// The child types of a type, and the bounded walk over them. The type walkers of the validator descend
// through `typeChildren`, so a new Type kind is a compile error here and
// nowhere else. A child comes with the IR path suffix that diagnostics use.

import type { Report, ValidationPath } from "./report.ts";
import type { Span, Type } from "../ir.ts";

// The bound on the recursion of one comparison. The parser limits written
// nesting to 512 levels and `declaration/012` limits an alias to 128 levels.
// So one type is at most about 640 levels deep, and two types give at most
// about 1280 frames. 1536 leaves room above that. The type walkers that
// report depth use the same bound and report a type that goes past it.
export const MAX_DEPTH = 1536;

export type TypeWalkState = {
  readonly report: Report;
  readonly valid: boolean;
};

/** A child type and the IR path suffix from its parent, such as `.fields[0].type`. */
type TypeChild = {
  readonly type: Type;
  readonly suffix: string;
};

function child(type: Type, suffix: string): TypeChild {
  return { type: type, suffix: suffix };
}

/**
 * The child types of `t`, in the order the walkers visit them. Identities
 * (failure and capability ids) are not child types. A leaf has no children.
 */
export function typeChildren(t: Type): readonly TypeChild[] {
  if (
    t.kind === "primitive" || t.kind === "literal" || t.kind === "named" ||
    t.kind === "provider"
  ) return [];
  if (t.kind === "record") {
    return t.fields.map((f, i) => child(f.type, `.fields[${i}].type`));
  }
  if (t.kind === "array" || t.kind === "option" || t.kind === "ref") {
    return [child(t.element, ".element")];
  }
  if (t.kind === "retry-schedule") return [child(t.error, ".error")];
  if (t.kind === "schema") {
    return t.makeInput === undefined
      ? [child(t.decoded, ".decoded"), child(t.encoded, ".encoded")]
      : [
        child(t.decoded, ".decoded"),
        child(t.encoded, ".encoded"),
        child(t.makeInput, ".makeInput"),
      ];
  }
  if (t.kind === "effect") return [child(t.result, ".result")];
  if (t.kind === "stream") return [child(t.element, ".element")];
  if (t.kind === "sink") {
    return t.leftover === undefined
      ? [child(t.input, ".input"), child(t.result, ".result")]
      : [
        child(t.input, ".input"),
        child(t.result, ".result"),
        child(t.leftover, ".leftover"),
      ];
  }
  if (t.kind === "tuple") {
    return t.elements.map((e, i) => child(e, `.elements[${i}]`));
  }
  if (t.kind === "union") {
    return t.members.map((m, i) => child(m, `.members[${i}]`));
  }
  return [
    ...t.parameters.map((p, i) => child(p, `.parameters[${i}]`)),
    child(t.result, ".result"),
  ];
}

/**
 * Walks a type and its children in the order of `typeChildren`. `enter` runs
 * on a node before its children, and `leave` after them. A node deeper than
 * `MAX_DEPTH` stops its branch and gets the one depth report of its declaration.
 */
export function walkTypeBounded(
  initial: TypeWalkState,
  span: Span,
  type: Type,
  path: ValidationPath,
  enter: (state: TypeWalkState, t: Type, at: string) => TypeWalkState,
  leave:
    | ((state: TypeWalkState, t: Type, at: string) => TypeWalkState)
    | undefined,
): TypeWalkState {
  function unchanged(
    current: TypeWalkState,
    _t: Type,
    _at: string,
  ): TypeWalkState {
    return current;
  }
  const leaveType = leave === undefined ? unchanged : leave;
  function walk(
    current: TypeWalkState,
    t: Type,
    at: string,
    depth: number,
  ): TypeWalkState {
    if (depth > MAX_DEPTH) {
      return {
        ...current,
        report: current.report.addDepth(at, MAX_DEPTH, span),
      };
    }
    let next = enter(current, t, at);
    for (const c of typeChildren(t)) {
      next = walk(next, c.type, `${at}${c.suffix}`, depth + 1);
    }
    return leaveType(next, t, at);
  }
  return walk(initial, type, path, 0);
}
