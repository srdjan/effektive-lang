import { emptyMap, emptySet } from "./runtime.ts";
// The type lowering of the declaration checker: the builtin type rows,
// `TypeLowerer` for the type syntax of a module, and the recursion check of
// type groups. The body checker uses `TypeLowerer` for annotations inside bodies.
import { type Diagnostic, makeDiagnosticWithRelated } from "./diagnostics.ts";
import type { CapabilityId, ErrorId, Field, TypeId } from "./ir.ts";
import { DURATION_ID, INSTANT_ID } from "./ir.ts";
import { TokenKind } from "./lex.ts";
import type { Target } from "./resolve.ts";
import type { Span } from "./source.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  typeWord,
} from "./syntax.ts";
import { dataOnly, type TypeRef } from "./types.ts";
import { arityMessage, sortedUnique } from "./util.ts";
import { showType } from "./type_show.ts";
import { isErrorId } from "./ids.ts";
import {
  functionParts,
  hasModifier,
  isTypeKind,
  kidsOf,
  kidsOfKind,
  literalOf,
  nameTextOf,
} from "./syntax_queries.ts";
import {
  type Lowered,
  loweredFunction,
  type ParameterSignature,
  type TypeEnv,
} from "./signatures.ts";
// ------------------------------------------------------------------ type lowering
type BuiltinTypeName = Extract<Target, {
  readonly kind: "builtin-type";
}>["name"];
/** How a built-in type name lowers. */
type BuiltinTypeRow =
  /** The name takes no type arguments. */
  | {
    readonly kind: "plain";
    readonly build: (lowerer: TypeLowerer) => Lowered;
  }
  /**
   * The name takes `arity` type arguments. The lowerer lowers them in order and
   * calls `build` with them and with their nodes. A wrong count is a report.
   */
  | {
    readonly kind: "generic";
    readonly arity: 1 | 2;
    readonly build: (
      lowerer: TypeLowerer,
      args: readonly Lowered[],
      nodes: readonly NodeId[],
    ) => Lowered;
  };
/**
 * The primitive type names that take no type arguments. A value primitive
 * (`true`) carries data and can occur only inside a type or error declaration.
 */
const PRIMITIVE_TYPES = {
  string: true,
  boolean: true,
  int: true,
  number: true,
  never: false,
  unknown: false,
} as const;
type PrimitiveTypeName = keyof typeof PRIMITIVE_TYPES;
/** True for a built-in type name that is a primitive that carries data. */
type PrimitiveNameText = string;
type TypeMatch = boolean;
export function isValuePrimitiveName(name: PrimitiveNameText): TypeMatch {
  return Object.entries(PRIMITIVE_TYPES).some((entry) => {
    const primitive = entry[0];
    const value = entry[1];
    return value && primitive === name;
  });
}
/** The row of a primitive type name that takes no type arguments. */
function primitiveRow(name: PrimitiveTypeName): BuiltinTypeRow {
  return {
    kind: "plain",
    build: (lowerer) => ({
      ref: lowerer.env.table.primitive(name),
      ir: { kind: "primitive", name: name },
    }),
  };
}
/** The row of a closed unit type name that takes no type arguments. */
function unitRow(id: TypeId): BuiltinTypeRow {
  return {
    kind: "plain",
    build: (lowerer) => ({
      ref: lowerer.env.table.named(id),
      ir: { kind: "named", id: id },
    }),
  };
}
/** Lowers type syntax nodes to interned types and IR trees. Diagnostics go to `sink`. */
export type TypeLowerer = {
  readonly env: TypeEnv;
  readonly report: (
    code: Diagnostic["code"],
    message: string,
    span: Span,
    related: Diagnostic["related"],
  ) => TypeLowerer;
  readonly span: (node: NodeId) => Span;
  readonly errorLowered: () => Lowered;
  readonly lower: (node: NodeId) => Lowered;
  readonly fields: (node: NodeId, errorDeclaration: boolean) => LoweredField[];
  readonly recordOf: (fields: readonly LoweredField[]) => Lowered;
  readonly providerOf: (
    provides: readonly CapabilityId[],
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ) => Lowered;
  readonly parameters: (paramList: NodeId) => ParameterSignature[];
  readonly failures: (clause: NodeId | undefined) => ErrorId[];
  readonly requirements: (clause: NodeId | undefined) => CapabilityId[];
  readonly capabilitiesOf: (qn: NodeId) => CapabilityId[];
};
export function TypeLowerer(env: TypeEnv, sink: Diagnostic[]): TypeLowerer {
  let self: TypeLowerer;
  const tree = env.tree;
  const builtinTypes: {
    readonly [N in BuiltinTypeName]: BuiltinTypeRow;
  } = {
    string: primitiveRow("string"),
    boolean: primitiveRow("boolean"),
    int: primitiveRow("int"),
    number: primitiveRow("number"),
    never: primitiveRow("never"),
    unknown: primitiveRow("unknown"),
    void: {
      kind: "plain",
      build: (lowerer) => ({
        ref: lowerer.env.table.unit,
        ir: { kind: "primitive", name: "unit" },
      }),
    },
    Duration: unitRow(DURATION_ID),
    Instant: unitRow(INSTANT_ID),
    Option: {
      kind: "generic",
      arity: 1,
      build: (lowerer, args) => {
        const element = args[0];
        return ({
          ref: lowerer.env.table.option(element.ref),
          ir: { kind: "option", element: element.ir },
        });
      },
    },
    Ref: {
      kind: "generic",
      arity: 1,
      build: (lowerer, args) => {
        const element = args[0];
        return ({
          ref: lowerer.env.table.ref(element.ref),
          ir: { kind: "ref", element: element.ir },
        });
      },
    },
    RetrySchedule: {
      kind: "generic",
      arity: 1,
      build: (lowerer, args, nodes) => {
        const error = args[0];
        if (error.ir.kind !== "named" || !isErrorId(error.ir.id)) {
          lowerer = lowerer.report(
            "type-mismatch/001",
            "RetrySchedule needs a declared error type",
            lowerer.span(nodes[0]),
            undefined,
          );
        }
        return {
          ref: lowerer.env.table.retrySchedule(error.ref),
          ir: { kind: "retry-schedule", error: error.ir },
        };
      },
    },
  };
  function report(
    code: Diagnostic["code"],
    message: string,
    span: Span,
    related: Diagnostic["related"],
  ): TypeLowerer {
    sink[sink.length] = makeDiagnosticWithRelated(
      code,
      message,
      span,
      related,
    );

    return self;
  }
  function lowerWithState(
    node: NodeId,
  ): { readonly lowerer: TypeLowerer; readonly value: Lowered } {
    const value = lowerType(node);
    return { lowerer: self, value: value };
  }
  function typeChildren(node: NodeId): NodeId[] {
    return kidsOf(tree, node);
  }
  function spanOf(node: NodeId): Span {
    return nodeSpan(tree, node);
  }
  function errorLowered(): Lowered {
    return {
      ref: env.table.error,
      ir: { kind: "primitive", name: "unknown" },
    };
  }
  function lowerType(node: NodeId): Lowered {
    const table = env.table;
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.NamedType) {
      return named(node);
    }
    if (
      kind === SyntaxKind.EffectType || kind === SyntaxKind.StreamType ||
      kind === SyntaxKind.SinkType || kind === SyntaxKind.SchemaType ||
      kind === SyntaxKind.LayerType
    ) {
      return deferredType(node);
    }
    if (kind === SyntaxKind.LiteralType) {
      return literal(node);
    }
    if (kind === SyntaxKind.RecordType) {
      return recordOf(lowerFields(node, false));
    }
    if (kind === SyntaxKind.TupleType) {
      const elements = typeChildren(node).map((k) => lowerElement(k));
      return {
        ref: table.tuple(elements.map((e) => e.ref)),
        ir: { kind: "tuple", elements: elements.map((e) => e.ir) },
      };
    }
    if (kind === SyntaxKind.ArrayType) {
      const inner = typeChildren(node)[0];
      if (inner === undefined) {
        return errorLowered();
      }
      const element = lowerElement(inner);
      return {
        ref: table.array(element.ref),
        ir: { kind: "array", element: element.ir },
      };
    }
    if (kind === SyntaxKind.UnionType) {
      return union(node);
    }
    if (kind === SyntaxKind.FunctionType) {
      return functionType(node);
    }
    if (kind === SyntaxKind.ParenType) {
      const inner = typeChildren(node)[0];
      return inner === undefined ? errorLowered() : lowerType(inner);
    }
    return errorLowered();
  }
  function lowerElement(node: NodeId): Lowered {
    const lowered = lowerType(node);
    if (lowered.ref === env.table.unit) {
      self = report(
        "type-mismatch/002",
        "`void` cannot be a record field, an array element, or a tuple element",
        spanOf(node),
        undefined,
      );
      return errorLowered();
    }
    return lowered;
  }
  function literal(node: NodeId): Lowered {
    const value = literalOf(tree, node);
    return value === undefined ? errorLowered() : {
      ref: env.table.literal(value),
      ir: { kind: "literal", value: value },
    };
  }
  function named(node: NodeId): Lowered {
    const table = env.table;
    const nameNode = kidsOfKind(tree, node, SyntaxKind.Name)[0];
    const argsNode = kidsOfKind(tree, node, SyntaxKind.TypeArgs)[0];
    const args = argsNode === undefined ? [] : typeChildren(argsNode);
    if (nameNode === undefined) {
      return errorLowered();
    }
    const name = nameTextOf(tree, nameNode) ?? "";
    const target = env.targets.get(nameNode);
    if (target === undefined || target.kind === "unresolved") {
      for (const arg of args) self = lowerWithState(arg).lowerer;
      return errorLowered();
    }
    if (target.kind === "type" || target.kind === "error") {
      self = noArguments(name, args, argsNode);
      return {
        ref: table.named(target.id),
        ir: { kind: "named", id: target.id },
      };
    }
    if (target.kind !== "builtin-type") {
      return errorLowered();
    }
    const row = builtinTypes[target.name];
    if (row.kind === "plain") {
      self = noArguments(name, args, argsNode);
      return row.build(self);
    }
    if (row.kind === "generic") {
      if (args.length !== row.arity) {
        self = arity(name, row.arity, args, node);
        return errorLowered();
      }
      return row.build(self, args.map((arg) => lowerType(arg)), args);
    }
    const unreachable: never = row;
    return unreachable;
  }
  function noArguments(
    name: string,
    args: readonly NodeId[],
    argsNode: NodeId | undefined,
  ): TypeLowerer {
    if (argsNode === undefined) {
      return self;
    }
    for (const arg of args) self = lowerWithState(arg).lowerer;
    self = report(
      "type-mismatch/001",
      `\`${name}\` takes no type arguments`,
      spanOf(argsNode),
      undefined,
    );

    return self;
  }
  function arity(
    name: string,
    expected: number,
    args: readonly NodeId[],
    node: NodeId,
  ): TypeLowerer {
    for (const arg of args) self = lowerWithState(arg).lowerer;
    self = report(
      "type-mismatch/001",
      arityMessage(`\`${name}\``, "type argument", expected, args.length),
      spanOf(node),
      undefined,
    );

    return self;
  }
  function lowerFields(
    node: NodeId,
    errorDeclaration: boolean,
  ): LoweredField[] {
    const result: LoweredField[] = [];
    let seen = emptyMap<string, Span>();
    for (const fieldNode of kidsOfKind(tree, node, SyntaxKind.FieldType)) {
      const parts = typeChildren(fieldNode);
      const nameNode = parts.find((k) => kindOf(tree, k) === SyntaxKind.Name);
      const typeNode = parts.find((k) => k !== nameNode);
      const name = nameNode === undefined
        ? undefined
        : nameTextOf(tree, nameNode);
      // Lower the type first so that its diagnostics appear even for a bad name.
      const type = typeNode === undefined
        ? errorLowered()
        : lowerElement(typeNode);
      if (nameNode === undefined || name === undefined) {
        continue;
      }
      const nameSpan = spanOf(nameNode);
      if (errorDeclaration && name === "_tag") {
        self = report(
          "declaration/009",
          "the field name `_tag` is reserved for generated tags",
          nameSpan,
          undefined,
        );
        continue;
      }
      const first = seen.get(name);
      if (first !== undefined) {
        self = report(
          "declaration/010",
          `the record type already has a field named \`${name}\``,
          nameSpan,
          [{ span: first, message: "first declared here" }],
        );
        continue;
      }
      seen = seen.set(name, nameSpan);
      const optional = childrenOf(tree, fieldNode).some((c) =>
        kindOf(tree, c) === SyntaxKind.Token &&
        tree.lexed.kinds[tree.tokens[c]] === TokenKind.Question
      );
      result[result.length] = {
        name: name,
        optional: optional,
        type: type,
        span: spanOf(fieldNode),
        typeSpan: spanOf(typeNode ?? fieldNode),
      };
    }
    return result;
  }
  function recordOf(fields: readonly LoweredField[]): Lowered {
    return {
      ref: env.table.record(fields.map((f) => ({
        name: f.name,
        type: f.type.ref,
        optional: f.optional,
      }))),
      ir: { kind: "record", fields: fields.map(toIrField) },
    };
  }
  function union(node: NodeId): Lowered {
    let members: Lowered[] = [];
    members = collectUnion(node, members);
    let refs = emptySet<TypeRef>();
    const unique: Lowered[] = [];
    for (const member of members) {
      if (refs.has(member.ref)) {
        continue;
      }
      refs = refs.add(member.ref);
      unique[unique.length] = member;
    }
    if (unique.length === 0) {
      return errorLowered();
    }
    if (unique.length === 1) {
      return unique[0];
    }
    const ref = env.table.union(unique.map((m) => m.ref));
    if (ref === env.table.error) {
      return errorLowered();
    }
    return {
      ref: ref,
      ir: { kind: "union", members: unique.map((m) => m.ir) },
    };
  }
  function collectUnion(node: NodeId, out: Lowered[]): Lowered[] {
    for (const kid of typeChildren(node)) {
      const kind = kindOf(tree, kid);
      const inner = kind === SyntaxKind.ParenType ? typeChildren(kid) : [];
      if (kind === SyntaxKind.UnionType) {
        out = collectUnion(kid, out);
      } else if (
        inner.length === 1 && kindOf(tree, inner[0]) === SyntaxKind.UnionType
      ) {
        out = collectUnion(inner[0], out);
      } else {
        out[out.length] = lowerType(kid);
      }
    }

    return out;
  }
  function functionType(node: NodeId): Lowered {
    const execution = hasModifier(tree, node, "pure") ? "pure" : "effect";
    const kids = typeChildren(node);
    const parts = functionParts(tree, node);
    const paramList = parts.paramList;
    const fails = parts.fails;
    const uses = parts.uses;
    const parameters = paramList === undefined
      ? []
      : lowerParameters(paramList);
    const resultNode = kids.find((k) => {
      const kind = kindOf(tree, k);
      return k !== paramList && kind !== SyntaxKind.FailsClause &&
        kind !== SyntaxKind.WithClause;
    });
    const result = resultNode === undefined
      ? errorLowered()
      : lowerType(resultNode);
    const failures = lowerFailures(fails);
    const requirements = lowerRequirements(uses);
    if (
      execution === "pure" &&
      (failures.length > 0 || requirements.length > 0)
    ) {
      self = report(
        "execution-mode/005",
        "a pure function type cannot declare failures or requirements",
        spanOf(node),
        undefined,
      );
    }
    return loweredFunction(
      env.table,
      { mode: execution, failures: failures, requirements: requirements },
      parameters.map((p) => p.type),
      result,
      parameters.map((p) => p.borrow),
      undefined,
    );
  }
  function deferredType(node: NodeId): Lowered {
    const kids = typeChildren(node);
    const typeNodes = kids.filter((k) => isTypeKind(kindOf(tree, k)));
    const first = typeNodes[0] === undefined
      ? errorLowered()
      : lowerType(typeNodes[0]);
    if (kindOf(tree, node) === SyntaxKind.SchemaType) {
      // The first child is the token of the type word.
      const wordToken = childrenOf(tree, node)[0];
      const flags = typeWord(nodeText(tree, wordToken))?.schema;
      const presence = flags?.presence ?? "required";
      const constructorDefault =
        typeof flags?.constructorDefault === "boolean" &&
        flags.constructorDefault;
      const encoded = typeNodes[1] === undefined
        ? first
        : lowerType(typeNodes[1]);
      const makeInput = typeNodes[2] === undefined
        ? first
        : lowerType(typeNodes[2]);
      if (
        !dataOnly(env.table, first.ref, "schema", true) ||
        !dataOnly(env.table, encoded.ref, "schema", true) ||
        !dataOnly(env.table, makeInput.ref, "schema", true)
      ) {
        self = report(
          "type-mismatch/010",
          "Schema decoded and encoded types must be data only",
          spanOf(node),
          undefined,
        );
      }
      const uses = kids.filter((k) =>
        kindOf(tree, k) === SyntaxKind.WithClause
      );
      const decodeRequirements = lowerRequirements(uses[0]);
      const encodeRequirements = lowerRequirements(uses[1]);
      let options: {
        readonly optionalKey?: true;
        readonly encodedOptionalKey?: true;
        readonly decodedOptionalKey?: true;
        readonly makeInput?: Lowered["ir"];
        readonly constructorDefault?: true;
      } = {};
      if (presence === "optional") options = { optionalKey: true };
      if (presence === "encoded-optional") {
        options = { encodedOptionalKey: true };
      }
      if (presence === "decoded-optional") {
        options = { decodedOptionalKey: true };
      }
      if (makeInput.ref !== first.ref) {
        options = { ...options, makeInput: makeInput.ir };
      }
      if (constructorDefault) {
        options = { ...options, constructorDefault: true };
      }
      return {
        ref: env.table.schema(
          first.ref,
          encoded.ref,
          decodeRequirements,
          encodeRequirements,
          {
            presence: presence,
            makeInput: makeInput.ref,
            constructorDefault: constructorDefault,
          },
        ),
        ir: {
          ...options,
          kind: "schema",
          decoded: first.ir,
          encoded: encoded.ir,
          decodeRequirements: decodeRequirements,
          encodeRequirements: encodeRequirements,
        },
      };
    }
    const clauses = functionParts(tree, node);
    const failures = lowerFailures(clauses.fails);
    const requirements = lowerRequirements(clauses.uses);
    const effects = { failures: failures, requirements: requirements };
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.LayerType) {
      const provides: CapabilityId[] = [];
      const clause = kids.find((k) =>
        kindOf(tree, k) === SyntaxKind.ProvidesClause
      );
      if (clause !== undefined) {
        for (const qn of kidsOfKind(tree, clause, SyntaxKind.QualifiedName)) {
          for (const capability of capabilitiesOf(qn)) {
            provides[provides.length] = capability;
          }
        }
      }
      return providerOf(provides, failures, requirements);
    }
    if (kind === SyntaxKind.StreamType) {
      return {
        ref: env.table.stream(first.ref, failures, requirements),
        ir: { kind: "stream", element: first.ir, effects: effects },
      };
    }
    if (kind === SyntaxKind.SinkType) {
      const second = typeNodes[1] === undefined
        ? errorLowered()
        : lowerType(typeNodes[1]);
      const leftover = typeNodes[2] === undefined
        ? {
          ref: env.table.never,
          ir: { kind: "primitive" as const, name: "never" as const },
        }
        : lowerType(typeNodes[2]);
      return {
        ref: env.table.sink(
          first.ref,
          second.ref,
          failures,
          requirements,
          leftover.ref,
        ),
        ir: {
          ...(leftover.ref === env.table.never
            ? {}
            : { leftover: leftover.ir }),
          kind: "sink",
          input: first.ir,
          result: second.ir,
          effects: effects,
        },
      };
    }
    return {
      ref: env.table.effect(first.ref, failures, requirements),
      ir: { kind: "effect", result: first.ir, effects: effects },
    };
  }
  function providerOf(
    provides: readonly CapabilityId[],
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): Lowered {
    const provided = sortedUnique(provides);
    return {
      ref: env.table.provider({
        provides: provided,
        execution: "effect",
        failures: failures,
        requirements: requirements,
      }),
      ir: {
        kind: "provider",
        provides: provided,
        acquisition: {
          execution: "effect",
          effects: { failures: failures, requirements: requirements },
        },
      },
    };
  }
  function lowerParameters(paramList: NodeId): ParameterSignature[] {
    const result: ParameterSignature[] = [];
    for (const param of kidsOfKind(tree, paramList, SyntaxKind.Param)) {
      const parts = typeChildren(param);
      const nameNode = parts.find((k) => kindOf(tree, k) === SyntaxKind.Name);
      const typeNode = parts.find((k) => k !== nameNode);
      const name = nameNode === undefined
        ? ""
        : nameTextOf(tree, nameNode) ?? "";
      const target = nameNode === undefined
        ? undefined
        : env.targets.get(nameNode);
      const type = typeNode === undefined
        ? {
          ref: env.table.unknown,
          ir: { kind: "primitive" as const, name: "unknown" as const },
        }
        : lowerType(typeNode);
      result[result.length] = {
        name: name,
        borrow: hasModifier(tree, param, "borrow"),
        id: target?.kind === "local" ? target.id : undefined,
        type: type,
        annotated: typeNode !== undefined,
        inferred: typeNode === undefined || type.ref === env.table.unknown,
        span: spanOf(param),
      };
    }
    return result;
  }
  function lowerFailures(clause: NodeId | undefined): ErrorId[] {
    if (clause === undefined) {
      return [];
    }
    const table = env.table;
    let ids: ErrorId[] = [];
    for (const name of kidsOfKind(tree, clause, SyntaxKind.Name)) {
      const target = env.targets.get(name);
      if (target?.kind === "error") {
        ids[ids.length] = target.id;
      } else if (target?.kind === "type") {
        ids = expandFailureAlias(name, table.named(target.id), ids, emptySet());
      }
    }
    return sortedUnique(ids);
  }
  function expandFailureAlias(
    nameNode: NodeId,
    ref: TypeRef,
    ids: ErrorId[],
    seen: Set<TypeRef>,
  ): ErrorId[] {
    const table = env.table;
    const unfolded = table.unfold(ref);
    if (seen.has(unfolded)) {
      return ids;
    }
    seen = seen.add(unfolded);
    const node = table.node(unfolded);
    if (node.kind === "named" && isErrorId(node.id)) {
      ids[ids.length] = node.id;
    } else if (node.kind === "union") {
      for (const member of node.members) {
        ids = expandFailureAlias(nameNode, member, ids, seen);
      }
    } else if (node.kind !== "error") {
      self = report(
        "failure-contract/004",
        `\`${nodeText(tree, nameNode)}\` has a member that is not an error: \`${
          showType(table, ref)
        }\``,
        spanOf(nameNode),
        undefined,
      );
    }

    return ids;
  }
  function lowerRequirements(clause: NodeId | undefined): CapabilityId[] {
    if (clause === undefined) {
      return [];
    }
    const ids: CapabilityId[] = [];
    for (const qn of kidsOfKind(tree, clause, SyntaxKind.QualifiedName)) {
      for (const capability of capabilitiesOf(qn)) {
        ids[ids.length] = capability;
      }
    }
    return sortedUnique(ids);
  }
  function capabilitiesOf(qn: NodeId): CapabilityId[] {
    const target = env.targets.get(qn);
    if (target?.kind === "cap") {
      return [target.id];
    }
    if (target?.kind === "service") {
      const service = env.services.get(target.id);
      return service === undefined ? [] : service.methods.map((m) => m.id);
    }
    return [];
  }
  self = {
    env: env,
    report: report,
    span: spanOf,
    errorLowered: errorLowered,
    lower: lowerType,
    fields: lowerFields,
    recordOf: recordOf,
    providerOf: providerOf,
    parameters: lowerParameters,
    failures: lowerFailures,
    requirements: lowerRequirements,
    capabilitiesOf: capabilitiesOf,
  };
  return self;
}
export type LoweredField = {
  readonly name: string;
  readonly optional: boolean;
  readonly type: Lowered;
  readonly span: Span;
  /** The span of the field type, or of the whole field when the type is missing. */
  readonly typeSpan: Span;
};
export function toIrField(field: LoweredField): Field {
  return { name: field.name, type: field.type.ir, optional: field.optional };
}
