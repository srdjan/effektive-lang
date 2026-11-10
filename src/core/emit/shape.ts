// The shape of every IR expression kind, for the emitter walkers. One table
// states, for each kind, which sub-expressions it has, which of them it defers,
// and whether the emitter treats it as a leaf effect. `childrenOf`,
// `evaluatedChildren`, and `isLeafExpr` derive from the table. A new Expr kind
// is a compile error until it has a row. The validator keeps its own child
// list (`validate/expr_walk.ts` exprChildren) and must not import this module.

import type { Expr } from "../ir.ts";

type ExprKind = Expr["kind"];

/**
 * The members of Expr that have the kind `K`. A member that has several kinds
 * belongs to each of its kinds.
 */
export type ExprOf<K extends ExprKind> = Expr extends infer E
  ? E extends Expr ? K extends E["kind"] ? E : never : never
  : never;

/**
 * How the emitter treats a kind.
 * - `leaf`: an Effect operation. The emitter prints it with `leaf`, after it
 *   prints the evaluated children.
 * - `call`: a leaf only when the callee is an effectful function. The emitter
 *   decides with the callee type, so the table cannot.
 * - `structural`: an ordinary expression that the emitter prints from its
 *   parts.
 */
type LeafRule = "leaf" | "call" | "structural";

interface Shape<E extends Expr> {
  /**
   * The sub-expressions that the node evaluates when it runs, in order. A leaf
   * evaluates them before it runs.
   */
  readonly children: (e: E) => readonly Expr[];
  /**
   * The sub-expressions that the node runs later, or under its own control: a
   * handler body, a job, or a closure that a library call receives. They follow
   * `children` in the order of all sub-expressions.
   */
  readonly deferred?: (e: E) => readonly Expr[];
  readonly leaf: LeafRule;
}

type ShapeTable = { readonly [K in ExprKind]: Shape<ExprOf<K>> };

/**
 * An operand that a builtin runs later, such as a job, still runs its own
 * expression first when that expression has effects. `retry(make(), ...)` calls
 * `make` once, before `retry` starts. The effectful operands are evaluated
 * children, and the pure operands stay deferred.
 */
const effectful = (operands: readonly Expr[]): Expr[] =>
  operands.filter((x) => x.execution === "effect");
const pure = (operands: readonly Expr[]): Expr[] =>
  operands.filter((x) => x.execution !== "effect");

/** The operands of `repeat` in source order: the job, then the options when present. */
export const repeatOperands = (e: ExprOf<"repeat">): Expr[] =>
  e.options === null ? [e.job] : [e.job, e.options];

const ROWS = {
  literal: { children: () => [], leaf: "structural" },
  null: { children: () => [], leaf: "structural" },
  reference: { children: () => [], leaf: "structural" },
  record: {
    children: (e) => e.fields.map((f) => f.value),
    leaf: "structural",
  },
  array: { children: (e) => e.elements, leaf: "structural" },
  tuple: { children: (e) => e.elements, leaf: "structural" },
  get: { children: (e) => [e.record], leaf: "structural" },
  update: {
    children: (e) => [e.record, ...e.fields.map((f) => f.value)],
    leaf: "structural",
  },
  nominal: { children: (e) => [e.value], leaf: "structural" },
  some: { children: (e) => [e.value], leaf: "structural" },
  none: { children: () => [], leaf: "structural" },
  error: {
    children: (e) => e.fields.map((f) => f.value),
    leaf: "structural",
  },
  closure: { children: (e) => [e.body], leaf: "structural" },
  call: { children: (e) => [e.callee, ...e.arguments], leaf: "call" },
  defer: { children: (e) => [e.job], leaf: "structural" },
  run: { children: (e) => [e.value], leaf: "leaf" },
  scoped: { children: (e) => [e.value], leaf: "leaf" },
  "fork-scoped": { children: (e) => [e.job], leaf: "leaf" },
  "with-resource": {
    children: () => [],
    deferred: (e) => [e.acquire, e.use, e.release],
    leaf: "leaf",
  },
  unfold: { children: (e) => [e.seed, e.next], leaf: "structural" },
  "map-effect": {
    children: (e) => [e.stream, e.transform],
    leaf: "structural",
  },
  "map-stream": {
    children: (e) => [e.stream, e.transform],
    leaf: "structural",
  },
  "race-all": { children: (e) => [e.jobs], leaf: "structural" },
  "sink-for-each": { children: (e) => [e.consume], leaf: "structural" },
  "take-sink": { children: () => [], leaf: "structural" },
  "transduce-stream": {
    children: (e) => [e.stream, e.sink],
    leaf: "structural",
  },
  "run-stream": { children: (e) => [e.stream, e.sink], leaf: "leaf" },
  "buffer-stream": { children: (e) => [e.stream], leaf: "structural" },
  race: { children: (e) => [e.left, e.right], leaf: "structural" },
  "make-ref": { children: (e) => [e.value], leaf: "leaf" },
  "get-ref": { children: (e) => [e.ref], leaf: "leaf" },
  "set-ref": { children: (e) => [e.ref, e.value], leaf: "leaf" },
  "update-ref": { children: (e) => [e.ref, e.transform], leaf: "leaf" },
  layer: { children: (e) => [e.acquire], leaf: "structural" },
  "merge-layers": { children: (e) => [e.left, e.right], leaf: "structural" },
  "retry-schedule": { children: (e) => [e.step], leaf: "structural" },
  "retry-with-schedule": {
    children: (e) => effectful([e.job, e.options]),
    deferred: (e) => pure([e.job, e.options]),
    leaf: "leaf",
  },
  schema: { children: (e) => e.arguments, leaf: "structural" },
  "schema-decode": { children: (e) => [e.schema, e.input], leaf: "leaf" },
  "schema-encode": { children: (e) => [e.schema, e.input], leaf: "leaf" },
  "schema-make": { children: (e) => [e.schema, e.input], leaf: "leaf" },
  perform: { children: (e) => e.arguments, leaf: "leaf" },
  block: {
    children: (e) => [...e.steps.map((s) => s.value), e.result],
    leaf: "structural",
  },
  if: {
    children: (e) => [e.condition, e.then, e.else],
    leaf: "structural",
  },
  match: {
    children: (e) => [e.subject, ...e.arms.map((a) => a.body)],
    leaf: "structural",
  },
  fail: { children: (e) => [e.error], leaf: "leaf" },
  catch: {
    children: () => [],
    deferred: (e) => [
      e.body,
      ...e.handlers.map((h) => h.body),
      ...(e.defect === undefined ? [] : [e.defect.body]),
    ],
    leaf: "leaf",
  },
  ensure: {
    children: () => [],
    deferred: (e) => [e.body, e.finalizer],
    leaf: "leaf",
  },
  retry: {
    children: (e) => effectful([e.job]),
    deferred: (e) => pure([e.job]),
    leaf: "leaf",
  },
  timeout: {
    children: (e) => [e.durationMs],
    deferred: (e) => [e.job],
    leaf: "leaf",
  },
  repeat: {
    children: (e) => effectful(repeatOperands(e)),
    deferred: (e) => pure(repeatOperands(e)),
    leaf: "leaf",
  },
  sleep: { children: (e) => [e.durationMs], leaf: "leaf" },
  now: { children: () => [], leaf: "leaf" },
  log: {
    children: (e) => e.fields === null ? [e.message] : [e.message, e.fields],
    leaf: "leaf",
  },
  random: { children: () => [], leaf: "leaf" },
  "random-int": { children: (e) => [e.min, e.max], leaf: "leaf" },
  uninterruptible: {
    children: () => [],
    deferred: (e) => [e.job],
    leaf: "leaf",
  },
  provide: {
    children: () => [],
    deferred: (e) => [e.provider, e.job],
    leaf: "leaf",
  },
  binary: { children: (e) => [e.left, e.right], leaf: "structural" },
} as const satisfies ShapeTable;

export type LeafKind = {
  readonly [K in ExprKind]: (typeof ROWS)[K]["leaf"] extends "leaf" ? K
    : never;
}[ExprKind];

/**
 * `K` itself, when the table marks every member of `K` as `leaf`. A family
 * names its leaf kinds with it, so a name that the table does not mark as a
 * leaf is a type error.
 */
export type LeafOf<K extends LeafKind> = K;

/** The expressions that the emitter always prints as leaf effects. */
type LeafExpr = ExprOf<LeafKind>;

const TABLE: ShapeTable = ROWS;

function rowChildren<K extends ExprKind>(kind: K, expr: ExprOf<K>): Expr[] {
  const row = TABLE[kind];
  return [...row.children(expr), ...(row.deferred?.(expr) ?? [])];
}

function rowEvaluated<K extends ExprKind>(kind: K, expr: ExprOf<K>): Expr[] {
  const row = TABLE[kind];
  return row.leaf === "structural" ? [] : [...row.children(expr)];
}

/** The direct sub-expressions of `expr`, in evaluation order. */
export function childrenOf(expr: Expr): Expr[] {
  return rowChildren(expr.kind, expr);
}

/**
 * The children that a leaf, or a call, evaluates before it runs, in source
 * order. A structural node has none: the emitter prints its parts itself.
 */
export function evaluatedChildren(expr: Expr): Expr[] {
  return rowEvaluated(expr.kind, expr);
}

/** True when the table marks the kind as a leaf. A call is not one: see `LeafRule`. */
export function isLeafExpr(expr: Expr): expr is LeafExpr {
  return TABLE[expr.kind].leaf === "leaf";
}
