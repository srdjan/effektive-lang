// Lists each validator rejection site that no fast test fires. Run
// `deno task rules:unfired`. The task runs the fast suite with coverage in a
// temporary directory, reads the lcov report for src/core/validate/, and
// prints `path:line: text` for each uncovered line that starts a rejection.
// The last line gives the count. The list is a report, not a gate: the script
// exits 0 when it succeeds and 1 when the suite or the coverage report fails.
//
// A rejection starts at a line that calls `add` or `addDepth` on a report
// receiver: `report`, `ctx.report`, `this.ctx.report`, `this` (the expression
// checker), or `c` (the family checkers). A call can span several lines, and
// the first line is the one that counts. The match is textual, so a rejection
// that goes through another helper is not listed.

import { dirname, fromFileUrl, join, relative } from "@std/path";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
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

async function run(
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const output = await new Deno.Command("deno", {
    args,
    cwd: ROOT,
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
  const dir = await Deno.makeTempDir({ prefix: "rules-unfired-" });
  try {
    const suite = await run([
      "test",
      "--allow-read",
      "--parallel",
      "--ignore=**/*_slow_test.ts",
      `--coverage=${dir}`,
      "tests/",
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
    console.log(formatUnfired(uncovered, sources).join("\n"));
    return 0;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

if (import.meta.main) Deno.exit(await main());
