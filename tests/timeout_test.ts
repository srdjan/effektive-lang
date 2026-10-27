// `timeout` and `sleep` (unit ES2): checking through checkProject, and forged
// IR through validateModule. Runtime behavior is in timeout_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";

const TYPES = "type Int = int\n";

function diagnosticsOf(source: string): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

// ------------------------------------------------------------------ checking

Deno.test("timeout keeps the job result and adds TimeoutError to its failures", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => timeout(() => 1, 5s)\n`,
    ),
    [],
  );
});

Deno.test("an exported function that uses timeout must list TimeoutError in fails", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}export const a = (): Int => timeout(() => 1, 5s)\n`),
    [
      "failure-contract/001 the body can fail with error:effect/TimeoutError, which the `fails` clause does not list",
    ],
  );
});

Deno.test("timeout adds the job failures and requirements to its own", () => {
  const source = `${TYPES}export error Stop = {}
export service Jobs { next(): Int fails Stop }
export const a = (): Int fails TimeoutError | Stop uses Jobs.next =>
  timeout(() => Jobs.next(), 1s)
export const missing = (): Int fails TimeoutError => timeout(() => Jobs.next(), 1s)
`;
  assertEquals(diagnosticsOf(source), [
    "failure-contract/001 the body can fail with Stop, which the `fails` clause does not list",
    "requirement-contract/001 the body requires Jobs.next, which the `uses` clause does not list",
  ]);
});

Deno.test("a catch arm for TimeoutError removes it from the failure set", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int =>
  try { timeout(() => 1, 5s) } catch { TimeoutError(e) => 0 }
`,
    ),
    [],
  );
});

Deno.test("the pipeline form of timeout passes the job as the left side", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => (() => 1) |> timeout(5s)\n`,
    ),
    [],
  );
});

Deno.test("timeout rejects a wrong count, a non-function job and a non-Duration duration", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => timeout(() => 1)\n`,
    ),
    ["type-mismatch/004 `timeout` takes 2 arguments, but 1 is given"],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => timeout(1, 5s)\n`,
    ),
    [
      "type-mismatch/010 `timeout` needs a function that takes no arguments, but the job has type int",
    ],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (): Int fails TimeoutError => timeout(() => 1, "x")\n`,
    ),
    ["type-mismatch/003 the timeout duration has type string, but Duration is expected"],
  );
});

Deno.test("sleep takes one Duration and returns void without failures", () => {
  assertEquals(diagnosticsOf("export const a = (): void => sleep(10ms)\n"), []);
  assertEquals(diagnosticsOf("export const a = (): void => sleep(2s)\n"), []);
  assertEquals(
    diagnosticsOf("export const a = (): void => sleep(1, 2)\n"),
    ["type-mismatch/004 `sleep` takes 1 argument, but 2 are given"],
  );
  assertEquals(
    diagnosticsOf('export const a = (): void => sleep("x")\n'),
    ["type-mismatch/003 the sleep duration has type string, but Duration is expected"],
  );
});

Deno.test("timeout and sleep are shadowable, so a local may reuse the names", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const a = (timeout: Int, sleep: Int): Int => timeout + sleep\n`,
    ),
    [],
  );
});

// ------------------------------------------------------------------ validator

const SOURCE =
  `${TYPES}export const slow = (): Int fails TimeoutError => timeout(() => 1, 5s)
export const nap = (): void => sleep(10ms)
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
  assert(module?.ok);
  assertEquals(validateModule(module.value, new Map([["m.eff", SOURCE]])), []);
  return structuredClone(module.value);
}

function find<K extends Expr["kind"]>(
  ir: ModuleIR,
  kind: K,
): Extract<Expr, { kind: K }> {
  let found: Extract<Expr, { kind: K }> | undefined;
  const visit = (value: unknown): void => {
    if (found !== undefined || typeof value !== "object" || value === null) {
      return;
    }
    if ((value as { kind?: unknown }).kind === kind) {
      found = value as Extract<Expr, { kind: K }>;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ir.declarations);
  assert(found !== undefined, kind);
  return found;
}

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

const FORGES: readonly (readonly [
  name: string,
  change: (ir: ModuleIR) => void,
  expected: readonly string[],
])[] = [
  ["a string duration in timeout", (ir) => {
    const duration = find(ir, "timeout").durationMs;
    assert(duration.kind === "nominal");
    (duration.value as { value: unknown }).value = "x";
  }, [
    'validation/002 declarations[1].body.durationMs.value.type: the recomputed type "x" does not fit the recorded type int',
    'validation/002 declarations[1].body.durationMs.value: the value has type "x", which does not fit the base int',
  ]],
  ["a timeout job that is not a function", (ir) => {
    const e = find(ir, "timeout");
    (e as { job: Expr }).job = e.durationMs;
  }, [
    "validation/006 declarations[1].body.job: timeout needs a function that takes no arguments, but the job has type Duration",
  ]],
  ["a timeout without TimeoutError in its failures", (ir) => {
    (find(ir, "timeout") as { effects: unknown }).effects = {
      failures: [],
      requirements: [],
    };
  }, [
    "validation/003 declarations[1].body.effects.failures: expected [error:effect/TimeoutError], recorded []",
  ]],
  ["a pure timeout", (ir) => {
    (find(ir, "timeout") as { execution: unknown }).execution = "pure";
  }, [
    "validation/004 declarations[1].body.execution: expected effect, recorded pure",
  ]],
  ["a timeout with the wrong result type", (ir) => {
    (find(ir, "timeout") as { type: unknown }).type = {
      kind: "primitive",
      name: "string",
    };
  }, [
    "validation/002 declarations[1].body.type: expected int, recorded string",
  ]],
  ["a string duration in sleep", (ir) => {
    const duration = find(ir, "sleep").durationMs;
    assert(duration.kind === "nominal");
    (duration.value as { value: unknown }).value = "x";
  }, [
    'validation/002 declarations[2].body.durationMs.value.type: the recomputed type "x" does not fit the recorded type int',
    'validation/002 declarations[2].body.durationMs.value: the value has type "x", which does not fit the base int',
  ]],
  ["a pure sleep", (ir) => {
    (find(ir, "sleep") as { execution: unknown }).execution = "pure";
  }, [
    "validation/004 declarations[2].body.execution: expected effect, recorded pure",
  ]],
  ["a sleep with an int result", (ir) => {
    (find(ir, "sleep") as { type: unknown }).type = {
      kind: "primitive",
      name: "int",
    };
  }, ["validation/002 declarations[2].body.type: expected void, recorded int"]],
  ["a sleep that records a failure", (ir) => {
    (find(ir, "sleep") as { effects: unknown }).effects = {
      failures: ["error:effect/TimeoutError"],
      requirements: [],
    };
  }, [
    "validation/003 declarations[2].body.effects.failures: expected [], recorded [error:effect/TimeoutError]",
  ]],
];

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}

Deno.test("the validator rejects a forged TimeoutError construction", () => {
  const found = forged((ir) => {
    const e = find(ir, "timeout");
    (e as { job: unknown }).job = {
      ...e.durationMs,
      kind: "error",
      error: "error:effect/TimeoutError",
      fields: [],
    };
  });
  assert(
    found.some((m) =>
      m.includes(
        "reserved target errors cannot be constructed as source errors",
      )
    ),
    found.join("\n"),
  );
});
