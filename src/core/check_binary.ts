// Operator typing for binary expressions. These functions are pure: they read
// the type table and decide the result type of an operator and whether the
// operands fit. `BodyChecker.binary` checks the operands, reports a mismatch,
// and records the node.

import { isErrorId } from "./ids.ts";
import { CLOSED_UNIT_IDS, DURATION_ID, INSTANT_ID, type TypeId } from "./ir.ts";
import { flattenIdentityMembers } from "./patterns.ts";
import type { ArithmeticOperator, BinaryOperator } from "./syntax_queries.ts";
import type { TypeRef, TypeTable } from "./types.ts";

function isError(table: TypeTable, ref: TypeRef): boolean {
  return table.node(ref).kind === "error";
}

/**
 * The identity id when the type, after transparent aliases, is an identity
 * over `int` or `number`. An identity over a literal union is not numeric.
 */
function numericIdentity(
  table: TypeTable,
  ref: TypeRef,
): TypeId | undefined {
  const node = table.node(table.unfoldTransparent(ref));
  if (node.kind !== "named" || isErrorId(node.id)) return undefined;
  const id = node.id;
  const base = table.identityBaseOf(id);
  if (base === undefined) return undefined;
  const baseNode = table.node(table.unfold(base));
  return baseNode.kind === "primitive" &&
      (baseNode.name === "int" || baseNode.name === "number")
    ? id
    : undefined;
}

/** The identity id when both operands have one numeric identity. */
function sharedNumericIdentity(
  table: TypeTable,
  left: TypeRef,
  right: TypeRef,
): TypeId | undefined {
  const shared = numericIdentity(table, left);
  return shared !== undefined && shared === numericIdentity(table, right)
    ? shared
    : undefined;
}

/**
 * The identity id when exactly one operand is a numeric identity and the other
 * operand is unnamed and fits the body of that identity (NI25).
 */
function adoptedNumericIdentity(
  table: TypeTable,
  module: string,
  left: TypeRef,
  right: TypeRef,
): TypeId | undefined {
  const l = numericIdentity(table, left);
  const r = numericIdentity(table, right);
  if ((l === undefined) === (r === undefined)) return undefined;
  const named = l ?? r;
  // `Duration` and `Instant` have their own operator rules.
  if (named !== undefined && CLOSED_UNIT_IDS.has(named)) return undefined;
  const unnamed = l === undefined ? left : right;
  const body = named === undefined ? undefined : table.identityBaseOf(named);
  return named !== undefined && body !== undefined &&
      table.isAssignableIn(module, unnamed, body)
    ? named
    : undefined;
}

export function isBoolean(
  table: TypeTable,
  module: string,
  ref: TypeRef,
): boolean {
  return table.isAssignableIn(module, ref, table.boolean) &&
    !isError(table, ref) && ref !== table.never;
}

/** The comparison class of a type: a primitive name or an identity. */
function comparisonClass(
  table: TypeTable,
  ref: TypeRef,
): string | undefined {
  const members = flattenIdentityMembers(table, ref);
  let found: string | undefined;
  for (const member of members) {
    const node = table.node(member);
    let current: string | undefined;
    if (node.kind === "literal") {
      current = node.value === null ? "null" : typeof node.value;
    } else if (node.kind === "primitive") {
      if (node.name === "int" || node.name === "number") current = "number";
      else if (node.name === "string" || node.name === "boolean") {
        current = node.name;
      }
    } else if (node.kind === "named" && !isErrorId(node.id)) {
      const base = table.identityBaseOf(node.id);
      if (base !== undefined && comparisonClass(table, base) !== undefined) {
        current = `identity:${node.id}`;
      }
    }
    if (current === undefined) return undefined;
    if (found !== undefined && found !== current) return undefined;
    found = current;
  }
  return found;
}

const IDENTITY_CLASS = "identity:";

/** The class of the base of an identity class, or undefined for another class. */
function baseClass(table: TypeTable, cls: string): string | undefined {
  if (!cls.startsWith(IDENTITY_CLASS)) return undefined;
  const base = table.identityBaseOf(cls.slice(IDENTITY_CLASS.length) as TypeId);
  return base === undefined ? undefined : comparisonClass(table, base);
}

/** The class and the classes of its bases, as far as widening reaches. */
function classChain(table: TypeTable, cls: string): readonly string[] {
  const chain = [cls];
  for (let next = baseClass(table, cls); next !== undefined;) {
    if (chain.includes(next)) break;
    chain.push(next);
    next = baseClass(table, next);
  }
  return chain;
}

function compatibleClasses(
  table: TypeTable,
  l: string,
  r: string,
): boolean {
  return classChain(table, l).includes(r) || classChain(table, r).includes(l);
}

function isNumericClass(table: TypeTable, cls: string): boolean {
  return classChain(table, cls).includes("number");
}

function isStringClass(table: TypeTable, cls: string): boolean {
  return classChain(table, cls).includes("string");
}

/** The closed unit class of a comparison class, or undefined for another class. */
function closedUnitClass(cls: string | undefined): string | undefined {
  return cls !== undefined && cls.startsWith(IDENTITY_CLASS) &&
      CLOSED_UNIT_IDS.has(cls.slice(IDENTITY_CLASS.length))
    ? cls
    : undefined;
}

/** A closed unit type compares only with a value of the same closed unit type. */
function closedUnitsDiffer(
  l: string | undefined,
  r: string | undefined,
): boolean {
  return (closedUnitClass(l) !== undefined ||
    closedUnitClass(r) !== undefined) &&
    l !== r;
}

/**
 * An operand of a unit rule: the id of a closed unit type, or `integral` for a
 * type that fits `int`, or `numeric` for a type that fits `int` or `number`.
 */
type UnitOperand = TypeId | "integral" | "numeric";

/**
 * The outcome of a unit rule: the id of a closed unit type, `number`, a
 * `mismatch`, or `general` when the general class rules decide.
 */
type UnitOutcome = TypeId | "number" | "mismatch" | "general";

interface UnitRule {
  readonly operator: ArithmeticOperator;
  readonly left: UnitOperand;
  readonly right: UnitOperand;
  readonly result: UnitOutcome;
}

interface UnitArithmetic {
  readonly unit: TypeId;
  /** The first rule that fits both operands decides. */
  readonly rules: readonly UnitRule[];
  /** The outcome when an operand is the unit and no rule fits. */
  readonly otherwise: UnitOutcome;
}

/**
 * The arithmetic of the closed units. A table runs in order, and the first
 * table with a unit operand decides. `Instant - Instant` is a `Duration`, and
 * an `Instant` moves by a `Duration`. A bare number has no unit, so
 * `Duration + int` and `Duration - int` do not fit.
 */
const UNIT_ARITHMETIC: readonly UnitArithmetic[] = [
  {
    unit: INSTANT_ID,
    rules: [
      {
        operator: "-",
        left: INSTANT_ID,
        right: INSTANT_ID,
        result: DURATION_ID,
      },
      {
        operator: "+",
        left: INSTANT_ID,
        right: DURATION_ID,
        result: INSTANT_ID,
      },
      {
        operator: "+",
        left: DURATION_ID,
        right: INSTANT_ID,
        result: INSTANT_ID,
      },
      {
        operator: "-",
        left: INSTANT_ID,
        right: DURATION_ID,
        result: INSTANT_ID,
      },
    ],
    otherwise: "mismatch",
  },
  {
    unit: DURATION_ID,
    rules: [
      {
        operator: "+",
        left: DURATION_ID,
        right: DURATION_ID,
        result: DURATION_ID,
      },
      {
        operator: "-",
        left: DURATION_ID,
        right: DURATION_ID,
        result: DURATION_ID,
      },
      {
        operator: "*",
        left: DURATION_ID,
        right: DURATION_ID,
        result: "general",
      },
      {
        operator: "/",
        left: DURATION_ID,
        right: DURATION_ID,
        result: "number",
      },
      {
        operator: "+",
        left: DURATION_ID,
        right: "numeric",
        result: "mismatch",
      },
      {
        operator: "+",
        left: "numeric",
        right: DURATION_ID,
        result: "mismatch",
      },
      {
        operator: "-",
        left: DURATION_ID,
        right: "numeric",
        result: "mismatch",
      },
      {
        operator: "-",
        left: "numeric",
        right: DURATION_ID,
        result: "mismatch",
      },
      {
        operator: "*",
        left: DURATION_ID,
        right: "integral",
        result: DURATION_ID,
      },
      {
        operator: "*",
        left: "integral",
        right: DURATION_ID,
        result: DURATION_ID,
      },
      {
        operator: "/",
        left: DURATION_ID,
        right: "integral",
        result: DURATION_ID,
      },
    ],
    otherwise: "general",
  },
];

function isUnit(table: TypeTable, ref: TypeRef, unit: TypeId): boolean {
  const node = table.node(table.unfoldTransparent(ref));
  return node.kind === "named" && node.id === unit;
}

function fitsUnitOperand(
  table: TypeTable,
  module: string,
  operand: UnitOperand,
  ref: TypeRef,
): boolean {
  switch (operand) {
    case "integral":
      return table.isAssignableIn(module, ref, table.int);
    case "numeric":
      return table.isAssignableIn(module, ref, table.int) ||
        table.isAssignableIn(module, ref, table.number);
    default:
      return isUnit(table, ref, operand);
  }
}

/**
 * The arithmetic of the closed units, or undefined when the general rules
 * decide.
 */
function unitArithmetic(
  table: TypeTable,
  module: string,
  operator: ArithmeticOperator,
  left: TypeRef,
  right: TypeRef,
): OperatorResult | undefined {
  for (const row of UNIT_ARITHMETIC) {
    if (!isUnit(table, left, row.unit) && !isUnit(table, right, row.unit)) {
      continue;
    }
    const rule = row.rules.find((candidate) =>
      candidate.operator === operator &&
      fitsUnitOperand(table, module, candidate.left, left) &&
      fitsUnitOperand(table, module, candidate.right, right)
    );
    const outcome = rule?.result ?? row.otherwise;
    switch (outcome) {
      case "general":
        return undefined;
      case "mismatch":
        return { type: table.error, mismatch: true };
      case "number":
        return { type: table.number, mismatch: false };
      default:
        return { type: table.named(outcome), mismatch: false };
    }
  }
  return undefined;
}

/** The result type of a binary operator, and whether the operands do not fit it. */
interface OperatorResult {
  readonly type: TypeRef;
  readonly mismatch: boolean;
  readonly sealed?: TypeId;
}

export function operatorResult(
  table: TypeTable,
  module: string,
  operator: BinaryOperator,
  left: TypeRef,
  right: TypeRef,
): OperatorResult {
  const either = isError(table, left) || isError(table, right);
  switch (operator) {
    case "&&":
    case "||": {
      const mismatch = !either &&
        !(isBoolean(table, module, left) && isBoolean(table, module, right));
      return { type: table.boolean, mismatch };
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      // `isNumeric` widens an identity to its base, so the classes decide.
      const l = comparisonClass(table, left);
      const r = comparisonClass(table, right);
      const mismatch = !either &&
        (closedUnitsDiffer(l, r) ||
          !(l !== undefined && r !== undefined &&
            compatibleClasses(table, l, r) &&
            isNumericClass(table, l) && isNumericClass(table, r)));
      return { type: table.boolean, mismatch };
    }
    case "===":
    case "!==": {
      let mismatch = false;
      if (!either) {
        const l = comparisonClass(table, left);
        const r = comparisonClass(table, right);
        const isNull = (ref: TypeRef) => {
          const type = table.node(table.unfold(ref));
          return type.kind === "literal" && type.value === null;
        };
        const nullable = (isNull(left) && table.isAssignable(left, right)) ||
          (isNull(right) && table.isAssignable(right, left));
        if (
          !nullable &&
          (l === undefined || r === undefined ||
            !compatibleClasses(table, l, r) || closedUnitsDiffer(l, r))
        ) {
          mismatch = true;
        }
      }
      return { type: table.boolean, mismatch };
    }
    case "+":
    case "-":
    case "*":
    case "/": {
      // An error operand hides whether the result is int or number.
      if (either) return { type: table.error, mismatch: false };
      const sealed = table.foreignSealedOf(module, left) ??
        table.foreignSealedOf(module, right);
      if (sealed !== undefined) {
        return { type: table.error, mismatch: false, sealed };
      }
      // A bare number has no unit, and a widened operand needs no shared class.
      const unit = unitArithmetic(table, module, operator, left, right);
      if (unit !== undefined) return unit;
      const l = comparisonClass(table, left);
      const r = comparisonClass(table, right);
      if (
        l === undefined || r === undefined || !compatibleClasses(table, l, r)
      ) {
        return { type: table.error, mismatch: true };
      }
      if (operator === "+" || operator === "-") {
        const shared = sharedNumericIdentity(table, left, right);
        if (shared !== undefined) {
          return { type: table.named(shared), mismatch: false };
        }
      }
      // One named operand and one unnamed operand that fits its body: the
      // result keeps the name, in either operand order.
      if (operator !== "/") {
        const named = adoptedNumericIdentity(table, module, left, right);
        if (named !== undefined) {
          return { type: table.named(named), mismatch: false };
        }
      }
      if (isNumericClass(table, l) && isNumericClass(table, r)) {
        const integral = operator !== "/" &&
          table.isAssignableIn(module, left, table.int) &&
          table.isAssignableIn(module, right, table.int);
        return {
          type: integral ? table.int : table.number,
          mismatch: false,
        };
      }
      if (
        operator === "+" && isStringClass(table, l) && isStringClass(table, r)
      ) {
        return { type: table.string, mismatch: false };
      }
      return { type: table.error, mismatch: true };
    }
    default: {
      const unreachable: never = operator;
      return unreachable;
    }
  }
}
