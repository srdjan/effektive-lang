import { bigInteger, emptyMap, emptySet } from "../runtime.ts";
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
import {
  invariantFailure,
  lineIndexOf,
  lineStarts,
  type Result,
} from "../source.ts";
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
export type VlqValue = number;
export type VlqText = string;
function encodeVlqDigits(rest: bigint, out: VlqText): VlqText {
  let digit = Number(rest % 32n);
  const next = rest / 32n;
  if (next > 0n) {
    digit = digit | CONTINUATION;
  }
  const encoded = out + BASE64[digit];
  return next > 0n ? encodeVlqDigits(next, encoded) : encoded;
}
export function encodeVlq(value: VlqValue): VlqText {
  if (!Number.isSafeInteger(value)) {
    return invariantFailure("emit", `cannot encode ${value} as VLQ`);
  }
  const integer = bigInteger(value);
  const rest = value < 0 ? -integer * 2n + 1n : integer * 2n;
  return encodeVlqDigits(rest, "");
}
// ------------------------------------------------------------------ the map
export type SourceMapV3 = {
  readonly version: 3;
  /** The generated file, without its directory: `users.ts`. */
  readonly file: string;
  /** The `.eff` files, relative to the directory of the map. */
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
};
export type SourceMapError = {
  readonly tag: "missing-source";
  readonly source: string;
};
/** A source of the map: its place in `sources`, its text, and its line starts. */
type SourceInfo = {
  readonly index: number;
  readonly text: string;
  readonly starts: Uint32Array;
};
/**
 * Builds the source map of one module. `sourceTexts` maps each root-relative
 * source path to its text, for the line tables. A source that a record names
 * and that is missing from `sourceTexts` is an error value.
 */
export function buildSourceMap(
  table: SpanTable,
  sourceTexts: ReadonlyMap<string, string>,
): Result<SourceMapV3, SourceMapError> {
  let infoOf = emptyMap<string, SourceInfo>();
  // The source of each record, in the order of `table.records`.
  const recordInfo: SourceInfo[] = [];
  for (const record of table.records) {
    const source = record.span.source;
    let info = infoOf.get(source);
    if (info === undefined) {
      const text = sourceTexts.get(source);
      if (text === undefined) {
        return { ok: false, error: { tag: "missing-source", source: source } };
      }
      info = { index: infoOf.size, text: text, starts: lineStarts(text) };
      infoOf = infoOf.set(source, info);
    }
    {
      const _appendTarget1 = recordInfo;
      const _appendValue2 = info;
      _appendTarget1[_appendTarget1.length] = _appendValue2;
    }
  }
  const sources = [...infoOf.keys()];
  let points = emptySet<number>();
  for (const record of table.records) {
    points = points.add(record.start);
    if (record.end < table.textLength) {
      points = points.add(record.end);
    }
  }
  for (const start of table.lineStarts) {
    if (start < table.textLength) {
      points = points.add(start);
    }
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
      if (lastTarget === undefined) {
        continue;
      }
      {
        const _appendTarget3 = lines[generatedLine];
        const _appendValue4 = encodeVlq(generatedColumn - previousGenerated);
        _appendTarget3[_appendTarget3.length] = _appendValue4;
      }
      previousGenerated = generatedColumn;
      lastTarget = undefined;
      continue;
    }
    const info = recordInfo[recordIndex];
    const index = info.index;
    const text = info.text;
    const starts = info.starts;
    const target = zeroBasedPosition(
      starts,
      text.length,
      table.records[recordIndex].span.start,
    );
    const key = `${index}:${target.line}:${target.column}`;
    if (key === lastTarget) {
      continue;
    }
    {
      const _appendTarget5 = lines[generatedLine];
      const _appendValue6 = encodeVlq(generatedColumn - previousGenerated) +
        encodeVlq(index - previousSource) +
        encodeVlq(target.line - previousLine) +
        encodeVlq(target.column - previousColumn);
      _appendTarget5[_appendTarget5.length] = _appendValue6;
    }
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
export type SourceMapText = string;
export function serializeSourceMap(map: SourceMapV3): SourceMapText {
  const ordered = {
    version: map.version,
    file: map.file,
    sources: map.sources,
    names: map.names,
    mappings: map.mappings,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}
