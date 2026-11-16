import {
  bigInteger,
  emptyMap,
  emptySet,
  indices,
  mapFrom,
  stackValues,
  type UnknownValue,
} from "./runtime.ts";
// Module interfaces. An interface is the `Import` payload of the IR without
// `module` and `bindings`: the exports, the types of the exported values, and
// the declarations that those exports reach (design I8). The spec requires the
// complete supporting type graph, so the payload also carries the declarations
// of other modules that the exports reach. A dependent then sees them without
// an import of their module, and the hash changes when one of them changes.
//
// The interface hash covers the content without source spans, so a comment or a
// body edit that moves a declaration does not change it. The hash is FNV-1a 64
// over canonical JSON. A later part may switch to SHA-256.
//
// `reachableModules` also lives here. The project driver in `check_project.ts`
// uses it to give each module the type graphs of the modules that it reaches.
import type { Analysis } from "./analyze.ts";
import {
  contractSets,
  type FunctionSignature,
  isPendingMode,
  type ModuleDeclarations,
  signatureType,
  type SolvedLookup,
  type TypeGraph,
} from "./signatures.ts";
import {
  declarationReferencedIds,
  effectIds,
  referencedIds,
} from "./referenced_ids.ts";
import type {
  DeclarationId,
  ErrorDecl,
  Import,
  ServiceDecl,
  Type,
  TypeDecl,
  ValueId,
} from "./ir.ts";
import type { Result } from "./source.ts";
import type { ModuleName } from "./ids.ts";
type InterfaceText = string;
type InterfaceHash = string;
import { canonicalJson } from "./content_id.ts";
import { compareText, isRecord } from "./util.ts";
/** The `Import` payload without `module` and `bindings`. */
type InterfacePayload = Pick<
  Import,
  "exports" | "values" | "types" | "errors" | "services"
>;
export type ModuleInterface = {
  readonly payload: InterfacePayload;
  /** FNV-1a 64 of the canonical JSON of the payload without spans. */
  readonly hash: string;
};
export type InterfaceError = {
  readonly tag: "missing-modes";
  /** Functions with a pending mode and no solved entry, sorted. */
  readonly ids: readonly ValueId[];
};
function byId<
  T extends {
    readonly id: string;
  },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareText(a.id, b.id));
}
/** Removes every `span` key. A span depends on the position of the text, not on its meaning. */
export function stripSpans(value: UnknownValue): UnknownValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripSpans(item));
  }
  const result: Record<string, unknown> = {};
  if (!isRecord(value)) return value;
  const record = value;
  for (const key of Object.keys(record)) {
    if (key === "span") {
      continue;
    }
    result[key] = stripSpans(record[key]);
  }
  return result;
}
// A small synchronous content hash: FNV-1a with 64 bits, over UTF-16 code
// units. The incremental model uses it to compare header text, body text, and
// interface payloads. It is not a cryptographic hash. Builtin specialization
// uses SHA-256 (sha256.ts).
const OFFSET_BASIS = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
/** FNV-1a 64 over the UTF-16 code units of `text`. Returns 16 lowercase hex digits. */
export function fnv1a64(text: InterfaceText): InterfaceHash {
  let hash = OFFSET_BASIS;
  for (const i of indices(text.length)) {
    hash = hash ^ bigInteger(text.charCodeAt(i));
    hash = bigInteger.asUintN(64, hash * PRIME);
  }
  return hash.toString(16).padStart(16, "0");
}
/** FNV-1a 64 of the canonical JSON of an interface payload with its spans. */
export function payloadHash(payload: InterfacePayload): InterfaceHash {
  return fnv1a64(canonicalJson(payload));
}
/**
 * The identities that the exported values mention in their types and effect
 * sets. The effect sets are the written sets, else the solved sets.
 */
function exportedValueIds(
  declarations: ModuleDeclarations,
  solved: SolvedLookup,
): Set<DeclarationId> {
  let ids = emptySet<DeclarationId>();
  for (const signature of declarations.values.values()) {
    if (!signature.exported) continue;
    if (signature.kind === "function") {
      if (!signature.written.result) continue;
      for (const parameter of signature.parameters) {
        ids = referencedIds(parameter.type.ir, ids);
      }
      if (signature.result !== undefined) {
        ids = referencedIds(signature.result.ir, ids);
      }
      const sets = contractSets(signature, solved);
      ids = effectIds(sets.failures, sets.requirements, ids);
    } else if (signature.type !== undefined) {
      ids = referencedIds(signature.type.ir, ids);
    }
  }
  return ids;
}
type GraphDecl = TypeDecl | ErrorDecl | ServiceDecl;
function declarationsOf(graph: TypeGraph): GraphDecl[] {
  return [...graph.types, ...graph.errors, ...graph.services];
}
/** Every declaration of `pool` that the seeds reach, directly or through other declarations of `pool`. */
function reach(
  pool: ReadonlyMap<string, GraphDecl>,
  seeds: Iterable<string>,
): GraphDecl[] {
  let reached = emptyMap<string, GraphDecl>();
  const pending: GraphDecl[] = [];
  function visit(ids: Iterable<string>): Map<string, GraphDecl> {
    for (const id of ids) {
      const declaration = pool.get(id);
      if (declaration === undefined || reached.has(id)) continue;
      reached = reached.set(id, declaration);
      pending[pending.length] = declaration;
    }
    return reached;
  }
  reached = visit(seeds);
  for (const declaration of stackValues(pending)) {
    const found = declarationReferencedIds(
      declaration,
      emptySet<DeclarationId>(),
    );
    reached = visit(found);
  }
  return [...reached.values()];
}
function graphOf(declarations: readonly GraphDecl[]): TypeGraph {
  const types: TypeDecl[] = [];
  const errors: ErrorDecl[] = [];
  const services: ServiceDecl[] = [];
  for (const declaration of declarations) {
    if (declaration.kind === "type") types[types.length] = declaration;
    else if (declaration.kind === "error") errors[errors.length] = declaration;
    else services[services.length] = declaration;
  }
  return { types: types, errors: errors, services: services };
}
/**
 * The type graph that the exports of a module reach: the exported types, errors,
 * and services, and every private declaration of this module that they reach
 * through types, failures, and capabilities. The failures and capabilities of an
 * exported function are its written sets, else its solved sets from `solved`.
 */
export function buildTypeGraph(
  declarations: ModuleDeclarations,
  solved: SolvedLookup,
): TypeGraph {
  const own = mapFrom<string, GraphDecl>(
    [...declarations.types, ...declarations.errors, ...declarations.services]
      .map((d) => [d.id, d]),
  );
  const graph = graphOf(reach(own, [
    ...declarations.exports,
    ...exportedValueIds(declarations, solved),
  ]));
  return {
    types: byId(graph.types),
    errors: byId(graph.errors),
    services: byId(graph.services),
  };
}
/**
 * The declarations of other modules that the exports and the own type graph
 * reach, directly or through other foreign declarations. `imported` holds the
 * type graphs of the modules that this module reaches.
 */
function foreignTypeGraph(
  declarations: ModuleDeclarations,
  solved: SolvedLookup,
  own: TypeGraph,
  imported: ReadonlyMap<string, TypeGraph>,
): TypeGraph {
  let foreign = emptyMap<string, GraphDecl>();
  for (const graph of imported.values()) {
    for (const d of declarationsOf(graph)) {
      foreign = foreign.set(d.id, d);
    }
  }
  let seeds = exportedValueIds(declarations, solved);
  for (const d of declarationsOf(own)) {
    seeds = declarationReferencedIds(d, seeds);
  }
  return graphOf(reach(foreign, seeds));
}
/**
 * Builds the interface of a module. Every function with a pending mode needs an
 * entry in `solved`. Without it the result is an error value, because the hash
 * would otherwise hide a pending mode. An open set of an exported function comes
 * from `solved`. A caller that has built the type graph of the module passes it as `ownGraph`.
 */
export function buildInterface(
  declarations: ModuleDeclarations,
  solved: SolvedLookup,
  imported: ReadonlyMap<string, TypeGraph> | undefined,
  ownGraph: TypeGraph | undefined,
): Result<ModuleInterface, InterfaceError> {
  const functions: FunctionSignature[] = [];
  for (const signature of declarations.values.values()) {
    if (signature.kind === "function") {
      const _appendTarget9 = functions;
      const _appendValue10 = signature;
      _appendTarget9[_appendTarget9.length] = _appendValue10;
    }
  }
  const missing = functions
    .filter((f) => isPendingMode(f) && solved.get(f.id) === undefined)
    .map((f) => f.id)
    .sort(compareText);
  if (missing.length > 0) {
    return { ok: false, error: { tag: "missing-modes", ids: missing } };
  }
  const values: {
    readonly id: ValueId;
    readonly name: string;
    readonly type: Type;
  }[] = [];
  for (const signature of declarations.values.values()) {
    if (!signature.exported) continue;
    if (signature.kind === "function") {
      if (!signature.written.result) continue;
      const type = signatureType(declarations.env.table, signature, solved);
      // The missing-mode check above guarantees a type for explicit functions.
      if (!type.ok) continue;
      values[values.length] = {
        id: signature.id,
        name: signature.name,
        type: type.value.ir,
      };
    } else if (signature.type !== undefined) {
      values[values.length] = {
        id: signature.id,
        name: signature.name,
        type: signature.type.ir,
      };
    }
  }
  const graph = ownGraph ?? buildTypeGraph(declarations, solved);
  const foreign = foreignTypeGraph(
    declarations,
    solved,
    graph,
    imported ?? emptyMap(),
  );
  const payload: InterfacePayload = {
    exports: declarations.exports,
    values: byId(values),
    types: byId([...graph.types, ...foreign.types]),
    errors: byId([...graph.errors, ...foreign.errors]),
    services: byId([...graph.services, ...foreign.services]),
  };
  return {
    ok: true,
    value: {
      payload: payload,
      hash: fnv1a64(canonicalJson(stripSpans(payload))),
    },
  };
}
/** The names of the modules that `module` reaches through imports, directly or not. */
export function reachableModules(
  analysis: Analysis,
  module: ModuleName,
): readonly ModuleName[] {
  let seen = emptySet<string>();
  const stack = [...(analysis.project.graph.get(module) ?? [])];
  for (const next of stackValues(stack)) {
    if (seen.has(next)) {
      continue;
    }
    seen = seen.add(next);
    for (const dependency of analysis.project.graph.get(next) ?? []) {
      {
        const _appendTarget17 = stack;
        const _appendValue18 = dependency;
        _appendTarget17[_appendTarget17.length] = _appendValue18;
      }
    }
  }
  return [...seen].filter((name) => name !== module).sort(compareText);
}
