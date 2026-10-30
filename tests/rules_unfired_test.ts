// Tests for the pure parts of scripts/rules_unfired.ts: the lcov parser, the
// selection of the lines that start a rejection, and the formatted list.

import { assertEquals } from "@std/assert";
import {
  formatUnfired,
  parseLcovUncovered,
  rejectionLines,
} from "../scripts/rules_unfired.ts";

Deno.test("parseLcovUncovered returns the zero-count lines of each file", () => {
  const lcov = [
    "TN:",
    "SF:/repo/src/core/validate/expr.ts",
    "FNF:0",
    "DA:10,3",
    "DA:11,0",
    "DA:30,0",
    "LF:3",
    "LH:1",
    "end_of_record",
    "SF:/repo/src/core/validate/report.ts",
    "DA:5,1",
    "end_of_record",
    "SF:/repo/src/core/validate/world.ts",
    "DA:9,0",
    "DA:2,0",
    "end_of_record",
  ].join("\n");
  assertEquals(parseLcovUncovered(lcov), {
    "/repo/src/core/validate/expr.ts": [11, 30],
    "/repo/src/core/validate/report.ts": [],
    "/repo/src/core/validate/world.ts": [2, 9],
  });
});

Deno.test("parseLcovUncovered returns an empty record for empty text", () => {
  assertEquals(parseLcovUncovered(""), {});
});

Deno.test("rejectionLines selects the lines that start a report call", () => {
  const source = [
    "const seen = new Set<string>();", // 1
    "seen.add(name);", // 2
    "this.declared.add(p.id);", // 3
    "if (bad) c.add(AREA.types, path, 'x', span);", // 4
    "this.add(", // 5
    "  AREA.types,", // 6
    ");", // 7
    "this.ctx.report.add(AREA.types, path, 'y', span);", // 8
    "ctx.report.addDepth(at, 3, span);", // 9
    "report.add(", // 10
    "// c.add(AREA.types) in a comment", // 11
    " * this.add(AREA.types) in a doc comment", // 12
    "this.checkedRaw.add(expression);", // 13
  ].join("\n");
  assertEquals(rejectionLines(source), [4, 5, 8, 9, 10]);
});

Deno.test("formatUnfired lists path:line: text sorted, then the count", () => {
  const sources = {
    "src/core/validate/b.ts": "x\n  c.add(AREA.types, p, 'm', s);\nz",
    "src/core/validate/a.ts": "report.add(\n  AREA.types,\n);\nthis.add(",
  };
  const uncovered = {
    "src/core/validate/b.ts": [1, 2],
    "src/core/validate/a.ts": [4, 1, 2],
  };
  assertEquals(formatUnfired(uncovered, sources), [
    "src/core/validate/a.ts:1: report.add(",
    "src/core/validate/a.ts:4: this.add(",
    "src/core/validate/b.ts:2: c.add(AREA.types, p, 'm', s);",
    "3 unfired rejection sites",
  ]);
});
