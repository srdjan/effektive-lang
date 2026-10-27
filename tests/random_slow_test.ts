// Runtime behavior of `random()` and `randomInt` (unit SL2). Each test compiles
// one module with independent validation, type-checks the emitted TypeScript
// under the strict target options, and runs it under Random.withSeed.

import { assert, assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

const SOURCE = `type Int = int
type Num = number
export const unit = (): Num => random()
export const roll = (a: Int, b: Int): Int => randomInt(a, b)
`;

async function compileAndRun(run: string): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": SOURCE },
      ["main.eff"],
      run,
      "effektive-random-",
    ),
  );
}

Deno.test("the same seed gives the same random() and randomInt sequence", async () => {
  const result = await compileAndRun(`import { Effect, Random } from "effect";
import { unit, roll } from "./main.ts";
const draw = Effect.gen(function* () {
  const out: number[] = [];
  for (let i = 0; i < 5; i++) out.push(yield* unit(), yield* roll(0, 100));
  return out;
});
const run = (seed: number) => Effect.runPromise(draw.pipe(Random.withSeed(seed)));
const a = await run(42);
const b = await run(42);
const c = await run(43);
console.log(JSON.stringify({ same: JSON.stringify(a) === JSON.stringify(b), other: JSON.stringify(a) !== JSON.stringify(c), a }));
`) as { same: boolean; other: boolean; a: number[] };
  assert(result.same);
  assert(result.other);
  assertEquals(result.a.length, 10);
});

Deno.test("random() lies in [0, 1) and randomInt(0, 3) draws only 0, 1 and 2 as ints", async () => {
  const result = await compileAndRun(`import { Effect, Random } from "effect";
import { unit, roll } from "./main.ts";
const program = Effect.gen(function* () {
  const units: number[] = [];
  const ints: number[] = [];
  for (let i = 0; i < 1000; i++) {
    units.push(yield* unit());
    ints.push(yield* roll(0, 3));
  }
  return { units, ints };
});
const out = await Effect.runPromise(program.pipe(Random.withSeed(7)));
console.log(JSON.stringify({
  unitsOk: out.units.every((u) => u >= 0 && u < 1),
  intsOk: out.ints.every((n) => Number.isInteger(n) && n >= 0 && n < 3),
  seen: [...new Set(out.ints)].sort(),
}));
`) as { unitsOk: boolean; intsOk: boolean; seen: number[] };
  assert(result.unitsOk);
  assert(result.intsOk);
  assertEquals(result.seen, [0, 1, 2]);
});

Deno.test("randomInt with max <= min dies with a RangeError", async () => {
  const result = await compileAndRun(
    `import { Cause, Effect, Exit } from "effect";
import { roll } from "./main.ts";
const outcome = async (a: number, b: number) => {
  const exit = await Effect.runPromiseExit(roll(a, b));
  if (!Exit.isFailure(exit)) return "success";
  const die = exit.cause.reasons.find(Cause.isDieReason);
  return die !== undefined && die.defect instanceof RangeError ? "RangeError" : "other";
};
console.log(JSON.stringify({ equal: await outcome(5, 5), reversed: await outcome(5, 2), ok: await outcome(2, 5) }));
`,
  );
  assertEquals(result, {
    equal: "RangeError",
    reversed: "RangeError",
    ok: "success",
  });
});
