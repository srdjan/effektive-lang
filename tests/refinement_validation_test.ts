import { assert, assertEquals } from "@std/assert";
import type { Expr, ModuleIR, TypeDecl } from "../src/core/ir.ts";
import { checkProject, lowerProject, memoryHost } from "../src/core/mod.ts";
import {
  and,
  entails,
  type Predicate,
  type Term,
} from "../src/core/predicates.ts";
import { exprChildren } from "../src/core/validate/expr.ts";
import { validateModule } from "../src/core/validate/index.ts";

function lower(
  text: string,
): { readonly ir: ModuleIR; readonly sources: ReadonlyMap<string, string> } {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics, []);
  const result = lowerProject(checked.value).get("m");
  assert(result?.ok, JSON.stringify(result));
  return { ir: result.value, sources: new Map([["m.eff", text]]) };
}

function expressions(expression: Expr): readonly Expr[] {
  return [expression, ...exprChildren(expression).flatMap(expressions)];
}

function proofExpression(ir: ModuleIR): Expr {
  for (const declaration of ir.declarations) {
    if (declaration.kind !== "function" && declaration.kind !== "constant") {
      continue;
    }
    const root = declaration.kind === "function"
      ? declaration.body
      : declaration.value;
    const found = expressions(root).find((expression) =>
      (expression.proofs?.length ?? 0) > 0
    );
    if (found !== undefined) return found;
  }
  throw new Error("no proof expression");
}

function messages(
  ir: ModuleIR,
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  return validateModule(ir, sources).map((diagnostic) => diagnostic.message);
}

Deno.test("independent validation reconstructs refinement proofs from public IR", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
type PositiveAlias = Positive
type Window = { low: int, high: int } where w => w.high - w.low >= 1
type Text = string
type ValidLength = string where s => len(s) >= 0 && len(s) <= 9007199254740991
type Box = { amount: Positive }
type Bool = boolean
const take = (p: Positive): Bool => true
const bump = (p: Positive): Positive => p + 1
const throughAlias = (): PositiveAlias => 1
const parenthesized = (): Positive => Positive((1))
const alias = (p: Positive): Positive => { const q = p + 1; q - 1 }
const guarded = (p: Positive): Positive => if (p > 1) { p - 1 } else { 1 }
const short = (p: Positive): Bool => (p > 1) && take(Positive(p - 1))
const matched = (p: Positive): Positive => match (p) { 2 => p - 1, _ => 1 }
const made = (): Window => ({ low: 1, high: 2 })
const moved = (w: Window): Window => ({ ...w, high: w.high + 1 })
const nested = (box: Box): Positive => box.amount + 1
const length = (text: Text): ValidLength => ValidLength(text)
`);
  assertEquals(
    validateModule(JSON.parse(JSON.stringify(lowered.ir)), lowered.sources),
    [],
  );
});

Deno.test("pipeline captures establish refinements before their stages", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
const take = (value: Positive): Positive => value
const constructed = (): Positive => 1 |> Positive
const passed = (): Positive => 1 |> take
const same = (value: Positive): Positive => Positive(value)
type Int = int
type Valid = int where n => true
const pass = (value: Int) => 1
const takeValid = (value: Valid): Valid => value
const chained = (): Valid => 1 |> pass |> takeValid
const result = (): Valid => 1 |> pass
const choose = (first: Positive, second: Positive): Positive => second
const argumentProof = (value: Positive): Positive => value |> choose(Positive(value + 1))
type Box = { value: Positive }
const destructured = (box: Box): Positive => { const { value } = box; value + 1 }
const sourceName = (): Positive => { const $p0: Positive = 1; $p0 + 1 }
`);
  assertEquals(
    validateModule(JSON.parse(JSON.stringify(lowered.ir)), lowered.sources),
    [],
  );
});

Deno.test("implicit tagged records carry their construction proof", () => {
  const lowered = lower(`
type Row = { value: int } where row => row.value > 0
error Stop = {}
type Domain = Row | Stop
const made = (): Row => ({ value: 1 })
`);
  assertEquals(
    validateModule(JSON.parse(JSON.stringify(lowered.ir)), lowered.sources),
    [],
  );
});

Deno.test("raw record variables cannot bypass a refined tag constructor", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": `
type Row = { value: int } where row => row.value > 0
error Stop = {}
type Domain = Row | Stop
const bad = (): Row => { const raw = { value: 1 }; raw }
`,
    }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics.map((d) => d.code), [
    "type-mismatch/003",
  ]);
});

Deno.test("independent validation rejects missing, forged, and mutated certificates", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
const value = (): Positive => Positive(1)
`);

  const missing = structuredClone(lowered.ir);
  Object.assign(proofExpression(missing), { proofs: [] });
  assert(
    messages(missing, lowered.sources).some((message) =>
      message.includes("needs one proof")
    ),
    JSON.stringify(messages(missing, lowered.sources)),
  );

  const shared = structuredClone(lowered.ir);
  const sharedDeclaration = shared.declarations.find((d) =>
    d.kind === "function"
  );
  assert(sharedDeclaration?.kind === "function");
  Object.assign(sharedDeclaration.body, {
    proofs: proofExpression(shared).proofs,
  });
  assert(
    messages(shared, lowered.sources).some((message) =>
      message.includes("no supported obligation")
    ),
  );

  const mutated = structuredClone(lowered.ir);
  const changed = proofExpression(mutated).proofs?.[0];
  assert(changed !== undefined);
  Object.assign(changed.certificate, { claim: "disproved" });
  assert(
    messages(mutated, lowered.sources).some((message) =>
      message.includes("does not prove its claim")
    ),
    JSON.stringify(messages(mutated, lowered.sources)),
  );

  const forged = structuredClone(lowered.ir);
  const expression = proofExpression(forged);
  const proof = expression.proofs?.[0];
  assert(proof !== undefined);
  Object.assign(expression, {
    proofs: [
      ...(expression.proofs ?? []),
      { ...proof, target: "type:m#Missing" },
    ],
  });
  assert(
    messages(forged, lowered.sources).some((message) =>
      message.includes("no supported obligation")
    ),
  );

  const changedGoal = structuredClone(lowered.ir);
  const changedExpression = proofExpression(changedGoal);
  assert(changedExpression.kind === "literal");
  Object.assign(changedExpression, {
    value: 0,
    type: { kind: "literal", value: 0 },
  });
  assert(
    messages(changedGoal, lowered.sources).some((message) =>
      message.includes("certificate is invalid")
    ),
    JSON.stringify(messages(changedGoal, lowered.sources)),
  );

  const arithmetic = lower(`
type Positive = int where n => n > 0
const bump = (p: Positive): Positive => p + 1
`);
  const unsupported = structuredClone(arithmetic.ir);
  const unsupportedExpression = proofExpression(unsupported);
  assert(unsupportedExpression.kind === "binary");
  Object.assign(unsupportedExpression, { operator: "*" });
  assert(
    messages(unsupported, arithmetic.sources).some((message) =>
      message.includes("unsupported expression")
    ),
    JSON.stringify(messages(unsupported, arithmetic.sources)),
  );
});

Deno.test("a refined binding cannot justify its own initializer", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
const value = (): Positive => { const local: Positive = 1; local }
`);
  const declaration = lowered.ir.declarations.find((d) =>
    d.kind === "function"
  );
  assert(declaration?.kind === "function" && declaration.body.kind === "block");
  const step = declaration.body.steps[0];
  assert(step?.kind === "bind" && step.value.kind === "literal");
  const local: Term = { kind: "field", path: [step.binding.id] };
  const zero: Term = { kind: "zero" };
  const constraint = (left: Term, right: Term, maximum: string): Predicate => ({
    kind: "difference",
    left,
    right,
    maximum,
  });
  const forged = entails(
    and(
      constraint(zero, local, "-1"),
      constraint(local, zero, "0"),
      constraint(zero, local, "0"),
    ),
    constraint(zero, zero, "-1"),
    { maxSteps: 8192 },
  );
  assert(forged.ok && forged.value.status === "proved");
  Object.assign(step.value, {
    value: 0,
    type: { kind: "literal", value: 0 },
    proofs: [{
      target: "type:m#Positive",
      certificate: forged.value.certificate,
    }],
  });
  assert(
    messages(lowered.ir, lowered.sources).some((message) =>
      message.includes("certificate is invalid")
    ),
  );
});

Deno.test("independent validation rejects malformed predicate declarations", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
const value = (): Positive => Positive(1)
`);
  const ir = structuredClone(lowered.ir);
  const declaration = ir.declarations.find((item): item is TypeDecl =>
    item.kind === "type"
  );
  assert(declaration !== undefined);
  Object.assign(declaration, {
    predicate: {
      kind: "difference",
      left: { kind: "field", path: ["missing"] },
      right: { kind: "zero" },
      maximum: "0",
    },
  });
  assert(
    messages(ir, lowered.sources).some((message) =>
      message.includes("predicate path")
    ),
    JSON.stringify(messages(ir, lowered.sources)),
  );

  const transparent = structuredClone(lowered.ir);
  const transparentDeclaration = transparent.declarations.find((
    item,
  ): item is TypeDecl => item.kind === "type");
  assert(transparentDeclaration !== undefined);
  Object.assign(transparentDeclaration, {
    definition: {
      kind: "alias",
      type: { kind: "primitive", name: "int" },
    },
  });
  assert(
    messages(transparent, lowered.sources).some((message) =>
      message.includes("non-opaque type with identity")
    ),
  );

  const opaque = structuredClone(lowered.ir);
  const opaqueDeclaration = opaque.declarations.find((item): item is TypeDecl =>
    item.kind === "type"
  );
  assert(opaqueDeclaration !== undefined);
  Object.assign(opaqueDeclaration, { opaque: true });
  assert(
    messages(opaque, lowered.sources).some((message) =>
      message.includes("non-opaque type with identity")
    ),
  );
});

// A trusted source contract is necessary because coordinated erasure leaves valid plain IR.
Deno.test("independent validation cannot detect consistent refinement contract erasure", () => {
  const lowered = lower(`
type Positive = int where n => n > 0
const value = (): Positive => Positive(1)
`);
  const ir = structuredClone(lowered.ir);
  const declaration = ir.declarations.find((item): item is TypeDecl =>
    item.kind === "type"
  );
  assert(declaration !== undefined);
  Object.assign(declaration, { predicate: undefined });
  Object.assign(proofExpression(ir), { proofs: [] });
  assertEquals(validateModule(ir, lowered.sources), []);
});

Deno.test("independent validation rejects refined host declarations", () => {
  const lowered = lower("type Positive = int where n => n > 0");
  const ir = structuredClone(lowered.ir);
  const declaration = ir.declarations.find((item) => item.kind === "type");
  assert(declaration !== undefined && declaration.kind === "type");
  Object.assign(declaration, {
    span: { ...declaration.span, source: "host.effi" },
  });
  const sources = new Map([...lowered.sources, [
    "host.effi",
    "type Positive = int where n => n > 0",
  ]]);
  assert(
    messages(ir, sources).some((message) =>
      message.includes("host interfaces must expose unrefined data")
    ),
  );
});

// RBF12: the checker keeps a raw `or` fact and compares join facts by JSON text,
// so it drops a commuted `or` fact at a join. The validator accepts the same proof.
Deno.test("RBF12: the checker drops a commuted or-fact at a join and the validator keeps it", () => {
  const program = (first: string, second: string) => `
type Int = int
type Bool = boolean
type Either = { a: Int, b: Int } where r => r.a > 0 || r.b > 0
error Stop = {}
const make = (a: Int, b: Int, p: Bool): Either => {
  if (p) { if (${first}) { 1 } else { fail(Stop({})) } } else { if (${second}) { 1 } else { fail(Stop({})) } }
  ({ a: a, b: b })
}
`;
  const same = program("a > 0 || b > 0", "a > 0 || b > 0");
  const control = lower(same);
  assertEquals(validateModule(control.ir, control.sources), []);

  const reversed = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": program("a > 0 || b > 0", "b > 0 || a > 0"),
    }),
    "",
    ["m.eff"],
  );
  assert(reversed.ok);
  assertEquals(reversed.value.diagnostics.map((d) => d.code), [
    "type-mismatch/013",
  ]);

  // The checker rejected the reversed source, so lowering fails. The validator
  // runs on the control IR with the second condition commuted by hand.
  const commuted = structuredClone(control.ir);
  const make = commuted.declarations.find((d) => d.kind === "function");
  assert(make?.kind === "function");
  const [, second] = expressions(make.body).filter((e) =>
    e.kind === "binary" && e.operator === "||"
  );
  assert(second?.kind === "binary");
  const swap = { left: second.right, right: second.left };
  Object.assign(second, swap);
  assertEquals(messages(commuted, control.sources), []);

  // A different second condition must still fail, so the validator proof is not vacuous.
  const weaker = structuredClone(control.ir);
  const weakerMake = weaker.declarations.find((d) => d.kind === "function");
  assert(weakerMake?.kind === "function");
  const [, other] = expressions(weakerMake.body).filter((e) =>
    e.kind === "binary" && e.operator === "||"
  );
  assert(other?.kind === "binary" && other.right.kind === "binary");
  Object.assign(other.right, { operator: "<" });
  assert(messages(weaker, control.sources).length > 0);
});
