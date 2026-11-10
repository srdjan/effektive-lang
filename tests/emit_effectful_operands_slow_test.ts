// Slow test for an effectful operand of retry, repeat, and retrySchedule. The
// factory call that writes the job or the step runs once. The job then runs on
// each attempt. A factory that the source binds first gives the same counts.

import { assertEquals } from "@std/assert";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "../src/cli/tsc.ts";
import { deno, runScript } from "./process_helpers.ts";

const CLI = new URL("../src/cli/main.ts", import.meta.url).pathname;

const PROGRAM = `type Int = int
error E = { code: Int }

const makeJob = (factoryRuns: Ref<Int>, jobRuns: Ref<Int>): () => Int fails E => {
  updateRef(factoryRuns, (n) => n + 1)
  () => {
    updateRef(jobRuns, (n) => n + 1)
    const seen = getRef(jobRuns)
    if (seen < 3) { fail(E({ code: seen })) } else { seen }
  }
}
const makeTick = (factoryRuns: Ref<Int>, jobRuns: Ref<Int>): () => Int => {
  updateRef(factoryRuns, (n) => n + 1)
  () => {
    updateRef(jobRuns, (n) => n + 1)
    getRef(jobRuns)
  }
}

const makeStep = (stepRuns: Ref<Int>): pure (error: E, attempt: Int) => Option<Duration> => {
  updateRef(stepRuns, (n) => n + 1)
  (error: E, attempt: Int) => if (attempt <= 2) { Some(0ms) } else { None }
}
const stepUpTo = (limit: Int): pure (error: E, attempt: Int) => Option<Duration> =>
  (error: E, attempt: Int) => if (attempt <= limit) { Some(0ms) } else { None }

export const retryFactory = (): [Int, Int] fails E => {
  const factoryRuns = makeRef(0)
  const jobRuns = makeRef(0)
  retry(makeJob(factoryRuns, jobRuns), { times: 2 })
  [getRef(factoryRuns), getRef(jobRuns)]
}
export const retryBound = (): [Int, Int] fails E => {
  const factoryRuns = makeRef(0)
  const jobRuns = makeRef(0)
  const job = makeJob(factoryRuns, jobRuns)
  retry(job, { times: 2 })
  [getRef(factoryRuns), getRef(jobRuns)]
}
const failTwice = (jobRuns: Ref<Int>): () => Int fails E => () => {
  updateRef(jobRuns, (n) => n + 1)
  const seen = getRef(jobRuns)
  if (seen < 3) { fail(E({ code: seen })) } else { seen }
}

export const scheduleFactory = (): [Int, Int] fails E => {
  const stepRuns = makeRef(0)
  const jobRuns = makeRef(0)
  retry(failTwice(jobRuns), { schedule: retrySchedule(makeStep(stepRuns)) })
  [getRef(stepRuns), getRef(jobRuns)]
}
export const scheduleBound = (): [Int, Int] fails E => {
  const stepRuns = makeRef(0)
  const jobRuns = makeRef(0)
  const step = makeStep(stepRuns)
  retry(failTwice(jobRuns), { schedule: retrySchedule(step) })
  [getRef(stepRuns), getRef(jobRuns)]
}
export const scheduleComputed = (): Int fails E => {
  const jobRuns = makeRef(0)
  retry(failTwice(jobRuns), { schedule: retrySchedule(stepUpTo(2)) })
  getRef(jobRuns)
}
export const repeatFactory = (): [Int, Int] => {
  const factoryRuns = makeRef(0)
  const jobRuns = makeRef(0)
  repeat(makeTick(factoryRuns, jobRuns), { times: 2 })
  [getRef(factoryRuns), getRef(jobRuns)]
}
export const repeatBound = (): [Int, Int] => {
  const factoryRuns = makeRef(0)
  const jobRuns = makeRef(0)
  const job = makeTick(factoryRuns, jobRuns)
  repeat(job, { times: 2 })
  [getRef(factoryRuns), getRef(jobRuns)]
}
`;

const SCRIPT = `
import { Effect } from "effect";
import {
  repeatBound,
  repeatFactory,
  retryBound,
  retryFactory,
  scheduleBound,
  scheduleComputed,
  scheduleFactory,
} from "./m.ts";

console.log(JSON.stringify({
  retryFactory: await Effect.runPromise(retryFactory()),
  retryBound: await Effect.runPromise(retryBound()),
  repeatFactory: await Effect.runPromise(repeatFactory()),
  repeatBound: await Effect.runPromise(repeatBound()),
  scheduleFactory: await Effect.runPromise(scheduleFactory()),
  scheduleBound: await Effect.runPromise(scheduleBound()),
  scheduleComputed: await Effect.runPromise(scheduleComputed()),
}));
`;

Deno.test("an effectful job operand of retry and repeat, and a step factory of retrySchedule, run once", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-operands-" });
  try {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/m.eff`, PROGRAM);
    const build = await deno(dir, [
      "run",
      "-q",
      "--no-lock",
      "--allow-read",
      "--allow-write",
      "--allow-run=deno",
      CLI,
      "build",
      dir,
      "--tsc",
    ]);
    assertEquals(
      build.code,
      0,
      `build failed:\n${build.stdout}\n${build.stderr}`,
    );
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify({
        compilerOptions: TARGET_COMPILER_OPTIONS,
        imports: TARGET_IMPORTS,
      }),
    );
    const result = await runScript(dir, SCRIPT);
    // Each pair is [factory runs, job runs]. A pure step factory cannot count its
    // runs, so scheduleComputed gives only the job runs.
    assertEquals(result, {
      retryFactory: [1, 3],
      retryBound: [1, 3],
      repeatFactory: [1, 3],
      repeatBound: [1, 3],
      scheduleFactory: [1, 3],
      scheduleBound: [1, 3],
      scheduleComputed: 3,
    });
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
