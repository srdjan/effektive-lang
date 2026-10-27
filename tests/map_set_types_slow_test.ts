// Runtime behavior of the `Map` and `Set` types (unit SL4). Each test compiles
// a project with independent validation, type-checks the emitted TypeScript
// under the strict target options, and runs a driver that builds `HashMap` and
// `HashSet` values, as a host adapter must.

import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

async function compileAndRun(
  files: Record<string, string>,
  extraFiles: Record<string, string>,
  run: string,
): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": "", ...files },
      ["main.eff"],
      run,
      "effektive-map-set-",
      extraFiles,
    ),
  );
}

const ROW = `type Text = string
type Int = int
export type Row = { tags: Set<Text>, counts: Map<Text, Int> }
export const id = (r: Row): Row => r
`;

Deno.test("a record with a Set field and a Map field decodes and encodes HashSet and HashMap", async () => {
  const result = await compileAndRun(
    { "main.eff": ROW },
    {},
    `
import { HashMap, HashSet, Schema } from "effect";
import { Row } from "./main.ts";
const decoded = Schema.decodeUnknownSync(Row)({
  tags: HashSet.make("b", "a"),
  counts: HashMap.make(["x", 1], ["y", 2]),
});
const encoded = Schema.encodeSync(Row)(decoded);
console.log(JSON.stringify({
  tags: [...decoded.tags].sort(),
  counts: HashMap.toEntries(decoded.counts).sort(),
  encodedTags: [...encoded.tags].sort(),
  encodedCounts: HashMap.toEntries(encoded.counts).sort(),
}));
`,
  );
  assertEquals(result, {
    tags: ["a", "b"],
    counts: [["x", 1], ["y", 2]],
    encodedTags: ["a", "b"],
    encodedCounts: [["x", 1], ["y", 2]],
  });
});

Deno.test("decoding a JSON array into a Map or a Set fails", async () => {
  const result = await compileAndRun(
    { "main.eff": ROW },
    {},
    `
import { HashMap, HashSet, Schema } from "effect";
import { Row } from "./main.ts";
const message = (input: unknown): string => {
  try {
    Schema.decodeUnknownSync(Row)(input);
    return "decoded";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
console.log(JSON.stringify({
  map: message({ tags: HashSet.make("a"), counts: [["x", 1]] }),
  set: message({ tags: ["a"], counts: HashMap.make(["x", 1]) }),
}));
`,
  );
  assertEquals(result, {
    map: 'Expected HashMap\n  at ["counts"]',
    set: 'Expected HashSet\n  at ["tags"]',
  });
});

const KEYED = `type Text = string
type Int = int
export type Key = { a: Text, b?: Int }
export type Index = { byKey: Map<Key, Int> }
export const mk = (a: Text): Key => ({ a })
export const mkb = (a: Text, b: Int): Key => ({ a, b })
export const id = (i: Index): Index => i
`;

Deno.test("two equal record keys built separately find one entry", async () => {
  const result = await compileAndRun(
    { "main.eff": KEYED },
    {},
    `
import { HashMap } from "effect";
import { mk, mkb } from "./main.ts";
const map = HashMap.make([mk("x"), 1], [mkb("x", 5), 2]);
const replaced = HashMap.set(map, mk("x"), 9);
console.log(JSON.stringify({
  size: HashMap.size(map),
  found: HashMap.get(map, mk("x")),
  foundWithB: HashMap.get(map, mkb("x", 5)),
  missing: HashMap.get(map, mk("y")),
  replacedSize: HashMap.size(replaced),
  replaced: HashMap.get(replaced, mk("x")),
}));
`,
  );
  assertEquals(result, {
    size: 2,
    found: { _id: "Option", _tag: "Some", value: 1 },
    foundWithB: { _id: "Option", _tag: "Some", value: 2 },
    missing: { _id: "Option", _tag: "None" },
    replacedSize: 2,
    replaced: { _id: "Option", _tag: "Some", value: 9 },
  });
});

Deno.test("an absent optional field stays absent in a decoded key and in a source key", async () => {
  const result = await compileAndRun(
    { "main.eff": KEYED },
    {},
    `
import { Equal, Hash, Schema } from "effect";
import { Key, mk, mkb } from "./main.ts";
const decoded = Schema.decodeUnknownSync(Key)({ a: "x" });
const decodedWithB = Schema.decodeUnknownSync(Key)({ a: "x", b: 5 });
console.log(JSON.stringify({
  decodedKeys: Object.keys(decoded),
  builtKeys: Object.keys(mk("x")),
  absentEqual: Equal.equals(decoded, mk("x")),
  absentHash: Hash.hash(decoded) === Hash.hash(mk("x")),
  presentEqual: Equal.equals(decodedWithB, mkb("x", 5)),
  presentHash: Hash.hash(decodedWithB) === Hash.hash(mkb("x", 5)),
  undefinedEqual: Equal.equals(mk("x"), { a: "x", b: undefined }),
}));
`,
  );
  assertEquals(result, {
    decodedKeys: ["a"],
    builtKeys: ["a"],
    absentEqual: true,
    absentHash: true,
    presentEqual: true,
    presentHash: true,
    undefinedEqual: false,
  });
});

const ENTRY = `type Text = string
type Int = int
const take = (m: Map<Text, Int>): Int => 1
const takeKeys = (s: Set<Text>): Int => 2
export const f = (input): Int fails SchemaError => take(input)
export const g = (input): Int fails SchemaError => takeKeys(input)
`;

Deno.test("an inferred Map entry accepts a HashMap and reports a bad value at its path", async () => {
  const result = await compileAndRun(
    { "main.eff": ENTRY },
    {},
    `
import { Effect, HashMap, HashSet } from "effect";
import { f, g } from "./main.ts";
const outcome = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
  Effect.runPromise(effect.pipe(Effect.match({
    onSuccess: (value) => ({ ok: value }),
    onFailure: (error) => ({ error: error.message }),
  })));
console.log(JSON.stringify({
  valid: await outcome(f(HashMap.make(["a", 1]))),
  badValue: await outcome(f(HashMap.make(["a", 1], ["b", "bad"]))),
  badKey: await outcome(f(HashMap.make([7, 1]))),
  array: await outcome(f([["a", 1]])),
  validSet: await outcome(g(HashSet.make("a"))),
  badElement: await outcome(g(HashSet.make("a", 3))),
}));
`,
  );
  assertEquals(result, {
    valid: { ok: 1 },
    badValue: { error: 'Expected number\n  at ["entries"][1][1]' },
    badKey: { error: 'Expected string\n  at ["entries"][0][0]' },
    array: { error: "Expected HashMap" },
    validSet: { ok: 2 },
    badElement: { error: 'Expected string\n  at ["values"][0]' },
  });
});

const HOST_EFFI = `export type Text = string
export type Int = int
export type Key = { id: Text }
export service Store {
  tags(): Set<Text>
  counts(): Map<Key, Int>
}
export provider StoreLive provides Store
`;

const HOST_MODULE = `import { Effect, HashMap, HashSet, Layer } from "effect";
import { Key, Store } from "./store.effi.ts";
export const StoreLive = Layer.succeed(Store)({
  tags: () => Effect.succeed(HashSet.make("a", "b")),
  counts: () => Effect.succeed(HashMap.make([Key.make({ id: "k" }), 3])),
});
`;

const HOST_MAIN = `import { Int, Key, StoreLive, Store, Text } from "host:store"
export const tags = (): Set<Text> => provide(StoreLive, () => Store.tags())
export const counts = (): Map<Key, Int> => provide(StoreLive, () => Store.counts())
export const echoTags = (s: Set<Text>): Set<Text> => s
export const echoCounts = (m: Map<Key, Int>): Map<Key, Int> => m
`;

Deno.test("a host provider returns a Set and a Map with a record key, and source passes them through", async () => {
  const result = await compileAndRun(
    {
      "effektive.json":
        '{ "host": { "store": { "interface": "./store.effi", "module": "./store.ts" } } }',
      "store.effi": HOST_EFFI,
      "main.eff": HOST_MAIN,
    },
    { "store.ts": HOST_MODULE },
    `
import { Effect, HashMap, HashSet } from "effect";
import { Key } from "./store.effi.ts";
import { counts, echoCounts, echoTags, tags } from "./main.ts";
const set = await Effect.runPromise(tags());
const map = await Effect.runPromise(counts());
const echoedSet = echoTags(set);
const echoedMap = echoCounts(map);
console.log(JSON.stringify({
  tags: [...set].sort(),
  hasA: HashSet.has(echoedSet, "a"),
  size: HashMap.size(echoedMap),
  found: HashMap.get(echoedMap, Key.make({ id: "k" })),
  missing: HashMap.get(echoedMap, Key.make({ id: "z" })),
  same: echoedMap === map,
}));
`,
  );
  assertEquals(result, {
    tags: ["a", "b"],
    hasA: true,
    size: 1,
    found: { _id: "Option", _tag: "Some", value: 3 },
    missing: { _id: "Option", _tag: "None" },
    same: true,
  });
});

const PROTOTYPE_FIELD = `type Text = string
type Tok = { label: Text, toString?: Text }
type Bag = { kind: "bag", m: Map<Text, Tok>, s: Set<Tok>, k: Map<Tok, Text> }
type Other = { kind: "other" }
type Any = Bag | Other
export const mk = (m: Map<Text, Tok>, s: Set<Tok>, k: Map<Tok, Text>): Bag =>
  Bag({ kind: "bag", m, s, k })
`;

Deno.test("a Map and a Set that hold a record with a prototype-named field keep their entries", async () => {
  const result = await compileAndRun(
    { "main.eff": PROTOTYPE_FIELD },
    {},
    `
import { HashMap, HashSet } from "effect";
import { mk, type Tok } from "./main.ts";
const make = (label: string): Tok => Object.assign(Object.create(null), { label });
const tok = make("a");
const bag = mk(HashMap.make(["x", tok]), HashSet.make(tok), HashMap.make([tok, "v"]));
console.log(JSON.stringify({
  kind: bag._tag,
  mapSize: HashMap.size(bag.m),
  mapValue: HashMap.get(bag.m, "x"),
  hasMember: HashSet.has(bag.s, make("a")),
  keyed: HashMap.get(bag.k, make("a")),
}));
`,
  );
  assertEquals(result, {
    kind: "main#Bag",
    mapSize: 1,
    mapValue: { _id: "Option", _tag: "Some", value: { label: "a" } },
    hasMember: true,
    keyed: { _id: "Option", _tag: "Some", value: "v" },
  });
});
