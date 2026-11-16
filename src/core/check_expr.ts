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
  makeDiagnosticWithRelated,
  type RelatedSpan,
} from "./diagnostics.ts";
import {
  argNodes,
  arrowBody,
  type BinaryOperator,
  functionParts,
  initOf,
  isArithmeticOperator,
  isDurationLiteral,
  isPatternKind,
  isTypeKind,
  kidsOf as syntaxKidsOf,
  kidsOfKind as syntaxKidsOfKind,
  literalOf,
  memberAccessParts,
  nameTextOf,
  operatorOf,
  paramNodes,
  paramParts,
  pipeParts,
  type RecordFieldParts,
  recordFieldParts,
  stageParts,
  unaryOperatorOf,
  unparen,
} from "./syntax_queries.ts";
import { isBoolean, operatorResult } from "./check_binary.ts";
import { type ContractEntry, contractOrigins } from "./contract_origins.ts";
import {
  checkCoverage,
  createMatchState,
  type MatchState,
  pattern,
  type PatternContext,
} from "./check_patterns.ts";
import { DURATION_ID, SCHEMA_ERROR_ID } from "./ir.ts";
import type {
  CapabilityId,
  ErrorId,
  Execution,
  LocalId,
  TypeId,
  ValueId,
} from "./ir.ts";
import {
  isOptionConstructorName,
  optionConstructorOf,
  optionRole,
  type PreludeName,
  type Target,
} from "./resolve.ts";
import type { Result, Span } from "./source.ts";
import { kindOf, type NodeId, nodeSpan, SyntaxKind } from "./syntax.ts";
import {
  checkedInputFlags,
  type ConstantSignature,
  type FunctionSignature,
  signatureFunctionRef,
} from "./signatures.ts";
import { TypeLowerer } from "./type_lower.ts";
import {
  domainOf,
  flattenIdentityMembers,
  flattenMembers,
  type LiteralValue,
} from "./patterns.ts";
import {
  combine,
  EFFECT_ONLY,
  type EffectSet,
  isQuiet,
  PURE_EFFECTS,
  without,
} from "./effect_set.ts";
import {
  type ArrowParameterFact,
  type BodyBuilder,
  type BodyTable,
  createBodyBuilder,
  type NodeFact,
  type NodeInfo,
} from "./tables.ts";
import {
  containsOpaqueType,
  containsUnknownPredicateInput,
  dataOnly,
  literalFitsPrimitive,
  MAX_DEPTH,
  type RecordField,
  type TypeRef,
} from "./types.ts";
import { arityMessage, sortedUnique } from "./util.ts";
import { showType, showTypes } from "./type_show.ts";
import { functionTypeToIr } from "./type_ir.ts";
import { bodyLocalId, isReservedErrorId, isTypeId, shortName } from "./ids.ts";
import {
  type Arg,
  type BuiltinContext,
  type FunctionNode,
  invocationOf,
  isEffectfulFunction,
  type LiteralField,
  type LocalUse,
} from "./check_builtins/context.ts";
import type { CollectionContext } from "./check_builtins/collections.ts";
import type { EffectContext } from "./check_builtins/effect.ts";
import type { LayerContext } from "./check_builtins/layer.ts";
import { createFamilyRows } from "./check_builtins/registry.ts";
import {
  type BuiltinRow,
  keyFact,
  type PreludeCallName,
  type Prologue,
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
import type { BodyEnv } from "./body_env.ts";
import {
  RefinementChecker,
  type RefinementDecision,
} from "./check_refinements.ts";
import { not } from "./predicates.ts";
import { emptyMap, emptySet, setFrom } from "./runtime.ts";

/**
 * The contract of a function body. An absent part is open: the body infers it.
 * A present part is closed, and the body must stay within it.
 */
type Contract = {
  readonly result: TypeRef | undefined;
  readonly failures: readonly ErrorId[] | undefined;
  readonly requirements: readonly CapabilityId[] | undefined;
};

/** A saved refinement state. */
type RefinementSnapshot = ReturnType<RefinementChecker["snapshot"]>;

type BranchResult = {
  readonly node: NodeId;
  readonly type: TypeRef;
};

/** The branch results of an `if` or `match` that `joinArms` combines. */
type BranchArms = {
  readonly infos: () => readonly NodeInfo[];
  readonly branches: () => readonly BranchResult[];
  readonly successful: () => readonly RefinementSnapshot[];
  readonly add: (
    info: NodeInfo,
    branch: BranchResult,
    snapshot: RefinementSnapshot | undefined,
  ) => BranchArms;
};

function createBranchArms(initial: readonly NodeInfo[]): BranchArms {
  const infos = [...initial];
  const branches: BranchResult[] = [];
  const successful: RefinementSnapshot[] = [];
  function readInfos(): readonly NodeInfo[] {
    return infos;
  }
  function readBranches(): readonly BranchResult[] {
    return branches;
  }
  function readSuccessful(): readonly RefinementSnapshot[] {
    return successful;
  }
  function add(
    info: NodeInfo,
    branch: BranchResult,
    snapshot: RefinementSnapshot | undefined,
  ): BranchArms {
    infos[infos.length] = info;
    branches[branches.length] = branch;
    if (snapshot !== undefined) successful[successful.length] = snapshot;
    return arms;
  }
  const arms: BranchArms = {
    infos: readInfos,
    branches: readBranches,
    successful: readSuccessful,
    add: add,
  };
  return arms;
}

/** The labels, literal values, and known name types that pick a record target. */
type RecordScan = {
  readonly labels: readonly string[];
  readonly literals: ReadonlyMap<string, LiteralValue>;
  readonly known: ReadonlyMap<string, TypeRef>;
};

type BodyOutcome = {
  /** The info of the body expression. Absent when the body is missing. */
  readonly body: NodeInfo | undefined;
  /** The declared or inferred result type. */
  readonly result: TypeRef;
  /** The invocation sets: declared for a closed set, inferred for an open one. */
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  readonly mode: Execution;
};

export type FunctionRun = BodyOutcome & {
  readonly table: BodyTable;
  /** The function type with that mode. */
  readonly type: TypeRef;
  readonly diagnostics: readonly Diagnostic[];
};

export type ConstantRun = {
  readonly table: BodyTable;
  /** The binding annotation, or the widened type of the initializer. */
  readonly type: TypeRef;
  readonly diagnostics: readonly Diagnostic[];
};

/** The three parts of a `using` expression. */
const RESOURCE_PARTS: readonly SyntaxKind[] = [
  SyntaxKind.ResourceAcquire,
  SyntaxKind.ResourceUse,
  SyntaxKind.ResourceRelease,
];

type ArrowContext = {
  readonly parameters: readonly TypeRef[];
  readonly result: TypeRef | undefined;
};

type TargetFields = {
  readonly ref: TypeRef;
  readonly fields: readonly RecordField[];
};

type RecordTarget =
  | ({ readonly kind: "record" } & TargetFields)
  | ({ readonly kind: "construct"; readonly id: TypeId } & TargetFields)
  | { readonly kind: "variants"; readonly ids: readonly TypeId[] };

function names(ids: readonly string[]): string {
  return ids.map(shortName).join(", ");
}

type BodyChecker =
  & BuiltinContext
  & CollectionContext
  & EffectContext
  & LayerContext
  & ScopeContext
  & StreamContext
  & SchemaContext
  & Omit<PatternContext, "recordLocal" | "report" | "fact">
  & {
    readonly sink: readonly Diagnostic[];
    readonly addDiagnostic: (diagnostic: Diagnostic) => BodyChecker;
    readonly body: BodyTable;
    readonly recordLocal: (local: LocalId, type: TypeRef) => BodyChecker;
    readonly report: (
      code: DiagnosticCode,
      message: string,
      node: NodeId,
    ) => BodyChecker;
    readonly fact: (node: NodeId, fact: NodeFact) => BodyChecker;
    readonly checkFit: (
      node: NodeId,
      found: TypeRef,
      expected: TypeRef | undefined,
      what: string,
    ) => BodyChecker;
    readonly inlineStreamCallback: (name: string, arg: Arg) => BodyChecker;
    readonly noPipeline: (name: string, args: readonly Arg[]) => BodyChecker;
    readonly bindLocal: (
      local: LocalId | undefined,
      type: TypeRef,
      init: NodeId | undefined,
    ) => BodyChecker;
    readonly checkBody: (
      bodyNode: NodeId | undefined,
      contract: Contract,
      hint: TypeRef | undefined,
    ) => BodyOutcome;
    readonly checkConstant: (
      initNode: NodeId | undefined,
      annotation: TypeRef | undefined,
    ) => { readonly type: TypeRef };
  };

// Family contexts expose only the checker operations and read views they need.
function createBodyChecker(benv: BodyEnv, declaration: ValueId): BodyChecker {
  const sink: Diagnostic[] = [];
  const tree = benv.env.tree;
  const table = benv.env.table;
  const module = benv.env.module;
  const targets = benv.env.targets;
  const familyRows = createFamilyRows();
  const lowerer = TypeLowerer(benv.env, sink);
  let bodyBuilder: BodyBuilder = createBodyBuilder(declaration);
  const bodyTable = bodyBuilder.table;
  let refinements = RefinementChecker(
    tree,
    table,
    module,
    targets,
    benv.proofBudget,
  );
  /** Block-local functions whose bodies are being checked. */
  let pendingLocals = emptySet<LocalId>();
  /** Counts the error nodes made so far. Recovery uses it to hold back cascades. */
  let errorCount = 0;
  let checkedSlots = emptySet<NodeId>();

  function valueType(id: ValueId): TypeRef {
    return benv.values(id);
  }

  function children(node: NodeId): NodeId[] {
    return syntaxKidsOf(tree, node);
  }

  function childrenOfKind(node: NodeId, kind: SyntaxKind): NodeId[] {
    return syntaxKidsOfKind(tree, node, kind);
  }

  function span(node: NodeId): Span {
    return nodeSpan(tree, node);
  }

  function uniqueLocalName(seed: string): string {
    let name = seed;
    for (const _character of tree.text) {
      if (!tree.text.includes(name)) return name;
      name = name + "$";
    }
    return name;
  }

  function report(
    code: DiagnosticCode,
    message: string,
    node: NodeId,
  ): BodyChecker {
    return reportRelated(code, message, node, []);
  }

  function addDiagnostic(diagnostic: Diagnostic): BodyChecker {
    sink[sink.length] = diagnostic;
    return checker;
  }

  function reportRelated(
    code: DiagnosticCode,
    message: string,
    node: NodeId,
    related: readonly RelatedSpan[],
  ): BodyChecker {
    sink[sink.length] = makeDiagnosticWithRelated(
      code,
      message,
      span(node),
      related,
    );
    return checker;
  }

  /** The related locations of the missing entries of a body, in source order. */
  function originsOf(
    root: NodeId,
    entries: readonly ContractEntry[],
  ): RelatedSpan[] {
    const related: RelatedSpan[] = [];
    for (const entry of entries) {
      const message = entry.kind === "failure"
        ? `can fail with \`${shortName(entry.error)}\` here`
        : `requires \`${shortName(entry.capability)}\` here`;
      for (
        const span of contractOrigins(tree, bodyTable, root, entry)
      ) related[related.length] = { span: span, message: message };
    }
    return related.sort((a, b) => a.span.start - b.span.start);
  }

  function show(ref: TypeRef): string {
    return showType(table, ref);
  }

  function isError(ref: TypeRef): boolean {
    return table.node(ref).kind === "error";
  }

  function nodeInfo(type: TypeRef, eff: EffectSet): NodeInfo {
    return {
      type: type,
      failures: eff.failures,
      requirements: eff.requirements,
      mode: eff.mode,
    };
  }

  function finish(node: NodeId, type: TypeRef, eff: EffectSet): NodeInfo {
    const info = nodeInfo(type, eff);
    bodyBuilder = bodyBuilder.recordInfo(node, info);
    return info;
  }

  function recordInfo(
    node: NodeId,
    type: TypeRef,
    eff: EffectSet,
  ): BodyChecker {
    bodyBuilder = bodyBuilder.recordInfo(node, nodeInfo(type, eff));
    return checker;
  }

  function recordFact(node: NodeId, fact: NodeFact): BodyChecker {
    bodyBuilder = bodyBuilder.recordFact(node, fact);
    return checker;
  }

  function recordLocal(local: LocalId, type: TypeRef): BodyChecker {
    bodyBuilder = bodyBuilder.recordLocal(local, type);
    return checker;
  }

  /** Records a local in the body table and in the refinement state. A missing local records nothing. */
  function bindLocal(
    local: LocalId | undefined,
    type: TypeRef,
    init: NodeId | undefined,
  ): BodyChecker {
    if (local !== undefined) {
      bodyBuilder = bodyBuilder.recordLocal(local, type);
      refinements = refinements.addLocal(local, type, init);
    }
    return checker;
  }

  function checkPattern(
    node: NodeId,
    domain: ReturnType<typeof domainOf>,
    state: MatchState,
  ): BodyChecker {
    if (pattern(checker, node, domain, state) === checker) return checker;
    return checker;
  }

  function checkPatternCoverage(
    node: NodeId,
    domain: ReturnType<typeof domainOf>,
    state: MatchState,
    armCount: number,
  ): BodyChecker {
    if (checkCoverage(checker, node, domain, state, armCount) === checker) {
      return checker;
    }
    return checker;
  }

  function errorInfo(node: NodeId): NodeInfo {
    errorCount = errorCount + 1;
    return finish(node, table.error, PURE_EFFECTS);
  }

  /** Source compatibility in the module that owns this body. */
  function assignable(found: TypeRef, expected: TypeRef): boolean {
    return table.isAssignableIn(module, found, expected);
  }

  /** Reports a mismatch when `found` does not fit `expected`. Returns true when it fits. */
  function fits(
    node: NodeId,
    found: TypeRef,
    expected: TypeRef | undefined,
    what: string,
  ): boolean {
    if (
      expected === undefined || assignable(found, expected) ||
      (checkedSlots.has(node) && checkedTypeFits(found, expected))
    ) {
      return true;
    }
    if (bodyTable.info.get(node)?.mode === "effect") {
      refinements = refinements.clearDerivedFacts();
    }
    const refinement = refinementBase(expected);
    if (
      refinement !== undefined &&
      table.node(table.unfoldTransparent(found)).kind !== "named" &&
      assignable(found, refinement.base)
    ) {
      return requireRefinement(node, expected, what);
    }
    const shown = showTypes(table, [found, expected]);
    const foundText = shown[0];
    const expectedText = shown[1];
    checker = report(
      "type-mismatch/003",
      `${what} has type ${foundText}, but ${expectedText} is expected`,
      node,
    );
    return false;
  }

  function checkFit(
    node: NodeId,
    found: TypeRef,
    expected: TypeRef | undefined,
    what: string,
  ): BodyChecker {
    if (fits(node, found, expected, what)) return checker;
    return checker;
  }

  function refinementBase(
    ref: TypeRef,
  ): { readonly id: TypeId; readonly base: TypeRef } | undefined {
    const node = table.node(table.unfoldTransparent(ref));
    if (node.kind !== "named" || !isTypeId(node.id)) return undefined;
    const id = node.id;
    if (table.predicateOf(id) === undefined) return undefined;
    const base = table.identityBaseOf(id);
    return base === undefined ? undefined : { id: id, base: base };
  }

  function requireRefinement(
    node: NodeId,
    expected: TypeRef,
    what: string,
  ): boolean {
    return recordRefinement(
      node,
      refinements.prove(node, expected),
      what,
      refinementBase(expected)?.id,
    );
  }

  function recordRefinement(
    node: NodeId,
    decision: RefinementDecision,
    what: string,
    target: TypeId | undefined,
  ): boolean {
    if (decision.status === "not-required") return true;
    if (decision.status === "proved") {
      node = unparen(tree, node);
      const current = bodyTable.proofs.get(node) ?? [];
      if (!current.some((proof) => proof.target === decision.proof.target)) {
        bodyBuilder = bodyBuilder.recordProofs(node, [
          ...current,
          decision.proof,
        ]);
      }
      return true;
    }
    let detail = "does not prove";
    if (decision.reason === "disproved") detail = "does not satisfy";
    if (decision.reason === "exhausted") {
      detail = "exceeds the proof limit for";
    }
    checker = report(
      "type-mismatch/013",
      `${what} ${detail} the required refinement${
        target === undefined ? "" : ` ${shortName(target)}`
      }`,
      node,
    );
    return false;
  }

  function requireRefinementState(
    node: NodeId,
    expected: TypeRef,
    what: string,
  ): BodyChecker {
    if (requireRefinement(node, expected, what)) return checker;
    return checker;
  }

  function preserveRefinementState(
    node: NodeId,
    id: TypeId,
    what: string,
  ): BodyChecker {
    return recordRefinementState(
      node,
      refinements.proveIdentity(node, id),
      what,
      id,
    );
  }

  function recordRefinementState(
    node: NodeId,
    decision: RefinementDecision,
    what: string,
    target: TypeId | undefined,
  ): BodyChecker {
    if (recordRefinement(node, decision, what, target)) return checker;
    return checker;
  }

  /** Literal types of a fresh value become their primitive. Declared types stay. */
  function widen(ref: TypeRef): TypeRef {
    const node = table.node(ref);
    if (node.kind === "literal") return primitiveOf(node.value);
    if (
      node.kind === "union" &&
      node.members.some((m) => table.node(m).kind === "literal")
    ) {
      return table.union(node.members.map((m) => widen(m)));
    }
    return ref;
  }

  function primitiveOf(value: LiteralValue): TypeRef {
    if (value === null) return table.literal(null);
    if (typeof value === "string") return table.string;
    if (typeof value === "boolean") return table.boolean;
    return literalFitsPrimitive(value, "int") ? table.int : table.number;
  }

  function functionOf(ref: TypeRef): FunctionNode | undefined {
    const node = table.node(table.unfold(ref));
    return node.kind === "function" ? node : undefined;
  }

  function contextOf(expected: TypeRef | undefined): ArrowContext | undefined {
    if (expected === undefined) return undefined;
    const fn = functionOf(expected);
    return fn === undefined
      ? undefined
      : { parameters: fn.parameters, result: fn.result };
  }

  /**
   * Checks a function body against its contract. The parameters must already be
   * in `locals`.
   */
  function checkBody(
    bodyNode: NodeId | undefined,
    contract: Contract,
    hint: TypeRef | undefined,
  ): BodyOutcome {
    if (bodyNode === undefined) {
      const failures = contract.failures ?? [];
      const requirements = contract.requirements ?? [];
      return {
        body: undefined,
        result: contract.result ?? table.error,
        failures: failures,
        requirements: requirements,
        mode: failures.length + requirements.length > 0 ? "effect" : "pure",
      };
    }
    const body = expr(bodyNode, contract.result ?? hint);
    if (contract.result !== undefined) {
      checker = checkFit(
        bodyNode,
        body.type,
        contract.result,
        "the function body",
      );
    }
    const extraFailures = contract.failures === undefined
      ? []
      : without(body.failures, contract.failures);
    if (extraFailures.length > 0) {
      checker = reportRelated(
        "failure-contract/001",
        `the body can fail with ${
          names(extraFailures)
        }, which the \`fails\` clause does not list`,
        bodyNode,
        originsOf(
          bodyNode,
          extraFailures.map((error) => ({ kind: "failure", error: error })),
        ),
      );
    }
    const extraRequirements = contract.requirements === undefined
      ? []
      : without(body.requirements, contract.requirements);
    if (extraRequirements.length > 0) {
      checker = reportRelated(
        "requirement-contract/001",
        `the body requires ${
          names(extraRequirements)
        }, which the \`with\` clause does not list`,
        bodyNode,
        originsOf(
          bodyNode,
          extraRequirements.map((capability) => ({
            kind: "requirement",
            capability: capability,
          })),
        ),
      );
    }
    const failures = contract.failures ?? body.failures;
    const requirements = contract.requirements ?? body.requirements;
    return {
      body: body,
      result: contract.result ?? widen(body.type),
      failures: failures,
      requirements: requirements,
      mode: failures.length + requirements.length > 0 ? "effect" : body.mode,
    };
  }

  function checkConstant(
    initNode: NodeId | undefined,
    annotation: TypeRef | undefined,
  ): { readonly type: TypeRef } {
    if (initNode === undefined) {
      return { type: annotation ?? table.error };
    }
    const init = expr(initNode, annotation);
    checker = checkFit(initNode, init.type, annotation, "the constant");
    if (
      init.mode === "effect" || init.failures.length > 0 ||
      init.requirements.length > 0
    ) {
      checker = report(
        "execution-mode/002",
        "a module constant must have a pure initializer with empty failure and requirement sets",
        initNode,
      );
    }
    return { type: annotation ?? widen(init.type) };
  }

  function expr(
    node: NodeId,
    expected: TypeRef | undefined,
  ): NodeInfo {
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.LiteralExpr) return literal(node, expected);
    if (kind === SyntaxKind.NameExpr) {
      return referenceInfo(node, targets.get(node), expected);
    }
    if (kind === SyntaxKind.ParenExpr) {
      const inner = children(node)[0];
      if (inner === undefined) return errorInfo(node);
      const info = expr(inner, expected);
      return finish(node, info.type, info);
    }
    if (kind === SyntaxKind.UsingExpr) {
      const args = children(node).filter((child) =>
        RESOURCE_PARTS.includes(kindOf(tree, child))
      ).map((child) => ({ node: child }));
      if (args.length !== 3) return errorInfo(node);
      return withResourceCall(checker, node, args, expected);
    }
    if (kind === SyntaxKind.ArrowExpr) return arrow(node, contextOf(expected));
    if (kind === SyntaxKind.CallExpr) return call(node, expected);
    if (kind === SyntaxKind.FieldExpr) return fieldExpr(node);
    if (kind === SyntaxKind.BinaryExpr) return binary(node);
    if (kind === SyntaxKind.UnaryExpr) return unary(node);
    if (kind === SyntaxKind.OptionFallbackExpr) {
      return optionFallback(node, expected);
    }
    if (kind === SyntaxKind.PipeExpr) return pipe(node, expected);
    if (kind === SyntaxKind.RecordExpr) return recordExpr(node, expected);
    if (kind === SyntaxKind.ListExpr) return listExpr(node, expected);
    if (kind === SyntaxKind.Block) return block(node, expected);
    if (kind === SyntaxKind.IfExpr) return ifExpr(node, expected);
    if (kind === SyntaxKind.MatchExpr) return match(node, expected);
    if (kind === SyntaxKind.TryExpr) return tryExpr(node, expected);
    return errorInfo(node);
  }

  function argInfo(
    arg: Arg,
    expected: TypeRef | undefined,
  ): NodeInfo {
    return arg.pre ?? expr(arg.node, expected);
  }

  function literal(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const value = literalOf(tree, node);
    if (value === undefined) return errorInfo(node);
    if (isDurationLiteral(tree, node)) {
      return finish(node, table.named(DURATION_ID), PURE_EFFECTS);
    }
    return finish(node, literalType(value, expected), PURE_EFFECTS);
  }

  /** An expected literal alternative survives. Otherwise the literal takes its primitive. */
  function literalType(
    value: LiteralValue,
    expected: TypeRef | undefined,
  ): TypeRef {
    if (expected !== undefined) {
      const members = flattenMembers(table, expected).map((m) => table.node(m));
      if (members.some((m) => m.kind === "literal" && m.value === value)) {
        return table.literal(value);
      }
      if (typeof value === "number") {
        const hasInt = members.some((m) =>
          m.kind === "primitive" && m.name === "int"
        );
        const hasNumber = members.some((m) =>
          m.kind === "primitive" && m.name === "number"
        );
        if (hasNumber && !(hasInt && literalFitsPrimitive(value, "int"))) {
          return table.number;
        }
      }
    }
    return primitiveOf(value);
  }

  function referenceInfo(
    node: NodeId,
    target: Target | undefined,
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (target === undefined) return errorInfo(node);
    if (target.kind === "local") {
      if (pendingLocals.has(target.id)) {
        checker = report(
          "execution-mode/003",
          "a local function cannot refer to itself; a recursive function must be a module-level function with an explicit signature",
          node,
        );
        return errorInfo(node);
      }
      return finish(
        node,
        bodyTable.locals.get(target.id) ?? table.error,
        PURE_EFFECTS,
      );
    }
    if (target.kind === "value" || target.kind === "provider") {
      return finish(node, benv.values(target.id), PURE_EFFECTS);
    }
    if (optionConstructorOf(target) === "none") {
      return none(node, expected);
    }
    return errorInfo(node);
  }

  function none(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const element = table.optionElementOf(expected);
    const type = element === undefined
      ? table.option(table.never)
      : table.option(element);
    checker = recordFact(node, { kind: "none" });
    return finish(node, type, PURE_EFFECTS);
  }

  function call(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = children(node);
    const callee = kids[0];
    if (callee === undefined) return errorInfo(node);
    const args: Arg[] = argNodes(tree, node).map((n) => ({ node: n }));
    const calleeKind = kindOf(tree, callee);
    const target = calleeKind === SyntaxKind.NameExpr ||
        calleeKind === SyntaxKind.FieldExpr
      ? targets.get(callee)
      : undefined;
    // A callee without a target is an ordinary expression that evaluates to a function.
    return target === undefined
      ? apply(node, expr(callee, undefined), args)
      : invoke(node, callee, target, args, expected);
  }

  /**
   * Checks a call. `callee` is the callee expression or, for a pipeline stage, the
   * qualified name.
   */
  function invoke(
    node: NodeId,
    callee: NodeId,
    target: Target,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (target.kind === "builtin") {
      return builtinCall(node, target.name, args, expected);
    }
    if (target.kind === "error") {
      return errorConstruction(node, target.id, args);
    }
    if (target.kind === "type") {
      const record = table.taggedRecordOf(target.id);
      if (record === undefined) {
        return identityConstruction(node, target.id, args);
      }
      checker = requireSealedOwner(node, target.id);
      checker = recordFact(node, {
        kind: "identity-construction",
        identity: target.id,
      });
      return constructFrom(node, target.id, record, "tagged record", args);
    }
    if (target.kind === "cap") return perform(node, target.id, args);
    if (
      target.kind === "local" || target.kind === "value" ||
      target.kind === "provider"
    ) {
      return apply(node, referenceInfo(callee, target, undefined), args);
    }
    return unresolvedCall(node, args);
  }

  /**
   * Checks the arguments without a hint, reports `diagnostic` when it is given,
   * and finishes the call with the error type.
   */
  function rejectCall(
    node: NodeId,
    args: readonly Arg[],
    diagnostic:
      | { readonly code: DiagnosticCode; readonly message: string }
      | undefined,
  ): NodeInfo {
    const infos = args.map((arg) => argInfo(arg, undefined));
    if (diagnostic !== undefined) {
      checker = report(diagnostic.code, diagnostic.message, node);
    }
    return finish(node, table.error, combine(infos));
  }

  /** The callee could not be resolved. The arguments still get checked. */
  function unresolvedCall(node: NodeId, args: readonly Arg[]): NodeInfo {
    errorCount = errorCount + 1;
    return rejectCall(node, args, undefined);
  }

  function apply(
    node: NodeId,
    callee: NodeInfo,
    args: readonly Arg[],
  ): NodeInfo {
    const fn = functionOf(callee.type);
    if (fn === undefined) {
      const infos = args.map((arg) => argInfo(arg, undefined));
      if (!isError(callee.type)) {
        checker = report(
          "type-mismatch/008",
          `a value of type ${show(callee.type)} is not a function`,
          node,
        );
      }
      checker = recordFact(node, { kind: "call" });
      return finish(
        node,
        table.error,
        combine([callee, ...infos]),
      );
    }
    checker = recordFact(node, { kind: "call" });
    return applyFunction(node, fn, callee, args, PURE_EFFECTS);
  }

  function markCheckedSlots(node: NodeId): BodyChecker {
    checkedSlots = checkedSlots.add(node);
    const kind = kindOf(tree, node);
    const kids = children(node);
    if (kind === SyntaxKind.RecordExpr) {
      for (const field of kids) {
        const parts = recordFieldParts(tree, field);
        if (parts !== undefined) {
          checker = markCheckedSlots(parts.value ?? field);
        }
      }
    } else if (kind === SyntaxKind.ParenExpr || kind === SyntaxKind.ListExpr) {
      for (const child of kids) checker = markCheckedSlots(child);
    } else if (kind === SyntaxKind.Block) {
      const last = kids.at(-1);
      if (
        last !== undefined && kindOf(tree, last) !== SyntaxKind.ConstDecl
      ) checker = markCheckedSlots(last);
    } else if (kind === SyntaxKind.IfExpr) {
      for (const branch of kids.slice(1)) checker = markCheckedSlots(branch);
    } else if (kind === SyntaxKind.MatchExpr) {
      for (
        const arm of kids.filter((child) =>
          kindOf(tree, child) === SyntaxKind.MatchArm
        )
      ) {
        const body = children(arm).at(-1);
        if (body !== undefined) checker = markCheckedSlots(body);
      }
    }
    return checker;
  }

  function checkedTypeFits(source: TypeRef, target: TypeRef): boolean {
    return checkedTypeFitsAt(source, target, 0);
  }

  function checkedTypeFitsAt(
    source: TypeRef,
    target: TypeRef,
    depth: number,
  ): boolean {
    if (depth > MAX_DEPTH) return false;
    if (assignable(source, target)) return true;
    const s = table.node(table.unfoldTransparent(source));
    const t = table.node(table.unfoldTransparent(target));
    if (s.kind === "primitive" && s.name === "unknown") return true;
    if (s.kind === "union") {
      return s.members.every((member) =>
        checkedTypeFitsAt(member, target, depth + 1)
      );
    }
    if (t.kind === "union") {
      return t.members.some((member) =>
        checkedTypeFitsAt(source, member, depth + 1)
      );
    }
    if (t.kind === "named" && isTypeId(t.id) && s.kind !== "named") {
      const id = t.id;
      const base = table.identityBaseOf(id);
      const predicate = table.predicateOf(id);
      if (
        !table.ownsSealed(module, id) ||
        (predicate !== undefined &&
          !containsUnknownPredicateInput(table, source, predicate)) ||
        table.taggedRecordOf(id) !== undefined
      ) return false;
      return base !== undefined &&
        checkedTypeFitsAt(source, base, depth + 1);
    }
    if (s.kind === "named" && isTypeId(s.id) && t.kind !== "named") {
      const id = s.id;
      if (!table.ownsSealed(module, id)) return false;
      const base = table.nominalBodyOf(id);
      return base !== undefined &&
        checkedTypeFitsAt(base, target, depth + 1);
    }
    if (s.kind === "record" && t.kind === "record") {
      return s.fields.length === t.fields.length && t.fields.every((field) => {
        const found = s.fields.find((item) => item.name === field.name);
        return found !== undefined && found.optional === field.optional &&
          checkedTypeFitsAt(found.type, field.type, depth + 1);
      });
    }
    if (
      (s.kind === "array" && t.kind === "array") ||
      (s.kind === "option" && t.kind === "option")
    ) return checkedTypeFitsAt(s.element, t.element, depth + 1);
    if (s.kind === "tuple" && t.kind === "tuple") {
      return s.elements.length === t.elements.length &&
        s.elements.every((element, i) =>
          checkedTypeFitsAt(element, t.elements[i], depth + 1)
        );
    }
    return false;
  }

  function applyFunction(
    node: NodeId,
    fn: FunctionNode,
    base: EffectSet,
    args: readonly Arg[],
    extra: EffectSet,
  ): NodeInfo {
    if (args.length !== fn.parameters.length) {
      checker = report(
        "type-mismatch/004",
        arityMessage(
          "the function",
          "argument",
          fn.parameters.length,
          args.length,
        ),
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const expected = fn.parameters[i];
      const before = checkedSlots;
      const checked = fn.checked;
      const isChecked = checked !== undefined && (checked[i] ?? false);
      if (isChecked) {
        checkedSlots = setFrom(before);
        checker = markCheckedSlots(arg.node);
      }
      const info = argInfo(arg, expected);
      if (
        expected !== undefined &&
        !(isChecked && checkedTypeFits(info.type, expected))
      ) {
        checker = checkFit(
          arg.node,
          info.type,
          expected,
          `argument ${i + 1}`,
        );
      }
      checkedSlots = before;
      return info;
    });
    return finish(
      node,
      fn.result,
      combine([base, ...infos, invocationOf(fn), extra]),
    );
  }

  function perform(
    node: NodeId,
    capability: CapabilityId,
    args: readonly Arg[],
  ): NodeInfo {
    checker = recordFact(node, { kind: "perform", capability: capability });
    const fn = functionOf(benv.methodType(capability));
    if (fn === undefined) return unresolvedCall(node, args);
    return applyFunction(node, fn, PURE_EFFECTS, args, {
      failures: [],
      requirements: [capability],
      mode: "effect",
    });
  }

  /** True for `{ a: x, b }` without a spread. */
  function isPlainRecordLiteral(node: NodeId): boolean {
    const inner = unparen(tree, node);
    if (kindOf(tree, inner) !== SyntaxKind.RecordExpr) return false;
    return children(inner).every((field) =>
      kindOf(tree, field) !== SyntaxKind.SpreadField
    );
  }

  function errorConstruction(
    node: NodeId,
    id: ErrorId,
    args: readonly Arg[],
  ): NodeInfo {
    if (isReservedErrorId(id)) {
      return rejectCall(node, args, {
        code: "type-mismatch/010",
        message: `${shortName(id)} cannot be constructed directly`,
      });
    }
    checker = recordFact(node, { kind: "error-construction", error: id });
    const record = table.errorRecordOf(id);
    if (args.length !== 1) {
      checker = report(
        "type-mismatch/004",
        `the error \`${
          shortName(id)
        }\` takes one record argument, but ${args.length} are given`,
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const info = argInfo(arg, i === 0 ? record : undefined);
      if (i === 0) {
        const fitted = fits(
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
          fitted && !isError(info.type) &&
          (piped || !isPlainRecordLiteral(arg.node))
        ) {
          checker = report(
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
    return finish(node, table.named(id), combine(infos));
  }

  function identityConstruction(
    node: NodeId,
    id: TypeId,
    args: readonly Arg[],
  ): NodeInfo {
    if (table.isOpaque(id)) {
      return rejectCall(node, args, {
        code: "type-mismatch/010",
        message: "an opaque type cannot be constructed in source",
      });
    }
    const base = table.identityBaseOf(id);
    if (base === undefined) {
      // A body that did not parse has the error type, so its uses report nothing more.
      return rejectCall(
        node,
        args,
        hasErrorRecord(table.named(id)) ? undefined : {
          code: "type-mismatch/010",
          message: `\`${
            shortName(id)
          }\` has no identity; only a type with identity is a constructor`,
        },
      );
    }
    checker = requireSealedOwner(node, id);
    checker = recordFact(node, { kind: "identity-construction", identity: id });
    return constructFrom(node, id, base, "type with identity", args);
  }

  /** Reports `sealed/001` when another module constructs a sealed type. */
  function requireSealedOwner(node: NodeId, id: TypeId): BodyChecker {
    if (!table.ownsSealed(module, id)) {
      checker = report(
        "sealed/001",
        `only the declaring module can construct the sealed type \`${
          shortName(id)
        }\``,
        node,
      );
    }
    return checker;
  }

  /** The single argument of a constructor must fit the base type. */
  function constructFrom(
    node: NodeId,
    id: TypeId,
    base: TypeRef,
    noun: "tagged record" | "type with identity",
    args: readonly Arg[],
  ): NodeInfo {
    if (args.length !== 1) {
      checker = report(
        "type-mismatch/004",
        `the ${noun} \`${
          shortName(id)
        }\` takes one argument, but ${args.length} are given`,
        node,
      );
    }
    const infos = args.map((arg, i) => {
      const info = argInfo(arg, i === 0 ? base : undefined);
      if (i === 0) {
        checker = checkFit(
          arg.node,
          info.type,
          base,
          `the value of ${shortName(id)}`,
        );
        if (
          table.predicateOf(id) !== undefined &&
          table.unfoldTransparent(info.type) !== table.named(id)
        ) {
          checker = preserveRefinementState(
            arg.node,
            id,
            `the value of ${shortName(id)}`,
          );
        }
      }
      return info;
    });
    return finish(node, table.named(id), combine(infos));
  }

  function builtinCall(
    node: NodeId,
    name: PreludeName,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (isOptionConstructorName(name)) {
      if (optionRole(name) === "some") {
        return someCall(node, name, args, expected);
      }
      return rejectCall(node, args, {
        code: "type-mismatch/008",
        message: `\`${name}\` is a value, not a function`,
      });
    }
    return preludeCall(node, name, args, expected);
  }

  /** Runs the handler of a prelude name. The table has one row for each name that is not an option constructor. */
  function preludeCall<K extends PreludeCallName>(
    node: NodeId,
    name: K,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    const row: BuiltinRow<K, BodyChecker> = familyRows[name];
    if (row.prologue !== "own-arity") {
      const bailed = runPrologue(node, name, args, row.prologue);
      if (bailed !== undefined) return bailed;
    }
    return row.handle(checker, node, name, args, expected);
  }

  /** Runs a prologue. Returns the result of a wrong argument count, or undefined. */
  function runPrologue<K extends PreludeCallName>(
    node: NodeId,
    name: K,
    args: readonly Arg[],
    prologue: Prologue<K, BodyChecker>,
  ): NodeInfo | undefined {
    const fact = prologue.fact;
    const bailFact = prologue.bailFact;
    if (fact !== undefined) {
      let nodeFact: NodeFact;
      if (typeof fact === "function") {
        nodeFact = fact(checker, name, args);
      } else if (fact === "key") {
        nodeFact = keyFact(name);
      } else {
        nodeFact = fact;
      }
      checker = recordFact(node, nodeFact);
    }
    const count = typeof prologue.arity === "number"
      ? prologue.arity
      : prologue.arity(name, args);
    if (!arity(node, name, count, args, prologue.usage)) {
      if (bailFact !== undefined) checker = recordFact(node, bailFact);
      const infos = args.map((arg) => argInfo(arg, undefined));
      return finish(
        node,
        table.error,
        combine(prologue.bail === "effect" ? [...infos, EFFECT_ONLY] : infos),
      );
    }
    if (prologue.pipeline === "direct") checker = noPipeline(name, args);
    return undefined;
  }

  /** Reports a wrong argument count for a prelude call. Returns true when the count is right. */
  function arity(
    node: NodeId,
    name: string,
    expectedCount: number,
    args: readonly Arg[],
    usage: string | undefined,
  ): boolean {
    if (args.length === expectedCount) return true;
    checker = report(
      "type-mismatch/004",
      usage ??
        arityMessage(`\`${name}\``, "argument", expectedCount, args.length),
      node,
    );
    return false;
  }

  function someCall(
    node: NodeId,
    name: PreludeName,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    checker = recordFact(node, { kind: "some" });
    const rightCount = arity(node, name, 1, args, undefined);
    const hint = table.optionElementOf(expected);
    let element = hint;
    if (checkedSlots.has(node)) {
      for (const arg of args) checker = markCheckedSlots(arg.node);
    }
    const infos = args.map((a, i) => {
      const info = argInfo(a, i === 0 ? hint : undefined);
      if (i === 0 && hint !== undefined) {
        if (
          checkedSlots.has(node) && !assignable(info.type, hint) &&
          checkedTypeFits(info.type, hint)
        ) element = info.type;
        else {
          checker = checkFit(a.node, info.type, hint, "the value of Some");
        }
      }
      return info;
    });
    const type = rightCount
      ? table.option(element ?? infos[0].type)
      : table.error;
    return finish(node, type, combine(infos));
  }

  function literalRecord(
    arg: Arg,
    count: number,
  ): Result<ReadonlyMap<string, LiteralField>, "shape"> {
    const shape = { ok: false, error: "shape" } as const;
    if (
      arg.pre !== undefined ||
      kindOf(tree, arg.node) !== SyntaxKind.RecordExpr
    ) return shape;
    const fields = children(arg.node);
    if (fields.length !== count) return shape;
    let values = emptyMap<string, LiteralField>();
    for (const field of fields) {
      if (kindOf(tree, field) !== SyntaxKind.RecordField) return shape;
      const parts = children(field);
      const label = parts.find((part) =>
        kindOf(tree, part) === SyntaxKind.Name
      );
      const valueNode = parts.find((part) => part !== label);
      if (
        label === undefined || valueNode === undefined ||
        kindOf(tree, valueNode) !== SyntaxKind.LiteralExpr
      ) return shape;
      const name = nameTextOf(tree, label);
      if (name === undefined || values.has(name)) return shape;
      values = values.set(name, {
        node: valueNode,
        value: literalOf(tree, valueNode),
      });
    }
    return { ok: true, value: values };
  }

  /** The zero-argument function type of a `retry` or `provide` job, or undefined after a diagnostic. */
  function jobFunction(
    name: string,
    arg: Arg,
    info: NodeInfo,
  ): FunctionNode | undefined {
    const fn = functionOf(info.type);
    if (fn === undefined) {
      if (!isError(info.type)) {
        checker = report(
          "type-mismatch/010",
          `\`${name}\` needs a function that takes no arguments, but the job has type ${
            show(info.type)
          }`,
          arg.node,
        );
      }
      return undefined;
    }
    if (fn.parameters.length > 0) {
      checker = report(
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
   * ancestors and tells whether an arrow function encloses it. The name in a
   * shorthand field such as `{ id }` also counts as a use.
   */
  function localUses(body: NodeId, id: LocalId): LocalUse[] {
    let uses: LocalUse[] = [];
    function visit(
      node: NodeId,
      parent: NodeId | undefined,
      grandparent: NodeId | undefined,
      nested: boolean,
    ): LocalUse[] {
      const kind = kindOf(tree, node);
      const target = targets.get(node);
      if (
        (kind === SyntaxKind.NameExpr ||
          (kind === SyntaxKind.Name && parent !== undefined &&
            kindOf(tree, parent) === SyntaxKind.ShorthandField)) &&
        target?.kind === "local" && target.id === id
      ) {
        uses[uses.length] = {
          node: node,
          parent: parent,
          grandparent: grandparent,
          nested: nested,
        };
      }
      for (const child of children(node)) {
        uses = visit(
          child,
          node,
          parent,
          nested ||
            Array.of<SyntaxKind>(
              SyntaxKind.ArrowExpr,
              SyntaxKind.ResourceAcquire,
              SyntaxKind.ResourceUse,
              SyntaxKind.ResourceRelease,
            ).includes(kind),
        );
      }
      return uses;
    }
    return visit(body, undefined, undefined, false);
  }

  function noPipeline(name: string, args: readonly Arg[]): BodyChecker {
    if (args[0]?.pre !== undefined) {
      checker = report(
        "type-mismatch/010",
        `\`${name}\` requires direct call syntax`,
        args[0].node,
      );
    }
    return checker;
  }

  function inlineStreamCallback(name: string, arg: Arg): BodyChecker {
    if (
      arg.pre !== undefined ||
      kindOf(tree, arg.node) !== SyntaxKind.ArrowExpr
    ) {
      checker = report(
        "type-mismatch/010",
        `\`${name}\` requires an inline arrow callback`,
        arg.node,
      );
    }
    return checker;
  }

  /**
   * Checks a collection callback. An inline arrow receives its parameter
   * types from the context. Only traverse permits invocation effects.
   */
  function callback(
    name: string,
    arg: Arg,
    parameters: readonly TypeRef[],
    resultHint: TypeRef | undefined,
    allowEffects: boolean,
  ): { readonly info: NodeInfo; readonly result: TypeRef } {
    const kind = kindOf(tree, arg.node);
    let info: NodeInfo;
    const implicit = RESOURCE_PARTS.includes(kind);
    if (arg.pre === undefined && implicit) {
      info = implicitArrow(arg.node, parameters, resultHint);
    } else if (arg.pre === undefined && kind === SyntaxKind.ArrowExpr) {
      info = arrow(arg.node, { parameters: parameters, result: resultHint });
    } else {
      info = argInfo(arg, undefined);
    }
    if (isError(info.type)) return { info: info, result: table.error };
    const fn = functionOf(info.type);
    if (fn === undefined) {
      checker = report(
        "type-mismatch/010",
        `the callback of \`${name}\` must be a function, but the value has type ${
          show(info.type)
        }`,
        arg.node,
      );
      return { info: info, result: table.error };
    }
    if (fn.parameters.length !== parameters.length) {
      checker = report(
        "type-mismatch/004",
        `the callback of \`${name}\` takes ${parameters.length} parameter${
          parameters.length === 1 ? "" : "s"
        }, but the function takes ${fn.parameters.length}`,
        arg.node,
      );
    } else {
      for (const parameter of parameters.entries()) {
        const i = parameter[0];
        const expected = parameter[1];
        if (!assignable(expected, fn.parameters[i])) {
          checker = report(
            "type-mismatch/003",
            `parameter ${i + 1} of the callback has type ${
              show(fn.parameters[i])
            }, but the collection supplies ${show(expected)}`,
            arg.node,
          );
        }
      }
    }
    if (!allowEffects && isEffectfulFunction(fn)) {
      checker = report(
        "execution-mode/001",
        `the callback of \`${name}\` must be pure with empty failure and requirement sets`,
        arg.node,
      );
    }
    return { info: info, result: fn.result };
  }

  function pipe(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const pipe = pipeParts(tree, node);
    const left = pipe.left;
    const stage = pipe.stage;
    if (left === undefined) return errorInfo(node);
    const leftInfo = expr(left, undefined);
    if (stage === undefined) return errorInfo(node);
    const stagePart = stageParts(tree, stage);
    const qualified = stagePart.callee;
    const stageArgs = stagePart.args;
    if (qualified === undefined) {
      const stageError = errorInfo(stage);
      return finish(node, stageError.type, leftInfo);
    }
    // The lowering evaluates a left value with effects in its own binding, so
    // the handler sees it as pure and the stage keeps its own sets.
    const quiet = isQuiet(leftInfo);
    const pre: NodeInfo = quiet
      ? leftInfo
      : { ...PURE_EFFECTS, type: leftInfo.type };
    const args: Arg[] = [
      { node: left, pre: pre },
      ...stageArgs.map((n) => ({ node: n })),
    ];
    if (checkedSlots.has(node)) checkedSlots = checkedSlots.add(stage);
    const target = targets.get(qualified);
    const q = target === undefined
      ? unresolvedCall(stage, args)
      : invoke(stage, qualified, target, args, expected);
    if (quiet) return finish(node, q.type, q);
    bodyBuilder = bodyBuilder.recordStageSet(stage, {
      failures: q.failures,
      requirements: q.requirements,
      mode: q.mode,
    });
    const combined = combine([leftInfo, q]);
    checker = recordInfo(stage, q.type, combined);
    return finish(node, q.type, combined);
  }

  function fieldExpr(node: NodeId): NodeInfo {
    const access = memberAccessParts(tree, node);
    const base = access.base;
    const member = access.member;
    const target = targets.get(node);
    if (target?.kind === "cap") {
      checker = report(
        "type-mismatch/008",
        `the service method \`${
          shortName(target.id)
        }\` can only be called or used as a pipeline stage`,
        node,
      );
      return errorInfo(node);
    }
    if (target?.kind === "unresolved") return errorInfo(node);
    if (base === undefined) return errorInfo(node);
    const baseInfo = expr(base, undefined);
    const name = member === undefined ? undefined : nameTextOf(tree, member);
    if (member === undefined || name === undefined) {
      return finish(node, table.error, baseInfo);
    }
    const read = readField(baseInfo.type, name, member);
    checker = recordFact(node, {
      kind: "field",
      name: name,
      optional: read.optional,
    });
    return finish(node, read.type, baseInfo);
  }

  /** True for a type or an error whose body did not parse. */
  function hasErrorRecord(ref: TypeRef): boolean {
    const node = table.node(table.unfold(ref));
    if (node.kind === "error") return true;
    if (node.kind !== "named") return false;
    const record = table.recordBodyOf(node.id);
    return record !== undefined && isError(record);
  }

  /** The record fields of a type that is a record, a named error, or a tagged record. */
  function recordFields(ref: TypeRef): readonly RecordField[] | undefined {
    const unfolded = table.unfold(ref);
    const node = table.node(unfolded);
    if (node.kind === "record") return node.fields;
    if (node.kind === "named") {
      // A named error or a tagged record has the fields of its record body.
      const body = table.recordBodyOf(node.id);
      if (body !== undefined) return recordFields(body);
    }
    return undefined;
  }

  function readField(
    ref: TypeRef,
    name: string,
    nameNode: NodeId,
  ): { readonly type: TypeRef; readonly optional: boolean } {
    const failed = { type: table.error, optional: false };
    if (isError(ref)) return failed;
    const members = flattenMembers(table, ref);
    const types: TypeRef[] = [];
    let optional = false;
    for (const member of members) {
      const fields = recordFields(member);
      const field = fields?.find((f) => f.name === name);
      if (field === undefined) {
        if (hasErrorRecord(member)) return failed;
        checker = report(
          "type-mismatch/006",
          fields === undefined
            ? `a value of type ${show(ref)} has no fields`
            : `the type ${show(member)} has no field \`${name}\``,
          nameNode,
        );
        return failed;
      }
      if (field.optional) optional = true;
      types[types.length] = field.type;
    }
    const type = table.union(types);
    return { type: optional ? table.option(type) : type, optional: optional };
  }

  function recordExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const fields = children(node);
    const first = fields[0];
    if (
      first !== undefined && kindOf(tree, first) === SyntaxKind.SpreadField
    ) {
      return recordUpdate(node, first, fields.slice(1));
    }
    checker = requireSealedLiteralOwner(node, expected);
    return recordConstruction(node, fields, expected);
  }

  /** A literal at a foreign sealed type is a construction, so `sealed/001` applies. */
  function requireSealedLiteralOwner(
    node: NodeId,
    expected: TypeRef | undefined,
  ): BodyChecker {
    const sealed = expected === undefined
      ? undefined
      : table.sealedRootOf(expected);
    if (sealed !== undefined) checker = requireSealedOwner(node, sealed);
    return checker;
  }

  function listExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    checker = requireSealedLiteralOwner(node, expected);
    const target = expected === undefined
      ? undefined
      : table.node(table.unfold(expected));
    const elements = children(node);
    function spread(element: NodeId): boolean {
      return kindOf(tree, element) === SyntaxKind.SpreadElement;
    }
    function spreadValue(element: NodeId): NodeId {
      return spread(element) ? children(element)[0] : element;
    }
    if (expected !== undefined && target?.kind === "tuple") {
      checker = recordFact(node, { kind: "list", shape: "tuple" });
      const firstSpread = elements.find(spread);
      if (firstSpread !== undefined) {
        checker = report(
          "type-mismatch/012",
          `a spread gives an array, but the tuple ${
            showType(table, table.unfold(expected))
          } is expected`,
          firstSpread,
        );
        const infos = elements.map((element) =>
          expr(spreadValue(element), undefined)
        );
        return finish(node, expected, combine(infos));
      }
      if (elements.length !== target.elements.length) {
        checker = report(
          "type-mismatch/012",
          `the tuple needs ${target.elements.length} elements, but ${elements.length} are given`,
          node,
        );
      }
      const infos = elements.map((element, i) => {
        const hint = target.elements[i];
        const info = expr(element, hint);
        checker = checkFit(
          element,
          info.type,
          hint,
          `tuple element ${i + 1}`,
        );
        return info;
      });
      if (refinementBase(expected) !== undefined) {
        checker = requireRefinementState(node, expected, "the list");
      }
      return finish(node, expected, combine(infos));
    }

    checker = recordFact(node, { kind: "list", shape: "array" });
    const hint = target?.kind === "array" ? target.element : undefined;
    // The element type of each child. A spread gives the element type of its array.
    const infos = elements.map((element, i) => {
      if (!spread(element)) {
        const info = expr(element, hint);
        if (hint !== undefined) {
          checker = checkFit(
            element,
            info.type,
            hint,
            `array element ${i + 1}`,
          );
        }
        return { info: info, element: info.type, spread: false };
      }
      const value = spreadValue(element);
      const info = expr(value, hint === undefined ? undefined : expected);
      const unfolded = table.unfold(info.type);
      const array = table.node(unfolded);
      if (isError(info.type)) {
        return { info: info, element: table.error, spread: true };
      }
      if (array.kind !== "array" || !assignable(info.type, unfolded)) {
        checker = report(
          "type-mismatch/003",
          `the spread has type ${
            showType(table, info.type)
          }, but an array is expected`,
          value,
        );
        return { info: info, element: table.error, spread: true };
      }
      if (hint !== undefined) {
        checker = checkFit(
          value,
          info.type,
          table.array(hint),
          `spread element ${i + 1}`,
        );
      }
      return { info: info, element: array.element, spread: true };
    });
    const combined = combine(infos.map((item) => item.info));
    function record(element: TypeRef): BodyChecker {
      if (!elements.some(spread)) return checker;
      const array = table.array(element);
      checker = recordFact(node, {
        kind: "list",
        shape: "array",
        concat: functionTypeToIr(
          table,
          table.function({
            execution: "pure",
            parameters: elements.map(() => array),
            result: array,
            failures: [],
            requirements: [],
          }),
        ),
      });
      return checker;
    }
    if (hint !== undefined && expected !== undefined) {
      checker = record(hint);
      if (elements.some(spread)) {
        // The instance `concat` gives the unfolded array type. It has no
        // proven length, so the caller rejects a refined expected type.
        return finish(node, table.array(hint), combined);
      }
      if (refinementBase(expected) !== undefined) {
        checker = requireRefinementState(node, expected, "the list");
      }
      return finish(node, expected, combined);
    }
    if (infos.length === 0) {
      checker = report(
        "type-mismatch/012",
        "an empty list needs an expected array or tuple type",
        node,
      );
      return finish(node, table.array(table.error), PURE_EFFECTS);
    }
    let element = widen(infos[0].element);
    for (const entry of infos.slice(1).entries()) {
      const i = entry[0] + 1;
      const next = widen(entry[1].element);
      if (isError(element) || isError(next)) {
        element = table.error;
      } else if (assignable(next, element)) {
        continue;
      } else if (assignable(element, next)) {
        element = next;
      } else {
        const shown = showTypes(table, [next, element]);
        const nextText = shown[0];
        const elementText = shown[1];
        checker = report(
          "type-mismatch/012",
          infos[i].spread
            ? `spread element ${
              i + 1
            } has element type ${nextText}, which has no common array element type with ${elementText}`
            : `list element ${
              i + 1
            } has type ${nextText}, which has no common array element type with ${elementText}`,
          elements[i],
        );
        element = table.error;
      }
    }
    checker = record(element);
    return finish(node, table.array(element), combined);
  }

  /** The value of a field: an expression, or the variable of a shorthand field. */
  function fieldValue(
    field: NodeId,
    parts: { readonly labelNode: NodeId; readonly value: NodeId | undefined },
    expected: TypeRef | undefined,
  ): NodeInfo {
    if (parts.value !== undefined) return expr(parts.value, expected);
    const info = referenceInfo(
      parts.labelNode,
      targets.get(parts.labelNode),
      expected,
    );
    return finish(field, info.type, info);
  }

  /**
   * Picks the record type that a construction targets. `construct` means the
   * expected type is exactly a tagged record, so the literal is an implicit
   * construction. `variants` means a record literal at a union picks a tagged
   * record: the author must write the constructor, and the result has no record.
   */
  function recordTarget(
    expected: TypeRef | undefined,
    scan: RecordScan,
  ): RecordTarget | undefined {
    const labels = scan.labels;
    const literals = scan.literals;
    const known = scan.known;
    if (expected === undefined) return undefined;
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
      [...literals].every((entry) => {
        const label = entry[0];
        const value = entry[1];
        const field = c.fields.find((f) => f.name === label);
        return field !== undefined &&
          assignable(table.literal(value), field.type);
      })
    );
    const narrowed = (discriminated.length > 0 ? discriminated : fitting)
      .filter(
        (c) =>
          [...known].every((entry) => {
            const label = entry[0];
            const type = entry[1];
            const field = c.fields.find((f) => f.name === label);
            return field !== undefined &&
              assignable(type, field.type);
          }),
      );
    const pool = [narrowed, discriminated, fitting, candidates].find((list) =>
      list.length > 0
    );
    // A member with no refinement needs no proof, so it wins over a refined one.
    const chosen =
      pool?.find((candidate) => refinementBase(candidate.ref) === undefined) ??
        (pool === undefined ? undefined : pool[0]);
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
  function knownNameType(node: NodeId): TypeRef | undefined {
    const target = targets.get(node);
    if (target === undefined) return undefined;
    let type: TypeRef | undefined;
    if (target.kind === "local") {
      if (!pendingLocals.has(target.id)) {
        type = bodyTable.locals.get(target.id);
      }
    } else if (target.kind === "value" || target.kind === "provider") {
      type = benv.values(target.id);
    }
    return type === undefined || type === table.error ? undefined : type;
  }

  /** The labels, literal values, and known name types that pick a record target. */
  function prescanRecordFields(
    partsList: readonly (ReturnType<typeof recordFieldParts>)[],
  ): RecordScan {
    const labels = partsList.flatMap((p) => p === undefined ? [] : [p.label]);
    let literals = emptyMap<string, LiteralValue>();
    let known = emptyMap<string, TypeRef>();
    for (const parts of partsList) {
      if (parts === undefined) continue;
      if (parts.value === undefined) {
        const type = knownNameType(parts.labelNode);
        if (type !== undefined) known = known.set(parts.label, type);
        continue;
      }
      const valueNode = unparen(tree, parts.value);
      if (kindOf(tree, valueNode) === SyntaxKind.NameExpr) {
        const type = knownNameType(valueNode);
        if (type !== undefined) known = known.set(parts.label, type);
        continue;
      }
      if (kindOf(tree, valueNode) !== SyntaxKind.LiteralExpr) continue;
      const value = literalOf(tree, valueNode);
      if (value !== undefined) {
        literals = literals.set(parts.label, value);
      }
    }
    return { labels: labels, literals: literals, known: known };
  }

  /**
   * The start of a field of a record literal or a record update. A field
   * without parts gets the diagnostic of a misplaced spread and no result.
   * A repeated label gets its diagnostic.
   */
  function fieldStart(
    fieldNode: NodeId,
    parts: RecordFieldParts | undefined,
    seen: ReadonlySet<string>,
  ):
    | { readonly parts: RecordFieldParts; readonly duplicate: boolean }
    | undefined {
    if (parts === undefined) {
      if (kindOf(tree, fieldNode) === SyntaxKind.SpreadField) {
        checker = report(
          "type-mismatch/005",
          "a record spread must come first",
          fieldNode,
        );
      }
      return undefined;
    }
    const duplicate = seen.has(parts.label);
    if (duplicate) {
      checker = report(
        "type-mismatch/005",
        `the field \`${parts.label}\` appears twice`,
        parts.labelNode,
      );
    }
    return { parts: parts, duplicate: duplicate };
  }

  function recordConstruction(
    node: NodeId,
    fields: readonly NodeId[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    const parsed = fields.map((f) => ({
      node: f,
      parts: recordFieldParts(tree, f),
    }));
    const scan = prescanRecordFields(parsed.map((p) => p.parts));
    const picked = recordTarget(expected, scan);
    // A record literal does not pick a tagged variant, so it has no target.
    let target: Exclude<RecordTarget, { kind: "variants" }> | undefined;
    if (picked?.kind === "record" || picked?.kind === "construct") {
      target = picked;
    } else if (picked?.kind === "variants") {
      checker = report(
        "type-mismatch/003",
        `a record literal does not pick a variant; write ${
          picked.ids.map((variant) => `\`${shortName(variant)}({ ... })\``)
            .sort().join(" or ")
        }`,
        node,
      );
    }
    let seen = emptySet<string>();
    const infos: NodeInfo[] = [];
    const inferred: RecordField[] = [];
    let raw = false;
    for (const parsedField of parsed) {
      const fieldNode = parsedField.node;
      const start = fieldStart(fieldNode, parsedField.parts, seen);
      if (start === undefined) continue;
      const parts = start.parts;
      const duplicate = start.duplicate;
      const declared = target?.fields.find((f) => f.name === parts.label);
      seen = seen.add(parts.label);
      if (target !== undefined && declared === undefined && !duplicate) {
        checker = report(
          "type-mismatch/005",
          `the record type ${show(target.ref)} has no field \`${parts.label}\``,
          parts.labelNode,
        );
      }
      const info = fieldValue(fieldNode, parts, declared?.type);
      infos[infos.length] = info;
      if (declared !== undefined && !duplicate) {
        if (
          target?.kind === "record" && checkedSlots.has(node) &&
          !assignable(info.type, declared.type) &&
          checkedTypeFits(info.type, declared.type)
        ) raw = true;
        checker = checkFit(
          parts.value ?? fieldNode,
          info.type,
          declared.type,
          `the field \`${parts.label}\``,
        );
      }
      if (!duplicate) {
        inferred[inferred.length] = {
          name: parts.label,
          type: info.type,
          optional: false,
        };
      }
    }
    let type: TypeRef;
    if (target !== undefined) {
      const missing = target.fields.filter((f) =>
        !f.optional && !seen.has(f.name)
      ).map((f) => f.name);
      if (missing.length > 0) {
        checker = report(
          "type-mismatch/005",
          `the record is missing the field${missing.length === 1 ? "" : "s"} ${
            missing.map((m) => `\`${m}\``).join(", ")
          }`,
          node,
        );
      }
      if (raw) {
        const rawType = table.record(target.fields.map((field) => ({
          ...field,
          type: inferred.find((value) => value.name === field.name)?.type ??
            field.type,
        })));
        const refinement = refinementBase(target.ref);
        const predicate = refinement === undefined
          ? undefined
          : table.predicateOf(refinement.id);
        raw = predicate === undefined ||
          containsUnknownPredicateInput(table, rawType, predicate);
        type = raw ? rawType : target.ref;
      } else type = target.ref;
      if (target.kind === "construct") {
        checker = recordFact(node, {
          kind: "identity-construction",
          identity: target.id,
        });
        checker = preserveRefinementState(node, target.id, "the record");
      }
    } else {
      type = picked?.kind !== "variants" ? table.record(inferred) : table.error;
    }
    // A literal adopts one member of an expected union, so it needs that member's proof.
    const adopted = target?.kind === "record" ? target.ref : expected;
    if (
      adopted !== undefined && refinementBase(adopted) !== undefined &&
      target?.kind !== "construct"
    ) {
      const decision = refinements.prove(node, adopted);
      if (
        !raw || decision.status === "failed" && decision.reason === "disproved"
      ) {
        checker = recordRefinementState(
          node,
          decision,
          "the record",
          refinementBase(adopted)?.id,
        );
      }
    }
    return finish(node, type, combine(infos));
  }

  function recordUpdate(
    node: NodeId,
    spread: NodeId,
    rest: readonly NodeId[],
  ): NodeInfo {
    const baseNode = children(spread)[0];
    if (baseNode === undefined) return errorInfo(node);
    const base = expr(baseNode, undefined);
    checker = recordInfo(spread, base.type, base);
    const sealed = table.sealedRootOf(base.type);
    if (sealed !== undefined && !table.ownsSealed(module, sealed)) {
      checker = report(
        "sealed/002",
        `only the declaring module can update the sealed type \`${
          shortName(sealed)
        }\``,
        node,
      );
    }
    const baseFields = isError(base.type) ? undefined : recordFields(base.type);
    if (baseFields === undefined && !isError(base.type)) {
      checker = report(
        "type-mismatch/005",
        `a record update needs a record, but the base has type ${
          show(base.type)
        }`,
        baseNode,
      );
    }
    let seen = emptySet<string>();
    const infos: NodeInfo[] = [base];
    for (const fieldNode of rest) {
      const start = fieldStart(
        fieldNode,
        recordFieldParts(tree, fieldNode),
        seen,
      );
      if (start === undefined) continue;
      const parts = start.parts;
      const duplicate = start.duplicate;
      seen = seen.add(parts.label);
      const declared = baseFields?.find((f) => f.name === parts.label);
      if (baseFields !== undefined && declared === undefined && !duplicate) {
        checker = report(
          "type-mismatch/005",
          `the record has no field \`${parts.label}\` to replace`,
          parts.labelNode,
        );
      }
      const info = fieldValue(fieldNode, parts, declared?.type);
      infos[infos.length] = info;
      if (declared !== undefined && !duplicate) {
        checker = checkFit(
          parts.value ?? fieldNode,
          info.type,
          declared.type,
          `the field \`${parts.label}\``,
        );
      }
    }
    const result = finish(node, base.type, combine(infos));
    const identity = table.node(table.unfoldTransparent(base.type));
    if (
      identity.kind === "named" && isTypeId(identity.id) &&
      table.predicateOf(identity.id) !== undefined
    ) {
      checker = preserveRefinementState(
        node,
        identity.id,
        "the record update",
      );
    }
    return result;
  }

  function binary(node: NodeId): NodeInfo {
    const kids = children(node);
    const operator = operatorOf(tree, node);
    if (operator === undefined || kids.length < 2) return errorInfo(node);
    const left = expr(kids[0], undefined);
    const equality = operator === "===" || operator === "!==";
    const branch = refinements.snapshot();
    if (operator === "&&" || operator === "||") {
      const condition = refinements.condition(kids[0]);
      refinements = refinements.addBranch(
        operator === "||" && condition !== undefined
          ? not(condition)
          : condition,
      );
    }
    const right = expr(kids[1], equality ? left.type : undefined);
    refinements = refinements.restore(branch);
    return operatorInfo(
      node,
      operator,
      operator,
      left.type,
      right.type,
      combine([left, right]),
      () => {
        const shown = showTypes(table, [left.type, right.type]);
        const leftText = shown[0];
        const rightText = shown[1];
        return `operands of type ${leftText} and ${rightText}`;
      },
    );
  }

  /** `-e` has the type of `0 - e`, and `!e` has the type of `e === false`. */
  function unary(node: NodeId): NodeInfo {
    const operandNode = children(node)[0];
    const parts = unaryOperatorOf(tree, node);
    if (parts === undefined || operandNode === undefined) {
      return errorInfo(node);
    }
    const operand = expr(operandNode, undefined);
    const minus = parts.operator === "-";
    const fixed = primitiveOf(minus ? 0 : false);
    return operatorInfo(
      node,
      minus ? "-" : "===",
      parts.operator,
      minus ? fixed : operand.type,
      minus ? operand.type : fixed,
      combine([operand]),
      () => `an operand of type ${show(operand.type)}`,
    );
  }

  /**
   * Reports an operator mismatch and records the node. `display` is the
   * operator in the message, and `operands` describes the operand types.
   */
  function operatorInfo(
    node: NodeId,
    operator: BinaryOperator,
    display: string,
    left: TypeRef,
    right: TypeRef,
    eff: EffectSet,
    operands: () => string,
  ): NodeInfo {
    const result = operatorResult(
      table,
      module,
      operator,
      left,
      right,
    );
    if (result.sealed !== undefined) {
      checker = report(
        "sealed/003",
        `only the declaring module can use arithmetic on the sealed type \`${
          shortName(result.sealed)
        }\``,
        node,
      );
    } else if (result.mismatch) {
      checker = report(
        "type-mismatch/007",
        `the operator \`${display}\` does not accept ${operands()}`,
        node,
      );
    }
    const info = finish(node, result.type, eff);
    const identity = table.node(table.unfoldTransparent(result.type));
    if (
      isArithmeticOperator(operator) &&
      identity.kind === "named" &&
      isTypeId(identity.id) &&
      table.predicateOf(identity.id) !== undefined
    ) {
      checker = preserveRefinementState(
        node,
        identity.id,
        "the arithmetic result",
      );
    }
    return info;
  }

  /**
   * Checks an arrow expression. Creating a closure is pure with empty sets. The
   * function type carries the invocation mode and sets.
   */
  function arrow(node: NodeId, context: ArrowContext | undefined): NodeInfo {
    const refinementScope = refinements.snapshot();
    const header = functionParts(tree, node);
    const params = paramNodes(tree, header.paramList);
    const inferredParameters: {
      readonly id: LocalId | undefined;
      readonly name: string;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[] = [];
    for (const parameter of params.entries()) {
      const i = parameter[0];
      const param = parameter[1];
      const parameterParts = paramParts(tree, param);
      const nameNode = parameterParts.name;
      const typeNode = parameterParts.type;
      const name = nameNode === undefined
        ? ""
        : nameTextOf(tree, nameNode) ?? "";
      const target = nameNode === undefined ? undefined : targets.get(nameNode);
      let type: TypeRef;
      if (typeNode !== undefined) {
        type = lowerer.lower(typeNode).ref;
      } else if (context !== undefined && i < context.parameters.length) {
        type = context.parameters[i];
      } else {
        type = table.unknown;
      }
      const id = target?.kind === "local" ? target.id : undefined;
      if (id !== undefined) bodyBuilder = bodyBuilder.recordLocal(id, type);
      inferredParameters[inferredParameters.length] = {
        id: id,
        name: name,
        type: type,
        inferred: type === table.unknown,
      };
    }
    const resultNode = header.result;
    const failsNode = header.fails;
    const usesNode = header.uses;
    const bodyNode = arrowBody(tree, node);
    const contract: Contract = {
      result: resultNode === undefined
        ? undefined
        : lowerer.lower(resultNode).ref,
      failures: failsNode === undefined
        ? undefined
        : lowerer.failures(failsNode),
      requirements: usesNode === undefined
        ? undefined
        : lowerer.requirements(usesNode),
    };
    const inference = inferredParameters.some((parameter) => parameter.inferred)
      ? inferArrowInputs(
        benv,
        inferredParameters,
        bodyNode,
        contract.result ?? context?.result,
        bodyTable.locals,
      )
      : { types: [], diagnostics: [] };
    for (const diagnostic of inference.diagnostics) {
      sink[sink.length] = diagnostic;
    }
    const parameterFacts: ArrowParameterFact[] = inferredParameters.map(
      (parameter, index) => {
        const type = inference.types[index] ?? parameter.type;
        checker = bindLocal(parameter.id, type, undefined);
        return { id: parameter.id, name: parameter.name, type: type };
      },
    );
    const result = callbackBody(
      node,
      parameterFacts,
      bodyNode,
      contract,
      context?.result,
    );
    refinements = refinements.restore(refinementScope);
    return result;
  }

  function implicitArrow(
    node: NodeId,
    parameters: readonly TypeRef[],
    hint: TypeRef | undefined,
  ): NodeInfo {
    const refinementScope = refinements.snapshot();
    const parent = tree.parents[node];
    const nameNode = children(parent).find((k) =>
      kindOf(tree, k) === SyntaxKind.Name
    );
    const facts: ArrowParameterFact[] = [];
    if (parameters.length > 0 && nameNode !== undefined) {
      facts[facts.length] = outcomeParameter(nameNode, parameters[0]);
    }
    const outcomeNode = children(node).find((k) =>
      kindOf(tree, k) === SyntaxKind.Name
    );
    if (parameters.length > 1 && outcomeNode !== undefined) {
      facts[facts.length] = outcomeParameter(outcomeNode, parameters[1]);
    }
    const result = callbackBody(
      node,
      facts,
      children(node).at(-1),
      { result: undefined, failures: undefined, requirements: undefined },
      hint,
    );
    refinements = refinements.restore(refinementScope);
    return result;
  }

  function outcomeParameter(
    nameNode: NodeId,
    type: TypeRef,
  ): ArrowParameterFact {
    const target = targets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    checker = bindLocal(id, type, undefined);
    checker = recordInfo(nameNode, type, PURE_EFFECTS);
    return { id: id, name: nameTextOf(tree, nameNode) ?? "", type: type };
  }

  function callbackBody(
    node: NodeId,
    parameterFacts: readonly ArrowParameterFact[],
    bodyNode: NodeId | undefined,
    contract: Contract,
    hint: TypeRef | undefined,
  ): NodeInfo {
    const written = {
      result: contract.result !== undefined,
      fails: contract.failures !== undefined,
      uses: contract.requirements !== undefined,
    };
    const run = checkBody(bodyNode, contract, hint);
    const type = table.function({
      execution: run.mode,
      parameters: parameterFacts.map((p) => p.type),
      result: run.result,
      failures: run.failures,
      requirements: run.requirements,
    });
    checker = recordFact(node, {
      kind: "arrow",
      parameters: parameterFacts,
      written: written,
    });
    return finish(node, type, PURE_EFFECTS);
  }

  function block(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const refinementScope = refinements.snapshot();
    const items = children(node);
    const infos: NodeInfo[] = [];
    let type = table.unit;
    let adoptedResult = false;
    for (const entry of items.entries()) {
      const i = entry[0];
      const item = entry[1];
      const last = i === items.length - 1;
      if (kindOf(tree, item) === SyntaxKind.ConstDecl) {
        infos[infos.length] = blockConst(item);
        type = table.unit;
      } else {
        const info = expr(item, last ? expected : undefined);
        infos[infos.length] = info;
        type = info.type;
        if (last && expected !== undefined && refinementBase(expected)) {
          checker = checkFit(item, info.type, expected, "the block result");
          adoptedResult = true;
        }
      }
      if (
        infos.at(-1)?.mode === "effect" &&
        !Array.of<SyntaxKind>(SyntaxKind.IfExpr, SyntaxKind.MatchExpr).includes(
          kindOf(tree, item),
        )
      ) {
        refinements = refinements.clearDerivedFacts();
      }
    }
    const result = finish(
      node,
      adoptedResult && expected !== undefined ? expected : type,
      combine(infos),
    );
    refinements = refinements.leaveScope(refinementScope);
    return result;
  }

  function blockConst(node: NodeId): NodeInfo {
    const parts = children(node);
    const record = parts.find((k) =>
      kindOf(tree, k) === SyntaxKind.RecordBinding
    );
    if (record !== undefined) return recordBinding(node, record);
    const nameNode = parts.find((k) => kindOf(tree, k) === SyntaxKind.Name);
    const typeNode = parts.find((k) => isTypeKind(kindOf(tree, k)));
    const init = initOf(tree, node, nameNode);
    const target = nameNode === undefined ? undefined : targets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    const annotation = typeNode === undefined
      ? undefined
      : lowerer.lower(typeNode).ref;
    let info: NodeInfo | undefined;
    if (init !== undefined) {
      if (kindOf(tree, init) === SyntaxKind.ArrowExpr) {
        if (id !== undefined) pendingLocals = pendingLocals.add(id);
        info = arrow(init, contextOf(annotation));
        if (id !== undefined) {
          pendingLocals = setFrom(
            [...pendingLocals].filter((pending) => pending !== id),
          );
        }
      } else {
        info = expr(init, annotation);
      }
    }
    let type: TypeRef;
    if (annotation !== undefined) {
      if (info !== undefined && init !== undefined) {
        checker = checkFit(init, info.type, annotation, "the value");
      }
      type = annotation;
    } else {
      type = info === undefined ? table.error : widen(info.type);
    }
    checker = bindLocal(id, type, info?.mode === "pure" ? init : undefined);
    checker = recordFact(node, { kind: "binding", id: id, type: type });
    return finish(node, type, info ?? PURE_EFFECTS);
  }

  function recordBinding(node: NodeId, record: NodeId): NodeInfo {
    const parts = children(node);
    const typeNode = parts.find((k) => isTypeKind(kindOf(tree, k)));
    const init = parts.at(-1);
    if (init === undefined || init === record || init === typeNode) {
      return errorInfo(node);
    }
    const annotation = typeNode === undefined
      ? undefined
      : lowerer.lower(typeNode).ref;
    const subject = expr(init, annotation);
    checker = checkFit(init, subject.type, annotation, "the value");
    const type = annotation ?? widen(subject.type);
    const name = uniqueLocalName(`$record${node}`);
    const captured = {
      id: bodyLocalId(bodyTable.declaration, name),
      name: name,
      type: type,
    };
    refinements = refinements.addLocal(
      captured.id,
      captured.type,
      subject.mode === "pure" ? init : undefined,
    );
    let seen = emptySet<string>();
    const fields = [];
    for (const field of children(record)) {
      const names = children(field);
      const label = names[0], local = names.at(-1);
      if (label === undefined || local === undefined) continue;
      const name = nameTextOf(tree, label);
      const bindingName = nameTextOf(tree, local);
      if (name === undefined || bindingName === undefined) continue;
      if (seen.has(name)) {
        checker = report(
          "declaration/001",
          `duplicate record binding field \`${name}\``,
          label,
        );
      }
      seen = seen.add(name);
      const read = readField(type, name, label);
      const target = targets.get(local);
      const id = target?.kind === "local" ? target.id : undefined;
      if (id !== undefined) {
        bodyBuilder = bodyBuilder.recordLocal(id, read.type);
      }
      if (id !== undefined) {
        refinements = refinements.addFieldLocal(
          id,
          read.type,
          captured.id,
          name,
        );
      }
      checker = recordInfo(label, read.type, PURE_EFFECTS);
      checker = recordInfo(local, read.type, PURE_EFFECTS);
      fields[fields.length] = {
        name: name,
        binding: { id: id, name: bindingName, type: read.type },
        label: label,
        local: local,
      };
    }
    checker = recordFact(node, {
      kind: "record-binding",
      captured: captured,
      fields: fields,
    });
    return finish(node, table.unit, subject);
  }

  /**
   * The common type of branch results. With an expected type each branch must fit
   * it and the result is the expected type. Without one, literals widen and the
   * result is the branch type that the others fit. Nominal records and errors
   * that no branch type covers join to their union.
   */
  function joinResults(
    branches: readonly { readonly node: NodeId; readonly type: TypeRef }[],
    expected: TypeRef | undefined,
  ): TypeRef {
    if (expected !== undefined) {
      for (const branch of branches) {
        checker = checkFit(branch.node, branch.type, expected, "the branch");
      }
      return expected;
    }
    let joined: TypeRef | undefined;
    for (const branch of branches) {
      const type = widen(branch.type);
      if (joined === undefined) {
        joined = type;
      } else if (isError(joined) || isError(type)) {
        joined = table.error;
      } else if (assignable(type, joined)) {
        // The earlier type already covers this branch.
      } else if (assignable(joined, type)) {
        joined = type;
      } else if (isNominalJoin(joined, type)) {
        joined = table.union([joined, type]);
      } else {
        const shown = showTypes(table, [type, joined]);
        const typeText = shown[0];
        const joinedText = shown[1];
        checker = report(
          "type-mismatch/009",
          `this branch has type ${typeText}, which has no common type with ${joinedText} from the earlier branches`,
          branch.node,
        );
        joined = table.error;
      }
    }
    return joined ?? table.never;
  }

  /** True when every member of both types is a tagged record or an Effektive error, as in `domainOf`. */
  function isNominalJoin(a: TypeRef, b: TypeRef): boolean {
    return [a, b].every((type) =>
      flattenIdentityMembers(table, type).every((member) => {
        const node = table.node(member);
        return node.kind === "named" && table.isErrorOrTagged(node.id);
      })
    );
  }

  function ifExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = children(node);
    const condition = kids[0];
    if (condition === undefined) return errorInfo(node);
    const cond = expr(condition, undefined);
    if (
      !isError(cond.type) &&
      !isBoolean(table, module, cond.type)
    ) {
      checker = report(
        "type-mismatch/007",
        `a condition must be boolean, but it has type ${show(cond.type)}`,
        condition,
      );
    }
    if (cond.mode === "effect") refinements = refinements.clearDerivedFacts();
    let arms = createBranchArms([cond]);
    const conditionFact = refinements.condition(condition);
    for (const entry of kids.slice(1, 3).entries()) {
      const index = entry[0];
      const branch = entry[1];
      const refinementScope = refinements.snapshot();
      refinements = refinements.addBranch(
        index === 1 && conditionFact !== undefined
          ? not(conditionFact)
          : conditionFact,
      );
      arms = armBody(branch, expected, arms).arms;
      refinements = refinements.restore(refinementScope);
    }
    refinements = refinements.join(arms.successful());
    return joinArms(node, expected, arms);
  }

  /** Checks one branch body of an `if` or `match` and records it in `arms`. */
  function armBody(
    bodyNode: NodeId,
    expected: TypeRef | undefined,
    arms: BranchArms,
  ): { readonly info: NodeInfo; readonly arms: BranchArms } {
    const info = expr(bodyNode, expected);
    if (
      kindOf(tree, bodyNode) !== SyntaxKind.Block &&
      expected !== undefined && refinementBase(expected) !== undefined
    ) {
      checker = checkFit(bodyNode, info.type, expected, "the branch");
    }
    const branch = {
      node: bodyNode,
      type: info.type,
    };
    const snapshot = table.unfold(info.type) === table.never
      ? undefined
      : refinements.snapshot();
    arms = arms.add(info, branch, snapshot);
    return { info: info, arms: arms };
  }

  /** The type and effects of an `if` or `match` from its checked branches. */
  function joinArms(
    node: NodeId,
    expected: TypeRef | undefined,
    arms: BranchArms,
  ): NodeInfo {
    const type = expected !== undefined && refinementBase(expected)
      ? expected
      : joinResults(arms.branches(), expected);
    return finish(node, type, combine(arms.infos()));
  }

  function tryExpr(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = children(node);
    const bodyNode = kids.find((k) => kindOf(tree, k) === SyntaxKind.Block);
    const catchNode = kids.find((k) =>
      kindOf(tree, k) === SyntaxKind.CatchClause
    );
    const finallyNode = kids.find((k) =>
      kindOf(tree, k) === SyntaxKind.FinallyClause
    );
    if (bodyNode === undefined) return errorInfo(node);
    const errorsBefore = errorCount;
    const body = expr(bodyNode, expected);
    const bodyHadErrors = errorCount > errorsBefore;
    const handlers = catchNode === undefined
      ? []
      : syntaxKidsOfKind(tree, catchNode, SyntaxKind.Handler);
    const protectedSet = setFrom(body.failures);
    let handled = emptySet<ErrorId>();
    // Every error that a handler names, so a repeat is a duplicate even for an absent error.
    let named = emptySet<ErrorId>();
    const handlerInfos: NodeInfo[] = [];
    const branches = [{ node: bodyNode, type: body.type }];
    let defectSeen = false;
    for (const handler of handlers) {
      const parts = children(handler);
      const nameNodes = parts.filter((k) =>
        kindOf(tree, k) === SyntaxKind.Name
      );
      const errorNode = nameNodes[0];
      const bindingNode = nameNodes[1];
      const handlerBody = parts.filter((k) =>
        kindOf(tree, k) !== SyntaxKind.Name
      ).pop();
      const isDefect = errorNode !== undefined &&
        benv.env.defectArms.has(errorNode);
      const errorTarget = errorNode === undefined || isDefect
        ? undefined
        : targets.get(errorNode);
      const error = errorTarget?.kind === "error" ? errorTarget.id : undefined;
      const bindingTarget = bindingNode === undefined
        ? undefined
        : targets.get(bindingNode);
      const binding = bindingTarget?.kind === "local"
        ? bindingTarget.id
        : undefined;
      let recordedBinding = binding;
      if (isDefect) {
        if (defectSeen) {
          checker = report(
            "failure-contract/003",
            "the `Defect` arm already has a handler",
            errorNode,
          );
        }
        defectSeen = true;
      }
      if (error !== undefined && errorNode !== undefined) {
        const repeated = named.has(error);
        named = named.add(error);
        if (repeated) {
          checker = report(
            "failure-contract/003",
            `the error \`${shortName(error)}\` already has a handler`,
            errorNode,
          );
        } else if (protectedSet.has(error)) {
          handled = handled.add(error);
        } else if (!bodyHadErrors) {
          checker = report(
            "failure-contract/002",
            `the protected block cannot fail with \`${shortName(error)}\``,
            errorNode,
          );
        }
      }
      if (isDefect && bindingNode !== undefined) {
        recordedBinding = outcomeParameter(
          bindingNode,
          table.record([
            { name: "message", type: table.string, optional: false },
          ]),
        ).id;
      } else if (binding !== undefined) {
        bodyBuilder = bodyBuilder.recordLocal(
          binding,
          error === undefined ? table.error : table.named(error),
        );
      }
      checker = recordFact(
        handler,
        isDefect
          ? {
            kind: "handler",
            error: error,
            binding: recordedBinding,
            defect: true,
          }
          : { kind: "handler", error: error, binding: recordedBinding },
      );
      if (handlerBody === undefined) {
        handlerInfos[handlerInfos.length] = errorInfo(handler);
        continue;
      }
      const info = expr(handlerBody, expected);
      handlerInfos[handlerInfos.length] = finish(handler, info.type, info);
      branches[branches.length] = { node: handlerBody, type: info.type };
    }
    const remaining: EffectSet = {
      failures: without(body.failures, [...handled]),
      requirements: body.requirements,
      mode: body.mode,
    };
    const type = joinResults(branches, expected);
    const protectedPart = combine([remaining, ...handlerInfos, EFFECT_ONLY]);
    const finalizer = finallyNode === undefined
      ? []
      : [finallyClause(finallyNode, type, protectedPart)];
    return finish(node, type, combine([protectedPart, ...finalizer]));
  }

  /** The finalizer of a `try`: a unit block that may bind the outcome. */
  function finallyClause(
    node: NodeId,
    result: TypeRef,
    protectedSet: EffectSet,
  ): NodeInfo {
    const parts = children(node);
    const nameNode = parts.find((k) => kindOf(tree, k) === SyntaxKind.Name);
    const block = parts.find((k) => kindOf(tree, k) === SyntaxKind.Block);
    let binding: ArrowParameterFact | undefined;
    if (nameNode !== undefined) {
      binding = outcomeParameter(
        nameNode,
        outcomeType(table, result, protectedSet.failures),
      );
      if (!dataOnly(table, result, "value", false)) {
        checker = report(
          "type-mismatch/010",
          "the protected result must be data only when `finally` binds the outcome",
          nameNode,
        );
      }
    }
    checker = recordFact(node, {
      kind: "finalizer",
      binding: binding,
      protectedSet: protectedSet,
    });
    if (block === undefined) return errorInfo(node);
    const info = expr(block, undefined);
    checker = checkFit(block, info.type, table.unit, "the finally result");
    return finish(node, table.unit, info);
  }

  function optionFallback(
    node: NodeId,
    expected: TypeRef | undefined,
  ): NodeInfo {
    const operands = children(node);
    const left = operands[0];
    const right = operands[1];
    if (left === undefined || right === undefined) return errorInfo(node);
    const subject = expr(left, undefined);
    const domain = domainOf(table, subject.type);
    let element: TypeRef | undefined;
    if (domain.kind === "option") element = domain.element;
    if (domain.kind === "nullable") element = domain.rest;
    const fallback = expr(right, expected);
    if (element === undefined) {
      if (!isError(subject.type)) {
        checker = report(
          "type-mismatch/010",
          "the left operand of `??` must be an Option or a nullable union",
          left,
        );
      }
      return errorInfo(node);
    }
    const name = uniqueLocalName(`$option${node}`);
    const id: LocalId = bodyLocalId(bodyTable.declaration, name);
    checker = recordFact(node, {
      kind: "option-fallback",
      subject: domain.kind === "option" ? "option" : "nullable",
      binding: { id: id, name: name, type: element },
    });
    const type = joinResults([{ node: left, type: element }, {
      node: right,
      type: fallback.type,
    }], expected);
    return finish(node, type, combine([subject, fallback]));
  }

  function match(node: NodeId, expected: TypeRef | undefined): NodeInfo {
    const kids = children(node);
    const subjectNode = kids[0];
    if (subjectNode === undefined) return errorInfo(node);
    const subject = expr(subjectNode, undefined);
    const arms = kids.slice(1).filter((k) =>
      kindOf(tree, k) === SyntaxKind.MatchArm
    );
    const domain = domainOf(table, subject.type);
    if (domain.kind === "unsupported") {
      checker = report(
        "pattern/004",
        `a match cannot take a value of type ${
          show(subject.type)
        }; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, primitives, and nullable unions`,
        subjectNode,
      );
    } else if (domain.kind === "mixed") {
      checker = report(
        "pattern/004",
        `a match cannot take a value of type ${
          show(subject.type)
        }, which mixes tagged records or errors with other types; a match over names needs tagged records or errors only`,
        subjectNode,
      );
    }
    const state: MatchState = createMatchState();
    if (subject.mode === "effect") {
      refinements = refinements.clearDerivedFacts();
    }
    const excluded: ReturnType<RefinementChecker["condition"]>[] = [];
    let results = createBranchArms([subject]);
    for (const arm of arms) {
      const refinementScope = refinements.snapshot();
      for (const fact of excluded) refinements = refinements.addBranch(fact);
      const parts = children(arm);
      const patternNode = parts.find((k) => isPatternKind(kindOf(tree, k)));
      const bodyNode = parts.filter((k) => k !== patternNode).pop();
      if (patternNode !== undefined) {
        checker = checkPattern(patternNode, domain, state);
        const fact = bodyTable.facts.get(patternNode);
        if (fact?.kind === "pattern") {
          if (
            fact.pattern.kind === "literal" || fact.pattern.kind === "duration"
          ) {
            const matched = refinements.matchLiteral(
              subjectNode,
              fact.pattern.kind === "literal"
                ? fact.pattern.value
                : fact.pattern.millis,
            );
            refinements = refinements.addBranch(matched);
            if (matched !== undefined) excluded[excluded.length] = not(matched);
          }
          const patternFact = fact.pattern;
          let binding: LocalId | undefined;
          if (
            patternFact.kind === "bind" || patternFact.kind === "some" ||
            patternFact.kind === "error" || patternFact.kind === "tagged" ||
            patternFact.kind === "tag"
          ) {
            binding = patternFact.binding ?? undefined;
          }
          if (binding !== undefined) {
            const type = bodyTable.locals.get(binding);
            if (type !== undefined) {
              refinements = refinements.addLocal(binding, type, undefined);
            }
          }
        }
      }
      if (bodyNode === undefined) {
        refinements = refinements.restore(refinementScope);
        continue;
      }
      const checkedArm = armBody(bodyNode, expected, results);
      const info = checkedArm.info;
      results = checkedArm.arms;
      checker = recordInfo(arm, info.type, info);
      refinements = refinements.restore(refinementScope);
    }
    refinements = refinements.join(results.successful());
    if (!state.wildcard() && state.binding() === undefined) {
      checker = checkPatternCoverage(node, domain, state, arms.length);
    }
    return joinArms(node, expected, results);
  }

  let checker: BodyChecker = {
    sink: sink,
    addDiagnostic: addDiagnostic,
    body: bodyTable,
    recordLocal: recordLocal,
    bindLocal: bindLocal,
    tree: tree,
    table: table,
    module: module,
    targets: targets,
    services: benv.env.services,
    infos: bodyTable.info,
    facts: bodyTable.facts,
    valueType: valueType,
    kids: children,
    kidsOfKind: childrenOfKind,
    report: report,
    isError: isError,
    finish: finish,
    checkFit: checkFit,
    fact: recordFact,
    assignable: assignable,
    fits: fits,
    widen: widen,
    functionOf: functionOf,
    checkBody: checkBody,
    checkConstant: checkConstant,
    expr: expr,
    argInfo: argInfo,
    arity: arity,
    literalRecord: literalRecord,
    jobFunction: jobFunction,
    localUses: localUses,
    noPipeline: noPipeline,
    inlineStreamCallback: inlineStreamCallback,
    callback: callback,
  };
  return checker;
}

export function checkFunctionBody(
  benv: BodyEnv,
  signature: FunctionSignature,
  bodyNode: NodeId | undefined,
): FunctionRun {
  let checker = createBodyChecker(benv, signature.id);
  for (const parameter of signature.parameters) {
    checker = checker.bindLocal(parameter.id, parameter.type.ref, undefined);
  }
  const written = signature.written;
  const contract: Contract = {
    result: written.result ? signature.result?.ref : undefined,
    failures: written.fails ? signature.failures : undefined,
    requirements: written.uses ? signature.requirements : undefined,
  };
  const run = checker.checkBody(bodyNode, contract, undefined);
  const checked = checkedInputFlags(signature, benv.env.table);
  const checkedInput = checked.some(Boolean);
  checker = reportCheckedInputs(checker, benv, signature, checked);
  if (
    signature.expectedExecution === "pure" &&
    (checkedInput || run.mode !== "pure") &&
    bodyNode !== undefined
  ) {
    checker = checker.addDiagnostic(makeDiagnostic(
      "type-mismatch/003",
      "the function body has effect execution, but a pure function is expected",
      nodeSpan(benv.env.tree, bodyNode),
    ));
  }
  for (const parameter of signature.parameters) {
    if (parameter.borrow) {
      checker = checkBorrowedBody(checker, bodyNode, parameter, run.result);
    }
  }
  const table = benv.env.table;
  const failures = checkedInput && !run.failures.includes(SCHEMA_ERROR_ID)
    ? sortedUnique([...run.failures, SCHEMA_ERROR_ID])
    : run.failures;
  const mode = checkedInput ? "effect" : run.mode;
  const type = signatureFunctionRef(
    table,
    signature,
    { mode: mode, failures: failures, requirements: run.requirements },
    run.result,
  );
  return {
    table: checker.body,
    body: run.body,
    result: run.result,
    failures: failures,
    requirements: run.requirements,
    mode: mode,
    type: type,
    diagnostics: checker.sink,
  };
}

/**
 * An exported function with an inferred input checks that input at the entry.
 * Reports an input that has no compiler-derived schema, and a written `fails`
 * clause that omits `SchemaError`.
 */
function reportCheckedInputs(
  checker: BodyChecker,
  benv: BodyEnv,
  signature: FunctionSignature,
  checked: readonly boolean[],
): BodyChecker {
  if (!checked.some(Boolean)) return checker;
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
      checker = checker.addDiagnostic(makeDiagnostic(
        "type-mismatch/010",
        `the inferred input \`${parameter.name}\` has no compiler-derived schema; use a concrete annotation or a source-owned decoder`,
        parameter.span,
      ));
    }
  }
  if (
    signature.written.fails && !signature.failures.includes(SCHEMA_ERROR_ID)
  ) {
    checker = checker.addDiagnostic(makeDiagnosticWithRelated(
      "failure-contract/001",
      "an exported function with an inferred input contract must list SchemaError in its `fails` clause",
      signature.span,
      signature.parameters.flatMap((parameter, index) =>
        checked[index]
          ? [{
            span: parameter.span,
            message:
              "this input is checked, so the function can fail with `SchemaError`",
          }]
          : []
      ),
    ));
  }
  return checker;
}

function checkBorrowedBody(
  checker: BodyChecker,
  body: NodeId | undefined,
  parameter: FunctionSignature["parameters"][number],
  result: TypeRef,
): BodyChecker {
  if (checkBorrowedParameter(checker, body, parameter, result) === checker) {
    return checker;
  }
  return checker;
}

export function checkConstantBody(
  benv: BodyEnv,
  signature: ConstantSignature,
  initNode: NodeId | undefined,
): ConstantRun {
  const checker = createBodyChecker(benv, signature.id);
  const run = checker.checkConstant(initNode, signature.type?.ref);
  return {
    table: checker.body,
    type: run.type,
    diagnostics: checker.sink,
  };
}
