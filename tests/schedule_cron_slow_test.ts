// `scheduleCron` (unit EL3): the differential test of src/core/cron.ts against
// `Cron.parse` of effect@4.0.5, and the runtime behavior of the emitted
// schedule under TestClock. No wall-clock time passes in the runtime tests.

import { assert, assertEquals } from "@std/assert";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "../src/cli/tsc.ts";
import {
  checkProject,
  emitProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";
import { EXPRESSIONS, ZONES } from "./cron_cases.ts";
import { runScript, withTemporaryDirectory } from "./process_helpers.ts";
import { runStrictTarget } from "./target_helpers.ts";

Deno.test("Cron.parse gives the literal verdict of each expression and zone", async () => {
  const script = `
import { Cron, Result } from "effect";
const expressions: string[] = ${
    JSON.stringify(EXPRESSIONS.map((c) => c.input))
  };
const zones: string[] = ${JSON.stringify(ZONES.map((c) => c.input))};
console.log(JSON.stringify({
  expressions: expressions.map((e) => Result.isSuccess(Cron.parse(e, "UTC"))),
  zones: zones.map((z) => Result.isSuccess(Cron.parse("* * * * *", z))),
}));
`;
  const effect = await withTemporaryDirectory("effektive-cron-", (dir) => {
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify({
        imports: TARGET_IMPORTS,
        compilerOptions: TARGET_COMPILER_OPTIONS,
      }),
    );
    return runScript(dir, script);
  }) as { expressions: boolean[]; zones: boolean[] };
  EXPRESSIONS.forEach(({ input, valid }, index) =>
    assertEquals(effect.expressions[index], valid, JSON.stringify(input))
  );
  ZONES.forEach(({ input, valid }, index) =>
    assertEquals(effect.zones[index], valid, JSON.stringify(input))
  );
});

async function compileAndRun(source: string, run: string): Promise<unknown> {
  const project = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": source }),
    "",
    ["main.eff"],
  );
  assert(project.ok, JSON.stringify(project));
  assertEquals(project.value.diagnostics, []);
  const lowered = lowerProject(project.value);
  for (const result of lowered.values()) {
    assert(result.ok, JSON.stringify(result));
  }
  for (
    const diagnostics of validateProject(
      project.value.analysis.project,
      lowered,
    ).values()
  ) assertEquals(diagnostics, []);
  return JSON.parse(
    await runStrictTarget(
      emitProject(lowered, { config: project.value.analysis.project.config }),
      run,
      "effektive-cron-",
    ),
  );
}

const SOURCE = `type Int = int
export error Stop = {}
export service Jobs { next(): Int fails Stop }
export const everyFive = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { schedule: scheduleMax(scheduleCron("*/5 * * * * *"), scheduleRecurs(3)) })
export const dailyUtc = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { schedule: scheduleMax(scheduleCron("0 4 * * *"), scheduleRecurs(1)) })
export const dailyZoned = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { schedule: scheduleMax(scheduleCron("0 4 * * *", "+03:00"), scheduleRecurs(1)) })
export const retried = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleMax(scheduleCron("*/5 * * * * *"), scheduleRecurs(5)) })
export const plain = (): Schedule<Duration> => scheduleCron("*/5 * * * * *")
`;

// The job records the virtual time of each run and fails the first `failures` runs.
const HARNESS = `import { Clock, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as M from "./main.ts";
const drive = (program: Effect.Effect<number, M.Stop, M.Jobs>, failures: number, advance: number) =>
  Effect.gen(function* () {
    const stamps: number[] = [];
    const Live = Layer.succeed(M.Jobs)({
      next: () => Effect.gen(function* () {
        stamps.push(yield* Clock.currentTimeMillis);
        return stamps.length > failures ? stamps.length : yield* Effect.fail(new M.Stop({}));
      }),
    });
    const fiber = yield* program.pipe(Effect.provide(Live), Effect.forkChild);
    yield* TestClock.adjust(advance);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    return { stamps, ok: Exit.isSuccess(exit) };
  });
const go = <A>(effect: Effect.Effect<A, never, any>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer()), Effect.timeout("10 seconds")) as Effect.Effect<A>);
`;

Deno.test("repeat with scheduleCron runs at each matching virtual time and scheduleMax stops it", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const everyFive = await go(drive(M.everyFive(), 0, 60000));
const utc = await go(drive(M.dailyUtc(), 0, 3 * 86400000));
const zoned = await go(drive(M.dailyZoned(), 0, 3 * 86400000));
console.log(JSON.stringify({ everyFive, utc, zoned }));
`,
  );
  assertEquals(result, {
    // The job runs at once, then three times at the next multiples of 5 seconds.
    everyFive: { stamps: [0, 5000, 10000, 15000], ok: true },
    // The clock starts at 1970-01-01T00:00:00Z. 04:00 UTC is 4 hours later.
    utc: { stamps: [0, 4 * 3600000], ok: true },
    // 04:00 at +03:00 is 01:00 UTC, one hour after the start.
    zoned: { stamps: [0, 3600000], ok: true },
  });
});

Deno.test("retry with scheduleCron waits until the next match", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const retried = await go(drive(M.retried(), 2, 60000));
const early = await go(drive(M.retried(), 2, 4999));
console.log(JSON.stringify({ retried, early }));
`,
  );
  assertEquals(result, {
    retried: { stamps: [0, 5000, 10000], ok: true },
    early: { stamps: [0], ok: false },
  });
});

Deno.test("the schedule outputs the delay in milliseconds", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Duration, Effect, Option, Schedule } from "effect";
import * as M from "./main.ts";
const step = await Effect.runPromise(Schedule.toStep(M.plain()));
const [output, delay] = await Effect.runPromise(step(3250, undefined));
console.log(JSON.stringify({ output, delay: Duration.toMillis(delay) }));
`,
  );
  assertEquals(result, { output: 1750, delay: 1750 });
});
