// The data of the playground log events (plan LG4). Each function returns the
// `data` of one `pg.*` kind, as plain JSON values. The page wraps the data in
// an envelope through `log_client.ts`. This file has no DOM code.

import { sha256Hex } from "../../src/core/mod.ts";
import type { PlaygroundHover, PlaygroundResult } from "./compile.ts";
import { outputState, type ProblemItem, tabCounts } from "./model.ts";

/** The page layout that a viewport width selects. */
export type Layout = "narrow" | "wide" | "explorer";

/** The widths where the wide layout and the explorer start. `app.css` agrees. */
const WIDE_FROM = 720;
const EXPLORER_FROM = 1024;

export function layoutOf(width: number): Layout {
  return width < WIDE_FROM
    ? "narrow"
    : width < EXPLORER_FROM
    ? "wide"
    : "explorer";
}

/** One change of a document edit. Offsets index the document before the edit. */
export interface EditChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function startData(input: {
  readonly build: string;
  readonly width: number;
  readonly height: number;
  readonly files: Readonly<Record<string, string>>;
  readonly loadMs: number;
}) {
  return {
    build: input.build,
    viewport: { w: input.width, h: input.height },
    layout: layoutOf(input.width),
    examples: sha256Hex(JSON.stringify(input.files)),
    loadMs: round1(input.loadMs),
  };
}

export function selectData(
  path: string,
  by: "click" | "key" | "hash" | "start",
) {
  return { path, by };
}

export function editData(
  path: string,
  changes: readonly EditChange[],
  length: number,
) {
  return { path, changes, length };
}

/** The diagnostics are those of `path`. The counts list files with errors. */
export function compileData(
  path: string,
  result: PlaygroundResult,
  saving: string,
) {
  const counts: Record<string, number> = {};
  for (const [file, count] of Object.entries(tabCounts(result))) {
    if (count > 0) counts[file] = count;
  }
  return {
    path,
    ms: round1(result.elapsedMs),
    diagnostics: (result.diagnostics[path] ?? []).map((d) => ({
      code: d.code,
      from: d.from,
      to: d.to,
    })),
    counts,
    stale: outputState(result, path).tag === "stale",
    saving,
  };
}

export function hoverData(
  offset: number,
  hit: PlaygroundHover | undefined,
  by: "pointer" | "cursor",
) {
  return { offset, hit: hit !== undefined, by };
}

export function problemData(item: Pick<ProblemItem, "code" | "path">) {
  return { code: item.code, path: item.path };
}

export function viewData(name: string) {
  return { name };
}

export function layoutData(mode: Layout) {
  return { mode };
}

export function errorData(tag: string, message: string) {
  return { tag, message };
}

export function endData(): Record<string, never> {
  return {};
}
