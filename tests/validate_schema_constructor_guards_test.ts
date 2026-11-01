// Proves that the Schema validator rejects each forged Schema operation that
// breaks exactly one guard condition. Each test lowers a valid module, forges
// the IR to break one condition, and requires the exact diagnostics. These tests
// kill the mutants of `schemaOf`, `optionalArg`, `schemaIdentity`,
// `schemaConstructorDefault`, `schemaNullToMissingKey`, `schemaDefaultKey`,
// and `schemaUnion` in `src/core/validate/families/schema.ts`.

import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR, Type } from "../src/core/ir.ts";
import { allExprs, forgedModule } from "./helpers.ts";

const SOURCE = `type Int = int
type Text = string
type Nil = null
type WireValue = Text | Nil
service Read { next(value: Int): Int }
const integer: Schema<Int> = schema()
const text: Schema<Text> = schema()
const flat: Schema<Int> = schema()
const solo: Schema<Int> = schema()
const base: Schema<Int> = schema()
const wire: Schema<Text> = schema()
const raw: Schema<Text> = schema()
const exact: SchemaOptional<Int> = schemaOptionalKey(integer)
const makeText = (): Text => "DEFAULT"
export const wrapped: Schema<Int[]> = schemaArray(flat)
export const transformed: SchemaOptional<Int> = schemaOptionalTransform(
  exact,
  exact,
  (value: Option<Int>): Option<Int> => value,
  (value: Option<Int>): Option<Int> => value
)
export const made: SchemaConstructorDefault<Int> =
  schemaConstructorDefault(base, (): Int => 4)
export const madeAgain: SchemaConstructorDefault<Int> =
  schemaConstructorDefault(integer, (): Int => 4)
export const nullable: SchemaOptional<Text, WireValue> =
  schemaNullToMissingKey(wire)
export const defaulted: SchemaEncodedOptional<Text> =
  schemaDefaultKey(text, (): Text => "DEFAULT", { encodingStrategy: "omit" })
export const plainDefault: SchemaEncodedOptional<Text> =
  schemaDefaultKey(text, (): Text => "DEFAULT")
export const nullDefaulted: SchemaEncodedOptional<Text, WireValue> =
  schemaDefaultKey(raw, (): Text => "DEFAULT", { on: "null" })
export const joined: Schema<Int | Text> = schemaUnion([integer, text])
`;

type SchemaExpr = Extract<Expr, { kind: "schema" }>;

function constantOf(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) =>
    d.kind === "constant" && d.name === name
  );
  assert(found?.kind === "constant", name);
  return found;
}

function functionOf(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) =>
    d.kind === "function" && d.name === name
  );
  assert(found?.kind === "function", name);
  return found;
}

/** The Schema expression that initializes the named constant. */
function schemaOf(ir: ModuleIR, name: string): SchemaExpr {
  const { value } = constantOf(ir, name);
  assert(value.kind === "schema", name);
  return value;
}

/** Add `patch` to the declared type of a constant and to each reference to it. */
function forgeConstant(
  ir: ModuleIR,
  name: string,
  patch: Record<string, unknown>,
): void {
  Object.assign(constantOf(ir, name).type, patch);
  for (const ref of allExprs(ir, "reference")) {
    if (ref.target === `value:m#${name}`) Object.assign(ref.type, patch);
  }
}

/** The recorded function type of the closure at an argument of a Schema expression. */
function callbackType(ir: ModuleIR, name: string, index: number) {
  const { type } = schemaOf(ir, name).arguments[index];
  assert(type.kind === "function", name);
  return type;
}

const INT: Type = { kind: "named", id: "type:m#Int" };
const TEXT: Type = { kind: "named", id: "type:m#Text" };
const NIL: Type = { kind: "literal", value: null };
const NOT_DATA: Type = { kind: "primitive", name: "unknown" };

Deno.test("schemaArray rejects an optionalKey Schema argument", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => forgeConstant(ir, "flat", { optionalKey: true }),
    ),
    [
      "validation/002 declarations[7].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaOptional<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[14].value: schemaArray needs one Schema",
    ],
  );
});

Deno.test("schemaArray rejects an encodedOptionalKey Schema argument", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => forgeConstant(ir, "flat", { encodedOptionalKey: true }),
    ),
    [
      "validation/002 declarations[7].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaEncodedOptional<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[14].value: schemaArray needs one Schema",
    ],
  );
});

Deno.test("schemaArray rejects a decodedOptionalKey Schema argument", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => forgeConstant(ir, "flat", { decodedOptionalKey: true }),
    ),
    [
      "validation/002 declarations[7].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type SchemaDecodedOptional<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[14].value: schemaArray needs one Schema",
    ],
  );
});

Deno.test("schemaOptionalTransform rejects a Schema argument without optionalKey", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      delete (constantOf(ir, "exact").type as { optionalKey?: true })
        .optionalKey;
    }),
    [
      "validation/002 declarations[12].value: the initializer type SchemaOptional<type:m#Int, type:m#Int, never, never> does not fit the constant type Schema<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[15].value: schemaOptionalTransform needs directional Option callbacks with only SchemaIssue failure",
      "validation/002 declarations[15].value.arguments[0].type: expected Schema<type:m#Int, type:m#Int, never, never>, recorded SchemaOptional<type:m#Int, type:m#Int, never, never>",
      "validation/002 declarations[15].value.arguments[1].type: expected Schema<type:m#Int, type:m#Int, never, never>, recorded SchemaOptional<type:m#Int, type:m#Int, never, never>",
    ],
  );
});

Deno.test("schema() rejects an identity Schema with a decode requirement", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(schemaOf(ir, "solo").type, {
        decodeRequirements: ["cap:m#Read.next"],
      });
    }),
    [
      "validation/002 declarations[8].value: schema() needs an identity data Schema with no services",
      "validation/002 declarations[8].value: the initializer type Schema<type:m#Int, type:m#Int, cap:m#Read.next, never> does not fit the constant type Schema<type:m#Int, type:m#Int, never, never>",
    ],
  );
});

Deno.test("schema() rejects an identity Schema with an encode requirement", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(schemaOf(ir, "solo").type, {
        encodeRequirements: ["cap:m#Read.next"],
      });
    }),
    [
      "validation/002 declarations[8].value: schema() needs an identity data Schema with no services",
      "validation/002 declarations[8].value: the initializer type Schema<type:m#Int, type:m#Int, never, cap:m#Read.next> does not fit the constant type Schema<type:m#Int, type:m#Int, never, never>",
    ],
  );
});

Deno.test("schema() rejects an identity Schema over a non-data type", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(schemaOf(ir, "solo").type, {
        decoded: NOT_DATA,
        encoded: NOT_DATA,
      });
    }),
    [
      "validation/001 declarations[8].value.type: Schema decoded and encoded types must be data only",
      "validation/002 declarations[8].value: schema() needs an identity data Schema with no services",
      "validation/002 declarations[8].value: the initializer type Schema<unknown, unknown, never, never> does not fit the constant type Schema<type:m#Int, type:m#Int, never, never>",
    ],
  );
});

Deno.test("schemaConstructorDefault rejects a callback with a parameter", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "madeAgain", 1), { parameters: [INT] });
    }),
    [
      "validation/002 declarations[17].value: schemaConstructorDefault needs an inline make-input callback with no services and only SchemaIssue failure",
      "validation/002 declarations[17].value.arguments[1].type.parameters: the closure declares 0 parameters, its type has 1",
    ],
  );
});

Deno.test("schemaConstructorDefault rejects a callback with a requirement", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "madeAgain", 1).effects, {
        requirements: ["cap:m#Read.next"],
      });
    }),
    [
      "validation/002 declarations[17].value: schemaConstructorDefault needs an inline make-input callback with no services and only SchemaIssue failure",
      "validation/002 declarations[17].value.arguments[1].type: a pure function type must have empty failure and requirement rows",
      "validation/004 declarations[17].value.arguments[1].type.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("schemaConstructorDefault rejects a callback result outside the make input", () => {
  assertEquals(
    forgedModule(
      SOURCE,
      (ir) => forgeConstant(ir, "base", { makeInput: TEXT }),
    ),
    [
      "validation/002 declarations[9].value: the initializer type Schema<type:m#Int, type:m#Int, never, never> does not fit the constant type Schema<type:m#Int, type:m#Int, never, never, type:m#Text>",
      "validation/002 declarations[16].value: schemaConstructorDefault needs an inline make-input callback with no services and only SchemaIssue failure",
    ],
  );
});

Deno.test("schemaNullToMissingKey rejects a Schema with a nullable encoded type", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) =>
      forgeConstant(ir, "wire", {
        encoded: { kind: "union", members: [TEXT, NIL] },
      })),
    [
      "validation/002 declarations[10].value: the initializer type Schema<type:m#Text, type:m#Text, never, never> does not fit the constant type Schema<type:m#Text, type:m#Text | null, never, never>",
      "validation/002 declarations[18].value: schemaNullToMissingKey needs one ordinary Schema with nonnullable decoded and encoded types",
    ],
  );
});

Deno.test("schemaDefaultKey rejects an options record with two fields", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const options = schemaOf(ir, "defaulted").arguments[2];
      assert(options.kind === "record");
      Object.assign(options, {
        fields: [...options.fields, {
          ...structuredClone(options.fields[0]),
          name: "extra",
        }],
      });
    }),
    [
      'validation/002 declarations[19].value: schemaDefaultKey options need one literal "omit" or "passthrough" encodingStrategy',
      'validation/002 declarations[19].value.arguments[2].fields[1]: the record type { encodingStrategy: "omit" | "passthrough" } has no field extra',
    ],
  );
});

Deno.test("schemaDefaultKey rejects an options field with another name", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const options = schemaOf(ir, "defaulted").arguments[2];
      assert(options.kind === "record");
      Object.assign(options.fields[0], { name: "strategy" });
    }),
    [
      'validation/002 declarations[19].value: schemaDefaultKey options need one literal "omit" or "passthrough" encodingStrategy',
      'validation/002 declarations[19].value.arguments[2].fields[0]: the record type { encodingStrategy: "omit" | "passthrough" } has no field strategy',
      "validation/002 declarations[19].value.arguments[2]: the construction is missing the required fields [encodingStrategy]",
    ],
  );
});

Deno.test("schemaDefaultKey rejects a fallback that is not an inline closure", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const call = schemaOf(ir, "plainDefault");
      const reference: Expr = {
        kind: "reference",
        target: "value:m#makeText",
        type: functionOf(ir, "makeText").type,
        execution: "pure",
        effects: { failures: [], requirements: [] },
        span: call.arguments[1].span,
      };
      Object.assign(call, { arguments: [call.arguments[0], reference] });
    }),
    [
      "validation/002 declarations[20].value: schemaDefaultKey needs a callback returning the decoded field type with only SchemaIssue or SchemaError failure",
    ],
  );
});

Deno.test("schemaDefaultKey rejects a fallback with a parameter", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "plainDefault", 1), { parameters: [INT] });
    }),
    [
      "validation/002 declarations[20].value: schemaDefaultKey needs a callback returning the decoded field type with only SchemaIssue or SchemaError failure",
      "validation/002 declarations[20].value.arguments[1].type.parameters: the closure declares 0 parameters, its type has 1",
    ],
  );
});

Deno.test("schemaDefaultKey rejects a pure fallback that lists a failure", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "plainDefault", 1).effects, {
        failures: ["error:effect/SchemaIssue"],
      });
    }),
    [
      "validation/002 declarations[20].value: schemaDefaultKey needs a callback returning the decoded field type with only SchemaIssue or SchemaError failure",
      "validation/002 declarations[20].value.arguments[1].type: a pure function type must have empty failure and requirement rows",
      "validation/004 declarations[20].value.arguments[1].type.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("schemaDefaultKey rejects a pure fallback that lists a requirement", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(callbackType(ir, "plainDefault", 1).effects, {
        requirements: ["cap:m#Read.next"],
      });
    }),
    [
      "validation/002 declarations[20].value: schemaDefaultKey needs a callback returning the decoded field type with only SchemaIssue or SchemaError failure",
      "validation/002 declarations[20].value.arguments[1].type: a pure function type must have empty failure and requirement rows",
      "validation/004 declarations[20].value.arguments[1].type.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("schemaDefaultNullKey rejects a Schema with a nullable encoded type", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) =>
      forgeConstant(ir, "raw", {
        encoded: { kind: "union", members: [TEXT, NIL] },
      })),
    [
      "validation/002 declarations[11].value: the initializer type Schema<type:m#Text, type:m#Text, never, never> does not fit the constant type Schema<type:m#Text, type:m#Text | null, never, never>",
      "validation/002 declarations[21].value: schemaDefaultNullKey needs nonnullable decoded and encoded field types",
    ],
  );
});

Deno.test("schemaUnion rejects a second argument", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const call = schemaOf(ir, "joined");
      Object.assign(call, {
        arguments: [...call.arguments, structuredClone(call.arguments[0])],
      });
    }),
    [
      "validation/002 declarations[22].value: schemaUnion needs an inline tuple of branches",
    ],
  );
});

Deno.test("schemaUnion rejects a branch list that is not an inline tuple", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const call = schemaOf(ir, "joined");
      const list = call.arguments[0];
      const holder = {
        ...structuredClone(constantOf(ir, "flat")),
        id: "value:m#pair",
        name: "pair",
        type: list.type,
        value: list,
      };
      const reference: Expr = {
        kind: "reference",
        target: "value:m#pair",
        type: list.type,
        execution: "pure",
        effects: { failures: [], requirements: [] },
        span: list.span,
      };
      Object.assign(call, { arguments: [reference] });
      const at = ir.declarations.findIndex((d) =>
        d.kind === "constant" && d.name === "joined"
      );
      Object.assign(ir, {
        declarations: [
          ...ir.declarations.slice(0, at),
          holder,
          ...ir.declarations.slice(at),
        ],
      });
    }),
    [
      "validation/002 declarations[23].value: schemaUnion needs an inline tuple of branches",
    ],
  );
});
