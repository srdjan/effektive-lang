// A property test of `sort`. One program exports a keyed sort of records and
// a plain sort of numbers, and one subprocess runs seeded arrays through them.
// For every array, the result is a permutation of the input, the key sequence
// is ordered, records with equal keys keep their input order, and the input
// is unchanged. The seeds come from a literal table, and the test asserts
// literal counts.

import { assertEquals } from "@std/assert";
import { makeRandom } from "../bench/generate.ts";
import { build, withTemporary } from "./emit_slow_helpers.ts";
import { runScript } from "./process_helpers.ts";

const SEEDS = [5, 19, 41, 73] as const;
const STEPS = 30;
const LENGTH = 12;

const PROGRAM = `type Int = int
type Row = { k: Int, id: Int }
type Rows = Row[]
type Ints = Int[]

export const byKey = (rows: Rows): Rows => sort(rows, (r) => r.k)
export const plain = (xs: Ints): Ints => sort(xs)
`;

interface Row {
  readonly k: number;
  readonly id: number;
}

interface Outcome {
  readonly rows: readonly Row[];
  readonly keyed: readonly Row[];
  readonly after: readonly Row[];
  readonly values: readonly number[];
  readonly plain: readonly number[];
}

/** Rows with few distinct keys, so that equal keys are common. */
function rowsOf(seed: number): Row[][] {
  const random = makeRandom(seed);
  return Array.from(
    { length: STEPS },
    () =>
      Array.from({ length: Math.floor(random() * LENGTH) }, (_, id) => ({
        k: Math.floor(random() * 5) - 2,
        id,
      })),
  );
}

/** The checked laws of one array: the empty string when they hold. */
function violation(o: Outcome): string {
  const ids = (rows: readonly Row[]) =>
    rows.map((r) => r.id).sort((a, b) => a - b);
  if (JSON.stringify(ids(o.keyed)) !== JSON.stringify(ids(o.rows))) {
    return "the result is not a permutation";
  }
  for (let i = 1; i < o.keyed.length; i++) {
    const [a, b] = [o.keyed[i - 1], o.keyed[i]];
    if (a.k > b.k) return `the keys are not ordered at ${i}`;
    if (a.k === b.k && a.id > b.id) return `the sort is not stable at ${i}`;
  }
  if (JSON.stringify(o.after) !== JSON.stringify(o.rows)) {
    return "the argument changed";
  }
  const sorted = [...o.values].sort((a, b) => a - b);
  if (JSON.stringify(o.plain) !== JSON.stringify(sorted)) {
    return "the plain sort is wrong";
  }
  return "";
}

Deno.test("sort gives a stable ordered permutation on seeded arrays", async () => {
  const cases = SEEDS.flatMap((seed) =>
    rowsOf(seed).map((rows, step) => ({
      label: `seed ${seed} step ${step}`,
      rows,
    }))
  );
  const outcomes = await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/main.eff`, PROGRAM);
    build(dir, ["main.eff"]);
    return await runScript(
      dir,
      `
import * as M from "./main.ts";

const inputs: { k: number; id: number }[][] = ${
        JSON.stringify(cases.map((c) => c.rows))
      };
console.log(JSON.stringify(inputs.map((rows) => {
  const copy = rows.map((r) => ({ ...r }));
  const values = rows.map((r) => r.k * 7 - r.id);
  const valuesCopy = [...values];
  const keyed = M.byKey(copy);
  const plain = M.plain(valuesCopy);
  return { rows, keyed, after: copy, values, plain };
})));
`,
    );
  });
  const results = outcomes as Outcome[];
  assertEquals(results.length, cases.length);
  const failures = results.flatMap((o, i) => {
    const found = violation(o);
    return found === "" ? [] : [`${cases[i].label}: ${found}`];
  });
  assertEquals(failures, []);
  const tally = {
    arrays: results.length,
    empty: results.filter((o) => o.rows.length === 0).length,
    withEqualKeys:
      results.filter((o) =>
        o.keyed.some((r, i) => i > 0 && o.keyed[i - 1].k === r.k)
      ).length,
  };
  assertEquals(tally, { arrays: 120, empty: 11, withEqualKeys: 78 });
});
