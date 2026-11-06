// The lookup tables of one module: its own declarations, then the payloads of
// its imports, and the context (tables and report) that the checks share.

import type {
  ErrorDecl,
  Field,
  MethodDecl,
  ModuleIR,
  ServiceDecl,
  Type,
  TypeDecl,
} from "../ir.ts";
import { DURATION_ID, INSTANT_ID, TIMEOUT_ERROR_ID } from "../ir.ts";
import type { Predicate } from "../predicates.ts";
import type { Report } from "./report.ts";
import type { TypeEnv } from "./typing.ts";
import { type BuiltinInfo, builtinInfo } from "./builtins.ts";

export const PRELUDE_MODULE = "effektive:prelude";

export interface World {
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
}

function addFirst<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

/** Own declarations come first, then the import payloads. The first entry of an identity wins. */
export function buildWorld(ir: ModuleIR): World {
  const types = new Map<string, TypeDecl>();
  const errors = new Map<string, ErrorDecl>();
  const services = new Map<string, ServiceDecl>();
  const values = new Map<string, Type>();
  const builtins = new Map<string, string>();
  const builtinMetadata = new Map<string, BuiltinInfo>();
  for (const d of ir.declarations) {
    switch (d.kind) {
      case "type":
        addFirst(types, d.id, d);
        break;
      case "error":
        addFirst(errors, d.id, d);
        break;
      case "service":
        addFirst(services, d.id, d);
        break;
      case "function":
        addFirst(values, d.id, d.type);
        break;
      case "constant":
        addFirst(values, d.id, d.type);
        break;
    }
  }
  for (const imp of ir.imports) {
    for (const t of imp.types) addFirst(types, t.id, t);
    for (const e of imp.errors) addFirst(errors, e.id, e);
    for (const s of imp.services) addFirst(services, s.id, s);
    for (const v of imp.values) {
      addFirst(values, v.id, v.type);
      if (imp.module === PRELUDE_MODULE && !builtins.has(v.id)) {
        builtins.set(v.id, v.name);
        builtinMetadata.set(v.id, builtinInfo(v.id, v.name));
      }
    }
  }
  errors.set("error:effect/SchemaError", {
    kind: "error",
    id: "error:effect/SchemaError",
    name: "SchemaError",
    fields: [{
      name: "message",
      type: { kind: "primitive", name: "string" },
      optional: false,
    }],
    span: { source: ir.module, start: 0, end: 0 },
  });
  errors.set(TIMEOUT_ERROR_ID, {
    kind: "error",
    id: TIMEOUT_ERROR_ID,
    name: "TimeoutError",
    fields: [{
      name: "message",
      type: { kind: "primitive", name: "string" },
      optional: false,
    }],
    span: { source: ir.module, start: 0, end: 0 },
  });
  errors.set("error:effect/SchemaIssue", {
    kind: "error",
    id: "error:effect/SchemaIssue",
    name: "SchemaIssue",
    fields: [],
    span: { source: ir.module, start: 0, end: 0 },
  });
  // `Duration` is the builtin untagged identity over `int`.
  types.set(DURATION_ID, {
    kind: "type",
    id: DURATION_ID,
    name: "Duration",
    definition: { kind: "nominal", base: { kind: "primitive", name: "int" } },
    span: { source: ir.module, start: 0, end: 0 },
  });
  // `Instant` is the builtin untagged identity over `int`.
  types.set(INSTANT_ID, {
    kind: "type",
    id: INSTANT_ID,
    name: "Instant",
    definition: { kind: "nominal", base: { kind: "primitive", name: "int" } },
    span: { source: ir.module, start: 0, end: 0 },
  });
  const methods = new Map<string, MethodDecl>();
  for (const s of services.values()) {
    for (const m of s.methods) addFirst(methods, m.id, m);
  }
  const aliases = new Map<string, Type>();
  const identities = new Set<string>();
  const opaqueBases = new Map<string, Type>();
  const taggedRecords = new Map<string, Extract<Type, { kind: "record" }>>();
  const opaque = new Set<string>();
  const sealed = new Set<string>();
  const refined = new Set<string>();
  const predicates = new Map<string, Predicate>();
  for (const t of types.values()) {
    if (t.opaque === true) opaque.add(t.id);
    if (t.predicate !== undefined) {
      refined.add(t.id);
      predicates.set(t.id, t.predicate);
    }
    if (t.definition.kind === "nominal" && t.definition.sealed === true) {
      sealed.add(t.id);
    }
    switch (t.definition.kind) {
      case "alias":
        aliases.set(t.id, t.definition.type);
        break;
      case "nominal":
        if (
          t.definition.tagged === true && t.definition.base.kind === "record"
        ) {
          taggedRecords.set(t.id, t.definition.base);
        } else if (t.opaque === true) opaqueBases.set(t.id, t.definition.base);
        else {
          // An untagged nominal type is an alias with identity.
          aliases.set(t.id, t.definition.base);
          identities.add(t.id);
        }
        break;
    }
  }
  const errorFields = new Map<string, readonly Field[]>();
  for (const e of errors.values()) errorFields.set(e.id, e.fields);
  return {
    exports: new Set(ir.exports),
    env: {
      module: ir.module,
      aliases,
      identities,
      opaqueBases,
      taggedRecords,
      errors: errorFields,
      opaque,
      sealed,
      refined,
      predicates,
    },
    types,
    errors,
    services,
    methods,
    values,
    builtins,
    builtinInfo: builtinMetadata,
  };
}

export interface Ctx {
  readonly world: World;
  readonly report: Report;
}
