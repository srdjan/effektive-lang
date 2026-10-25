import { assert, assertEquals } from "@std/assert";
import {
  and,
  comparison,
  constant,
  entails,
  normalizeInteger,
  or,
  type Predicate,
  type ProofCertificate,
  type Term,
} from "../src/core/predicates.ts";
import { verifyCertificate } from "../src/core/validate/predicates.ts";

const ZERO: Term = { kind: "zero" };
const INPUT: Term = { kind: "input" };
const FIELD: Term = { kind: "field", path: ["count"] };
const LIMITS = { maxSteps: 10_000 };

function compare(
  left: Term,
  leftOffset: string,
  operator: Parameters<typeof comparison>[2],
  right: Term,
  rightOffset: string,
): Predicate {
  const result = comparison(
    left,
    leftOffset,
    operator,
    right,
    rightOffset,
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function certificateOf(
  assumptions: Predicate,
  predicate: Predicate,
): ProofCertificate {
  const result = entails(assumptions, predicate, LIMITS);
  assert(result.ok, JSON.stringify(result));
  assert(
    result.value.status === "proved" || result.value.status === "disproved",
    JSON.stringify(result.value),
  );
  const checked = verifyCertificate(
    assumptions,
    predicate,
    result.value.certificate,
    LIMITS,
  );
  assert(checked.ok, JSON.stringify(checked));
  return result.value.certificate;
}

Deno.test("comparison normalizes integers beyond the safe number range", () => {
  assertEquals(normalizeInteger("+00090071992547409931234567890"), {
    ok: true,
    value: "90071992547409931234567890",
  });
  const predicate = compare(
    INPUT,
    "90071992547409931234567890",
    "<",
    FIELD,
    "90071992547409931234567900",
  );
  assertEquals(predicate, {
    kind: "difference",
    left: INPUT,
    right: FIELD,
    maximum: "9",
  });
  assertEquals(
    comparison(INPUT, "1.5", "<=", ZERO, "0"),
    { ok: false, error: { tag: "invalid-integer", value: "1.5" } },
  );
});

Deno.test("conjunction entailment produces an independently valid cycle", () => {
  const assumptions = and(
    compare(INPUT, "0", ">=", ZERO, "1"),
    compare(INPUT, "0", "<=", ZERO, "2"),
  );
  const predicate = and(
    compare(INPUT, "0", ">", ZERO, "0"),
    compare(INPUT, "0", "<", ZERO, "3"),
  );
  const result = entails(assumptions, predicate, LIMITS);
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.status, "proved");
  assert(result.value.status === "proved");
  assertEquals(result.value.certificate.claim, "proved");
  assert(
    verifyCertificate(
      assumptions,
      predicate,
      result.value.certificate,
      LIMITS,
    ).ok,
  );
});

Deno.test("disjunction entailment records every Boolean split", () => {
  const assumptions = or(
    compare(INPUT, "0", "<=", ZERO, "-1"),
    compare(INPUT, "0", ">=", ZERO, "1"),
  );
  const predicate = compare(INPUT, "0", "!==", ZERO, "0");
  const certificate = certificateOf(assumptions, predicate);
  assertEquals(certificate.claim, "proved");
  assertEquals(certificate.proof.kind, "split");
  if (certificate.proof.kind === "split") {
    assertEquals(certificate.proof.cases.length, 2);
  }
});

Deno.test("the solver disproves a contradictory predicate", () => {
  const assumptions = compare(INPUT, "0", "===", ZERO, "0");
  const predicate = compare(INPUT, "0", ">", ZERO, "0");
  const result = entails(assumptions, predicate, LIMITS);
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.status, "disproved");
  assert(result.value.status === "disproved");
  assertEquals(result.value.certificate.claim, "disproved");
  assert(
    verifyCertificate(
      assumptions,
      predicate,
      result.value.certificate,
      LIMITS,
    ).ok,
  );
});

Deno.test("the independent checker rejects a mutated cycle", () => {
  const assumptions = compare(INPUT, "0", ">=", ZERO, "1");
  const predicate = compare(INPUT, "0", "<=", ZERO, "0");
  const certificate = certificateOf(assumptions, predicate);
  assertEquals(certificate.proof.kind, "negative-cycle");
  const mutated = structuredClone(certificate) as {
    claim: "proved" | "disproved";
    proof: { kind: "negative-cycle"; constraints: number[] };
  };
  mutated.proof.constraints[0] = 999;
  const checked = verifyCertificate(
    assumptions,
    predicate,
    mutated,
    LIMITS,
  );
  assert(!checked.ok);
  assertEquals(checked.error.tag, "invalid-certificate");
});

Deno.test("work exhaustion returns unknown and bounds certificate checking", () => {
  const predicate = compare(INPUT, "0", ">", ZERO, "0");
  assertEquals(entails(constant(true), predicate, { maxSteps: 0 }), {
    ok: true,
    value: { status: "unknown", stepsUsed: 0, reason: "exhausted" },
  });
  const certificate = certificateOf(
    compare(INPUT, "0", ">=", ZERO, "1"),
    predicate,
  );
  assertEquals(
    verifyCertificate(constant(true), predicate, certificate, { maxSteps: 0 }),
    { ok: false, error: { tag: "limit" } },
  );
});

Deno.test("an open comparison stays unknown", () => {
  const result = entails(
    constant(true),
    compare(INPUT, "0", ">", ZERO, "0"),
    LIMITS,
  );
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.status, "unknown");
  assert(result.value.status === "unknown");
  assertEquals(result.value.reason, "open");
  assert(result.value.stepsUsed > 0);
});
