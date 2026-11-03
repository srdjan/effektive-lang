// General `retry` options with a RetrySchedule: checking, lowering, and forged
// IR through validateModule. Runtime behavior is in retry_options_slow_test.ts.

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
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Log { note(n: Int): void }
export service Gate { open(e: Stop): Bool fails Other }
`;

const diagnosticsOf = (source: string): string[] =>
  sharedDiagnosticsOf(HEAD + source);

const POLICY =
  "(e: Stop, attempt: Int): Option<Duration> => if (attempt < 3) { Some(100ms) } else { None }";

const RETRY = "retry(() => Jobs.next(), ";
const SIG = "(): Int fails Stop with Jobs.next";

function retryWith(options: string, signature = SIG): string[] {
  return diagnosticsOf(
    `export const a = ${signature} => ${RETRY}${options})\n`,
  );
}

// ------------------------------------------------------------------ checking

Deno.test("each retry option is accepted alone", () => {
  for (
    const options of [
      "{ times: 3 }",
      "{ schedule: retrySchedule(" + POLICY + ") }",
      "{ while: (e) => true }",
      "{ until: (e) => false }",
      "{ while: (e: Stop) => true }",
    ]
  ) assertEquals(retryWith(options), [], options);
});

Deno.test("retry options combine", () => {
  assertEquals(
    retryWith(
      "{ times: 2, schedule: retrySchedule(" + POLICY +
        "), until: (e) => false, while: (e) => true }",
    ),
    [],
  );
});

Deno.test("the callbacks of while and until take the job failure union and return boolean", () => {
  assertEquals(retryWith("{ while: (e: Other) => true }"), [
    "type-mismatch/003 parameter 1 of the callback has type Other, but the collection supplies Stop",
  ]);
  assertEquals(retryWith("{ until: (e) => 1 }"), [
    "type-mismatch/003 the retry `until` result has type int, but boolean is expected",
  ]);
  assertEquals(retryWith("{ while: (a, b) => true }"), [
    "type-mismatch/004 the callback of `retry` takes 1 parameter, but the function takes 2",
  ]);
});

Deno.test("an effectful while callback adds its failures and requirements", () => {
  const options = "{ while: (e) => Gate.open(e) }";
  assertEquals(
    retryWith(
      options,
      "(): Int fails Stop | Other with Jobs.next | Gate.open",
    ),
    [],
  );
  assertEquals(retryWith(options), [
    "failure-contract/001 the body can fail with Other, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Gate.open, which the `with` clause does not list",
  ]);
});

Deno.test("a RetrySchedule whose error type does not accept a job failure is a diagnostic", () => {
  const source = (error: string) =>
    `const s: RetrySchedule<${error}> = retrySchedule((e: ${error}, attempt: Int): Option<Duration> => None)
export const a = ${SIG} => ${RETRY}{ schedule: s })\n`;
  assertEquals(diagnosticsOf(source("Other")), [
    "type-mismatch/003 the retry schedule does not accept error:m#Stop",
  ]);
  assertEquals(diagnosticsOf(source("Stop")), []);
});

Deno.test("an unknown key, a duplicate key, and an empty record are diagnostics", () => {
  assertEquals(retryWith("{ count: 1 }"), [
    "type-mismatch/010 `retry` has no option `count`; the options are times, schedule, while, until",
  ]);
  assertEquals(retryWith("{ times: 1, times: 2 }"), [
    "type-mismatch/010 `retry` option `times` appears twice",
  ]);
  assertEquals(retryWith("{ }"), [
    "type-mismatch/010 `retry` needs at least one of `times`, `schedule`, `while`, or `until`",
  ]);
  assertEquals(retryWith("3"), [
    "type-mismatch/010 `retry` needs an options record with `times`, `schedule`, `while`, or `until`",
  ]);
});

Deno.test("times stays a nonnegative safe integer literal in a combined record", () => {
  for (const times of ["1.5", "0 - 1", "n"]) {
    assertEquals(
      retryWith(
        `{ times: ${times}, until: (e) => true }`,
        "(n: Int): Int fails Stop with Jobs.next",
      ),
      [
        "type-mismatch/010 `retry` needs `times` to be a finite nonnegative safe integer literal",
      ],
      times,
    );
  }
});

Deno.test("schedule needs a RetrySchedule", () => {
  assertEquals(retryWith("{ schedule: 3 }"), [
    "type-mismatch/010 `retry` needs a RetrySchedule in `schedule`",
  ]);
  assertEquals(
    diagnosticsOf(
      `const s: Int = 3\nexport const a = ${SIG} => ${RETRY}{ schedule: s })\n`,
    ),
    ["type-mismatch/010 `retry` needs a RetrySchedule in `schedule`"],
  );
});

Deno.test("while is a record label but not a name", () => {
  assertEquals(diagnosticsOf(`const while = 1\n`), [
    "syntax/007 `while` is a reserved word and cannot be a name",
  ]);
});

// ------------------------------------------------------------------ lowering

const SOURCE = `${HEAD}export const times = ${SIG} => ${RETRY}{ times: 3 })
export const both = ${SIG} => ${RETRY}{ times: 3, until: (e) => false })
const policy: RetrySchedule<Stop> = retrySchedule(${POLICY})
export const sched = ${SIG} => ${RETRY}{ schedule: policy })
export const gated = ${SIG} => ${RETRY}{ schedule: policy })
`;

const lowered = () => loweredModule(SOURCE);

Deno.test("a times-only record keeps the retry kind and every other record lowers to retry-with-schedule", () => {
  const ir = lowered();
  assertEquals(allExprs(ir, "retry").map((e) => e.times), [3]);
  assertEquals(allExprs(ir, "retry-with-schedule").length, 3);
  const [both] = allExprs(ir, "retry-with-schedule");
  assert(both.options.kind === "record");
  assertEquals(both.options.fields.map((f) => f.name), ["times", "until"]);
});

// ------------------------------------------------------------------ validator

const forged = (change: (ir: ModuleIR) => void) => forgedModule(SOURCE, change);

function options(ir: ModuleIR): Extract<Expr, { kind: "record" }> {
  const e = allExprs(ir, "retry-with-schedule")[0].options;
  assert(e.kind === "record");
  return e;
}

const REC = "{ times: int, until: (error:m#Stop) => boolean [pure] }";
const OPTS = "declarations[8].body.options";

const FORGES: readonly (readonly [
  name: string,
  change: (ir: ModuleIR) => void,
  expected: readonly string[],
])[] = [
  ["an unknown retry option", (ir) => {
    (options(ir).fields[0] as { name: string }).name = "count";
  }, [
    `validation/002 ${OPTS}.fields[0]: the record type ${REC} has no field count`,
    `validation/002 ${OPTS}: the construction is missing the required fields [times]`,
    `validation/006 ${OPTS}.fields[0]: retry has no option count`,
  ]],
  ["a duplicate retry option", (ir) => {
    (options(ir).fields[1] as { name: string }).name = "times";
  }, [
    `validation/002 ${OPTS}.fields[1]: the field times appears twice`,
    `validation/002 ${OPTS}: the construction is missing the required fields [until]`,
    `validation/006 ${OPTS}.fields[1]: retry option times appears twice`,
  ]],
  ["an empty retry options record", (ir) => {
    (options(ir) as { fields: unknown }).fields = [];
  }, [
    `validation/002 ${OPTS}: the construction is missing the required fields [times, until]`,
    `validation/006 ${OPTS}: retry needs at least one option`,
  ]],
  ["a negative times option", (ir) => {
    (options(ir).fields[0].value as { value: unknown }).value = -1;
  }, [
    `validation/006 ${OPTS}.fields[0].value: retry needs a finite nonnegative safe integer literal for times`,
  ]],
  ["a while option that is not a function", (ir) => {
    const fields = options(ir).fields as { name: string; value: Expr }[];
    fields[1] = { name: "while", value: fields[0].value };
  }, [
    `validation/002 ${OPTS}.fields[1]: the record type ${REC} has no field while`,
    `validation/002 ${OPTS}: the construction is missing the required fields [until]`,
    `validation/006 ${OPTS}.fields[1]: retry while needs a one-parameter function`,
  ]],
  ["a schedule option that is not a schedule", (ir) => {
    (options(ir).fields[1] as { name: string }).name = "schedule";
  }, [
    `validation/002 ${OPTS}.fields[1]: the record type ${REC} has no field schedule`,
    `validation/002 ${OPTS}: the construction is missing the required fields [until]`,
    `validation/006 ${OPTS}.fields[1]: retry needs a retry schedule in schedule`,
  ]],
  ["retry options that are not a record", (ir) => {
    (allExprs(ir, "retry-with-schedule")[0] as { options: unknown }).options =
      allExprs(ir, "literal")[0];
  }, [
    `validation/006 ${OPTS}: retry needs an options record`,
  ]],
];

Deno.test("the validator rejects a schedule whose input does not accept a job failure", () => {
  const found = forged((ir) => {
    const gated = allExprs(ir, "retry-with-schedule")[2];
    const type = gated.job.type;
    assert(type.kind === "function");
    (type.effects as unknown as { failures: string[] }).failures = [
      "error:m#Other",
      "error:m#Stop",
    ];
  });
  assertEquals(found, [
    "validation/003 declarations[11].body.effects.failures: expected [error:m#Other, error:m#Stop], recorded [error:m#Stop]",
    "validation/003 declarations[11].body: the body can fail with [error:m#Other], which the declared failures [error:m#Stop] do not list",
    "validation/006 declarations[11].body.options.fields[0]: retry schedule does not accept error:m#Other",
  ]);
});

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}
