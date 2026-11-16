// The page logic of the playground that needs no DOM: the tab from
// the URL hash, the Problems list, the error count of each tab, the state of
// the TypeScript pane, and the hover texts. Fast tests cover each function.

import {
  caught,
  isInterfacePath,
  lineStarts,
  positionOf,
  type Severity,
} from "../../src/core/mod.ts";
import { decodeUriComponent } from "../../src/core/frontend.ts";
import { BACKEND_UNAVAILABLE_TEXT } from "../../src/core/typescript.ts";
import type { PlaygroundHover, PlaygroundResult } from "./compile.ts";

/** The tab that opens when the hash names no known file. */
export const DEFAULT_TAB = "main.eff";

type UrlHash = string;
type SourcePath = string;
type SourceText = string;
type TabSize = number;
type Column = number;

/** `decodeURIComponent` that gives undefined for a malformed escape. */
function decode(text: string): string | undefined {
  const decoded = caught(() => decodeUriComponent(text));
  return decoded.ok ? decoded.value : undefined;
}

/**
 * The file that a URL hash selects. The hash looks like `#users.eff` or
 * `#host%2Fproviders.effi`. The result is the decoded path when `paths`
 * contains it, else `DEFAULT_TAB`. A malformed escape gives `DEFAULT_TAB`.
 */
export function tabFromHash(
  hash: UrlHash,
  paths: readonly SourcePath[],
): SourcePath {
  const path = decode(hash.startsWith("#") ? hash.slice(1) : hash);
  return path !== undefined && paths.includes(path) ? path : DEFAULT_TAB;
}

/** One entry of the Problems list. Line and column are one-based. */
export type ProblemItem = {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
};

function compareProblemItems(left: ProblemItem, right: ProblemItem): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.from !== right.from) return left.from - right.from;
  return left.to - right.to;
}

/**
 * Every diagnostic of every file, sorted by path, then `from`, then `to`.
 * `texts` maps a path to the text that the diagnostic offsets index. A path
 * without text gets line 1 and column 1.
 */
export function problemItems(
  result: PlaygroundResult,
  texts: Readonly<Record<string, string>>,
): ProblemItem[] {
  const items: ProblemItem[] = [];
  for (const entry of Object.entries(result.diagnostics)) {
    const path = entry[0];
    const diagnostics = entry[1];
    const text = texts[path] ?? "";
    const starts = lineStarts(text);
    for (const d of diagnostics) {
      const position = positionOf(starts, text, d.from);
      items[items.length] = {
        path: path,
        from: d.from,
        to: d.to,
        line: position.line,
        column: position.column,
        severity: d.severity,
        code: d.code,
        message: d.message,
      };
    }
  }
  return items.sort(compareProblemItems);
}

/**
 * The number of diagnostics in each file. Every path of
 * `result.diagnostics` has an entry, also with count 0.
 */
export function tabCounts(result: PlaygroundResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.entries(result.diagnostics)) {
    const path = entry[0];
    const diagnostics = entry[1];
    counts[path] = diagnostics.length;
  }
  return counts;
}

/**
 * What the TypeScript pane shows for a file.
 * `text`: the current output. `stale`: the last good output, while the module
 * has errors. `none`: the module never produced output.
 */
type OutputState =
  | { readonly tag: "text"; readonly text: string }
  | { readonly tag: "stale"; readonly text: string }
  | { readonly tag: "none" };

export function outputState(
  result: PlaygroundResult,
  path: SourcePath,
): OutputState {
  const output = result.outputs[path];
  if (output === undefined || output === null) return { tag: "none" };
  return output.stale
    ? { tag: "stale", text: output.text }
    : { tag: "text", text: output.text };
}

/** The characters that are not whitespace, outside whole-line `//` comments. */
function nonWhitespaceLength(text: string): number {
  let length = 0;
  for (const character of text) {
    if (character.trim().length > 0) length = length + character.length;
  }
  return length;
}

function codeLength(text: string): number {
  const code = text.split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("");
  return nonWhitespaceLength(code);
}

/**
 * The status bar text that compares the source with its generated TypeScript.
 * Whitespace and whole-line comments, such as the generated header and the
 * source map line, do not count. Empty when the output has no code.
 */
export function savingLabel(
  source: SourceText,
  generated: SourceText,
): SourceText {
  const target = codeLength(generated);
  if (target === 0) return "";
  const saved = Math.round((1 - codeLength(source) / target) * 100);
  return saved >= 0
    ? `${saved}% fewer characters than Effect-TS`
    : `${-saved}% more characters than Effect-TS`;
}

/**
 * The saving label that the page shows for a file, and the replay expects.
 * Stale output belongs to older source, and the companion module of an
 * interface is a check module, not its translation, so neither compares.
 */
export function outputSaving(
  state: OutputState,
  path: SourcePath,
  source: SourceText,
): SourceText {
  return state.tag === "text" && !isInterfacePath(path)
    ? savingLabel(source, state.text)
    : "";
}

/** One labelled block of the hover tooltip. `code` is false for a plain message. */
export type HoverBlock = {
  readonly label: string;
  readonly text: string;
  readonly code: boolean;
};

type HoverLines = {
  /** The blocks of the tooltip: the contract, then the backend type when it exists. */
  readonly tooltip: readonly HoverBlock[];
  /** The text of the cursor line: the contract on one line. Empty without a hit. */
  readonly cursor: string;
};

function oneLine(text: string): string {
  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

/** The texts of the tooltip and of the cursor line for a hover answer. */
export function hoverLines(hit: PlaygroundHover | undefined): HoverLines {
  if (hit === undefined) return { tooltip: [], cursor: "" };
  const tooltip: HoverBlock[] = [
    { label: "Contract", text: hit.contract, code: true },
  ];
  if (hit.backend?.tag === "type") {
    tooltip[tooltip.length] = {
      label: "Backend type",
      text: hit.backend.text,
      code: true,
    };
  } else if (hit.backend?.tag === "unavailable") {
    tooltip[tooltip.length] = {
      label: "Backend type",
      text: BACKEND_UNAVAILABLE_TEXT,
      code: false,
    };
  }
  return {
    tooltip: tooltip,
    cursor: oneLine(hit.contract),
  };
}

/** The extra columns that a wrapped part of a line hangs past its indent. */
export const WRAP_HANG = 2;

/**
 * The columns that each wrapped part of `line` starts at: the leading
 * whitespace of the line plus `WRAP_HANG`. A tab moves to the next multiple of
 * `tabSize`.
 */
export function wrapIndent(line: SourceText, tabSize: TabSize): Column {
  let column = 0;
  for (const char of line) {
    if (char === " ") column = column + 1;
    else if (char === "\t") column = column + tabSize - (column % tabSize);
    else break;
  }
  return column + WRAP_HANG;
}
