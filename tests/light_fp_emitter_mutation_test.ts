import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import { type EmitContext, emitModule } from "../src/core/typescript.ts";
import type { ModuleIR, Type } from "../src/core/ir.ts";
import { loweredModule } from "./helpers.ts";

const NO_CONFIG: EmitContext = { config: { host: new Map() } };

function emittedText(ir: ModuleIR, context: EmitContext = NO_CONFIG): string {
  const result = emitModule(ir, context);
  assert(result.ok, JSON.stringify(result));
  return result.value.text;
}

Deno.test("an error record with __proto__ uses the safe record helper", () => {
  const text = emittedText(loweredModule(`type Text = string
export error Stop = { __proto__: { value: Text } }
export const stop = (): Stop => Stop({ __proto__: { value: "p" } })
`));

  assertStringIncludes(
    text,
    `new Stop(
    $record<{ readonly __proto__: { readonly value: Text } }>({
      ["__proto__"]: { value: "p" },
    }),
  )`,
  );
});

Deno.test("schemaDefaultKey on null emits the null-default path", () => {
  const text = emittedText(loweredModule(`type Text = string
const text: Schema<Text> = schema()
const value = schemaDefaultKey(text, (): Text => "Ada", { on: "null" })
`));

  assertStringIncludes(
    text,
    "Schema.optionalKey(Schema.NullOr($t1)).pipe(Schema.decodeTo(Schema.toType($t1), { decode: SchemaGetter.transformOptionalEffect",
  );
});

Deno.test("with-resource rejects a forged nonclosure use callback", () => {
  const ir = loweredModule(`type Int = int
export const run = (): Int =>
  using (resource = ({ close: () => {} })) { 1 } finally { resource.close() }
`);
  const run = ir.declarations.find((declaration) => declaration.name === "run");
  assert(run?.kind === "function" && run.body.kind === "with-resource");
  Object.assign(run.body, { use: run.body.use.body });

  assertEquals(emitModule(ir, { config: { host: new Map() } }), {
    ok: false,
    error: {
      tag: "internal",
      module: "m",
      message: "with-resource requires three closures",
    },
  });
});

Deno.test("a forged host schema field emits no field adapter", () => {
  const files = {
    "effektive.json": JSON.stringify({
      host: { p: { interface: "./host.effi", module: "./adapter.ts" } },
    }),
    "host.effi": [
      "export type Row = { count: int }",
      "export type Empty = { reason: string }",
      "export type Outcome = Row | Empty",
      "export service Rows { get(): Row }",
      "export provider RowsLive provides Rows",
      "",
    ].join("\n"),
    "main.eff": [
      'import { Row, Rows, RowsLive } from "host:p"',
      "export const load = (): Row => provide(RowsLive, () => Rows.get())",
      "",
    ].join("\n"),
  };
  const checked = checkProject(memoryHost(files), "", ["main.eff"]);
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const lowered = lowerProject(checked.value).get("main");
  assert(lowered?.ok, JSON.stringify(lowered));
  const row = lowered.value.imports.flatMap((imported) => imported.types).find(
    (declaration) => declaration.name === "Row",
  );
  assert(
    row?.kind === "type" && row.definition.kind === "nominal" &&
      row.definition.base.kind === "record",
  );
  const integer: Type = { kind: "primitive", name: "int" };
  const schema: Type = {
    kind: "schema",
    decoded: integer,
    encoded: integer,
    decodeRequirements: [],
    encodeRequirements: [],
  };
  Object.assign(row.definition.base.fields[0], { type: schema });

  const text = emittedText(lowered.value, {
    config: checked.value.analysis.project.config,
  });
  assertStringIncludes(
    text,
    'const RowsLive$get = $hostCheck(Row, "Rows.get");',
  );
  assertEquals(text.includes("function $fields"), false);
});
