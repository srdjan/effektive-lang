// Tests for the validator rejection sites that no other fast test fires (plan
// stable-base-reset, SB4, finding SBF9). Each row lowers a valid program,
// forges one fact of the IR payload, runs the public entry `validateModule`,
// and requires the exact diagnostics. A row fails if its site is deleted.
//
// To add a row, append to ROWS. A row names the rejection site (`file:line` in
// src/core/validate), the program it forges from, the module of that program,
// a `change` function, and the literal diagnostics (`code path: message`).
// Add a program to PROGRAMS when the existing programs lack the construct.

import { assert, assertEquals } from "@std/assert";
import { checkProject } from "../src/core/check_project.ts";
import type {
  Declaration,
  Expr,
  FunctionDecl,
  ModuleIR,
  Type,
} from "../src/core/ir.ts";
import { lowerProject } from "../src/core/lower.ts";
import { memoryHost } from "../src/core/source.ts";
import { validateModule } from "../src/core/validate/index.ts";

// ------------------------------------------------------------------ programs

/** A deep mutable view of the IR, so that a row can forge one fact. */
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type ForgedIR = Mutable<ModuleIR>;

interface Program {
  readonly files: Readonly<Record<string, string>>;
  readonly entry: string;
}

const HOST_INTERFACE = `export opaque type Handle
export type Text = string
export service Files {
  open(): Handle
  read(borrow handle: Handle): Text
  close(borrow handle: Handle): void
  peek(): Text
  lookup(borrow handle: Handle): Text
}
`;

const CORE_SOURCE = `import { Handle, Text, Files } from "host:files"
type Int = int
type Small = int where n => n > 0
error Boom = { code: Int }
export const exported = (): Int => 1
const readBorrowed = (borrow handle: Handle): Text uses Files.read => Files.read(handle)
const pair = (): [Int, Int] => [1, 2]
const some1 = (): Option<Int> => Some(1)
const boom = (): Int fails Boom => fail(Boom({ code: 1 }))
const inferred = () => boom()
const failing = (): Int fails Boom => scoped(defer(() => boom()))
const inc = (n: Int): Int => n + 1
const piped = (a: Int): Int => a |> inc
const useHandle = (): Text uses Files.open | Files.read | Files.close =>
  withResource(() => Files.open(), (handle) => readBorrowed(handle), (handle) => Files.close(handle))
const useRecord = (): Int => withResource(() => ({ get: () => 1 }), (ops) => ops.get(), (ops) => {})
const outcome = (): Int => try { 1 } finally (o) { }
const sc = (): Int => scoped(defer(() => 1))
const fk = (): void => scoped(defer(() => forkScoped(defer(() => 1))))
const owner = (): void => {
  const o = makeScope()
  addScopeFinalizer(o, defer(() => {}))
  provideScope(o, defer(() => 1))
  closeScope(o)
}
const mapped = (): Int[] => map([1], (n) => n + 1)
`;

const PROGRAMS = {
  core: {
    files: {
      "effektive.json": JSON.stringify({
        host: { files: { interface: "./host.effi", module: "./host.ts" } },
      }),
      "host.effi": HOST_INTERFACE,
      "m.eff": CORE_SOURCE,
    },
    entry: "m.eff",
  },
} as const satisfies Readonly<Record<string, Program>>;

type ProgramName = keyof typeof PROGRAMS;

const lowered = new Map<ProgramName, ModuleIR>();

/** Lowers a program once and returns a fresh copy of its module for a forge. */
function baseOf(name: ProgramName): ForgedIR {
  let base = lowered.get(name);
  if (base === undefined) {
    const program: Program = PROGRAMS[name];
    const checked = checkProject(memoryHost(program.files), "", [
      program.entry,
    ]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    const module = lowerProject(checked.value).get("m");
    assert(module?.ok);
    assertEquals(
      validateModule(module.value, new Map(Object.entries(program.files))),
      [],
    );
    base = module.value;
    lowered.set(name, base);
  }
  // ModuleIR holds readonly arrays, which TypeScript does not accept as
  // mutable. The copy is private to one row, so the cast is safe.
  return structuredClone(base) as unknown as ForgedIR;
}

// ------------------------------------------------------------------ forge helpers

/** An illegal value for a typed field. A row uses it to forge a bad payload. */
function illegal(value: unknown): never {
  return value as never;
}

function declaration(ir: ForgedIR, name: string): Mutable<Declaration> {
  const found = ir.declarations.find((d) => d.name === name);
  assert(found !== undefined, name);
  return found;
}

function fn(ir: ForgedIR, name: string): Mutable<FunctionDecl> {
  const found = declaration(ir, name);
  assert(found.kind === "function", name);
  return found;
}

function find<K extends Expr["kind"]>(
  root: unknown,
  kind: K,
): Mutable<Extract<Expr, { kind: K }>> {
  let found: Mutable<Extract<Expr, { kind: K }>> | undefined;
  const visit = (value: unknown): void => {
    if (found !== undefined || typeof value !== "object" || value === null) {
      return;
    }
    if ((value as { kind?: unknown }).kind === kind) {
      found = value as Mutable<Extract<Expr, { kind: K }>>;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(root);
  assert(found !== undefined, kind);
  return found;
}

function hostImport(ir: ForgedIR): ForgedIR["imports"][number] {
  const found = ir.imports.find((i) => i.module === "host:files");
  assert(found !== undefined);
  return found;
}

function preludeImport(ir: ForgedIR): ForgedIR["imports"][number] {
  const found = ir.imports.find((i) => i.module === "effektive:prelude");
  assert(found !== undefined);
  return found;
}

function method(ir: ForgedIR, name: string) {
  const found = hostImport(ir).services[0].methods.find((m) => m.name === name);
  assert(found !== undefined, name);
  return found;
}

const INT: Type = { kind: "primitive", name: "int" };
const STRING: Type = { kind: "primitive", name: "string" };
const UNKNOWN: Type = { kind: "primitive", name: "unknown" };

/** A fresh literal expression of type int, copied from the `pair` function. */
function intLiteral(ir: ForgedIR): Mutable<Extract<Expr, { kind: "literal" }>> {
  return structuredClone(find(fn(ir, "pair").body, "literal"));
}

// ------------------------------------------------------------------ rows

interface Row {
  /** The rejection site: `file:line` under src/core/validate at the time of writing. */
  readonly site: string;
  readonly name: string;
  readonly program: ProgramName;
  readonly change: (ir: ForgedIR) => void;
  /** Each entry is `code path: message`, in the order that `validateModule` gives. */
  readonly expected: readonly string[];
}

const ROWS: readonly Row[] = [
  // ---------------------------------------------------------------- expr.ts
  {
    site: "expr.ts:266",
    name: "a parameter identity that is not local",
    program: "core",
    change: (ir) => {
      fn(ir, "inc").parameters[0].id = illegal("value:m#n");
    },
    expected: [
      "validation/001 declarations[10].parameters[0].id: value:m#n is not a local identity",
      "validation/001 declarations[10].body.left.target: the target local:m#inc/n is not a parameter, a binding, or a declaration in scope",
    ],
  },
  {
    site: "expr.ts:475",
    name: "more borrow flags than parameters",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.borrows = [true, true];
    },
    expected: [
      "validation/001 declarations[4].type: borrow flags must match function parameters",
      "validation/002 declarations[4].type.borrows: borrow flags must match function parameters",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect]",
    ],
  },
  {
    site: "expr.ts:484",
    name: "a borrow flag in the type that the parameter lacks",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").parameters[0].borrow = false;
    },
    expected: [
      "validation/002 declarations[4].parameters[0]: borrow parameter flag disagrees with function type",
    ],
  },
  {
    site: "expr.ts:497",
    name: "a borrow parameter of a type that is not opaque",
    program: "core",
    change: (ir) => {
      const f = fn(ir, "readBorrowed");
      f.parameters[0].type = INT;
      f.type.parameters[0] = INT;
    },
    expected: [
      "validation/002 declarations[4].parameters[0]: a borrow parameter needs an opaque type",
      "validation/002 declarations[4].body.arguments[0].type: expected int, recorded type:host#Handle",
      "validation/002 declarations[4].body.arguments[0]: the argument has type int, which does not fit the parameter type:host#Handle",
      "validation/002 declarations[12].body.use.body.callee.type: expected (int) => type:host#Text uses cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect]",
      "validation/002 declarations[12].body.use.body.arguments[0]: the argument has type type:host#Handle, which does not fit the parameter int",
    ],
  },
  {
    site: "expr.ts:505",
    name: "a borrow parameter whose type flag is false",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.borrows = [false];
    },
    expected: [
      "validation/002 declarations[4].type.borrows[0]: borrow flag missing from function type",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect]",
      "validation/006 declarations[12].body.use.body: borrowed handle may only pass to a borrow-qualified method",
    ],
  },
  {
    site: "expr.ts:513",
    name: "a borrow function that returns a value that is not data",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.result = UNKNOWN;
    },
    expected: [
      "validation/002 declarations[4].type.result: a borrow function must return data only",
      "validation/002 declarations[4].body: the body type type:host#Text does not fit the declared result unknown",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => unknown uses cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text uses cap:host#Files.read [effect]",
      "validation/002 declarations[12].body.use.body.type: expected unknown, recorded type:host#Text",
      "validation/002 declarations[12].body.use.body: the body type unknown does not fit the closure result type:host#Text",
    ],
  },
  {
    site: "expr.ts:557",
    name: "an inferred contract that omits a body failure",
    program: "core",
    change: (ir) => {
      fn(ir, "inferred").type.effects.failures = [];
    },
    expected: [
      "validation/003 declarations[8].type.effects.failures: an inferred contract equals the body: expected [error:m#Boom], recorded []",
    ],
  },
  {
    site: "expr.ts:737",
    name: "a Some value that does not fit the option element",
    program: "core",
    change: (ir) => {
      find(fn(ir, "some1").body, "some").type = {
        kind: "option",
        element: STRING,
      };
    },
    expected: [
      "validation/002 declarations[6].body: the body type Option<string> does not fit the declared result Option<type:m#Int>",
      "validation/002 declarations[6].body.value: the Some value has type int, which does not fit string",
    ],
  },
  {
    site: "expr.ts:1139",
    name: "a tuple element that does not fit the tuple type",
    program: "core",
    change: (ir) => {
      find(fn(ir, "pair").body, "tuple").type = {
        kind: "tuple",
        elements: [STRING, INT],
      };
    },
    expected: [
      "validation/002 declarations[5].body: the body type [string, int] does not fit the declared result [type:m#Int, type:m#Int]",
      "validation/002 declarations[5].body.elements[0]: the element has type int, which does not fit string",
    ],
  },
  {
    site: "expr.ts:1313",
    name: "an error construction of an undeclared error",
    program: "core",
    change: (ir) => {
      find(fn(ir, "boom").body, "error").error = "error:m#Nope";
    },
    expected: [
      "validation/001 declarations[7].body.error.error: the error error:m#Nope is not declared",
    ],
  },
  {
    site: "expr.ts:1616",
    name: "a generated capture marker that is false",
    program: "core",
    change: (ir) => {
      const block = find(fn(ir, "piped").body, "block");
      const step = block.steps.find((s) => s.kind === "bind");
      assert(step?.kind === "bind");
      step.generated = illegal(false);
    },
    expected: [
      "validation/002 declarations[11].body.steps[0].generated: a generated capture marker must be true",
    ],
  },
  // ---------------------------------------------------------------- scope.ts
  {
    site: "scope.ts:39",
    name: "scoped over a value that is not an Effect",
    program: "core",
    change: (ir) => {
      find(fn(ir, "sc").body, "scoped").value = intLiteral(ir);
    },
    expected: [
      "validation/006 declarations[15].body: scoped needs an Effect value",
    ],
  },
  {
    site: "scope.ts:60",
    name: "forkScoped over a job that is not an Effect",
    program: "core",
    change: (ir) => {
      find(fn(ir, "fk").body, "fork-scoped").job = intLiteral(ir);
    },
    expected: [
      "validation/006 declarations[16].body.value.job.body: forkScoped needs an Effect value",
    ],
  },
  {
    site: "scope.ts:64",
    name: "forkScoped over a job with typed failures",
    program: "core",
    change: (ir) => {
      find(fn(ir, "fk").body, "fork-scoped").job = structuredClone(
        find(fn(ir, "failing").body, "scoped").value,
      );
    },
    expected: [
      "validation/006 declarations[16].body.value.job.body: forkScoped needs an Effect value without typed failures",
    ],
  },
  {
    site: "scope.ts:104",
    name: "an explicit scope operation over a job that is not an Effect",
    program: "core",
    change: (ir) => {
      find(fn(ir, "owner").body, "provide-scope").job = intLiteral(ir);
    },
    expected: [
      "validation/006 declarations[17].body.steps[2].value: provide-scope needs an Effect value",
    ],
  },
  {
    site: "scope.ts:144",
    name: "an acquired record that has no operations",
    program: "core",
    change: (ir) => {
      find(fn(ir, "useRecord").body, "with-resource").acquire.type = illegal({
        ...find(fn(ir, "useRecord").body, "with-resource").acquire.type,
        result: { kind: "record", fields: [] },
      });
    },
    expected: [
      "validation/002 declarations[13].body: use and release must accept the acquired operation record",
      "validation/002 declarations[13].body.acquire.type.result: acquisition must return a nonempty record of required operations",
      "validation/002 declarations[13].body.acquire.body: the body type { get: () => int [pure] } does not fit the closure result {}",
    ],
  },
  {
    site: "scope.ts:160",
    name: "an operation that returns a value that is not data",
    program: "core",
    change: (ir) => {
      const acquire = find(fn(ir, "useRecord").body, "with-resource").acquire;
      assert(acquire.type.kind === "function");
      assert(acquire.type.result.kind === "record");
      const field = acquire.type.result.fields[0];
      assert(field.type.kind === "function");
      field.type.result = UNKNOWN;
    },
    expected: [
      "validation/002 declarations[13].body: use and release must accept the acquired operation record",
      "validation/002 declarations[13].body.acquire.type.result.get: an operation must take and return data-only values",
      "validation/002 declarations[13].body.acquire.body: the body type { get: () => int [pure] } does not fit the closure result { get: () => unknown [pure] }",
    ],
  },
  {
    site: "scope.ts:265",
    name: "an outcome binding over a result that is not data",
    program: "core",
    change: (ir) => {
      find(fn(ir, "outcome").body, "ensure").type = UNKNOWN;
    },
    expected: [
      "validation/002 declarations[14].body.type: an outcome binding needs a data-only protected result",
      "validation/002 declarations[14].body.type: the recomputed type int does not fit the recorded type unknown",
      'validation/002 declarations[14].body.finalizer.parameters[0]: the outcome has type { _tag: "Success", success: unknown } | { _tag: "Defect", message: string } | { _tag: "Interrupted" }, recorded { _tag: "Defect", message: string } | { _tag: "Interrupted" } | { _tag: "Success", success: type:m#Int }',
    ],
  },
  {
    site: "scope.ts:341",
    name: "a release that does not accept the acquired handle",
    program: "core",
    change: (ir) => {
      const release = find(fn(ir, "useHandle").body, "with-resource").release;
      assert(release.type.kind === "function");
      release.type.parameters[0] = INT;
    },
    expected: [
      "validation/002 declarations[12].body: use and release must accept the acquired operation record",
      "validation/002 declarations[12].body.release.type.parameters[0]: expected type:host#Handle, recorded int",
    ],
  },
  {
    site: "scope.ts:362",
    name: "a release that does not return void",
    program: "core",
    change: (ir) => {
      const release = find(fn(ir, "useHandle").body, "with-resource").release;
      assert(release.type.kind === "function");
      release.type.result = INT;
    },
    expected: [
      "validation/002 declarations[12].body.release.type.result: release must return void",
      "validation/002 declarations[12].body.release.body: the body type void does not fit the closure result int",
    ],
  },
  {
    site: "scope.ts:370",
    name: "a use callback that does not return data",
    program: "core",
    change: (ir) => {
      const use = find(fn(ir, "useHandle").body, "with-resource").use;
      assert(use.type.kind === "function");
      use.type.result = UNKNOWN;
    },
    expected: [
      "validation/002 declarations[12].body.type: expected unknown, recorded type:host#Text",
      "validation/002 declarations[12].body: the body type unknown does not fit the declared result type:host#Text",
      "validation/002 declarations[12].body.use.type.result: use must return data only",
      "validation/002 declarations[12].body.use.body: the body type type:host#Text does not fit the closure result unknown",
    ],
  },
  // ---------------------------------------------------------------- world.ts
  {
    site: "world.ts:542",
    name: "a host interface method that exposes a refined type",
    program: "core",
    change: (ir) => {
      method(ir, "peek").type.result = { kind: "named", id: "type:m#Small" };
    },
    expected: [
      "validation/002 imports[0].services[0].methods[3].type: host interfaces must expose unrefined data",
    ],
  },
  {
    site: "world.ts:575",
    name: "a service method with a wrong capability identity",
    program: "core",
    change: (ir) => {
      method(ir, "peek").id = "cap:host#Files.other";
    },
    expected: [
      "validation/001 imports[0].services[0].methods[3].id: expected the capability identity cap:host#Files.peek, recorded cap:host#Files.other",
    ],
  },
  {
    site: "world.ts:583",
    name: "a service that declares a capability twice",
    program: "core",
    change: (ir) => {
      const peek = method(ir, "peek");
      const lookup = method(ir, "lookup");
      lookup.name = peek.name;
      lookup.id = peek.id;
    },
    expected: [
      "validation/001 imports[0].services[0].methods[4].id: the capability cap:host#Files.peek is declared twice",
    ],
  },
  {
    site: "world.ts:593",
    name: "a service method that claims checked entry validation",
    program: "core",
    change: (ir) => {
      method(ir, "peek").type.checked = [true];
    },
    expected: [
      "validation/001 imports[0].services[0].methods[3].type: checked flags must be booleans and match function parameters",
      "validation/003 imports[0].services[0].methods[3].type.checked: a checked function must declare SchemaError",
      "validation/003 imports[0].services[0].methods[3].type.checked: a service method cannot claim checked entry validation",
    ],
  },
  {
    site: "world.ts:602",
    name: "a service method with the wrong number of borrow flags",
    program: "core",
    change: (ir) => {
      method(ir, "lookup").borrows = [];
    },
    expected: [
      "validation/002 imports[0].services[0].methods[4].borrows: borrow flags must match method parameters",
    ],
  },
  {
    site: "world.ts:612",
    name: "a service borrow parameter outside a host interface",
    program: "core",
    change: (ir) => {
      method(ir, "lookup").span.source = "m.eff";
    },
    expected: [
      "validation/002 imports[0].services[0].methods[4].borrows[0]: a service borrow parameter belongs in a host interface",
    ],
  },
  {
    site: "world.ts:624",
    name: "a service borrow parameter of a type that is not opaque",
    program: "core",
    change: (ir) => {
      method(ir, "lookup").type.parameters[0] = INT;
    },
    expected: [
      "validation/002 imports[0].services[0].methods[4].borrows[0]: a borrow parameter needs an opaque type",
    ],
  },
  {
    site: "world.ts:729",
    name: "a declaration with a wrong identity",
    program: "core",
    change: (ir) => {
      declaration(ir, "outcome").id = illegal("value:m#other");
    },
    expected: [
      "validation/001 declarations[14].id: expected the identity value:m#outcome, recorded value:m#other",
    ],
  },
  {
    site: "world.ts:776",
    name: "an export that appears twice",
    program: "core",
    change: (ir) => {
      ir.exports = [ir.exports[0], ir.exports[0]];
    },
    expected: [
      "validation/001 exports[1]: the export value:m#exported appears twice",
    ],
  },
  {
    site: "world.ts:1146",
    name: "a builtin whose type is not a function",
    program: "core",
    change: (ir) => {
      preludeImport(ir).values[0].type = INT;
    },
    expected: [
      "validation/002 imports[1].values[0].type: a builtin has a function type, recorded primitive",
      "validation/002 declarations[18].body.callee.type: expected int, recorded (int[], (int) => int [pure]) => int[] [pure]",
      "validation/002 declarations[18].body.callee: the callee has type int, which is not a function",
    ],
  },
  {
    site: "world.ts:1312",
    name: "an import payload that declares an identity twice",
    program: "core",
    change: (ir) => {
      const imp = hostImport(ir);
      imp.types.push(structuredClone(imp.types[0]));
    },
    expected: [
      "validation/001 imports[0].types[2].id: the payload declares type:host#Handle twice",
    ],
  },
  {
    site: "world.ts:1315",
    name: "a prelude payload that declares an identity of the module",
    program: "core",
    change: (ir) => {
      preludeImport(ir).values[0].id = illegal("value:m#mapped");
    },
    expected: [
      "validation/001 imports[1].exports: the prelude import exports exactly the builtin ids of its values",
      "validation/001 imports[1].exports[0]: the module effektive:prelude exports value:m#$builtin/map/a648b6255b2f, which its payload does not declare",
      "validation/001 imports[1].values[0].id: a builtin identity has the form value:m#$builtin/<name>/<hash>, recorded value:m#mapped",
      "validation/001 imports[1].values[0].id: the payload declares value:m#mapped, which this module declares itself",
      "validation/001 declarations[18].body.callee.target: the target value:m#$builtin/map/a648b6255b2f is not a parameter, a binding, or a declaration in scope",
    ],
  },
  {
    site: "world.ts:1367",
    name: "a prelude import with a type",
    program: "core",
    change: (ir) => {
      preludeImport(ir).types.push(structuredClone(hostImport(ir).types[0]));
    },
    expected: [
      "validation/001 imports[1]: the prelude import has no bindings, types, errors, or services",
    ],
  },
  {
    site: "world.ts:1375",
    name: "a prelude import that exports no builtin",
    program: "core",
    change: (ir) => {
      preludeImport(ir).exports = [];
    },
    expected: [
      "validation/001 imports[1].exports: the prelude import exports exactly the builtin ids of its values",
    ],
  },
  {
    site: "world.ts:1395",
    name: "a builtin name that differs from its identity",
    program: "core",
    change: (ir) => {
      preludeImport(ir).values[0].name = "other";
    },
    expected: [
      "validation/001 imports[1].values[0].name: the builtin name is the text after # in its identity, recorded other",
    ],
  },
  // ---------------------------------------------------------------- serialization.ts
  {
    site: "serialization.ts:152",
    name: "a span without an end offset",
    program: "core",
    change: (ir) => {
      fn(ir, "inc").span = illegal({ source: "m.eff", start: 0 });
    },
    expected: [
      "validation/008 declarations[10].span: a span has a source and two offsets",
    ],
  },
];

for (const row of ROWS) {
  Deno.test(`rejection ${row.site}: ${row.name}`, () => {
    const ir = baseOf(row.program);
    row.change(ir);
    const program: Program = PROGRAMS[row.program];
    const actual = validateModule(
      ir as ModuleIR,
      new Map(Object.entries(program.files)),
    ).map((d) => `${d.code} ${d.message}`);
    assertEquals(actual, row.expected);
  });
}
