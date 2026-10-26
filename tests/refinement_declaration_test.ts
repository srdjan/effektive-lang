import { assert, assertEquals } from "@std/assert";
import { analyzeProject } from "../src/core/analyze.ts";
import { modesAsSolved, signatureType } from "../src/core/signatures.ts";
import { checkModuleDeclarations } from "../src/core/check.ts";
import type { TypeId } from "../src/core/ir.ts";
import { parse } from "../src/core/parse.ts";
import { memoryHost } from "../src/core/source.ts";
import { childrenOf, kindName } from "../src/core/syntax.ts";
import { functionTypeFromIr, functionTypeToIr } from "../src/core/type_ir.ts";
import { TypeTable } from "../src/core/types.ts";

function checkDeclarations(text: string) {
  const analysis = analyzeProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(analysis.ok, JSON.stringify(analysis));
  const table = new TypeTable();
  const declarations = checkModuleDeclarations(
    analysis.value,
    "m",
    table,
    new Map(),
  );
  return { declarations, table };
}

Deno.test("a type declaration parses its refinement clause", () => {
  const parsed = parse(
    "m.eff",
    "export type Positive = int where n => n > 0\n",
  );
  assertEquals(parsed.diagnostics, []);
  const declaration = childrenOf(parsed.tree, parsed.tree.root).find((node) =>
    kindName(parsed.tree.kinds[node]) === "TypeDecl"
  );
  assertEquals(
    declaration === undefined
      ? []
      : [...childrenOf(parsed.tree, declaration)].map((node) =>
        kindName(parsed.tree.kinds[node])
      ),
    ["Token", "Token", "Name", "Token", "NamedType", "RefinementClause"],
  );
});

Deno.test("identity refinements normalize integer and length constraints", () => {
  const checked = checkDeclarations(`
export type Positive = int where n => n > 0
export type Window = { name: string, low: int, high: int } where w =>
  len(w.name) > 0 && w.high - w.low >= 1
export type Large = int where n => n > 9007199254740993
`);
  assertEquals(checked.declarations.diagnostics, []);
  assertEquals(checked.declarations.types.map((type) => type.predicate), [
    {
      kind: "difference",
      left: { kind: "zero" },
      right: { kind: "input" },
      maximum: "-1",
    },
    {
      kind: "and",
      operands: [
        {
          kind: "difference",
          left: { kind: "zero" },
          right: { kind: "length", path: ["name"], unit: "utf16" },
          maximum: "-1",
        },
        {
          kind: "difference",
          left: { kind: "field", path: ["low"] },
          right: { kind: "field", path: ["high"] },
          maximum: "-1",
        },
      ],
    },
    {
      kind: "difference",
      left: { kind: "zero" },
      right: { kind: "input" },
      maximum: "-9007199254740994",
    },
  ]);
});

Deno.test("transparent and unsupported refinements report declaration 018", () => {
  const checked = checkDeclarations(`
type Int = int
type Alias = Int where n => n > 0
type Optional = { value?: int } where x => x.value > 0
type Float = number where n => n > 0.5
type Called = int where n => other(n) > 0
`);
  assertEquals(
    checked.declarations.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.message,
    ]),
    [
      [
        "declaration/018",
        "the transparent alias `Alias` cannot have a refinement",
      ],
      ["declaration/018", "the field `value` must be required"],
      ["declaration/018", "a compared value must have type `int`"],
      ["declaration/018", "a refinement supports only the `len` call"],
    ],
  );
});

Deno.test("type tables preserve predicates and reject unproved adoption", () => {
  const checked = checkDeclarations("type Positive = int where n => n > 0\n");
  const id = "type:m#Positive" as TypeId;
  const predicate = checked.table.predicateOf(id);
  assert(predicate !== undefined);
  assertEquals(
    checked.table.isAssignable(checked.table.int, checked.table.named(id)),
    false,
  );
  assertEquals(
    checked.table.isAssignable(checked.table.named(id), checked.table.int),
    true,
  );

  const loaded = new TypeTable();
  loaded.load({
    types: checked.declarations.types,
    errors: checked.declarations.errors,
  });
  assertEquals(loaded.predicateOf(id), predicate);
});

Deno.test("tag inference preserves a record refinement", () => {
  const checked = checkDeclarations(`
type PositiveRow = { value: int } where row => row.value > 0
error Stop = {}
type Domain = PositiveRow | Stop
`);
  assertEquals(checked.declarations.diagnostics, []);
  const id = "type:m#PositiveRow" as TypeId;
  assert(checked.table.taggedRecordOf(id) !== undefined);
  const expected = {
    kind: "difference",
    left: { kind: "zero" },
    right: { kind: "field", path: ["value"] },
    maximum: "-1",
  } as const;
  assertEquals(checked.table.predicateOf(id), expected);
  assertEquals(checked.declarations.types[0].predicate, expected);
});

Deno.test("checked function capability survives IR and only discards", () => {
  const table = new TypeTable();
  const plain = table.function({
    execution: "pure",
    parameters: [table.int],
    result: table.int,
    failures: [],
    requirements: [],
  });
  const checked = table.function({
    execution: "pure",
    parameters: [table.int],
    checked: [true],
    result: table.int,
    failures: [],
    requirements: [],
  });
  assertEquals(table.isAssignable(checked, plain), true);
  assertEquals(table.isAssignable(plain, checked), false);
  const ir = functionTypeToIr(table, checked);
  assertEquals(ir.checked, [true]);
  assertEquals(functionTypeFromIr(table, ir), checked);
});

Deno.test("omitted and explicit unknown parameters are inferred contracts", () => {
  const checked = checkDeclarations(`
type Int = int
type Mapper = (value) => Int
export const omitted = (value): Int => 1
export const explicit = (value: unknown): Int => 1
export const bound: (value: Int) => Int = (value) => 1
service Inputs { read(value): Int }
`);
  assertEquals(checked.declarations.diagnostics, []);
  const omitted = checked.declarations.values.get("value:m#omitted");
  const explicit = checked.declarations.values.get("value:m#explicit");
  const bound = checked.declarations.values.get("value:m#bound");
  assert(omitted?.kind === "function");
  assert(explicit?.kind === "function");
  assert(bound?.kind === "function");
  assertEquals(omitted.parameters.map((parameter) => parameter.inferred), [
    true,
  ]);
  assertEquals(explicit.parameters.map((parameter) => parameter.inferred), [
    true,
  ]);
  assertEquals(bound.parameters.map((parameter) => parameter.inferred), [true]);
  for (const signature of [omitted, explicit]) {
    const unknownType = signatureType(
      checked.table,
      signature,
      modesAsSolved(new Map([[signature.id, "pure"]])),
    );
    assert(unknownType.ok);
    assertEquals(unknownType.value.ir.checked, undefined);
  }
  const type = signatureType(
    checked.table,
    bound,
    modesAsSolved(new Map([[bound.id, "pure"]])),
  );
  assert(type.ok);
  assertEquals(type.value.ir.checked, [true]);
  assertEquals(checked.declarations.services[0].methods[0].type.parameters, [
    { kind: "primitive", name: "unknown" },
  ]);
  const mapper = checked.declarations.types.find((item) =>
    item.name === "Mapper"
  );
  assert(mapper?.definition.kind === "nominal");
  assertEquals(mapper.definition.base, {
    kind: "function",
    execution: "effect",
    parameters: [{ kind: "primitive", name: "unknown" }],
    result: { kind: "named", id: "type:m#Int" },
    effects: { failures: [], requirements: [] },
  });
});

Deno.test("an exported function still needs its result declaration", () => {
  const checked = checkDeclarations(
    "export const missing = (value) => value\n",
  );
  assertEquals(checked.declarations.diagnostics.map((item) => item.code), [
    "declaration/005",
  ]);
});

Deno.test("refinements reject sums that are not difference constraints", () => {
  const checked = checkDeclarations(`
type Invalid = { low: int, high: int } where r => r.low + r.high > 0
`);
  assertEquals(
    checked.declarations.diagnostics.map((diagnostic) => diagnostic.code),
    ["declaration/018"],
  );
});
