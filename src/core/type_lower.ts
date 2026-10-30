// The type lowering of the declaration checker: the builtin type rows,
// `TypeLowerer` for the type syntax of a module, and the recursion check of
// type groups. The body checker uses `TypeLowerer` for annotations inside bodies.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import type { CapabilityId, ErrorId, Execution, Field, Type } from "./ir.ts";
import { DURATION_ID, INSTANT_ID } from "./ir.ts";
import { TokenKind } from "./lex.ts";
import { stronglyConnectedComponents } from "./graph.ts";
import type { Target } from "./resolve.ts";
import type { Span } from "./source.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
  TYPE_WORDS,
} from "./syntax.ts";
import { dataOnly, type TypeRef } from "./types.ts";
import { sortedUnique } from "./util.ts";
import { typeToIr } from "./type_ir.ts";
import { showType } from "./type_show.ts";
import { isErrorId } from "./ids.ts";
import { isTypeKind, kidsOf, literalOf, nameTextOf } from "./syntax_queries.ts";
import {
  type Lowered,
  loweredFunction,
  type ParameterSignature,
  referencedIds,
  type SignatureType,
  type TypeEnv,
} from "./signatures.ts";

// ------------------------------------------------------------------ type lowering

type BuiltinTypeName = Extract<
  Target,
  { readonly kind: "builtin-type" }
>["name"];

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

/** The row of a primitive type name that takes no type arguments. */
function primitiveRow(
  name: "string" | "boolean" | "int" | "number" | "never" | "unknown",
): BuiltinTypeRow {
  return {
    kind: "plain",
    build: (lowerer) => ({
      ref: lowerer.env.table.primitive(name),
      ir: { kind: "primitive", name },
    }),
  };
}

/** Lowers type syntax nodes to interned types and IR trees. Diagnostics go to `sink`. */
export class TypeLowerer {
  constructor(
    readonly env: TypeEnv,
    readonly sink: Diagnostic[],
  ) {}

  private get tree(): SyntaxTree {
    return this.env.tree;
  }

  report(
    code: Diagnostic["code"],
    message: string,
    span: Span,
    related?: readonly { span: Span; message: string }[],
  ): void {
    this.sink.push(makeDiagnostic(code, message, span, related));
  }

  /** Child nodes that are not tokens or Missing nodes. */
  kids(node: NodeId): NodeId[] {
    return kidsOf(this.tree, node);
  }

  kidsOfKind(node: NodeId, kind: SyntaxKind): NodeId[] {
    return this.kids(node).filter((k) => kindOf(this.tree, k) === kind);
  }

  span(node: NodeId): Span {
    return nodeSpan(this.tree, node);
  }

  errorLowered(): Lowered {
    return {
      ref: this.env.table.error,
      ir: { kind: "primitive", name: "unknown" },
    };
  }

  /** Lowers a type syntax node. */
  lower(node: NodeId): Lowered {
    const table = this.env.table;
    switch (kindOf(this.tree, node)) {
      case SyntaxKind.NamedType:
        return this.named(node);
      case SyntaxKind.EffectType:
      case SyntaxKind.StreamType:
      case SyntaxKind.SinkType:
      case SyntaxKind.ScheduleType:
      case SyntaxKind.SchemaType:
      case SyntaxKind.LayerType:
        return this.deferredType(node);
      case SyntaxKind.LiteralType:
        return this.literal(node);
      case SyntaxKind.RecordType:
        return this.recordOf(this.fields(node, false));
      case SyntaxKind.TupleType: {
        const elements = this.kids(node).map((k) => this.element(k));
        return {
          ref: table.tuple(elements.map((e) => e.ref)),
          ir: { kind: "tuple", elements: elements.map((e) => e.ir) },
        };
      }
      case SyntaxKind.ArrayType: {
        const inner = this.kids(node)[0];
        if (inner === undefined) return this.errorLowered();
        const element = this.element(inner);
        return {
          ref: table.array(element.ref),
          ir: { kind: "array", element: element.ir },
        };
      }
      case SyntaxKind.UnionType:
        return this.union(node);
      case SyntaxKind.FunctionType:
        return this.functionType(node);
      case SyntaxKind.ParenType: {
        const inner = this.kids(node)[0];
        return inner === undefined ? this.errorLowered() : this.lower(inner);
      }
      default:
        return this.errorLowered();
    }
  }

  /** A record field, array element, or tuple element. `void` is not allowed here. */
  private element(node: NodeId): Lowered {
    const lowered = this.lower(node);
    if (lowered.ref === this.env.table.unit) {
      this.report(
        "type-mismatch/002",
        "`void` cannot be a record field, an array element, or a tuple element",
        this.span(node),
      );
      return this.errorLowered();
    }
    return lowered;
  }

  private literal(node: NodeId): Lowered {
    const value = literalOf(this.tree, node);
    return value === undefined
      ? this.errorLowered()
      : { ref: this.env.table.literal(value), ir: { kind: "literal", value } };
  }

  private named(node: NodeId): Lowered {
    const table = this.env.table;
    const nameNode = this.kidsOfKind(node, SyntaxKind.Name)[0];
    const argsNode = this.kidsOfKind(node, SyntaxKind.TypeArgs)[0];
    const args = argsNode === undefined ? [] : this.kids(argsNode);
    if (nameNode === undefined) return this.errorLowered();
    const name = nameTextOf(this.tree, nameNode) ?? "";
    const target = this.env.targets.get(nameNode);
    if (target === undefined || target.kind === "unresolved") {
      for (const arg of args) this.lower(arg);
      return this.errorLowered();
    }
    if (target.kind === "type" || target.kind === "error") {
      this.noArguments(name, args, argsNode);
      return {
        ref: table.named(target.id),
        ir: { kind: "named", id: target.id },
      };
    }
    if (target.kind !== "builtin-type") return this.errorLowered();
    const row = TypeLowerer.BUILTIN_TYPES[target.name];
    switch (row.kind) {
      case "plain":
        this.noArguments(name, args, argsNode);
        return row.build(this);
      case "generic": {
        if (args.length !== row.arity) {
          this.arity(name, row.arity, args, node);
          return this.errorLowered();
        }
        return row.build(this, args.map((arg) => this.lower(arg)), args);
      }
      default: {
        const unreachable: never = row;
        return unreachable;
      }
    }
  }

  /** One row for each built-in type name. A missing name is a compile error. */
  private static readonly BUILTIN_TYPES: {
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
    Duration: {
      kind: "plain",
      build: (lowerer) => ({
        ref: lowerer.env.table.named(DURATION_ID),
        ir: { kind: "named", id: DURATION_ID },
      }),
    },
    Instant: {
      kind: "plain",
      build: (lowerer) => ({
        ref: lowerer.env.table.named(INSTANT_ID),
        ir: { kind: "named", id: INSTANT_ID },
      }),
    },
    CloseableScope: {
      kind: "plain",
      build: (lowerer) => ({
        ref: lowerer.env.table.closeableScope,
        ir: { kind: "closeable-scope" },
      }),
    },
    Option: {
      kind: "generic",
      arity: 1,
      build: (lowerer, [element]) => ({
        ref: lowerer.env.table.option(element.ref),
        ir: { kind: "option", element: element.ir },
      }),
    },
    Map: {
      kind: "generic",
      arity: 2,
      build: (lowerer, [key, value], nodes) => {
        lowerer.requireKeyData("Map key", key, nodes[0]);
        return {
          ref: lowerer.env.table.map(key.ref, value.ref),
          ir: { kind: "map", key: key.ir, value: value.ir },
        };
      },
    },
    Set: {
      kind: "generic",
      arity: 1,
      build: (lowerer, [element], nodes) => {
        lowerer.requireKeyData("Set element", element, nodes[0]);
        return {
          ref: lowerer.env.table.set(element.ref),
          ir: { kind: "set", element: element.ir },
        };
      },
    },
    Ref: {
      kind: "generic",
      arity: 1,
      build: (lowerer, [element]) => ({
        ref: lowerer.env.table.ref(element.ref),
        ir: { kind: "ref", element: element.ir },
      }),
    },
    RetrySchedule: {
      kind: "generic",
      arity: 1,
      build: (lowerer, [error], nodes) => {
        if (error.ir.kind !== "named" || !isErrorId(error.ir.id)) {
          lowerer.report(
            "type-mismatch/001",
            "RetrySchedule needs a declared error type",
            lowerer.span(nodes[0]),
          );
        }
        return {
          ref: lowerer.env.table.retrySchedule(error.ref),
          ir: { kind: "retry-schedule", error: error.ir },
        };
      },
    },
    ScheduleInput: {
      kind: "generic",
      arity: 1,
      build: (lowerer, [input]) => {
        const ref = lowerer.env.table.scheduleInput(input.ref);
        return { ref, ir: typeToIr(lowerer.env.table, ref) };
      },
    },
    ScheduleMetadata: {
      kind: "generic",
      arity: 2,
      build: (lowerer, [input, output]) => {
        const ref = lowerer.env.table.scheduleMetadata(input.ref, output.ref);
        return { ref, ir: typeToIr(lowerer.env.table, ref) };
      },
    },
    ScheduleDecision: {
      kind: "generic",
      arity: 2,
      build: (lowerer, [state, input]) => {
        const ref = lowerer.env.table.scheduleDecision(state.ref, input.ref);
        return { ref, ir: typeToIr(lowerer.env.table, ref) };
      },
    },
    Codec: {
      kind: "generic",
      arity: 2,
      build: (lowerer, [decoded, encoded]) => ({
        ref: lowerer.env.table.codec(decoded.ref, encoded.ref),
        ir: { kind: "codec", decoded: decoded.ir, encoded: encoded.ir },
      }),
    },
    Fiber: {
      kind: "generic",
      arity: 2,
      build: (lowerer, [result, error], nodes) => {
        const failures: ErrorId[] = [];
        const collect = (type: Type): void => {
          if (type.kind === "primitive" && type.name === "never") return;
          if (type.kind === "union") {
            type.members.forEach(collect);
          } else if (type.kind === "named" && isErrorId(type.id)) {
            failures.push(type.id);
          } else {
            lowerer.report(
              "type-mismatch/001",
              "Fiber failure type needs declared errors or never",
              lowerer.span(nodes[1]),
            );
          }
        };
        collect(error.ir);
        const unique = sortedUnique(failures);
        return {
          ref: lowerer.env.table.fiber(result.ref, unique),
          ir: { kind: "fiber", result: result.ir, failures: unique },
        };
      },
    },
  };

  /**
   * The key checks that wait until every declaration of the module is defined,
   * because a key may name a type that a later declaration defines. The module
   * checker sets this list, runs the checks, and then clears it.
   */
  pendingKeyChecks: (() => void)[] | undefined;

  /** Reports `declaration/019` when a Map key or a Set element is not data. */
  requireKeyData(role: string, lowered: Lowered, node: NodeId): void {
    const check = (): void => {
      if (dataOnly(this.env.table, lowered.ref, "value", true)) return;
      this.report(
        "declaration/019",
        `A ${role} must be data, found \`${
          showType(this.env.table, lowered.ref)
        }\``,
        this.span(node),
      );
    };
    if (this.pendingKeyChecks === undefined) check();
    else this.pendingKeyChecks.push(check);
  }

  private noArguments(
    name: string,
    args: readonly NodeId[],
    argsNode: NodeId | undefined,
  ): void {
    if (argsNode === undefined) return;
    for (const arg of args) this.lower(arg);
    this.report(
      "type-mismatch/001",
      `\`${name}\` takes no type arguments`,
      this.span(argsNode),
    );
  }

  private arity(
    name: string,
    expected: number,
    args: readonly NodeId[],
    node: NodeId,
  ): void {
    for (const arg of args) this.lower(arg);
    this.report(
      "type-mismatch/001",
      `\`${name}\` takes ${expected} type argument${
        expected === 1 ? "" : "s"
      }, but ${args.length} ${args.length === 1 ? "is" : "are"} given`,
      this.span(node),
    );
  }

  /**
   * The fields of a record type in source order. Reports duplicate names, void
   * fields, and, for an error declaration, a field named `_tag`.
   */
  fields(node: NodeId, errorDeclaration: boolean): LoweredField[] {
    const result: LoweredField[] = [];
    const seen = new Map<string, Span>();
    for (const fieldNode of this.kidsOfKind(node, SyntaxKind.FieldType)) {
      const parts = this.kids(fieldNode);
      const nameNode = parts.find((k) =>
        kindOf(this.tree, k) === SyntaxKind.Name
      );
      const typeNode = parts.find((k) => k !== nameNode);
      const name = nameNode === undefined
        ? undefined
        : nameTextOf(this.tree, nameNode);
      // Lower the type first so that its diagnostics appear even for a bad name.
      const type = typeNode === undefined
        ? this.errorLowered()
        : this.element(typeNode);
      if (nameNode === undefined || name === undefined) continue;
      const nameSpan = this.span(nameNode);
      if (errorDeclaration && name === "_tag") {
        this.report(
          "declaration/009",
          "the field name `_tag` is reserved for generated tags",
          nameSpan,
        );
        continue;
      }
      const first = seen.get(name);
      if (first !== undefined) {
        this.report(
          "declaration/010",
          `the record type already has a field named \`${name}\``,
          nameSpan,
          [{ span: first, message: "first declared here" }],
        );
        continue;
      }
      seen.set(name, nameSpan);
      const optional = childrenOf(this.tree, fieldNode).some((c) =>
        kindOf(this.tree, c) === SyntaxKind.Token &&
        this.tree.lexed.kinds[this.tree.tokens[c]] === TokenKind.Question
      );
      result.push({
        name,
        optional,
        type,
        span: this.span(fieldNode),
        typeSpan: this.span(typeNode ?? fieldNode),
      });
    }
    return result;
  }

  recordOf(fields: readonly LoweredField[]): Lowered {
    return {
      ref: this.env.table.record(fields.map((f) => ({
        name: f.name,
        type: f.type.ref,
        optional: f.optional,
      }))),
      ir: { kind: "record", fields: fields.map(toIrField) },
    };
  }

  private union(node: NodeId): Lowered {
    const members: Lowered[] = [];
    this.collectUnion(node, members);
    const refs = new Set<TypeRef>();
    const unique: Lowered[] = [];
    for (const member of members) {
      if (refs.has(member.ref)) continue;
      refs.add(member.ref);
      unique.push(member);
    }
    if (unique.length === 0) return this.errorLowered();
    if (unique.length === 1) return unique[0];
    const ref = this.env.table.union(unique.map((m) => m.ref));
    if (ref === this.env.table.error) return this.errorLowered();
    return { ref, ir: { kind: "union", members: unique.map((m) => m.ir) } };
  }

  private collectUnion(node: NodeId, out: Lowered[]): void {
    for (const kid of this.kids(node)) {
      const kind = kindOf(this.tree, kid);
      if (kind === SyntaxKind.UnionType) {
        this.collectUnion(kid, out);
      } else if (kind === SyntaxKind.ParenType) {
        const inner = this.kids(kid);
        if (
          inner.length === 1 &&
          kindOf(this.tree, inner[0]) === SyntaxKind.UnionType
        ) {
          this.collectUnion(inner[0], out);
        } else {
          out.push(this.lower(kid));
        }
      } else {
        out.push(this.lower(kid));
      }
    }
  }

  /** A function type in type syntax. An unmarked type defaults to `effect`. */
  private functionType(node: NodeId): Lowered {
    const first = childrenOf(this.tree, node)[0];
    const execution =
      first !== undefined && nodeText(this.tree, first) === "pure"
        ? "pure"
        : "effect";
    const kids = this.kids(node);
    const paramList = kids.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.ParamList
    );
    const parameters = paramList === undefined
      ? []
      : this.parameters(paramList);
    const resultNode = kids.find((k) => {
      const kind = kindOf(this.tree, k);
      return k !== paramList && kind !== SyntaxKind.FailsClause &&
        kind !== SyntaxKind.UsesClause;
    });
    const result = resultNode === undefined
      ? this.errorLowered()
      : this.lower(resultNode);
    const failures = this.failures(
      kids.find((k) => kindOf(this.tree, k) === SyntaxKind.FailsClause),
    );
    const requirements = this.requirements(
      kids.find((k) => kindOf(this.tree, k) === SyntaxKind.UsesClause),
    );
    if (
      execution === "pure" &&
      (failures.length > 0 || requirements.length > 0)
    ) {
      this.report(
        "execution-mode/005",
        "a pure function type cannot declare failures or requirements",
        this.span(node),
      );
    }
    return this.functionOf(
      execution,
      parameters.map((p) => p.type),
      result,
      failures,
      requirements,
      parameters.map((p) => p.borrow),
    );
  }

  private deferredType(node: NodeId): Lowered {
    const kids = this.kids(node);
    const typeNodes = kids.filter((k) => isTypeKind(kindOf(this.tree, k)));
    const first = typeNodes[0] === undefined
      ? this.errorLowered()
      : this.lower(typeNodes[0]);
    if (kindOf(this.tree, node) === SyntaxKind.SchemaType) {
      // The first child is the token of the type word.
      const wordToken = childrenOf(this.tree, node)[0];
      const flags = TYPE_WORDS.get(nodeText(this.tree, wordToken))?.schema;
      const optionalKey = flags?.optionalKey === true;
      const encodedOptionalKey = flags?.encodedOptionalKey === true;
      const decodedOptionalKey = flags?.decodedOptionalKey === true;
      const constructorDefault = flags?.constructorDefault === true;
      const encoded = typeNodes[1] === undefined
        ? first
        : this.lower(typeNodes[1]);
      const makeInput = typeNodes[2] === undefined
        ? first
        : this.lower(typeNodes[2]);
      if (
        !dataOnly(this.env.table, first.ref, "schema", true) ||
        !dataOnly(this.env.table, encoded.ref, "schema", true) ||
        !dataOnly(this.env.table, makeInput.ref, "schema", true)
      ) {
        this.report(
          "type-mismatch/010",
          "Schema decoded and encoded types must be data only",
          this.span(node),
        );
      }
      const uses = kids.filter((k) =>
        kindOf(this.tree, k) === SyntaxKind.UsesClause
      );
      const decodeRequirements = this.requirements(uses[0]);
      const encodeRequirements = this.requirements(uses[1]);
      return {
        ref: this.env.table.schema(
          first.ref,
          encoded.ref,
          decodeRequirements,
          encodeRequirements,
          {
            presence: optionalKey
              ? "optional"
              : encodedOptionalKey
              ? "encoded-optional"
              : decodedOptionalKey
              ? "decoded-optional"
              : "required",
            makeInput: makeInput.ref,
            constructorDefault,
          },
        ),
        ir: {
          kind: "schema",
          decoded: first.ir,
          encoded: encoded.ir,
          decodeRequirements,
          encodeRequirements,
          ...(optionalKey ? { optionalKey: true as const } : {}),
          ...(encodedOptionalKey ? { encodedOptionalKey: true as const } : {}),
          ...(decodedOptionalKey ? { decodedOptionalKey: true as const } : {}),
          ...(makeInput.ref === first.ref ? {} : { makeInput: makeInput.ir }),
          ...(constructorDefault ? { constructorDefault: true as const } : {}),
        },
      };
    }
    const failures = this.failures(
      kids.find((k) => kindOf(this.tree, k) === SyntaxKind.FailsClause),
    );
    const requirements = this.requirements(
      kids.find((k) => kindOf(this.tree, k) === SyntaxKind.UsesClause),
    );
    const effects = { failures, requirements };
    const kind = kindOf(this.tree, node);
    if (kind === SyntaxKind.LayerType) {
      const provides: CapabilityId[] = [];
      const clause = kids.find((k) =>
        kindOf(this.tree, k) === SyntaxKind.ProvidesClause
      );
      if (clause !== undefined) {
        for (const qn of this.kidsOfKind(clause, SyntaxKind.QualifiedName)) {
          for (const capability of this.capabilitiesOf(qn)) {
            provides.push(capability);
          }
        }
      }
      return this.providerOf(provides, failures, requirements);
    }
    if (kind === SyntaxKind.StreamType) {
      return {
        ref: this.env.table.stream(first.ref, failures, requirements),
        ir: { kind: "stream", element: first.ir, effects },
      };
    }
    if (kind === SyntaxKind.ScheduleType) {
      const input = typeNodes[1] === undefined
        ? {
          ref: this.env.table.unknown,
          ir: { kind: "primitive" as const, name: "unknown" as const },
        }
        : this.lower(typeNodes[1]);
      return {
        ref: this.env.table.schedule(
          first.ref,
          input.ref,
          failures,
          requirements,
        ),
        ir: { kind: "schedule", output: first.ir, input: input.ir, effects },
      };
    }
    if (kind === SyntaxKind.SinkType) {
      const second = typeNodes[1] === undefined
        ? this.errorLowered()
        : this.lower(typeNodes[1]);
      const leftover = typeNodes[2] === undefined
        ? {
          ref: this.env.table.never,
          ir: { kind: "primitive" as const, name: "never" as const },
        }
        : this.lower(typeNodes[2]);
      return {
        ref: this.env.table.sink(
          first.ref,
          second.ref,
          failures,
          requirements,
          leftover.ref,
        ),
        ir: {
          kind: "sink",
          input: first.ir,
          result: second.ir,
          ...(leftover.ref === this.env.table.never
            ? {}
            : { leftover: leftover.ir }),
          effects,
        },
      };
    }
    return {
      ref: this.env.table.effect(first.ref, failures, requirements),
      ir: { kind: "effect", result: first.ir, effects },
    };
  }

  /** A provider type. Its acquisition execution is always `effect`. */
  providerOf(
    provides: readonly CapabilityId[],
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): Lowered {
    const provided = sortedUnique(provides);
    return {
      ref: this.env.table.provider({
        provides: provided,
        execution: "effect",
        failures,
        requirements,
      }),
      ir: {
        kind: "provider",
        provides: provided,
        acquisition: {
          execution: "effect",
          effects: { failures, requirements },
        },
      },
    };
  }

  functionOf(
    execution: Execution,
    parameters: readonly Lowered[],
    result: Lowered,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
    borrows?: readonly boolean[],
  ): SignatureType {
    return loweredFunction(
      this.env.table,
      execution,
      parameters,
      result,
      failures,
      requirements,
      borrows,
    );
  }

  /** The parameters of a parameter list. An omitted annotation starts as unknown. */
  parameters(paramList: NodeId): ParameterSignature[] {
    const result: ParameterSignature[] = [];
    for (const param of this.kidsOfKind(paramList, SyntaxKind.Param)) {
      const parts = this.kids(param);
      const nameNode = parts.find((k) =>
        kindOf(this.tree, k) === SyntaxKind.Name
      );
      const typeNode = parts.find((k) => k !== nameNode);
      const name = nameNode === undefined
        ? ""
        : nameTextOf(this.tree, nameNode) ?? "";
      const target = nameNode === undefined
        ? undefined
        : this.env.targets.get(nameNode);
      const type = typeNode === undefined
        ? {
          ref: this.env.table.unknown,
          ir: { kind: "primitive" as const, name: "unknown" as const },
        }
        : this.lower(typeNode);
      result.push({
        name,
        borrow: /^borrow\s+/.test(nodeText(this.tree, param)),
        id: target?.kind === "local" ? target.id : undefined,
        type,
        annotated: typeNode !== undefined,
        inferred: typeNode === undefined || type.ref === this.env.table.unknown,
        span: this.span(param),
      });
    }
    return result;
  }

  /** The error identities of a `fails` clause, sorted and unique. */
  failures(clause: NodeId | undefined): ErrorId[] {
    if (clause === undefined) return [];
    const table = this.env.table;
    const ids: ErrorId[] = [];
    for (const name of this.kidsOfKind(clause, SyntaxKind.Name)) {
      const target = this.env.targets.get(name);
      if (target?.kind === "error") ids.push(target.id);
      else if (target?.kind === "type") {
        this.expandFailureAlias(name, table.named(target.id), ids, new Set());
      }
    }
    return sortedUnique(ids);
  }

  /** Adds the errors of an alias body to `ids`. A member that is not an error gets a diagnostic. */
  private expandFailureAlias(
    nameNode: NodeId,
    ref: TypeRef,
    ids: ErrorId[],
    seen: Set<TypeRef>,
  ): void {
    const table = this.env.table;
    const unfolded = table.unfold(ref);
    if (seen.has(unfolded)) return;
    seen.add(unfolded);
    const node = table.node(unfolded);
    if (node.kind === "named" && isErrorId(node.id)) ids.push(node.id);
    else if (node.kind === "union") {
      for (const member of node.members) {
        this.expandFailureAlias(nameNode, member, ids, seen);
      }
    } else if (node.kind !== "error") {
      this.report(
        "failure-contract/004",
        `\`${
          nodeText(this.tree, nameNode)
        }\` has a member that is not an error: \`${showType(table, ref)}\``,
        this.span(nameNode),
      );
    }
  }

  /**
   * The capabilities of a `uses` clause, sorted and unique. A whole service
   * expands to all its methods.
   */
  requirements(clause: NodeId | undefined): CapabilityId[] {
    if (clause === undefined) return [];
    const ids: CapabilityId[] = [];
    for (const qn of this.kidsOfKind(clause, SyntaxKind.QualifiedName)) {
      for (const capability of this.capabilitiesOf(qn)) {
        ids.push(capability);
      }
    }
    return sortedUnique(ids);
  }

  /** The capabilities that a qualified name stands for: one method, or all methods of a service. */
  capabilitiesOf(qn: NodeId): CapabilityId[] {
    const target = this.env.targets.get(qn);
    if (target?.kind === "cap") return [target.id];
    if (target?.kind === "service") {
      const service = this.env.services.get(target.id);
      return service === undefined ? [] : service.methods.map((m) => m.id);
    }
    return [];
  }
}

export interface LoweredField {
  readonly name: string;
  readonly optional: boolean;
  readonly type: Lowered;
  readonly span: Span;
  /** The span of the field type, or of the whole field when the type is missing. */
  readonly typeSpan: Span;
}

export function toIrField(field: LoweredField): Field {
  return { name: field.name, type: field.type.ir, optional: field.optional };
}

// ------------------------------------------------------------------ type graph walk

/**
 * Rule 11 for one group of tagged records and aliases that refer to each other.
 * `roots[n]` lists the IR types of member `n`: the record of a tagged record, or
 * the target of an alias. The group is guarded when no cycle is made of aliases
 * alone, and no cycle is made of references that avoid an `Option`, an array,
 * an optional field, and a union with a member outside the group.
 */
export function recursionIsGuarded(
  members: readonly { readonly id: string; readonly tagged: boolean }[],
  roots: readonly (readonly Type[])[],
): boolean {
  const index = new Map(members.map((m, n) => [m.id, n]));
  const inGroup = (type: Type): boolean => {
    const ids = new Set<string>();
    referencedIds(type, ids);
    return [...ids].some((id) => index.has(id));
  };
  // The edges of a member, and whether a path with no guard reaches the target.
  const edges = roots.map((types) => {
    const found = new Map<number, boolean>();
    const reach = (id: string, guarded: boolean): void => {
      const target = index.get(id);
      if (target !== undefined) {
        found.set(target, (found.get(target) ?? false) || !guarded);
      }
    };
    const visit = (type: Type, guarded: boolean): void => {
      switch (type.kind) {
        case "named":
          reach(type.id, guarded);
          return;
        case "option":
        case "array":
        case "set":
          visit(type.element, true);
          return;
        case "map":
          visit(type.key, true);
          visit(type.value, true);
          return;
        case "union": {
          const outside = type.members.some((m) => !inGroup(m));
          for (const member of type.members) visit(member, guarded || outside);
          return;
        }
        case "record":
          // A value can leave out an optional field, so the field ends the recursion.
          for (const field of type.fields) {
            visit(field.type, guarded || field.optional);
          }
          return;
        case "tuple":
          for (const element of type.elements) visit(element, guarded);
          return;
        default: {
          const ids = new Set<string>();
          referencedIds(type, ids);
          for (const id of ids) reach(id, guarded);
        }
      }
    };
    for (const type of types) visit(type, false);
    return found;
  });
  const cyclic = (
    keep: (from: number, to: number, bare: boolean) => boolean,
  ) => {
    const graph = edges.map((targets, from) =>
      [...targets].filter(([to, bare]) => keep(from, to, bare)).map(([to]) =>
        to
      )
    );
    return stronglyConnectedComponents(members.length, graph).some((c) =>
      c.length > 1 || graph[c[0]].includes(c[0])
    );
  };
  return !cyclic((from, to) => !members[from].tagged && !members[to].tagged) &&
    !cyclic((_from, _to, bare) => bare);
}
