// Laws of type assignment, over seeded generated types. The compiler has two
// independent implementations on purpose: `TypeTable.isAssignableIn` in the
// checker and `fits` in the validator. This file imports both directly, because
// the laws are about these two functions and no public surface exposes them.
//
// One generated set of definitions feeds both sides. `TypeTable.load` reads the
// definitions for the checker, and `envOf` reads them for the validator in the
// same way as `src/core/validate/world.ts`. The module `owner` has authority
// over the sealed types of `owner` and none over the sealed types of `other`.

import { assertEquals } from "@std/assert";
import { makeRandom } from "../bench/generate.ts";
import type {
  CapabilityId,
  Effects,
  ErrorId,
  Execution,
  Field,
  FunctionType,
  Type,
  TypeId,
} from "../src/core/ir.ts";
import { type ModuleIR, Program, type Result } from "../src/core/frontend.ts";
import { DURATION_ID, INSTANT_ID } from "../src/core/ir.ts";
import type { LowerError } from "../src/core/frontend.ts";
import type { Predicate } from "../src/core/predicates.ts";
import { typeFromIr } from "../src/core/type_ir.ts";
import { TypeTable } from "../src/core/types.ts";
import { fits, show, type TypeEnv } from "../src/core/validate/typing.ts";
import { validateRevision } from "./validate_helpers.ts";

const OWNER = "owner";

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
const PAIRS_PER_SEED = 5000;
const TYPES_PER_SEED = 2000;
const PLAIN_ROOTS_PER_SEED = 30;

const INT: Type = { kind: "primitive", name: "int" };
const NUMBER: Type = { kind: "primitive", name: "number" };
const STRING: Type = { kind: "primitive", name: "string" };
const BOOLEAN: Type = { kind: "primitive", name: "boolean" };
const UNIT: Type = { kind: "primitive", name: "unit" };
const NEVER: Type = { kind: "primitive", name: "never" };
const UNKNOWN: Type = { kind: "primitive", name: "unknown" };

const PRIMITIVES: readonly Type[] = [
  INT,
  NUMBER,
  STRING,
  BOOLEAN,
  UNIT,
  NEVER,
  UNKNOWN,
];

const LITERALS: readonly Type[] = [
  { kind: "literal", value: 0 },
  { kind: "literal", value: 1 },
  { kind: "literal", value: 1.5 },
  { kind: "literal", value: 9007199254740992 },
  { kind: "literal", value: "a" },
  { kind: "literal", value: "b" },
  { kind: "literal", value: "" },
  { kind: "literal", value: true },
  { kind: "literal", value: false },
  { kind: "literal", value: null },
];

const ERRORS: readonly ErrorId[] = [
  "error:owner#E0",
  "error:owner#E1",
  "error:other#E2",
];
const CAPABILITIES: readonly CapabilityId[] = ["cap:owner#A", "cap:other#B"];
const FIELD_NAMES = ["a", "b", "c"] as const;
const EXECUTIONS: readonly Execution[] = ["pure", "effect"];

// ---------------------------------------------------------------- definitions

interface TypeDecl {
  readonly id: TypeId;
  readonly opaque?: boolean;
  readonly predicate?: Predicate;
  readonly definition:
    | { readonly kind: "alias"; readonly type: Type }
    | {
      readonly kind: "nominal";
      readonly base: Type;
      readonly tagged?: true;
      readonly sealed?: true;
    };
}

interface Definitions {
  readonly types: readonly TypeDecl[];
  readonly errors: readonly {
    readonly id: ErrorId;
    readonly fields: readonly Field[];
  }[];
}

/** The validator's view of the definitions. It follows world.ts:165-191. */
function envOf(definitions: Definitions): TypeEnv {
  const aliases = new Map<string, Type>();
  const identities = new Set<string>();
  const opaqueBases = new Map<string, Type>();
  const taggedRecords = new Map<string, Extract<Type, { kind: "record" }>>();
  const opaque = new Set<string>();
  const sealed = new Set<string>();
  const refined = new Set<string>();
  const predicates = new Map<string, Predicate>();
  const builtins: readonly TypeDecl[] = [
    { id: DURATION_ID, definition: { kind: "nominal", base: INT } },
    { id: INSTANT_ID, definition: { kind: "nominal", base: INT } },
  ];
  for (const decl of [...builtins, ...definitions.types]) {
    if (decl.opaque === true) opaque.add(decl.id);
    if (decl.predicate !== undefined) {
      refined.add(decl.id);
      predicates.set(decl.id, decl.predicate);
    }
    if (decl.definition.kind === "alias") {
      aliases.set(decl.id, decl.definition.type);
      continue;
    }
    if (decl.definition.sealed === true) sealed.add(decl.id);
    if (
      decl.definition.tagged === true && decl.definition.base.kind === "record"
    ) {
      taggedRecords.set(decl.id, decl.definition.base);
    } else if (decl.opaque === true) {
      opaqueBases.set(decl.id, decl.definition.base);
    } else {
      aliases.set(decl.id, decl.definition.base);
      identities.add(decl.id);
    }
  }
  const errors = new Map<string, readonly Field[]>();
  for (const error of definitions.errors) errors.set(error.id, error.fields);
  return {
    module: OWNER,
    aliases,
    identities,
    opaqueBases,
    taggedRecords,
    errors,
    opaque,
    sealed,
    refined,
    predicates,
  };
}

// ----------------------------------------------------------------- generation

/**
 * The random source and the names and bodies that are defined so far. `scratch`
 * is a table without definitions. It only tells which union members intern to
 * one ref. It must stay separate, because `TypeTable.schema` reads definitions
 * when a node is interned first.
 */
interface Generator {
  readonly random: () => number;
  readonly names: Type[];
  readonly bodies: Map<string, Type>;
  readonly scratch: TypeTable;
}

function pick<T>(g: Generator, items: readonly T[]): T {
  return items[Math.floor(g.random() * items.length)];
}

function subset<T>(g: Generator, items: readonly T[]): T[] {
  return items.filter(() => g.random() < 0.4);
}

/** Adds the item when the list does not hold it, and removes it otherwise. */
function toggle<T>(g: Generator, items: readonly T[], pool: readonly T[]): T[] {
  const item = pick(g, pool);
  return items.includes(item)
    ? items.filter((other) => other !== item)
    : [...items, item];
}

function effects(g: Generator): Effects {
  return {
    failures: subset(g, ERRORS),
    requirements: subset(g, CAPABILITIES),
  };
}

/**
 * A union in the form that the compiler emits. A union with one distinct member
 * is that member: type_lower.ts:504-509, types.ts:780, and typing.ts:716 all
 * collapse it. So the IR never holds that union, and the checker, which interns
 * it to the member, would keep the top-level lift that the validator drops at a
 * union (typing.ts:295-298).
 */
function unionOf(g: Generator, members: readonly Type[]): Type {
  const union: Type = { kind: "union", members };
  const node = g.scratch.node(typeFromIr(g.scratch, union));
  return node.kind === "union" ? union : members[0];
}

function leaf(g: Generator): Type {
  const roll = g.random();
  if (roll < 0.35) return pick(g, PRIMITIVES);
  if (roll < 0.6) return pick(g, LITERALS);
  if (roll < 0.95 && g.names.length > 0) return pick(g, g.names);
  return { kind: "closeable-scope" };
}

function record(g: Generator, inner: () => Type): Type {
  const fields = subset(g, FIELD_NAMES).map((name) => ({
    name,
    type: inner(),
    optional: g.random() < 0.25,
  }));
  return { kind: "record", fields };
}

function tuple(g: Generator, inner: () => Type): Type {
  const elements = [inner(), inner(), inner()];
  return {
    kind: "tuple",
    elements: elements.slice(0, Math.floor(g.random() * 4)),
  };
}

function functionType(g: Generator, depth: number): FunctionType {
  const inner = () => anyType(g, depth - 1);
  const parameters = [inner(), inner()].slice(0, Math.floor(g.random() * 3));
  const borrows = parameters.map(() => g.random() < 0.1);
  const checked = parameters.map(() => g.random() < 0.1);
  return {
    kind: "function",
    execution: pick(g, EXECUTIONS),
    parameters,
    ...(borrows.some(Boolean) ? { borrows } : {}),
    ...(checked.some(Boolean) ? { checked } : {}),
    result: inner(),
    effects: effects(g),
  };
}

const COMPOSITE_KINDS = [
  "array",
  "tuple",
  "record",
  "option",
  "set",
  "map",
  "union",
  "function",
  "effect",
  "fiber",
  "stream",
  "schedule",
  "sink",
  "ref",
  "retry-schedule",
  "codec",
  "schema",
  "provider",
] as const;

/** A type over every kind of the IR, with nesting up to `depth`. */
function anyType(g: Generator, depth: number): Type {
  if (depth === 0 || g.random() < 0.15) return leaf(g);
  const inner = () => anyType(g, depth - 1);
  const kind = pick(g, COMPOSITE_KINDS);
  switch (kind) {
    case "array":
    case "option":
    case "set":
    case "ref":
      return { kind, element: inner() };
    case "tuple":
      return tuple(g, inner);
    case "record":
      return record(g, inner);
    case "map":
      return { kind, key: inner(), value: inner() };
    case "union":
      return unionOf(g, [inner(), inner()]);
    case "function":
      return functionType(g, depth);
    case "effect":
      return { kind, result: inner(), effects: effects(g) };
    case "fiber":
      return { kind, result: inner(), failures: subset(g, ERRORS) };
    case "stream":
      return { kind, element: inner(), effects: effects(g) };
    case "schedule":
      return { kind, output: inner(), input: inner(), effects: effects(g) };
    case "sink":
      return {
        kind,
        input: inner(),
        result: inner(),
        ...(g.random() < 0.5 ? { leftover: inner() } : {}),
        effects: effects(g),
      };
    case "retry-schedule":
      return { kind, error: inner() };
    case "codec":
      return { kind, decoded: inner(), encoded: inner() };
    case "schema":
      return {
        kind,
        decoded: inner(),
        encoded: inner(),
        decodeRequirements: subset(g, CAPABILITIES),
        encodeRequirements: subset(g, CAPABILITIES),
        ...(g.random() < 0.25 ? { optionalKey: true as const } : {}),
        ...(g.random() < 0.25 ? { makeInput: inner() } : {}),
        ...(g.random() < 0.25 ? { constructorDefault: true as const } : {}),
      };
    case "provider":
      return {
        kind,
        provides: subset(g, CAPABILITIES),
        acquisition: { execution: pick(g, EXECUTIONS), effects: effects(g) },
      };
  }
}

/** A type that the given type should fit in most cases. */
function widen(g: Generator, type: Type, top = true): Type {
  const next = (part: Type) => widen(g, part, false);
  switch (type.kind) {
    case "primitive":
      return type.name === "int" ? NUMBER : type;
    case "literal":
      if (typeof type.value === "string") return STRING;
      if (typeof type.value === "boolean") return BOOLEAN;
      return typeof type.value === "number" ? NUMBER : type;
    case "named":
      return g.bodies.get(type.id) ?? type;
    case "array":
    case "option":
    case "set":
      return { ...type, element: next(type.element) };
    case "tuple":
      return { ...type, elements: type.elements.map(next) };
    case "record":
      return {
        ...type,
        fields: [...type.fields].reverse().map((field) => ({
          ...field,
          type: next(field.type),
        })),
      };
    case "union":
      return { ...type, members: [...type.members, leaf(g)] };
    case "map":
      return { ...type, value: next(type.value) };
    case "fiber":
      return {
        ...type,
        result: next(type.result),
        failures: [...type.failures].reverse(),
      };
    case "effect":
      return {
        ...type,
        result: next(type.result),
        effects: { ...type.effects, failures: ERRORS },
      };
    case "stream":
      return {
        ...type,
        element: next(type.element),
        effects: { ...type.effects, failures: ERRORS },
      };
    case "function":
      return {
        ...type,
        execution: top ? "effect" : type.execution,
        result: next(type.result),
        effects: { ...type.effects, requirements: CAPABILITIES },
      };
    default:
      return type;
  }
}

/** A near miss: one local change that usually breaks assignment. */
function perturb(g: Generator, type: Type): Type {
  switch (type.kind) {
    case "primitive":
    case "literal":
      return pick(g, [...PRIMITIVES, ...LITERALS]);
    case "named":
      return pick(g, g.names);
    case "array":
    case "option":
    case "set":
      return { ...type, element: perturb(g, type.element) };
    case "tuple":
      return type.elements.length === 0
        ? { ...type, elements: [INT] }
        : { ...type, elements: type.elements.slice(1) };
    case "record": {
      const [first, ...rest] = type.fields;
      return first === undefined
        ? {
          ...type,
          fields: [{ name: "a", type: INT, optional: false }],
        }
        : {
          ...type,
          fields: [{ ...first, optional: !first.optional }, ...rest],
        };
    }
    case "union":
      return unionOf(g, type.members.slice(1));
    case "map":
      return { ...type, key: perturb(g, type.key) };
    case "fiber":
      return { ...type, failures: toggle(g, type.failures, ERRORS) };
    case "effect":
    case "stream":
      return {
        ...type,
        effects: {
          ...type.effects,
          failures: toggle(g, type.effects.failures, ERRORS),
        },
      };
    case "function":
      return g.random() < 0.5
        ? {
          ...type,
          execution: type.execution === "pure" ? "effect" : "pure",
        }
        : {
          ...type,
          effects: {
            ...type.effects,
            failures: toggle(g, type.effects.failures, ERRORS),
          },
        };
    default:
      return anyType(g, 1);
  }
}

/** The same position around both sides, so a lift can apply only at the top. */
function wrapBoth(
  g: Generator,
  first: Type,
  second: Type,
): readonly [Type, Type] {
  const other = leaf(g);
  switch (Math.floor(g.random() * 5)) {
    case 0:
      return [first, second];
    case 1:
      return [first, unionOf(g, [other, second])];
    case 2:
      return [
        { kind: "array", element: first },
        { kind: "array", element: second },
      ];
    case 3:
      return [
        { kind: "option", element: first },
        { kind: "option", element: second },
      ];
    default:
      return [unionOf(g, [other, first]), unionOf(g, [other, second])];
  }
}

/** The first type takes a wider input than the second type, so it should fit. */
function contravariantPair(g: Generator): readonly [Type, Type] {
  const input = anyType(g, 1);
  const wider = widen(g, input, false);
  const { borrows: _borrows, checked: _checked, ...plain } = functionType(g, 1);
  const shared = { effects: effects(g) };
  switch (Math.floor(g.random() * 3)) {
    case 0:
      return [
        { ...plain, parameters: [wider] },
        { ...plain, parameters: [input] },
      ];
    case 1: {
      const output = anyType(g, 1);
      return [
        {
          kind: "schedule",
          output,
          input: g.random() < 0.3 ? UNKNOWN : wider,
          ...shared,
        },
        { kind: "schedule", output, input, ...shared },
      ];
    }
    default: {
      const result = anyType(g, 1);
      return [
        { kind: "sink", input: wider, result, ...shared },
        { kind: "sink", input, result, ...shared },
      ];
    }
  }
}

/** A pair that fits, nearly fits, or has no relation. */
function generatePair(g: Generator): readonly [Type, Type] {
  const source = anyType(g, 2);
  switch (Math.floor(g.random() * 10)) {
    case 0:
      return [source, widen(g, source)];
    case 1:
      return [source, widen(g, widen(g, source))];
    case 2:
      return [source, perturb(g, source)];
    case 3:
      return [source, anyType(g, 2)];
    case 4:
      return [source, unionOf(g, [leaf(g), source])];
    case 5: {
      const name = pick(g, g.names);
      return [name, widen(g, name)];
    }
    case 6:
      return [source, pick(g, g.names)];
    case 7: {
      const result = anyType(g, 1);
      return [
        { kind: "fiber", result, failures: subset(g, ERRORS) },
        { kind: "fiber", result, failures: subset(g, ERRORS) },
      ];
    }
    case 8: {
      const type = functionType(g, 1);
      const execution = type.execution === "pure" ? "effect" : "pure";
      return wrapBoth(g, type, { ...type, execution });
    }
    default:
      return contravariantPair(g);
  }
}

/** A type over primitives and literals, and arrays, tuples, and records of them. */
function plainType(g: Generator, depth: number): Type {
  const roll = g.random();
  if (depth === 0 || roll < 0.2) {
    return g.random() < 0.5 ? pick(g, PRIMITIVES) : pick(g, LITERALS);
  }
  const inner = () => plainType(g, depth - 1);
  if (roll < 0.45) return { kind: "array", element: inner() };
  if (roll < 0.7) return tuple(g, inner);
  return record(g, inner);
}

// ---------------------------------------------------------------------- world

/** Both implementations over one set of definitions. */
interface Sides {
  readonly table: TypeTable;
  readonly env: TypeEnv;
}

interface World extends Sides {
  readonly seed: number;
  readonly generator: Generator;
}

function sidesOf(definitions: Definitions): Sides {
  const table = new TypeTable();
  table.load(definitions);
  return { table, env: envOf(definitions) };
}

function checkerFits(sides: Sides, source: Type, target: Type): boolean {
  return sides.table.isAssignableIn(
    OWNER,
    typeFromIr(sides.table, source),
    typeFromIr(sides.table, target),
  );
}

function bothAnswers(
  sides: Sides,
  source: Type,
  target: Type,
): { readonly checker: boolean; readonly validator: boolean } {
  return {
    checker: checkerFits(sides, source, target),
    validator: fits(sides.env, source, target),
  };
}

function named(id: TypeId | ErrorId): Type {
  return { kind: "named", id };
}

function selfRecord(id: TypeId, optional: boolean, array: boolean): Type {
  const self = named(id);
  return {
    kind: "record",
    fields: [
      { name: "value", type: INT, optional: false },
      {
        name: "next",
        type: array ? { kind: "array", element: self } : self,
        optional,
      },
    ],
  };
}

function taggedList(id: TypeId): Type {
  return {
    kind: "union",
    members: [
      {
        kind: "record",
        fields: [{
          name: "kind",
          type: { kind: "literal", value: "nil" },
          optional: false,
        }],
      },
      {
        kind: "record",
        fields: [
          {
            name: "kind",
            type: { kind: "literal", value: "cons" },
            optional: false,
          },
          { name: "next", type: named(id), optional: false },
        ],
      },
    ],
  };
}

function tagRecord(tag: string): Extract<Type, { kind: "record" }> {
  return {
    kind: "record",
    fields: [
      {
        name: "_tag",
        type: { kind: "literal", value: tag },
        optional: false,
      },
      { name: "value", type: INT, optional: false },
    ],
  };
}

/** One set of definitions: fixed shapes with generated bodies. */
function generateWorld(seed: number): World {
  const g: Generator = {
    random: makeRandom(seed),
    names: [named(DURATION_ID), named(INSTANT_ID)],
    bodies: new Map([[DURATION_ID, INT], [INSTANT_ID, INT]]),
    scratch: new TypeTable(),
  };
  const errors = ERRORS.map((id, index) => {
    g.names.push(named(id));
    return {
      id,
      fields: [{
        name: `field${index}`,
        type: index === 0 ? INT : STRING,
        optional: false,
      }],
    };
  });
  const types: TypeDecl[] = [];
  const alias = (id: TypeId, type: Type) => {
    types.push({ id, definition: { kind: "alias", type } });
    g.names.push(named(id));
    g.bodies.set(id, type);
  };
  const identity = (id: TypeId, base: Type, sealed = false) => {
    types.push({
      id,
      definition: {
        kind: "nominal",
        base,
        ...(sealed ? { sealed: true as const } : {}),
      },
    });
    g.names.push(named(id));
    g.bodies.set(id, base);
  };
  const tagged = (id: TypeId, sealed: boolean) => {
    const base = tagRecord(id);
    types.push({
      id,
      definition: {
        kind: "nominal",
        base,
        tagged: true,
        ...(sealed ? { sealed: true as const } : {}),
      },
    });
    g.names.push(named(id));
    g.bodies.set(id, base);
  };

  alias("type:owner#Alias0", anyType(g, 1));
  alias("type:owner#Alias1", anyType(g, 2));
  alias("type:owner#Alias2", leaf(g));
  identity("type:owner#Id0", INT);
  identity("type:owner#Id1", STRING);
  identity("type:owner#Id2", anyType(g, 1));
  identity("type:owner#Id3", anyType(g, 2));
  identity("type:owner#IdOverName", pick(g, g.names));
  identity("type:owner#IdOverFunction", functionType(g, 1));
  identity("type:owner#Sealed0", INT, true);
  identity("type:owner#Sealed1", anyType(g, 1), true);
  identity("type:other#Sealed0", INT, true);
  identity("type:other#Sealed1", anyType(g, 1), true);
  identity("type:other#Open", anyType(g, 1));
  tagged("type:owner#Tag", false);
  tagged("type:owner#SealedTag", true);
  tagged("type:other#SealedTag", true);
  types.push({
    id: "type:owner#Handle",
    opaque: true,
    definition: { kind: "nominal", base: UNKNOWN },
  });
  g.names.push(named("type:owner#Handle"));
  types.push({
    id: "type:owner#Refined",
    predicate: { kind: "constant", value: true },
    definition: { kind: "nominal", base: INT },
  });
  g.names.push(named("type:owner#Refined"));
  g.bodies.set("type:owner#Refined", INT);
  alias("type:owner#Tree", selfRecord("type:owner#Tree", false, true));
  alias("type:owner#Forest", selfRecord("type:owner#Forest", false, true));
  alias("type:owner#Chain", selfRecord("type:owner#Chain", true, false));
  alias("type:owner#List", taggedList("type:owner#List"));
  alias("type:owner#Queue", taggedList("type:owner#Queue"));
  identity("type:owner#Node", selfRecord("type:owner#Node", true, false));
  alias("type:owner#AliasOfTree", named("type:owner#Tree"));
  return { ...sidesOf({ types, errors }), seed, generator: g };
}

// ----------------------------------------------------------------- the reports

/** The shortest messages first, so a report leads with a near-minimal case. */
function report(found: readonly string[]): string {
  const shortest = [...found].sort((a, b) => a.length - b.length);
  return `${found.length} cases:\n${shortest.slice(0, 8).join("\n")}`;
}

function pairText(
  seed: number,
  source: Type,
  target: Type,
  detail: string,
): string {
  return `seed ${seed}: source ${show(source)}, target ${
    show(target)
  }: ${detail}`;
}

function failureText(failures: readonly ErrorId[]): string {
  return [...new Set(failures)].sort().join(" ");
}

// ------------------------------------------------------------------- the laws

Deno.test("each generated type fits itself on both implementations", () => {
  const failures: string[] = [];
  let checked = 0;
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    const g = world.generator;
    const types = [...g.names];
    for (let index = 0; index < TYPES_PER_SEED; index++) {
      types.push(anyType(g, 3));
    }
    for (const type of types) {
      const answers = bothAnswers(world, type, type);
      checked++;
      if (!answers.checker || !answers.validator) {
        failures.push(pairText(seed, type, type, JSON.stringify(answers)));
      }
    }
  }
  assertEquals(failures.length, 0, report(failures));
  assertEquals(checked, 16248);
});

Deno.test("assignment of plain types is transitive on both implementations", () => {
  const failures: string[] = [];
  let checker = 0;
  let validator = 0;
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    const g = world.generator;
    const pool: Type[] = [];
    for (let index = 0; index < PLAIN_ROOTS_PER_SEED; index++) {
      const root = plainType(g, 2);
      pool.push(root, widen(g, root), widen(g, widen(g, root)));
    }
    const decide = (fit: (source: Type, target: Type) => boolean) =>
      pool.map((source) => pool.map((target) => fit(source, target)));
    const checkerTable = decide((s, t) => checkerFits(world, s, t));
    const validatorTable = decide((s, t) => fits(world.env, s, t));
    const check = (name: string, table: readonly (readonly boolean[])[]) => {
      let premises = 0;
      for (let a = 0; a < pool.length; a++) {
        for (let b = 0; b < pool.length; b++) {
          if (!table[a][b] || a === b) continue;
          for (let c = 0; c < pool.length; c++) {
            if (!table[b][c] || b === c) continue;
            premises++;
            if (!table[a][c]) {
              failures.push(
                `${name} ${
                  pairText(seed, pool[a], pool[c], `through ${show(pool[b])}`)
                }`,
              );
            }
          }
        }
      }
      return premises;
    };
    checker += check("checker", checkerTable);
    validator += check("validator", validatorTable);
  }
  assertEquals(failures.length, 0, report(failures));
  assertEquals({ checker, validator }, { checker: 21028, validator: 21028 });
});

Deno.test("the checker and the validator agree on generated pairs", () => {
  const disagreements: string[] = [];
  const answers = { fit: 0, rejected: 0 };
  const fibers = { fit: 0, rejected: 0, failuresDiffer: 0 };
  const kinds = new Map<string, number>();
  let authorityDecided = 0;
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    const g = world.generator;
    for (let index = 0; index < PAIRS_PER_SEED; index++) {
      const [first, second] = generatePair(g);
      kinds.set(first.kind, (kinds.get(first.kind) ?? 0) + 1);
      for (const [source, target] of [[first, second], [second, first]]) {
        const { checker, validator } = bothAnswers(world, source, target);
        if (checker !== validator) {
          disagreements.push(
            pairText(
              seed,
              source,
              target,
              `checker ${checker}, validator ${validator}`,
            ),
          );
          continue;
        }
        if (checker) answers.fit++;
        else answers.rejected++;
        // `isAssignable` takes no module, so it has every sealed authority.
        const withoutModule = world.table.isAssignable(
          typeFromIr(world.table, source),
          typeFromIr(world.table, target),
        );
        if (withoutModule !== checker) authorityDecided++;
        if (source.kind === "fiber" && target.kind === "fiber") {
          if (checker) fibers.fit++;
          else fibers.rejected++;
          if (
            source.result === target.result &&
            failureText(source.failures) !== failureText(target.failures)
          ) {
            fibers.failuresDiffer++;
            if (checker) {
              disagreements.push(
                pairText(seed, source, target, "fits with other failures"),
              );
            }
          }
        }
      }
    }
  }
  assertEquals(disagreements.length, 0, report(disagreements));
  assertEquals(answers, { fit: 32964, rejected: 47036 });
  assertEquals(fibers, { fit: 1748, rejected: 7308, failuresDiffer: 7150 });
  assertEquals(authorityDecided, 940);
  assertEquals(Object.fromEntries([...kinds].sort()), {
    "closeable-scope": 175,
    "retry-schedule": 1141,
    array: 1933,
    codec: 1143,
    effect: 1157,
    fiber: 5074,
    function: 3964,
    literal: 930,
    map: 1111,
    named: 5403,
    option: 1963,
    primitive: 1260,
    provider: 1144,
    record: 1105,
    ref: 1153,
    schedule: 2481,
    schema: 1104,
    set: 1144,
    sink: 2433,
    stream: 1122,
    tuple: 1083,
    union: 1977,
  });
});

// ------------------------------------------------------------ literal cases

const IDENTITY_A: Type = named("type:owner#A");
const IDENTITY_B: Type = named("type:owner#B");
const OWN_SEALED: Type = named("type:owner#OwnSealed");
const FOREIGN_SEALED: Type = named("type:other#ForeignSealed");
const E0: ErrorId = "error:owner#E0";
const E1: ErrorId = "error:owner#E1";

const LITERAL_SIDES = sidesOf({
  types: [
    { id: "type:owner#A", definition: { kind: "nominal", base: INT } },
    { id: "type:owner#B", definition: { kind: "nominal", base: INT } },
    {
      id: "type:owner#OwnSealed",
      definition: { kind: "nominal", base: INT, sealed: true },
    },
    {
      id: "type:other#ForeignSealed",
      definition: { kind: "nominal", base: INT, sealed: true },
    },
  ],
  errors: [
    { id: E0, fields: [] },
    { id: E1, fields: [] },
  ],
});

function execution(mode: Execution): Type {
  return {
    kind: "function",
    execution: mode,
    parameters: [INT],
    result: STRING,
    effects: { failures: [], requirements: [] },
  };
}

function fiber(failures: readonly ErrorId[]): Type {
  return { kind: "fiber", result: INT, failures };
}

function schemaWith(makeInput?: Type): Type {
  return {
    kind: "schema",
    decoded: INT,
    encoded: INT,
    decodeRequirements: [],
    encodeRequirements: [],
    ...(makeInput === undefined ? {} : { makeInput }),
  };
}

const YES = { checker: true, validator: true };
const NO = { checker: false, validator: false };

Deno.test("nominal widening is not transitive", () => {
  assertEquals(bothAnswers(LITERAL_SIDES, IDENTITY_A, INT), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, INT, IDENTITY_B), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, IDENTITY_A, IDENTITY_B), NO);
});

Deno.test("function lifting is not transitive", () => {
  const union: Type = { kind: "union", members: [execution("effect"), UNIT] };
  assertEquals(
    bothAnswers(LITERAL_SIDES, execution("pure"), execution("effect")),
    YES,
  );
  assertEquals(bothAnswers(LITERAL_SIDES, execution("effect"), union), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, execution("pure"), union), NO);
});

Deno.test("a Fiber fits only with an equal failure set", () => {
  assertEquals(
    bothAnswers(LITERAL_SIDES, fiber([E0, E1]), fiber([E1, E0])),
    YES,
  );
  assertEquals(bothAnswers(LITERAL_SIDES, fiber([E0]), fiber([E1])), NO);
  assertEquals(bothAnswers(LITERAL_SIDES, fiber([E0]), fiber([E0, E1])), NO);
  assertEquals(bothAnswers(LITERAL_SIDES, fiber([E0, E1]), fiber([E0])), NO);
  assertEquals(bothAnswers(LITERAL_SIDES, fiber([]), fiber([E0])), NO);
});

Deno.test("a sealed type widens and adopts only in its own module", () => {
  assertEquals(bothAnswers(LITERAL_SIDES, OWN_SEALED, INT), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, INT, OWN_SEALED), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, FOREIGN_SEALED, INT), NO);
  assertEquals(bothAnswers(LITERAL_SIDES, INT, FOREIGN_SEALED), NO);
});

Deno.test("a Schema make input keeps its sealed authority", () => {
  const wide = schemaWith(FOREIGN_SEALED);
  assertEquals(bothAnswers(LITERAL_SIDES, wide, schemaWith()), NO);
  assertEquals(bothAnswers(LITERAL_SIDES, schemaWith(), wide), NO);
  const own = schemaWith(OWN_SEALED);
  assertEquals(bothAnswers(LITERAL_SIDES, own, schemaWith()), YES);
  assertEquals(bothAnswers(LITERAL_SIDES, schemaWith(), own), YES);
});

/** The diagnostic codes of each side for the module `main` of a project. */
function sourceCodes(lib: string, main: string) {
  const updated = new Program("").update({
    set: new Map([
      ["effektive.json", "{}"],
      ["lib.eff", lib],
      ["main.eff", main],
    ]),
  });
  if (!updated.ok) throw new Error("the project has no valid configuration");
  const revision = updated.value;
  const lowered = new Map<string, Result<ModuleIR, LowerError>>();
  for (const name of revision.moduleNames()) {
    const result = revision.lowered(name);
    if (result !== undefined) lowered.set(name, result);
  }
  return {
    checker: revision.diagnostics.map((item) => item.code),
    validator: validateRevision(revision, lowered).get("main")?.map((item) =>
      item.code
    ),
  };
}

Deno.test("an open identity make input interns as the plain Schema", () => {
  const plain = typeFromIr(LITERAL_SIDES.table, schemaWith());
  assertEquals(typeFromIr(LITERAL_SIDES.table, schemaWith(IDENTITY_A)), plain);
});

const POSITIVE_LIB = "export sealed type Positive = int\n";
const POSITIVE_IMPORT =
  `import { Positive } from "./lib.eff"\ntype Whole = int\n`;
const POSITIVE_TYPES = `type R = { s: Schema<int, int, never, never, Positive> }
type Q = { s: Schema<int> }
`;

Deno.test("a Schema with a foreign sealed make input does not widen", () => {
  const main = POSITIVE_IMPORT + POSITIVE_TYPES +
    "export const f = (r: R): Q => ({ s: r.s })\n";
  assertEquals(sourceCodes(POSITIVE_LIB, main), {
    checker: ["type-mismatch/003"],
    validator: undefined,
  });
});

Deno.test("the owner widens a Schema with its own sealed make input", () => {
  const main = "export sealed type Positive = int\n" + POSITIVE_TYPES +
    "export const f = (r: R): Q => ({ s: r.s })\n";
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

Deno.test("equal Schemas with a foreign sealed make input match", () => {
  const main = POSITIVE_IMPORT +
    `type R = { s: Schema<int, int, never, never, Positive> }
type Q = { s: Schema<int, int, never, never, Positive> }
export const f = (r: R): Q => ({ s: r.s })
`;
  assertEquals(sourceCodes(POSITIVE_LIB, main), { checker: [], validator: [] });
});

Deno.test("schema rejects a foreign sealed make input", () => {
  const main = POSITIVE_IMPORT +
    `type S = Schema<int, int, never, never, Positive>
export const s: S = schema()
`;
  assertEquals(sourceCodes(POSITIVE_LIB, main), {
    checker: ["type-mismatch/010"],
    validator: undefined,
  });
});

// An equivalent make input is not a changed make input, and the rule keeps
// equivalent aliases compatible. The result keeps the name of a named Schema.
Deno.test("schema accepts a named Schema type", () => {
  const main = `type S = Schema<int>
export const s: S = schema()
`;
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

Deno.test("schema accepts a sealed make input of the owner", () => {
  const main = `export sealed type Positive = int
type S = Schema<int, int, never, never, Positive>
export const s: S = schema()
`;
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

Deno.test("schema accepts an open identity make input", () => {
  const main = `export type Cents = int
type S = Schema<int, int, never, never, Cents>
export const s: S = schema()
`;
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

Deno.test("schema accepts a transparent alias make input", () => {
  const main = `type Rec = { a: int }
type A = Rec
type S = Schema<Rec, Rec, never, never, A>
export const s: S = schema()
`;
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

Deno.test("schema accepts an owned make input without a named Schema", () => {
  const main = `type Int = int
export sealed type Rec = { a: Int }
export const s: Schema<{ a: Int }, { a: Int }, never, never, Rec> = schema()
`;
  assertEquals(sourceCodes("", main), { checker: [], validator: [] });
});

/** A recursive Schema with the given annotations and body. */
function recursiveProgram(
  annotation: string,
  self: string,
  result: string,
  body: string,
): string {
  return `type Int = int
type Tree = { value: Int, children: Tree[] }
type S = Schema<Tree>
const integer: Schema<Int> = schema()
export const s: ${annotation} = schemaRecursive((self: ${self}): ${result} =>
  ${body}
)
`;
}

const RECURSIVE_BODY =
  "schemaStruct({ value: integer, children: schemaArray(self) })";

// The checker tests that the expected type fits the parameter, and that the
// result fits the expected type. A named Schema and its body fit each other.
Deno.test("schemaRecursive accepts a named Schema type in each position", () => {
  const passes = { checker: [], validator: [] };
  assertEquals(
    sourceCodes("", recursiveProgram("S", "S", "S", RECURSIVE_BODY)),
    passes,
  );
  assertEquals(
    sourceCodes(
      "",
      recursiveProgram("S", "Schema<Tree>", "Schema<Tree>", RECURSIVE_BODY),
    ),
    passes,
  );
  assertEquals(
    sourceCodes("", recursiveProgram("S", "S", "Schema<Tree>", RECURSIVE_BODY)),
    passes,
  );
  assertEquals(
    sourceCodes("", recursiveProgram("S", "Schema<Tree>", "S", RECURSIVE_BODY)),
    passes,
  );
  assertEquals(
    sourceCodes("", recursiveProgram("Schema<Tree>", "S", "S", RECURSIVE_BODY)),
    passes,
  );
  assertEquals(
    sourceCodes(
      "",
      recursiveProgram(
        "Schema<Tree>",
        "Schema<Tree>",
        "Schema<Tree>",
        RECURSIVE_BODY,
      ),
    ),
    passes,
  );
});

Deno.test("schemaRecursive rejects a parameter that the Schema does not fit", () => {
  assertEquals(
    sourceCodes(
      "",
      recursiveProgram("S", "Schema<Int>", "S", RECURSIVE_BODY),
    ),
    {
      checker: ["type-mismatch/003", "type-mismatch/003"],
      validator: undefined,
    },
  );
});

Deno.test("schemaMake with a literal and a foreign sealed make input", () => {
  const main = POSITIVE_IMPORT +
    `type R = { s: Schema<int, int, never, never, Positive> }
export const f = (r: R): Whole fails SchemaIssue => schemaMake(r.s, 1)
`;
  assertEquals(sourceCodes(POSITIVE_LIB, main), {
    checker: ["type-mismatch/003"],
    validator: undefined,
  });
});

Deno.test("schemaMake with a foreign sealed value and make input", () => {
  const main = POSITIVE_IMPORT +
    `type R = { s: Schema<int, int, never, never, Positive> }
export const f = (r: R, p: Positive): Whole fails SchemaIssue =>
  schemaMake(r.s, p)
`;
  assertEquals(sourceCodes(POSITIVE_LIB, main), { checker: [], validator: [] });
});

// The rule lets another module compare primitive values. A comparison with
// `null` reads the value and needs no sealed authority, on both sides.
Deno.test("a null comparison of a foreign sealed type passes on both sides", () => {
  const lib =
    "export sealed type Code = null | 1\nexport type Flag = boolean\n";
  const main = `import { Code, Flag } from "./lib.eff"
export const f = (c: Code): Flag => c === null
`;
  assertEquals(sourceCodes(lib, main), { checker: [], validator: [] });
});

Deno.test("a not-equal null comparison of a foreign sealed type passes on both sides", () => {
  const lib =
    "export sealed type Code = null | 1\nexport type Flag = boolean\n";
  const main = `import { Code, Flag } from "./lib.eff"
export const f = (c: Code): Flag => c !== null
`;
  assertEquals(sourceCodes(lib, main), { checker: [], validator: [] });
});

Deno.test("a null comparison with null on the left passes on both sides", () => {
  const lib =
    "export sealed type Code = null | 1\nexport type Flag = boolean\n";
  const main = `import { Code, Flag } from "./lib.eff"
export const f = (c: Code): Flag => null === c
`;
  assertEquals(sourceCodes(lib, main), { checker: [], validator: [] });
});

Deno.test("a null comparison of a foreign sealed type without null stays rejected", () => {
  const lib = "export sealed type Small = 1 | 2\nexport type Flag = boolean\n";
  const main = `import { Small, Flag } from "./lib.eff"
export const f = (c: Small): Flag => c === null
`;
  assertEquals(sourceCodes(lib, main), {
    checker: ["type-mismatch/007"],
    validator: undefined,
  });
});
