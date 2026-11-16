import { assert, assertEquals } from "@std/assert";
import { forgedModule } from "./helpers.ts";

Deno.test("inherited declaration flags retain exact validator diagnostics", () => {
  assertEquals(
    forgedModule("export type Count = int\n", (ir) => {
      const declaration = ir.declarations[0];
      assert(declaration.kind === "type");
      Object.setPrototypeOf(declaration.definition, {
        sealed: false,
        tagged: false,
      });
    }),
    [
      "validation/002 declarations[0].definition.sealed: sealed must be true and belongs only to a type with identity",
      "validation/002 declarations[0].definition.tagged: tagged must be true and belongs only to a nominal definition over a record",
    ],
  );
});
