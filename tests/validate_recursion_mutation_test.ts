// Forged-IR tests for the recursion guard of the validator
// (src/core/validate/recursion_checks.ts). The checker rejects each forged
// shape before lowering, so each test lowers an accepted seed module and
// replaces one declaration. The tests call `checkRecursion` alone, so a
// finding of another walker never mixes into the expected list. The deep
// cases sit at a node of depth 1536, the bound `MAX_DEPTH` of the validator.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import type { Field, ModuleIR, Type, TypeDecl } from "../src/core/ir.ts";
import { Report } from "../src/core/validate/report.ts";
import { checkRecursion } from "../src/core/validate/recursion_checks.ts";
import { buildWorld } from "../src/core/validate/world_table.ts";

type Definition = TypeDecl["definition"];

const INT: Type = { kind: "primitive", name: "int" };
const named = (id: `type:${string}` | `error:${string}`): Type => ({
  kind: "named",
  id,
});
const array = (element: Type): Type => ({ kind: "array", element });
const field = (name: string, type: Type, optional = false): Field => ({
  name,
  type,
  optional,
});
const record = (...fields: Field[]): Type => ({ kind: "record", fields });
const union = (...members: Type[]): Type => ({ kind: "union", members });
const alias = (type: Type): Definition => ({ kind: "alias", type });
const tagged = (base: Type): Definition => ({
  kind: "nominal",
  base,
  tagged: true,
});
const identity = (base: Type): Definition => ({ kind: "nominal", base });

/** `leaf` below `levels` array wrappers. */
function arrays(levels: number, leaf: Type): Type {
  let type = leaf;
  for (let i = 0; i < levels; i++) type = array(type);
  return type;
}

/** `leaf` below `levels` records that each hold one required field. */
function records(levels: number, leaf: Type): Type {
  let type = leaf;
  for (let i = 0; i < levels; i++) type = record(field("x", type));
  return type;
}

function lower(files: Readonly<Record<string, string>>, name = "m"): ModuleIR {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const lowered = lowerProject(checked.value).get(name);
  assert(lowered?.ok === true, name);
  return structuredClone(lowered.value);
}

/** The module with the definition of the type declaration `name` replaced. */
function redefine(
  ir: ModuleIR,
  name: string,
  definition: Definition,
  opaque = false,
): ModuleIR {
  const found = ir.declarations.find((d) => d.name === name);
  assert(found?.kind === "type", name);
  return {
    ...ir,
    declarations: ir.declarations.map((d) =>
      d === found ? { ...found, definition, ...(opaque ? { opaque } : {}) } : d
    ),
  };
}

/** The reports of the recursion check alone, as code and message. */
function recursion(ir: ModuleIR): string[] {
  const report = new Report();
  checkRecursion({ world: buildWorld(ir), report }, ir);
  return report.items.map((d) => `${d.code} ${d.message}`);
}

const refers = (index: number, id: string) =>
  `validation/002 declarations[${index}]: the type ${id} refers to itself; version 0 has no recursive types`;
const deep = (index: number) =>
  `validation/002 declarations[${index}]: type nesting exceeds 1536 levels`;

const TAG_SEED = `type A = "a"
type B = "b"
type T = { tag: A, next: T[] } | { tag: B }`;

const LEAF_SEED = `type Leaf = { v: int }
type Node = { left: Tree }
type Tree = Node | Leaf`;

const OPTIONAL_SEED = `type Node = { left?: Tree }
type Other = { right?: Tree }
type Tree = Node | Other`;

Deno.test("a guarded tagged union passes, and an option beside the guard makes it recur", () => {
  const seed = lower({ "m.eff": TAG_SEED });
  assertEquals(recursion(seed), []);
  const forged = redefine(
    seed,
    "T",
    alias(union(
      record(
        field("tag", named("type:m#A")),
        field("next", array(named("type:m#T"))),
      ),
      record(
        field("tag", named("type:m#B")),
        field("opt", { kind: "option", element: INT }),
      ),
    )),
  );
  assertEquals(recursion(forged), [refers(2, "type:m#T")]);
});

Deno.test("a union whose members all reach the group gives no base case", () => {
  const seed = lower({ "m.eff": OPTIONAL_SEED });
  assertEquals(recursion(seed), []);
  const required = (name: string) =>
    tagged(record(field(name, named("type:m#Tree"))));
  const forged = redefine(
    redefine(seed, "Node", required("left")),
    "Other",
    required("right"),
  );
  assertEquals(recursion(forged), [
    refers(0, "type:m#Node"),
    refers(2, "type:m#Tree"),
  ]);
});

Deno.test("a union member that is no name and no mention of the group is a base case", () => {
  const seed = lower({ "m.eff": LEAF_SEED });
  assertEquals(recursion(seed), []);
  const forged = redefine(
    seed,
    "Tree",
    alias(union(named("type:m#Node"), INT)),
  );
  assertEquals(recursion(forged), []);
});

Deno.test("optional fields and plain fields guard a union of records that all reach the group", () => {
  const ir = lower({
    "m.eff": `type Node = { next?: Tree, v: int }
type Other = { next?: Tree }
type Tree = Node | Other`,
  });
  assertEquals(recursion(ir), []);
});

Deno.test("a mention nested 1536 levels deep still counts as a mention", () => {
  const seed = lower({ "m.eff": LEAF_SEED });
  const forged = (levels: number) =>
    redefine(
      seed,
      "Tree",
      alias(union(named("type:m#Node"), arrays(levels, named("type:m#Node")))),
    );
  assertEquals(recursion(forged(1535)), [refers(1, "type:m#Node")]);
  assertEquals(recursion(forged(1536)), [
    refers(1, "type:m#Node"),
    deep(2),
  ]);
});

Deno.test("a required edge at depth 1536 closes the cycle, and one at 1537 does not", () => {
  const seed = lower({ "m.eff": LEAF_SEED });
  const forged = (levels: number) =>
    redefine(
      redefine(seed, "Tree", alias(named("type:m#Node"))),
      "Node",
      tagged(records(levels, named("type:m#Tree"))),
    );
  assertEquals(recursion(forged(1535)), [refers(1, "type:m#Node")]);
  assertEquals(recursion(forged(1536)), [refers(1, "type:m#Node")]);
  assertEquals(recursion(forged(1537)), []);
});

Deno.test("a guarded edge at depth 1536 still joins the data group", () => {
  const seed = lower({
    "m.eff": `type Leaf = { v: int }
type Node = { left: A }
type A = Node[]
type Tree = Node | Leaf`,
  });
  assertEquals(recursion(seed), []);
  const forged = (levels: number) =>
    redefine(seed, "A", identity(arrays(levels, named("type:m#Node"))));
  assertEquals(recursion(forged(1535)), []);
  assertEquals(recursion(forged(1536)), []);
  assertEquals(recursion(forged(1537)), [deep(2)]);
});

Deno.test("a cycle through an error is reported at the error", () => {
  const seed = lower({ "m.eff": `error E = { t: T }\ntype T = { n: int }` });
  assertEquals(recursion(seed), []);
  const forged = redefine(
    seed,
    "T",
    identity(record(field("e", named("error:m#E")))),
  );
  assertEquals(recursion(forged), [refers(0, "error:m#E")]);
});

Deno.test("an opaque type that holds itself under an array is still a cycle", () => {
  const seed = lower({ "m.eff": "type H = { n: int }" });
  assertEquals(recursion(seed), []);
  const body = record(field("kids", array(named("type:m#H"))));
  assertEquals(recursion(redefine(seed, "H", identity(body))), []);
  assertEquals(recursion(redefine(seed, "H", identity(body), true)), [
    refers(0, "type:m#H"),
  ]);
});

Deno.test("a cycle among imported types is left to the module that declares it", () => {
  const seed = lower({
    "lib.eff": "export type I = int\n",
    "m.eff": 'import { I } from "./lib.eff"\nexport type T = I\n',
  });
  assertEquals(recursion(seed), []);
  const [lib] = seed.imports;
  const [imported] = lib.types;
  const forged: ModuleIR = {
    ...seed,
    imports: [{
      ...lib,
      types: [{ ...imported, definition: identity(named("type:lib#I")) }],
    }],
  };
  assertEquals(recursion(forged), []);
});

Deno.test("a type that holds itself in two fields gives one report", () => {
  const seed = lower({ "m.eff": "type T = { n: int }" });
  const forged = redefine(
    seed,
    "T",
    identity(record(
      field("a", named("type:m#T")),
      field("b", named("type:m#T")),
    )),
  );
  assertEquals(recursion(forged), [refers(0, "type:m#T")]);
});
