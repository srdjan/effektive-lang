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

import {
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  toFileUrl,
} from "@std/path";
import type { Result } from "../src/core/mod.ts";
import { fastSuiteArgs, ROOT, runProcess, withTempDir } from "./lib.ts";

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

/** The coverage owner of each production TypeScript file. */
export type CoverageOwnership = {
  readonly runtimePaths: readonly string[];
  readonly typeOnlyPaths: readonly string[];
  readonly separatePaths: readonly string[];
};

/** A validation failure in the ownership manifest or LCOV report. */
export type CoverageValidationError = {
  readonly tag: "manifest" | "inventory" | "report" | "read";
  readonly message: string;
};

/** The accounting result of a valid LCOV report. */
export type ValidatedCoverage = {
  readonly recordCount: number;
};

type ManifestCategory = {
  readonly reason: string;
  readonly owner: string;
  readonly paths: readonly string[];
};

const MANIFEST_KEYS = [
  "runtimeReportable",
  "typeOnly",
  "separatelyExercisedEntrypoint",
] as const;
const COUNTERS = ["FNF", "FNH", "BRF", "BRH", "LF", "LH"] as const;
type Counter = (typeof COUNTERS)[number];

function validationError(
  tag: CoverageValidationError["tag"],
  message: string,
): Result<never, CoverageValidationError> {
  return { ok: false, error: { tag, message } };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string");
}

function categoryOf(
  value: unknown,
  name: string,
): Result<ManifestCategory, CoverageValidationError> {
  if (!isRecord(value)) {
    return validationError("manifest", `${name} must be an object`);
  }
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    return validationError("manifest", `${name}.reason must not be empty`);
  }
  if (typeof value.owner !== "string" || value.owner.trim() === "") {
    return validationError("manifest", `${name}.owner must not be empty`);
  }
  if (!isStringArray(value.paths)) {
    return validationError("manifest", `${name}.paths must contain strings`);
  }
  return {
    ok: true,
    value: {
      reason: value.reason,
      owner: value.owner,
      paths: value.paths,
    },
  };
}

function isProductionPath(path: string): boolean {
  const segments = path.split("/");
  return (path.startsWith("src/") || path.startsWith("playground/src/")) &&
    path.endsWith(".ts") && !path.includes("\\") &&
    segments.every((segment) =>
      segment !== "" && segment !== "." && segment !== ".."
    );
}

function manifestPath(nativePath: string): string {
  return Deno.build.os === "windows"
    ? nativePath.replaceAll("\\", "/")
    : nativePath;
}

/**
 * Parses the ownership manifest and compares it with the source inventory.
 * Every production file must occur once in one ownership category.
 */
export function parseCoverageOwnership(
  text: string,
  sourcePaths: readonly string[],
): Result<CoverageOwnership, CoverageValidationError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return validationError("manifest", `ownership JSON is invalid: ${message}`);
  }
  if (!isRecord(parsed)) {
    return validationError("manifest", "ownership must be an object");
  }
  const keys = Object.keys(parsed).sort();
  const expectedKeys = [...MANIFEST_KEYS].sort();
  if (keys.join("\n") !== expectedKeys.join("\n")) {
    return validationError(
      "manifest",
      `ownership keys must be ${MANIFEST_KEYS.join(", ")}`,
    );
  }
  const categories: ManifestCategory[] = [];
  for (const key of MANIFEST_KEYS) {
    const category = categoryOf(parsed[key], key);
    if (!category.ok) return category;
    categories.push(category.value);
  }
  const seen = new Set<string>();
  for (const category of categories) {
    for (const path of category.paths) {
      if (!isProductionPath(path)) {
        return validationError(
          "manifest",
          `ownership path is not canonical production TypeScript: ${path}`,
        );
      }
      if (seen.has(path)) {
        return validationError("manifest", `duplicate ownership path: ${path}`);
      }
      seen.add(path);
    }
  }
  const inventory = new Set(sourcePaths);
  const unclassified = sourcePaths.filter((path) => !seen.has(path));
  const absent = [...seen].filter((path) => !inventory.has(path));
  if (unclassified.length > 0 || absent.length > 0) {
    const details = [
      unclassified.length > 0
        ? `unclassified source files: ${unclassified.join(", ")}`
        : "",
      absent.length > 0
        ? `manifest paths without source files: ${absent.join(", ")}`
        : "",
    ].filter((detail) => detail !== "").join("; ");
    return validationError("inventory", details);
  }
  return {
    ok: true,
    value: {
      runtimePaths: categories[0].paths,
      typeOnlyPaths: categories[1].paths,
      separatePaths: categories[2].paths,
    },
  };
}

async function walkTypeScript(
  root: string,
  directory: string,
): Promise<Result<readonly string[], CoverageValidationError>> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    const relativePath = manifestPath(relative(root, path));
    if (entry.isSymlink) {
      return validationError(
        "inventory",
        `symbolic link is not allowed in production sources: ${relativePath}`,
      );
    }
    if (entry.isDirectory) {
      const nested = await walkTypeScript(root, path);
      if (!nested.ok) return nested;
      paths.push(...nested.value);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      paths.push(relativePath);
    }
  }
  return { ok: true, value: paths };
}

/** Discovers all production TypeScript files from the file system. */
export async function productionSourcePaths(
  root: string | URL,
): Promise<Result<readonly string[], CoverageValidationError>> {
  const rootPath = root instanceof URL ? fromFileUrl(root) : root;
  try {
    const source = await walkTypeScript(rootPath, join(rootPath, "src"));
    if (!source.ok) return source;
    const playground = await walkTypeScript(
      rootPath,
      join(rootPath, "playground", "src"),
    );
    if (!playground.ok) return playground;
    const paths = [...source.value, ...playground.value];
    return { ok: true, value: paths.sort() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return validationError(
      "read",
      `cannot read production sources: ${message}`,
    );
  }
}

function relativeReportPath(
  root: string,
  rawPath: string,
): Result<string, CoverageValidationError> {
  let plain: string;
  try {
    plain = rawPath.startsWith("file://") ? fromFileUrl(rawPath) : rawPath;
  } catch {
    return validationError("report", `invalid SF path: ${rawPath}`);
  }
  if (!isAbsolute(plain) || normalize(plain) !== plain) {
    return validationError("report", `non-canonical SF path: ${rawPath}`);
  }
  const path = manifestPath(relative(resolve(root), plain));
  return { ok: true, value: path };
}

function counterOf(key: string): Counter | undefined {
  return COUNTERS.find((counter) => counter === key);
}

type PendingRecord = {
  readonly rawPath: string;
  readonly counts: Partial<Record<Counter, number>>;
};

function completeCounters(
  record: PendingRecord,
): Result<Record<Counter, number>, CoverageValidationError> {
  const { FNF, FNH, BRF, BRH, LF, LH } = record.counts;
  if (FNF === undefined) return missingCounter(record.rawPath, "FNF");
  if (FNH === undefined) return missingCounter(record.rawPath, "FNH");
  if (BRF === undefined) return missingCounter(record.rawPath, "BRF");
  if (BRH === undefined) return missingCounter(record.rawPath, "BRH");
  if (LF === undefined) return missingCounter(record.rawPath, "LF");
  if (LH === undefined) return missingCounter(record.rawPath, "LH");
  return { ok: true, value: { FNF, FNH, BRF, BRH, LF, LH } };
}

function missingCounter(
  rawPath: string,
  counter: Counter,
): Result<never, CoverageValidationError> {
  return validationError("report", `${rawPath} has no ${counter} counter`);
}

/** Validates complete LCOV records against the production ownership manifest. */
export function validateCoverageReport(
  lcov: string,
  root: string,
  ownership: CoverageOwnership,
): Result<ValidatedCoverage, CoverageValidationError> {
  const classified = new Set([
    ...ownership.runtimePaths,
    ...ownership.typeOnlyPaths,
    ...ownership.separatePaths,
  ]);
  const reported = new Set<string>();
  let current: PendingRecord | undefined;
  for (const line of lcov.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    const key = colon === -1 ? line : line.slice(0, colon);
    if (key === "SF") {
      if (current !== undefined) {
        return validationError(
          "report",
          `unfinished LCOV record: ${current.rawPath}`,
        );
      }
      const rawPath = line.slice(colon + 1);
      if (rawPath === "") return validationError("report", "empty SF path");
      current = { rawPath, counts: {} };
      continue;
    }
    if (key === "end_of_record") {
      if (current === undefined) {
        return validationError("report", "end_of_record has no SF path");
      }
      const completed = completeCounters(current);
      if (!completed.ok) return completed;
      const counts = completed.value;
      const pairs = [
        ["FNH", "FNF"],
        ["BRH", "BRF"],
        ["LH", "LF"],
      ] as const;
      for (const [hit, found] of pairs) {
        if (counts[hit] > counts[found]) {
          return validationError(
            "report",
            `${current.rawPath} has ${hit} above ${found}`,
          );
        }
      }
      const relativePath = relativeReportPath(root, current.rawPath);
      if (!relativePath.ok) return relativePath;
      if (!classified.has(relativePath.value)) {
        return validationError(
          "report",
          `unclassified or foreign LCOV path: ${relativePath.value}`,
        );
      }
      if (reported.has(relativePath.value)) {
        return validationError(
          "report",
          `duplicate LCOV path or alias: ${relativePath.value}`,
        );
      }
      reported.add(relativePath.value);
      current = undefined;
      continue;
    }
    const counter = counterOf(key);
    if (counter !== undefined) {
      if (current === undefined) {
        return validationError("report", `${counter} has no SF path`);
      }
      if (current.counts[counter] !== undefined) {
        return validationError(
          "report",
          `${current.rawPath} has duplicate ${counter} counters`,
        );
      }
      const rawValue = line.slice(colon + 1);
      const value = Number(rawValue);
      if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(value)) {
        return validationError(
          "report",
          `${current.rawPath} has invalid ${counter}: ${rawValue}`,
        );
      }
      current.counts[counter] = value;
    }
  }
  if (current !== undefined) {
    return validationError(
      "report",
      `unfinished LCOV record: ${current.rawPath}`,
    );
  }
  const missing = ownership.runtimePaths.filter((path) => !reported.has(path));
  if (missing.length > 0) {
    return validationError(
      "report",
      `required runtime modules have no LCOV record: ${missing.join(", ")}`,
    );
  }
  return { ok: true, value: { recordCount: reported.size } };
}

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
function parseLcovCounts(lcov: string): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  let path: string | undefined;
  let counts = ZERO;
  for (const line of lcov.split(/\r?\n/)) {
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
    (a.name === b.name ? 0 : a.name < b.name ? -1 : 1)
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
  const output = await runProcess("deno", args, { cwd: ROOT, env });
  return { ok: output.success, stdout: output.stdout, stderr: output.stderr };
}

async function main(): Promise<number> {
  const sources = await productionSourcePaths(ROOT);
  if (!sources.ok) {
    console.error(`coverage: ${sources.error.message}`);
    return 1;
  }
  let ownershipText: string;
  try {
    ownershipText = await Deno.readTextFile(
      join(ROOT, "fixtures", "coverage", "ownership.json"),
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`coverage: cannot read coverage ownership: ${message}`);
    return 1;
  }
  const ownership = parseCoverageOwnership(ownershipText, sources.value);
  if (!ownership.ok) {
    console.error(`coverage: ${ownership.error.message}`);
    return 1;
  }
  return await withTempDir("coverage-", async (dir) => {
    const fast = join(dir, "fast");
    const slow = join(dir, "slow");
    const fastRun = await run([
      "test",
      ...fastSuiteArgs([
        // Without this flag, `deno test` applies the floors to one suite alone.
        "--coverage-raw-data-only",
        `--coverage=${fast}`,
      ]),
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
    const validated = validateCoverageReport(
      report.stdout,
      ROOT,
      ownership.value,
    );
    if (!validated.ok) {
      console.error(
        `coverage: invalid LCOV report: ${validated.error.message}`,
      );
      return 1;
    }
    console.log(formatSummary(summarizeLcov(report.stdout, ROOT)).join("\n"));
    if (outcome === "floor") {
      console.error(`coverage: ${report.stderr.trim()}`);
      return 1;
    }
    return 0;
  });
}

if (import.meta.main) Deno.exit(await main());
