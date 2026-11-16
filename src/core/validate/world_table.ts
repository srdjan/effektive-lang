// The lookup tables of one module: its own declarations, then the payloads of
// its imports, and the context (tables and report) that the checks share.

import { isTrue } from "./guards.ts";
import { emptyMap, emptySet, setFrom } from "../runtime.ts";
import type {
  ErrorDecl,
  Field,
  MethodDecl,
  ModuleIR,
  ServiceDecl,
  Span,
  Type,
  TypeDecl,
} from "../ir.ts";
import type { Predicate } from "../predicates.ts";
import type {
  AreaCode,
  Report,
  ValidationMessage,
  ValidationPath,
} from "./report.ts";
import type { TypeEnv } from "./typing.ts";
import { type BuiltinInfo, builtinInfo } from "./builtins.ts";
import { preludeErrors, preludeTypes } from "./prelude.ts";

export const PRELUDE_MODULE = "effektive:prelude";

export type World = {
  readonly env: TypeEnv;
  readonly exports: ReadonlySet<string>;
  readonly types: ReadonlyMap<string, TypeDecl>;
  readonly errors: ReadonlyMap<string, ErrorDecl>;
  readonly services: ReadonlyMap<string, ServiceDecl>;
  readonly methods: ReadonlyMap<string, MethodDecl>;
  /** The recorded type of every value a module can reference. */
  readonly values: ReadonlyMap<string, Type>;
  /** The builtin ids of the prelude import. */
  readonly builtins: ReadonlyMap<string, string>;
  /** Cached identity and call classifications; raw names retain malformed-IR behavior. */
  readonly builtinInfo: ReadonlyMap<string, BuiltinInfo>;
};

type EntryKey = string;

/** Sets `key` only when the map has no entry for it, so the first entry wins. */
export function addFirst<V>(
  map: Map<EntryKey, V>,
  key: EntryKey,
  value: V,
): Map<EntryKey, V> {
  return map.has(key) ? map : map.set(key, value);
}

/** Own declarations come first, then the import payloads. The first entry of an identity wins. */
export function buildWorld(ir: ModuleIR): World {
  let types = emptyMap<string, TypeDecl>();
  let errors = emptyMap<string, ErrorDecl>();
  let services = emptyMap<string, ServiceDecl>();
  let values = emptyMap<string, Type>();
  let builtins = emptyMap<string, string>();
  let builtinMetadata = emptyMap<string, BuiltinInfo>();
  for (const d of ir.declarations) {
    if (d.kind === "type") types = addFirst(types, d.id, d);
    else if (d.kind === "error") errors = addFirst(errors, d.id, d);
    else if (d.kind === "service") services = addFirst(services, d.id, d);
    else values = addFirst(values, d.id, d.type);
  }
  for (const imp of ir.imports) {
    for (const t of imp.types) types = addFirst(types, t.id, t);
    for (const e of imp.errors) errors = addFirst(errors, e.id, e);
    for (const s of imp.services) services = addFirst(services, s.id, s);
    for (const v of imp.values) {
      values = addFirst(values, v.id, v.type);
      if (imp.module === PRELUDE_MODULE && !builtins.has(v.id)) {
        builtins = builtins.set(v.id, v.name);
        builtinMetadata = builtinMetadata.set(v.id, builtinInfo(v.id, v.name));
      }
    }
  }
  for (const e of preludeErrors(ir.module)) errors = errors.set(e.id, e);
  for (const t of preludeTypes(ir.module)) types = types.set(t.id, t);
  let methods = emptyMap<string, MethodDecl>();
  for (const s of services.values()) {
    for (const m of s.methods) methods = addFirst(methods, m.id, m);
  }
  let aliases = emptyMap<string, Type>();
  let identities = emptySet<string>();
  let opaqueBases = emptyMap<string, Type>();
  let taggedRecords = emptyMap<string, Extract<Type, { kind: "record" }>>();
  let opaque = emptySet<string>();
  let sealed = emptySet<string>();
  let refined = emptySet<string>();
  let predicates = emptyMap<string, Predicate>();
  for (const t of types.values()) {
    if (isTrue(t.opaque)) opaque = opaque.add(t.id);
    if (t.predicate !== undefined) {
      refined = refined.add(t.id);
      predicates = predicates.set(t.id, t.predicate);
    }
    if (t.definition.kind === "nominal" && isTrue(t.definition.sealed)) {
      sealed = sealed.add(t.id);
    }
    if (t.definition.kind === "alias") {
      aliases = aliases.set(t.id, t.definition.type);
    } else if (
      isTrue(t.definition.tagged) && t.definition.base.kind === "record"
    ) {
      taggedRecords = taggedRecords.set(t.id, t.definition.base);
    } else if (isTrue(t.opaque)) {
      opaqueBases = opaqueBases.set(t.id, t.definition.base);
    } else {
      aliases = aliases.set(t.id, t.definition.base);
      identities = identities.add(t.id);
    }
  }
  let errorFields = emptyMap<string, readonly Field[]>();
  for (const e of errors.values()) {
    errorFields = errorFields.set(e.id, e.fields);
  }
  return {
    exports: setFrom(ir.exports),
    env: {
      module: ir.module,
      aliases: aliases,
      identities: identities,
      opaqueBases: opaqueBases,
      taggedRecords: taggedRecords,
      errors: errorFields,
      opaque: opaque,
      sealed: sealed,
      refined: refined,
      predicates: predicates,
    },
    types: types,
    errors: errors,
    services: services,
    methods: methods,
    values: values,
    builtins: builtins,
    builtinInfo: builtinMetadata,
  };
}

export type Ctx = {
  readonly world: World;
  readonly report: Report;
};

/** `state` with one more finding in its report. The report is one owner, so its order is the order of the calls. */
export function flag<T extends { readonly report: Report }>(
  state: T,
  area: AreaCode,
  path: ValidationPath,
  what: ValidationMessage,
  span: Span,
): T {
  return { ...state, report: state.report.add(area, path, what, span) };
}
