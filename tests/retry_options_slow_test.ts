// Runtime behavior of the general `retry` options. Each test compiles one
// module with independent validation, type-checks the emitted TypeScript under the strict
// target options, and runs it. A test clock drives the delays, so the gaps are exact.

import { assertEquals } from "@std/assert";
import { compileAndRun } from "./target_helpers.ts";

const SOURCE = `type Int = int
type Bool = boolean
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Gate { allow(e: Stop): Bool fails Other }
const limited: RetrySchedule<Stop> = retrySchedule((e: Stop, attempt: Int): Option<Duration> =>
  if (attempt < 3) { Some(attempt * 10ms) } else { None })
export const timesWhile = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 2, while: (e) => true })
export const whileFalse = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 5, while: (e) => false })
export const untilGate = (): Int fails Stop | Other uses Jobs.next | Gate.allow =>
  retry(() => Jobs.next(), { until: (e) => Gate.allow(e) })
export const recurring = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: limited })
export const timesOnly = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 2 })
`;

// The host runs a program with a job that fails \`failures\` times, then succeeds.
const HARNESS =
  `import { Cause, Clock, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as M from "./main.ts";
const stamps: number[] = [];
const run = async (
  program: Effect.Effect<number, M.Stop | M.Other, M.Jobs | M.Gate>,
  failures: number,
  gate: (n: number) => boolean = () => false,
) => {
  stamps.length = 0;
  let allowed = 0;
  const Live = Layer.mergeAll(
    Layer.succeed(M.Jobs)({
      next: () => Effect.gen(function* () {
        stamps.push(yield* Clock.currentTimeMillis);
        return stamps.length > failures
          ? stamps.length
          : yield* Effect.fail(new M.Stop({}));
      }),
    }),
    Layer.succeed(M.Gate)({ allow: () => Effect.sync(() => gate(++allowed)) }),
  );
  const exit = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(program.pipe(Effect.provide(Live))));
    for (let step = 0; step < 2000; step++) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust(1);
      if (fiber.pollUnsafe() !== undefined) break;
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())));
  const gaps = stamps.slice(1).map((t, i) => t - (stamps[i] ?? 0));
  return { exit, attempts: stamps.length, gaps, total: stamps.length > 0 ? (stamps[stamps.length - 1] ?? 0) - (stamps[0] ?? 0) : 0 };
};
const outcome = (exit: Exit.Exit<number, unknown>) =>
  Exit.isSuccess(exit) ? { ok: exit.value } : Cause.hasFails(exit.cause) ? { failed: true } : { defect: true };
`;

Deno.test("times and while: while stops retries early and times bounds them", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const bounded = await run(M.timesWhile(), 10);
const stopped = await run(M.whileFalse(), 10);
const recovers = await run(M.timesWhile(), 1);
const plain = await run(M.timesOnly(), 10);
console.log(JSON.stringify({
  bounded: [bounded.attempts, outcome(bounded.exit)],
  stopped: [stopped.attempts, outcome(stopped.exit)],
  recovers: [recovers.attempts, outcome(recovers.exit)],
  plain: [plain.attempts, outcome(plain.exit)],
}));
`,
  );
  assertEquals(result, {
    bounded: [3, { failed: true }],
    stopped: [1, { failed: true }],
    recovers: [2, { ok: 2 }],
    plain: [3, { failed: true }],
  });
});

Deno.test("until with an effectful callback stops when it returns true and adds its failures", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const stops = await run(M.untilGate(), 10, (n) => n >= 3);
const recovers = await run(M.untilGate(), 1);
console.log(JSON.stringify({
  stops: [stops.attempts, outcome(stops.exit)],
  recovers: [recovers.attempts, outcome(recovers.exit)],
}));
`,
  );
  assertEquals(result, {
    stops: [3, { failed: true }],
    // The job succeeds on its second run before the gate ever returns true.
    recovers: [2, { ok: 2 }],
  });
});

Deno.test("a RetrySchedule in schedule limits the retries", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const failing = await run(M.recurring(), 100);
const recovers = await run(M.recurring(), 2);
console.log(JSON.stringify({
  failing: [failing.attempts, failing.gaps, outcome(failing.exit)],
  recovers: [recovers.attempts, recovers.gaps, outcome(recovers.exit)],
}));
`,
  );
  assertEquals(result, {
    failing: [3, [10, 20], { failed: true }],
    recovers: [3, [10, 20], { ok: 3 }],
  });
});

Deno.test("defects are not retried", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
let attempts = 0;
const Live = Layer.mergeAll(
  Layer.succeed(M.Jobs)({ next: () => Effect.suspend(() => { attempts++; return Effect.die("boom"); }) }),
  Layer.succeed(M.Gate)({ allow: () => Effect.succeed(false) }),
);
const exit = await Effect.runPromiseExit(M.timesWhile().pipe(Effect.provide(Live)));
console.log(JSON.stringify({ attempts, outcome: outcome(exit) }));
`,
  );
  assertEquals(result, { attempts: 1, outcome: { defect: true } });
});
