import { assertEquals } from "@std/assert";
import { type ModuleIR, serializeModule } from "../src/core/mod.ts";

Deno.test("serializeModule indents nested containers and writes empty ones inline", () => {
  const module: ModuleIR = {
    format: "light-functional-ir",
    version: 10,
    module: "m",
    sources: [],
    imports: [],
    declarations: [],
    exports: [],
  };
  Object.assign(module, {
    extra: { list: [1, undefined], inner: {}, gone: undefined, empty: [] },
  });
  const result = serializeModule(module);
  assertEquals(result, {
    ok: true,
    value: `{
  "declarations": [],
  "exports": [],
  "extra": {
    "empty": [],
    "inner": {},
    "list": [
      1,
      null
    ]
  },
  "format": "light-functional-ir",
  "imports": [],
  "module": "m",
  "sources": [],
  "version": 10
}
`,
  });
});
