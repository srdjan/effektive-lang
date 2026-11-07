// Tests that kill mutation survivors of the project driver (check_project.ts).
// Each test gives a program or a forged analysis and requires the exact
// diagnostics or module names that the driver reports.

import { assertEquals } from "@std/assert";
import { type Analysis, analyzeProject } from "../src/core/analyze.ts";
import { checkAnalysis } from "../src/core/check_project.ts";
import { checkProject, memoryHost } from "../src/core/mod.ts";

function messagesOf(files: Record<string, string>): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    Object.keys(files),
  );
  if (!checked.ok) throw new Error(JSON.stringify(checked.error));
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

function analysisOf(files: Record<string, string>): Analysis {
  const analyzed = analyzeProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    Object.keys(files),
  );
  if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.error));
  return analyzed.value;
}

const TWO_MODULES = {
  "a.eff": "const one = 1\n",
  "b.eff": "const two = 2\n",
};

Deno.test("a recursive function without a result annotation has an error type for its callers", () => {
  // Fault: `moduleValues.publish` records the inferred result of a recursive
  // function (`||` for `&&`). The caller `g` then sees `string` and reports a
  // mismatch that the recursion diagnostic already covers.
  assertEquals(
    messagesOf({
      "m.eff": `type Int = int
const countdown = (n: Int) => {
  const rest = countdown(n - 1)
  "done"
}
const g = (): Int => countdown(1)
`,
    }),
    [
      "execution-mode/003 `countdown` is recursive, so it needs explicit parameter and result annotations",
    ],
  );
});

Deno.test("the driver skips a module that has no resolution", () => {
  // Fault: `driveProject` guards with `&&` for `||`, so a module without a
  // resolution reaches the module step and throws.
  const analysis = analysisOf(TWO_MODULES);
  const forged: Analysis = {
    ...analysis,
    resolutions: new Map(
      [...analysis.resolutions].filter(([name]) => name !== "b"),
    ),
  };
  assertEquals([...checkAnalysis(forged).modules.keys()], ["a"]);
});

Deno.test("the driver skips a module that has no module record", () => {
  // Fault: the same `&&` for `||` guard. A resolution without a module record
  // reaches the module step and throws.
  const analysis = analysisOf(TWO_MODULES);
  const forged: Analysis = {
    ...analysis,
    project: {
      ...analysis.project,
      modules: new Map(
        [...analysis.project.modules].filter(([name]) => name !== "b"),
      ),
    },
  };
  assertEquals([...checkAnalysis(forged).modules.keys()], ["a"]);
});
