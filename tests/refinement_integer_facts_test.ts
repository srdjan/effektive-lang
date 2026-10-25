import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR, Type, TypeDecl } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { exprChildren } from "../src/core/validate/expr.ts";
import { validateModule } from "../src/core/validate/index.ts";

function diagnostics(source: string): readonly string[] {
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((diagnostic) => diagnostic.code);
}

function lower(
  source: string,
): { readonly ir: ModuleIR; readonly sources: ReadonlyMap<string, string> } {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const lowered = lowerProject(checked.value).get("m");
  assert(lowered?.ok, JSON.stringify(lowered));
  return { ir: lowered.value, sources: new Map([["m.eff", source]]) };
}

function expressions(expression: Expr): readonly Expr[] {
  return [expression, ...exprChildren(expression).flatMap(expressions)];
}

function validationMessages(
  ir: ModuleIR,
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  return validateModule(ir, sources).map((diagnostic) => diagnostic.message);
}

const FLOAT: Type = { kind: "named", id: "type:m#Float" };
const INT: Type = { kind: "named", id: "type:m#Int" };

Deno.test("Float conditions cannot establish integer refinement facts", () => {
  const cases = [
    `
type Float = number
type Positive = int where n => n > 0
const bad = (x: Float): Positive => if (x > 0 && x < 1) { 0 } else { 1 }
`,
    `
type Float = number
type Decimal = Float
type Positive = int where n => n > 0
const bad = (x: Decimal): Positive => if (x > 0 && x < 1) { 0 } else { 1 }
`,
    `
type Float = number
type Decimal = Float
type Input = { inner: { value: Decimal } }
type Positive = int where n => n > 0
const bad = (input: Input): Positive =>
  if (input.inner.value > 0 && input.inner.value < 1) { 0 } else { 1 }
`,
    `
type Float = number
type Input = { value: Float }
type Positive = int where n => n > 0
const bad = (input: Input): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
`,
    `
type Float = number
type Flag = boolean
type Left = { value: Float, left: Flag }
type Right = { value: Float, right: Flag }
type Input = Left | Right
type Positive = int where n => n > 0
const bad = (input: Input): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
`,
    `
type Float = number
type Positive = int where n => n > 0
const bad = (x: Float): Positive =>
  if (x + 1 > 1 && x + 1 < 2) { 0 } else { 1 }
`,
  ];
  for (const source of cases) {
    assertEquals(diagnostics(source), ["type-mismatch/013"]);
  }
});

Deno.test("integer and length facts remain available", () => {
  assertEquals(
    diagnostics(`
type IntAlias = int
type Text = string
type Flag = boolean
type Input = { inner: { value: IntAlias } }
type Left = { value: IntAlias, left: Flag }
type Right = { value: IntAlias, right: Flag }
type UnionInput = Left | Right
type Positive = int where n => n > 0
type ValidText = string where text => len(text) >= 0
const parameter = (x: IntAlias): Positive =>
  if (x > 0 && x < 1) { 0 } else { 1 }
const arithmetic = (x: IntAlias): Positive =>
  if (x + 1 > 1 && x + 1 < 2) { 0 } else { 1 }
const nested = (input: Input): Positive =>
  if (input.inner.value > 0 && input.inner.value < 1) { 0 } else { 1 }
const union = (input: UnionInput): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
const length = (text: Text): ValidText => ValidText(text)
`),
    [],
  );
});

Deno.test("independent validation rejects a certificate after an integer parameter becomes Float", () => {
  const lowered = lower(`
type Float = number
type Int = int
type Positive = int where n => n > 0
const guarded = (x: Int): Positive =>
  if (x > 0 && x < 1) { 0 } else { 1 }
`);
  const ir = structuredClone(lowered.ir);
  const declaration = ir.declarations.find((item) => item.kind === "function");
  assert(declaration?.kind === "function");
  const parameter = declaration.parameters[0];
  assert(parameter !== undefined);
  Object.assign(parameter, { type: FLOAT });
  Object.assign(declaration.type.parameters, { 0: FLOAT });
  for (const expression of expressions(declaration.body)) {
    if (expression.kind === "reference" && expression.target === parameter.id) {
      Object.assign(expression, { type: FLOAT });
    }
  }
  const messages = validationMessages(ir, lowered.sources);
  assert(
    messages.some((message) => message.includes("certificate is invalid")),
    JSON.stringify(messages),
  );
});

Deno.test("independent validation rejects a certificate after an integer field becomes Float", () => {
  const lowered = lower(`
type Float = number
type Int = int
type Input = { value: Int }
type Positive = int where n => n > 0
const guarded = (input: Input): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
`);
  const ir = structuredClone(lowered.ir);
  const input = ir.declarations.find((item): item is TypeDecl =>
    item.kind === "type" && item.name === "Input"
  );
  assert(input !== undefined && input.definition.kind === "nominal");
  assert(input.definition.base.kind === "record");
  Object.assign(input.definition.base.fields[0], { type: FLOAT });
  const declaration = ir.declarations.find((item) => item.kind === "function");
  assert(declaration?.kind === "function");
  for (const expression of expressions(declaration.body)) {
    if (expression.kind === "get" && expression.field === "value") {
      Object.assign(expression, { type: FLOAT });
    }
  }
  const messages = validationMessages(ir, lowered.sources);
  assert(
    messages.some((message) => message.includes("certificate is invalid")),
    JSON.stringify(messages),
  );
});

Deno.test("independent validation rejects a certificate after an integer field becomes optional", () => {
  const lowered = lower(`
type Int = int
type Input = { value: Int }
type Positive = int where n => n > 0
const guarded = (input: Input): Positive =>
  if (input.value > 0 && input.value < 1) { 0 } else { 1 }
`);
  const ir = structuredClone(lowered.ir);
  const input = ir.declarations.find((item): item is TypeDecl =>
    item.kind === "type" && item.name === "Input"
  );
  assert(input !== undefined && input.definition.kind === "nominal");
  assert(input.definition.base.kind === "record");
  Object.assign(input.definition.base.fields[0], { optional: true });
  const declaration = ir.declarations.find((item) => item.kind === "function");
  assert(declaration?.kind === "function");
  for (const expression of expressions(declaration.body)) {
    if (expression.kind === "get" && expression.field === "value") {
      Object.assign(expression, { type: { kind: "option", element: INT } });
    }
  }
  const messages = validationMessages(ir, lowered.sources);
  assert(
    messages.some((message) => message.includes("certificate is invalid")),
    JSON.stringify(messages),
  );
});
