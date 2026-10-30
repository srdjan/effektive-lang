// The `Map` and `Set` types (unit SL4): builtin type applications over
// `HashMap` and `HashSet`. Checking runs through checkProject, emission through
// emitFiles, and forged IR through validateModule. The type has no operation
// yet, so each test reaches a value through a parameter. Runtime behavior is in
// map_set_types_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import type { ModuleIR, Type } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { showType } from "../src/core/type_show.ts";
import { TypeTable } from "../src/core/types.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { diagnosticsOf, emitFiles } from "./helpers.ts";

const TYPES = `type Text = string
type Int = int
type Flag = boolean
type A = { id: Int }
type B = { name: Text }
type AB = A | B
`;

/** The diagnostics of `export const f = (m: <from>): <to> => m`. */
function convert(from: string, to: string): string[] {
  return diagnosticsOf(`${TYPES}export const f = (m: ${from}): ${to} => m\n`);
}

// ------------------------------------------------------------------ assignability

Deno.test("a Map fits a Map with the same key and a wider value", () => {
  assertEquals(convert("Map<Text, A>", "Map<Text, AB>"), []);
});

Deno.test("a Map does not fit a Map with a narrower value", () => {
  assertEquals(convert("Map<Text, AB>", "Map<Text, A>"), [
    "type-mismatch/003 the function body has type Map<Text, AB>, but Map<Text, A> is expected",
  ]);
});

Deno.test("a Map key is invariant when the target key is wider", () => {
  assertEquals(convert("Map<A, Int>", "Map<AB, Int>"), [
    "type-mismatch/003 the function body has type Map<A, Int>, but Map<AB, Int> is expected",
  ]);
});

Deno.test("a Map key is invariant when the target key is narrower", () => {
  assertEquals(convert("Map<AB, Int>", "Map<A, Int>"), [
    "type-mismatch/003 the function body has type Map<AB, Int>, but Map<A, Int> is expected",
  ]);
});

Deno.test("a Map fits itself", () => {
  assertEquals(convert("Map<A, Set<Text>>", "Map<A, Set<Text>>"), []);
});

Deno.test("a Set fits a Set with a wider element", () => {
  assertEquals(convert("Set<A>", "Set<AB>"), []);
});

Deno.test("a Set does not fit a Set with a narrower element", () => {
  assertEquals(convert("Set<AB>", "Set<A>"), [
    "type-mismatch/003 the function body has type Set<AB>, but Set<A> is expected",
  ]);
});

Deno.test("a Map does not fit a Set, a record, or an array", () => {
  assertEquals(convert("Map<Text, Int>", "Set<Text>"), [
    "type-mismatch/003 the function body has type Map<Text, Int>, but Set<Text> is expected",
  ]);
  assertEquals(convert("Set<Text>", "Text[]"), [
    "type-mismatch/003 the function body has type Set<Text>, but Text[] is expected",
  ]);
});

// ------------------------------------------------------------------ type syntax

Deno.test("a wrong type-argument count gives the Option diagnostic", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}type One = Map<Text>\ntype Two = Set<Text, Int>\n`),
    [
      "type-mismatch/001 `Map` takes 2 type arguments, but 1 is given",
      "type-mismatch/001 `Set` takes 1 type argument, but 2 are given",
    ],
  );
});

Deno.test("a user declaration named Map or Set is declaration/002", () => {
  assertEquals(diagnosticsOf("type Map = { a: string }\ntype Set = string\n"), [
    "declaration/002 `Map` is a reserved prelude or builtin name and cannot be declared",
    "declaration/002 `Set` is a reserved prelude or builtin name and cannot be declared",
  ]);
});

Deno.test("showType prints Map and Set in the source form", () => {
  const t = new TypeTable();
  assertEquals(showType(t, t.map(t.string, t.int)), "Map<string, int>");
  assertEquals(showType(t, t.set(t.string)), "Set<string>");
  assertEquals(
    showType(t, t.map(t.string, t.set(t.int))),
    "Map<string, Set<int>>",
  );
});

// ------------------------------------------------------------------ key rule

Deno.test("a function key is declaration/019", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}type Lookup = Map<() => Int, Int>\n`),
    ["declaration/019 A Map key must be data, found `() => Int`"],
  );
});

Deno.test("a Ref element in a Set is declaration/019", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}type Members = Set<Ref<Int>>\n`),
    ["declaration/019 A Set element must be data, found `Ref<Int>`"],
  );
});

Deno.test("a key in a function signature is checked", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (m: Map<Effect<Int>, Int>): Int => 1\n`,
    ),
    ["declaration/019 A Map key must be data, found `Effect<Int, never, never>`"],
  );
});

Deno.test("record, union and Set keys are data", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (a: Map<A, Int>, b: Map<AB, Int>, c: Map<Set<Text>, Int>, d: Set<Map<Text, Int>>): Int => 1\n`,
    ),
    [],
  );
});

Deno.test("a key may name a type that a later declaration defines", () => {
  assertEquals(
    diagnosticsOf(
      `type Int = int\ntype Row = { m: Map<Key, Int>, s: Set<Alias> }\ntype Key = { a: string }\ntype Alias = Key\n`,
    ),
    [],
  );
});

Deno.test("a Map value with a function type is allowed in a function signature", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (m: Map<Text, () => Int>): Int => 1\n`,
    ),
    [],
  );
});

Deno.test("a Map value with a function type in an error field is declaration/015", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}error E = { m: Map<Text, () => Int> }\n`),
    [
      "declaration/015 the field `m` has a function or deferred type, which a tagged record or error declaration cannot hold",
    ],
  );
});

Deno.test("a Set of Refs in an error field is declaration/015 and declaration/019", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}error E = { m: Set<Ref<Int>> }\n`),
    [
      "declaration/015 the field `m` has a function or deferred type, which a tagged record or error declaration cannot hold",
      "declaration/019 A Set element must be data, found `Ref<Int>`",
    ],
  );
});

// ------------------------------------------------------------------ patterns and equality

Deno.test("a match on a Map is pattern/004", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (m: Map<Text, Int>): Int => match m { _ => 1 }\n`,
    ),
    [
      "pattern/004 a match cannot take a value of type Map<Text, Int>; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, and primitives",
    ],
  );
});

Deno.test("a match on a Set is pattern/004", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (s: Set<Text>): Int => match s { _ => 1 }\n`,
    ),
    [
      "pattern/004 a match cannot take a value of type Set<Text>; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, and primitives",
    ],
  );
});

Deno.test("=== on two Maps is type-mismatch/007, as for records", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (a: Map<Text, Int>, b: Map<Text, Int>): Flag => a === b\n`,
    ),
    [
      "type-mismatch/007 the operator `===` does not accept operands of type Map<Text, Int> and Map<Text, Int>",
    ],
  );
  assertEquals(
    diagnosticsOf(`${TYPES}export const g = (a: A, b: A): Flag => a === b\n`),
    [
      "type-mismatch/007 the operator `===` does not accept operands of type A and A",
    ],
  );
});

Deno.test("!== on two Sets is type-mismatch/007", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (a: Set<Text>, b: Set<Text>): Flag => a !== b\n`,
    ),
    [
      "type-mismatch/007 the operator `!==` does not accept operands of type Set<Text> and Set<Text>",
    ],
  );
});

// ------------------------------------------------------------------ emission

Deno.test("a record with a Set field and a Map field emits HashSet and HashMap", () => {
  const emitted = emitFiles({
    "effektive.json": "{}",
    "m.eff":
      "type Text = string\ntype Int = int\ntype Row = { tags: Set<Text>, counts: Map<Text, Int> }\nexport const id = (r: Row): Row => r\n",
  }, ["m.eff"]);
  assertEquals(
    emitted.get("m")?.text,
    `// Generated from m.eff by the Effektive compiler. Do not edit.

import { Schema } from "effect";

const $Int = Schema.Finite.check(
  Schema.makeFilter(
    (value) => Number.isSafeInteger(value) || "expected a safe integer",
  ),
);

export const Text = Schema.String;
export type Text = typeof Text.Type;

export const Int = $Int;
export type Int = typeof Int.Type;

export const Row = Schema.Struct({
  tags: Schema.HashSet(Text),
  counts: Schema.HashMap(Text, Int),
});
export type Row = typeof Row.Type;

export const id = (r: Row): Row => r;
//# sourceMappingURL=m.ts.map
`,
  );
});

Deno.test("a Map and a Set in a signature emit HashMap and HashSet types", () => {
  const emitted = emitFiles({
    "effektive.json": "{}",
    "m.eff":
      "type Text = string\ntype Int = int\nexport const f = (m: Map<Text, Int>, s: Set<Text>): Map<Text, Int> => m\n",
  }, ["m.eff"]);
  assertEquals(
    emitted.get("m")?.text,
    `// Generated from m.eff by the Effektive compiler. Do not edit.

import { HashMap, HashSet, Schema } from "effect";

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
  s: HashSet.HashSet<Text>,
): HashMap.HashMap<Text, Int> => m;
//# sourceMappingURL=m.ts.map
`,
  );
});

// ------------------------------------------------------------------ validator

const SOURCE = `${TYPES}export type Lookup = Map<Text, Int>
export const f = (m: Map<Text, Int>): Map<Text, Int> => m
export const g = (s: Set<Text>): Set<Text> => s
`;

function lowered(): ModuleIR {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": SOURCE }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok, JSON.stringify(module));
  assertEquals(validateModule(module.value, new Map([["m.eff", SOURCE]])), []);
  return structuredClone(module.value);
}

function messages(ir: ModuleIR): string[] {
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

const FUNCTION_KEY: Type = {
  kind: "function",
  execution: "pure",
  parameters: [],
  result: { kind: "primitive", name: "int" },
  effects: { failures: [], requirements: [] },
};

function declaration(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) => d.name === name);
  assert(found !== undefined);
  return found;
}

Deno.test("the validator rejects a forged Map type with a function key", () => {
  const ir = lowered();
  const lookup = declaration(ir, "Lookup");
  assert(lookup.kind === "type" && lookup.definition.kind === "nominal");
  const base = lookup.definition.base;
  assert(base.kind === "map");
  (base as { key: Type }).key = FUNCTION_KEY;
  assertEquals(messages(ir), [
    "validation/001 declarations[6].definition.base.key: a Map key must be data",
  ]);
});

Deno.test("the validator rejects a forged Map type whose value does not fit", () => {
  const ir = lowered();
  const f = declaration(ir, "f");
  assert(f.kind === "function");
  assert(f.type.kind === "function" && f.type.result.kind === "map");
  (f.type.result as { value: Type }).value = {
    kind: "named",
    id: "type:m#Text",
  };
  assertEquals(messages(ir), [
    "validation/002 declarations[7].body: the body type Map<type:m#Text, type:m#Int> does not fit the declared result Map<type:m#Text, type:m#Text>",
  ]);
});

Deno.test("the validator rejects a forged Map type whose key does not fit", () => {
  const ir = lowered();
  const f = declaration(ir, "f");
  assert(f.kind === "function");
  assert(f.type.kind === "function" && f.type.result.kind === "map");
  (f.type.result as { key: Type }).key = { kind: "named", id: "type:m#Int" };
  assertEquals(messages(ir), [
    "validation/002 declarations[7].body: the body type Map<type:m#Text, type:m#Int> does not fit the declared result Map<type:m#Int, type:m#Int>",
  ]);
});

Deno.test("the validator rejects a forged Set type whose element does not fit", () => {
  const ir = lowered();
  const g = declaration(ir, "g");
  assert(g.kind === "function");
  assert(g.type.kind === "function" && g.type.result.kind === "set");
  (g.type.result as { element: Type }).element = {
    kind: "named",
    id: "type:m#Int",
  };
  assertEquals(messages(ir), [
    "validation/002 declarations[8].body: the body type Set<type:m#Text> does not fit the declared result Set<type:m#Int>",
  ]);
});
