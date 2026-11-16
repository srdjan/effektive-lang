import type { Result } from "../source.ts";
import type {
  Predicate,
  ProofCertificate,
  SolverLimits,
  UnsatProof,
} from "../predicates.ts";
import { bigInteger, indices, reverseIndices } from "../runtime.ts";
import { isRecord } from "./guards.ts";

type CertificateError =
  | { readonly tag: "invalid-certificate"; readonly message: string }
  | { readonly tag: "invalid-predicate"; readonly message: string }
  | { readonly tag: "invalid-limit"; readonly message: string }
  | { readonly tag: "limit" };

type SignedPredicate = {
  readonly predicate: Predicate;
  readonly negated: boolean;
};

type CheckedConstraint = {
  readonly left: string;
  readonly right: string;
  readonly maximum: bigint;
};

type CheckTask = {
  readonly pending: readonly SignedPredicate[];
  readonly constraints: readonly CheckedConstraint[];
  readonly proof: UnsatProof;
};

type Spend = (count: number) => boolean;

type CertificateVerification = {
  readonly stepsUsed: number;
};

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
    !isRecord(certificate) ||
    (certificate.claim !== "proved" && certificate.claim !== "disproved") ||
    !isUnsatProof(certificate.proof)
  ) {
    return failure("invalid-certificate", "the certificate shape is invalid");
  }
  let remaining = limits.maxSteps;
  function spend(count: number): boolean {
    if (count > remaining) {
      remaining = 0;
      return false;
    }
    remaining = remaining - count;
    return true;
  }
  const tasks: CheckTask[] = [{
    pending: [
      { predicate: assumptions, negated: false },
      { predicate: predicate, negated: certificate.claim === "proved" },
    ],
    constraints: [],
    proof: certificate.proof,
  }];
  for (const _index of indices(limits.maxSteps + 1)) {
    const task = tasks.pop();
    if (task === undefined) break;
    const checked = checkBranch(task, tasks, spend, limits.maxSteps + 1);
    if (!checked.ok) return checked;
  }
  return {
    ok: true,
    value: { stepsUsed: limits.maxSteps - remaining },
  };
}

function checkBranch(
  task: CheckTask,
  tasks: CheckTask[],
  spend: Spend,
  iterationLimit: number,
): Result<true, CertificateError> {
  const pending = [...task.pending];
  const constraints = [...task.constraints];
  for (const _index of indices(iterationLimit)) {
    const signed = pending.pop();
    if (signed === undefined) break;
    if (!spend(1)) return { ok: false, error: { tag: "limit" } };
    const node = signed.predicate;
    if (!isRecord(node) || typeof node.kind !== "string") {
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
      if (!isRecord(node.operand)) {
        return failure(
          "invalid-predicate",
          "a not node has no predicate operand",
        );
      }
      pending[pending.length] = {
        predicate: node.operand,
        negated: !signed.negated,
      };
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
        if (!spend(node.operands.length)) {
          return { ok: false, error: { tag: "limit" } };
        }
        for (const index of reverseIndices(node.operands.length)) {
          pending[pending.length] = {
            predicate: node.operands[index],
            negated: signed.negated,
          };
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
      if (!spend(node.operands.length)) {
        return { ok: false, error: { tag: "limit" } };
      }
      for (const index of reverseIndices(node.operands.length)) {
        const proof = task.proof.cases[index];
        if (!isUnsatProof(proof)) {
          return failure(
            "invalid-certificate",
            "a Boolean split case is invalid",
          );
        }
        tasks[tasks.length] = {
          pending: [
            ...pending,
            { predicate: node.operands[index], negated: signed.negated },
          ],
          constraints: [...constraints],
          proof: proof,
        };
      }
      return { ok: true, value: true };
    }
    if (node.kind === "difference") {
      const constraint = decodeConstraint(node, signed.negated);
      if (!constraint.ok) return constraint;
      constraints[constraints.length] = constraint.value;
      continue;
    }
    return failure("invalid-predicate", "a predicate has an unknown kind");
  }
  return checkCycle(task.proof, constraints, spend);
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
  spend: Spend,
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
  if (!spend(proof.constraints.length)) {
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
    cycle[cycle.length] = constraints[index];
  }
  let total = 0n;
  for (const index of indices(cycle.length)) {
    const edge = cycle[index];
    const next = cycle[(index + 1) % cycle.length];
    if (edge.right !== next.left) {
      return failure(
        "invalid-certificate",
        "the listed constraints do not form a cycle",
      );
    }
    total = total + edge.maximum;
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
    !isNormalizedInteger(node.maximum)
  ) {
    return failure(
      "invalid-predicate",
      "a difference maximum is not a normalized integer",
    );
  }
  const maximum = bigInteger(node.maximum);
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
      value: { left: left.value, right: right.value, maximum: maximum },
    };
}

type IntegerText = string;
type NormalForm = boolean;

/** True when `text` is a decimal integer with an optional minus sign and no leading zero. The text `-0` passes. */
export function isNormalizedInteger(text: IntegerText): NormalForm {
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (digits === "0") return true;
  if (digits.length === 0 || digits.startsWith("0")) return false;
  for (const digit of digits) {
    if (digit < "0" || digit > "9") return false;
  }
  return true;
}

function decodeTerm(term: unknown): Result<string, CertificateError> {
  if (!isRecord(term) || typeof term.kind !== "string") {
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

function isUnsatProof(value: unknown): value is UnsatProof {
  return isRecord(value) &&
    (value.kind === "false" || value.kind === "split" ||
      value.kind === "negative-cycle");
}

function failure(
  tag: "invalid-certificate" | "invalid-predicate" | "invalid-limit",
  message: string,
): Result<never, CertificateError> {
  return { ok: false, error: { tag: tag, message: message } };
}
