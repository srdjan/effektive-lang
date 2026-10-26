import { assert, assertEquals } from "@std/assert";
import { Program, serializeModule } from "../src/core/frontend.ts";
import {
  serializeSourceMap,
  TypeScriptOutputs,
} from "../src/core/typescript.ts";

Deno.test("IR, emitted text, source maps, and interface hashes match the examples snapshot", () => {
  const corpus = JSON.parse(
    Deno.readTextFileSync(
      new URL("../fixtures/ir/examples-baseline.json", import.meta.url),
    ),
  );
  for (const { files, modules } of corpus) {
    const program = new Program();
    const outputs = new TypeScriptOutputs();
    const updated = program.update({ set: files });
    assert(updated.ok);
    assertEquals(updated.value.diagnostics, []);
    for (const expected of modules) {
      const ir = updated.value.lowered(expected.name);
      const emitted = outputs.emitted(updated.value, expected.name);
      const map = outputs.sourceMap(updated.value, expected.name);
      assert(ir?.ok && emitted?.ok && map?.ok);
      const text = serializeModule(ir.value);
      assert(text.ok);
      const withoutCaptures = JSON.parse(
        text.value,
        (key, value: unknown) => key === "generated" ? undefined : value,
      );
      assertEquals(withoutCaptures, expected.ir);
      assertEquals(emitted.value, expected.emitted);
      assertEquals(serializeSourceMap(map.value), expected.map);
      assertEquals(updated.value.interfaceHash(expected.name), expected.hash);
      assertEquals(
        [...updated.value.validate(new Map([[expected.name, ir]])).values()]
          .flat(),
        [],
      );
    }
  }
});
