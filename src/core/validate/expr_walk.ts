// Walks of the expression tree of the IR. The body validator and the borrow
// checks of the families share these walks.

import type { Expr } from "../ir.ts";

/**
 * The nearest child expressions of a node. The final branch makes the function
 * exhaustive because TypeScript narrows the remaining expression to binary.
 */
export function exprChildren(e: Expr): readonly Expr[] {
  if (e.kind === "take-sink") return [];
  if (e.kind === "now") return [];
  if (e.kind === "random") return [];
  if (e.kind === "null") return [];
  if (e.kind === "literal") return [];
  if (e.kind === "reference") return [];
  if (e.kind === "none") return [];
  if (e.kind === "record") return e.fields.map((f) => f.value);
  if (e.kind === "error") return e.fields.map((f) => f.value);
  if (e.kind === "array") return [...e.elements];
  if (e.kind === "tuple") return [...e.elements];
  if (e.kind === "get") return [e.record];
  if (e.kind === "update") {
    return [e.record, ...e.fields.map((f) => f.value)];
  }
  if (e.kind === "nominal") return [e.value];
  if (e.kind === "some") return [e.value];
  if (e.kind === "run") return [e.value];
  if (e.kind === "scoped") return [e.value];
  if (e.kind === "closure") return [e.body];
  if (e.kind === "call") return [e.callee, ...e.arguments];
  if (e.kind === "with-resource") return [e.acquire, e.use, e.release];
  if (e.kind === "unfold") return [e.seed, e.next];
  if (e.kind === "map-effect") return [e.stream, e.transform];
  if (e.kind === "map-stream") return [e.stream, e.transform];
  if (e.kind === "sink-for-each") return [e.consume];
  if (e.kind === "transduce-stream") return [e.stream, e.sink];
  if (e.kind === "run-stream") return [e.stream, e.sink];
  if (e.kind === "buffer-stream") return [e.stream];
  if (e.kind === "race") return [e.left, e.right];
  if (e.kind === "make-ref") return [e.value];
  if (e.kind === "repeat") {
    if (e.options === null) return [e.job];
    return [e.job, e.options];
  }
  if (e.kind === "uninterruptible") return [e.job];
  if (e.kind === "race-all") return [e.jobs];
  if (e.kind === "sleep") return [e.durationMs];
  if (e.kind === "log") {
    if (e.fields === null) return [e.message];
    return [e.message, e.fields];
  }
  if (e.kind === "random-int") return [e.min, e.max];
  if (e.kind === "timeout") return [e.job, e.durationMs];
  if (e.kind === "get-ref") return [e.ref];
  if (e.kind === "set-ref") return [e.ref, e.value];
  if (e.kind === "update-ref") return [e.ref, e.transform];
  if (e.kind === "layer") return [e.acquire];
  if (e.kind === "merge-layers") return [e.left, e.right];
  if (e.kind === "retry-schedule") return [e.step];
  if (e.kind === "retry-with-schedule") return [e.job, e.options];
  if (e.kind === "schema") return [...e.arguments];
  if (e.kind === "schema-make") return [e.schema, e.input];
  if (e.kind === "schema-decode") return [e.schema, e.input];
  if (e.kind === "schema-encode") return [e.schema, e.input];
  if (e.kind === "defer") return [e.job];
  if (e.kind === "retry") return [e.job];
  if (e.kind === "fork-scoped") return [e.job];
  if (e.kind === "perform") return [...e.arguments];
  if (e.kind === "block") {
    return [...e.steps.map((s) => s.value), e.result];
  }
  if (e.kind === "if") return [e.condition, e.then, e.else];
  if (e.kind === "match") {
    return [e.subject, ...e.arms.map((a) => a.body)];
  }
  if (e.kind === "fail") return [e.error];
  if (e.kind === "catch") {
    const defect = e.defect === undefined ? [] : [e.defect.body];
    return [e.body, ...e.handlers.map((h) => h.body), ...defect];
  }
  if (e.kind === "ensure") return [e.body, e.finalizer];
  if (e.kind === "provide") return [e.provider, e.job];
  return [e.left, e.right];
}

/**
 * Visits `body` and every expression below it, parents first. The visitor
 * gets the node, its parent, its grandparent, and whether a closure lies
 * between the node and `body`. The closure itself is not nested.
 */
export function walkExprs<State>(
  body: Expr,
  initial: State,
  visit: (
    state: State,
    e: Expr,
    parent: Expr | undefined,
    grandparent: Expr | undefined,
    nested: boolean,
  ) => State,
): State {
  function go(
    state: State,
    e: Expr,
    parent: Expr | undefined,
    grandparent: Expr | undefined,
    nested: boolean,
  ): State {
    let next = visit(state, e, parent, grandparent, nested);
    for (const child of exprChildren(e)) {
      next = go(next, child, e, parent, nested || e.kind === "closure");
    }
    return next;
  }
  return go(initial, body, undefined, undefined, false);
}
