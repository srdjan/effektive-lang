// Family mutations for the independent validator. Each test lowers a valid
// program with `lowerProject`, changes one node of the IR in memory, and
// requires the validator to report a specific code at the IR path of that
// node, with a fragment of the message. The families are the Stream operators
// and the Schema constructors. Their guard branches had no test before.
//
// The committed fixtures under fixtures/validate stay untouched: the mutations
// happen here, in memory. A mutation may also make a parent node disagree with
// its child, so the tests require the expected diagnostic and ignore extra ones.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { assertValidation } from "./schema_diagnostics.ts";

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ------------------------------------------------------------------ programs

const STREAMS = `type Int = int
type Bool = boolean
error Stop = {}
service Source { next(n: Int): Option<[Int, Int]> fails Stop }
service Accum { add(total: Int, n: Int): Int fails Stop }
service Consumer { accept(n: Int): void fails Stop }

const source = unfold(0, (n) => Source.next(n))

const pull = (n: Int): Option<[Int, Int]> fails Stop with Source.next => Source.next(n)
const plusOne = (n: Int): Int => n + 1
const bump = (n: Int): Int fails Stop with Accum.add => Accum.add(n, 1)
const accept = (value: Int): void fails Stop with Consumer.accept => Consumer.accept(value)

const mapped: Stream<Int, Stop, Source.next> = mapEffect(source, (n) => n + 1)
const mappedEffect: Stream<Int, Stop, Source.next | Accum.add> = mapEffect(source, (n) => Accum.add(n, 1))
const buffered = bufferStream(source, { capacity: 2 })
const consumer = sinkForEach((value: Int) => Consumer.accept(value))

type Pairs = Sink<Int, Int[], never, never, Int>
const pairs: Pairs = takeSink(2)
const batches: Stream<Int[], Stop, Source.next> = transduceStream(source, pairs)

const ran = (): void fails Stop with Source.next | Consumer.accept => runStream(source, consumer)
`;

const SCHEMAS = `type Text = string
type Int = int
type Nil = null
type Nullable = Text | Nil
type Short = { name: Text }
type Long = { name: Text, score: Int }
type Shape = Short | Long
type Tree = { score: Int, children: Tree[] }
type TreeInput = { score?: Int, children?: TreeInput[] }
error Other = {}

const text: Schema<Text> = schema()
const integer: Schema<Int> = schema()
const short: Schema<Short> = schema()
const long: Schema<Long> = schema()
const exact: SchemaOptional<Text> = schemaOptionalKey(text)
const exactInt: SchemaOptional<Int> = schemaOptionalKey(integer)

const listed: Schema<Int[]> = schemaArray(integer)
const nulls: SchemaOptional<Text, Nullable> = schemaNullToMissingKey(text)
const optionFrom: SchemaEncodedOptional<Option<Text>, Text> = schemaOptionFromOptionalKey(text)
const defaulted: SchemaEncodedOptional<Text> = schemaDefaultKey(text, (): Text => "x")
const defaultedNull: SchemaEncodedOptional<Text, Nullable> = schemaDefaultKey(text, (): Text => "x", { on: "null" })
const defaultedEncoded: SchemaEncodedOptional<Text> = schemaDefaultKey(text, (): Text => "x", { on: "encoded" })
const withDefault: SchemaConstructorDefault<Int> = schemaConstructorDefault(integer, (): Int => 4)
const structured: Schema<{ name: Text }> = schemaStruct({ name: text })
const unioned: Schema<Shape> = schemaUnion([short, long])
const transformed: Schema<Int, Text> = schemaTransform(
  text,
  integer,
  (value: Text): Option<Int> => if (value === "one") { Some(1) } else { None },
  (value: Int): Option<Text> => if (value === 1) { Some("one") } else { None }
)
const optionalTransform: SchemaOptional<Int> = schemaOptionalTransform(
  exactInt,
  exactInt,
  (value: Option<Int>): Option<Int> => value,
  (value: Option<Int>): Option<Int> => value
)
const required: SchemaDecodedOptional<Text> = schemaOptionalFromRequired(
  text,
  exact,
  (value: Text): Option<Text> => if (value === "") { None } else { Some(value) },
  (value: Option<Text>): Text => match value { Some(name) => name, None => "" }
)
const recursive: Schema<Tree, Tree, never, never, TreeInput> = schemaRecursive(
  (self: Schema<Tree, Tree, never, never, TreeInput>): Schema<Tree, Tree, never, never, TreeInput> =>
    schemaStruct({
      score: schemaConstructorDefault(integer, (): Int => 4),
      children: schemaConstructorDefault(schemaArray(self), (): TreeInput[] => [])
    })
)
`;

interface Program {
  readonly sources: ReadonlyMap<string, string>;
  /** A fresh copy of the valid IR. */
  forge(): ModuleIR;
}

function lowerProgram(text: string): Program {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": text }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const lowered = [...lowerProject(checked.value).values()][0];
  assert(lowered?.ok, JSON.stringify(lowered));
  const valid = lowered.value;
  return {
    sources: new Map([["main.eff", text]]),
    forge: () => structuredClone(valid),
  };
}

const STREAM_PROGRAM = lowerProgram(STREAMS);
const SCHEMA_PROGRAM = lowerProgram(SCHEMAS);

// ------------------------------------------------------------------ IR editing

function segments(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    out.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  return out;
}

/** The value at a path below `root`, for example `arguments[0].elements[1]`. */
function at(root: unknown, path: string): unknown {
  let current = root;
  for (const key of segments(path)) {
    if (typeof key === "number") {
      assert(Array.isArray(current), `${path}: not an array at ${key}`);
      current = current[key];
    } else {
      assert(isObj(current), `${path}: not an object at ${key}`);
      current = current[key];
    }
  }
  return current;
}

function objectAt(root: unknown, path: string): Obj {
  const found = at(root, path);
  assert(isObj(found), `${path}: not an object`);
  return found;
}

function setAt(root: unknown, path: string, value: unknown): void {
  const parts = segments(path);
  const last = parts.pop();
  assert(last !== undefined, "empty path");
  const parent = parts.length === 0 ? root : at(root, pathOf(parts));
  if (typeof last === "number") {
    assert(Array.isArray(parent), `${path}: parent is not an array`);
    parent[last] = value;
  } else {
    assert(isObj(parent), `${path}: parent is not an object`);
    parent[last] = value;
  }
}

function pathOf(parts: readonly (string | number)[]): string {
  return parts.map((p) => typeof p === "number" ? `[${p}]` : `.${p}`).join("")
    .replace(/^\./, "");
}

interface Root {
  /** The IR path of the declaration root, `declarations[i].value` or `.body`. */
  readonly path: string;
  readonly node: Obj;
}

/** The expression at the root of the named constant or function. */
function rootOf(ir: ModuleIR, name: string): Root {
  const index = ir.declarations.findIndex((d) => d.name === name);
  assert(index >= 0, `no declaration named ${name}`);
  const declaration = ir.declarations[index];
  assert(
    declaration.kind === "constant" || declaration.kind === "function",
    name,
  );
  const field = declaration.kind === "constant" ? "value" : "body";
  const node = at(declaration, field);
  assert(isObj(node), name);
  return { path: `declarations[${index}].${field}`, node };
}

const NO_EFFECTS = { failures: [], requirements: [] };
const INT_TYPE = { kind: "primitive", name: "int" };
const STRING_TYPE = { kind: "primitive", name: "string" };

function literal(value: string | number, type: unknown, span: unknown): Obj {
  return {
    kind: "literal",
    value,
    type,
    execution: "pure",
    effects: NO_EFFECTS,
    span,
  };
}

/** A pure expression that is not a Stream, a Sink, a Schema, or a function. */
function wrongValue(kind: "int" | "string", span: unknown): Obj {
  return kind === "int"
    ? literal(1, INT_TYPE, span)
    : literal("x", STRING_TYPE, span);
}

/**
 * A reference to the module function `helper`. It takes the place of an inline
 * closure. The helper has the same signature as the closure it replaces.
 */
function referenceTo(ir: ModuleIR, helper: string, span: unknown): Obj {
  const declaration = ir.declarations.find((d) => d.name === helper);
  assert(declaration?.kind === "function", `no function ${helper}`);
  return {
    kind: "reference",
    target: declaration.id,
    type: declaration.type,
    execution: "pure",
    effects: NO_EFFECTS,
    span,
  };
}

// ------------------------------------------------------------------ Stream families

/** An operator, the IR kind at the root of its declaration, and its operands. */
type Case = readonly [declaration: string, kind: string];

/** Declaration, IR kind, callback field, helper function, message fragment. */
type ClosureRow = readonly [
  ...Case,
  field: string,
  helper: string,
  fragment: string,
];
const CLOSURE_ROWS: readonly ClosureRow[] = [
  ["source", "unfold", "next", "pull", "unfold requires an inline closure"],
  [
    "mapped",
    "map-stream",
    "transform",
    "plusOne",
    "mapStream requires an inline closure",
  ],
  [
    "mappedEffect",
    "map-effect",
    "transform",
    "bump",
    "mapEffect requires an inline closure",
  ],
  [
    "consumer",
    "sink-for-each",
    "consume",
    "accept",
    "sinkForEach requires an inline closure",
  ],
];

Deno.test("the valid stream and Schema programs validate without diagnostics", () => {
  assertEquals(
    validateModule(STREAM_PROGRAM.forge(), STREAM_PROGRAM.sources),
    [],
  );
  assertEquals(
    validateModule(SCHEMA_PROGRAM.forge(), SCHEMA_PROGRAM.sources),
    [],
  );
});

Deno.test("a stream callback that is a reference instead of an inline closure is rejected", () => {
  for (const [declaration, kind, field, helper, fragment] of CLOSURE_ROWS) {
    const ir = STREAM_PROGRAM.forge();
    const root = rootOf(ir, declaration);
    assertEquals(root.node.kind, kind, declaration);
    const closure = objectAt(root.node, field);
    assertEquals(closure.kind, "closure", `${declaration}.${field}`);
    root.node[field] = referenceTo(ir, helper, closure.span);
    assertValidation(
      validateModule(ir, STREAM_PROGRAM.sources),
      "validation/006",
      `${root.path}.${field}`,
      fragment,
      `${declaration}.${field}`,
    );
  }
});

/** Replacement values for an operand. "type" replaces the recorded type. */
type Wrong = "int" | "string" | "type";

/** Declaration, IR kind, operand field, replacement, message fragment. */
type OperandRow = readonly [
  ...Case,
  field: string,
  wrong: Wrong,
  fragment: string,
];
const OPERAND_ROWS: readonly OperandRow[] = [
  [
    "source",
    "unfold",
    "next",
    "int",
    "unfold needs a callback accepting the state",
  ],
  [
    "mapped",
    "map-stream",
    "stream",
    "int",
    "mapStream needs a Stream and a pure element callback",
  ],
  [
    "mappedEffect",
    "map-effect",
    "stream",
    "int",
    "mapEffect needs a Stream and an element callback",
  ],
  [
    "consumer",
    "sink-for-each",
    "consume",
    "int",
    "sinkForEach needs a one-argument void callback",
  ],
  ["pairs", "take-sink", "type", "type", "takeSink needs a Sink annotation"],
  [
    "buffered",
    "buffer-stream",
    "stream",
    "int",
    "bufferStream needs a Stream value",
  ],
  [
    "batches",
    "transduce-stream",
    "stream",
    "int",
    "transduceStream needs compatible input and replayable Sink leftovers",
  ],
  [
    "batches",
    "transduce-stream",
    "sink",
    "int",
    "transduceStream needs compatible input and replayable Sink leftovers",
  ],
  [
    "ran",
    "run-stream",
    "stream",
    "int",
    "runStream needs compatible Stream and Sink values",
  ],
  [
    "ran",
    "run-stream",
    "sink",
    "int",
    "runStream needs compatible Stream and Sink values",
  ],
];

Deno.test("a stream operator with a non-stream operand is rejected", () => {
  for (const [declaration, kind, field, wrong, fragment] of OPERAND_ROWS) {
    const ir = STREAM_PROGRAM.forge();
    const root = rootOf(ir, declaration);
    assertEquals(root.node.kind, kind, declaration);
    // The path of the diagnostic is the operator node, except for the callbacks
    // of unfold, which the validator names directly.
    const operand = at(root.node, field);
    const path = kind === "unfold" ? `${root.path}.${field}` : root.path;
    if (wrong === "type") {
      root.node.type = INT_TYPE;
    } else {
      assert(isObj(operand), `${declaration}.${field}`);
      root.node[field] = wrongValue(wrong, operand.span);
    }
    assertValidation(
      validateModule(ir, STREAM_PROGRAM.sources),
      "validation/002",
      path,
      fragment,
      `${declaration}.${field}`,
    );
  }
});

Deno.test("an unfold callback that does not return an Option pair is rejected", () => {
  const ir = STREAM_PROGRAM.forge();
  const root = rootOf(ir, "source");
  assertEquals(root.node.kind, "unfold");
  setAt(root.node, "next.type.result", INT_TYPE);
  assertValidation(
    validateModule(ir, STREAM_PROGRAM.sources),
    "validation/002",
    `${root.path}.next`,
    "unfold callback must return Option<[Element, State]>",
    "unfold result",
  );
});

/** Declaration, IR kind, callback field, message fragment. */
type EffectfulRow = readonly [...Case, field: string, fragment: string];
const EFFECTFUL_ROWS: readonly EffectfulRow[] = [
  [
    "mapped",
    "map-stream",
    "transform",
    "mapStream needs a Stream and a pure element callback",
  ],
];

Deno.test("a pure stream callback that runs an effect is rejected", () => {
  for (const [declaration, kind, field, fragment] of EFFECTFUL_ROWS) {
    const ir = STREAM_PROGRAM.forge();
    const root = rootOf(ir, declaration);
    assertEquals(root.node.kind, kind, declaration);
    const closure = objectAt(root.node, field);
    assertEquals(closure.kind, "closure", `${declaration}.${field}`);
    objectAt(closure, "type").execution = "effect";
    assertValidation(
      validateModule(ir, STREAM_PROGRAM.sources),
      "validation/002",
      root.path,
      fragment,
      `${declaration}.${field}`,
    );
  }
});

// ------------------------------------------------------------------ Schema families

/**
 * Declaration, op, path of the replaced node below the Schema node, and message
 * fragment. The optional last path names a recorded type that changes with the
 * replaced node. A record or tuple argument then stays consistent in itself, and
 * the Schema rule decides.
 */
type SchemaArgRow = readonly [
  declaration: string,
  op: string,
  path: string,
  wrong: "int" | "string",
  fragment: string,
  retype?: string,
];
const SCHEMA_ARGUMENT_ROWS: readonly SchemaArgRow[] = [
  ["listed", "array", "arguments[0]", "int", "schemaArray needs one Schema"],
  [
    "exact",
    "optional-key",
    "arguments[0]",
    "int",
    "schemaOptionalKey needs one ordinary Schema",
  ],
  [
    "nulls",
    "null-to-missing-key",
    "arguments[0]",
    "int",
    "schemaNullToMissingKey needs one ordinary Schema",
  ],
  [
    "optionFrom",
    "option-from-optional-key",
    "arguments[0]",
    "int",
    "schemaOptionFromOptionalKey needs one ordinary Schema",
  ],
  [
    "defaulted",
    "default-key",
    "arguments[0]",
    "int",
    "schemaDefaultKey needs a callback",
  ],
  [
    "defaultedNull",
    "default-null-key",
    "arguments[0]",
    "int",
    "schemaDefaultNullKey needs a callback",
  ],
  [
    "defaultedEncoded",
    "default-encoded-key",
    "arguments[0]",
    "int",
    "schemaDefaultEncodedKey needs a callback",
  ],
  [
    "withDefault",
    "constructor-default",
    "arguments[0]",
    "int",
    "schemaConstructorDefault needs an inline make-input callback",
  ],
  [
    "structured",
    "struct",
    "arguments[0]",
    "int",
    "schemaStruct needs required Schema fields",
  ],
  [
    "structured",
    "struct",
    "arguments[0].fields[0].value",
    "int",
    "schemaStruct field is not a Schema or optional descriptor",
    "arguments[0].type.fields[0].type",
  ],
  [
    "unioned",
    "union",
    "arguments[0]",
    "int",
    "schemaUnion needs an inline tuple of branches",
  ],
  [
    "unioned",
    "union",
    "arguments[0].elements[0]",
    "int",
    "schemaUnion branches must be ordinary Schema values",
    "arguments[0].type.elements[0]",
  ],
  [
    "transformed",
    "transform",
    "arguments[0]",
    "int",
    "schemaTransform callback types or failure channels do not match",
  ],
  [
    "transformed",
    "transform",
    "arguments[1]",
    "int",
    "schemaTransform callback types or failure channels do not match",
  ],
  [
    "optionalTransform",
    "optional-transform",
    "arguments[0]",
    "int",
    "schemaOptionalTransform needs directional Option callbacks",
  ],
  [
    "optionalTransform",
    "optional-transform",
    "arguments[1]",
    "int",
    "schemaOptionalTransform needs directional Option callbacks",
  ],
  [
    "required",
    "optional-from-required",
    "arguments[0]",
    "int",
    "schemaOptionalFromRequired needs required-to-optional callbacks",
  ],
  [
    "required",
    "optional-from-required",
    "arguments[1]",
    "int",
    "schemaOptionalFromRequired needs required-to-optional callbacks",
  ],
  [
    "recursive",
    "recursive",
    "arguments[0]",
    "int",
    "schemaRecursive needs a pure body",
  ],
];

Deno.test("a Schema constructor with a non-Schema argument is rejected", () => {
  for (
    const [declaration, op, path, wrong, fragment, retype]
      of SCHEMA_ARGUMENT_ROWS
  ) {
    const ir = SCHEMA_PROGRAM.forge();
    const root = rootOf(ir, declaration);
    assertEquals(root.node.kind, "schema", declaration);
    assertEquals(root.node.op, op, declaration);
    const argument = objectAt(root.node, path);
    setAt(root.node, path, wrongValue(wrong, argument.span));
    if (retype !== undefined) setAt(root.node, retype, INT_TYPE);
    assertValidation(
      validateModule(ir, SCHEMA_PROGRAM.sources),
      "validation/002",
      root.path,
      fragment,
      `${declaration}: ${path}`,
    );
  }
});

Deno.test("a Schema identity descriptor with a non-Schema type is rejected", () => {
  const ir = SCHEMA_PROGRAM.forge();
  const root = rootOf(ir, "text");
  assertEquals(root.node.op, "identity");
  root.node.type = INT_TYPE;
  assertValidation(
    validateModule(ir, SCHEMA_PROGRAM.sources),
    "validation/002",
    root.path,
    "schema() needs an identity data Schema",
    "identity descriptor",
  );
});

Deno.test("a Schema identity descriptor with a make input that fits one way is rejected", () => {
  const ir = SCHEMA_PROGRAM.forge();
  const root = rootOf(ir, "text");
  assertEquals(root.node.op, "identity");
  const schema = objectAt(root.node, "type");
  assertEquals(schema.kind, "schema");
  setAt(root.node, "type.makeInput", {
    kind: "union",
    members: [schema.decoded, INT_TYPE],
  });
  assertValidation(
    validateModule(ir, SCHEMA_PROGRAM.sources),
    "validation/002",
    root.path,
    "schema() needs an identity data Schema",
    "one-way make input",
  );
});

/** Declaration, op, index of the callback argument, message fragment. */
type CallbackRow = readonly [
  declaration: string,
  op: string,
  index: number,
  fragment: string,
];
const CALLBACK_ROWS: readonly CallbackRow[] = [
  [
    "withDefault",
    "constructor-default",
    1,
    "schemaConstructorDefault needs an inline make-input callback",
  ],
  ["defaulted", "default-key", 1, "schemaDefaultKey needs a callback"],
  [
    "defaultedNull",
    "default-null-key",
    1,
    "schemaDefaultNullKey needs a callback",
  ],
  [
    "defaultedEncoded",
    "default-encoded-key",
    1,
    "schemaDefaultEncodedKey needs a callback",
  ],
  [
    "transformed",
    "transform",
    2,
    "schemaTransform callback types or failure channels do not match",
  ],
  [
    "transformed",
    "transform",
    3,
    "schemaTransform callback types or failure channels do not match",
  ],
  [
    "optionalTransform",
    "optional-transform",
    2,
    "schemaOptionalTransform needs directional Option callbacks",
  ],
  [
    "optionalTransform",
    "optional-transform",
    3,
    "schemaOptionalTransform needs directional Option callbacks",
  ],
  [
    "required",
    "optional-from-required",
    2,
    "schemaOptionalFromRequired needs required-to-optional callbacks",
  ],
  [
    "required",
    "optional-from-required",
    3,
    "schemaOptionalFromRequired needs required-to-optional callbacks",
  ],
  ["recursive", "recursive", 0, "schemaRecursive needs a pure body"],
];

Deno.test("a Schema callback that fails with another error is rejected", () => {
  for (const [declaration, op, index, fragment] of CALLBACK_ROWS) {
    const ir = SCHEMA_PROGRAM.forge();
    const other = ir.declarations.find((d) =>
      d.kind === "error" && d.name === "Other"
    );
    assert(other?.kind === "error");
    const root = rootOf(ir, declaration);
    assertEquals(root.node.op, op, declaration);
    const callback = objectAt(root.node, `arguments[${index}]`);
    assertEquals(callback.kind, "closure", `${declaration}[${index}]`);
    const type = objectAt(callback, "type");
    assertEquals(type.kind, "function", `${declaration}[${index}]`);
    type.execution = "effect";
    type.effects = { failures: [other.id], requirements: [] };
    assertValidation(
      validateModule(ir, SCHEMA_PROGRAM.sources),
      "validation/002",
      root.path,
      fragment,
      `${declaration}: arguments[${index}]`,
    );
  }
});
