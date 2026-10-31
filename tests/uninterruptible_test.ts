// `uninterruptible`: checking through checkProject, and forged IR
// through validateModule. Runtime behavior is in uninterruptible_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { diagnosticsOf, forgedModule } from "./helpers.ts";

const TYPES = "type Int = int\n";

Deno.test("uninterruptible keeps the job result, failures and requirements", () => {
  const source = `${TYPES}export error Stop = {}
export service Jobs { next(): Int fails Stop }
export const a = (): Int fails Stop uses Jobs.next =>
  uninterruptible(() => Jobs.next())
export const missing = (): Int => uninterruptible(() => Jobs.next())
`;
  assertEquals(diagnosticsOf(source), [
    "failure-contract/001 the body can fail with Stop, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Jobs.next, which the `uses` clause does not list",
  ]);
});

Deno.test("uninterruptible adds no failure of its own", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int => uninterruptible(() => 1)\n`,
    ),
    [],
  );
});

Deno.test("the pipeline form of uninterruptible passes the job as the left side", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int => (() => 1) |> uninterruptible()\n`,
    ),
    [],
  );
});

Deno.test("uninterruptible rejects a wrong count and a non-function job", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}export const a = (): Int => uninterruptible()\n`),
    ["type-mismatch/004 `uninterruptible` takes 1 argument, but 0 are given"],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int => uninterruptible(() => 1, 2)\n`,
    ),
    ["type-mismatch/004 `uninterruptible` takes 1 argument, but 2 are given"],
  );
  assertEquals(
    diagnosticsOf(`${TYPES}export const a = (): Int => uninterruptible(1)\n`),
    [
      "type-mismatch/010 `uninterruptible` needs a function that takes no arguments, but the job has type int",
    ],
  );
});

Deno.test("uninterruptible is shadowable, so a local may reuse the name", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (uninterruptible: Int): Int => uninterruptible + 1\n`,
    ),
    [],
  );
});

// ------------------------------------------------------------------ validator

const SOURCE = `${TYPES}export const a = (): Int => uninterruptible(() => 1)\n`;

function find(ir: ModuleIR): Extract<Expr, { kind: "uninterruptible" }> {
  let found: Extract<Expr, { kind: "uninterruptible" }> | undefined;
  const visit = (value: unknown): void => {
    if (found !== undefined || typeof value !== "object" || value === null) {
      return;
    }
    if ((value as { kind?: unknown }).kind === "uninterruptible") {
      found = value as Extract<Expr, { kind: "uninterruptible" }>;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
  assert(found !== undefined);
  return found;
}

const forged = (change: (ir: ModuleIR) => void) => forgedModule(SOURCE, change);

const FORGES: readonly (readonly [
  name: string,
  change: (ir: ModuleIR) => void,
  expected: readonly string[],
])[] = [
  ["a job that is not a function", (ir) => {
    const e = find(ir);
    (e as { job: unknown }).job = {
      ...e.job,
      kind: "literal",
      value: 1,
      type: { kind: "primitive", name: "int" },
      effects: { failures: [], requirements: [] },
      execution: "pure",
    };
  }, [
    "validation/006 declarations[1].body.job: uninterruptible needs a function that takes no arguments, but the job has type int",
  ]],
  ["a pure uninterruptible", (ir) => {
    (find(ir) as { execution: unknown }).execution = "pure";
  }, [
    "validation/004 declarations[1].body.execution: expected effect, recorded pure",
  ]],
  ["an uninterruptible with the wrong result type", (ir) => {
    (find(ir) as { type: unknown }).type = {
      kind: "primitive",
      name: "string",
    };
  }, [
    "validation/002 declarations[1].body.type: expected int, recorded string",
  ]],
  ["an uninterruptible that records a failure", (ir) => {
    (find(ir) as { effects: unknown }).effects = {
      failures: ["error:effect/TimeoutError"],
      requirements: [],
    };
  }, [
    "validation/003 declarations[1].body.effects.failures: expected [], recorded [error:effect/TimeoutError]",
  ]],
];

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}
