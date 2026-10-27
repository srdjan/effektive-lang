// `race(jobs)` over an array (unit ES10): checking through checkProject, and
// forged IR through validateModule. Runtime behavior is in race_all_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

const HEAD = `type Int = int
export error Stop = {}
export service Jobs { next(): Int fails Stop }
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

Deno.test("race over an array has the success, failures and requirements of its jobs", () => {
  const source = `${HEAD}export const jobs = (): Int[] => [1]
export const a = (): Int fails Stop uses Jobs.next =>
  run(race([defer(() => Jobs.next()), defer(() => 1)]))
export const missing = (): Int => run(race([defer(() => Jobs.next())]))
`;
  assertEquals(diagnosticsOf(source), [
    "failure-contract/001 the body can fail with Stop, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Jobs.next, which the `uses` clause does not list",
  ]);
});

Deno.test("race over an array is an Effect value that a pure function can return", () => {
  assertEquals(
    diagnosticsOf(
      `${HEAD}export const a = (): Effect<Int, never, never> => race([defer(() => 1)])\n`,
    ),
    [],
  );
});

Deno.test("race over an array rejects a non-array, non-Effect elements and mixed successes", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => run(race(1))\n`),
    ["type-mismatch/010 `race` needs an array of Effect values"],
  );
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => run(race([1, 2]))\n`),
    ["type-mismatch/010 `race` needs an array of Effect values"],
  );
  assertEquals(
    diagnosticsOf(
      `${HEAD}export const a = (): Int => run(race([defer(() => 1), defer(() => "x")]))\n`,
    ),
    [
      "type-mismatch/010 `race` needs an array of Effect values",
      "type-mismatch/012 list element 2 has type Effect<string, never, never>, which has no common array element type with Effect<int, never, never>",
    ],
  );
});

Deno.test("race takes an array or two Effect values and nothing else", () => {
  const message =
    "type-mismatch/004 `race` takes an Effect array or two Effect values";
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => run(race())\n`),
    [
      message,
    ],
  );
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => run(race(1, 2, 3))\n`),
    [message],
  );
});

Deno.test("race of two Effect values is unchanged", () => {
  assertEquals(
    diagnosticsOf(
      `${HEAD}export const a = (): Int => run(race(defer(() => 1), defer(() => 2)))\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int => run(race(1, 2))\n`),
    ["type-mismatch/010 `race` needs two Effect values"],
  );
});

// ------------------------------------------------------------------ validator

const SOURCE =
  `${HEAD}export const a = (): Int => run(race([defer(() => 1)]))\n`;

function lowered(): ModuleIR {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": SOURCE }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const module = lowerProject(checked.value).get("m");
  assert(module?.ok);
  assertEquals(validateModule(module.value, new Map([["m.eff", SOURCE]])), []);
  return structuredClone(module.value);
}

function find(ir: ModuleIR): Extract<Expr, { kind: "race-all" }> {
  let found: Extract<Expr, { kind: "race-all" }> | undefined;
  const visit = (value: unknown): void => {
    if (found !== undefined || typeof value !== "object" || value === null) {
      return;
    }
    if ((value as { kind?: unknown }).kind === "race-all") {
      found = value as Extract<Expr, { kind: "race-all" }>;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
  assert(found !== undefined);
  return found;
}

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

const literal = {
  kind: "literal",
  value: 1,
  type: { kind: "primitive", name: "int" },
  effects: { failures: [], requirements: [] },
  execution: "pure",
};

const FORGES: readonly (readonly [
  name: string,
  change: (ir: ModuleIR) => void,
  expected: readonly string[],
])[] = [
  ["jobs that are not an array", (ir) => {
    const e = find(ir);
    (e as { jobs: unknown }).jobs = { ...e.jobs, ...literal };
  }, [
    "validation/002 declarations[3].body.value: race needs an array of Effect values",
  ]],
  ["jobs that are an array of non-Effect values", (ir) => {
    const e = find(ir);
    (e as { jobs: unknown }).jobs = {
      ...e.jobs,
      type: { kind: "array", element: { kind: "primitive", name: "int" } },
    };
  }, [
    "validation/002 declarations[3].body.value: race needs an array of Effect values",
    "validation/002 declarations[3].body.value.jobs.elements[0]: the element has type Effect<int, never, never>, which does not fit int",
  ]],
  ["a race-all with the wrong result type", (ir) => {
    (find(ir) as { type: unknown }).type = {
      kind: "effect",
      result: { kind: "primitive", name: "string" },
      effects: { failures: [], requirements: [] },
    };
  }, [
    "validation/002 declarations[3].body.value.type: expected Effect<int, never, never>, recorded Effect<string, never, never>",
  ]],
  ["a race-all that records a failure", (ir) => {
    (find(ir) as { effects: unknown }).effects = {
      failures: ["error:effect/TimeoutError"],
      requirements: [],
    };
  }, [
    "validation/003 declarations[3].body.value.effects.failures: expected [], recorded [error:effect/TimeoutError]",
  ]],
];

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}
