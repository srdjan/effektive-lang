// Turns session logs into a Markdown report (plan LG5): sessions, broken
// behavior, latency, friction, and outcomes.
//
// Run `deno task logs:report [--since <N>(m|h|d)] [folder ...]` from the
// repository root. The default window is 24h and the default folder is
// `playground/.effektive/logs/`. The core functions are pure, so tests call
// `parseSession` and `buildReport` on fixture text.

import { isRecord, type Result } from "../src/core/mod.ts";
import type { Envelope, Surface } from "../src/host/log.ts";

/** The p90 budget for diagnostics latency, from `docs/release-measurements.md`. */
export const BUDGET_MS = 100;
/** Edits closer together than this form one burst. */
export const BURST_GAP_MS = 1000;
const DEFAULT_FOLDER = "playground/.effektive/logs/";
const UNITS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
const SURFACES: readonly string[] = ["cli", "lsp", "playground"];
const END_KINDS: ReadonlySet<string> = new Set([
  "cli.end",
  "lsp.exit",
  "pg.end",
]);
const RPC_NAMES: Readonly<Record<number, string>> = {
  [-32603]: "internal error",
  [-32602]: "invalid params",
  // features.ts: an edit request against an old document version.
  [-32801]: "content modified",
};
const NONE = "None in this period.";

type Obj = Record<string, unknown>;

/** One session file: its events and the numbers of its unparsable lines. */
export interface LogFile {
  readonly file: string;
  readonly events: readonly Envelope[];
  readonly badLines: readonly number[];
}

export interface ReportOptions {
  readonly now: Date;
  readonly sinceMs: number;
  /** Folders that could not be read, one note each. */
  readonly notes?: readonly string[];
}

// ------------------------------------------------------------------ parsing

function asEnvelope(value: unknown): Envelope | undefined {
  if (!isRecord(value)) return undefined;
  const { v, t, ms, surface, session, seq, build, kind } = value;
  return v === 1 && typeof t === "string" && !Number.isNaN(Date.parse(t)) &&
      typeof ms === "number" && typeof surface === "string" &&
      SURFACES.includes(surface) && typeof session === "string" &&
      typeof seq === "number" && typeof build === "string" &&
      typeof kind === "string"
    ? value as unknown as Envelope
    : undefined;
}

/** Reads the lines of one session file. A bad line is counted, not thrown. */
export function parseSession(text: string, file: string): LogFile {
  const events: Envelope[] = [];
  const badLines: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    const event = asEnvelope(parsed);
    if (event === undefined) badLines.push(index + 1);
    else events.push(event);
  });
  return { file, events, badLines };
}

/** Parses `[--since <N>(m|h|d)] [folder ...]`. */
export function parseArgs(
  args: readonly string[],
): Result<{ sinceMs: number; folders: string[] }, string> {
  let sinceMs = 24 * UNITS.h;
  const folders: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--since") {
      const value = args[++i] ?? "";
      const match = /^(\d+)([mhd])$/.exec(value);
      if (match === null || Number(match[1]) === 0) {
        return { ok: false, error: `bad --since value: "${value}"` };
      }
      sinceMs = Number(match[1]) * UNITS[match[2]];
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown flag: ${arg}` };
    } else folders.push(arg);
  }
  return {
    ok: true,
    value: {
      sinceMs,
      folders: folders.length > 0 ? folders : [DEFAULT_FOLDER],
    },
  };
}

// ------------------------------------------------------------------ helpers

const record = (value: unknown): Obj => isRecord(value) ? value : {};
const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const short = (e: Envelope): string => e.session.slice(0, 8);
const where = (e: Envelope): string => `\`${short(e)}\` seq ${e.seq}`;
const ms1 = (value: number): string => (Math.round(value * 10) / 10).toString();

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
}

function table(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const line = (cells: readonly (string | number)[]) =>
    `| ${cells.join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map(line),
  ].join("\n");
}

function countBy(keys: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const section = (title: string, body: string): string =>
  `## ${title}\n\n${body}\n`;

/** A code list from a `pg.compile` diagnostics array or a `publishDiagnostics`. */
function codesOf(diagnostics: unknown): Set<string> {
  const codes = new Set<string>();
  if (!Array.isArray(diagnostics)) return codes;
  for (const d of diagnostics) {
    const code = record(d).code;
    if (typeof code === "string" || typeof code === "number") {
      codes.add(String(code));
    }
  }
  return codes;
}

/** An edit or a diagnostics result of one document, for the friction rules. */
type DocEvent =
  | { readonly edit: true; readonly ms: number }
  | { readonly edit: false; readonly ms: number; readonly codes: Set<string> };

/** The edits and results of one session, grouped by path or URI. */
function docEvents(events: readonly Envelope[]): Map<string, DocEvent[]> {
  const docs = new Map<string, DocEvent[]>();
  const add = (key: string | undefined, event: DocEvent) => {
    if (key === undefined) return;
    const list = docs.get(key);
    if (list === undefined) docs.set(key, [event]);
    else list.push(event);
  };
  for (const e of events) {
    const d = record(e.data);
    const message = record(d.message);
    const params = record(message.params);
    if (e.kind === "pg.edit") add(str(d.path), { edit: true, ms: e.ms });
    else if (e.kind === "pg.compile") {
      add(str(d.path), {
        edit: false,
        ms: e.ms,
        codes: codesOf(d.diagnostics),
      });
    } else if (e.kind === "lsp.in") {
      const method = message.method;
      if (method === "textDocument/didChange") {
        add(str(record(params.textDocument).uri), { edit: true, ms: e.ms });
      }
    } else if (
      e.kind === "lsp.out" &&
      message.method === "textDocument/publishDiagnostics"
    ) {
      add(str(params.uri), {
        edit: false,
        ms: e.ms,
        codes: codesOf(params.diagnostics),
      });
    }
  }
  return docs;
}

// ------------------------------------------------------------------ sections

function sessionsSection(files: readonly LogFile[], options: ReportOptions) {
  const rows = countBy(
    files.map((f) => `${f.events[0].surface} | ${f.events[0].build}`),
  ).map(([key, count]) => `${key} | ${count}`);
  const times = files.flatMap((f) => f.events.map((e) => Date.parse(e.t)));
  const lines = [
    `Window: ${
      new Date(options.now.getTime() - options.sinceMs).toISOString()
    } to ${options.now.toISOString()}.`,
    ...(options.notes ?? []),
  ];
  if (files.length === 0) {
    return section("Sessions", [...lines, NONE].join("\n"));
  }
  lines.push(
    `Events from ${new Date(Math.min(...times)).toISOString()} to ${
      new Date(Math.max(...times)).toISOString()
    }.`,
  );
  return section(
    "Sessions",
    `${
      lines.join("\n")
    }\n\n| Surface | Build | Sessions |\n| --- | --- | --- |\n${
      rows.map((r) => `| ${r} |`).join("\n")
    }`,
  );
}

function brokenItems(file: LogFile): string[] {
  const items: string[] = [];
  for (const e of file.events) {
    const d = record(e.data);
    if (e.kind === "lsp.out") {
      const error = record(record(d.message).error);
      if (typeof error.code === "number") {
        const name = RPC_NAMES[error.code];
        items.push(
          `${where(e)}: language server error ${error.code}${
            name === undefined ? "" : ` (${name})`
          }: ${str(error.message) ?? ""}`,
        );
      }
    } else if (e.kind === "lsp.in" && d.error !== undefined) {
      const error = record(d.error);
      items.push(
        `${where(e)}: bad frame ${str(error.tag) ?? ""}: ${
          str(error.message) ?? ""
        }`,
      );
    } else if (e.kind === "lsp.error") {
      items.push(
        `${where(e)}: language server error text: ${str(d.text) ?? ""}`,
      );
    } else if (e.kind === "cli.error") {
      items.push(`${where(e)}: CLI error: ${str(d.message) ?? ""}`);
    } else if (e.kind === "pg.error") {
      items.push(
        `${where(e)}: playground error ${str(d.tag) ?? ""}: ${
          str(d.message) ?? ""
        }`,
      );
    } else if (e.kind === "cli.end") {
      // main.ts: 2 is a usage or configuration error, 3 is an internal error.
      if (d.code === 2) {
        items.push(`${where(e)}: CLI exit 2 (usage or configuration error)`);
      }
      if (d.code === 3) items.push(`${where(e)}: CLI exit 3 (internal error)`);
    }
  }
  for (const line of file.badLines) {
    items.push(`\`${file.file}\` line ${line}: unparsable line`);
  }
  // One item stays on one line, also when a message holds a newline.
  return items.map((item) => item.replace(/\s+/g, " ").trim());
}

function brokenSection(files: readonly LogFile[]) {
  const items = files.flatMap(brokenItems);
  const open =
    files.filter((f) =>
      f.events.length > 0 && !f.events.some((e) => END_KINDS.has(e.kind))
    ).length;
  const body = items.length === 0
    ? NONE
    : items.map((i) => `- ${i}`).join("\n");
  return section(
    "Broken behavior",
    `${body}\n\nSessions that ended without an end event: ${open}.`,
  );
}

/** The diagnostics latency samples: an edit to the next publish of its URI. */
function diagnosticsLatency(files: readonly LogFile[]): number[] {
  const samples: number[] = [];
  for (const f of files) {
    const pending = new Map<string, number[]>();
    for (const e of f.events) {
      const message = record(record(e.data).message);
      const params = record(message.params);
      if (
        e.kind === "lsp.in" &&
        /^textDocument\/did(Change|Open)$/.test(String(message.method))
      ) {
        const uri = str(record(params.textDocument).uri);
        if (uri !== undefined) {
          const list = pending.get(uri);
          if (list === undefined) pending.set(uri, [e.ms]);
          else list.push(e.ms);
        }
      } else if (
        e.kind === "lsp.out" &&
        message.method === "textDocument/publishDiagnostics"
      ) {
        const uri = str(params.uri);
        for (const start of pending.get(uri ?? "") ?? []) {
          samples.push(e.ms - start);
        }
        pending.delete(uri ?? "");
      }
    }
  }
  return samples;
}

function latencySection(files: readonly LogFile[]) {
  const ops = new Map<string, number[]>();
  const add = (name: string, value: unknown) => {
    if (typeof value !== "number") return;
    const list = ops.get(name);
    if (list === undefined) ops.set(name, [value]);
    else list.push(value);
  };
  for (const e of files.flatMap((f) => f.events)) {
    const d = record(e.data);
    if (e.kind === "cli.phase") add(`cli.phase ${str(d.name)}`, d.ms);
    else if (e.kind === "lsp.timing") add(`lsp.timing ${str(d.method)}`, d.ms);
    else if (e.kind === "pg.compile") add("pg.compile", d.ms);
  }
  const diagnostics = diagnosticsLatency(files);
  if (diagnostics.length > 0) {
    ops.set("lsp diagnostics (edit to publish)", diagnostics);
  }
  if (ops.size === 0) return section("Latency", NONE);
  const rows = [...ops].sort((a, b) => a[0].localeCompare(b[0])).map(
    ([name, values]) => {
      const sorted = values.toSorted((a, b) => a - b);
      return [
        name,
        sorted.length,
        ms1(percentile(sorted, 50)),
        ms1(percentile(sorted, 90)),
      ];
    },
  );
  const budget = ["lsp diagnostics (edit to publish)", "pg.compile"].flatMap(
    (name) => {
      const values = ops.get(name);
      if (values === undefined) return [];
      const p90 = percentile(values.toSorted((a, b) => a - b), 90);
      return [
        `- ${name}: p90 ${ms1(p90)} ms is ${
          p90 <= BUDGET_MS ? "within" : "over"
        } the ${BUDGET_MS} ms budget.`,
      ];
    },
  );
  return section(
    "Latency",
    `${
      table(["Operation", "Count", "p50 ms", "p90 ms"], rows)
    }\n\nPercentiles use the nearest-rank rule.\n\n${budget.join("\n")}`,
  );
}

/**
 * Transient codes of one document: codes that show in a result inside an edit
 * burst and are absent from the last result of the burst. One burst counts
 * each such code once.
 */
function transientCodes(events: readonly DocEvent[]): string[] {
  const found: string[] = [];
  let seen = new Set<string>();
  let final: Set<string> | undefined;
  let last: number | undefined;
  const close = () => {
    if (final !== undefined) {
      for (const code of seen) if (!final.has(code)) found.push(code);
    }
    seen = new Set();
    final = undefined;
  };
  for (const e of events) {
    if (e.edit) {
      if (last !== undefined && e.ms - last >= BURST_GAP_MS) close();
      last = e.ms;
      final = undefined;
    } else if (last !== undefined) {
      final = e.codes;
      for (const code of e.codes) seen.add(code);
    }
  }
  close();
  return found;
}

/** Durations from a result with diagnostics to the next result with none. */
function fixTimes(events: readonly DocEvent[]): number[] {
  const times: number[] = [];
  let since: number | undefined;
  for (const e of events) {
    if (e.edit) continue;
    if (e.codes.size > 0) since ??= e.ms;
    else if (since !== undefined) {
      times.push(e.ms - since);
      since = undefined;
    }
  }
  return times;
}

/** Stale output spans of one session: `pg.compile` stale to the next not stale. */
function staleSpans(events: readonly Envelope[]): number[] {
  const spans: number[] = [];
  let since: number | undefined;
  for (const e of events) {
    if (e.kind !== "pg.compile") continue;
    const stale = record(e.data).stale;
    if (stale === true) since ??= e.ms;
    else if (stale === false && since !== undefined) {
      spans.push(e.ms - since);
      since = undefined;
    }
  }
  return spans;
}

/** Hover requests of the language server whose response has a null result. */
function lspHoverMisses(
  events: readonly Envelope[],
): { total: number; misses: number } {
  const asked = new Set<unknown>();
  let total = 0, misses = 0;
  for (const e of events) {
    const message = record(record(e.data).message);
    if (e.kind === "lsp.in" && message.method === "textDocument/hover") {
      asked.add(message.id);
    } else if (
      e.kind === "lsp.out" && "result" in message && asked.has(message.id)
    ) {
      total++;
      if (message.result === null) misses++;
    }
  }
  return { total, misses };
}

function frictionSection(files: readonly LogFile[]) {
  const transient: string[] = [];
  const fixes: number[] = [];
  const stale: number[] = [];
  const pgHovers = { pointer: 0, cursor: 0, total: 0 };
  const lsp = { total: 0, misses: 0 };
  const problems: string[] = [];
  const views: string[] = [];
  for (const f of files) {
    for (const events of docEvents(f.events).values()) {
      transient.push(...transientCodes(events));
      fixes.push(...fixTimes(events));
    }
    stale.push(...staleSpans(f.events));
    const hover = lspHoverMisses(f.events);
    lsp.total += hover.total;
    lsp.misses += hover.misses;
    for (const e of f.events) {
      const d = record(e.data);
      if (e.kind === "pg.hover") {
        pgHovers.total++;
        if (d.hit === false) {
          pgHovers[d.by === "cursor" ? "cursor" : "pointer"]++;
        }
      } else if (e.kind === "pg.problem") problems.push(str(d.code) ?? "?");
      else if (e.kind === "pg.view") views.push(str(d.name) ?? "?");
    }
  }
  const parts: string[] = [];
  parts.push(
    `### Transient diagnostics\n\nAn edit burst is a run of edits with gaps below ${BURST_GAP_MS} ms. A code is transient when it shows in a result inside the burst and is absent from the last result of the burst. Each code counts once for each burst.\n\n${
      transient.length === 0
        ? NONE
        : `Transient appearances: ${transient.length}.\n\n${
          table(["Code", "Count"], countBy(transient).slice(0, 10))
        }`
    }`,
  );
  const sorted = fixes.toSorted((a, b) => a - b);
  parts.push(
    `### Time from error to fix\n\n${
      sorted.length === 0
        ? NONE
        : `Fixes: ${sorted.length}, p50 ${
          ms1(percentile(sorted, 50))
        } ms, p90 ${ms1(percentile(sorted, 90))} ms.`
    }`,
  );
  const missed = pgHovers.pointer + pgHovers.cursor + lsp.misses;
  parts.push(
    `### Hovers with no answer\n\n${
      missed === 0
        ? NONE
        : `Playground: ${pgHovers.pointer} by pointer and ${pgHovers.cursor} by cursor, of ${pgHovers.total} hovers. Language server: ${lsp.misses} of ${lsp.total} hover responses.`
    }`,
  );
  parts.push(
    `### Stale output time\n\n${
      stale.length === 0
        ? NONE
        : `Spans: ${stale.length}, ${
          ms1(stale.reduce((a, b) => a + b, 0))
        } ms in total.`
    }`,
  );
  parts.push(
    `### Problem clicks\n\n${
      problems.length === 0
        ? NONE
        : table(["Code", "Clicks"], countBy(problems))
    }`,
  );
  parts.push(
    `### View switches\n\n${
      views.length === 0 ? NONE : table(["View", "Switches"], countBy(views))
    }`,
  );
  return section("Friction", parts.join("\n\n"));
}

function outcomesSection(files: readonly LogFile[]) {
  const events = files.flatMap((f) => f.events);
  const compiles = new Map<Surface, number>();
  const saving = new Map<string, { t: number; label: string }>();
  let written = 0, bytes = 0;
  const bump = (surface: Surface) =>
    compiles.set(surface, (compiles.get(surface) ?? 0) + 1);
  for (const e of events) {
    const d = record(e.data);
    if (e.kind === "pg.compile") {
      bump(e.surface);
      const path = str(d.path), label = str(d.saving);
      const t = Date.parse(e.t);
      if (path !== undefined && label !== undefined && label !== "") {
        const old = saving.get(path);
        if (old === undefined || t >= old.t) saving.set(path, { t, label });
      }
    } else if (e.kind === "cli.phase" && d.name === "build") bump(e.surface);
    else if (
      e.kind === "lsp.out" &&
      record(d.message).method === "textDocument/publishDiagnostics"
    ) bump(e.surface);
    else if (e.kind === "cli.output") {
      written++;
      if (typeof d.bytes === "number") bytes += d.bytes;
    }
  }
  const parts = [
    `Compiles: CLI builds, language server diagnostics publishes, and playground compiles.\n\n${
      compiles.size === 0 ? NONE : table(
        ["Surface", "Compiles"],
        [...compiles].sort((a, b) => a[0].localeCompare(b[0])),
      )
    }`,
    `Last saving label per path.\n\n${
      saving.size === 0 ? NONE : table(
        ["Path", "Label"],
        [...saving].sort((a, b) => a[0].localeCompare(b[0])).map((
          [path, s],
        ) => [path, s.label]),
      )
    }`,
    `Files written by the CLI.\n\n${
      written === 0 ? NONE : `Files: ${written}, ${bytes} bytes.`
    }`,
  ];
  return section("Outcomes", parts.join("\n\n"));
}

// ------------------------------------------------------------------ report

/** Builds the report. Sessions that started before the window are dropped. */
export function buildReport(
  logFiles: readonly LogFile[],
  options: ReportOptions,
): string {
  const from = options.now.getTime() - options.sinceMs;
  const inWindow = logFiles.filter((f) =>
    f.events.length === 0 || Date.parse(f.events[0].t) >= from
  );
  const sessions = inWindow.filter((f) => f.events.length > 0).toSorted((
    a,
    b,
  ) =>
    a.events[0].t.localeCompare(b.events[0].t) || a.file.localeCompare(b.file)
  );
  return [
    "# Log report\n",
    sessionsSection(sessions, options),
    brokenSection(inWindow),
    latencySection(sessions),
    frictionSection(sessions),
    outcomesSection(sessions),
  ].join("\n");
}

// ------------------------------------------------------------------ entry

/** Reads the `*.jsonl` files directly in one folder. */
function readFolder(folder: string): Result<LogFile[], string> {
  try {
    const files = [...Deno.readDirSync(folder)]
      .filter((e) => e.isFile && e.name.endsWith(".jsonl"))
      .map((e) => e.name)
      .sort();
    return {
      ok: true,
      value: files.map((name) => {
        const path = `${folder.replace(/\/$/, "")}/${name}`;
        return parseSession(Deno.readTextFileSync(path), path);
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Deno.errors.NotFound
        ? `Folder not found: ${folder}`
        : `Folder not readable: ${folder}`,
    };
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  if (!args.ok) {
    console.error(
      `logs:report: ${args.error}\nUsage: deno task logs:report [--since <N>(m|h|d)] [folder ...]`,
    );
    Deno.exit(2);
  }
  const files: LogFile[] = [];
  const notes: string[] = [];
  for (const folder of args.value.folders) {
    const read = readFolder(folder);
    if (read.ok) files.push(...read.value);
    else notes.push(read.error);
  }
  console.log(
    buildReport(files, { now: new Date(), sinceMs: args.value.sinceMs, notes }),
  );
}
