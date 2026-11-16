import { decodeUriComponent, emptyMap } from "../runtime.ts";
// The `tsc` oracle on the Effektive side. Two pure functions:
//
// - `parseDenoCheck` reads the text that `deno check` prints on failure and
//   returns its TypeScript diagnostics.
// - `mapTscDiagnostic` maps one TypeScript diagnostic of a generated file back
//   to the Effektive source, through the span table of that file.
//
// A diagnostic on a host assertion constant (`const UsersLive$host: ... =
// UsersLive;`) means that the host module disagrees with its declaration file.
// It maps to the code `host-boundary/001` on the imported name in the `.eff`
// import. A diagnostic inside a registered host module means the same thing,
// for example a layer of the declared service that lacks a method. It keeps
// its position in the host module.
import { type Diagnostic, makeDiagnostic } from "../diagnostics.ts";
import type { Span } from "../ir.ts";
import { caught } from "../source.ts";
import type { ProjectConfig } from "../project_config.ts";
import {
  hostAssertionAtOffset,
  mapOffset,
  offsetOfGenerated,
  type SpanTable,
} from "./spans.ts";
// ------------------------------------------------------------------ parsing
/** One TypeScript diagnostic from `deno check`. */
export type TscDiagnostic = {
  /** Root-relative with `/` separators when the file lies under the root, else the absolute path. */
  readonly file: string;
  /** One-based. */
  readonly line: number;
  /** One-based, in UTF-16 code units. */
  readonly column: number;
  /** The TypeScript code: 2375 for `TS2375`. */
  readonly code: number;
  /** The first line of the TypeScript message, without the advice to add `undefined`. */
  readonly message: string;
  /** The other lines of the message, the source line, and its underline. */
  readonly detail: string;
};
type DenoCheckOutput = {
  readonly diagnostics: readonly TscDiagnostic[];
  /**
   * Lines that belong to no diagnostic and that are not progress lines: an
   * `error:` line for a resolution failure, for example. Empty when the output
   * holds only diagnostics.
   */
  readonly other: readonly string[];
};
/**
 * TypeScript appends this advice when `exactOptionalPropertyTypes` rejects an
 * assignment. The generated code is not the user's to edit, so the advice is
 * removed from the relayed message.
 */
const UNDEFINED_ADVICE =
  " Consider adding 'undefined' to the types of the target's properties.";
function hasOnlyDigits(text: string): boolean {
  return text.length > 0 &&
    [...text].every((character) => character >= "0" && character <= "9");
}
function hasLineTerminator(text: string): boolean {
  return [...text].some((character) =>
    character === "\n" || character === "\r" || character === "\u2028" ||
    character === "\u2029"
  );
}
function firstHeaderMarker(
  raw: string,
): readonly [number, string] | undefined {
  const errorMarker = " [ERROR]: ";
  const warningMarker = " [WARN]: ";
  const markerAt = raw.indexOf(" ", 2);
  if (markerAt === -1) return undefined;
  if (raw.startsWith(errorMarker, markerAt)) return [markerAt, errorMarker];
  if (raw.startsWith(warningMarker, markerAt)) return [markerAt, warningMarker];
  return undefined;
}
function headerParts(raw: string): readonly [number, string] | undefined {
  if (!raw.startsWith("TS")) return undefined;
  const marker = firstHeaderMarker(raw);
  if (marker === undefined) return undefined;
  const markerAt = marker[0];
  const code = raw.slice(2, markerAt);
  if (!hasOnlyDigits(code)) return undefined;
  const message = raw.slice(markerAt + marker[1].length);
  return hasLineTerminator(message) ? undefined : [Number(code), message];
}
function locationParts(
  raw: string,
): readonly [string, number, number] | undefined {
  const trimmed = raw.trimStart();
  if (trimmed.length === raw.length || !trimmed.startsWith("at file://")) {
    return undefined;
  }
  const columnSeparator = trimmed.lastIndexOf(":");
  const lineSeparator = trimmed.lastIndexOf(":", columnSeparator - 1);
  if (lineSeparator < 0 || columnSeparator < 0) return undefined;
  const url = trimmed.slice("at ".length, lineSeparator);
  const line = trimmed.slice(lineSeparator + 1, columnSeparator);
  const column = trimmed.slice(columnSeparator + 1);
  if (
    [...url].some((character) => character.trim() === "") ||
    !hasOnlyDigits(line) || !hasOnlyDigits(column)
  ) {
    return undefined;
  }
  return [url, Number(line), Number(column)];
}
function isProgress(raw: string): boolean {
  return raw.startsWith("Check ") || raw.startsWith("Download ") ||
    raw.startsWith("Resolving ") || raw.startsWith("Initialize ");
}
function isSummary(raw: string): boolean {
  if (raw === "error: Type checking failed.") return true;
  if (!raw.startsWith("Found ")) return false;
  let suffix: string | undefined;
  if (raw.endsWith(" errors.")) {
    suffix = " errors.";
  } else if (raw.endsWith(" error.")) {
    suffix = " error.";
  }
  return suffix !== undefined &&
    hasOnlyDigits(raw.slice("Found ".length, -suffix.length));
}
function pathOfFileUrl(url: string): string {
  const path = url.slice("file://".length);
  const decoded = caught(() => decodeUriComponent(path));
  return decoded.ok ? decoded.value : path;
}
export type DenoCheckText = string;
export type ProjectRoot = string;
/**
 * Parses the output of `deno check` (stderr, without color codes). `root` is
 * the absolute project directory, as `deno check` prints it. A file under the
 * root gets a root-relative path. Text after the first location of a
 * diagnostic, such as a note about a related declaration, is dropped.
 */
export function parseDenoCheck(
  text: DenoCheckText,
  root: ProjectRoot,
): DenoCheckOutput {
  const prefix = root.endsWith("/") ? root : root + "/";
  const diagnostics: TscDiagnostic[] = [];
  const other: string[] = [];
  type Open = {
    readonly code: number;
    readonly message: string;
    readonly detail: readonly string[];
    readonly location: {
      readonly file: string;
      readonly line: number;
      readonly column: number;
    } | undefined;
  };
  let open: Open | undefined;
  function close(current: Open | undefined): Open | undefined {
    if (current === undefined) {
      return undefined;
    }
    if (current.location === undefined) {
      other[other.length] = `TS${current.code}: ${current.message}`;
    } else {
      diagnostics[diagnostics.length] = {
        file: current.location.file.startsWith(prefix)
          ? current.location.file.slice(prefix.length)
          : current.location.file,
        line: current.location.line,
        column: current.location.column,
        code: current.code,
        message: current.message,
        detail: current.detail.join("\n"),
      };
    }
    return undefined;
  }
  for (const raw of text.replaceAll("\r\n", "\n").split("\n")) {
    const header = headerParts(raw);
    if (header !== undefined) {
      open = close(open);
      open = {
        code: header[0],
        message: header[1].endsWith(UNDEFINED_ADVICE)
          ? header[1].slice(0, -UNDEFINED_ADVICE.length)
          : header[1],
        detail: [],
        location: undefined,
      };
      continue;
    }
    if (open !== undefined) {
      if (isSummary(raw) || raw.startsWith("error: ")) {
        open = close(open);
      } else {
        if (open.location !== undefined) {
          continue;
        }
        const location = locationParts(raw);
        if (location !== undefined) {
          open = {
            ...open,
            location: {
              file: pathOfFileUrl(location[0]),
              line: location[1],
              column: location[2],
            },
          };
        } else {
          open = { ...open, detail: [...open.detail, raw] };
        }
        continue;
      }
    }
    if (raw.trim() === "" || isProgress(raw) || isSummary(raw)) {
      continue;
    }
    other[other.length] = raw;
  }
  open = close(open);
  return { diagnostics: diagnostics, other: other };
}
// ------------------------------------------------------------------ mapping
/** A TypeScript diagnostic mapped to the Effektive side. */
export type TscMapping =
  /** The diagnostic lies on a host assertion constant. */
  | {
    readonly tag: "host-boundary";
    readonly diagnostic: Diagnostic;
    readonly tsCode: number;
  }
  /**
   * The diagnostic lies inside a printed node. Correct generated code has no
   * such error, so it points at a defect of the emitter. The span is the
   * innermost source span. Print the code as `TS<tsCode>`.
   */
  | {
    readonly tag: "source";
    readonly span: Span;
    readonly tsCode: number;
    readonly message: string;
  }
  /**
   * The diagnostic lies in a registered host module, so the host module does
   * not fit the types that the generated code declares. The position is in the
   * host module. Print it with the code `host-boundary/001`.
   */
  | {
    readonly tag: "host-module";
    /** The registry key: `providers` for `host:providers`. */
    readonly key: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly tsCode: number;
    readonly message: string;
  }
  /**
   * The diagnostic has no source span: its file has no span table and is not a
   * host module, or its position lies outside every record. The position is in
   * the generated file.
   */
  | {
    readonly tag: "generated";
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly tsCode: number;
    readonly message: string;
  };
/** The root-relative path of each host module to its registry key. */
export function hostModulePaths(
  config: ProjectConfig,
): ReadonlyMap<string, string> {
  let paths = emptyMap<string, string>();
  for (const entry of config.host) {
    const key = entry[0];
    const host = entry[1];
    paths = paths.set(host.modulePath, key);
  }
  return paths;
}
/**
 * Maps one TypeScript diagnostic. `tables` maps the root-relative path of a
 * generated file, such as `users.ts`, to its span table. `hosts` maps the
 * root-relative path of a host module to its registry key; see
 * `hostModulePaths`.
 */
export function mapTscDiagnostic(
  diagnostic: TscDiagnostic,
  tables: ReadonlyMap<string, SpanTable>,
  requestedHosts: ReadonlyMap<string, string> | undefined,
): TscMapping {
  const hosts = requestedHosts ?? emptyMap<string, string>();
  const key = hosts.get(diagnostic.file);
  if (key !== undefined) {
    return {
      tag: "host-module",
      key: key,
      file: diagnostic.file,
      line: diagnostic.line,
      column: diagnostic.column,
      tsCode: diagnostic.code,
      message: diagnostic.message,
    };
  }
  const unmapped: TscMapping = {
    tag: "generated",
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
    tsCode: diagnostic.code,
    message: diagnostic.message,
  };
  const table = tables.get(diagnostic.file);
  if (table === undefined) {
    return unmapped;
  }
  const offset = offsetOfGenerated(table, diagnostic.line, diagnostic.column);
  if (offset === undefined) {
    return unmapped;
  }
  const assertion = hostAssertionAtOffset(table, offset);
  if (assertion !== undefined && assertion.importSpan !== undefined) {
    return {
      tag: "host-boundary",
      tsCode: diagnostic.code,
      diagnostic: makeDiagnostic(
        "host-boundary/001",
        `The host module "${assertion.key}" does not match its declaration file for ${assertion.local}: TS${diagnostic.code} ${diagnostic.message}`,
        assertion.importSpan,
      ),
    };
  }
  const span = mapOffset(table, offset);
  if (span === undefined) {
    return unmapped;
  }
  return {
    tag: "source",
    span: span,
    tsCode: diagnostic.code,
    message: diagnostic.message,
  };
}
