// Tests for the validator rejection sites that no other fast test fires.
// Each row lowers a valid program, forges one fact of the IR payload, runs the
// public entry `validateModule`, and requires the exact diagnostics. A row fails
// if its rejection is deleted.
//
// To add a row, append to ROWS. A row names the forged fact, the program it
// forges from, a `change` function, and the literal diagnostics
// (`code path: message`).
// Add a program to PROGRAMS when the existing programs lack the construct.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import type {
  ConstantDecl,
  Declaration,
  Expr,
  FunctionDecl,
  ModuleIR,
  Type,
} from "../src/core/ir.ts";
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
const readBorrowed = (borrow handle: Handle): Text with Files.read => Files.read(handle)
const pair = (): [Int, Int] => [1, 2]
const some1 = (): Option<Int> => Some(1)
const boom = (): Int fails Boom => fail(Boom({ code: 1 }))
const inferred = () => boom()
const failing = (): Int fails Boom => scoped(defer(() => boom()))
const inc = (n: Int): Int => n + 1
const piped = (a: Int): Int => a |> inc
const useHandle = (): Text with Files.open | Files.read | Files.close =>
  withResource(() => Files.open(), (handle) => readBorrowed(handle), (handle) => Files.close(handle))
const useRecord = (): Int => withResource(() => ({ get: () => 1 }), (ops) => ops.get(), (ops) => {})
const outcome = (): Int => try { 1 } finally (o) { }
const sc = (): Int => scoped(defer(() => 1))
const fk = (): void => scoped(defer(() => forkScoped(defer(() => 1))))
const mapped = (): Int[] => map([1], (n) => n + 1)
`;

const EFFECTS_SOURCE = `type Int = int
error Boom = { code: Int }
service Clock { now(): Int }
service Tick { now(): Int }
service Log { write(): void }
const timed = (): Int fails TimeoutError => timeout(() => 1, 5ms)
const retryPolicy = retrySchedule((e: Boom, attempt: Int): Option<Duration> => Some(1ms))
const ran = (): Int => run(defer(() => 1))
const raced = () => race(defer(() => 1), defer(() => 2))
const clockLive = layer(Clock, () => ({ now: () => 1 }))
const logLive = layer(Log, () => ({ write: () => {} }))
const needy = layer(Clock, () => {
  Tick.now()
  ({ now: () => 1 })
})
const both = mergeLayers(clockLive, logLive)
const one = (): Int => 1
`;

const FAMILIES_SOURCE = `type Int = int
type Text = string
const integer: Schema<Int> = schema()
const word = (): Text => "x"
const read = (ref: Ref<Int>): Int => getRef(ref)
const write = (ref: Ref<Int>): void => setRef(ref, 2)
const update = (ref: Ref<Int>): void => updateRef(ref, (n) => n)
const decodeInt = (input: unknown): Int fails SchemaError => schemaDecode(integer, input)
type Cents = int
type Score = int
const scored = (): Score => 1
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
  effects: {
    files: { "effektive.json": "{}", "m.eff": EFFECTS_SOURCE },
    entry: "m.eff",
  },
  families: {
    files: { "effektive.json": "{}", "m.eff": FAMILIES_SOURCE },
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

/** A constant declaration, whose `value` is the expression to forge. */
function constant(ir: ForgedIR, name: string): Mutable<ConstantDecl> {
  const found = declaration(ir, name);
  assert(found.kind === "constant", name);
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

/** The function type of a closure expression. */
function closureType(
  closure: Mutable<Extract<Expr, { kind: "closure" }>>,
): Mutable<Extract<Type, { kind: "function" }>> {
  const type = closure.type;
  assert(type.kind === "function");
  return type;
}

function method(ir: ForgedIR, name: string) {
  const found = hostImport(ir).services[0].methods.find((m) => m.name === name);
  assert(found !== undefined, name);
  return found;
}

const INT: Type = { kind: "primitive", name: "int" };
const STRING: Type = { kind: "primitive", name: "string" };
const UNKNOWN: Type = { kind: "primitive", name: "unknown" };

/** A fresh literal expression of type int, copied from a function body. */
function intLiteral(
  ir: ForgedIR,
  from = "pair",
): Mutable<Extract<Expr, { kind: "literal" }>> {
  return structuredClone(find(fn(ir, from).body, "literal"));
}

// ------------------------------------------------------------------ rows

interface Row {
  readonly name: string;
  readonly program: ProgramName;
  readonly change: (ir: ForgedIR) => void;
  /** Each entry is `code path: message`, in the order that `validateModule` gives. */
  readonly expected: readonly string[];
}

const ROWS: readonly Row[] = [
  // ---------------------------------------------------------------- expr.ts
  {
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
    name: "more borrow flags than parameters",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.borrows = [true, true];
    },
    expected: [
      "validation/001 declarations[4].type: borrow flags must match function parameters",
      "validation/002 declarations[4].type.borrows: borrow flags must match function parameters",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => type:host#Text with cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text with cap:host#Files.read [effect]",
    ],
  },
  {
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
      "validation/002 declarations[12].body.use.body.callee.type: expected (int) => type:host#Text with cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text with cap:host#Files.read [effect]",
      "validation/002 declarations[12].body.use.body.arguments[0]: the argument has type type:host#Handle, which does not fit the parameter int",
    ],
  },
  {
    name: "a borrow parameter whose type flag is false",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.borrows = [false];
    },
    expected: [
      "validation/002 declarations[4].type.borrows[0]: borrow flag missing from function type",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => type:host#Text with cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text with cap:host#Files.read [effect]",
      "validation/006 declarations[12].body.use.body: borrowed handle may only pass to a borrow-qualified method",
    ],
  },
  {
    name: "a borrow function that returns a value that is not data",
    program: "core",
    change: (ir) => {
      fn(ir, "readBorrowed").type.result = UNKNOWN;
    },
    expected: [
      "validation/002 declarations[4].type.result: a borrow function must return data only",
      "validation/002 declarations[4].body: the body type type:host#Text does not fit the declared result unknown",
      "validation/002 declarations[12].body.use.body.callee.type: expected (type:host#Handle) => unknown with cap:host#Files.read [effect], recorded (type:host#Handle) => type:host#Text with cap:host#Files.read [effect]",
      "validation/002 declarations[12].body.use.body.type: expected unknown, recorded type:host#Text",
      "validation/002 declarations[12].body.use.body: the body type unknown does not fit the closure result type:host#Text",
    ],
  },
  {
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
  // ------------------------------------------- type, declaration, recursion, import checks
  {
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
    name: "a builtin whose type is not a function",
    program: "core",
    change: (ir) => {
      preludeImport(ir).values[0].type = INT;
    },
    expected: [
      "validation/002 imports[1].values[0].type: a builtin has a function type, recorded primitive",
      "validation/002 declarations[17].body.callee.type: expected int, recorded (int[], (int) => int [pure]) => int[] [pure]",
      "validation/002 declarations[17].body.callee: the callee has type int, which is not a function",
    ],
  },
  {
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
      "validation/001 declarations[17].body.callee.target: the target value:m#$builtin/map/a648b6255b2f is not a parameter, a binding, or a declaration in scope",
    ],
  },
  {
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
    name: "a builtin name that differs from its identity",
    program: "core",
    change: (ir) => {
      preludeImport(ir).values[0].name = "other";
    },
    expected: [
      "validation/001 imports[1].values[0].name: the builtin name is the text after # in its identity, recorded other",
    ],
  },
  // ---------------------------------------------------------------- effect.ts
  {
    name: "a timeout duration that is not a Duration",
    program: "effects",
    change: (ir) => {
      const t = find(fn(ir, "timed").body, "timeout");
      t.durationMs = illegal(find(t.durationMs, "literal"));
    },
    expected: [
      "validation/002 declarations[5].body.durationMs: timeout needs a Duration, found int",
    ],
  },
  {
    name: "a retry schedule step that is not a function",
    program: "effects",
    change: (ir) => {
      const r = find(constant(ir, "retryPolicy").value, "retry-schedule");
      r.step = intLiteral(ir, "one");
    },
    expected: [
      "validation/006 declarations[6].value.step: retry schedule needs a two-parameter callback",
    ],
  },
  {
    name: "a retry schedule error parameter that is not a declared error",
    program: "effects",
    change: (ir) => {
      const step = find(constant(ir, "retryPolicy").value, "closure");
      step.parameters[0].type = INT;
      closureType(step).parameters[0] = INT;
    },
    expected: [
      "validation/002 declarations[6].value.type: expected RetrySchedule<int>, recorded RetrySchedule<error:m#Boom>",
      "validation/002 declarations[6].value: the initializer type RetrySchedule<int> does not fit the constant type RetrySchedule<error:m#Boom>",
      "validation/002 declarations[6].value.step: retry schedule needs a declared error parameter",
    ],
  },
  {
    name: "a retry schedule attempt parameter that is not an int",
    program: "effects",
    change: (ir) => {
      const step = find(constant(ir, "retryPolicy").value, "closure");
      step.parameters[1].type = STRING;
      closureType(step).parameters[1] = STRING;
    },
    expected: [
      "validation/002 declarations[6].value.step: retry schedule needs an Int attempt and Option<Duration> result",
    ],
  },
  {
    name: "a retry schedule callback that is not pure",
    program: "effects",
    change: (ir) => {
      const step = find(constant(ir, "retryPolicy").value, "closure");
      closureType(step).execution = "effect";
    },
    expected: [
      "validation/004 declarations[6].value.step.type.execution: expected pure, recorded effect",
      "validation/006 declarations[6].value.step: retry schedule callback must be pure",
    ],
  },
  {
    name: "run of a value that is not an Effect",
    program: "effects",
    change: (ir) => {
      find(fn(ir, "ran").body, "run").value = intLiteral(ir, "one");
    },
    expected: [
      "validation/006 declarations[7].body.value: run needs an Effect value, but the expression has type int",
    ],
  },
  {
    name: "race of a value that is not an Effect",
    program: "effects",
    change: (ir) => {
      find(fn(ir, "raced").body, "race").left = intLiteral(ir, "one");
    },
    expected: [
      "validation/002 declarations[8].body: race needs two Effect values",
    ],
  },
  // ---------------------------------------------------------------- layer.ts
  {
    name: "a layer of a service that is not declared",
    program: "effects",
    change: (ir) => {
      find(constant(ir, "clockLive").value, "layer").service = illegal(
        "service:m#Nope",
      );
    },
    expected: [
      "validation/006 declarations[9].value: layer needs a declared service and inline zero-argument callback",
    ],
  },
  {
    name: "a layer record with fewer fields than the service methods",
    program: "effects",
    change: (ir) => {
      const result = closureType(
        find(constant(ir, "clockLive").value, "closure"),
      ).result;
      assert(result.kind === "record");
      result.fields = [];
    },
    expected: [
      "validation/002 declarations[9].value.acquire: layer must return exactly the service methods",
      "validation/002 declarations[9].value.acquire.body: the body type { now: () => type:m#Int [effect] } does not fit the closure result {}",
    ],
  },
  {
    name: "a layer method that does not fit its service contract",
    program: "effects",
    change: (ir) => {
      const result = closureType(
        find(constant(ir, "clockLive").value, "closure"),
      ).result;
      assert(result.kind === "record");
      result.fields[0].type = INT;
    },
    expected: [
      "validation/002 declarations[9].value.acquire: layer method now does not fit its service contract",
      "validation/002 declarations[9].value.acquire.body: the body type { now: () => type:m#Int [effect] } does not fit the closure result { now: int }",
    ],
  },
  {
    name: "a layer acquisition that requires a method it provides",
    program: "effects",
    change: (ir) => {
      find(constant(ir, "needy").value, "layer").service = illegal(
        "service:m#Tick",
      );
    },
    expected: [
      "validation/002 declarations[11].value.type: expected provider provides cap:m#Tick.now [effect], recorded provider provides cap:m#Clock.now [effect]",
      "validation/002 declarations[11].value: the initializer type provider provides cap:m#Tick.now [effect] does not fit the constant type provider provides cap:m#Clock.now [effect]",
      "validation/006 declarations[11].value: layer acquisition requires a method it provides",
    ],
  },
  {
    name: "mergeLayers of a value that is not a Layer",
    program: "effects",
    change: (ir) => {
      find(constant(ir, "both").value, "merge-layers").left = intLiteral(
        ir,
        "one",
      );
    },
    expected: [
      "validation/002 declarations[12].value: mergeLayers needs two Layer values",
    ],
  },
  // ---------------------------------------------------------------- families
  {
    name: "a getRef over a value that is not a Ref",
    program: "families",
    change: (ir) => {
      find(fn(ir, "read").body, "get-ref").ref = intLiteral(ir, "word");
    },
    expected: [
      "validation/002 declarations[4].body: get-ref needs a Ref value",
    ],
  },
  {
    name: "a setRef of a value that does not fit the Ref element",
    program: "families",
    change: (ir) => {
      find(fn(ir, "write").body, "set-ref").value = intLiteral(ir, "word");
    },
    expected: [
      "validation/002 declarations[5].body.value: the new value must fit the Ref element",
    ],
  },
  {
    name: "an updateRef whose callback is not a function",
    program: "families",
    change: (ir) => {
      find(fn(ir, "update").body, "update-ref").transform = intLiteral(
        ir,
        "word",
      );
    },
    expected: [
      "validation/004 declarations[6].body.transform: updateRef needs an element-to-element callback",
    ],
  },
  {
    name: "a schemaDecode over a value that is not a Schema",
    program: "families",
    change: (ir) => {
      find(fn(ir, "decodeInt").body, "schema-decode").schema = intLiteral(
        ir,
        "word",
      );
    },
    expected: [
      "validation/002 declarations[7].body: schema runner needs an ordinary Schema value",
    ],
  },
  // ---------------------------------------------------------------- serialization.ts
  {
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
  Deno.test(`rejection: ${row.name}`, () => {
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
