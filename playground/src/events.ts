// The data of the playground log events. Each function returns the
// `data` of one `pg.*` kind, as plain JSON values. The page wraps the data in
// an envelope through `log_client.ts`. This file has no DOM code.

import { sha256Hex } from "../../src/core/mod.ts";
import type {
  EditChange,
  EmptyData,
  Layout,
  PgCompileData,
  PgEditData,
  PgErrorData,
  PgHoverData,
  PgLayoutData,
  PgProblemData,
  PgSelectData,
  PgStartData,
  PgViewData,
} from "../../src/host/log_schema.ts";
import type { PlaygroundHover, PlaygroundResult } from "./compile.ts";
import { outputState, type ProblemItem, tabCounts } from "./model.ts";

export type { EditChange, Layout };

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

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function startData(input: {
  readonly build: string;
  readonly width: number;
  readonly height: number;
  readonly files: Readonly<Record<string, string>>;
  readonly loadMs: number;
}): PgStartData {
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
): PgSelectData {
  return { path, by };
}

export function editData(
  path: string,
  changes: readonly EditChange[],
  length: number,
): PgEditData {
  return { path, changes, length };
}

/** The diagnostics are those of `path`. The counts list files with errors. */
export function compileData(
  path: string,
  result: PlaygroundResult,
  saving: string,
): PgCompileData {
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
): PgHoverData {
  return { offset, hit: hit !== undefined, by };
}

export function problemData(
  item: Pick<ProblemItem, "code" | "path">,
): PgProblemData {
  return { code: item.code, path: item.path };
}

export function viewData(name: string): PgViewData {
  return { name };
}

export function layoutData(mode: Layout): PgLayoutData {
  return { mode };
}

export function errorData(tag: string, message: string): PgErrorData {
  return { tag, message };
}

export function endData(): EmptyData {
  return {};
}
