import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";

Deno.test("a file with 130000 parse errors returns its diagnostics", () => {
  const result = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "broken.eff": "@ ".repeat(130000),
    }),
    "",
    ["broken.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.diagnostics.length, 130000);
});
