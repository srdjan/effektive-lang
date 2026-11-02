// Walks of the expression tree of the IR. The body validator and the borrow
// checks of the families share these walks.

import type { Expr } from "../ir.ts";

/**
 * The nearest child expressions of a node. The switch has no default case, so
 * the compiler rejects a new Expr kind that the switch does not name.
 */
export function exprChildren(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case "take-sink":
    case "now":
    case "random":
    case "null":
    case "literal":
    case "reference":
    case "none":
      return [];
    case "record":
    case "error":
      return e.fields.map((f) => f.value);
    case "array":
    case "tuple":
      return [...e.elements];
    case "get":
      return [e.record];
    case "update":
      return [e.record, ...e.fields.map((f) => f.value)];
    case "nominal":
    case "some":
    case "run":
    case "scoped":
      return [e.value];
    case "closure":
      return [e.body];
    case "call":
      return [e.callee, ...e.arguments];
    case "with-resource":
      return [e.acquire, e.use, e.release];
    case "unfold":
      return [e.seed, e.next];
    case "map-groups":
      return [e.stream, e.key, e.use];
    case "map-effect":
    case "map-stream":
    case "flat-map-streams":
    case "switch-map-streams":
      return [e.stream, e.transform];
    case "catch-stream":
      return [e.stream, e.recover];
    case "retry-stream":
      return [e.stream, e.policy];
    case "debounce-stream":
    case "throttle-stream":
      return [e.stream];
    case "scan-stream":
    case "map-accum-stream":
    case "fold-stream":
    case "fold-effect-stream":
      return [e.stream, e.seed, e.update];
    case "collect-stream":
    case "head-stream":
    case "last-stream":
    case "drain-stream":
      return [e.stream];
    case "take-stream":
      return [e.stream, e.count];
    case "drop-stream":
      return [e.stream, e.count];
    case "drop-while-stream":
      return [e.stream, e.predicate];
    case "filter-stream":
    case "filter-effect-stream":
    case "take-while-effect-stream":
    case "take-until-effect-stream":
    case "drop-while-effect-stream":
      return [e.stream, e.predicate];
    case "take-while-stream":
      return [e.stream, e.predicate];
    case "take-until-stream":
      return [e.stream, e.predicate];
    case "sink-for-each":
      return [e.consume];
    case "transduce-stream":
    case "aggregate-stream":
    case "run-stream":
      return [e.stream, e.sink];
    case "buffer-stream":
      return [e.stream];
    case "merge-streams":
    case "zip-streams":
    case "concat-streams":
      return [e.left, e.right];
    case "race":
      return [e.left, e.right];
    case "make-ref":
      return [e.value];
    case "repeat":
      return e.options === null ? [e.job] : [e.job, e.options];
    case "uninterruptible":
      return [e.job];
    case "race-all":
      return [e.jobs];
    case "sleep":
      return [e.durationMs];
    case "log":
      return e.fields === null ? [e.message] : [e.message, e.fields];
    case "random-int":
      return [e.min, e.max];
    case "timeout":
      return [e.job, e.durationMs];
    case "get-ref":
      return [e.ref];
    case "set-ref":
      return [e.ref, e.value];
    case "update-ref":
      return [e.ref, e.transform];
    case "layer":
      return [e.acquire];
    case "merge-layers":
      return [e.left, e.right];
    case "retry-schedule":
      return [e.step];
    case "retry-with-schedule":
      return [e.job, e.options];
    case "schema":
      return [...e.arguments];
    case "schema-make":
    case "schema-decode":
    case "schema-encode":
      return [e.schema, e.input];
    case "with-fiber":
      return [e.job, e.use];
    case "join-fiber":
    case "interrupt-fiber":
      return [e.fiber];
    case "defer":
    case "retry":
    case "fork-scoped":
      return [e.job];
    case "perform":
      return [...e.arguments];
    case "block":
      return [...e.steps.map((s) => s.value), e.result];
    case "if":
      return [e.condition, e.then, e.else];
    case "match":
      return [e.subject, ...e.arms.map((a) => a.body)];
    case "fail":
      return [e.error];
    case "catch":
      return [
        e.body,
        ...e.handlers.map((h) => h.body),
        ...(e.defect === undefined ? [] : [e.defect.body]),
      ];
    case "ensure":
      return [e.body, e.finalizer];
    case "provide":
      return [e.provider, e.job];
    case "binary":
      return [e.left, e.right];
  }
}

/**
 * Visits `body` and every expression below it, parents first. The visitor
 * gets the node, its parent, its grandparent, and whether a closure lies
 * between the node and `body`. The closure itself is not nested.
 */
export function walkExprs(
  body: Expr,
  visit: (
    e: Expr,
    parent: Expr | undefined,
    grandparent: Expr | undefined,
    nested: boolean,
  ) => void,
): void {
  const go = (
    e: Expr,
    parent: Expr | undefined,
    grandparent: Expr | undefined,
    nested: boolean,
  ): void => {
    visit(e, parent, grandparent, nested);
    for (const child of exprChildren(e)) {
      go(child, e, parent, nested || e.kind === "closure");
    }
  };
  go(body, undefined, undefined, false);
}
