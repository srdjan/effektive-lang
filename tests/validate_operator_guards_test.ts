// Proves that the validator rejects each forged binary operator that breaks
// exactly one guard condition, and that it accepts the refinement flow of `||`.
// Each test lowers a valid module, forges one operand type or one operator in
// the IR, and requires the exact diagnostics. These tests kill the mutants of
// `binary`, `instantArithmetic`, and `durationArithmetic` in
// `src/core/validate/expr.ts`.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR, Type } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { forgedModule } from "./helpers.ts";

type BinaryOperator = Extract<Expr, { kind: "binary" }>["operator"];

const SOURCE = `type Int = int
type Num = number
type Text = string
type Flag = boolean
type Positive = int where n => n > 0
const take = (p: Positive): Flag => true
export const either = (p: Positive): Flag => (p <= 1) || take(Positive(p - 1))
export const both = (a: Flag, b: Flag): Flag => a && b
export const equal = (a: Text, b: Text): Flag => a === b
export const join = (a: Text, b: Text): Text => a + b
export const instantMinus = (i: Instant, d: Duration): Instant => i - d
export const durationPlus = (d: Duration, e: Duration): Duration => d + e
export const durationTimes = (d: Duration, n: Int): Duration => d * n
export const durationOver = (d: Duration, n: Int): Duration => d / n
`;

const INT: Type = { kind: "named", id: "type:m#Int" };
const NUM: Type = { kind: "named", id: "type:m#Num" };
const DURATION: Type = { kind: "named", id: "type:effect/Duration" };
const INSTANT: Type = { kind: "named", id: "type:effect/Instant" };
const TEXT_OR_INT: Type = {
  kind: "union",
  members: [
    { kind: "primitive", name: "string" },
    { kind: "primitive", name: "int" },
  ],
};
const LITERAL_TEXT: Type = { kind: "literal", value: "a" };
const PRIMITIVE_NUMBER: Type = { kind: "primitive", name: "number" };

function functionOf(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) =>
    d.kind === "function" && d.name === name
  );
  assert(found?.kind === "function", name);
  return found;
}

/** The binary expression that is the body of the named function. */
function bodyOf(ir: ModuleIR, name: string) {
  const { body } = functionOf(ir, name);
  assert(body.kind === "binary", name);
  return body;
}

/** Change the declared type of one parameter, in the parameter and in the function type. */
function forgeParameter(
  ir: ModuleIR,
  name: string,
  index: number,
  type: Type,
): void {
  const declaration = functionOf(ir, name);
  Object.assign(declaration.parameters[index], { type });
  assert(declaration.type.kind === "function", name);
  Object.assign(declaration.type.parameters, { [index]: type });
}

function forgeOperator(
  ir: ModuleIR,
  name: string,
  operator: BinaryOperator,
): void {
  Object.assign(bodyOf(ir, name), { operator });
}

Deno.test("a || operand refines its right operand with the negated left condition", () => {
  assertEquals(forgedModule(SOURCE, () => {}), []);
});

function forged(change: (ir: ModuleIR) => void): string[] {
  return forgedModule(SOURCE, change);
}

Deno.test("&& rejects a non-boolean right operand", () => {
  assertEquals(forged((ir) => forgeParameter(ir, "both", 1, INT)), [
    "validation/002 declarations[7].body: the operator && does not accept operands of type type:m#Flag and type:m#Int",
    "validation/002 declarations[7].body.right.type: expected type:m#Int, recorded type:m#Flag",
  ]);
});

Deno.test("&& rejects a non-boolean left operand", () => {
  assertEquals(forged((ir) => forgeParameter(ir, "both", 0, INT)), [
    "validation/002 declarations[7].body.left.type: expected type:m#Int, recorded type:m#Flag",
    "validation/002 declarations[7].body: the operator && does not accept operands of type type:m#Int and type:m#Flag",
  ]);
});

Deno.test("=== rejects a literal operand against a mixed union", () => {
  assertEquals(
    forged((ir) => {
      forgeParameter(ir, "equal", 0, TEXT_OR_INT);
      forgeParameter(ir, "equal", 1, LITERAL_TEXT);
    }),
    [
      "validation/002 declarations[8].body.left.type: expected string | int, recorded type:m#Text",
      'validation/002 declarations[8].body: the operator === does not accept operands of type string | int and "a"',
      'validation/002 declarations[8].body.right.type: expected "a", recorded type:m#Text',
    ],
  );
});

Deno.test("- on two strings is a mismatch", () => {
  assertEquals(forged((ir) => forgeOperator(ir, "join", "-")), [
    "validation/002 declarations[9].body: the operator - does not accept operands of type type:m#Text and type:m#Text",
  ]);
});

Deno.test("Instant * Duration is a mismatch", () => {
  assertEquals(forged((ir) => forgeOperator(ir, "instantMinus", "*")), [
    "validation/002 declarations[10].body: the operator * does not accept operands of type Instant and Duration",
  ]);
});

Deno.test("Duration - Instant is a mismatch", () => {
  assertEquals(
    forged((ir) => {
      forgeParameter(ir, "instantMinus", 0, DURATION);
      forgeParameter(ir, "instantMinus", 1, INSTANT);
    }),
    [
      "validation/002 declarations[10].body.left.type: expected Duration, recorded Instant",
      "validation/002 declarations[10].body: the operator - does not accept operands of type Duration and Instant",
      "validation/002 declarations[10].body.right.type: expected Instant, recorded Duration",
    ],
  );
});

Deno.test("Duration * Duration has the type int, not Duration", () => {
  assertEquals(forged((ir) => forgeOperator(ir, "durationPlus", "*")), [
    "validation/002 declarations[11].body.type: expected int, recorded Duration",
    "validation/002 declarations[11].body: the body type int does not fit the declared result Duration",
  ]);
});

Deno.test("Duration + number is a mismatch even when the number is not an integer", () => {
  assertEquals(
    forged((ir) => {
      forgeOperator(ir, "durationTimes", "+");
      forgeParameter(ir, "durationTimes", 1, PRIMITIVE_NUMBER);
    }),
    [
      "validation/002 declarations[12].body: the operator + does not accept operands of type Duration and number",
      "validation/002 declarations[12].body.right.type: expected number, recorded type:m#Int",
    ],
  );
});

Deno.test("Duration / number is a mismatch", () => {
  assertEquals(forged((ir) => forgeParameter(ir, "durationOver", 1, NUM)), [
    "validation/002 declarations[13].body: the operator / does not accept operands of type Duration and type:m#Num",
    "validation/002 declarations[13].body.right.type: expected type:m#Num, recorded type:m#Int",
  ]);
});

Deno.test("integer / Duration is a mismatch", () => {
  assertEquals(
    forged((ir) => {
      forgeParameter(ir, "durationOver", 0, INT);
      forgeParameter(ir, "durationOver", 1, DURATION);
    }),
    [
      "validation/002 declarations[13].body.left.type: expected type:m#Int, recorded Duration",
      "validation/002 declarations[13].body: the operator / does not accept operands of type type:m#Int and Duration",
      "validation/002 declarations[13].body.right.type: expected Duration, recorded type:m#Int",
    ],
  );
});

const SEALED_LIBRARY = `export sealed type Positive = int
`;

const SEALED_CONSUMER = `import { Positive } from "./lib.eff"
type Int = int
type Num = number
export const keep = (p: Positive): Positive => p
export const plus = (a: Int, b: Int): Int => a + b
export const minus = (a: Int, b: Int): Int => a - b
export const times = (a: Int, b: Int): Int => a * b
export const over = (a: Int, b: Int): Num => a / b
`;

const POSITIVE: Type = { kind: "named", id: "type:lib#Positive" };

Deno.test("arithmetic rejects a foreign sealed operand in each operator", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff": SEALED_LIBRARY,
      "main.eff": SEALED_CONSUMER,
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const main = lowerProject(checked.value).get("main");
  assert(main?.ok, JSON.stringify(main));
  const ir = structuredClone(main.value);
  forgeParameter(ir, "plus", 1, POSITIVE);
  forgeParameter(ir, "minus", 0, POSITIVE);
  forgeParameter(ir, "times", 0, POSITIVE);
  forgeParameter(ir, "over", 1, POSITIVE);
  const sources = new Map([["main.eff", SEALED_CONSUMER]]);
  assertEquals(
    validateModule(ir, sources).map((d) => `${d.code} ${d.message}`),
    [
      "validation/002 declarations[3].body: arithmetic cannot use a foreign sealed type",
      "validation/002 declarations[3].body: the operator + does not accept operands of type type:main#Int and type:lib#Positive",
      "validation/002 declarations[3].body.right.type: expected type:lib#Positive, recorded type:main#Int",
      "validation/002 declarations[4].body.left.type: expected type:lib#Positive, recorded type:main#Int",
      "validation/002 declarations[4].body: arithmetic cannot use a foreign sealed type",
      "validation/002 declarations[4].body: the operator - does not accept operands of type type:lib#Positive and type:main#Int",
      "validation/002 declarations[5].body.left.type: expected type:lib#Positive, recorded type:main#Int",
      "validation/002 declarations[5].body: arithmetic cannot use a foreign sealed type",
      "validation/002 declarations[5].body: the operator * does not accept operands of type type:lib#Positive and type:main#Int",
      "validation/002 declarations[6].body: arithmetic cannot use a foreign sealed type",
      "validation/002 declarations[6].body: the operator / does not accept operands of type type:main#Int and type:lib#Positive",
      "validation/002 declarations[6].body.right.type: expected type:lib#Positive, recorded type:main#Int",
    ],
  );
});
