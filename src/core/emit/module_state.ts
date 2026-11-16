import { emptyMap, emptySet, indices, mapFrom, setFrom } from "../runtime.ts";
// The naming state of one emitted module: the names
// that the module owns, the names that the emitter generates, the imports that
// the module must print, and the host registry.
import type {
  Declaration,
  DeclarationId,
  ErrorDecl,
  LocalId,
  ModuleIR,
  ServiceDecl,
  Type,
  TypeDecl,
} from "../ir.ts";
import {
  isClosedUnitId,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";
import {
  generatedPathOf,
  hostKeyOf,
  isHostLabel,
  isInterfacePath,
  isPreludeModule,
  moduleNameOf,
  normalizeRelative,
  relativeSpecifier,
} from "../paths.ts";
import type { ProjectConfig } from "../project_config.ts";
import { compareText, trueFlag } from "../util.ts";
import { isValueId } from "../ids.ts";
import { internal } from "./failure.ts";
import { moduleOfId, nameOfId } from "./identity.ts";
import { type EffectModule, isDeferredType } from "./type_query.ts";
import { binderNames } from "./walk.ts";
const INT_TYPE: Type = { kind: "primitive", name: "int" };
/** The order of `deno fmt` for named imports: case-insensitive, then by code unit. */
function compareImportNames(a: string, b: string): number {
  return compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b);
}
// ------------------------------------------------------------------ the scope
type HostBinding = {
  /** The registry key: `providers` for `host:providers`. */
  readonly key: string;
  /** The name that the host module exports. */
  readonly exported: string;
  /** The name that the Effektive source binds. */
  readonly local: string;
  /** The name of the assertion constant: `UsersLive$host`. */
  readonly hostName: string;
  readonly specifier: string;
};
type ImportedName = {
  readonly local: string;
  readonly typeOnly: boolean;
};
export type ImportGroup = {
  readonly specifier: string;
  readonly names: readonly {
    readonly exported: string;
    readonly local: string;
    readonly typeOnly: boolean;
  }[];
};
type OutcomeNames = {
  readonly type: string;
  readonly make: string;
};
export type HelperKey =
  | "intSchema"
  | "intFunction"
  | "remainder"
  | "divide"
  | "round"
  | "at"
  | "sort"
  | "unmatched"
  | "hostCheck"
  | "outcome";
type NamedHelperKey = Exclude<HelperKey, "outcome">;
const HELPER_NAMES: Readonly<Record<NamedHelperKey, string>> = {
  intSchema: "$Int",
  intFunction: "$int",
  remainder: "$rem",
  divide: "$div",
  round: "$round",
  at: "$at",
  sort: "$sort",
  unmatched: "$unmatched",
  hostCheck: "$hostCheck",
};
/** The key of a module-level field helper. The key names the helper in the emitted text. */
export type FieldHelperKey =
  | "record"
  | "optionalField"
  | "suppliedFields"
  | "untagged";
type FieldAdapter = {
  readonly name: string;
  readonly type: Type;
  readonly direction: "decoded" | "encoded" | "make";
};
/** Names for the emitted module. Each member records the name on first use. */
export interface EmitNames {
  effect(module: EffectModule): string;
  nameOf(id: DeclarationId): string;
  encodedMirrorName(id: DeclarationId): string;
  intSchemaName(): string;
  intFunction(): string;
  remainder(): string;
  divide(): string;
  round(): string;
  at(): string;
  sort(): string;
  unmatched(): string;
  outcome(): OutcomeNames;
  hostCheck(): string;
  serviceParameter(): string;
  fieldHelper(key: FieldHelperKey): string;
  fieldAdapter(type: Type, direction: "decoded" | "encoded" | "make"): string;
}
interface Temporaries {
  fresh(base: string): string;
  temp(): string;
}
/** Reads of the module IR and the config. No member records anything. */
export interface TypeLookup {
  resolve(type: Type): Type;
  typeLevelDeclaration(
    id: DeclarationId,
  ): TypeDecl | ErrorDecl | ServiceDecl | undefined;
}
/**
 * What the expression emitter, the type printers, and the field adapters read.
 * It has no import ledger and no `resetTemporaries`.
 */
export type ExprScope =
  & EmitNames
  & Temporaries
  & TypeLookup
  & Pick<
    ModuleState,
    "locals" | "hostBinding" | "fieldAdapters" | "fieldHelpers"
  >;
export type ModuleState =
  & EmitNames
  & Temporaries
  & TypeLookup
  & {
    readonly source: string;
    readonly path: string;
    readonly locals: ReadonlyMap<`local:${string}`, string>;
    readonly hosts: ReadonlyMap<DeclarationId, HostBinding>;
    readonly fieldHelpers: ReadonlyMap<FieldHelperKey, string>;
    readonly fieldAdapters: () => Iterable<FieldAdapter>;
    readonly ir: ModuleIR;
    readonly resetTemporaries: () => ModuleState;
    readonly usesHelper: (key: HelperKey) => boolean;
    readonly isTypeOnly: (id: DeclarationId) => boolean;
    readonly hostBinding: (id: DeclarationId) => HostBinding | undefined;
    readonly finish: () => ImportGroup[];
  };
export function ModuleState(ir: ModuleIR, config: ProjectConfig): ModuleState {
  const moduleStateConfig = config;
  const moduleStateIr = ir;
  const moduleStateModule = ir.module;
  const moduleStateSource = ir.sources[0] ?? `${ir.module}.eff`;
  const moduleStatePath = generatedPathOf(moduleStateSource);
  let moduleStateTaken = emptySet<string>();
  let moduleStateLocals = emptyMap<LocalId, string>();
  let moduleStateLocalDecls = emptyMap<DeclarationId, Declaration>();
  let moduleStateForeignDecls = emptyMap<
    DeclarationId,
    TypeDecl | ErrorDecl | ServiceDecl
  >();
  let moduleStateBound = emptyMap<DeclarationId, string>();
  let moduleStateUnusedImports = emptySet<DeclarationId>();
  let moduleStateAllocated = emptyMap<DeclarationId, string>();
  let moduleStateForeignImports = emptyMap<
    string,
    Map<string, ImportedName>
  >();
  let moduleStateHosts = emptyMap<DeclarationId, HostBinding>();
  let moduleStateHostDeclarations = emptyMap<
    string,
    Map<string, ImportedName>
  >();
  let moduleStateEffectAliases = emptyMap<EffectModule, string>();
  let moduleStateFieldHelpers = emptyMap<FieldHelperKey, string>();
  let moduleStateFieldAdaptersByKey = emptyMap<string, FieldAdapter>();
  let moduleStateHelperNames = emptyMap<HelperKey, string>();
  let moduleStateOutcomeHelper: OutcomeNames | undefined;
  let moduleStateServiceName: string | undefined;
  let moduleStateFinished = false;
  let moduleStateTemporaries = 0;
  let moduleStateDeclarationTemporaries: string[] = [];
  let moduleStateTypeOnlyMemo = emptyMap<DeclarationId, boolean>();
  let moduleStateEncodedMirrors = emptyMap<DeclarationId, string>();
  for (const declaration of ir.declarations) {
    moduleStateLocalDecls = moduleStateLocalDecls.set(
      declaration.id,
      declaration,
    );
    moduleStateTaken = moduleStateTaken.add(declaration.name);
    for (const binder of binderNames(declaration)) {
      const id = binder[0];
      const name = binder[1];
      moduleStateLocals = moduleStateLocals.set(id, name);
      moduleStateTaken = moduleStateTaken.add(name);
    }
  }
  for (const imported of ir.imports) {
    for (const t of imported.types) {
      moduleStateForeignDecls = moduleStateForeignDecls.set(t.id, t);
    }
    for (const e of imported.errors) {
      moduleStateForeignDecls = moduleStateForeignDecls.set(e.id, e);
    }
    for (const s of imported.services) {
      moduleStateForeignDecls = moduleStateForeignDecls.set(s.id, s);
    }
  }
  for (const imported of ir.imports) {
    if (isPreludeModule(imported.module)) {
      continue;
    }
    for (const binding of imported.bindings) {
      moduleStateTaken = moduleStateTaken.add(binding.name);
    }
  }
  for (const imported of ir.imports) {
    if (isPreludeModule(imported.module)) {
      continue;
    }
    if (isHostLabel(imported.module)) {
      moduleStateHosts = moduleStateBindHost(
        imported.module,
        imported.bindings,
      );
      continue;
    }
    for (const binding of imported.bindings) {
      moduleStateBound = moduleStateBound.set(binding.target, binding.name);
      // A companion module prints only the imports that its declarations use.
      if (isInterfacePath(moduleStateSource)) {
        moduleStateUnusedImports = moduleStateUnusedImports.add(binding.target);
      } else {
        moduleStateForeignImports = moduleStateAddImport(
          binding.target,
          binding.name,
        );
      }
    }
  }
  function moduleStateFieldAdapters(): Iterable<FieldAdapter> {
    return moduleStateFieldAdaptersByKey.values();
  }
  function moduleStateFieldAdapter(
    type: Type,
    direction: "decoded" | "encoded" | "make",
  ): string {
    const key = JSON.stringify([direction, type]);
    const existing = moduleStateFieldAdaptersByKey.get(key);
    if (existing !== undefined) {
      return existing.name;
    }
    const name = moduleStateFresh("$fields");
    moduleStateFieldAdaptersByKey = moduleStateFieldAdaptersByKey.set(key, {
      name: name,
      type: type,
      direction: direction,
    });
    return name;
  }
  function moduleStateFieldHelper(key: FieldHelperKey): string {
    let name = moduleStateFieldHelpers.get(key);
    if (name === undefined) {
      name = moduleStateFresh(`$${key}`);
      moduleStateFieldHelpers = moduleStateFieldHelpers.set(key, name);
    }
    return name;
  }
  function moduleStateBindHost(
    label: string,
    bindings: readonly {
      readonly name: string;
      readonly target: DeclarationId;
    }[],
  ): Map<DeclarationId, HostBinding> {
    const key = hostKeyOf(label);
    const host = moduleStateConfig.host.get(key);
    if (host === undefined) {
      return internal(`the host module ${label} is not in the project file`);
    }
    const target = normalizeRelative(host.modulePath);
    if (target === undefined) {
      return internal(`the host module path ${host.modulePath} is not valid`);
    }
    const specifier = relativeSpecifier(moduleStatePath, target);
    for (const binding of bindings) {
      if (isValueId(binding.target)) {
        moduleStateHosts = moduleStateHosts.set(binding.target, {
          key: key,
          exported: nameOfId(binding.target),
          local: binding.name,
          hostName: moduleStateFresh(`${binding.name}$host`),
          specifier: specifier,
        });
      } else {
        moduleStateBound = moduleStateBound.set(binding.target, binding.name);
        const declaration = moduleStateTypeLevelDeclaration(binding.target);
        if (declaration?.kind === "type" && trueFlag(declaration.opaque)) {
          let names = moduleStateHostDeclarations.get(specifier) ??
            emptyMap<string, ImportedName>();
          names = names.set(nameOfId(binding.target), {
            local: binding.name,
            typeOnly: true,
          });
          moduleStateHostDeclarations = moduleStateHostDeclarations.set(
            specifier,
            names,
          );
        } else {
          // The companion module of the interface owns every other declaration.
          moduleStateForeignImports = moduleStateAddImport(
            binding.target,
            binding.name,
          );
        }
      }
    }
    return moduleStateHosts;
  }
  function moduleStateImportOpaque(
    module: string,
    exported: string,
    local: string,
  ): Map<string, Map<string, ImportedName>> {
    if (!moduleStateIsOpen()) {
      return internal(
        `the opaque type ${exported} is imported after the imports are final`,
      );
    }
    for (const host of moduleStateConfig.host.values()) {
      const iface = normalizeRelative(host.interfacePath);
      if (iface === undefined || moduleNameOf(iface) !== module) {
        continue;
      }
      const target = normalizeRelative(host.modulePath);
      if (target === undefined) {
        break;
      }
      const specifier = relativeSpecifier(moduleStatePath, target);
      let names = moduleStateHostDeclarations.get(specifier) ??
        emptyMap<string, ImportedName>();
      names = names.set(exported, { local: local, typeOnly: true });
      moduleStateHostDeclarations = moduleStateHostDeclarations.set(
        specifier,
        names,
      );
      return moduleStateHostDeclarations;
    }
    return internal(`the interface ${module} has no host module`);
  }
  function moduleStateIsOpen(): boolean {
    return !moduleStateFinished;
  }
  function moduleStateFresh(base: string): string {
    if (!moduleStateIsOpen()) {
      return internal(
        `the name ${base} is allocated after the imports are final`,
      );
    }
    for (const n of indices(Number.MAX_SAFE_INTEGER)) {
      const candidate = n === 0 ? base : `${base}$${n}`;
      if (!moduleStateTaken.has(candidate)) {
        moduleStateTaken = moduleStateTaken.add(candidate);
        return candidate;
      }
    }
    return internal(`no generated name is available for ${base}`);
  }
  function moduleStateTemp(): string {
    if (!moduleStateIsOpen()) {
      return internal("a temporary is allocated after the imports are final");
    }
    for (const _attempt of indices(Number.MAX_SAFE_INTEGER)) {
      const candidate = `$t${moduleStateTemporaries}`;
      moduleStateTemporaries = moduleStateTemporaries + 1;
      if (!moduleStateTaken.has(candidate)) {
        moduleStateTaken = moduleStateTaken.add(candidate);
        moduleStateDeclarationTemporaries[
          moduleStateDeclarationTemporaries.length
        ] = candidate;
        return candidate;
      }
    }
    return internal("no temporary name is available");
  }
  function moduleStateResetTemporaries(): ModuleState {
    const temporaryNames = setFrom(moduleStateDeclarationTemporaries);
    moduleStateTaken = setFrom(
      [...moduleStateTaken].filter((name) => !temporaryNames.has(name)),
    );
    moduleStateDeclarationTemporaries = [];
    moduleStateTemporaries = 0;
    return moduleStateSelf;
  }
  function moduleStateEffect(module: EffectModule): string {
    let alias = moduleStateEffectAliases.get(module);
    if (alias === undefined) {
      alias = moduleStateFresh(module);
      moduleStateEffectAliases = moduleStateEffectAliases.set(module, alias);
    }
    return alias;
  }
  function moduleStateEncodedMirrorName(id: DeclarationId): string {
    let name = moduleStateEncodedMirrors.get(id);
    if (name === undefined) {
      name = moduleStateFresh(`${moduleStateNameOf(id)}Encoded`);
      moduleStateEncodedMirrors = moduleStateEncodedMirrors.set(id, name);
    }
    return name;
  }
  function moduleStateUsesHelper(key: HelperKey): boolean {
    return key === "outcome"
      ? moduleStateOutcomeHelper !== undefined
      : moduleStateHelperNames.has(key);
  }
  function moduleStateHelper(key: NamedHelperKey): string {
    let name = moduleStateHelperNames.get(key);
    if (name === undefined) {
      name = moduleStateFresh(HELPER_NAMES[key]);
      moduleStateHelperNames = moduleStateHelperNames.set(key, name);
    }
    return name;
  }
  function moduleStateOutcome(): OutcomeNames {
    if (moduleStateOutcomeHelper === undefined) {
      moduleStateOutcomeHelper = {
        type: moduleStateFresh("$Outcome"),
        make: moduleStateFresh("$outcome"),
      };
    }
    return moduleStateOutcomeHelper;
  }
  function moduleStateServiceParameter(): string {
    if (moduleStateServiceName === undefined) {
      moduleStateServiceName = moduleStateFresh("$s");
    }
    return moduleStateServiceName;
  }
  function moduleStateTypeLevelDeclaration(
    id: DeclarationId,
  ): TypeDecl | ErrorDecl | ServiceDecl | undefined {
    const local = moduleStateLocalDecls.get(id);
    if (local !== undefined) {
      return local.kind === "type" || local.kind === "error" ||
          local.kind === "service"
        ? local
        : undefined;
    }
    return moduleStateForeignDecls.get(id);
  }
  function moduleStateIsTypeOnly(id: DeclarationId): boolean {
    const known = moduleStateTypeOnlyMemo.get(id);
    if (known !== undefined) {
      return known;
    }
    moduleStateTypeOnlyMemo = moduleStateTypeOnlyMemo.set(id, false);
    const declaration = moduleStateTypeLevelDeclaration(id);
    let result = false;
    if (declaration?.kind === "type" && trueFlag(declaration.opaque)) {
      // The host module declares an opaque type as a type: it has no value.
      result = true;
    } else if (
      declaration?.kind === "type" && declaration.definition.kind === "alias"
    ) {
      result = moduleStateContainsFunction(declaration.definition.type);
    }
    moduleStateTypeOnlyMemo = moduleStateTypeOnlyMemo.set(id, result);
    return result;
  }
  function moduleStateResolve(type: Type): Type {
    let current = type;
    let seen = emptySet<DeclarationId>();
    for (const _depth of indices(Number.MAX_SAFE_INTEGER)) {
      if (current.kind !== "named" || seen.has(current.id)) return current;
      // `Duration` and `Instant` are identities over `int`: they keep the `int` guard.
      if (isClosedUnitId(current.id)) {
        return INT_TYPE;
      }
      seen = seen.add(current.id);
      const declaration = moduleStateTypeLevelDeclaration(current.id);
      if (
        declaration?.kind !== "type" || declaration.definition.kind !== "alias"
      ) {
        return current;
      }
      current = declaration.definition.type;
    }
    return internal("a named type chain exceeded the native index range");
  }
  function moduleStateContainsFunction(type: Type): boolean {
    if (isDeferredType(type)) {
      return true;
    }
    if (type.kind === "primitive" || type.kind === "literal") return false;
    if (type.kind === "named") return moduleStateIsTypeOnly(type.id);
    if (type.kind === "record") {
      return type.fields.some((f) => moduleStateContainsFunction(f.type));
    }
    if (type.kind === "array" || type.kind === "option") {
      return moduleStateContainsFunction(type.element);
    }
    if (type.kind === "tuple") {
      return type.elements.some((t) => moduleStateContainsFunction(t));
    }
    return type.members.some((t) => moduleStateContainsFunction(t));
  }
  function moduleStateNameOf(id: DeclarationId): string {
    // `Duration` and `Instant` are numbers of milliseconds at run time.
    if (isClosedUnitId(id)) {
      return "number";
    }
    if (id === SCHEMA_ERROR_ID) {
      return `${moduleStateEffect("Schema")}.SchemaError`;
    }
    if (id === TIMEOUT_ERROR_ID) {
      return `${moduleStateEffect("Cause")}.TimeoutError`;
    }
    if (id === SCHEMA_ISSUE_ID) {
      return `${moduleStateEffect("SchemaIssue")}.Issue`;
    }
    const local = moduleStateLocalDecls.get(id);
    if (local !== undefined) {
      if (local.kind === "type" && trueFlag(local.opaque)) {
        moduleStateHostDeclarations = moduleStateImportOpaque(
          moduleStateModule,
          local.name,
          local.name,
        );
      }
      return local.name;
    }
    const bound = moduleStateBound.get(id);
    if (bound !== undefined) {
      if (moduleStateUnusedImports.has(id)) {
        moduleStateForeignImports = moduleStateAddImport(id, bound);
        if (!moduleStateUnusedImports.delete(id)) {
          return internal(`the deferred import ${id} disappeared before use`);
        }
      }
      return bound;
    }
    const allocated = moduleStateAllocated.get(id);
    if (allocated !== undefined) {
      return allocated;
    }
    const exported = nameOfId(id);
    const name = moduleStateFresh(exported);
    moduleStateAllocated = moduleStateAllocated.set(id, name);
    const foreign = moduleStateTypeLevelDeclaration(id);
    if (foreign?.kind === "type" && trueFlag(foreign.opaque)) {
      moduleStateHostDeclarations = moduleStateImportOpaque(
        moduleOfId(id),
        exported,
        name,
      );
    } else {
      moduleStateForeignImports = moduleStateAddImport(id, name);
    }
    return name;
  }
  function moduleStateHostBinding(id: DeclarationId): HostBinding | undefined {
    return moduleStateHosts.get(id);
  }
  function moduleStateAddImport(
    id: DeclarationId,
    local: string,
  ): Map<string, Map<string, ImportedName>> {
    const module = moduleOfId(id);
    const exported = nameOfId(id);
    if (!moduleStateIsOpen()) {
      return internal(`${exported} is imported after the imports are final`);
    }
    const names = moduleStateForeignImports.get(module) ??
      emptyMap<string, ImportedName>();
    return moduleStateForeignImports.set(
      module,
      names.set(exported, {
        local: local,
        typeOnly: moduleStateIsTypeOnly(id),
      }),
    );
  }
  function moduleStateFinish(): ImportGroup[] {
    moduleStateFinished = true;
    return [
      ...moduleStateEffectImports(),
      ...moduleStateModuleImports(),
      ...moduleStateHostImports(),
    ];
  }
  function moduleStateModuleImports(): ImportGroup[] {
    const groups: ImportGroup[] = [];
    // The companion module path of each host interface module, by module name.
    let companions = emptyMap<string, string>();
    for (const host of moduleStateConfig.host.values()) {
      const path = normalizeRelative(host.interfacePath);
      if (path !== undefined) {
        companions = companions.set(moduleNameOf(path), generatedPathOf(path));
      }
    }
    for (const moduleEntry of moduleStateForeignImports) {
      const module = moduleEntry[0];
      const names = moduleEntry[1];
      groups[groups.length] = {
        specifier: relativeSpecifier(
          moduleStatePath,
          companions.get(module) ?? `${module}.ts`,
        ),
        names: [...names].map((nameEntry) => {
          const exported = nameEntry[0];
          const imported = nameEntry[1];
          return {
            exported: exported,
            local: imported.local,
            typeOnly: imported.typeOnly,
          };
        }).sort((a, b) => compareImportNames(a.exported, b.exported)),
      };
    }
    return groups.sort((a, b) => compareText(a.specifier, b.specifier));
  }
  function moduleStateEffectImports(): ImportGroup[] {
    const names = [...moduleStateEffectAliases]
      .map((effectEntry) => ({
        exported: effectEntry[0],
        local: effectEntry[1],
        typeOnly: false,
      }))
      .sort((a, b) => compareImportNames(a.exported, b.exported));
    return names.length === 0 ? [] : [{ specifier: "effect", names: names }];
  }
  function moduleStateHostImports(): ImportGroup[] {
    let bySpecifier = emptyMap<string, Map<string, ImportedName>>();
    for (const hostEntry of moduleStateHostDeclarations) {
      const specifier = hostEntry[0];
      const names = hostEntry[1];
      bySpecifier = bySpecifier.set(specifier, mapFrom(names));
    }
    for (const host of moduleStateHosts.values()) {
      let names = bySpecifier.get(host.specifier) ??
        emptyMap<string, ImportedName>();
      names = names.set(host.exported, { local: host.local, typeOnly: false });
      bySpecifier = bySpecifier.set(host.specifier, names);
    }
    return [...bySpecifier].map((specifierEntry) => {
      const specifier = specifierEntry[0];
      const names = specifierEntry[1];
      return {
        specifier: specifier,
        names: [...names].sort((a, b) => compareImportNames(a[0], b[0])).map(
          (nameEntry) => {
            const exported = nameEntry[0];
            const entry = nameEntry[1];
            return {
              exported: exported,
              local: entry.local,
              typeOnly: entry.typeOnly,
            };
          },
        ),
      };
    }).sort((a, b) => compareText(a.specifier, b.specifier));
  }
  const moduleStateSelf: ModuleState = {
    source: moduleStateSource,
    path: moduleStatePath,
    locals: moduleStateLocals,
    hosts: moduleStateHosts,
    fieldHelpers: moduleStateFieldHelpers,
    fieldAdapters: moduleStateFieldAdapters,
    fieldAdapter: moduleStateFieldAdapter,
    fieldHelper: moduleStateFieldHelper,
    ir: moduleStateIr,
    fresh: moduleStateFresh,
    temp: moduleStateTemp,
    resetTemporaries: moduleStateResetTemporaries,
    effect: moduleStateEffect,
    encodedMirrorName: moduleStateEncodedMirrorName,
    usesHelper: moduleStateUsesHelper,
    intFunction: () => moduleStateHelper("intFunction"),
    remainder: () => moduleStateHelper("remainder"),
    divide: () => moduleStateHelper("divide"),
    at: () => moduleStateHelper("at"),
    sort: () => moduleStateHelper("sort"),
    round: () => moduleStateHelper("round"),
    unmatched: () => moduleStateHelper("unmatched"),
    outcome: moduleStateOutcome,
    hostCheck: () => moduleStateHelper("hostCheck"),
    intSchemaName: () => moduleStateHelper("intSchema"),
    serviceParameter: moduleStateServiceParameter,
    typeLevelDeclaration: moduleStateTypeLevelDeclaration,
    isTypeOnly: moduleStateIsTypeOnly,
    resolve: moduleStateResolve,
    nameOf: moduleStateNameOf,
    hostBinding: moduleStateHostBinding,
    finish: moduleStateFinish,
  };
  return moduleStateSelf;
}
