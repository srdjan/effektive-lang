// Source access, line tables, and span helpers. Positions are UTF-16 code units
// with an exclusive end, as JavaScript strings index them.

import type { Span } from "./ir.ts";

export type { Span };

/** Expected compiler failures are data. */
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

export interface SourceEdit {
  readonly span: Span;
  readonly text: string;
}

export type ReadError =
  | { readonly tag: "not-found"; readonly path: string }
  | {
    readonly tag: "unreadable";
    readonly path: string;
    readonly message: string;
  };

/** The only way the core reads files. The CLI and the tests supply the implementation. */
export interface SourceHost {
  readText(path: string): Result<string, ReadError>;
}

export function memoryHost(
  files: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): SourceHost {
  const map: ReadonlyMap<string, string> = files instanceof Map
    ? files
    : new Map(Object.entries(files));
  return {
    readText(path: string): Result<string, ReadError> {
      const text = map.get(path);
      return text === undefined
        ? { ok: false, error: { tag: "not-found", path } }
        : { ok: true, value: text };
    },
  };
}

/** A line terminator is `\n`, `\r\n`, or a lone `\r`. The lexer uses the same rule. */
export function lineStarts(text: string): Uint32Array {
  const starts: number[] = [0];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      starts.push(i + 1);
    } else if (c === 0x0d) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 0x0a) i++;
      starts.push(i + 1);
    }
  }
  return Uint32Array.from(starts);
}

interface Position {
  /** One-based. */
  readonly line: number;
  /** One-based, in UTF-16 code units. */
  readonly column: number;
}

/** Index (zero-based) of the line that contains `offset`. */
export function lineIndexOf(starts: Uint32Array, offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Offset to one-based line and column. An offset past the end clamps to the end. */
export function positionOf(
  starts: Uint32Array,
  text: string,
  offset: number,
): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const index = lineIndexOf(starts, clamped);
  return { line: index + 1, column: clamped - starts[index] + 1 };
}

/** Orders by source, then start, then end. */
export function compareSpans(a: Span, b: Span): number {
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.start !== b.start) return a.start - b.start;
  return a.end - b.end;
}
