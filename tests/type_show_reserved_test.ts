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
