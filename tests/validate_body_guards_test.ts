// Proves guard conditions of the body validator in src/core/validate/expr.ts.
// A valid program kills a mutant that rejects valid code. A forged IR kills a
// mutant that accepts invalid code. Each test covers one guard: tagMayEqual,
// the sealed update, refinement adoption, the checked entry and borrow
// parameters, the field read, the reserved errors, and the builtin callbacks.

import { assert, assertEquals } from "@std/assert";
import {
  type ErrorId,
  type FunctionDecl,
  type ModuleIR,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  type Type,
  type TypeDecl,
} from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { allExprs, forgedModule } from "./helpers.ts";

function accepted(source: string): string[] {
  return forgedModule(source, () => {});
}

Deno.test("an owner module updates its own sealed record", () => {
  assertEquals(
    accepted(`export sealed type Box = { n: int }
export const make = (): Box => Box({ n: 1 })
export const bump = (b: Box): Box => ({ ...b, n: 2 })
`),
    [],
  );
});

Deno.test("a pure value adopts a refined type from the branch fact", () => {
  assertEquals(
    accepted(`type Positive = int where n => n > 0
type Pair = { n: int }
const f = (p: Pair): Positive => if (p.n > 1) { p.n - 1 } else { 1 }
`),
    [],
  );
});

Deno.test("an effectful match step keeps the branch facts", () => {
  assertEquals(
    accepted(`type Positive = int where n => n > 0
type Pair = { n: int }
type Int = int
service Log { write(n: Int): Int }
const f = (p: Pair): Positive uses Log.write => if (p.n > 1) { match (p.n) { 2 => Log.write(1), _ => Log.write(2) }; p.n - 1 } else { 1 }
`),
    [],
  );
});

const ALIASES = `type Int = int
type Text = string
type A = Int
type B = Text
const f = (x: A): Text => match x { 1 => "a", _ => "b" }
`;

function typeOf(ir: ModuleIR, name: string): TypeDecl {
  const found = ir.declarations.find((d) =>
    d.kind === "type" && d.name === name
  );
  assert(found?.kind === "type", name);
  return found;
}

function literalPattern(ir: ModuleIR): { value: unknown } {
  const [match] = allExprs(ir, "match");
  const pattern = match.arms[0].pattern;
  assert(pattern.kind === "literal");
  return pattern;
}

const named = (name: string): Type => ({ kind: "named", id: `type:m#${name}` });

Deno.test("tagMayEqual accepts a literal when the alias chain cycles", () => {
  assertEquals(
    forgedModule(ALIASES, (ir) => {
      Object.assign(typeOf(ir, "A"), {
        definition: {
          kind: "alias",
          type: { kind: "union", members: [named("B"), named("Int")] },
        },
      });
      Object.assign(typeOf(ir, "B"), {
        definition: {
          kind: "alias",
          type: { kind: "union", members: [named("A"), named("Text")] },
        },
      });
      Object.assign(literalPattern(ir), { value: true });
    }),
    [
      "validation/002 declarations[2]: the type type:m#A refers to itself; version 0 has no recursive types",
    ],
  );
});

Deno.test("a literal pattern of the wrong primitive does not match the subject", () => {
  assertEquals(
    forgedModule(ALIASES, (ir) => {
      Object.assign(literalPattern(ir), { value: "a" });
    }),
    [
      `validation/002 declarations[4].body.arms[0].pattern: the literal "a" does not belong to the subject of type type:m#A`,
    ],
  );
});

Deno.test("a literal pattern does not match a named type without a base", () => {
  assertEquals(
    forgedModule(ALIASES, (ir) => {
      const [match] = allExprs(ir, "match");
      Object.assign(match.subject, { type: named("Missing") });
    }),
    [
      "validation/001 declarations[4].body.subject.type: the type type:m#Missing is not declared",
      "validation/002 declarations[4].body.arms[0].pattern: the literal 1 does not belong to the subject of type type:m#Missing",
    ],
  );
});

/** Make `A` the head of a chain of `length` aliases `N0`, `N1`, ... that ends in `last`. */
function forgeAliasChain(ir: ModuleIR, length: number, last: Type): void {
  const template = typeOf(ir, "B");
  const links = Array.from({ length }, (_, index): TypeDecl => ({
    ...structuredClone(template),
    id: `type:m#N${index}`,
    name: `N${index}`,
    definition: {
      kind: "alias",
      type: index === length - 1 ? last : named(`N${index + 1}`),
    },
  }));
  Object.assign(typeOf(ir, "A"), {
    definition: { kind: "alias", type: named("N0") },
  });
  Object.assign(ir, { declarations: [...ir.declarations, ...links] });
}

const INT: Type = { kind: "primitive", name: "int" };
const STRING: Type = { kind: "primitive", name: "string" };

Deno.test("a literal pattern reads an alias chain at the last level inside the depth bound", () => {
  assertEquals(
    forgedModule(ALIASES, (ir) => forgeAliasChain(ir, 1534, INT)),
    [],
  );
});

Deno.test("a literal pattern fails on an alias chain past the depth bound", () => {
  assertEquals(forgedModule(ALIASES, (ir) => forgeAliasChain(ir, 1535, INT)), [
    "validation/002 declarations[4].body.arms[0].pattern: the literal 1 does not belong to the subject of type type:m#A",
  ]);
});

Deno.test("a wrong literal pattern fails on an alias chain past the depth bound", () => {
  assertEquals(
    forgedModule(ALIASES, (ir) => forgeAliasChain(ir, 1535, STRING)),
    [
      "validation/002 declarations[4].body.arms[0].pattern: the literal 1 does not belong to the subject of type type:m#A",
    ],
  );
});

const PAIR = `type Pair = { n: int }
type Int = int
const f = (p: Pair): Int => p.n
`;

Deno.test("a field read of a missing field names the record type", () => {
  assertEquals(
    forgedModule(PAIR, (ir) => {
      const [read] = allExprs(ir, "get");
      Object.assign(read, { field: "m" });
    }),
    [
      "validation/002 declarations[2].body.field: the type { n: int } has no field m",
    ],
  );
});

Deno.test("a field read of a value without fields says so", () => {
  assertEquals(
    forgedModule(PAIR, (ir) => {
      const [read] = allExprs(ir, "get");
      const declaration = ir.declarations.find((d) => d.kind === "function");
      assert(declaration?.kind === "function");
      Object.assign(declaration.parameters[0], { type: named("Int") });
      Object.assign(declaration.type.parameters, [named("Int")]);
      Object.assign(read.record, { type: named("Int") });
    }),
    [
      "validation/002 declarations[2].body.field: a value of type type:m#Int has no fields",
    ],
  );
});

const CONSTRUCTED = `error Stop = {}
const f = (): Stop => Stop({})
`;

function forgeConstructedError(id: ErrorId): string[] {
  return forgedModule(CONSTRUCTED, (ir) => {
    const construction = allExprs(ir, "error").find((e) => "error" in e);
    assert(construction !== undefined);
    Object.assign(construction, { error: id });
  });
}

Deno.test("source code cannot construct the reserved SchemaError", () => {
  assertEquals(forgeConstructedError(SCHEMA_ERROR_ID), [
    "validation/002 declarations[1].body: reserved target errors cannot be constructed as source errors",
  ]);
});

Deno.test("source code cannot construct the reserved SchemaIssue", () => {
  assertEquals(forgeConstructedError(SCHEMA_ISSUE_ID), [
    "validation/002 declarations[1].body: reserved target errors cannot be constructed as source errors",
  ]);
});

const HOST_FILES = {
  "effektive.json": JSON.stringify({
    host: { files: { interface: "./host.effi", module: "./host.ts" } },
  }),
  "host.effi": `export opaque type Handle
export service Files { open(): Handle }
`,
  "m.eff": `import { Handle } from "host:files"
type Int = int
error Boom = {}
export const peek = (borrow handle: Handle): Int => 1
`,
};

/** Lower the host program, apply `change` to the IR, and return the validator output. */
function forgedHostModule(change: (ir: ModuleIR) => void): string[] {
  const checked = checkProject(memoryHost(HOST_FILES), "", ["m.eff"]);
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const lowered = lowerProject(checked.value).get("m");
  assert(lowered?.ok);
  const ir = structuredClone(lowered.value);
  change(ir);
  return validateModule(ir, new Map(Object.entries(HOST_FILES))).map((d) =>
    `${d.code} ${d.message}`
  );
}

function peekOf(ir: ModuleIR): FunctionDecl {
  const found = ir.declarations.find((d) =>
    d.kind === "function" && d.name === "peek"
  );
  assert(found?.kind === "function");
  return found;
}

Deno.test("a borrow parameter of a named type that is not opaque is rejected", () => {
  assertEquals(forgedHostModule(() => {}), []);
  assertEquals(
    forgedHostModule((ir) => {
      const peek = peekOf(ir);
      const boom: Type = { kind: "named", id: "error:m#Boom" };
      Object.assign(peek.parameters[0], { type: boom });
      Object.assign(peek.type.parameters, [boom]);
    }),
    [
      "validation/002 declarations[2].parameters[0]: a borrow parameter needs an opaque type",
    ],
  );
});

const CHECKED_ENTRY = `type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)
`;

Deno.test("a checked entry parameter must have a schema-derivable type", () => {
  assertEquals(
    forgedModule(CHECKED_ENTRY, (ir) => {
      const entry = ir.declarations.find((d) =>
        d.kind === "function" && d.name === "entry"
      );
      assert(entry?.kind === "function");
      const deferred: Type = {
        kind: "effect",
        result: { kind: "primitive", name: "string" },
        effects: { failures: [], requirements: [] },
      };
      Object.assign(entry.parameters[0], { type: deferred });
      Object.assign(entry.type, { parameters: [deferred] });
    }),
    [
      "validation/003 declarations[2].type.checked: a checked function parameter needs a schema-derivable contract",
      "validation/002 declarations[2].parameters[0].type: a checked entry parameter needs a schema-derivable closed data type",
      "validation/002 declarations[2].body.arguments[0].record.type: expected Effect<string, never, never>, recorded { name: type:m#Text }",
      "validation/002 declarations[2].body.arguments[0].field: a value of type Effect<string, never, never> has no fields",
    ],
  );
});

const BUILTINS = `error Stop = {}
type Int = int
type Ints = Int[]
const total = (xs: Ints): Int => fold(xs, 0, (a: Int, b: Int): Int => a + b)
const doubled = (xs: Ints): Ints => map(xs, (a: Int): Int => a + 1)
const probe = (): Int => ((a: Int, b: Int): Int => a + b)(1, 2)
`;

/** The prelude import of the builtin `name`. */
function builtinImport(ir: ModuleIR, name: string) {
  const found = ir.imports.flatMap((i) => i.values).find((v) =>
    v.name.startsWith(`$builtin/${name}/`)
  );
  assert(found !== undefined, name);
  return found;
}

Deno.test("a call with three arguments to an unknown builtin has no callback", () => {
  assertEquals(
    forgedModule(BUILTINS, (ir) => {
      const renamed = JSON.parse(
        JSON.stringify(ir).replaceAll("$builtin/fold/", "$builtin/zip/"),
      );
      Object.assign(ir, renamed);
    }),
    [
      "validation/001 imports[0].values[0].id: a builtin identity has the form value:m#$builtin/<name>/<hash>, recorded value:m#$builtin/zip/5d579b68b56f",
    ],
  );
});

Deno.test("only a reference callee names a builtin", () => {
  assertEquals(
    forgedModule(BUILTINS, (ir) => {
      const map = builtinImport(ir, "map");
      const probe = allExprs(ir, "call").find((c) =>
        c.callee.kind !== "reference" && c.arguments.length === 2
      );
      assert(probe !== undefined);
      Object.assign(probe.callee, { target: map.id });
    }),
    [],
  );
});

Deno.test("a builtin callback keeps the failures of the builtin", () => {
  assertEquals(
    forgedModule(BUILTINS, (ir) => {
      const map = builtinImport(ir, "map");
      assert(map.type.kind === "function");
      Object.assign(map.type.effects, { failures: ["error:m#Stop"] });
    }),
    [
      "validation/002 imports[0].values[1].type: a pure function type must have empty failure and requirement rows",
      "validation/003 imports[0].values[1].type: map invokes its callback and carries its failures and requirements",
      "validation/003 declarations[4].type.effects.failures: an inferred contract equals the body: expected [error:m#Stop], recorded []",
      "validation/004 declarations[4].type.execution: expected effect, recorded pure",
      "validation/002 declarations[4].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[4].body.effects.failures: expected [error:m#Stop], recorded []",
      "validation/003 declarations[4].body: map must invoke the callback with its declared failures and requirements",
      "validation/004 declarations[4].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("a builtin callback must be a function", () => {
  assertEquals(
    forgedModule(BUILTINS, (ir) => {
      const doubled = allExprs(ir, "call").find((c) =>
        c.callee.kind === "reference" && c.arguments.length === 2 &&
        c.arguments[1].kind === "closure"
      );
      assert(doubled !== undefined);
      Object.assign(doubled.arguments, [
        doubled.arguments[0],
        doubled.arguments[0],
      ]);
    }),
    [
      "validation/003 declarations[4].body: map must invoke the callback with its declared failures and requirements",
      "validation/002 declarations[4].body.arguments[1]: the argument has type type:m#Ints, which does not fit the parameter (type:m#Int) => type:m#Int [pure]",
    ],
  );
});
