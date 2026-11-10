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

const SERVICE = `service Clock { now(): Int }
const live = layer(Clock, () => ({ now: () => 1 }))
const makeLayer = (): Layer<Clock> => { sleep(1ms)
  layer(Clock, () => ({ now: () => 1 })) }
const makeJob = (): () => Int with Clock.now => { sleep(1ms)
  () => Clock.now() }
`;

const SCHEDULE = `error E = { code: Int }
const stepNone = (error: E, attempt: Int): Option<Duration> => None
const makeStep = (n: Int): pure (error: E, attempt: Int) => Option<Duration> =>
  (error: E, attempt: Int) => None
const makeStepE = (): pure (error: E, attempt: Int) => Option<Duration> => { sleep(1ms)
  (error: E, attempt: Int) => None }
`;

Deno.test("an effectful timeout job is bound before timeout", () => {
  const output = emit(
    HEAD +
      `export const main = (): Int fails TimeoutError => timeout(make(), 1s)\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: () => Effect.Effect<Int> = yield* make();\n" +
      '    return yield* Effect.suspend(() => { const $t1: number = 1000; if ($t1 < 0) throw new RangeError("negative duration"); return Effect.timeout(\n' +
      "      Effect.suspend($t0),\n" +
      "      $t1,\n" +
      "    ); });",
  );
});

Deno.test("an effectful uninterruptible job is bound before uninterruptible", () => {
  const output = emit(
    HEAD + `export const main = (): Int => uninterruptible(make())\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: () => Effect.Effect<Int> = yield* make();\n" +
      "    return yield* Effect.uninterruptible(Effect.suspend($t0));",
  );
});

Deno.test("an effectful provide layer and job are bound in source order", () => {
  const output = emit(
    HEAD + SERVICE +
      `export const main = (): Int => provide(makeLayer(), makeJob())\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: Layer.Layer<Clock> = yield* makeLayer();\n" +
      "    const $t1: () => Effect.Effect<Int, never, Clock> = yield* makeJob();\n" +
      "    return yield* Effect.provide(Effect.suspend($t1), $t0);",
  );
});

Deno.test("an effectful provide layer is bound before provide", () => {
  const output = emit(
    HEAD + SERVICE +
      `export const main = (): Int => provide(makeLayer(), () => Clock.now())\n`,
  );
  assertStringIncludes(
    output,
    "const $t0: Layer.Layer<Clock> = yield* makeLayer();\n" +
      "    return yield* Effect.provide(",
  );
});

Deno.test("an effectful retrySchedule step is bound once outside the schedule", () => {
  const output = emit(
    HEAD + SCHEDULE +
      `export const main = (): RetrySchedule<E> => retrySchedule(makeStepE())\n`,
  );
  assertStringIncludes(
    output,
    "    return (($t0) => Schedule.fromStepWithMetadata<E, number, never, never, never, never>(Effect.succeed(($t1: Schedule.InputMetadata<E>) => { const $t2 = $t0($t1.input, $t1.attempt);",
  );
  assertStringIncludes(output, "(yield* makeStepE());");
});

Deno.test("a computed pure retrySchedule step is bound once outside the schedule", () => {
  const output = emit(
    HEAD + SCHEDULE +
      `export const main = (n: Int): RetrySchedule<E> => retrySchedule(makeStep(n))\n`,
  );
  assertStringIncludes(
    output,
    "(($t0) => Schedule.fromStepWithMetadata<E, number, never, never, never, never>(Effect.succeed(($t1: Schedule.InputMetadata<E>) => { const $t2 = $t0($t1.input, $t1.attempt);",
  );
  assertStringIncludes(output, "(makeStep(\n    n,\n  ));");
});

Deno.test("a named retrySchedule step stays inline", () => {
  const output = emit(
    HEAD + SCHEDULE +
      `export const main = (): RetrySchedule<E> => retrySchedule(stepNone)\n`,
  );
  assertStringIncludes(
    output,
    "  Schedule.fromStepWithMetadata<E, number, never, never, never, never>(Effect.succeed(($t0: Schedule.InputMetadata<E>) => { const $t1 = stepNone($t0.input, $t0.attempt);",
  );
});
