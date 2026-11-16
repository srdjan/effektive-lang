// Lowering of a checked module to typed IR.
//
// The lowering reads the syntax tree and the side tables that body checking
// built. It never infers a type or an effect set itself. A pipeline stage whose
// left value moved into a fresh binding takes its set from `stageSets`.
//
// The IR exists only for a module whose diagnostics are empty. A module in a
// `.effi` file lowers to its declarations, without its providers. Expected
// failures are error values. A violated internal invariant throws inside the
// lowering and the entry point turns it into an `internal` error value.
import {
  argNodes,
  arrowBody,
  type BinaryOperator,
  functionParts,
  initOf,
  isDurationLiteral,
  isPatternKind,
  isTypeKind,
  kidsOf,
  kidsOfKind,
  literalOf,
  nameTextOf,
  operatorOf,
  paramNodes,
  pipeParts,
  type RecordFieldParts,
  recordFieldParts,
  stageParts,
  unaryOperatorOf,
} from "./syntax_queries.ts";
import { solvedSignatureType } from "./signatures.ts";
import type {
  CheckedModule,
  CheckedProject,
  ConstantBody,
  FunctionBody,
} from "./check_project.ts";
import type {
  Annotation,
  Arm,
  ClosureExpr,
  Declaration,
  DeclarationId,
  DefectHandler,
  Effects,
  Expr,
  FunctionType,
  Handler,
  Import,
  LocalId,
  ModuleIR,
  Parameter,
  Pattern,
  Span,
  Step,
  Type,
  ValueId,
} from "./ir.ts";
import { DURATION_ID } from "./ir.ts";
import {
  caught,
  invariantFailure,
  isInvariantFailure,
  type Result,
  rethrow,
} from "./source.ts";
import { TokenKind } from "./lex.ts";
import { exportRuleOf, type ModuleInfo, planImports } from "./project.ts";
import type { ModuleResolution, Target } from "./resolve.ts";
import { sha256Hex } from "./sha256.ts";
import { canonicalJson } from "./content_id.ts";
import { compareText, sortedUnique } from "./util.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import {
  combine,
  type EffectSet,
  isQuiet,
  PURE_EFFECTS,
} from "./effect_set.ts";
import type { BodyTable, NodeFact, NodeInfo } from "./tables.ts";
import type { TypeRef, TypeTable } from "./types.ts";
import { functionTypeToIr, typeToIr } from "./type_ir.ts";
import {
  bodyLocalId,
  builtinInstanceId,
  type BuiltinInstanceName,
  localId,
  type ModuleName,
  shortName,
} from "./ids.ts";
import { PRELUDE_MODULE } from "./paths.ts";
import { emptyMap, emptySet, indices, reverseIndices } from "./runtime.ts";
export type LowerError =
  /** The module name is not part of the checked project. */
  | {
    readonly tag: "unknown-module";
    readonly module: string;
  }
  /** The module has diagnostics, so it has no IR. */
  | {
    readonly tag: "diagnostics";
    readonly module: string;
    readonly count: number;
  }
  /** The interface of an imported module is missing. */
  | {
    readonly tag: "no-interface";
    readonly module: string;
    readonly imported: string;
  }
  /** A violated invariant between the checker tables and the tree. */
  | {
    readonly tag: "internal";
    readonly module: string;
    readonly message: string;
  };

type LowerResult = Result<ModuleIR, LowerError>;
/** `lowerModule` returns an invariant failure as a `LowerError`. */
function internal(message: string): never {
  return invariantFailure("lower", message);
}
type BuiltinInstance = {
  readonly type: FunctionType;
};
type BuiltinInstances = {
  readonly get: (id: ValueId) => BuiltinInstance | undefined;
  readonly claim: (id: ValueId, instance: BuiltinInstance) => BuiltinInstance;
  readonly values: () => ReadonlyMap<ValueId, BuiltinInstance>;
};
function BuiltinInstances(): BuiltinInstances {
  let values = emptyMap<ValueId, BuiltinInstance>();
  function get(id: ValueId): BuiltinInstance | undefined {
    return values.get(id);
  }
  function claim(id: ValueId, instance: BuiltinInstance): BuiltinInstance {
    values = values.set(id, instance);
    return instance;
  }
  function readonlyValues(): ReadonlyMap<ValueId, BuiltinInstance> {
    return values;
  }
  return {
    get: get,
    claim: claim,
    values: readonlyValues,
  };
}
/** What the lowering of every body of one module shares. */
type ModuleContext = {
  readonly module: string;
  readonly tree: SyntaxTree;
  readonly types: TypeTable;
  readonly targets: ReadonlyMap<NodeId, Target>;
  /** Specialized builtins in the order of first use. */
  readonly builtins: BuiltinInstances;
  /** The identifier texts of the module, which a generated `$p<n>` name skips. */
  readonly identifiers: ReadonlySet<string>;
};
const EMPTY_EFFECTS: Effects = { failures: [], requirements: [] };
function setOf(expr: Expr): EffectSet {
  return {
    failures: expr.effects.failures,
    requirements: expr.effects.requirements,
    mode: expr.execution,
  };
}
type FactKind = NodeFact["kind"];
/** The argument reader of `invoke`: argument `i`, or an internal error. */
type ArgumentAt = (i: number) => Expr;
/**
 * The fact kinds that `invoke` lowers in its own cases: a fact field with
 * logic, a callee, a closure check, or no call at all.
 */
type SpecialKind =
  | "call"
  | "perform"
  | "builtin"
  | "error-construction"
  | "identity-construction"
  | "retry"
  | "log"
  | "schema"
  | "take-sink"
  | "buffer-stream"
  | "layer"
  | "none"
  | "list"
  | "field"
  | "arrow"
  | "binding"
  | "pattern"
  | "handler"
  | "finalizer"
  | "option-fallback"
  | "record-binding";
/** The fact kinds whose node moves positional arguments into named fields. */
type PositionalKind = Exclude<FactKind, SpecialKind>;
type FactOf<K extends FactKind> = NodeFact extends infer F ? F extends {
    readonly kind: infer FK;
  } ? [
      Extract<K, FK>,
    ] extends [
      never,
    ] ? never
    : F
  : never
  : never;
type BodyOf<K extends PositionalKind> = Extract<Expr, {
  readonly kind: K;
}> extends infer E ? E extends Expr ? Omit<E, keyof Annotation> : never : never;
/**
 * One builder for each positional kind. A kind without a row, and a row for a
 * kind that `invoke` handles itself, fail to compile. A row that builds the
 * wrong fields for its kind fails too.
 */
type PositionalBuilders = {
  readonly [K in PositionalKind]: (
    arg: ArgumentAt,
    fact: FactOf<K>,
  ) => BodyOf<K>;
};
const POSITIONAL_BUILDERS: PositionalBuilders = {
  "some": (arg) => ({ kind: "some", value: arg(0) }),
  "fail": (arg) => ({ kind: "fail", error: arg(0) }),
  "retry-schedule": (arg) => ({ kind: "retry-schedule", step: arg(0) }),
  "retry-with-schedule": (arg) => ({
    kind: "retry-with-schedule",
    job: arg(0),
    options: arg(1),
  }),
  "provide": (arg) => ({ kind: "provide", provider: arg(0), job: arg(1) }),
  "defer": (arg) => ({ kind: "defer", job: arg(0) }),
  "timeout": (arg) => ({ kind: "timeout", job: arg(0), durationMs: arg(1) }),
  "repeat": (arg, fact) => ({
    kind: "repeat",
    job: arg(0),
    options: fact.options ? arg(1) : null,
  }),
  "uninterruptible": (arg) => ({ kind: "uninterruptible", job: arg(0) }),
  "sleep": (arg) => ({ kind: "sleep", durationMs: arg(0) }),
  "now": () => ({ kind: "now" }),
  "random": () => ({ kind: "random" }),
  "random-int": (arg) => ({ kind: "random-int", min: arg(0), max: arg(1) }),
  "run": (arg) => ({ kind: "run", value: arg(0) }),
  "scoped": (arg) => ({ kind: "scoped", value: arg(0) }),
  "fork-scoped": (arg) => ({ kind: "fork-scoped", job: arg(0) }),
  "unfold": (arg) => ({ kind: "unfold", seed: arg(0), next: arg(1) }),
  "map-effect": (arg, fact) => ({
    kind: "map-effect",
    stream: arg(0),
    transform: arg(1),
    concurrency: fact.concurrency,
  }),
  "map-stream": (arg) => ({
    kind: "map-stream",
    stream: arg(0),
    transform: arg(1),
  }),
  "sink-for-each": (arg) => ({ kind: "sink-for-each", consume: arg(0) }),
  "transduce-stream": (arg) => ({
    kind: "transduce-stream",
    stream: arg(0),
    sink: arg(1),
  }),
  "run-stream": (arg) => ({ kind: "run-stream", stream: arg(0), sink: arg(1) }),
  "race-all": (arg) => ({ kind: "race-all", jobs: arg(0) }),
  "race": (arg) => ({ kind: "race", left: arg(0), right: arg(1) }),
  "make-ref": (arg) => ({ kind: "make-ref", value: arg(0) }),
  "get-ref": (arg) => ({ kind: "get-ref", ref: arg(0) }),
  "set-ref": (arg) => ({ kind: "set-ref", ref: arg(0), value: arg(1) }),
  "update-ref": (arg) => ({
    kind: "update-ref",
    ref: arg(0),
    transform: arg(1),
  }),
  "merge-layers": (arg) => ({
    kind: "merge-layers",
    left: arg(0),
    right: arg(1),
  }),
};
/** The node of a positional fact, without its annotation. */
function positionalBody<K extends PositionalKind>(
  kind: K,
  fact: FactOf<K>,
  arg: ArgumentAt,
): BodyOf<K> {
  return POSITIONAL_BUILDERS[kind](arg, fact);
}
/**
 * Lowers the expressions of one top-level declaration. The counter of generated
 * pipeline bindings belongs to the declaration and starts at 1.
 */
type BodyLowerer = {
  readonly expr: (node: NodeId) => Expr;
};

type PipelineLink = {
  readonly pipe: NodeId;
  readonly stage: NodeId;
};

type PipelineParts = {
  readonly base: NodeId;
  readonly links: readonly PipelineLink[];
};

function BodyLowerer(
  ctx: ModuleContext,
  body: BodyTable,
  owner: string,
): BodyLowerer {
  const bodyLowererOwner = owner;
  const bodyLowererBody = body;
  const bodyLowererCtx = ctx;
  let bodyLowererPipelines = 0;
  let bodyLowererResourceBindings = emptyMap<LocalId, LocalId>();
  function bodyLowererKids(node: NodeId): NodeId[] {
    return kidsOf(bodyLowererCtx.tree, node);
  }
  function bodyLowererSpan(node: NodeId): Span {
    return nodeSpan(bodyLowererCtx.tree, node);
  }
  function bodyLowererInfo(node: NodeId): NodeInfo {
    const info = bodyLowererBody.info.get(node);
    if (info === undefined) {
      return internal(
        `no checker info for the node at ${bodyLowererDescribe(node)}`,
      );
    }
    return info;
  }
  function bodyLowererFact(node: NodeId): NodeFact | undefined {
    return bodyLowererBody.facts.get(node);
  }
  function bodyLowererFactOf<K extends FactKind>(
    node: NodeId,
    kind: K,
  ): FactOf<K> {
    const fact = bodyLowererFact(node);
    if (fact === undefined || !factHasKind(fact, kind)) {
      return internal(`no ${kind} fact at ${bodyLowererDescribe(node)}`);
    }
    return fact;
  }

  function factHasKind<K extends FactKind>(
    fact: NodeFact,
    kind: K,
  ): fact is FactOf<K> {
    return fact.kind === kind;
  }
  function bodyLowererDescribe(node: NodeId): string {
    const span = bodyLowererSpan(node);
    return `${span.source}:${span.start}-${span.end}`;
  }
  function bodyLowererIr(ref: TypeRef): Type {
    return typeToIr(bodyLowererCtx.types, ref);
  }
  function bodyLowererAnnotationWith(
    type: TypeRef,
    set: EffectSet,
    span: Span,
  ): Annotation {
    return {
      type: bodyLowererIr(type),
      execution: set.mode,
      effects: {
        failures: [...set.failures],
        requirements: [...set.requirements],
      },
      span: span,
    };
  }
  function bodyLowererAnnotation(node: NodeId): Annotation {
    const info = bodyLowererInfo(node);
    const proofs = bodyLowererBody.proofs.get(node);
    const annotation = bodyLowererAnnotationWith(
      info.type,
      info,
      bodyLowererSpan(node),
    );
    return proofs === undefined
      ? annotation
      : { ...annotation, proofs: proofs };
  }
  function bodyLowererNameText(nameNode: NodeId | undefined): string {
    const text = nameNode === undefined
      ? undefined
      : nameTextOf(bodyLowererCtx.tree, nameNode);
    if (text === undefined) {
      return internal("a name node has no identifier");
    }
    return text;
  }
  function bodyLowererRequired<T>(
    value: T | undefined,
    what: string,
    node: NodeId,
  ): T {
    if (value === undefined) {
      return internal(`${what} is missing at ${bodyLowererDescribe(node)}`);
    }
    return value;
  }
  function bodyLowererParameter(
    id: LocalId | undefined,
    name: string,
    type: TypeRef | undefined,
    span: Span,
  ): Parameter {
    if (id === undefined || type === undefined) {
      return internal(`the binding \`${name}\` has no local identity`);
    }
    return { id: id, name: name, type: bodyLowererIr(type), span: span };
  }
  function bodyLowererBindingOf(
    id: LocalId | undefined,
    nameNode: NodeId | undefined,
  ): Parameter {
    if (id === undefined || nameNode === undefined) {
      return internal("a pattern binding has no local identity");
    }
    return bodyLowererParameter(
      id,
      bodyLowererNameText(nameNode),
      bodyLowererBody.locals.get(id),
      bodyLowererSpan(nameNode),
    );
  }
  function bodyLowererNextPipelineBinding(): {
    readonly id: LocalId;
    readonly name: string;
  } {
    for (const _index of indices(bodyLowererCtx.identifiers.size + 1)) {
      bodyLowererPipelines = bodyLowererPipelines + 1;
      if (!bodyLowererCtx.identifiers.has(`$p${bodyLowererPipelines}`)) {
        const name = `$p${bodyLowererPipelines}`;
        return {
          id: localId(bodyLowererCtx.module, bodyLowererOwner, name),
          name: name,
        };
      }
    }
    return internal("cannot allocate a pipeline binding");
  }
  function bodyLowererExpr(node: NodeId): Expr {
    const tree = bodyLowererCtx.tree;
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.LiteralExpr) {
      const value = literalOf(tree, node);
      if (value === undefined) {
        return internal(
          `a literal has no value at ${bodyLowererDescribe(node)}`,
        );
      }
      if (value === null) {
        return { ...bodyLowererAnnotation(node), kind: "null" };
      }
      const literal: Expr = {
        ...bodyLowererAnnotation(node),
        kind: "literal",
        value: value,
      };
      if (!isDurationLiteral(tree, node)) {
        return literal;
      }
      // A duration literal is the `Duration` of its millisecond value.
      const valueAnnotation = bodyLowererAnnotationWith(
        bodyLowererCtx.types.int,
        bodyLowererInfo(node),
        bodyLowererSpan(node),
      );
      return {
        ...bodyLowererAnnotation(node),
        kind: "nominal",
        nominal: DURATION_ID,
        value: {
          ...literal,
          type: valueAnnotation.type,
          execution: valueAnnotation.execution,
          effects: valueAnnotation.effects,
          span: valueAnnotation.span,
        },
      };
    }
    if (kind === SyntaxKind.NameExpr) {
      return bodyLowererName(node);
    }
    if (kind === SyntaxKind.ParenExpr) {
      const inner = bodyLowererKids(node)[0];
      return bodyLowererExpr(
        bodyLowererRequired(inner, "a parenthesized value", node),
      );
    }
    if (kind === SyntaxKind.ArrowExpr) {
      return bodyLowererClosure(node);
    }
    if (kind === SyntaxKind.UsingExpr) {
      return bodyLowererUsing(node);
    }
    if (kind === SyntaxKind.CallExpr) {
      return bodyLowererCall(node);
    }
    if (kind === SyntaxKind.FieldExpr) {
      return bodyLowererField(node);
    }
    if (kind === SyntaxKind.BinaryExpr) {
      return bodyLowererBinary(node);
    }
    if (kind === SyntaxKind.UnaryExpr) {
      return bodyLowererUnary(node);
    }
    if (kind === SyntaxKind.OptionFallbackExpr) {
      return bodyLowererOptionFallback(node);
    }
    if (kind === SyntaxKind.PipeExpr) {
      return bodyLowererPipeline(node);
    }
    if (kind === SyntaxKind.RecordExpr) {
      return bodyLowererRecord(node);
    }
    if (kind === SyntaxKind.ListExpr) {
      const fact = bodyLowererFactOf(node, "list");
      if (fact.concat !== undefined) {
        return bodyLowererConcat(node, fact.concat);
      }
      return {
        ...bodyLowererAnnotation(node),
        kind: fact.shape,
        elements: bodyLowererKids(node).map((child) => bodyLowererExpr(child)),
      };
    }
    if (kind === SyntaxKind.Block) {
      return bodyLowererBlock(node);
    }
    if (kind === SyntaxKind.IfExpr) {
      return bodyLowererIfExpr(node);
    }
    if (kind === SyntaxKind.MatchExpr) {
      return bodyLowererMatch(node);
    }
    if (kind === SyntaxKind.TryExpr) {
      return bodyLowererTryExpr(node);
    }
    return internal(
      `cannot lower the node at ${bodyLowererDescribe(node)}`,
    );
  }
  function bodyLowererValueTarget(nameNode: NodeId): LocalId | ValueId {
    const target = bodyLowererCtx.targets.get(nameNode);
    if (
      target?.kind === "local" || target?.kind === "value" ||
      target?.kind === "provider"
    ) {
      return target.kind === "local"
        ? bodyLowererResourceBindings.get(target.id) ?? target.id
        : target.id;
    }
    return internal(
      `the name at ${bodyLowererDescribe(nameNode)} does not refer to a value`,
    );
  }
  function bodyLowererName(node: NodeId): Expr {
    if (bodyLowererFact(node)?.kind === "none") {
      return { ...bodyLowererAnnotation(node), kind: "none" };
    }
    return {
      ...bodyLowererAnnotation(node),
      kind: "reference",
      target: bodyLowererValueTarget(node),
    };
  }
  function bodyLowererUsing(node: NodeId): Expr {
    const parts = bodyLowererKids(node);
    function region(kind: SyntaxKind): ClosureExpr {
      const region = bodyLowererRequired(
        parts.find((k) => kindOf(bodyLowererCtx.tree, k) === kind),
        "resource region",
        node,
      );
      const fact = bodyLowererFactOf(region, "arrow");
      const source = fact.parameters[0];
      const outcome = fact.parameters[1];
      const outcomeName =
        kidsOfKind(bodyLowererCtx.tree, region, SyntaxKind.Name)[0];
      const id: LocalId = bodyLocalId(
        bodyLowererBody.declaration,
        `$using${region}`,
      );
      const parameters = source === undefined ? [] : [
        bodyLowererParameter(
          id,
          source.name,
          source.type,
          bodyLowererSpan(parts[0]),
        ),
      ];
      if (outcome !== undefined) {
        parameters[parameters.length] = bodyLowererParameter(
          outcome.id,
          outcome.name,
          outcome.type,
          bodyLowererSpan(
            bodyLowererRequired(outcomeName, "the outcome name", node),
          ),
        );
      }
      const previous = source?.id === undefined
        ? undefined
        : bodyLowererResourceBindings.get(source.id);
      if (source?.id !== undefined) {
        bodyLowererResourceBindings = bodyLowererResourceBindings.set(
          source.id,
          id,
        );
      }
      // A failure ends the lowering of the module, so no restore on a throw.
      const closure: Expr = {
        ...bodyLowererAnnotation(region),
        kind: "closure",
        parameters: parameters,
        body: bodyLowererExpr(
          bodyLowererRequired(
            bodyLowererKids(region).at(-1),
            "the region body",
            node,
          ),
        ),
      };
      if (source?.id !== undefined) {
        if (previous === undefined) {
          if (!bodyLowererResourceBindings.delete(source.id)) {
            return internal("the active resource binding is missing");
          }
        } else {
          bodyLowererResourceBindings = bodyLowererResourceBindings.set(
            source.id,
            previous,
          );
        }
      }
      return closure;
    }
    return {
      ...bodyLowererAnnotation(node),
      kind: "with-resource",
      acquire: region(SyntaxKind.ResourceAcquire),
      use: region(SyntaxKind.ResourceUse),
      release: region(SyntaxKind.ResourceRelease),
    };
  }
  function bodyLowererClosure(node: NodeId): Expr {
    const fact = bodyLowererFactOf(node, "arrow");
    const params = paramNodes(
      bodyLowererCtx.tree,
      functionParts(bodyLowererCtx.tree, node).paramList,
    );
    const parameters = fact.parameters.map((p, i) =>
      bodyLowererParameter(
        p.id,
        p.name,
        p.type,
        bodyLowererSpan(bodyLowererRequired(params[i], "a parameter", node)),
      )
    );
    const bodyNode = arrowBody(bodyLowererCtx.tree, node);
    return {
      ...bodyLowererAnnotation(node),
      kind: "closure",
      parameters: parameters,
      body: bodyLowererExpr(
        bodyLowererRequired(bodyNode, "the arrow body", node),
      ),
    };
  }
  function bodyLowererCall(node: NodeId): Expr {
    const kids = bodyLowererKids(node);
    const callee = bodyLowererRequired(kids[0], "the callee", node);
    const args = argNodes(bodyLowererCtx.tree, node);
    return bodyLowererInvoke(node, callee, args, undefined);
  }
  function bodyLowererInvoke(
    node: NodeId,
    calleeNode: NodeId,
    argNodes: readonly NodeId[],
    pre: Expr | undefined,
  ): Expr {
    const fact = bodyLowererRequired(
      bodyLowererFact(node),
      "the call fact",
      node,
    );
    if (fact.kind === "layer") {
      return bodyLowererInvokeLayer(fact, node, argNodes, pre);
    }
    const callee: Expr | undefined = fact.kind === "call"
      ? bodyLowererCalleeExpr(calleeNode)
      : undefined;
    const args: Expr[] = pre === undefined ? [] : [pre];
    if (fact.kind !== "error-construction") {
      for (const argNode of argNodes) {
        args[args.length] = bodyLowererExpr(argNode);
      }
    }
    const stageSet = bodyLowererBody.stageSets.get(node);
    const annotation = stageSet === undefined
      ? bodyLowererAnnotation(node)
      : bodyLowererAnnotationWith(
        bodyLowererInfo(node).type,
        stageSet,
        bodyLowererSpan(node),
      );
    function arg(i: number): Expr {
      return bodyLowererRequired(args[i], `argument ${i + 1}`, node);
    }
    if (fact.kind === "call") {
      return {
        ...annotation,
        kind: "call",
        callee: bodyLowererRequired(callee, "the callee", node),
        arguments: args,
      };
    }
    if (fact.kind === "perform") {
      return {
        ...annotation,
        kind: "perform",
        capability: fact.capability,
        arguments: args,
      };
    }
    if (fact.kind === "builtin") {
      const id = bodyLowererSpecialize(fact.name, fact.ir);
      return {
        ...annotation,
        kind: "call",
        callee: {
          kind: "reference",
          target: id,
          type: fact.ir,
          execution: "pure",
          effects: EMPTY_EFFECTS,
          span: bodyLowererSpan(calleeNode),
        },
        arguments: args,
      };
    }
    if (fact.kind === "error-construction") {
      return bodyLowererInvokeErrorConstruction(
        fact,
        argNodes,
        pre,
        annotation,
      );
    }
    if (fact.kind === "identity-construction") {
      return {
        ...annotation,
        kind: "nominal",
        nominal: fact.identity,
        value: arg(0),
      };
    }
    if (fact.kind === "retry") {
      return {
        ...annotation,
        kind: "retry",
        job: arg(0),
        times: bodyLowererRequired(fact.times, "the retry count", node),
      };
    }
    if (fact.kind === "schema") {
      return bodyLowererInvokeSchema(fact, args, arg, annotation);
    }
    if (fact.kind === "log") {
      return bodyLowererInvokeLog(fact, node, args, arg, annotation);
    }
    if (fact.kind === "take-sink") {
      return {
        ...annotation,
        kind: "take-sink",
        count: bodyLowererRequired(fact.count, "the sink count", node),
      };
    }
    if (fact.kind === "buffer-stream") {
      return {
        ...annotation,
        kind: "buffer-stream",
        stream: arg(0),
        capacity: bodyLowererRequired(
          fact.capacity,
          "the stream buffer capacity",
          node,
        ),
      };
    }
    if (
      fact.kind === "none" || fact.kind === "list" || fact.kind === "field" ||
      fact.kind === "arrow" || fact.kind === "binding" ||
      fact.kind === "pattern" || fact.kind === "handler" ||
      fact.kind === "finalizer" || fact.kind === "option-fallback" ||
      fact.kind === "record-binding"
    ) {
      return internal(
        `the fact ${fact.kind} is no call at ${bodyLowererDescribe(node)}`,
      );
    }
    // Every other fact kind has a row in POSITIONAL_BUILDERS. A kind
    // without a row, or without a case above, fails to compile here.
    return {
      ...positionalBody(fact.kind, fact, arg),
      type: annotation.type,
      execution: annotation.execution,
      effects: annotation.effects,
      span: annotation.span,
    };
  }
  function bodyLowererInvokeLayer(
    fact: FactOf<"layer">,
    node: NodeId,
    argNodes: readonly NodeId[],
    pre: Expr | undefined,
  ): Expr {
    if (pre !== undefined) {
      return internal("layer does not accept a pipeline input");
    }
    return {
      ...bodyLowererAnnotation(node),
      kind: "layer",
      service: bodyLowererRequired(fact.service, "the supplied service", node),
      acquire: bodyLowererExpr(
        bodyLowererRequired(argNodes[1], "the layer acquisition", node),
      ),
    };
  }
  function bodyLowererInvokeErrorConstruction(
    fact: FactOf<"error-construction">,
    argNodes: readonly NodeId[],
    pre: Expr | undefined,
    annotation: Annotation,
  ): Expr {
    const record = argNodes[0];
    if (
      pre !== undefined || argNodes.length !== 1 || record === undefined ||
      kindOf(bodyLowererCtx.tree, record) !== SyntaxKind.RecordExpr
    ) {
      return internal(
        "an error is constructed from a record literal; this argument is not one",
      );
    }
    return {
      ...annotation,
      kind: "error",
      error: fact.error,
      fields: bodyLowererRecordFields(bodyLowererKids(record)),
    };
  }
  function bodyLowererInvokeSchema(
    fact: FactOf<"schema">,
    args: readonly Expr[],
    arg: ArgumentAt,
    annotation: Annotation,
  ): Expr {
    if (fact.op === "decode") {
      return {
        ...annotation,
        kind: "schema-decode",
        schema: arg(0),
        input: arg(1),
      };
    }
    if (fact.op === "encode") {
      return {
        ...annotation,
        kind: "schema-encode",
        schema: arg(0),
        input: arg(1),
      };
    }
    if (fact.op === "make") {
      return {
        ...annotation,
        kind: "schema-make",
        schema: arg(0),
        input: arg(1),
      };
    }
    return {
      ...annotation,
      kind: "schema",
      op: fact.op,
      arguments: bodyLowererSchemaArguments(fact, args),
    };
  }
  function bodyLowererInvokeLog(
    fact: FactOf<"log">,
    node: NodeId,
    args: readonly Expr[],
    arg: ArgumentAt,
    annotation: Annotation,
  ): Expr {
    // The checker proved a literal options record and recorded whether it writes `fields`.
    const options = args[1];
    if (options !== undefined && options.kind !== "record") {
      return internal("log needs a literal options record");
    }
    const fields = options === undefined || !fact.fields
      ? undefined
      : options.fields.find((field) => field.name === "fields")?.value;
    return {
      ...annotation,
      kind: "log",
      message: arg(0),
      level: bodyLowererRequired(fact.level, "the log level", node),
      fields: fields ?? null,
    };
  }
  function bodyLowererCalleeExpr(calleeNode: NodeId): Expr {
    if (kindOf(bodyLowererCtx.tree, calleeNode) !== SyntaxKind.QualifiedName) {
      return bodyLowererExpr(calleeNode);
    }
    return {
      ...bodyLowererAnnotation(calleeNode),
      kind: "reference",
      target: bodyLowererValueTarget(calleeNode),
    };
  }
  function bodyLowererConcat(node: NodeId, type: FunctionType): Expr {
    const span = bodyLowererSpan(node);
    const args = bodyLowererKids(node).map((child, i): Expr => {
      if (kindOf(bodyLowererCtx.tree, child) === SyntaxKind.SpreadElement) {
        return bodyLowererExpr(bodyLowererKids(child)[0]);
      }
      const element = bodyLowererExpr(child);
      return {
        kind: "array",
        elements: [element],
        type: type.parameters[i],
        execution: element.execution,
        effects: element.effects,
        span: element.span,
      };
    });
    return {
      ...bodyLowererAnnotation(node),
      kind: "call",
      callee: {
        kind: "reference",
        target: bodyLowererSpecialize("concat", type),
        type: type,
        execution: "pure",
        effects: EMPTY_EFFECTS,
        span: span,
      },
      arguments: args,
    };
  }
  function bodyLowererSpecialize(
    name: BuiltinInstanceName,
    type: FunctionType,
  ): ValueId {
    const json = canonicalJson(type);
    const hash = sha256Hex(json).slice(0, 12);
    const id: ValueId = builtinInstanceId(bodyLowererCtx.module, name, hash);
    const known = bodyLowererCtx.builtins.get(id) ??
      bodyLowererCtx.builtins.claim(id, { type: type });
    if (canonicalJson(known.type) !== json) {
      // The 12-digit hash is a truncation, so two types could share an id.
      return internal(`two builtin instance types share the id ${id}`);
    }
    return id;
  }
  function bodyLowererField(node: NodeId): Expr {
    const fact = bodyLowererFactOf(node, "field");
    const base = bodyLowererRequired(
      bodyLowererKids(node)[0],
      "the record",
      node,
    );
    return {
      ...bodyLowererAnnotation(node),
      kind: "get",
      record: bodyLowererExpr(base),
      field: fact.name,
    };
  }
  function bodyLowererBinary(node: NodeId): Expr {
    const kids = bodyLowererKids(node);
    const operator: BinaryOperator = bodyLowererRequired(
      operatorOf(bodyLowererCtx.tree, node),
      "the operator",
      node,
    );
    return {
      ...bodyLowererAnnotation(node),
      kind: "binary",
      operator: operator,
      left: bodyLowererExpr(
        bodyLowererRequired(kids[0], "the left operand", node),
      ),
      right: bodyLowererExpr(
        bodyLowererRequired(kids[1], "the right operand", node),
      ),
    };
  }
  function bodyLowererUnary(node: NodeId): Expr {
    const unary = bodyLowererRequired(
      unaryOperatorOf(bodyLowererCtx.tree, node),
      "the operator",
      node,
    );
    const operator = unary.operator;
    const token = unary.token;
    const operand = bodyLowererExpr(
      bodyLowererRequired(bodyLowererKids(node)[0], "the operand", node),
    );
    const minus = operator === "-";
    const literal: Expr = {
      ...bodyLowererAnnotationWith(
        minus ? bodyLowererCtx.types.int : bodyLowererCtx.types.boolean,
        PURE_EFFECTS,
        bodyLowererSpan(token),
      ),
      kind: "literal",
      value: minus ? 0 : false,
    };
    return {
      ...bodyLowererAnnotation(node),
      kind: "binary",
      operator: minus ? "-" : "===",
      left: minus ? literal : operand,
      right: minus ? operand : literal,
    };
  }
  function bodyLowererPipeline(node: NodeId): Expr {
    const parts = bodyLowererPipelineParts(node);
    const chain = parts.links;
    const base = parts.base;
    // One binding for the base value and one for each stage but the last.
    const bindings = chain.map(() => bodyLowererNextPipelineBinding());
    const steps: Step[] = [];
    let left: NodeId = base;
    let value = bodyLowererExpr(base);
    let result: Expr | undefined;
    let bindingIndex = 0;
    for (const i of reverseIndices(chain.length)) {
      const link = chain[i];
      const leftInfo = bodyLowererInfo(left);
      const leftSpan = bodyLowererSpan(left);
      const proofs = bodyLowererBody.proofs.get(left);
      if (proofs !== undefined) {
        value = { ...value, proofs: proofs };
      }
      const adoption = value.proofs?.find((proof) =>
        bodyLowererCtx.types.identityBaseOf(proof.target) !== undefined
      );
      const type: Type = adoption === undefined
        ? bodyLowererIr(leftInfo.type)
        : { kind: "named", id: adoption.target };
      const bindingStep: Step = {
        kind: "bind",
        generated: true,
        binding: {
          id: bindings[bindingIndex].id,
          name: bindings[bindingIndex].name,
          type: type,
          span: leftSpan,
        },
        value: value,
      };
      steps[steps.length] = bindingStep;
      const reference: Expr = {
        kind: "reference",
        target: bindings[bindingIndex].id,
        type: type,
        execution: "pure",
        effects: EMPTY_EFFECTS,
        span: leftSpan,
      };
      const call = bodyLowererStage(link.stage, reference, leftInfo);
      if (i === 0) {
        result = call;
      } else {
        value = call;
        left = link.pipe;
      }
      bindingIndex = bindingIndex + 1;
    }
    const last = bodyLowererRequired(result, "the pipeline result", node);
    const outer = bodyLowererInfo(node);
    const set = combine([...steps.map((s) => setOf(s.value)), setOf(last)]);
    const proofs = bodyLowererBody.proofs.get(node);
    const block: Expr = {
      ...bodyLowererAnnotationWith(outer.type, set, bodyLowererSpan(node)),
      kind: "block",
      steps: steps,
      result: last,
    };
    return proofs === undefined ? block : { ...block, proofs: proofs };
  }

  function bodyLowererPipelineParts(node: NodeId): PipelineParts {
    let base = node;
    const links: PipelineLink[] = [];
    for (const _index of indices(bodyLowererCtx.tree.count)) {
      if (kindOf(bodyLowererCtx.tree, base) !== SyntaxKind.PipeExpr) {
        return { base: base, links: links };
      }
      const parts = pipeParts(bodyLowererCtx.tree, base);
      links[links.length] = {
        pipe: base,
        stage: bodyLowererRequired(parts.stage, "the pipeline stage", base),
      };
      base = bodyLowererRequired(parts.left, "the pipeline value", base);
    }
    return internal("a pipeline is deeper than its syntax tree");
  }
  function bodyLowererStage(
    stage: NodeId,
    pre: Expr,
    leftInfo: NodeInfo,
  ): Expr {
    const parts = stageParts(bodyLowererCtx.tree, stage);
    const callee = parts.callee;
    const stageArgs = parts.args;
    const qualified = bodyLowererRequired(callee, "the stage name", stage);
    if (!isQuiet(leftInfo)) {
      if (bodyLowererBody.stageSets.get(stage) === undefined) {
        return internal(
          `the stage effect set is missing at ${bodyLowererDescribe(stage)}`,
        );
      }
    }
    return bodyLowererInvoke(stage, qualified, stageArgs, pre);
  }
  function bodyLowererFieldParts(field: NodeId): RecordFieldParts {
    const kind = kindOf(bodyLowererCtx.tree, field);
    if (kind !== SyntaxKind.RecordField && kind !== SyntaxKind.ShorthandField) {
      return internal("a record spread must come first in a record");
    }
    return bodyLowererRequired(
      recordFieldParts(bodyLowererCtx.tree, field),
      "the field label",
      field,
    );
  }
  function bodyLowererSchemaArguments(
    fact: FactOf<"schema">,
    args: readonly Expr[],
  ): readonly Expr[] {
    const options = args[2];
    if (!fact.options || options === undefined || options.kind !== "record") {
      return args;
    }
    const dropped = "on";
    const fields = options.fields.filter((field) => field.name !== dropped);
    if (fields.length === 0) {
      return args.slice(0, 2);
    }
    const type = options.type;
    return [
      args[0],
      args[1],
      {
        ...options,
        fields: fields,
        type: type.kind === "record"
          ? {
            kind: "record",
            fields: type.fields
              .filter((field) => field.name !== dropped)
              .map((field) => ({ ...field, optional: false })),
          }
          : type,
      },
    ];
  }
  function bodyLowererRecordFields(fields: readonly NodeId[]): {
    readonly name: string;
    readonly value: Expr;
  }[] {
    return fields.map((field) => {
      const parts = bodyLowererFieldParts(field);
      // A shorthand field `{ id }` reads the variable `id`. The checker keeps its sets on the field node.
      const value: Expr = parts.value !== undefined
        ? bodyLowererExpr(parts.value)
        : {
          ...bodyLowererAnnotation(field),
          kind: "reference",
          target: bodyLowererValueTarget(parts.labelNode),
        };
      return { name: parts.label, value: value };
    });
  }
  function bodyLowererRecord(node: NodeId): Expr {
    const fields = bodyLowererKids(node);
    const first = fields[0];
    if (
      first !== undefined &&
      kindOf(bodyLowererCtx.tree, first) === SyntaxKind.SpreadField
    ) {
      const baseNode = bodyLowererRequired(
        bodyLowererKids(first)[0],
        "the spread base",
        first,
      );
      return {
        ...bodyLowererAnnotation(node),
        kind: "update",
        record: bodyLowererExpr(baseNode),
        fields: bodyLowererRecordFields(fields.slice(1)),
      };
    }
    const record: Expr = {
      ...bodyLowererAnnotation(node),
      kind: "record",
      fields: bodyLowererRecordFields(fields),
    };
    const fact = bodyLowererFact(node);
    if (fact?.kind !== "identity-construction") {
      return record;
    }
    // A record literal at a tagged record is an implicit `Name({ ... })`: the
    // literal itself has the unnamed record type.
    const body = bodyLowererCtx.types.taggedRecordOf(fact.identity);
    return {
      ...bodyLowererAnnotationWith(
        bodyLowererInfo(node).type,
        bodyLowererInfo(node),
        bodyLowererSpan(node),
      ),
      kind: "nominal",
      nominal: fact.identity,
      value: body === undefined
        ? record
        : { ...record, type: bodyLowererIr(body) },
    };
  }
  function bodyLowererBlock(node: NodeId): Expr {
    const items = bodyLowererKids(node);
    const steps: Step[] = [];
    let result: Expr | undefined;
    for (const i of indices(items.length)) {
      const item = items[i];
      if (kindOf(bodyLowererCtx.tree, item) === SyntaxKind.ConstDecl) {
        if (bodyLowererFact(item)?.kind === "record-binding") {
          for (const recordStep of bodyLowererRecordBinding(item)) {
            steps[steps.length] = recordStep;
          }
        } else {
          steps[steps.length] = bodyLowererBinding(item);
        }
      } else if (i === items.length - 1) {
        result = bodyLowererExpr(item);
      } else {
        const evaluateStep: Step = {
          kind: "evaluate",
          value: bodyLowererExpr(item),
        };
        steps[steps.length] = evaluateStep;
      }
    }
    return {
      ...bodyLowererAnnotation(node),
      kind: "block",
      steps: steps,
      // A block that ends with a binding, or has no items, yields unit.
      result: result ?? {
        kind: "literal",
        value: null,
        type: { kind: "primitive", name: "unit" },
        execution: "pure",
        effects: EMPTY_EFFECTS,
        span: bodyLowererSpan(node),
      },
    };
  }
  function bodyLowererRecordBinding(node: NodeId): Step[] {
    const fact = bodyLowererFactOf(node, "record-binding");
    const init = bodyLowererRequired(
      bodyLowererKids(node).at(-1),
      "the record binding initializer",
      node,
    );
    const captured = bodyLowererParameter(
      fact.captured.id,
      fact.captured.name,
      fact.captured.type,
      bodyLowererSpan(init),
    );
    const reference: Expr = {
      ...bodyLowererAnnotationWith(
        fact.captured.type,
        PURE_EFFECTS,
        bodyLowererSpan(init),
      ),
      kind: "reference",
      target: captured.id,
    };
    return [
      { kind: "bind", binding: captured, value: bodyLowererExpr(init) },
      ...fact.fields.map((field): Step => {
        const name = field.name;
        const binding = field.binding;
        const label = field.label;
        const local = field.local;
        return ({
          kind: "bind",
          binding: bodyLowererParameter(
            binding.id,
            binding.name,
            binding.type,
            bodyLowererSpan(local),
          ),
          value: {
            ...bodyLowererAnnotationWith(
              binding.type,
              PURE_EFFECTS,
              bodyLowererSpan(label),
            ),
            kind: "get",
            record: reference,
            field: name,
          },
        });
      }),
    ];
  }
  function bodyLowererBinding(node: NodeId): Step {
    const fact = bodyLowererFactOf(node, "binding");
    const parts = bodyLowererKids(node);
    const nameNode = bodyLowererRequired(
      parts.find((k) => kindOf(bodyLowererCtx.tree, k) === SyntaxKind.Name),
      "the binding name",
      node,
    );
    const typeNode = parts.find((k) =>
      isTypeKind(kindOf(bodyLowererCtx.tree, k))
    );
    const init = initOf(bodyLowererCtx.tree, node, nameNode);
    const name = bodyLowererSpan(nameNode);
    const end = typeNode === undefined
      ? name.end
      : bodyLowererSpan(typeNode).end;
    return {
      kind: "bind",
      binding: bodyLowererParameter(
        fact.id,
        bodyLowererNameText(nameNode),
        fact.type,
        {
          source: name.source,
          start: name.start,
          end: end,
        },
      ),
      value: bodyLowererExpr(
        bodyLowererRequired(init, "the binding value", node),
      ),
    };
  }
  function bodyLowererIfExpr(node: NodeId): Expr {
    const kids = bodyLowererKids(node);
    function part(i: number, what: string): Expr {
      return bodyLowererExpr(bodyLowererRequired(kids[i], what, node));
    }
    return {
      ...bodyLowererAnnotation(node),
      kind: "if",
      condition: part(0, "the condition"),
      then: part(1, "the then branch"),
      else: part(2, "the else branch"),
    };
  }
  function bodyLowererOptionFallback(node: NodeId): Expr {
    const children = bodyLowererKids(node);
    const left = children[0];
    const right = children[1];
    const fact = bodyLowererFactOf(node, "option-fallback");
    const span = bodyLowererSpan(node);
    // The subject lowers first, so its pipeline bindings number before those of the fallback.
    const subject = bodyLowererExpr(left);
    const binding = bodyLowererParameter(
      fact.binding.id,
      fact.binding.name,
      fact.binding.type,
      bodyLowererSpan(left),
    );
    const taken: Arm = {
      pattern: fact.subject === "option"
        ? { kind: "some", binding: binding, span: span }
        : { kind: "bind", binding: binding, span: span },
      body: {
        ...bodyLowererAnnotationWith(
          fact.binding.type,
          PURE_EFFECTS,
          bodyLowererSpan(left),
        ),
        kind: "reference",
        target: binding.id,
      },
    };
    const absent: Arm = {
      pattern: fact.subject === "option"
        ? { kind: "none", span: span }
        : { kind: "literal", value: null, span: span },
      body: bodyLowererExpr(right),
    };
    return {
      ...bodyLowererAnnotation(node),
      kind: "match",
      subject: subject,
      arms: fact.subject === "option" ? [taken, absent] : [absent, taken],
    };
  }
  function bodyLowererMatch(node: NodeId): Expr {
    const kids = bodyLowererKids(node);
    const subject = bodyLowererExpr(
      bodyLowererRequired(kids[0], "the subject", node),
    );
    const arms: Arm[] = kids.slice(1)
      .filter((k) => kindOf(bodyLowererCtx.tree, k) === SyntaxKind.MatchArm)
      .map((arm) => {
        const parts = bodyLowererKids(arm);
        const patternNode = bodyLowererRequired(
          parts.find((k) => isPatternKind(kindOf(bodyLowererCtx.tree, k))),
          "the pattern",
          arm,
        );
        const bodyNode = parts.filter((k) => k !== patternNode).pop();
        return {
          pattern: bodyLowererPattern(patternNode),
          body: bodyLowererExpr(
            bodyLowererRequired(bodyNode, "the arm body", arm),
          ),
        };
      });
    return {
      ...bodyLowererAnnotation(node),
      kind: "match",
      subject: subject,
      arms: arms,
    };
  }
  function bodyLowererPattern(node: NodeId): Pattern {
    const fact = bodyLowererFactOf(node, "pattern");
    const pattern = fact.pattern;
    const span = bodyLowererSpan(node);
    const names = kidsOfKind(bodyLowererCtx.tree, node, SyntaxKind.Name);
    if (pattern.kind === "wildcard") {
      return { kind: "wildcard", span: span };
    }
    if (pattern.kind === "literal") {
      return { kind: "literal", value: pattern.value, span: span };
    }
    if (pattern.kind === "duration") {
      return { kind: "duration", millis: pattern.millis, span: span };
    }
    if (pattern.kind === "none") {
      return { kind: "none", span: span };
    }
    if (pattern.kind === "bind") {
      return {
        kind: "bind",
        binding: bodyLowererBindingOf(pattern.binding, names[0]),
        span: span,
      };
    }
    if (pattern.kind === "some") {
      return {
        kind: "some",
        binding: bodyLowererBindingOf(pattern.binding, names[1]),
        span: span,
      };
    }
    if (pattern.kind === "error") {
      return {
        kind: "error",
        error: pattern.error,
        binding: bodyLowererBindingOf(pattern.binding, names[1]),
        span: span,
      };
    }
    if (pattern.kind === "tagged") {
      return {
        kind: "nominal",
        nominal: pattern.tagged,
        binding: bodyLowererBindingOf(pattern.binding, names[1]),
        span: span,
      };
    }
    if (pattern.kind === "tag") {
      const spread =
        kidsOfKind(bodyLowererCtx.tree, node, SyntaxKind.SpreadPattern)[0];
      const spreadName = spread === undefined
        ? undefined
        : kidsOfKind(bodyLowererCtx.tree, spread, SyntaxKind.Name)[0];
      return {
        kind: "tag",
        field: pattern.field,
        value: pattern.value,
        binding: pattern.binding === null
          ? null
          : bodyLowererBindingOf(pattern.binding, spreadName),
        span: span,
      };
    }
    if (pattern.kind === "invalid") {
      return internal(`an invalid pattern at ${bodyLowererDescribe(node)}`);
    }
    return internal(`an unknown pattern at ${bodyLowererDescribe(node)}`);
  }
  function bodyLowererTryExpr(node: NodeId): Expr {
    const kids = bodyLowererKids(node);
    const bodyNode = bodyLowererRequired(
      kids.find((k) => kindOf(bodyLowererCtx.tree, k) === SyntaxKind.Block),
      "the protected block",
      node,
    );
    const catchNode = kids.find((k) =>
      kindOf(bodyLowererCtx.tree, k) === SyntaxKind.CatchClause
    );
    const finallyNode = kids.find((k) =>
      kindOf(bodyLowererCtx.tree, k) === SyntaxKind.FinallyClause
    );
    const body = bodyLowererExpr(bodyNode);
    const arms = catchNode === undefined
      ? []
      : kidsOfKind(bodyLowererCtx.tree, catchNode, SyntaxKind.Handler);
    function isDefect(h: NodeId): boolean {
      const fact = bodyLowererFact(h);
      return fact?.kind === "handler" &&
        typeof fact.defect === "boolean" && fact.defect;
    }
    const handlers: Handler[] = arms.filter((h) => !isDefect(h)).map((h) =>
      bodyLowererHandler(h)
    );
    const defectArm = arms.find(isDefect);
    const whole = bodyLowererAnnotation(node);
    const fact = finallyNode === undefined
      ? undefined
      : bodyLowererFact(finallyNode);
    if (finallyNode === undefined || fact?.kind !== "finalizer") {
      const caughtExpr: Expr = {
        ...whole,
        kind: "catch",
        body: body,
        handlers: handlers,
      };
      return defectArm === undefined
        ? caughtExpr
        : { ...caughtExpr, defect: bodyLowererDefectHandler(defectArm) };
    }
    // The catch node carries the effects of the protected part only.
    const protectedAnnotation = bodyLowererAnnotationWith(
      bodyLowererInfo(node).type,
      fact.protectedSet,
      whole.span,
    );
    const caughtProtected: Expr = {
      ...protectedAnnotation,
      kind: "catch",
      body: body,
      handlers: handlers,
    };
    let protectedPart: Expr = body;
    if (catchNode !== undefined) {
      protectedPart = defectArm === undefined ? caughtProtected : {
        ...caughtProtected,
        defect: bodyLowererDefectHandler(defectArm),
      };
    }
    return {
      ...whole,
      kind: "ensure",
      body: protectedPart,
      finalizer: bodyLowererFinalizer(finallyNode, fact.binding),
    };
  }
  function bodyLowererFinalizer(
    node: NodeId,
    binding: {
      id: LocalId | undefined;
      name: string;
      type: TypeRef;
    } | undefined,
  ): ClosureExpr {
    const block = bodyLowererRequired(
      bodyLowererKids(node).find((k) =>
        kindOf(bodyLowererCtx.tree, k) === SyntaxKind.Block
      ),
      "the finally block",
      node,
    );
    const name = kidsOfKind(bodyLowererCtx.tree, node, SyntaxKind.Name)[0];
    const info = bodyLowererInfo(node);
    const body = bodyLowererExpr(block);
    return {
      ...bodyLowererAnnotationWith(
        bodyLowererCtx.types.function({
          execution: info.mode,
          parameters: binding === undefined ? [] : [binding.type],
          result: info.type,
          failures: info.failures,
          requirements: info.requirements,
        }),
        PURE_EFFECTS,
        bodyLowererSpan(node),
      ),
      kind: "closure",
      parameters: binding === undefined ? [] : [
        bodyLowererParameter(
          binding.id,
          binding.name,
          binding.type,
          bodyLowererSpan(bodyLowererRequired(name, "the outcome name", node)),
        ),
      ],
      body: body,
    };
  }
  function bodyLowererDefectHandler(node: NodeId): DefectHandler {
    const fact = bodyLowererFactOf(node, "handler");
    const parts = bodyLowererKids(node);
    const bodyNode = parts.filter((k) =>
      kindOf(bodyLowererCtx.tree, k) !== SyntaxKind.Name
    ).pop();
    return {
      binding: bodyLowererBindingOf(
        fact.binding,
        parts.filter((k) =>
          kindOf(bodyLowererCtx.tree, k) === SyntaxKind.Name
        )[1],
      ),
      body: bodyLowererExpr(
        bodyLowererRequired(bodyNode, "the handler body", node),
      ),
      span: bodyLowererSpan(node),
    };
  }
  function bodyLowererHandler(node: NodeId): Handler {
    const fact = bodyLowererFactOf(node, "handler");
    const parts = bodyLowererKids(node);
    const nameNodes = parts.filter((k) =>
      kindOf(bodyLowererCtx.tree, k) === SyntaxKind.Name
    );
    const bodyNode = parts.filter((k) =>
      kindOf(bodyLowererCtx.tree, k) !== SyntaxKind.Name
    ).pop();
    return {
      error: bodyLowererRequired(fact.error, "the handled error", node),
      binding: bodyLowererBindingOf(fact.binding, nameNodes[1]),
      body: bodyLowererExpr(
        bodyLowererRequired(bodyNode, "the handler body", node),
      ),
      span: bodyLowererSpan(node),
    };
  }
  return { expr: bodyLowererExpr };
}
function targetId(target: Target | undefined): DeclarationId | undefined {
  if (target === undefined) return undefined;
  if (
    target.kind === "type" || target.kind === "error" ||
    target.kind === "service" || target.kind === "provider" ||
    target.kind === "value"
  ) {
    return target.id;
  }
  return undefined;
}
function lowerImports(
  checked: CheckedProject,
  info: ModuleInfo,
  resolution: ModuleResolution,
  module: string,
): Result<Import[], LowerError> {
  const imports: Import[] = [];
  for (const planned of planImports(info)) {
    const imported = planned.target === undefined
      ? undefined
      : checked.modules.get(planned.target);
    const iface = imported?.interface;
    if (
      planned.label === undefined || imported === undefined ||
      iface === undefined || !iface.ok
    ) {
      return {
        ok: false,
        error: {
          tag: "no-interface",
          module: module,
          imported: planned.imported,
        },
      };
    }
    const bindings: {
      name: string;
      target: DeclarationId;
    }[] = [];
    for (const name of planned.names) {
      const target = targetId(resolution.namespace.get(name)?.target);
      if (target === undefined) {
        return {
          ok: false,
          error: {
            tag: "internal",
            module: module,
            message: `the imported name ${name} has no target`,
          },
        };
      }
      bindings[bindings.length] = { name: name, target: target };
    }
    const payload = iface.value.payload;
    imports[imports.length] = {
      module: planned.label,
      bindings: bindings,
      exports: payload.exports,
      values: payload.values,
      types: payload.types,
      errors: payload.errors,
      services: payload.services,
    };
  }
  return { ok: true, value: imports };
}
/** The synthetic import of the closed prelude interface, or nothing when no builtin is used. */
function preludeImport(
  builtins: ReadonlyMap<ValueId, BuiltinInstance>,
): Import | undefined {
  if (builtins.size === 0) {
    return undefined;
  }
  const entries = [...builtins].sort((left, right) => {
    return compareText(left[0], right[0]);
  });
  return {
    module: PRELUDE_MODULE,
    bindings: [],
    exports: entries.map((entry) => {
      return entry[0];
    }),
    values: entries.map((entry) => {
      const id = entry[0];
      const builtin = entry[1];
      return ({
        id: id,
        name: shortName(id),
        type: builtin.type,
      });
    }),
    types: [],
    errors: [],
    services: [],
  };
}
function lowerDeclarations(
  checked: CheckedProject,
  module: CheckedModule,
  ctx: ModuleContext,
): Declaration[] {
  const found: {
    readonly start: number;
    readonly declaration: Declaration;
  }[] = [];
  const decls = module.declarations;
  for (const declaration of decls.types) {
    found[found.length] = {
      start: declaration.span.start,
      declaration: declaration,
    };
  }
  for (const declaration of decls.errors) {
    found[found.length] = {
      start: declaration.span.start,
      declaration: declaration,
    };
  }
  for (const declaration of decls.services) {
    found[found.length] = {
      start: declaration.span.start,
      declaration: declaration,
    };
  }
  for (const fn of module.functions.values()) {
    found[found.length] = {
      start: fn.signature.span.start,
      declaration: lowerFunction(checked, ctx, fn),
    };
  }
  for (const constant of module.constants.values()) {
    found[found.length] = {
      start: constant.signature.span.start,
      declaration: lowerConstant(ctx, constant),
    };
  }
  const ordered = found.sort((a, b) => a.start - b.start);
  return ordered.map((entry) => entry.declaration);
}
function lowerFunction(
  checked: CheckedProject,
  ctx: ModuleContext,
  fn: FunctionBody,
): Declaration {
  const signature = fn.signature;
  const lowerer = BodyLowerer(ctx, fn.table, signature.name);
  if (fn.bodyNode === undefined) {
    return internal(`the function ${signature.name} has no body`);
  }
  let type: FunctionType;
  if (signature.written.result) {
    // The written result keeps source order, which `toIrFunction` loses.
    const computed = solvedSignatureType(checked.table, signature, {
      mode: fn.mode,
      failures: fn.failures,
      requirements: fn.requirements,
    });
    if (!computed.ok) {
      return internal(`the function ${signature.name} has no computed mode`);
    }
    type = computed.value.ir;
  } else {
    type = functionTypeToIr(checked.table, fn.type);
  }
  const parameters: Parameter[] = signature.parameters.map((p) => {
    if (p.id === undefined) {
      return internal(`the parameter ${p.name} has no local identity`);
    }
    const parameter: Parameter = {
      id: p.id,
      name: p.name,
      type: p.type.ir,
      span: p.span,
    };
    return p.borrow ? { ...parameter, borrow: true } : parameter;
  });
  const checkedParameters = type.checked;
  const entryValidation = checkedParameters?.some(Boolean)
    ? parameters.filter((_parameter, index) => {
      const checked = checkedParameters[index];
      return typeof checked === "boolean" && checked;
    }).map((parameter) => parameter.id)
    : undefined;
  return {
    ...(entryValidation === undefined
      ? {}
      : { entryValidation: entryValidation }),
    kind: "function",
    id: signature.id,
    name: signature.name,
    parameters: parameters,
    type: type,
    written: signature.written,
    body: lowerer.expr(fn.bodyNode),
    span: signature.span,
  };
}
function lowerConstant(
  ctx: ModuleContext,
  constant: ConstantBody,
): Declaration {
  const signature = constant.signature;
  if (constant.initNode === undefined) {
    return internal(`the constant ${signature.name} has no initializer`);
  }
  const lowerer = BodyLowerer(ctx, constant.table, signature.name);
  return {
    kind: "constant",
    id: signature.id,
    name: signature.name,
    type: signature.type?.ir ?? typeToIr(ctx.types, constant.type),
    value: lowerer.expr(constant.initNode),
    span: signature.span,
  };
}
/**
 * Lowers one checked module to typed IR. A module that `checked.blocked` lists
 * has an error value. A `.effi` module lowers to its type, error, and service
 * declarations.
 */
export function lowerModule(
  checked: CheckedProject,
  module: ModuleName,
): LowerResult {
  const checkedModule = checked.modules.get(module);
  const info = checked.analysis.project.modules.get(module);
  const resolution = checked.analysis.resolutions.get(module);
  if (
    checkedModule === undefined || info === undefined ||
    resolution === undefined
  ) {
    return { ok: false, error: { tag: "unknown-module", module: module } };
  }
  const count = checked.blocked.get(module);
  if (count !== undefined) {
    return {
      ok: false,
      error: { tag: "diagnostics", module: module, count: count },
    };
  }
  const imports = lowerImports(checked, info, resolution, module);
  if (!imports.ok) {
    return imports;
  }
  const lexed = checkedModule.tree.lexed;
  let identifiers = emptySet<string>();
  for (const t of indices(lexed.count)) {
    if (lexed.kinds[t] === TokenKind.Ident) {
      identifiers = identifiers.add(
        lexed.text.slice(lexed.starts[t], lexed.ends[t]),
      );
    }
  }
  const ctx: ModuleContext = {
    module: module,
    tree: checkedModule.tree,
    types: checked.table,
    targets: resolution.targets,
    builtins: BuiltinInstances(),
    identifiers: identifiers,
  };
  const lowered = caught(() => lowerDeclarations(checked, checkedModule, ctx));
  if (!lowered.ok) {
    if (!isInvariantFailure(lowered.error, "lower")) {
      return rethrow(lowered.error);
    }
    return {
      ok: false,
      error: {
        tag: "internal",
        module: module,
        message: lowered.error.message,
      },
    };
  }
  const declarations = lowered.value;
  const prelude = preludeImport(ctx.builtins.values());
  return {
    ok: true,
    value: {
      format: "light-functional-ir",
      version: 10,
      module: module,
      sources: [checkedModule.path],
      imports: prelude === undefined
        ? imports.value
        : [...imports.value, prelude],
      declarations: declarations,
      // The companion module of a `.effi` file exports every declaration,
      // because the host module needs each one. Providers are not lowered.
      exports: exportRuleOf(info) === "every-declaration"
        ? sortedUnique(declarations.map((d) => d.id))
        : checkedModule.declarations.exports,
    },
  };
}
/**
 * Lowers every `.eff` and `.effi` module of the project, in topological order.
 * A module with an error value has no IR.
 */
export function lowerProject(
  checked: CheckedProject,
): LoweredProject {
  let results = emptyMap<string, LowerResult>();
  for (const name of checked.modules.keys()) {
    results = results.set(name, lowerModule(checked, name));
  }
  return results;
}

type LoweredProject = ReadonlyMap<string, LowerResult>;
