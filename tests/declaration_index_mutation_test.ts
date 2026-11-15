// Tests that kill mutation survivors of src/core/declaration_index.ts.

import { assert, assertEquals } from "@std/assert";
import { documentSymbols, Program } from "../src/core/frontend.ts";

Deno.test("document symbols mark an arrow on the line after = as a function", () => {
  const text = "type Int = int\nexport const f =\n  (x: Int): Int => x\n";
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(loaded.ok);
  assertEquals(
    documentSymbols(loaded.value, "m.eff", text).map((s) => [s.name, s.kind]),
    [["Int", "type"], ["f", "function"]],
  );
});
