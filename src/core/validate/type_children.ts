// The child types of a type, and the bounded walk over them. The type walkers of the validator descend
// through `typeChildren`, so a new Type kind is a compile error here and
// nowhere else. A child comes with the IR path suffix that diagnostics use.

import type { Span, Type } from "../ir.ts";
import type { Report } from "./report.ts";

// The bound on the recursion of one comparison. The parser limits written
// nesting to 512 levels and `declaration/012` limits an alias to 128 levels.
// So one type is at most about 640 levels deep, and two types give at most
// about 1280 frames. 1536 leaves room above that. The type walkers that
// report depth use the same bound and report a type that goes past it.
export const MAX_DEPTH = 1536;

/** A child type and the IR path suffix from its parent, such as `.fields[0].type`. */
interface TypeChild {
  readonly type: Type;
  readonly suffix: string;
}

const child = (type: Type, suffix: string): TypeChild => ({ type, suffix });

/**
 * The child types of `t`, in the order the walkers visit them. Identities
 * (failure and capability ids) are not child types. A leaf has no children.
 */
export function typeChildren(t: Type): readonly TypeChild[] {
  switch (t.kind) {
    case "primitive":
    case "literal":
    case "named":
    case "provider":
      return [];
    case "record":
      return t.fields.map((f, i) => child(f.type, `.fields[${i}].type`));
    case "array":
    case "option":
    case "ref":
      return [child(t.element, ".element")];
    case "retry-schedule":
      return [child(t.error, ".error")];
    case "schema":
      return t.makeInput === undefined
        ? [child(t.decoded, ".decoded"), child(t.encoded, ".encoded")]
        : [
          child(t.decoded, ".decoded"),
          child(t.encoded, ".encoded"),
          child(t.makeInput, ".makeInput"),
        ];
    case "effect":
      return [child(t.result, ".result")];
    case "stream":
      return [child(t.element, ".element")];
    case "sink":
      return t.leftover === undefined
        ? [child(t.input, ".input"), child(t.result, ".result")]
        : [
          child(t.input, ".input"),
          child(t.result, ".result"),
          child(t.leftover, ".leftover"),
        ];
    case "tuple":
      return t.elements.map((e, i) => child(e, `.elements[${i}]`));
    case "union":
      return t.members.map((m, i) => child(m, `.members[${i}]`));
    case "function":
      return [
        ...t.parameters.map((p, i) => child(p, `.parameters[${i}]`)),
        child(t.result, ".result"),
      ];
    default: {
      const unreachable: never = t;
      return unreachable;
    }
  }
}

/**
 * Walks a type and its children in the order of `typeChildren`. `enter` runs
 * on a node before its children, and `leave` after them. A node deeper than
 * `MAX_DEPTH` stops its branch and gets the one depth report of its declaration.
 */
export function walkTypeBounded(
  report: Report,
  span: Span,
  type: Type,
  path: string,
  enter: (t: Type, at: string) => void,
  leave: (t: Type, at: string) => void = () => {},
): void {
  const walk = (t: Type, at: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      report.addDepth(at, MAX_DEPTH, span);
      return;
    }
    enter(t, at);
    for (const c of typeChildren(t)) {
      walk(c.type, `${at}${c.suffix}`, depth + 1);
    }
    leave(t, at);
  };
  walk(type, path, 0);
}
