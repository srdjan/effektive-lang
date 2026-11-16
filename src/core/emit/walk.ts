import { emptySet } from "../runtime.ts";
// Traversals of the typed IR that the emitter shares: children, binders, and
// the references of a declaration.
import type {
  Declaration,
  Expr,
  LocalId,
  Parameter,
  Pattern,
  ValueId,
} from "../ir.ts";
import { childrenOf } from "./shape.ts";
import { isValueId } from "../ids.ts";
export function patternBinding(pattern: Pattern): Parameter | null {
  if (
    pattern.kind === "bind" || pattern.kind === "some" ||
    pattern.kind === "error" || pattern.kind === "nominal" ||
    pattern.kind === "tag"
  ) {
    return pattern.binding;
  }
  return null;
}
/** The binders that `expr` itself introduces (not those of its children). */
function bindersOf(expr: Expr): Parameter[] {
  if (expr.kind === "closure") return [...expr.parameters];
  if (expr.kind === "block") {
    return expr.steps.flatMap((s) => s.kind === "bind" ? [s.binding] : []);
  }
  if (expr.kind === "match") {
    return expr.arms.flatMap((a) => {
      const binding = patternBinding(a.pattern);
      return binding === null ? [] : [binding];
    });
  }
  if (expr.kind === "catch") {
    return [
      ...expr.handlers.map((h) => h.binding),
      ...(expr.defect === undefined ? [] : [expr.defect.binding]),
    ];
  }
  return [];
}
/** Calls `visit` on `expr` and on every expression below it, parents first. */
export function walkExpr<State>(
  expr: Expr,
  state: State,
  visit: (state: State, e: Expr) => State,
): State {
  let next = visit(state, expr);
  for (const child of childrenOf(expr)) {
    next = walkExpr(child, next, visit);
  }
  return next;
}
function rootOf(declaration: Declaration): Expr | undefined {
  if (declaration.kind === "function") return declaration.body;
  if (declaration.kind === "constant") return declaration.value;
  return undefined;
}
/** Calls `visit` for each local binder of a declaration: parameters and inner binders. */
export function binderNames(declaration: Declaration): readonly (readonly [
  LocalId,
  string,
])[] {
  const names: (readonly [
    LocalId,
    string,
  ])[] = [];
  if (declaration.kind === "function") {
    for (const p of declaration.parameters) {
      names[names.length] = [p.id, p.name];
    }
  }
  const root = rootOf(declaration);
  if (root === undefined) {
    return names;
  }
  return walkExpr(root, names, (collected, e) => {
    for (const binder of bindersOf(e)) {
      collected[collected.length] = [binder.id, binder.name];
    }
    return collected;
  });
}
/** The module-level values that a declaration refers to, without duplicates. */
export function valueReferences(declaration: Declaration): ValueId[] {
  const root = rootOf(declaration);
  if (root === undefined) {
    return [];
  }
  const found = walkExpr(root, emptySet<ValueId>(), (references, e) => {
    if (e.kind === "reference" && isValueId(e.target)) {
      return references.add(e.target);
    }
    return references;
  });
  return [...found];
}
