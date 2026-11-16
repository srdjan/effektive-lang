import {
  bigInteger,
  emptyMap,
  emptySet,
  hasProperty,
  indices,
  reverseIndices,
  stackValues,
} from "./runtime.ts";
import type { Result } from "./source.ts";

/** An integer written without a precision-losing JavaScript number. */
type DecimalInteger = string;

/** A value that an input predicate can compare. */
export type Term =
  | { readonly kind: "zero" }
  | { readonly kind: "input" }
  | { readonly kind: "field"; readonly path: readonly string[] }
  | {
    readonly kind: "length";
    readonly path: readonly string[];
    readonly unit: "utf16";
  };

/** A normalized, JSON-serializable input predicate. */
export type Predicate =
  | { readonly kind: "constant"; readonly value: boolean }
  | { readonly kind: "and"; readonly operands: readonly Predicate[] }
  | { readonly kind: "or"; readonly operands: readonly Predicate[] }
  | { readonly kind: "not"; readonly operand: Predicate }
  /** `left - right <= maximum`. */
  | {
    readonly kind: "difference";
    readonly left: Term;
    readonly right: Term;
    readonly maximum: DecimalInteger;
  };

type PredicateError =
  | { readonly tag: "invalid-integer"; readonly value: string }
  | { readonly tag: "invalid-term"; readonly message: string }
  | { readonly tag: "invalid-predicate"; readonly message: string }
  | { readonly tag: "invalid-limit"; readonly message: string };

export type SolverLimits = {
  readonly maxSteps: number;
};

export type UnsatProof =
  | { readonly kind: "false" }
  | { readonly kind: "split"; readonly cases: readonly UnsatProof[] }
  | {
    readonly kind: "negative-cycle";
    readonly constraints: readonly number[];
  };

export type ProofCertificate = {
  readonly claim: "proved" | "disproved";
  readonly proof: UnsatProof;
};

type Entailment =
  | {
    readonly status: "proved";
    readonly stepsUsed: number;
    readonly certificate: ProofCertificate & { readonly claim: "proved" };
  }
  | {
    readonly status: "disproved";
    readonly stepsUsed: number;
    readonly certificate: ProofCertificate & { readonly claim: "disproved" };
  }
  | {
    readonly status: "unknown";
    readonly stepsUsed: number;
    readonly reason: "open" | "exhausted";
  };

type PredicateTruth = boolean;

export function constant(value: PredicateTruth): Predicate {
  return { kind: "constant", value: value };
}
export function and(operands: readonly Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const operand of operands) {
    if (operand.kind === "constant") {
      if (!operand.value) {
        return operand;
      }
      continue;
    }
    if (operand.kind === "and") {
      const _appendTarget1 = flat;
      const _appendValues2 = [...operand.operands];
      for (const _appendItem3 of _appendValues2) {
        _appendTarget1[_appendTarget1.length] = _appendItem3;
      }
    } else {
      const _appendTarget4 = flat;
      const _appendValue5 = operand;
      _appendTarget4[_appendTarget4.length] = _appendValue5;
    }
  }
  if (flat.length === 0) {
    return constant(true);
  }
  return flat.length === 1 ? flat[0] : { kind: "and", operands: flat };
}
export function or(operands: readonly Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const operand of operands) {
    if (operand.kind === "constant") {
      if (operand.value) {
        return operand;
      }
      continue;
    }
    if (operand.kind === "or") {
      const _appendTarget6 = flat;
      const _appendValues7 = [...operand.operands];
      for (const _appendItem8 of _appendValues7) {
        _appendTarget6[_appendTarget6.length] = _appendItem8;
      }
    } else {
      const _appendTarget9 = flat;
      const _appendValue10 = operand;
      _appendTarget9[_appendTarget9.length] = _appendValue10;
    }
  }
  if (flat.length === 0) {
    return constant(false);
  }
  return flat.length === 1 ? flat[0] : { kind: "or", operands: flat };
}
export function not(operand: Predicate): Predicate {
  if (operand.kind === "constant") {
    return constant(!operand.value);
  }
  return operand.kind === "not"
    ? operand.operand
    : { kind: "not", operand: operand };
}
/** Returns the unique decimal spelling of a mathematical integer. */
export function normalizeInteger(
  value: DecimalInteger,
): Result<DecimalInteger, PredicateError> {
  if (!isDecimalInteger(value)) {
    return { ok: false, error: { tag: "invalid-integer", value: value } };
  }
  return { ok: true, value: bigInteger(value).toString() };
}
/**
 * Compares `left + leftOffset` with `right + rightOffset`.
 * The result uses only normalized difference constraints and Boolean nodes.
 */
export function comparison(
  left: Term,
  leftOffset: DecimalInteger,
  operator: ComparisonOperator,
  right: Term,
  rightOffset: DecimalInteger,
): Result<Predicate, PredicateError> {
  const leftTerm = checkTerm(left);
  if (!leftTerm.ok) {
    return leftTerm;
  }
  const rightTerm = checkTerm(right);
  if (!rightTerm.ok) {
    return rightTerm;
  }
  const leftInteger = parseInteger(leftOffset);
  if (!leftInteger.ok) {
    return leftInteger;
  }
  const rightInteger = parseInteger(rightOffset);
  if (!rightInteger.ok) {
    return rightInteger;
  }
  const maximum = rightInteger.value - leftInteger.value;
  const join = COMPARISON_BOUNDS[operator].join;
  const bounds = COMPARISON_BOUNDS[operator].parts.map((part) =>
    part.reversed
      ? difference(right, left, -maximum + part.slack)
      : difference(left, right, maximum + part.slack)
  );
  if (join === "single") {
    return { ok: true, value: bounds[0] };
  } else if (join === "and") {
    return { ok: true, value: and(bounds) };
  } else {
    return { ok: true, value: or(bounds) };
  }
}
type Constraint = {
  readonly left: Term;
  readonly right: Term;
  readonly maximum: bigint;
  readonly leftKey: string;
  readonly rightKey: string;
};
type PendingPredicate = {
  readonly predicate: Predicate;
  readonly negated: boolean;
};
type SearchState = {
  readonly pending: readonly PendingPredicate[];
  readonly constraints: readonly Constraint[];
};
type Search = {
  readonly kind: "unsat";
  readonly proof: UnsatProof;
} | {
  readonly kind: "satisfiable";
} | {
  readonly kind: "exhausted";
} | {
  readonly kind: "error";
  readonly error: PredicateError;
};
type Budget = {
  readonly remaining: () => number;
  readonly spend: (count: number) => boolean;
};
function createBudget(maximum: number): Budget {
  let remaining = maximum;
  function spend(count: number): boolean {
    if (count > remaining) {
      remaining = 0;
      return false;
    }
    remaining = remaining - count;
    return true;
  }
  return { remaining: () => remaining, spend: spend };
}
function isDecimalInteger(value: string): boolean {
  const sign = value[0] === "+" || value[0] === "-";
  const digits = sign ? value.slice(1) : value;
  if (digits.length === 0) {
    return false;
  }
  for (const char of digits) {
    if (char < "0" || char > "9") {
      return false;
    }
  }
  return true;
}
type SearchTask = {
  readonly kind: "solve";
  readonly state: SearchState;
} | {
  readonly kind: "join";
  readonly count: number;
};
/** Proves a predicate, disproves it, or reports that the bounded search is open. */
export function entails(
  assumptions: Predicate,
  predicate: Predicate,
  limits: SolverLimits,
): Result<Entailment, PredicateError> {
  const checked = checkLimits(limits);
  if (!checked.ok) {
    return checked;
  }
  const budget = createBudget(limits.maxSteps);
  const proof = contradiction([
    { predicate: assumptions, negated: false },
    { predicate: predicate, negated: true },
  ], budget);
  if (proof.kind === "error") {
    return { ok: false, error: proof.error };
  }
  if (proof.kind === "unsat") {
    const certificate = { claim: "proved" as const, proof: proof.proof };
    return {
      ok: true,
      value: {
        status: "proved",
        stepsUsed: limits.maxSteps - budget.remaining(),
        certificate: certificate,
      },
    };
  }
  if (proof.kind === "exhausted") {
    return {
      ok: true,
      value: {
        status: "unknown",
        stepsUsed: limits.maxSteps - budget.remaining(),
        reason: "exhausted",
      },
    };
  }
  const disproof = contradiction([
    { predicate: assumptions, negated: false },
    { predicate: predicate, negated: false },
  ], budget);
  if (disproof.kind === "error") {
    return { ok: false, error: disproof.error };
  }
  if (disproof.kind === "unsat") {
    const certificate = {
      claim: "disproved" as const,
      proof: disproof.proof,
    };
    return {
      ok: true,
      value: {
        status: "disproved",
        stepsUsed: limits.maxSteps - budget.remaining(),
        certificate: certificate,
      },
    };
  }
  return {
    ok: true,
    value: {
      status: "unknown",
      stepsUsed: limits.maxSteps - budget.remaining(),
      reason: disproof.kind === "exhausted" ? "exhausted" : "open",
    },
  };
}
function contradiction(pending: PendingPredicate[], budget: Budget): Search {
  const tasks: SearchTask[] = [{
    kind: "solve",
    state: { pending: pending, constraints: [] },
  }];
  const proofs: UnsatProof[] = [];
  for (const task of stackValues(tasks)) {
    if (task.kind === "join") {
      const cases = proofs.splice(proofs.length - task.count, task.count);
      proofs[proofs.length] = { kind: "split", cases: cases };
      continue;
    }
    const reduced = reduce(task.state, budget);
    if (reduced.kind === "error" || reduced.kind === "exhausted") {
      return reduced;
    }
    if (reduced.kind === "satisfiable") {
      return reduced;
    }
    if (reduced.kind === "proof") {
      proofs[proofs.length] = reduced.proof;
      continue;
    }
    tasks[tasks.length] = { kind: "join", count: reduced.cases.length };
    for (const index of reverseIndices(reduced.cases.length)) {
      tasks[tasks.length] = { kind: "solve", state: reduced.cases[index] };
    }
  }
  const proof = proofs[0];
  return proof === undefined
    ? { kind: "satisfiable" }
    : { kind: "unsat", proof: proof };
}
type Reduced = {
  readonly kind: "proof";
  readonly proof: UnsatProof;
} | {
  readonly kind: "split";
  readonly cases: readonly SearchState[];
} | {
  readonly kind: "satisfiable";
} | {
  readonly kind: "exhausted";
} | {
  readonly kind: "error";
  readonly error: PredicateError;
};
function reduce(state: SearchState, budget: Budget): Reduced {
  const pending = [...state.pending];
  const constraints = [...state.constraints];
  for (const current of stackValues(pending)) {
    if (!budget.spend(1)) {
      return { kind: "exhausted" };
    }
    const predicate = current.predicate;
    if (!isPredicateRecord(predicate)) {
      return invalidPredicate("a predicate is not an object");
    }
    if (predicate.kind === "constant") {
      if (typeof predicate.value !== "boolean") {
        return invalidPredicate("a constant does not contain a boolean");
      }
      const value = current.negated ? !predicate.value : predicate.value;
      if (!value) {
        return { kind: "proof", proof: { kind: "false" } };
      }
      continue;
    }
    if (predicate.kind === "not") {
      if (!isPredicateRecord(predicate.operand)) {
        return invalidPredicate("a not node has no predicate operand");
      }
      pending[pending.length] = {
        predicate: predicate.operand,
        negated: !current.negated,
      };
      continue;
    }
    if (predicate.kind === "and" || predicate.kind === "or") {
      if (!Array.isArray(predicate.operands)) {
        return invalidPredicate("a Boolean node has no operand list");
      }
      const conjunction = (predicate.kind === "and") !== current.negated;
      if (conjunction) {
        for (const index of reverseIndices(predicate.operands.length)) {
          if (!budget.spend(1)) {
            return { kind: "exhausted" };
          }
          pending[pending.length] = {
            predicate: predicate.operands[index],
            negated: current.negated,
          };
        }
        continue;
      }
      if (predicate.operands.length === 0) {
        return { kind: "proof", proof: { kind: "false" } };
      }
      if (!budget.spend(predicate.operands.length)) {
        return { kind: "exhausted" };
      }
      return {
        kind: "split",
        cases: predicate.operands.map((operand) => ({
          pending: [...pending, {
            predicate: operand,
            negated: current.negated,
          }],
          constraints: constraints,
        })),
      };
    }
    if (predicate.kind === "difference") {
      const constraint = readConstraint(predicate, current.negated);
      if (!constraint.ok) {
        return { kind: "error", error: constraint.error };
      }
      constraints[constraints.length] = constraint.value;
      continue;
    }
    return invalidPredicate("a predicate has an unknown kind");
  }
  const cycle = negativeCycle(constraints, budget);
  if (cycle.kind === "exhausted") {
    return cycle;
  }
  return cycle.kind === "none" ? { kind: "satisfiable" } : {
    kind: "proof",
    proof: { kind: "negative-cycle", constraints: cycle.constraints },
  };
}
function negativeCycle(constraints: readonly Constraint[], budget: Budget): {
  readonly kind: "none";
} | {
  readonly kind: "cycle";
  readonly constraints: readonly number[];
} | {
  readonly kind: "exhausted";
} {
  let nodes = emptySet<string>();
  for (const constraint of constraints) {
    nodes = nodes.add(constraint.leftKey);
    nodes = nodes.add(constraint.rightKey);
  }
  let distance = emptyMap<string, bigint>();
  let predecessor = emptyMap<string, number>();
  for (const node of nodes) {
    distance = distance.set(node, 0n);
  }
  let changed: string | undefined;
  for (const _pass of indices(nodes.size)) {
    changed = undefined;
    for (const index of indices(constraints.length)) {
      if (!budget.spend(1)) {
        return { kind: "exhausted" };
      }
      const edge = constraints[index];
      const candidate = (distance.get(edge.rightKey) ?? 0n) + edge.maximum;
      if (candidate < (distance.get(edge.leftKey) ?? 0n)) {
        distance = distance.set(edge.leftKey, candidate);
        predecessor = predecessor.set(edge.leftKey, index);
        changed = edge.leftKey;
      }
    }
    if (changed === undefined) {
      return { kind: "none" };
    }
  }
  if (changed === undefined) {
    return { kind: "none" };
  }
  let node = changed;
  for (const _count of indices(nodes.size)) {
    if (!budget.spend(1)) {
      return { kind: "exhausted" };
    }
    const edge = constraints[predecessor.get(node) ?? -1];
    if (edge === undefined) {
      return { kind: "none" };
    }
    node = edge.rightKey;
  }
  const start = node;
  const cycle: number[] = [];
  for (const _step of indices(nodes.size)) {
    if (!budget.spend(1)) {
      return { kind: "exhausted" };
    }
    const index = predecessor.get(node);
    if (index === undefined) {
      return { kind: "none" };
    }
    {
      const _appendTarget19 = cycle;
      const _appendValue20 = index;
      _appendTarget19[_appendTarget19.length] = _appendValue20;
    }
    node = constraints[index].rightKey;
    if (node === start) {
      break;
    }
  }
  return { kind: "cycle", constraints: cycle };
}
function readConstraint(
  predicate: Extract<Predicate, {
    readonly kind: "difference";
  }>,
  negated: boolean,
): Result<Constraint, PredicateError> {
  const left = checkTerm(predicate.left);
  if (!left.ok) {
    return left;
  }
  const right = checkTerm(predicate.right);
  if (!right.ok) {
    return right;
  }
  const maximum: Result<bigint, PredicateError> =
    typeof predicate.maximum === "string" ? parseInteger(predicate.maximum) : {
      ok: false,
      error: { tag: "invalid-integer", value: String(predicate.maximum) },
    };
  if (!maximum.ok) {
    return maximum;
  }
  if (maximum.value.toString() !== predicate.maximum) {
    return {
      ok: false,
      error: {
        tag: "invalid-predicate",
        message: "a difference maximum is not a normalized integer",
      },
    };
  }
  const actualLeft = negated ? predicate.right : predicate.left;
  const actualRight = negated ? predicate.left : predicate.right;
  const actualMaximum = negated ? -maximum.value - 1n : maximum.value;
  return {
    ok: true,
    value: {
      left: actualLeft,
      right: actualRight,
      maximum: actualMaximum,
      leftKey: termKey(actualLeft),
      rightKey: termKey(actualRight),
    },
  };
}
function difference(left: Term, right: Term, maximum: bigint): Predicate {
  if (termKey(left) === termKey(right)) {
    return constant(0n <= maximum);
  }
  return {
    kind: "difference",
    left: left,
    right: right,
    maximum: maximum.toString(),
  };
}
function parseInteger(value: string): Result<bigint, PredicateError> {
  const normalized = normalizeInteger(value);
  return normalized.ok
    ? { ok: true, value: bigInteger(normalized.value) }
    : normalized;
}
function checkTerm(term: Term): Result<Term, PredicateError> {
  if (typeof term !== "object" || term === null) {
    return invalidTerm("a term is not an object");
  }
  if (term.kind === "zero" || term.kind === "input") {
    return { ok: true, value: term };
  }
  if (term.kind !== "field" && term.kind !== "length") {
    return invalidTerm("a term has an unknown kind");
  }
  if (
    !Array.isArray(term.path) ||
    !term.path.every((part) => typeof part === "string")
  ) {
    return invalidTerm("a term path is not a string list");
  }
  if (term.kind === "field" && term.path.length === 0) {
    return invalidTerm("a field term has an empty path");
  }
  if (term.kind === "length" && term.unit !== "utf16") {
    return invalidTerm("a length term does not use UTF-16 units");
  }
  return { ok: true, value: term };
}
function invalidTerm(message: string): Result<never, PredicateError> {
  return { ok: false, error: { tag: "invalid-term", message: message } };
}
function invalidPredicate(message: string): Reduced {
  return {
    kind: "error",
    error: { tag: "invalid-predicate", message: message },
  };
}
function isPredicateRecord(value: unknown): value is Predicate {
  return typeof value === "object" && value !== null &&
    hasProperty(value, "kind");
}
function termKey(term: Term): string {
  {
    const kind_1 = term.kind;
    if (kind_1 === "zero") {
      return "z";
    } else if (kind_1 === "input") {
      return "i";
    } else if (kind_1 === "field") {
      return `f${JSON.stringify(term.path)}`;
    } else {
      return `l${JSON.stringify(term.path)}`;
    }
  }
}
function checkLimits(limits: SolverLimits): Result<true, PredicateError> {
  if (!Number.isSafeInteger(limits.maxSteps) || limits.maxSteps < 0) {
    return {
      ok: false,
      error: {
        tag: "invalid-limit",
        message: "maxSteps must be a nonnegative safe integer",
      },
    };
  }
  return { ok: true, value: true };
}
export type ComparisonOperator = "<" | "<=" | "===" | "!==" | ">=" | ">";
/**
 * One difference bound of a comparison of `left + leftOffset` with `right + rightOffset`.
 * With `maximum = rightOffset - leftOffset`, the forward bound is
 * `left - right <= maximum + slack`. The reverse bound is `right - left <= -maximum + slack`.
 */
type ComparisonPart = {
  readonly reversed: boolean;
  readonly slack: bigint;
};
type ComparisonBounds = {
  readonly parts: readonly ComparisonPart[];
  /** How the parts combine. A single part has no join. */
  readonly join: "single" | "and" | "or";
};
/** Turns each comparison operator into its difference bounds. */
export const COMPARISON_BOUNDS: Readonly<
  Record<ComparisonOperator, ComparisonBounds>
> = {
  "<": { join: "single", parts: [{ reversed: false, slack: -1n }] },
  "<=": { join: "single", parts: [{ reversed: false, slack: 0n }] },
  ">": { join: "single", parts: [{ reversed: true, slack: -1n }] },
  ">=": { join: "single", parts: [{ reversed: true, slack: 0n }] },
  "===": {
    join: "and",
    parts: [{ reversed: false, slack: 0n }, { reversed: true, slack: 0n }],
  },
  "!==": {
    join: "or",
    parts: [{ reversed: false, slack: -1n }, { reversed: true, slack: -1n }],
  },
};
