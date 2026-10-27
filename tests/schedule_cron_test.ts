// `scheduleCron` (unit EL3): the grammar of src/core/cron.ts against
// `Cron.parse` of effect@4.0.5, the checker diagnostics, lowering, and forged
// IR through validateModule. Runtime behavior is in schedule_cron_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import { cronExpressionProblem, cronZoneProblem } from "../src/core/cron.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { EXPRESSIONS, ZONES } from "./cron_cases.ts";

// -------------------------------------------------------------- grammar

Deno.test("cron.ts gives the literal verdict of each expression and zone", () => {
  for (const { input, valid } of EXPRESSIONS) {
    assertEquals(
      cronExpressionProblem(input) === undefined,
      valid,
      JSON.stringify(input),
    );
  }
  for (const { input, valid } of ZONES) {
    assertEquals(
      cronZoneProblem(input) === undefined,
      valid,
      JSON.stringify(input),
    );
  }
});

Deno.test("cron.ts gives a reason for each invalid input", () => {
  assertEquals(
    cronExpressionProblem("* * * *"),
    "a cron expression has 5 or 6 fields",
  );
  assertEquals(
    cronExpressionProblem("*/0 * * * *"),
    "field minutes: a step must be greater than 0",
  );
  assertEquals(
    cronExpressionProblem("* * * * mon-sun"),
    "field weekdays: a range must not run backward",
  );
  assertEquals(
    cronZoneProblem("GMT"),
    "an offset zone must end with +hh:mm or -hh:mm",
  );
  assertEquals(cronZoneProblem("Not/AZone"), "the time zone is not known");
});

// ----------------------------------------------------------------- checking

function diagnosticsOf(source: string): string[] {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": `type Text = string\n${source}`,
    }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

const SIG = "(): Schedule<Duration> =>";

Deno.test("scheduleCron accepts one or two string literals", () => {
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron("0 4 * * *")\n`),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = ${SIG} scheduleCron("0 4 * * *", "Europe/Belgrade")\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = ${SIG} scheduleCron("0 4 * * *", "+03:00")\n`,
    ),
    [],
  );
});

Deno.test("scheduleCron has no failures and no requirements", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Duration, unknown, never> => scheduleCron("* * * * *")\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Text> => scheduleCron("* * * * *")\n`,
    ).map((d) => d.slice(0, 17)),
    ["type-mismatch/003"],
  );
});

Deno.test("scheduleCron rejects an expression or a zone that is not a literal", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (t: Text): Schedule<Duration> => scheduleCron(t)\n`,
    ),
    ["type-mismatch/010 `scheduleCron` needs a string literal expression"],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (t: Text): Schedule<Duration> => scheduleCron("* * * * *", t)\n`,
    ),
    ["type-mismatch/010 `scheduleCron` needs a string literal time zone"],
  );
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron(5)\n`),
    ["type-mismatch/010 `scheduleCron` needs a string literal expression"],
  );
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron("a" + "b")\n`),
    ["type-mismatch/010 `scheduleCron` needs a string literal expression"],
  );
});

Deno.test("scheduleCron rejects an invalid expression with the reason", () => {
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron("* * * *")\n`),
    [
      "type-mismatch/010 `scheduleCron` got an invalid expression: a cron expression has 5 or 6 fields",
    ],
  );
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron("* * * * mon-sun")\n`),
    [
      "type-mismatch/010 `scheduleCron` got an invalid expression: field weekdays: a range must not run backward",
    ],
  );
});

Deno.test("scheduleCron rejects an invalid zone with the reason", () => {
  assertEquals(
    diagnosticsOf(`export const a = ${SIG} scheduleCron("* * * * *", "GMT")\n`),
    [
      "type-mismatch/010 `scheduleCron` got an invalid time zone: an offset zone must end with +hh:mm or -hh:mm",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = ${SIG} scheduleCron("* * * * *", "Not/AZone")\n`,
    ),
    [
      "type-mismatch/010 `scheduleCron` got an invalid time zone: the time zone is not known",
    ],
  );
});

Deno.test("scheduleCron rejects a wrong argument count", () => {
  for (
    const call of ["scheduleCron()", 'scheduleCron("* * * * *", "UTC", "UTC")']
  ) {
    assertEquals(
      diagnosticsOf(`export const a = ${SIG} ${call}\n`).filter((d) =>
        d.startsWith("type-mismatch/004")
      ),
      [
        "type-mismatch/004 `scheduleCron` takes a cron expression and an optional time zone",
      ],
    );
  }
});

// ----------------------------------------------------------------- lowering

const SOURCE = `export const plain = ${SIG} scheduleCron("0 4 * * *")
export const zoned = ${SIG} scheduleCron("0 4 * * *", "Europe/London")
`;

function lowered(): ModuleIR {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": SOURCE }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok, JSON.stringify(module));
  assertEquals(validateModule(module.value, new Map([["m.eff", SOURCE]])), []);
  return structuredClone(module.value);
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

Deno.test("scheduleCron lowers a missing zone to UTC", () => {
  assertEquals(
    all(lowered(), "schedule-cron").map((e) => [e.expression, e.zone]),
    [["0 4 * * *", "UTC"], ["0 4 * * *", "Europe/London"]],
  );
});

// ---------------------------------------------------------------- validator

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

Deno.test("the validator rejects an invalid cron expression", () => {
  assertEquals(
    forged((ir) => {
      (all(ir, "schedule-cron")[0] as { expression: string }).expression =
        "* * * *";
    }),
    [
      "validation/002 declarations[0].body.expression: scheduleCron needs a valid cron expression: a cron expression has 5 or 6 fields",
    ],
  );
});

Deno.test("the validator rejects an invalid cron time zone", () => {
  assertEquals(
    forged((ir) => {
      (all(ir, "schedule-cron")[1] as { zone: string }).zone = "GMT";
    }),
    [
      "validation/002 declarations[1].body.zone: scheduleCron needs a valid time zone: an offset zone must end with +hh:mm or -hh:mm",
    ],
  );
});

Deno.test("the validator rejects a scheduleCron that records a string output", () => {
  assertEquals(
    forged((ir) => {
      (all(ir, "schedule-cron")[0] as { type: unknown }).type = {
        kind: "schedule",
        output: { kind: "primitive", name: "string" },
        input: { kind: "primitive", name: "unknown" },
        effects: { failures: [], requirements: [] },
      };
    }),
    [
      "validation/002 declarations[0].body.type: expected Schedule<Duration, unknown, never, never>, recorded Schedule<string, unknown, never, never>",
    ],
  );
});
