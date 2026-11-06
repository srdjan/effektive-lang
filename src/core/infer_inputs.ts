import type {
  FunctionSignature,
  ParameterSignature,
  TypeEnv,
} from "./signatures.ts";
import { TypeLowerer } from "./type_lower.ts";
import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import type { BodyEnv } from "./body_env.ts";
import type { LocalId } from "./ir.ts";
import {
  type CallableEvidence,
  InputContractResolver,
  type Origin,
} from "./infer_contracts.ts";
import { flattenMembers } from "./patterns.ts";
import type { Target } from "./resolve.ts";
import {
  arrowBody,
  initOf,
  isTypeKind,
  kidsOf,
  nameTextOf,
  operatorOf,
  unparen,
} from "./syntax_queries.ts";
import { kindOf, type NodeId, nodeSpan, SyntaxKind } from "./syntax.ts";
import { showType } from "./type_show.ts";
import { typeToIr } from "./type_ir.ts";
import type { TypeRef, TypeTable } from "./types.ts";

interface InputInference {
  readonly types: readonly TypeRef[];
  readonly diagnostics: readonly Diagnostic[];
}

interface RecordEvidence {
  readonly kind: "record";
  readonly fields: ReadonlyMap<string, ExpressionEvidence>;
}

type ExpressionEvidence = CallableEvidence | RecordEvidence;

/** Infers the body-driven types of one function's inferred parameters. */
export function inferFunctionInputs(
  benv: BodyEnv,
  signature: FunctionSignature,
  bodyNode: NodeId | undefined,
): InputInference {
  const roots = signature.parameters.map((parameter) => ({
    id: parameter.id,
    name: parameter.name,
    inferred: parameter.inferred,
    type: parameter.type.ref,
  }));
  return inferInputs(
    benv,
    roots,
    bodyNode,
    signature.result?.ref,
  );
}

/** Infers omitted arrow parameters before the ordinary body checker checks the arrow. */
export function inferArrowInputs(
  benv: BodyEnv,
  parameters: readonly {
    readonly id: LocalId | undefined;
    readonly name: string;
    readonly type: TypeRef;
    readonly inferred: boolean;
  }[],
  bodyNode: NodeId | undefined,
  result: TypeRef | undefined,
  outerLocals: ReadonlyMap<LocalId, TypeRef>,
): InputInference {
  return inferInputs(
    benv,
    parameters,
    bodyNode,
    result,
    outerLocals,
  );
}

function inferInputs(
  benv: BodyEnv,
  parameters: readonly {
    readonly id: LocalId | undefined;
    readonly name: string;
    readonly inferred: boolean;
    readonly type: TypeRef;
  }[],
  bodyNode: NodeId | undefined,
  result: TypeRef | undefined,
  outerLocals: ReadonlyMap<LocalId, TypeRef> = new Map(),
): InputInference {
  const engine = new InputEngine(benv, parameters, outerLocals);
  if (bodyNode !== undefined) engine.visit(bodyNode, result);
  return engine.finish(parameters);
}

class InputEngine {
  private readonly tree: TypeEnv["tree"];
  private readonly table: TypeTable;
  private readonly targets: TypeEnv["targets"];
  private readonly resolver: InputContractResolver;
  private readonly localTypes = new Map<LocalId, TypeRef>();
  private readonly expressionEvidence = new Map<NodeId, ExpressionEvidence>();
  private readonly localEvidence = new Map<LocalId, ExpressionEvidence>();
  private readonly lowerer: TypeLowerer;

  constructor(
    private readonly benv: BodyEnv,
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly name: string;
      readonly inferred: boolean;
      readonly type: TypeRef;
    }[],
    outerLocals: ReadonlyMap<LocalId, TypeRef>,
  ) {
    this.tree = benv.env.tree;
    this.table = benv.env.table;
    this.targets = benv.env.targets;
    this.lowerer = new TypeLowerer(benv.env, []);
    this.resolver = new InputContractResolver(
      this.table,
      parameters.flatMap((parameter) =>
        parameter.inferred && parameter.id !== undefined
          ? [{ id: parameter.id, name: parameter.name }]
          : []
      ),
    );
    for (const [id, type] of outerLocals) this.localTypes.set(id, type);
    for (const parameter of parameters) {
      if (parameter.id === undefined) continue;
      this.localTypes.set(parameter.id, parameter.type);
    }
  }

  finish(
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[],
  ): InputInference {
    const resolution = this.resolver.finish(parameters);
    const diagnostics = resolution.issues.map((issue) => {
      if (issue.kind === "unresolved-call") {
        return makeDiagnostic(
          "type-mismatch/011",
          `the parameter \`${issue.rootName}\` needs a type annotation because its callback type cannot be inferred`,
          nodeSpan(this.tree, issue.node),
        );
      }
      const texts = [
        ...new Set(
          issue.candidates.map((candidate) => showType(this.table, candidate)),
        ),
      ];
      return makeDiagnostic(
        "type-mismatch/014",
        `the inferred input \`${issue.rootName}\` has conflicting requirements at \`${
          [issue.rootName, ...issue.path].join(".")
        }\`: ${texts.join(" and ")}`,
        nodeSpan(this.tree, issue.node),
      );
    });
    return { types: resolution.types, diagnostics };
  }

  private originOf(node: NodeId): Origin | undefined {
    const kind = kindOf(this.tree, node);
    if (kind === SyntaxKind.ParenExpr) {
      const inner = kidsOf(this.tree, node)[0];
      return inner === undefined ? undefined : this.originOf(inner);
    }
    if (kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name) {
      const target = this.targets.get(node);
      return target?.kind === "local"
        ? this.resolver.origin(target.id)
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) return undefined;
    const kids = kidsOf(this.tree, node);
    const base = kids[0];
    const member = kids.find((child, index) =>
      index > 0 && kindOf(this.tree, child) === SyntaxKind.Name
    );
    const origin = base === undefined ? undefined : this.originOf(base);
    const name = member === undefined
      ? undefined
      : nameTextOf(this.tree, member);
    return origin === undefined || name === undefined
      ? undefined
      : { root: origin.root, path: [...origin.path, name] };
  }

  visit(node: NodeId, expected?: TypeRef): TypeRef | undefined {
    const origin = this.originOf(node);
    if (origin !== undefined) this.resolver.demand(origin, expected, node);
    switch (kindOf(this.tree, node)) {
      case SyntaxKind.NameExpr:
      case SyntaxKind.Name:
        return this.nameType(this.targets.get(node));
      case SyntaxKind.ParenExpr: {
        const inner = kidsOf(this.tree, node)[0];
        return inner === undefined ? undefined : this.visit(inner, expected);
      }
      case SyntaxKind.FieldExpr:
        return this.field(node, expected);
      case SyntaxKind.CallExpr:
        return this.call(node, expected);
      case SyntaxKind.PipeExpr:
        return this.pipe(node, expected);
      case SyntaxKind.BinaryExpr:
        return this.binary(node, expected);
      case SyntaxKind.Block:
        return this.block(node, expected);
      case SyntaxKind.IfExpr:
        return this.ifExpr(node, expected);
      case SyntaxKind.MatchExpr:
        return this.matchExpr(node, expected);
      case SyntaxKind.ArrowExpr:
        return this.arrow(node, expected);
      case SyntaxKind.RecordExpr:
        return this.record(node, expected);
      case SyntaxKind.ListExpr:
        return this.list(node, expected);
      case SyntaxKind.LiteralExpr:
        return undefined;
      default:
        for (const child of kidsOf(this.tree, node)) this.visit(child);
        return undefined;
    }
  }

  private nameType(target: Target | undefined): TypeRef | undefined {
    if (target?.kind === "local") return this.localTypes.get(target.id);
    if (target?.kind === "value" || target?.kind === "provider") {
      return this.benv.values(target.id);
    }
    if (target?.kind === "cap") return this.benv.methodType(target.id);
    return undefined;
  }

  private evidenceOf(node: NodeId): ExpressionEvidence | undefined {
    const recorded = this.expressionEvidence.get(node);
    if (recorded !== undefined) return recorded;
    const bare = unparen(this.tree, node);
    if (bare !== node) return this.evidenceOf(bare);
    const kind = kindOf(this.tree, node);
    if (
      kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name ||
      kind === SyntaxKind.QualifiedName
    ) {
      const target = this.targets.get(node);
      return target?.kind === "local"
        ? this.localEvidence.get(target.id)
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) return undefined;
    const parts = kidsOf(this.tree, node);
    const base = parts[0];
    const member = parts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.Name
    );
    const name = member === undefined
      ? undefined
      : nameTextOf(this.tree, member);
    const evidence = base === undefined ? undefined : this.evidenceOf(base);
    return evidence?.kind === "record" && name !== undefined
      ? evidence.fields.get(name)
      : undefined;
  }

  private callableEvidence(
    node: NodeId,
    type: TypeRef | undefined,
  ): CallableEvidence | undefined {
    const evidence = this.resolver.callableEvidence(type) ??
      this.evidenceOf(node);
    return evidence?.kind === "callable" ? evidence : undefined;
  }

  private optionElement(type: TypeRef | undefined): TypeRef | undefined {
    if (type === undefined) return undefined;
    const options = flattenMembers(this.table, type).map((member) =>
      this.table.node(member)
    ).filter((member) => member.kind === "option");
    const option = options.length === 1 ? options[0] : undefined;
    return option?.kind === "option" ? option.element : undefined;
  }

  private field(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const kids = kidsOf(this.tree, node);
    const base = kids[0];
    const member = kids.find((child, index) =>
      index > 0 && kindOf(this.tree, child) === SyntaxKind.Name
    );
    const name = member === undefined
      ? undefined
      : nameTextOf(this.tree, member);
    if (base === undefined || name === undefined) return expected;
    const baseType = this.visit(base);
    return this.resolver.fieldType(baseType, name) ?? expected;
  }

  private call(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const kids = kidsOf(this.tree, node);
    const callee = kids[0];
    const argList = kids.find((child) =>
      kindOf(this.tree, child) === SyntaxKind.ArgList
    );
    const args = argList === undefined ? [] : kidsOf(this.tree, argList);
    if (callee === undefined) return undefined;
    const target = this.targets.get(callee);
    let type: TypeRef | undefined;
    if (target?.kind === "type") {
      const record = this.table.taggedRecordOf(target.id);
      type = record ?? this.table.identityBaseOf(target.id);
      if (args[0] !== undefined) {
        const input = record === undefined &&
            this.table.predicateOf(target.id) !== undefined &&
            this.originOf(args[0]) !== undefined
          ? this.table.named(target.id)
          : type;
        this.visit(args[0], input);
      }
      args.slice(1).forEach((argument) => this.visit(argument));
      return this.table.named(target.id);
    }
    if (target?.kind === "error") {
      type = this.table.errorRecordOf(target.id);
      if (args[0] !== undefined) this.visit(args[0], type);
      args.slice(1).forEach((argument) => this.visit(argument));
      return this.table.named(target.id);
    }
    if (target?.kind === "builtin" && target.name === "Some") {
      const element = this.optionElement(expected);
      const inferred = args[0] === undefined
        ? undefined
        : this.visit(args[0], element);
      args.slice(1).forEach((argument) => this.visit(argument));
      return this.table.option(element ?? inferred ?? this.table.unknown);
    }
    const calleeType = target === undefined
      ? this.visit(callee)
      : this.nameType(target);
    const fn = this.callableEvidence(callee, calleeType);
    if (fn === undefined) {
      const origin = this.originOf(callee);
      if (origin !== undefined) {
        this.resolver.defer(origin, callee, (evidence) => {
          args.forEach((argument, index) =>
            this.visit(
              argument,
              evidence.checked?.[index]
                ? this.table.unknown
                : evidence.parameters[index],
            )
          );
        });
      }
      args.forEach((argument) => this.visit(argument));
      return undefined;
    }
    args.forEach((argument, index) =>
      this.visit(
        argument,
        fn.checked?.[index] ? this.table.unknown : fn.parameters[index],
      )
    );
    return fn.result;
  }

  private pipe(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const parts = kidsOf(this.tree, node);
    const left = parts[0];
    const stage = parts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.PipeStage
    );
    if (left === undefined || stage === undefined) return undefined;
    const stageParts = kidsOf(this.tree, stage);
    const callee = stageParts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.QualifiedName
    );
    const argList = stageParts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.ArgList
    );
    const args = argList === undefined ? [] : kidsOf(this.tree, argList);
    const target = callee === undefined ? undefined : this.targets.get(callee);
    if (target?.kind === "type") {
      const record = this.table.taggedRecordOf(target.id);
      const input = record === undefined &&
          this.table.predicateOf(target.id) !== undefined &&
          this.originOf(left) !== undefined
        ? this.table.named(target.id)
        : record ?? this.table.identityBaseOf(target.id);
      this.visit(left, input);
      args.forEach((argument) => this.visit(argument));
      return this.table.named(target.id);
    }
    if (target?.kind === "builtin" && target.name === "Some") {
      const element = this.optionElement(expected);
      const inferred = this.visit(left, element);
      args.forEach((argument) => this.visit(argument));
      return this.table.option(element ?? inferred ?? this.table.unknown);
    }
    const calleeType = this.nameType(target);
    const fn = callee === undefined
      ? undefined
      : this.callableEvidence(callee, calleeType);
    if (fn === undefined) {
      this.visit(left);
      args.forEach((argument) => this.visit(argument));
      return undefined;
    }
    this.visit(
      left,
      fn.checked?.[0] ? this.table.unknown : fn.parameters[0],
    );
    args.forEach((argument, index) =>
      this.visit(
        argument,
        fn.checked?.[index + 1] ? this.table.unknown : fn.parameters[index + 1],
      )
    );
    return fn.result;
  }

  private binary(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const operands = kidsOf(this.tree, node);
    const operator = operatorOf(this.tree, node);
    const contextual =
      operator !== undefined && ["+", "-", "*", "/"].includes(operator) &&
        this.resolver.isConcrete(expected)
        ? expected
        : undefined;
    operands.forEach((operand) => this.visit(operand, contextual));
    return expected;
  }

  private block(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const items = kidsOf(this.tree, node);
    let type: TypeRef | undefined;
    items.forEach((item, index) => {
      if (kindOf(this.tree, item) === SyntaxKind.ConstDecl) {
        this.binding(item);
        return;
      }
      type = this.visit(
        item,
        index === items.length - 1 ? expected : undefined,
      );
    });
    return type;
  }

  private binding(node: NodeId): void {
    const parts = kidsOf(this.tree, node);
    const nameNode = parts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.Name
    );
    const typeNode = parts.find((part) => isTypeKind(kindOf(this.tree, part)));
    const init = initOf(this.tree, node, nameNode);
    const target = nameNode === undefined
      ? undefined
      : this.targets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    const annotation = typeNode === undefined
      ? undefined
      : this.lowerer.lower(typeNode).ref;
    const inferred = init === undefined
      ? undefined
      : this.visit(init, annotation);
    const type = annotation ?? inferred;
    if (id === undefined) return;
    if (type !== undefined) this.localTypes.set(id, type);
    const evidence = this.resolver.callableEvidence(annotation) ??
      (init === undefined ? undefined : this.evidenceOf(init));
    if (evidence !== undefined) this.localEvidence.set(id, evidence);
    if (init !== undefined) {
      const origin = this.originOf(init);
      if (origin !== undefined) this.resolver.setOrigin(id, origin);
    }
  }

  private ifExpr(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const parts = kidsOf(this.tree, node);
    if (parts[0] !== undefined) this.visit(parts[0], this.table.boolean);
    let type: TypeRef | undefined;
    for (const branch of parts.slice(1)) {
      type = this.visit(branch, expected) ?? type;
    }
    return expected ?? type;
  }

  private matchExpr(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const parts = kidsOf(this.tree, node);
    const subject = parts.find((part) =>
      kindOf(this.tree, part) !== SyntaxKind.MatchArm
    );
    if (subject !== undefined) this.visit(subject);
    let type: TypeRef | undefined;
    for (
      const arm of parts.filter((part) =>
        kindOf(this.tree, part) === SyntaxKind.MatchArm
      )
    ) {
      const body = kidsOf(this.tree, arm).at(-1);
      if (body !== undefined) type = this.visit(body, expected) ?? type;
    }
    return expected ?? type;
  }

  private arrow(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const fn = this.resolver.callableEvidence(expected);
    const parts = kidsOf(this.tree, node);
    const paramList = parts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.ParamList
    );
    const params = paramList === undefined
      ? []
      : kidsOf(this.tree, paramList).filter((part) =>
        kindOf(this.tree, part) === SyntaxKind.Param
      );
    const parameterEvidence: (TypeRef | undefined)[] = [];
    params.forEach((param, index) => {
      const pieces = kidsOf(this.tree, param);
      const nameNode = pieces.find((piece) =>
        kindOf(this.tree, piece) === SyntaxKind.Name
      );
      const typeNode = pieces.find((piece) => piece !== nameNode);
      const target = nameNode === undefined
        ? undefined
        : this.targets.get(nameNode);
      const id = target?.kind === "local" ? target.id : undefined;
      const type = typeNode === undefined
        ? fn?.parameters[index] ?? this.table.unknown
        : this.lowerer.lower(typeNode).ref;
      parameterEvidence.push(
        typeNode === undefined ? fn?.parameters[index] : type,
      );
      if (id !== undefined) this.localTypes.set(id, type);
    });
    const resultNode = parts.find((part) =>
      isTypeKind(kindOf(this.tree, part))
    );
    const result = resultNode === undefined
      ? fn?.result
      : this.lowerer.lower(resultNode).ref;
    this.expressionEvidence.set(node, {
      kind: "callable",
      parameters: parameterEvidence,
      result,
      checked: fn?.checked,
    });
    const body = arrowBody(this.tree, node);
    if (body !== undefined) this.visit(body, result);
    return expected;
  }

  private record(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = this.resolver.isConcrete(expected)
      ? this.table.node(this.table.unfold(expected))
      : undefined;
    const evidence = new Map<string, ExpressionEvidence>();
    for (const field of kidsOf(this.tree, node)) {
      const pieces = kidsOf(this.tree, field);
      const labelNode = pieces.find((piece) =>
        kindOf(this.tree, piece) === SyntaxKind.Name
      );
      const label = labelNode === undefined
        ? undefined
        : nameTextOf(this.tree, labelNode);
      const value = pieces.at(-1);
      if (value === undefined) continue;
      const fieldType = target?.kind === "record" && label !== undefined
        ? target.fields.find((entry) => entry.name === label)?.type
        : undefined;
      const valueType = this.visit(value, fieldType);
      const fieldEvidence = this.resolver.callableEvidence(
        fieldType ?? valueType,
      ) ??
        this.evidenceOf(value);
      if (label !== undefined && fieldEvidence !== undefined) {
        evidence.set(label, fieldEvidence);
      }
    }
    if (evidence.size > 0) {
      this.expressionEvidence.set(node, { kind: "record", fields: evidence });
    }
    return expected;
  }

  private list(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = this.resolver.isConcrete(expected)
      ? this.table.node(this.table.unfold(expected))
      : undefined;
    kidsOf(this.tree, node).forEach((element, index) => {
      const elementType = target?.kind === "array"
        ? target.element
        : target?.kind === "tuple"
        ? target.elements[index]
        : undefined;
      this.visit(element, elementType);
    });
    return expected;
  }
}

/** Returns a signature copy with finalized inferred parameter contracts. */
export function withInferredInputs(
  signature: FunctionSignature,
  inference: InputInference,
  table: TypeTable,
): FunctionSignature {
  return {
    ...signature,
    parameters: signature.parameters.map(
      (parameter, index): ParameterSignature => {
        const ref = inference.types[index] ?? parameter.type.ref;
        return parameter.inferred && parameter.type.ref !== ref
          ? { ...parameter, type: { ref, ir: typeToIr(table, ref) } }
          : parameter;
      },
    ),
  };
}
