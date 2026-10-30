// The surface oracle: records the command-line output and the language server
// output of the current build, so that a refactor shows each change of a message,
// an exit code, or the order of replies. `scripts/surface_update.ts` writes the
// records to `fixtures/surface/`, and `tests/surface_test.ts` compares them.
//
// A command-line record is `{ args, code, events }`. The events keep the order
// across stdout, stderr, file writes, file removals, and failures. A file event
// holds the SHA-256 of its text, not the text.

import { sha256Hex } from "../src/core/mod.ts";
import { main } from "../src/cli/main.ts";
import type { HostIo } from "../src/host/io.ts";
import { memoryIo, under } from "./cli_helpers.ts";
import { exampleFiles, FIXTURES, listErrorCases } from "./helpers.ts";
import {
  didChangeFull,
  didClose,
  didOpen,
  exampleFiles as lspExampleFiles,
  exampleUri,
  makeHarness,
  notification,
  request,
  ROOT as LSP_ROOT,
  watched,
} from "./lsp_helpers.ts";

/** The virtual project directory of the command-line cases. */
const ROOT = "/proj";

// ---- Command line -----------------------------------------------------------

export type SurfaceEvent =
  | { readonly kind: "stdout"; readonly text: string }
  | { readonly kind: "stderr"; readonly text: string }
  | { readonly kind: "write"; readonly path: string; readonly sha256: string }
  | { readonly kind: "remove"; readonly path: string }
  | {
    readonly kind: "failure";
    readonly operation: "write" | "remove";
    readonly path: string;
    readonly message: string;
  };

export interface CliRecord {
  readonly args: readonly string[];
  readonly code: number;
  readonly events: readonly SurfaceEvent[];
}

export interface CliCase {
  readonly name: string;
  readonly args: readonly string[];
  /** Files by path relative to the project root. */
  readonly files: Readonly<Record<string, string>>;
}

/** Runs `main` with memory ports, and records every output in order. */
export async function runCliCase(c: CliCase): Promise<CliRecord> {
  const memory = memoryIo(under(ROOT, c.files));
  const events: SurfaceEvent[] = [];
  const { fs } = memory.io;
  const io: HostIo = {
    ...memory.io,
    stdout: (text) => {
      events.push({ kind: "stdout", text });
      memory.io.stdout(text);
    },
    stderr: (text) => {
      events.push({ kind: "stderr", text });
      memory.io.stderr(text);
    },
    fs: {
      ...fs,
      writeText(path, text) {
        const result = fs.writeText(path, text);
        events.push(
          result.ok ? { kind: "write", path, sha256: sha256Hex(text) } : {
            kind: "failure",
            operation: "write",
            path,
            message: result.error.message,
          },
        );
        return result;
      },
      remove(path) {
        const result = fs.remove(path);
        events.push(
          result.ok ? { kind: "remove", path } : {
            kind: "failure",
            operation: "remove",
            path,
            message: result.error.message,
          },
        );
        return result;
      },
    },
  };
  const code = await main(c.args, io);
  return { args: c.args, code, events };
}

/** Every file under a fixtures directory, by path relative to it. */
function readTree(
  url: URL,
  prefix: string,
  out: Record<string, string>,
): Record<string, string> {
  for (const entry of Deno.readDirSync(url)) {
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), url);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory) readTree(child, `${name}/`, out);
    else out[name] = Deno.readTextFileSync(child);
  }
  return out;
}

const NO_FILES: Readonly<Record<string, string>> = {};

/** The literal command-line cases over the examples and the usage. */
export function fixedCliCases(): readonly CliCase[] {
  const examples = exampleFiles();
  return [
    { name: "examples-check", args: ["check", ROOT], files: examples },
    { name: "examples-build", args: ["build", ROOT], files: examples },
    {
      name: "examples-build-validate",
      args: ["build", ROOT, "--validate"],
      files: examples,
    },
    { name: "usage-no-arguments", args: [], files: NO_FILES },
    { name: "usage-help", args: ["--help"], files: NO_FILES },
    { name: "usage-unknown-command", args: ["nope"], files: NO_FILES },
    {
      name: "usage-missing-project",
      args: ["check", "/missing"],
      files: NO_FILES,
    },
    {
      name: "usage-unknown-flag",
      args: ["check", ROOT, "--nope"],
      files: examples,
    },
  ];
}

/**
 * One `check` case for each entry of `fixtures/errors/`. A single file runs as a
 * one-file project with an empty `effektive.json`. A directory is a project.
 */
export function errorCliCases(): readonly CliCase[] {
  return listErrorCases().map((c) => ({
    name: `errors-${c.name}`,
    args: ["check", ROOT],
    files: c.kind === "file"
      ? { "effektive.json": "{}", [c.files[0].path]: c.files[0].text }
      : readTree(new URL(`${c.path}/`, FIXTURES), "", {}),
  }));
}

export function cliCases(): readonly CliCase[] {
  return [...fixedCliCases(), ...errorCliCases()];
}

export async function cliRecords(): Promise<Record<string, CliRecord>> {
  const records: Record<string, CliRecord> = {};
  for (const c of cliCases()) records[c.name] = await runCliCase(c);
  return records;
}

// ---- Language server --------------------------------------------------------

export interface LspStep {
  readonly step: string;
  /** Every message the server sent during the step, in order. */
  readonly sent: readonly unknown[];
  readonly stderr?: readonly string[];
  readonly exits?: readonly number[];
}

/** A text longer than this becomes its SHA-256, so that a record stays small. */
const LONG_TEXT = 400;

function shorten(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > LONG_TEXT
      ? `sha256:${sha256Hex(value)} (${value.length} characters)`
      : value;
  }
  if (Array.isArray(value)) return value.map(shorten);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shorten(item)]),
    );
  }
  return value;
}

/** The position of the first `needle` in `text`, plus `shift` characters. */
function positionOf(text: string, needle: string, shift = 0) {
  const offset = text.indexOf(needle) + shift;
  const before = text.slice(0, offset).split("\n");
  const line = before.length - 1;
  return { line, character: before[line].length };
}

/** A module that calls a service without a `fails` or `uses` entry. */
const SCRATCH_TEXT =
  "type Count = int\nerror Failed = {}\nservice Clock { now(): Count fails Failed }\nexport const run = (): Count => Clock.now()\n";

/** A module whose private constant has an inferred contract. */
const HINTS_TEXT =
  "type Count = int\nerror Failed = {}\nservice Clock { now(): Count fails Failed }\nconst read = () => { Clock.now() }\n";

/** One scripted session that sends valid parameters for all 22 handled methods. */
export function lspRecords(): readonly LspStep[] {
  const files = lspExampleFiles();
  const mainText = files["main.eff"];
  const usersText = files["users.eff"];
  const MAIN = exampleUri("main.eff");
  const USERS = exampleUri("users.eff");
  const call = positionOf(mainText, "displayName(");
  const argument = positionOf(mainText, '"u1"');
  const h = makeHarness();
  const steps: LspStep[] = [];
  let id = 0;

  const run = (step: string, ...messages: readonly unknown[]): void => {
    h.deliver(...messages);
    h.runTimers();
    steps.push({
      step,
      sent: h.sent.map(shorten),
      ...(h.stderr.length > 0 ? { stderr: [...h.stderr] } : {}),
      ...(h.exits.length > 0 ? { exits: [...h.exits] } : {}),
    });
    h.clearSent();
    h.stderr.length = 0;
    h.exits.length = 0;
  };
  const ask = (method: string, params?: unknown): void =>
    run(method, request(++id, method, params));
  const at = (uri: string, position: { line: number; character: number }) => ({
    textDocument: { uri },
    position,
  });

  // Lifecycle: start.
  run("initialize", request(++id, "initialize", { capabilities: {} }));
  run("initialized", notification("initialized", {}));

  // Notifications: open both documents, then a change of the main document.
  run("textDocument/didOpen main", didOpen(MAIN, 1, mainText));
  run("textDocument/didOpen users", didOpen(USERS, 1, usersText));

  // Requests on the open documents.
  ask("textDocument/hover", at(MAIN, call));
  ask("textDocument/definition", at(MAIN, call));
  ask("textDocument/references", {
    ...at(MAIN, call),
    context: { includeDeclaration: true },
  });
  ask("textDocument/prepareRename", at(MAIN, call));
  ask("textDocument/rename", { ...at(MAIN, call), newName: "shownName" });
  ask(
    "textDocument/completion",
    at(MAIN, positionOf(mainText, "displayName(", 4)),
  );
  ask("textDocument/signatureHelp", at(MAIN, argument));
  ask("textDocument/semanticTokens/full", { textDocument: { uri: USERS } });
  ask("textDocument/documentSymbol", { textDocument: { uri: USERS } });
  ask("effektive/generatedTypeScript", { textDocument: { uri: MAIN } });
  ask("effektive/stats", { textDocument: { uri: MAIN } });

  // A third document with a missing effect entry, so that the code action has an
  // answer.
  const scratch = exampleUri("scratch.eff");
  run("textDocument/didOpen scratch", didOpen(scratch, 1, SCRATCH_TEXT));
  const run0 = positionOf(SCRATCH_TEXT, "export const run");
  ask("textDocument/codeAction", {
    textDocument: { uri: scratch },
    range: { start: run0, end: run0 },
    context: { diagnostics: [] },
  });
  // A fourth document with no error, so that the inlay hint has an answer.
  const hints = exampleUri("hints.eff");
  run("textDocument/didOpen hints", didOpen(hints, 1, HINTS_TEXT));
  ask("textDocument/inlayHint", {
    textDocument: { uri: hints },
    range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
  });

  // Notifications: change, save, watched files, close.
  run(
    "textDocument/didChange",
    didChangeFull(
      MAIN,
      2,
      mainText.replace('displayName("u1")', "displayName(1)"),
    ),
  );
  // A change of one document that changes the diagnostics of both open documents,
  // so that the record pins the order of the two publishes.
  run(
    "textDocument/didChange users",
    didChangeFull(
      USERS,
      2,
      usersText.replaceAll("displayName", "shownName") +
        "\nexport const broken: int = true\n",
    ),
  );
  run(
    "textDocument/didSave",
    notification("textDocument/didSave", { textDocument: { uri: MAIN } }),
  );
  const collections = exampleUri("collections.eff");
  h.files.set(
    `${LSP_ROOT}/collections.eff`,
    files["collections.eff"] + "\nexport const broken: int = true\n",
  );
  run(
    "workspace/didChangeWatchedFiles",
    watched({ uri: collections, type: 2 }),
  );
  run("textDocument/didClose", didClose(MAIN));

  // An unsupported request and an ignored notification.
  ask("textDocument/formatting", {
    textDocument: { uri: USERS },
    options: { tabSize: 2, insertSpaces: true },
  });
  run("ignored notification", notification("$/setTrace", { value: "off" }));

  // Lifecycle: stop.
  ask("shutdown");
  run("exit", notification("exit"));
  return steps;
}
