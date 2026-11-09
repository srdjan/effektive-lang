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
import { canonicalJson } from "./content_id.ts";
import { compareText } from "./util.ts";

/** The `Import` payload without `module` and `bindings`. */
type InterfacePayload = Pick<
  Import,
  "exports" | "values" | "types" | "errors" | "services"
>;

export interface ModuleInterface {
  readonly payload: InterfacePayload;
  /** FNV-1a 64 of the canonical JSON of the payload without spans. */
  readonly hash: string;
}

export type InterfaceError = {
  readonly tag: "missing-modes";
  /** Functions with a pending mode and no solved entry, sorted. */
  readonly ids: readonly ValueId[];
};

function byId<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareText(a.id, b.id));
}

/** Removes every `span` key. A span depends on the position of the text, not on its meaning. */
export function stripSpans(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripSpans(item));
  const result: Record<string, unknown> = {};
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) {
    if (key === "span") continue;
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
export function fnv1a64(text: string): string {
  let hash = OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * PRIME);
  }
  return hash.toString(16).padStart(16, "0");
}

/** FNV-1a 64 of the canonical JSON of an interface payload with its spans. */
export function payloadHash(payload: InterfacePayload): string {
  return fnv1a64(canonicalJson(payload));
}

function interfaceHash(payload: InterfacePayload): string {
  return fnv1a64(canonicalJson(stripSpans(payload)));
}

/**
 * The identities that the exported values mention in their types and effect
 * sets. The effect sets are the written sets, else the solved sets.
 */
function exportedValueIds(
  declarations: ModuleDeclarations,
  solved: SolvedLookup,
): Set<string> {
  const ids = new Set<string>();
  for (const signature of declarations.values.values()) {
    if (!signature.exported) continue;
    switch (signature.kind) {
      case "function":
        if (!signature.written.result) break;
        for (const parameter of signature.parameters) {
          referencedIds(parameter.type.ir, ids);
        }
        if (signature.result !== undefined) {
          referencedIds(signature.result.ir, ids);
        }
        {
          const sets = contractSets(signature, solved);
          effectIds(sets.failures, sets.requirements, ids);
        }
        break;
      case "constant":
        if (signature.type !== undefined) referencedIds(signature.type.ir, ids);
        break;
      case "provider":
        referencedIds(signature.type.ir, ids);
        break;
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
  const reached = new Map<string, GraphDecl>();
  const pending: GraphDecl[] = [];
  const visit = (ids: Iterable<string>): void => {
    for (const id of ids) {
      const d = pool.get(id);
      if (d === undefined || reached.has(id)) continue;
      reached.set(id, d);
      pending.push(d);
    }
  };
  visit(seeds);
  for (let d = pending.pop(); d !== undefined; d = pending.pop()) {
    const found = new Set<string>();
    declarationReferencedIds(d, found);
    visit(found);
  }
  return [...reached.values()];
}

function graphOf(declarations: readonly GraphDecl[]): TypeGraph {
  const types: TypeDecl[] = [];
  const errors: ErrorDecl[] = [];
  const services: ServiceDecl[] = [];
  for (const d of declarations) {
    switch (d.kind) {
      case "type":
        types.push(d);
        break;
      case "error":
        errors.push(d);
        break;
      case "service":
        services.push(d);
        break;
    }
  }
  return { types, errors, services };
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
  const own = new Map<string, GraphDecl>(
    [...declarations.types, ...declarations.errors, ...declarations.services]
      .map((d) => [d.id, d]),
  );
  const graph = graphOf(
    reach(own, [
      ...declarations.exports,
      ...exportedValueIds(declarations, solved),
    ]),
  );
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
  const foreign = new Map<string, GraphDecl>();
  for (const graph of imported.values()) {
    for (const d of declarationsOf(graph)) foreign.set(d.id, d);
  }
  const seeds = exportedValueIds(declarations, solved);
  for (const d of declarationsOf(own)) declarationReferencedIds(d, seeds);
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
  imported: ReadonlyMap<string, TypeGraph> = new Map(),
  ownGraph?: TypeGraph,
): Result<ModuleInterface, InterfaceError> {
  const functions: FunctionSignature[] = [];
  for (const signature of declarations.values.values()) {
    if (signature.kind === "function") functions.push(signature);
  }
  const missing = functions
    .filter((f) => isPendingMode(f) && solved.get(f.id) === undefined)
    .map((f) => f.id)
    .sort(compareText);
  if (missing.length > 0) {
    return { ok: false, error: { tag: "missing-modes", ids: missing } };
  }

  const values: { id: ValueId; name: string; type: Type }[] = [];
  for (const signature of declarations.values.values()) {
    if (!signature.exported) continue;
    switch (signature.kind) {
      case "function": {
        if (!signature.written.result) break;
        const type = signatureType(
          declarations.env.table,
          signature,
          solved,
        );
        // Every explicit function passed the check above, so this cannot fail.
        if (!type.ok) break;
        values.push({
          id: signature.id,
          name: signature.name,
          type: type.value.ir,
        });
        break;
      }
      case "constant":
        if (signature.type !== undefined) {
          values.push({
            id: signature.id,
            name: signature.name,
            type: signature.type.ir,
          });
        }
        break;
      case "provider":
        values.push({
          id: signature.id,
          name: signature.name,
          type: signature.type.ir,
        });
        break;
    }
  }
  const graph = ownGraph ?? buildTypeGraph(declarations, solved);
  const foreign = foreignTypeGraph(declarations, solved, graph, imported);
  const payload: InterfacePayload = {
    exports: declarations.exports as readonly DeclarationId[],
    values: byId(values),
    types: byId([...graph.types, ...foreign.types]),
    errors: byId([...graph.errors, ...foreign.errors]),
    services: byId([...graph.services, ...foreign.services]),
  };
  return {
    ok: true,
    value: {
      payload,
      hash: interfaceHash(payload),
    },
  };
}

/** The names of the modules that `module` reaches through imports, directly or not. */
export function reachableModules(analysis: Analysis, module: string): string[] {
  const seen = new Set<string>();
  const stack = [...(analysis.project.graph.get(module) ?? [])];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dependency of analysis.project.graph.get(next) ?? []) {
      stack.push(dependency);
    }
  }
  seen.delete(module);
  return [...seen].sort(compareText);
}
