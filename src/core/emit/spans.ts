import { emptyMap, indices } from "../runtime.ts";
// The span table. The emitter records the
// generated range of every printed node together with the source span of the
// node. The span table answers one question: which source span does a
// generated position belong to? A `tsc` diagnostic and a source map both use
// the answer.
//
// The table is a plain sorted array plus parent links. It is pure data. The
// functions in this file are pure and synchronous.
import type { Span } from "../ir.ts";
import { lineIndexOf, lineStarts } from "../source.ts";
import type { ModuleInfo, Project } from "../project.ts";
import type { SpanRecord } from "./doc.ts";
import type { EmittedModule, HostAssertionRecord } from "./emitted_module.ts";
/** A host assertion with the span of the Effektive import that binds the provider. */
export type HostAssertionEntry = HostAssertionRecord & {
  /**
   * The span of the imported name in the `.eff` import declaration, for
   * example `UsersLive` in `import { UsersLive } from "host:providers"`.
   * Undefined when the caller supplied no import span for the name.
   */
  readonly importSpan: Span | undefined;
};
export type SpanTable = {
  /** The generated file, relative to the project root: `users.ts`. */
  readonly path: string;
  /** The length of the generated text in UTF-16 code units. */
  readonly textLength: number;
  /** Offsets of the line starts of the generated text. */
  readonly lineStarts: Uint32Array;
  /**
   * The non-empty records, outermost first: ascending start, then descending
   * end. Of two records with one range, the outer record comes first.
   */
  readonly records: readonly SpanRecord[];
  /** For each record, the index of the smallest record that contains it, or -1. */
  readonly parents: readonly number[];
  readonly hostAssertions: readonly HostAssertionEntry[];
};
/**
 * Builds the span table of one emitted module. `importSpans` maps the name
 * that the `.eff` source binds in a host import to the span of that name. Use
 * `hostImportSpans(project).get(emitted.module)`.
 */
export function buildSpanTable(
  emitted: EmittedModule,
  requestedImportSpans: ReadonlyMap<string, Span> | undefined,
): SpanTable {
  const importSpans = requestedImportSpans ?? emptyMap<string, Span>();
  // The renderer lists the records in the order in which they close, so of two
  // records with one range the inner record comes first.
  let indexed = emitted.spans
    .map((record, closed) => ({ record: record, closed: closed }))
    .filter((entry) => entry.record.end > entry.record.start);
  indexed = indexed.sort((a, b) => {
    if (a.record.start !== b.record.start) {
      return a.record.start - b.record.start;
    }
    if (a.record.end !== b.record.end) {
      return b.record.end - a.record.end;
    }
    return b.closed - a.closed;
  });
  const records = indexed.map((entry) => entry.record);
  const parents: number[] = [];
  const open: number[] = [];
  for (const i of indices(records.length)) {
    const record = records[i];
    const containing = open.findLastIndex((index) =>
      records[index].end > record.start
    );
    open.length = containing + 1;
    parents[parents.length] = open.length === 0 ? -1 : open[open.length - 1];
    open[open.length] = i;
  }
  return {
    path: emitted.path,
    textLength: emitted.text.length,
    lineStarts: lineStarts(emitted.text),
    records: records,
    parents: parents,
    hostAssertions: emitted.hostAssertions.map((assertion) => ({
      ...assertion,
      importSpan: importSpans.get(assertion.local),
    })),
  };
}
/**
 * The span of each name that the host imports of one module bind: local name
 * to span. The `.eff` source binds the local name.
 */
export function hostNameSpans(
  links: ModuleInfo["links"],
): ReadonlyMap<string, Span> {
  let names = emptyMap<string, Span>();
  for (const link of links) {
    if (!link.isHost) {
      continue;
    }
    for (const imported of link.entry.names) {
      names = names.set(imported.name, imported.span);
    }
  }
  return names;
}
/**
 * The span of each imported name in the host imports of each module:
 * module name to local name to span. A module with no host name is absent.
 */
export function hostImportSpans(
  project: Project,
): ReadonlyMap<string, ReadonlyMap<string, Span>> {
  let result = emptyMap<string, ReadonlyMap<string, Span>>();
  for (const entry of project.modules) {
    const name = entry[0];
    const info = entry[1];
    const names = hostNameSpans(info.links);
    if (names.size > 0) {
      result = result.set(name, names);
    }
  }
  return result;
}
/**
 * The innermost record that contains the offset, or undefined. A position
 * outside every record is not mapped. The file header, the imports, the
 * helpers, the host assertions, and the blank lines between declarations lie
 * outside every record. Every position inside a declaration lies inside the
 * record of that declaration at least, so it maps to the declaration at worst.
 */
export function recordAtOffset(
  table: SpanTable,
  offset: GeneratedOffset,
): SpanRecord | undefined {
  const found = recordIndexAtOffset(table, offset);
  return found < 0 ? undefined : table.records[found];
}
export type GeneratedOffset = number;
export type RecordIndex = number;
function lastStartingRecord(
  records: readonly SpanRecord[],
  offset: GeneratedOffset,
  lo: RecordIndex,
  hi: RecordIndex,
  found: RecordIndex,
): RecordIndex {
  if (lo > hi) return found;
  const mid = (lo + hi) >> 1;
  return records[mid].start <= offset
    ? lastStartingRecord(records, offset, mid + 1, hi, mid)
    : lastStartingRecord(records, offset, lo, mid - 1, found);
}
function containingRecord(
  table: SpanTable,
  offset: GeneratedOffset,
  candidate: RecordIndex,
): RecordIndex {
  let current = candidate;
  for (const _step of indices(table.parents.length)) {
    if (current < 0 || table.records[current].end > offset) return current;
    current = table.parents[current];
  }
  return current;
}
/** The index in `table.records` of that record, or -1 when no record contains the offset. */
export function recordIndexAtOffset(
  table: SpanTable,
  offset: GeneratedOffset,
): RecordIndex {
  const records = table.records;
  const found = lastStartingRecord(records, offset, 0, records.length - 1, -1);
  // That record, or one of its ancestors, contains the offset: records nest.
  return containingRecord(table, offset, found);
}
/** The source span of the innermost record that contains a generated offset. */
export function mapOffset(
  table: SpanTable,
  offset: GeneratedOffset,
): Span | undefined {
  return recordAtOffset(table, offset)?.span;
}
/**
 * The offset of a generated position, or undefined when the line does not
 * exist or the column lies past the end of the text. The line and the column
 * are one-based, as in `tsc` and in the diagnostic format. The column counts
 * UTF-16 code units.
 */
export function offsetOfGenerated(
  table: SpanTable,
  line: GeneratedLine,
  column: GeneratedColumn,
): GeneratedOffset | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(column)) {
    return undefined;
  }
  if (line < 1 || line > table.lineStarts.length || column < 1) {
    return undefined;
  }
  const offset = table.lineStarts[line - 1] + column - 1;
  return offset > table.textLength ? undefined : offset;
}
/** The host assertion whose generated range contains the offset. */
export function hostAssertionAtOffset(
  table: SpanTable,
  offset: GeneratedOffset,
): HostAssertionEntry | undefined {
  return table.hostAssertions.find((a) => offset >= a.start && offset < a.end);
}
/** The zero-based line and column of an offset in a text, for source maps. */
export function zeroBasedPosition(
  starts: Uint32Array,
  textLength: GeneratedOffset,
  offset: GeneratedOffset,
): GeneratedPosition {
  const clamped = Math.max(0, Math.min(offset, textLength));
  const line = lineIndexOf(starts, clamped);
  return { line: line, column: clamped - starts[line] };
}
export type GeneratedLine = number;
export type GeneratedColumn = number;
export type GeneratedPosition = {
  readonly line: number;
  readonly column: number;
};
