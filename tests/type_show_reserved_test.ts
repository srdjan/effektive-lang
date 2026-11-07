import { assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

Deno.test("a diagnostic prints a reserved failure by its short name", () => {
  const project = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": [
        "type N = int",
        "const takes = (f: (x: N) => N): N => f(1)",
        "const bad = (): N => takes((x: N): N fails SchemaError => x)",
      ].join("\n"),
    }),
    "",
    ["m.eff"],
  );
  if (!project.ok) throw new Error(JSON.stringify(project.error));
  assertEquals(project.value.diagnostics.map((d) => d.message), [
    "argument 1 has type (N) => N fails SchemaError, but (N) => N is expected",
  ]);
});

Deno.test("a diagnostic prints a reserved error type by its short name", () => {
  const project = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": [
        "type N = int",
        "const f = (e: SchemaIssue): N => 1",
        "const g = (): N => f(1)",
      ].join("\n"),
    }),
    "",
    ["m.eff"],
  );
  if (!project.ok) throw new Error(JSON.stringify(project.error));
  assertEquals(project.value.diagnostics.map((d) => d.message), [
    "argument 1 has type int, but SchemaIssue is expected",
  ]);
});

Deno.test("a diagnostic prints a reserved capability by its short name", () => {
  const project = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": [
        "type Int = int",
        "const take = (n: Int): Int => n",
        "const bad = (): Int => take(defer(() => forkScoped(defer(() => 1))))",
      ].join("\n"),
    }),
    "",
    ["m.eff"],
  );
  if (!project.ok) throw new Error(JSON.stringify(project.error));
  assertEquals(project.value.diagnostics.map((d) => d.message), [
    "argument 1 has type Effect<void, never, Scope>, but Int is expected",
  ]);
});
