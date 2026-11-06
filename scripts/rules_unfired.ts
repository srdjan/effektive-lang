// Lists each validator rejection site that no fast test fires. Run
// `deno task rules:unfired`. The task runs the fast suite with coverage in a
// temporary directory, reads the lcov report for src/core/validate/, and
// prints `path:line: text` for each uncovered line that starts a rejection.
// The last line gives the count. The list is a gate: the script exits 1 when
// the list has a site, or when the suite or the coverage report fails. It
// exits 0 when the list is empty.
//
// A rejection starts at a line that calls `add` or `addDepth` on a report
// receiver: `report`, `ctx.report`, `this.ctx.report`, `this` (the expression
// checker), or `c` (the family checkers). A call can span several lines, and
// the first line is the one that counts. The match is textual, so a rejection
// that goes through another helper is not listed.

import { fromFileUrl, join, relative } from "@std/path";
import { fastSuiteArgs, ROOT, runProcess, withTempDir } from "./lib.ts";

const VALIDATE_DIR = "src/core/validate/";
const REJECTION =
  /(?<![\w.])(?:this\.ctx\.report|ctx\.report|report|this|c)\.(?:addDepth|add)\(/;

/** Uncovered line numbers (ascending) of each file in the lcov text. */
export function parseLcovUncovered(lcov: string): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  let current: number[] | undefined;
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      current = [];
      result[line.slice(3)] = current;
    } else if (line.startsWith("DA:") && current !== undefined) {
      const [number, count] = line.slice(3).split(",");
      if (Number(count) === 0) current.push(Number(number));
    } else if (line === "end_of_record") {
      current?.sort((a, b) => a - b);
      current = undefined;
    }
  }
  return result;
}

/** The 1-based lines of the source that start a report call. */
export function rejectionLines(source: string): number[] {
  const found: number[] = [];
  source.split("\n").forEach((text, index) => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (REJECTION.test(text)) found.push(index + 1);
  });
  return found;
}

/**
 * Formats the unfired rejection sites as `path:line: text`, sorted by path
 * and line, followed by the count. A file without a source entry is skipped.
 */
export function formatUnfired(
  uncovered: Record<string, number[]>,
  sources: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const path of Object.keys(uncovered).sort()) {
    const source = sources[path];
    if (source === undefined) continue;
    const text = source.split("\n");
    const sites = new Set(rejectionLines(source));
    const lines = [...new Set(uncovered[path])].sort((a, b) => a - b);
    for (const line of lines) {
      if (sites.has(line)) {
        out.push(`${path}:${line}: ${text[line - 1].trim()}`);
      }
    }
  }
  return [...out, `${out.length} unfired rejection sites`];
}

/**
 * The exit code for a formatted list: 1 when the list has a site before its
 * count line, and 0 when the count line is alone.
 */
export function unfiredExitCode(formatted: readonly string[]): number {
  return formatted.length > 1 ? 1 : 0;
}

async function run(
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const output = await runProcess("deno", args, { cwd: ROOT });
  return { ok: output.success, stdout: output.stdout, stderr: output.stderr };
}

async function main(): Promise<number> {
  return await withTempDir("rules-unfired-", async (dir) => {
    const suite = await run([
      "test",
      ...fastSuiteArgs([
        // The floors in deno.json are for the whole project, not for this suite.
        "--coverage-raw-data-only",
        `--coverage=${dir}`,
      ]),
    ]);
    if (!suite.ok) {
      console.error(
        `rules:unfired: the fast suite failed\n${suite.stdout}${suite.stderr}`,
      );
      return 1;
    }
    const report = await run([
      "coverage",
      "--lcov",
      // The floors in deno.json are for the whole project, not for this subset.
      "--threshold=1",
      `--include=${VALIDATE_DIR}`,
      dir,
    ]);
    if (!report.ok) {
      console.error(`rules:unfired: deno coverage failed\n${report.stderr}`);
      return 1;
    }
    const uncovered: Record<string, number[]> = {};
    const sources: Record<string, string> = {};
    for (
      const [file, lines] of Object.entries(parseLcovUncovered(report.stdout))
    ) {
      const path = relative(
        ROOT,
        file.startsWith("file://") ? fromFileUrl(file) : file,
      );
      if (!path.startsWith(VALIDATE_DIR)) continue;
      uncovered[path] = lines;
      sources[path] = await Deno.readTextFile(join(ROOT, path));
    }
    const formatted = formatUnfired(uncovered, sources);
    console.log(formatted.join("\n"));
    return unfiredExitCode(formatted);
  });
}

if (import.meta.main) Deno.exit(await main());
