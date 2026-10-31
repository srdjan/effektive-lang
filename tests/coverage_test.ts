// Tests for the pure parts of scripts/coverage.ts: the include pattern, the
// lcov summary by directory, the lowest files, and the report outcome.

import { assertEquals } from "@std/assert";
import {
  escapeRegex,
  formatSummary,
  includePattern,
  reportOutcome,
  summarizeLcov,
} from "../scripts/coverage.ts";

const LCOV = [
  "TN:",
  "SF:file:///repo/src/core/a.ts",
  "FNF:2",
  "FNH:2",
  "BRF:4",
  "BRH:3",
  "LF:10",
  "LH:10",
  "end_of_record",
  "SF:file:///repo/src/core/b.ts",
  "FNF:2",
  "FNH:1",
  "BRF:4",
  "BRH:1",
  "LF:10",
  "LH:5",
  "end_of_record",
  "SF:/repo/src/cli/c.ts",
  "FNF:1",
  "FNH:1",
  "BRF:0",
  "BRH:0",
  "LF:4",
  "LH:4",
  "end_of_record",
  "SF:file:///repo/playground/src/d.ts",
  "FNF:1",
  "FNH:1",
  "BRF:2",
  "BRH:2",
  "LF:6",
  "LH:6",
  "end_of_record",
].join("\n");

Deno.test("summarizeLcov gives one row for each directory with files", () => {
  const { groups } = summarizeLcov(LCOV, "/repo");
  assertEquals(
    groups.map((g) => [g.name, g.linePct, g.branchPct]),
    [
      ["src/core", 75, 50],
      ["src/cli", 100, 100],
      ["playground/src", 100, 100],
    ],
  );
});

Deno.test("summarizeLcov totals the counts of every file", () => {
  const { total } = summarizeLcov(LCOV, "/repo");
  assertEquals(
    [total.linesHit, total.linesFound, total.linePct],
    [25, 30, 83.33],
  );
  assertEquals(
    [total.branchesHit, total.branchesFound, total.branchPct],
    [6, 10, 60],
  );
  assertEquals(
    [total.functionsHit, total.functionsFound, total.functionPct],
    [5, 6, 83.33],
  );
});

Deno.test("summarizeLcov lists the lowest files first with relative paths", () => {
  const { lowest } = summarizeLcov(LCOV, "/repo");
  assertEquals(lowest.map((r) => [r.name, r.linePct]), [
    ["src/core/b.ts", 50],
    ["src/core/a.ts", 100],
    ["playground/src/d.ts", 100],
    ["src/cli/c.ts", 100],
  ]);
});

Deno.test("summarizeLcov keeps at most 20 lowest files", () => {
  const files = Array.from({ length: 25 }, (_, i) =>
    [
      `SF:/repo/src/host/f${String(i).padStart(2, "0")}.ts`,
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n"));
  const { lowest } = summarizeLcov(files.join("\n"), "/repo");
  assertEquals(lowest.length, 20);
  assertEquals(lowest[0].name, "src/host/f00.ts");
  assertEquals(lowest[19].name, "src/host/f19.ts");
});

Deno.test("summarizeLcov reports 100 percent for a file without branches", () => {
  const { groups } = summarizeLcov(
    "SF:/repo/src/lsp/x.ts\nLF:2\nLH:1\nend_of_record",
    "/repo",
  );
  assertEquals(groups.map((g) => [g.name, g.linePct, g.branchPct]), [
    ["src/lsp", 50, 100],
  ]);
});

Deno.test("summarizeLcov returns an empty summary for empty text", () => {
  const summary = summarizeLcov("", "/repo");
  assertEquals(summary.groups, []);
  assertEquals(summary.lowest, []);
  assertEquals(summary.total.linePct, 100);
});

Deno.test("formatSummary prints the tables and the total", () => {
  assertEquals(formatSummary(summarizeLcov(LCOV, "/repo")), [
    "Directory       Lines %  Branch %",
    "src/core          75.00     50.00",
    "src/cli          100.00    100.00",
    "playground/src   100.00    100.00",
    "",
    "Lowest 4 files       Lines %  Branch %",
    "src/core/b.ts          50.00     25.00",
    "src/core/a.ts         100.00     75.00",
    "playground/src/d.ts   100.00    100.00",
    "src/cli/c.ts          100.00    100.00",
    "",
    "Total: lines 83.33%, branches 60.00%, functions 83.33%",
  ]);
});

Deno.test("includePattern anchors on the escaped repository path", () => {
  assertEquals(
    includePattern("/work/a.b+c"),
    "^file:///work/a\\.b\\+c/(src|playground/src)/",
  );
});

Deno.test("includePattern matches the repository and not a temporary copy", () => {
  const pattern = new RegExp(includePattern("/work/repo"));
  assertEquals(pattern.test("file:///work/repo/src/core/mod.ts"), true);
  assertEquals(pattern.test("file:///work/repo/playground/src/app.ts"), true);
  assertEquals(pattern.test("file:///tmp/x/work/repo/src/core/mod.ts"), false);
  assertEquals(pattern.test("file:///work/repo/tests/a_test.ts"), false);
  assertEquals(pattern.test("file:///work/repoX/src/core/mod.ts"), false);
});

Deno.test("escapeRegex escapes the regex characters", () => {
  assertEquals(escapeRegex("a.b*c(d)[e]"), "a\\.b\\*c\\(d\\)\\[e\\]");
});

Deno.test("reportOutcome tells a floor failure from a report failure", () => {
  const cases = [
    [true, "", "pass"],
    [false, "error: Coverage threshold not met:\n  - Branch", "floor"],
    [false, "error: no coverage data", "failed"],
  ] as const;
  for (const [ok, stderr, expected] of cases) {
    assertEquals(reportOutcome(ok, stderr), expected);
  }
});
