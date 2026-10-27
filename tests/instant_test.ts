// The `Instant` type and `now()` (unit SL1): checking through checkProject,
// emission text, and forged IR through validateModule. Runtime behavior is in
// instant_slow_test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import {
  DURATION_ID,
  type Expr,
  INSTANT_ID,
  type ModuleIR,
} from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { emitFiles } from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Flag = boolean
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

function body(expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (i: Instant, j: Instant, d: Duration, n: Int, x: Num): ${result} => ${expression}\n`,
  );
}

const MISMATCH = (operator: string, left: string, right: string) =>
  `type-mismatch/007 the operator \`${operator}\` does not accept operands of type ${left} and ${right}`;

// ------------------------------------------------------------------ type rule

Deno.test("Instant is closed: no unnamed value fits it, and it widens to int", () => {
  assertEquals(body("5", "Instant"), [
    "type-mismatch/003 the function body has type int, but Instant is expected",
  ]);
  assertEquals(body("n", "Instant"), [
    "type-mismatch/003 the function body has type Int, but Instant is expected",
  ]);
  assertEquals(body("d", "Instant"), [
    "type-mismatch/003 the function body has type Duration, but Instant is expected",
  ]);
  assertEquals(body("i", "Instant"), []);
  // `scheduleRecurs` takes an `int`, which an Instant fits.
  assertEquals(body("scheduleRecurs(i)", "Schedule<Int>"), []);
});

Deno.test("a user declaration named Instant is declaration/002", () => {
  assertEquals(diagnosticsOf("export type Instant = int\n"), [
    "declaration/002 `Instant` is a reserved prelude or builtin name and cannot be declared",
  ]);
});

// ----------------------------------------------------------------- arithmetic

Deno.test("Instant arithmetic: the accepted forms", () => {
  assertEquals(body("i - j", "Duration"), []);
  assertEquals(body("i + d", "Instant"), []);
  assertEquals(body("d + i", "Instant"), []);
  assertEquals(body("i - d", "Instant"), []);
  assertEquals(body("i + 5s", "Instant"), []);
  assertEquals(body("(i - j) / 2", "Duration"), []);
});

Deno.test("Instant arithmetic: the result of Instant - Instant is a Duration, not an Instant", () => {
  assertEquals(body("i - j", "Instant"), [
    "type-mismatch/003 the function body has type Duration, but Instant is expected",
  ]);
});

Deno.test("Instant arithmetic: each rejected mix is type-mismatch/007", () => {
  const cases: [string, string, string, string][] = [
    ["i + j", "+", "Instant", "Instant"],
    ["d - i", "-", "Duration", "Instant"],
    ["i + 1", "+", "Instant", "int"],
    ["1 + i", "+", "int", "Instant"],
    ["i + n", "+", "Instant", "Int"],
    ["i + x", "+", "Instant", "Num"],
    ["i - 1", "-", "Instant", "int"],
    ["1 - i", "-", "int", "Instant"],
    ["i * 2", "*", "Instant", "int"],
    ["2 * i", "*", "int", "Instant"],
    ["i / 2", "/", "Instant", "int"],
    ["i * d", "*", "Instant", "Duration"],
    ["i * i", "*", "Instant", "Instant"],
    ["i / i", "/", "Instant", "Instant"],
    ["d / i", "/", "Duration", "Instant"],
    ["i / d", "/", "Instant", "Duration"],
  ];
  for (const [expression, operator, left, right] of cases) {
    assertEquals(
      body(expression, "Instant"),
      [MISMATCH(operator, left, right)],
      expression,
    );
  }
});

// ---------------------------------------------------------------- comparisons

Deno.test("a closed unit type compares only with its own type", () => {
  for (const operator of ["<", "<=", ">", ">=", "===", "!=="]) {
    assertEquals(body(`i ${operator} j`, "Flag"), [], `i ${operator} j`);
    assertEquals(body(`d ${operator} 5s`, "Flag"), [], `d ${operator} 5s`);
    assertEquals(
      body(`d ${operator} 5`, "Flag"),
      [MISMATCH(operator, "Duration", "int")],
      `d ${operator} 5`,
    );
    assertEquals(
      body(`n ${operator} d`, "Flag"),
      [MISMATCH(operator, "Int", "Duration")],
      `n ${operator} d`,
    );
    assertEquals(
      body(`i ${operator} 5`, "Flag"),
      [MISMATCH(operator, "Instant", "int")],
      `i ${operator} 5`,
    );
    assertEquals(
      body(`x ${operator} i`, "Flag"),
      [MISMATCH(operator, "Num", "Instant")],
      `x ${operator} i`,
    );
    assertEquals(
      body(`i ${operator} d`, "Flag"),
      [MISMATCH(operator, "Instant", "Duration")],
      `i ${operator} d`,
    );
    assertEquals(
      body(`d ${operator} i`, "Flag"),
      [MISMATCH(operator, "Duration", "Instant")],
      `d ${operator} i`,
    );
  }
});

// ------------------------------------------------------------------------ now

Deno.test("now takes no argument, returns an Instant, and is an effect", () => {
  assertEquals(diagnosticsOf("export const a = (): Instant => now()\n"), []);
  assertEquals(
    diagnosticsOf("export const a = (): Instant => now(1)\n"),
    ["type-mismatch/004 `now` takes 0 arguments, but 1 is given"],
  );
  assertEquals(
    diagnosticsOf(`${TYPES}export const a = (): Int => now()\n`),
    ["type-mismatch/003 the function body has type Instant, but Int is expected"],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Duration => now() - now()\n`,
    ),
    [],
  );
});

Deno.test("now is shadowable, so a local may reuse the name", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (now: Instant, d: Duration): Instant => now + d\n`,
    ),
    [],
  );
});

Deno.test("ScheduleInput start and now are Instants", () => {
  const source = (value: string) =>
    `${TYPES}export const s: Schedule<Int> = scheduleFromStep(
  (): Int => 0,
  (state: Int, meta: ScheduleInput<unknown>): ScheduleDecision<Int, Int> =>
    ({ kind: "Continue", state: state + 1, output: state, delay: ${value} })
)\n`;
  assertEquals(diagnosticsOf(source("meta.now - meta.start")), []);
  assertEquals(diagnosticsOf(source("meta.now - meta.now")), []);
  assertEquals(diagnosticsOf(source("meta.now")), [
    "type-mismatch/003 the field `delay` has type Instant, but Duration is expected",
  ]);
  const reader = `${TYPES}export const s: Schedule<Instant> = scheduleFromStep(
  (): Int => 0,
  (state: Int, meta: ScheduleInput<unknown>): ScheduleDecision<Int, Instant> =>
    ({ kind: "Continue", state: state + 1, output: meta.now, delay: 1s })
)\n`;
  assertEquals(diagnosticsOf(reader), []);
});

// ------------------------------------------------------------------- emission

Deno.test("now emits Clock.currentTimeMillis and Instant emits as number", () => {
  const text = emitFiles(
    {
      "effektive.json": "{}",
      "m.eff": `export const stamp = (): Instant => now()
export const since = (start: Instant): Duration => now() - start
`,
    },
    ["m.eff"],
  ).get("m")?.text;
  assert(text !== undefined);
  assertStringIncludes(text, 'import { Clock, Effect } from "effect";');
  assertStringIncludes(text, "Clock.currentTimeMillis");
  assertStringIncludes(text, "(start: number)");
  assert(!text.includes("Instant.make"), text);
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

function validate(
  ir: ModuleIR,
  source: string,
): readonly { code: string; path: string; message: string }[] {
  return validateModule(ir, new Map([["m.eff", source]])).map((d) => {
    const colon = d.message.indexOf(": ");
    return {
      code: d.code,
      path: d.message.slice(0, colon),
      message: d.message.slice(colon + 2),
    };
  });
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

const SOURCE = `${TYPES}export const stamp = (): Instant => now()
export const gap = (a: Instant, b: Instant): Duration => a - b
export const later = (a: Instant, d: Duration): Instant => a + d
export const before = (a: Instant, b: Instant): Flag => a < b
export const lag = (a: Duration, b: Duration): Flag => a < b
export const five = (): Int => 5
`;

function pathOf(ir: ModuleIR, name: string): string {
  return `declarations[${ir.declarations.findIndex((d) => d.name === name)}]`;
}

function binaryOf(ir: ModuleIR, name: string) {
  const d = ir.declarations.find((x) => x.name === name);
  assert(d?.kind === "function", name);
  const found = all({ ...ir, declarations: [d] }, "binary")[0];
  assert(found !== undefined, name);
  return found;
}

const INT_LITERAL = (ir: ModuleIR): Expr => {
  const literal = all(ir, "literal")[0];
  assert(literal !== undefined);
  return structuredClone(literal);
};

Deno.test("the lowered now is a leaf of type Instant with an effect mode", () => {
  const ir = lowered(SOURCE);
  const [now] = all(ir, "now");
  assertEquals(now.type, { kind: "named", id: INSTANT_ID });
  assertEquals(now.execution, "effect");
  assertEquals(now.effects, { failures: [], requirements: [] });
});

Deno.test("the validator rejects a now with a wrong result type", () => {
  for (
    const wrong of [
      { kind: "primitive", name: "int" },
      { kind: "named", id: DURATION_ID },
    ]
  ) {
    const ir = lowered(SOURCE);
    (all(ir, "now")[0] as { type: unknown }).type = wrong;
    const found = validate(ir, SOURCE);
    assertEquals(found.length, 1, JSON.stringify(wrong));
    assertEquals(found[0].code, "validation/002");
    assertEquals(found[0].path, `${pathOf(ir, "stamp")}.body.type`);
  }
});

Deno.test("the validator rejects a now with a pure mode", () => {
  const ir = lowered(SOURCE);
  (all(ir, "now")[0] as { execution: unknown }).execution = "pure";
  assert(validate(ir, SOURCE).length > 0);
});

Deno.test("the validator rejects Instant plus int and Instant plus Instant", () => {
  const ir = lowered(SOURCE);
  (binaryOf(ir, "later") as { right: Expr }).right = INT_LITERAL(ir);
  assertEquals(validate(ir, SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "later")}.body`,
    message: "the operator + does not accept operands of type Instant and int",
  }]);
  const second = lowered(SOURCE);
  const sum = binaryOf(second, "later") as { right: Expr; left: Expr };
  sum.right = structuredClone(sum.left);
  assertEquals(validate(second, SOURCE), [{
    code: "validation/002",
    path: `${pathOf(second, "later")}.body`,
    message:
      "the operator + does not accept operands of type Instant and Instant",
  }]);
});

Deno.test("the validator recomputes the type of Instant - Instant as a Duration", () => {
  const ir = lowered(SOURCE);
  (binaryOf(ir, "gap") as { type: unknown }).type = {
    kind: "named",
    id: INSTANT_ID,
  };
  assertEquals(validate(ir, SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "gap")}.body.type`,
    message: "expected Duration, recorded Instant",
  }]);
});

Deno.test("the validator rejects a forged comparison of an Instant with an int", () => {
  const ir = lowered(SOURCE);
  (binaryOf(ir, "before") as { right: Expr }).right = INT_LITERAL(ir);
  assertEquals(validate(ir, SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "before")}.body`,
    message: "the operator < does not accept operands of type Instant and int",
  }]);
});

Deno.test("the validator rejects a forged comparison of a Duration with an int", () => {
  const ir = lowered(SOURCE);
  (binaryOf(ir, "lag") as { right: Expr }).right = INT_LITERAL(ir);
  assertEquals(validate(ir, SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "lag")}.body`,
    message: "the operator < does not accept operands of type Duration and int",
  }]);
});

Deno.test("the validator rejects a forged equality of an Instant with a Duration", () => {
  const ir = lowered(
    `${TYPES}export const same = (a: Instant, b: Instant): Flag => a === b
export const d = (x: Duration): Duration => x
`,
  );
  const duration = all(ir, "reference").find((r) =>
    JSON.stringify(r.type) ===
      JSON.stringify({ kind: "named", id: DURATION_ID })
  );
  assert(duration !== undefined);
  (binaryOf(ir, "same") as { right: Expr }).right = structuredClone(duration);
  const found = validate(ir, "");
  assert(
    found.some((d) =>
      d.message ===
        "the operator === does not accept operands of type Instant and Duration"
    ),
    JSON.stringify(found),
  );
});
