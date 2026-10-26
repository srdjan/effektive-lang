import { assert, assertEquals } from "@std/assert";
import { irSnapshot } from "./helpers.ts";

Deno.test("IR, emitted text, source maps, and interface hashes match the examples snapshot", () => {
  const corpus: {
    files: Record<string, string>;
    modules: unknown[];
  }[] = JSON.parse(
    Deno.readTextFileSync(
      new URL("../fixtures/ir/examples-baseline.json", import.meta.url),
    ),
  );
  for (const { files, modules } of corpus) {
    const { revision, modules: actual } = irSnapshot(files);
    assertEquals(actual, modules);
    for (const { name } of actual) {
      const ir = revision.lowered(name);
      assert(ir !== undefined);
      assertEquals(
        [...revision.validate(new Map([[name, ir]])).values()].flat(),
        [],
      );
    }
  }
});
