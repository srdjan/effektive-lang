import type { Result } from "../ir.ts";
import type {
  Predicate,
  ProofCertificate,
  SolverLimits,
  UnsatProof,
} from "../predicates.ts";

type CertificateError =
  | { readonly tag: "invalid-certificate"; readonly message: string }
  | { readonly tag: "invalid-predicate"; readonly message: string }
  | { readonly tag: "invalid-limit"; readonly message: string }
  | { readonly tag: "limit" };

interface SignedPredicate {
  readonly predicate: Predicate;
  readonly negated: boolean;
}

interface CheckedConstraint {
  readonly left: string;
  readonly right: string;
  readonly maximum: bigint;
}

interface CheckTask {
  readonly pending: SignedPredicate[];
  readonly constraints: CheckedConstraint[];
  readonly proof: UnsatProof;
}

interface Counter {
  remaining: number;
}

interface CertificateVerification {
  readonly stepsUsed: number;
}

/** Checks a proof without calling or sharing implementation with the solver. */
export function verifyCertificate(
  assumptions: Predicate,
  predicate: Predicate,
  certificate: ProofCertificate,
  limits: SolverLimits,
): Result<CertificateVerification, CertificateError> {
  if (!Number.isSafeInteger(limits.maxSteps) || limits.maxSteps < 0) {
    return failure(
      "invalid-limit",
      "maxSteps must be a nonnegative safe integer",
    );
  }
  if (
    !isObject(certificate) ||
    (certificate.claim !== "proved" && certificate.claim !== "disproved") ||
    !isUnsatProof(certificate.proof)
  ) {
    return failure("invalid-certificate", "the certificate shape is invalid");
  }
  const counter: Counter = { remaining: limits.maxSteps };
  const tasks: CheckTask[] = [{
    pending: [
      { predicate: assumptions, negated: false },
      { predicate, negated: certificate.claim === "proved" },
    ],
    constraints: [],
    proof: certificate.proof,
  }];
  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) break;
    const checked = checkBranch(task, tasks, counter);
    if (!checked.ok) return checked;
  }
  return {
    ok: true,
    value: { stepsUsed: limits.maxSteps - counter.remaining },
  };
}

function checkBranch(
  task: CheckTask,
  tasks: CheckTask[],
  counter: Counter,
): Result<true, CertificateError> {
  while (task.pending.length > 0) {
    if (!take(counter)) return { ok: false, error: { tag: "limit" } };
    const signed = task.pending.pop();
    if (signed === undefined) break;
    const node = signed.predicate;
    if (!isObject(node) || typeof node.kind !== "string") {
      return failure("invalid-predicate", "a predicate is not an object");
    }
    if (node.kind === "constant") {
      if (typeof node.value !== "boolean") {
        return failure(
          "invalid-predicate",
          "a constant does not contain a boolean",
        );
      }
      const value = signed.negated ? !node.value : node.value;
      if (!value) return expectFalse(task.proof);
      continue;
    }
    if (node.kind === "not") {
      if (!isObject(node.operand)) {
        return failure(
          "invalid-predicate",
          "a not node has no predicate operand",
        );
      }
      task.pending.push({
        predicate: node.operand,
        negated: !signed.negated,
      });
      continue;
    }
    if (node.kind === "and" || node.kind === "or") {
      if (!Array.isArray(node.operands)) {
        return failure(
          "invalid-predicate",
          "a Boolean node has no operand list",
        );
      }
      const isConjunction = (node.kind === "and") !== signed.negated;
      if (isConjunction) {
        if (!takeCount(counter, node.operands.length)) {
          return { ok: false, error: { tag: "limit" } };
        }
        for (let index = node.operands.length - 1; index >= 0; index--) {
          task.pending.push({
            predicate: node.operands[index],
            negated: signed.negated,
          });
        }
        continue;
      }
      if (node.operands.length === 0) return expectFalse(task.proof);
      if (
        task.proof.kind !== "split" ||
        !Array.isArray(task.proof.cases) ||
        task.proof.cases.length !== node.operands.length
      ) {
        return failure(
          "invalid-certificate",
          "a Boolean split does not match the predicate",
        );
      }
      if (!takeCount(counter, node.operands.length)) {
        return { ok: false, error: { tag: "limit" } };
      }
      for (let index = node.operands.length - 1; index >= 0; index--) {
        const proof = task.proof.cases[index];
        if (!isUnsatProof(proof)) {
          return failure(
            "invalid-certificate",
            "a Boolean split case is invalid",
          );
        }
        tasks.push({
          pending: [
            ...task.pending,
            { predicate: node.operands[index], negated: signed.negated },
          ],
          constraints: [...task.constraints],
          proof,
        });
      }
      return { ok: true, value: true };
    }
    if (node.kind === "difference") {
      const constraint = decodeConstraint(node, signed.negated);
      if (!constraint.ok) return constraint;
      task.constraints.push(constraint.value);
      continue;
    }
    return failure("invalid-predicate", "a predicate has an unknown kind");
  }
  return checkCycle(task.proof, task.constraints, counter);
}

function expectFalse(proof: UnsatProof): Result<true, CertificateError> {
  return proof.kind === "false" ? { ok: true, value: true } : failure(
    "invalid-certificate",
    "a false branch has no false witness",
  );
}

function checkCycle(
  proof: UnsatProof,
  constraints: readonly CheckedConstraint[],
  counter: Counter,
): Result<true, CertificateError> {
  if (proof.kind !== "negative-cycle" || !Array.isArray(proof.constraints)) {
    return failure(
      "invalid-certificate",
      "a constraint branch has no negative cycle",
    );
  }
  if (proof.constraints.length === 0) {
    return failure("invalid-certificate", "a negative cycle is empty");
  }
  if (!takeCount(counter, proof.constraints.length)) {
    return { ok: false, error: { tag: "limit" } };
  }
  const cycle: CheckedConstraint[] = [];
  for (const index of proof.constraints) {
    if (
      !Number.isSafeInteger(index) || index < 0 || index >= constraints.length
    ) {
      return failure(
        "invalid-certificate",
        "a negative cycle constraint index is invalid",
      );
    }
    cycle.push(constraints[index]);
  }
  let total = 0n;
  for (let index = 0; index < cycle.length; index++) {
    const edge = cycle[index];
    const next = cycle[(index + 1) % cycle.length];
    if (edge.right !== next.left) {
      return failure(
        "invalid-certificate",
        "the listed constraints do not form a cycle",
      );
    }
    total += edge.maximum;
  }
  return total < 0n
    ? { ok: true, value: true }
    : failure("invalid-certificate", "the listed cycle is not negative");
}

function decodeConstraint(
  node: Readonly<Record<string, unknown>>,
  negated: boolean,
): Result<CheckedConstraint, CertificateError> {
  const left = decodeTerm(node.left);
  if (!left.ok) return left;
  const right = decodeTerm(node.right);
  if (!right.ok) return right;
  if (
    typeof node.maximum !== "string" ||
    !/^-?(0|[1-9][0-9]*)$/.test(node.maximum)
  ) {
    return failure(
      "invalid-predicate",
      "a difference maximum is not a normalized integer",
    );
  }
  const maximum = BigInt(node.maximum);
  return negated
    ? {
      ok: true,
      value: {
        left: right.value,
        right: left.value,
        maximum: -maximum - 1n,
      },
    }
    : {
      ok: true,
      value: { left: left.value, right: right.value, maximum },
    };
}

function decodeTerm(term: unknown): Result<string, CertificateError> {
  if (!isObject(term) || typeof term.kind !== "string") {
    return failure("invalid-predicate", "a term is not an object");
  }
  if (term.kind === "zero") return { ok: true, value: "zero" };
  if (term.kind === "input") return { ok: true, value: "input" };
  if (term.kind !== "field" && term.kind !== "length") {
    return failure("invalid-predicate", "a term has an unknown kind");
  }
  if (
    !Array.isArray(term.path) ||
    !term.path.every((part) => typeof part === "string")
  ) {
    return failure("invalid-predicate", "a term path is not a string list");
  }
  if (term.kind === "field" && term.path.length === 0) {
    return failure("invalid-predicate", "a field term has an empty path");
  }
  if (term.kind === "length" && term.unit !== "utf16") {
    return failure(
      "invalid-predicate",
      "a length term does not use UTF-16 units",
    );
  }
  return {
    ok: true,
    value: `${term.kind}:${JSON.stringify(term.path)}`,
  };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsatProof(value: unknown): value is UnsatProof {
  return isObject(value) &&
    (value.kind === "false" || value.kind === "split" ||
      value.kind === "negative-cycle");
}

function take(counter: Counter): boolean {
  if (counter.remaining === 0) return false;
  counter.remaining--;
  return true;
}

function takeCount(counter: Counter, count: number): boolean {
  if (count > counter.remaining) {
    counter.remaining = 0;
    return false;
  }
  counter.remaining -= count;
  return true;
}

function failure(
  tag: "invalid-certificate" | "invalid-predicate" | "invalid-limit",
  message: string,
): Result<never, CertificateError> {
  return { ok: false, error: { tag, message } };
}
