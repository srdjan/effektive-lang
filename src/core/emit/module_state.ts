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
  CLOSED_UNIT_IDS,
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
import { compareText } from "../util.ts";
import { isValueId } from "../ids.ts";
import { internal } from "./failure.ts";
import { moduleOfId, nameOfId } from "./identity.ts";
import { type EffectModule, isDeferredType } from "./type_query.ts";
import { collectBinderNames } from "./walk.ts";

const INT_TYPE: Type = { kind: "primitive", name: "int" };

/** The order of `deno fmt` for named imports: case-insensitive, then by code unit. */
function compareImportNames(a: string, b: string): number {
  return compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b);
}

// ------------------------------------------------------------------ the scope

interface HostBinding {
  /** The registry key: `providers` for `host:providers`. */
  readonly key: string;
  /** The name that the host module exports. */
  readonly exported: string;
  /** The name that the Effektive source binds. */
  readonly local: string;
  /** The name of the assertion constant: `UsersLive$host`. */
  readonly hostName: string;
  readonly specifier: string;
}

interface ImportedName {
  readonly local: string;
  readonly typeOnly: boolean;
}

export interface ImportGroup {
  readonly specifier: string;
  readonly names: readonly {
    readonly exported: string;
    readonly local: string;
    readonly typeOnly: boolean;
  }[];
}

interface OutcomeNames {
  readonly type: string;
  readonly make: string;
}

/** The generated helpers of a module. Each slot fills at its first use. */
interface HelperNames {
  intSchema?: string;
  intFunction?: string;
  unmatched?: string;
  hostCheck?: string;
  outcome?: OutcomeNames;
}

export type HelperKey = keyof HelperNames;

/** The key of a module-level field helper. The key names the helper in the emitted text. */
type FieldHelperKey =
  | "record"
  | "optionalField"
  | "suppliedFields"
  | "untagged";

/** Names for the emitted module. Each member records the name on first use. */
export interface EmitNames {
  effect(module: EffectModule): string;
  nameOf(id: DeclarationId): string;
  encodedMirrorName(id: DeclarationId): string;
  intSchemaName(): string;
  intFunction(): string;
  unmatched(): string;
  outcome(): OutcomeNames;
  hostCheck(): string;
  serviceParameter(): string;
  fieldHelper(key: FieldHelperKey): string;
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
 * What `emit.ts` reads when all allocation is done. `finish` is the only way to
 * the import lists; after it, an allocation is an internal failure.
 */
interface ImportLedger {
  finish(): ImportGroup[];
  usesHelper(key: HelperKey): boolean;
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

export class ModuleState
  implements EmitNames, Temporaries, TypeLookup, ImportLedger {
  readonly module: string;
  /** The source file of the module, as its header names it. */
  readonly source: string;
  /** The path of the generated file, relative to the project root. */
  readonly path: string;
  /** Every name in use: declarations, imports, locals, and allocated names. */
  private readonly taken = new Set<string>();
  /** Names of local binders by identity. */
  readonly locals = new Map<LocalId, string>();
  private readonly localDecls = new Map<DeclarationId, Declaration>();
  private readonly foreignDecls = new Map<
    DeclarationId,
    TypeDecl | ErrorDecl | ServiceDecl
  >();
  /** Names that the Effektive source binds in its imports. */
  private readonly bound = new Map<DeclarationId, string>();
  /** The import of each bound name that a companion module has not used yet. */
  private readonly unusedImports = new Map<DeclarationId, () => void>();
  /** Names that the emitter allocated for foreign declarations. */
  private readonly allocated = new Map<DeclarationId, string>();
  private readonly foreignImports = new Map<
    string,
    Map<string, ImportedName>
  >();
  readonly hosts = new Map<DeclarationId, HostBinding>();
  private readonly hostDeclarations = new Map<
    string,
    Map<string, ImportedName>
  >();
  private readonly effectAliases = new Map<EffectModule, string>();
  readonly fieldHelpers = new Map<FieldHelperKey, string>();
  readonly fieldAdapters = new Map<
    string,
    {
      readonly name: string;
      readonly type: Type;
      readonly direction: "decoded" | "encoded" | "make";
    }
  >();

  fieldHelper(key: FieldHelperKey): string {
    let name = this.fieldHelpers.get(key);
    if (name === undefined) {
      name = this.fresh(`$${key}`);
      this.fieldHelpers.set(key, name);
    }
    return name;
  }

  private readonly helpers: HelperNames = {};
  private serviceName: string | undefined;
  /** True after `finish`: the import lists are read, so no name or import may change. */
  private finished = false;
  private temporaries = 0;
  private declarationTemporaries: string[] = [];
  private readonly typeOnlyMemo = new Map<DeclarationId, boolean>();
  private readonly encodedMirrors = new Map<DeclarationId, string>();

  constructor(readonly ir: ModuleIR, readonly config: ProjectConfig) {
    this.module = ir.module;
    this.source = ir.sources[0] ?? `${ir.module}.eff`;
    this.path = generatedPathOf(this.source);
    for (const declaration of ir.declarations) {
      this.localDecls.set(declaration.id, declaration);
      this.taken.add(declaration.name);
      collectBinderNames(declaration, (id, name) => {
        this.locals.set(id, name);
        this.taken.add(name);
      });
    }
    for (const imported of ir.imports) {
      for (const t of imported.types) this.foreignDecls.set(t.id, t);
      for (const e of imported.errors) this.foreignDecls.set(e.id, e);
      for (const s of imported.services) this.foreignDecls.set(s.id, s);
    }
    for (const imported of ir.imports) {
      if (isPreludeModule(imported.module)) continue;
      for (const binding of imported.bindings) {
        this.taken.add(binding.name);
      }
    }
    for (const imported of ir.imports) {
      if (isPreludeModule(imported.module)) continue;
      if (isHostLabel(imported.module)) {
        this.bindHost(imported.module, imported.bindings);
        continue;
      }
      for (const binding of imported.bindings) {
        this.bound.set(binding.target, binding.name);
        const use = () =>
          this.addImport(
            moduleOfId(binding.target),
            nameOfId(binding.target),
            binding.name,
            this.isTypeOnly(binding.target),
          );
        // A companion module prints only the imports that its declarations use.
        if (isInterfacePath(this.source)) {
          this.unusedImports.set(binding.target, use);
        } else use();
      }
    }
  }

  private bindHost(
    label: string,
    bindings: readonly {
      readonly name: string;
      readonly target: DeclarationId;
    }[],
  ): void {
    const key = hostKeyOf(label);
    const host = this.config.host.get(key);
    if (host === undefined) {
      throw internal(`the host module ${label} is not in the project file`);
    }
    const target = normalizeRelative(host.modulePath);
    if (target === undefined) {
      throw internal(`the host module path ${host.modulePath} is not valid`);
    }
    const specifier = relativeSpecifier(this.path, target);
    for (const binding of bindings) {
      if (isValueId(binding.target)) {
        this.hosts.set(binding.target, {
          key,
          exported: nameOfId(binding.target),
          local: binding.name,
          hostName: this.fresh(`${binding.name}$host`),
          specifier,
        });
      } else {
        this.bound.set(binding.target, binding.name);
        const declaration = this.typeLevelDeclaration(binding.target);
        if (declaration?.kind === "type" && declaration.opaque === true) {
          const names = this.hostDeclarations.get(specifier) ??
            new Map<string, ImportedName>();
          names.set(nameOfId(binding.target), {
            local: binding.name,
            typeOnly: true,
          });
          this.hostDeclarations.set(specifier, names);
        } else {
          // The companion module of the interface owns every other declaration.
          this.addImport(
            moduleOfId(binding.target),
            nameOfId(binding.target),
            binding.name,
            this.isTypeOnly(binding.target),
          );
        }
      }
    }
  }

  /**
   * An opaque type of an interface module lives in its host module, not in the
   * companion module: import it from there.
   */
  private importOpaque(module: string, exported: string, local: string): void {
    this.assertOpen(`the opaque type ${exported} is imported`);
    for (const host of this.config.host.values()) {
      const iface = normalizeRelative(host.interfacePath);
      if (iface === undefined || moduleNameOf(iface) !== module) continue;
      const target = normalizeRelative(host.modulePath);
      if (target === undefined) break;
      const specifier = relativeSpecifier(this.path, target);
      const names = this.hostDeclarations.get(specifier) ??
        new Map<string, ImportedName>();
      names.set(exported, { local, typeOnly: true });
      this.hostDeclarations.set(specifier, names);
      return;
    }
    throw internal(`the interface ${module} has no host module`);
  }

  // -------------------------------------------------------------- allocation

  /** An allocation after `finish` would miss the import lists that `finish` returned. */
  private assertOpen(what: string): void {
    if (this.finished) throw internal(`${what} after the imports are final`);
  }

  /** Reserves `base`, or `base$1`, `base$2`, ... when the name is taken. */
  fresh(base: string): string {
    this.assertOpen(`the name ${base} is allocated`);
    let candidate = base;
    let n = 0;
    while (this.taken.has(candidate)) {
      n += 1;
      candidate = `${base}$${n}`;
    }
    this.taken.add(candidate);
    return candidate;
  }

  /** The next temporary `$t<n>`. The counter restarts for each top-level declaration. */
  temp(): string {
    this.assertOpen("a temporary is allocated");
    for (;;) {
      const candidate = `$t${this.temporaries}`;
      this.temporaries += 1;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        this.declarationTemporaries.push(candidate);
        return candidate;
      }
    }
  }

  /** Starts a top-level declaration: its temporaries count from `$t0` again. */
  resetTemporaries(): void {
    for (const name of this.declarationTemporaries) this.taken.delete(name);
    this.declarationTemporaries = [];
    this.temporaries = 0;
  }

  effect(module: EffectModule): string {
    let alias = this.effectAliases.get(module);
    if (alias === undefined) {
      alias = this.fresh(module);
      this.effectAliases.set(module, alias);
    }
    return alias;
  }

  /** The name of the generated encoded type of a recursive alias: `NodeEncoded`. */
  encodedMirrorName(id: DeclarationId): string {
    let name = this.encodedMirrors.get(id);
    if (name === undefined) {
      name = this.fresh(`${this.nameOf(id)}Encoded`);
      this.encodedMirrors.set(id, name);
    }
    return name;
  }

  usesHelper(key: HelperKey): boolean {
    return this.helpers[key] !== undefined;
  }

  intFunction(): string {
    return this.helpers.intFunction ??= this.fresh("$int");
  }

  /** The helper `$unmatched` that a match calls for a value outside its type. */
  unmatched(): string {
    return this.helpers.unmatched ??= this.fresh("$unmatched");
  }

  /** The helper `$outcome` that maps an `Exit` to the outcome record of a `finally` binding. */
  outcome(): OutcomeNames {
    return this.helpers.outcome ??= {
      type: this.fresh("$Outcome"),
      make: this.fresh("$outcome"),
    };
  }

  /** The helper `$hostCheck` that a wrapped host provider calls for a data result. */
  hostCheck(): string {
    return this.helpers.hostCheck ??= this.fresh("$hostCheck");
  }

  intSchemaName(): string {
    return this.helpers.intSchema ??= this.fresh("$Int");
  }

  serviceParameter(): string {
    this.serviceName ??= this.fresh("$s");
    return this.serviceName;
  }

  // -------------------------------------------------------------- declarations

  /** A type, error, or service declaration of this module or of an import. */
  typeLevelDeclaration(
    id: DeclarationId,
  ): TypeDecl | ErrorDecl | ServiceDecl | undefined {
    const local = this.localDecls.get(id);
    if (local !== undefined) {
      return local.kind === "type" || local.kind === "error" ||
          local.kind === "service"
        ? local
        : undefined;
    }
    return this.foreignDecls.get(id);
  }

  /**
   * True when the declaration has no runtime value: an opaque type, or an alias
   * whose definition contains a function, provider, or opaque type, directly or
   * through another alias.
   */
  isTypeOnly(id: DeclarationId): boolean {
    const known = this.typeOnlyMemo.get(id);
    if (known !== undefined) return known;
    this.typeOnlyMemo.set(id, false);
    const declaration = this.typeLevelDeclaration(id);
    let result = false;
    if (declaration?.kind === "type" && declaration.opaque === true) {
      // The host module declares an opaque type as a type: it has no value.
      result = true;
    } else if (
      declaration?.kind === "type" && declaration.definition.kind === "alias"
    ) {
      result = this.containsFunction(declaration.definition.type);
    }
    this.typeOnlyMemo.set(id, result);
    return result;
  }

  /** Follows type aliases until a type that is not a name. A type with identity and an unknown name stay. */
  resolve(type: Type): Type {
    let current = type;
    const seen = new Set<DeclarationId>();
    while (current.kind === "named" && !seen.has(current.id)) {
      // `Duration` and `Instant` are identities over `int`: they keep the `int` guard.
      if (CLOSED_UNIT_IDS.has(current.id)) return INT_TYPE;
      seen.add(current.id);
      const declaration = this.typeLevelDeclaration(current.id);
      if (
        declaration?.kind !== "type" || declaration.definition.kind !== "alias"
      ) {
        return current;
      }
      current = declaration.definition.type;
    }
    return current;
  }

  containsFunction(type: Type): boolean {
    if (isDeferredType(type)) return true;
    switch (type.kind) {
      case "primitive":
      case "literal":
        return false;
      case "named":
        return this.isTypeOnly(type.id);
      case "record":
        return type.fields.some((f) => this.containsFunction(f.type));
      case "array":
      case "option":
        return this.containsFunction(type.element);
      case "tuple":
        return type.elements.some((t) => this.containsFunction(t));
      case "union":
        return type.members.some((t) => this.containsFunction(t));
    }
  }

  /** The name that this module uses for a declaration. A foreign declaration is imported on first use. */
  nameOf(id: DeclarationId): string {
    // `Duration` and `Instant` are numbers of milliseconds at run time.
    if (CLOSED_UNIT_IDS.has(id)) return "number";
    if (id === SCHEMA_ERROR_ID) {
      return `${this.effect("Schema")}.SchemaError`;
    }
    if (id === TIMEOUT_ERROR_ID) {
      return `${this.effect("Cause")}.TimeoutError`;
    }
    if (id === SCHEMA_ISSUE_ID) {
      return `${this.effect("SchemaIssue")}.Issue`;
    }
    const local = this.localDecls.get(id);
    if (local !== undefined) {
      if (local.kind === "type" && local.opaque === true) {
        this.importOpaque(this.module, local.name, local.name);
      }
      return local.name;
    }
    const bound = this.bound.get(id);
    if (bound !== undefined) {
      this.unusedImports.get(id)?.();
      this.unusedImports.delete(id);
      return bound;
    }
    const allocated = this.allocated.get(id);
    if (allocated !== undefined) return allocated;
    const exported = nameOfId(id);
    const name = this.fresh(exported);
    this.allocated.set(id, name);
    const foreign = this.typeLevelDeclaration(id);
    if (foreign?.kind === "type" && foreign.opaque === true) {
      this.importOpaque(moduleOfId(id), exported, name);
    } else {
      this.addImport(moduleOfId(id), exported, name, this.isTypeOnly(id));
    }
    return name;
  }

  hostBinding(id: DeclarationId): HostBinding | undefined {
    return this.hosts.get(id);
  }

  private addImport(
    module: string,
    exported: string,
    local: string,
    typeOnly: boolean,
  ): void {
    this.assertOpen(`${exported} is imported`);
    let names = this.foreignImports.get(module);
    if (names === undefined) {
      names = new Map();
      this.foreignImports.set(module, names);
    }
    names.set(exported, { local, typeOnly });
  }

  /**
   * The import groups of the module, in print order: `effect`, other generated
   * modules, and host modules. It closes the state: a later allocation is an
   * internal failure.
   */
  finish(): ImportGroup[] {
    this.finished = true;
    return [
      ...this.effectImports(),
      ...this.moduleImports(),
      ...this.hostImports(),
    ];
  }

  /** Imports of other generated modules, sorted by specifier. */
  private moduleImports(): ImportGroup[] {
    const groups: ImportGroup[] = [];
    // The companion module path of each host interface module, by module name.
    const companions = new Map<string, string>();
    for (const host of this.config.host.values()) {
      const path = normalizeRelative(host.interfacePath);
      if (path !== undefined) {
        companions.set(moduleNameOf(path), generatedPathOf(path));
      }
    }
    for (const [module, names] of this.foreignImports) {
      groups.push({
        specifier: relativeSpecifier(
          this.path,
          companions.get(module) ?? `${module}.ts`,
        ),
        names: [...names].map(([exported, imported]) => ({
          exported,
          local: imported.local,
          typeOnly: imported.typeOnly,
        })).sort((a, b) => compareImportNames(a.exported, b.exported)),
      });
    }
    return groups.sort((a, b) => compareText(a.specifier, b.specifier));
  }

  /** The imports from `effect` that the module used, sorted by exported name. */
  private effectImports(): ImportGroup[] {
    const names = [...this.effectAliases]
      .map(([exported, local]) => ({ exported, local, typeOnly: false }))
      .sort((a, b) => compareImportNames(a.exported, b.exported));
    return names.length === 0 ? [] : [{ specifier: "effect", names }];
  }

  /** The host imports in registry order of first appearance, sorted by specifier. */
  private hostImports(): ImportGroup[] {
    const bySpecifier = new Map<string, Map<string, ImportedName>>();
    for (const [specifier, names] of this.hostDeclarations) {
      bySpecifier.set(specifier, new Map(names));
    }
    for (const host of this.hosts.values()) {
      const names = bySpecifier.get(host.specifier) ??
        new Map<string, ImportedName>();
      names.set(host.exported, { local: host.local, typeOnly: false });
      bySpecifier.set(host.specifier, names);
    }
    return [...bySpecifier].map(([specifier, names]) => ({
      specifier,
      names: [...names].sort((a, b) => compareImportNames(a[0], b[0])).map((
        [exported, entry],
      ) => ({ exported, local: entry.local, typeOnly: entry.typeOnly })),
    })).sort((a, b) => compareText(a.specifier, b.specifier));
  }
}
