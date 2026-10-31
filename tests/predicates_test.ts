import { assert, assertEquals } from "@std/assert";
import {
  and,
  comparison,
  constant,
  entails,
  normalizeInteger,
  not,
  or,
  type Predicate,
  type ProofCertificate,
  type SolverLimits,
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

/** Builds a value that the type system forbids, to test boundary rejection. */
function forged<T>(value: unknown): T {
  return value as T;
}

/** Compares a result with a literal that may differ in static type. */
function same(actual: unknown, expected: unknown, message?: string): void {
  assertEquals(actual, expected, message);
}

function verify(
  assumptions: unknown,
  predicate: unknown,
  certificate: unknown,
  limits: unknown = LIMITS,
) {
  return verifyCertificate(
    forged<Predicate>(assumptions),
    forged<Predicate>(predicate),
    forged<ProofCertificate>(certificate),
    forged<SolverLimits>(limits),
  );
}

const TRUE = { kind: "constant", value: true };
const FALSE_PROOF = { kind: "false" };
const NEGATIVE_CYCLE = { kind: "negative-cycle", constraints: [0, 1] };
const INPUT_BELOW_ZERO = {
  kind: "difference",
  left: { kind: "input" },
  right: { kind: "zero" },
  maximum: "0",
};
const ZERO_BELOW_INPUT_BY_ONE = {
  kind: "difference",
  left: { kind: "zero" },
  right: { kind: "input" },
  maximum: "-1",
};

function differenceOf(
  left: unknown,
  right: unknown,
  maximum: unknown,
): unknown {
  return { kind: "difference", left, right, maximum };
}

interface BadTerm {
  readonly name: string;
  readonly term: unknown;
  readonly solver: string;
  readonly checker: string;
}

const NOT_OBJECT = "a term is not an object";
const UNKNOWN_KIND = "a term has an unknown kind";
const PATH_MESSAGE = "a term path is not a string list";
const EMPTY_PATH = "a field term has an empty path";
const UNIT_MESSAGE = "a length term does not use UTF-16 units";

const BAD_TERMS: readonly BadTerm[] = [
  { name: "a number", term: 7, solver: NOT_OBJECT, checker: NOT_OBJECT },
  { name: "null", term: null, solver: NOT_OBJECT, checker: NOT_OBJECT },
  {
    name: "an array",
    term: [],
    solver: UNKNOWN_KIND,
    checker: NOT_OBJECT,
  },
  {
    name: "a numeric kind",
    term: { kind: 5 },
    solver: UNKNOWN_KIND,
    checker: NOT_OBJECT,
  },
  {
    name: "an unknown kind",
    term: { kind: "bogus" },
    solver: UNKNOWN_KIND,
    checker: UNKNOWN_KIND,
  },
  {
    name: "a field path that is a string",
    term: { kind: "field", path: "count" },
    solver: PATH_MESSAGE,
    checker: PATH_MESSAGE,
  },
  {
    name: "a field without a path",
    term: { kind: "field" },
    solver: PATH_MESSAGE,
    checker: PATH_MESSAGE,
  },
  {
    name: "a field path with a number part",
    term: { kind: "field", path: ["count", 1] },
    solver: PATH_MESSAGE,
    checker: PATH_MESSAGE,
  },
  {
    name: "a length path that is an object",
    term: { kind: "length", path: { 0: "a" }, unit: "utf16" },
    solver: PATH_MESSAGE,
    checker: PATH_MESSAGE,
  },
  {
    name: "a length path with a null part",
    term: { kind: "length", path: [null], unit: "utf16" },
    solver: PATH_MESSAGE,
    checker: PATH_MESSAGE,
  },
  {
    name: "a field with an empty path",
    term: { kind: "field", path: [] },
    solver: EMPTY_PATH,
    checker: EMPTY_PATH,
  },
  {
    name: "a length in UTF-8 units",
    term: { kind: "length", path: ["name"], unit: "utf8" },
    solver: UNIT_MESSAGE,
    checker: UNIT_MESSAGE,
  },
];

Deno.test("comparison rejects a forged term or offset with its exact error", () => {
  for (const row of BAD_TERMS) {
    const expected = {
      ok: false,
      error: { tag: "invalid-term", message: row.solver },
    };
    same(
      comparison(forged<Term>(row.term), "0", "<", ZERO, "0"),
      expected,
      `${row.name} as the left term`,
    );
    same(
      comparison(ZERO, "0", "<", forged<Term>(row.term), "0"),
      expected,
      `${row.name} as the right term`,
    );
  }
  same(
    comparison(ZERO, "0", "<", INPUT, "x"),
    { ok: false, error: { tag: "invalid-integer", value: "x" } },
  );
  same(
    comparison(ZERO, "", "<", INPUT, "0"),
    { ok: false, error: { tag: "invalid-integer", value: "" } },
  );
});

Deno.test("normalizeInteger rejects text that is not a decimal integer", () => {
  same(normalizeInteger("-0"), { ok: true, value: "0" });
  same(normalizeInteger("12a"), {
    ok: false,
    error: { tag: "invalid-integer", value: "12a" },
  });
  same(normalizeInteger("+"), {
    ok: false,
    error: { tag: "invalid-integer", value: "+" },
  });
});

Deno.test("comparison yields the exact predicate for every operator", () => {
  const forward = (maximum: string) => ({
    kind: "difference",
    left: INPUT,
    right: FIELD,
    maximum,
  });
  const reverse = (maximum: string) => ({
    kind: "difference",
    left: FIELD,
    right: INPUT,
    maximum,
  });
  const rows: readonly [Parameters<typeof comparison>[2], unknown][] = [
    ["<", forward("-1")],
    ["<=", forward("0")],
    ["==", { kind: "and", operands: [forward("0"), reverse("0")] }],
    ["===", { kind: "and", operands: [forward("0"), reverse("0")] }],
    ["!=", { kind: "or", operands: [forward("-1"), reverse("-1")] }],
    ["!==", { kind: "or", operands: [forward("-1"), reverse("-1")] }],
    [">=", reverse("0")],
    [">", reverse("-1")],
  ];
  for (const [operator, expected] of rows) {
    same(
      comparison(INPUT, "0", operator, FIELD, "0"),
      { ok: true, value: expected as Predicate },
      operator,
    );
  }
});

Deno.test("Boolean constructors fold constants and flatten nesting", () => {
  const open = compare(INPUT, "0", ">", ZERO, "0");
  const other = compare(FIELD, "0", ">", ZERO, "0");
  same(and(), constant(true));
  same(or(), constant(false));
  same(and(constant(true), open), open);
  same(and(open, constant(false), other), constant(false));
  same(or(open, constant(true), other), constant(true));
  same(or(constant(false), open), open);
  same(and(and(open, other), open), {
    kind: "and",
    operands: [open, other, open],
  });
  same(or(or(open, other), open), {
    kind: "or",
    operands: [open, other, open],
  });
  same(not(constant(true)), constant(false));
  same(not(open), { kind: "not", operand: open });
  same(not(not(open)), open);
});

Deno.test("entails rejects a bad step limit with its exact error", () => {
  const error = {
    ok: false,
    error: {
      tag: "invalid-limit",
      message: "maxSteps must be a nonnegative safe integer",
    },
  };
  const predicate = constant(true);
  for (const maxSteps of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    same(
      entails(predicate, predicate, { maxSteps }),
      error,
      String(maxSteps),
    );
  }
  same(entails(constant(true), constant(true), { maxSteps: 0 }), {
    ok: true,
    value: { status: "unknown", stepsUsed: 0, reason: "exhausted" },
  });
});

Deno.test("verifyCertificate rejects a bad step limit with its exact error", () => {
  const error = {
    ok: false,
    error: {
      tag: "invalid-limit",
      message: "maxSteps must be a nonnegative safe integer",
    },
  };
  const rows: readonly [string, unknown][] = [
    ["a negative safe integer", -1],
    ["a non-integer", 1.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a string", "3"],
    ["a missing number", undefined],
  ];
  for (const [name, maxSteps] of rows) {
    same(
      verify(TRUE, TRUE, { claim: "proved", proof: FALSE_PROOF }, {
        maxSteps,
      }),
      error,
      name,
    );
  }
  same(
    verify(TRUE, TRUE, { claim: "proved", proof: FALSE_PROOF }, {
      maxSteps: 1,
    }),
    { ok: true, value: { stepsUsed: 1 } },
  );
});

Deno.test("entails rejects a forged predicate with its exact error", () => {
  const open = compare(INPUT, "0", ">", ZERO, "0");
  const invalid = (message: string) => ({
    ok: false,
    error: { tag: "invalid-predicate", message },
  });
  const rows: readonly [string, unknown, unknown, unknown][] = [
    ["a number", TRUE, 5, invalid("a predicate is not an object")],
    ["null", TRUE, null, invalid("a predicate is not an object")],
    [
      "an object without a kind",
      TRUE,
      {},
      invalid("a predicate is not an object"),
    ],
    [
      "a constant with a string value",
      TRUE,
      { kind: "constant", value: "yes" },
      invalid("a constant does not contain a boolean"),
    ],
    [
      "a not without an operand",
      TRUE,
      { kind: "not" },
      invalid("a not node has no predicate operand"),
    ],
    [
      "a not with a null operand",
      TRUE,
      { kind: "not", operand: null },
      invalid("a not node has no predicate operand"),
    ],
    [
      "an and without operands",
      TRUE,
      { kind: "and" },
      invalid("a Boolean node has no operand list"),
    ],
    [
      "an or with a string operand list",
      TRUE,
      { kind: "or", operands: "xy" },
      invalid("a Boolean node has no operand list"),
    ],
    [
      "an unknown kind",
      TRUE,
      { kind: "bogus" },
      invalid("a predicate has an unknown kind"),
    ],
    [
      "a forged assumption",
      { kind: "bogus" },
      open,
      invalid("a predicate has an unknown kind"),
    ],
    [
      "a forged operand met only by the disproof",
      TRUE,
      { kind: "and", operands: [open, 5] },
      invalid("a predicate is not an object"),
    ],
    [
      "a difference maximum that is a number",
      TRUE,
      differenceOf({ kind: "input" }, { kind: "zero" }, 5),
      { ok: false, error: { tag: "invalid-integer", value: "5" } },
    ],
    [
      "a difference maximum that is not an integer",
      TRUE,
      differenceOf({ kind: "input" }, { kind: "zero" }, "abc"),
      { ok: false, error: { tag: "invalid-integer", value: "abc" } },
    ],
    [
      "a difference maximum with a plus sign",
      TRUE,
      differenceOf({ kind: "input" }, { kind: "zero" }, "+5"),
      invalid("a difference maximum is not a normalized integer"),
    ],
    [
      "a difference maximum with a leading zero",
      TRUE,
      differenceOf({ kind: "input" }, { kind: "zero" }, "05"),
      invalid("a difference maximum is not a normalized integer"),
    ],
  ];
  for (const [name, assumptions, predicate, expected] of rows) {
    same(
      entails(
        forged<Predicate>(assumptions),
        forged<Predicate>(predicate),
        LIMITS,
      ),
      expected,
      name,
    );
  }
});

Deno.test("entails rejects a forged difference term with its exact error", () => {
  for (const row of BAD_TERMS) {
    const expected = {
      ok: false,
      error: { tag: "invalid-term", message: row.solver },
    };
    same(
      entails(
        constant(true),
        forged<Predicate>(differenceOf(row.term, { kind: "zero" }, "0")),
        LIMITS,
      ),
      expected,
      `${row.name} as the left term`,
    );
    same(
      entails(
        constant(true),
        forged<Predicate>(differenceOf({ kind: "zero" }, row.term, "0")),
        LIMITS,
      ),
      expected,
      `${row.name} as the right term`,
    );
  }
});

Deno.test("entails accepts a length term and a zero-operand node", () => {
  const length: Term = { kind: "length", path: ["name"], unit: "utf16" };
  const atMostFive = compare(length, "0", "<=", ZERO, "5");
  const atMostSix = compare(length, "0", "<=", ZERO, "6");
  same(entails(atMostFive, atMostSix, LIMITS), {
    ok: true,
    value: {
      status: "proved",
      stepsUsed: 10,
      certificate: {
        claim: "proved",
        proof: { kind: "negative-cycle", constraints: [1, 0] },
      },
    },
  });
  same(
    entails(constant(true), { kind: "and", operands: [] }, LIMITS),
    {
      ok: true,
      value: {
        status: "proved",
        stepsUsed: 1,
        certificate: { claim: "proved", proof: { kind: "false" } },
      },
    },
  );
  same(
    entails(constant(true), { kind: "or", operands: [] }, LIMITS),
    {
      ok: true,
      value: {
        status: "disproved",
        stepsUsed: 3,
        certificate: { claim: "disproved", proof: { kind: "false" } },
      },
    },
  );
  same(entails(constant(true), constant(false), LIMITS), {
    ok: true,
    value: {
      status: "disproved",
      stepsUsed: 3,
      certificate: { claim: "disproved", proof: { kind: "false" } },
    },
  });
});

Deno.test("entails reports exhausted at every spend site", () => {
  const open = compare(INPUT, "0", ">", ZERO, "0");
  const exhausted = (stepsUsed: number) => ({
    ok: true,
    value: { status: "unknown", stepsUsed, reason: "exhausted" },
  });
  const many = and(
    compare(INPUT, "0", ">=", ZERO, "1"),
    compare(INPUT, "0", "<=", ZERO, "2"),
    compare(FIELD, "0", ">=", ZERO, "0"),
  );
  same(entails(many, open, { maxSteps: 3 }), exhausted(3));
  const split = and(open, compare(FIELD, "0", ">", ZERO, "0"));
  same(entails(constant(true), split, { maxSteps: 2 }), exhausted(2));
  const assumptions = compare(INPUT, "0", ">=", ZERO, "1");
  const predicate = compare(INPUT, "0", "<=", ZERO, "0");
  for (const maxSteps of [4, 8, 12, 14, 15]) {
    same(
      entails(assumptions, predicate, { maxSteps }),
      exhausted(maxSteps),
      `maxSteps ${maxSteps}`,
    );
  }
  same(entails(assumptions, predicate, { maxSteps: 16 }), {
    ok: true,
    value: {
      status: "disproved",
      stepsUsed: 16,
      certificate: {
        claim: "disproved",
        proof: { kind: "negative-cycle", constraints: [1, 0] },
      },
    },
  });
});

Deno.test("verifyCertificate rejects a forged certificate shape", () => {
  const shape = {
    ok: false,
    error: {
      tag: "invalid-certificate",
      message: "the certificate shape is invalid",
    },
  };
  const rows: readonly [string, unknown][] = [
    ["null", null],
    ["an array", []],
    ["a number", 3],
    ["an unknown claim", { claim: "maybe", proof: FALSE_PROOF }],
    ["a missing claim", { proof: FALSE_PROOF }],
    ["a missing proof", { claim: "proved" }],
    ["a null proof", { claim: "proved", proof: null }],
    ["an unknown proof kind", { claim: "proved", proof: { kind: "bogus" } }],
  ];
  for (const [name, certificate] of rows) {
    same(verify(TRUE, TRUE, certificate), shape, name);
  }
});

Deno.test("verifyCertificate rejects a forged predicate with its exact error", () => {
  const invalid = (message: string) => ({
    ok: false,
    error: { tag: "invalid-predicate", message },
  });
  const certificateError = (message: string) => ({
    ok: false,
    error: { tag: "invalid-certificate", message },
  });
  const proved = { claim: "proved", proof: FALSE_PROOF };
  const disproved = { claim: "disproved", proof: FALSE_PROOF };
  const rows: readonly [string, unknown, unknown, unknown][] = [
    ["a number", 5, proved, invalid("a predicate is not an object")],
    ["null", null, proved, invalid("a predicate is not an object")],
    ["an array", [], proved, invalid("a predicate is not an object")],
    [
      "a numeric kind",
      { kind: 5 },
      proved,
      invalid("a predicate is not an object"),
    ],
    [
      "a constant with a string value",
      { kind: "constant", value: "yes" },
      proved,
      invalid("a constant does not contain a boolean"),
    ],
    [
      "a not without an operand",
      { kind: "not" },
      proved,
      invalid("a not node has no predicate operand"),
    ],
    [
      "a not with an array operand",
      { kind: "not", operand: [] },
      proved,
      invalid("a not node has no predicate operand"),
    ],
    [
      "an and without operands",
      { kind: "and" },
      disproved,
      invalid("a Boolean node has no operand list"),
    ],
    [
      "an or with a string operand list",
      { kind: "or", operands: "xy" },
      disproved,
      invalid("a Boolean node has no operand list"),
    ],
    [
      "an unknown kind",
      { kind: "bogus" },
      proved,
      invalid("a predicate has an unknown kind"),
    ],
    [
      "a true branch with a false witness missing",
      TRUE,
      { claim: "proved", proof: NEGATIVE_CYCLE },
      certificateError("a false branch has no false witness"),
    ],
    [
      "a difference maximum that is a number",
      differenceOf({ kind: "input" }, { kind: "zero" }, 5),
      disproved,
      invalid("a difference maximum is not a normalized integer"),
    ],
    [
      "a difference maximum with a plus sign",
      differenceOf({ kind: "input" }, { kind: "zero" }, "+5"),
      disproved,
      invalid("a difference maximum is not a normalized integer"),
    ],
    [
      "a difference maximum with a leading zero",
      differenceOf({ kind: "input" }, { kind: "zero" }, "05"),
      disproved,
      invalid("a difference maximum is not a normalized integer"),
    ],
    [
      "a difference maximum that is a decimal",
      differenceOf({ kind: "input" }, { kind: "zero" }, "1.5"),
      disproved,
      invalid("a difference maximum is not a normalized integer"),
    ],
    [
      "a difference maximum that is empty",
      differenceOf({ kind: "input" }, { kind: "zero" }, ""),
      disproved,
      invalid("a difference maximum is not a normalized integer"),
    ],
  ];
  for (const [name, predicate, certificate, expected] of rows) {
    same(verify(TRUE, predicate, certificate), expected, name);
  }
  same(
    verify({ kind: "bogus" }, INPUT_BELOW_ZERO, disproved),
    invalid("a predicate has an unknown kind"),
    "a forged assumption",
  );
});

Deno.test("verifyCertificate rejects a forged difference term", () => {
  const disproved = { claim: "disproved", proof: FALSE_PROOF };
  for (const row of BAD_TERMS) {
    const expected = {
      ok: false,
      error: { tag: "invalid-predicate", message: row.checker },
    };
    same(
      verify(
        TRUE,
        differenceOf(row.term, { kind: "zero" }, "0"),
        disproved,
      ),
      expected,
      `${row.name} as the left term`,
    );
    same(
      verify(
        TRUE,
        differenceOf({ kind: "zero" }, row.term, "0"),
        disproved,
      ),
      expected,
      `${row.name} as the right term`,
    );
  }
});

Deno.test("verifyCertificate rejects a Boolean split that does not match", () => {
  const certificateError = (message: string) => ({
    ok: false,
    error: { tag: "invalid-certificate", message },
  });
  const either = { kind: "or", operands: [TRUE, TRUE] };
  const mismatch = certificateError(
    "a Boolean split does not match the predicate",
  );
  const rows: readonly [string, unknown, unknown, unknown][] = [
    ["a false proof", either, FALSE_PROOF, mismatch],
    [
      "a split without a case list",
      either,
      { kind: "split", cases: "xy" },
      mismatch,
    ],
    [
      "a split with one case for two operands",
      either,
      { kind: "split", cases: [FALSE_PROOF] },
      mismatch,
    ],
    [
      "a split with three cases for two operands",
      either,
      { kind: "split", cases: [FALSE_PROOF, FALSE_PROOF, FALSE_PROOF] },
      mismatch,
    ],
    [
      "an invalid last case",
      either,
      { kind: "split", cases: [FALSE_PROOF, 7] },
      certificateError("a Boolean split case is invalid"),
    ],
    [
      "an invalid first case",
      either,
      { kind: "split", cases: [{ kind: "bogus" }, FALSE_PROOF] },
      certificateError("a Boolean split case is invalid"),
    ],
    [
      "an empty or without a false witness",
      { kind: "or", operands: [] },
      NEGATIVE_CYCLE,
      certificateError("a false branch has no false witness"),
    ],
  ];
  for (const [name, predicate, proof, expected] of rows) {
    same(
      verify(TRUE, predicate, { claim: "disproved", proof }),
      expected,
      name,
    );
  }
  same(
    verify(TRUE, { kind: "or", operands: [] }, {
      claim: "disproved",
      proof: FALSE_PROOF,
    }),
    { ok: true, value: { stepsUsed: 1 } },
  );
});

Deno.test("verifyCertificate enforces the step limit at each counted site", () => {
  const limit = { ok: false, error: { tag: "limit" } };
  const wide = { kind: "and", operands: [TRUE, TRUE, TRUE] };
  same(
    verify(TRUE, wide, { claim: "disproved", proof: FALSE_PROOF }, {
      maxSteps: 3,
    }),
    limit,
    "a conjunction of three operands",
  );
  same(
    verify(
      TRUE,
      { kind: "or", operands: [TRUE, TRUE] },
      {
        claim: "disproved",
        proof: { kind: "split", cases: [FALSE_PROOF, FALSE_PROOF] },
      },
      { maxSteps: 2 },
    ),
    limit,
    "a split of two cases",
  );
  const cycle = { claim: "disproved", proof: NEGATIVE_CYCLE };
  same(
    verify(ZERO_BELOW_INPUT_BY_ONE, INPUT_BELOW_ZERO, cycle, { maxSteps: 3 }),
    limit,
    "a cycle of two constraints",
  );
  same(
    verify(ZERO_BELOW_INPUT_BY_ONE, INPUT_BELOW_ZERO, cycle, { maxSteps: 4 }),
    { ok: true, value: { stepsUsed: 4 } },
  );
});

Deno.test("verifyCertificate rejects a forged negative cycle", () => {
  const certificateError = (message: string) => ({
    ok: false,
    error: { tag: "invalid-certificate", message },
  });
  const noCycle = certificateError("a constraint branch has no negative cycle");
  const badIndex = certificateError(
    "a negative cycle constraint index is invalid",
  );
  const cycleOf = (constraints: unknown) => ({
    claim: "disproved",
    proof: { kind: "negative-cycle", constraints },
  });
  const rows: readonly [string, unknown, unknown][] = [
    ["a false proof", { claim: "disproved", proof: FALSE_PROOF }, noCycle],
    [
      "a split proof",
      { claim: "disproved", proof: { kind: "split", cases: [] } },
      noCycle,
    ],
    ["a constraint list that is a string", cycleOf("xy"), noCycle],
    [
      "an empty cycle",
      cycleOf([]),
      certificateError("a negative cycle is empty"),
    ],
    ["an index past the end", cycleOf([0, 2]), badIndex],
    ["a negative index", cycleOf([0, -1]), badIndex],
    ["a fractional index", cycleOf([0.5, 1]), badIndex],
    ["a string index", cycleOf(["a", 1]), badIndex],
    [
      "a path that does not close",
      cycleOf([0]),
      certificateError("the listed constraints do not form a cycle"),
    ],
    ["a valid cycle", cycleOf([0, 1]), { ok: true, value: { stepsUsed: 4 } }],
    ["a valid cycle in the other order", cycleOf([1, 0]), {
      ok: true,
      value: { stepsUsed: 4 },
    }],
  ];
  for (const [name, certificate, expected] of rows) {
    same(
      verify(ZERO_BELOW_INPUT_BY_ONE, INPUT_BELOW_ZERO, certificate),
      expected,
      name,
    );
  }
  same(
    verify(
      TRUE,
      differenceOf({ kind: "input" }, { kind: "input" }, "-1"),
      cycleOf([0]),
    ),
    { ok: true, value: { stepsUsed: 3 } },
    "a true constant, then a self-loop of negative weight",
  );
  const notNegative = certificateError("the listed cycle is not negative");
  same(
    verify(
      differenceOf({ kind: "zero" }, { kind: "input" }, "0"),
      INPUT_BELOW_ZERO,
      cycleOf([0, 1]),
    ),
    notNegative,
    "a cycle that sums to zero",
  );
  same(
    verify(
      differenceOf({ kind: "zero" }, { kind: "input" }, "5"),
      INPUT_BELOW_ZERO,
      cycleOf([0, 1]),
    ),
    notNegative,
    "a cycle that sums to a positive number",
  );
});
