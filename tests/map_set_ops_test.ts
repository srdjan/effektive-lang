// The Map and Set operations (unit SL5): mapOf, getMap, putMap, removeMap,
// hasMap, entriesMap, setOf, addSet, removeSet, hasSet and itemsSet. Checking
// runs through checkProject, emission through emitFiles, and forged IR through
// validateModule. Runtime behavior is in map_set_ops_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import type { ModuleIR, Type } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { diagnosticsOf, emitFiles } from "./helpers.ts";

const TYPES = `type Text = string
type Int = int
type Flag = boolean
type A = { id: Int }
type B = { name: Text }
type AB = A | B
`;

/** The diagnostics of one function with the parameters `m`, `s` and `es` and the body `body`. */
function body(result: string, body: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (m: Map<Text, Int>, s: Set<Int>, es: [Text, Int][], texts: Text[], a: A): ${result} => ${body}\n`,
  );
}

// ------------------------------------------------------------------ result types

interface TypeRow {
  readonly call: string;
  readonly message: string;
}

// Each call has a result type that is not Flag, so the diagnostic names it.
const RESULT_TYPES: readonly TypeRow[] = [
  {
    call: `getMap(m, "a")`,
    message:
      "type-mismatch/003 the function body has type Option<Int>, but Flag is expected",
  },
  {
    call: `putMap(m, "a", 1)`,
    message:
      "type-mismatch/003 the function body has type Map<Text, Int>, but Flag is expected",
  },
  {
    call: `removeMap(m, "a")`,
    message:
      "type-mismatch/003 the function body has type Map<Text, Int>, but Flag is expected",
  },
  {
    call: `entriesMap(m)`,
    message:
      "type-mismatch/003 the function body has type [Text, Int][], but Flag is expected",
  },
  {
    call: `addSet(s, 1)`,
    message:
      "type-mismatch/003 the function body has type Set<Int>, but Flag is expected",
  },
  {
    call: `removeSet(s, 1)`,
    message:
      "type-mismatch/003 the function body has type Set<Int>, but Flag is expected",
  },
  {
    call: `itemsSet(s)`,
    message:
      "type-mismatch/003 the function body has type Int[], but Flag is expected",
  },
  {
    call: `mapOf(es)`,
    message:
      "type-mismatch/003 the function body has type Map<Text, Int>, but Flag is expected",
  },
  {
    call: `setOf([1, 2])`,
    message:
      "type-mismatch/003 the function body has type Set<int>, but Flag is expected",
  },
];

for (const row of RESULT_TYPES) {
  Deno.test(`the result type of ${row.call}`, () => {
    assertEquals(body("Flag", row.call), [row.message]);
  });
}

Deno.test("hasMap and hasSet return boolean", () => {
  assertEquals(body("Flag", `hasMap(m, "a")`), []);
  assertEquals(body("Flag", `hasSet(s, 1)`), []);
  assertEquals(body("Text", `hasMap(m, "a")`), [
    "type-mismatch/003 the function body has type boolean, but Text is expected",
  ]);
  assertEquals(body("Text", `hasSet(s, 1)`), [
    "type-mismatch/003 the function body has type boolean, but Text is expected",
  ]);
});

// ------------------------------------------------------------------ pair inference

Deno.test("mapOf infers the key and value types of literal pairs without an expected type", () => {
  assertEquals(body("Flag", `mapOf([["a", 1], ["b", 2]])`), [
    "type-mismatch/003 the function body has type Map<string, int>, but Flag is expected",
  ]);
});

Deno.test("mapOf joins the value types of the pairs separately from the key types", () => {
  assertEquals(body("Flag", `mapOf([["a", 1], ["b", 2.5]])`), [
    "type-mismatch/003 the function body has type Map<string, number>, but Flag is expected",
  ]);
  assertEquals(body("Flag", `mapOf([["a", { id: 1 }], ["b", { id: 2 }]])`), [
    "type-mismatch/003 the function body has type Map<string, { id: int }>, but Flag is expected",
  ]);
});

Deno.test("mapOf with an expected Map gives each pair the expected tuple type", () => {
  assertEquals(body("Map<Text, Int>", `mapOf([["a", 1], ["b", 2]])`), []);
  assertEquals(body("Map<Text, AB>", `mapOf([["x", a]])`), []);
  assertEquals(body("Map<Text, Int>", `mapOf([["a", "x"]])`), [
    "type-mismatch/003 tuple element 2 has type string, but Int is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `mapOf([[1, 1]])`), [
    "type-mismatch/003 tuple element 1 has type int, but Text is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `mapOf([["a", 1, 2]])`), [
    "type-mismatch/012 the tuple needs 2 elements, but 3 are given",
  ]);
});

Deno.test("mapOf takes a non-literal argument of type [K, V][]", () => {
  assertEquals(body("Map<Text, Int>", `mapOf(es)`), []);
  assertEquals(body("Flag", `mapOf(texts)`), [
    "type-mismatch/003 the mapOf entries has type Text[], but an array of [key, value] pairs is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `mapOf(texts)`), [
    "type-mismatch/003 the mapOf entries has type Text[], but [Text, Int][] is expected",
  ]);
});

Deno.test("mapOf([]) needs an expected Map type", () => {
  assertEquals(body("Flag", `mapOf([])`), [
    "type-mismatch/012 `mapOf([])` needs an expected Map type",
  ]);
  assertEquals(body("Map<Text, Int>", `mapOf([])`), []);
});

Deno.test("a mapOf entry that is not a pair, and keys with no common type, are diagnostics", () => {
  assertEquals(body("Flag", `mapOf([["a", 1], 5])`), [
    "type-mismatch/012 mapOf entry 2 must be a [key, value] pair",
  ]);
  assertEquals(body("Flag", `mapOf([1, 2])`), [
    "type-mismatch/012 mapOf entry 1 must be a [key, value] pair",
    "type-mismatch/012 mapOf entry 2 must be a [key, value] pair",
  ]);
  assertEquals(body("Flag", `mapOf([["a", 1], [1, 2]])`), [
    "type-mismatch/012 map key 2 has type int, which has no common type with string",
  ]);
  assertEquals(body("Flag", `mapOf([["a", 1], ["b", "x"]])`), [
    "type-mismatch/012 map value 2 has type string, which has no common type with int",
  ]);
});

Deno.test("mapOf with an argument that is not a list is a diagnostic", () => {
  assertEquals(body("Flag", `mapOf(5)`), [
    "type-mismatch/003 the mapOf entries has type int, but an array of [key, value] pairs is expected",
  ]);
});

Deno.test("an inferred Map key that is not data is declaration/019", () => {
  assertEquals(body("Flag", `mapOf([[() => 1, 1]])`), [
    "type-mismatch/003 the function body has type Map<pure () => int, int>, but Flag is expected",
    "declaration/019 A Map key must be data, found `pure () => int`",
  ]);
});

Deno.test("setOf infers the element type and checks the expected Set", () => {
  assertEquals(body("Set<Int>", `setOf([1, 2])`), []);
  assertEquals(body("Set<Int>", `setOf(["a"])`), [
    "type-mismatch/003 array element 1 has type string, but Int is expected",
  ]);
  assertEquals(body("Flag", `setOf([])`), [
    "type-mismatch/012 `setOf([])` needs an expected Set type",
  ]);
  assertEquals(body("Set<Int>", `setOf([])`), []);
  assertEquals(body("Flag", `setOf(5)`), [
    "type-mismatch/003 the setOf items has type int, but an array is expected",
  ]);
  assertEquals(body("Flag", `setOf([() => 1])`), [
    "type-mismatch/003 the function body has type Set<pure () => int>, but Flag is expected",
    "declaration/019 A Set element must be data, found `pure () => int`",
  ]);
});

// ------------------------------------------------------------------ argument fit

Deno.test("a key or element that does not fit is type-mismatch/003", () => {
  assertEquals(body("Flag", `hasMap(m, 1)`), [
    "type-mismatch/003 the Map key has type int, but Text is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `removeMap(m, 1)`), [
    "type-mismatch/003 the Map key has type int, but Text is expected",
  ]);
  assertEquals(body("Flag", `hasSet(s, "a")`), [
    "type-mismatch/003 the Set element has type string, but Int is expected",
  ]);
  assertEquals(body("Set<Int>", `addSet(s, "a")`), [
    "type-mismatch/003 the Set element has type string, but Int is expected",
  ]);
  assertEquals(body("Set<Int>", `removeSet(s, "a")`), [
    "type-mismatch/003 the Set element has type string, but Int is expected",
  ]);
  assertEquals(body("Option<Int>", `getMap(m, 1)`), [
    "type-mismatch/003 the Map key has type int, but Text is expected",
  ]);
});

Deno.test("putMap fits its key and value to K and V and does not widen", () => {
  assertEquals(body("Map<Text, Int>", `putMap(m, "a", 1)`), []);
  assertEquals(body("Map<Text, Int>", `putMap(m, 1, 1)`), [
    "type-mismatch/003 the Map key has type int, but Text is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `putMap(m, "a", "x")`), [
    "type-mismatch/003 the Map value has type string, but Int is expected",
  ]);
  assertEquals(body("Map<Text, Int>", `putMap(m, "a", a)`), [
    "type-mismatch/003 the Map value has type A, but Int is expected",
  ]);
});

Deno.test("a receiver that is not a Map or a Set is type-mismatch/010", () => {
  assertEquals(body("Flag", `getMap(s, "a")`), [
    "type-mismatch/010 `getMap` needs a Map value",
  ]);
  assertEquals(body("Flag", `entriesMap(5)`), [
    "type-mismatch/010 `entriesMap` needs a Map value",
  ]);
  assertEquals(body("Set<Int>", `addSet(m, 1)`), [
    "type-mismatch/010 `addSet` needs a Set value",
  ]);
  assertEquals(body("Flag", `itemsSet(m)`), [
    "type-mismatch/010 `itemsSet` needs a Set value",
  ]);
});

Deno.test("a pipeline form is rejected", () => {
  assertEquals(body("Option<Int>", `m |> getMap("a")`), [
    "type-mismatch/010 `getMap` requires direct call syntax",
  ]);
});

Deno.test("the Map and Set names are shadowable", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const getMap = (x: Text): Text => x\nexport const f = (mapOf: Text, setOf: Text): Text => getMap(mapOf)\n`,
    ),
    [],
  );
});

// ------------------------------------------------------------------ emission

interface EmitRow {
  readonly name: string;
  readonly source: string;
  readonly text: string;
}

const EMIT_ROWS: readonly EmitRow[] = [
  {
    name: "mapOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text, v: Text): Map<Text, Text> => mapOf([[k, v]])
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (k: Text, v: Text): HashMap.HashMap<Text, Text> =>
  HashMap.fromIterable([[k, v]]);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "getMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Option<Text> => getMap(m, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Option, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (
  m: HashMap.HashMap<Text, Text>,
  k: Text,
): Option.Option<Text> => HashMap.get(m, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "putMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text, v: Text): Map<Text, Text> => putMap(m, k, v)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (
  m: HashMap.HashMap<Text, Text>,
  k: Text,
  v: Text,
): HashMap.HashMap<Text, Text> => HashMap.set(m, k, v);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "removeMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Map<Text, Text> => removeMap(m, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (
  m: HashMap.HashMap<Text, Text>,
  k: Text,
): HashMap.HashMap<Text, Text> => HashMap.remove(m, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "hasMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Flag => hasMap(m, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

export const Flag = Schema.Boolean;
export type Flag = typeof Flag.Type;

export const f = (m: HashMap.HashMap<Text, Text>, k: Text): Flag =>
  HashMap.has(m, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "entriesMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): [Text, Text][] => entriesMap(m)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (
  m: HashMap.HashMap<Text, Text>,
  k: Text,
): ReadonlyArray<readonly [Text, Text]> => HashMap.toEntries(m);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "setOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text): Set<Text> => setOf([k])
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashSet, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (k: Text): HashSet.HashSet<Text> => HashSet.fromIterable([k]);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "addSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => addSet(s, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashSet, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (s: HashSet.HashSet<Text>, k: Text): HashSet.HashSet<Text> =>
  HashSet.add(s, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "removeSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => removeSet(s, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashSet, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (s: HashSet.HashSet<Text>, k: Text): HashSet.HashSet<Text> =>
  HashSet.remove(s, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "hasSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Flag => hasSet(s, k)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashSet, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

export const Flag = Schema.Boolean;
export type Flag = typeof Flag.Type;

export const f = (s: HashSet.HashSet<Text>, k: Text): Flag => HashSet.has(s, k);
//# sourceMappingURL=m.ts.map
`,
  },
  {
    name: "itemsSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Text[] => itemsSet(s)
`,
    text: `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashSet, Schema } from "effect";

export const Text = Schema.String;
export type Text = typeof Text.Type;

const Flag = Schema.Boolean;
type Flag = typeof Flag.Type;

export const f = (s: HashSet.HashSet<Text>, k: Text): ReadonlyArray<Text> => [
  ...s,
];
//# sourceMappingURL=m.ts.map
`,
  },
];

for (const row of EMIT_ROWS) {
  Deno.test(`${row.name} emits its Effect call`, () => {
    assertEquals(
      emitFiles({ "effektive.json": "{}", "m.eff": row.source }, ["m.eff"]).get(
        "m",
      )?.text,
      row.text,
    );
  });
}

Deno.test("a typed const binding of mapOf, getMap, entriesMap and itemsSet emits Effect calls", () => {
  const emitted = emitFiles({
    "effektive.json": "{}",
    "m.eff": `type Text = string
type Int = int
export const f = (m: Map<Text, Int>, s: Set<Int>): Int => {
  const made = mapOf([["a", 1], ["b", 2]])
  const found = getMap(made, "a")
  const entries = entriesMap(m)
  const items = itemsSet(s)
  1
}
`,
  }, ["m.eff"]);
  assertEquals(
    emitted.get("m")?.text,
    `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, HashSet, Option, Schema } from "effect";

const $Int = Schema.Finite.check(
  Schema.makeFilter(
    (value) => Number.isSafeInteger(value) || "expected a safe integer",
  ),
);

export const Text = Schema.String;
export type Text = typeof Text.Type;

export const Int = $Int;
export type Int = typeof Int.Type;

export const f = (
  m: HashMap.HashMap<Text, Int>,
  s: HashSet.HashSet<Int>,
): Int => {
  const made: HashMap.HashMap<string, number> = HashMap.fromIterable([
    ["a", 1],
    ["b", 2],
  ]);
  const found: Option.Option<number> = HashMap.get(made, "a");
  const entries: ReadonlyArray<readonly [Text, Int]> = HashMap.toEntries(m);
  const items: ReadonlyArray<Int> = [...s];
  return 1;
};
//# sourceMappingURL=m.ts.map
`,
  );
});

// ------------------------------------------------------------------ validator

const TEXT: Type = { kind: "named", id: "type:m#Text" };

/** An IR node with its fields set by name, for forging. */
type Forged = { [field: string]: unknown };

function forgedModule(source: string): { ir: ModuleIR; body: Forged } {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok, JSON.stringify(module));
  assertEquals(validateModule(module.value, new Map([["m.eff", source]])), []);
  const ir = structuredClone(module.value);
  const declaration = ir.declarations.find((d) => d.name === "f");
  assert(declaration?.kind === "function");
  return { ir, body: declaration.body as unknown as Forged };
}

function messages(ir: ModuleIR, source: string): string[] {
  return validateModule(ir, new Map([["m.eff", source]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

interface ForgeRow {
  readonly name: string;
  readonly source: string;
  /** The field to forge: set to a Text reference, or to a copy of `from`. */
  readonly field: string;
  readonly from: string;
  readonly messages: readonly string[];
}

const RECEIVER_ROWS: readonly ForgeRow[] = [
  {
    name: "mapOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text, v: Text): Map<Text, Text> => mapOf([[k, v]])
`,
    field: "entries",
    from: "",
    messages: [
      "validation/002 declarations[2].body.entries: map-of needs an array of [key, value] pairs, found type:m#Text",
    ],
  },
  {
    name: "getMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Option<Text> => getMap(m, k)
`,
    field: "map",
    from: "",
    messages: [
      "validation/002 declarations[2].body.map: get-map needs a Map value, found type:m#Text",
    ],
  },
  {
    name: "putMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text, v: Text): Map<Text, Text> => putMap(m, k, v)
`,
    field: "map",
    from: "",
    messages: [
      "validation/002 declarations[2].body.map: put-map needs a Map value, found type:m#Text",
    ],
  },
  {
    name: "removeMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Map<Text, Text> => removeMap(m, k)
`,
    field: "map",
    from: "",
    messages: [
      "validation/002 declarations[2].body.map: remove-map needs a Map value, found type:m#Text",
    ],
  },
  {
    name: "hasMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Flag => hasMap(m, k)
`,
    field: "map",
    from: "",
    messages: [
      "validation/002 declarations[2].body.map: has-map needs a Map value, found type:m#Text",
    ],
  },
  {
    name: "entriesMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): [Text, Text][] => entriesMap(m)
`,
    field: "map",
    from: "",
    messages: [
      "validation/002 declarations[2].body.map: entries-map needs a Map value, found type:m#Text",
    ],
  },
  {
    name: "setOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text): Set<Text> => setOf([k])
`,
    field: "items",
    from: "",
    messages: [
      "validation/002 declarations[2].body.items: set-of needs an array, found type:m#Text",
    ],
  },
  {
    name: "addSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => addSet(s, k)
`,
    field: "set",
    from: "",
    messages: [
      "validation/002 declarations[2].body.set: add-set needs a Set value, found type:m#Text",
    ],
  },
  {
    name: "removeSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => removeSet(s, k)
`,
    field: "set",
    from: "",
    messages: [
      "validation/002 declarations[2].body.set: remove-set needs a Set value, found type:m#Text",
    ],
  },
  {
    name: "hasSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Flag => hasSet(s, k)
`,
    field: "set",
    from: "",
    messages: [
      "validation/002 declarations[2].body.set: has-set needs a Set value, found type:m#Text",
    ],
  },
  {
    name: "itemsSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Text[] => itemsSet(s)
`,
    field: "set",
    from: "",
    messages: [
      "validation/002 declarations[2].body.set: items-set needs a Set value, found type:m#Text",
    ],
  },
];

for (const row of RECEIVER_ROWS) {
  Deno.test(`the validator rejects a forged receiver of ${row.name}`, () => {
    const { ir, body } = forgedModule(row.source);
    body[row.field] = {
      ...(body[row.field] as Forged),
      kind: "reference",
      target: "local:m#f/k",
      type: TEXT,
    };
    assertEquals(messages(ir, row.source), row.messages);
  });
}

const RESULT_ROWS: readonly ForgeRow[] = [
  {
    name: "mapOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text, v: Text): Map<Text, Text> => mapOf([[k, v]])
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: the recomputed type Map<type:m#Text, type:m#Text> does not fit the recorded type type:m#Text",
    ],
  },
  {
    name: "getMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Option<Text> => getMap(m, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected Option<type:m#Text>, recorded type:m#Text",
    ],
  },
  {
    name: "putMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text, v: Text): Map<Text, Text> => putMap(m, k, v)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected Map<type:m#Text, type:m#Text>, recorded type:m#Text",
    ],
  },
  {
    name: "removeMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Map<Text, Text> => removeMap(m, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected Map<type:m#Text, type:m#Text>, recorded type:m#Text",
    ],
  },
  {
    name: "hasMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Flag => hasMap(m, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected boolean, recorded type:m#Text",
    ],
  },
  {
    name: "entriesMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): [Text, Text][] => entriesMap(m)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected [type:m#Text, type:m#Text][], recorded type:m#Text",
    ],
  },
  {
    name: "setOf",
    source: `type Text = string
type Flag = boolean
export const f = (k: Text): Set<Text> => setOf([k])
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: the recomputed type Set<type:m#Text> does not fit the recorded type type:m#Text",
    ],
  },
  {
    name: "addSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => addSet(s, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected Set<type:m#Text>, recorded type:m#Text",
    ],
  },
  {
    name: "removeSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => removeSet(s, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected Set<type:m#Text>, recorded type:m#Text",
    ],
  },
  {
    name: "hasSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Flag => hasSet(s, k)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected boolean, recorded type:m#Text",
    ],
  },
  {
    name: "itemsSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Text[] => itemsSet(s)
`,
    field: "type",
    from: "",
    messages: [
      "validation/002 declarations[2].body.type: expected type:m#Text[], recorded type:m#Text",
    ],
  },
];

for (const row of RESULT_ROWS) {
  Deno.test(`the validator rejects a forged result type of ${row.name}`, () => {
    const { ir, body } = forgedModule(row.source);
    body.type = TEXT;
    assertEquals(messages(ir, row.source), row.messages);
  });
}

const ARGUMENT_ROWS: readonly ForgeRow[] = [
  {
    name: "getMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Option<Text> => getMap(m, k)
`,
    field: "key",
    from: "map",
    messages: [
      "validation/002 declarations[2].body.key: get-map needs a key that fits type:m#Text, found Map<type:m#Text, type:m#Text>",
    ],
  },
  {
    name: "putMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text, v: Text): Map<Text, Text> => putMap(m, k, v)
`,
    field: "key",
    from: "map",
    messages: [
      "validation/002 declarations[2].body.key: put-map needs a key that fits type:m#Text, found Map<type:m#Text, type:m#Text>",
    ],
  },
  {
    name: "removeMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Map<Text, Text> => removeMap(m, k)
`,
    field: "key",
    from: "map",
    messages: [
      "validation/002 declarations[2].body.key: remove-map needs a key that fits type:m#Text, found Map<type:m#Text, type:m#Text>",
    ],
  },
  {
    name: "hasMap",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text): Flag => hasMap(m, k)
`,
    field: "key",
    from: "map",
    messages: [
      "validation/002 declarations[2].body.key: has-map needs a key that fits type:m#Text, found Map<type:m#Text, type:m#Text>",
    ],
  },
  {
    name: "addSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => addSet(s, k)
`,
    field: "element",
    from: "set",
    messages: [
      "validation/002 declarations[2].body.element: add-set needs an element that fits type:m#Text, found Set<type:m#Text>",
    ],
  },
  {
    name: "removeSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Set<Text> => removeSet(s, k)
`,
    field: "element",
    from: "set",
    messages: [
      "validation/002 declarations[2].body.element: remove-set needs an element that fits type:m#Text, found Set<type:m#Text>",
    ],
  },
  {
    name: "hasSet",
    source: `type Text = string
type Flag = boolean
export const f = (s: Set<Text>, k: Text): Flag => hasSet(s, k)
`,
    field: "element",
    from: "set",
    messages: [
      "validation/002 declarations[2].body.element: has-set needs an element that fits type:m#Text, found Set<type:m#Text>",
    ],
  },
  {
    name: "putMap value",
    source: `type Text = string
type Flag = boolean
export const f = (m: Map<Text, Text>, k: Text, v: Text): Map<Text, Text> => putMap(m, k, v)
`,
    field: "value",
    from: "map",
    messages: [
      "validation/002 declarations[2].body.value: put-map needs a value that fits type:m#Text, found Map<type:m#Text, type:m#Text>",
    ],
  },
];

for (const row of ARGUMENT_ROWS) {
  Deno.test(`the validator rejects a forged argument of ${row.name}`, () => {
    const { ir, body } = forgedModule(row.source);
    body[row.field] = structuredClone(body[row.from]);
    assertEquals(messages(ir, row.source), row.messages);
  });
}

const MAP_OF_SOURCE =
  "type Text = string\ntype Flag = boolean\nexport const f = (k: Text, v: Text): Map<Text, Text> => mapOf([[k, v]])\n";
const SET_OF_SOURCE =
  "type Text = string\ntype Flag = boolean\nexport const f = (k: Text): Set<Text> => setOf([k])\n";

const FUNCTION_TYPE: Type = {
  kind: "function",
  execution: "pure",
  parameters: [],
  result: { kind: "primitive", name: "int" },
  effects: { failures: [], requirements: [] },
};

Deno.test("the validator rejects a forged mapOf entries type with a function key", () => {
  const source = MAP_OF_SOURCE;
  const { ir, body } = forgedModule(source);
  (body.entries as Forged).type = {
    kind: "array",
    element: { kind: "tuple", elements: [FUNCTION_TYPE, TEXT] },
  };
  assertEquals(messages(ir, source), [
    "validation/002 declarations[2].body.type: the recomputed type Map<() => int [pure], type:m#Text> does not fit the recorded type Map<type:m#Text, type:m#Text>",
    "validation/002 declarations[2].body: the body type Map<() => int [pure], type:m#Text> does not fit the declared result Map<type:m#Text, type:m#Text>",
    "validation/002 declarations[2].body.entries: a Map key must be data, found () => int [pure]",
    "validation/002 declarations[2].body.entries.elements[0]: the element has type [type:m#Text, type:m#Text], which does not fit [() => int [pure], type:m#Text]",
  ]);
});

Deno.test("the validator rejects a forged setOf items type with a function element", () => {
  const source = SET_OF_SOURCE;
  const { ir, body } = forgedModule(source);
  (body.items as Forged).type = { kind: "array", element: FUNCTION_TYPE };
  assertEquals(messages(ir, source), [
    "validation/002 declarations[2].body.type: the recomputed type Set<() => int [pure]> does not fit the recorded type Set<type:m#Text>",
    "validation/002 declarations[2].body: the body type Set<() => int [pure]> does not fit the declared result Set<type:m#Text>",
    "validation/002 declarations[2].body.items: a Set element must be data, found () => int [pure]",
    "validation/002 declarations[2].body.items.elements[0]: the element has type type:m#Text, which does not fit () => int [pure]",
  ]);
});
