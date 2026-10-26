import type {
  FunctionSignature,
  ParameterSignature,
  TypeEnv,
} from "./signatures.ts";
import { TypeLowerer } from "./type_lower.ts";
import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import type { BodyEnv } from "./check_expr.ts";
import { isErrorId } from "./ids.ts";
import type { LocalId } from "./ir.ts";
import { flattenMembers } from "./patterns.ts";
import type { Target } from "./resolve.ts";
import {
  arrowBody,
  initOf,
  isTypeKind,
  kidsOf,
  nameTextOf,
  operatorOf,
} from "./syntax_queries.ts";
import { kindOf, type NodeId, nodeSpan, SyntaxKind } from "./syntax.ts";
import { showType } from "./type_show.ts";
import { typeToIr } from "./type_ir.ts";
import type { TypeRef, TypeTable } from "./types.ts";

interface Root {
  readonly id: LocalId;
  readonly name: string;
}

interface Origin {
  readonly root: Root;
  readonly path: readonly string[];
}

interface Demand {
  readonly path: readonly string[];
  readonly type: TypeRef;
  readonly node: NodeId;
}

interface DemandNode {
  readonly direct: Demand[];
  readonly fields: Map<string, DemandNode>;
}

interface InputInference {
  readonly types: readonly TypeRef[];
  readonly diagnostics: readonly Diagnostic[];
}

function emptyDemandNode(): DemandNode {
  return { direct: [], fields: new Map() };
}

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
  private readonly origins = new Map<LocalId, Origin>();
  private readonly localTypes = new Map<LocalId, TypeRef>();
  private readonly demands = new Map<LocalId, Demand[]>();
  private readonly unresolvedCallbacks = new Map<LocalId, NodeId[]>();
  private readonly diagnostics: Diagnostic[] = [];
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
    for (const [id, type] of outerLocals) this.localTypes.set(id, type);
    for (const parameter of parameters) {
      if (parameter.id === undefined) continue;
      this.localTypes.set(parameter.id, parameter.type);
      if (parameter.inferred) {
        this.origins.set(parameter.id, {
          root: {
            id: parameter.id,
            name: parameter.name,
          },
          path: [],
        });
      }
    }
  }

  finish(
    parameters: readonly {
      readonly id: LocalId | undefined;
      readonly type: TypeRef;
      readonly inferred: boolean;
    }[],
  ): InputInference {
    const types = parameters.map((parameter) => {
      if (!parameter.inferred || parameter.id === undefined) {
        return parameter.type;
      }
      const root = this.origins.get(parameter.id)?.root;
      const bodyDemands = this.demands.get(parameter.id) ?? [];
      const demands =
        parameter.type !== this.table.unknown && bodyDemands.length > 0
          ? [
            { path: [], type: parameter.type, node: bodyDemands[0].node },
            ...bodyDemands,
          ]
          : bodyDemands;
      for (const node of this.unresolvedCallbacks.get(parameter.id) ?? []) {
        this.diagnostics.push(makeDiagnostic(
          "type-mismatch/011",
          `the parameter \`${
            root?.name ?? "input"
          }\` needs a type annotation because its callback type cannot be inferred`,
          nodeSpan(this.tree, node),
        ));
      }
      if (root === undefined || demands.length === 0) {
        return parameter.type;
      }
      const demandTree = emptyDemandNode();
      for (const demand of demands) this.insert(demandTree, demand, 0);
      return this.resolve(root, demandTree, []);
    });
    return { types, diagnostics: this.diagnostics };
  }

  private insert(tree: DemandNode, demand: Demand, depth: number): void {
    const field = demand.path[depth];
    if (field === undefined) {
      tree.direct.push(demand);
      return;
    }
    let child = tree.fields.get(field);
    if (child === undefined) {
      child = emptyDemandNode();
      tree.fields.set(field, child);
    }
    this.insert(child, demand, depth + 1);
  }

  private resolve(
    root: Root,
    tree: DemandNode,
    path: readonly string[],
  ): TypeRef {
    let fields: TypeRef | undefined;
    if (tree.fields.size > 0) {
      fields = this.table.record([...tree.fields].map(([name, child]) => ({
        name,
        type: this.resolve(root, child, [...path, name]),
        optional: false,
      })));
    }
    let candidates = [...tree.direct.map((demand) => demand.type)];
    if (
      fields !== undefined ||
      candidates.some((candidate) => candidate !== this.table.unknown)
    ) {
      candidates = candidates.filter((candidate) =>
        candidate !== this.table.unknown
      );
    }
    if (
      fields !== undefined &&
      (candidates.length === 0 ||
        !this.satisfiesFields(candidates[0], tree.fields))
    ) {
      candidates.push(fields);
    }
    const chosen = candidates[0] ?? this.table.unknown;
    const canonical = this.table.unfoldTransparent(chosen);
    if (
      candidates.some((candidate) =>
        this.table.unfoldTransparent(candidate) !== canonical
      )
    ) {
      const uses = this.leafDemands(tree);
      const texts = [
        ...new Set(
          candidates.map((candidate) => showType(this.table, candidate)),
        ),
      ];
      for (const use of uses) {
        this.diagnostics.push(makeDiagnostic(
          "type-mismatch/014",
          `the inferred input \`${root.name}\` has conflicting requirements at \`${
            [root.name, ...path].join(".")
          }\`: ${texts.join(" and ")}`,
          nodeSpan(this.tree, use.node),
        ));
      }
    }
    return chosen;
  }

  private satisfiesFields(
    type: TypeRef,
    requirements: ReadonlyMap<string, DemandNode>,
  ): boolean {
    const shape = this.table.node(this.table.unfold(type));
    if (shape.kind === "union") {
      return shape.members.every((member) =>
        this.satisfiesFields(member, requirements)
      );
    }
    const fields = this.recordFields(type);
    if (fields === undefined) return false;
    for (const [name, requirement] of requirements) {
      const field = fields.find((candidate) => candidate.name === name);
      if (field === undefined) return false;
      const direct = requirement.direct.map((demand) => demand.type).filter(
        (candidate) => candidate !== this.table.unknown,
      );
      if (
        direct.some((candidate) =>
          this.table.unfoldTransparent(candidate) !==
            this.table.unfoldTransparent(field.type)
        )
      ) return false;
      if (
        requirement.fields.size > 0 &&
        !this.satisfiesFields(field.type, requirement.fields)
      ) return false;
    }
    return true;
  }

  private recordFields(type: TypeRef) {
    let node = this.table.node(this.table.unfold(type));
    if (node.kind === "named") {
      const record = isErrorId(node.id)
        ? this.table.errorRecordOf(node.id)
        : this.table.dataRecordOf(node.id) ?? this.table.brandBaseOf(node.id);
      if (record === undefined) return undefined;
      node = this.table.node(this.table.unfold(record));
    }
    return node.kind === "record" ? node.fields : undefined;
  }

  private leafDemands(tree: DemandNode): Demand[] {
    return [
      ...tree.direct,
      ...[...tree.fields.values()].flatMap((child) => this.leafDemands(child)),
    ];
  }

  private concrete(type: TypeRef | undefined): type is TypeRef {
    if (type === undefined || type === this.table.unknown) return false;
    return this.table.node(type).kind !== "error";
  }

  private demand(
    origin: Origin | undefined,
    type: TypeRef | undefined,
    node: NodeId,
  ): void {
    if (
      origin === undefined ||
      (!this.concrete(type) && origin.path.length === 0)
    ) return;
    const list = this.demands.get(origin.root.id) ?? [];
    list.push({
      path: origin.path,
      type: this.concrete(type) ? type : this.table.unknown,
      node,
    });
    this.demands.set(origin.root.id, list);
  }

  private originOf(node: NodeId): Origin | undefined {
    const kind = kindOf(this.tree, node);
    if (kind === SyntaxKind.ParenExpr) {
      const inner = kidsOf(this.tree, node)[0];
      return inner === undefined ? undefined : this.originOf(inner);
    }
    if (kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name) {
      const target = this.targets.get(node);
      return target?.kind === "local" ? this.origins.get(target.id) : undefined;
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
    if (origin !== undefined) this.demand(origin, expected, node);
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

  private functionOf(type: TypeRef | undefined) {
    if (type === undefined) return undefined;
    const node = this.table.node(this.table.unfold(type));
    return node.kind === "function" ? node : undefined;
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
    return this.fieldType(baseType, name) ?? expected;
  }

  private fieldType(
    type: TypeRef | undefined,
    name: string,
  ): TypeRef | undefined {
    if (!this.concrete(type)) return undefined;
    return this.recordFields(type)?.find((field) => field.name === name)?.type;
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
      const record = this.table.dataRecordOf(target.id);
      type = record ?? this.table.brandBaseOf(target.id);
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
    const fn = this.functionOf(calleeType);
    if (fn === undefined) {
      const origin = this.originOf(callee);
      if (origin !== undefined) {
        const uses = this.unresolvedCallbacks.get(origin.root.id) ?? [];
        uses.push(callee);
        this.unresolvedCallbacks.set(origin.root.id, uses);
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
      const record = this.table.dataRecordOf(target.id);
      const input = record === undefined &&
          this.table.predicateOf(target.id) !== undefined &&
          this.originOf(left) !== undefined
        ? this.table.named(target.id)
        : record ?? this.table.brandBaseOf(target.id);
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
    const fn = this.functionOf(this.nameType(target));
    if (fn === undefined) {
      this.visit(left);
      args.forEach((argument) => this.visit(argument));
      return undefined;
    }
    this.visit(left, fn.checked?.[0] ? this.table.unknown : fn.parameters[0]);
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
        this.concrete(expected)
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
    if (init !== undefined) {
      const origin = this.originOf(init);
      if (origin !== undefined) this.origins.set(id, origin);
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
    const fn = this.functionOf(expected);
    const parts = kidsOf(this.tree, node);
    const paramList = parts.find((part) =>
      kindOf(this.tree, part) === SyntaxKind.ParamList
    );
    const params = paramList === undefined
      ? []
      : kidsOf(this.tree, paramList).filter((part) =>
        kindOf(this.tree, part) === SyntaxKind.Param
      );
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
      if (id !== undefined) this.localTypes.set(id, type);
    });
    const resultNode = parts.find((part) =>
      isTypeKind(kindOf(this.tree, part))
    );
    const result = resultNode === undefined
      ? fn?.result
      : this.lowerer.lower(resultNode).ref;
    const body = arrowBody(this.tree, node);
    if (body !== undefined) this.visit(body, result);
    return expected;
  }

  private record(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = this.concrete(expected)
      ? this.table.node(this.table.unfold(expected))
      : undefined;
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
      this.visit(value, fieldType);
    }
    return expected;
  }

  private list(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = this.concrete(expected)
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
