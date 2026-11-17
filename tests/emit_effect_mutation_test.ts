// Tests that kill older mutation survivors of the effect emitter.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { emitModule } from "../src/core/typescript.ts";
import { allExprs, emittedText, loweredModule } from "./helpers.ts";

const NO_CONFIG = { config: { host: new Map() } };

Deno.test("repeat without options runs forever and repeat with options repeats", () => {
  const text = emittedText(`type Int = int
export service Jobs { next(): Int }
export const times = (): Int with Jobs.next =>
  repeat(() => Jobs.next(), { times: 2 })
export const forever = (): never with Jobs.next =>
  repeat(() => Jobs.next())
`);
  assertStringIncludes(
    text,
    `export const times = (): Effect.Effect<Int, never, Jobs> =>
  Effect.repeat(Effect.suspend(() => Jobs.use(($s) => $s.next())), {
    times: 2,
  });`,
  );
  assertStringIncludes(
    text,
    `export const forever = (): Effect.Effect<never, never, Jobs> =>
  Effect.forever(Effect.suspend(() => Jobs.use(($s) => $s.next())));`,
  );
});

Deno.test("defer rejects a job whose type is not a function type", () => {
  const ir = loweredModule(`type Int = int
export const a = (): Effect<Int> => defer(() => 1)
`);
  const [defer] = allExprs(ir, "defer");
  Object.assign(defer.job, { type: { kind: "primitive", name: "int" } });

  assertEquals(emitModule(ir, NO_CONFIG), {
    ok: false,
    error: {
      tag: "internal",
      module: "m",
      message: "a closure node has a type that is not a function type",
    },
  });
});
