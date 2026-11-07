// Source maps. A version 3 source map for one
// generated module, derived from its span table. The file also holds a base64
// VLQ encoder. The core has no dependencies, so it has its own. The tests hold
// the decoder (`tests/support/source_map_decoder.ts`).
//
// What the map says. A position of the generated text maps to the start of the
// source span of its innermost record, which is exactly what `mapOffset` of
// the span table returns. A position outside every record has no mapping. The
// map holds one segment at every record start, at every record end, and at
// the start of every generated line, because a segment does not continue past
// a line break. Consecutive segments with equal targets are merged.
//
// Source lines and columns are zero-based UTF-16 positions, as the source map
// format and JavaScript tooling expect.

import type { Result } from "../result.ts";
import { fileNameOf, relativeSpecifier } from "../paths.ts";
import { lineIndexOf, lineStarts } from "../source.ts";
import { recordAtOffset, type SpanTable, zeroBasedPosition } from "./spans.ts";

// ------------------------------------------------------------------ base64 VLQ

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CONTINUATION = 32;

/** Encodes one integer as base64 VLQ: the sign in the lowest bit, five bits for each digit. */
export function encodeVlq(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`cannot encode ${value} as VLQ`);
  }
  const integer = BigInt(value);
  let rest = value < 0 ? -integer * 2n + 1n : integer * 2n;
  let out = "";
  do {
    let digit = Number(rest % 32n);
    rest /= 32n;
    if (rest > 0n) digit |= CONTINUATION;
    out += BASE64[digit];
  } while (rest > 0n);
  return out;
}

// ------------------------------------------------------------------ the map

export interface SourceMapV3 {
  readonly version: 3;
  /** The generated file, without its directory: `users.ts`. */
  readonly file: string;
  /** The `.eff` files, relative to the directory of the map. */
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export type SourceMapError = {
  readonly tag: "missing-source";
  readonly source: string;
};

interface SourceMapOptions {
  /** Add the source texts as `sourcesContent`. Default: false. */
  readonly includeContent?: boolean;
}

/** The path of `source` relative to the directory of the generated file `path`. */
function relativeSource(path: string, source: string): string {
  const specifier = relativeSpecifier(path, source);
  return specifier.startsWith("./") ? specifier.slice(2) : specifier;
}

/**
 * Builds the source map of one module. `sourceTexts` maps each root-relative
 * source path to its text, for the line tables. A source that a record names
 * and that is missing from `sourceTexts` is an error value.
 */
export function buildSourceMap(
  table: SpanTable,
  sourceTexts: ReadonlyMap<string, string>,
  options: SourceMapOptions = {},
): Result<SourceMapV3, SourceMapError> {
  const sourceIndex = new Map<string, number>();
  for (const record of table.records) {
    const source = record.span.source;
    if (sourceIndex.has(source)) continue;
    if (!sourceTexts.has(source)) {
      return { ok: false, error: { tag: "missing-source", source } };
    }
    sourceIndex.set(source, sourceIndex.size);
  }
  const sources = [...sourceIndex.keys()];
  const sourceLineStarts = new Map<string, Uint32Array>();
  for (const source of sources) {
    sourceLineStarts.set(source, lineStarts(sourceTexts.get(source) ?? ""));
  }

  const points = new Set<number>();
  for (const record of table.records) {
    points.add(record.start);
    if (record.end < table.textLength) points.add(record.end);
  }
  for (const start of table.lineStarts) {
    if (start < table.textLength) points.add(start);
  }

  const lines: string[][] = table.lineStarts.length === 0
    ? [[]]
    : Array.from({ length: table.lineStarts.length }, () => []);
  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  let currentLine = -1;
  let previousGenerated = 0;
  let lastTarget: string | undefined;
  for (const point of [...points].sort((a, b) => a - b)) {
    const generatedLine = lineIndexOf(table.lineStarts, point);
    const generatedColumn = point - table.lineStarts[generatedLine];
    if (generatedLine !== currentLine) {
      currentLine = generatedLine;
      previousGenerated = 0;
      lastTarget = undefined;
    }
    const record = recordAtOffset(table, point);
    if (record === undefined) {
      if (lastTarget === undefined) continue;
      lines[generatedLine].push(encodeVlq(generatedColumn - previousGenerated));
      previousGenerated = generatedColumn;
      lastTarget = undefined;
      continue;
    }
    const source = record.span.source;
    const text = sourceTexts.get(source) ?? "";
    const target = zeroBasedPosition(
      sourceLineStarts.get(source) ?? new Uint32Array([0]),
      text.length,
      record.span.start,
    );
    const index = sourceIndex.get(source) ?? 0;
    const key = `${index}:${target.line}:${target.column}`;
    if (key === lastTarget) continue;
    lines[generatedLine].push(
      encodeVlq(generatedColumn - previousGenerated) +
        encodeVlq(index - previousSource) +
        encodeVlq(target.line - previousLine) +
        encodeVlq(target.column - previousColumn),
    );
    previousGenerated = generatedColumn;
    previousSource = index;
    previousLine = target.line;
    previousColumn = target.column;
    lastTarget = key;
  }

  const base = {
    version: 3 as const,
    file: fileNameOf(table.path),
    sources: sources.map((s) => relativeSource(table.path, s)),
    names: [] as string[],
    mappings: lines.map((segments) => segments.join(",")).join(";"),
  };
  if (options.includeContent !== true) return { ok: true, value: base };
  return {
    ok: true,
    value: {
      ...base,
      sourcesContent: sources.map((s) => sourceTexts.get(s) ?? ""),
    },
  };
}

/** The text of the `.ts.map` file: JSON with two-space indentation and a final newline. */
export function serializeSourceMap(map: SourceMapV3): string {
  const ordered: Record<string, unknown> = {
    version: map.version,
    file: map.file,
    sources: map.sources,
  };
  if (map.sourcesContent !== undefined) {
    ordered.sourcesContent = map.sourcesContent;
  }
  ordered.names = map.names;
  ordered.mappings = map.mappings;
  return JSON.stringify(ordered, null, 2) + "\n";
}
