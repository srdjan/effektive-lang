// `repeat` (unit ES4): checking, lowering, and forged IR through
// validateModule. Runtime behavior is in repeat_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

const HEAD = `type Int = int
type Bool = boolean
type Text = string
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Gate { open(n: Int): Bool fails Other }
`;

function diagnosticsOf(source: string): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": HEAD + source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

const REPEAT = "repeat(() => Jobs.next(), ";
const SIG = "(): Int fails Stop uses Jobs.next";

function repeatWith(options: string, signature = SIG): string[] {
  return diagnosticsOf(
    `export const a = ${signature} => ${REPEAT}${options})\n`,
  );
}

Deno.test("repeat(job) has the result type never and the job failures", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (): never fails Stop uses Jobs.next => repeat(() => Jobs.next())\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): never uses Jobs.next => repeat(() => Jobs.next())\n`,
    ),
    [
      "failure-contract/001 the body can fail with Stop, which the `fails` clause does not list",
    ],
  );
  assertEquals(
    diagnosticsOf(`export const a = (): Int => repeat(() => 1)\n`),
    [],
  );
});

Deno.test("each repeat option is accepted alone", () => {
  for (
    const options of [
      "{ times: 3 }",
      "{ schedule: scheduleRecurs(3) }",
      "{ schedule: scheduleExponential(100ms) }",
      "{ while: (n) => true }",
      "{ until: (n: Int) => false }",
      "{ times: 2, until: (n) => n > 1, while: (n) => true }",
    ]
  ) assertEquals(repeatWith(options), [], options);
});

Deno.test("while and until receive the job success type", () => {
  assertEquals(repeatWith("{ while: (n: Text) => true }"), [
    "type-mismatch/003 parameter 1 of the callback has type Text, but the collection supplies Int",
  ]);
  assertEquals(repeatWith("{ until: (n) => n }"), [
    "type-mismatch/003 the repeat `until` result has type Int, but boolean is expected",
  ]);
  assertEquals(repeatWith("{ while: (a, b) => true }"), [
    "type-mismatch/004 the callback of `repeat` takes 1 parameter, but the function takes 2",
  ]);
});

Deno.test("an effectful while callback adds its failures and requirements", () => {
  const options = "{ while: (n) => Gate.open(n) }";
  assertEquals(
    repeatWith(
      options,
      "(): Int fails Stop | Other uses Jobs.next | Gate.open",
    ),
    [],
  );
  assertEquals(repeatWith(options), [
    "failure-contract/001 the body can fail with Other, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Gate.open, which the `uses` clause does not list",
  ]);
});

Deno.test("a RetrySchedule in schedule is a diagnostic", () => {
  assertEquals(
    diagnosticsOf(
      `const r: RetrySchedule<Stop> = retrySchedule((e: Stop, n: Int): Option<Duration> => None)
export const a = ${SIG} => ${REPEAT}{ schedule: r })\n`,
    ),
    [
      "type-mismatch/010 `repeat` needs a Schedule in `schedule`; a RetrySchedule takes failures as input",
    ],
  );
  assertEquals(repeatWith("{ schedule: 3 }"), [
    "type-mismatch/010 `repeat` needs a Schedule in `schedule`",
  ]);
});

Deno.test("a Schedule whose input does not accept the success type is a diagnostic", () => {
  const rejected = `const s: Schedule<Int, Text> = scheduleRecurs(2)
export const a = ${SIG} => ${REPEAT}{ schedule: s })\n`;
  assertEquals(diagnosticsOf(rejected), [
    "type-mismatch/003 the repeat schedule does not accept Int",
  ]);
  assertEquals(diagnosticsOf(rejected.replace("Text>", "Int>")), []);
});

Deno.test("an unknown key, a duplicate key, and an empty record are diagnostics", () => {
  assertEquals(repeatWith("{ count: 1 }"), [
    "type-mismatch/010 `repeat` has no option `count`; the options are times, schedule, while, until",
  ]);
  assertEquals(repeatWith("{ times: 1, times: 2 }"), [
    "type-mismatch/010 `repeat` option `times` appears twice",
  ]);
  assertEquals(repeatWith("{ }"), [
    "type-mismatch/010 `repeat` needs at least one of `times`, `schedule`, `while`, or `until`",
  ]);
  assertEquals(repeatWith("3"), [
    "type-mismatch/010 `repeat` needs an options record with `times`, `schedule`, `while`, or `until`",
  ]);
  assertEquals(repeatWith("{ times: 0 - 1 }"), [
    "type-mismatch/010 `repeat` needs `times` to be a finite nonnegative safe integer literal",
  ]);
});

Deno.test("the pipeline form takes options, or no argument for the forever form", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = ${SIG} => (() => Jobs.next()) |> repeat({ times: 2 })\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): never fails Stop uses Jobs.next => (() => Jobs.next()) |> repeat()\n`,
    ),
    [],
  );
});

Deno.test("repeat checks its job and its argument count", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (): Int => repeat(() => 1, { times: 1 }, 3)\n`,
    ),
    ["type-mismatch/004 `repeat` takes a job and optional options"],
  );
  assertEquals(
    diagnosticsOf(`export const a = (): Int => repeat()\n`),
    ["type-mismatch/004 `repeat` takes a job and optional options"],
  );
  assertEquals(
    diagnosticsOf(`export const a = (): Int => repeat((n: Int) => 1)\n`),
    ["type-mismatch/010 `repeat` needs a function that takes no arguments, but the job takes 1"],
  );
});

// ------------------------------------------------------------------ lowering

const SOURCE =
  `${HEAD}export const forever = (): never fails Stop uses Jobs.next => repeat(() => Jobs.next())
export const limited = ${SIG} => ${REPEAT}{ times: 2, until: (n) => n > 2 })
export const policy: RetrySchedule<Stop> = retrySchedule((e: Stop, n: Int): Option<Duration> => None)
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

Deno.test("repeat lowers to the repeat kind with null or record options", () => {
  const ir = lowered();
  const [forever, limited] = all(ir, "repeat");
  assertEquals(forever.options, null);
  assert(limited.options?.kind === "record");
  assertEquals(limited.options.fields.map((f) => f.name), ["times", "until"]);
});

// ------------------------------------------------------------------ validator

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

const FOREVER = "declarations[7].body";
const LIMITED = "declarations[8].body";

function limitedOptions(ir: ModuleIR): Extract<Expr, { kind: "record" }> {
  const e = all(ir, "repeat")[1].options;
  assert(e?.kind === "record");
  return e;
}

Deno.test("the validator rejects an unknown repeat option", () => {
  const found = forged((ir) => {
    (limitedOptions(ir).fields[0] as { name: string }).name = "count";
  });
  assert(
    found.includes(
      `validation/006 ${LIMITED}.options.fields[0]: repeat has no option count`,
    ),
    found.join("\n"),
  );
});

Deno.test("the validator rejects a negative times option in repeat", () => {
  const found = forged((ir) => {
    (limitedOptions(ir).fields[0].value as { value: unknown }).value = -1;
  });
  assertEquals(found, [
    `validation/006 ${LIMITED}.options.fields[0].value: repeat needs a finite nonnegative safe integer literal for times`,
  ]);
});

Deno.test("the validator rejects a RetrySchedule in a repeat schedule", () => {
  const found = forged((ir) => {
    const options = limitedOptions(ir);
    // A type also has the kind retry-schedule; only the expression has a step.
    const value = all(ir, "retry-schedule").find((e) => "step" in e)!;
    (options as { fields: unknown }).fields = [{ name: "schedule", value }];
    (options as { type: unknown }).type = {
      kind: "record",
      fields: [{ name: "schedule", type: value.type, optional: false }],
    };
  });
  assert(
    found.includes(
      `validation/006 ${LIMITED}.options.fields[0]: repeat needs a schedule in schedule; a retry schedule takes failures as input`,
    ),
    found.join("\n"),
  );
});

Deno.test("the validator rejects a repeat job that is not a function", () => {
  const found = forged((ir) => {
    (all(ir, "repeat")[0] as { job: unknown }).job = all(ir, "literal")[0];
  });
  assert(
    found.includes(
      `validation/006 ${FOREVER}.job: repeat needs a function that takes no arguments, but the job has type int`,
    ),
    found.join("\n"),
  );
});

Deno.test("the validator rejects repeat options that are not a record", () => {
  const found = forged((ir) => {
    (all(ir, "repeat")[1] as { options: unknown }).options =
      all(ir, "literal")[0];
  });
  assert(
    found.includes(
      `validation/006 ${LIMITED}.options: repeat needs an options record`,
    ),
    found.join("\n"),
  );
});
