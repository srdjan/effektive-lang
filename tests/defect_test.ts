// Defect recovery (unit ES6): the `Defect(name) => expression` arm of `catch`.
// Runtime behavior is in defect_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { Program, sourceHoverAt } from "../src/core/frontend.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

const HEAD = `type Int = int
type Text = string
export error Stop = { n: Int }
export service Log {
  note(n: Int): void
  next(): Int fails Stop
  boom(): Int
  other(): Int fails Stop
}
`;

function diagnosticsOf(source: string): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

Deno.test("a catch block with only a Defect arm is valid", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int uses Log.boom =>
  try { Log.boom() } catch { Defect(d) => 0 }
`),
    [],
  );
});

Deno.test("a Defect arm needs no failure in the protected block, and joins typed arms", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int uses Log.next =>
  try { Log.next() } catch { Stop(e) => e.n, Defect(d) => 0 }
export const b = (): Int => try { 1 } catch { Defect(d) => 2 }
`),
    [],
  );
});

Deno.test("the Defect arm result joins the protected result", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => {
  const x = try { 1 } catch { Defect(d) => "text" }
  0
}
`).map((d) => d.slice(0, 20)),
    ["type-mismatch/009 th"],
  );
});

Deno.test("the Defect arm body failures and requirements join the result", () => {
  const text =
    `${HEAD}export const a = (): Int fails Stop uses Log.boom | Log.other =>
  try { Log.boom() } catch { Defect(d) => Log.other() }
export const b = (): Int uses Log.boom | Log.other =>
  try { Log.boom() } catch { Defect(d) => Log.other() }
`;
  const found = diagnosticsOf(text);
  assertEquals(found.length, 1);
  assert(found[0].includes("Stop"), found[0]);
});

Deno.test("a typed failure is not handled by the Defect arm", () => {
  const found = diagnosticsOf(`${HEAD}export const a = (): Int uses Log.next =>
  try { Log.next() } catch { Defect(d) => 0 }
`);
  assertEquals(found.length, 1);
  assert(found[0].includes("Stop"), found[0]);
});

Deno.test("two Defect arms are a duplicate handler", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int uses Log.boom =>
  try { Log.boom() } catch { Defect(d) => 0, Defect(e) => 1 }
`),
    ["failure-contract/003 the `Defect` arm already has a handler"],
  );
});

Deno.test("Defect is reserved as a declaration name", () => {
  for (
    const declaration of [
      "error Defect = {}",
      "type Defect = int",
      "service Defect { f(): int }",
    ]
  ) {
    const found = diagnosticsOf(`${declaration}\n`);
    assert(found.some((f) => f.includes("Defect")), found.join("\n"));
  }
});

Deno.test("fails Defect is rejected, because Defect is not an error", () => {
  const found = diagnosticsOf(
    `${HEAD}export service Bad { f(): Int fails Defect }
`,
  );
  assertEquals(found.length, 1);
  assert(found[0].includes("Defect"), found[0]);
});

Deno.test("the Defect binding is local to its arm", () => {
  const found = diagnosticsOf(
    `${HEAD}export const a = (): Int uses Log.boom => {
  const x = try { Log.boom() } catch { Defect(d) => 0 }
  d
}
`,
  );
  assertEquals(found.length, 1);
  assert(found[0].includes("`d`"), found[0]);
});

Deno.test("the Defect binding has the type { message: string }", () => {
  const text = `${HEAD}export const a = (): Text uses Log.boom =>
  try { Log.boom(); "x" } catch { Defect(failure) => failure.message }
`;
  const program = new Program().update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(program.ok);
  assertEquals(program.value.diagnostics, []);
  assertEquals(
    sourceHoverAt(program.value, "m.eff", text.indexOf("(failure)") + 1)
      ?.contract,
    "{ message: string }",
  );
});

// ------------------------------------------------------------------ validator

const SOURCE = `${HEAD}export const a = (): Int uses Log.boom =>
  try { Log.boom() } catch { Defect(d) => 0 }
`;

function forged(change: (ir: ModuleIR) => void): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": SOURCE }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok);
  const sources = new Map([["m.eff", SOURCE]]);
  assertEquals(validateModule(module.value, sources), []);
  const ir = structuredClone(module.value);
  change(ir);
  return validateModule(ir, sources).map((d) => `${d.code} ${d.message}`);
}

function theCatch(ir: ModuleIR): Extract<Expr, { kind: "catch" }> {
  let found: Extract<Expr, { kind: "catch" }> | undefined;
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    if ((value as { kind?: unknown }).kind === "catch") {
      found = value as Extract<Expr, { kind: "catch" }>;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
  assert(found !== undefined);
  return found;
}

Deno.test("the validator rejects a defect binding of the wrong type", () => {
  const found = forged((ir) => {
    const defect = theCatch(ir).defect;
    assert(defect !== undefined);
    (defect.binding as { type: unknown }).type = {
      kind: "primitive",
      name: "string",
    };
  });
  assertEquals(found.length, 1);
  assert(found[0].startsWith("validation/002 "), found[0]);
  assert(
    found[0].includes(".defect.binding.type: expected { message: string }"),
  );
});

Deno.test("the validator rejects a defect body that does not fit the result", () => {
  const found = forged((ir) => {
    const defect = theCatch(ir).defect;
    assert(defect !== undefined);
    const body = defect.body as { type: unknown; value: unknown };
    body.type = { kind: "primitive", name: "string" };
    body.value = "x";
  });
  assert(found.length > 0);
  assert(found.every((f) => f.includes(".defect.body")), found.join("\n"));
  assert(found.some((f) => f.startsWith("validation/005 ")), found.join("\n"));
});

Deno.test("the validator recomputes the effects of a defect body", () => {
  const found = forged((ir) => {
    (theCatch(ir) as { effects: unknown }).effects = {
      failures: [],
      requirements: [],
    };
  });
  assertEquals(found.length, 1);
  assert(found[0].startsWith("validation/003 "), found[0]);
});
