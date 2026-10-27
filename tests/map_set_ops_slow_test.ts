// Runtime behavior of the Map and Set operations (unit SL5). Each test compiles
// a project with independent validation, type-checks the emitted TypeScript
// under the strict target options, and runs a driver on the compiled functions.

import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

async function compileAndRun(
  source: string,
  run: string,
): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": source },
      ["main.eff"],
      run,
      "effektive-map-set-ops-",
    ),
  );
}

const MAPS = `type Text = string
type Int = int
type Flag = boolean
export const inferred = (): [Text, Int][] => entriesMap(mapOf([["a", 1], ["b", 2]]))
export const typed = (): Map<Text, Int> => mapOf([["a", 1], ["b", 2]])
export const replaced = (): Map<Text, Int> => mapOf([["a", 1], ["b", 2], ["a", 3]])
export const fromList = (pairs: [Text, Int][]): Map<Text, Int> => mapOf(pairs)
export const get = (m: Map<Text, Int>, k: Text): Option<Int> => getMap(m, k)
export const put = (m: Map<Text, Int>, k: Text, v: Int): Map<Text, Int> => putMap(m, k, v)
export const del = (m: Map<Text, Int>, k: Text): Map<Text, Int> => removeMap(m, k)
export const has = (m: Map<Text, Int>, k: Text): Flag => hasMap(m, k)
export const entries = (m: Map<Text, Int>): [Text, Int][] => entriesMap(m)
`;

Deno.test("each Map operation returns the literal values", async () => {
  const result = await compileAndRun(
    MAPS,
    `
import { HashMap, Option } from "effect";
import { del, entries, fromList, get, has, inferred, put, replaced, typed } from "./main.ts";
const base = typed();
const found = (o: Option.Option<number>): number => Option.getOrElse(o, () => -1);
console.log(JSON.stringify({
  inferred: Object.fromEntries(inferred()),
  typed: Object.fromEntries(entries(base)),
  replaced: Object.fromEntries(entries(replaced())),
  fromList: Object.fromEntries(entries(fromList([["x", 7], ["y", 8]]))),
  getA: found(get(base, "a")),
  getMissing: found(get(base, "z")),
  put: Object.fromEntries(entries(put(base, "c", 3))),
  putReplace: Object.fromEntries(entries(put(base, "a", 9))),
  putLeavesBase: HashMap.size(base),
  del: Object.fromEntries(entries(del(base, "a"))),
  delMissing: Object.fromEntries(entries(del(base, "z"))),
  delLeavesBase: HashMap.size(base),
  hasA: has(base, "a"),
  hasZ: has(base, "z"),
}));
`,
  );
  assertEquals(result, {
    inferred: { a: 1, b: 2 },
    typed: { a: 1, b: 2 },
    replaced: { a: 3, b: 2 },
    fromList: { x: 7, y: 8 },
    getA: 1,
    getMissing: -1,
    put: { a: 1, b: 2, c: 3 },
    putReplace: { a: 9, b: 2 },
    putLeavesBase: 2,
    del: { b: 2 },
    delMissing: { a: 1, b: 2 },
    delLeavesBase: 2,
    hasA: true,
    hasZ: false,
  });
});

const SETS = `type Text = string
type Int = int
type Flag = boolean
export const built = (xs: Int[]): Set<Int> => setOf(xs)
export const typed = (): Set<Int> => setOf([3, 1, 2, 3])
export const inferred = (): Text[] => itemsSet(setOf(["b", "a"]))
export const add = (s: Set<Int>, x: Int): Set<Int> => addSet(s, x)
export const del = (s: Set<Int>, x: Int): Set<Int> => removeSet(s, x)
export const has = (s: Set<Int>, x: Int): Flag => hasSet(s, x)
export const items = (s: Set<Int>): Int[] => itemsSet(s)
`;

Deno.test("each Set operation returns the literal values", async () => {
  const result = await compileAndRun(
    SETS,
    `
import { HashSet } from "effect";
import { add, built, del, has, inferred, items, typed } from "./main.ts";
const base = typed();
console.log(JSON.stringify({
  inferred: [...inferred()].sort(),
  typed: [...items(base)].sort(),
  built: [...items(built([5, 5, 6]))].sort(),
  add: [...items(add(base, 4))].sort(),
  addExisting: [...items(add(base, 1))].sort(),
  addLeavesBase: HashSet.size(base),
  del: [...items(del(base, 1))].sort(),
  delMissing: [...items(del(base, 9))].sort(),
  delLeavesBase: HashSet.size(base),
  hasOne: has(base, 1),
  hasNine: has(base, 9),
}));
`,
  );
  assertEquals(result, {
    inferred: ["a", "b"],
    typed: [1, 2, 3],
    built: [5, 6],
    add: [1, 2, 3, 4],
    addExisting: [1, 2, 3],
    addLeavesBase: 3,
    del: [2, 3],
    delMissing: [1, 2, 3],
    delLeavesBase: 3,
    hasOne: true,
    hasNine: false,
  });
});

const KEYED = `type Text = string
type Int = int
type Flag = boolean
export type Key = { a: Text, b?: Int }
export const mk = (a: Text): Key => ({ a })
export const mkb = (a: Text, b: Int): Key => ({ a, b })
export const table = (): Map<Key, Int> => mapOf([[mk("x"), 1], [mkb("x", 5), 2], [mk("x"), 9]])
export const find = (m: Map<Key, Int>, k: Key): Option<Int> => getMap(m, k)
export const put = (m: Map<Key, Int>, k: Key, v: Int): Map<Key, Int> => putMap(m, k, v)
export const has = (m: Map<Key, Int>, k: Key): Flag => hasMap(m, k)
export const del = (m: Map<Key, Int>, k: Key): Map<Key, Int> => removeMap(m, k)
export const members = (): Set<Key> => setOf([mk("x"), mk("x"), mkb("x", 5)])
export const member = (s: Set<Key>, k: Key): Flag => hasSet(s, k)
export const grow = (s: Set<Key>, k: Key): Set<Key> => addSet(s, k)
`;

Deno.test("two separately built equal record keys find one entry", async () => {
  const result = await compileAndRun(
    KEYED,
    `
import { HashMap, HashSet, Option } from "effect";
import { del, find, grow, has, member, members, mk, mkb, put, table } from "./main.ts";
const m = table();
const s = members();
const found = (o: Option.Option<number>): number => Option.getOrElse(o, () => -1);
console.log(JSON.stringify({
  size: HashMap.size(m),
  foundX: found(find(m, mk("x"))),
  foundXB: found(find(m, mkb("x", 5))),
  missing: found(find(m, mk("y"))),
  hasX: has(m, mk("x")),
  putSize: HashMap.size(put(m, mk("x"), 4)),
  putValue: found(find(put(m, mk("x"), 4), mk("x"))),
  delSize: HashMap.size(del(m, mk("x"))),
  setSize: HashSet.size(s),
  member: member(s, mk("x")),
  memberB: member(s, mkb("x", 5)),
  notMember: member(s, mkb("x", 6)),
  growSize: HashSet.size(grow(s, mk("x"))),
}));
`,
  );
  assertEquals(result, {
    size: 2,
    foundX: 9,
    foundXB: 2,
    missing: -1,
    hasX: true,
    putSize: 2,
    putValue: 4,
    delSize: 1,
    setSize: 2,
    member: true,
    memberB: true,
    notMember: false,
    growSize: 2,
  });
});

const ORDER = `type Text = string
type Int = int
export const forward = (): Map<Text, Int> => mapOf([["a", 1], ["b", 2], ["c", 3], ["d", 4]])
export const backward = (): Map<Text, Int> => mapOf([["d", 4], ["c", 3], ["b", 2], ["a", 1]])
export const grown = (m: Map<Text, Int>): Map<Text, Int> => putMap(putMap(m, "d", 4), "a", 1)
export const entries = (m: Map<Text, Int>): [Text, Int][] => entriesMap(m)
export const setForward = (): Set<Text> => setOf(["a", "b", "c", "d"])
export const setBackward = (): Set<Text> => setOf(["d", "c", "b", "a"])
export const items = (s: Set<Text>): Text[] => itemsSet(s)
`;

Deno.test("entriesMap and itemsSet give equal lists for equal contents built in another order", async () => {
  const result = await compileAndRun(
    ORDER,
    `
import { HashMap } from "effect";
import { backward, entries, forward, grown, items, setBackward, setForward } from "./main.ts";
console.log(JSON.stringify({
  forward: entries(forward()),
  backward: entries(backward()),
  grown: entries(grown(HashMap.make(["c", 3], ["b", 2]))),
  setForward: items(setForward()),
  setBackward: items(setBackward()),
}));
`,
  ) as {
    forward: [string, number][];
    backward: [string, number][];
    grown: [string, number][];
    setForward: string[];
    setBackward: string[];
  };
  // The hash order depends on Effect, so the test compares the lists with
  // each other and the contents without order.
  assertEquals(result.backward, result.forward);
  assertEquals(result.grown, result.forward);
  assertEquals(result.setBackward, result.setForward);
  assertEquals(Object.fromEntries(result.forward), { a: 1, b: 2, c: 3, d: 4 });
  assertEquals(
    new Set(result.setForward),
    new Set(["a", "b", "c", "d"]),
  );
});

const WIDE = `type Text = string
type Int = int
type A = { id: Int }
type B = { name: Text }
type AB = A | B
type Role = "admin" | "guest"
export const byRole = (): Map<Role, Int> => mapOf([["admin", 1], ["guest", 2]])
export const widened = (a: A): Map<Text, AB> => mapOf([["x", a]])
export const widenedPut = (m: Map<Text, AB>, a: A): Map<Text, AB> => putMap(m, "y", a)
export const roles = (): Set<Role> => setOf(["admin"])
export const empty = (): Map<Text, Int> => mapOf([])
export const emptySet = (): Set<Int> => setOf([])
export const sizeOf = (m: Map<Text, AB>): [Text, AB][] => entriesMap(m)
`;

Deno.test("expected types that widen the entries still pass the strict target check", async () => {
  const result = await compileAndRun(
    WIDE,
    `
import { HashMap, HashSet } from "effect";
import { byRole, empty, emptySet, roles, widened, widenedPut } from "./main.ts";
console.log(JSON.stringify({
  byRole: HashMap.toEntries(byRole()),
  widened: HashMap.toEntries(widenedPut(widened({ _tag: "main#A", id: 1 }), { _tag: "main#A", id: 2 })),
  roles: [...roles()],
  empty: HashMap.size(empty()),
  emptySet: HashSet.size(emptySet()),
}));
`,
  );
  assertEquals(result, {
    byRole: [["admin", 1], ["guest", 2]],
    widened: [["y", { _tag: "main#A", id: 2 }], ["x", {
      _tag: "main#A",
      id: 1,
    }]],
    roles: ["admin"],
    empty: 0,
    emptySet: 0,
  });
});
