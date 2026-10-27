// Operator typing for binary expressions. These functions are pure: they read
// the type table and decide the result type of an operator and whether the
// operands fit. `BodyChecker.binary` checks the operands, reports a mismatch,
// and records the node.

import { isErrorId } from "./ids.ts";
import { DURATION_ID, type TypeId } from "./ir.ts";
import { flattenIdentityMembers } from "./patterns.ts";
import type { BinaryOperator } from "./syntax_queries.ts";
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
  // `Duration` has its own operator rules.
  if (named === DURATION_ID) return undefined;
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

/** Two classes are compatible when one widens to the other. */
function compatibleClasses(
  table: TypeTable,
  l: string,
  r: string,
): boolean {
  return classChain(table, l).includes(r) || classChain(table, r).includes(l);
}

/** True when the class widens to `number`. */
function isNumericClass(table: TypeTable, cls: string): boolean {
  return classChain(table, cls).includes("number");
}

function isStringClass(table: TypeTable, cls: string): boolean {
  return classChain(table, cls).includes("string");
}

function isDuration(table: TypeTable, ref: TypeRef): boolean {
  const node = table.node(table.unfoldTransparent(ref));
  return node.kind === "named" && node.id === DURATION_ID;
}

/**
 * The arithmetic of `Duration`, or undefined when the general rules decide. A
 * bare number has no unit, so `Duration + int` and `Duration - int` do not fit.
 */
function durationArithmetic(
  table: TypeTable,
  module: string,
  operator: "+" | "-" | "*" | "/",
  left: TypeRef,
  right: TypeRef,
): OperatorResult | undefined {
  const l = isDuration(table, left);
  const r = isDuration(table, right);
  if (!l && !r) return undefined;
  const duration = { type: table.named(DURATION_ID), mismatch: false };
  if (l && r) {
    if (operator === "/") return { type: table.number, mismatch: false };
    return operator === "*" ? undefined : duration;
  }
  const other = l ? right : left;
  const integral = table.isAssignableIn(module, other, table.int);
  switch (operator) {
    case "+":
    case "-":
      // A bare number has no unit, so it never adds to a Duration.
      return integral || table.isAssignableIn(module, other, table.number)
        ? { type: table.error, mismatch: true }
        : undefined;
    case "*":
      return integral ? duration : undefined;
    case "/":
      return l && integral ? duration : undefined;
  }
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
        !(l !== undefined && r !== undefined &&
          compatibleClasses(table, l, r) &&
          isNumericClass(table, l) && isNumericClass(table, r));
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
            !compatibleClasses(table, l, r))
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
      const duration = durationArithmetic(table, module, operator, left, right);
      if (duration !== undefined) return duration;
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
