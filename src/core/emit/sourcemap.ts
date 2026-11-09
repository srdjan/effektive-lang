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

import { fileNameOf, relativeSpecifier } from "../paths.ts";
import { lineIndexOf, lineStarts, type Result } from "../source.ts";
import {
  recordIndexAtOffset,
  type SpanTable,
  zeroBasedPosition,
} from "./spans.ts";

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
  readonly names: readonly string[];
  readonly mappings: string;
}

export type SourceMapError = {
  readonly tag: "missing-source";
  readonly source: string;
};

/** A source of the map: its place in `sources`, its text, and its line starts. */
interface SourceInfo {
  readonly index: number;
  readonly text: string;
  readonly starts: Uint32Array;
}

/**
 * Builds the source map of one module. `sourceTexts` maps each root-relative
 * source path to its text, for the line tables. A source that a record names
 * and that is missing from `sourceTexts` is an error value.
 */
export function buildSourceMap(
  table: SpanTable,
  sourceTexts: ReadonlyMap<string, string>,
): Result<SourceMapV3, SourceMapError> {
  const infoOf = new Map<string, SourceInfo>();
  // The source of each record, in the order of `table.records`.
  const recordInfo: SourceInfo[] = [];
  for (const record of table.records) {
    const source = record.span.source;
    let info = infoOf.get(source);
    if (info === undefined) {
      const text = sourceTexts.get(source);
      if (text === undefined) {
        return { ok: false, error: { tag: "missing-source", source } };
      }
      info = { index: infoOf.size, text, starts: lineStarts(text) };
      infoOf.set(source, info);
    }
    recordInfo.push(info);
  }
  const sources = [...infoOf.keys()];

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
    const recordIndex = recordIndexAtOffset(table, point);
    if (recordIndex < 0) {
      if (lastTarget === undefined) continue;
      lines[generatedLine].push(encodeVlq(generatedColumn - previousGenerated));
      previousGenerated = generatedColumn;
      lastTarget = undefined;
      continue;
    }
    const { index, text, starts } = recordInfo[recordIndex];
    const target = zeroBasedPosition(
      starts,
      text.length,
      table.records[recordIndex].span.start,
    );
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

  return {
    ok: true,
    value: {
      version: 3,
      file: fileNameOf(table.path),
      // Each source path is relative to the directory of the generated file.
      sources: sources.map((s) => {
        const specifier = relativeSpecifier(table.path, s);
        return specifier.startsWith("./") ? specifier.slice(2) : specifier;
      }),
      names: [],
      mappings: lines.map((segments) => segments.join(",")).join(";"),
    },
  };
}

/** The text of the `.ts.map` file: JSON with two-space indentation and a final newline. */
export function serializeSourceMap(map: SourceMapV3): string {
  const ordered = {
    version: map.version,
    file: map.file,
    sources: map.sources,
    names: map.names,
    mappings: map.mappings,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}
