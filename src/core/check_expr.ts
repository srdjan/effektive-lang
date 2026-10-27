// Expression checking. A `BodyChecker` checks one declaration
// body. For each syntax node it records the type, the failure set, the
// requirement set, and the mode in a `BodyTable`, and it records the facts that
// lowering needs. See `tables.ts` for the shapes.
//
// Checking is bidirectional. `expr(node, expected)` passes an expected type
// down so that literals, record constructions, `None`, and arrows can use it. An
// expected type is always a requirement: the construct or its parent verifies
// that the result fits.
//
// Error recovery follows design 6.4. An error node, an unresolved name, or an
// operand of the error type gives the error type, empty sets, and pure mode, and
// no diagnostic. Diagnostics go to `sink`; the driver decides when to publish.

import {
  type Diagnostic,
  type DiagnosticCode,
  makeDiagnostic,
} from "./diagnostics.ts";
import {
  arrowBody,
  initOf,
  isDurationLiteral,
  isPatternKind,
  isTypeKind,
  kidsOf,
  literalOf,
  nameTextOf,
  operatorOf,
} from "./syntax_queries.ts";
import { isBoolean, operatorResult } from "./check_binary.ts";
import {
  checkCoverage,
  type MatchState,
  pattern,
  type PatternContext,
} from "./check_patterns.ts";
import {
  DURATION_ID,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "./ir.ts";
import type {
  CapabilityId,
  ErrorId,
  Execution,
  LocalId,
  Result,
  TypeId,
  ValueId,
} from "./ir.ts";
import type { PreludeName, Target } from "./resolve.ts";
import type { Span } from "./source.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import {
  checkedInputFlags,
  type ConstantSignature,
  type FunctionSignature,
  type TypeEnv,
} from "./signatures.ts";
import { TypeLowerer } from "./type_lower.ts";
import {
  domainOf,
  flattenIdentityMembers,
  flattenMembers,
  type LiteralValue,
} from "./patterns.ts";
import {
  type ArrowParameterFact,
  type BodyTable,
  combine,
  EFFECT_ONLY,
  type EffectSet,
  isQuiet,
  newBodyTable,
  type NodeFact,
  type NodeInfo,
  PURE_EFFECTS,
  without,
} from "./tables.ts";
import {
  containsOpaqueType,
  containsUnknownPredicateInput,
  dataOnly,
  MAX_DEPTH,
  type TypeRef,
  type TypeTable,
} from "./types.ts";
import { sortedUnique } from "./util.ts";
import { showType, showTypes } from "./type_show.ts";
import { isErrorId, shortName } from "./ids.ts";
import {
  type Arg,
  type BuiltinContext,
  type ConcurrencyOperation,
  type FunctionNode,
  invocationOf,
  isEffectfulFunction,
  type LiteralField,
  type LocalUse,
} from "./check_builtins/context.ts";
import type { CollectionContext } from "./check_builtins/collections.ts";
import type { EffectContext } from "./check_builtins/effect.ts";
import type { FiberContext } from "./check_builtins/fiber.ts";
import type { LayerContext } from "./check_builtins/layer.ts";
import { type CoreRowName, FAMILY_ROWS } from "./check_builtins/registry.ts";
import type {
  BuiltinRow,
  PreludeCallName,
  Prologue,
  Rows,
} from "./check_builtins/rows.ts";
import type { SchemaContext } from "./check_builtins/schema.ts";
import {
  checkBorrowedParameter,
  outcomeType,
  type ScopeContext,
  withResourceCall,
} from "./check_builtins/scope.ts";
import type { StreamContext } from "./check_builtins/stream.ts";
import { inferArrowInputs } from "./infer_inputs.ts";
import {
  type ProofBudget,
  RefinementChecker,
  type RefinementDecision,
} from "./check_refinements.ts";
import { not } from "./predicates.ts";

// ------------------------------------------------------------------ environment

/** What the body checker needs from the module and from the project. */
export interface BodyEnv {
  readonly env: TypeEnv;
  /** The type of a module-level value, local or imported. The error type when unknown. */
  readonly values: (id: ValueId) => TypeRef;
  /** The function type of a service method. The error type when unknown. */
  readonly methodType: (capability: CapabilityId) => TypeRef;
  readonly proofBudget?: ProofBudget;
}

/**
 * The contract of a function body. An absent part is open: the body infers it.
 * A present part is closed, and the body must stay within it.
 */
interface Contract {
  readonly result: TypeRef | undefined;
  readonly failures: readonly ErrorId[] | undefined;
  readonly requirements: readonly CapabilityId[] | undefined;
}

/** What checking the body expression of a function produces. */
interface BodyOutcome {
  /** The info of the body expression. Absent when the body is missing. */
  readonly body: NodeInfo | undefined;
  /** The declared or inferred result type. */
  readonly result: TypeRef;
  /** The invocation sets: declared for a closed set, inferred for an open one. */
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  /** The invocation mode. */
  readonly mode: Execution;
}

/** What checking one function body produces. */
export interface FunctionRun extends BodyOutcome {
  readonly table: BodyTable;
  /** The function type with that mode. */
  readonly type: TypeRef;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ConstantRun {
  readonly table: BodyTable;
  readonly init: NodeInfo | undefined;
  /** The binding annotation, or the widened type of the initializer. */
  readonly type: TypeRef;
  readonly diagnostics: readonly Diagnostic[];
}

interface ArrowContext {
  readonly parameters: readonly TypeRef[];
  readonly result: TypeRef | undefined;
}

interface TargetFields {
  readonly ref: TypeRef;
  readonly fields: readonly {
    readonly name: string;
    readonly type: TypeRef;
    readonly optional: boolean;
  }[];
}

type RecordTarget =
  | ({ readonly kind: "record" } & TargetFields)
  | ({ readonly kind: "construct"; readonly id: TypeId } & TargetFields)
  | { readonly kind: "variants"; readonly ids: readonly TypeId[] };

function names(ids: readonly string[]): string {
  return ids.map(shortName).join(", ");
}

// ------------------------------------------------------------------ the checker

// Family contexts expose only the checker operations and read views they need.
class BodyChecker
  implements
    BuiltinContext,
    CollectionContext,
    EffectContext,
    LayerContext,
    FiberContext,
    ScopeContext,
    StreamContext,
    SchemaContext,
    PatternContext {
  readonly sink: Diagnostic[] = [];
  readonly body: BodyTable;
  private readonly lowerer: TypeLowerer;
  readonly refinements: RefinementChecker;
  readonly tree: SyntaxTree;
  readonly table: TypeTable;
  readonly module: string;
  readonly targets: ReadonlyMap<NodeId, Target>;
  /** Block-local functions whose bodies are being checked. */
  private readonly pendingLocals = new Set<LocalId>();
  /** Counts the error nodes made so far. Recovery uses it to hold back cascades. */
  private errorCount = 0;
  private checkedSlots = new Set<NodeId>();

  constructor(private readonly benv: BodyEnv, declaration: ValueId) {
    this.tree = benv.env.tree;
    this.table = benv.env.table;
    this.module = benv.env.module;
    this.targets = benv.env.targets;
    this.lowerer = new TypeLowerer(benv.env, this.sink);
    this.body = newBodyTable(declaration);
    this.refinements = new RefinementChecker(
      this.tree,
      this.table,
      this.module,
      this.targets,
      benv.proofBudget,
    );
  }

  get services(): Pick<TypeEnv["services"], "get"> {
    return this.benv.env.services;
  }

  get infos(): ReadonlyMap<NodeId, NodeInfo> {
    return this.body.info;
  }

  get facts(): ReadonlyMap<NodeId, NodeFact> {
    return this.body.facts;
  }

  valueType(id: ValueId): TypeRef {
    return this.benv.values(id);
  }

  // -------------------------------------------------------------- helpers

  kids(node: NodeId): NodeId[] {
    return kidsOf(this.tree, node);
  }

  kidsOfKind(node: NodeId, kind: SyntaxKind): NodeId[] {
    return this.kids(node).filter((k) => kindOf(this.tree, k) === kind);
  }

  private span(node: NodeId): Span {
    return nodeSpan(this.tree, node);
  }

  report(code: DiagnosticCode, message: string, node: NodeId): void {
    this.sink.push(makeDiagnostic(code, message, this.span(node)));
  }

  private show(ref: TypeRef): string {
    return showType(this.table, ref);
  }

  isError(ref: TypeRef): boolean {
    return this.table.node(ref).kind === "error";
  }

  finish(node: NodeId, type: TypeRef, eff: EffectSet): NodeInfo {
    const info: NodeInfo = {
      type,
      failures: eff.failures,
      requirements: eff.requirements,
      mode: eff.mode,
    };
    this.body.info.set(node, info);
    return info;
  }

  fact(node: NodeId, fact: NodeFact): void {
    this.body.facts.set(node, fact);
  }

  private errorInfo(node: NodeId): NodeInfo {
    this.errorCount++;
    return this.finish(node, this.table.error, PURE_EFFECTS);
  }

  /** Source compatibility in the module that owns this body. */
  assignable(found: TypeRef, expected: TypeRef): boolean {
    return this.table.isAssignableIn(this.module, found, expected);
  }

  /** Reports a mismatch when `found` does not fit `expected`. Returns true when it fits. */
  fits(
    node: NodeId,
    found: TypeRef,
    expected: TypeRef | undefined,
    what: string,
  ): boolean {
    if (
      expected === undefined || this.assignable(found, expected) ||
      (this.checkedSlots.has(node) && this.checkedTypeFits(found, expected))
    ) {
      return true;
    }
    if (this.body.info.get(node)?.mode === "effect") {
      this.refinements.clearDerivedFacts();
    }
    const refinement = this.refinementBase(expected);
    if (
      refinement !== undefined &&
      this.table.node(this.table.unfoldTransparent(found)).kind !== "named" &&
      this.assignable(found, refinement.base)
    ) {
      return this.requireRefinement(node, expected, what);
    }
    const [foundText, expectedText] = showTypes(this.table, found, expected);
    this.report(
      "type-mismatch/003",
      `${what} has type ${foundText}, but ${expectedText} is expected`,
      node,
    );
    return false;
  }

  private refinementBase(
    ref: TypeRef,
  ): { readonly id: TypeId; readonly base: TypeRef } | undefined {
    const node = this.table.node(this.table.unfoldTransparent(ref));
    if (node.kind !== "named" || !node.id.startsWith("type:")) return undefined;
    const id = node.id as TypeId;
    if (this.table.predicateOf(id) === undefined) return undefined;
    const base = this.table.identityBaseOf(id);
    return base === undefined ? undefined : { id, base };
  }

  private requireRefinement(
    node: NodeId,
    expected: TypeRef,
    what: string,
  ): boolean {
    return this.recordRefinement(
      node,
      this.refinements.prove(node, expected),
      what,
      this.refinementBase(expected)?.id,
    );
  }

  private preserveRefinement(node: NodeId, id: TypeId, what: string): boolean {
    return this.recordRefinement(
      node,
      this.refinements.proveIdentity(node, id),
      what,
      id,
    );
  }

  private recordRefinement(
    node: NodeId,
    decision: RefinementDecision,
    what: string,
    target: TypeId | undefined,
  ): boolean {
    if (decision.status === "not-required") return true;
    if (decision.status === "proved") {
      while (kindOf(this.tree, node) === SyntaxKind.ParenExpr) {
        const inner = this.kids(node)[0];
        if (inner === undefined) break;
        node = inner;
      }
      const current = this.body.proofs.get(node) ?? [];
      if (!current.some((proof) => proof.target === decision.proof.target)) {
        this.body.proofs.set(node, [...current, decision.proof]);
      }
      return true;
    }
    const detail = decision.reason === "disproved"
      ? "does not satisfy"
      : decision.reason === "exhausted"
      ? "exceeds the proof limit for"
      : "does not prove";
    this.report(
      "type-mismatch/013",
      `${what} ${detail} the required refinement${
        target === undefined ? "" : ` ${shortName(target)}`
      }`,
      node,
    );
    return false;
  }

  /** Literal types of a fresh value become their primitive. Declared types stay. */
  widen(ref: TypeRef): TypeRef {
    const node = this.table.node(ref);
    if (node.kind === "literal") return this.primitiveOf(node.value);
    if (node.kind === "union" && node.members.some((m) => this.isLiteral(m))) {
      return this.table.union(node.members.map((m) => this.widen(m)));
    }
    return ref;
  }

  private isLiteral(ref: TypeRef): boolean {
    return this.table.node(ref).kind === "literal";
  }

  private primitiveOf(value: LiteralValue): TypeRef {
    if (value === null) return this.table.literal(null);
    if (typeof value === "string") return this.table.string;
    if (typeof value === "boolean") return this.table.boolean;
    return Number.isSafeInteger(value) ? this.table.int : this.table.number;
  }

  functionOf(ref: TypeRef): FunctionNode | undefined {
    const node = this.table.node(this.table.unfold(ref));
    return node.kind === "function" ? node : undefined;
  }

  private contextOf(expected: TypeRef | undefined): ArrowContext | undefined {
    if (expected === undefined) return undefined;
    const fn = this.functionOf(expected);
    return fn === undefined
      ? undefined
      : { parameters: fn.parameters, result: fn.result };
  }

  /** The element type of an option type, or undefined when the type is no option. */
  private optionElement(ref: TypeRef | undefined): TypeRef | undefined {
    if (ref === undefined) return undefined;
    const members = flattenMembers(this.table, ref).map((m) =>
      this.table.node(m)
    );
    const options = members.filter((m) => m.kind === "option");
    if (options.length !== 1) return undefined;
    const only = options[0];
    return only.kind === "option" ? only.element : undefined;
  }

  // -------------------------------------------------------------- public entries

  /**
   * Checks a function body against its contract. The parameters must already be
   * in `locals`.
   */
  checkBody(
    bodyNode: NodeId | undefined,
    contract: Contract,
    hint: TypeRef | undefined,
  ): BodyOutcome {
    if (bodyNode === undefined) {
      const failures = contract.failures ?? [];
      const requirements = contract.requirements ?? [];
      return {
        body: undefined,
        result: contract.result ?? this.table.error,
        failures,
        requirements,
        mode: failures.length + requirements.length > 0 ? "effect" : "pure",
      };
    }
    const body = this.expr(bodyNode, contract.result ?? hint);
    if (contract.result !== undefined) {
      this.fits(bodyNode, body.type, contract.result, "the function body");
    }
    const extraFailures = contract.failures === undefined
      ? []
      : without(body.failures, contract.failures);
    if (extraFailures.length > 0) {
      this.report(
        "failure-contract/001",
        `the body can fail with ${
          names(extraFailures)
        }, which the \`fails\` clause does not list`,
        bodyNode,
      );
    }
    const extraRequirements = contract.requirements === undefined
      ? []
      : without(body.requirements, contract.requirements);
    if (extraRequirements.length > 0) {
      this.report(
        "requirement-contract/001",
        `the body requires ${
          names(extraRequirements)
        }, which the \`uses\` clause does not list`,
        bodyNode,
      );
    }
    const failures = contract.failures ?? body.failures;
    const requirements = contract.requirements ?? body.requirements;
    return {
      body,
      result: contract.result ?? this.widen(body.type),
      failures,
      requirements,
      mode: failures.length + requirements.length > 0 ? "effect" : body.mode,
    };
  }

  /** Checks a module-level constant initializer. */
  checkConstant(
    initNode: NodeId | undefined,
    annotation: TypeRef | undefined,
  ): { readonly init: NodeInfo | undefined; readonly type: TypeRef } {
    if (initNode === undefined) {
      return { init: undefined, type: annotation ?? this.table.error };
    }
    const init = this.expr(initNode, annotation);
    this.fits(initNode, init.type, annotation, "the constant");
    if (
      init.mode === "effect" || init.failures.length > 0 ||
      init.requirements.length > 0
    ) {
      this.report(
        "execution-mode/002",
        "a module constant must have a pure initializer with empty failure and requirement sets",
        initNode,
      );
    }
    return { init, type: annotation ?? this.widen(init.type) };
  }

  // -------------------------------------------------------------- expressions

  expr(node: NodeId, expected?: TypeRef): NodeInfo {
    switch (kindOf(this.tree, node)) {
      case SyntaxKind.LiteralExpr:
        return this.literal(node, expected);
      case SyntaxKind.NameExpr:
        return this.referenceInfo(node, this.targets.get(node), expected);
      case SyntaxKind.ParenExpr: {
        const inner = this.kids(node)[0];
        if (inner === undefined) return this.errorInfo(node);
        const info = this.expr(inner, expected);
        return this.finish(node, info.type, info);
      }
      case SyntaxKind.UsingExpr: {
        const args = this.kids(node).filter((k) =>
          [
            SyntaxKind.ResourceAcquire,
            SyntaxKind.ResourceUse,
            SyntaxKind.ResourceRelease,
          ].includes(kindOf(this.tree, k))
        ).map((node) => ({ node }));
        if (args.length !== 3) return this.errorInfo(node);
        return withResourceCall(this, node, args, expected);
      }
      case SyntaxKind.ArrowExpr:
        return this.arrow(node, this.contextOf(expected));
      case SyntaxKind.CallExpr:
        return this.call(node, expected);
      case SyntaxKind.FieldExpr:
        return this.fieldExpr(node);
      case SyntaxKind.BinaryExpr:
        return this.binary(node);
      case SyntaxKind.OptionFallbackExpr:
        return this.optionFallback(node, expected);
      case SyntaxKind.PipeExpr:
        return this.pipe(node, expected);
      case SyntaxKind.RecordExpr:
        return this.recordExpr(node, expected);
      case SyntaxKind.ListExpr:
        return this.listExpr(node, expected);
      case SyntaxKind.Block:
        return this.block(node, expected);
      case SyntaxKind.IfExpr:
        return this.ifExpr(node, expected);
      case SyntaxKind.MatchExpr:
        return this.match(node, expected);
      case SyntaxKind.TryExpr:
        return this.tryExpr(node, expected);
      default:
        return this.errorInfo(node);
    }
  }

  argInfo(arg: Arg, expected?: TypeRef): NodeInfo {
    return arg.pre ?? this.expr(arg.node, expected);
  }

  // -------------------------------------------------------------- literals and names

  private literal(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const value = literalOf(this.tree, node);
    if (value === undefined) return this.errorInfo(node);
    if (isDurationLiteral(this.tree, node)) {
      return this.finish(node, this.table.named(DURATION_ID), PURE_EFFECTS);
    }
    return this.finish(node, this.literalType(value, expected), PURE_EFFECTS);
  }

  /** An expected literal alternative survives. Otherwise the literal takes its primitive. */
  private literalType(
    value: LiteralValue,
    expected: TypeRef | undefined,
  ): TypeRef {
    if (expected !== undefined) {
      const members = flattenMembers(this.table, expected).map((m) =>
        this.table.node(m)
      );
      if (members.some((m) => m.kind === "literal" && m.value === value)) {
        return this.table.literal(value);
      }
      if (typeof value === "number") {
        const hasInt = members.some((m) =>
          m.kind === "primitive" && m.name === "int"
        );
        const hasNumber = members.some((m) =>
          m.kind === "primitive" && m.name === "number"
        );
        if (hasNumber && !(hasInt && Number.isSafeInteger(value))) {
          return this.table.number;
        }
      }
    }
    return this.primitiveOf(value);
  }

  private referenceInfo(
    node: NodeId,
    target: Target | undefined,
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (target === undefined) return this.errorInfo(node);
    switch (target.kind) {
      case "local": {
        if (this.pendingLocals.has(target.id)) {
          this.report(
            "execution-mode/003",
            "a local function cannot refer to itself; a recursive function must be a module-level function with an explicit signature",
            node,
          );
          return this.errorInfo(node);
        }
        return this.finish(
          node,
          this.body.locals.get(target.id) ?? this.table.error,
          PURE_EFFECTS,
        );
      }
      case "value":
      case "provider":
        return this.finish(node, this.benv.values(target.id), PURE_EFFECTS);
      case "builtin":
        if (target.name === "None") return this.none(node, expected);
        return this.errorInfo(node);
      case "type":
      case "error":
      case "service":
      case "cap":
      case "builtin-type":
      case "field":
      case "unresolved":
        return this.errorInfo(node);
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  }

  private none(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const element = this.optionElement(expected);
    const type = element === undefined
      ? this.table.option(this.table.never)
      : this.table.option(element);
    this.fact(node, { kind: "none" });
    return this.finish(node, type, PURE_EFFECTS);
  }

  // -------------------------------------------------------------- calls

  private call(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = this.kids(node);
    const callee = kids[0];
    if (callee === undefined) return this.errorInfo(node);
    const argList = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.ArgList
    );
    const args: Arg[] = argList === undefined
      ? []
      : this.kids(argList).map((n) => ({ node: n }));
    const calleeKind = kindOf(this.tree, callee);
    const target = calleeKind === SyntaxKind.NameExpr ||
        calleeKind === SyntaxKind.FieldExpr
      ? this.targets.get(callee)
      : undefined;
    return this.invoke(node, callee, target, false, args, expected);
  }

  /**
   * Checks a call. `callee` is the callee expression or, for a pipeline stage, the
   * qualified name. A target of `undefined` on an expression callee means the
   * callee is an ordinary expression that evaluates to a function.
   */
  private invoke(
    node: NodeId,
    callee: NodeId,
    target: Target | undefined,
    stage: boolean,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (target === undefined) {
      if (stage) return this.unresolvedCall(node, args);
      return this.apply(node, this.expr(callee), args);
    }
    switch (target.kind) {
      case "builtin":
        return this.builtinCall(node, target.name, args, expected);
      case "error":
        return this.errorConstruction(node, target.id, args);
      case "type": {
        const record = this.table.taggedRecordOf(target.id);
        return record === undefined
          ? this.identityConstruction(node, target.id, args)
          : this.taggedConstruction(node, target.id, record, args);
      }
      case "cap":
        return this.perform(node, target.id, args);
      case "local":
      case "value":
      case "provider":
        return this.apply(
          node,
          this.referenceInfo(callee, target, undefined),
          args,
        );
      case "service":
      case "builtin-type":
      case "field":
      case "unresolved":
        return this.unresolvedCall(node, args);
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  }

  /** The callee could not be resolved. The arguments still get checked. */
  private unresolvedCall(node: NodeId, args: readonly Arg[]): NodeInfo {
    const infos = args.map((a) => this.argInfo(a));
    this.errorCount++;
    return this.finish(node, this.table.error, combine(infos));
  }

  private apply(
    node: NodeId,
    callee: NodeInfo,
    args: readonly Arg[],
  ): NodeInfo {
    const fn = this.functionOf(callee.type);
    if (fn === undefined) {
      const infos = args.map((a) => this.argInfo(a));
      if (!this.isError(callee.type)) {
        this.report(
          "type-mismatch/008",
          `a value of type ${this.show(callee.type)} is not a function`,
          node,
        );
      }
      this.fact(node, { kind: "call" });
      return this.finish(
        node,
        this.table.error,
        combine([callee, ...infos]),
      );
    }
    this.fact(node, { kind: "call" });
    return this.applyFunction(node, fn, callee, args, PURE_EFFECTS);
  }

  private markCheckedSlots(node: NodeId): void {
    this.checkedSlots.add(node);
    const kind = kindOf(this.tree, node);
    const kids = this.kids(node);
    if (kind === SyntaxKind.RecordExpr) {
      for (const field of kids) {
        const parts = this.fieldParts(field);
        if (parts !== undefined) this.markCheckedSlots(parts.value ?? field);
      }
    } else if (kind === SyntaxKind.ParenExpr || kind === SyntaxKind.ListExpr) {
      for (const child of kids) this.markCheckedSlots(child);
    } else if (kind === SyntaxKind.Block) {
      const last = kids.at(-1);
      if (
        last !== undefined && kindOf(this.tree, last) !== SyntaxKind.ConstDecl
      ) this.markCheckedSlots(last);
    } else if (kind === SyntaxKind.IfExpr) {
      for (const branch of kids.slice(1)) this.markCheckedSlots(branch);
    } else if (kind === SyntaxKind.MatchExpr) {
      for (
        const arm of kids.filter((child) =>
          kindOf(this.tree, child) === SyntaxKind.MatchArm
        )
      ) {
        const body = this.kids(arm).at(-1);
        if (body !== undefined) this.markCheckedSlots(body);
      }
    }
  }

  private checkedTypeFits(
    source: TypeRef,
    target: TypeRef,
    depth = 0,
  ): boolean {
    if (depth > MAX_DEPTH) return false;
    if (this.assignable(source, target)) return true;
    const s = this.table.node(this.table.unfoldTransparent(source));
    const t = this.table.node(this.table.unfoldTransparent(target));
    if (s.kind === "primitive" && s.name === "unknown") return true;
    if (s.kind === "union") {
      return s.members.every((member) =>
        this.checkedTypeFits(member, target, depth + 1)
      );
    }
    if (t.kind === "union") {
      return t.members.some((member) =>
        this.checkedTypeFits(source, member, depth + 1)
      );
    }
    if (t.kind === "named" && t.id.startsWith("type:") && s.kind !== "named") {
      const id = t.id as TypeId;
      const base = this.table.identityBaseOf(id);
      const predicate = this.table.predicateOf(id);
      if (
        !this.table.ownsSealed(this.module, id) ||
        (predicate !== undefined &&
          !containsUnknownPredicateInput(this.table, source, predicate)) ||
        this.table.taggedRecordOf(id) !== undefined
      ) return false;
      return base !== undefined &&
        this.checkedTypeFits(source, base, depth + 1);
    }
    if (s.kind === "named" && s.id.startsWith("type:") && t.kind !== "named") {
      const id = s.id as TypeId;
      if (!this.table.ownsSealed(this.module, id)) return false;
      const base = this.table.identityBaseOf(id) ??
        this.table.taggedRecordOf(id);
      return base !== undefined &&
        this.checkedTypeFits(base, target, depth + 1);
    }
    if (s.kind === "record" && t.kind === "record") {
      return s.fields.length === t.fields.length && t.fields.every((field) => {
        const found = s.fields.find((item) => item.name === field.name);
        return found !== undefined && found.optional === field.optional &&
          this.checkedTypeFits(found.type, field.type, depth + 1);
      });
    }
    if (
      (s.kind === "array" && t.kind === "array") ||
      (s.kind === "option" && t.kind === "option")
    ) return this.checkedTypeFits(s.element, t.element, depth + 1);
    if (s.kind === "tuple" && t.kind === "tuple") {
      return s.elements.length === t.elements.length &&
        s.elements.every((element, i) =>
          this.checkedTypeFits(element, t.elements[i], depth + 1)
        );
    }
    return false;
  }

  private applyFunction(
    node: NodeId,
    fn: FunctionNode,
    base: EffectSet,
    args: readonly Arg[],
    extra: EffectSet,
  ): NodeInfo {
    if (args.length !== fn.parameters.length) {
      this.report(
        "type-mismatch/004",
        `the function takes ${fn.parameters.length} argument${
          fn.parameters.length === 1 ? "" : "s"
        }, but ${args.length} ${args.length === 1 ? "is" : "are"} given`,
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const expected = fn.parameters[i];
      const before = this.checkedSlots;
      if (fn.checked?.[i] === true) {
        this.checkedSlots = new Set(before);
        this.markCheckedSlots(arg.node);
      }
      const info = this.argInfo(arg, expected);
      if (
        expected !== undefined &&
        !(fn.checked?.[i] === true && this.checkedTypeFits(info.type, expected))
      ) {
        this.fits(arg.node, info.type, expected, `argument ${i + 1}`);
      }
      this.checkedSlots = before;
      return info;
    });
    return this.finish(
      node,
      fn.result,
      combine([base, ...infos, invocationOf(fn), extra]),
    );
  }

  private perform(
    node: NodeId,
    capability: CapabilityId,
    args: readonly Arg[],
  ): NodeInfo {
    this.fact(node, { kind: "perform", capability });
    const fn = this.functionOf(this.benv.methodType(capability));
    if (fn === undefined) return this.unresolvedCall(node, args);
    return this.applyFunction(node, fn, PURE_EFFECTS, args, {
      failures: [],
      requirements: [capability],
      mode: "effect",
    });
  }

  /** True for `{ a: x, b }` without a spread. */
  private isPlainRecordLiteral(node: NodeId): boolean {
    if (kindOf(this.tree, node) === SyntaxKind.ParenExpr) {
      const inner = this.kids(node)[0];
      return inner !== undefined && this.isPlainRecordLiteral(inner);
    }
    if (kindOf(this.tree, node) !== SyntaxKind.RecordExpr) return false;
    return this.kids(node).every((field) =>
      kindOf(this.tree, field) !== SyntaxKind.SpreadField
    );
  }

  private errorConstruction(
    node: NodeId,
    id: ErrorId,
    args: readonly Arg[],
  ): NodeInfo {
    if (
      id === SCHEMA_ERROR_ID || id === SCHEMA_ISSUE_ID ||
      id === TIMEOUT_ERROR_ID
    ) {
      const infos = args.map((arg) => this.argInfo(arg));
      this.report(
        "type-mismatch/010",
        `${
          id === SCHEMA_ERROR_ID
            ? "SchemaError"
            : id === TIMEOUT_ERROR_ID
            ? "TimeoutError"
            : "SchemaIssue"
        } cannot be constructed directly`,
        node,
      );
      return this.finish(node, this.table.error, combine(infos));
    }
    this.fact(node, { kind: "error-construction", error: id });
    const record = this.table.errorRecordOf(id);
    if (args.length !== 1) {
      this.report(
        "type-mismatch/004",
        `the error \`${
          shortName(id)
        }\` takes one record argument, but ${args.length} are given`,
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const info = this.argInfo(arg, i === 0 ? record : undefined);
      if (i === 0) {
        const fits = this.fits(
          arg.node,
          info.type,
          record,
          `the argument of ${shortName(id)}`,
        );
        // The IR error node lists its fields, so the argument must be a record
        // literal without a spread. A pipeline stage with one piped value has no
        // record literal of its own, so the stage is the error. A value that
        // does not fit has its type report already, as in the direct form.
        const piped = arg.pre !== undefined && args.length === 1;
        if (
          fits && !this.isError(info.type) &&
          (piped || !this.isPlainRecordLiteral(arg.node))
        ) {
          this.report(
            "type-mismatch/010",
            `the error \`${shortName(id)}\` needs a record literal such as ${
              shortName(id)
            }({ field: value })`,
            piped ? node : arg.node,
          );
        }
      }
      return info;
    });
    return this.finish(node, this.table.named(id), combine(infos));
  }

  private identityConstruction(
    node: NodeId,
    id: TypeId,
    args: readonly Arg[],
  ): NodeInfo {
    if (this.table.isOpaque(id)) {
      const infos = args.map((a) => this.argInfo(a));
      this.report(
        "type-mismatch/010",
        "an opaque type cannot be constructed in source",
        node,
      );
      return this.finish(node, this.table.error, combine(infos));
    }
    const base = this.table.identityBaseOf(id);
    if (base === undefined) {
      const infos = args.map((a) => this.argInfo(a));
      // A body that did not parse has the error type, so its uses report nothing more.
      if (!this.hasErrorRecord(this.table.named(id))) {
        this.report(
          "type-mismatch/010",
          `\`${
            shortName(id)
          }\` has no identity; only a type with identity is a constructor`,
          node,
        );
      }
      return this.finish(node, this.table.error, combine(infos));
    }
    this.requireSealedOwner(node, id);
    this.fact(node, { kind: "identity-construction", identity: id });
    return this.constructFrom(node, id, base, "type with identity", args);
  }

  /** Reports `sealed/001` when another module constructs a sealed type. */
  private requireSealedOwner(node: NodeId, id: TypeId): void {
    if (!this.table.ownsSealed(this.module, id)) {
      this.report(
        "sealed/001",
        `only the declaring module can construct the sealed type \`${
          shortName(id)
        }\``,
        node,
      );
    }
  }

  private taggedConstruction(
    node: NodeId,
    id: TypeId,
    record: TypeRef,
    args: readonly Arg[],
  ): NodeInfo {
    this.requireSealedOwner(node, id);
    this.fact(node, { kind: "identity-construction", identity: id });
    return this.constructFrom(node, id, record, "tagged record", args);
  }

  /** The single argument of a constructor must fit the base type. */
  private constructFrom(
    node: NodeId,
    id: TypeId,
    base: TypeRef,
    noun: "tagged record" | "type with identity",
    args: readonly Arg[],
  ): NodeInfo {
    if (args.length !== 1) {
      this.report(
        "type-mismatch/004",
        `the ${noun} \`${
          shortName(id)
        }\` takes one argument, but ${args.length} are given`,
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const info = this.argInfo(arg, i === 0 ? base : undefined);
      if (i === 0) {
        this.fits(arg.node, info.type, base, `the value of ${shortName(id)}`);
        if (
          this.table.predicateOf(id) !== undefined &&
          this.table.unfoldTransparent(info.type) !== this.table.named(id)
        ) {
          this.preserveRefinement(
            arg.node,
            id,
            `the value of ${shortName(id)}`,
          );
        }
      }
      return info;
    });
    return this.finish(node, this.table.named(id), combine(infos));
  }

  // -------------------------------------------------------------- prelude calls

  private builtinCall(
    node: NodeId,
    name: PreludeName,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (name === "None") {
      const infos = args.map((a) => this.argInfo(a));
      this.report(
        "type-mismatch/008",
        `\`${name}\` is a value, not a function`,
        node,
      );
      return this.finish(node, this.table.error, combine(infos));
    }
    return this.preludeCall(node, name, args, expected);
  }

  /** Runs the handler of a prelude name. The table has one row for each name except `None`. */
  private preludeCall<K extends PreludeCallName>(
    node: NodeId,
    name: K,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    const row: BuiltinRow<K, BodyChecker> = BodyChecker.PRELUDE_ROWS[name];
    if (row.prologue !== "own-arity") {
      const bailed = this.runPrologue(node, name, args, row.prologue);
      if (bailed !== undefined) return bailed;
    }
    return row.handle(this, node, name, args, expected);
  }

  /** Runs a prologue. Returns the result of a wrong argument count, or undefined. */
  private runPrologue<K extends PreludeCallName>(
    node: NodeId,
    name: K,
    args: readonly Arg[],
    prologue: Prologue<K, BodyChecker>,
  ): NodeInfo | undefined {
    const { fact, bailFact } = prologue;
    if (fact !== undefined) {
      this.fact(
        node,
        typeof fact === "function" ? fact(this, name, args) : fact,
      );
    }
    const count = typeof prologue.arity === "number"
      ? prologue.arity
      : prologue.arity(name, args);
    if (!this.arity(node, name, count, args, prologue.usage)) {
      if (bailFact !== undefined) this.fact(node, bailFact);
      const infos = args.map((a) => this.argInfo(a));
      return this.finish(
        node,
        this.table.error,
        combine(prologue.bail === "effect" ? [...infos, EFFECT_ONLY] : infos),
      );
    }
    if (prologue.pipeline === "direct") this.noPipeline(name, args);
    return undefined;
  }

  /** The rows of the builtins that call private members of the checker. */
  private static readonly CORE_ROWS: Rows<CoreRowName, BodyChecker> = {
    Some: {
      prologue: "own-arity",
      handle: (c, node, _name, args, expected) =>
        c.someCall(node, args, expected),
    },
  };

  /**
   * The row of each prelude call name. The family files own the rows of the
   * other builtins. A row with the prologue `"own-arity"` tests its own
   * argument count. `CORE_ROWS` must come first, because static initializers
   * run in source order.
   */
  private static readonly PRELUDE_ROWS: Rows<PreludeCallName, BodyChecker> = {
    ...FAMILY_ROWS,
    ...BodyChecker.CORE_ROWS,
  };

  /** Reports a wrong argument count for a prelude call. Returns true when the count is right. */
  arity(
    node: NodeId,
    name: string,
    expectedCount: number,
    args: readonly Arg[],
    usage?: string,
  ): boolean {
    if (args.length === expectedCount) return true;
    this.report(
      "type-mismatch/004",
      usage ??
        `\`${name}\` takes ${expectedCount} argument${
          expectedCount === 1 ? "" : "s"
        }, but ${args.length} ${args.length === 1 ? "is" : "are"} given`,
      node,
    );
    return false;
  }

  private someCall(
    node: NodeId,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    this.fact(node, { kind: "some" });
    const rightCount = this.arity(node, "Some", 1, args);
    const hint = this.optionElement(expected);
    let element = hint;
    if (this.checkedSlots.has(node)) {
      for (const arg of args) this.markCheckedSlots(arg.node);
    }
    const infos = args.map((a, i) => {
      const info = this.argInfo(a, i === 0 ? hint : undefined);
      if (i === 0 && hint !== undefined) {
        if (
          this.checkedSlots.has(node) && !this.assignable(info.type, hint) &&
          this.checkedTypeFits(info.type, hint)
        ) element = info.type;
        else this.fits(a.node, info.type, hint, "the value of Some");
      }
      return info;
    });
    const type = rightCount
      ? this.table.option(element ?? infos[0].type)
      : this.table.error;
    return this.finish(node, type, combine(infos));
  }

  /**
   * Reads an option record of exactly `count` fields, each `name: literal`, and
   * gives the fields by name. It fails with "shape" for a pipeline left side, a
   * value that is not a record, another field count, a field of another form,
   * or a repeated name. It reports nothing and records nothing.
   */
  literalRecord(
    arg: Arg,
    count: number,
  ): Result<ReadonlyMap<string, LiteralField>, "shape"> {
    const shape = { ok: false, error: "shape" } as const;
    if (
      arg.pre !== undefined ||
      kindOf(this.tree, arg.node) !== SyntaxKind.RecordExpr
    ) return shape;
    const fields = this.kids(arg.node);
    if (fields.length !== count) return shape;
    const values = new Map<string, LiteralField>();
    for (const field of fields) {
      if (kindOf(this.tree, field) !== SyntaxKind.RecordField) return shape;
      const parts = this.kids(field);
      const label = parts.find((part) =>
        kindOf(this.tree, part) === SyntaxKind.Name
      );
      const valueNode = parts.find((part) => part !== label);
      if (
        label === undefined || valueNode === undefined ||
        kindOf(this.tree, valueNode) !== SyntaxKind.LiteralExpr
      ) return shape;
      const name = nameTextOf(this.tree, label);
      if (name === undefined || values.has(name)) return shape;
      values.set(name, {
        node: valueNode,
        value: literalOf(this.tree, valueNode),
      });
    }
    return { ok: true, value: values };
  }

  /** The zero-argument function type of a `retry` or `provide` job, or undefined after a diagnostic. */
  jobFunction(
    name: string,
    arg: Arg,
    info: NodeInfo,
  ): FunctionNode | undefined {
    const fn = this.functionOf(info.type);
    if (fn === undefined) {
      if (!this.isError(info.type)) {
        this.report(
          "type-mismatch/010",
          `\`${name}\` needs a function that takes no arguments, but the job has type ${
            this.show(info.type)
          }`,
          arg.node,
        );
      }
      return undefined;
    }
    if (fn.parameters.length > 0) {
      this.report(
        "type-mismatch/010",
        `\`${name}\` needs a function that takes no arguments, but the job takes ${fn.parameters.length}`,
        arg.node,
      );
      return undefined;
    }
    return fn;
  }

  /**
   * The uses of a local in `body`, in syntax order. Each use has its two nearest
   * ancestors and tells whether an arrow function encloses it. With `shorthand`,
   * the name in a shorthand field such as `{ id }` also counts as a use.
   */
  localUses(
    body: NodeId,
    id: LocalId,
    shorthand = false,
  ): LocalUse[] {
    const uses: LocalUse[] = [];
    const visit = (
      node: NodeId,
      parent: NodeId | undefined,
      grandparent: NodeId | undefined,
      nested: boolean,
    ): void => {
      const kind = kindOf(this.tree, node);
      const target = this.targets.get(node);
      if (
        (kind === SyntaxKind.NameExpr ||
          (shorthand && kind === SyntaxKind.Name && parent !== undefined &&
            kindOf(this.tree, parent) === SyntaxKind.ShorthandField)) &&
        target?.kind === "local" && target.id === id
      ) {
        uses.push({ node, parent, grandparent, nested });
      }
      for (const child of this.kids(node)) {
        visit(
          child,
          node,
          parent,
          nested ||
            [
              SyntaxKind.ArrowExpr,
              SyntaxKind.ResourceAcquire,
              SyntaxKind.ResourceUse,
              SyntaxKind.ResourceRelease,
            ].includes(kind),
        );
      }
    };
    visit(body, undefined, undefined, false);
    return uses;
  }

  noPipeline(name: string, args: readonly Arg[]): void {
    if (args[0]?.pre !== undefined) {
      this.report(
        "type-mismatch/010",
        `\`${name}\` requires direct call syntax`,
        args[0].node,
      );
    }
  }

  inlineStreamCallback(name: string, arg: Arg): void {
    if (
      arg.pre !== undefined ||
      kindOf(this.tree, arg.node) !== SyntaxKind.ArrowExpr
    ) {
      this.report(
        "type-mismatch/010",
        `\`${name}\` requires an inline arrow callback`,
        arg.node,
      );
    }
  }

  /**
   * Checks a collection callback. An inline arrow receives its parameter
   * types from the context. Only traverse permits invocation effects.
   */
  callback(
    name: string,
    arg: Arg,
    parameters: readonly TypeRef[],
    resultHint: TypeRef | undefined,
    allowEffects = false,
  ): { readonly info: NodeInfo; readonly result: TypeRef } {
    const kind = kindOf(this.tree, arg.node);
    const info = arg.pre === undefined &&
        [
          SyntaxKind.ResourceAcquire,
          SyntaxKind.ResourceUse,
          SyntaxKind.ResourceRelease,
        ].includes(kind)
      ? this.implicitArrow(arg.node, parameters, resultHint)
      : arg.pre === undefined && kind === SyntaxKind.ArrowExpr
      ? this.arrow(arg.node, { parameters, result: resultHint })
      : this.argInfo(arg);
    if (this.isError(info.type)) return { info, result: this.table.error };
    const fn = this.functionOf(info.type);
    if (fn === undefined) {
      this.report(
        "type-mismatch/010",
        `the callback of \`${name}\` must be a function, but the value has type ${
          this.show(info.type)
        }`,
        arg.node,
      );
      return { info, result: this.table.error };
    }
    if (fn.parameters.length !== parameters.length) {
      this.report(
        "type-mismatch/004",
        `the callback of \`${name}\` takes ${parameters.length} parameter${
          parameters.length === 1 ? "" : "s"
        }, but the function takes ${fn.parameters.length}`,
        arg.node,
      );
    } else {
      parameters.forEach((expected, i) => {
        if (!this.assignable(expected, fn.parameters[i])) {
          this.report(
            "type-mismatch/003",
            `parameter ${i + 1} of the callback has type ${
              this.show(fn.parameters[i])
            }, but the collection supplies ${this.show(expected)}`,
            arg.node,
          );
        }
      });
    }
    if (!allowEffects && isEffectfulFunction(fn)) {
      this.report(
        "execution-mode/001",
        `the callback of \`${name}\` must be pure with empty failure and requirement sets`,
        arg.node,
      );
    }
    return { info, result: fn.result };
  }

  concurrencyBound(
    arg: Arg,
    operation: ConcurrencyOperation = "traverse",
  ): number | "unbounded" | undefined {
    const record = this.literalRecord(arg, 1);
    const literal = record.ok
      ? record.value.get("concurrency")?.value
      : undefined;
    if (literal === "unbounded") return literal;
    if (
      typeof literal === "number" && Number.isSafeInteger(literal) &&
      literal > 0
    ) return literal;
    this.report(
      "type-mismatch/010",
      `\`${operation}\` needs \`{ concurrency: N }\` with a positive safe integer literal, or \`{ concurrency: "unbounded" }\``,
      arg.node,
    );
    return undefined;
  }

  // -------------------------------------------------------------- pipelines

  private pipe(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = this.kids(node);
    const left = kids[0];
    const stage = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.PipeStage
    );
    if (left === undefined) return this.errorInfo(node);
    const leftInfo = this.expr(left);
    if (stage === undefined) return this.errorInfo(node);
    const parts = this.kids(stage);
    const qualified = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.QualifiedName
    );
    const argList = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.ArgList
    );
    if (qualified === undefined) {
      this.errorInfo(stage);
      return this.finish(node, this.table.error, leftInfo);
    }
    // The lowering evaluates a left value with effects in its own binding, so
    // the handler sees it as pure and the stage keeps its own sets.
    const quiet = isQuiet(leftInfo);
    const pre: NodeInfo = quiet
      ? leftInfo
      : { type: leftInfo.type, ...PURE_EFFECTS };
    const args: Arg[] = [
      { node: left, pre },
      ...(argList === undefined
        ? []
        : this.kids(argList).map((n) => ({ node: n }))),
    ];
    if (this.checkedSlots.has(node)) this.checkedSlots.add(stage);
    const q = this.invoke(
      stage,
      qualified,
      this.targets.get(qualified),
      true,
      args,
      expected,
    );
    if (quiet) return this.finish(node, q.type, q);
    this.body.stageSets.set(stage, {
      failures: q.failures,
      requirements: q.requirements,
      mode: q.mode,
    });
    const combined = combine([leftInfo, q]);
    this.finish(stage, q.type, combined);
    return this.finish(node, q.type, combined);
  }

  // -------------------------------------------------------------- fields and records

  private fieldExpr(node: NodeId): NodeInfo {
    const kids = this.kids(node);
    const base = kids[0];
    const member = kids.find((k, i) =>
      i > 0 && kindOf(this.tree, k) === SyntaxKind.Name
    );
    const target = this.targets.get(node);
    if (target?.kind === "cap") {
      this.report(
        "type-mismatch/008",
        `the service method \`${
          shortName(target.id)
        }\` can only be called or used as a pipeline stage`,
        node,
      );
      return this.errorInfo(node);
    }
    if (target?.kind === "unresolved") return this.errorInfo(node);
    if (base === undefined) return this.errorInfo(node);
    const baseInfo = this.expr(base);
    const name = member === undefined
      ? undefined
      : nameTextOf(this.tree, member);
    if (member === undefined || name === undefined) {
      return this.finish(node, this.table.error, baseInfo);
    }
    const read = this.readField(baseInfo.type, name, member);
    this.fact(node, { kind: "field", name, optional: read.optional });
    return this.finish(node, read.type, baseInfo);
  }

  /** True for a type or an error whose body did not parse. */
  private hasErrorRecord(ref: TypeRef): boolean {
    const node = this.table.node(this.table.unfold(ref));
    if (node.kind === "error") return true;
    if (node.kind !== "named") return false;
    const record = isErrorId(node.id)
      ? this.table.errorRecordOf(node.id)
      : this.table.taggedRecordOf(node.id);
    return record !== undefined && this.isError(record);
  }

  /** The record fields of a type that is a record, a named error, or a tagged record. */
  private recordFields(ref: TypeRef):
    | readonly {
      readonly name: string;
      readonly type: TypeRef;
      readonly optional: boolean;
    }[]
    | undefined {
    const unfolded = this.table.unfold(ref);
    const node = this.table.node(unfolded);
    if (node.kind === "record") return node.fields;
    if (node.kind === "named") {
      if (isErrorId(node.id)) {
        const record = this.table.errorRecordOf(node.id);
        const recordNode = record === undefined
          ? undefined
          : this.table.node(record);
        return recordNode?.kind === "record" ? recordNode.fields : undefined;
      }
      // A tagged record has the fields of its base record.
      const base = this.table.taggedRecordOf(node.id);
      if (base !== undefined) return this.recordFields(base);
    }
    return undefined;
  }

  private readField(
    ref: TypeRef,
    name: string,
    nameNode: NodeId,
  ): { readonly type: TypeRef; readonly optional: boolean } {
    const failed = { type: this.table.error, optional: false };
    if (this.isError(ref)) return failed;
    const members = flattenMembers(this.table, ref);
    const types: TypeRef[] = [];
    let optional = false;
    for (const member of members) {
      const fields = this.recordFields(member);
      const field = fields?.find((f) => f.name === name);
      if (field === undefined) {
        if (this.hasErrorRecord(member)) return failed;
        this.report(
          "type-mismatch/006",
          fields === undefined
            ? `a value of type ${this.show(ref)} has no fields`
            : `the type ${this.show(member)} has no field \`${name}\``,
          nameNode,
        );
        return failed;
      }
      if (field.optional) optional = true;
      types.push(field.type);
    }
    const type = this.table.union(types);
    return { type: optional ? this.table.option(type) : type, optional };
  }

  private recordExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const fields = this.kids(node);
    const first = fields[0];
    if (
      first !== undefined && kindOf(this.tree, first) === SyntaxKind.SpreadField
    ) {
      return this.recordUpdate(node, first, fields.slice(1));
    }
    return this.recordConstruction(node, fields, expected);
  }

  private listExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const table = this.table;
    const target = expected === undefined
      ? undefined
      : table.node(table.unfold(expected));
    const elements = this.kids(node);
    if (expected !== undefined && target?.kind === "tuple") {
      this.fact(node, { kind: "list", shape: "tuple" });
      if (elements.length !== target.elements.length) {
        this.report(
          "type-mismatch/012",
          `the tuple needs ${target.elements.length} elements, but ${elements.length} are given`,
          node,
        );
      }
      const infos = elements.map((element, i) => {
        const hint = target.elements[i];
        const info = this.expr(element, hint);
        this.fits(element, info.type, hint, `tuple element ${i + 1}`);
        return info;
      });
      if (this.refinementBase(expected) !== undefined) {
        this.requireRefinement(node, expected, "the list");
      }
      return this.finish(node, expected, combine(infos));
    }

    this.fact(node, { kind: "list", shape: "array" });
    const hint = target?.kind === "array" ? target.element : undefined;
    const infos = elements.map((element, i) => {
      const info = this.expr(element, hint);
      if (hint !== undefined) {
        this.fits(element, info.type, hint, `array element ${i + 1}`);
      }
      return info;
    });
    if (hint !== undefined && expected !== undefined) {
      if (this.refinementBase(expected) !== undefined) {
        this.requireRefinement(node, expected, "the list");
      }
      return this.finish(node, expected, combine(infos));
    }
    if (infos.length === 0) {
      this.report(
        "type-mismatch/012",
        "an empty list needs an expected array or tuple type",
        node,
      );
      return this.finish(node, table.array(table.error), PURE_EFFECTS);
    }
    let element = this.widen(infos[0].type);
    for (let i = 1; i < infos.length; i++) {
      const next = this.widen(infos[i].type);
      if (this.isError(element) || this.isError(next)) {
        element = table.error;
      } else if (this.assignable(next, element)) {
        continue;
      } else if (this.assignable(element, next)) {
        element = next;
      } else {
        const [nextText, elementText] = showTypes(table, next, element);
        this.report(
          "type-mismatch/012",
          `list element ${
            i + 1
          } has type ${nextText}, which has no common array element type with ${elementText}`,
          elements[i],
        );
        element = table.error;
      }
    }
    return this.finish(node, table.array(element), combine(infos));
  }

  /** The label, label node, and value node of a record field. */
  fieldParts(
    field: NodeId,
  ): {
    readonly label: string;
    readonly labelNode: NodeId;
    readonly value: NodeId | undefined;
  } | undefined {
    const kind = kindOf(this.tree, field);
    const parts = this.kids(field);
    const labelNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Name
    );
    if (labelNode === undefined) return undefined;
    const label = nameTextOf(this.tree, labelNode);
    if (label === undefined) return undefined;
    if (kind === SyntaxKind.ShorthandField) {
      return { label, labelNode, value: undefined };
    }
    if (kind === SyntaxKind.RecordField) {
      return { label, labelNode, value: parts.find((k) => k !== labelNode) };
    }
    return undefined;
  }

  /** The value of a field: an expression, or the variable of a shorthand field. */
  private fieldValue(
    field: NodeId,
    parts: { readonly labelNode: NodeId; readonly value: NodeId | undefined },
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (parts.value !== undefined) return this.expr(parts.value, expected);
    const info = this.referenceInfo(
      parts.labelNode,
      this.targets.get(parts.labelNode),
      expected,
    );
    return this.finish(field, info.type, info);
  }

  /**
   * Picks the record type that a construction targets. `construct` means the
   * expected type is exactly a tagged record, so the literal is an implicit
   * construction. `variants` means a record literal at a union picks a tagged
   * record: the author must write the constructor, and the result has no record.
   */
  private recordTarget(
    expected: TypeRef | undefined,
    labels: readonly string[],
    literals: ReadonlyMap<string, LiteralValue>,
    known: ReadonlyMap<string, TypeRef>,
  ): RecordTarget | undefined {
    if (expected === undefined) return undefined;
    const table = this.table;
    const unfolded = table.unfold(expected);
    const node = table.node(unfolded);
    if (node.kind === "record") {
      const tagged = table.taggedIdOf(table.unfoldTransparent(expected));
      return tagged === undefined
        ? { kind: "record", ref: expected, fields: node.fields }
        : { kind: "construct", ref: expected, fields: node.fields, id: tagged };
    }
    if (node.kind !== "union") return undefined;
    const members = flattenIdentityMembers(table, expected);
    const candidates = members.flatMap((m) => {
      const id = table.taggedIdOf(m);
      const body = table.node(table.unfold(m));
      return body.kind === "record"
        ? [{ ref: m, fields: body.fields, tagged: id }]
        : [];
    });
    const fitting = candidates.filter((c) =>
      labels.every((l) => c.fields.some((f) => f.name === l)) &&
      c.fields.every((f) => f.optional || labels.includes(f.name))
    );
    const discriminated = fitting.filter((c) =>
      [...literals].every(([label, value]) => {
        const field = c.fields.find((f) => f.name === label);
        return field !== undefined &&
          this.assignable(table.literal(value), field.type);
      })
    );
    const narrowed = (discriminated.length > 0 ? discriminated : fitting)
      .filter(
        (c) =>
          [...known].every(([label, type]) => {
            const field = c.fields.find((f) => f.name === label);
            return field !== undefined &&
              this.assignable(type, field.type);
          }),
      );
    const pool = [narrowed, discriminated, fitting, candidates].find((list) =>
      list.length > 0
    );
    // A member with no refinement needs no proof, so it wins over a refined one.
    const chosen =
      pool?.find((c) => this.refinementBase(c.ref) === undefined) ??
        pool?.[0];
    if (chosen === undefined) return undefined;
    if (chosen.tagged !== undefined) {
      return {
        kind: "variants",
        ids: candidates.flatMap((c) =>
          c.tagged === undefined ? [] : [c.tagged]
        ),
      };
    }
    return { kind: "record", ref: chosen.ref, fields: chosen.fields };
  }

  /**
   * The type of a field value that a name reference gives without context: a
   * settled local, a value, or a provider. It records no fact and reports nothing.
   */
  private knownNameType(node: NodeId): TypeRef | undefined {
    const target = this.targets.get(node);
    if (target === undefined) return undefined;
    let type: TypeRef | undefined;
    if (target.kind === "local") {
      if (!this.pendingLocals.has(target.id)) {
        type = this.body.locals.get(target.id);
      }
    } else if (target.kind === "value" || target.kind === "provider") {
      type = this.benv.values(target.id);
    }
    return type === undefined || type === this.table.error ? undefined : type;
  }

  private recordConstruction(
    node: NodeId,
    fields: readonly NodeId[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    const parsed = fields.map((f) => ({ node: f, parts: this.fieldParts(f) }));
    const labels = parsed.flatMap((p) =>
      p.parts === undefined ? [] : [p.parts.label]
    );
    const literals = new Map<string, LiteralValue>();
    const known = new Map<string, TypeRef>();
    for (const { parts } of parsed) {
      if (parts === undefined) continue;
      if (parts.value === undefined) {
        const type = this.knownNameType(parts.labelNode);
        if (type !== undefined) known.set(parts.label, type);
        continue;
      }
      let valueNode = parts.value;
      while (kindOf(this.tree, valueNode) === SyntaxKind.ParenExpr) {
        const inner = this.kids(valueNode)[0];
        if (inner === undefined) break;
        valueNode = inner;
      }
      if (kindOf(this.tree, valueNode) === SyntaxKind.NameExpr) {
        const type = this.knownNameType(valueNode);
        if (type !== undefined) known.set(parts.label, type);
        continue;
      }
      if (kindOf(this.tree, valueNode) !== SyntaxKind.LiteralExpr) continue;
      const value = literalOf(this.tree, valueNode);
      if (value !== undefined) literals.set(parts.label, value);
    }
    const picked = this.recordTarget(expected, labels, literals, known);
    // A record literal does not pick a tagged variant, so it has no target.
    let target: Exclude<RecordTarget, { kind: "variants" }> | undefined;
    switch (picked?.kind) {
      case "record":
      case "construct":
        target = picked;
        break;
      case "variants":
        this.report(
          "type-mismatch/003",
          `a record literal does not pick a variant; write ${
            picked.ids.map((v) => `\`${shortName(v)}({ ... })\``).sort()
              .join(" or ")
          }`,
          node,
        );
        break;
      case undefined:
        break;
    }
    const seen = new Set<string>();
    const infos: NodeInfo[] = [];
    const inferred: { name: string; type: TypeRef; optional: boolean }[] = [];
    let raw = false;
    for (const { node: fieldNode, parts } of parsed) {
      if (parts === undefined) {
        if (kindOf(this.tree, fieldNode) === SyntaxKind.SpreadField) {
          this.report(
            "type-mismatch/005",
            "a record spread must come first",
            fieldNode,
          );
        }
        continue;
      }
      const declared = target?.fields.find((f) => f.name === parts.label);
      const duplicate = seen.has(parts.label);
      if (duplicate) {
        this.report(
          "type-mismatch/005",
          `the field \`${parts.label}\` appears twice`,
          parts.labelNode,
        );
      }
      seen.add(parts.label);
      if (target !== undefined && declared === undefined && !duplicate) {
        this.report(
          "type-mismatch/005",
          `the record type ${
            this.show(target.ref)
          } has no field \`${parts.label}\``,
          parts.labelNode,
        );
      }
      const info = this.fieldValue(fieldNode, parts, declared?.type);
      infos.push(info);
      if (declared !== undefined && !duplicate) {
        if (
          target?.kind === "record" && this.checkedSlots.has(node) &&
          !this.assignable(info.type, declared.type) &&
          this.checkedTypeFits(info.type, declared.type)
        ) raw = true;
        this.fits(
          parts.value ?? fieldNode,
          info.type,
          declared.type,
          `the field \`${parts.label}\``,
        );
      }
      if (!duplicate) {
        inferred.push({ name: parts.label, type: info.type, optional: false });
      }
    }
    let type: TypeRef;
    if (target !== undefined) {
      const missing = target.fields.filter((f) =>
        !f.optional && !seen.has(f.name)
      ).map((f) => f.name);
      if (missing.length > 0) {
        this.report(
          "type-mismatch/005",
          `the record is missing the field${missing.length === 1 ? "" : "s"} ${
            missing.map((m) => `\`${m}\``).join(", ")
          }`,
          node,
        );
      }
      if (raw) {
        const rawType = this.table.record(target.fields.map((field) => ({
          ...field,
          type: inferred.find((value) => value.name === field.name)?.type ??
            field.type,
        })));
        const refinement = this.refinementBase(target.ref);
        const predicate = refinement === undefined
          ? undefined
          : this.table.predicateOf(refinement.id);
        raw = predicate === undefined ||
          containsUnknownPredicateInput(this.table, rawType, predicate);
        type = raw ? rawType : target.ref;
      } else type = target.ref;
      if (target.kind === "construct") {
        this.fact(node, { kind: "identity-construction", identity: target.id });
        this.preserveRefinement(node, target.id, "the record");
      }
    } else {
      type = picked?.kind !== "variants"
        ? this.table.record(inferred)
        : this.table.error;
    }
    // A literal adopts one member of an expected union, so it needs that member's proof.
    const adopted = target?.kind === "record" ? target.ref : expected;
    if (
      adopted !== undefined && this.refinementBase(adopted) !== undefined &&
      target?.kind !== "construct"
    ) {
      const decision = this.refinements.prove(node, adopted);
      if (
        !raw || decision.status === "failed" && decision.reason === "disproved"
      ) {
        this.recordRefinement(
          node,
          decision,
          "the record",
          this.refinementBase(adopted)?.id,
        );
      }
    }
    return this.finish(node, type, combine(infos));
  }

  private recordUpdate(
    node: NodeId,
    spread: NodeId,
    rest: readonly NodeId[],
  ): NodeInfo {
    const baseNode = this.kids(spread)[0];
    if (baseNode === undefined) return this.errorInfo(node);
    const base = this.expr(baseNode);
    this.finish(spread, base.type, base);
    const sealed = this.table.sealedRootOf(base.type);
    if (sealed !== undefined && !this.table.ownsSealed(this.module, sealed)) {
      this.report(
        "sealed/002",
        `only the declaring module can update the sealed type \`${
          shortName(sealed)
        }\``,
        node,
      );
    }
    const baseFields = this.isError(base.type)
      ? undefined
      : this.recordFields(base.type);
    if (baseFields === undefined && !this.isError(base.type)) {
      this.report(
        "type-mismatch/005",
        `a record update needs a record, but the base has type ${
          this.show(base.type)
        }`,
        baseNode,
      );
    }
    const seen = new Set<string>();
    const infos: NodeInfo[] = [base];
    for (const fieldNode of rest) {
      const parts = this.fieldParts(fieldNode);
      if (parts === undefined) {
        if (kindOf(this.tree, fieldNode) === SyntaxKind.SpreadField) {
          this.report(
            "type-mismatch/005",
            "a record spread must come first",
            fieldNode,
          );
        }
        continue;
      }
      const duplicate = seen.has(parts.label);
      if (duplicate) {
        this.report(
          "type-mismatch/005",
          `the field \`${parts.label}\` appears twice`,
          parts.labelNode,
        );
      }
      seen.add(parts.label);
      const declared = baseFields?.find((f) => f.name === parts.label);
      if (baseFields !== undefined && declared === undefined && !duplicate) {
        this.report(
          "type-mismatch/005",
          `the record has no field \`${parts.label}\` to replace`,
          parts.labelNode,
        );
      }
      const info = this.fieldValue(fieldNode, parts, declared?.type);
      infos.push(info);
      if (declared !== undefined && !duplicate) {
        this.fits(
          parts.value ?? fieldNode,
          info.type,
          declared.type,
          `the field \`${parts.label}\``,
        );
      }
    }
    const result = this.finish(node, base.type, combine(infos));
    const identity = this.table.node(this.table.unfoldTransparent(base.type));
    if (
      identity.kind === "named" && identity.id.startsWith("type:") &&
      this.table.predicateOf(identity.id as TypeId) !== undefined
    ) {
      this.preserveRefinement(
        node,
        identity.id as TypeId,
        "the record update",
      );
    }
    return result;
  }

  // -------------------------------------------------------------- operators

  private binary(node: NodeId): NodeInfo {
    const kids = this.kids(node);
    const operator = operatorOf(this.tree, node);
    if (operator === undefined || kids.length < 2) return this.errorInfo(node);
    const left = this.expr(kids[0]);
    const equality = operator === "===" || operator === "!==";
    const branch = this.refinements.snapshot();
    if (operator === "&&" || operator === "||") {
      const condition = this.refinements.condition(kids[0]);
      this.refinements.addBranch(
        operator === "||" && condition !== undefined
          ? not(condition)
          : condition,
      );
    }
    const right = this.expr(kids[1], equality ? left.type : undefined);
    this.refinements.restore(branch);
    const eff = combine([left, right]);
    const result = operatorResult(
      this.table,
      this.module,
      operator,
      left.type,
      right.type,
    );
    if (result.sealed !== undefined) {
      this.report(
        "sealed/003",
        `only the declaring module can use arithmetic on the sealed type \`${
          shortName(result.sealed)
        }\``,
        node,
      );
    } else if (result.mismatch) {
      const [leftText, rightText] = showTypes(
        this.table,
        left.type,
        right.type,
      );
      this.report(
        "type-mismatch/007",
        `the operator \`${operator}\` does not accept operands of type ${leftText} and ${rightText}`,
        node,
      );
    }
    const info = this.finish(node, result.type, eff);
    const identity = this.table.node(this.table.unfoldTransparent(result.type));
    if (
      (operator === "+" || operator === "-" || operator === "*" ||
        operator === "/") &&
      identity.kind === "named" &&
      identity.id.startsWith("type:") &&
      this.table.predicateOf(identity.id as TypeId) !== undefined
    ) {
      this.preserveRefinement(
        node,
        identity.id as TypeId,
        "the arithmetic result",
      );
    }
    return info;
  }

  // -------------------------------------------------------------- arrows

  /**
   * Checks an arrow expression. Creating a closure is pure with empty sets. The
   * function type carries the invocation mode and sets.
   */
  private arrow(node: NodeId, context: ArrowContext | undefined): NodeInfo {
    const refinementScope = this.refinements.snapshot();
    const parts = this.kids(node);
    const paramList = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.ParamList
    );
    const params = paramList === undefined
      ? []
      : this.kidsOfKind(paramList, SyntaxKind.Param);
    const inferredParameters: {
      readonly id: LocalId | undefined;
      readonly name: string;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[] = [];
    params.forEach((param, i) => {
      const piece = this.kids(param);
      const nameNode = piece.find((k) =>
        kindOf(this.tree, k) === SyntaxKind.Name
      );
      const typeNode = piece.find((k) => k !== nameNode);
      const name = nameNode === undefined
        ? ""
        : nameTextOf(this.tree, nameNode) ?? "";
      const target = nameNode === undefined
        ? undefined
        : this.targets.get(nameNode);
      let type: TypeRef;
      if (typeNode !== undefined) {
        type = this.lowerer.lower(typeNode).ref;
      } else if (context !== undefined && i < context.parameters.length) {
        type = context.parameters[i];
      } else {
        type = this.table.unknown;
      }
      const id = target?.kind === "local" ? target.id : undefined;
      if (id !== undefined) this.body.locals.set(id, type);
      inferredParameters.push({
        id,
        name,
        type,
        inferred: type === this.table.unknown,
      });
    });
    const resultNode = parts.find((k) => isTypeKind(kindOf(this.tree, k)));
    const failsNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.FailsClause
    );
    const usesNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.UsesClause
    );
    const bodyNode = arrowBody(this.tree, node);
    const contract: Contract = {
      result: resultNode === undefined
        ? undefined
        : this.lowerer.lower(resultNode).ref,
      failures: failsNode === undefined
        ? undefined
        : this.lowerer.failures(failsNode),
      requirements: usesNode === undefined
        ? undefined
        : this.lowerer.requirements(usesNode),
    };
    const inference = inferredParameters.some((parameter) => parameter.inferred)
      ? inferArrowInputs(
        this.benv,
        inferredParameters,
        bodyNode,
        contract.result ?? context?.result,
        this.body.locals,
      )
      : { types: [], diagnostics: [] };
    this.sink.push(...inference.diagnostics);
    const parameterFacts: ArrowParameterFact[] = inferredParameters.map(
      (parameter, index) => {
        const type = inference.types[index] ?? parameter.type;
        if (parameter.id !== undefined) {
          this.body.locals.set(parameter.id, type);
        }
        return { id: parameter.id, name: parameter.name, type };
      },
    );
    for (const parameter of parameterFacts) {
      if (parameter.id !== undefined) {
        this.refinements.addLocal(parameter.id, parameter.type);
      }
    }
    const result = this.callbackBody(
      node,
      parameterFacts,
      bodyNode,
      contract,
      context?.result,
      {
        result: resultNode !== undefined,
        fails: failsNode !== undefined,
        uses: usesNode !== undefined,
      },
    );
    this.refinements.restore(refinementScope);
    return result;
  }

  private implicitArrow(
    node: NodeId,
    parameters: readonly TypeRef[],
    hint: TypeRef | undefined,
  ): NodeInfo {
    const refinementScope = this.refinements.snapshot();
    const parent = this.tree.parents[node];
    const nameNode = this.kids(parent).find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Name
    );
    const facts: ArrowParameterFact[] = [];
    if (parameters.length > 0 && nameNode !== undefined) {
      const target = this.targets.get(nameNode);
      const id = target?.kind === "local" ? target.id : undefined;
      const type = parameters[0];
      if (id !== undefined) this.body.locals.set(id, type);
      if (id !== undefined) this.refinements.addLocal(id, type);
      this.finish(nameNode, type, PURE_EFFECTS);
      facts.push({ id, name: nameTextOf(this.tree, nameNode) ?? "", type });
    }
    const outcomeNode = this.kids(node).find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Name
    );
    if (parameters.length > 1 && outcomeNode !== undefined) {
      facts.push(this.outcomeParameter(outcomeNode, parameters[1]));
    }
    const result = this.callbackBody(
      node,
      facts,
      this.kids(node).at(-1),
      { result: undefined, failures: undefined, requirements: undefined },
      hint,
      { result: false, fails: false, uses: false },
    );
    this.refinements.restore(refinementScope);
    return result;
  }

  /** Declares the outcome binding of a `finally` region. */
  private outcomeParameter(
    nameNode: NodeId,
    type: TypeRef,
  ): ArrowParameterFact {
    const target = this.targets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    if (id !== undefined) this.body.locals.set(id, type);
    if (id !== undefined) this.refinements.addLocal(id, type);
    this.finish(nameNode, type, PURE_EFFECTS);
    return { id, name: nameTextOf(this.tree, nameNode) ?? "", type };
  }

  private callbackBody(
    node: NodeId,
    parameterFacts: readonly ArrowParameterFact[],
    bodyNode: NodeId | undefined,
    contract: Contract,
    hint: TypeRef | undefined,
    written: {
      readonly result: boolean;
      readonly fails: boolean;
      readonly uses: boolean;
    },
  ): NodeInfo {
    const run = this.checkBody(bodyNode, contract, hint);
    const type = this.table.function({
      execution: run.mode,
      parameters: parameterFacts.map((p) => p.type),
      result: run.result,
      failures: run.failures,
      requirements: run.requirements,
    });
    this.fact(node, { kind: "arrow", parameters: parameterFacts, written });
    return this.finish(node, type, PURE_EFFECTS);
  }

  // -------------------------------------------------------------- blocks and control

  private block(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const refinementScope = this.refinements.snapshot();
    const items = this.kids(node);
    const infos: NodeInfo[] = [];
    let type = this.table.unit;
    let adoptedResult = false;
    items.forEach((item, i) => {
      const last = i === items.length - 1;
      if (kindOf(this.tree, item) === SyntaxKind.ConstDecl) {
        infos.push(this.blockConst(item));
        type = this.table.unit;
      } else {
        const info = this.expr(item, last ? expected : undefined);
        infos.push(info);
        type = info.type;
        if (last && expected !== undefined && this.refinementBase(expected)) {
          this.fits(item, info.type, expected, "the block result");
          adoptedResult = true;
        }
      }
      if (
        infos.at(-1)?.mode === "effect" &&
        ![SyntaxKind.IfExpr, SyntaxKind.MatchExpr].includes(
          kindOf(this.tree, item),
        )
      ) {
        this.refinements.clearDerivedFacts();
      }
    });
    const result = this.finish(
      node,
      adoptedResult && expected !== undefined ? expected : type,
      combine(infos),
    );
    this.refinements.leaveScope(refinementScope);
    return result;
  }

  private blockConst(node: NodeId): NodeInfo {
    const parts = this.kids(node);
    const record = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.RecordBinding
    );
    if (record !== undefined) return this.recordBinding(node, record);
    const nameNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Name
    );
    const typeNode = parts.find((k) => isTypeKind(kindOf(this.tree, k)));
    const init = initOf(this.tree, node, nameNode);
    const target = nameNode === undefined
      ? undefined
      : this.targets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    const annotation = typeNode === undefined
      ? undefined
      : this.lowerer.lower(typeNode).ref;
    let info: NodeInfo | undefined;
    if (init !== undefined) {
      if (kindOf(this.tree, init) === SyntaxKind.ArrowExpr) {
        if (id !== undefined) this.pendingLocals.add(id);
        info = this.arrow(init, this.contextOf(annotation));
        if (id !== undefined) this.pendingLocals.delete(id);
      } else {
        info = this.expr(init, annotation);
      }
    }
    let type: TypeRef;
    if (annotation !== undefined) {
      if (info !== undefined && init !== undefined) {
        this.fits(init, info.type, annotation, "the value");
      }
      type = annotation;
    } else {
      type = info === undefined ? this.table.error : this.widen(info.type);
    }
    if (id !== undefined) this.body.locals.set(id, type);
    if (id !== undefined) {
      this.refinements.addLocal(
        id,
        type,
        info?.mode === "pure" ? init : undefined,
      );
    }
    this.fact(node, { kind: "binding", id, type });
    return this.finish(node, type, info ?? PURE_EFFECTS);
  }

  private recordBinding(node: NodeId, record: NodeId): NodeInfo {
    const parts = this.kids(node);
    const typeNode = parts.find((k) => isTypeKind(kindOf(this.tree, k)));
    const init = parts.at(-1);
    if (init === undefined || init === record || init === typeNode) {
      return this.errorInfo(node);
    }
    const annotation = typeNode === undefined
      ? undefined
      : this.lowerer.lower(typeNode).ref;
    const subject = this.expr(init, annotation);
    this.fits(init, subject.type, annotation, "the value");
    const type = annotation ?? this.widen(subject.type);
    let name = `$record${node}`;
    while (this.tree.text.includes(name)) name += "$";
    const captured = {
      id: `local:${this.body.declaration}/${name}` as LocalId,
      name,
      type,
    };
    this.refinements.addLocal(
      captured.id,
      captured.type,
      subject.mode === "pure" ? init : undefined,
    );
    const seen = new Set<string>();
    const fields = [];
    for (const field of this.kids(record)) {
      const names = this.kids(field);
      const label = names[0], local = names.at(-1);
      if (label === undefined || local === undefined) continue;
      const name = nameTextOf(this.tree, label);
      const bindingName = nameTextOf(this.tree, local);
      if (name === undefined || bindingName === undefined) continue;
      if (seen.has(name)) {
        this.report(
          "declaration/001",
          `duplicate record binding field \`${name}\``,
          label,
        );
      }
      seen.add(name);
      const read = this.readField(type, name, label);
      const target = this.targets.get(local);
      const id = target?.kind === "local" ? target.id : undefined;
      if (id !== undefined) this.body.locals.set(id, read.type);
      if (id !== undefined) {
        this.refinements.addFieldLocal(id, read.type, captured.id, name);
      }
      this.finish(label, read.type, PURE_EFFECTS);
      this.finish(local, read.type, PURE_EFFECTS);
      fields.push({
        name,
        binding: { id, name: bindingName, type: read.type },
        label,
        local,
      });
    }
    this.fact(node, { kind: "record-binding", captured, fields });
    return this.finish(node, this.table.unit, subject);
  }

  /**
   * The common type of branch results. With an expected type each branch must fit
   * it and the result is the expected type. Without one, literals widen and the
   * result is the branch type that the others fit. Nominal records and errors
   * that no branch type covers join to their union.
   */
  private joinResults(
    branches: readonly { readonly node: NodeId; readonly type: TypeRef }[],
    expected: TypeRef | undefined,
  ): TypeRef {
    if (expected !== undefined) {
      for (const branch of branches) {
        this.fits(branch.node, branch.type, expected, "the branch");
      }
      return expected;
    }
    let joined: TypeRef | undefined;
    for (const branch of branches) {
      const type = this.widen(branch.type);
      if (joined === undefined) {
        joined = type;
      } else if (this.isError(joined) || this.isError(type)) {
        joined = this.table.error;
      } else if (this.assignable(type, joined)) {
        // The earlier type already covers this branch.
      } else if (this.assignable(joined, type)) {
        joined = type;
      } else if (this.isNominalJoin(joined, type)) {
        joined = this.table.union([joined, type]);
      } else {
        const [typeText, joinedText] = showTypes(this.table, type, joined);
        this.report(
          "type-mismatch/009",
          `this branch has type ${typeText}, which has no common type with ${joinedText} from the earlier branches`,
          branch.node,
        );
        joined = this.table.error;
      }
    }
    return joined ?? this.table.never;
  }

  /** True when every member of both types is a tagged record or an Effektive error, as in `domainOf`. */
  private isNominalJoin(a: TypeRef, b: TypeRef): boolean {
    return [a, b].every((type) =>
      flattenIdentityMembers(this.table, type).every((member) => {
        const node = this.table.node(member);
        return node.kind === "named" &&
          (isErrorId(node.id) ||
            this.table.taggedRecordOf(node.id) !== undefined);
      })
    );
  }

  private ifExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = this.kids(node);
    const condition = kids[0];
    if (condition === undefined) return this.errorInfo(node);
    const cond = this.expr(condition);
    if (
      !this.isError(cond.type) &&
      !isBoolean(this.table, this.module, cond.type)
    ) {
      this.report(
        "type-mismatch/007",
        `a condition must be boolean, but it has type ${this.show(cond.type)}`,
        condition,
      );
    }
    if (cond.mode === "effect") this.refinements.clearDerivedFacts();
    const successful: ReturnType<RefinementChecker["snapshot"]>[] = [];
    const infos: NodeInfo[] = [cond];
    const branches: { node: NodeId; type: TypeRef }[] = [];
    const conditionFact = this.refinements.condition(condition);
    for (const [index, branch] of kids.slice(1, 3).entries()) {
      const refinementScope = this.refinements.snapshot();
      this.refinements.addBranch(
        index === 1 && conditionFact !== undefined
          ? not(conditionFact)
          : conditionFact,
      );
      const info = this.expr(branch, expected);
      if (
        kindOf(this.tree, branch) !== SyntaxKind.Block &&
        expected !== undefined && this.refinementBase(expected) !== undefined
      ) {
        this.fits(branch, info.type, expected, "the branch");
      }
      infos.push(info);
      branches.push({ node: branch, type: info.type });
      if (this.table.unfold(info.type) !== this.table.never) {
        successful.push(this.refinements.snapshot());
      }
      this.refinements.restore(refinementScope);
    }
    this.refinements.join(successful);
    const type = expected !== undefined && this.refinementBase(expected)
      ? expected
      : this.joinResults(branches, expected);
    return this.finish(node, type, combine(infos));
  }

  // -------------------------------------------------------------- try and catch

  private tryExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = this.kids(node);
    const bodyNode = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Block
    );
    const catchNode = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.CatchClause
    );
    const finallyNode = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.FinallyClause
    );
    if (bodyNode === undefined) return this.errorInfo(node);
    const errorsBefore = this.errorCount;
    const body = this.expr(bodyNode, expected);
    const bodyHadErrors = this.errorCount > errorsBefore;
    const handlers = catchNode === undefined
      ? []
      : this.kidsOfKind(catchNode, SyntaxKind.Handler);
    const protectedSet = new Set<ErrorId>(body.failures);
    const handled = new Set<ErrorId>();
    // Every error that a handler names, so a repeat is a duplicate even for an absent error.
    const named = new Set<ErrorId>();
    const handlerInfos: NodeInfo[] = [];
    const branches = [{ node: bodyNode, type: body.type }];
    let defectSeen = false;
    for (const handler of handlers) {
      const parts = this.kids(handler);
      const nameNodes = parts.filter((k) =>
        kindOf(this.tree, k) === SyntaxKind.Name
      );
      const errorNode = nameNodes[0];
      const bindingNode = nameNodes[1];
      const handlerBody = parts.filter((k) =>
        kindOf(this.tree, k) !== SyntaxKind.Name
      ).pop();
      const isDefect = errorNode !== undefined &&
        nameTextOf(this.tree, errorNode) === "Defect";
      const errorTarget = errorNode === undefined || isDefect
        ? undefined
        : this.targets.get(errorNode);
      const error = errorTarget?.kind === "error" ? errorTarget.id : undefined;
      const bindingTarget = bindingNode === undefined
        ? undefined
        : this.targets.get(bindingNode);
      const binding = bindingTarget?.kind === "local"
        ? bindingTarget.id
        : undefined;
      if (isDefect && errorNode !== undefined) {
        if (defectSeen) {
          this.report(
            "failure-contract/003",
            "the `Defect` arm already has a handler",
            errorNode,
          );
        }
        defectSeen = true;
      }
      if (error !== undefined && errorNode !== undefined) {
        const repeated = named.has(error);
        named.add(error);
        if (repeated) {
          this.report(
            "failure-contract/003",
            `the error \`${shortName(error)}\` already has a handler`,
            errorNode,
          );
        } else if (!protectedSet.has(error)) {
          if (!bodyHadErrors) {
            this.report(
              "failure-contract/002",
              `the protected block cannot fail with \`${shortName(error)}\``,
              errorNode,
            );
          }
        } else {
          handled.add(error);
        }
      }
      if (isDefect && bindingNode !== undefined) {
        this.outcomeParameter(
          bindingNode,
          this.table.record([
            { name: "message", type: this.table.string, optional: false },
          ]),
        );
      } else if (binding !== undefined) {
        this.body.locals.set(
          binding,
          error === undefined ? this.table.error : this.table.named(error),
        );
      }
      this.fact(
        handler,
        isDefect
          ? { kind: "handler", error, binding, defect: true }
          : { kind: "handler", error, binding },
      );
      if (handlerBody === undefined) {
        handlerInfos.push(this.errorInfo(handler));
        continue;
      }
      const info = this.expr(handlerBody, expected);
      handlerInfos.push(this.finish(handler, info.type, info));
      branches.push({ node: handlerBody, type: info.type });
    }
    const remaining: EffectSet = {
      failures: without(body.failures, [...handled]),
      requirements: body.requirements,
      mode: body.mode,
    };
    const type = this.joinResults(branches, expected);
    const protectedPart = combine([remaining, ...handlerInfos, EFFECT_ONLY]);
    const finalizer = finallyNode === undefined
      ? []
      : [this.finallyClause(finallyNode, type, protectedPart)];
    return this.finish(node, type, combine([protectedPart, ...finalizer]));
  }

  /** The finalizer of a `try`: a unit block that may bind the outcome. */
  private finallyClause(
    node: NodeId,
    result: TypeRef,
    protectedSet: EffectSet,
  ): NodeInfo {
    const parts = this.kids(node);
    const nameNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.Name
    );
    const block = parts.find((k) => kindOf(this.tree, k) === SyntaxKind.Block);
    let binding: ArrowParameterFact | undefined;
    if (nameNode !== undefined) {
      binding = this.outcomeParameter(
        nameNode,
        outcomeType(this.table, result, protectedSet.failures),
      );
      if (!dataOnly(this.table, result, "value")) {
        this.report(
          "type-mismatch/010",
          "the protected result must be data only when `finally` binds the outcome",
          nameNode,
        );
      }
    }
    this.fact(node, { kind: "finalizer", binding, protectedSet });
    if (block === undefined) return this.errorInfo(node);
    const info = this.expr(block);
    this.fits(block, info.type, this.table.unit, "the finally result");
    return this.finish(node, this.table.unit, info);
  }

  private optionFallback(
    node: NodeId,
    expected: TypeRef | undefined,
  ): NodeInfo {
    const [left, right] = this.kids(node);
    if (left === undefined || right === undefined) return this.errorInfo(node);
    const subject = this.expr(left);
    const element = this.optionElement(subject.type);
    const fallback = this.expr(right, expected);
    if (element === undefined) {
      if (!this.isError(subject.type)) {
        this.report(
          "type-mismatch/010",
          "the left operand of `??` must be an Option",
          left,
        );
      }
      return this.errorInfo(node);
    }
    let name = `$option${node}`;
    while (this.tree.text.includes(name)) name += "$";
    const id: LocalId = `local:${this.body.declaration}/${name}`;
    this.fact(node, {
      kind: "option-fallback",
      binding: { id, name, type: element },
    });
    const type = this.joinResults([{ node: left, type: element }, {
      node: right,
      type: fallback.type,
    }], expected);
    return this.finish(node, type, combine([subject, fallback]));
  }

  // -------------------------------------------------------------- match

  private match(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = this.kids(node);
    const subjectNode = kids[0];
    if (subjectNode === undefined) return this.errorInfo(node);
    const subject = this.expr(subjectNode);
    const arms = kids.slice(1).filter((k) =>
      kindOf(this.tree, k) === SyntaxKind.MatchArm
    );
    const domain = domainOf(this.table, subject.type);
    if (domain.kind === "unsupported") {
      this.report(
        "pattern/004",
        `a match cannot take a value of type ${
          this.show(subject.type)
        }; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, and primitives`,
        subjectNode,
      );
    } else if (domain.kind === "mixed") {
      this.report(
        "pattern/004",
        `a match cannot take a value of type ${
          this.show(subject.type)
        }, which mixes tagged records or errors with other types; a match over names needs tagged records or errors only`,
        subjectNode,
      );
    }
    const state: MatchState = {
      wildcard: false,
      covered: new Set(),
      tagField: undefined,
    };
    if (subject.mode === "effect") this.refinements.clearDerivedFacts();
    const successful: ReturnType<RefinementChecker["snapshot"]>[] = [];
    const excluded: ReturnType<RefinementChecker["condition"]>[] = [];
    const infos: NodeInfo[] = [subject];
    const branches: { node: NodeId; type: TypeRef }[] = [];
    for (const arm of arms) {
      const refinementScope = this.refinements.snapshot();
      for (const fact of excluded) this.refinements.addBranch(fact);
      const parts = this.kids(arm);
      const patternNode = parts.find((k) =>
        isPatternKind(kindOf(this.tree, k))
      );
      const bodyNode = parts.filter((k) => k !== patternNode).pop();
      if (patternNode !== undefined) {
        pattern(this, patternNode, domain, state);
        const fact = this.body.facts.get(patternNode);
        if (fact?.kind === "pattern") {
          if (
            fact.pattern.kind === "literal" || fact.pattern.kind === "duration"
          ) {
            const matched = this.refinements.matchLiteral(
              subjectNode,
              fact.pattern.kind === "literal"
                ? fact.pattern.value
                : fact.pattern.millis,
            );
            this.refinements.addBranch(matched);
            if (matched !== undefined) excluded.push(not(matched));
          }
          const binding = fact.pattern.kind === "some" ||
              fact.pattern.kind === "error" || fact.pattern.kind === "tagged"
            ? fact.pattern.binding
            : fact.pattern.kind === "tag"
            ? fact.pattern.binding ?? undefined
            : undefined;
          if (binding !== undefined) {
            const type = this.body.locals.get(binding);
            if (type !== undefined) this.refinements.addLocal(binding, type);
          }
        }
      }
      if (bodyNode === undefined) {
        this.refinements.restore(refinementScope);
        continue;
      }
      const info = this.expr(bodyNode, expected);
      if (
        kindOf(this.tree, bodyNode) !== SyntaxKind.Block &&
        expected !== undefined && this.refinementBase(expected) !== undefined
      ) {
        this.fits(bodyNode, info.type, expected, "the branch");
      }
      infos.push(info);
      branches.push({ node: bodyNode, type: info.type });
      this.finish(arm, info.type, info);
      if (this.table.unfold(info.type) !== this.table.never) {
        successful.push(this.refinements.snapshot());
      }
      this.refinements.restore(refinementScope);
    }
    this.refinements.join(successful);
    if (!state.wildcard) checkCoverage(this, node, domain, state, arms.length);
    const type = expected !== undefined && this.refinementBase(expected)
      ? expected
      : this.joinResults(branches, expected);
    return this.finish(node, type, combine(infos));
  }
}

// ------------------------------------------------------------------ entry points

/** Checks the body of a module-level function against its signature. */
export function checkFunctionBody(
  benv: BodyEnv,
  signature: FunctionSignature,
  bodyNode: NodeId | undefined,
): FunctionRun {
  const checker = new BodyChecker(benv, signature.id);
  for (const parameter of signature.parameters) {
    if (parameter.id !== undefined) {
      checker.body.locals.set(parameter.id, parameter.type.ref);
      checker.refinements.addLocal(parameter.id, parameter.type.ref);
    }
  }
  const { written } = signature;
  const contract: Contract = {
    result: written.result ? signature.result?.ref : undefined,
    failures: written.fails ? signature.failures : undefined,
    requirements: written.uses ? signature.requirements : undefined,
  };
  const run = checker.checkBody(bodyNode, contract, undefined);
  const checked = checkedInputFlags(signature, benv.env.table);
  const checkedInput = checked.some(Boolean);
  if (checkedInput) {
    for (const parameter of signature.parameters) {
      if (
        !parameter.inferred || parameter.type.ref === benv.env.table.unknown
      ) continue;
      const table = benv.env.table;
      if (
        !dataOnly(table, parameter.type.ref, "entry", true) ||
        containsOpaqueType(table, parameter.type.ref) ||
        table.foreignSealedOf(benv.env.module, parameter.type.ref) !== undefined
      ) {
        checker.sink.push(
          makeDiagnostic(
            "type-mismatch/010",
            `the inferred input \`${parameter.name}\` has no compiler-derived schema; use a concrete annotation or a source-owned decoder`,
            parameter.span,
          ),
        );
      }
    }
  }
  if (checkedInput && !signature.failures.includes(SCHEMA_ERROR_ID)) {
    checker.sink.push(makeDiagnostic(
      "failure-contract/001",
      "an exported function with an inferred input contract must list SchemaError in its `fails` clause",
      signature.span,
    ));
  }
  if (
    signature.expectedExecution === "pure" &&
    (checkedInput || run.mode !== "pure") &&
    bodyNode !== undefined
  ) {
    checker.report(
      "type-mismatch/003",
      "the function body has effect execution, but a pure function is expected",
      bodyNode,
    );
  }
  for (const parameter of signature.parameters) {
    if (parameter.borrow) {
      checkBorrowedParameter(checker, bodyNode, parameter, run.result);
    }
  }
  const table = benv.env.table;
  const failures = checkedInput && !run.failures.includes(SCHEMA_ERROR_ID)
    ? sortedUnique([...run.failures, SCHEMA_ERROR_ID])
    : run.failures;
  const mode = checkedInput ? "effect" : run.mode;
  const type = table.function({
    execution: mode,
    parameters: signature.parameters.map((p) => p.type.ref),
    borrows: signature.parameters.map((p) => p.borrow),
    checked,
    result: run.result,
    failures,
    requirements: run.requirements,
  });
  return {
    table: checker.body,
    body: run.body,
    result: run.result,
    failures,
    requirements: run.requirements,
    mode,
    type,
    diagnostics: checker.sink,
  };
}

/** Checks the initializer of a module-level constant. */
export function checkConstantBody(
  benv: BodyEnv,
  signature: ConstantSignature,
  initNode: NodeId | undefined,
): ConstantRun {
  const checker = new BodyChecker(benv, signature.id);
  const run = checker.checkConstant(initNode, signature.type?.ref);
  return {
    table: checker.body,
    init: run.init,
    type: run.type,
    diagnostics: checker.sink,
  };
}
