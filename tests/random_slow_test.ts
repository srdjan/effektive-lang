// Runtime behavior of `random()` and `randomInt` (unit SL2). Each test compiles
// one module with independent validation, type-checks the emitted TypeScript
// under the strict target options, and runs it under Random.withSeed.

import { assertEquals } from "@std/assert";
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

const DRAWS = `import { Effect, Random } from "effect";
import { unit, roll } from "./main.ts";
const ints = Effect.all([roll(0, 3), roll(0, 3), roll(0, 3), roll(0, 3), roll(0, 3), roll(0, 3), roll(0, 3), roll(0, 3)]);
const units = Effect.all([unit(), unit(), unit(), unit()]);
const draw = Effect.all({ ints, units });
const run = (seed: number) => Effect.runPromise(draw.pipe(Random.withSeed(seed)));
console.log(JSON.stringify({ first: await run(42), again: await run(42), other: await run(43) }));
`;

Deno.test("a fixed seed gives a literal randomInt and random() sequence", async () => {
  const result = await compileAndRun(DRAWS);
  // The literal randomInt(0, 3) values for seed 42 hold 0, 1 and 2 and no
  // other value: these values show the half-open bound [0, 3).
  const seed42 = {
    ints: [0, 2, 0, 0, 0, 1, 1, 1],
    units: [
      0.09487908866581074,
      0.43891319506233695,
      0.44887838124951485,
      0.9877134572415172,
    ],
  };
  assertEquals(result, {
    first: seed42,
    again: seed42,
    other: {
      ints: [1, 1, 0, 0, 1, 2, 0, 1],
      units: [
        0.870645898947423,
        0.5705898295241468,
        0.5472878282694575,
        0.38190712548633166,
      ],
    },
  });
});

Deno.test("randomInt with max <= min dies with a RangeError", async () => {
  const result = await compileAndRun(
    `import { Cause, Effect, Exit } from "effect";
import { roll } from "./main.ts";
const outcome = async (a: number, b: number) => {
  const exit = await Effect.runPromiseExit(roll(a, b));
  if (!Exit.isFailure(exit)) return "success";
  const die = exit.cause.reasons.find(Cause.isDieReason);
  return die !== undefined && die.defect instanceof RangeError ? "RangeError: " + die.defect.message : "other";
};
console.log(JSON.stringify({ equal: await outcome(5, 5), reversed: await outcome(5, 2), ok: await outcome(2, 5) }));
`,
  );
  assertEquals(result, {
    equal: "RangeError: randomInt needs max greater than min",
    reversed: "RangeError: randomInt needs max greater than min",
    ok: "success",
  });
});
