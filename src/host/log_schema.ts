// The schema of the session log: the envelope of a line, the data type of
// every record kind, the session file name, and the parsing of an envelope.
// It holds data and pure parsing only, with no Deno API, so the playground
// bundle can import it. The writers build records with `emit`, and the readers
// (`scripts/logs_*.ts`, the log endpoint, the playground replay) share the
// same kind names and file name format.

import { isRecord, type ReadError } from "../core/frontend.ts";
import type { FileFailure } from "./ports.ts";

export type Surface = "cli" | "lsp" | "playground";

export const SURFACES: readonly Surface[] = ["cli", "lsp", "playground"];

/** One line of a session file. */
export interface Envelope {
  readonly v: 1;
  /** Wall time, ISO 8601. */
  readonly t: string;
  /** Monotonic milliseconds since the session start. */
  readonly ms: number;
  readonly surface: Surface;
  readonly session: string;
  /** Starts at 0 and grows by 1 for each event. */
  readonly seq: number;
  readonly build: string;
  /** A `LogKind` for a current writer. An old or unknown log can hold another name. */
  readonly kind: string;
  readonly data: unknown;
}

// ------------------------------------------------------------------ cli

/** One diagnostic as the session log records it. Positions are one-based. */
export interface LoggedDiagnostic {
  readonly source: "effektive" | "validate" | "tsc";
  readonly code?: string;
  readonly path?: string;
  readonly start?: { readonly line: number; readonly column: number };
  readonly end?: { readonly line: number; readonly column: number };
  readonly message: string;
}

export interface CliStartData {
  readonly args: readonly string[];
  readonly command: "check" | "build" | "watch";
  readonly root: string;
}

/** A source file that the session read or lost. A `target` file is a host module. */
export type CliInputData =
  | { readonly path: string; readonly hash: string; readonly target?: true }
  | { readonly path: string; readonly removed: true; readonly target?: true };

export interface CliPhaseData {
  readonly name: "sync" | "build";
  readonly ms: number;
}

export interface CliDiagnosticsData {
  readonly items: readonly LoggedDiagnostic[];
}

export interface CliOutputData {
  readonly path: string;
  readonly bytes: number;
  readonly hash: string;
}

export interface CliTscData {
  readonly code: number;
  readonly ms: number;
}

export interface CliChangeData {
  readonly paths: readonly string[];
}

export interface MessageData {
  readonly message: string;
}

export interface CliEndData {
  readonly code: number;
  readonly ms: number;
}

// ------------------------------------------------------------------ lsp

export type LspInData =
  | {
    readonly error: {
      readonly tag: "bad-header" | "bad-json";
      readonly message: string;
    };
  }
  | { readonly message: unknown };

export interface LspOutData {
  readonly message: unknown;
}

export type LspFsData =
  | { readonly op: "readText"; readonly path: string; readonly hash: string }
  | {
    readonly op: "readText";
    readonly path: string;
    readonly error: ReadError;
  }
  | {
    readonly op: "writeText";
    readonly path: string;
    readonly hash: string;
    readonly ok: boolean;
  }
  | { readonly op: "remove"; readonly path: string; readonly ok: boolean }
  | {
    readonly op: "entryKind";
    readonly path: string;
    readonly kind: "symlink" | "other" | "missing";
  }
  | {
    readonly op: "entryKind";
    readonly path: string;
    readonly error: FileFailure;
  }
  | {
    readonly op: "kind";
    readonly path: string;
    readonly kind: "file" | "directory" | "missing";
  }
  | {
    readonly op: "list";
    readonly path: string;
    readonly entries: readonly {
      readonly name: string;
      readonly isDirectory: boolean;
    }[];
  }
  | { readonly op: "list"; readonly path: string; readonly error: FileFailure }
  | { readonly op: "absolute"; readonly path: string; readonly result: string };

export interface LspTimingData {
  readonly method: string;
  readonly id: string | number;
  readonly ms: number;
}

export interface LspErrorData {
  readonly text: string;
}

export interface LspExitData {
  readonly code: number;
}

// ------------------------------------------------------------------ playground

/** The page layout that a viewport width selects. */
export type Layout = "narrow" | "wide" | "explorer";

/** One change of a document edit. Offsets index the document before the edit. */
export interface EditChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface PgStartData {
  readonly build: string;
  readonly viewport: { readonly w: number; readonly h: number };
  readonly layout: Layout;
  readonly examples: string;
  readonly loadMs: number;
}

export interface PgSelectData {
  readonly path: string;
  readonly by: "click" | "key" | "hash" | "start";
}

export interface PgEditData {
  readonly path: string;
  readonly changes: readonly EditChange[];
  readonly length: number;
}

export interface PgCompileData {
  readonly path: string;
  readonly ms: number;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly stale: boolean;
  readonly saving: string;
}

export interface PgHoverData {
  readonly offset: number;
  readonly hit: boolean;
  readonly by: "pointer" | "cursor";
}

export interface PgProblemData {
  readonly code: string;
  readonly path: string;
}

export interface PgViewData {
  readonly name: string;
}

export interface PgLayoutData {
  readonly mode: Layout;
}

export interface PgErrorData {
  readonly tag: string;
  readonly message: string;
}

/** The data of a kind that carries none. */
export type EmptyData = Readonly<Record<string, never>>;

// ------------------------------------------------------------------ kinds

/** The data type of every record kind that a writer produces. */
export interface LogData {
  readonly "cli.start": CliStartData;
  readonly "cli.input": CliInputData;
  readonly "cli.phase": CliPhaseData;
  readonly "cli.diagnostics": CliDiagnosticsData;
  readonly "cli.output": CliOutputData;
  readonly "cli.tsc": CliTscData;
  readonly "cli.change": CliChangeData;
  readonly "cli.error": MessageData;
  readonly "cli.end": CliEndData;
  readonly "lsp.in": LspInData;
  readonly "lsp.out": LspOutData;
  readonly "lsp.batch": EmptyData;
  readonly "lsp.flush": EmptyData;
  readonly "lsp.fs": LspFsData;
  readonly "lsp.timing": LspTimingData;
  readonly "lsp.error": LspErrorData;
  readonly "lsp.exit": LspExitData;
  readonly "pg.start": PgStartData;
  readonly "pg.select": PgSelectData;
  readonly "pg.edit": PgEditData;
  readonly "pg.compile": PgCompileData;
  readonly "pg.hover": PgHoverData;
  readonly "pg.problem": PgProblemData;
  readonly "pg.view": PgViewData;
  readonly "pg.layout": PgLayoutData;
  readonly "pg.error": PgErrorData;
  readonly "pg.end": EmptyData;
}

export type LogKind = keyof LogData;

export type CliKind = Extract<LogKind, `cli.${string}`>;
export type LspKind = Extract<LogKind, `lsp.${string}`>;
export type PgKind = Extract<LogKind, `pg.${string}`>;

/** The part of the `EventLog` port that `emit` needs. */
export interface Appender {
  append(kind: string, data: unknown): void;
}

/** Appends one record. The compiler checks the kind against the data. */
export function emit<K extends LogKind>(
  log: Appender,
  kind: K,
  data: LogData[K],
): void {
  log.append(kind, data);
}

/** True when the event has that kind. The compiler checks the kind name. */
export function isKind(
  event: { readonly kind?: unknown },
  kind: LogKind,
): boolean {
  return event.kind === kind;
}

export function isAnyKind(
  event: { readonly kind: string },
  kinds: ReadonlySet<LogKind>,
): boolean {
  return (kinds as ReadonlySet<string>).has(event.kind);
}

// ------------------------------------------------------------------ session file

/** The form of a session ID. */
export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SESSION_FILE = new RegExp(
  `^(${SURFACES.join("|")})-(\\d{8})-([0-9a-f-]{36})\\.jsonl$`,
);

/** The file name of a session: `<surface>-<YYYYMMDD>-<session>.jsonl`. */
export function sessionFileName(
  surface: Surface,
  start: Date,
  session: string,
): string {
  const day = start.toISOString().slice(0, 10).replaceAll("-", "");
  return `${surface}-${day}-${session}.jsonl`;
}

export interface SessionFileName {
  readonly surface: Surface;
  /** The start day, `YYYYMMDD`. */
  readonly day: string;
  readonly session: string;
}

/** The parts of a session file name, or undefined for any other name. */
export function parseSessionFileName(
  name: string,
): SessionFileName | undefined {
  const match = SESSION_FILE.exec(name);
  if (match === null || !SESSION_ID.test(match[3])) return undefined;
  const surface = SURFACES.find((s) => s === match[1]);
  return surface === undefined
    ? undefined
    : { surface, day: match[2], session: match[3] };
}

// ------------------------------------------------------------------ envelope

/**
 * Which rules read an envelope. `browser` is the rule of `POST /log`: a
 * playground event with a session ID and a `pg.` kind. `replay` is the
 * tolerance for logs on disk: any surface, any kind name, and the shapes of
 * older builds.
 */
export type EnvelopePolicy = "browser" | "replay";

function browserEnvelope(
  value: Readonly<Record<string, unknown>>,
): Envelope | undefined {
  const { v, t, ms, surface, session, seq, build, kind, data } = value;
  if (
    v === 1 && typeof t === "string" && typeof ms === "number" &&
    Number.isFinite(ms) && surface === "playground" &&
    typeof session === "string" && SESSION_ID.test(session) &&
    typeof seq === "number" && Number.isInteger(seq) && seq >= 0 &&
    typeof build === "string" && typeof kind === "string" &&
    kind.startsWith("pg.") && "data" in value
  ) {
    return {
      v: 1,
      t,
      ms,
      surface: "playground",
      session,
      seq,
      build,
      kind,
      data,
    };
  }
  return undefined;
}

function isReplayEnvelope(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & Envelope {
  const { v, t, ms, surface, session, seq, build, kind } = value;
  return v === 1 && typeof t === "string" && !Number.isNaN(Date.parse(t)) &&
    typeof ms === "number" && typeof surface === "string" &&
    SURFACES.some((s) => s === surface) && typeof session === "string" &&
    typeof seq === "number" && typeof build === "string" &&
    typeof kind === "string";
}

/**
 * The envelope of a parsed JSON value, or undefined. The `browser` policy
 * returns a new object with only the envelope fields. The `replay` policy
 * returns the value itself.
 */
export function parseEnvelope(
  value: unknown,
  policy: EnvelopePolicy,
): Envelope | undefined {
  if (!isRecord(value)) return undefined;
  if (policy === "browser") return browserEnvelope(value);
  return isReplayEnvelope(value) ? value : undefined;
}
