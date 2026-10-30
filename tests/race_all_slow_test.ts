// Runtime behavior of `race(jobs)` over an array (unit ES10). Each test compiles
// one module with independent validation, type-checks the emitted TypeScript
// under the strict target options, and runs it.

import { assertEquals } from "@std/assert";
import { compileAndRun } from "./target_helpers.ts";

const SOURCE = `type Int = int
type Name = string
export error Boom = {}
export service Log { seen(name: Name): void }
const slow = (): Int uses Log.seen => {
  try { sleep(200ms)
 3 } finally { Log.seen("slow-closed") }
}
const medium = (): Int uses Log.seen => {
  try { sleep(100ms)
 2 } finally { Log.seen("medium-closed") }
}
const fast = (): Int => { sleep(10ms)
 1 }
export const firstWins = (): Int uses Log.seen =>
  run(race([defer(() => slow()), defer(() => medium()), defer(() => fast())]))
export const failSlow = (): Int fails Boom => { sleep(30ms)
 fail(Boom({})) }
export const failFast = (): Int fails Boom => { sleep(5ms)
 fail(Boom({})) }
export const allFail = (): Int fails Boom =>
  run(race([defer(() => failSlow()), defer(() => failFast())]))
const none = (): Effect<Int, never, never>[] => []
export const noJobs = (): Int => run(race(none()))
`;

const PRELUDE = `import { Effect, Layer } from "effect";
import { Log, firstWins, allFail, noJobs } from "./main.ts";
const events: string[] = [];
const Live = Layer.succeed(Log)({
  seen: (name) => Effect.sync(() => { events.push(name); }),
});
`;

Deno.test("race over an array returns the first success and completes the loser finalizers", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const winner = await Effect.runPromise(firstWins().pipe(Effect.provide(Live)));
console.log(JSON.stringify({ winner, events: [...events].sort() }));
`,
  );
  assertEquals(result, {
    winner: 1,
    events: ["medium-closed", "slow-closed"],
  });
});

Deno.test("race over an array fails with a job failure when every job fails", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const failure = await Effect.runPromise(Effect.flip(allFail()));
console.log(JSON.stringify({ tag: failure._tag }));
`,
  );
  const { tag } = result as { tag: string };
  assertEquals(tag, "main#Boom");
});

Deno.test("race over an empty array is a RangeError defect", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const exit = await Effect.runPromiseExit(noJobs());
const cause = exit._tag === "Failure" ? exit.cause : undefined;
const defect = cause?.reasons.find((r) => r._tag === "Die");
console.log(JSON.stringify({
  tag: exit._tag,
  range: defect?.defect instanceof RangeError,
}));
`,
  );
  assertEquals(result, { tag: "Failure", range: true });
});
