// Tests for the text that the emitter writes when the job of retry, repeat, or
// a retry schedule is an effectful expression. The emitter runs the expression
// once, before the builtin, and passes the result to the builtin.

import { assert, assertStringIncludes } from "@std/assert";
import { emitFiles } from "./helpers.ts";

const HEAD = `type Int = int
const make = (): () => Int => { sleep(1ms)
  () => 1 }
const makeP = (): pure () => Int => { sleep(1ms)
  () => 1 }
`;

function emit(text: string): string {
  const emitted = emitFiles({ "effektive.json": "{}", "m.eff": text }, [
    "m.eff",
  ]).get("m");
  assert(emitted !== undefined, "module m was not emitted");
  return emitted.text;
}

Deno.test("an effectful retry job is bound before retry", () => {
  const output = emit(
    HEAD + `export const main = (): Int => retry(make(), { times: 0 })\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: () => Effect.Effect<Int> = yield* make();\n" +
      "    return yield* Effect.retry(Effect.suspend($t0), { times: 0 });",
  );
});

Deno.test("an effectful retry job of a pure function type is lifted once", () => {
  const output = emit(
    HEAD + `export const main = (): Int => retry(makeP(), { times: 0 })\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: () => Int = yield* makeP();\n" +
      "    return yield* Effect.retry(\n" +
      "      Effect.suspend(() => Effect.succeed($t0())),\n" +
      "      { times: 0 },\n" +
      "    );",
  );
});
