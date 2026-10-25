import type { Result } from "./ir.ts";

export const PREDICATE_RULES_VERSION = 1;

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

type Comparison =
  | "<"
  | "<="
  | "=="
  | "==="
  | "!="
  | "!=="
  | ">="
  | ">";

type PredicateError =
  | { readonly tag: "invalid-integer"; readonly value: string }
  | { readonly tag: "invalid-term"; readonly message: string }
  | { readonly tag: "invalid-predicate"; readonly message: string }
  | { readonly tag: "invalid-limit"; readonly message: string };

export interface SolverLimits {
  readonly maxSteps: number;
}

export type UnsatProof =
  | { readonly kind: "false" }
  | { readonly kind: "split"; readonly cases: readonly UnsatProof[] }
  | {
    readonly kind: "negative-cycle";
    readonly constraints: readonly number[];
  };

export interface ProofCertificate {
  readonly claim: "proved" | "disproved";
  readonly proof: UnsatProof;
}

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

export function constant(value: boolean): Predicate {
  return { kind: "constant", value };
}

export function and(...operands: readonly Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const operand of operands) {
    if (operand.kind === "constant") {
      if (!operand.value) return operand;
      continue;
    }
    if (operand.kind === "and") flat.push(...operand.operands);
    else flat.push(operand);
  }
  if (flat.length === 0) return constant(true);
  return flat.length === 1 ? flat[0] : { kind: "and", operands: flat };
}

export function or(...operands: readonly Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const operand of operands) {
    if (operand.kind === "constant") {
      if (operand.value) return operand;
      continue;
    }
    if (operand.kind === "or") flat.push(...operand.operands);
    else flat.push(operand);
  }
  if (flat.length === 0) return constant(false);
  return flat.length === 1 ? flat[0] : { kind: "or", operands: flat };
}

export function not(operand: Predicate): Predicate {
  if (operand.kind === "constant") return constant(!operand.value);
  return operand.kind === "not" ? operand.operand : { kind: "not", operand };
}

/** Returns the unique decimal spelling of a mathematical integer. */
export function normalizeInteger(
  value: string,
): Result<DecimalInteger, PredicateError> {
  if (!/^[+-]?[0-9]+$/.test(value)) {
    return { ok: false, error: { tag: "invalid-integer", value } };
  }
  return { ok: true, value: BigInt(value).toString() };
}

/**
 * Compares `left + leftOffset` with `right + rightOffset`.
 * The result uses only normalized difference constraints and Boolean nodes.
 */
export function comparison(
  left: Term,
  leftOffset: string,
  operator: Comparison,
  right: Term,
  rightOffset: string,
): Result<Predicate, PredicateError> {
  const leftTerm = checkTerm(left);
  if (!leftTerm.ok) return leftTerm;
  const rightTerm = checkTerm(right);
  if (!rightTerm.ok) return rightTerm;
  const leftInteger = parseInteger(leftOffset);
  if (!leftInteger.ok) return leftInteger;
  const rightInteger = parseInteger(rightOffset);
  if (!rightInteger.ok) return rightInteger;
  const maximum = rightInteger.value - leftInteger.value;
  const forward = (bound: bigint): Predicate => difference(left, right, bound);
  const reverse = (bound: bigint): Predicate => difference(right, left, bound);
  switch (operator) {
    case "<":
      return { ok: true, value: forward(maximum - 1n) };
    case "<=":
      return { ok: true, value: forward(maximum) };
    case "==":
    case "===":
      return {
        ok: true,
        value: and(forward(maximum), reverse(-maximum)),
      };
    case "!=":
    case "!==":
      return {
        ok: true,
        value: or(forward(maximum - 1n), reverse(-maximum - 1n)),
      };
    case ">=":
      return { ok: true, value: reverse(-maximum) };
    case ">":
      return { ok: true, value: reverse(-maximum - 1n) };
  }
}

interface Constraint {
  readonly left: Term;
  readonly right: Term;
  readonly maximum: bigint;
  readonly leftKey: string;
  readonly rightKey: string;
}

interface PendingPredicate {
  readonly predicate: Predicate;
  readonly negated: boolean;
}

interface SearchState {
  readonly pending: PendingPredicate[];
  readonly constraints: Constraint[];
}

type Search =
  | { readonly kind: "unsat"; readonly proof: UnsatProof }
  | { readonly kind: "satisfiable" }
  | { readonly kind: "exhausted" }
  | { readonly kind: "error"; readonly error: PredicateError };

interface Budget {
  remaining: number;
}

type SearchTask =
  | { readonly kind: "solve"; readonly state: SearchState }
  | { readonly kind: "join"; readonly count: number };

/** Proves a predicate, disproves it, or reports that the bounded search is open. */
export function entails(
  assumptions: Predicate,
  predicate: Predicate,
  limits: SolverLimits,
): Result<Entailment, PredicateError> {
  const checked = checkLimits(limits);
  if (!checked.ok) return checked;
  const budget: Budget = { remaining: limits.maxSteps };
  const proof = contradiction(
    [
      { predicate: assumptions, negated: false },
      { predicate, negated: true },
    ],
    budget,
  );
  if (proof.kind === "error") return { ok: false, error: proof.error };
  if (proof.kind === "unsat") {
    const certificate = { claim: "proved" as const, proof: proof.proof };
    return {
      ok: true,
      value: {
        status: "proved",
        stepsUsed: limits.maxSteps - budget.remaining,
        certificate,
      },
    };
  }
  if (proof.kind === "exhausted") {
    return {
      ok: true,
      value: {
        status: "unknown",
        stepsUsed: limits.maxSteps - budget.remaining,
        reason: "exhausted",
      },
    };
  }

  const disproof = contradiction(
    [
      { predicate: assumptions, negated: false },
      { predicate, negated: false },
    ],
    budget,
  );
  if (disproof.kind === "error") return { ok: false, error: disproof.error };
  if (disproof.kind === "unsat") {
    const certificate = {
      claim: "disproved" as const,
      proof: disproof.proof,
    };
    return {
      ok: true,
      value: {
        status: "disproved",
        stepsUsed: limits.maxSteps - budget.remaining,
        certificate,
      },
    };
  }
  return {
    ok: true,
    value: {
      status: "unknown",
      stepsUsed: limits.maxSteps - budget.remaining,
      reason: disproof.kind === "exhausted" ? "exhausted" : "open",
    },
  };
}

function contradiction(
  pending: PendingPredicate[],
  budget: Budget,
): Search {
  const tasks: SearchTask[] = [{
    kind: "solve",
    state: { pending, constraints: [] },
  }];
  const proofs: UnsatProof[] = [];
  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) break;
    if (task.kind === "join") {
      const cases = proofs.splice(proofs.length - task.count, task.count);
      proofs.push({ kind: "split", cases });
      continue;
    }
    const reduced = reduce(task.state, budget);
    if (reduced.kind === "error" || reduced.kind === "exhausted") {
      return reduced;
    }
    if (reduced.kind === "satisfiable") return reduced;
    if (reduced.kind === "proof") {
      proofs.push(reduced.proof);
      continue;
    }
    tasks.push({ kind: "join", count: reduced.cases.length });
    for (let index = reduced.cases.length - 1; index >= 0; index--) {
      tasks.push({ kind: "solve", state: reduced.cases[index] });
    }
  }
  const proof = proofs[0];
  return proof === undefined
    ? { kind: "satisfiable" }
    : { kind: "unsat", proof };
}

type Reduced =
  | { readonly kind: "proof"; readonly proof: UnsatProof }
  | { readonly kind: "split"; readonly cases: readonly SearchState[] }
  | { readonly kind: "satisfiable" }
  | { readonly kind: "exhausted" }
  | { readonly kind: "error"; readonly error: PredicateError };

function reduce(state: SearchState, budget: Budget): Reduced {
  while (state.pending.length > 0) {
    if (!spend(budget)) return { kind: "exhausted" };
    const current = state.pending.pop();
    if (current === undefined) break;
    const predicate = current.predicate;
    if (!isPredicateRecord(predicate)) {
      return invalidPredicate("a predicate is not an object");
    }
    switch (predicate.kind) {
      case "constant": {
        if (typeof predicate.value !== "boolean") {
          return invalidPredicate("a constant does not contain a boolean");
        }
        const value = current.negated ? !predicate.value : predicate.value;
        if (!value) return { kind: "proof", proof: { kind: "false" } };
        break;
      }
      case "not":
        if (!isPredicateRecord(predicate.operand)) {
          return invalidPredicate("a not node has no predicate operand");
        }
        state.pending.push({
          predicate: predicate.operand,
          negated: !current.negated,
        });
        break;
      case "and":
      case "or": {
        if (!Array.isArray(predicate.operands)) {
          return invalidPredicate("a Boolean node has no operand list");
        }
        const conjunction = (predicate.kind === "and") !== current.negated;
        if (conjunction) {
          for (let index = predicate.operands.length - 1; index >= 0; index--) {
            if (!spend(budget)) return { kind: "exhausted" };
            state.pending.push({
              predicate: predicate.operands[index],
              negated: current.negated,
            });
          }
          break;
        }
        if (predicate.operands.length === 0) {
          return { kind: "proof", proof: { kind: "false" } };
        }
        if (!spendMany(budget, predicate.operands.length)) {
          return { kind: "exhausted" };
        }
        return {
          kind: "split",
          cases: predicate.operands.map((operand) => ({
            pending: [
              ...state.pending,
              { predicate: operand, negated: current.negated },
            ],
            constraints: [...state.constraints],
          })),
        };
      }
      case "difference": {
        const constraint = readConstraint(predicate, current.negated);
        if (!constraint.ok) return { kind: "error", error: constraint.error };
        state.constraints.push(constraint.value);
        break;
      }
      default:
        return invalidPredicate("a predicate has an unknown kind");
    }
  }
  const cycle = negativeCycle(state.constraints, budget);
  if (cycle.kind === "exhausted") return cycle;
  return cycle.kind === "none" ? { kind: "satisfiable" } : {
    kind: "proof",
    proof: { kind: "negative-cycle", constraints: cycle.constraints },
  };
}

function negativeCycle(
  constraints: readonly Constraint[],
  budget: Budget,
):
  | { readonly kind: "none" }
  | { readonly kind: "cycle"; readonly constraints: readonly number[] }
  | { readonly kind: "exhausted" } {
  const nodes = new Set<string>();
  for (const constraint of constraints) {
    nodes.add(constraint.leftKey);
    nodes.add(constraint.rightKey);
  }
  const distance = new Map<string, bigint>();
  const predecessor = new Map<string, number>();
  for (const node of nodes) distance.set(node, 0n);
  let changed: string | undefined;
  for (let pass = 0; pass < nodes.size; pass++) {
    changed = undefined;
    for (let index = 0; index < constraints.length; index++) {
      if (!spend(budget)) return { kind: "exhausted" };
      const edge = constraints[index];
      const candidate = (distance.get(edge.rightKey) ?? 0n) + edge.maximum;
      if (candidate < (distance.get(edge.leftKey) ?? 0n)) {
        distance.set(edge.leftKey, candidate);
        predecessor.set(edge.leftKey, index);
        changed = edge.leftKey;
      }
    }
    if (changed === undefined) return { kind: "none" };
  }
  if (changed === undefined) return { kind: "none" };
  let node = changed;
  for (let count = 0; count < nodes.size; count++) {
    if (!spend(budget)) return { kind: "exhausted" };
    const edge = constraints[predecessor.get(node) ?? -1];
    if (edge === undefined) return { kind: "none" };
    node = edge.rightKey;
  }
  const start = node;
  const cycle: number[] = [];
  do {
    if (!spend(budget)) return { kind: "exhausted" };
    const index = predecessor.get(node);
    if (index === undefined) return { kind: "none" };
    cycle.push(index);
    node = constraints[index].rightKey;
  } while (node !== start);
  return { kind: "cycle", constraints: cycle };
}

function readConstraint(
  predicate: Extract<Predicate, { readonly kind: "difference" }>,
  negated: boolean,
): Result<Constraint, PredicateError> {
  const left = checkTerm(predicate.left);
  if (!left.ok) return left;
  const right = checkTerm(predicate.right);
  if (!right.ok) return right;
  const maximum = typeof predicate.maximum === "string"
    ? parseInteger(predicate.maximum)
    : invalidInteger(String(predicate.maximum));
  if (!maximum.ok) return maximum;
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
  if (termKey(left) === termKey(right)) return constant(0n <= maximum);
  return { kind: "difference", left, right, maximum: maximum.toString() };
}

function parseInteger(value: string): Result<bigint, PredicateError> {
  const normalized = normalizeInteger(value);
  return normalized.ok
    ? { ok: true, value: BigInt(normalized.value) }
    : normalized;
}

function invalidInteger(value: string): Result<never, PredicateError> {
  return { ok: false, error: { tag: "invalid-integer", value } };
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
  return { ok: false, error: { tag: "invalid-term", message } };
}

function invalidPredicate(message: string): Reduced {
  return { kind: "error", error: { tag: "invalid-predicate", message } };
}

function isPredicateRecord(value: unknown): value is Predicate {
  return typeof value === "object" && value !== null && "kind" in value;
}

function termKey(term: Term): string {
  switch (term.kind) {
    case "zero":
      return "z";
    case "input":
      return "i";
    case "field":
      return `f${JSON.stringify(term.path)}`;
    case "length":
      return `l${JSON.stringify(term.path)}`;
  }
}

function checkLimits(
  limits: SolverLimits,
): Result<true, PredicateError> {
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

function spend(budget: Budget): boolean {
  if (budget.remaining === 0) return false;
  budget.remaining--;
  return true;
}

function spendMany(budget: Budget, count: number): boolean {
  if (count > budget.remaining) {
    budget.remaining = 0;
    return false;
  }
  budget.remaining -= count;
  return true;
}
