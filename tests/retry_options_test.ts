// General `retry` options and the Schedule builtins `scheduleExponential` and
// `scheduleJittered` (unit ES3): checking, lowering, and forged IR through
// validateModule. Runtime behavior is in retry_options_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

const HEAD = `type Int = int
type Bool = boolean
export error Stop = {}
export error Other = {}
export service Jobs { next(): Int fails Stop }
export service Log { note(n: Int): void }
export service Gate { open(e: Stop): Bool fails Other }
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

const RETRY = "retry(() => Jobs.next(), ";
const SIG = "(): Int fails Stop uses Jobs.next";

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
      "{ schedule: scheduleRecurs(3) }",
      "{ while: (e) => true }",
      "{ until: (e) => false }",
      "{ while: (e: Stop) => true }",
      "{ schedule: scheduleExponential(100ms) }",
      "{ schedule: scheduleJittered(scheduleRecurs(2)) }",
    ]
  ) assertEquals(retryWith(options), [], options);
});

Deno.test("retry options combine", () => {
  assertEquals(
    retryWith(
      "{ times: 2, schedule: scheduleExponential(100ms, 2), until: (e) => false, while: (e) => true }",
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
      "(): Int fails Stop | Other uses Jobs.next | Gate.open",
    ),
    [],
  );
  assertEquals(retryWith(options), [
    "failure-contract/001 the body can fail with Other, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Gate.open, which the `uses` clause does not list",
  ]);
});

Deno.test("a Schedule in schedule adds its own failures and requirements", () => {
  const options =
    "{ schedule: scheduleMap(scheduleRecurs(2), (m) => Gate.open(Stop({})) ) }";
  assertEquals(retryWith(options), [
    "failure-contract/001 the body can fail with Other, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Gate.open, which the `uses` clause does not list",
  ]);
});

Deno.test("a Schedule whose input does not accept a job failure is a diagnostic", () => {
  const rejected = `const s: Schedule<Int, Other> = scheduleRecurs(2)
export const a = ${SIG} => ${RETRY}{ schedule: s })\n`;
  assertEquals(diagnosticsOf(rejected), [
    "type-mismatch/003 the retry schedule does not accept error:m#Stop",
  ]);
  assertEquals(
    diagnosticsOf(rejected.replace("Other", "Stop")),
    [],
  );
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
        "(n: Int): Int fails Stop uses Jobs.next",
      ),
      [
        "type-mismatch/010 `retry` needs `times` to be a finite nonnegative safe integer literal",
      ],
      times,
    );
  }
});

Deno.test("schedule needs a RetrySchedule or a Schedule", () => {
  assertEquals(retryWith("{ schedule: 3 }"), [
    "type-mismatch/010 `retry` needs a RetrySchedule or a Schedule in `schedule`",
  ]);
});

Deno.test("scheduleExponential and scheduleJittered check their arguments", () => {
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Duration> => scheduleExponential("x")\n`,
    ),
    [
      "type-mismatch/003 the exponential base has type string, but Duration is expected",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Duration> => scheduleExponential(1ms, "x")\n`,
    ),
    [
      "type-mismatch/003 the exponential factor has type string, but number is expected",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Int> => scheduleExponential()\n`,
    ),
    [
      "type-mismatch/004 `scheduleExponential` takes a base and an optional factor",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Int> => scheduleJittered(1)\n`,
    ),
    [
      "type-mismatch/010 `scheduleJittered` needs a Schedule",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `export const a = (): Schedule<Duration> => scheduleJittered(scheduleExponential(5ms))\n`,
    ),
    [],
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
export const sched = ${SIG} => ${RETRY}{ schedule: scheduleJittered(scheduleExponential(100ms, 2)) })
export const plain = (): Schedule<Duration> => scheduleExponential(100ms)
const stopOnly: Schedule<Int, Stop> = scheduleRecurs(1)
export const gated = ${SIG} => ${RETRY}{ schedule: stopOnly })
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

Deno.test("a times-only record keeps the retry kind and every other record lowers to retry-with-schedule", () => {
  const ir = lowered();
  assertEquals(all(ir, "retry").map((e) => e.times), [3]);
  assertEquals(all(ir, "retry-with-schedule").length, 3);
  const [both] = all(ir, "retry-with-schedule");
  assert(both.options.kind === "record");
  assertEquals(both.options.fields.map((f) => f.name), ["times", "until"]);
});

Deno.test("scheduleExponential lowers a missing factor to null", () => {
  const ir = lowered();
  assertEquals(
    all(ir, "schedule-exponential").map((e) => e.factor === null),
    [false, true],
  );
  assertEquals(all(ir, "schedule-jittered").length, 1);
});

// ------------------------------------------------------------------ validator

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

function options(ir: ModuleIR): Extract<Expr, { kind: "record" }> {
  const e = all(ir, "retry-with-schedule")[0].options;
  assert(e.kind === "record");
  return e;
}

const REC = "{ times: int, until: (error:m#Stop) => boolean [pure] }";
const OPTS = "declarations[8].body.options";
const EXP = "declarations[9].body.options.fields[0].value.schedule";

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
    `validation/006 ${OPTS}.fields[1]: retry needs a retry schedule or a schedule in schedule`,
  ]],
  ["retry options that are not a record", (ir) => {
    (all(ir, "retry-with-schedule")[0] as { options: unknown }).options =
      all(ir, "literal")[0];
  }, [
    `validation/006 ${OPTS}: retry needs an options record`,
  ]],
  ["a string base in scheduleExponential", (ir) => {
    const base = all(ir, "schedule-exponential")[0].baseMs;
    assert(base.kind === "nominal");
    (base.value as { value: unknown }).value = "x";
  }, [
    `validation/002 ${EXP}.baseMs.value.type: the recomputed type "x" does not fit the recorded type int`,
    `validation/002 ${EXP}.baseMs.value: the value has type "x", which does not fit the base int`,
  ]],
  ["a string factor in scheduleExponential", (ir) => {
    (all(ir, "schedule-exponential")[0].factor as { value: unknown }).value =
      "x";
  }, [
    `validation/002 ${EXP}.factor: scheduleExponential needs a number factor, found "x"`,
    `validation/002 ${EXP}.factor.type: the recomputed type "x" does not fit the recorded type number`,
  ]],
  ["a scheduleJittered of an int", (ir) => {
    (all(ir, "schedule-jittered")[0] as { schedule: unknown }).schedule =
      all(ir, "literal")[0];
  }, [
    `validation/002 ${EXP}: scheduleJittered needs a Schedule, found int`,
  ]],
  ["a scheduleExponential that records a string output", (ir) => {
    (all(ir, "schedule-exponential")[1] as { type: unknown }).type = {
      kind: "schedule",
      output: { kind: "primitive", name: "string" },
      input: { kind: "primitive", name: "unknown" },
      effects: { failures: [], requirements: [] },
    };
  }, [
    "validation/002 declarations[10].body.type: expected Schedule<Duration, unknown, never, never>, recorded Schedule<string, unknown, never, never>",
  ]],
];

Deno.test("the validator rejects a schedule whose input does not accept a job failure", () => {
  const found = forged((ir) => {
    const gated = all(ir, "retry-with-schedule")[2];
    const type = gated.job.type;
    assert(type.kind === "function");
    (type.effects as unknown as { failures: string[] }).failures = [
      "error:m#Other",
      "error:m#Stop",
    ];
  });
  assertEquals(found, [
    "validation/003 declarations[12].body.effects.failures: expected [error:m#Other, error:m#Stop], recorded [error:m#Stop]",
    "validation/003 declarations[12].body: the body can fail with [error:m#Other], which the declared failures [error:m#Stop] do not list",
    "validation/006 declarations[12].body.options.fields[0]: retry schedule does not accept error:m#Other",
  ]);
});

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}
