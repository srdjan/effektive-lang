import { assert, assertEquals } from "@std/assert";
import {
  type CheckedProject,
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import { validateProject } from "../src/core/validate_project.ts";
import type { ValueId } from "../src/core/ir.ts";
import { showType } from "../src/core/type_show.ts";

function checkFiles(
  files: Readonly<Record<string, string>>,
  entries: readonly string[],
): CheckedProject {
  const project = checkProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    entries,
  );
  assert(project.ok, JSON.stringify(project));
  return project.value;
}

function checkText(text: string): CheckedProject {
  return checkFiles({ "m.eff": text }, ["m.eff"]);
}

function parameterTypes(project: CheckedProject, module: string, name: string) {
  const body = project.modules.get(module)?.functions.get(
    `value:${module}#${name}` as ValueId,
  );
  assert(body !== undefined, name);
  return body.signature.parameters.map((parameter) =>
    showType(project.table, parameter.type.ref)
  );
}

function functionType(project: CheckedProject, module: string, name: string) {
  const body = project.modules.get(module)?.functions.get(
    `value:${module}#${name}` as ValueId,
  );
  assert(body !== undefined, name);
  return showType(project.table, body.type);
}

function codes(project: CheckedProject): string[] {
  return project.diagnostics.map((diagnostic) => diagnostic.code);
}

function assertLoweredValid(project: CheckedProject): void {
  const lowered = lowerProject(project);
  for (const result of lowered.values()) {
    assert(result.ok, JSON.stringify(result));
  }
  for (
    const diagnostics of validateProject(project.analysis.project, lowered)
      .values()
  ) assertEquals(diagnostics, []);
}

Deno.test("infers nested closed input records through simple aliases", () => {
  const project = checkText(`
type Text = string
const consume = (value: Text): Text => value
const read = (input): Text => {
  const user = input.user
  consume(user.name)
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), [
    "{ user: { name: Text } }",
  ]);
});

Deno.test("keeps an unconstrained required field as unknown", () => {
  const project = checkText(`
const read = (input) => input.name
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), ["{ name: unknown }"]);
});

Deno.test("omitted and explicit unknown inputs infer equally", () => {
  const project = checkText(`
type Text = string
const consume = (value: Text): Text => value
const omitted = (input): Text => consume(input.name)
const explicit = (input: unknown): Text => consume(input.name)
`);
  assertEquals(codes(project), []);
  assertEquals(
    parameterTypes(project, "m", "omitted"),
    parameterTypes(project, "m", "explicit"),
  );
});

Deno.test("infers from explicit result and local annotation contexts", () => {
  const project = checkText(`
type Int = int
const arithmetic = (input): Int => input + 1
const annotated = (input): Int => { const value: Int = input; value }
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "arithmetic"), ["Int"]);
  assertEquals(parameterTypes(project, "m", "annotated"), ["Int"]);
});

Deno.test("retains local function annotations for later calls and aliases", () => {
  const project = checkText(`
type Int = int
const omitted = (input): Int => {
  const fn: (n: Int) => Int = input
  const alias = fn
  alias(1)
}
const explicit = (input: unknown): Int => {
  const fn: (n: Int) => Int = input
  fn(1)
}
`);
  assertEquals(codes(project), []);
  const omitted = parameterTypes(project, "m", "omitted");
  assertEquals(omitted, ["(Int) => Int"]);
  assertEquals(
    omitted,
    parameterTypes(project, "m", "explicit"),
  );
  assertLoweredValid(project);
});

Deno.test("retains local record annotations for later field uses", () => {
  const project = checkText(`
type Int = int
type Input = { value: Int }
const read = (input) => {
  const record: Input = input
  record.value
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), ["Input"]);
  assertEquals(functionType(project, "m", "read"), "pure (Input) => Int");
  assertLoweredValid(project);
});

Deno.test("checks an incompatible annotated initializer after collecting its input demand", () => {
  const project = checkText(`
type Int = int
const consume = (value: Int): Int => value
const bad = (input): Int => {
  const fn: (n: Int) => Int = consume(input)
  1
}
`);
  assertEquals(codes(project), ["type-mismatch/003"]);
  assertEquals(parameterTypes(project, "m", "bad"), ["Int"]);
});

Deno.test("keeps local annotation inference independent of callers", () => {
  const project = checkText(`
type Int = int
type Text = string
const inferred = (input): Int => {
  const fn: (n: Int) => Int = input
  fn(1)
}
const caller = (callback: (text: Text) => Int): Int => inferred(callback)
`);
  assertEquals(codes(project), ["type-mismatch/003"]);
  assertEquals(parameterTypes(project, "m", "inferred"), ["(Int) => Int"]);
});

Deno.test("infers through forward calls and function aliases", () => {
  const project = checkText(`
type Int = int
const caller = (input): Int => { const call = callee; call(input) }
const callee = (value: Int): Int => value
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "caller"), ["Int"]);
});

Deno.test("infers imported function input contracts", () => {
  const project = checkFiles({
    "dep.eff":
      `export type Text = string\nexport const consume = (value: Text): Text => value`,
    "main.eff":
      `import { consume, Text } from "./dep.eff"\nconst call = (input): Text => consume(input)`,
  }, ["main.eff"]);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "main", "call"), ["Text"]);
});

Deno.test("combines requirements from separate branches", () => {
  const project = checkText(`
type Text = string
type Int = int
type Bool = boolean
const text = (value: Text): Text => value
const consumeCount = (value: Int): Int => value
const read = (input, choose: Bool): Text =>
  if (choose) { text(input.name) } else { consumeCount(input.count); "none" }
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), [
    "{ count: Int, name: Text }",
    "Bool",
  ]);
});

Deno.test("leaves unused and raw unknown inputs unconstrained", () => {
  const project = checkText(`
type Text = string
const unused = (input): Text => "ok"
const textSchema: Schema<Text> = schema()
const decodeValue = (input: unknown): Text fails SchemaError => schemaDecode(textSchema, input)
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "unused"), ["unknown"]);
  assertEquals(parameterTypes(project, "m", "decodeValue"), ["unknown"]);
});

Deno.test("reports both conflicting inferred uses without widening identity", () => {
  const project = checkText(`
type Left = string
type Right = string
const left = (value: Left): Left => value
const right = (value: Right): Right => value
const conflict = (input): Left => { right(input); left(input) }
`);
  assertEquals(codes(project).filter((code) => code === "type-mismatch/014"), [
    "type-mismatch/014",
    "type-mismatch/014",
  ]);
  assertEquals(parameterTypes(project, "m", "conflict"), ["Right"]);
});

Deno.test("retains a demanded identity when compatible field paths are used", () => {
  const project = checkText(`
type Text = string
type Int = int
type User = { id: Int, name: Text }
const consumeUser = (value: User): User => value
const consumeText = (value: Text): Text => value
const read = (input): User => { consumeText(input.name); consumeUser(input) }
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), ["User"]);
});

Deno.test("requires annotations for recursive inferred inputs", () => {
  const project = checkText(`
type Int = int
const loop = (input): Int => loop(input)
`);
  assert(codes(project).includes("execution-mode/003"));
});

Deno.test("uses expected callback types to infer captured inputs", () => {
  const project = checkText(`
type Int = int
const apply = (callback: (value: Int) => Int): Int => callback(1)
const captured = (input): Int => apply((value) => value + input)
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "captured"), ["Int"]);
});

Deno.test("infers omitted local arrow inputs from their bodies", () => {
  const project = checkText(`
type Int = int
const consume = (value: Int): Int => value
const outer = (): Int => { const local = (input) => consume(input); local(1) }
`);
  assertEquals(codes(project), []);
});

Deno.test("uses annotated local arrow evidence through aliases and records", () => {
  const project = checkText(`
type Int = int
const direct = (input): Int => {
  const fn = (n: Int): Int => n
  fn(input)
}
const aliased = (input): Int => {
  const fn = (n: Int): Int => n
  const alias = (fn)
  alias(input)
}
const field = (input): Int => {
  const record = { fn: (n: Int): Int => n }
  record.fn(input)
}
const fieldAlias = (input): Int => {
  const record = { fn: (n: Int): Int => n }
  const alias = record
  alias.fn(input)
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "direct"), ["Int"]);
  assertEquals(parameterTypes(project, "m", "aliased"), ["Int"]);
  assertEquals(parameterTypes(project, "m", "field"), ["Int"]);
  assertEquals(parameterTypes(project, "m", "fieldAlias"), ["Int"]);
  assertLoweredValid(project);
});

Deno.test("keeps arrow contracts separate from callable inference evidence", () => {
  const effectful = checkText(`
type Int = int
error LocalFailure = { value: Int }
service LocalService { read(): Int }
const effectful = (input): Int fails LocalFailure with LocalService.read => {
  const fn = (n: Int): Int fails LocalFailure with LocalService.read => {
    if (n > 0) { LocalService.read() } else { fail(LocalFailure({ value: n })) }
  }
  fn(input)
}
`);
  assertEquals(codes(effectful), []);
  assertEquals(parameterTypes(effectful, "m", "effectful"), ["Int"]);
  const body = effectful.modules.get("m")?.functions.get(
    "value:m#effectful" as ValueId,
  );
  assert(body !== undefined);
  assertEquals(body.mode, "effect");
  assertEquals(body.failures, ["error:m#LocalFailure"]);
  assertEquals(body.requirements, ["cap:m#LocalService.read"]);
  assertLoweredValid(effectful);

  const invalid = checkText(`
type Int = int
const invalid = (): Int => {
  const fn = (n: Int): Int => n
  fn("wrong")
}
`);
  assert(codes(invalid).includes("type-mismatch/003"));
});

Deno.test("marks exported inferred inputs as checked effect entries", () => {
  const project = checkText(`
type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)
`);
  assertEquals(codes(project), []);
  const body = project.modules.get("m")?.functions.get(
    "value:m#entry" as ValueId,
  );
  assert(body !== undefined);
  assertEquals(body.mode, "effect");
  assertEquals(body.failures, ["error:effect/SchemaError"]);
  const type = project.table.node(body.type);
  assert(type.kind === "function");
  assertEquals(type.checked, [true]);
});

Deno.test("infers SchemaError for an exported inferred input with no fails clause", () => {
  const project = checkText(`
type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text => consume(input.name)
`);
  assertEquals(codes(project), []);
  const body = project.modules.get("m")?.functions.get(
    "value:m#entry" as ValueId,
  );
  assert(body !== undefined);
  assertEquals(body.mode, "effect");
  assertEquals(body.failures, ["error:effect/SchemaError"]);
});

Deno.test("requires SchemaError in a written fails clause of an exported inferred input", () => {
  const project = checkText(`
type Text = string
error Other = {}
const consume = (value: Text): Text => value
export const entry = (input): Text fails Other => consume(input.name)
`);
  assertEquals(codes(project), ["failure-contract/001"]);
});

Deno.test("accepts raw unknown only at checked parameters", () => {
  const project = checkText(`
type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)
const raw = (input: unknown): Text fails SchemaError => entry(input)
const nested = (input: { name: unknown }): Text fails SchemaError => entry(input)
const bad = (): Text fails SchemaError => entry({ name: "ok", extra: 1 })
`);
  assertEquals(
    codes(project).filter((code) => code === "type-mismatch/003"),
    [],
  );
  assert(codes(project).includes("type-mismatch/005"));
});

Deno.test("a checked parameter accepts a union, a union target, and a tuple that hold unknown", () => {
  const project = checkText(`
type Text = string
type Pair = [Text, Text]
type Named = { name: Text }
const consume = (value: Named): Text => value.name
const consumeU = (value: Text | Named): Text => "x"
const consumeP = (value: Pair): Text => "y"
export const entry = (input): Text fails SchemaError => consume(input)
export const entryU = (input): Text fails SchemaError => consumeU(input)
export const entryP = (input): Text fails SchemaError => consumeP(input)
const fromUnion = (input: { name: unknown } | { name: Text }): Text fails SchemaError => entry(input)
const toUnion = (input: { name: unknown }): Text fails SchemaError => entryU(input)
const fromTuple = (input: [unknown, Text]): Text fails SchemaError => entryP(input)
`);
  assertEquals(project.diagnostics.map((d) => d.code), []);
});

Deno.test("a checked parameter rejects a short tuple and a tuple with a wrong element", () => {
  const project = checkText(`
type Text = string
type Pair = [Text, Text]
const consumeP = (value: Pair): Text => "y"
export const entryP = (input): Text fails SchemaError => consumeP(input)
const shortTuple = (input: [unknown]): Text fails SchemaError => entryP(input)
const wrongTuple = (input: [unknown, { a: Text }]): Text fails SchemaError => entryP(input)
`);
  assertEquals(
    project.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "type-mismatch/003 argument 1 has type [unknown], but Pair is expected",
      "type-mismatch/003 argument 1 has type [unknown, { a: Text }], but Pair is expected",
    ],
  );
});

Deno.test("publishes inferred input contracts through module interfaces", () => {
  const project = checkFiles({
    "dep.eff": `
export type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)
`,
    "main.eff": `
import { entry, Text } from "./dep.eff"
const raw = (input: unknown): Text fails SchemaError => { const alias = entry; alias(input) }
`,
  }, ["main.eff"]);
  assertEquals(codes(project), []);
});

Deno.test("infers constructor input contracts", () => {
  const project = checkText(`
type Text = string
type User = { name: Text }
const make = (input): User => User(input)
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "make"), ["{ name: Text }"]);
});

Deno.test("does not select an input type from an operator alone", () => {
  const project = checkText(`
const ambiguous = (input) => input + 1
`);
  assertEquals(parameterTypes(project, "m", "ambiguous"), ["unknown"]);
  assert(codes(project).includes("type-mismatch/007"));
});

Deno.test("requires an annotation for an unresolved inferred callback", () => {
  const project = checkText(`
type Int = int
const call = (callback): Int => callback(1)
`);
  assertEquals(parameterTypes(project, "m", "call"), ["unknown"]);
  assert(codes(project).includes("type-mismatch/011"));
});

Deno.test("resolves deferred inferred callbacks from later and nested contracts", () => {
  const project = checkText(`
type Int = int
type Fn = (value: Int) => Int
type Callbacks = { run: Fn }
const direct = (input): Int => { const fn: Fn = input; input(1) }
const before = (input): Int => { input(1); const fn: Fn = input; 1 }
const aliased = (input): Int => { const alias = input; const fn: Fn = input; alias(1) }
const whole = (input): Int => { const callbacks: Callbacks = input; input.run(1) }
const field = (input): Int => { const fn: Fn = input.run; input.run(1) }
const nested = (input): Int => {
  const alias = input.callbacks.run
  const fn: Fn = alias
  input.callbacks.run(1)
}
const pair = (callback, value): Int => {
  const fn: Fn = callback
  callback(value)
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "direct"), ["Fn"]);
  assertEquals(parameterTypes(project, "m", "before"), ["Fn"]);
  assertEquals(parameterTypes(project, "m", "aliased"), ["Fn"]);
  assertEquals(parameterTypes(project, "m", "whole"), ["Callbacks"]);
  assertEquals(parameterTypes(project, "m", "field"), ["{ run: Fn }"]);
  assertEquals(parameterTypes(project, "m", "nested"), [
    "{ callbacks: { run: Fn } }",
  ]);
  assertEquals(parameterTypes(project, "m", "pair"), ["Fn", "Int"]);
  assertLoweredValid(project);
});

Deno.test("propagates deferred callback contracts through dependent calls", () => {
  const project = checkText(`
type Int = int
type Fn = (value: Int) => Int
type Higher = (callback: Fn) => Int
const chained = (higher, callback, value): Int => {
  callback(value)
  higher(callback)
  const annotated: Higher = higher
  1
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "chained"), [
    "Higher",
    "Fn",
    "Int",
  ]);
  assertLoweredValid(project);
});

Deno.test("keeps deferred callback diagnostics and local identities independent", () => {
  const unresolved = checkText(`
type Int = int
type Fn = (value: Int) => Int
const read = (input): Int => {
  const typed: Fn = input.known
  input.known(1)
  input.missing(1)
  1
}
`);
  assertEquals(
    codes(unresolved).filter((code) => code === "type-mismatch/011"),
    ["type-mismatch/011"],
  );

  const conflict = checkText(`
type Int = int
type Text = string
type IntFn = (value: Int) => Int
type TextFn = (value: Text) => Int
const read = (input): Int => {
  const first: IntFn = input
  const second: TextFn = input
  input(1)
}
`);
  assert(codes(conflict).includes("type-mismatch/014"));

  const shadowed = checkText(`
type Int = int
type Fn = (value: Int) => Int
type Text = string
const read = (input): Int => {
  const local = (input): Text => { const value: Text = input; value }
  const fn: Fn = input
  local("text")
  input(1)
}
`);
  assertEquals(codes(shadowed), []);
  assertEquals(parameterTypes(shadowed, "m", "read"), ["Fn"]);
  assertLoweredValid(shadowed);
});

Deno.test("omitted and explicit unknown callbacks resolve equally", () => {
  const project = checkText(`
type Int = int
type Fn = (value: Int) => Int
const omitted = (input): Int => { const fn: Fn = input; input(1) }
const explicit = (input: unknown): Int => { const fn: Fn = input; input(1) }
`);
  assertEquals(codes(project), []);
  assertEquals(
    parameterTypes(project, "m", "omitted"),
    parameterTypes(project, "m", "explicit"),
  );
  assertLoweredValid(project);
});

Deno.test("infers through pipelines and expected shorthand fields", () => {
  const project = checkText(`
type Text = string
type Box = { value: Text }
const consume = (value: Text): Text => value
const piped = (input): Text => input |> consume
const boxed = (value): Box => ({ value })
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "piped"), ["Text"]);
  assertEquals(parameterTypes(project, "m", "boxed"), ["Text"]);
});

Deno.test("checked callees keep forwarding inputs raw and preserve known refinement obligations", () => {
  const project = checkText(`
type Positive = int where n => n > 0
type Int = int
const consume = (value: Positive): Positive => value
export const entry = (input): Positive fails SchemaError => consume(input.amount)
const forward = (input: unknown): Positive fails SchemaError => entry(input)
const direct = (raw: unknown): Positive fails SchemaError => entry({ amount: raw })
const invalid = (raw: unknown): Positive fails SchemaError => entry({ amount: 0 })
service Host { raw(): unknown }
const hidden = (): Positive fails SchemaError with Host => entry({ amount: Positive(Host.raw()) })
`);
  assertEquals(parameterTypes(project, "m", "forward"), ["unknown"]);
  assertEquals(parameterTypes(project, "m", "direct"), ["unknown"]);
  assert(codes(project).includes("type-mismatch/013"));
  assert(codes(project).includes("type-mismatch/003"));
});

Deno.test("inferred exported contracts reject deferred schema inputs", () => {
  const project = checkText(`
type Int = int
type Job = (value: Int) => Int
const use = (job: Job): Int => job(1)
export const entry = (job): Int fails SchemaError => use(job)
`);
  assert(codes(project).includes("type-mismatch/010"));
});

Deno.test("typed callback fields supply requirements to inferred arguments", () => {
  const project = checkText(`
type Int = int
type Callbacks = { run: (value: Int) => Int }
const read = (callbacks: Callbacks, input): Int => callbacks.run(input)
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), ["Callbacks", "Int"]);
  assertLoweredValid(project);
});

Deno.test("compatible error fields retain a demanded error identity", () => {
  const project = checkText(`
type Int = int
error Issue = { value: Int }
const read = (input): Int => {
  const issue: Issue = input
  input.value
  1
}
`);
  assertEquals(codes(project), []);
  assertEquals(parameterTypes(project, "m", "read"), ["Issue"]);
  assertLoweredValid(project);
});

Deno.test("incomplete field recovery preserves inferred input contracts", () => {
  for (
    const [expression, expectedCodes] of [
      ["consume(input).", ["syntax/008"]],
      ["consume(input).if", ["type-mismatch/003", "syntax/008"]],
    ] as const
  ) {
    const project = checkText(`
type Int = int
const consume = (value: Int): Int => value
const read = (input): Int => ${expression}
`);
    assertEquals(codes(project), [...expectedCodes]);
    assertEquals(parameterTypes(project, "m", "read"), ["unknown"]);
  }
});
