import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { exprChildren } from "../src/core/validate/expr.ts";
import { validateModule } from "../src/core/validate/index.ts";

const declarations = `
type Int = int
type Window = { low: Int, high: Int } where w => w.high > w.low
const take = (value: Window): Window => value
export const entry = (input): Window fails SchemaError => take(input)
`;

function check(source: string) {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": declarations + source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value;
}

function records(expression: Expr): readonly Expr[] {
  return [expression, ...exprChildren(expression).flatMap(records)].filter((
    node,
  ) => node.kind === "record");
}

Deno.test("raw record components defer relational predicates to checked entries", () => {
  const checked = check(`
const direct = (raw: unknown): Window fails SchemaError => entry({ low: raw, high: 2 })
const alias = (raw: unknown): Window fails SchemaError => { const value = raw; entry({ low: value, high: 2 }) }
type Flag = boolean
const conditional = (flag: Flag, raw: unknown): Window fails SchemaError => entry(if (flag) { ({ low: raw, high: 2 }) } else { ({ low: raw, high: 3 }) })
const matched = (flag: Flag, raw: unknown): Window fails SchemaError => entry(match (flag) { true => ({ low: raw, high: 2 }), false => ({ low: raw, high: 3 }) })
type Box = { window: Window }
const takeBox = (value: Box): Box => value
export const boxEntry = (input): Box fails SchemaError => takeBox(input)
const nested = (raw: unknown): Box fails SchemaError => boxEntry({ window: { low: raw, high: 2 } })
type OptionalWindow = { low: Int, high: Int, note?: Int } where w => w.high > w.low
const takeOptional = (value: OptionalWindow): OptionalWindow => value
export const optionalEntry = (input): OptionalWindow fails SchemaError => takeOptional(input)
const missingOptional = (raw: unknown): OptionalWindow fails SchemaError => optionalEntry({ low: raw, high: 2 })
`);
  assertEquals(checked.diagnostics, []);
  const lowered = lowerProject(checked);
  for (
    const diagnostics of validateProject(checked.analysis.project, lowered)
      .values()
  ) assertEquals(diagnostics, []);
  const module = lowered.get("m");
  assert(module?.ok);
  const direct = module.value.declarations.find((d) =>
    d.kind === "function" && d.name === "direct"
  );
  assert(direct?.kind === "function");
  const record = records(direct.body)[0];
  assert(record?.type.kind === "record");
  assertEquals(record.type.fields.find((f) => f.name === "low")?.type, {
    kind: "primitive",
    name: "unknown",
  });
  assertEquals(record.proofs, undefined);
});

Deno.test("fully typed record values retain their static predicate obligations", () => {
  const checked = check(`
const unproved = (low: Int): Window fails SchemaError => entry({ low, high: 2 })
const invalid = (): Window fails SchemaError => entry({ low: 3, high: 2 })
type NamedWindow = { low: Int, high: Int, label: Int } where w => w.high > w.low
const takeNamed = (value: NamedWindow): NamedWindow => value
export const namedEntry = (input): NamedWindow fails SchemaError => takeNamed(input)
const invalidPartial = (raw: unknown): NamedWindow fails SchemaError => namedEntry({ low: 3, high: 2, label: raw })
const unprovedPartial = (low: Int, high: Int, raw: unknown): NamedWindow fails SchemaError => namedEntry({ low, high, label: raw })
`);
  assertEquals(checked.diagnostics.map((d) => d.code), [
    "type-mismatch/013",
    "type-mismatch/013",
    "type-mismatch/013",
    "type-mismatch/013",
  ]);
});

Deno.test("an unrelated unknown field cannot hide a forged record predicate", () => {
  const source = `
type NamedWindow = { low: Int, high: Int, label: Int } where w => w.high > w.low
const takeNamed = (value: NamedWindow): NamedWindow => value
export const namedEntry = (input): NamedWindow fails SchemaError => takeNamed(input)
const good = (raw: unknown): NamedWindow fails SchemaError => namedEntry({ low: 1, high: 2, label: raw })
`;
  const checked = check(source);
  assertEquals(checked.diagnostics, []);
  const result = lowerProject(checked).get("m");
  assert(result?.ok);
  const sources = new Map([["m.eff", declarations + source]]);
  assertEquals(validateModule(result.value, sources), []);
  const change = (ir: ModuleIR) => {
    const good = ir.declarations.find((d) =>
      d.kind === "function" && d.name === "good"
    );
    assert(good?.kind === "function");
    const record = records(good.body)[0];
    assert(record?.kind === "record");
    const low = record.fields.find((field) => field.name === "low")?.value;
    assert(low?.kind === "literal");
    Object.assign(low, { value: 3 });
    return record;
  };
  const badValue = structuredClone(result.value);
  change(badValue);
  assert(
    validateModule(badValue, sources).some((d) =>
      d.message.includes("certificate is invalid")
    ),
  );

  const erased = structuredClone(result.value);
  const record = change(erased);
  assert(record.type.kind === "named");
  const named = erased.declarations.find((d) =>
    d.kind === "type" && d.name === "NamedWindow"
  );
  assert(named?.kind === "type" && named.definition.kind === "nominal");
  assert(named.definition.base.kind === "record");
  Object.assign(record, {
    type: {
      kind: "record",
      fields: named.definition.base.fields.map((field) =>
        field.name === "label"
          ? { ...field, type: { kind: "primitive", name: "unknown" } }
          : field
      ),
    },
    proofs: [],
  });
  assert(validateModule(erased, sources).length > 0);
});
