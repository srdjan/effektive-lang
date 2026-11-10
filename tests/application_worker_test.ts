import { assert } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertDiagnostics, type Expected } from "./schema_diagnostics.ts";
import { assertValidProject } from "./helpers.ts";

const base = new URL(
  "../fixtures/applications/scheduled-worker/",
  import.meta.url,
);
const files = Object.fromEntries(
  ["effektive.json", "contracts.eff", "worker.eff"].map((
    name,
  ) => [name, Deno.readTextFileSync(new URL(name, base))]),
);
function checked(source = files["worker.eff"]) {
  const result = checkProject(
    memoryHost({ ...files, "worker.eff": source }),
    "",
    ["worker.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

Deno.test("scheduled worker composes retry, repetition and resource lifetimes in source", () => {
  const project = checked();
  assertValidProject(project);
});

Deno.test("scheduled worker contracts reject lost channels", () => {
  // The service headers bound the requirements, so a written `with` clause is
  // an optional checked bound. Each case below changes that written bound.
  const bounded = files["worker.eff"].replace(
    "(input: unknown): Report => {",
    "(input: unknown): Report\n  with Jobs | Clock => {",
  );
  const cases: readonly (readonly [string, string, readonly Expected[]])[] = [
    [
      "lost JobFailure",
      bounded.replace(
        "(input: unknown): Report\n  with Jobs | Clock => {",
        "(input: unknown): Report\n  fails SchemaError | InvalidPolicy\n  with Jobs | Clock => {",
      ),
      [[
        "failure-contract/001",
        "the body can fail with JobFailure, which the `fails` clause does not list",
      ]],
    ],
    [
      "lost Clock.wait",
      bounded.replace(
        "with Jobs | Clock => {",
        "with Jobs => {",
      ),
      [[
        "requirement-contract/001",
        "the body requires Clock.wait, which the `with` clause does not list",
      ]],
    ],
    [
      "wrong result type",
      files["worker.eff"].replace(
        "(input: unknown): Report",
        "(input: unknown): Int",
      ),
      [[
        "type-mismatch/003",
        "the branch has type Report, but Int is expected",
        "{ cycle(policy, 0, None) }",
      ]],
    ],
  ];
  for (const [label, source, expected] of cases) {
    assertDiagnostics(
      source,
      checked(source).diagnostics,
      expected,
      label,
    );
  }
});
