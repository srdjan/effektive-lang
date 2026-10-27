// Runtime behavior of the general `retry` options, `scheduleExponential`, and
// `scheduleJittered` (unit ES3). Each test compiles one module with
// independent validation, type-checks the emitted TypeScript under the strict
// target options, and runs it. Delays use real small times with tolerant bounds.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  emitProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";
import { runStrictTarget } from "./target_helpers.ts";

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
      "effektive-retry-options-",
    ),
  );
}

const SOURCE = `type Int = int
type Bool = boolean
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Gate { allow(e: Stop): Bool fails Other }
export const timesWhile = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 2, while: (e) => true })
export const whileFalse = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 5, while: (e) => false })
export const untilGate = (): Int fails Stop | Other uses Jobs.next | Gate.allow =>
  retry(() => Jobs.next(), { until: (e) => Gate.allow(e) })
export const recurring = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleRecurs(3) })
export const timesOnly = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { times: 2 })
export const exponential = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleMax(scheduleExponential(30ms), scheduleRecurs(3)) })
export const factored = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleMax(scheduleExponential(10ms, 3), scheduleRecurs(3)) })
export const minimum = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleMin(scheduleExponential(10ms), scheduleRecurs(2)) })
export const maximum = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleMax(scheduleExponential(100ms), scheduleRecurs(2)) })
export const jittered = (): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleJittered(scheduleMax(scheduleExponential(20ms), scheduleRecurs(2))) })
export const backoff = (ms: Int): Int fails Stop uses Jobs.next =>
  retry(() => Jobs.next(), { schedule: scheduleExponential(ms * 1ms) })
`;

// The host runs a program with a job that fails \`failures\` times, then succeeds.
const HARNESS = `import { Cause, Effect, Exit, Layer } from "effect";
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
      next: () => Effect.suspend(() => {
        stamps.push(Date.now());
        return stamps.length > failures
          ? Effect.succeed(stamps.length)
          : Effect.fail(new M.Stop({}));
      }),
    }),
    Layer.succeed(M.Gate)({ allow: () => Effect.sync(() => gate(++allowed)) }),
  );
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(Live)));
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

Deno.test("a general Schedule in schedule limits the retries", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const failing = await run(M.recurring(), 100);
const recovers = await run(M.recurring(), 2);
console.log(JSON.stringify({
  failing: [failing.attempts, outcome(failing.exit)],
  recovers: [recovers.attempts, outcome(recovers.exit)],
}));
`,
  );
  assertEquals(result, {
    failing: [4, { failed: true }],
    recovers: [3, { ok: 3 }],
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

Deno.test("scheduleExponential delays grow by the factor", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const doubling = await run(M.exponential(), 100);
const tripling = await run(M.factored(), 100);
console.log(JSON.stringify({ doubling: [doubling.attempts, doubling.gaps], tripling: [tripling.attempts, tripling.gaps] }));
`,
  ) as {
    doubling: [number, number[]];
    tripling: [number, number[]];
  };
  assertEquals(result.doubling[0], 4);
  assertEquals(result.tripling[0], 4);
  // Timers never fire early; the upper bound is loose for a loaded machine.
  const near = (gaps: number[], expected: number[]) =>
    gaps.every((g, i) => g >= expected[i] - 2 && g < expected[i] + 80);
  assert(near(result.doubling[1], [30, 60, 120]), `${result.doubling[1]}`);
  assert(near(result.tripling[1], [10, 30, 90]), `${result.tripling[1]}`);
});

Deno.test("scheduleMax limits an exponential schedule by count and scheduleMin does not", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const max = await run(M.maximum(), 100);
const min = await run(M.minimum(), 4);
console.log(JSON.stringify({
  max: [max.attempts, max.total, outcome(max.exit)],
  min: [min.attempts, min.gaps, outcome(min.exit)],
}));
`,
  ) as {
    max: [number, number, unknown];
    min: [number, number[], unknown];
  };
  // The max stops after two retries and keeps the 100 ms and 200 ms backoff.
  assertEquals(result.max[0], 3);
  assertEquals(result.max[2], { failed: true });
  assert(result.max[1] >= 295, `max total ${result.max[1]}`);
  // The min recurs while any schedule recurs, so the exponential schedule keeps
  // it going after the count ends. While the count lasts, the zero delay of
  // scheduleRecurs wins, so the first two gaps have no backoff.
  assertEquals(result.min[0], 5);
  assertEquals(result.min[2], { ok: 5 });
  assert(result.min[1][0] < 9 && result.min[1][1] < 9, `${result.min[1]}`);
  assert(result.min[1][2] >= 35, `${result.min[1]}`);
});

Deno.test("scheduleJittered compiles, runs, and keeps the retry limit", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const jittered = await run(M.jittered(), 100);
console.log(JSON.stringify({ attempts: jittered.attempts, gaps: jittered.gaps }));
`,
  ) as { attempts: number; gaps: number[] };
  assertEquals(result.attempts, 3);
  // Jitter scales each delay (20 ms and 40 ms) by a factor in [0.8, 1.2).
  assert(result.gaps[0] >= 14 && result.gaps[0] < 100, `${result.gaps}`);
  assert(result.gaps[1] >= 28 && result.gaps[1] < 150, `${result.gaps}`);
});

Deno.test("a negative exponential base is a defect", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const negative = await run(M.backoff(-1), 100);
const exit = negative.exit;
console.log(JSON.stringify({
  attempts: negative.attempts,
  defect: Exit.isFailure(exit) && Cause.hasDies(exit.cause) && Cause.pretty(exit.cause).includes("negative duration"),
}));
`,
  );
  assertEquals(result, { attempts: 1, defect: true });
});
