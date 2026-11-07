// An independent line scan for tests. It shares no code with `lineStarts` and
// `positionOf` of the core, so a test that takes its expected positions from
// here does not repeat the interpretation of the encoder. A line ends at LF,
// CR, or CRLF. Both the line and the column are 1-based, in UTF-16 code units.

export interface LineScan {
  readonly lineCount: number;
  /** The 1-based line and column of `offset`; an offset past the end clamps. */
  readonly at: (offset: number) => { line: number; column: number };
}

const cache = new Map<string, LineScan>();

export function scanLines(text: string): LineScan {
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const lines: number[] = [];
  const columns: number[] = [];
  let line = 1;
  let column = 1;
  for (let i = 0; i < text.length; i++) {
    lines.push(line);
    columns.push(column);
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\n" || (ch === "\r" && next !== "\n")) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  lines.push(line);
  columns.push(column);
  const scan: LineScan = {
    lineCount: line,
    at: (offset) => {
      const i = Math.max(0, Math.min(offset, text.length));
      return { line: lines[i], column: columns[i] };
    },
  };
  cache.set(text, scan);
  return scan;
}
