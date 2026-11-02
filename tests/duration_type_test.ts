// The `Duration` type (unit ES1b): a closed untagged identity over `int` whose
// values are numbers of milliseconds. Checking runs through checkProject, and
// forged IR runs through validateModule. Runtime behavior is in
// duration_type_slow_test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DURATION_ID, type Expr, type ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import {
  allExprs,
  diagnosticsOf,
  emitFiles,
  loweredModule,
} from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Flag = boolean
`;

function body(expression: string, result = "Duration"): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (n: Int, d: Duration, x: Num): ${result} => ${expression}\n`,
  );
}

// ------------------------------------------------------------------ type rule

Deno.test("a bare int never fits Duration, but a Duration widens to int", () => {
  assertEquals(body("5"), [
    "type-mismatch/003 the function body has type int, but Duration is expected",
  ]);
  assertEquals(body("n"), [
    "type-mismatch/003 the function body has type Int, but Duration is expected",
  ]);
  assertEquals(body("5s"), []);
});

Deno.test("timeout and sleep reject an int", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => timeout(() => 1, 5)\n`,
    ),
    ["type-mismatch/003 the timeout duration has type int, but Duration is expected"],
  );
});

Deno.test("a module cannot declare a type named Duration", () => {
  assertEquals(diagnosticsOf("type Duration = int\n"), [
    "declaration/002 `Duration` is a reserved prelude or builtin name and cannot be declared",
  ]);
});

// ------------------------------------------------------------------ operators

Deno.test("Duration plus and minus need two Durations", () => {
  assertEquals(body("1s + 500ms"), []);
  assertEquals(body("d - 500ms"), []);
  assertEquals(
    body("5s + 3"),
    [
      "type-mismatch/007 the operator `+` does not accept operands of type Duration and int",
    ],
  );
  assertEquals(
    body("5s + 2.5", "Num"),
    [
      "type-mismatch/007 the operator `+` does not accept operands of type Duration and number",
    ],
  );
  assertEquals(
    body("d - n"),
    [
      "type-mismatch/007 the operator `-` does not accept operands of type Duration and Int",
    ],
  );
  assertEquals(
    body("3 + d"),
    [
      "type-mismatch/007 the operator `+` does not accept operands of type int and Duration",
    ],
  );
});

Deno.test("Duration times an int is a Duration in either order", () => {
  assertEquals(body("n * 1s"), []);
  assertEquals(body("1s * n"), []);
  assertEquals(body("d * 2"), []);
  assertEquals(body("2 * d"), []);
});

Deno.test("Duration divided by an int is a Duration, and by a Duration is a number", () => {
  assertEquals(body("10s / 3"), []);
  assertEquals(body("d / n"), []);
  assertEquals(body("10s / 5s", "Num"), []);
  assertEquals(body("10s / 5s"), [
    "type-mismatch/003 the function body has type number, but Duration is expected",
  ]);
  // An int divided by a Duration widens: a number.
  assertEquals(body("10 / 5s", "Num"), []);
});

Deno.test("a Duration times a number does not fit Duration", () => {
  assertEquals(body("5s * 2.5", "Num"), []);
  assertEquals(body("5s * 2.5"), [
    "type-mismatch/003 the function body has type number, but Duration is expected",
  ]);
});

Deno.test("comparisons of two Durations are boolean", () => {
  assertEquals(body("d < 3s", "Flag"), []);
  assertEquals(body("d >= d", "Flag"), []);
  assertEquals(body("d === 5s", "Flag"), []);
});

// ------------------------------------------------------------------ builtins

Deno.test("retrySchedule callbacks return Option<Duration>", () => {
  const source = (result: string, value: string) =>
    `${TYPES}error Stop = {}
const p: RetrySchedule<Stop> = retrySchedule((e: Stop, attempt: Int): ${result} => Some(${value}))\n`;
  assertEquals(diagnosticsOf(source("Option<Duration>", "attempt * 5ms")), []);
  assertEquals(diagnosticsOf(source("Option<Duration>", "attempt")), [
    "type-mismatch/003 the value of Some has type Int, but Duration is expected",
  ]);
  assertEquals(diagnosticsOf(source("Option<Int>", "attempt")), [
    "type-mismatch/003 the retry delay has type Option<Int>, but Option<Duration> is expected",
  ]);
});

// ------------------------------------------------------------------ patterns

Deno.test("a duration literal pattern on a Duration subject emits the number of milliseconds", () => {
  const source = `${TYPES}export const f = (d: Duration): Int =>
  match (d) { 5s => 1, _ => 2 }\n`;
  assertEquals(diagnosticsOf(source), []);
  const text = emitFiles({ "effektive.json": "{}", "m.eff": source }, ["m.eff"])
    .get("m")?.text;
  assert(text !== undefined);
  assertStringIncludes(text, "=== 5000");
});

Deno.test("a duration literal pattern needs a Duration subject", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (n: Int): Int =>\n  match (n) { 5s => 1, _ => 2 }\n`,
    ),
    ["pattern/003 5s does not belong to the subject (a int)"],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}type Text = string\nexport const f = (t: Text): Int =>\n  match (t) { 5s => 1, _ => 2 }\n`,
    ),
    ["pattern/003 5s does not belong to the subject (a string)"],
  );
});

Deno.test("a plain number pattern does not fit a Duration subject", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (d: Duration): Int =>\n  match (d) { 5000 => 1, _ => 2 }\n`,
    ),
    ["pattern/003 5000 does not belong to the subject (a Duration)"],
  );
});

Deno.test("two duration patterns of the same value make the second unreachable", () => {
  const codes = diagnosticsOf(
    `${TYPES}export const f = (d: Duration): Int =>\n  match (d) { 5s => 1, 5000ms => 2, _ => 3 }\n`,
  ).map((d) => d.split(" ")[0]);
  assertEquals(codes, ["pattern/002"]);
});

Deno.test("a duration pattern works inside an Option<Duration> match", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (o: Option<Duration>): Int =>
  match (o) { Some(d) => match (d) { 5s => 1, _ => 2 }, None => 0 }\n`,
    ),
    [],
  );
});

// ------------------------------------------------------------------ emission

function emitted(source: string): string {
  const text = emitFiles({ "effektive.json": "{}", "m.eff": source }, [
    "m.eff",
  ]).get("m")?.text;
  assert(text !== undefined);
  return text;
}

Deno.test("Duration emits as number, erases its literal, and keeps the int guard", () => {
  const text = emitted(
    `${TYPES}export const f = (n: Int, d: Duration): Duration =>
  n * 1s + d / 3
`,
  );
  assertStringIncludes(text, "(n: Int, d: number): number");
  assertStringIncludes(text, "$int(n * 1000)");
  assertStringIncludes(text, "$int(Math.trunc(d / 3))");
  assert(!text.includes("Duration.make"), text);
});

Deno.test("a ratio of two Durations is a plain division", () => {
  const text = emitted(`${TYPES}export const f = (a: Duration): Num => a / 5s
`);
  assertStringIncludes(text, "a / 5000");
  assert(!text.includes("Math.trunc"), text);
});

Deno.test("Duration uses the int schema at a schema position", () => {
  const text = emitted(`${TYPES}export type Policy = { wait: Duration }
const policySchema: Schema<Policy> = schema()
export const decoded = (input: unknown): Policy fails SchemaError =>
  schemaDecode(policySchema, input)
`);
  assertStringIncludes(text, "wait: $Int");
});

// ------------------------------------------------------------------ validator

function validate(
  ir: ModuleIR,
  source: string,
): readonly { code: string; path: string; message: string }[] {
  // A validation message has the form "<path>: <message>".
  return validateModule(ir, new Map([["m.eff", source]])).map((d) => {
    const colon = d.message.indexOf(": ");
    return {
      code: d.code,
      path: d.message.slice(0, colon),
      message: d.message.slice(colon + 2),
    };
  });
}

const NOMINAL_SOURCE = `${TYPES}export const lit = (): Duration => 5s
export const nap = (): void => sleep(5s)
export const sum = (a: Duration, b: Duration): Duration => a + b
export const diff = (a: Duration, b: Duration): Duration => a - b
export const scaled = (a: Duration, n: Int): Duration => a * n
export const halved = (a: Duration, n: Int): Duration => a / n
export const ratio = (a: Duration, b: Duration): Num => a / b
export const before = (a: Duration, b: Duration): Flag => a < b
`;

function declarationOf(ir: ModuleIR, name: string) {
  const found = ir.declarations.find((d) => d.name === name);
  assert(found?.kind === "function", name);
  return found;
}

function binaryOf(ir: ModuleIR, name: string) {
  const d = declarationOf(ir, name);
  const found = allExprs({ ...ir, declarations: [d] }, "binary")[0];
  assert(found !== undefined, name);
  return found;
}

function durationLiterals(ir: ModuleIR) {
  return allExprs(ir, "nominal").filter((e) => e.nominal === DURATION_ID);
}

function pathOf(ir: ModuleIR, name: string): string {
  return `declarations[${ir.declarations.findIndex((d) => d.name === name)}]`;
}

const INT_LITERAL = (ir: ModuleIR): Expr => {
  const literal = allExprs(ir, "literal")[0];
  assert(literal !== undefined);
  return structuredClone(literal);
};

Deno.test("a duration literal lowers to a nominal Duration over an int literal", () => {
  const ir = loweredModule(NOMINAL_SOURCE);
  const [first] = durationLiterals(ir);
  assertEquals(first.nominal, DURATION_ID);
  assert(first.value.kind === "literal");
  assertEquals(first.value.value, 5000);
  assertEquals(first.value.type, { kind: "primitive", name: "int" });
  assertEquals(first.type, { kind: "named", id: DURATION_ID });
});

Deno.test("the validator rejects a forged duration literal whose value is not an int", () => {
  const ir = loweredModule(NOMINAL_SOURCE);
  const [first] = durationLiterals(ir);
  (first.value as { value: unknown }).value = "x";
  const at = `${pathOf(ir, "lit")}.body.value`;
  assertEquals(validate(ir, NOMINAL_SOURCE), [
    {
      code: "validation/002",
      path: `${at}.type`,
      message: 'the recomputed type "x" does not fit the recorded type int',
    },
    {
      code: "validation/002",
      path: at,
      message: 'the value has type "x", which does not fit the base int',
    },
  ]);
});

Deno.test("the validator rejects an unnamed int where a Duration is needed", () => {
  const ir = loweredModule(NOMINAL_SOURCE);
  const sleep = allExprs(ir, "sleep")[0];
  (sleep as { durationMs: Expr }).durationMs = INT_LITERAL(ir);
  assertEquals(validate(ir, NOMINAL_SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "nap")}.body.durationMs`,
    message: "sleep needs a Duration, found int",
  }]);
});

Deno.test("the validator rejects an unnamed int as the body of a Duration function", () => {
  const ir = loweredModule(NOMINAL_SOURCE);
  const lit = declarationOf(ir, "lit");
  (lit as { body: Expr }).body = INT_LITERAL(ir);
  assertEquals(validate(ir, NOMINAL_SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "lit")}.body`,
    message: "the body type int does not fit the declared result Duration",
  }]);
});

Deno.test("the validator rejects Duration plus int and Duration minus int", () => {
  for (const [name, operator] of [["sum", "+"], ["diff", "-"]] as const) {
    const ir = loweredModule(NOMINAL_SOURCE);
    (binaryOf(ir, name) as { right: Expr }).right = INT_LITERAL(ir);
    assertEquals(validate(ir, NOMINAL_SOURCE), [{
      code: "validation/002",
      path: `${pathOf(ir, name)}.body`,
      message:
        `the operator ${operator} does not accept operands of type Duration and int`,
    }], name);
  }
});

const RECORDED: readonly [
  name: string,
  recorded: "int" | "number" | "Duration" | "boolean",
  message: string,
][] = [
  ["scaled", "int", "expected Duration, recorded int"],
  ["halved", "number", "expected Duration, recorded number"],
  ["ratio", "Duration", "expected number, recorded Duration"],
  ["before", "int", "expected boolean, recorded int"],
];

for (const [name, recorded, message] of RECORDED) {
  Deno.test(`the validator recomputes the Duration rule of ${name}`, () => {
    const ir = loweredModule(NOMINAL_SOURCE);
    (binaryOf(ir, name) as { type: unknown }).type = recorded === "Duration"
      ? { kind: "named", id: DURATION_ID }
      : { kind: "primitive", name: recorded };
    assertEquals(validate(ir, NOMINAL_SOURCE), [{
      code: "validation/002",
      path: `${pathOf(ir, name)}.body.type`,
      message,
    }]);
  });
}

const PATTERN_SOURCE = `${TYPES}export const dur = (d: Duration): Int =>
  match (d) { 5s => 1, _ => 2 }
export const num = (n: Int): Int =>
  match (n) { 5000 => 1, _ => 2 }
`;

function firstPattern(ir: ModuleIR, name: string) {
  const found =
    allExprs({ ...ir, declarations: [declarationOf(ir, name)] }, "match")[0];
  assert(found !== undefined, name);
  return found.arms[0];
}

Deno.test("the validator rejects a forged duration pattern on an int subject", () => {
  const ir = loweredModule(PATTERN_SOURCE);
  const arm = firstPattern(ir, "num");
  (arm as { pattern: unknown }).pattern = {
    kind: "duration",
    millis: 5000,
    span: arm.pattern.span,
  };
  assertEquals(validate(ir, PATTERN_SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "num")}.body.arms[0].pattern`,
    message:
      "the duration 5000ms does not belong to the subject of type type:m#Int",
  }]);
});

Deno.test("the validator rejects a forged literal pattern on a Duration subject", () => {
  const ir = loweredModule(PATTERN_SOURCE);
  const arm = firstPattern(ir, "dur");
  (arm as { pattern: unknown }).pattern = {
    kind: "literal",
    value: 5000,
    span: arm.pattern.span,
  };
  assertEquals(validate(ir, PATTERN_SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "dur")}.body.arms[0].pattern`,
    message: "the literal 5000 does not belong to the subject of type Duration",
  }]);
});

Deno.test("the validator rejects a forged duration pattern with a fractional value", () => {
  const ir = loweredModule(PATTERN_SOURCE);
  const arm = firstPattern(ir, "dur");
  (arm.pattern as { millis: number }).millis = 1.5;
  assertEquals(validate(ir, PATTERN_SOURCE), [{
    code: "validation/002",
    path: `${pathOf(ir, "dur")}.body.arms[0].pattern.millis`,
    message:
      "a duration pattern needs a safe integer of milliseconds, found 1.5",
  }]);
});
