// Outcome-aware cleanup (unit ES5): `try` with `finally`, `using` with an outcome
// binding, and `withResource` with a two-parameter release. Runtime behavior is in
// outcome_slow_test.ts.

import { assert, assertEquals } from "@std/assert";
import { Program, sourceHoverAt } from "../src/core/frontend.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import type { Expr, ModuleIR } from "../src/core/ir.ts";
import { parse } from "../src/core/parse.ts";
import { kindName, kindOf, SyntaxKind, walk } from "../src/core/syntax.ts";
import { validateModule } from "../src/core/validate/index.ts";

const HEAD = `type Int = int
export error Stop = { n: Int }
export service Log {
  note(n: Int): void
  next(): Int fails Stop
  check(): void fails Stop
}
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

// ------------------------------------------------------------------ parsing

function shape(text: string): { kinds: string[]; diagnostics: string[] } {
  const result = parse("t.eff", text, "eff");
  const kinds: string[] = [];
  walk(result.tree, result.tree.root, (node) => {
    const kind = kindOf(result.tree, node);
    if (
      [
        SyntaxKind.TryExpr,
        SyntaxKind.CatchClause,
        SyntaxKind.FinallyClause,
        SyntaxKind.ResourceRelease,
        SyntaxKind.Name,
        SyntaxKind.Missing,
      ].includes(kind)
    ) kinds.push(kindName(kind));
  });
  return {
    kinds,
    diagnostics: result.diagnostics.map((d) => `${d.code} ${d.message}`),
  };
}

Deno.test("try accepts finally alone, with and without an outcome binding", () => {
  const plain = shape("const a = try { 1 } finally { 2 }");
  assertEquals(plain.diagnostics, []);
  assertEquals(plain.kinds, ["Name", "TryExpr", "FinallyClause"]);
  const bound = shape("const a = try { 1 } finally (o) { 2 }");
  assertEquals(bound.diagnostics, []);
  assertEquals(bound.kinds, ["Name", "TryExpr", "FinallyClause", "Name"]);
});

Deno.test("try accepts catch then finally, across lines", () => {
  const result = shape(
    "const a = try { 1 }\n  catch { E(e) => 2 }\n  finally (o) { 3 }",
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.kinds.filter((k) => k.endsWith("Clause")), [
    "CatchClause",
    "FinallyClause",
  ]);
});

Deno.test("try without catch and finally is a syntax diagnostic", () => {
  const result = shape("const a = try { 1 }");
  assertEquals(result.diagnostics, [
    "syntax/008 expected `catch` or `finally`, found end of file",
  ]);
});

Deno.test("using accepts an outcome binding in its finally clause", () => {
  const plain = shape("const a = using (r = open()) { 1 } finally { 2 }");
  assertEquals(plain.diagnostics, []);
  assertEquals(plain.kinds.filter((k) => k === "Name").length, 2);
  const bound = shape("const a = using (r = open()) { 1 } finally (o) { 2 }");
  assertEquals(bound.diagnostics, []);
  assertEquals(bound.kinds.filter((k) => k === "Name").length, 3);
});

// ------------------------------------------------------------------ checking

Deno.test("the outcome binding has the structural union, with a Failure member for a remaining failure", () => {
  const text =
    `${HEAD}export const a = (): Int fails Stop uses Log.next | Log.note =>
  try { Log.next() } finally (out) { Log.note(1) }
`;
  const program = new Program().update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(program.ok);
  assertEquals(program.value.diagnostics, []);
  assertEquals(
    sourceHoverAt(program.value, "m.eff", text.indexOf("(out)") + 1)?.contract,
    '{ _tag: "Defect", message: string } | { _tag: "Failure", failure: Stop } | { _tag: "Interrupted" } | { _tag: "Success", success: Int }',
  );
});

Deno.test("the outcome has no Failure member when no failure remains, also after a catch", () => {
  const text = `${HEAD}export const a = (): Int uses Log.next | Log.note =>
  try { Log.next() } catch { Stop(e) => 0 } finally (out) { Log.note(1) }
export const b = (): Int uses Log.note => try { 1 } finally (done) { Log.note(1) }
`;
  const program = new Program().update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(program.ok);
  assertEquals(program.value.diagnostics, []);
  const noFailure =
    '{ _tag: "Defect", message: string } | { _tag: "Interrupted" } | { _tag: "Success", success: Int }';
  for (const name of ["(out)", "(done)"]) {
    assertEquals(
      sourceHoverAt(program.value, "m.eff", text.indexOf(name) + 1)?.contract,
      noFailure,
    );
  }
});

Deno.test("a using outcome binding has the union of the use block", () => {
  const text = `${HEAD}type Handle = { wait: () => Int }
export service Pool { open(): Handle }
export const a = (): Int fails Stop uses Pool.open | Log.note =>
  using (h = Pool.open()) { Log.next() } finally (z) { Log.note(1) }
`;
  const program = new Program().update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(program.ok);
  assertEquals(program.value.diagnostics.map((d) => d.code + " " + d.message), [
    "requirement-contract/001 the body requires Log.next, which the `uses` clause does not list",
  ]);
  assertEquals(
    sourceHoverAt(program.value, "m.eff", text.indexOf("(z)") + 1)?.contract,
    '{ _tag: "Defect", message: string } | { _tag: "Failure", failure: Stop } | { _tag: "Interrupted" } | { _tag: "Success", success: Int }',
  );
});

Deno.test("the finalizer failures and requirements join the result", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int =>
  try { 1 } finally { Log.check() }
`),
    [
      "failure-contract/001 the body can fail with Stop, which the `fails` clause does not list",
      "requirement-contract/001 the body requires Log.check, which the `uses` clause does not list",
    ],
  );
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int fails Stop uses Log.check =>
  try { 1 } finally { Log.check() }
`),
    [],
  );
});

Deno.test("the finalizer must return void", () => {
  assertEquals(
    diagnosticsOf(`${HEAD}export const a = (): Int uses Log.next =>
  try { 1 } finally (o) { 5 }
`),
    ["type-mismatch/003 the finally result has type int, but void is expected"],
  );
});

Deno.test("the outcome binding is visible only in the finally block", () => {
  const found = diagnosticsOf(
    `${HEAD}export const b = (n: Int): Int uses Log.note =>
  try { Log.note(1); out } finally (out) { Log.note(1) }
`,
  );
  assertEquals(found, ["unknown-name/001 unknown name `out`"]);
});

Deno.test("a protected result that is not data only cannot be bound, but may be left unbound", () => {
  const source = (binding: string) =>
    `${HEAD}type Fn = () => Int
export const a = (): Fn => try { () => 1 } finally ${binding}{ }
`;
  assertEquals(diagnosticsOf(source("")), []);
  assertEquals(diagnosticsOf(source("(o) ")), [
    "type-mismatch/010 the protected result must be data only when `finally` binds the outcome",
  ]);
});

Deno.test("a withResource release may take the outcome as a second parameter", () => {
  const text = `${HEAD}type Handle = { wait: () => Int }
export service Pool { open(): Handle }
export const a = (): Int uses Pool.open =>
  withResource(() => Pool.open(), (h) => h.wait(), (h, outcome) => { })
`;
  assertEquals(diagnosticsOf(text), []);
  assertEquals(
    diagnosticsOf(text.replace("(h, outcome)", "(h, outcome, extra)")),
    ["type-mismatch/004 the callback of `withResource` takes 1 parameter, but the function takes 3"],
  );
});

// ------------------------------------------------------------------ validator

const SOURCE = `${HEAD}type Handle = { wait: () => Int }
export service Pool { open(): Handle }
export const guarded = (): Int fails Stop uses Log.next | Log.note =>
  try { Log.next() } finally (out) { Log.note(1) }
export const plain = (): Int uses Log.note => try { 1 } finally { Log.note(1) }
export const resource = (): Int uses Pool.open =>
  withResource(() => Pool.open(), (h) => h.wait(), (h, outcome) => { })
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

function findAll<K extends Expr["kind"]>(
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
  assert(found.length > 0, kind);
  return found;
}

function forged(change: (ir: ModuleIR) => void): string[] {
  const ir = lowered();
  change(ir);
  return validateModule(ir, new Map([["m.eff", SOURCE]])).map((d) =>
    `${d.code} ${d.message}`
  );
}

const UNIT_TYPE = { kind: "primitive", name: "unit" };
const INT_TYPE = { kind: "primitive", name: "int" };

/** A mutable view of a forged node. */
function rec(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function params(closure: unknown): unknown[] {
  return rec(closure).parameters as unknown[];
}

function typeParams(closure: unknown): unknown[] {
  return rec(rec(closure).type).parameters as unknown[];
}

const FORGES: readonly (readonly [
  name: string,
  change: (ir: ModuleIR) => void,
  expected: readonly string[],
])[] = [
  ["an ensure finalizer with two parameters", (ir) => {
    const closure = findAll(ir, "ensure")[0].finalizer;
    params(closure).push({ ...rec(params(closure)[0]), id: "local:m#g/x" });
    typeParams(closure).push(typeParams(closure)[0]);
  }, [
    "validation/006 declarations[5].body.finalizer: an ensure finalizer is a closure with zero or one parameter",
  ]],
  ["an ensure outcome without the Failure member", (ir) => {
    const closure = findAll(ir, "ensure")[0].finalizer;
    const type = rec(typeParams(closure)[0]);
    type.members = (type.members as { fields: { type: { value: string } }[] }[])
      .filter((m) => m.fields[0].type.value !== "Failure");
    rec(params(closure)[0]).type = type;
  }, [
    'validation/002 declarations[5].body.finalizer.parameters[0]: the outcome has type { _tag: "Success", success: type:m#Int } | { _tag: "Failure", failure: error:m#Stop } | { _tag: "Defect", message: string } | { _tag: "Interrupted" }, recorded { _tag: "Defect", message: string } | { _tag: "Interrupted" } | { _tag: "Success", success: type:m#Int }',
  ]],
  ["an ensure finalizer with a non-unit result", (ir) => {
    const closure = findAll(ir, "ensure")[1].finalizer;
    rec(rec(closure).type).result = INT_TYPE;
    rec(closure.body).type = INT_TYPE;
  }, [
    "validation/002 declarations[6].body.finalizer.type.result: a finalizer must return void",
    "validation/002 declarations[6].body.finalizer.body.type: expected void, recorded int",
    "validation/002 declarations[6].body.finalizer.body: the body type void does not fit the closure result int",
  ]],
  ["an ensure that omits the finalizer failures", (ir) => {
    rec(findAll(ir, "ensure")[0]).effects = {
      failures: [],
      requirements: ["cap:m#Log.next", "cap:m#Log.note"],
    };
  }, [
    "validation/003 declarations[5].body.effects.failures: expected [error:m#Stop], recorded []",
  ]],
  ["a pure ensure", (ir) => {
    rec(findAll(ir, "ensure")[1]).execution = "pure";
  }, [
    "validation/004 declarations[6].body.execution: expected effect, recorded pure",
  ]],
  ["a release with an outcome of the wrong type", (ir) => {
    const release = findAll(ir, "with-resource")[0].release;
    rec(params(release)[1]).type = UNIT_TYPE;
    typeParams(release)[1] = UNIT_TYPE;
  }, [
    'validation/002 declarations[7].body.release.parameters[1]: the outcome has type { _tag: "Success", success: type:m#Int } | { _tag: "Defect", message: string } | { _tag: "Interrupted" }, recorded void',
  ]],
  ["a release with three parameters", (ir) => {
    const release = findAll(ir, "with-resource")[0].release;
    params(release).push({ ...rec(params(release)[1]), id: "local:m#r/x" });
    typeParams(release).push(typeParams(release)[1]);
  }, [
    "validation/006 declarations[7].body: with-resource callback arity or scoped identity is invalid",
  ]],
];

for (const [name, change, expected] of FORGES) {
  Deno.test(`the validator rejects ${name}`, () => {
    assertEquals(forged(change), expected);
  });
}
