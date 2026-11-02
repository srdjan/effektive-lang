// Proves that the Schema validator rejects each forged optional, recursive, and
// transform Schema operation that breaks exactly one guard condition. Each test
// lowers a valid module, forges the IR to break one condition, and requires the
// exact diagnostics. These tests kill the mutants of `schemaOptionalFromRequired`,
// `schemaOptionalTransform`, `schemaRecursive`, and `schemaTransform` in
// `src/core/validate/families/schema.ts`.

import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR, Type } from "../src/core/ir.ts";
import { forgedModule } from "./helpers.ts";

const SOURCE = `type Int = int
type Text = string
type Tree = { score: Int, children: Tree[] }
type TreeInput = { score?: Int, children?: TreeInput[] }
error Other = {}
const text: Schema<Text> = schema()
const integer: Schema<Int> = schema()
const exact: SchemaOptional<Text> = schemaOptionalKey(text)
export const required: SchemaDecodedOptional<Text> = schemaOptionalFromRequired(
  text,
  exact,
  (value: Text): Option<Text> => Some(value),
  (value: Option<Text>): Text => match value { Some(name) => name, None => "" }
)
export const optional: SchemaOptional<Text> = schemaOptionalTransform(
  exact,
  exact,
  (value: Option<Text>): Option<Text> => value,
  (value: Option<Text>): Option<Text> => value
)
export const recursive: Schema<Tree, Tree, never, never, TreeInput> = schemaRecursive(
  (self: Schema<Tree, Tree, never, never, TreeInput>): Schema<Tree, Tree, never, never, TreeInput> =>
    schemaStruct({
      score: schemaConstructorDefault(integer, (): Int => 4),
      children: schemaConstructorDefault(schemaArray(self), (): TreeInput[] => [])
    })
)
export const shifted: Schema<Int, Text> = schemaTransform(
  text,
  integer,
  (value: Text): Int fails SchemaIssue => schemaMake(integer, 1),
  (value: Int): Text fails SchemaIssue => schemaMake(text, "x")
)
export const keep = (value: Option<Text>): Option<Text> => value
export const widen = (value: Text): Option<Text> => Some(value)
`;

type SchemaExpr = Extract<Expr, { kind: "schema" }>;

function constantOf(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) =>
    d.kind === "constant" && d.name === name
  );
  assert(found?.kind === "constant", name);
  return found;
}

/** The Schema expression that initializes the named constant. */
function schemaOf(ir: ModuleIR, name: string): SchemaExpr {
  const { value } = constantOf(ir, name);
  assert(value.kind === "schema", name);
  return value;
}

/** The recorded function type of the closure at an argument of a Schema expression. */
function callbackType(ir: ModuleIR, name: string, index: number) {
  const { type } = schemaOf(ir, name).arguments[index];
  assert(type.kind === "function", name);
  return type;
}

/** A reference to a module function, with the type of the argument `index` of the Schema expression. */
function referenceTo(
  ir: ModuleIR,
  name: string,
  index: number,
  target: `value:${string}`,
): Expr {
  return {
    kind: "reference",
    target,
    type: callbackType(ir, name, index),
    execution: "pure",
    effects: { failures: [], requirements: [] },
    span: schemaOf(ir, name).arguments[index].span,
  };
}

/** Replace an argument of a Schema expression with a reference to a module function. */
function referenceCallback(
  ir: ModuleIR,
  name: string,
  index: number,
  target: `value:${string}`,
): void {
  const call = schemaOf(ir, name);
  const reference = referenceTo(ir, name, index, target);
  Object.assign(call, {
    arguments: call.arguments.map((argument, at) =>
      at === index ? reference : argument
    ),
  });
}

/** Set the encoded type of each Schema type that decodes to Tree. */
function forgeTreeEncoded(ir: ModuleIR, encoded: Type): void {
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const node = value as { kind?: unknown; decoded?: unknown };
    if (
      node.kind === "schema" &&
      (node.decoded as { id?: unknown })?.id === "type:m#Tree"
    ) Object.assign(node, { encoded });
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
}

const INT: Type = { kind: "primitive", name: "int" };
const NOT_DATA: Type = { kind: "primitive", name: "unknown" };
const OPTION_TEXT: Type = {
  kind: "option",
  element: { kind: "named", id: "type:m#Text" },
};

Deno.test("the valid optional, recursive, and transform programs validate", () => {
  assertEquals(forgedModule(SOURCE, () => {}), []);
});

Deno.test("schemaOptionalFromRequired rejects an encode callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "required", 3), {
        parameters: [OPTION_TEXT, INT],
      });
    }),
    [
      "validation/002 declarations[8].value: schemaOptionalFromRequired needs required-to-optional callbacks with only SchemaIssue failure",
      "validation/002 declarations[8].value.arguments[3].type.parameters: the closure declares 1 parameters, its type has 2",
    ],
  );
});

Deno.test("schemaOptionalFromRequired rejects an encode callback with a wrong parameter", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "required", 3), { parameters: [INT] });
    }),
    [
      "validation/002 declarations[8].value: schemaOptionalFromRequired needs required-to-optional callbacks with only SchemaIssue failure",
      "validation/002 declarations[8].value.arguments[3].type.parameters[0]: expected Option<type:m#Text>, recorded int",
    ],
  );
});

Deno.test("schemaOptionalFromRequired rejects an encode callback with a wrong result", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "required", 3), { result: INT });
    }),
    [
      "validation/002 declarations[8].value: schemaOptionalFromRequired needs required-to-optional callbacks with only SchemaIssue failure",
      "validation/002 declarations[8].value.arguments[3].body: the body type type:m#Text does not fit the closure result int",
    ],
  );
});

Deno.test("schemaOptionalFromRequired rejects a decode callback that is not an inline closure", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => referenceCallback(ir, "required", 2, "value:m#widen"),
    ),
    [
      "validation/002 declarations[8].value: schemaOptionalFromRequired needs required-to-optional callbacks with only SchemaIssue failure",
    ],
  );
});

Deno.test("schemaOptionalTransform rejects an encode callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "optional", 3), {
        parameters: [OPTION_TEXT, INT],
      });
    }),
    [
      "validation/002 declarations[9].value: schemaOptionalTransform needs directional Option callbacks with only SchemaIssue failure",
      "validation/002 declarations[9].value.arguments[3].type.parameters: the closure declares 1 parameters, its type has 2",
    ],
  );
});

Deno.test("schemaOptionalTransform rejects an encode callback with a wrong parameter", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "optional", 3), { parameters: [INT] });
    }),
    [
      "validation/002 declarations[9].value: schemaOptionalTransform needs directional Option callbacks with only SchemaIssue failure",
      "validation/002 declarations[9].value.arguments[3].type.parameters[0]: expected Option<type:m#Text>, recorded int",
    ],
  );
});

Deno.test("schemaOptionalTransform rejects an encode callback with a wrong result", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "optional", 3), { result: INT });
    }),
    [
      "validation/002 declarations[9].value: schemaOptionalTransform needs directional Option callbacks with only SchemaIssue failure",
      "validation/002 declarations[9].value.arguments[3].body: the body type Option<type:m#Text> does not fit the closure result int",
    ],
  );
});

Deno.test("schemaOptionalTransform rejects a decode callback that is not an inline closure", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => referenceCallback(ir, "optional", 2, "value:m#keep"),
    ),
    [
      "validation/002 declarations[9].value: schemaOptionalTransform needs directional Option callbacks with only SchemaIssue failure",
    ],
  );
});

Deno.test("schemaRecursive rejects a second argument", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const call = schemaOf(ir, "recursive");
      const extra = referenceTo(ir, "optional", 2, "value:m#keep");
      Object.assign(call, { arguments: [call.arguments[0], extra] });
    }),
    [
      "validation/002 declarations[10].value: schemaRecursive needs a pure body from self to the expected data Schema",
    ],
  );
});

Deno.test("schemaRecursive rejects a callback with two parameters", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const type = callbackType(ir, "recursive", 0);
      Object.assign(type, { parameters: [...type.parameters, INT] });
    }),
    [
      "validation/002 declarations[10].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/002 declarations[10].value.arguments[0].type.parameters: the closure declares 1 parameters, its type has 2",
    ],
  );
});

Deno.test("schemaRecursive rejects a Schema with a non-data encoded type", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => forgeTreeEncoded(ir, NOT_DATA)),
    [
      "validation/001 declarations[10].type: Schema decoded and encoded types must be data only",
      "validation/001 declarations[10].value.type: Schema decoded and encoded types must be data only",
      "validation/002 declarations[10].value: schemaRecursive needs a pure body from self to the expected data Schema",
      "validation/001 declarations[10].value.arguments[0].type.parameters[0]: Schema decoded and encoded types must be data only",
      "validation/001 declarations[10].value.arguments[0].type.result: Schema decoded and encoded types must be data only",
      "validation/001 declarations[10].value.arguments[0].parameters[0].type: Schema decoded and encoded types must be data only",
      "validation/002 declarations[10].value.arguments[0].body: the body type Schema<{ children: type:m#Tree[], score: type:m#Int }, { children: type:m#Tree[], score: type:m#Int }, never, never, { children?: type:m#TreeInput[], score?: type:m#Int }> does not fit the closure result Schema<type:m#Tree, unknown, never, never, type:m#TreeInput>",
      "validation/002 declarations[10].value.arguments[0].body.arguments[0].fields[1].value.type: expected SchemaConstructorDefault<type:m#Tree[], unknown[], never, never, type:m#TreeInput[]>, recorded SchemaConstructorDefault<type:m#Tree[], type:m#Tree[], never, never, type:m#TreeInput[]>",
      "validation/002 declarations[10].value.arguments[0].body.arguments[0].fields[1].value: the value of children has type SchemaConstructorDefault<type:m#Tree[], unknown[], never, never, type:m#TreeInput[]>, which does not fit SchemaConstructorDefault<type:m#Tree[], type:m#Tree[], never, never, type:m#TreeInput[]>",
      "validation/002 declarations[10].value.arguments[0].body.arguments[0].fields[1].value.arguments[0].type: expected Schema<type:m#Tree[], unknown[], never, never, type:m#TreeInput[]>, recorded Schema<type:m#Tree[], type:m#Tree[], never, never, type:m#TreeInput[]>",
      "validation/001 declarations[10].value.arguments[0].body.arguments[0].fields[1].value.arguments[0].arguments[0].type: Schema decoded and encoded types must be data only",
    ],
  );
});

Deno.test("schemaTransform rejects a decode callback that fails with another error", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "shifted", 2).effects, {
        failures: ["error:m#Other"],
      });
    }),
    [
      "validation/002 declarations[11].value: schemaTransform callback types or failure channels do not match",
      "validation/003 declarations[11].value.arguments[2].type.effects.failures: the body can fail with [error:effect/SchemaIssue], the closure type lists [error:m#Other]",
    ],
  );
});
