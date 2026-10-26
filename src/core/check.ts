// The declaration level of the checker (plan part A3a). It builds the
// declarations of a module: types, errors, services, providers, and the
// signatures of module-level consts. It reports the declaration diagnostics and
// does not look at expression bodies. The signature model is in signatures.ts,
// and the type lowering is in type_lower.ts. Part A3b checks the bodies in
// check_expr.ts and drives the whole project in check_project.ts.

import type { Analysis } from "./analyze.ts";
import { type Diagnostic, normalizeDiagnostics } from "./diagnostics.ts";
import type { DeclEntry } from "./index.ts";
import type {
  CapabilityId,
  DeclarationId,
  ErrorDecl,
  ErrorId,
  FunctionType,
  MethodDecl,
  ServiceDecl,
  ServiceId,
  Type,
  TypeDecl,
  TypeId,
  ValueId,
  WrittenParts,
} from "./ir.ts";
import { stronglyConnectedComponents } from "./graph.ts";
import { flattenIdentityMembers } from "./patterns.ts";
import { predicateFromSource } from "./predicate_source.ts";
import type { ModuleInfo } from "./project.ts";
import type { Span } from "./source.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
  walk,
} from "./syntax.ts";
import {
  containsDeferredType,
  containsOpaqueType,
  dataOnly,
  guardedRecord,
  type TypeNode,
  type TypeRef,
  type TypeTable,
} from "./types.ts";
import { typeToIr } from "./type_ir.ts";
import { showType } from "./type_show.ts";
import {
  declarationId,
  type DeclarationPrefix,
  isErrorId,
  isTypeId,
} from "./ids.ts";
import { initOf, isTypeKind } from "./syntax_queries.ts";
import { compareText, sortedUnique } from "./util.ts";
import {
  checkedInputFlags,
  type FunctionSignature,
  type Lowered,
  type ModuleDeclarations,
  type ParameterSignature,
  type ProviderSignature,
  referencedIds,
  type SignatureBase,
  type TypeEnv,
  type TypeGraph,
  type ValueSignature,
} from "./signatures.ts";
import {
  type LoweredField,
  recursionIsGuarded,
  toIrField,
  TypeLowerer,
} from "./type_lower.ts";

type FunctionNode = Extract<TypeNode, { readonly kind: "function" }>;

// ------------------------------------------------------------------ the module checker

type TypeNodeInfo =
  & {
    readonly name: string;
    readonly nameSpan: Span;
    readonly start: number;
    readonly refs: ReadonlySet<string>;
  }
  & (
    | { readonly kind: "alias" | "brand" | "data"; readonly id: TypeId }
    | { readonly kind: "error"; readonly id: ErrorId }
  );

/** A record declaration that waits for tag inference. */
type RecordIdentity = {
  readonly entry: DeclEntry;
  readonly id: TypeId;
  readonly index: number;
  readonly literal: LoweredField[] | undefined;
  readonly span: Span;
};

/** The most levels that a type declaration may have, counting its aliases. */
const MAX_TYPE_DEPTH = 128;

class ModuleChecker {
  readonly sink: Diagnostic[] = [];
  readonly lowerer: TypeLowerer;
  private readonly tree: SyntaxTree;
  private readonly table: TypeTable;
  private readonly types: TypeDecl[] = [];
  private readonly errors: ErrorDecl[] = [];
  /** The fields and record bodies of tagged records and error declarations, for the deferred-type rule. */
  private readonly nominalFields: {
    readonly subject: string;
    readonly ref: TypeRef;
    readonly span: Span;
  }[] = [];
  /** The record declarations of this module, which a union alias may tag. */
  private readonly recordIdentities: RecordIdentity[] = [];
  private readonly services: ServiceDecl[] = [];
  private readonly methodTypes = new Map<CapabilityId, TypeRef>();
  private readonly values = new Map<ValueId, ValueSignature>();
  private readonly exports: DeclarationId[] = [];

  constructor(
    private readonly info: ModuleInfo,
    readonly env: TypeEnv,
  ) {
    this.tree = env.tree;
    this.table = env.table;
    this.lowerer = new TypeLowerer(env, this.sink);
  }

  private id<P extends DeclarationPrefix>(
    prefix: P,
    name: string,
  ): `${P}:${string}` {
    return declarationId(prefix, this.env.module, name);
  }

  /** The first declaration of each name. Later ones are duplicates that the resolver reported. */
  private entries(): DeclEntry[] {
    const { index } = this.info;
    return index.decls.filter((d) => index.byName.get(d.name) === d);
  }

  run(): ModuleDeclarations {
    const entries = this.entries();
    const infos: TypeNodeInfo[] = [];
    for (const entry of entries) {
      if (entry.kind === "type") infos.push(this.checkType(entry));
      else if (entry.kind === "error") infos.push(this.checkError(entry));
    }
    // A union alias may list a record that a later declaration defines, so the
    // table must hold every definition first.
    this.inferTags(infos);
    const guarded = this.checkCycles(infos);
    this.checkDepths(infos, guarded);
    this.checkDeferredFields();
    this.checkPrimitivePositions();
    for (const entry of entries) {
      if (entry.kind === "service") this.checkService(entry);
    }
    for (const entry of entries) {
      if (entry.kind === "provider") this.checkProvider(entry);
      else if (entry.kind === "const") this.checkConst(entry);
    }
    this.checkHostContracts();
    for (const entry of entries) {
      if (!entry.exported) continue;
      const prefix = entry.kind === "const" || entry.kind === "provider"
        ? "value"
        : entry.kind;
      this.exports.push(this.id(prefix, entry.name));
    }
    this.exports.sort(compareText);
    return {
      module: this.env.module,
      env: this.env,
      types: this.types,
      errors: this.errors,
      services: this.services,
      methodTypes: this.methodTypes,
      values: this.values,
      exports: this.exports,
      diagnostics: normalizeDiagnostics(this.sink),
    };
  }

  private checkHostContracts(): void {
    if (this.tree.mode !== "effi") return;
    const check = (type: Type, span: Span): void => {
      const ids = new Set<string>();
      referencedIds(type, ids);
      for (const id of ids) {
        if (isTypeId(id) && this.table.predicateOf(id) !== undefined) {
          this.lowerer.report(
            "declaration/018",
            "host interfaces must expose unrefined data; use a checked source entry",
            span,
          );
          return;
        }
        if (id.startsWith("service:")) {
          for (
            const method of this.env.services.get(id as ServiceId)?.methods ??
              []
          ) referencedIds(method.type, ids);
        }
        const body = isTypeId(id)
          ? this.table.aliasOf(id) ?? this.table.dataRecordOf(id)
          : isErrorId(id)
          ? this.table.errorRecordOf(id)
          : undefined;
        if (body !== undefined) referencedIds(typeToIr(this.table, body), ids);
      }
    };
    for (const declaration of this.types) {
      check({ kind: "named", id: declaration.id }, declaration.span);
    }
    for (const declaration of this.errors) {
      check({ kind: "record", fields: declaration.fields }, declaration.span);
    }
    for (const service of this.services) {
      for (const method of service.methods) check(method.type, method.span);
    }
    for (const signature of this.values.values()) {
      if (signature.kind === "provider") {
        check(signature.type.ir, signature.span);
      }
    }
  }

  /**
   * Rule R1: a primitive type node can occur only inside a type or error declaration.
   * The walk skips those declarations and the regions that the parser already reported.
   * A broken declaration is checked, because its annotations parsed.
   */
  private checkPrimitivePositions(): void {
    const { tree } = this;
    walk(tree, tree.root, (node) => {
      const kind = kindOf(tree, node);
      if (
        kind === SyntaxKind.TypeDecl || kind === SyntaxKind.ErrorDecl ||
        kind === SyntaxKind.Error
      ) return false;
      if (kind === SyntaxKind.LiteralType || this.isPrimitiveName(node)) {
        this.lowerer.report(
          "declaration/013",
          `the primitive type \`${
            nodeText(tree, node)
          }\` can occur only inside a type or error declaration`,
          nodeSpan(tree, node),
        );
      }
    });
  }

  /** True for a named type that resolves to string, int, number, or boolean. */
  private isPrimitiveName(node: NodeId): boolean {
    if (kindOf(this.tree, node) !== SyntaxKind.NamedType) return false;
    const nameNode = this.lowerer.kidsOfKind(node, SyntaxKind.Name)[0];
    if (nameNode === undefined) return false;
    const target = this.env.targets.get(nameNode);
    if (target?.kind !== "builtin-type") return false;
    const name = target.name;
    switch (name) {
      case "string":
      case "int":
      case "number":
      case "boolean":
        return true;
      case "void":
      case "never":
      case "unknown":
      case "Option":
      case "Ref":
      case "RetrySchedule":
      case "ScheduleInput":
      case "ScheduleMetadata":
      case "ScheduleDecision":
      case "Codec":
      case "Fiber":
      case "CloseableScope":
        return false;
      default: {
        const unreachable: never = name;
        return unreachable;
      }
    }
  }

  // -------------------------------------------------------------- types and errors

  private bodyOf(entry: DeclEntry): NodeId | undefined {
    return this.lowerer.kids(entry.node).find((k) =>
      k !== entry.nameNode && kindOf(this.tree, k) !== SyntaxKind.Error
    );
  }

  private checkType(entry: DeclEntry): TypeNodeInfo {
    const id = this.id("type", entry.name);
    const body = this.bodyOf(entry);
    const opaque = /^(?:export\s+)?opaque\s+type\b/.test(
      nodeText(this.tree, entry.node),
    );
    let definition: TypeDecl["definition"];
    let kind: "alias" | "brand" = "alias";
    let literal: LoweredField[] | undefined;
    let record = false;
    let predicate: TypeDecl["predicate"];
    const refinement = this.lowerer.kidsOfKind(
      entry.node,
      SyntaxKind.RefinementClause,
    )[0];
    if (opaque) {
      this.table.defineOpaque(id);
      definition = {
        kind: "nominal",
        base: { kind: "primitive", name: "unknown" },
      };
      kind = "brand";
    } else {
      // A literal record keeps its field spans, for the tag checks.
      literal = body !== undefined &&
          kindOf(this.tree, body) === SyntaxKind.RecordType
        ? this.lowerer.fields(body, false)
        : undefined;
      const lowered = body === undefined
        ? this.lowerer.errorLowered()
        : literal !== undefined
        ? this.lowerer.recordOf(literal)
        : this.lowerer.lower(body);
      if (body !== undefined && this.hasIdentity(lowered.ref)) {
        if (refinement !== undefined) {
          const compiled = predicateFromSource(
            this.tree,
            refinement,
            this.table,
            lowered.ref,
          );
          if (compiled.ok) predicate = compiled.value;
          else {
            this.lowerer.report(
              "declaration/018",
              compiled.error.message,
              compiled.error.span,
            );
          }
        }
        this.table.defineIdentity(
          id,
          lowered.ref,
          entry.sealed,
          false,
          predicate,
        );
        record = lowered.ir.kind === "record";
        definition = {
          kind: "nominal",
          base: lowered.ir,
          ...(entry.sealed ? { sealed: true } : {}),
        };
      } else {
        this.table.defineAlias(id, lowered.ref);
        if (refinement !== undefined) {
          this.lowerer.report(
            "declaration/018",
            `the transparent alias \`${entry.name}\` cannot have a refinement`,
            nodeSpan(this.tree, refinement),
          );
        }
        if (
          entry.sealed && body !== undefined &&
          this.table.node(lowered.ref).kind !== "error"
        ) {
          this.lowerer.report(
            "declaration/017",
            `\`sealed\` needs a type with identity, and the body of \`${entry.name}\` is a union with a non-literal member or a bare name`,
            entry.nameSpan,
          );
        }
        definition = { kind: "alias", type: lowered.ir };
      }
    }
    this.types.push({
      kind: "type",
      id,
      name: entry.name,
      definition,
      ...(predicate === undefined ? {} : { predicate }),
      ...(opaque ? { opaque: true } : {}),
      span: entry.span,
    });
    const refs = new Set<string>();
    referencedIds(
      definition.kind === "alias" ? definition.type : definition.base,
      refs,
    );
    if (record) {
      this.recordIdentities.push({
        entry,
        id,
        index: this.types.length - 1,
        literal,
        span: nodeSpan(this.tree, body ?? entry.node),
      });
    }
    return {
      id,
      name: entry.name,
      nameSpan: entry.nameSpan,
      start: entry.span.start,
      kind,
      refs,
    };
  }

  /**
   * A `type` body gives identity unless it is a union with a non-literal
   * member, a bare name, or the error type. A record gives identity, and a
   * union alias of the module may tag it.
   */
  private hasIdentity(body: TypeRef): boolean {
    const node = this.table.node(body);
    switch (node.kind) {
      case "named":
      case "error":
        return false;
      case "union":
        return node.members.every((m) => this.table.node(m).kind === "literal");
      default:
        return true;
    }
  }

  /**
   * A record identity of this module gets a tag when a transparent union alias
   * of this module lists it, through transparent aliases. Every member of the
   * union must be a record identity of this module, a tagged record of another
   * module, or an error. Otherwise the union tags nothing. A tagged record gets
   * the tagged IR, the `_tag` check, and the field rules of a tagged record.
   */
  private inferTags(infos: TypeNodeInfo[]): void {
    const local = new Set(this.recordIdentities.map((r) => r.id));
    const tagged = new Set<TypeId>();
    for (const info of infos) {
      if (info.kind !== "alias" || this.table.isIdentity(info.id)) continue;
      const body = this.table.aliasOf(info.id);
      if (body === undefined || this.table.node(body).kind !== "union") {
        continue;
      }
      const members = flattenIdentityMembers(this.table, body).map((m) =>
        this.table.node(m)
      );
      const ok = members.every((n) =>
        n.kind === "named" &&
        (isErrorId(n.id) ||
          (isTypeId(n.id) &&
            (local.has(n.id) || this.table.dataRecordOf(n.id) !== undefined)))
      );
      if (!ok) continue;
      for (const n of members) {
        if (n.kind === "named" && isTypeId(n.id) && local.has(n.id)) {
          tagged.add(n.id);
        }
      }
    }
    for (const record of this.recordIdentities) {
      if (!tagged.has(record.id)) continue;
      const at = infos.findIndex((info) => info.id === record.id);
      const { name, nameSpan, start, refs } = infos[at];
      infos[at] = { name, nameSpan, start, refs, kind: "data", id: record.id };
      this.tagRecord(record);
    }
  }

  /** Marks a record identity as tagged, and applies the rules for the fields of a tagged record. */
  private tagRecord(record: RecordIdentity): void {
    const { entry, id, literal, span } = record;
    const declaration = this.types[record.index];
    const definition = declaration.definition;
    if (definition.kind !== "nominal") return;
    const aliased = this.table.aliasOf(id);
    if (aliased === undefined) return;
    const node = this.table.node(aliased);
    let body = aliased;
    let base = definition.base;
    if (node.kind === "record" && node.fields.some((f) => f.name === "_tag")) {
      this.lowerer.report(
        "declaration/009",
        "the field name `_tag` is reserved for generated tags",
        literal?.find((f) => f.name === "_tag")?.span ?? span,
      );
      // The record loses the reserved field, so its uses report nothing more.
      body = this.table.record(node.fields.filter((f) => f.name !== "_tag"));
      if (base.kind === "record") {
        base = {
          kind: "record",
          fields: base.fields.filter((f) => f.name !== "_tag"),
        };
      }
    }
    this.table.defineTagged(
      id,
      body,
      entry.sealed,
      this.table.predicateOf(id),
    );
    if (literal !== undefined) {
      for (const field of literal) {
        if (field.name === "_tag") continue;
        this.nominalFields.push({
          subject: `the field \`${field.name}\``,
          ref: field.type.ref,
          span: field.typeSpan,
        });
      }
    } else {
      this.nominalFields.push({
        subject: `the body of \`${entry.name}\``,
        ref: this.table.aliasOf(id) ?? this.table.error,
        span,
      });
    }
    this.types[record.index] = {
      ...declaration,
      definition: {
        kind: "nominal",
        base,
        tagged: true,
        ...(entry.sealed ? { sealed: true } : {}),
      },
    };
  }

  private checkError(entry: DeclEntry): TypeNodeInfo {
    const id = this.id("error", entry.name);
    const record =
      this.lowerer.kidsOfKind(entry.node, SyntaxKind.RecordType)[0];
    const fields = record === undefined
      ? []
      : this.lowerer.fields(record, true);
    for (const field of fields) {
      this.nominalFields.push({
        subject: `the field \`${field.name}\``,
        ref: field.type.ref,
        span: field.typeSpan,
      });
    }
    this.table.defineError(
      id,
      record === undefined
        ? this.table.error
        : this.lowerer.recordOf(fields).ref,
    );
    this.errors.push({
      kind: "error",
      id,
      name: entry.name,
      fields: fields.map(toIrField),
      span: entry.span,
    });
    const refs = new Set<string>();
    for (const field of fields) referencedIds(field.type.ir, refs);
    return {
      id,
      name: entry.name,
      nameSpan: entry.nameSpan,
      start: entry.span.start,
      kind: "error",
      refs,
    };
  }

  /**
   * Version 0 rejects recursive type definitions. Finds the strongly connected
   * components of the reference graph, reports one diagnostic for each cycle, and
   * redefines its aliases and brands as the error type so that compatibility ends.
   * Returns the aliases that stay as guarded records.
   */
  private checkCycles(typeInfos: readonly TypeNodeInfo[]): Set<TypeId> {
    const guardedAliases = new Set<TypeId>();
    const infos = new Map<string, TypeNodeInfo>();
    for (const info of typeInfos) infos.set(info.id, info);
    // The search starts from the declarations in source order, and follows the
    // references of each one in text order.
    const nodes = [...infos.values()];
    const indexOfId = new Map<string, number>();
    nodes.forEach((node, n) => indexOfId.set(node.id, n));
    const edges = nodes.map((node) =>
      [...node.refs].sort(compareText).flatMap((ref) => {
        const target = indexOfId.get(ref);
        return target === undefined ? [] : [target];
      })
    );
    const components: TypeNodeInfo[][] = [];
    for (const members of stronglyConnectedComponents(nodes.length, edges)) {
      const component = members.map((n) => nodes[n]);
      const selfLoop = component.length === 1 &&
        component[0].refs.has(component[0].id);
      if (component.length > 1 || selfLoop) components.push(component);
    }

    for (const component of components) {
      component.sort((a, b) => a.start - b.start);
      const first = component[0];
      if (this.guardedDataGroup(component)) continue;
      if (component.length === 1 && first.kind === "alias") {
        const declaration = this.types.find((d) => d.id === first.id);
        const aliased = this.table.aliasOf(first.id);
        const definition = declaration?.definition;
        // An untagged record identity is a guarded alias like a record alias.
        const body = definition?.kind === "alias"
          ? definition.type
          : definition?.kind === "nominal"
          ? definition.base
          : undefined;
        if (
          body !== undefined &&
          guardedRecord(
            body,
            first.id,
            (type) => this.literalTag(type),
          ) &&
          aliased !== undefined &&
          dataOnly(this.table, aliased, "schema")
        ) {
          guardedAliases.add(first.id);
          if (definition?.kind === "nominal") {
            this.table.defineIdentity(
              first.id,
              aliased,
              definition.sealed === true,
              true,
              this.table.predicateOf(first.id),
            );
          } else this.table.defineAlias(first.id, aliased, true);
          continue;
        }
      }
      const names = component.map((m) => m.name);
      this.lowerer.report(
        "declaration/007",
        component.length === 1
          ? `the type \`${first.name}\` is defined in terms of itself`
          : `recursive type definition: ${names.join(" -> ")} -> ${names[0]}`,
        first.nameSpan,
        component.slice(1).map((m) => ({
          span: m.nameSpan,
          message: "also part of the cycle",
        })),
      );
      for (const member of component) {
        if (member.kind === "alias" || member.kind === "brand") {
          this.table.defineAlias(member.id, this.table.error);
        }
      }
    }
    return guardedAliases;
  }

  /**
   * Rule 11: a cycle that has a tagged record, and only such types and aliases, is
   * legal when no cycle is made of aliases alone and every cycle passes through
   * an `Option`, an array, an optional field, or a union that has a member
   * outside the group.
   */
  private guardedDataGroup(component: readonly TypeNodeInfo[]): boolean {
    if (!component.some((m) => m.kind === "data")) return false;
    if (component.some((m) => m.kind !== "data" && m.kind !== "alias")) {
      return false;
    }
    const roots = component.map((m): Type[] => {
      const declaration = this.types.find((d) => d.id === m.id);
      const definition = declaration?.definition;
      // The record keeps the optional flag of each field.
      if (definition?.kind === "nominal") return [definition.base];
      return definition?.kind === "alias" ? [definition.type] : [];
    });
    return recursionIsGuarded(
      component.map((m) => ({ id: m.id, data: m.kind === "data" })),
      roots,
    );
  }

  /**
   * The string value of a tag field type: an inline string literal, or a name
   * that reaches one through literal aliases. The table holds every definition
   * before the cycle analysis, and a repeated name stops an alias cycle.
   */
  private literalTag(type: Type): string | undefined {
    if (type.kind === "literal") {
      return typeof type.value === "string" ? type.value : undefined;
    }
    if (type.kind !== "named") return undefined;
    const seen = new Set<string>();
    let id: TypeId | ErrorId = type.id;
    while (!isErrorId(id) && !seen.has(id)) {
      seen.add(id);
      const target = this.table.aliasOf(id);
      if (target === undefined) return undefined;
      const node = this.table.node(target);
      if (node.kind === "literal") {
        return typeof node.value === "string" ? node.value : undefined;
      }
      if (node.kind !== "named") return undefined;
      id = node.id;
    }
    return undefined;
  }

  /**
   * A type declaration whose alias is nested deeper than `MAX_TYPE_DEPTH`
   * levels, counting the levels inside its aliases, gets `declaration/012`. The
   * alias becomes the error type, so a later comparison never walks the chain.
   * The walk has a budget, so a cycle cannot loop.
   */
  private checkDepths(
    typeInfos: readonly TypeNodeInfo[],
    guardedAliases: ReadonlySet<TypeId>,
  ): void {
    const memo = new Map<TypeRef, number>();
    for (const info of typeInfos) {
      if (info.kind !== "alias") continue;
      if (guardedAliases.has(info.id)) continue;
      const body = this.table.aliasOf(info.id);
      if (body === undefined) continue;
      if (!this.table.exceedsDepth(body, MAX_TYPE_DEPTH, memo)) continue;
      this.lowerer.report(
        "declaration/012",
        `the type \`${info.name}\` is nested deeper than ${MAX_TYPE_DEPTH} levels, counting the levels inside its aliases`,
        info.nameSpan,
      );
      this.table.defineAlias(info.id, this.table.error);
    }
  }

  /**
   * A tagged record or error field cannot hold a function, deferred, or opaque type, at
   * any depth, after aliases unfold. The emitter has no schema for one. The
   * check runs after every alias is defined, so a field may name a later alias.
   */
  private checkDeferredFields(): void {
    for (const field of this.nominalFields) {
      if (containsDeferredType(this.table, field.ref)) {
        this.lowerer.report(
          "declaration/015",
          `${field.subject} has a function or deferred type, which a tagged record or error declaration cannot hold`,
          field.span,
        );
      } else if (containsOpaqueType(this.table, field.ref)) {
        this.lowerer.report(
          "declaration/016",
          `${field.subject} has an opaque type, which has no schema`,
          field.span,
        );
      }
    }
  }

  // -------------------------------------------------------------- services and providers

  private checkService(entry: DeclEntry): void {
    const id = this.id("service", entry.name);
    const methods: MethodDecl[] = [];
    for (const method of entry.methodList) {
      if (entry.methods.get(method.name) !== method) continue;
      const parts = this.lowerer.kids(method.node);
      const paramList = parts.find((k) =>
        kindOf(this.tree, k) === SyntaxKind.ParamList
      );
      const parameters = paramList === undefined
        ? []
        : this.lowerer.parameters(paramList);
      for (const parameter of parameters) {
        if (parameter.borrow) {
          if (this.tree.mode !== "effi") {
            this.lowerer.report(
              "type-mismatch/010",
              "a service borrow parameter belongs in a host interface",
              parameter.span,
            );
          }
          const ref = this.table.node(this.table.unfold(parameter.type.ref));
          if (
            ref.kind !== "named" || !isTypeId(ref.id) ||
            !this.table.isOpaque(ref.id)
          ) {
            this.lowerer.report(
              "type-mismatch/010",
              "borrow parameters need an opaque type",
              parameter.span,
            );
          }
        }
      }
      const resultNode = parts.find((k) =>
        k !== method.nameNode && k !== paramList &&
        kindOf(this.tree, k) !== SyntaxKind.FailsClause
      );
      const result = resultNode === undefined
        ? this.lowerer.errorLowered()
        : this.lowerer.lower(resultNode);
      const failures = this.lowerer.failures(
        parts.find((k) => kindOf(this.tree, k) === SyntaxKind.FailsClause),
      );
      const type = this.lowerer.functionOf(
        "effect",
        parameters.map((p) => p.type),
        result,
        failures,
        [],
      );
      const capability: CapabilityId =
        `cap:${this.env.module}#${entry.name}.${method.name}`;
      this.methodTypes.set(capability, type.ref);
      methods.push({
        id: capability,
        name: method.name,
        type: type.ir,
        ...(parameters.some((p) => p.borrow)
          ? { borrows: parameters.map((p) => p.borrow) }
          : {}),
        span: method.span,
      });
    }
    const declaration: ServiceDecl = {
      kind: "service",
      id,
      name: entry.name,
      methods,
      span: entry.span,
    };
    this.services.push(declaration);
    this.env.services.set(id, declaration);
  }

  private checkProvider(entry: DeclEntry): void {
    const id = this.id("value", entry.name);
    const parts = this.lowerer.kids(entry.node);
    const provides: CapabilityId[] = [];
    for (
      const clause of parts.filter((k) =>
        kindOf(this.tree, k) === SyntaxKind.ProvidesClause
      )
    ) {
      for (
        const qn of this.lowerer.kidsOfKind(clause, SyntaxKind.QualifiedName)
      ) {
        provides.push(...this.lowerer.capabilitiesOf(qn));
      }
    }
    const failures = this.lowerer.failures(
      parts.find((k) => kindOf(this.tree, k) === SyntaxKind.FailsClause),
    );
    const requirements = this.lowerer.requirements(
      parts.find((k) => kindOf(this.tree, k) === SyntaxKind.UsesClause),
    );
    const signature: ProviderSignature = {
      kind: "provider",
      id,
      ...this.base(entry),
      provides: sortedUnique(provides),
      failures,
      requirements,
      type: this.lowerer.providerOf(provides, failures, requirements),
    };
    this.values.set(id, signature);
  }

  // -------------------------------------------------------------- consts

  private base(entry: DeclEntry): SignatureBase {
    return {
      name: entry.name,
      exported: entry.exported,
      node: entry.node,
      nameNode: entry.nameNode,
      span: entry.span,
      nameSpan: entry.nameSpan,
    };
  }

  private checkConst(entry: DeclEntry): void {
    const id = this.id("value", entry.name);
    const rest = this.lowerer.kids(entry.node).filter((k) =>
      k !== entry.nameNode
    );
    const bindingNode = rest.find((k) => isTypeKind(kindOf(this.tree, k)));
    const init = initOf(this.tree, entry.node, entry.nameNode);
    const binding = bindingNode === undefined
      ? undefined
      : this.lowerer.lower(bindingNode);
    if (
      init !== undefined && kindOf(this.tree, init) === SyntaxKind.ArrowExpr
    ) {
      this.values.set(id, this.functionSignature(entry, id, init, binding));
      return;
    }
    if (entry.exported && bindingNode === undefined && !entry.broken) {
      this.lowerer.report(
        "declaration/006",
        `the exported constant \`${entry.name}\` needs a type annotation`,
        entry.nameSpan,
      );
    }
    this.values.set(id, {
      kind: "constant",
      id,
      ...this.base(entry),
      type: binding,
    });
  }

  private functionSignature(
    entry: DeclEntry,
    id: ValueId,
    arrow: NodeId,
    binding: Lowered | undefined,
  ): FunctionSignature {
    const lowerer = this.lowerer;
    const parts = lowerer.kids(arrow);
    const paramList = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.ParamList
    );
    const resultNode = parts.find((k) => isTypeKind(kindOf(this.tree, k)));
    const failsNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.FailsClause
    );
    const usesNode = parts.find((k) =>
      kindOf(this.tree, k) === SyntaxKind.UsesClause
    );
    const written = paramList === undefined
      ? []
      : lowerer.parameters(paramList);

    // A binding type annotation that is a function type of the same arity supplies
    // the types that the arrow does not write.
    let bindingFn: {
      type: FunctionType;
      parameters: readonly TypeRef[];
      result: TypeRef;
    } | undefined;
    const bindingFunction = binding === undefined
      ? undefined
      : this.functionOfBinding(binding);
    if (
      bindingFunction !== undefined &&
      bindingFunction.node.parameters.length === written.length
    ) {
      bindingFn = {
        type: bindingFunction.ir,
        parameters: bindingFunction.node.parameters,
        result: bindingFunction.node.result,
      };
    }
    const parameters: ParameterSignature[] = written.map((p, i) => {
      if (p.annotated || bindingFn === undefined) return p;
      return {
        ...p,
        type: {
          ref: bindingFn.parameters[i],
          ir: bindingFn.type.parameters[i],
        },
      };
    });
    const explicit = resultNode !== undefined || bindingFn !== undefined;
    let result: Lowered | undefined;
    let failures: ErrorId[] = [];
    let requirements: CapabilityId[] = [];
    let annotation: FunctionSignature["annotation"] = "none";
    // A binding type is a type, so it closes every part. An exported function
    // closes both sets: an omitted clause is an empty set.
    let closedParts: WrittenParts = {
      result: false,
      fails: false,
      uses: false,
    };
    if (resultNode !== undefined) {
      result = lowerer.lower(resultNode);
      annotation = "arrow";
      closedParts = { result: true, fails: false, uses: false };
    } else if (bindingFn !== undefined) {
      result = { ref: bindingFn.result, ir: bindingFn.type.result };
      failures = [...bindingFn.type.effects.failures];
      requirements = [...bindingFn.type.effects.requirements];
      annotation = "binding";
      closedParts = { result: true, fails: true, uses: true };
    }
    if (annotation !== "binding") {
      const closed = entry.exported || bindingFn !== undefined;
      closedParts = {
        ...closedParts,
        fails: failsNode !== undefined || closed,
        uses: usesNode !== undefined || closed,
      };
      if (closedParts.fails) failures = lowerer.failures(failsNode);
      if (closedParts.uses) requirements = lowerer.requirements(usesNode);
    }

    if (!entry.broken && binding !== undefined) {
      this.checkBindingFits(arrow, binding, parameters, result, {
        failures,
        requirements,
      }, entry.exported);
    }
    if (!entry.broken) {
      if (entry.exported) {
        if (!explicit) {
          lowerer.report(
            "declaration/005",
            `the exported function \`${entry.name}\` needs a result annotation`,
            entry.nameSpan,
          );
        }
      }
    }
    return {
      kind: "function",
      id,
      ...this.base(entry),
      written: closedParts,
      annotation,
      parameters,
      result,
      failures,
      requirements,
      ...(bindingFn?.type.execution === "pure"
        ? { expectedExecution: "pure" as const }
        : {}),
    };
  }

  /**
   * The function type of a binding annotation, seen through alias names. A
   * written function type keeps its lowered IR, which holds the source order and
   * schema make inputs that `toIr` does not.
   */
  private functionOfBinding(
    binding: Lowered,
  ): { node: FunctionNode; ir: FunctionType } | undefined {
    const ref = this.table.unfold(binding.ref);
    const node = this.table.node(ref);
    if (node.kind !== "function") return undefined;
    const ir = binding.ir.kind === "function"
      ? binding.ir
      : typeToIr(this.table, ref);
    return ir.kind === "function" ? { node, ir } : undefined;
  }

  /**
   * The arrow of an annotated binding must fit the binding type. The arrow takes
   * the execution of the binding type, because its body decides its own mode later.
   */
  private checkBindingFits(
    arrow: NodeId,
    binding: Lowered,
    parameters: readonly ParameterSignature[],
    result: Lowered | undefined,
    effects: {
      failures: readonly ErrorId[];
      requirements: readonly CapabilityId[];
    },
    exported: boolean,
  ): void {
    const expected = showType(this.table, binding.ref);
    const fn = this.functionOfBinding(binding);
    if (fn === undefined) {
      this.lowerer.report(
        "type-mismatch/003",
        `the value is a function, but ${expected} is expected`,
        this.lowerer.span(arrow),
      );
      return;
    }
    if (result === undefined) {
      // The body infers the result. Only the arity can disagree here.
      if (parameters.length !== fn.ir.parameters.length) {
        this.lowerer.report(
          "type-mismatch/003",
          `the function takes ${parameters.length} parameters, but ${expected} is expected`,
          this.lowerer.span(arrow),
        );
      }
      return;
    }
    const found = this.table.function({
      execution: fn.ir.execution,
      parameters: parameters.map((p) => p.type.ref),
      checked: checkedInputFlags({ exported, parameters }, this.table),
      result: result.ref,
      failures: effects.failures,
      requirements: effects.requirements,
    });
    if (!this.table.isAssignableIn(this.env.module, found, binding.ref)) {
      this.lowerer.report(
        "type-mismatch/003",
        `the function has type ${
          showType(this.table, found)
        }, but ${expected} is expected`,
        this.lowerer.span(arrow),
      );
    }
  }
}

/**
 * Checks the declarations of one module. `imported` holds the type graphs of the
 * modules that this module reaches through its imports. The table registers their
 * definitions before it lowers any local type.
 */
export function checkModuleDeclarations(
  analysis: Analysis,
  module: string,
  table: TypeTable,
  imported: ReadonlyMap<string, TypeGraph>,
): ModuleDeclarations {
  const info = analysis.project.modules.get(module);
  const resolution = analysis.resolutions.get(module);
  if (info === undefined || resolution === undefined) {
    throw new Error(`module ${module} is not part of the analysis`);
  }
  const services = new Map<ServiceId, ServiceDecl>();
  for (const graph of imported.values()) {
    table.load(graph);
    for (const service of graph.services) services.set(service.id, service);
  }
  const env: TypeEnv = {
    module,
    tree: info.tree,
    targets: resolution.targets,
    table,
    services,
  };
  return new ModuleChecker(info, env).run();
}
