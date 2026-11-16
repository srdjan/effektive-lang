import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import type { ModuleIR } from "../src/core/ir.ts";
import { type EmitContext, emitModule } from "../src/core/typescript.ts";
import { loweredModule } from "./helpers.ts";

const NO_CONFIG: EmitContext = { config: { host: new Map() } };

function emittedText(ir: ModuleIR, context: EmitContext = NO_CONFIG): string {
  const result = emitModule(ir, context);
  assert(result.ok, JSON.stringify(result));
  return result.value.text;
}

Deno.test("the emitter ignores a forged nonboolean opaque flag", () => {
  const ir = loweredModule("export type Count = int\n");
  const count = ir.declarations.find((declaration) =>
    declaration.name === "Count"
  );
  assert(count?.kind === "type");
  assert(Reflect.set(count, "opaque", "forged"));

  assertEquals(
    emittedText(ir),
    `// Generated from m.eff by the Effektive compiler. Do not edit.

import { Schema } from "effect";

const $Int = Schema.Finite.check(
  Schema.makeFilter(
    (value) => Number.isSafeInteger(value) || "expected a safe integer",
  ),
);

export const Count = $Int;
export type Count = typeof Count.Type;
//# sourceMappingURL=m.ts.map
`,
  );
});

Deno.test("the emitter ignores forged nonboolean Schema flags", () => {
  const ir = loweredModule(
    "type Int = int\nexport const value: Schema<Int> = schema()\n",
  );
  const value = ir.declarations.find((declaration) =>
    declaration.name === "value"
  );
  assert(value?.kind === "constant" && value.type.kind === "schema");
  assert(Reflect.set(value.type, "constructorDefault", "forged"));
  assert(Reflect.set(value.type, "optionalKey", "forged"));
  assert(Reflect.set(value.type, "encodedOptionalKey", "forged"));
  assert(Reflect.set(value.type, "decodedOptionalKey", "forged"));

  assertEquals(
    emittedText(ir),
    `// Generated from m.eff by the Effektive compiler. Do not edit.

import { Schema } from "effect";

const $Int = Schema.Finite.check(
  Schema.makeFilter(
    (value) => Number.isSafeInteger(value) || "expected a safe integer",
  ),
);

export const Int = $Int;
export type Int = typeof Int.Type;

export const value: Schema.Codec<Int, Int, never, never> = Schema.toType(Int);
//# sourceMappingURL=m.ts.map
`,
  );
});

Deno.test("host emission ignores a forged nonboolean opaque flag", () => {
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
  assert(row !== undefined);
  assert(Reflect.set(row, "opaque", "forged"));

  assertEquals(
    emittedText(lowered.value, {
      config: checked.value.analysis.project.config,
    }),
    `// Generated from main.eff by the Effektive compiler. Do not edit.

import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { Row, Rows } from "./host.effi.ts";
import { RowsLive } from "./adapter.ts";

const $hostCheck = <T>(
  schema: Schema.Top & { readonly Type: T },
  label: string,
  adapt: (value: unknown) => unknown = (value) => value,
) => {
  const is = Schema.is(schema);
  const decode = Schema.decodeUnknownExit(Schema.toType(schema));
  return (value: T): T => {
    const fields = adapt(value);
    if (is(fields)) return value;
    const exit = decode(fields);
    const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    const issue = failure instanceof Error
      ? failure.message.replace(/\\s*\\n\\s*/g, " ")
      : "unknown issue";
    throw new TypeError(
      \`host value of \${label} does not match its type: \${issue}\`,
    );
  };
};

const RowsLive$get = $hostCheck(Row, "Rows.get");
const RowsLive$host: Layer.Layer<Rows> = Layer.effect(Rows)(
  Effect.gen(function* () {
    const $s = yield* Rows;
    return {
      get: () => Effect.map($s.get(), RowsLive$get),
    };
  }),
).pipe(Layer.provide(RowsLive));

export const load = (): Effect.Effect<Row> =>
  Effect.provide(
    Effect.suspend(() => Rows.use(($s) => $s.get())),
    RowsLive$host,
  );
//# sourceMappingURL=main.ts.map
`,
  );
});
