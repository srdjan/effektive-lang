// Runtime behavior of `now()` and the `Instant` type (unit SL1). Each test
// compiles one module with independent validation, type-checks the emitted
// TypeScript under the strict target options, and runs it under TestClock.

import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

async function compileAndRun(source: string, run: string): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": source },
      ["main.eff"],
      run,
      "effektive-instant-",
    ),
  );
}

const SOURCE = `type Int = int
type Flag = boolean
export const stamp = (): Instant => now()
export const since = (start: Instant): Duration => now() - start
export const later = (a: Instant, d: Duration): Instant => a + d
export const earlier = (a: Instant, d: Duration): Instant => a - d
export const gap = (a: Instant, b: Instant): Duration => a - b
export const before = (a: Instant, b: Instant): Flag => a < b
export const seen: Schedule<Instant> = scheduleFromStep(
  (): Int => 0,
  (state: Int, meta: ScheduleInput<unknown>): ScheduleDecision<Int, Instant> =>
    if (state < 2) {
      ({ kind: "Continue", state: state + 1, output: meta.now, delay: 5ms })
    } else {
      ({ kind: "Done", output: meta.now })
    }
)
`;

Deno.test("now() reads the virtual clock after TestClock.adjust", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { stamp, since } from "./main.ts";
const program = Effect.gen(function* () {
  const first = yield* stamp();
  yield* TestClock.adjust(2500);
  const second = yield* stamp();
  const elapsed = yield* since(first);
  return { first, second, elapsed };
});
const out = await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, { first: 0, second: 2500, elapsed: 2500 });
});

Deno.test("Instant arithmetic and comparison run on milliseconds", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { later, earlier, gap, before } from "./main.ts";
console.log(JSON.stringify({
  later: later(1000, 500),
  earlier: earlier(1000, 500),
  gap: gap(1000, 400),
  before: [before(1, 2), before(2, 1)],
}));
`,
  );
  assertEquals(result, {
    later: 1500,
    earlier: 500,
    gap: 600,
    before: [true, false],
  });
});

Deno.test("a schedule step reads meta.now as an Instant under TestClock", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect, Option, Schedule } from "effect";
import { seen } from "./main.ts";
const program = Effect.gen(function* () {
  const step = yield* Schedule.toStep(seen);
  const [first] = yield* step(1000, Option.none());
  return { first };
});
const out = await Effect.runPromise(program);
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, { first: 1000 });
});
