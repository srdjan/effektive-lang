// `random()` and `randomInt` (unit SL2): checking through checkProject,
// emission text, and forged IR through validateModule. Runtime behavior is in
// random_slow_test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { diagnosticsOf, emitFiles } from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
`;

const SOURCE =
  `${TYPES}export const roll = (a: Int, b: Int): Int => randomInt(a, b)
export const unit = (): Num => random()
`;

// ------------------------------------------------------------------- checking

Deno.test("random and randomInt check with their result types", () => {
  assertEquals(diagnosticsOf(SOURCE), []);
  assertEquals(
    diagnosticsOf(`${TYPES}export const f = (): Int => randomInt(0, 6)\n`),
    [],
  );
});

Deno.test("randomInt needs int arguments", () => {
  const found = diagnosticsOf(
    `${TYPES}export const f = (x: Num): Int => randomInt(x, 6)\n`,
  );
  assertEquals(found.length, 1, found.join("\n"));
  assertStringIncludes(found[0], "type-mismatch/");
  assertStringIncludes(found[0], "the randomInt minimum");
  const second = diagnosticsOf(
    `${TYPES}export const f = (x: Num): Int => randomInt(0, x)\n`,
  );
  assertEquals(second.length, 1, second.join("\n"));
  assertStringIncludes(second[0], "the randomInt maximum");
});

Deno.test("random returns a number, not an int", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}export const f = (): Int => random()\n`).length,
    1,
  );
});

Deno.test("an arity mismatch is a diagnostic", () => {
  assert(
    diagnosticsOf(`${TYPES}export const f = (): Int => randomInt(1)\n`)
      .length > 0,
  );
  assert(
    diagnosticsOf(`${TYPES}export const f = (): Num => random(1)\n`)
      .length > 0,
  );
});

Deno.test("random and randomInt are shadowable", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (random: Int, randomInt: Int): Int => random + randomInt\n`,
    ),
    [],
  );
});

// ------------------------------------------------------------------- emission

Deno.test("random emits Random.next and randomInt checks the range", () => {
  const text = emitFiles({ "effektive.json": "{}", "m.eff": SOURCE }, ["m.eff"])
    .get("m")?.text;
  assert(text !== undefined);
  assertStringIncludes(text, "Random.next");
  assertStringIncludes(text, "Random.nextIntBetween(");
  assertStringIncludes(text, "{ halfOpen: true }");
  assertStringIncludes(
    text,
    'new RangeError("randomInt needs max greater than min")',
  );
});

// ------------------------------------------------------------------ validator

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

function validate(ir: ModuleIR) {
  return validateModule(ir, new Map([["m.eff", SOURCE]]));
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

Deno.test("the lowered random and randomInt are effect leaves with the right types", () => {
  const ir = lowered(SOURCE);
  const [random] = all(ir, "random");
  assertEquals(random.type, { kind: "primitive", name: "number" });
  assertEquals(random.execution, "effect");
  assertEquals(random.effects, { failures: [], requirements: [] });
  const [randomInt] = all(ir, "random-int");
  assertEquals(randomInt.type, { kind: "primitive", name: "int" });
  assertEquals(randomInt.execution, "effect");
  assertEquals(randomInt.effects, { failures: [], requirements: [] });
});

Deno.test("the validator rejects a forged non-int randomInt child", () => {
  const source = `${SOURCE}type Str = string
export const g = (x: Str): Str => x\n`;
  for (const side of ["min", "max"] as const) {
    const ir = lowered(source);
    const text = all(ir, "reference").find((r) =>
      JSON.stringify(r.type).includes("Str")
    );
    assert(text !== undefined);
    const [node] = all(ir, "random-int");
    (node as { min: Expr; max: Expr })[side] = structuredClone(text);
    const found = validateModule(ir, new Map([["m.eff", source]]));
    assert(
      found.some((d) => d.message.includes(`randomInt needs an int ${side}`)),
      JSON.stringify(found),
    );
  }
});

Deno.test("the validator rejects wrong result types", () => {
  for (
    const [kind, wrong] of [
      ["random", { kind: "primitive", name: "int" }],
      ["random-int", { kind: "primitive", name: "number" }],
    ] as const
  ) {
    const ir = lowered(SOURCE);
    (all(ir, kind)[0] as { type: unknown }).type = wrong;
    const found = validate(ir);
    assert(found.length > 0, kind);
    assert(found.some((d) => d.code === "validation/002"), kind);
  }
});

Deno.test("the validator rejects a pure random or randomInt", () => {
  for (const kind of ["random", "random-int"] as const) {
    const ir = lowered(SOURCE);
    (all(ir, kind)[0] as { execution: unknown }).execution = "pure";
    assert(validate(ir).length > 0, kind);
  }
});
