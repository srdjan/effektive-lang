// The signature model of the declaration checker: function and constant
// signatures, the module declarations that carry them, the execution modes,
// and the lowering of a signature to a function type. TypeLowerer
// and the module checker (check_declarations.ts) both build on it.
//
// - `ModuleDeclarations.values` holds one signature for each module-level const
//   and provider. The body checker checks each body against its signature.
// - A function signature without a written result has no result and empty
//   sets. A set whose clause is not written (`written.fails` or `written.uses`
//   is false) is open: the body checker infers it, and the signature holds an
//   empty set for it. An exported function leaves a `fails` clause open when it
//   writes none. Its omitted `with` set opens only in a module with service headers.
// - The execution mode and the open sets of a function come from a `Solved`
//   lookup that the body checker supplies. `signatureType` takes the lookup
//   and returns a Result error when an entry is missing.

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

/** An interned type together with its IR tree in source order. */
export type Lowered = {
  readonly ref: TypeRef;
  readonly ir: Type;
};

/** The declarations that an imported module supplies, as an interface carries them. */
export type TypeGraph = {
  readonly types: readonly TypeDecl[];
  readonly errors: readonly ErrorDecl[];
  readonly services: readonly ServiceDecl[];
};

/** Everything that type lowering reads about one module. */
export type TypeEnv = {
  readonly module: string;
  readonly tree: SyntaxTree;
  readonly targets: ReadonlyMap<NodeId, Target>;
  /** The error-name nodes of the handler arms that catch defects. */
  readonly defectArms: ReadonlySet<NodeId>;
  readonly table: TypeTable;
  /** Local and imported services by identity. */
  readonly services: ReadonlyMap<ServiceId, ServiceDecl>;
};

export type ParameterSignature = {
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
};

export type SignatureBase = {
  readonly name: string;
  readonly exported: boolean;
  /** The declaration node. */
  readonly node: NodeId;
  readonly nameNode: NodeId;
  /** The span of the whole declaration. */
  readonly span: Span;
  readonly nameSpan: Span;
};

export type FunctionSignature = SignatureBase & {
  readonly kind: "function";
  readonly id: ValueId;
  /**
   * The parts that close the contract. A part that is not written is inferred,
   * except that an export outside a service-header module closes its `with` set.
   * A binding function type closes every part.
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
};

export type ConstantSignature = SignatureBase & {
  readonly kind: "constant";
  readonly id: ValueId;
  /** The binding type annotation, when present. */
  readonly type: Lowered | undefined;
};

export type ProviderSignature = SignatureBase & {
  readonly kind: "provider";
  readonly id: ValueId;
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  /** The provider type: acquisition execution is always `effect`. */
  readonly type: Lowered;
};

export type ValueSignature =
  | FunctionSignature
  | ConstantSignature
  | ProviderSignature;

export type ModuleDeclarations = {
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
};

export type ModeMap = ReadonlyMap<ValueId, Execution>;
/** Consumers can look up a solved state without owning or mutating the map. */
export type SolvedLookup = Pick<ReadonlyMap<ValueId, Solved>, "get">;
export type PendingMode = boolean;
export type InputFlags = readonly boolean[];

type SignatureError =
  | { readonly tag: "missing-mode"; readonly id: ValueId }
  | { readonly tag: "inferred-contract"; readonly id: ValueId };

/**
 * True when the body decides part of the contract of a function with a written
 * result: the mode, because the closed sets are empty, or an open set.
 */
export function isPendingMode(signature: FunctionSignature): PendingMode {
  const written = signature.written;
  return written.result &&
    !(written.fails && written.uses &&
      signature.failures.length + signature.requirements.length > 0);
}

/**
 * The failure and requirement sets of a signature: a written set, else the
 * solved set. An open set with no entry in `solved` is empty.
 */
export function contractSets(
  signature: FunctionSignature,
  solved: SolvedLookup,
): Pick<Solved, "failures" | "requirements"> {
  const written = signature.written;
  const entry = written.fails && written.uses
    ? undefined
    : solved.get(signature.id);
  return {
    failures: written.fails ? signature.failures : entry?.failures ?? [],
    requirements: written.uses
      ? signature.requirements
      : entry?.requirements ?? [],
  };
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
  const sets = contractSets(signature, solved);
  const failures = sets.failures;
  const requirements = sets.requirements;
  return {
    ok: true,
    value: {
      mode: failures.length + requirements.length > 0 ? "effect" : entry.mode,
      failures: failures,
      requirements: requirements,
    },
  };
}

export type SignatureType = {
  readonly ref: TypeRef;
  readonly ir: FunctionType;
};

export function checkedInputFlags(
  signature: Pick<FunctionSignature, "exported" | "parameters">,
  table: TypeTable,
): InputFlags {
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
      contract.value,
      signature.parameters.map((p) => p.type),
      result,
      signature.parameters.map((p) => p.borrow),
      checkedInputFlags(signature, table),
    ),
  };
}

/**
 * `signatureType` for a state that the caller already holds, as the lowering
 * holds the state of a checked function. The written result keeps source order.
 */
export function solvedSignatureType(
  table: TypeTable,
  signature: FunctionSignature,
  state: Solved,
): Result<SignatureType, SignatureError> {
  return signatureType(table, signature, { get: () => state });
}

/**
 * The interned function type of a signature with the contract and the result
 * that a body check found. The borrow flags and the checked flags come from the
 * signature, as in `signatureType`.
 */
export function signatureFunctionRef(
  table: TypeTable,
  signature: FunctionSignature,
  contract: Pick<Solved, "mode" | "failures" | "requirements">,
  result: TypeRef,
): TypeRef {
  return table.function({
    execution: contract.mode,
    parameters: signature.parameters.map((p) => p.type.ref),
    borrows: signature.parameters.map((p) => p.borrow),
    checked: checkedInputFlags(signature, table),
    result: result,
    failures: contract.failures,
    requirements: contract.requirements,
  });
}

/** A function type as an interned type and an IR tree. The sets are sorted and unique. */
export function loweredFunction(
  table: TypeTable,
  contract: Pick<Solved, "mode" | "failures" | "requirements">,
  parameters: readonly Lowered[],
  result: Lowered,
  borrows: InputFlags | undefined,
  checked: InputFlags | undefined,
): SignatureType {
  const execution = contract.mode;
  const failureSet = sortedUnique(contract.failures);
  const requirementSet = sortedUnique(contract.requirements);
  const borrowed = borrows?.some(Boolean) ?? false;
  const validated = checked?.some(Boolean) ?? false;
  let flags: {
    readonly borrows?: InputFlags;
    readonly checked?: InputFlags;
  };
  if (
    borrows !== undefined && checked !== undefined && borrowed && validated
  ) {
    flags = { borrows: borrows, checked: checked };
  } else if (borrows !== undefined && borrowed) {
    flags = { borrows: borrows };
  } else if (checked !== undefined && validated) {
    flags = { checked: checked };
  } else {
    flags = {};
  }
  return {
    ref: table.function({
      ...flags,
      execution: execution,
      parameters: parameters.map((p) => p.ref),
      result: result.ref,
      failures: failureSet,
      requirements: requirementSet,
    }),
    ir: {
      ...flags,
      kind: "function",
      execution: execution,
      parameters: parameters.map((p) => p.ir),
      result: result.ir,
      effects: {
        failures: failureSet,
        requirements: requirementSet,
      },
    },
  };
}
