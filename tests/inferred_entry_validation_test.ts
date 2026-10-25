import { assert, assertEquals } from "@std/assert";
import type { Expr, FunctionDecl, ModuleIR } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { exprChildren } from "../src/core/validate/expr.ts";
import { validateModule } from "../src/core/validate/index.ts";

function lower(
  text: string,
): { readonly ir: ModuleIR; readonly sources: ReadonlyMap<string, string> } {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const result = lowerProject(checked.value).get("m");
  assert(result?.ok, JSON.stringify(result));
  return { ir: result.value, sources: new Map([["m.eff", text]]) };
}

function functionDecl(ir: ModuleIR, name: string): FunctionDecl {
  const declaration = ir.declarations.find((item): item is FunctionDecl =>
    item.kind === "function" && item.name === name
  );
  assert(declaration !== undefined);
  return declaration;
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

const SOURCE = `
type Text = string
type Raw = { name: unknown }
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)
const raw = (input: unknown): Text fails SchemaError => entry(input)
const nested = (input: { name: unknown }): Text fails SchemaError => entry(input)
const named = (input: Raw): Text fails SchemaError => entry(input)
const direct = (input: unknown): Text fails SchemaError => entry({ name: input })
const maker = (): Text => { const local = (value: Text): Text => value; local("ok") }
`;

Deno.test("checked entries and recursive unknown calls validate through public IR", () => {
  const lowered = lower(SOURCE);
  assertEquals(validateModule(lowered.ir, lowered.sources), []);
});

Deno.test("checked entry metadata must match exported parameters and generated effects", () => {
  const lowered = lower(SOURCE);

  const wrongIds = structuredClone(lowered.ir);
  Object.assign(functionDecl(wrongIds, "entry"), {
    entryValidation: ["local:m#wrong"],
  });
  assert(
    validationMessages(wrongIds, lowered.sources).some((message) =>
      message.includes("declaration order")
    ),
  );

  const local = structuredClone(lowered.ir);
  const raw = functionDecl(local, "raw");
  Object.assign(raw.type, { checked: [true] });
  Object.assign(raw, { entryValidation: [raw.parameters[0].id] });
  assert(
    validationMessages(local, lowered.sources).some((message) =>
      message.includes("only an exported function")
    ),
  );

  const missingFailure = structuredClone(lowered.ir);
  const entry = functionDecl(missingFailure, "entry");
  Object.assign(entry.type.effects, { failures: [] });
  Object.assign(entry.type, { execution: "pure" });
  const messages = validationMessages(missingFailure, lowered.sources);
  assert(messages.some((message) => message.includes("SchemaError")));
  assert(messages.some((message) => message.includes("expected effect")));
});

Deno.test("closures and conversions cannot fabricate checked entry capability", () => {
  const lowered = lower(SOURCE);
  const closureIr = structuredClone(lowered.ir);
  const maker = functionDecl(closureIr, "maker");
  const closure = expressions(maker.body).find((expression) =>
    expression.kind === "closure"
  );
  assert(closure !== undefined && closure.type.kind === "function");
  Object.assign(closure.type, { checked: [true] });
  assert(
    validationMessages(closureIr, lowered.sources).some((message) =>
      message.includes("closure cannot claim")
    ),
  );

  const conversion = lower(
    SOURCE.replace(
      "(value: Text): Text => value",
      "(value: Text): Text fails SchemaError => value",
    ),
  );
  const conversionIr = structuredClone(conversion.ir);
  const entry = functionDecl(conversionIr, "entry");
  const plainReference = expressions(entry.body).find((expression) =>
    expression.kind === "reference" && expression.target.endsWith("#consume")
  );
  assert(
    plainReference !== undefined && plainReference.type.kind === "function",
  );
  Object.assign(plainReference.type, { checked: [true] });
  assert(
    validationMessages(conversionIr, conversion.sources).some((message) =>
      message.includes("recorded")
    ),
  );
});

Deno.test("checked entries reject deferred parameter contracts", () => {
  const lowered = lower(SOURCE);
  const ir = structuredClone(lowered.ir);
  const entry = functionDecl(ir, "entry");
  const deferred = {
    kind: "effect" as const,
    result: { kind: "primitive" as const, name: "string" as const },
    effects: { failures: [], requirements: [] },
  };
  Object.assign(entry.parameters[0], { type: deferred });
  Object.assign(entry.type, { parameters: [deferred] });
  assert(
    validationMessages(ir, lowered.sources).some((message) =>
      message.includes("schema-derivable")
    ),
  );
});

Deno.test("checked calls do not hide an invalid known refinement beside unknown data", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
type Output = { amount: Positive, other: unknown }
const take = (value: Positive): Positive => value
export const entry = (input): Output fails SchemaError =>
  ({ amount: take(input.amount), other: input.other })
const direct = (raw: unknown): Output fails SchemaError =>
  entry({ amount: 1, other: raw })
`);
  const ir = structuredClone(lowered.ir);
  const direct = functionDecl(ir, "direct");
  const record = expressions(direct.body).find((expression) =>
    expression.kind === "record"
  );
  assert(record !== undefined && record.type.kind === "record");
  const amount = record.fields.find((field) => field.name === "amount")?.value;
  assert(amount?.kind === "literal");
  Object.assign(amount, {
    value: 0,
    type: { kind: "literal", value: 0 },
    proofs: [],
  });
  Object.assign(record.type, {
    fields: record.type.fields.map((field) =>
      field.name === "amount"
        ? { ...field, type: { kind: "literal" as const, value: 0 } }
        : field
    ),
  });
  assert(
    validationMessages(ir, lowered.sources).some((message) =>
      message.includes("does not fit the parameter")
    ),
    JSON.stringify(validationMessages(ir, lowered.sources)),
  );
});

Deno.test("unused imported checked contracts retain generated effect and schema invariants", () => {
  const dep = `export type Text = string
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)`;
  const main =
    'import { entry } from "./dep.eff"\nexport const ready = (): void => {}';
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "dep.eff": dep, "main.eff": main }),
    "",
    ["main.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const result = lowerProject(checked.value).get("main");
  assert(result?.ok);
  const sources = new Map([["main.eff", main], ["dep.eff", dep]]);
  assertEquals(validateModule(result.value, sources), []);
  for (const change of ["failures", "execution", "parameter"] as const) {
    const ir = structuredClone(result.value);
    const entry = ir.imports.flatMap((item) => item.values).find((item) =>
      item.id === "value:dep#entry"
    );
    assert(entry !== undefined && entry.type.kind === "function");
    if (change === "failures") {
      Object.assign(entry.type.effects, { failures: [] });
    } else if (change === "execution") {
      Object.assign(entry.type, { execution: "pure" });
    } else {Object.assign(entry.type, {
        parameters: [{
          kind: "function",
          execution: "pure",
          parameters: [],
          result: { kind: "primitive", name: "unit" },
          effects: { failures: [], requirements: [] },
        }],
      });}
    assert(
      validateModule(ir, sources).some((diagnostic) =>
        diagnostic.message.includes("checked")
      ),
      change,
    );
  }
});

Deno.test("imported checked entries retain their producer's sealed validation authority", () => {
  const dep = `export sealed type Text = string where s => len(s) > 0
const consume = (value: Text): Text => value
export const entry = (input): Text fails SchemaError => consume(input.name)`;
  const main =
    'import { entry } from "./dep.eff"\nexport const ready = (): void => {}';
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "dep.eff": dep, "main.eff": main }),
    "",
    ["main.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const result = lowerProject(checked.value).get("main");
  assert(result?.ok);
  assertEquals(
    validateModule(
      result.value,
      new Map([["main.eff", main], ["dep.eff", dep]]),
    ),
    [],
  );
});
