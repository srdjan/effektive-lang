// The signature model of the declaration checker: function and constant
// signatures, the module declarations that carry them, the execution modes,
// and the lowering of a signature to a function type. TypeLowerer
// and the module checker (check.ts) both build on it.
//
// - `ModuleDeclarations.values` holds one signature for each module-level const
//   and provider. The body checker checks each body against its signature.
// - A function signature without a written result has no result and empty
//   sets. A set whose clause is not written (`written.fails` or `written.uses`
//   is false) is open: the body checker infers it, and the signature holds an
//   empty set for it.
// - The execution mode and the open sets of a function come from a `Solved`
//   lookup that the body checker supplies. `executionOf` and `signatureType`
//   take the lookup and return a Result error when an entry is missing.

import type { Diagnostic } from "./diagnostics.ts";
import type {
  CapabilityId,
  DeclarationId,
  ErrorDecl,
  ErrorId,
  Execution,
  FunctionType,
  LocalId,
  ServiceDecl,
  ServiceId,
  Type,
  TypeDecl,
  ValueId,
  WrittenParts,
} from "./ir.ts";
import type { Solved } from "./modes.ts";
import type { Target } from "./resolve.ts";
import type { Result, Span } from "./source.ts";
import type { NodeId, SyntaxTree } from "./syntax.ts";
import type { TypeRef, TypeTable } from "./types.ts";
import { sortedUnique } from "./util.ts";
import { serviceOfCapability } from "./ids.ts";

// ------------------------------------------------------------------ shapes

/** An interned type together with its IR tree in source order. */
export interface Lowered {
  readonly ref: TypeRef;
  readonly ir: Type;
}

/** The declarations that an imported module supplies, as an interface carries them. */
export interface TypeGraph {
  readonly types: readonly TypeDecl[];
  readonly errors: readonly ErrorDecl[];
  readonly services: readonly ServiceDecl[];
}

/** Everything that type lowering reads about one module. */
export interface TypeEnv {
  readonly module: string;
  readonly tree: SyntaxTree;
  readonly targets: ReadonlyMap<NodeId, Target>;
  readonly table: TypeTable;
  /** Local and imported services by identity. */
  readonly services: Map<ServiceId, ServiceDecl>;
}

export interface ParameterSignature {
  readonly name: string;
  readonly borrow: boolean;
  /** The local identity from the resolver. Absent in a function type, where names are labels. */
  readonly id: LocalId | undefined;
  readonly type: Lowered;
  /** True when the source gives the parameter a type annotation. */
  readonly annotated: boolean;
  /** True when the source omits the annotation or explicitly writes `unknown`. */
  readonly inferred: boolean;
  /** Covers the name and its annotation. */
  readonly span: Span;
}

export interface SignatureBase {
  readonly name: string;
  readonly exported: boolean;
  /** The declaration node. */
  readonly node: NodeId;
  readonly nameNode: NodeId;
  /** The span of the whole declaration. */
  readonly span: Span;
  readonly nameSpan: Span;
}

export interface FunctionSignature extends SignatureBase {
  readonly kind: "function";
  readonly id: ValueId;
  /**
   * The parts that close the contract. A part that is not written is inferred.
   * An exported function closes both sets: an omitted clause is an empty set.
   */
  readonly written: WrittenParts;
  /** Where a written result comes from: the arrow, or the binding type annotation. */
  readonly annotation: "arrow" | "binding" | "none";
  readonly parameters: readonly ParameterSignature[];
  /** Absent when the result is not written. */
  readonly result: Lowered | undefined;
  /** Sorted and unique. Empty when the set is open. */
  readonly failures: readonly ErrorId[];
  /** Sorted and unique. A whole service is expanded to all its methods. Empty when the set is open. */
  readonly requirements: readonly CapabilityId[];
  /** Present when a binding type requires pure execution. */
  readonly expectedExecution?: "pure";
}

export interface ConstantSignature extends SignatureBase {
  readonly kind: "constant";
  readonly id: ValueId;
  /** The binding type annotation, when present. */
  readonly type: Lowered | undefined;
}

export interface ProviderSignature extends SignatureBase {
  readonly kind: "provider";
  readonly id: ValueId;
  readonly provides: readonly CapabilityId[];
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  /** The provider type: acquisition execution is always `effect`. */
  readonly type: Lowered;
}

export type ValueSignature =
  | FunctionSignature
  | ConstantSignature
  | ProviderSignature;

export interface ModuleDeclarations {
  readonly module: string;
  readonly env: TypeEnv;
  /** Source order. Duplicate names after the first are left out. */
  readonly types: readonly TypeDecl[];
  readonly errors: readonly ErrorDecl[];
  readonly services: readonly ServiceDecl[];
  readonly methodTypes: ReadonlyMap<CapabilityId, TypeRef>;
  /** Module-level consts and providers in source order. */
  readonly values: ReadonlyMap<ValueId, ValueSignature>;
  /** Identities of the exported declarations, sorted. */
  readonly exports: readonly DeclarationId[];
  /** Declaration diagnostics of this module, sorted. */
  readonly diagnostics: readonly Diagnostic[];
}

// ------------------------------------------------------------------ modes

/** The mode map of a module: the invocation mode of each function. */
export type ModeMap = ReadonlyMap<ValueId, Execution>;
/** Consumers can look up a solved state without owning or mutating the map. */
export type SolvedLookup = Pick<ReadonlyMap<ValueId, Solved>, "get">;

type SignatureError =
  | { readonly tag: "missing-mode"; readonly id: ValueId }
  | { readonly tag: "inferred-contract"; readonly id: ValueId };

/**
 * The lookup of a mode map for a signature whose sets are closed. Exported
 * functions are closed, so their sets never come from the lookup.
 */
export function modesAsSolved(modes: Pick<ModeMap, "get">): SolvedLookup {
  return {
    get: (id) => {
      const mode = modes.get(id);
      return mode === undefined
        ? undefined
        : { mode, failures: [], requirements: [] };
    },
  };
}

/**
 * True when the body decides part of the contract of a function with a written
 * result: the mode, because the closed sets are empty, or an open set.
 */
export function isPendingMode(signature: FunctionSignature): boolean {
  const { written } = signature;
  return written.result &&
    !(written.fails && written.uses &&
      signature.failures.length + signature.requirements.length > 0);
}

/**
 * The mode and the sets of a signature with a written result. A closed set is
 * the written one. An open set and a pending mode come from `solved`, which must
 * hold an entry then.
 */
function contractOf(
  signature: FunctionSignature,
  solved: SolvedLookup,
): Result<Solved, SignatureError> {
  if (!signature.written.result) {
    return { ok: false, error: { tag: "inferred-contract", id: signature.id } };
  }
  const { written } = signature;
  if (!isPendingMode(signature)) {
    return {
      ok: true,
      value: {
        mode: "effect",
        failures: signature.failures,
        requirements: signature.requirements,
      },
    };
  }
  const entry = solved.get(signature.id);
  if (entry === undefined) {
    return { ok: false, error: { tag: "missing-mode", id: signature.id } };
  }
  const failures = written.fails ? signature.failures : entry.failures;
  const requirements = written.uses
    ? signature.requirements
    : entry.requirements;
  return {
    ok: true,
    value: {
      mode: failures.length + requirements.length > 0 ? "effect" : entry.mode,
      failures,
      requirements,
    },
  };
}

/**
 * The execution mode of a signature with a written result. A nonempty set gives
 * `effect`. Otherwise the mode comes from `solved`.
 */
export function executionOf(
  signature: FunctionSignature,
  solved: SolvedLookup,
): Result<Execution, SignatureError> {
  const contract = contractOf(signature, solved);
  return contract.ok ? { ok: true, value: contract.value.mode } : contract;
}

export interface SignatureType {
  readonly ref: TypeRef;
  readonly ir: FunctionType;
}

export function checkedInputFlags(
  signature: Pick<FunctionSignature, "exported" | "parameters">,
  table: TypeTable,
): readonly boolean[] {
  return signature.parameters.map((parameter) =>
    signature.exported && parameter.inferred &&
    parameter.type.ref !== table.unknown
  );
}

/** The function type of a signature with a written result, with the state from `solved`. */
export function signatureType(
  table: TypeTable,
  signature: FunctionSignature,
  solved: SolvedLookup,
): Result<SignatureType, SignatureError> {
  const contract = contractOf(signature, solved);
  if (!contract.ok) return contract;
  const result = signature.result;
  if (result === undefined) {
    return { ok: false, error: { tag: "inferred-contract", id: signature.id } };
  }
  return {
    ok: true,
    value: loweredFunction(
      table,
      contract.value.mode,
      signature.parameters.map((p) => p.type),
      result,
      contract.value.failures,
      contract.value.requirements,
      signature.parameters.map((p) => p.borrow),
      checkedInputFlags(signature, table),
    ),
  };
}

/** A function type as an interned type and an IR tree. The sets are sorted and unique. */
export function loweredFunction(
  table: TypeTable,
  execution: Execution,
  parameters: readonly Lowered[],
  result: Lowered,
  failures: readonly ErrorId[],
  requirements: readonly CapabilityId[],
  borrows?: readonly boolean[],
  checked?: readonly boolean[],
): SignatureType {
  const failureSet = sortedUnique(failures);
  const requirementSet = sortedUnique(requirements);
  const borrowed = borrows?.some(Boolean) ? { borrows } : {};
  const validated = checked?.some(Boolean) ? { checked } : {};
  return {
    ref: table.function({
      execution,
      parameters: parameters.map((p) => p.ref),
      ...borrowed,
      ...validated,
      result: result.ref,
      failures: failureSet,
      requirements: requirementSet,
    }),
    ir: {
      kind: "function",
      execution,
      parameters: parameters.map((p) => p.ir),
      ...borrowed,
      ...validated,
      result: result.ir,
      effects: { failures: failureSet, requirements: requirementSet },
    },
  };
}

/** Adds the type and error identities that an IR type mentions, and the services of its capabilities. */
export function referencedIds(type: Type, ids: Set<string>): void {
  switch (type.kind) {
    case "closeable-scope":
    case "primitive":
    case "literal":
      return;
    case "named":
      ids.add(type.id);
      return;
    case "record":
      for (const field of type.fields) referencedIds(field.type, ids);
      return;
    case "array":
    case "option":
    case "set":
    case "ref":
      referencedIds(type.element, ids);
      return;
    case "map":
      referencedIds(type.key, ids);
      referencedIds(type.value, ids);
      return;
    case "retry-schedule":
      referencedIds(type.error, ids);
      return;
    case "codec":
      referencedIds(type.decoded, ids);
      referencedIds(type.encoded, ids);
      return;
    case "schema":
      referencedIds(type.decoded, ids);
      referencedIds(type.encoded, ids);
      if (type.makeInput !== undefined) referencedIds(type.makeInput, ids);
      effectIds([], type.decodeRequirements, ids);
      effectIds([], type.encodeRequirements, ids);
      return;
    case "fiber":
      referencedIds(type.result, ids);
      effectIds(type.failures, [], ids);
      return;
    case "effect":
      referencedIds(type.result, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "stream":
      referencedIds(type.element, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "schedule":
      referencedIds(type.output, ids);
      referencedIds(type.input, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "sink":
      referencedIds(type.input, ids);
      referencedIds(type.result, ids);
      if (type.leftover !== undefined) referencedIds(type.leftover, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "tuple":
      for (const element of type.elements) referencedIds(element, ids);
      return;
    case "union":
      for (const member of type.members) referencedIds(member, ids);
      return;
    case "function":
      for (const parameter of type.parameters) referencedIds(parameter, ids);
      referencedIds(type.result, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "provider":
      effectIds([], type.provides, ids);
      effectIds(
        type.acquisition.effects.failures,
        type.acquisition.effects.requirements,
        ids,
      );
      return;
  }
}

/** Adds failure identities and the services of capabilities. */
export function effectIds(
  failures: readonly ErrorId[],
  capabilities: readonly CapabilityId[],
  ids: Set<string>,
): void {
  for (const failure of failures) ids.add(failure);
  for (const capability of capabilities) {
    const service = serviceOfCapability(capability);
    if (service !== undefined) ids.add(service);
  }
}
