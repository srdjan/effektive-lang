// Proves that the Schema validator rejects each forged `schemaTransform` and
// `schemaRecursive` that breaks exactly one guard condition. Each test lowers a
// valid module, forges the IR to break one condition, and requires the exact
// diagnostics. These tests kill the mutants of `schemaTransform` and
// `guardedSchemaBody` in `src/core/validate/families/schema.ts`.

import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR, Type } from "../src/core/ir.ts";
import { allExprs, forgedModule } from "./helpers.ts";

const SOURCE = `type Int = int
type Text = string
type A = "a"
type B = "b"
type T = { tag: A, next: T } | { tag: B }
type Tree = { value: Int, children: Tree[] }
const integer: Schema<Int> = schema()
const text: Schema<Text> = schema()
const lit_a: Schema<A> = schema()
const lit_b: Schema<B> = schema()
const keep = (value: Text): Option<Int> => None
export const moved: Schema<Text, Int> = schemaTransform(
  integer,
  text,
  (value: Int): Option<Text> => None,
  (value: Text): Option<Int> => None
)
export const tagged: Schema<T> = schemaRecursive((self: Schema<T>): Schema<T> =>
  schemaUnion([schemaStruct({ tag: lit_a, next: self }), schemaStruct({ tag: lit_b })]))
export const tree: Schema<Tree> = schemaRecursive((self: Schema<Tree>): Schema<Tree> =>
  schemaStruct({ value: integer, children: schemaArray(self) }))
`;

type SchemaExpr = Extract<Expr, { kind: "schema" }>;
type ClosureExpr = Extract<Expr, { kind: "closure" }>;
type RecordType = Extract<Type, { kind: "record" }>;

const INT: Type = { kind: "named", id: "type:m#Int" };
const TEXT: Type = { kind: "named", id: "type:m#Text" };
const STRING: Type = { kind: "primitive", name: "string" };

function schemaOf(ir: ModuleIR, name: string): SchemaExpr {
  const found = ir.declarations.find((d) =>
    d.kind === "constant" && d.name === name
  );
  assert(found?.kind === "constant", name);
  assert(found.value.kind === "schema", name);
  return found.value;
}

/** The closure at an argument of a Schema expression. */
function closureAt(schema: SchemaExpr, index: number): ClosureExpr {
  const argument = schema.arguments[index];
  assert(argument.kind === "closure");
  return argument;
}

/** The body of the `schemaRecursive` callback of a constant. */
function bodyOf(ir: ModuleIR, name: string): SchemaExpr {
  const { body } = closureAt(schemaOf(ir, name), 0);
  assert(body.kind === "schema");
  return body;
}

/** The two struct branches of the tagged union in `tagged`. */
function branchesOf(ir: ModuleIR): SchemaExpr[] {
  const [tuple] = bodyOf(ir, "tagged").arguments;
  assert(tuple.kind === "tuple");
  return tuple.elements.map((element) => {
    assert(element.kind === "schema");
    return element;
  });
}

/** The decoded or encoded record type of a branch. */
function sideOf(branch: SchemaExpr, side: "decoded" | "encoded"): RecordType {
  assert(branch.type.kind === "schema");
  const record = branch.type[side];
  assert(record.kind === "record");
  return record;
}

/** Replace the type of the `tag` field of a branch on both sides. */
function forgeTag(
  branch: SchemaExpr,
  decoded: Type,
  encoded: Type = decoded,
): void {
  for (
    const [side, type] of [["decoded", decoded], ["encoded", encoded]] as const
  ) {
    const field = sideOf(branch, side).fields.find((f) => f.name === "tag");
    assert(field !== undefined);
    Object.assign(field, { type });
  }
}

/** The function type of the closure at an argument of the `moved` constant. */
function callbackType(ir: ModuleIR, index: number) {
  const { type } = schemaOf(ir, "moved").arguments[index];
  assert(type.kind === "function");
  return type;
}

/** Forge the parameters of the recorded type of a `moved` callback. */
function forgeParameters(
  ir: ModuleIR,
  index: number,
  parameters: readonly Type[],
): void {
  Object.assign(callbackType(ir, index), { parameters });
}

Deno.test("schemaTransform rejects a decode callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => forgeParameters(ir, 2, [INT, INT])),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/002 declarations[11].value.arguments[2].type.parameters: the closure declares 1 parameters, its type has 2",
    ],
  );
});

Deno.test("schemaTransform rejects an encode callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => forgeParameters(ir, 3, [TEXT, TEXT])),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/002 declarations[11].value.arguments[3].type.parameters: the closure declares 1 parameters, its type has 2",
    ],
  );
});

Deno.test("schemaTransform rejects a decode parameter that the source does not fit", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => forgeParameters(ir, 2, [TEXT])),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/002 declarations[11].value.arguments[2].type.parameters[0]: expected type:m#Int, recorded type:m#Text",
    ],
  );
});

Deno.test("schemaTransform rejects an encode parameter that the target does not fit", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => forgeParameters(ir, 3, [INT])),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/002 declarations[11].value.arguments[3].type.parameters[0]: expected type:m#Text, recorded type:m#Int",
    ],
  );
});

Deno.test("schemaTransform rejects a decode argument that is not a function", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(schemaOf(ir, "moved").arguments[2], { type: INT });
    }),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/002 declarations[11].value.arguments[2].type: a closure has a function type, recorded type:m#Int",
    ],
  );
});

Deno.test("schemaTransform rejects an encode argument that is not an inline closure", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const moved = schemaOf(ir, "moved");
      const [reference] = allExprs(ir, "reference");
      Object.assign(moved.arguments, {
        3: {
          ...reference,
          target: "value:m#keep",
          type: moved.arguments[3].type,
        },
      });
    }),
    ["validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match"],
  );
});

Deno.test("schemaRecursive rejects a callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const closure = closureAt(schemaOf(ir, "tree"), 0);
      Object.assign(closure, {
        parameters: [...closure.parameters, closure.parameters[0]],
      });
    }),
    [
      "validation/002 declarations[13].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[13].value.arguments[0].type.parameters: the closure declares 2 parameters, its type has 1",
      "validation/001 declarations[13].value.arguments[0].parameters[1].id: the local local:m#tree/self is declared twice in this function",
    ],
  );
});

Deno.test("schemaRecursive rejects a body that is neither a struct nor a union", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(bodyOf(ir, "tree"), { op: "array" });
    }),
    [
      "validation/002 declarations[13].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[13].value.arguments[0].body: schemaArray needs one Schema",
    ],
  );
});

Deno.test("schemaRecursive rejects a union body without a branch tuple", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(bodyOf(ir, "tagged"), { arguments: [] });
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[12].value.arguments[0].body: schemaUnion needs an inline tuple of branches",
    ],
  );
});

Deno.test("schemaRecursive rejects a branch with an encoded type that is not a record", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(branchesOf(ir)[0].type, { encoded: STRING });
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[0].type: expected Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag: type:m#A }, never, never, { next: type:m#T, tag: type:m#A }>, recorded Schema<{ next: type:m#T, tag: type:m#A }, string, never, never>",
    ],
  );
});

Deno.test("schemaRecursive rejects a union whose encoded tag is an optional key", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const field = sideOf(branchesOf(ir)[0], "encoded").fields.find((f) =>
        f.name === "tag"
      );
      assert(field !== undefined);
      Object.assign(field, { optional: true });
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[0].type: expected Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag: type:m#A }, never, never, { next: type:m#T, tag: type:m#A }>, recorded Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag?: type:m#A }, never, never>",
    ],
  );
});

Deno.test("schemaRecursive rejects a union whose encoded tag is not a literal", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      forgeTag(branchesOf(ir)[0], { kind: "literal", value: "a" }, STRING);
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      'validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[0].type: expected Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag: type:m#A }, never, never, { next: type:m#T, tag: type:m#A }>, recorded Schema<{ next: type:m#T, tag: "a" }, { next: type:m#T, tag: string }, never, never>',
    ],
  );
});

Deno.test("schemaRecursive rejects a union whose tags are numbers", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const [first, second] = branchesOf(ir);
      forgeTag(first, { kind: "literal", value: 1 });
      forgeTag(second, { kind: "literal", value: 2 });
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[0].type: expected Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag: type:m#A }, never, never, { next: type:m#T, tag: type:m#A }>, recorded Schema<{ next: type:m#T, tag: 1 }, { next: type:m#T, tag: 1 }, never, never>",
      "validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[1].type: expected Schema<{ tag: type:m#B }, { tag: type:m#B }, never, never, { tag: type:m#B }>, recorded Schema<{ tag: 2 }, { tag: 2 }, never, never>",
    ],
  );
});

Deno.test("schemaRecursive rejects a union whose encoded tag is a string with a value property", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      forgeTag(branchesOf(ir)[0], { kind: "literal", value: "a" }, {
        ...STRING,
        value: "a",
      } as Type);
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      'validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[0].type: expected Schema<{ next: type:m#T, tag: type:m#A }, { next: type:m#T, tag: type:m#A }, never, never, { next: type:m#T, tag: type:m#A }>, recorded Schema<{ next: type:m#T, tag: "a" }, { next: type:m#T, tag: string }, never, never>',
    ],
  );
});

Deno.test("schemaRecursive rejects a union whose branches repeat one tag value", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      forgeTag(branchesOf(ir)[1], { kind: "literal", value: "a" });
    }),
    [
      "validation/002 declarations[12].value: schemaRecursive needs a pure body from self to the expected data Schema",
      'validation/002 declarations[12].value.arguments[0].body.arguments[0].elements[1].type: expected Schema<{ tag: type:m#B }, { tag: type:m#B }, never, never, { tag: type:m#B }>, recorded Schema<{ tag: "a" }, { tag: "a" }, never, never>',
    ],
  );
});

Deno.test("schemaRecursive rejects a self reference under an operation that does not pass it on, beside a guarded one", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const [fields] = bodyOf(ir, "tree").arguments;
      assert(fields.kind === "record");
      const children = fields.fields.find((f) => f.name === "children");
      assert(children !== undefined);
      Object.assign(fields, {
        fields: [...fields.fields, {
          name: "extra",
          value: { ...structuredClone(children.value), op: "transform" },
        }],
      });
    }),
    [
      "validation/002 declarations[13].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[13].value.arguments[0].body.arguments[0].fields[2]: the record type { children: Schema<type:m#Tree[], type:m#Tree[], never, never>, value: Schema<type:m#Int, type:m#Int, never, never> } has no field extra",
      "validation/002 declarations[13].value.arguments[0].body.arguments[0].fields[2].value: schemaTransform callback types or failure channels do not match",
    ],
  );
});
