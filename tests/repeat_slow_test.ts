// Runtime behavior of `repeat` (unit ES4). Each test compiles one module with
// independent validation, type-checks the emitted TypeScript under the strict
// target options, and runs it.

import { assertEquals } from "@std/assert";
import { compileAndRun } from "./target_helpers.ts";

const SOURCE = `type Int = int
export error Stop = {}
export service Jobs { next(): Int fails Stop }
export const times = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { times: 2 })
export const whileSmall = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { while: (n) => n < 3 })
export const untilBig = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { until: (n) => n >= 4 })
export const recurring = (): Int fails Stop uses Jobs.next =>
  repeat(() => Jobs.next(), { schedule: scheduleRecurs(3) })
export const piped = (): Int fails Stop uses Jobs.next =>
  (() => Jobs.next()) |> repeat({ times: 1 })
export const forever = (): never fails Stop uses Jobs.next =>
  repeat(() => Jobs.next())
export const limited = (): never fails TimeoutError | Stop uses Jobs.next =>
  timeout(() => repeat(() => Jobs.next()), 50ms)
`;

// The job counts its runs and succeeds with the count, or fails at run \`failAt\`.
const HARNESS = `import { Cause, Effect, Exit, Layer } from "effect";
import * as M from "./main.ts";
const run = async (program: Effect.Effect<unknown, M.Stop | Cause.TimeoutError, M.Jobs>, failAt = 0) => {
  let runs = 0;
  const Live = Layer.succeed(M.Jobs)({
    next: () => Effect.suspend(() => {
      runs++;
      return runs === failAt ? Effect.fail(new M.Stop({})) : Effect.sleep(1).pipe(Effect.as(runs));
    }),
  });
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(Live)));
  const outcome = Exit.isSuccess(exit)
    ? { ok: exit.value }
    : Cause.hasFails(exit.cause)
    ? { failed: Cause.squash(exit.cause) instanceof Cause.TimeoutError ? "timeout" : "stop" }
    : { other: true };
  return { runs, outcome };
};
`;

Deno.test("times: 2 runs the job three times and returns the last value", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
console.log(JSON.stringify({
  times: await run(M.times()),
  piped: await run(M.piped()),
}));
`,
  );
  assertEquals(result, {
    times: { runs: 3, outcome: { ok: 3 } },
    piped: { runs: 2, outcome: { ok: 2 } },
  });
});

Deno.test("while and until stop on a success value", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
console.log(JSON.stringify({
  whileSmall: await run(M.whileSmall()),
  untilBig: await run(M.untilBig()),
}));
`,
  );
  assertEquals(result, {
    // while runs the job again only while the last value is below 3.
    whileSmall: { runs: 3, outcome: { ok: 3 } },
    untilBig: { runs: 4, outcome: { ok: 4 } },
  });
});

Deno.test("a schedule limits the repetitions", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
console.log(JSON.stringify({ recurring: await run(M.recurring()) }));
`,
  );
  assertEquals(result, { recurring: { runs: 4, outcome: { ok: 4 } } });
});

Deno.test("a typed failure stops the repetition and propagates", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
console.log(JSON.stringify({
  times: await run(M.times(), 2),
  forever: await run(M.forever(), 5),
}));
`,
  );
  assertEquals(result, {
    times: { runs: 2, outcome: { failed: "stop" } },
    forever: { runs: 5, outcome: { failed: "stop" } },
  });
});

Deno.test("repeat(job) ends only through timeout, and the job ran more than once", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${HARNESS}
const limited = await run(M.limited());
console.log(JSON.stringify({ tag: limited.outcome, many: limited.runs > 1 }));
`,
  );
  assertEquals(result, { tag: { failed: "timeout" }, many: true });
});
