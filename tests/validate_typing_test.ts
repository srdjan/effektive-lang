// Unit tests for `fits` and `same` of the independent validator, for the
// compound types that carry variance rules: Schema, Sink,
// RetrySchedule, and null against unit. Each test
// builds Type values by hand and checks both directions of `fits`, and `same`.

import { assert, assertEquals } from "@std/assert";
import type { Field, Type } from "../src/core/ir.ts";
import type { Predicate, Term } from "../src/core/predicates.ts";
import {
  comparisonClass,
  containsRefinement,
  containsUnknown,
  entrySchemaDerivable,
  fits,
  fitsCheckedInput,
  identityMembers,
  members,
  same,
  show,
  type TypeEnv,
  unfold,
} from "../src/core/validate/typing.ts";
import { MAX_DEPTH } from "../src/core/validate/type_children.ts";

const ENV: TypeEnv = {
  module: "m",
  aliases: new Map<string, Type>([
    ["type:m#Alias", { kind: "primitive", name: "string" }],
  ]),
  identities: new Set<string>(),
  opaqueBases: new Map<string, Type>(),
  taggedRecords: new Map(),
  errors: new Map<string, readonly Field[]>(),
  opaque: new Set<string>(),
  sealed: new Set<string>(),
};

const INT: Type = { kind: "primitive", name: "int" };
const NUMBER: Type = { kind: "primitive", name: "number" };
const STRING: Type = { kind: "primitive", name: "string" };
const UNIT: Type = { kind: "primitive", name: "unit" };
const NEVER: Type = { kind: "primitive", name: "never" };
const UNKNOWN: Type = { kind: "primitive", name: "unknown" };
const NULL: Type = { kind: "literal", value: null };
const ALIAS: Type = { kind: "named", id: "type:m#Alias" };

const A = "cap:m#A";
const B = "cap:m#B";
const E = "error:m#E";
const F = "error:m#F";

interface Relation {
  /** `fits(a, b)` */
  readonly forward: boolean;
  /** `fits(b, a)` */
  readonly backward: boolean;
  /** `same(a, b)`. `same` is symmetric. */
  readonly same: boolean;
}

/** Checks both directions of `fits` and both directions of `same`. */
function relate(label: string, a: Type, b: Type, expected: Relation): void {
  assertEquals(fits(ENV, a, b), expected.forward, `${label}: fits(a, b)`);
  assertEquals(fits(ENV, b, a), expected.backward, `${label}: fits(b, a)`);
  assertEquals(same(ENV, a, b), expected.same, `${label}: same(a, b)`);
  assertEquals(same(ENV, b, a), expected.same, `${label}: same(b, a)`);
}

const EQUAL: Relation = { forward: true, backward: true, same: true };
const UNRELATED: Relation = { forward: false, backward: false, same: false };
/** The left type fits the right type, but not the reverse. */
const ONE_WAY: Relation = { forward: true, backward: false, same: false };

// ------------------------------------------------------------------- Schema

type SchemaType = Extract<Type, { kind: "schema" }>;

function schema(over: Partial<Omit<SchemaType, "kind">> = {}): Type {
  return {
    kind: "schema",
    decoded: INT,
    encoded: STRING,
    decodeRequirements: [],
    encodeRequirements: [],
    ...over,
  };
}

Deno.test("Schema: an equal Schema fits and is the same", () => {
  relate("plain", schema(), schema(), EQUAL);
  relate(
    "all flags and services",
    schema({
      optionalKey: true,
      constructorDefault: true,
      decodeRequirements: [A],
      encodeRequirements: [B],
      makeInput: NUMBER,
      decoded: NUMBER,
    }),
    schema({
      optionalKey: true,
      constructorDefault: true,
      decodeRequirements: [A],
      encodeRequirements: [B],
      makeInput: NUMBER,
      decoded: NUMBER,
    }),
    EQUAL,
  );
});

Deno.test("Schema: each of the four flags must match in both directions", () => {
  const flags = [
    "optionalKey",
    "encodedOptionalKey",
    "decodedOptionalKey",
    "constructorDefault",
  ] as const;
  for (const flag of flags) {
    relate(
      `${flag} against absent`,
      schema({ [flag]: true }),
      schema(),
      UNRELATED,
    );
    relate(
      `${flag} on both`,
      schema({ [flag]: true }),
      schema({ [flag]: true }),
      EQUAL,
    );
  }
  for (const first of flags) {
    for (const second of flags) {
      if (first === second) continue;
      relate(
        `${first} against ${second}`,
        schema({ [first]: true }),
        schema({ [second]: true }),
        UNRELATED,
      );
    }
  }
});

Deno.test("Schema: decoded and encoded types are invariant", () => {
  relate(
    "decoded int against number",
    schema(),
    schema({ decoded: NUMBER }),
    UNRELATED,
  );
  relate(
    "encoded string against unknown",
    schema(),
    schema({ encoded: UNKNOWN }),
    UNRELATED,
  );
  relate(
    "encoded never against string",
    schema({ encoded: NEVER }),
    schema(),
    UNRELATED,
  );
  relate(
    "an alias equals its target",
    schema({ encoded: ALIAS }),
    schema(),
    EQUAL,
  );
});

Deno.test("Schema: make input is invariant and a missing make input equals the decoded type", () => {
  relate(
    "missing against the decoded type",
    schema(),
    schema({ makeInput: INT }),
    EQUAL,
  );
  relate(
    "missing against a wider make input",
    schema(),
    schema({ makeInput: NUMBER }),
    UNRELATED,
  );
  relate(
    "int against number make input",
    schema({ makeInput: INT }),
    schema({ makeInput: NUMBER }),
    UNRELATED,
  );
  relate(
    "make input against the decoded type of the other side",
    schema({ decoded: NUMBER, makeInput: INT }),
    schema({ decoded: NUMBER }),
    UNRELATED,
  );
  relate(
    "equal make input through an alias",
    schema({ decoded: STRING, makeInput: ALIAS }),
    schema({ decoded: STRING }),
    EQUAL,
  );
});

Deno.test("Schema: requirement sets are subsets under fits and equal under same", () => {
  relate(
    "decode requirements: none against one",
    schema(),
    schema({ decodeRequirements: [A] }),
    ONE_WAY,
  );
  relate(
    "encode requirements: none against one",
    schema(),
    schema({ encodeRequirements: [A] }),
    ONE_WAY,
  );
  relate(
    "decode requirements: one against two",
    schema({ decodeRequirements: [A] }),
    schema({ decodeRequirements: [A, B] }),
    ONE_WAY,
  );
  relate(
    "decode requirements: disjoint",
    schema({ decodeRequirements: [A] }),
    schema({ decodeRequirements: [B] }),
    UNRELATED,
  );
  relate(
    "a decode service is not an encode service",
    schema({ decodeRequirements: [A] }),
    schema({ encodeRequirements: [A] }),
    UNRELATED,
  );
  relate(
    "both sets grow together",
    schema({ decodeRequirements: [A] }),
    schema({ decodeRequirements: [A], encodeRequirements: [B] }),
    ONE_WAY,
  );
});

Deno.test("Schema: a Schema is not another kind of type", () => {
  relate("against Ref", schema(), { kind: "ref", element: INT }, UNRELATED);
  relate("against its decoded type", schema(), INT, UNRELATED);
});

// --------------------------------------------------------------------- Sink

type SinkType = Extract<Type, { kind: "sink" }>;

function sink(over: Partial<Omit<SinkType, "kind">> = {}): Type {
  return {
    kind: "sink",
    input: INT,
    result: INT,
    effects: { failures: [], requirements: [] },
    ...over,
  };
}

Deno.test("Sink: input is contravariant, result is covariant", () => {
  relate("input number against int", sink({ input: NUMBER }), sink(), ONE_WAY);
  relate(
    "input string against int",
    sink({ input: STRING }),
    sink(),
    UNRELATED,
  );
  relate(
    "result int against number",
    sink(),
    sink({ result: NUMBER }),
    ONE_WAY,
  );
  relate(
    "result string against int",
    sink({ result: STRING }),
    sink(),
    UNRELATED,
  );
});

Deno.test("Sink: leftover is covariant and a missing leftover equals never", () => {
  relate("missing against never", sink(), sink({ leftover: NEVER }), EQUAL);
  relate("missing against int", sink(), sink({ leftover: INT }), ONE_WAY);
  relate(
    "never against int",
    sink({ leftover: NEVER }),
    sink({ leftover: INT }),
    ONE_WAY,
  );
  relate(
    "int against number",
    sink({ leftover: INT }),
    sink({ leftover: NUMBER }),
    ONE_WAY,
  );
  relate(
    "string against int",
    sink({ leftover: STRING }),
    sink({ leftover: INT }),
    UNRELATED,
  );
  relate(
    "equal leftover",
    sink({ leftover: INT }),
    sink({ leftover: INT }),
    EQUAL,
  );
});

Deno.test("Sink: failure and requirement sets are subsets", () => {
  relate(
    "failures",
    sink(),
    sink({ effects: { failures: [E], requirements: [] } }),
    ONE_WAY,
  );
  relate(
    "requirements",
    sink(),
    sink({ effects: { failures: [], requirements: [A] } }),
    ONE_WAY,
  );
  relate(
    "disjoint requirements",
    sink({ effects: { failures: [], requirements: [A] } }),
    sink({ effects: { failures: [], requirements: [B] } }),
    UNRELATED,
  );
});

// ------------------------------------------------------------ RetrySchedule

Deno.test("RetrySchedule: the error type is invariant", () => {
  const retry = (error: Type): Type => ({ kind: "retry-schedule", error });
  relate(
    "equal",
    retry({ kind: "named", id: E }),
    retry({ kind: "named", id: E }),
    EQUAL,
  );
  relate(
    "different errors",
    retry({ kind: "named", id: E }),
    retry({ kind: "named", id: F }),
    UNRELATED,
  );
  relate("int against number", retry(INT), retry(NUMBER), UNRELATED);
  relate("an alias equals its target", retry(ALIAS), retry(STRING), EQUAL);
});

// ------------------------------------------------------------ null and unit

Deno.test("null and unit do not fit each other in either direction", () => {
  relate("null against unit", NULL, UNIT, UNRELATED);
  relate(
    "null literal against itself",
    NULL,
    { kind: "literal", value: null },
    EQUAL,
  );
  relate(
    "unit against itself",
    UNIT,
    { kind: "primitive", name: "unit" },
    EQUAL,
  );
  const nullable: Type = { kind: "union", members: [STRING, NULL] };
  assert(fits(ENV, NULL, nullable), "null fits a nullable union");
  assert(!fits(ENV, UNIT, nullable), "unit does not fit a nullable union");
  const optionalUnit: Type = { kind: "union", members: [STRING, UNIT] };
  assert(!fits(ENV, NULL, optionalUnit), "null does not fit a union with unit");
  relate("null against string", NULL, STRING, UNRELATED);
});

// ------------------------------------------------------------------ nominal

Deno.test("a tagged record fits its record, an opaque type does not widen, and an identity takes an unnamed value", () => {
  const id: Type = { kind: "named", id: "type:m#Id" };
  const handle: Type = { kind: "named", id: "type:m#Handle" };
  const account: Type = { kind: "named", id: "type:m#Account" };
  const record: Extract<Type, { kind: "record" }> = {
    kind: "record",
    fields: [{ name: "id", type: id, optional: false }],
  };
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([["type:m#Id", STRING]]),
    identities: new Set(["type:m#Id"]),
    opaqueBases: new Map<string, Type>([["type:m#Handle", UNKNOWN]]),
    taggedRecords: new Map([["type:m#Account", record]]),
    opaque: new Set(["type:m#Handle"]),
  };
  assertEquals(fits(env, id, STRING), true);
  assertEquals(fits(env, STRING, id), true);
  assertEquals(fits(env, account, record), true);
  assertEquals(fits(env, record, account), false);
  assertEquals(fits(env, id, { kind: "union", members: [STRING, INT] }), true);
  assertEquals(
    fits(env, { kind: "array", element: id }, {
      kind: "array",
      element: STRING,
    }),
    true,
  );
  assertEquals(fits(env, handle, UNKNOWN), false);
});

Deno.test("a union of identities takes no other name, and a literal union still fits one", () => {
  const cents: Type = { kind: "named", id: "type:m#Cents" };
  const meters: Type = { kind: "named", id: "type:m#Meters" };
  const score: Type = { kind: "named", id: "type:m#Score" };
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#Cents", INT],
      ["type:m#Meters", INT],
      ["type:m#Score", INT],
    ]),
    identities: new Set(["type:m#Cents", "type:m#Meters", "type:m#Score"]),
  };
  const one: Type = { kind: "literal", value: 1 };
  const two: Type = { kind: "literal", value: 2 };
  assert(!fits(env, { kind: "union", members: [cents, meters] }, score));
  assert(!fits(env, { kind: "union", members: [cents, one] }, score));
  assert(fits(env, { kind: "union", members: [one, two] }, cents));
  assert(fits(env, { kind: "union", members: [cents, meters] }, INT));
});

// ------------------------------------------------- Recursion bounds and guards

/** A type that nests `levels` arrays around `int`. */
function nestedArray(levels: number): Type {
  let type: Type = INT;
  for (let i = 0; i < levels; i++) type = { kind: "array", element: type };
  return type;
}

function named(id: `type:${string}` | `error:${string}`): Type {
  return { kind: "named", id };
}

Deno.test("fits accepts a type nested to MAX_DEPTH and rejects one level deeper", () => {
  assertEquals(MAX_DEPTH, 1536);
  assertEquals(fits(ENV, nestedArray(1536), nestedArray(1536)), true);
  assertEquals(fits(ENV, nestedArray(1537), nestedArray(1537)), false);
});

Deno.test("fitsCheckedInput accepts depth MAX_DEPTH and rejects depth past it", () => {
  assertEquals(fitsCheckedInput(ENV, STRING, STRING, 1536), true);
  assertEquals(fitsCheckedInput(ENV, STRING, STRING, 1537), false);
});

Deno.test("members and identityMembers flatten a union below MAX_DEPTH and stop at it", () => {
  const union: Type = { kind: "union", members: [STRING, INT] };
  assertEquals(members(ENV, union, 1535), [STRING, INT]);
  assertEquals(members(ENV, union, 1536), [union]);
  assertEquals(identityMembers(ENV, union, 1535), [STRING, INT]);
  assertEquals(identityMembers(ENV, union, 1536), [union]);
});

Deno.test("unfold follows exactly MAX_DEPTH aliases of a chain", () => {
  const aliases = new Map<string, Type>();
  for (let i = 0; i <= 1536; i++) {
    aliases.set(`type:c${i}`, named(`type:c${i + 1}`));
  }
  const env: TypeEnv = { ...ENV, aliases };
  assertEquals(unfold(env, named("type:c0")), named("type:c1536"));
  assertEquals(unfold(env, named("type:c1535")), named("type:c1537"));
});

Deno.test("entrySchemaDerivable reads the fields of an error and rejects an unknown name", () => {
  const env: TypeEnv = {
    ...ENV,
    errors: new Map<string, readonly Field[]>([
      [E, [{ name: "code", type: STRING, optional: false }]],
    ]),
  };
  assertEquals(entrySchemaDerivable(env, named(E)), true);
  assertEquals(entrySchemaDerivable(env, named(F)), false);
});

Deno.test("two different guarded recursive aliases do not fit, even when a structural walk would end", () => {
  // A = { next?: A }. B = { next?: B | A }. Both refer to themselves behind an
  // optional field. Without the guard, A against B ends: A fits B | A by name.
  const a = named("type:m#A");
  const b = named("type:m#B");
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#A", {
        kind: "record",
        fields: [{ name: "next", type: a, optional: true }],
      }],
      ["type:m#B", {
        kind: "record",
        fields: [{
          name: "next",
          type: { kind: "union", members: [b, a] },
          optional: true,
        }],
      }],
    ]),
  };
  assertEquals(fits(env, a, b), false);
  assertEquals(fits(env, a, a), true);
});

Deno.test("two aliases that do not refer to themselves fit by structure", () => {
  const record: Type = {
    kind: "record",
    fields: [{ name: "x", type: STRING, optional: false }],
  };
  const other = named("type:m#Other");
  const union: Type = { kind: "union", members: [other, STRING] };
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#R1", record],
      ["type:m#R2", record],
      ["type:m#U1", union],
      ["type:m#U2", union],
    ]),
  };
  assertEquals(fits(env, named("type:m#R1"), named("type:m#R2")), true);
  assertEquals(fits(env, named("type:m#U1"), named("type:m#U2")), true);
});

Deno.test("fitsCheckedInput: unknown fits only when the source is unknown", () => {
  assertEquals(fitsCheckedInput(ENV, UNKNOWN, INT), true);
  assertEquals(fitsCheckedInput(ENV, STRING, INT), false);
});

Deno.test("fitsCheckedInput through a named target", () => {
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([["type:m#Id", INT]]),
    identities: new Set(["type:m#Id"]),
  };
  assertEquals(fitsCheckedInput(env, UNKNOWN, named("type:m#Id")), true);
  assertEquals(fitsCheckedInput(env, STRING, named("type:m#Id")), false);
  assertEquals(fitsCheckedInput(env, STRING, named("type:m#Missing")), false);
});

Deno.test("fitsCheckedInput through a named source", () => {
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([["type:m#Id", STRING]]),
    identities: new Set(["type:m#Id"]),
    sealed: new Set(["type:other#Sealed"]),
    opaqueBases: new Map<string, Type>([["type:other#Sealed", STRING]]),
  };
  assertEquals(fitsCheckedInput(env, named("type:m#Id"), INT), false);
  assertEquals(fitsCheckedInput(env, named("type:m#Missing"), INT), false);
  assertEquals(fitsCheckedInput(env, named("type:other#Sealed"), INT), false);
  assertEquals(
    fitsCheckedInput(env, named("type:other#Sealed"), STRING),
    false,
  );
});

Deno.test("fitsCheckedInput on records compares the field count", () => {
  const one: Type = {
    kind: "record",
    fields: [{ name: "a", type: INT, optional: false }],
  };
  const two: Type = {
    kind: "record",
    fields: [
      { name: "a", type: INT, optional: false },
      { name: "b", type: INT, optional: false },
    ],
  };
  const unknownOne: Type = {
    kind: "record",
    fields: [{ name: "a", type: UNKNOWN, optional: false }],
  };
  assertEquals(fitsCheckedInput(ENV, one, two), false);
  assertEquals(fitsCheckedInput(ENV, unknownOne, one), true);
  assertEquals(fitsCheckedInput(ENV, STRING, one), false);
  assertEquals(fitsCheckedInput(ENV, one, STRING), false);
});

Deno.test("a recursive alias fits a union that names it", () => {
  // Tree = (Tree | string)[]. Tree fits Tree | string by name. If the walk
  // unfolded Tree first, it would meet Tree | string inside the array again.
  const tree = named("type:m#Tree");
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([[
      "type:m#Tree",
      { kind: "array", element: { kind: "union", members: [tree, STRING] } },
    ]]),
  };
  assertEquals(
    fits(env, tree, { kind: "union", members: [tree, STRING] }),
    true,
  );
  assertEquals(
    fits(env, tree, { kind: "union", members: [STRING, tree] }),
    true,
  );
  assertEquals(
    fits(env, tree, { kind: "union", members: [STRING, INT] }),
    false,
  );
});

Deno.test("fitsCheckedInput accepts an unknown element inside an array, an option, or a tuple, and nothing else", () => {
  const array = (element: Type): Type => ({ kind: "array", element });
  const option = (element: Type): Type => ({ kind: "option", element });
  const tuple = (...elements: Type[]): Type => ({ kind: "tuple", elements });
  const table: readonly (readonly [string, Type, Type, boolean])[] = [
    ["array of unknown into array of int", array(UNKNOWN), array(INT), true],
    ["array of string into array of int", array(STRING), array(INT), false],
    ["array of unknown into int", array(UNKNOWN), INT, false],
    ["string into array of int", STRING, array(INT), false],
    [
      "option of unknown into option of int",
      option(UNKNOWN),
      option(INT),
      true,
    ],
    ["option of string into option of int", option(STRING), option(INT), false],
    ["option of unknown into int", option(UNKNOWN), INT, false],
    ["string into option of int", STRING, option(INT), false],
    [
      "tuple with unknown into tuple of int",
      tuple(UNKNOWN, INT),
      tuple(INT, INT),
      true,
    ],
    [
      "tuple of string into tuple of int",
      tuple(STRING, INT),
      tuple(INT, INT),
      false,
    ],
    [
      "shorter tuple into longer tuple",
      tuple(UNKNOWN),
      tuple(INT, INT),
      false,
    ],
    [
      "longer tuple into shorter tuple",
      tuple(UNKNOWN, UNKNOWN),
      tuple(INT),
      false,
    ],
    ["tuple of unknown into int", tuple(UNKNOWN), INT, false],
    ["string into tuple of int", STRING, tuple(INT), false],
    ["array of unknown into tuple of int", array(UNKNOWN), tuple(INT), false],
    ["tuple of unknown into array of int", tuple(UNKNOWN), array(INT), false],
    ["array of unknown into option of int", array(UNKNOWN), option(INT), false],
  ];
  for (const [label, source, target, expected] of table) {
    assertEquals(fitsCheckedInput(ENV, source, target), expected, label);
  }
});

Deno.test("entrySchemaDerivable rejects the schema, issue, and timeout errors and an opaque type", () => {
  const body: readonly Field[] = [
    { name: "code", type: STRING, optional: false },
  ];
  const env: TypeEnv = {
    ...ENV,
    errors: new Map<string, readonly Field[]>([
      ["error:effect/SchemaError", body],
      ["error:effect/SchemaIssue", body],
      ["error:effect/TimeoutError", body],
      [E, body],
    ]),
    aliases: new Map<string, Type>([["type:m#Opaque", STRING]]),
    opaque: new Set(["type:m#Opaque"]),
  };
  assertEquals(entrySchemaDerivable(env, named(E)), true);
  assertEquals(
    entrySchemaDerivable(env, named("error:effect/SchemaError")),
    false,
  );
  assertEquals(
    entrySchemaDerivable(env, named("error:effect/SchemaIssue")),
    false,
  );
  assertEquals(
    entrySchemaDerivable(env, named("error:effect/TimeoutError")),
    false,
  );
  assertEquals(entrySchemaDerivable(env, named("type:m#Opaque")), false);
});

Deno.test("entrySchemaDerivable follows the body of a name, ends on a repeated name, and checks the body", () => {
  const ref: Type = { kind: "ref", element: INT };
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#Bad", { kind: "array", element: ref }],
      ["type:m#Good", { kind: "array", element: STRING }],
      ["type:m#Loop", {
        kind: "record",
        fields: [{ name: "next", type: named("type:m#Loop"), optional: true }],
      }],
    ]),
  };
  const table: readonly (readonly [string, Type, boolean])[] = [
    ["a name with a derivable body", named("type:m#Good"), true],
    ["a name with a body that holds a ref", named("type:m#Bad"), false],
    ["a name without a body", named("type:m#Missing"), false],
    ["a name that refers to itself", named("type:m#Loop"), true],
  ];
  for (const [label, type, expected] of table) {
    assertEquals(entrySchemaDerivable(env, type), expected, label);
  }
});

Deno.test("fitsCheckedInput on a refined name accepts a value only when the predicate reads an unknown field", () => {
  const record = (a: Type, b: Type): Type => ({
    kind: "record",
    fields: [
      { name: "a", type: a, optional: false },
      { name: "b", type: b, optional: false },
    ],
  });
  const field = (...path: string[]): Term => ({ kind: "field", path });
  const diff = (left: Term, right: Term): Predicate => ({
    kind: "difference",
    left,
    right,
    maximum: "0",
  });
  const zero: Term = { kind: "zero" };
  const readsA = diff(field("a"), zero);
  const readsB = diff(field("b"), zero);
  const refined = (predicate: Predicate): TypeEnv => ({
    ...ENV,
    aliases: new Map<string, Type>([["type:m#R", record(INT, INT)]]),
    identities: new Set(["type:m#R"]),
    refined: new Set(["type:m#R"]),
    predicates: new Map<string, Predicate>([["type:m#R", predicate]]),
  });
  const target = named("type:m#R");
  const table: readonly (readonly [string, Predicate, Type, boolean])[] = [
    [
      "the difference reads the unknown field",
      readsA,
      record(UNKNOWN, INT),
      true,
    ],
    ["the difference reads a known field", readsA, record(INT, UNKNOWN), false],
    ["the other field is unknown and read", readsB, record(INT, UNKNOWN), true],
    [
      "the right term reads the unknown field",
      diff(zero, field("a")),
      record(UNKNOWN, INT),
      true,
    ],
    [
      "an and reads the unknown field",
      { kind: "and", operands: [readsB, readsA] },
      record(UNKNOWN, INT),
      true,
    ],
    [
      "an or reads the unknown field",
      { kind: "or", operands: [readsB, readsA] },
      record(UNKNOWN, INT),
      true,
    ],
    [
      "a not reads the unknown field",
      { kind: "not", operand: readsA },
      record(UNKNOWN, INT),
      true,
    ],
    [
      "an and reads only known fields",
      { kind: "and", operands: [readsB, readsB] },
      record(UNKNOWN, INT),
      false,
    ],
    [
      "a constant reads nothing",
      { kind: "constant", value: true },
      record(UNKNOWN, INT),
      false,
    ],
  ];
  for (const [label, predicate, source, expected] of table) {
    assertEquals(
      fitsCheckedInput(refined(predicate), source, target),
      expected,
      label,
    );
  }
});

/** `levels` arrays around `inner`. */
function wrapArrays(levels: number, inner: Type): Type {
  let type = inner;
  for (let i = 0; i < levels; i++) type = { kind: "array", element: type };
  return type;
}

Deno.test("same reads the names of a type down to MAX_DEPTH and not below", () => {
  // `Wide` is an alias of `X`. `Deep` is an alias of 1535 arrays around `Wide`.
  // A name check has no way to tell `Deep` from its body, so both fit each
  // other. Only the name walk can tell them apart.
  const x = named("type:m#X");
  const wide = named("type:m#Wide");
  const deep = wrapArrays(1535, wide);
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#Wide", x],
      ["type:m#Deep", deep],
    ]),
  };
  // X is at depth 1535 + 1 = 1536 through `Wide`, which is still inside MAX_DEPTH.
  assertEquals(same(env, wrapArrays(1535, wide), wrapArrays(1535, x)), true);
  // The alias `Deep` moves X one level deeper, to 1537, where the walk stops.
  assertEquals(same(env, named("type:m#Deep"), deep), false);
});

Deno.test("containsRefinement finds a refined name through aliases, errors, and children", () => {
  const record = (...types: Type[]): Type => ({
    kind: "record",
    fields: types.map((type, i) => ({
      name: `f${i}`,
      type,
      optional: false,
    })),
  });
  const refined = named("type:m#R");
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#ToRefined", refined],
      ["type:m#ToInt", INT],
    ]),
    errors: new Map<string, readonly Field[]>([
      [
        "error:m#Bad",
        [{ name: "r", type: refined, optional: false }],
      ],
      ["error:m#Plain", [{ name: "n", type: INT, optional: false }]],
    ]),
    refined: new Set(["type:m#R"]),
  };
  const table: readonly (readonly [string, Type, boolean])[] = [
    ["a refined name", refined, true],
    ["an alias of a refined name", named("type:m#ToRefined"), true],
    ["an alias of int", named("type:m#ToInt"), false],
    ["a name without a body", named("type:m#Missing"), false],
    ["an error with a refined field", named("error:m#Bad"), true],
    ["an error with a plain field", named("error:m#Plain"), false],
    ["an array of a refined name", { kind: "array", element: refined }, true],
    ["a record that holds one type object twice", record(INT, INT), false],
  ];
  for (const [label, type, expected] of table) {
    assertEquals(containsRefinement(env, type), expected, label);
  }
});

Deno.test("containsUnknown reads transparent aliases, owned identities, and children", () => {
  const record = (...types: Type[]): Type => ({
    kind: "record",
    fields: types.map((type, i) => ({
      name: `f${i}`,
      type,
      optional: false,
    })),
  });
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#ToUnknown", UNKNOWN],
      ["type:m#IdUnknown", UNKNOWN],
      ["type:m#IdInt", INT],
      ["type:other#Foreign", UNKNOWN],
    ]),
    identities: new Set([
      "type:m#IdUnknown",
      "type:m#IdInt",
      "type:other#Foreign",
    ]),
    taggedRecords: new Map([
      ["type:m#Tag", {
        kind: "record",
        fields: [{ name: "x", type: UNKNOWN, optional: false }],
      }],
    ]),
    sealed: new Set(["type:other#Foreign"]),
  };
  const table: readonly (readonly [string, Type, boolean])[] = [
    ["unknown", UNKNOWN, true],
    ["int", INT, false],
    ["a record with an unknown field", record(INT, UNKNOWN), true],
    ["a record of int fields", record(INT, STRING), false],
    ["a record that holds one type object twice", record(INT, INT), false],
    ["a transparent alias of unknown", named("type:m#ToUnknown"), true],
    ["an owned identity over unknown", named("type:m#IdUnknown"), true],
    ["an owned identity over int", named("type:m#IdInt"), false],
    ["a name without a body", named("type:m#Missing"), false],
    ["a sealed identity of another module", named("type:other#Foreign"), false],
    ["a tagged record with an unknown field", named("type:m#Tag"), true],
  ];
  for (const [label, type, expected] of table) {
    assertEquals(containsUnknown(env, type), expected, label);
  }
});

Deno.test("comparisonClass names a primitive identity and stops past MAX_DEPTH", () => {
  const env: TypeEnv = {
    ...ENV,
    aliases: new Map<string, Type>([
      ["type:m#IdInt", INT],
      ["type:m#IdRecord", { kind: "record", fields: [] }],
    ]),
    identities: new Set(["type:m#IdInt", "type:m#IdRecord"]),
  };
  const table:
    readonly (readonly [string, Type, number, string | undefined])[] = [
      ["int at depth 0", INT, 0, "number"],
      ["int at MAX_DEPTH", INT, 1536, "number"],
      ["int past MAX_DEPTH", INT, 1537, undefined],
      [
        "an identity over int",
        named("type:m#IdInt"),
        0,
        "identity:type:m#IdInt",
      ],
      ["an identity over a record", named("type:m#IdRecord"), 0, undefined],
      ["a name without a body", named("type:m#Missing"), 0, undefined],
    ];
  for (const [label, type, depth, expected] of table) {
    assertEquals(comparisonClass(env, type, depth), expected, label);
  }
});

Deno.test("show wraps the element of an array in parentheses only for a union or a function", () => {
  const union: Type = { kind: "union", members: [STRING, INT] };
  const fn: Type = {
    kind: "function",
    execution: "pure",
    parameters: [],
    result: INT,
    effects: { failures: [], requirements: [] },
  };
  const array = (element: Type): Type => ({ kind: "array", element });
  assertEquals(show(array(INT)), "int[]");
  assertEquals(show(array(union)), "(string | int)[]");
  assertEquals(show(array(fn)), "(() => int [pure])[]");
});
