// Tests for the pure parts of scripts/coverage.ts: the include pattern, the
// lcov summary by directory, the lowest files, and the report outcome.

import { assert, assertEquals } from "@std/assert";
import { join, resolve, toFileUrl } from "@std/path";
import {
  escapeRegex,
  formatSummary,
  includePattern,
  parseCoverageOwnership,
  productionSourcePaths,
  reportOutcome,
  summarizeLcov,
  validateCoverageReport,
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

Deno.test("summarizeLcov keeps input order when normalized names tie", () => {
  const report = [
    "SF:/repo/src/core/a.ts",
    "FNF:2",
    "FNH:1",
    "BRF:0",
    "BRH:0",
    "LF:1",
    "LH:1",
    "end_of_record",
    "SF:file:///repo/src/core/a.ts",
    "FNF:2",
    "FNH:2",
    "BRF:0",
    "BRH:0",
    "LF:1",
    "LH:1",
    "end_of_record",
  ].join("\n");
  assertEquals(
    summarizeLcov(report, "/repo").lowest.map((row) => row.functionsHit),
    [1, 2],
  );
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

const category = (
  paths: readonly string[],
  owner = "deno task coverage",
) => ({
  reason: "The coverage gate requires a complete LCOV record.",
  owner,
  paths,
});

const TEST_ROOT = resolve(Deno.cwd(), ".coverage-test-root");

function testPath(path: string): string {
  return join(TEST_ROOT, ...path.split("/"));
}

const ownershipText = (runtimePaths: readonly string[]): string =>
  JSON.stringify({
    runtimeReportable: category(runtimePaths),
    typeOnly: category([], "deno task check"),
    separatelyExercisedEntrypoint: category(
      [],
      "playground browser acceptance",
    ),
  });

const completeRecord = (
  path: string,
  values: Partial<Record<"FNF" | "FNH" | "BRF" | "BRH" | "LF" | "LH", string>> =
    {},
): string => {
  const counters = {
    FNF: "1",
    FNH: "1",
    BRF: "0",
    BRH: "0",
    LF: "1",
    LH: "1",
    ...values,
  };
  return [
    `SF:${path}`,
    "FN:1,run",
    ...Object.entries(counters).map(([name, value]) => `${name}:${value}`),
    "end_of_record",
  ].join("\n");
};

function ownershipFor(paths: readonly string[]) {
  const result = parseCoverageOwnership(ownershipText(paths), paths);
  assert(result.ok);
  return result.value;
}

Deno.test("coverage ownership classifies the production source inventory", async () => {
  const sources = await productionSourcePaths(new URL("..", import.meta.url));
  assert(sources.ok);
  const text = await Deno.readTextFile(
    new URL("../fixtures/coverage/ownership.json", import.meta.url),
  );
  const ownership = parseCoverageOwnership(text, sources.value);
  assert(ownership.ok);
  assert(ownership.value.runtimePaths.includes("src/core/mod.ts"));
  assertEquals(ownership.value.typeOnlyPaths, [
    "src/core/body_env.ts",
    "src/core/emit/emitted_module.ts",
    "src/core/emit/families/context.ts",
    "src/host/io.ts",
    "src/host/ports.ts",
    "src/lsp/handler.ts",
  ]);
  assertEquals(ownership.value.separatePaths, [
    "playground/src/app.ts",
    "playground/src/editor.ts",
  ]);
});

Deno.test("coverage ownership rejects invalid categories and paths", () => {
  const invalidCategories = [
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({
      runtimeReportable: category(["src/core/a.ts"]),
      typeOnly: { ...category([]), reason: "" },
      separatelyExercisedEntrypoint: category([]),
    }),
    JSON.stringify({
      runtimeReportable: category(["src/core/a.ts"]),
      typeOnly: { ...category([]), owner: "" },
      separatelyExercisedEntrypoint: category([]),
    }),
    JSON.stringify({
      runtimeReportable: null,
      typeOnly: category([]),
      separatelyExercisedEntrypoint: category([]),
    }),
    JSON.stringify({
      runtimeReportable: [],
      typeOnly: category([]),
      separatelyExercisedEntrypoint: category([]),
    }),
    JSON.stringify({
      runtimeReportable: { ...category([]), paths: "src/core/a.ts" },
      typeOnly: category([]),
      separatelyExercisedEntrypoint: category([]),
    }),
    JSON.stringify({
      runtimeReportable: { ...category([]), paths: ["src/core/a.ts", 1] },
      typeOnly: category([]),
      separatelyExercisedEntrypoint: category([]),
    }),
  ];
  for (const text of invalidCategories) {
    const result = parseCoverageOwnership(text, ["src/core/a.ts"]);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.tag, "manifest");
  }

  const invalidPaths = [
    "src\\core\\a.ts",
    "src/core/../a.ts",
    "src//core/a.ts",
    "/src/core/a.ts",
    "tests/a.ts",
    "src/core/a.js",
  ];
  for (const path of invalidPaths) {
    const result = parseCoverageOwnership(
      ownershipText([path]),
      [path],
    );
    assertEquals(result.ok, false, path);
    if (!result.ok) assertEquals(result.error.tag, "manifest");
  }
});

Deno.test("coverage ownership rejects new and duplicate source paths", () => {
  const unclassified = parseCoverageOwnership(
    ownershipText(["src/core/a.ts"]),
    ["src/core/a.ts", "src/core/new.ts"],
  );
  assertEquals(unclassified.ok, false);
  if (!unclassified.ok) {
    assertEquals(unclassified.error.tag, "inventory");
    assertEquals(
      unclassified.error.message,
      "unclassified source files: src/core/new.ts",
    );
  }

  const absent = parseCoverageOwnership(
    ownershipText(["src/core/a.ts", "src/core/absent.ts"]),
    ["src/core/a.ts"],
  );
  assertEquals(absent.ok, false);
  if (!absent.ok) {
    assertEquals(absent.error.tag, "inventory");
    assertEquals(
      absent.error.message,
      "manifest paths without source files: src/core/absent.ts",
    );
  }

  const duplicate = JSON.stringify({
    runtimeReportable: category(["src/core/a.ts"]),
    typeOnly: category(["src/core/a.ts"], "deno task check"),
    separatelyExercisedEntrypoint: category(
      [],
      "playground browser acceptance",
    ),
  });
  const duplicated = parseCoverageOwnership(duplicate, ["src/core/a.ts"]);
  assertEquals(duplicated.ok, false);
  if (!duplicated.ok) assertEquals(duplicated.error.tag, "manifest");
});

Deno.test("coverage validation accepts complete CRLF records and zero totals", () => {
  const paths = ["src/core/a.ts", "src/core/b.ts"];
  const report = [
    "TN:fast",
    completeRecord(testPath("src/core/a.ts")),
    completeRecord(testPath("src/core/b.ts"), {
      FNF: "0",
      FNH: "0",
      LF: "0",
      LH: "0",
    }),
  ].join("\n").replaceAll("\n", "\r\n");
  const result = validateCoverageReport(report, TEST_ROOT, ownershipFor(paths));
  assert(result.ok);
  assertEquals(result.value.recordCount, 2);
  assertEquals(summarizeLcov(report, TEST_ROOT).total.linesFound, 1);
});

Deno.test("coverage validation rejects an absent required runtime module", () => {
  const paths = ["src/core/a.ts", "src/core/b.ts"];
  const result = validateCoverageReport(
    completeRecord(testPath("src/core/a.ts")),
    TEST_ROOT,
    ownershipFor(paths),
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.tag, "report");
    assert(result.error.message.includes("src/core/b.ts"));
  }
});

Deno.test("coverage validation rejects invalid aggregate counters", () => {
  const badValues = ["NaN", "Infinity", "1.5", "-1", "9007199254740992"];
  const counters = ["FNF", "FNH", "BRF", "BRH", "LF", "LH"] as const;
  for (const counter of counters) {
    for (const value of badValues) {
      const result = validateCoverageReport(
        completeRecord(testPath("src/core/a.ts"), { [counter]: value }),
        TEST_ROOT,
        ownershipFor(["src/core/a.ts"]),
      );
      assertEquals(result.ok, false, `${counter}:${value}`);
    }
  }
});

Deno.test("coverage validation requires each aggregate counter once", () => {
  const counters = ["FNF", "FNH", "BRF", "BRH", "LF", "LH"] as const;
  for (const counter of counters) {
    const record = completeRecord(testPath("src/core/a.ts"));
    const line = new RegExp(`^${counter}:.*$`, "m").exec(record)?.[0];
    assert(line !== undefined);
    const missing = record.replace(`${line}\n`, "");
    const duplicate = record.replace(line, `${line}\n${line}`);
    for (const report of [missing, duplicate]) {
      assertEquals(
        validateCoverageReport(
          report,
          TEST_ROOT,
          ownershipFor(["src/core/a.ts"]),
        ).ok,
        false,
        counter,
      );
    }
  }
});

Deno.test("coverage validation rejects each hit counter above its total", () => {
  const pairs = [
    ["FNH", "FNF"],
    ["BRH", "BRF"],
    ["LH", "LF"],
  ] as const;
  for (const [hit, found] of pairs) {
    const result = validateCoverageReport(
      completeRecord(testPath("src/core/a.ts"), {
        [found]: "1",
        [hit]: "2",
      }),
      TEST_ROOT,
      ownershipFor(["src/core/a.ts"]),
    );
    assertEquals(result.ok, false, `${hit}>${found}`);
  }
});

Deno.test("coverage validation rejects duplicate aliases and foreign paths", () => {
  const ownership = ownershipFor(["src/core/a.ts"]);
  const aliases = [
    completeRecord(testPath("src/core/a.ts")),
    completeRecord(toFileUrl(testPath("src/core/a.ts")).href),
  ].join("\n");
  assertEquals(
    validateCoverageReport(aliases, TEST_ROOT, ownership).ok,
    false,
  );
  assertEquals(
    validateCoverageReport(
      completeRecord(testPath("tests/a_test.ts")),
      TEST_ROOT,
      ownership,
    ).ok,
    false,
  );
  assertEquals(
    validateCoverageReport(
      completeRecord(resolve(TEST_ROOT, "..", "foreign.ts")),
      TEST_ROOT,
      ownership,
    ).ok,
    false,
  );
  assertEquals(
    validateCoverageReport(
      completeRecord(testPath("src/core/b.ts")),
      TEST_ROOT,
      ownership,
    ).ok,
    false,
  );
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  const alias =
    `${TEST_ROOT}${separator}src${separator}core${separator}..${separator}core${separator}a.ts`;
  assertEquals(
    validateCoverageReport(completeRecord(alias), TEST_ROOT, ownership).ok,
    false,
  );
  if (Deno.build.os !== "windows") {
    const backslashes = `${TEST_ROOT}/src\\core\\a.ts`;
    assertEquals(
      validateCoverageReport(
        completeRecord(backslashes),
        TEST_ROOT,
        ownership,
      ).ok,
      false,
    );
  }
});

Deno.test("coverage validation rejects unfinished records", () => {
  const report = completeRecord(testPath("src/core/a.ts")).replace(
    "end_of_record",
    "",
  );
  assertEquals(
    validateCoverageReport(
      report,
      TEST_ROOT,
      ownershipFor(["src/core/a.ts"]),
    )
      .ok,
    false,
  );
});
