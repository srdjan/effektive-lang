// `log` (unit SL3): checking through checkProject, lowering, emission text, and
// forged IR through validateModule. Runtime behavior is in log_builtin_slow_test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { diagnosticsOf, emitFiles } from "./helpers.ts";

const TYPES = `type Text = string
type Id = int
`;

const call = (args: string, params = "id: Id, msg: Text"): string =>
  `${TYPES}export const f = (${params}): void => log(${args})\n`;

const SOURCE = `${TYPES}export const plain = (msg: Text): void => log(msg)
export const full = (msg: Text, id: Id): void =>
  log(msg, { level: "warn", fields: { orderId: id } })
`;

// ------------------------------------------------------------------- checking

Deno.test("log checks with a string message, a string identity and options", () => {
  assertEquals(diagnosticsOf(SOURCE), []);
  assertEquals(diagnosticsOf(call(`"hello"`)), []);
  assertEquals(diagnosticsOf(call(`msg, { level: "fatal" }`)), []);
  assertEquals(diagnosticsOf(call(`msg, { fields: { a: id, b: [id] } }`)), []);
});

Deno.test("log takes one or two arguments and no pipeline form", () => {
  assertEquals(diagnosticsOf(call("")).length, 1);
  assertEquals(diagnosticsOf(call(`msg, { level: "info" }, id`)).length, 1);
  const piped = diagnosticsOf(
    `${TYPES}export const f = (msg: Text): void => msg |> log()\n`,
  );
  assert(piped.length > 0, "a pipeline left side is rejected");
});

Deno.test("log needs a string message", () => {
  const found = diagnosticsOf(call("id"));
  assertEquals(found.length, 1, found.join("\n"));
  assertStringIncludes(found[0], "type-mismatch/");
  assertStringIncludes(found[0], "the log message");
});

Deno.test("each rejected option is type-mismatch/010", () => {
  const cases: [string, string][] = [
    [`msg, { colour: "red" }`, "has no option `colour`"],
    [`msg, { level: "info", level: "warn" }`, "appears twice"],
    [`msg, { fields: {}, fields: {} }`, "appears twice"],
    [`msg, { level: "loud" }`, "one of the string literals"],
    [`msg, { level: msg }`, "one of the string literals"],
    [`msg, { level: 3 }`, "one of the string literals"],
    [`msg, {}`, "at least one of `level` or `fields`"],
    [`msg, msg`, "needs an options record"],
    [`msg, { fields: id }`, "a record literal"],
    [`msg, { fields: { f: (x: Id): Id => x } }`, "must be data"],
  ];
  for (const [args, text] of cases) {
    const found = diagnosticsOf(call(args));
    assertEquals(found.length, 1, `${args}: ${found.join("\n")}`);
    assert(found[0].startsWith("type-mismatch/010 "), `${args}: ${found[0]}`);
    assertStringIncludes(found[0], text);
  }
});

Deno.test("log is shadowable", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}export const a = (log: Id): Id => log + 1\n`),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}const log = (m: Text): Text => m\nexport const a = (m: Text): Text => log(m)\n`,
    ),
    [],
  );
});

Deno.test("the examples that export a value named log keep checking", () => {
  for (
    const path of ["fixtures/examples/log.eff", "fixtures/ir/example/log.eff"]
  ) {
    const source = Deno.readTextFileSync(path);
    assertEquals(diagnosticsOf(source), [], path);
  }
});

// ------------------------------------------------------------------- lowering

function lowered(source: string): ModuleIR {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok, JSON.stringify(module));
  assertEquals(validateModule(module.value, new Map([["m.eff", source]])), []);
  return structuredClone(module.value);
}

function validate(ir: ModuleIR, source = SOURCE) {
  return validateModule(ir, new Map([["m.eff", source]]));
}

function all<K extends Expr["kind"]>(
  ir: ModuleIR,
  kind: K,
): Extract<Expr, { kind: K }>[] {
  const found: Extract<Expr, { kind: K }>[] = [];
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    if ((value as { kind?: unknown }).kind === kind) {
      found.push(value as Extract<Expr, { kind: K }>);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
  return found;
}

Deno.test("the lowered log defaults to the info level and has no fields", () => {
  const [plain, full] = all(lowered(SOURCE), "log");
  assertEquals(plain.level, "info");
  assertEquals(plain.fields, null);
  assertEquals(plain.type, { kind: "primitive", name: "unit" });
  assertEquals(plain.execution, "effect");
  assertEquals(plain.effects, { failures: [], requirements: [] });
  assertEquals(full.level, "warn");
  assertEquals(full.fields?.kind, "record");
});

Deno.test("a level-only options record lowers with no fields", () => {
  const [node] = all(lowered(call(`msg, { level: "debug" }`)), "log");
  assertEquals(node.level, "debug");
  assertEquals(node.fields, null);
});

// ------------------------------------------------------------------- emission

Deno.test("log emits Effect.logWithLevel and Effect.annotateLogs", () => {
  const text = emitFiles({ "effektive.json": "{}", "m.eff": SOURCE }, ["m.eff"])
    .get("m")?.text;
  assert(text !== undefined);
  assertStringIncludes(text, 'Effect.logWithLevel("Info")(msg)');
  assertStringIncludes(
    text,
    'Effect.annotateLogs(Effect.logWithLevel("Warn")(msg), { orderId: id })',
  );
});

// ------------------------------------------------------------------ validator

Deno.test("the validator rejects a forged log level", () => {
  const ir = lowered(SOURCE);
  (all(ir, "log")[0] as { level: string }).level = "loud";
  const found = validate(ir);
  assert(found.some((d) => d.message.includes("log needs a level")));
});

Deno.test("the validator rejects a forged non-string message", () => {
  const ir = lowered(SOURCE);
  const id = all(ir, "reference").find((r) =>
    JSON.stringify(r.type).includes("Id")
  );
  assert(id !== undefined);
  (all(ir, "log")[0] as { message: Expr }).message = structuredClone(id);
  const found = validate(ir);
  assert(found.some((d) => d.message.includes("log needs a string message")));
});

Deno.test("the validator rejects a forged non-data field", () => {
  const source = `${TYPES}export const g = (msg: Text): void =>
  log(msg, { fields: { n: 1 } })
export const h = (f: (x: Id) => Id): (x: Id) => Id => f\n`;
  const ir = lowered(source);
  const fn = all(ir, "reference").find((r) => r.type.kind === "function");
  assert(fn !== undefined);
  const [node] = all(ir, "log");
  const record = node.fields;
  assert(record?.kind === "record");
  (record.fields as unknown as { value: Expr }[])[0].value = structuredClone(
    fn,
  );
  (record as { type: unknown }).type = {
    kind: "record",
    fields: [{ name: "n", type: fn.type, optional: false }],
  };
  const found = validate(ir, source);
  assert(
    found.some((d) => d.message.includes("log field n must be data")),
    JSON.stringify(found),
  );
});

Deno.test("the validator rejects a non-record fields child", () => {
  const ir = lowered(SOURCE);
  const [, full] = all(ir, "log");
  (full as { fields: Expr | null }).fields = structuredClone(full.message);
  const found = validate(ir);
  assert(found.some((d) => d.message.includes("log needs a record of fields")));
});

Deno.test("the validator rejects a wrong result type and a pure log", () => {
  const wrong = lowered(SOURCE);
  (all(wrong, "log")[0] as { type: unknown }).type = {
    kind: "primitive",
    name: "int",
  };
  assert(validate(wrong).some((d) => d.code === "validation/002"));
  const pure = lowered(SOURCE);
  (all(pure, "log")[0] as { execution: unknown }).execution = "pure";
  assert(validate(pure).length > 0);
});
