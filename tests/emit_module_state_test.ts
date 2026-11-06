import { assertEquals, assertThrows } from "@std/assert";
import { EmitFailure } from "../src/core/emit/failure.ts";
import { ModuleState } from "../src/core/emit/module_state.ts";
import type { ModuleIR } from "../src/core/ir.ts";

const ir: ModuleIR = {
  format: "light-functional-ir",
  version: 8,
  module: "main",
  sources: ["main.eff"],
  imports: [],
  declarations: [],
  exports: [],
};

Deno.test("finish gives the effect imports sorted, and an alias that is in use stays readable", () => {
  const scope = new ModuleState(ir, { host: new Map() });
  assertEquals(scope.effect("Schema"), "Schema");
  assertEquals(scope.effect("Effect"), "Effect");
  assertEquals(scope.finish(), [{
    specifier: "effect",
    names: [
      { exported: "Effect", local: "Effect", typeOnly: false },
      { exported: "Schema", local: "Schema", typeOnly: false },
    ],
  }]);
  assertEquals(scope.effect("Effect"), "Effect");
});

Deno.test("a module without allocation finishes with no import", () => {
  assertEquals(new ModuleState(ir, { host: new Map() }).finish(), []);
});

Deno.test("an allocation after finish is an internal failure", () => {
  const scope = new ModuleState(ir, { host: new Map() });
  scope.finish();
  assertThrows(
    () => scope.effect("Stream"),
    EmitFailure,
    "the name Stream is allocated after the imports are final",
  );
  assertThrows(
    () => scope.intFunction(),
    EmitFailure,
    "the name $int is allocated after the imports are final",
  );
  assertThrows(
    () => scope.temp(),
    EmitFailure,
    "a temporary is allocated after the imports are final",
  );
});
