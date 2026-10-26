// Replays a logged session on the current build and compares the outcomes
// (plan LG6). Run `deno task logs:replay <session.jsonl>`. The blobs come from
// the `blobs/` folder beside the session file.
//
// Exit codes: 0 when every compared outcome matches, 1 on the first
// difference, 2 for a usage error, a missing file or blob, or a session that
// replay does not support. The core, `replaySession`, is pure: it takes the
// events and a blob reader, so tests replay a session they just recorded.
//
// What each surface compares, after removing the values that change from run
// to run (`ms`, `t`, `pg.compile` time, `lsp.timing`, and the memory fields of
// `effektive/stats`):
// - cli: the `cli.diagnostics` and `cli.output` events. The `--tsc` stage is
//   skipped, because it needs the Deno cache.
// - lsp: every message out, every disk call, every flush, stderr text, and exit.
// - playground: every `pg.compile` and `pg.error`.

import { equal } from "@std/assert/equal";
import {
  isRecord,
  joinPath,
  type ReadError,
  sha256Hex,
} from "../src/core/mod.ts";
import type { Result } from "../src/core/mod.ts";
import { parseArgs } from "../src/cli/args.ts";
import { main } from "../src/cli/main.ts";
import type { DirectoryEntry, FileFailure, HostIo } from "../src/host/io.ts";
import { type Envelope, memoryLog, type Surface } from "../src/host/log.ts";
import type { FrameError } from "../src/lsp/jsonrpc.ts";
import { LanguageServer, type ServerPorts } from "../src/lsp/server.ts";
import { EXAMPLE_FILES, REPOSITORY_ROOT } from "../playground/build.ts";
import { createPlayground } from "../playground/src/compile.ts";
import { compileData, errorData } from "../playground/src/events.ts";
import { outputState, savingLabel } from "../playground/src/model.ts";
import { applyChanges, editChangesOf } from "../playground/src/replay.ts";
import { parseSession } from "./logs_report.ts";

/** Returns the text of a blob, or undefined when the blob is missing. */
export type BlobReader = (hash: string) => string | undefined;

export type ReplayOutcome =
  | {
    readonly tag: "same";
    readonly surface: Surface;
    /** The number of logged events that replay compared. */
    readonly compared: number;
    /** The stages that replay did not run, such as `tsc`. */
    readonly skipped: readonly string[];
  }
  | {
    readonly tag: "different";
    /** The `seq` and kind of the logged event that differs. */
    readonly seq: number;
    readonly kind: string;
    readonly expected: unknown;
    readonly actual: unknown;
  }
  | { readonly tag: "unsupported"; readonly reason: string };

/** One outcome of a session: the logged one or the replayed one. */
interface Observation {
  readonly kind: string;
  readonly data: unknown;
}

type Logged = Observation & { readonly seq: number };

const unsupported = (reason: string): ReplayOutcome => ({
  tag: "unsupported",
  reason,
});

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The value as JSON data, so that `undefined` members compare like the logged ones. */
const plain = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/**
 * Compares the logged outcomes with the replayed ones, in order. The first
 * difference names the logged event. A replay that ends early or goes on
 * longer is a difference too.
 */
function compare(
  surface: Surface,
  expected: readonly Logged[],
  actual: readonly Observation[],
  skipped: readonly string[] = [],
): ReplayOutcome {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    const want = expected[i];
    const got = actual[i];
    if (want === undefined) {
      return {
        tag: "different",
        seq: expected.at(-1)?.seq ?? 0,
        kind: "end of session",
        expected: undefined,
        actual: plain(got),
      };
    }
    const data = got === undefined ? undefined : plain(got.data);
    if (
      got === undefined || got.kind !== want.kind || !equal(want.data, data)
    ) {
      return {
        tag: "different",
        seq: want.seq,
        kind: want.kind,
        expected: want.data,
        actual: got === undefined || got.kind === want.kind
          ? data
          : { kind: got.kind, data },
      };
    }
  }
  return { tag: "same", surface, compared: expected.length, skipped };
}

// ------------------------------------------------------------------ cli

/** A file system in a map, as the CLI needs it. Paths are the ones the CLI builds. */
function memoryFs(files: Map<string, string>): HostIo["fs"] {
  const prefixOf = (dir: string): string =>
    dir === "." || dir === "" ? "" : dir.replace(/\/+$/, "") + "/";
  return {
    readText(path): Result<string, ReadError> {
      const text = files.get(path);
      return text === undefined
        ? { ok: false, error: { tag: "not-found", path } }
        : { ok: true, value: text };
    },
    writeText(path, text): Result<void, FileFailure> {
      files.set(path, text);
      return { ok: true, value: undefined };
    },
    remove(path): Result<void, FileFailure> {
      files.delete(path);
      return { ok: true, value: undefined };
    },
    kind(path) {
      if (files.has(path)) return "file";
      const prefix = prefixOf(path);
      for (const key of files.keys()) {
        if (key.startsWith(prefix) && key !== path) return "directory";
      }
      return "missing";
    },
    list(path): Result<readonly DirectoryEntry[], FileFailure> {
      const prefix = prefixOf(path);
      const found = new Map<string, boolean>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) found.set(rest, false);
        else found.set(rest.slice(0, slash), true);
      }
      return {
        ok: true,
        value: [...found].map(([name, isDirectory]) => ({ name, isDirectory })),
      };
    },
    absolute: (path) =>
      path === "." ? "/mem" : path.startsWith("/") ? path : `/mem/${path}`,
  };
}

const CLI_KINDS: ReadonlySet<string> = new Set([
  "cli.diagnostics",
  "cli.output",
]);

async function replayCli(
  events: readonly Envelope[],
  blob: BlobReader,
): Promise<ReplayOutcome> {
  const start = events.find((e) => e.kind === "cli.start")?.data;
  const logged = isRecord(start) && Array.isArray(start.args) ? start.args : [];
  const argv = logged.filter((a): a is string => typeof a === "string");
  if (argv.length === 0 || argv.length !== logged.length) {
    return unsupported("cli.start holds no arguments");
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok || parsed.value.kind === "help") {
    return unsupported("the logged arguments do not name a project command");
  }
  // shortcut: watch mode (cli.change) needs the changed files in order, so replay
  // supports one-shot commands only. Upgrade when a watch session needs a regression check.
  if (parsed.value.kind === "watch") {
    return unsupported("watch sessions (cli.change) are not supported yet");
  }
  const root = parsed.value.root;
  const files = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "cli.input" || !isRecord(event.data)) continue;
    const { path, hash, removed, target } = event.data;
    if (typeof path !== "string" || target === true) continue;
    if (removed === true) {
      files.delete(joinPath(root, path));
      continue;
    }
    const text = typeof hash === "string" ? blob(hash) : undefined;
    if (text === undefined) return unsupported(`missing blob for ${path}`);
    files.set(joinPath(root, path), text);
  }
  const log = memoryLog("cli");
  const io: HostIo = {
    stdout: () => {},
    stderr: () => {},
    fs: memoryFs(files),
    denoCheck: () =>
      Promise.resolve({
        ok: false,
        error: { message: "tsc is skipped in replay" },
      }),
    watch: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    }),
    openLog: () => log,
  };
  const skipsTsc = argv.includes("--tsc");
  await main(argv.filter((a) => a !== "--tsc" && a !== "--no-log"), io);
  const expected = events.filter((e) => CLI_KINDS.has(e.kind));
  // The log holds no earlier generated files, so replay writes files that the
  // original run found up to date. Only the files that the original wrote count.
  const wrote = new Set(
    expected.flatMap((e) =>
      e.kind === "cli.output" && isRecord(e.data) ? [e.data.path] : []
    ),
  );
  const replayed = log.events.filter((e) =>
    e.kind === "cli.diagnostics" ||
    (e.kind === "cli.output" && isRecord(e.data) && wrote.has(e.data.path))
  );
  return compare(
    "cli",
    expected,
    replayed,
    skipsTsc ? ["tsc"] : [],
  );
}

// ------------------------------------------------------------------ lsp

const LSP_KINDS: ReadonlySet<string> = new Set([
  "lsp.out",
  "lsp.fs",
  "lsp.flush",
  "lsp.error",
  "lsp.exit",
]);

/**
 * The comparable form of a logged or replayed LSP outcome. A disk call counts
 * by what it asked (the written hash included), not by what it got. An
 * `effektive/stats` answer loses its memory fields.
 */
function normalizeLsp(kind: string, data: unknown): Observation {
  const copy = plain(data);
  if (!isRecord(copy)) return { kind, data: copy };
  if (kind === "lsp.fs") {
    const { op, path, hash } = copy;
    return {
      kind,
      data: op === "writeText" ? { op, path, hash } : { op, path },
    };
  }
  if (
    kind === "lsp.out" && isRecord(copy.message) &&
    isRecord(copy.message.result)
  ) {
    const { memory: _memory, ...result } = copy.message.result;
    return {
      kind,
      data: { ...copy, message: { ...copy.message, result } },
    };
  }
  return { kind, data: copy };
}

const KINDS = ["file", "directory", "missing"] as const;

function replayLsp(
  events: readonly Envelope[],
  blob: BlobReader,
): ReplayOutcome {
  // Resolve the blobs first, so that a missing one is a result and not a throw.
  const fsEvents = events.filter((e) => e.kind === "lsp.fs");
  const texts = new Map<string, string>();
  for (const { data } of fsEvents) {
    if (!isRecord(data) || data.op !== "readText") continue;
    if (typeof data.hash !== "string") continue;
    const text = blob(data.hash);
    if (text === undefined) return unsupported(`missing blob ${data.hash}`);
    texts.set(data.hash, text);
  }
  const actual: Observation[] = [];
  let cursor = 0;
  /** The logged result of the next disk call, when it is the same operation. */
  const take = (
    op: string,
    path: string,
    hash?: string,
  ): Record<string, unknown> => {
    const data = fsEvents[cursor++]?.data;
    actual.push({ kind: "lsp.fs", data: { op, path, hash } });
    return isRecord(data) && data.op === op ? data : {};
  };
  let pending: (() => void) | undefined;
  const failure = (): Result<void, FileFailure> => ({
    ok: false,
    error: { message: "replayed failure" },
  });
  const ok = (): Result<void, FileFailure> => ({ ok: true, value: undefined });
  const ports: ServerPorts = {
    send: (message) => {
      actual.push({ kind: "lsp.out", data: { message } });
    },
    fs: {
      readText: (path) => {
        const data = take("readText", path);
        const text = typeof data.hash === "string"
          ? texts.get(data.hash)
          : undefined;
        if (text !== undefined) return { ok: true, value: text };
        const error = data.error;
        return {
          ok: false,
          error: isRecord(error) && error.tag === "unreadable"
            ? { tag: "unreadable", path, message: str(error.message) ?? "" }
            : { tag: "not-found", path },
        };
      },
      writeText: (path, text) => {
        const data = take("writeText", path, sha256Hex(text));
        return data.ok === false ? failure() : ok();
      },
      remove: (path) => take("remove", path).ok === false ? failure() : ok(),
      kind: (path) => {
        const kind = take("kind", path).kind;
        return KINDS.find((k) => k === kind) ?? "missing";
      },
      list: (path) => {
        const entries = take("list", path).entries;
        if (!Array.isArray(entries)) {
          return { ok: false, error: { message: "replayed failure" } };
        }
        return {
          ok: true,
          value: entries.filter(isRecord).map((e) => ({
            name: str(e.name) ?? "",
            isDirectory: e.isDirectory === true,
          })),
        };
      },
      absolute: (path) => str(take("absolute", path).result) ?? path,
    },
    schedule: (callback) => {
      pending = callback;
      return () => {
        if (pending === callback) pending = undefined;
      };
    },
    exit: (code) => {
      actual.push({ kind: "lsp.exit", data: { code } });
    },
    stderr: (text) => {
      actual.push({ kind: "lsp.error", data: { text } });
    },
    // The memory fields are removed before the comparison.
    memory: () => ({ rss: 0, heapUsed: 0 }),
  };
  const server = new LanguageServer(ports);
  for (const { kind, data } of events) {
    if (kind === "lsp.in" && isRecord(data)) {
      const error = data.error;
      const frame: Result<unknown, FrameError> =
        isRecord(error) && typeof error.message === "string" &&
          (error.tag === "bad-json" || error.tag === "bad-header")
          ? { ok: false, error: { tag: error.tag, message: error.message } }
          : { ok: true, value: data.message };
      server.handle(frame);
    } else if (kind === "lsp.batch") {
      server.afterBatch();
    } else if (kind === "lsp.flush" && pending !== undefined) {
      const run = pending;
      pending = undefined;
      actual.push({ kind: "lsp.flush", data: {} });
      run();
    }
  }
  const expected: Logged[] = events.filter((e) => LSP_KINDS.has(e.kind)).map((
    e,
  ) => ({ seq: e.seq, ...normalizeLsp(e.kind, e.data) }));
  return compare(
    "lsp",
    expected,
    actual.map((o) => normalizeLsp(o.kind, o.data)),
  );
}

// ------------------------------------------------------------------ playground

/** The bundled examples, read the way `playground/build.ts` reads them. */
export function loadExamples(): Record<string, string> {
  const examples: Record<string, string> = {};
  for (const path of EXAMPLE_FILES) {
    examples[path] = Deno.readTextFileSync(
      `${REPOSITORY_ROOT}/fixtures/examples/${path}`,
    );
  }
  return examples;
}

/** The message that `app.ts` shows and logs for an error of the facade. */
function errorText(tag: string, message: string): string {
  return tag === "config"
    ? `Configuration error: ${message}`
    : `Internal error: ${message}`;
}

/** The compile data without the elapsed time. */
const withoutTime = (data: unknown): unknown => {
  const copy = plain(data);
  if (!isRecord(copy)) return copy;
  const { ms: _ms, ...rest } = copy;
  return rest;
};

function replayPlayground(events: readonly Envelope[]): ReplayOutcome {
  const start = events.find((e) => e.kind === "pg.start");
  if (start === undefined || !isRecord(start.data)) {
    return unsupported("the session has no pg.start");
  }
  const examples = loadExamples();
  if (start.data.examples !== sha256Hex(JSON.stringify(examples))) {
    return unsupported("the examples changed since the session was recorded");
  }
  const session = createPlayground(examples, { now: () => 0 });
  const texts: Record<string, string> = { ...examples };
  let active = "";
  let result = session.start();
  const expected: Logged[] = [];
  const actual: Observation[] = [];
  /** The outcome that the replayed result gives, as the page would log it. */
  const observe = (): Observation => {
    if (!result.ok) {
      const { tag, message } = result.error;
      return {
        kind: "pg.error",
        data: errorData(tag, errorText(tag, message)),
      };
    }
    const state = outputState(result.value, active);
    const saving = state.tag === "text" && !active.endsWith(".effi")
      ? savingLabel(texts[active] ?? "", state.text)
      : "";
    return {
      kind: "pg.compile",
      data: withoutTime(compileData(active, result.value, saving)),
    };
  };
  for (const event of events) {
    const data = event.data;
    if (!isRecord(data)) continue;
    if (event.kind === "pg.select" && typeof data.path === "string") {
      active = data.path;
    } else if (event.kind === "pg.edit" && typeof data.path === "string") {
      const changes = editChangesOf(data);
      if (changes === undefined) {
        return unsupported(`bad pg.edit at seq ${event.seq}`);
      }
      const text = applyChanges(texts[data.path] ?? "", changes);
      if (text.length !== data.length) {
        return {
          tag: "different",
          seq: event.seq,
          kind: event.kind,
          expected: { length: data.length },
          actual: { length: text.length },
        };
      }
      texts[data.path] = text;
      result = session.update(data.path, text);
    } else if (event.kind === "pg.compile" || event.kind === "pg.error") {
      expected.push({
        seq: event.seq,
        kind: event.kind,
        data: event.kind === "pg.compile"
          ? withoutTime(event.data)
          : event.data,
      });
      actual.push(observe());
    }
  }
  return compare("playground", expected, actual);
}

// ------------------------------------------------------------------ entry

/** Replays the events of one session on the current build. */
export function replaySession(
  events: readonly Envelope[],
  blob: BlobReader,
): Promise<ReplayOutcome> {
  const surface = events[0]?.surface;
  if (surface === undefined) {
    return Promise.resolve(unsupported("the session has no events"));
  }
  if (events.some((e) => e.surface !== surface)) {
    return Promise.resolve(unsupported("the session mixes surfaces"));
  }
  switch (surface) {
    case "cli":
      return replayCli(events, blob);
    case "lsp":
      return Promise.resolve(replayLsp(events, blob));
    case "playground":
      return Promise.resolve(replayPlayground(events));
  }
}

function show(value: unknown): string {
  const text = value === undefined ? "(nothing)" : JSON.stringify(value);
  return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
}

if (import.meta.main) {
  const [file, ...rest] = Deno.args;
  if (file === undefined || rest.length > 0) {
    console.error("Usage: deno task logs:replay <session.jsonl>");
    Deno.exit(2);
  }
  let text: string;
  try {
    text = Deno.readTextFileSync(file);
  } catch (error) {
    console.error(
      `logs:replay: cannot read ${file}: ${
        error instanceof Error ? error.message : error
      }`,
    );
    Deno.exit(2);
  }
  const session = parseSession(text, file);
  if (session.badLines.length > 0) {
    console.error(
      `logs:replay: ${file}: bad lines ${session.badLines.join(", ")}`,
    );
    Deno.exit(2);
  }
  const folder = file.includes("/")
    ? file.slice(0, file.lastIndexOf("/"))
    : ".";
  const blob: BlobReader = (hash) => {
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    try {
      return Deno.readTextFileSync(`${folder}/blobs/${hash}.txt`);
    } catch {
      return undefined;
    }
  };
  const outcome = await replaySession(session.events, blob);
  switch (outcome.tag) {
    case "same": {
      const skipped = outcome.skipped.map((s) => `, ${s} skipped`).join("");
      console.log(
        `same: ${outcome.surface}, ${outcome.compared} events compared${skipped}`,
      );
      break;
    }
    case "different":
      console.log(
        `different at seq ${outcome.seq}, kind ${outcome.kind}\nexpected: ${
          show(outcome.expected)
        }\nactual: ${show(outcome.actual)}`,
      );
      Deno.exit(1);
      break;
    case "unsupported":
      console.error(`logs:replay: unsupported: ${outcome.reason}`);
      Deno.exit(2);
  }
}
