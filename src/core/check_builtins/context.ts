// The checker operations used by builtin family handlers. The body checker
// owns argument evaluation, diagnostics and body tables; dispatch owns arity,
// pipeline rules and lowering facts. Keep this interface to the members used
// by the extracted families.

import type { DiagnosticCode } from "../diagnostics.ts";
import type { LocalId } from "../ir.ts";
import type { Result } from "../source.ts";
import type { Target } from "../resolve.ts";
import type { NodeId, SyntaxTree } from "../syntax.ts";
import { type EffectSet, PURE_EFFECTS } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import type { TypeNode, TypeRef, TypeTable } from "../types.ts";

export type Arg = {
  readonly node: NodeId;
  /** The value of a pipeline's left side, which is evaluated once before the stage. */
  readonly pre?: NodeInfo;
};

/** The builtins that take a concurrency option record. */
type ConcurrencyOperation = "traverse" | "all" | "mapEffect";

export type BuiltinContext = {
  readonly table: TypeTable;
  readonly module: string;
  assignable(found: TypeRef, expected: TypeRef): boolean;
  argInfo(arg: Arg, expected: TypeRef | undefined): NodeInfo;
  callback(
    name: string,
    arg: Arg,
    parameters: readonly TypeRef[],
    resultHint: TypeRef | undefined,
    allowEffects: boolean,
  ): { readonly info: NodeInfo; readonly result: TypeRef };
  finish(node: NodeId, type: TypeRef, eff: EffectSet): NodeInfo;
  fits(
    node: NodeId,
    found: TypeRef,
    expected: TypeRef | undefined,
    what: string,
  ): boolean;
  functionOf(ref: TypeRef): FunctionNode | undefined;
  isError(ref: TypeRef): boolean;
  widen(ref: TypeRef): TypeRef;
};

export type FunctionNode = Extract<TypeNode, { readonly kind: "function" }>;

export type LiteralField = {
  readonly node: NodeId;
  readonly value: unknown;
};

export type LiteralRecordView = {
  /**
   * Reads an option record of exactly `count` fields, each `name: literal`, and
   * gives the fields by name. It fails with "shape" for a pipeline left side, a
   * value that is not a record, another field count, a field of another form,
   * or a repeated name. It reports nothing and records nothing.
   */
  literalRecord(
    arg: Arg,
    count: number,
  ): Result<ReadonlyMap<string, LiteralField>, "shape">;
};

export type ConcurrencyLimit = number | "unbounded" | undefined;
export type EffectfulDecision = boolean;

/**
 * The bound of a `{ concurrency: N }` option record, or undefined after a
 * diagnostic. `N` is a positive safe integer literal or `"unbounded"`.
 */
export type ConcurrencyBound<State> = {
  readonly state: State;
  readonly bound: ConcurrencyLimit;
};

export function concurrencyBound<
  State extends LiteralRecordView & {
    report(code: DiagnosticCode, message: string, node: NodeId): State;
  },
>(
  c: State,
  arg: Arg,
  operation: ConcurrencyOperation,
): ConcurrencyBound<State> {
  const record = c.literalRecord(arg, 1);
  const literal = record.ok
    ? record.value.get("concurrency")?.value
    : undefined;
  if (literal === "unbounded") return { state: c, bound: literal };
  if (
    typeof literal === "number" && Number.isSafeInteger(literal) &&
    literal > 0
  ) return { state: c, bound: literal };
  const state = c.report(
    "type-mismatch/010",
    `\`${operation}\` needs \`{ concurrency: N }\` with a positive safe integer literal, or \`{ concurrency: "unbounded" }\``,
    arg.node,
  );
  return { state: state, bound: undefined };
}

/** True when a function runs as an effect or has a failure or requirement. */
export function isEffectfulFunction(fn: FunctionNode): EffectfulDecision {
  return fn.execution !== "pure" || fn.failures.length > 0 ||
    fn.requirements.length > 0;
}

/** Invocation effects; an unknown function contributes none during recovery. */
export function invocationOf(fn: FunctionNode | undefined): EffectSet {
  return fn === undefined ? PURE_EFFECTS : {
    failures: fn.failures,
    requirements: fn.requirements,
    mode: fn.execution,
  };
}

export type LocalUse = {
  readonly node: NodeId;
  readonly parent: NodeId | undefined;
  readonly grandparent: NodeId | undefined;
  /** True when an arrow function between the body and the use encloses it. */
  readonly nested: boolean;
};

// The views below hold the members that several family contexts share. A
// family context extends the views that it uses.

/** The syntax tree and its child lists. */
export type SyntaxView = {
  readonly tree: SyntaxTree;
  kids(node: NodeId): NodeId[];
};

/** What name resolution decided for each node. */
export type ResolveView = {
  readonly targets: ReadonlyMap<NodeId, Target>;
};

/** The facts that the checker recorded so far. */
export type FactView = {
  readonly facts: ReadonlyMap<NodeId, NodeFact>;
};

export type LocalUseView = {
  localUses(
    body: NodeId,
    id: LocalId,
    shorthand: boolean,
  ): readonly LocalUse[];
};
