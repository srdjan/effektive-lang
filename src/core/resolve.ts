import { emptyMap, emptySet, mapFrom, setFrom } from "./runtime.ts";
// Name resolution. Each name node gets one entry in a side table from the node id
// to its target: a declaration identity, a local identity, a prelude builtin, or
// a builtin type.
//
// Scope rules. Module-level names live in one namespace for the whole module
// (types, errors, services, providers, consts, and imports) and are visible
// everywhere, in any order. A local scope holds parameters, block consts, match
// pattern bindings, and catch handler bindings. A block that follows a parameter
// list, a pattern, or a handler binding shares that scope, because the emitted
// function body shares it too.
import {
  type Diagnostic,
  type DiagnosticCode,
  makeDiagnosticWithRelated,
  normalizeDiagnostics,
} from "./diagnostics.ts";
import type { DeclEntry, MethodEntry } from "./declaration_index.ts";
import {
  isPatternKind,
  isTypeKind,
  kidsOf,
  kidsOfKind,
  memberAccessParts,
  nameTextOf,
} from "./syntax_queries.ts";
import {
  capabilityId,
  declarationId,
  type DeclarationPrefix,
  localId,
} from "./ids.ts";
import type {
  CapabilityId,
  ErrorId,
  LocalId,
  ServiceId,
  TypeId,
  ValueId,
} from "./ir.ts";
import { SCHEMA_ERROR_ID, SCHEMA_ISSUE_ID, TIMEOUT_ERROR_ID } from "./ir.ts";
import type { ModuleInfo, Project } from "./project.ts";
import type { Span } from "./source.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
/**
 * What the compiler treats differently about a prelude name. An option
 * constructor has its own resolution and checking rules and is not a family
 * builtin. A service-argument builtin takes a service name as its first
 * argument.
 */
type PreludeRole = "option-some" | "option-none" | "service-argument";
type PreludeEntry = {
  readonly shadowable: boolean;
  readonly role?: PreludeRole;
};
/**
 * The prelude operations, in one table. `shadowable` marks a name that a module
 * constant, a parameter, or a local may shadow. `role` marks a name that the
 * compiler handles apart from the family builtins. Existing programs may use these
 * names as values. Bindings shadow these prelude operations; lookupValue already
 * checks bindings first. Every other name is reserved.
 */
const PRELUDE = {
  fail: { shadowable: false },
  retry: { shadowable: false },
  timeout: { shadowable: true },
  sleep: { shadowable: true },
  now: { shadowable: true },
  log: { shadowable: true },
  random: { shadowable: true },
  randomInt: { shadowable: true },
  uninterruptible: { shadowable: true },
  repeat: { shadowable: true },
  provide: { shadowable: false },
  defer: { shadowable: false },
  run: { shadowable: true },
  scoped: { shadowable: true },
  forkScoped: { shadowable: true },
  unfold: { shadowable: false },
  mapEffect: { shadowable: false },
  sinkForEach: { shadowable: false },
  takeSink: { shadowable: true },
  transduceStream: { shadowable: true },
  runStream: { shadowable: false },
  bufferStream: { shadowable: false },
  race: { shadowable: false },
  makeRef: { shadowable: false },
  getRef: { shadowable: false },
  setRef: { shadowable: false },
  updateRef: { shadowable: false },
  layer: { shadowable: false, role: "service-argument" },
  mergeLayers: { shadowable: false },
  retrySchedule: { shadowable: false },
  schema: { shadowable: true },
  schemaArray: { shadowable: true },
  schemaStruct: { shadowable: true },
  schemaOptionalKey: { shadowable: true },
  schemaNullToMissingKey: { shadowable: true },
  schemaOptionFromOptionalKey: { shadowable: true },
  schemaDefaultKey: { shadowable: true },
  schemaConstructorDefault: { shadowable: true },
  schemaOptionalTransform: { shadowable: true },
  schemaOptionalFromRequired: { shadowable: true },
  schemaUnion: { shadowable: true },
  schemaTransform: { shadowable: true },
  schemaRecursive: { shadowable: true },
  schemaDecode: { shadowable: true },
  schemaEncode: { shadowable: true },
  schemaMake: { shadowable: true },
  Some: { shadowable: false, role: "option-some" },
  None: { shadowable: false, role: "option-none" },
  map: { shadowable: false },
  filter: { shadowable: false },
  fold: { shadowable: false },
  all: { shadowable: true },
  traverse: { shadowable: false },
  div: { shadowable: true },
  trunc: { shadowable: true },
  floor: { shadowable: true },
  round: { shadowable: true },
  ceil: { shadowable: true },
  text: { shadowable: true },
  len: { shadowable: true },
  at: { shadowable: true },
  sort: { shadowable: true },
} as const;
export type PreludeName = keyof typeof PRELUDE;
/** The prelude names that are option constructors. */
export type OptionConstructorName = {
  [K in PreludeName]: typeof PRELUDE[K] extends {
    readonly role: "option-some" | "option-none";
  } ? K
    : never;
}[PreludeName];
/** True when the builtin named by `text` takes a service name as its first argument. */
function takesServiceArgument(text: string): boolean {
  const name = asPrelude(text);
  if (name === undefined) {
    return false;
  }
  const entry: PreludeEntry = PRELUDE[name];
  return entry.role === "service-argument";
}
/** The handler arm that catches defects. It is a keyword of the handler, not an error identity. */
const DEFECT_ARM = "Defect";
export function isOptionConstructorName(
  name: PreludeName,
): name is OptionConstructorName {
  return optionRole(name) !== undefined;
}
/** The option constructor that a prelude name is, or undefined. */
export function optionRole(name: PreludeName): "some" | "none" | undefined {
  const entry: PreludeEntry = PRELUDE[name];
  if (entry.role === "option-some") {
    return "some";
  }
  if (entry.role === "option-none") {
    return "none";
  }
  return undefined;
}
/** The option constructor that a target names, or undefined. */
export function optionConstructorOf(
  target: Target | undefined,
): "some" | "none" | undefined {
  return target?.kind === "builtin" ? optionRole(target.name) : undefined;
}
// deno-lint-ignore light-fp/pure-module -- A pure factory builds this immutable exported lookup table.
export const PRELUDE_NAMES: ReadonlySet<string> = setFrom(Object.keys(PRELUDE));
const BUILTIN_TYPES = [
  "string",
  "boolean",
  "int",
  "number",
  "void",
  "never",
  "unknown",
  "Option",
  "Ref",
  "RetrySchedule",
  "Duration",
  "Instant",
] as const;
type BuiltinTypeName = typeof BUILTIN_TYPES[number];
// deno-lint-ignore light-fp/pure-module -- A pure factory builds this immutable exported lookup table.
export const BUILTIN_TYPE_NAMES: ReadonlySet<string> = setFrom(BUILTIN_TYPES);
/** The error names that the Effect runtime provides, and their identities. */
// deno-lint-ignore light-fp/pure-module -- A pure factory builds this immutable exported lookup table.
export const EFFECT_ERROR_IDS: ReadonlyMap<string, ErrorId> = mapFrom([
  ["SchemaError", SCHEMA_ERROR_ID],
  ["SchemaIssue", SCHEMA_ISSUE_ID],
  ["TimeoutError", TIMEOUT_ERROR_ID],
]);
/**
 * Names that the generated TypeScript needs, so no declaration or binding may
 * take them. The emitter prints the globals `undefined`, `Number`, `RangeError`,
 * `ReadonlyArray`, `Math`, `Error`, `String`, `globalThis`, `TypeError`, and
 * `BigInt`.
 * TypeScript rejects `any`, `bigint`, `object`, and `symbol` as the name of a
 * type or a class.
 */
// deno-lint-ignore light-fp/pure-module -- A pure factory builds this immutable internal lookup table.
const TARGET_NAMES: ReadonlySet<string> = setFrom([
  "undefined",
  "Number",
  "RangeError",
  "SchemaError",
  "SchemaIssue",
  "TimeoutError",
  DEFECT_ARM,
  "ReadonlyArray",
  "Math",
  "Error",
  "String",
  "globalThis",
  "TypeError",
  "BigInt",
  "any",
  "bigint",
  "object",
  "symbol",
]);
/** The prelude names that a module constant, a parameter, or a local may shadow. */
// deno-lint-ignore light-fp/pure-module -- Pure array operations derive the stable shadowable name list.
const SHADOWABLE_PRELUDE_VALUES: readonly string[] = Object.entries(PRELUDE)
  .filter((entry) => entry[1].shadowable)
  .map((entry) => entry[0]);
// deno-lint-ignore light-fp/pure-module -- A pure factory builds this immutable exported lookup table.
export const SHADOWABLE_PRELUDE_NAMES: ReadonlySet<string> = setFrom(
  SHADOWABLE_PRELUDE_VALUES,
);
function isReservedPreludeName(name: string): boolean {
  return PRELUDE_NAMES.has(name) && !SHADOWABLE_PRELUDE_NAMES.has(name);
}
function asPrelude(name: string): PreludeName | undefined {
  return PRELUDE_NAMES.has(name) ? name as PreludeName : undefined;
}
export type Target =
  | {
    readonly kind: "type";
    readonly id: TypeId;
  }
  | {
    readonly kind: "error";
    readonly id: ErrorId;
  }
  | {
    readonly kind: "service";
    readonly id: ServiceId;
  }
  | {
    readonly kind: "provider";
    readonly id: ValueId;
  }
  | {
    readonly kind: "value";
    readonly id: ValueId;
  }
  | {
    readonly kind: "cap";
    readonly id: CapabilityId;
  }
  | {
    readonly kind: "local";
    readonly id: LocalId;
  }
  | {
    readonly kind: "builtin";
    readonly name: PreludeName;
  }
  | {
    readonly kind: "builtin-type";
    readonly name: BuiltinTypeName;
  }
  /** A field label or a field access. The checker resolves it against a record type. */
  | {
    readonly kind: "field";
    readonly name: string;
  }
  /** A name that did not resolve. A diagnostic exists, or an earlier one covers it. */
  | {
    readonly kind: "unresolved";
    readonly name: string;
  };
/** The identity string of a target, or the builtin name. */
export type TargetText = string;
export function targetText(target: Target): TargetText {
  if (target.kind === "builtin") {
    return `prelude:${target.name}`;
  }
  if (
    target.kind === "builtin-type" || target.kind === "field" ||
    target.kind === "unresolved"
  ) {
    return `${target.kind}:${target.name}`;
  }
  if (
    target.kind === "type" || target.kind === "error" ||
    target.kind === "service" || target.kind === "provider" ||
    target.kind === "value" || target.kind === "cap" ||
    target.kind === "local"
  ) {
    return target.id;
  }
  const unreachable: never = target;
  return unreachable;
}
type Binding = {
  readonly target: Target;
  /** For a service: the defining module and the declaration, to look up methods. */
  readonly service?: {
    readonly module: string;
    readonly entry: DeclEntry;
  };
  readonly span: Span;
};
export type ModuleResolution = {
  /** From syntax node id to target. Every resolved name node has one entry. */
  readonly targets: ReadonlyMap<NodeId, Target>;
  /** The error-name nodes of the handler arms that catch defects. They have no target. */
  readonly defectArms: ReadonlySet<NodeId>;
  /** From local identity to the span of the name that binds it. */
  readonly locals: ReadonlyMap<LocalId, Span>;
  /** The module-level names, including imported names. */
  readonly namespace: ReadonlyMap<string, Binding>;
  readonly diagnostics: readonly Diagnostic[];
};
type LocalBinding = {
  readonly id: LocalId;
  readonly span: Span;
};
type Scope = {
  readonly parent: Scope | undefined;
  readonly binding: (name: string) => LocalBinding | undefined;
  readonly bind: (name: string, binding: LocalBinding) => Scope;
  readonly outerUse: (name: string) => Span | undefined;
  readonly recordOuterUse: (name: string, span: Span) => Scope;
};
function Scope(parent: Scope | undefined): Scope {
  const scopeParent = parent;
  let scopeNames = emptyMap<string, LocalBinding>();
  let scopeOuterUses = emptyMap<string, Span>();
  function binding(name: string): LocalBinding | undefined {
    return scopeNames.get(name);
  }
  function bind(name: string, local: LocalBinding): Scope {
    scopeNames = scopeNames.set(name, local);
    return scopeSelf;
  }
  function outerUse(name: string): Span | undefined {
    return scopeOuterUses.get(name);
  }
  function recordOuterUse(name: string, span: Span): Scope {
    scopeOuterUses = scopeOuterUses.set(name, span);
    return scopeSelf;
  }
  const scopeSelf: Scope = {
    parent: scopeParent,
    binding: binding,
    bind: bind,
    outerUse: outerUse,
    recordOuterUse: recordOuterUse,
  };
  return scopeSelf;
}
type Found = {
  readonly tag: "local";
  readonly binding: LocalBinding;
} | {
  readonly tag: "module";
  readonly binding: Binding;
} | {
  readonly tag: "builtin";
  readonly name: PreludeName;
};
type Position = "value" | "callee";
const KIND_DESCRIPTIONS: Record<Target["kind"], string> = {
  type: "a type",
  error: "an error",
  service: "a service",
  provider: "a provider",
  value: "a value",
  cap: "a service method",
  local: "a local binding",
  builtin: "a builtin function",
  "builtin-type": "a builtin type",
  field: "a field",
  unresolved: "an unresolved name",
};
function describeKind(target: Target): string {
  return KIND_DESCRIPTIONS[target.kind];
}
const RESOURCE_REGIONS: readonly SyntaxKind[] = [
  SyntaxKind.ResourceUse,
  SyntaxKind.ResourceRelease,
];
type Resolver = {
  readonly run: () => ModuleResolution;
};
type DeclaredLocal = {
  readonly owner: Resolver;
  readonly binding: LocalBinding | undefined;
};
type ResolvedMethod = {
  readonly owner: Resolver;
  readonly target: Target | undefined;
};
function Resolver(info: ModuleInfo, project: Project): Resolver {
  let resolverSelf: Resolver;
  const resolverProject = project;
  const resolverInfo = info;
  let resolverTargets = emptyMap<NodeId, Target>();
  let resolverDefectArms = emptySet<NodeId>();
  let resolverLocals = emptyMap<LocalId, Span>();
  const resolverDiagnostics: Diagnostic[] = [];
  let resolverNamespace = emptyMap<string, Binding>();
  let resolverScope: Scope | undefined;
  let resolverFn = "";
  let resolverCounters = emptyMap<string, number>();
  let resolverPending = emptyMap<LocalId, boolean>();
  const resolverTree: SyntaxTree = info.tree;
  const resolverName: string = info.name;
  function resolverSpan(node: NodeId): Span {
    return nodeSpan(resolverTree, node);
  }
  function resolverReport(
    code: DiagnosticCode,
    message: string,
    span: Span,
    related:
      | readonly {
        span: Span;
        message: string;
      }[]
      | undefined,
  ): Resolver {
    resolverDiagnostics[resolverDiagnostics.length] = makeDiagnosticWithRelated(
      code,
      message,
      span,
      related,
    );
    return resolverSelf;
  }
  function resolverSet(node: NodeId, target: Target): Resolver {
    resolverTargets = resolverTargets.set(node, target);
    return resolverSelf;
  }
  function resolverUnresolved(node: NodeId, name: string): Resolver {
    return resolverSet(node, { kind: "unresolved", name: name });
  }
  function resolverDeclareModuleName(
    name: string,
    binding: Binding,
    nameNode: NodeId,
  ): Resolver {
    if (
      isReservedPreludeName(name) ||
      BUILTIN_TYPE_NAMES.has(name)
    ) {
      resolverSelf = resolverReport(
        "declaration/002",
        `\`${name}\` is a reserved prelude or builtin name and cannot be declared`,
        binding.span,
        undefined,
      );
    } else if (TARGET_NAMES.has(name)) {
      resolverSelf = resolverReport(
        "declaration/002",
        `\`${name}\` is reserved because the generated TypeScript needs it`,
        binding.span,
        undefined,
      );
    }
    const existing = resolverNamespace.get(name);
    if (existing !== undefined) {
      resolverSelf = resolverReport(
        "declaration/001",
        `\`${name}\` is already declared in this module`,
        binding.span,
        [{ span: existing.span, message: "first declared here" }],
      );
      return resolverSet(nameNode, existing.target);
    }
    resolverNamespace = resolverNamespace.set(name, binding);
    return resolverSet(nameNode, binding.target);
  }
  function resolverBindImports(): Resolver {
    const index = resolverInfo.index;
    let events: {
      readonly start: number;
      readonly run: () => Resolver;
    }[] = [];
    for (const indexedEntry of index.imports.entries()) {
      const i = indexedEntry[0];
      const entry = indexedEntry[1];
      events[events.length] = {
        start: entry.span.start,
        run: () => resolverBindImport(i),
      };
    }
    for (const decl of index.decls) {
      events[events.length] = {
        start: decl.span.start,
        run: () => resolverBindDecl(decl),
      };
    }
    events = events.sort((a, b) => a.start - b.start);
    for (const event of events) {
      resolverSelf = event.run();
    }
    return resolverSelf;
  }
  function resolverBindImport(i: number): Resolver {
    const link = resolverInfo.links[i];
    const entry = resolverInfo.index.imports[i];
    const target = link.target === undefined
      ? undefined
      : resolverProject.modules.get(link.target);
    for (const imported of entry.names) {
      const poison: Binding = {
        target: { kind: "unresolved", name: imported.name },
        span: imported.span,
      };
      if (target === undefined) {
        resolverSelf = resolverDeclareModuleName(
          imported.name,
          poison,
          imported.node,
        );
        continue;
      }
      const decl = target.index.byName.get(imported.name);
      if (decl === undefined) {
        resolverSelf = resolverReport(
          "unknown-name/002",
          `module \`${target.name}\` has no declaration named \`${imported.name}\``,
          imported.span,
          undefined,
        );
        resolverSelf = resolverDeclareModuleName(
          imported.name,
          poison,
          imported.node,
        );
        continue;
      }
      if (!decl.exported) {
        resolverSelf = resolverReport(
          "unknown-name/002",
          `\`${imported.name}\` is not exported by module \`${target.name}\``,
          imported.span,
          undefined,
        );
        resolverSelf = resolverDeclareModuleName(
          imported.name,
          poison,
          imported.node,
        );
        continue;
      }
      if (entry.role === "service" && decl.kind !== "service") {
        resolverSelf = resolverReport(
          "unknown-name/004",
          `a service import requires a service, but \`${imported.name}\` is a ${decl.kind}`,
          imported.span,
          undefined,
        );
        resolverSelf = resolverDeclareModuleName(
          imported.name,
          poison,
          imported.node,
        );
        continue;
      }
      resolverSelf = resolverDeclareModuleName(
        imported.name,
        resolverBindingFor(target.name, decl, imported.span),
        imported.node,
      );
    }
    return resolverSelf;
  }
  function resolverBindDecl(decl: DeclEntry): Resolver {
    resolverSelf = resolverDeclareModuleName(
      decl.name,
      resolverBindingFor(resolverName, decl, decl.nameSpan),
      decl.nameNode,
    );
    let seen = emptyMap<string, MethodEntry>();
    for (const method of decl.methodList) {
      const first = seen.get(method.name);
      if (first !== undefined) {
        resolverSelf = resolverReport(
          "declaration/001",
          `service \`${decl.name}\` already has a method named \`${method.name}\``,
          method.nameSpan,
          [{
            span: first.nameSpan,
            message: "first declared here",
          }],
        );
      }
      if (first === undefined) {
        seen = seen.set(method.name, method);
      }
      resolverSelf = resolverSet(method.nameNode, {
        kind: "cap",
        id: capabilityId(resolverName, decl.name, method.name),
      });
    }
    return resolverSelf;
  }
  function resolverBindingFor(
    module: string,
    decl: DeclEntry,
    span: Span,
  ): Binding {
    function id<P extends DeclarationPrefix>(prefix: P): `${P}:${string}` {
      return declarationId(prefix, module, decl.name);
    }
    if (decl.kind === "type") {
      return { target: { kind: "type", id: id("type") }, span: span };
    }
    if (decl.kind === "error") {
      return { target: { kind: "error", id: id("error") }, span: span };
    }
    if (decl.kind === "service") {
      return {
        target: { kind: "service", id: id("service") },
        service: { module: module, entry: decl },
        span: span,
      };
    }
    if (decl.kind === "provider") {
      return { target: { kind: "provider", id: id("value") }, span: span };
    }
    if (decl.kind === "const") {
      return { target: { kind: "value", id: id("value") }, span: span };
    }
    const unreachable: never = decl.kind;
    return unreachable;
  }
  function resolverDeclareLocal(
    nameNode: NodeId,
    pending: boolean,
  ): DeclaredLocal {
    const scope = resolverScope;
    if (scope === undefined) {
      return { owner: resolverSelf, binding: undefined };
    }
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return { owner: resolverSelf, binding: undefined };
    }
    const span = resolverSpan(nameNode);
    if (isReservedPreludeName(name)) {
      resolverSelf = resolverReport(
        "declaration/002",
        `\`${name}\` is a reserved prelude name and cannot be a binding`,
        span,
        undefined,
      );
    } else if (TARGET_NAMES.has(name)) {
      resolverSelf = resolverReport(
        "declaration/002",
        `\`${name}\` is reserved because the generated TypeScript needs it`,
        span,
        undefined,
      );
    }
    const existing = scope.binding(name);
    if (existing !== undefined) {
      resolverSelf = resolverReport(
        "declaration/001",
        `\`${name}\` is already bound in this scope`,
        span,
        [{ span: existing.span, message: "first bound here" }],
      );
      resolverSelf = resolverSet(nameNode, { kind: "local", id: existing.id });
      return { owner: resolverSelf, binding: undefined };
    }
    const used = scope.outerUse(name);
    if (used !== undefined) {
      resolverSelf = resolverReport(
        "declaration/004",
        `\`${name}\` is used earlier in this block as an outer name, and this binding would capture that use`,
        span,
        [{ span: used, message: "the earlier use" }],
      );
    }
    const key = `${resolverFn}/${name}`;
    const count = (resolverCounters.get(key) ?? 0) + 1;
    resolverCounters = resolverCounters.set(key, count);
    const base: LocalId = localId(resolverName, resolverFn, name);
    const binding: LocalBinding = {
      id: count === 1 ? base : `${base}/${count}`,
      span: span,
    };
    resolverScope = scope.bind(name, binding);
    resolverPending = resolverPending.set(binding.id, pending);
    resolverLocals = resolverLocals.set(binding.id, span);
    resolverSelf = resolverSet(nameNode, { kind: "local", id: binding.id });
    return { owner: resolverSelf, binding: binding };
  }
  function resolverServiceBinding(nameExpr: NodeId): Binding | undefined {
    const found = resolverLookupValue(
      nodeText(resolverTree, nameExpr),
      resolverSpan(nameExpr),
    );
    return found?.tag === "module" && found.binding.target.kind === "service"
      ? found.binding
      : undefined;
  }
  function resolverLookupValue(name: string, useSpan: Span): Found | undefined {
    const passed: Scope[] = [];
    let found: Found | undefined;
    let scope = resolverScope;
    // The scope chain is never longer than the node count, so the node list
    // bounds the walk. The walk stops at the outermost scope or at a binding.
    for (const _kind of resolverTree.kinds) {
      if (scope === undefined || found !== undefined) break;
      const binding = scope.binding(name);
      if (binding !== undefined) {
        found = { tag: "local", binding: binding };
      } else {
        passed[passed.length] = scope;
      }
      scope = scope.parent;
    }
    if (found === undefined) {
      const moduleBinding = resolverNamespace.get(name);
      if (moduleBinding !== undefined) {
        found = { tag: "module", binding: moduleBinding };
      } else {
        const builtin = asPrelude(name);
        if (builtin !== undefined) {
          found = { tag: "builtin", name: builtin };
        }
      }
    }
    if (found !== undefined) {
      for (const indexedScope of passed.entries()) {
        const index = indexedScope[0];
        const passedScope = indexedScope[1];
        if (passedScope.outerUse(name) === undefined) {
          passed[index] = passedScope.recordOuterUse(name, useSpan);
        }
      }
    }
    return found;
  }
  function resolverUnknown(node: NodeId, name: string, what: string): Resolver {
    resolverSelf = resolverReport(
      "unknown-name/001",
      `unknown ${what} \`${name}\``,
      resolverSpan(node),
      undefined,
    );
    return resolverUnresolved(node, name);
  }
  function resolverWrongKind(
    node: NodeId,
    name: string,
    message: string,
  ): Resolver {
    resolverSelf = resolverReport(
      "unknown-name/004",
      message,
      resolverSpan(node),
      undefined,
    );
    return resolverUnresolved(node, name);
  }
  function resolverValueRef(
    node: NodeId,
    name: string,
    position: Position,
  ): Resolver {
    const found = resolverLookupValue(name, resolverSpan(node));
    if (found === undefined) {
      return resolverUnknown(node, name, "name");
    }
    if (found.tag === "local") {
      if (resolverPending.get(found.binding.id) ?? false) {
        resolverSelf = resolverReport(
          "unknown-name/001",
          `\`${name}\` is used in its own initializer before it is bound`,
          resolverSpan(node),
          undefined,
        );
        return resolverUnresolved(node, name);
      }
      return resolverSet(node, { kind: "local", id: found.binding.id });
    }
    if (found.tag === "builtin") {
      if (position === "callee" || optionRole(found.name) === "none") {
        return resolverSet(node, { kind: "builtin", name: found.name });
      }
      return resolverWrongKind(
        node,
        name,
        `the builtin \`${name}\` can only be called or used as a pipeline stage`,
      );
    }
    const target = found.binding.target;
    if (
      target.kind === "value" || target.kind === "provider" ||
      target.kind === "unresolved"
    ) {
      return resolverSet(node, target);
    }
    if (target.kind === "type" || target.kind === "error") {
      if (position === "callee") {
        return resolverSet(node, target);
      }
      return resolverWrongKind(
        node,
        name,
        `\`${name}\` is ${
          describeKind(target)
        }, not a value; call it to construct a value`,
      );
    }
    if (
      target.kind === "service" || target.kind === "cap" ||
      target.kind === "local" || target.kind === "builtin" ||
      target.kind === "builtin-type" || target.kind === "field"
    ) {
      return resolverWrongKind(
        node,
        name,
        `\`${name}\` is ${describeKind(target)}, not a value`,
      );
    }
    const unreachable: never = target;
    return unreachable;
  }
  function resolverTypeRef(nameNode: NodeId): Resolver {
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return resolverSelf;
    }
    const binding = resolverNamespace.get(name);
    if (binding !== undefined) {
      const t = binding.target;
      if (t.kind === "type" || t.kind === "error" || t.kind === "unresolved") {
        return resolverSet(nameNode, t);
      }
      return resolverWrongKind(
        nameNode,
        name,
        `\`${name}\` is ${describeKind(t)}, not a type`,
      );
    }
    const effectError = EFFECT_ERROR_IDS.get(name);
    if (effectError !== undefined) {
      return resolverSet(nameNode, { kind: "error", id: effectError });
    }
    const builtin = BUILTIN_TYPES.find((candidate) => candidate === name);
    if (builtin !== undefined) {
      return resolverSet(nameNode, {
        kind: "builtin-type",
        name: builtin,
      });
    }
    return resolverUnknown(nameNode, name, "type");
  }
  function resolverErrorRef(
    nameNode: NodeId,
    allowAlias: boolean,
  ): Resolver {
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return resolverSelf;
    }
    const binding = resolverNamespace.get(name);
    if (binding === undefined) {
      const effectError = EFFECT_ERROR_IDS.get(name);
      if (effectError !== undefined) {
        return resolverSet(nameNode, {
          kind: "error",
          id: effectError,
        });
      }
      return resolverUnknown(nameNode, name, "error");
    }
    const t = binding.target;
    if (
      t.kind === "error" || t.kind === "unresolved" ||
      (allowAlias && t.kind === "type")
    ) {
      return resolverSet(nameNode, t);
    }
    return resolverWrongKind(
      nameNode,
      name,
      `\`${name}\` is ${describeKind(t)}, not an error`,
    );
  }
  function resolverIsConstructorName(nameNode: NodeId): boolean {
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return true;
    }
    const prelude = asPrelude(name);
    if (prelude !== undefined && optionRole(prelude) !== undefined) {
      return true;
    }
    if (EFFECT_ERROR_IDS.has(name)) {
      return true;
    }
    const kind = resolverNamespace.get(name)?.target.kind;
    return kind === "type" || kind === "error" || kind === "unresolved";
  }
  function resolverCtorRef(nameNode: NodeId): Resolver {
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return resolverSelf;
    }
    const prelude = asPrelude(name);
    if (prelude !== undefined && optionRole(prelude) !== undefined) {
      return resolverSet(nameNode, { kind: "builtin", name: prelude });
    }
    const target = resolverNamespace.get(name)?.target;
    if (target?.kind === "type") {
      return resolverSet(nameNode, target);
    }
    return resolverErrorRef(nameNode, false);
  }
  function resolverServiceRef(
    nameNode: NodeId,
    scoped: boolean,
  ): Binding | undefined {
    const name = nameTextOf(resolverTree, nameNode);
    if (name === undefined) {
      return undefined;
    }
    let binding: Binding | undefined;
    if (scoped) {
      const found = resolverLookupValue(name, resolverSpan(nameNode));
      if (found === undefined) {
        resolverSelf = resolverUnknown(nameNode, name, "service");
        return undefined;
      }
      if (found.tag === "local") {
        resolverSelf = resolverWrongKind(
          nameNode,
          name,
          `\`${name}\` is a local binding, not a service`,
        );
        return undefined;
      }
      if (found.tag === "builtin") {
        resolverSelf = resolverWrongKind(
          nameNode,
          name,
          `\`${name}\` is a builtin function, not a service`,
        );
        return undefined;
      }
      binding = found.binding;
    } else {
      binding = resolverNamespace.get(name);
      if (binding === undefined) {
        resolverSelf = resolverUnknown(nameNode, name, "service");
        return undefined;
      }
    }
    const t = binding.target;
    if (t.kind === "service") {
      resolverSelf = resolverSet(nameNode, t);
      return binding;
    }
    if (t.kind === "unresolved") {
      resolverSelf = resolverSet(nameNode, t);
      return undefined;
    }
    resolverSelf = resolverWrongKind(
      nameNode,
      name,
      `\`${name}\` is ${describeKind(t)}, not a service`,
    );
    return undefined;
  }
  function resolverMethodRef(
    service: Binding,
    methodNode: NodeId,
  ): ResolvedMethod {
    const method = nameTextOf(resolverTree, methodNode);
    const info = service.service;
    if (method === undefined || info === undefined) {
      return { owner: resolverSelf, target: undefined };
    }
    if (!info.entry.methods.has(method)) {
      resolverSelf = resolverReport(
        "unknown-name/003",
        `service \`${info.entry.name}\` has no method named \`${method}\``,
        resolverSpan(methodNode),
        undefined,
      );
      resolverSelf = resolverUnresolved(methodNode, method);
      return { owner: resolverSelf, target: undefined };
    }
    const target: Target = {
      kind: "cap",
      id: capabilityId(info.module, info.entry.name, method),
    };
    resolverSelf = resolverSet(methodNode, target);
    return { owner: resolverSelf, target: target };
  }
  function resolverQualified(
    qn: NodeId,
    context: "with" | "provides" | "stage",
  ): Resolver {
    const names = kidsOfKind(resolverTree, qn, SyntaxKind.Name);
    if (names.length === 0) {
      return resolverSelf;
    }
    if (context === "stage" && names.length === 1) {
      const name = nameTextOf(resolverTree, names[0]);
      if (name === undefined) {
        return resolverSelf;
      }
      resolverSelf = resolverValueRef(names[0], name, "callee");
      const target = resolverTargets.get(names[0]);
      if (target !== undefined) {
        resolverSelf = resolverSet(qn, target);
      }
      return resolverSelf;
    }
    const service = resolverServiceRef(names[0], context === "stage");
    let whole: Target | undefined = service?.target;
    if (names.length >= 2) {
      if (context === "provides") {
        resolverSelf = resolverReport(
          "declaration/003",
          "a provider provides whole services; a method name is not allowed here",
          resolverSpan(qn),
          undefined,
        );
      }
      if (service !== undefined) {
        const resolved = resolverMethodRef(service, names[1]);
        resolverSelf = resolved.owner;
        if (context !== "provides") {
          whole = resolved.target;
        }
      }
    }
    for (const extra of names.slice(2)) {
      resolverSelf = resolverWrongKind(
        extra,
        nameTextOf(resolverTree, extra) ?? "",
        "a qualified name has at most two parts: a service and a method",
      );
    }
    if (whole !== undefined) {
      resolverSelf = resolverSet(qn, whole);
    }
    return resolverSelf;
  }
  function resolverResolveType(node: NodeId): Resolver {
    const kind = kindOf(resolverTree, node);
    if (kind === SyntaxKind.NamedType) {
      for (const kid of kidsOf(resolverTree, node)) {
        if (kindOf(resolverTree, kid) === SyntaxKind.Name) {
          resolverSelf = resolverTypeRef(kid);
        } else {
          resolverSelf = resolverResolveType(kid);
        }
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.RecordType) {
      for (
        const field of kidsOfKind(resolverTree, node, SyntaxKind.FieldType)
      ) {
        resolverSelf = resolverLabelsAndTypes(field);
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.FunctionType) {
      for (const kid of kidsOf(resolverTree, node)) {
        const k = kindOf(resolverTree, kid);
        if (k === SyntaxKind.ParamList) {
          resolverSelf = resolverLabelParams(kid);
        } else if (
          k === SyntaxKind.FailsClause || k === SyntaxKind.WithClause
        ) {
          resolverSelf = resolverClause(kid);
        } else {
          resolverSelf = resolverResolveType(kid);
        }
      }
      return resolverSelf;
    }
    if (
      kind === SyntaxKind.EffectType || kind === SyntaxKind.StreamType ||
      kind === SyntaxKind.SinkType || kind === SyntaxKind.SchemaType ||
      kind === SyntaxKind.LayerType
    ) {
      for (const kid of kidsOf(resolverTree, node)) {
        const k = kindOf(resolverTree, kid);
        if (
          k === SyntaxKind.FailsClause || k === SyntaxKind.WithClause ||
          k === SyntaxKind.ProvidesClause
        ) {
          resolverSelf = resolverClause(kid);
        } else {
          resolverSelf = resolverResolveType(kid);
        }
      }
      return resolverSelf;
    }
    if (
      kind === SyntaxKind.TypeArgs || kind === SyntaxKind.TupleType ||
      kind === SyntaxKind.ArrayType || kind === SyntaxKind.UnionType ||
      kind === SyntaxKind.ParenType
    ) {
      for (const kid of kidsOf(resolverTree, node)) {
        resolverSelf = resolverResolveType(kid);
      }
      return resolverSelf;
    }
    return resolverSelf;
  }
  function resolverFieldLabel(nameNode: NodeId): Resolver {
    const name = nameTextOf(resolverTree, nameNode);
    if (name !== undefined) {
      resolverSelf = resolverSet(nameNode, { kind: "field", name: name });
    }
    return resolverSelf;
  }
  function resolverLabelParams(paramList: NodeId): Resolver {
    for (const param of kidsOfKind(resolverTree, paramList, SyntaxKind.Param)) {
      resolverSelf = resolverLabelsAndTypes(param);
    }
    return resolverSelf;
  }
  function resolverLabelsAndTypes(node: NodeId): Resolver {
    for (const kid of kidsOf(resolverTree, node)) {
      if (kindOf(resolverTree, kid) === SyntaxKind.Name) {
        resolverSelf = resolverFieldLabel(kid);
      } else {
        resolverSelf = resolverResolveType(kid);
      }
    }
    return resolverSelf;
  }
  function resolverClause(node: NodeId): Resolver {
    const kind = kindOf(resolverTree, node);
    if (kind === SyntaxKind.FailsClause) {
      for (const name of kidsOfKind(resolverTree, node, SyntaxKind.Name)) {
        if (nameTextOf(resolverTree, name) === "never") {
          continue;
        }
        resolverSelf = resolverErrorRef(name, true);
      }
    } else if (kind === SyntaxKind.WithClause) {
      for (
        const qn of kidsOfKind(resolverTree, node, SyntaxKind.QualifiedName)
      ) {
        if (nodeText(resolverTree, qn) === "never") {
          continue;
        }
        resolverSelf = resolverQualified(qn, "with");
      }
    } else if (kind === SyntaxKind.ProvidesClause) {
      for (
        const qn of kidsOfKind(resolverTree, node, SyntaxKind.QualifiedName)
      ) {
        resolverSelf = resolverQualified(qn, "provides");
      }
    }
    return resolverSelf;
  }
  function resolverResolveDecl(decl: DeclEntry): Resolver {
    const node = decl.node;
    resolverFn = decl.name;
    resolverScope = Scope(undefined);
    if (decl.kind === "type" || decl.kind === "error") {
      for (const kid of kidsOf(resolverTree, node)) {
        if (kid !== decl.nameNode) {
          resolverSelf = resolverResolveType(kid);
        }
      }
    } else if (decl.kind === "service") {
      for (
        const method of kidsOfKind(resolverTree, node, SyntaxKind.ServiceMethod)
      ) {
        for (const kid of kidsOf(resolverTree, method)) {
          const k = kindOf(resolverTree, kid);
          if (k === SyntaxKind.Name) {
            continue;
          }
          if (k === SyntaxKind.ParamList) {
            resolverSelf = resolverLabelParams(kid);
          } else if (k === SyntaxKind.FailsClause) {
            resolverSelf = resolverClause(kid);
          } else {
            resolverSelf = resolverResolveType(kid);
          }
        }
      }
    } else if (decl.kind === "provider") {
      for (const kid of kidsOf(resolverTree, node)) {
        const k = kindOf(resolverTree, kid);
        if (k === SyntaxKind.Name) {
          continue;
        }
        resolverSelf = resolverClause(kid);
      }
    } else {
      // The type annotation and the initializer of a top-level const.
      const rest = kidsOf(resolverTree, node).filter((kid) =>
        kid !== decl.nameNode
      );
      for (const kid of rest) {
        if (isTypeKind(kindOf(resolverTree, kid))) {
          resolverSelf = resolverResolveType(kid);
        }
      }
      const init = rest[rest.length - 1];
      if (init !== undefined && !isTypeKind(kindOf(resolverTree, init))) {
        resolverSelf = resolverExpr(init, "value");
      }
    }
    resolverScope = undefined;
    return resolverSelf;
  }
  function resolverExpr(node: NodeId, position: Position): Resolver {
    const kind = kindOf(resolverTree, node);
    if (kind === SyntaxKind.NameExpr) {
      return resolverValueRef(
        node,
        nodeText(resolverTree, node),
        position,
      );
    }
    if (kind === SyntaxKind.UsingExpr) {
      return resolverUsing(node);
    }
    if (kind === SyntaxKind.ArrowExpr) {
      return resolverArrow(node);
    }
    if (kind === SyntaxKind.CallExpr) {
      const kids = kidsOf(resolverTree, node);
      if (kids.length > 0) {
        resolverSelf = resolverExpr(kids[0], "callee");
      }
      if (
        kids[0] !== undefined &&
        kindOf(resolverTree, kids[0]) === SyntaxKind.NameExpr &&
        takesServiceArgument(nodeText(resolverTree, kids[0])) &&
        kids[1] !== undefined &&
        kindOf(resolverTree, kids[1]) === SyntaxKind.ArgList
      ) {
        const args = kidsOf(resolverTree, kids[1]);
        const first = args[0];
        if (
          first !== undefined &&
          kindOf(resolverTree, first) === SyntaxKind.NameExpr
        ) {
          const service = resolverServiceBinding(first);
          if (service !== undefined) {
            resolverSelf = resolverSet(first, service.target);
          } else {
            resolverSelf = resolverExpr(first, "value");
          }
        } else if (first !== undefined) {
          resolverSelf = resolverExpr(first, "value");
        }
        for (const arg of args.slice(1)) {
          resolverSelf = resolverExpr(arg, "value");
        }
        return resolverSelf;
      }
      for (const arg of kids.slice(1)) {
        resolverSelf = resolverExpr(arg, "value");
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.FieldExpr) {
      return resolverFieldExpr(node);
    }
    if (kind === SyntaxKind.PipeExpr) {
      const kids = kidsOf(resolverTree, node);
      if (kids.length > 0) {
        resolverSelf = resolverExpr(kids[0], "value");
      }
      for (const stage of kids.slice(1)) {
        resolverSelf = resolverPipeStage(stage);
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.RecordExpr) {
      for (const field of kidsOf(resolverTree, node)) {
        resolverSelf = resolverRecordField(field);
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.Block) {
      return resolverBlock(node, undefined);
    }
    if (kind === SyntaxKind.MatchExpr) {
      const kids = kidsOf(resolverTree, node);
      if (kids.length > 0) {
        resolverSelf = resolverExpr(kids[0], "value");
      }
      for (const arm of kids.slice(1)) {
        if (kindOf(resolverTree, arm) === SyntaxKind.MatchArm) {
          resolverSelf = resolverArm(arm);
        }
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.TryExpr) {
      for (const kid of kidsOf(resolverTree, node)) {
        if (kindOf(resolverTree, kid) === SyntaxKind.CatchClause) {
          for (const h of kidsOfKind(resolverTree, kid, SyntaxKind.Handler)) {
            resolverSelf = resolverHandler(h);
          }
        } else if (kindOf(resolverTree, kid) === SyntaxKind.FinallyClause) {
          const outer = resolverScope;
          resolverScope = Scope(outer);
          resolverSelf = resolverBodyWithOutcome(kid);
          resolverScope = outer;
        } else {
          resolverSelf = resolverExpr(kid, "value");
        }
      }
      return resolverSelf;
    }
    if (
      kind === SyntaxKind.ParenExpr || kind === SyntaxKind.BinaryExpr ||
      kind === SyntaxKind.UnaryExpr ||
      kind === SyntaxKind.OptionFallbackExpr || kind === SyntaxKind.ArgList ||
      kind === SyntaxKind.ListExpr || kind === SyntaxKind.SpreadElement ||
      kind === SyntaxKind.IfExpr
    ) {
      for (const kid of kidsOf(resolverTree, node)) {
        resolverSelf = resolverExpr(kid, "value");
      }
      return resolverSelf;
    }
    return resolverSelf;
  }
  function resolverFieldExpr(node: NodeId): Resolver {
    const parts = memberAccessParts(resolverTree, node);
    const base = parts.base;
    const member = parts.member;
    if (base === undefined) {
      return resolverSelf;
    }
    if (kindOf(resolverTree, base) === SyntaxKind.NameExpr) {
      const service = resolverServiceBinding(base);
      if (service !== undefined) {
        resolverSelf = resolverSet(base, service.target);
        if (member === undefined) {
          return resolverSelf;
        }
        const resolved = resolverMethodRef(service, member);
        resolverSelf = resolved.owner;
        if (resolved.target !== undefined) {
          resolverSelf = resolverSet(node, resolved.target);
        } else {
          resolverSelf = resolverUnresolved(
            node,
            nameTextOf(resolverTree, member) ?? "",
          );
        }
        return resolverSelf;
      }
    }
    resolverSelf = resolverExpr(base, "value");
    if (member !== undefined) {
      resolverSelf = resolverFieldLabel(member);
    }
    return resolverSelf;
  }
  function resolverPipeStage(stage: NodeId): Resolver {
    if (kindOf(resolverTree, stage) !== SyntaxKind.PipeStage) {
      return resolverSelf;
    }
    for (const kid of kidsOf(resolverTree, stage)) {
      const kind = kindOf(resolverTree, kid);
      if (kind === SyntaxKind.QualifiedName) {
        resolverSelf = resolverQualified(kid, "stage");
      } else {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    return resolverSelf;
  }
  function resolverRecordField(field: NodeId): Resolver {
    const kind = kindOf(resolverTree, field);
    if (kind === SyntaxKind.RecordField) {
      for (const kid of kidsOf(resolverTree, field)) {
        if (kindOf(resolverTree, kid) === SyntaxKind.Name) {
          resolverSelf = resolverFieldLabel(kid);
        } else {
          resolverSelf = resolverExpr(kid, "value");
        }
      }
    } else if (kind === SyntaxKind.ShorthandField) {
      for (const kid of kidsOf(resolverTree, field)) {
        if (kindOf(resolverTree, kid) !== SyntaxKind.Name) {
          continue;
        }
        const name = nameTextOf(resolverTree, kid);
        if (name !== undefined) {
          resolverSelf = resolverValueRef(kid, name, "value");
        }
      }
    } else if (kind === SyntaxKind.SpreadField) {
      for (const kid of kidsOf(resolverTree, field)) {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    return resolverSelf;
  }
  function resolverBodyWithOutcome(region: NodeId): Resolver {
    for (const kid of kidsOf(resolverTree, region)) {
      if (kindOf(resolverTree, kid) === SyntaxKind.Name) {
        resolverSelf = resolverDeclareLocal(kid, false).owner;
      } else {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    return resolverSelf;
  }
  function resolverUsing(node: NodeId): Resolver {
    const parts = kidsOf(resolverTree, node);
    const name = parts.find((k) => kindOf(resolverTree, k) === SyntaxKind.Name);
    const acquire = parts.find((k) =>
      kindOf(resolverTree, k) === SyntaxKind.ResourceAcquire
    );
    const outer = resolverScope;
    if (acquire !== undefined) {
      resolverScope = Scope(outer);
      for (const body of kidsOf(resolverTree, acquire)) {
        resolverSelf = resolverExpr(body, "value");
      }
    }
    const scope = Scope(outer);
    resolverScope = scope;
    if (name !== undefined) {
      resolverSelf = resolverDeclareLocal(name, false).owner;
    }
    for (
      const region of parts.filter((k) =>
        RESOURCE_REGIONS.includes(kindOf(resolverTree, k))
      )
    ) {
      resolverScope = Scope(scope);
      resolverSelf = resolverBodyWithOutcome(region);
    }
    resolverScope = outer;
    return resolverSelf;
  }
  function resolverArrow(node: NodeId): Resolver {
    const outer = resolverScope;
    const scope = Scope(outer);
    resolverScope = scope;
    for (const kid of kidsOf(resolverTree, node)) {
      const kind = kindOf(resolverTree, kid);
      if (kind === SyntaxKind.ParamList) {
        for (const param of kidsOfKind(resolverTree, kid, SyntaxKind.Param)) {
          for (const part of kidsOf(resolverTree, param)) {
            if (kindOf(resolverTree, part) === SyntaxKind.Name) {
              resolverSelf = resolverDeclareLocal(part, false).owner;
            } else {
              resolverSelf = resolverResolveType(part);
            }
          }
        }
      } else if (
        kind === SyntaxKind.FailsClause || kind === SyntaxKind.WithClause
      ) {
        resolverSelf = resolverClause(kid);
      } else if (isTypeKind(kind)) {
        resolverSelf = resolverResolveType(kid);
      } else if (kind === SyntaxKind.Block) {
        resolverSelf = resolverBlock(kid, scope);
      } else {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    resolverScope = outer;
    return resolverSelf;
  }
  function resolverBlock(node: NodeId, shared: Scope | undefined): Resolver {
    const outer = resolverScope;
    resolverScope = shared ?? Scope(outer);
    for (const item of kidsOf(resolverTree, node)) {
      if (kindOf(resolverTree, item) === SyntaxKind.ConstDecl) {
        resolverSelf = resolverBlockConst(item);
      } else {
        resolverSelf = resolverExpr(item, "value");
      }
    }
    resolverScope = outer;
    return resolverSelf;
  }
  function resolverBlockConst(node: NodeId): Resolver {
    const kids = kidsOf(resolverTree, node);
    const record = kids.find((k) =>
      kindOf(resolverTree, k) === SyntaxKind.RecordBinding
    );
    if (record !== undefined) {
      const bindings: LocalBinding[] = [];
      for (const field of kidsOf(resolverTree, record)) {
        const names = kidsOfKind(resolverTree, field, SyntaxKind.Name);
        if (
          kindOf(resolverTree, field) === SyntaxKind.BindingField &&
          names[0] !== undefined
        ) {
          resolverSelf = resolverFieldLabel(names[0]);
        }
        const name = names.at(-1);
        if (name !== undefined) {
          const declared = resolverDeclareLocal(name, true);
          resolverSelf = declared.owner;
          const binding = declared.binding;
          if (binding !== undefined) {
            bindings[bindings.length] = binding;
          }
        }
      }
      for (const part of kids.filter((k) => k !== record)) {
        if (isTypeKind(kindOf(resolverTree, part))) {
          resolverSelf = resolverResolveType(part);
        } else {
          resolverSelf = resolverExpr(part, "value");
        }
      }
      for (const binding of bindings) {
        resolverPending = resolverPending.set(binding.id, false);
      }
      return resolverSelf;
    }
    const nameNode = kids.find((k) =>
      kindOf(resolverTree, k) === SyntaxKind.Name
    );
    if (nameNode === undefined) {
      return resolverSelf;
    }
    const rest = kids.filter((k) => k !== nameNode);
    const init = rest.find((k) => !isTypeKind(kindOf(resolverTree, k)));
    const isArrow = init !== undefined &&
      kindOf(resolverTree, init) === SyntaxKind.ArrowExpr;
    const declared = resolverDeclareLocal(nameNode, !isArrow);
    resolverSelf = declared.owner;
    const binding = declared.binding;
    for (const kid of rest) {
      if (isTypeKind(kindOf(resolverTree, kid))) {
        resolverSelf = resolverResolveType(kid);
      }
    }
    if (init !== undefined) {
      resolverSelf = resolverExpr(init, "value");
    }
    if (binding !== undefined) {
      resolverPending = resolverPending.set(binding.id, false);
    }
    return resolverSelf;
  }
  function resolverArm(node: NodeId): Resolver {
    const outer = resolverScope;
    const scope = Scope(outer);
    resolverScope = scope;
    for (const kid of kidsOf(resolverTree, node)) {
      const kind = kindOf(resolverTree, kid);
      if (isPatternKind(kind)) {
        resolverSelf = resolverPattern(kid);
      } else if (kind === SyntaxKind.Block) {
        resolverSelf = resolverBlock(kid, scope);
      } else {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    resolverScope = outer;
    return resolverSelf;
  }
  function resolverHandler(node: NodeId): Resolver {
    const outer = resolverScope;
    const scope = Scope(outer);
    resolverScope = scope;
    let names = 0;
    for (const kid of kidsOf(resolverTree, node)) {
      const kind = kindOf(resolverTree, kid);
      if (kind === SyntaxKind.Name) {
        if (names === 0) {
          if (nameTextOf(resolverTree, kid) === DEFECT_ARM) {
            resolverDefectArms = resolverDefectArms.add(kid);
          } else {
            resolverSelf = resolverErrorRef(kid, false);
          }
        } else {
          resolverSelf = resolverDeclareLocal(kid, false).owner;
        }
        names = names + 1;
      } else if (kind === SyntaxKind.Block) {
        resolverSelf = resolverBlock(kid, scope);
      } else {
        resolverSelf = resolverExpr(kid, "value");
      }
    }
    resolverScope = outer;
    return resolverSelf;
  }
  function resolverPattern(node: NodeId): Resolver {
    const kind = kindOf(resolverTree, node);
    if (kind === SyntaxKind.NamePattern) {
      for (const name of kidsOfKind(resolverTree, node, SyntaxKind.Name)) {
        if (resolverIsConstructorName(name)) {
          resolverSelf = resolverCtorRef(name);
        } else {
          resolverSelf = resolverDeclareLocal(name, false).owner;
        }
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.CtorPattern) {
      const names = kidsOfKind(resolverTree, node, SyntaxKind.Name);
      if (names.length > 0) {
        resolverSelf = resolverCtorRef(names[0]);
      }
      if (names.length > 1) {
        resolverSelf = resolverDeclareLocal(names[1], false).owner;
      }
      return resolverSelf;
    }
    if (kind === SyntaxKind.RecordPattern) {
      for (const field of kidsOf(resolverTree, node)) {
        const fieldKind = kindOf(resolverTree, field);
        if (fieldKind === SyntaxKind.PatternField) {
          for (
            const name of kidsOfKind(resolverTree, field, SyntaxKind.Name)
          ) {
            resolverSelf = resolverFieldLabel(name);
          }
        } else if (fieldKind === SyntaxKind.SpreadPattern) {
          for (
            const name of kidsOfKind(resolverTree, field, SyntaxKind.Name)
          ) {
            resolverSelf = resolverDeclareLocal(name, false).owner;
          }
        }
      }
      return resolverSelf;
    }
    return resolverSelf;
  }
  function resolverRun(): ModuleResolution {
    resolverSelf = resolverBindImports();
    for (const decl of resolverInfo.index.decls) {
      resolverSelf = resolverResolveDecl(decl);
    }
    return {
      targets: resolverTargets,
      defectArms: resolverDefectArms,
      locals: resolverLocals,
      namespace: resolverNamespace,
      diagnostics: normalizeDiagnostics(resolverDiagnostics),
    };
  }
  resolverSelf = {
    run: resolverRun,
  };
  return resolverSelf;
}
/** Resolves every module of the project. The map follows the topological order. */
export function resolveProject(
  project: Project,
): ReadonlyMap<string, ModuleResolution> {
  let result = emptyMap<string, ModuleResolution>();
  for (const name of project.order) {
    const info = project.modules.get(name);
    if (info !== undefined) {
      result = result.set(name, Resolver(info, project).run());
    }
  }
  return result;
}
