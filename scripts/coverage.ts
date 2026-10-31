// Measures test coverage of both suites and enforces the floors. Run
// `deno task coverage`. The task runs the fast suite, then the slow suite with
// child-process coverage, in one temporary directory. It merges both with
// `deno coverage`, prints the line and branch percent for each directory and
// for the 20 lowest files, and exits 1 when a floor fails. The floors are in
// deno.json under "coverage": { "thresholds": ... }, and `deno coverage`
// enforces them. The task exits 1 also when a suite or the report fails.
//
// The merge includes only src/ and playground/src/ of this repository. The
// slow suite compiles copies in temporary directories, and the pattern is
// anchored on the real repository path to leave those copies out.

import { dirname, fromFileUrl, join, relative, toFileUrl } from "@std/path";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const GROUPS = [
  "src/core",
  "src/cli",
  "src/host",
  "src/lsp",
  "playground/src",
] as const;
const OTHER = "other";
const LOWEST_COUNT = 20;
const FLOOR_MESSAGE = "Coverage threshold not met";

/** Counts of hit and found items for lines, branches, and functions. */
export type Counts = {
  readonly linesFound: number;
  readonly linesHit: number;
  readonly branchesFound: number;
  readonly branchesHit: number;
  readonly functionsFound: number;
  readonly functionsHit: number;
};

/** A row of the summary: a name, its counts, and the rounded percentages. */
export type Row = Counts & {
  readonly name: string;
  readonly linePct: number;
  readonly branchPct: number;
  readonly functionPct: number;
};

/** The summary of an lcov report. */
export type Summary = {
  readonly groups: readonly Row[];
  readonly lowest: readonly Row[];
  readonly total: Row;
};

/** The result of the `deno coverage` run: how it ended. */
export type ReportOutcome = "pass" | "floor" | "failed";

const ZERO: Counts = {
  linesFound: 0,
  linesHit: 0,
  branchesFound: 0,
  branchesHit: 0,
  functionsFound: 0,
  functionsHit: 0,
};

function percent(hit: number, found: number): number {
  return found === 0 ? 100 : Math.round((hit / found) * 10000) / 100;
}

function row(name: string, counts: Counts): Row {
  return {
    name,
    ...counts,
    linePct: percent(counts.linesHit, counts.linesFound),
    branchPct: percent(counts.branchesHit, counts.branchesFound),
    functionPct: percent(counts.functionsHit, counts.functionsFound),
  };
}

function add(a: Counts, b: Counts): Counts {
  return {
    linesFound: a.linesFound + b.linesFound,
    linesHit: a.linesHit + b.linesHit,
    branchesFound: a.branchesFound + b.branchesFound,
    branchesHit: a.branchesHit + b.branchesHit,
    functionsFound: a.functionsFound + b.functionsFound,
    functionsHit: a.functionsHit + b.functionsHit,
  };
}

/** Escapes the characters that have a meaning in a regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `--include` pattern of `deno coverage`: the `file:///` form of
 * `<root>/src/` and `<root>/playground/src/`, with `root` escaped.
 */
export function includePattern(root: string): string {
  const base = escapeRegex(toFileUrl(root).href.replace(/\/$/, ""));
  return `^${base}/(src|playground/src)/`;
}

/** The counts of each file in the lcov text, keyed by the `SF:` path. */
export function parseLcovCounts(lcov: string): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  let path: string | undefined;
  let counts = ZERO;
  for (const line of lcov.split("\n")) {
    const colon = line.indexOf(":");
    const key = colon === -1 ? line : line.slice(0, colon);
    const value = Number(line.slice(colon + 1));
    if (key === "SF") {
      path = line.slice(3);
      counts = ZERO;
    } else if (key === "LF") counts = { ...counts, linesFound: value };
    else if (key === "LH") counts = { ...counts, linesHit: value };
    else if (key === "BRF") counts = { ...counts, branchesFound: value };
    else if (key === "BRH") counts = { ...counts, branchesHit: value };
    else if (key === "FNF") counts = { ...counts, functionsFound: value };
    else if (key === "FNH") counts = { ...counts, functionsHit: value };
    else if (key === "end_of_record" && path !== undefined) {
      result[path] = counts;
      path = undefined;
    }
  }
  return result;
}

function groupOf(relativePath: string): string {
  for (const group of GROUPS) {
    if (relativePath.startsWith(`${group}/`)) return group;
  }
  return OTHER;
}

function relativeTo(root: string, path: string): string {
  const plain = path.startsWith("file://") ? fromFileUrl(path) : path;
  return relative(root, plain).replaceAll("\\", "/");
}

/**
 * Summarizes the lcov text: one row for each directory of `GROUPS` that has
 * files, the lowest files by line percent, and the total. The paths are
 * relative to `root`.
 */
export function summarizeLcov(lcov: string, root: string): Summary {
  const files = Object.entries(parseLcovCounts(lcov)).map(([path, counts]) =>
    [relativeTo(root, path), counts] as const
  );
  const byGroup = new Map<string, Counts>();
  let total = ZERO;
  for (const [path, counts] of files) {
    const group = groupOf(path);
    byGroup.set(group, add(byGroup.get(group) ?? ZERO, counts));
    total = add(total, counts);
  }
  const groups = [...GROUPS, OTHER].filter((name) => byGroup.has(name)).map(
    (name) => row(name, byGroup.get(name) ?? ZERO),
  );
  const lowest = files.map(([path, counts]) => row(path, counts)).sort((a, b) =>
    a.linePct - b.linePct || a.branchPct - b.branchPct ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ).slice(0, LOWEST_COUNT);
  return { groups, lowest, total: row("total", total) };
}

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function table(title: string, rows: readonly Row[]): string[] {
  const width = Math.max(title.length, ...rows.map((r) => r.name.length));
  const out = [`${pad(title, width)}  Lines %  Branch %`];
  for (const r of rows) {
    out.push(
      `${pad(r.name, width)}  ${r.linePct.toFixed(2).padStart(7)}  ${
        r.branchPct.toFixed(2).padStart(8)
      }`,
    );
  }
  return out;
}

/** The report lines: the directory table, the lowest files, and the total. */
export function formatSummary(summary: Summary): string[] {
  const { total } = summary;
  return [
    ...table("Directory", summary.groups),
    "",
    ...table(`Lowest ${summary.lowest.length} files`, summary.lowest),
    "",
    `Total: lines ${total.linePct.toFixed(2)}%, branches ${
      total.branchPct.toFixed(2)
    }%, functions ${total.functionPct.toFixed(2)}%`,
  ];
}

/**
 * Classifies the end of `deno coverage`. A failed run with the threshold
 * message is a failed floor. Any other failed run is a failed report.
 */
export function reportOutcome(ok: boolean, stderr: string): ReportOutcome {
  if (ok) return "pass";
  return stderr.includes(FLOOR_MESSAGE) ? "floor" : "failed";
}

type Run = { ok: boolean; stdout: string; stderr: string };

async function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<Run> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: ROOT,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    ok: output.success,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

async function main(): Promise<number> {
  const dir = await Deno.makeTempDir({ prefix: "coverage-" });
  try {
    const fast = join(dir, "fast");
    const slow = join(dir, "slow");
    const fastRun = await run([
      "test",
      "--allow-read",
      "--parallel",
      "--ignore=**/*_slow_test.ts",
      // Without this flag, `deno test` applies the floors to one suite alone.
      "--coverage-raw-data-only",
      `--coverage=${fast}`,
      "tests/",
    ]);
    if (!fastRun.ok) {
      console.error(
        `coverage: the fast suite failed\n${fastRun.stdout}${fastRun.stderr}`,
      );
      return 1;
    }
    const slowRun = await run([
      "run",
      "--allow-run",
      "--allow-read",
      "--allow-write",
      "scripts/test_slow.ts",
      "--coverage-raw-data-only",
      `--coverage=${slow}`,
    ], { DENO_COVERAGE_DIR: slow });
    if (!slowRun.ok) {
      console.error(
        `coverage: the slow suite failed\n${slowRun.stdout}${slowRun.stderr}`,
      );
      return 1;
    }
    const report = await run([
      "coverage",
      "--lcov",
      `--include=${includePattern(ROOT)}`,
      fast,
      slow,
    ]);
    const outcome = reportOutcome(report.ok, report.stderr);
    // `deno coverage --lcov` prints the report also when a floor fails.
    if (outcome === "failed" || !report.stdout.includes("SF:")) {
      console.error(`coverage: deno coverage failed\n${report.stderr}`);
      return 1;
    }
    console.log(formatSummary(summarizeLcov(report.stdout, ROOT)).join("\n"));
    if (outcome === "floor") {
      console.error(`coverage: ${report.stderr.trim()}`);
      return 1;
    }
    return 0;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

if (import.meta.main) Deno.exit(await main());
