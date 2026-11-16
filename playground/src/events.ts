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

type ViewportWidth = number;
type SourcePath = string;
type SourceLength = number;
type SavingLabel = string;
type SourceOffset = number;
type ViewName = string;
type ErrorTag = string;
type ErrorMessage = string;

/** The widths where the wide layout and the explorer start. `app.css` agrees. */
export const WIDE_FROM = 720;
export const EXPLORER_FROM = 1024;

export function layoutOf(width: ViewportWidth): Layout {
  if (width < WIDE_FROM) return "narrow";
  if (width < EXPLORER_FROM) return "wide";
  return "explorer";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

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
  path: SourcePath,
  by: "click" | "key" | "hash" | "start",
): PgSelectData {
  return { path: path, by: by };
}

export function editData(
  path: SourcePath,
  changes: readonly EditChange[],
  length: SourceLength,
): PgEditData {
  return { path: path, changes: changes, length: length };
}

/** The diagnostics are those of `path`. The counts list files with errors. */
export function compileData(
  path: SourcePath,
  result: PlaygroundResult,
  saving: SavingLabel,
): PgCompileData {
  const counts: Record<string, number> = {};
  for (const entry of Object.entries(tabCounts(result))) {
    const file = entry[0];
    const count = entry[1];
    if (count > 0) counts[file] = count;
  }
  return {
    path: path,
    ms: round1(result.elapsedMs),
    diagnostics: (result.diagnostics[path] ?? []).map((d) => ({
      code: d.code,
      from: d.from,
      to: d.to,
    })),
    counts: counts,
    stale: outputState(result, path).tag === "stale",
    saving: saving,
  };
}

export function hoverData(
  offset: SourceOffset,
  hit: PlaygroundHover | undefined,
  by: "pointer" | "cursor",
): PgHoverData {
  return { offset: offset, hit: hit !== undefined, by: by };
}

export function problemData(
  item: Pick<ProblemItem, "code" | "path">,
): PgProblemData {
  return { code: item.code, path: item.path };
}

export function viewData(name: ViewName): PgViewData {
  return { name: name };
}

export function layoutData(mode: Layout): PgLayoutData {
  return { mode: mode };
}

export function errorData(tag: ErrorTag, message: ErrorMessage): PgErrorData {
  return { tag: tag, message: message };
}

export function endData(): EmptyData {
  return {};
}
