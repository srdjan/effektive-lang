// Tests for the text that the emitter writes when a computed pure callback
// fills a slot of an effect function type. The wrapper must not hold the
// computation: the source expression runs once, where the source writes it.

import { assert, assertStringIncludes } from "@std/assert";
import { emitFiles } from "./helpers.ts";

const HEAD = `type Int = int
const one = (): Int => 1
const make = (x: Int): pure () => Int => {
  const y = x + 1
  () => y
}
`;

function emit(text: string): string {
  const emitted = emitFiles({ "effektive.json": "{}", "m.eff": text }, [
    "m.eff",
  ]).get("m");
  assert(emitted !== undefined, "module m was not emitted");
  return emitted.text;
}

Deno.test("a computed pure callback in a function result is bound once", () => {
  const output = emit(
    HEAD + `export const main = (x: Int): () => Int => make(x)\n`,
  );
  assertStringIncludes(
    output,
    "export const main = (x: Int): () => Effect.Effect<Int> =>\n" +
      "  (($t0) => () => Effect.succeed($t0()))(make(x));",
  );
});

Deno.test("a computed pure callback in defer is bound once", () => {
  const output = emit(
    HEAD + `export const main = (x: Int): Effect<Int> => defer(make(x))\n`,
  );
  assertStringIncludes(
    output,
    "Effect.suspend((($t0) => () => Effect.succeed($t0()))(make(x)))",
  );
});

Deno.test("a named pure function in a function result is not bound", () => {
  const output = emit(
    HEAD + `export const main = (): () => Int => one\n`,
  );
  assertStringIncludes(
    output,
    "export const main = (): () => Effect.Effect<Int> => () => Effect.succeed(one());",
  );
});

Deno.test("named pure functions in the branches of a pure if are wrapped, not bound", () => {
  const output = emit(
    HEAD +
      `const two = (): Int => 2
export const main = (x: Int): () => Int => if (x + 1 > 0) { one } else { two }\n`,
  );
  assertStringIncludes(
    output,
    "? (() => Effect.succeed(one()))\n    : (() => Effect.succeed(two()));",
  );
});
