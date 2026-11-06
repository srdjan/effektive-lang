// A source map decoder for the tests. It reads `mappings` without the encoder of
// the product, so a coding error in `encodeVlq` cannot hide in a round trip.

import type { Result } from "../../src/core/frontend.ts";
import type { Span } from "../../src/core/ir.ts";
import {
  mapOffset,
  offsetOfGenerated,
  type SpanTable,
} from "../../src/core/typescript.ts";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(
  [...BASE64].map((char, value) => [char, value]),
);
const CONTINUATION = 32;
const DIGIT_MASK = 31;
const MAX_VLQ_VALUE = BigInt(Number.MAX_SAFE_INTEGER) * 2n + 1n;

type VlqError =
  | { readonly tag: "bad-character"; readonly index: number }
  | { readonly tag: "truncated"; readonly index: number }
  | { readonly tag: "overflow"; readonly index: number };

/** Decodes the integers in `text`. The text holds only VLQ digits. */
export function decodeVlqList(text: string): Result<number[], VlqError> {
  const values: number[] = [];
  let acc = 0n;
  let scale = 1n;
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const digit = BASE64_VALUES.get(text[i]);
    if (digit === undefined) {
      return { ok: false, error: { tag: "bad-character", index: i } };
    }
    acc += BigInt(digit & DIGIT_MASK) * scale;
    if (acc > MAX_VLQ_VALUE) {
      return { ok: false, error: { tag: "overflow", index: i } };
    }
    if ((digit & CONTINUATION) !== 0) {
      scale *= 32n;
      if (scale > MAX_VLQ_VALUE) scale = MAX_VLQ_VALUE + 1n;
      open = true;
      continue;
    }
    values.push(acc % 2n === 1n ? -Number((acc - 1n) / 2n) : Number(acc / 2n));
    acc = 0n;
    scale = 1n;
    open = false;
  }
  if (open) {
    return { ok: false, error: { tag: "truncated", index: text.length } };
  }
  return { ok: true, value: values };
}

/** One decoded segment. Positions are zero-based. A segment with no `source` ends a mapping. */
interface MapSegment {
  readonly generatedColumn: number;
  readonly source: number | undefined;
  readonly line: number | undefined;
  readonly column: number | undefined;
}

type MappingsError =
  | { readonly tag: "bad-vlq"; readonly line: number; readonly error: VlqError }
  | { readonly tag: "overflow"; readonly line: number }
  | {
    readonly tag: "bad-segment";
    readonly line: number;
    readonly fields: number;
  };

/** Decodes `mappings` into the segments of each generated line, with absolute values. */
export function decodeMappings(
  mappings: string,
): Result<MapSegment[][], MappingsError> {
  const result: MapSegment[][] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  const lines = mappings.split(";");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const segments: MapSegment[] = [];
    let generated = 0;
    const text = lines[lineIndex];
    if (text !== "") {
      for (const part of text.split(",")) {
        const decoded = decodeVlqList(part);
        if (!decoded.ok) {
          return {
            ok: false,
            error: { tag: "bad-vlq", line: lineIndex, error: decoded.error },
          };
        }
        const fields = decoded.value;
        if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
          return {
            ok: false,
            error: {
              tag: "bad-segment",
              line: lineIndex,
              fields: fields.length,
            },
          };
        }
        generated += fields[0];
        if (!Number.isSafeInteger(generated)) {
          return { ok: false, error: { tag: "overflow", line: lineIndex } };
        }
        if (fields.length === 1) {
          segments.push({
            generatedColumn: generated,
            source: undefined,
            line: undefined,
            column: undefined,
          });
          continue;
        }
        source += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
        if (
          !Number.isSafeInteger(source) || !Number.isSafeInteger(sourceLine) ||
          !Number.isSafeInteger(sourceColumn)
        ) {
          return { ok: false, error: { tag: "overflow", line: lineIndex } };
        }
        segments.push({
          generatedColumn: generated,
          source,
          line: sourceLine,
          column: sourceColumn,
        });
      }
    }
    result.push(segments);
  }
  return { ok: true, value: result };
}

/**
 * The segment that covers a generated position: the last segment of the line
 * that starts at or before the column. Zero-based. Undefined when the
 * position is unmapped.
 */
export function lookupMapping(
  decoded: readonly (readonly MapSegment[])[],
  line: number,
  column: number,
): MapSegment | undefined {
  const segments = decoded[line];
  if (segments === undefined) return undefined;
  let found: MapSegment | undefined;
  for (const segment of segments) {
    if (segment.generatedColumn > column) break;
    found = segment;
  }
  return found === undefined || found.source === undefined ? undefined : found;
}

/**
 * The source span of a generated position. The line and the column are
 * one-based. Returns undefined for a position that lies outside the text or
 * outside every record.
 */
export function mapGenerated(
  table: SpanTable,
  line: number,
  column: number,
): Span | undefined {
  const offset = offsetOfGenerated(table, line, column);
  return offset === undefined ? undefined : mapOffset(table, offset);
}
