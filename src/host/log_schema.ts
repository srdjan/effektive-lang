// The schema of the session log: the envelope of a line, the data type of
// every record kind, the session file name, and the parsing of an envelope.
// It holds data and pure parsing only, with no Deno API, so the playground
// bundle can import it. The writers build records with `emit`, and the readers
// (`scripts/logs_*.ts`, the log endpoint, the playground replay) share the
// same kind names and file name format.
import {
  hasProperty,
  isRecord,
  parseTimestamp,
  type ReadError,
} from "../core/frontend.ts";
import type { EventLog, FileFailure } from "./ports.ts";
export type Surface = "cli" | "lsp" | "playground";
const SURFACES: readonly Surface[] = ["cli", "lsp", "playground"];
/** One line of a session file. */
export type Envelope = {
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
};
// ------------------------------------------------------------------ cli
/** One diagnostic as the session log records it. Positions are one-based. */
export type LoggedDiagnostic = {
  readonly source: "effektive" | "tsc";
  readonly code?: string;
  readonly path?: string;
  readonly start?: {
    readonly line: number;
    readonly column: number;
  };
  readonly end?: {
    readonly line: number;
    readonly column: number;
  };
  readonly message: string;
};
type CliStartData = {
  readonly args: readonly string[];
  readonly command: "check" | "build" | "watch";
  readonly root: string;
};
/** A source file that the session read or lost. A `target` file is a host module. */
type CliInputData = {
  readonly path: string;
  readonly hash: string;
  readonly target?: true;
} | {
  readonly path: string;
  readonly removed: true;
  readonly target?: true;
};
type CliPhaseData = {
  readonly name: "sync" | "build";
  readonly ms: number;
};
type CliDiagnosticsData = {
  readonly items: readonly LoggedDiagnostic[];
};
type CliOutputData = {
  readonly path: string;
  readonly bytes: number;
  readonly hash: string;
};
type CliTscData = {
  readonly code: number;
  readonly ms: number;
};
type CliChangeData = {
  readonly paths: readonly string[];
};
type MessageData = {
  readonly message: string;
};
type CliEndData = {
  readonly code: number;
  readonly ms: number;
};
// ------------------------------------------------------------------ lsp
type LspInData = {
  readonly error: {
    readonly tag: "bad-header" | "bad-json";
    readonly message: string;
  };
} | {
  readonly message: unknown;
};
type LspOutData = {
  readonly message: unknown;
};
type LspFsData = {
  readonly op: "readText";
  readonly path: string;
  readonly hash: string;
} | {
  readonly op: "readText";
  readonly path: string;
  readonly error: ReadError;
} | {
  readonly op: "writeText";
  readonly path: string;
  readonly hash: string;
  readonly ok: boolean;
} | {
  readonly op: "remove";
  readonly path: string;
  readonly ok: boolean;
} | {
  readonly op: "entryKind";
  readonly path: string;
  readonly kind: "symlink" | "other" | "missing";
} | {
  readonly op: "entryKind";
  readonly path: string;
  readonly error: FileFailure;
} | {
  readonly op: "kind";
  readonly path: string;
  readonly kind: "file" | "directory" | "missing";
} | {
  readonly op: "list";
  readonly path: string;
  readonly entries: readonly {
    readonly name: string;
    readonly isDirectory: boolean;
  }[];
} | {
  readonly op: "list";
  readonly path: string;
  readonly error: FileFailure;
} | {
  readonly op: "absolute";
  readonly path: string;
  readonly result: string;
};
type LspTimingData = {
  readonly method: string;
  readonly id: string | number;
  readonly ms: number;
};
type LspErrorData = {
  readonly text: string;
};
type LspExitData = {
  readonly code: number;
};
// ------------------------------------------------------------------ playground
/** The page layout that a viewport width selects. */
export type Layout = "narrow" | "wide" | "explorer";
/** One change of a document edit. Offsets index the document before the edit. */
export type EditChange = {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
};
export type PgStartData = {
  readonly build: string;
  readonly viewport: {
    readonly w: number;
    readonly h: number;
  };
  readonly layout: Layout;
  readonly examples: string;
  readonly loadMs: number;
};
export type PgSelectData = {
  readonly path: string;
  readonly by: "click" | "key" | "hash" | "start";
};
export type PgEditData = {
  readonly path: string;
  readonly changes: readonly EditChange[];
  readonly length: number;
};
export type PgCompileData = {
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
};
export type PgHoverData = {
  readonly offset: number;
  readonly hit: boolean;
  readonly by: "pointer" | "cursor";
};
export type PgProblemData = {
  readonly code: string;
  readonly path: string;
};
export type PgViewData = {
  readonly name: string;
};
export type PgLayoutData = {
  readonly mode: Layout;
};
export type PgErrorData = {
  readonly tag: string;
  readonly message: string;
};
/** The data of a kind that carries none. */
export type EmptyData = Readonly<Record<string, never>>;
// ------------------------------------------------------------------ kinds
/** The data type of every record kind that a writer produces. */
export type LogData = {
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
};
export type LogKind = keyof LogData;
export type LspKind = Extract<LogKind, `lsp.${string}`>;
/** The part of the `EventLog` port that `emit` needs. */
type Appender = Pick<EventLog, "append">;
/** Appends one record. The compiler checks the kind against the data. */
export function emit<K extends LogKind>(
  log: Appender,
  kind: K,
  data: LogData[K],
): undefined {
  return log.append(kind, data) ?? undefined;
}
/** True when the event has that kind. The compiler checks the kind name. */
export function isKind(event: {
  readonly kind?: unknown;
}, kind: LogKind): LogMatch {
  return event.kind === kind;
}
export function isAnyKind(event: {
  readonly kind: string;
}, kinds: ReadonlySet<LogKind>): LogMatch {
  const names: ReadonlySet<string> = kinds;
  return names.has(event.kind);
}
// ------------------------------------------------------------------ session file
/** The form of a session ID. */
type LogMatch = boolean;
type LogValue = unknown;
type LogText = string;
function isSessionId(text: string): boolean {
  const format = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  if (text.length !== format.length) {
    return false;
  }
  let index = 0;
  for (const slot of format) {
    const char = text[index];
    if (slot === "-") {
      if (char !== "-") {
        return false;
      }
    } else if (!(char >= "0" && char <= "9") && !(char >= "a" && char <= "f")) {
      return false;
    }
    index = index + 1;
  }
  return true;
}
/** The file name of a session: `<surface>-<YYYYMMDD>-<session>.jsonl`. */
export function sessionFileName(
  surface: Surface,
  start: Date,
  session: LogText,
): LogText {
  const day = start.toISOString().slice(0, 10).replaceAll("-", "");
  return `${surface}-${day}-${session}.jsonl`;
}
type SessionFileName = {
  readonly surface: Surface;
  /** The start day, `YYYYMMDD`. */
  readonly day: string;
  readonly session: string;
};
/** The parts of a session file name, or undefined for any other name. */
export function parseSessionFileName(
  name: LogText,
): SessionFileName | undefined {
  const surface = SURFACES.find((surface) => name.startsWith(`${surface}-`));
  if (surface === undefined || !name.endsWith(".jsonl")) {
    return undefined;
  }
  const rest = name.slice(surface.length + 1, -".jsonl".length);
  const day = rest.slice(0, "YYYYMMDD".length);
  if (
    day.length !== "YYYYMMDD".length ||
    ![...day].every((char) => char >= "0" && char <= "9")
  ) {
    return undefined;
  }
  if (rest[day.length] !== "-") {
    return undefined;
  }
  const session = rest.slice(day.length + 1);
  return isSessionId(session)
    ? { surface: surface, day: day, session: session }
    : undefined;
}
// ------------------------------------------------------------------ envelope
/**
 * Which rules read an envelope. `browser` is the rule of `POST /log`: a
 * playground event with a session ID and a `pg.` kind. `replay` is the
 * tolerance for logs on disk: any surface, any kind name, and the shapes of
 * older builds.
 */
type EnvelopePolicy = "browser" | "replay";
function isTime(t: unknown): t is string {
  return typeof t === "string" && !Number.isNaN(parseTimestamp(t));
}
function browserEnvelope(
  value: Readonly<Record<string, unknown>>,
): Envelope | undefined {
  const binding1 = value;
  const v = binding1.v;
  const t = binding1.t;
  const ms = binding1.ms;
  const surface = binding1.surface;
  const session = binding1.session;
  const seq = binding1.seq;
  const build = binding1.build;
  const kind = binding1.kind;
  const data = binding1.data;
  if (
    v === 1 && isTime(t) && typeof ms === "number" &&
    Number.isFinite(ms) && surface === "playground" &&
    typeof session === "string" && isSessionId(session) &&
    typeof seq === "number" && Number.isInteger(seq) && seq >= 0 &&
    typeof build === "string" && typeof kind === "string" &&
    kind.startsWith("pg.") && hasProperty(value, "data")
  ) {
    return {
      v: 1,
      t: t,
      ms: ms,
      surface: "playground",
      session: session,
      seq: seq,
      build: build,
      kind: kind,
      data: data,
    };
  }
  return undefined;
}
function isReplayEnvelope(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & Envelope {
  const binding2 = value;
  const v = binding2.v;
  const t = binding2.t;
  const ms = binding2.ms;
  const surface = binding2.surface;
  const session = binding2.session;
  const seq = binding2.seq;
  const build = binding2.build;
  const kind = binding2.kind;
  return v === 1 && isTime(t) &&
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
  value: LogValue,
  policy: EnvelopePolicy,
): Envelope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (policy === "browser") {
    return browserEnvelope(value);
  }
  return isReplayEnvelope(value) ? value : undefined;
}
