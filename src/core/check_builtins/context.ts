// The checker operations used by builtin family handlers. The body checker
// owns argument evaluation, diagnostics and body tables; dispatch owns arity,
// pipeline rules and lowering facts. Keep this interface to the members used
// by the extracted families.

import type { DiagnosticCode } from "../diagnostics.ts";
import type { LocalId } from "../ir.ts";
import type { Result } from "../result.ts";
import type { Target } from "../resolve.ts";
import type { NodeId, SyntaxTree } from "../syntax.ts";
import { type EffectSet, PURE_EFFECTS } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import type { TypeNode, TypeRef, TypeTable } from "../types.ts";

export interface Arg {
  readonly node: NodeId;
  /** The value of a pipeline's left side, which is evaluated once before the stage. */
  readonly pre?: NodeInfo;
}

/** The builtins that take a concurrency option record. */
export type ConcurrencyOperation = "traverse" | "all" | "mapEffect";

export interface BuiltinContext {
  readonly table: TypeTable;
  readonly module: string;
  assignable(found: TypeRef, expected: TypeRef): boolean;
  argInfo(arg: Arg, expected?: TypeRef): NodeInfo;
  callback(
    name: string,
    arg: Arg,
    parameters: readonly TypeRef[],
    resultHint: TypeRef | undefined,
    allowEffects?: boolean,
  ): { readonly info: NodeInfo; readonly result: TypeRef };
  finish(node: NodeId, type: TypeRef, eff: EffectSet): NodeInfo;
  fits(
    node: NodeId,
    found: TypeRef,
    expected: TypeRef | undefined,
    what: string,
  ): boolean;
  functionOf(ref: TypeRef): FunctionNode | undefined;
  inlineStreamCallback(name: string, arg: Arg): void;
  isError(ref: TypeRef): boolean;
  report(code: DiagnosticCode, message: string, node: NodeId): void;
  widen(ref: TypeRef): TypeRef;
}

export type FunctionNode = Extract<TypeNode, { readonly kind: "function" }>;

export interface LiteralField {
  readonly node: NodeId;
  readonly value: unknown;
}

export interface LiteralRecordView {
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
}

/**
 * The bound of a `{ concurrency: N }` option record, or undefined after a
 * diagnostic. `N` is a positive safe integer literal or `"unbounded"`.
 */
export function concurrencyBound(
  c: LiteralRecordView & Pick<BuiltinContext, "report">,
  arg: Arg,
  operation: ConcurrencyOperation = "traverse",
): number | "unbounded" | undefined {
  const record = c.literalRecord(arg, 1);
  const literal = record.ok
    ? record.value.get("concurrency")?.value
    : undefined;
  if (literal === "unbounded") return literal;
  if (
    typeof literal === "number" && Number.isSafeInteger(literal) &&
    literal > 0
  ) return literal;
  c.report(
    "type-mismatch/010",
    `\`${operation}\` needs \`{ concurrency: N }\` with a positive safe integer literal, or \`{ concurrency: "unbounded" }\``,
    arg.node,
  );
  return undefined;
}

/** True when a function runs as an effect or has a failure or requirement. */
export function isEffectfulFunction(fn: FunctionNode): boolean {
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

export interface LocalUse {
  readonly node: NodeId;
  readonly parent: NodeId | undefined;
  readonly grandparent: NodeId | undefined;
  /** True when an arrow function between the body and the use encloses it. */
  readonly nested: boolean;
}

// The views below hold the members that several family contexts share. A
// family context extends the views that it uses.

/** The syntax tree and its child lists. */
export interface SyntaxView {
  readonly tree: SyntaxTree;
  kids(node: NodeId): NodeId[];
}

/** What name resolution decided for each node. */
export interface ResolveView {
  readonly targets: ReadonlyMap<NodeId, Target>;
}

/** The facts that the checker recorded so far. */
export interface FactView {
  readonly facts: ReadonlyMap<NodeId, NodeFact>;
}

export interface FactWriter {
  fact(node: NodeId, fact: NodeFact): void;
}

export interface LocalUseView {
  localUses(
    body: NodeId,
    id: LocalId,
    shorthand?: boolean,
  ): readonly LocalUse[];
}
