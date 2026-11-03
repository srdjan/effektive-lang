// `repeat`: checking, lowering, and forged IR through
// validateModule. Runtime behavior is in repeat_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import {
  allExprs,
  diagnosticsOf as sharedDiagnosticsOf,
  forgedModule,
  loweredModule,
} from "./helpers.ts";

const HEAD = `type Int = int
type Bool = boolean
type Text = string
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Gate { open(n: Int): Bool fails Other }
`;

const diagnosticsOf = (source: string): string[] =>
  sharedDiagnosticsOf(HEAD + source);

const REPEAT = "repeat(() => Jobs.next(), ";
const SIG = "(): Int fails Stop with Jobs.next";

function repeatWith(options: string, signature = SIG): string[] {
  return diagnosticsOf(
    `export const a = ${signature} => ${REPEAT}${options})\n`,
  );
}

Deno.test("repeat(job) has the result type never and the job failures", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (): never fails Stop with Jobs.next => repeat(() => Jobs.next())\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): never fails Other with Jobs.next => repeat(() => Jobs.next())\n`,
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
      "(): Int fails Stop | Other with Jobs.next | Gate.open",
    ),
    [],
  );
  assertEquals(repeatWith(options), [
    "failure-contract/001 the body can fail with Other, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Gate.open, which the `with` clause does not list",
  ]);
});

Deno.test("schedule is no option of repeat", () => {
  assertEquals(
    diagnosticsOf(
      `const r: RetrySchedule<Stop> = retrySchedule((e: Stop, n: Int): Option<Duration> => None)
export const a = ${SIG} => ${REPEAT}{ schedule: r })\n`,
    ),
    [
      "type-mismatch/010 `repeat` has no option `schedule`; the options are times, while, until",
    ],
  );
  assertEquals(repeatWith("{ schedule: 3 }"), [
    "type-mismatch/010 `repeat` has no option `schedule`; the options are times, while, until",
  ]);
  assertEquals(repeatWith("{ times: 2, schedule: 3 }"), [
    "type-mismatch/010 `repeat` has no option `schedule`; the options are times, while, until",
  ]);
});

Deno.test("an unknown key, a duplicate key, and an empty record are diagnostics", () => {
  assertEquals(repeatWith("{ count: 1 }"), [
    "type-mismatch/010 `repeat` has no option `count`; the options are times, while, until",
  ]);
  assertEquals(repeatWith("{ times: 1, times: 2 }"), [
    "type-mismatch/010 `repeat` option `times` appears twice",
  ]);
  assertEquals(repeatWith("{ }"), [
    "type-mismatch/010 `repeat` needs at least one of `times`, `while`, or `until`",
  ]);
  assertEquals(repeatWith("3"), [
    "type-mismatch/010 `repeat` needs an options record with `times`, `while`, or `until`",
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
      `export const a = (): never fails Stop with Jobs.next => (() => Jobs.next()) |> repeat()\n`,
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
  `${HEAD}export const forever = (): never fails Stop with Jobs.next => repeat(() => Jobs.next())
export const limited = ${SIG} => ${REPEAT}{ times: 2, until: (n) => n > 2 })
export const policy: RetrySchedule<Stop> = retrySchedule((e: Stop, n: Int): Option<Duration> => None)
`;

const lowered = () => loweredModule(SOURCE);

Deno.test("repeat lowers to the repeat kind with null or record options", () => {
  const ir = lowered();
  const [forever, limited] = allExprs(ir, "repeat");
  assertEquals(forever.options, null);
  assert(limited.options?.kind === "record");
  assertEquals(limited.options.fields.map((f) => f.name), ["times", "until"]);
});

// ------------------------------------------------------------------ validator

const forged = (change: (ir: ModuleIR) => void) => forgedModule(SOURCE, change);

const FOREVER = "declarations[7].body";
const LIMITED = "declarations[8].body";

function limitedOptions(ir: ModuleIR): Extract<Expr, { kind: "record" }> {
  const e = allExprs(ir, "repeat")[1].options;
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

Deno.test("the validator rejects a schedule option in a repeat record", () => {
  const found = forged((ir) => {
    const options = limitedOptions(ir);
    // A type also has the kind retry-schedule; only the expression has a step.
    const value = allExprs(ir, "retry-schedule").find((e) => "step" in e)!;
    (options as { fields: unknown }).fields = [{ name: "schedule", value }];
    (options as { type: unknown }).type = {
      kind: "record",
      fields: [{ name: "schedule", type: value.type, optional: false }],
    };
  });
  assert(
    found.includes(
      `validation/006 ${LIMITED}.options.fields[0]: repeat has no option schedule`,
    ),
    found.join("\n"),
  );
});

Deno.test("the validator rejects a repeat job that is not a function", () => {
  const found = forged((ir) => {
    (allExprs(ir, "repeat")[0] as { job: unknown }).job =
      allExprs(ir, "literal")[0];
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
    (allExprs(ir, "repeat")[1] as { options: unknown }).options =
      allExprs(ir, "literal")[0];
  });
  assert(
    found.includes(
      `validation/006 ${LIMITED}.options: repeat needs an options record`,
    ),
    found.join("\n"),
  );
});
