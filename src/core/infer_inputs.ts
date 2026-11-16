import { emptyMap, setFrom } from "./runtime.ts";
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
import { optionConstructorOf, type Target } from "./resolve.ts";
import {
  argNodes,
  arrowBody,
  functionParts,
  initOf,
  isArithmeticOperator,
  isTypeKind,
  kidsOf,
  memberAccessParts,
  nameTextOf,
  operatorOf,
  paramNodes,
  paramParts,
  pipeParts,
  stageParts,
  unaryOperatorOf,
  unparen,
} from "./syntax_queries.ts";
import { kindOf, type NodeId, nodeSpan, SyntaxKind } from "./syntax.ts";
import { showType } from "./type_show.ts";
import { typeToIr } from "./type_ir.ts";
import type { TypeRef, TypeTable } from "./types.ts";
type InputInference = {
  readonly types: readonly TypeRef[];
  readonly diagnostics: readonly Diagnostic[];
};
type RecordEvidence = {
  readonly kind: "record";
  readonly fields: ReadonlyMap<string, ExpressionEvidence>;
};
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
  return inferArrowInputs(
    benv,
    roots,
    bodyNode,
    signature.result?.ref,
    undefined,
  );
}
type InputParameter = {
  readonly id: LocalId | undefined;
  readonly name: string;
  readonly inferred: boolean;
  readonly type: TypeRef;
};
/** Infers omitted arrow parameters before the ordinary body checker checks the arrow. */
export function inferArrowInputs(
  benv: BodyEnv,
  parameters: readonly InputParameter[],
  bodyNode: NodeId | undefined,
  result: TypeRef | undefined,
  outerLocals: ReadonlyMap<LocalId, TypeRef> | undefined,
): InputInference {
  let engine = InputEngine(benv, parameters, outerLocals);
  if (bodyNode !== undefined) {
    engine = engine.visit(bodyNode, result);
  }
  return engine.finish();
}
type InputEngine = {
  readonly finish: () => InputInference;
  readonly visit: (
    node: NodeId,
    expected: TypeRef | undefined,
  ) => InputEngine;
};
type InputEngineResult = {
  readonly engine: InputEngine;
  readonly type: TypeRef | undefined;
};
function InputEngine(
  benv: BodyEnv,
  parameters: readonly InputParameter[],
  outerLocals: ReadonlyMap<LocalId, TypeRef> | undefined,
): InputEngine {
  let inputEngineSelf: InputEngine;
  const inputEngineParameters = parameters;
  const inputEngineBenv = benv;
  const inputEngineTree: TypeEnv["tree"] = benv.env.tree;
  const inputEngineTable: TypeTable = benv.env.table;
  const inputEngineTargets: TypeEnv["targets"] = benv.env.targets;
  let inputEngineResolver: InputContractResolver;
  let inputEngineLocalTypes = emptyMap<LocalId, TypeRef>();
  let inputEngineExpressionEvidence = emptyMap<NodeId, ExpressionEvidence>();
  let inputEngineLocalEvidence = emptyMap<LocalId, ExpressionEvidence>();
  const inputEngineLowerer: TypeLowerer = TypeLowerer(benv.env, []);
  inputEngineResolver = InputContractResolver(
    inputEngineTable,
    parameters.flatMap((parameter) =>
      parameter.inferred && parameter.id !== undefined
        ? [{ id: parameter.id, name: parameter.name }]
        : []
    ),
  );
  for (const binding1 of outerLocals ?? emptyMap()) {
    const binding2 = binding1;
    const id = binding2[0];
    const type = binding2[1];
    inputEngineLocalTypes = inputEngineLocalTypes.set(id, type);
  }
  for (const parameter of parameters) {
    if (parameter.id === undefined) {
      continue;
    }
    inputEngineLocalTypes = inputEngineLocalTypes.set(
      parameter.id,
      parameter.type,
    );
  }
  function inputEngineFinish(): InputInference {
    const resolution = inputEngineResolver.finish(inputEngineParameters);
    const diagnostics = resolution.issues.map((issue) => {
      if (issue.kind === "unresolved-call") {
        return makeDiagnostic(
          "type-mismatch/011",
          `the parameter \`${issue.rootName}\` needs a type annotation because its callback type cannot be inferred`,
          nodeSpan(inputEngineTree, issue.node),
        );
      }
      const texts = [
        ...setFrom(
          issue.candidates.map((candidate) =>
            showType(inputEngineTable, candidate)
          ),
        ),
      ];
      return makeDiagnostic(
        "type-mismatch/014",
        `the inferred input \`${issue.rootName}\` has conflicting requirements at \`${
          [issue.rootName, ...issue.path].join(".")
        }\`: ${texts.join(" and ")}`,
        nodeSpan(inputEngineTree, issue.node),
      );
    });
    return { types: resolution.types, diagnostics: diagnostics };
  }
  function inputEngineOriginOf(node: NodeId): Origin | undefined {
    const kind = kindOf(inputEngineTree, node);
    if (kind === SyntaxKind.ParenExpr) {
      const inner = kidsOf(inputEngineTree, node)[0];
      return inner === undefined ? undefined : inputEngineOriginOf(inner);
    }
    if (
      kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name ||
      kind === SyntaxKind.QualifiedName
    ) {
      const target = inputEngineTargets.get(node);
      return target?.kind === "local"
        ? inputEngineResolver.origin(target.id)
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) {
      return undefined;
    }
    const binding3 = memberAccessParts(inputEngineTree, node);
    const base = binding3.base;
    const member = binding3.member;
    const origin = base === undefined ? undefined : inputEngineOriginOf(base);
    const name = member === undefined
      ? undefined
      : nameTextOf(inputEngineTree, member);
    return origin === undefined || name === undefined
      ? undefined
      : { root: origin.root, path: [...origin.path, name] };
  }
  function inputEngineVisit(
    node: NodeId,
    expected: TypeRef | undefined,
  ): InputEngine {
    return inputEngineInfer(node, expected).engine;
  }
  function inputEngineInfer(
    node: NodeId,
    expected: TypeRef | undefined,
  ): InputEngineResult {
    const origin = inputEngineOriginOf(node);
    if (origin !== undefined) {
      inputEngineResolver = inputEngineResolver.demand(origin, expected, node);
    }
    let type: TypeRef | undefined;
    {
      const kind_1 = kindOf(inputEngineTree, node);
      if (kind_1 === SyntaxKind.NameExpr || kind_1 === SyntaxKind.Name) {
        type = inputEngineNameType(inputEngineTargets.get(node));
      } else if (kind_1 === SyntaxKind.ParenExpr) {
        const inner = kidsOf(inputEngineTree, node)[0];
        type = inner === undefined
          ? undefined
          : inputEngineInfer(inner, expected).type;
      } else if (kind_1 === SyntaxKind.FieldExpr) {
        type = inputEngineField(node, expected);
      } else if (kind_1 === SyntaxKind.CallExpr) {
        type = inputEngineCall(node, expected);
      } else if (kind_1 === SyntaxKind.PipeExpr) {
        type = inputEnginePipe(node, expected);
      } else if (kind_1 === SyntaxKind.BinaryExpr) {
        type = inputEngineBinary(node, expected);
      } else if (kind_1 === SyntaxKind.UnaryExpr) {
        type = inputEngineUnary(node, expected);
      } else if (kind_1 === SyntaxKind.Block) {
        type = inputEngineBlock(node, expected);
      } else if (kind_1 === SyntaxKind.IfExpr) {
        type = inputEngineIfExpr(node, expected);
      } else if (kind_1 === SyntaxKind.MatchExpr) {
        type = inputEngineMatchExpr(node, expected);
      } else if (kind_1 === SyntaxKind.ArrowExpr) {
        type = inputEngineArrow(node, expected);
      } else if (kind_1 === SyntaxKind.RecordExpr) {
        type = inputEngineRecord(node, expected);
      } else if (kind_1 === SyntaxKind.ListExpr) {
        type = inputEngineList(node, expected);
      } else if (kind_1 === SyntaxKind.LiteralExpr) {
        type = undefined;
      } else {
        for (const child of kidsOf(inputEngineTree, node)) {
          inputEngineSelf = inputEngineVisit(child, undefined);
        }
        type = undefined;
      }
    }
    return { engine: inputEngineSelf, type: type };
  }
  function inputEngineNameType(
    target: Target | undefined,
  ): TypeRef | undefined {
    if (target?.kind === "local") {
      return inputEngineLocalTypes.get(target.id);
    }
    if (target?.kind === "value" || target?.kind === "provider") {
      return inputEngineBenv.values(target.id);
    }
    if (target?.kind === "cap") {
      return inputEngineBenv.methodType(target.id);
    }
    return undefined;
  }
  function inputEngineEvidenceOf(node: NodeId): ExpressionEvidence | undefined {
    const recorded = inputEngineExpressionEvidence.get(node);
    if (recorded !== undefined) {
      return recorded;
    }
    const bare = unparen(inputEngineTree, node);
    if (bare !== node) {
      return inputEngineEvidenceOf(bare);
    }
    const kind = kindOf(inputEngineTree, node);
    if (
      kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name ||
      kind === SyntaxKind.QualifiedName
    ) {
      const target = inputEngineTargets.get(node);
      return target?.kind === "local"
        ? inputEngineLocalEvidence.get(target.id)
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) {
      return undefined;
    }
    const binding4 = memberAccessParts(inputEngineTree, node);
    const base = binding4.base;
    const member = binding4.member;
    const name = member === undefined
      ? undefined
      : nameTextOf(inputEngineTree, member);
    const evidence = base === undefined
      ? undefined
      : inputEngineEvidenceOf(base);
    return evidence?.kind === "record" && name !== undefined
      ? evidence.fields.get(name)
      : undefined;
  }
  function inputEngineCallableEvidence(
    node: NodeId,
    type: TypeRef | undefined,
  ): CallableEvidence | undefined {
    const evidence = inputEngineResolver.callableEvidence(type) ??
      inputEngineEvidenceOf(node);
    return evidence?.kind === "callable" ? evidence : undefined;
  }
  function inputEngineField(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const binding5 = memberAccessParts(inputEngineTree, node);
    const base = binding5.base;
    const member = binding5.member;
    const name = member === undefined
      ? undefined
      : nameTextOf(inputEngineTree, member);
    if (base === undefined || name === undefined) {
      return expected;
    }
    const baseType = inputEngineInfer(base, undefined).type;
    return inputEngineResolver.fieldType(baseType, name) ?? expected;
  }
  function inputEngineExpectedArgument(
    fn: CallableEvidence,
    index: number,
  ): TypeRef | undefined {
    return fn.checked !== undefined && fn.checked[index]
      ? inputEngineTable.unknown
      : fn.parameters[index];
  }
  function inputEngineConstructorInput(
    id: Extract<Target, {
      kind: "type";
    }>["id"],
    argument: NodeId,
  ): TypeRef | undefined {
    const record = inputEngineTable.taggedRecordOf(id);
    return record === undefined &&
        inputEngineTable.predicateOf(id) !== undefined &&
        inputEngineOriginOf(argument) !== undefined
      ? inputEngineTable.named(id)
      : record ?? inputEngineTable.identityBaseOf(id);
  }
  function inputEngineCall(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const callee = kidsOf(inputEngineTree, node)[0];
    const args = argNodes(inputEngineTree, node);
    if (callee === undefined) {
      return undefined;
    }
    const target = inputEngineTargets.get(callee);
    if (target?.kind === "type") {
      if (args[0] !== undefined) {
        inputEngineSelf = inputEngineVisit(
          args[0],
          inputEngineConstructorInput(target.id, args[0]),
        );
      }
      for (const argument of args.slice(1)) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.named(target.id);
    }
    if (target?.kind === "error") {
      const type = inputEngineTable.errorRecordOf(target.id);
      if (args[0] !== undefined) {
        inputEngineSelf = inputEngineVisit(args[0], type);
      }
      for (const argument of args.slice(1)) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.named(target.id);
    }
    if (optionConstructorOf(target) === "some") {
      const element = inputEngineTable.optionElementOf(expected);
      const inferred = args[0] === undefined
        ? undefined
        : inputEngineInfer(args[0], element).type;
      for (const argument of args.slice(1)) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.option(
        element ?? inferred ?? inputEngineTable.unknown,
      );
    }
    const calleeType = target === undefined
      ? inputEngineInfer(callee, undefined).type
      : inputEngineNameType(target);
    const fn = inputEngineCallableEvidence(callee, calleeType);
    if (fn === undefined) {
      const origin = inputEngineOriginOf(callee);
      if (origin !== undefined) {
        inputEngineResolver = inputEngineResolver.defer(
          origin,
          callee,
          (evidence) => {
            for (const index of args.keys()) {
              const argument = args[index];
              if (argument === undefined) {
                continue;
              }
              inputEngineSelf = inputEngineVisit(
                argument,
                inputEngineExpectedArgument(evidence, index),
              );
            }
            return true;
          },
        );
      }
      for (const argument of args) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return undefined;
    }
    for (const index of args.keys()) {
      const argument = args[index];
      if (argument === undefined) {
        continue;
      }
      inputEngineSelf = inputEngineVisit(
        argument,
        inputEngineExpectedArgument(fn, index),
      );
    }
    return fn.result;
  }
  function inputEnginePipe(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const binding6 = pipeParts(inputEngineTree, node);
    const left = binding6.left;
    const stage = binding6.stage;
    if (left === undefined || stage === undefined) {
      return undefined;
    }
    const binding7 = stageParts(inputEngineTree, stage);
    const callee = binding7.callee;
    const args = binding7.args;
    const target = callee === undefined
      ? undefined
      : inputEngineTargets.get(callee);
    if (target?.kind === "type") {
      inputEngineSelf = inputEngineVisit(
        left,
        inputEngineConstructorInput(target.id, left),
      );
      for (const argument of args) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.named(target.id);
    }
    if (target?.kind === "error") {
      inputEngineSelf = inputEngineVisit(
        left,
        inputEngineTable.errorRecordOf(target.id),
      );
      for (const argument of args) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.named(target.id);
    }
    if (optionConstructorOf(target) === "some") {
      const element = inputEngineTable.optionElementOf(expected);
      const inferred = inputEngineInfer(left, element).type;
      for (const argument of args) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return inputEngineTable.option(
        element ?? inferred ?? inputEngineTable.unknown,
      );
    }
    const calleeType = inputEngineNameType(target);
    const fn = callee === undefined
      ? undefined
      : inputEngineCallableEvidence(callee, calleeType);
    if (fn === undefined) {
      const origin = callee === undefined
        ? undefined
        : inputEngineOriginOf(callee);
      if (callee !== undefined && origin !== undefined) {
        inputEngineResolver = inputEngineResolver.defer(
          origin,
          callee,
          (evidence) => {
            const argumentsWithLeft = [left, ...args];
            for (const index of argumentsWithLeft.keys()) {
              const argument = argumentsWithLeft[index];
              if (argument === undefined) {
                continue;
              }
              inputEngineSelf = inputEngineVisit(
                argument,
                inputEngineExpectedArgument(evidence, index),
              );
            }
            return true;
          },
        );
      }
      inputEngineSelf = inputEngineVisit(left, undefined);
      for (const argument of args) {
        inputEngineSelf = inputEngineVisit(argument, undefined);
      }
      return undefined;
    }
    inputEngineSelf = inputEngineVisit(
      left,
      inputEngineExpectedArgument(fn, 0),
    );
    for (const index of args.keys()) {
      const argument = args[index];
      if (argument === undefined) {
        continue;
      }
      inputEngineSelf = inputEngineVisit(
        argument,
        inputEngineExpectedArgument(fn, index + 1),
      );
    }
    return fn.result;
  }
  function inputEngineBinary(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const operands = kidsOf(inputEngineTree, node);
    const operator = operatorOf(inputEngineTree, node);
    const contextual =
      isArithmeticOperator(operator) && inputEngineResolver.isConcrete(expected)
        ? expected
        : undefined;
    for (const operand of operands) {
      inputEngineSelf = inputEngineVisit(operand, contextual);
    }
    return expected;
  }
  function inputEngineUnary(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const contextual =
      unaryOperatorOf(inputEngineTree, node)?.operator === "-" &&
        inputEngineResolver.isConcrete(expected)
        ? expected
        : undefined;
    for (const operand of kidsOf(inputEngineTree, node)) {
      inputEngineSelf = inputEngineVisit(operand, contextual);
    }
    return expected;
  }
  function inputEngineBlock(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const items = kidsOf(inputEngineTree, node);
    let type: TypeRef | undefined;
    for (const index of items.keys()) {
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      if (kindOf(inputEngineTree, item) === SyntaxKind.ConstDecl) {
        inputEngineSelf = inputEngineBinding(item);
        continue;
      }
      type = inputEngineInfer(
        item,
        index === items.length - 1 ? expected : undefined,
      ).type;
    }
    return type;
  }
  function inputEngineBinding(node: NodeId): InputEngine {
    const parts = kidsOf(inputEngineTree, node);
    const nameNode = parts.find((part) =>
      kindOf(inputEngineTree, part) === SyntaxKind.Name
    );
    const typeNode = parts.find((part) =>
      isTypeKind(kindOf(inputEngineTree, part))
    );
    const init = initOf(inputEngineTree, node, nameNode);
    const target = nameNode === undefined
      ? undefined
      : inputEngineTargets.get(nameNode);
    const id = target?.kind === "local" ? target.id : undefined;
    const annotation = typeNode === undefined
      ? undefined
      : inputEngineLowerer.lower(typeNode).ref;
    const inferred = init === undefined
      ? undefined
      : inputEngineInfer(init, annotation).type;
    const type = annotation ?? inferred;
    if (id === undefined) {
      return inputEngineSelf;
    }
    if (type !== undefined) {
      inputEngineLocalTypes = inputEngineLocalTypes.set(id, type);
    }
    const evidence = inputEngineResolver.callableEvidence(annotation) ??
      (init === undefined ? undefined : inputEngineEvidenceOf(init));
    if (evidence !== undefined) {
      inputEngineLocalEvidence = inputEngineLocalEvidence.set(id, evidence);
    }
    if (init !== undefined) {
      const origin = inputEngineOriginOf(init);
      if (origin !== undefined) {
        inputEngineResolver = inputEngineResolver.setOrigin(id, origin);
      }
    }
    return inputEngineSelf;
  }
  function inputEngineIfExpr(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const parts = kidsOf(inputEngineTree, node);
    if (parts[0] !== undefined) {
      inputEngineSelf = inputEngineVisit(parts[0], inputEngineTable.boolean);
    }
    let type: TypeRef | undefined;
    for (const branch of parts.slice(1)) {
      type = inputEngineInfer(branch, expected).type ?? type;
    }
    return expected ?? type;
  }
  function inputEngineMatchExpr(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const parts = kidsOf(inputEngineTree, node);
    const subject = parts.find((part) =>
      kindOf(inputEngineTree, part) !== SyntaxKind.MatchArm
    );
    if (subject !== undefined) {
      inputEngineSelf = inputEngineVisit(subject, undefined);
    }
    let type: TypeRef | undefined;
    for (
      const arm of parts.filter((part) =>
        kindOf(inputEngineTree, part) === SyntaxKind.MatchArm
      )
    ) {
      const body = kidsOf(inputEngineTree, arm).at(-1);
      if (body !== undefined) {
        type = inputEngineInfer(body, expected).type ?? type;
      }
    }
    return expected ?? type;
  }
  function inputEngineArrow(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const fn = inputEngineResolver.callableEvidence(expected);
    const header = functionParts(inputEngineTree, node);
    const params = paramNodes(inputEngineTree, header.paramList);
    const parameterEvidence: (TypeRef | undefined)[] = [];
    for (const index of params.keys()) {
      const param = params[index];
      if (param === undefined) {
        continue;
      }
      const binding8 = paramParts(inputEngineTree, param);
      const nameNode = binding8.name;
      const typeNode = binding8.type;
      const target = nameNode === undefined
        ? undefined
        : inputEngineTargets.get(nameNode);
      const id = target?.kind === "local" ? target.id : undefined;
      const type = typeNode === undefined
        ? fn?.parameters[index] ?? inputEngineTable.unknown
        : inputEngineLowerer.lower(typeNode).ref;
      {
        const _appendTarget1 = parameterEvidence;
        const _appendValue2 = typeNode === undefined
          ? fn?.parameters[index]
          : type;
        _appendTarget1[_appendTarget1.length] = _appendValue2;
      }
      if (id !== undefined) {
        inputEngineLocalTypes = inputEngineLocalTypes.set(id, type);
      }
    }
    const resultNode = header.result;
    const result = resultNode === undefined
      ? fn?.result
      : inputEngineLowerer.lower(resultNode).ref;
    inputEngineExpressionEvidence = inputEngineExpressionEvidence.set(node, {
      kind: "callable",
      parameters: parameterEvidence,
      result: result,
      checked: fn?.checked,
    });
    const body = arrowBody(inputEngineTree, node);
    if (body !== undefined) {
      inputEngineSelf = inputEngineVisit(body, result);
    }
    return expected;
  }
  function inputEngineRecord(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = inputEngineResolver.isConcrete(expected)
      ? inputEngineTable.node(inputEngineTable.unfold(expected))
      : undefined;
    let evidence = emptyMap<string, ExpressionEvidence>();
    for (const field of kidsOf(inputEngineTree, node)) {
      const pieces = kidsOf(inputEngineTree, field);
      const labelNode = pieces.find((piece) =>
        kindOf(inputEngineTree, piece) === SyntaxKind.Name
      );
      const label = labelNode === undefined
        ? undefined
        : nameTextOf(inputEngineTree, labelNode);
      const value = pieces.at(-1);
      if (value === undefined) {
        continue;
      }
      const fieldType = target?.kind === "record" && label !== undefined
        ? target.fields.find((entry) => entry.name === label)?.type
        : undefined;
      const valueType = inputEngineInfer(value, fieldType).type;
      const fieldEvidence =
        inputEngineResolver.callableEvidence(fieldType ?? valueType) ??
          inputEngineEvidenceOf(value);
      if (label !== undefined && fieldEvidence !== undefined) {
        evidence = evidence.set(label, fieldEvidence);
      }
    }
    if (evidence.size > 0) {
      inputEngineExpressionEvidence = inputEngineExpressionEvidence.set(node, {
        kind: "record",
        fields: evidence,
      });
    }
    return expected;
  }
  function inputEngineList(
    node: NodeId,
    expected: TypeRef | undefined,
  ): TypeRef | undefined {
    const target = inputEngineResolver.isConcrete(expected)
      ? inputEngineTable.node(inputEngineTable.unfold(expected))
      : undefined;
    const elements = kidsOf(inputEngineTree, node);
    for (const index of elements.keys()) {
      const element = elements[index];
      if (element === undefined) {
        continue;
      }
      let elementType: TypeRef | undefined;
      if (target?.kind === "array") {
        elementType = target.element;
      } else if (target?.kind === "tuple") {
        elementType = target.elements[index];
      }
      inputEngineSelf = inputEngineVisit(element, elementType);
    }
    return expected;
  }
  inputEngineSelf = { finish: inputEngineFinish, visit: inputEngineVisit };
  return inputEngineSelf;
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
          ? { ...parameter, type: { ref: ref, ir: typeToIr(table, ref) } }
          : parameter;
      },
    ),
  };
}
