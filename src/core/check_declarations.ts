// The declaration level of the checker. It builds the declarations of a module:
// types, errors, services, providers, and the signatures of module-level consts.
// It reports the declaration diagnostics and does not look at expression bodies.
// The signature model is in signatures.ts, and the type lowering is in
// type_lower.ts. check_expr.ts checks the bodies, and check_project.ts drives the
// whole project.
import { emptyMap, emptySet, setFrom } from "./runtime.ts";
import type { ModuleResolution } from "./resolve.ts";
import { type Diagnostic, normalizeDiagnostics } from "./diagnostics.ts";
import type { DeclEntry } from "./declaration_index.ts";
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
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import { flattenIdentityMembers } from "./patterns.ts";
import { predicateFromSource } from "./predicate_source.ts";
import type { Predicate } from "./predicates.ts";
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
  TypeDepthMemo,
  type TypeNode,
  type TypeRef,
  type TypeTable,
} from "./types.ts";
import {
  guardedRecord,
  literalTagOf,
  recursionIsGuarded,
} from "./recursion_guard.ts";
import { referencedIds } from "./referenced_ids.ts";
import { loadGraph, typeToIr } from "./type_ir.ts";
import { showType } from "./type_show.ts";
import {
  capabilityId,
  declarationId,
  type DeclarationPrefix,
  isErrorId,
  isServiceId,
  isTypeId,
  type ModuleName,
} from "./ids.ts";
import {
  functionParts,
  initOf,
  isOpaqueTypeDecl,
  isTypeKind,
  kidsOf,
  kidsOfKind,
} from "./syntax_queries.ts";
import { compareText } from "./util.ts";
import {
  checkedInputFlags,
  type FunctionSignature,
  type Lowered,
  loweredFunction,
  type ModuleDeclarations,
  type ParameterSignature,
  type ProviderSignature,
  type SignatureBase,
  type TypeEnv,
  type TypeGraph,
  type ValueSignature,
} from "./signatures.ts";
import {
  isValuePrimitiveName,
  type LoweredField,
  toIrField,
  TypeLowerer,
} from "./type_lower.ts";
type FunctionNode = Extract<TypeNode, {
  readonly kind: "function";
}>;
type TypeNodeInfo =
  & {
    readonly name: string;
    readonly nameSpan: Span;
    readonly start: number;
    readonly refs: ReadonlySet<string>;
  }
  & ({
    readonly kind: "alias" | "identity" | "tagged";
    readonly id: TypeId;
  } | {
    readonly kind: "error";
    readonly id: ErrorId;
  });
/** A record declaration that waits for tag inference. */
type RecordIdentity = {
  readonly entry: DeclEntry;
  readonly id: TypeId;
  readonly index: number;
  readonly literal: readonly LoweredField[] | undefined;
  readonly span: Span;
};
/** The most levels that a type declaration may have, counting its aliases. */
const MAX_TYPE_DEPTH = 128;
type ModuleChecker = {
  readonly run: () => ModuleDeclarations;
};
function createModuleChecker(
  info: ModuleInfo,
  env: TypeEnv,
  servicesById: Map<ServiceId, ServiceDecl>,
): ModuleChecker {
  let checker: ModuleChecker;
  let serviceIndex = servicesById;
  const sink: Diagnostic[] = [];
  let lowerer = TypeLowerer(env, sink);
  const tree: SyntaxTree = env.tree;
  let table: TypeTable = env.table;
  const types: TypeDecl[] = [];
  const errors: ErrorDecl[] = [];
  const nominalFields: {
    readonly subject: string;
    readonly ref: TypeRef;
    readonly span: Span;
  }[] = [];
  const recordIdentities: RecordIdentity[] = [];
  const services: ServiceDecl[] = [];
  let methodTypes = emptyMap<CapabilityId, TypeRef>();
  let values = emptyMap<ValueId, ValueSignature>();
  let exports: DeclarationId[] = [];
  const infersExportedRequirements = info.index.imports.some((
    entry,
  ) => entry.role === "service");
  function declarationIdOf<P extends DeclarationPrefix>(
    prefix: P,
    name: string,
  ): `${P}:${string}` {
    return declarationId(prefix, env.module, name);
  }

  /** Returns the first declaration for each name. The resolver reports later declarations as duplicates. */
  function declarationEntries(): DeclEntry[] {
    const index = info.index;
    return index.decls.filter((d) => index.byName.get(d.name) === d);
  }
  function run(): ModuleDeclarations {
    const entries = declarationEntries();
    const infos: TypeNodeInfo[] = [];
    for (const entry of entries) {
      if (entry.kind === "type") {
        infos[infos.length] = checkType(entry);
      } else if (entry.kind === "error") {
        infos[infos.length] = checkError(entry);
      }
    }
    // A union alias may list a record that a later declaration defines, so the
    // table must hold every definition first.
    checker = inferTags(infos);
    const guarded = checkCycles(infos);
    checker = checkDepths(infos, guarded);
    checker = checkDeferredFields();
    checker = checkPrimitivePositions();
    for (const entry of entries) {
      if (entry.kind === "service") {
        checker = checkService(entry);
      }
    }
    for (const entry of entries) {
      if (entry.kind === "provider") {
        checker = checkProvider(entry);
      } else if (entry.kind === "const") {
        checker = checkConst(entry);
      }
    }
    checker = checkHostContracts();
    for (const entry of entries) {
      if (!entry.exported) {
        continue;
      }
      const prefix = entry.kind === "const" || entry.kind === "provider"
        ? "value"
        : entry.kind;
      exports[exports.length] = declarationIdOf(prefix, entry.name);
    }
    exports = exports.sort(compareText);
    return {
      module: env.module,
      env: env,
      types: types,
      errors: errors,
      services: services,
      methodTypes: methodTypes,
      values: values,
      exports: exports,
      diagnostics: normalizeDiagnostics(sink),
    };
  }
  function checkHostContracts(): ModuleChecker {
    if (tree.mode !== "effi") {
      return checker;
    }
    function check(type: Type, span: Span): ModuleChecker {
      let ids = emptySet<string>();
      ids = referencedIds(type, ids);
      for (const id of ids) {
        if (isTypeId(id) && table.predicateOf(id) !== undefined) {
          lowerer = lowerer.report(
            "declaration/018",
            "host interfaces must expose unrefined data; use a checked source entry",
            span,
            undefined,
          );
          return checker;
        }
        if (isServiceId(id)) {
          for (
            const method of env.services.get(id)?.methods ??
              []
          ) {
            ids = referencedIds(method.type, ids);
          }
        }
        const body = table.declaredBodyOf(id);
        if (body !== undefined) {
          ids = referencedIds(typeToIr(table, body), ids);
        }
      }
      return checker;
    }
    for (const declaration of types) {
      checker = check(
        { kind: "named", id: declaration.id },
        declaration.span,
      );
    }
    for (const declaration of errors) {
      checker = check(
        { kind: "record", fields: declaration.fields },
        declaration.span,
      );
    }
    for (const service of services) {
      for (const method of service.methods) {
        checker = check(method.type, method.span);
      }
    }
    for (const signature of values.values()) {
      if (signature.kind === "provider") {
        checker = check(signature.type.ir, signature.span);
      }
    }
    return checker;
  }

  /** Checks that primitive type nodes occur only inside type or error declarations. */
  function checkPrimitivePositions(): ModuleChecker {
    return walk(tree, tree.root, (node) => {
      const kind = kindOf(tree, node);
      if (
        kind === SyntaxKind.TypeDecl || kind === SyntaxKind.ErrorDecl ||
        kind === SyntaxKind.Error
      ) {
        return false;
      }
      if (
        kind === SyntaxKind.LiteralType || isPrimitiveName(node)
      ) {
        lowerer = lowerer.report(
          "declaration/013",
          `the primitive type \`${
            nodeText(tree, node)
          }\` can occur only inside a type or error declaration`,
          nodeSpan(tree, node),
          undefined,
        );
      }
    }) ?? checker;
  }

  /** Returns true when a named type resolves to a value primitive. */
  function isPrimitiveName(node: NodeId): boolean {
    if (kindOf(tree, node) !== SyntaxKind.NamedType) {
      return false;
    }
    const nameNode = kidsOfKind(tree, node, SyntaxKind.Name)[0];
    if (nameNode === undefined) {
      return false;
    }
    const target = env.targets.get(nameNode);
    if (target?.kind !== "builtin-type") {
      return false;
    }
    return isValuePrimitiveName(target.name);
  }

  function checkType(entry: DeclEntry): TypeNodeInfo {
    const id = declarationIdOf("type", entry.name);
    const body = kidsOf(tree, entry.node).find((k) =>
      k !== entry.nameNode && kindOf(tree, k) !== SyntaxKind.Error
    );
    const opaque = isOpaqueTypeDecl(tree, entry.node);
    let definition: TypeDecl["definition"];
    let kind: "alias" | "identity" = "alias";
    let literal: LoweredField[] | undefined;
    let record = false;
    let predicate: TypeDecl["predicate"];
    const refinement =
      kidsOfKind(tree, entry.node, SyntaxKind.RefinementClause)[0];
    if (opaque) {
      table = table.defineOpaque(id);
      definition = {
        kind: "nominal",
        base: { kind: "primitive", name: "unknown" },
      };
      kind = "identity";
    } else {
      // A literal record keeps its field spans, for the tag checks.
      literal = body !== undefined &&
          kindOf(tree, body) === SyntaxKind.RecordType
        ? lowerer.fields(body, false)
        : undefined;
      let lowered: Lowered;
      if (body === undefined) {
        lowered = lowerer.errorLowered();
      } else if (literal !== undefined) {
        lowered = lowerer.recordOf(literal);
      } else {
        lowered = lowerer.lower(body);
      }
      if (body !== undefined && hasIdentity(lowered.ref)) {
        if (refinement !== undefined) {
          const compiled = predicateFromSource(
            tree,
            refinement,
            table,
            lowered.ref,
          );
          if (compiled.ok) {
            predicate = compiled.value;
          } else {
            lowerer = lowerer.report(
              "declaration/018",
              compiled.error.message,
              compiled.error.span,
              undefined,
            );
          }
        }
        table = table.defineIdentity(
          id,
          lowered.ref,
          entry.sealed,
          false,
          predicate,
        );
        record = lowered.ir.kind === "record";
        definition = {
          ...(entry.sealed ? { sealed: true as const } : {}),
          kind: "nominal",
          base: lowered.ir,
        };
      } else {
        table = table.defineAlias(
          id,
          lowered.ref,
          false,
        );
        if (refinement !== undefined) {
          lowerer = lowerer.report(
            "declaration/018",
            `the transparent alias \`${entry.name}\` cannot have a refinement`,
            nodeSpan(tree, refinement),
            undefined,
          );
        }
        if (
          entry.sealed && body !== undefined &&
          table.node(lowered.ref).kind !== "error"
        ) {
          lowerer = lowerer.report(
            "declaration/017",
            `\`sealed\` needs a type with identity, and the body of \`${entry.name}\` is a union with a non-literal member or a bare name`,
            entry.nameSpan,
            undefined,
          );
        }
        definition = { kind: "alias", type: lowered.ir };
      }
    }
    let declarationOptions: {
      readonly predicate?: Predicate;
      readonly opaque?: true;
    } = predicate === undefined ? {} : { predicate: predicate };
    if (opaque) {
      declarationOptions = predicate === undefined
        ? { opaque: true }
        : { predicate: predicate, opaque: true };
    }
    types[types.length] = {
      ...declarationOptions,
      kind: "type",
      id: id,
      name: entry.name,
      definition: definition,
      span: entry.span,
    };
    let refs = emptySet<string>();
    refs = referencedIds(
      definition.kind === "alias" ? definition.type : definition.base,
      refs,
    );
    if (record) {
      recordIdentities[recordIdentities.length] = {
        entry: entry,
        id: id,
        index: types.length - 1,
        literal: literal,
        span: nodeSpan(tree, body ?? entry.node),
      };
    }
    return {
      id: id,
      name: entry.name,
      nameSpan: entry.nameSpan,
      start: entry.span.start,
      kind: kind,
      refs: refs,
    };
  }

  /** Returns true when the type body gives the declaration an identity. */
  function hasIdentity(body: TypeRef): boolean {
    const node = table.node(body);
    if (node.kind === "named" || node.kind === "error") {
      return false;
    }
    if (node.kind === "union") {
      return node.members.every((m) => table.node(m).kind === "literal");
    }
    return true;
  }

  /** Adds tags to local record identities that a valid transparent union lists. */
  function inferTags(infos: TypeNodeInfo[]): ModuleChecker {
    const local = setFrom(recordIdentities.map((r) => r.id));
    let tagged = emptySet<TypeId>();
    for (const info of infos) {
      if (info.kind !== "alias" || table.isIdentity(info.id)) {
        continue;
      }
      const body = table.aliasOf(info.id);
      if (
        body === undefined || table.node(body).kind !== "union"
      ) {
        continue;
      }
      const members = flattenIdentityMembers(table, body).map((
        m,
      ) => table.node(m));
      const ok = members.every((n) =>
        n.kind === "named" &&
        (isErrorId(n.id) ||
          (isTypeId(n.id) &&
            (local.has(n.id) ||
              table.taggedRecordOf(n.id) !== undefined)))
      );
      if (!ok) {
        continue;
      }
      for (const n of members) {
        if (n.kind === "named" && isTypeId(n.id) && local.has(n.id)) {
          tagged = tagged.add(n.id);
        }
      }
    }
    for (const record of recordIdentities) {
      if (!tagged.has(record.id)) {
        continue;
      }
      const at = infos.findIndex((info) => info.id === record.id);
      infos[at] = { ...infos[at], kind: "tagged", id: record.id };
      checker = tagRecord(record);
    }
    return checker;
  }

  /** Marks one record identity as tagged and checks its fields. */
  function tagRecord(record: RecordIdentity): ModuleChecker {
    const entry = record.entry;
    const id = record.id;
    const literal = record.literal;
    const span = record.span;
    const declaration = types[record.index];
    const definition = declaration.definition;
    if (definition.kind !== "nominal") {
      return checker;
    }
    const aliased = table.aliasOf(id);
    if (aliased === undefined) {
      return checker;
    }
    const node = table.node(aliased);
    let body = aliased;
    let base = definition.base;
    if (node.kind === "record" && node.fields.some((f) => f.name === "_tag")) {
      lowerer = lowerer.report(
        "declaration/009",
        "the field name `_tag` is reserved for generated tags",
        literal?.find((f) => f.name === "_tag")?.span ?? span,
        undefined,
      );
      // The record loses the reserved field, so its uses report nothing more.
      body = table.record(
        node.fields.filter((f) => f.name !== "_tag"),
      );
      if (base.kind === "record") {
        base = {
          kind: "record",
          fields: base.fields.filter((f) => f.name !== "_tag"),
        };
      }
    }
    table = table.defineTagged(
      id,
      body,
      entry.sealed,
      table.predicateOf(id),
    );
    if (literal !== undefined) {
      for (const field of literal) {
        if (field.name === "_tag") {
          continue;
        }
        nominalFields[nominalFields.length] = {
          subject: `the field \`${field.name}\``,
          ref: field.type.ref,
          span: field.typeSpan,
        };
      }
    } else {
      nominalFields[nominalFields.length] = {
        subject: `the body of \`${entry.name}\``,
        ref: table.aliasOf(id) ?? table.error,
        span: span,
      };
    }
    types[record.index] = {
      ...declaration,
      definition: {
        ...(entry.sealed ? { sealed: true as const } : {}),
        kind: "nominal",
        base: base,
        tagged: true,
      },
    };
    return checker;
  }
  function checkError(entry: DeclEntry): TypeNodeInfo {
    const id = declarationIdOf("error", entry.name);
    const record = kidsOfKind(tree, entry.node, SyntaxKind.RecordType)[0];
    const fields = record === undefined ? [] : lowerer.fields(record, true);
    for (const field of fields) {
      nominalFields[nominalFields.length] = {
        subject: `the field \`${field.name}\``,
        ref: field.type.ref,
        span: field.typeSpan,
      };
    }
    table = table.defineError(
      id,
      record === undefined ? table.error : lowerer.recordOf(fields).ref,
    );
    errors[errors.length] = {
      kind: "error",
      id: id,
      name: entry.name,
      fields: fields.map(toIrField),
      span: entry.span,
    };
    let refs = emptySet<string>();
    for (const field of fields) {
      refs = referencedIds(field.type.ir, refs);
    }
    return {
      id: id,
      name: entry.name,
      nameSpan: entry.nameSpan,
      start: entry.span.start,
      kind: "error",
      refs: refs,
    };
  }

  /** Reports unguarded recursive definitions. Returns aliases that remain guarded records. */
  function checkCycles(
    typeInfos: readonly TypeNodeInfo[],
  ): ReadonlySet<TypeId> {
    let guardedAliases = emptySet<TypeId>();
    // The search starts from the declarations in source order, and follows the
    // references of each one in text order.
    const nodes = typeInfos;
    let indexOfId = emptyMap<string, number>();
    for (const indexedNode of nodes.entries()) {
      const n = indexedNode[0];
      const node = indexedNode[1];
      indexOfId = indexOfId.set(node.id, n);
    }
    const edges = nodes.map((node) =>
      [...node.refs].sort(compareText).flatMap((ref) => {
        const target = indexOfId.get(ref);
        return target === undefined ? [] : [target];
      })
    );
    const components: TypeNodeInfo[][] = [];
    for (const members of stronglyConnectedComponents(nodes.length, edges)) {
      const component = members.map((n) => nodes[n]);
      if (isCycle(members, edges)) {
        components[components.length] = component;
      }
    }
    for (let component of components) {
      component = component.sort((a, b) => a.start - b.start);
      const first = component[0];
      if (guardedDataGroup(component)) {
        continue;
      }
      if (component.length === 1 && first.kind === "alias") {
        const declaration = types.find((d) => d.id === first.id);
        const aliased = table.aliasOf(first.id);
        const definition = declaration?.definition;
        // An untagged record identity is a guarded alias like a record alias.
        let body: Type | undefined;
        if (definition?.kind === "alias") {
          body = definition.type;
        } else if (definition?.kind === "nominal") {
          body = definition.base;
        }
        if (
          body !== undefined &&
          guardedRecord(
            body,
            first.id,
            (type) => literalTag(type),
          ) &&
          aliased !== undefined &&
          dataOnly(table, aliased, "schema", false)
        ) {
          guardedAliases = guardedAliases.add(first.id);
          if (definition?.kind === "nominal") {
            table = table.defineIdentity(
              first.id,
              aliased,
              typeof definition.sealed === "boolean" && definition.sealed,
              true,
              table.predicateOf(first.id),
            );
          } else {
            table = table.defineAlias(
              first.id,
              aliased,
              true,
            );
          }
          continue;
        }
      }
      const names = component.map((m) => m.name);
      lowerer = lowerer.report(
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
        if (member.kind === "alias" || member.kind === "identity") {
          table = table.defineAlias(
            member.id,
            table.error,
            false,
          );
        }
      }
    }
    return guardedAliases;
  }

  /** Returns true when every cycle in a tagged data group passes through a recursion guard. */
  function guardedDataGroup(
    component: readonly TypeNodeInfo[],
  ): boolean {
    if (!component.some((m) => m.kind === "tagged")) {
      return false;
    }
    if (component.some((m) => m.kind !== "tagged" && m.kind !== "alias")) {
      return false;
    }
    const roots = component.map((m): Type[] => {
      const declaration = types.find((d) => d.id === m.id);
      const definition = declaration?.definition;
      // The record keeps the optional flag of each field.
      if (definition?.kind === "nominal") {
        return [definition.base];
      }
      return definition?.kind === "alias" ? [definition.type] : [];
    });
    return recursionIsGuarded(
      component.map((m) => ({ id: m.id, tagged: m.kind === "tagged" })),
      roots,
    );
  }

  /** Returns the string value of a literal tag after transparent alias expansion. */
  function literalTag(type: Type): string | undefined {
    return literalTagOf(type, (id): Type | undefined => {
      if (!isTypeId(id)) {
        return undefined;
      }
      const target = table.aliasOf(id);
      const node = target === undefined ? undefined : table.node(target);
      return node?.kind === "literal" || node?.kind === "named"
        ? node
        : undefined;
    });
  }

  /** Reports aliases that exceed the maximum depth and replaces each alias with the error type. */
  function checkDepths(
    typeInfos: readonly TypeNodeInfo[],
    guardedAliases: ReadonlySet<TypeId>,
  ): ModuleChecker {
    const memo = TypeDepthMemo();
    for (const info of typeInfos) {
      if (info.kind !== "alias") {
        continue;
      }
      if (guardedAliases.has(info.id)) {
        continue;
      }
      const body = table.aliasOf(info.id);
      if (body === undefined) {
        continue;
      }
      if (!table.exceedsDepth(body, MAX_TYPE_DEPTH, memo)) {
        continue;
      }
      lowerer = lowerer.report(
        "declaration/012",
        `the type \`${info.name}\` is nested deeper than ${MAX_TYPE_DEPTH} levels, counting the levels inside its aliases`,
        info.nameSpan,
        undefined,
      );
      table = table.defineAlias(
        info.id,
        table.error,
        false,
      );
    }
    return checker;
  }

  /** Rejects function, deferred, and opaque types in tagged records and errors. */
  function checkDeferredFields(): ModuleChecker {
    for (const field of nominalFields) {
      if (containsDeferredType(table, field.ref)) {
        lowerer = lowerer.report(
          "declaration/015",
          `${field.subject} has a function or deferred type, which a tagged record or error declaration cannot hold`,
          field.span,
          undefined,
        );
      } else if (containsOpaqueType(table, field.ref)) {
        lowerer = lowerer.report(
          "declaration/016",
          `${field.subject} has an opaque type, which has no schema`,
          field.span,
          undefined,
        );
      }
    }
    return checker;
  }

  function checkService(entry: DeclEntry): ModuleChecker {
    const id = declarationIdOf("service", entry.name);
    const methods: MethodDecl[] = [];
    for (const method of entry.methodList) {
      if (entry.methods.get(method.name) !== method) {
        continue;
      }
      const parts = kidsOf(tree, method.node);
      const writtenParts = functionParts(tree, method.node);
      const paramList = writtenParts.paramList;
      const fails = writtenParts.fails;
      const parameters = paramList === undefined
        ? []
        : lowerer.parameters(paramList);
      for (const parameter of parameters) {
        if (parameter.borrow) {
          if (tree.mode !== "effi") {
            lowerer = lowerer.report(
              "type-mismatch/010",
              "a service borrow parameter belongs in a host interface",
              parameter.span,
              undefined,
            );
          }
          const ref = table.node(
            table.unfold(parameter.type.ref),
          );
          if (
            ref.kind !== "named" || !isTypeId(ref.id) ||
            !table.isOpaque(ref.id)
          ) {
            lowerer = lowerer.report(
              "type-mismatch/010",
              "borrow parameters need an opaque type",
              parameter.span,
              undefined,
            );
          }
        }
      }
      const resultNode = parts.find((k) =>
        k !== method.nameNode && k !== paramList && k !== fails
      );
      const result = resultNode === undefined
        ? lowerer.errorLowered()
        : lowerer.lower(resultNode);
      const failures = lowerer.failures(fails);
      const type = loweredFunction(
        table,
        { mode: "effect", failures: failures, requirements: [] },
        parameters.map((p) => p.type),
        result,
        undefined,
        undefined,
      );
      const capability: CapabilityId = capabilityId(
        env.module,
        entry.name,
        method.name,
      );
      methodTypes = methodTypes.set(
        capability,
        type.ref,
      );
      const borrowOption = parameters.some((p) => p.borrow)
        ? { borrows: parameters.map((p) => p.borrow) }
        : {};
      methods[methods.length] = {
        ...borrowOption,
        id: capability,
        name: method.name,
        type: type.ir,
        span: method.span,
      };
    }
    const declaration: ServiceDecl = {
      kind: "service",
      id: id,
      name: entry.name,
      methods: methods,
      span: entry.span,
    };
    services[services.length] = declaration;
    serviceIndex = serviceIndex.set(id, declaration);
    return checker;
  }
  function checkProvider(entry: DeclEntry): ModuleChecker {
    const id = declarationIdOf("value", entry.name);
    const parts = kidsOf(tree, entry.node);
    const provides: CapabilityId[] = [];
    for (
      const clause of parts.filter((k) =>
        kindOf(tree, k) === SyntaxKind.ProvidesClause
      )
    ) {
      for (
        const qn of kidsOfKind(
          tree,
          clause,
          SyntaxKind.QualifiedName,
        )
      ) {
        for (const capability of lowerer.capabilitiesOf(qn)) {
          provides[provides.length] = capability;
        }
      }
    }
    const writtenParts = functionParts(tree, entry.node);
    const fails = writtenParts.fails;
    const uses = writtenParts.uses;
    const failures = lowerer.failures(fails);
    const requirements = lowerer.requirements(uses);
    const signature: ProviderSignature = {
      ...base(entry),
      kind: "provider",
      id: id,
      failures: failures,
      requirements: requirements,
      type: lowerer.providerOf(provides, failures, requirements),
    };
    values = values.set(id, signature);
    return checker;
  }
  function base(entry: DeclEntry): SignatureBase {
    return {
      name: entry.name,
      exported: entry.exported,
      node: entry.node,
      nameNode: entry.nameNode,
      span: entry.span,
      nameSpan: entry.nameSpan,
    };
  }
  function checkConst(entry: DeclEntry): ModuleChecker {
    const id = declarationIdOf("value", entry.name);
    const rest = kidsOf(tree, entry.node).filter((k) => k !== entry.nameNode);
    const bindingNode = rest.find((k) => isTypeKind(kindOf(tree, k)));
    const init = initOf(tree, entry.node, entry.nameNode);
    const binding = bindingNode === undefined
      ? undefined
      : lowerer.lower(bindingNode);
    if (
      init !== undefined &&
      kindOf(tree, init) === SyntaxKind.ArrowExpr
    ) {
      values = values.set(
        id,
        functionSignature(entry, id, init, binding),
      );
      return checker;
    }
    if (entry.exported && bindingNode === undefined && !entry.broken) {
      lowerer = lowerer.report(
        "declaration/006",
        `the exported constant \`${entry.name}\` needs a type annotation`,
        entry.nameSpan,
        undefined,
      );
    }
    values = values.set(id, {
      ...base(entry),
      kind: "constant",
      id: id,
      type: binding,
    });
    return checker;
  }
  function functionSignature(
    entry: DeclEntry,
    id: ValueId,
    arrow: NodeId,
    binding: Lowered | undefined,
  ): FunctionSignature {
    const writtenParts = functionParts(tree, arrow);
    const paramList = writtenParts.paramList;
    const resultNode = writtenParts.result;
    const failsNode = writtenParts.fails;
    const usesNode = writtenParts.uses;
    const written = paramList === undefined
      ? []
      : lowerer.parameters(paramList);
    // A binding type annotation that is a function type of the same arity supplies
    // the types that the arrow does not write.
    const bindingFunction = binding === undefined
      ? undefined
      : functionOfBinding(binding);
    const bindingFn = bindingFunction?.node.parameters.length === written.length
      ? bindingFunction
      : undefined;
    const parameters: ParameterSignature[] = written.map((p, i) => {
      if (p.annotated || bindingFn === undefined) {
        return p;
      }
      return {
        ...p,
        type: {
          ref: bindingFn.node.parameters[i],
          ir: bindingFn.ir.parameters[i],
        },
      };
    });
    let result: Lowered | undefined;
    let failures: ErrorId[] = [];
    let requirements: CapabilityId[] = [];
    let annotation: FunctionSignature["annotation"] = "none";
    // A binding type is a type, so it closes every part. An exported function
    // closes its omitted `with` set unless a service header enables inference.
    // It leaves an omitted `fails` clause open, as a local function does.
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
      result = { ref: bindingFn.node.result, ir: bindingFn.ir.result };
      failures = [...bindingFn.ir.effects.failures];
      requirements = [...bindingFn.ir.effects.requirements];
      annotation = "binding";
      closedParts = { result: true, fails: true, uses: true };
    }
    if (annotation !== "binding") {
      const bound = bindingFn !== undefined;
      closedParts = {
        ...closedParts,
        fails: failsNode !== undefined || bound,
        uses: usesNode !== undefined || bound ||
          (entry.exported && !infersExportedRequirements),
      };
      if (closedParts.fails) {
        failures = lowerer.failures(failsNode);
      }
      if (closedParts.uses) {
        requirements = lowerer.requirements(usesNode);
      }
    }
    if (!entry.broken && binding !== undefined) {
      checker = checkBindingFits(
        arrow,
        binding,
        bindingFunction,
        parameters,
        result,
        { failures: failures, requirements: requirements },
        entry.exported,
      );
    }
    if (!entry.broken && entry.exported && annotation === "none") {
      lowerer = lowerer.report(
        "declaration/005",
        `the exported function \`${entry.name}\` needs a result annotation`,
        entry.nameSpan,
        undefined,
      );
    }
    const signatureBase = bindingFn?.ir.execution === "pure"
      ? { ...base(entry), expectedExecution: "pure" as const }
      : base(entry);
    return {
      ...signatureBase,
      kind: "function",
      id: id,
      written: closedParts,
      annotation: annotation,
      parameters: parameters,
      result: result,
      failures: failures,
      requirements: requirements,
    };
  }

  /** Returns the function type of a binding annotation after alias expansion. */
  function functionOfBinding(binding: Lowered): {
    node: FunctionNode;
    ir: FunctionType;
  } | undefined {
    const ref = table.unfold(binding.ref);
    const node = table.node(ref);
    if (node.kind !== "function") {
      return undefined;
    }
    const ir = binding.ir.kind === "function"
      ? binding.ir
      : typeToIr(table, ref);
    return ir.kind === "function" ? { node: node, ir: ir } : undefined;
  }

  /** Checks that an annotated arrow fits its binding type. */
  function checkBindingFits(
    arrow: NodeId,
    binding: Lowered,
    fn: {
      node: FunctionNode;
      ir: FunctionType;
    } | undefined,
    parameters: readonly ParameterSignature[],
    result: Lowered | undefined,
    effects: {
      failures: readonly ErrorId[];
      requirements: readonly CapabilityId[];
    },
    exported: boolean,
  ): ModuleChecker {
    const expected = showType(table, binding.ref);
    if (fn === undefined) {
      lowerer = lowerer.report(
        "type-mismatch/003",
        `the value is a function, but ${expected} is expected`,
        nodeSpan(tree, arrow),
        undefined,
      );
      return checker;
    }
    if (result === undefined) {
      // The body infers the result. Only the arity can disagree here.
      if (parameters.length !== fn.ir.parameters.length) {
        lowerer = lowerer.report(
          "type-mismatch/003",
          `the function takes ${parameters.length} parameters, but ${expected} is expected`,
          nodeSpan(tree, arrow),
          undefined,
        );
      }
      return checker;
    }
    const found = table.function({
      execution: fn.ir.execution,
      parameters: parameters.map((p) => p.type.ref),
      checked: checkedInputFlags(
        { exported: exported, parameters: parameters },
        table,
      ),
      result: result.ref,
      failures: effects.failures,
      requirements: effects.requirements,
    });
    if (
      !table.isAssignableIn(
        env.module,
        found,
        binding.ref,
      )
    ) {
      lowerer = lowerer.report(
        "type-mismatch/003",
        `the function has type ${
          showType(table, found)
        }, but ${expected} is expected`,
        nodeSpan(tree, arrow),
        undefined,
      );
    }
    return checker;
  }
  checker = { run: run };
  return checker;
}
/**
 * Checks the declarations of one module. `imported` holds the type graphs of the
 * modules that this module reaches through its imports. The table registers their
 * definitions before it lowers any local type.
 */
export function checkModuleDeclarations(
  info: ModuleInfo,
  resolution: ModuleResolution,
  module: ModuleName,
  table: TypeTable,
  imported: ReadonlyMap<string, TypeGraph>,
): ModuleDeclarations {
  let services = emptyMap<ServiceId, ServiceDecl>();
  for (const graph of imported.values()) {
    table = loadGraph(table, graph);
    for (const service of graph.services) {
      services = services.set(service.id, service);
    }
  }
  const env: TypeEnv = {
    module: module,
    tree: info.tree,
    targets: resolution.targets,
    defectArms: resolution.defectArms,
    table: table,
    services: services,
  };
  return createModuleChecker(info, env, services).run();
}
