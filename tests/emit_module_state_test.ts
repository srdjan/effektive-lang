import { assert, assertEquals, assertThrows } from "@std/assert";
import { isInvariantFailure } from "../src/core/source.ts";
import { ModuleState } from "../src/core/emit/module_state.ts";
import type { ModuleIR } from "../src/core/ir.ts";

const ir: ModuleIR = {
  format: "light-functional-ir",
  version: 10,
  module: "main",
  sources: ["main.eff"],
  imports: [],
  declarations: [],
  exports: [],
};

Deno.test("finish gives the effect imports sorted, and an alias that is in use stays readable", () => {
  const scope = ModuleState(ir, { host: new Map() });
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
  assertEquals(ModuleState(ir, { host: new Map() }).finish(), []);
});

Deno.test("an allocation after finish is an internal failure", () => {
  const scope = ModuleState(ir, { host: new Map() });
  scope.finish();
  const streamError = assertThrows(() => scope.effect("Stream"));
  assert(isInvariantFailure(streamError, "emit"));
  assertEquals(
    streamError.message,
    "the name Stream is allocated after the imports are final",
  );
  const functionError = assertThrows(() => scope.intFunction());
  assert(isInvariantFailure(functionError, "emit"));
  assertEquals(
    functionError.message,
    "the name $int is allocated after the imports are final",
  );
  const temporaryError = assertThrows(() => scope.temp());
  assert(isInvariantFailure(temporaryError, "emit"));
  assertEquals(
    temporaryError.message,
    "a temporary is allocated after the imports are final",
  );
});
