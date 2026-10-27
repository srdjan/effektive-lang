// Runtime behavior of the `Duration` type (unit ES1b). Each test compiles one
// module with independent validation, type-checks the emitted TypeScript under
// the strict target options, and runs it.

import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

async function compileAndRun(source: string, run: string): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": source },
      ["main.eff"],
      run,
      "effektive-duration-",
    ),
  );
}

const SOURCE = `type Int = int
type Num = number
export const third = (): Duration => 10s / 3
export const negative = (): Duration => (0ms - 7ms) / 2
export const scaled = (n: Int): Duration => n * 1ms
export const sum = (a: Duration, b: Duration): Duration => a + b
export const ratio = (a: Duration, b: Duration): Num => a / b
export const half = (a: Duration): Duration => a / 2
export const limit = (n: Int): Int fails TimeoutError => timeout(() => 1, n * 1ms)
export const hang = (): Int fails TimeoutError =>
  timeout(() => { sleep(5s)
 1 }, 10ms)
export const nap = (n: Int): void => sleep(n * 1ms)
export const metadata: Schedule<Duration> = scheduleMap(
  scheduleSpaced(20ms),
  (meta: ScheduleMetadata<Int, unknown>): Duration => meta.duration
)
export const elapsed: Schedule<Duration> = scheduleMap(
  scheduleSpaced(20ms),
  (meta: ScheduleMetadata<Int, unknown>): Duration => meta.elapsed
)
export const exponential: Schedule<Duration> = scheduleExponential(100ms, 2)
export const stepped: Schedule<Int> = scheduleFromStep(
  (): Int => 0,
  (state: Int, meta: ScheduleInput<unknown>): ScheduleDecision<Int, Int> =>
    if (state < 2) {
      ({ kind: "Continue", state: state + 1, output: state, delay: 5ms })
    } else {
      ({ kind: "Done", output: state })
    }
)
`;

Deno.test("Duration arithmetic runs on milliseconds, truncating a quotient toward zero", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { third, negative, scaled, sum, ratio, half } from "./main.ts";
console.log(JSON.stringify({
  third: third(),
  negative: negative(),
  scaled: scaled(250),
  sum: sum(1500, 500),
  ratio: ratio(10000, 4000),
  half: half(7),
}));
`,
  );
  assertEquals(result, {
    third: 3333,
    negative: -3,
    scaled: 250,
    sum: 2000,
    ratio: 2.5,
    half: 3,
  });
});

Deno.test("timeout and sleep take a Duration made from a count of milliseconds", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Cause, Effect, Exit } from "effect";
import { hang, limit, nap } from "./main.ts";
const start = Date.now();
await Effect.runPromise(nap(60));
const waited = Date.now() - start >= 50;
const flipped = await Effect.runPromise(Effect.flip(hang()));
const defect = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasDies(exit.cause) &&
  Cause.pretty(exit.cause).includes("negative duration");
console.log(JSON.stringify({
  waited,
  limit: await Effect.runPromise(limit(1000)),
  tag: flipped._tag,
  negativeTimeout: defect(await Effect.runPromiseExit(limit(-1))),
  negativeSleep: defect(await Effect.runPromiseExit(nap(-1))),
}));
`,
  );
  assertEquals(result, {
    waited: true,
    limit: 1,
    tag: "TimeoutError",
    negativeTimeout: true,
    negativeSleep: true,
  });
});

Deno.test("scheduleMap sees duration and elapsed as milliseconds", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect, Schedule } from "effect";
import { elapsed, metadata } from "./main.ts";
const first = (schedule: Schedule.Schedule<number>) =>
  Effect.runPromise(Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule);
    const [output] = yield* step(0, undefined);
    return output;
  }));
const duration = await first(metadata);
console.log(JSON.stringify({
  duration,
  durationIsNumber: typeof duration === "number",
  elapsed: typeof (await first(elapsed)) === "number",
}));
`,
  );
  assertEquals(result, {
    duration: 20,
    durationIsNumber: true,
    elapsed: true,
  });
});

Deno.test("scheduleExponential outputs delays as milliseconds and scheduleFromStep reads delay", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect, Schedule } from "effect";
import { exponential, stepped } from "./main.ts";
const outputs = (schedule: Schedule.Schedule<number>, count: number) =>
  Effect.runPromise(Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule);
    const seen: number[] = [];
    for (let i = 0; i < count; i++) {
      const [output] = yield* step(i, undefined);
      seen.push(output);
    }
    return seen;
  }));
console.log(JSON.stringify({
  exponential: await outputs(exponential, 3),
  stepped: await outputs(stepped, 2),
}));
`,
  );
  assertEquals(result, { exponential: [100, 200, 400], stepped: [0, 1] });
});
