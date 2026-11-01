// Proves that the validator checks the facts, the arms, and the patterns of
// `if`, `match`, and `fail` expressions. Each test lowers a valid module,
// forges the IR to break one condition, and requires the exact diagnostics.
// These tests kill the mutants of `ifExpr`, `matchExpr`, `pattern`, and `fail`
// in `src/core/validate/expr.ts`.

import { assert, assertEquals } from "@std/assert";
import type {
  Expr,
  FunctionDecl,
  ModuleIR,
  Pattern,
  Type,
} from "../src/core/ir.ts";
import { allExprs, forgedModule } from "./helpers.ts";

const SOURCE = `type Int = int
type Positive = int where n => n > 0
type Flag = boolean
type Text = string
type Num = number
error Boom = { code: Int }
error Bust = { reason: Text }
type Cell = { v: Int }
type Row = { w: Int }
type Table = Cell | Row
type Mixed = Boom | Positive
type Shape = { kind: "circle", r: Num } | { kind: "square", side: Num }
service Check {
  next(value: Int): Int
  ok(value: Int): Flag
}
const afterIf = (n: Int, flag: Flag): Positive => {
  const seen = Check.ok(n)
  if (n > 0) {} else { fail(Boom({ code: 1 })) }
  if (flag) { Positive(n) } else { Positive(n) }
}
const afterMatch = (n: Int, m: Int): Positive => {
  const seen = Check.next(n)
  if (n > 0) {} else { fail(Boom({ code: 1 })) }
  match (m) { 1 => Positive(n), _ => Positive(n) }
}
const thenFact = (n: Int): Positive =>
  if (n > 0) { Positive(n) } else { Positive(1) }
const elseFact = (n: Int): Positive =>
  if (n <= 0) { Positive(1) } else { Positive(n) }
const matchNever = (n: Int): Positive => {
  match (n) { 1 => {}, _ => fail(Boom({ code: 1 })) }
  Positive(n)
}
const vacuous = (n: Int): Positive =>
  match (5) { 6 => Positive(n), _ => Positive(1) }
const lone = (e: Boom): Int => match (e) { Boom(b) => b.code }
const pair = (e: Boom | Bust): Int =>
  match e { Boom(b) => b.code, Bust(x) => 0 }
const mixed = (e: Boom): Int => match (e) { Boom(b) => b.code }
const other = (e: Boom): Int => match (e) { Boom(b) => b.code }
const cells = (t: Table): Int => match (t) { Cell(c) => c.v, Row(r) => r.w }
const shaped = (s: Shape): Num =>
  match s { { kind: "circle", ...c } => c.r, { kind: "square" } => 4 }
const counted = (n: Int): Int => match (n) { 1 => 1, _ => 2 }
const failing = (p: Cell, flag: Flag): Cell =>
  if (flag) { p } else { fail(Boom({ code: 1 })) }
`;

const MIXED: Type = {
  kind: "union",
  members: [{ kind: "named", id: "error:m#Boom" }, {
    kind: "named",
    id: "type:m#Positive",
  }],
};

function functionOf(ir: ModuleIR, name: string): FunctionDecl {
  const found = ir.declarations.find((d) =>
    d.kind === "function" && d.name === name
  );
  assert(found?.kind === "function", name);
  return found;
}

/** The result expression of a function whose body is a block. */
function resultOf(ir: ModuleIR, name: string): Expr {
  const { body } = functionOf(ir, name);
  assert(body.kind === "block", name);
  return body.result;
}

/** The call to `Check.next` that the named function binds first. */
function effectCall(ir: ModuleIR, name: string): Expr {
  const { body } = functionOf(ir, name);
  assert(body.kind === "block", name);
  return structuredClone(body.steps[0].value);
}

/** Record `type` as the type of the first parameter of a function and of each reference to it. */
function retype(ir: ModuleIR, name: string, type: Type): void {
  const fn = functionOf(ir, name);
  const [parameter] = fn.parameters;
  Object.assign(parameter, { type });
  Object.assign(fn.type, { parameters: [type] });
  for (const ref of allExprs(ir, "reference")) {
    if (ref.target === parameter.id) Object.assign(ref, { type });
  }
}

function matchOf(ir: ModuleIR, name: string) {
  const { body } = functionOf(ir, name);
  const found = body.kind === "block" ? body.result : body;
  assert(found.kind === "match", name);
  return found;
}

function patternOf(ir: ModuleIR, name: string): Pattern {
  return matchOf(ir, name).arms[0].pattern;
}

Deno.test("a branch that keeps a fact, a match with a never arm, and the name patterns of one subject member are valid", () => {
  assertEquals(forgedModule(SOURCE, () => {}), []);
});

Deno.test("an effect in an if condition clears the facts that an earlier test proved", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const branch = resultOf(ir, "afterIf");
      assert(branch.kind === "if");
      const call = effectCall(ir, "afterIf");
      Object.assign(branch, {
        condition: call,
        execution: "effect",
        effects: call.effects,
      });
    }),
    [
      "validation/002 declarations[13].body.result.then.result.value.proofs: the proof certificate is invalid: invalid-certificate",
      "validation/002 declarations[13].body.result.else.result.value.proofs: the proof certificate is invalid: invalid-certificate",
    ],
  );
});

Deno.test("an effect in a match subject clears the facts that an earlier test proved", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const call = effectCall(ir, "afterMatch");
      Object.assign(matchOf(ir, "afterMatch"), {
        subject: call,
        execution: "effect",
        effects: call.effects,
      });
    }),
    [
      "validation/002 declarations[14].body.result.arms[0].body.value.proofs: the proof certificate is invalid: invalid-certificate",
      "validation/002 declarations[14].body.result.arms[1].body.value.proofs: the proof certificate is invalid: invalid-certificate",
    ],
  );
});

Deno.test("a duration arm adds the fact of its milliseconds", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const arm = matchOf(ir, "vacuous").arms[0];
      Object.assign(arm.pattern, { kind: "duration", millis: 6 });
      delete (arm.pattern as { value?: unknown }).value;
    }),
    [
      "validation/002 declarations[18].body.arms[0].pattern: the duration 6ms does not belong to the subject of type int",
    ],
  );
});

Deno.test("a name pattern over a subject with a data member rejects the name", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      retype(ir, "mixed", MIXED);
    }),
    [
      "validation/002 declarations[21].body.arms[0].pattern: the error error:m#Boom does not belong to the subject of type error:m#Boom | type:m#Positive",
    ],
  );
});

Deno.test("an error pattern with another error name is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(patternOf(ir, "other"), { error: "error:m#Bust" });
    }),
    [
      "validation/002 declarations[22].body.arms[0].pattern: the error error:m#Bust does not belong to the subject of type error:m#Boom",
    ],
  );
});

Deno.test("a tag pattern with no matching member is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      Object.assign(patternOf(ir, "shaped"), { value: "triangle" });
    }),
    [
      'validation/002 declarations[24].body.arms[0].pattern: the tag kind: "triangle" does not belong to the subject of type type:m#Shape',
    ],
  );
});

Deno.test("a fail of a named value that is not an error is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const inFailing = { ...ir, declarations: [functionOf(ir, "failing")] };
      const [fail] = allExprs(inFailing, "fail");
      const [reference] = allExprs(inFailing, "reference").filter((r) =>
        r.type.kind === "named" && r.type.id === "type:m#Cell"
      );
      Object.assign(fail, { error: structuredClone(reference) });
    }),
    [
      "validation/003 declarations[26].type.effects.failures: an inferred contract equals the body: expected [], recorded [error:m#Boom]",
      "validation/003 declarations[26].body.effects.failures: expected [], recorded [error:m#Boom]",
      "validation/002 declarations[26].body.else.result.error: fail needs a value of a named error type, but the value has type type:m#Cell",
      "validation/003 declarations[26].body.else.effects.failures: expected [], recorded [error:m#Boom]",
      "validation/003 declarations[26].body.else.result.effects.failures: expected [], recorded [error:m#Boom]",
    ],
  );
});
