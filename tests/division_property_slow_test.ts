// A property test of `div` and `%`. One program exports a wrapper of each, and
// one subprocess runs seeded pairs through them. For every pair of nonzero
// divisor, BigInt checks that `div(a, b) * b + a % b === a`, that `|a % b|` is
// less than `|b|`, and that a nonzero `a % b` has the sign of `a`. Neither
// result is `-0`, and a zero divisor throws "division by zero" in both. The
// seeds come from a literal table, and the test asserts literal counts.

import { assertEquals } from "@std/assert";
import { makeRandom } from "../bench/generate.ts";
import { build, withTemporary } from "./emit_slow_helpers.ts";
import { runScript } from "./process_helpers.ts";

const SEEDS = [11, 29, 47, 83] as const;
const STEPS = 40;
const LIMIT = Number.MAX_SAFE_INTEGER;

const PROGRAM = `type Int = int

export const quotient = (a: Int, b: Int): Int => div(a, b)
export const remainder = (a: Int, b: Int): Int => a % b
`;

type Pair = readonly [number, number];

/** The safe integer limits, the units, and the zero cases, in a fixed order. */
const EDGES: readonly Pair[] = [
  [LIMIT, 1],
  [LIMIT, -1],
  [-LIMIT, 1],
  [-LIMIT, -1],
  [LIMIT, LIMIT],
  [-LIMIT, LIMIT],
  [LIMIT, -LIMIT],
  [LIMIT, 2],
  [-LIMIT, 2],
  [1, LIMIT],
  [-1, LIMIT],
  [0, 5],
  [0, -5],
  [5, -1],
  [-5, -1],
  [5, 0],
  [-5, 0],
  [0, 0],
];

function randomInt(random: () => number): number {
  const magnitude = [20, 1000000, LIMIT][Math.floor(random() * 3)];
  const sign = random() < 0.5 ? -1 : 1;
  return sign * Math.floor(random() * magnitude);
}

function pairsOf(seed: number): Pair[] {
  const random = makeRandom(seed);
  return Array.from(
    { length: STEPS },
    () => [randomInt(random), randomInt(random)] as const,
  );
}

interface Outcome {
  readonly a: number;
  readonly b: number;
  readonly quotient: number | string;
  readonly remainder: number | string;
  readonly negativeZero: boolean;
}

/** The checked law of one pair: the empty string when it holds. */
function violation(o: Outcome): string {
  if (o.b === 0) {
    return o.quotient === "division by zero" &&
        o.remainder === "division by zero"
      ? ""
      : `zero divisor gave ${o.quotient} and ${o.remainder}`;
  }
  if (typeof o.quotient !== "number" || typeof o.remainder !== "number") {
    return `no number: ${o.quotient} and ${o.remainder}`;
  }
  const a = BigInt(o.a);
  const b = BigInt(o.b);
  const q = BigInt(o.quotient);
  const r = BigInt(o.remainder);
  const magnitude = (n: bigint): bigint => n < 0n ? -n : n;
  if (q * b + r !== a) return `div * b + % is ${q * b + r}`;
  if (magnitude(r) >= magnitude(b)) return `|%| is ${magnitude(r)}`;
  if (r !== 0n && (r < 0n) !== (a < 0n)) return `% ${r} has the wrong sign`;
  if (o.negativeZero) return "a result is -0";
  return "";
}

Deno.test("div and % keep div(a, b) * b + a % b === a on seeded pairs", async () => {
  const cases = [
    ...SEEDS.flatMap((seed) =>
      pairsOf(seed).map((pair, step) => ({
        label: `seed ${seed} step ${step}`,
        pair,
      }))
    ),
    ...EDGES.map((pair, step) => ({ label: `edge ${step}`, pair })),
  ];
  const outcomes = await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/main.eff`, PROGRAM);
    build(dir, ["main.eff"]);
    return await runScript(
      dir,
      `
import * as M from "./main.ts";

function run(f: (a: number, b: number) => number, a: number, b: number): number | string {
  try {
    return f(a, b);
  } catch (e) {
    return e instanceof RangeError ? e.message : "other";
  }
}
const pairs: [number, number][] = ${JSON.stringify(cases.map((c) => c.pair))};
console.log(JSON.stringify(pairs.map(([a, b]) => {
  const quotient = run(M.quotient, a, b);
  const remainder = run(M.remainder, a, b);
  return {
    a,
    b,
    quotient,
    remainder,
    negativeZero: Object.is(quotient, -0) || Object.is(remainder, -0),
  };
})));
`,
    );
  });
  const results = outcomes as Outcome[];
  assertEquals(results.length, cases.length);
  const failures = results.flatMap((o, i) => {
    const found = violation(o);
    return found === "" ? [] : [`${cases[i].label} (${o.a}, ${o.b}): ${found}`];
  });
  assertEquals(failures, []);
  const tally = {
    zeroDivisor: results.filter((o) => o.b === 0).length,
    exact: results.filter((o) => o.b !== 0 && o.remainder === 0).length,
    positiveRemainder:
      results.filter((o) => typeof o.remainder === "number" && o.remainder > 0)
        .length,
    negativeRemainder:
      results.filter((o) => typeof o.remainder === "number" && o.remainder < 0)
        .length,
  };
  assertEquals(tally, {
    zeroDivisor: 4,
    exact: 22,
    positiveRemainder: 73,
    negativeRemainder: 79,
  });
});
