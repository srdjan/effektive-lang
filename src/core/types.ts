// Interned types and type compatibility. Equal structural types share one
// integer id (a `TypeRef`), so type equality is id equality. Aliases keep their
// name: a `named` type points at the alias `TypeId`, and compatibility unfolds
// the alias on demand. Types with identity, tagged records, and errors are nominal by identity.
//
// Tables share interned storage and keep separate definition maps. The ids
// depend on the order of interning, so no output may depend on a raw id. The
// serialization functions below sort by canonical text, not by id.

import type { CapabilityId, ErrorId, Execution, TypeId } from "./ir.ts";
import {
  DURATION_ID,
  INSTANT_ID,
  isClosedUnitId,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "./ir.ts";
import { isErrorId, isReservedErrorId, isTypeId, moduleOfId } from "./ids.ts";
import type { Predicate } from "./predicates.ts";
import { typeToIr } from "./type_ir.ts";
import { canonicalJson } from "./content_id.ts";
import { emptyMap, emptySet, indices, mapFrom, setFrom } from "./runtime.ts";
import { panic } from "./source.ts";
import { compareText, sortedUnique } from "./util.ts";

declare const typeRefBrand: unique symbol;

/** An interned type. Equal structural types have equal refs. */
export type TypeRef = number & { readonly [typeRefBrand]: true };

export type SchemaPresence =
  | "required"
  | "optional"
  | "encoded-optional"
  | "decoded-optional";

type SchemaOptions = {
  readonly presence?: SchemaPresence;
  readonly makeInput?: TypeRef;
  /** Constructor defaults are independent of field presence. */
  readonly constructorDefault?: boolean;
};

type PrimitiveName =
  | "string"
  | "boolean"
  | "int"
  | "number"
  | "unit"
  | "never"
  | "unknown";

export type RecordField = {
  readonly name: string;
  readonly type: TypeRef;
  readonly optional: boolean;
};

/** The interned form. Records are sorted by field name, unions by the canonical text of their IR. */
export type TypeNode =
  | { readonly kind: "primitive"; readonly name: PrimitiveName }
  | {
    readonly kind: "literal";
    readonly value: string | number | boolean | null;
  }
  | { readonly kind: "named"; readonly id: TypeId | ErrorId }
  | { readonly kind: "record"; readonly fields: readonly RecordField[] }
  | { readonly kind: "array"; readonly element: TypeRef }
  | { readonly kind: "tuple"; readonly elements: readonly TypeRef[] }
  | { readonly kind: "union"; readonly members: readonly TypeRef[] }
  | { readonly kind: "option"; readonly element: TypeRef }
  | { readonly kind: "ref"; readonly element: TypeRef }
  | { readonly kind: "retry-schedule"; readonly error: TypeRef }
  | {
    readonly kind: "schema";
    readonly decoded: TypeRef;
    readonly encoded: TypeRef;
    readonly decodeRequirements: readonly CapabilityId[];
    readonly encodeRequirements: readonly CapabilityId[];
    readonly presence: SchemaPresence;
    readonly makeInput?: TypeRef;
    /** Independent of field presence. */
    readonly constructorDefault?: true;
  }
  | {
    readonly kind: "effect";
    readonly result: TypeRef;
    readonly failures: readonly ErrorId[];
    readonly requirements: readonly CapabilityId[];
  }
  | {
    readonly kind: "stream";
    readonly element: TypeRef;
    readonly failures: readonly ErrorId[];
    readonly requirements: readonly CapabilityId[];
  }
  | {
    readonly kind: "sink";
    readonly input: TypeRef;
    readonly result: TypeRef;
    readonly leftover: TypeRef;
    readonly failures: readonly ErrorId[];
    readonly requirements: readonly CapabilityId[];
  }
  | {
    readonly kind: "function";
    readonly execution: Execution;
    readonly parameters: readonly TypeRef[];
    readonly borrows?: readonly boolean[];
    readonly checked?: readonly boolean[];
    readonly result: TypeRef;
    /** Sorted and unique. */
    readonly failures: readonly ErrorId[];
    /** Sorted and unique. */
    readonly requirements: readonly CapabilityId[];
  }
  | {
    readonly kind: "provider";
    /** Sorted and unique. */
    readonly provides: readonly CapabilityId[];
    readonly execution: Execution;
    readonly failures: readonly ErrorId[];
    readonly requirements: readonly CapabilityId[];
  }
  /** The recovery type. It is compatible with every type in both directions. */
  | { readonly kind: "error" };

type FunctionSpec = {
  readonly execution: Execution;
  readonly parameters: readonly TypeRef[];
  readonly borrows?: readonly boolean[];
  readonly checked?: readonly boolean[];
  readonly result: TypeRef;
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
};

type ProviderSpec = {
  readonly provides: readonly CapabilityId[];
  readonly execution: Execution;
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
};

function isSubset(
  small: readonly string[],
  large: readonly string[],
): boolean {
  const set = setFrom(large);
  return small.every((item) => set.has(item));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// The bound on the recursion of one comparison. The parser limits written
// nesting to 512 levels and `declaration/012` limits an alias to 128 levels.
// So one type is at most about 640 levels deep, and two types give at most
// about 1280 frames. 1536 leaves room above that.
export const MAX_DEPTH = 1536;

/** The members of a type after `unfold` and union flattening. A type that is not a union is its own member. */
export function flattenUnion(
  table: TypeTable,
  ref: TypeRef,
  unfold: (ref: TypeRef) => TypeRef,
): TypeRef[] {
  function visit(current: TypeRef, depth: number): TypeRef[] {
    const unfolded = unfold(current);
    const node = table.node(unfolded);
    if (node.kind === "union" && depth < MAX_DEPTH) {
      return node.members.flatMap((member) => visit(member, depth + 1));
    }
    return [unfolded];
  }
  return visit(ref, 0);
}

// No module has this name, so it owns no sealed type.
const NO_MODULE = "";

/**
 * The definition of a type id. `transparent` unfolds. `identity` has identity by
 * name and widens to its body. `tagged` is an identity record that carries a
 * tag. `opaque` has no body. `guarded` marks a recursive record that needs an
 * array, an optional key, or a tagged terminal choice.
 */
type AliasDef =
  | {
    readonly kind: "transparent";
    readonly body: TypeRef;
    readonly guarded: boolean;
  }
  | {
    readonly kind: "identity";
    readonly body: TypeRef;
    readonly sealed: boolean;
    readonly guarded: boolean;
    readonly predicate?: Predicate;
  }
  | {
    readonly kind: "tagged";
    readonly body: TypeRef;
    readonly sealed: boolean;
    readonly predicate?: Predicate;
  }
  | { readonly kind: "opaque" };

/** True for a guarded alias or a guarded untagged identity. */
function guarded(def: AliasDef | undefined): boolean {
  return (def?.kind === "transparent" || def?.kind === "identity") &&
    def.guarded;
}

/** The read side of a `TypeTable`: queries only, no writers. */
export type TypeReader = Pick<
  TypeTable,
  | "never"
  | "node"
  | "unfold"
  | "aliasOf"
  | "identityBaseOf"
  | "taggedRecordOf"
  | "predicateOf"
  | "errorRecordOf"
  | "isErrorOrTagged"
  | "recordBodyOf"
  | "nominalBodyOf"
  | "declaredBodyOf"
  | "optionElementOf"
  | "isSealed"
  | "error"
  | "size"
>;

type Lookup<Key, Value> = {
  readonly size: () => number;
  readonly get: (key: Key) => Value | undefined;
  readonly has: (key: Key) => boolean;
  readonly set: (key: Key, value: Value) => Lookup<Key, Value>;
  readonly copy: () => Lookup<Key, Value>;
};

function createLookup<Key, Value>(
  entries: Iterable<readonly [Key, Value]>,
): Lookup<Key, Value> {
  let values = mapFrom(entries);
  function size(): number {
    return values.size;
  }
  function get(key: Key): Value | undefined {
    return values.get(key);
  }
  function has(key: Key): boolean {
    return values.has(key);
  }
  function set(key: Key, value: Value): Lookup<Key, Value> {
    values = values.set(key, value);
    return lookup;
  }
  function copy(): Lookup<Key, Value> {
    return createLookup(values);
  }
  const lookup: Lookup<Key, Value> = {
    size: size,
    get: get,
    has: has,
    set: set,
    copy: copy,
  };
  return lookup;
}

type TypeStorage = {
  readonly size: () => number;
  readonly node: (ref: TypeRef) => TypeNode | undefined;
  readonly find: (key: string) => TypeRef | undefined;
  readonly append: (key: string, node: TypeNode) => TypeRef;
  readonly irKey: (ref: TypeRef) => string | undefined;
  readonly cacheIrKey: (ref: TypeRef, key: string) => string;
};

function createTypeRef(index: number): TypeRef {
  // This private constructor brands one newly allocated internal index.
  return index as TypeRef;
}

function createTypeStorage(): TypeStorage {
  const nodes: TypeNode[] = [];
  let byKey = emptyMap<string, TypeRef>();
  let irKeys = emptyMap<TypeRef, string>();
  function size(): number {
    return nodes.length;
  }
  function node(ref: TypeRef): TypeNode | undefined {
    return nodes[ref];
  }
  function find(key: string): TypeRef | undefined {
    return byKey.get(key);
  }
  function append(key: string, node: TypeNode): TypeRef {
    const ref = createTypeRef(nodes.length);
    nodes[nodes.length] = node;
    byKey = byKey.set(key, ref);
    return ref;
  }
  function irKey(ref: TypeRef): string | undefined {
    return irKeys.get(ref);
  }
  function cacheIrKey(ref: TypeRef, key: string): string {
    irKeys = irKeys.set(ref, key);
    return key;
  }
  return {
    size: size,
    node: node,
    find: find,
    append: append,
    irKey: irKey,
    cacheIrKey: cacheIrKey,
  };
}

/**
 * The children of each node kind except `named`, in visit order. The first
 * match of `foreignSealedOf` selects a diagnostic, so this order is observable.
 * The `never` check after the last `if` makes a new kind a compile error here.
 */
function structuralChildren(
  node: Exclude<TypeNode, { readonly kind: "named" }>,
): readonly TypeRef[] {
  if (node.kind === "record") return node.fields.map((field) => field.type);
  if (
    node.kind === "array" || node.kind === "option" || node.kind === "ref" ||
    node.kind === "stream"
  ) return [node.element];
  if (node.kind === "tuple") return node.elements;
  if (node.kind === "union") return node.members;
  if (node.kind === "retry-schedule") return [node.error];
  if (node.kind === "schema") {
    return node.makeInput === undefined
      ? [node.decoded, node.encoded]
      : [node.decoded, node.encoded, node.makeInput];
  }
  if (node.kind === "effect") return [node.result];
  if (node.kind === "sink") return [node.input, node.result, node.leftover];
  if (node.kind === "function") return [...node.parameters, node.result];
  if (
    node.kind === "primitive" || node.kind === "literal" ||
    node.kind === "provider" || node.kind === "error"
  ) return [];
  const unreachable: never = node;
  return unreachable;
}

export type TypeDepthMemo = {
  readonly get: (ref: TypeRef) => number | undefined;
  readonly set: (ref: TypeRef, height: number) => TypeDepthMemo;
};

export function TypeDepthMemo(): TypeDepthMemo {
  return createLookup<TypeRef, number>([]);
}

export type TypeTable = {
  readonly error: TypeRef;
  readonly string: TypeRef;
  readonly boolean: TypeRef;
  readonly int: TypeRef;
  readonly number: TypeRef;
  readonly unit: TypeRef;
  readonly never: TypeRef;
  readonly unknown: TypeRef;
  readonly fork: () => TypeTable;
  readonly size: () => number;
  readonly node: (ref: TypeRef) => TypeNode;
  readonly primitive: (name: PrimitiveName) => TypeRef;
  readonly literal: (value: string | number | boolean | null) => TypeRef;
  readonly named: (id: TypeId | ErrorId) => TypeRef;
  readonly record: (fields: readonly RecordField[]) => TypeRef;
  readonly array: (element: TypeRef) => TypeRef;
  readonly tuple: (elements: readonly TypeRef[]) => TypeRef;
  readonly option: (element: TypeRef) => TypeRef;
  readonly ref: (element: TypeRef) => TypeRef;
  readonly retrySchedule: (error: TypeRef) => TypeRef;
  readonly schema: (
    decoded: TypeRef,
    encoded: TypeRef,
    decodeRequirements: readonly CapabilityId[],
    encodeRequirements: readonly CapabilityId[],
    options: SchemaOptions,
  ) => TypeRef;
  readonly effect: (
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ) => TypeRef;
  readonly stream: (
    element: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ) => TypeRef;
  readonly sink: (
    input: TypeRef,
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
    leftover: TypeRef,
  ) => TypeRef;
  readonly union: (members: readonly TypeRef[]) => TypeRef;
  readonly function: (spec: FunctionSpec) => TypeRef;
  readonly provider: (spec: ProviderSpec) => TypeRef;
  readonly defineAlias: (
    id: TypeId,
    target: TypeRef,
    guarded: boolean,
  ) => TypeTable;
  readonly defineIdentity: (
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    guarded: boolean,
    predicate: Predicate | undefined,
  ) => TypeTable;
  readonly defineTagged: (
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    predicate: Predicate | undefined,
  ) => TypeTable;
  readonly defineOpaque: (id: TypeId) => TypeTable;
  readonly isIdentity: (id: TypeId) => boolean;
  readonly isOpaque: (id: TypeId) => boolean;
  readonly isSealed: (id: TypeId) => boolean;
  readonly ownsSealed: (module: string, id: TypeId) => boolean;
  readonly sealedRootOf: (ref: TypeRef) => TypeId | undefined;
  readonly foreignSealedOf: (
    module: string,
    ref: TypeRef,
  ) => TypeId | undefined;
  readonly containsForeignSealed: (module: string, ref: TypeRef) => boolean;
  readonly defineError: (id: ErrorId, record: TypeRef) => TypeTable;
  readonly aliasOf: (id: TypeId) => TypeRef | undefined;
  readonly identityBaseOf: (id: TypeId) => TypeRef | undefined;
  readonly taggedRecordOf: (id: TypeId) => TypeRef | undefined;
  readonly predicateOf: (id: TypeId) => Predicate | undefined;
  readonly taggedIdOf: (ref: TypeRef) => TypeId | undefined;
  readonly errorRecordOf: (id: ErrorId) => TypeRef | undefined;
  readonly isErrorOrTagged: (id: TypeId | ErrorId) => boolean;
  readonly recordBodyOf: (id: TypeId | ErrorId) => TypeRef | undefined;
  readonly nominalBodyOf: (id: TypeId | ErrorId) => TypeRef | undefined;
  readonly declaredBodyOf: (id: string) => TypeRef | undefined;
  readonly optionElementOf: (ref: TypeRef | undefined) => TypeRef | undefined;
  readonly isDefined: (id: TypeId | ErrorId) => boolean;
  readonly unfold: (ref: TypeRef) => TypeRef;
  readonly unfoldTransparent: (ref: TypeRef) => TypeRef;
  readonly exceedsDepth: (
    ref: TypeRef,
    limit: number,
    memo: TypeDepthMemo,
  ) => boolean;
  readonly isAssignable: (source: TypeRef, target: TypeRef) => boolean;
  readonly isAssignableIn: (
    module: string,
    source: TypeRef,
    target: TypeRef,
  ) => boolean;
};

type TypeTableState = {
  readonly storage: TypeStorage;
  readonly defs: Lookup<TypeId, AliasDef>;
  readonly errorRecords: Lookup<ErrorId, TypeRef>;
};

function createTypeTable(state: TypeTableState): TypeTable {
  const storage = state.storage;
  const defs = state.defs;
  const errorRecords = state.errorRecords;

  const error = intern({ kind: "error" });
  const string = primitive("string");
  const boolean = primitive("boolean");
  const int = primitive("int");
  const number = primitive("number");
  const unit = primitive("unit");
  const never = primitive("never");
  const unknown = primitive("unknown");

  /** Shares interned nodes and copies the definitions for independent writes. */
  function fork(): TypeTable {
    return createTypeTable({
      storage: storage,
      defs: defs.copy(),
      errorRecords: errorRecords.copy(),
    });
  }

  /** Number of interned types across tables that share storage. */
  function size(): number {
    return storage.size();
  }

  function node(ref: TypeRef): TypeNode {
    return storage.node(ref) ?? panic(`unknown type ref ${ref}`);
  }

  /** The intern key of a node. Each kind has its own prefix, so keys of different kinds never collide. */
  function keyOf(node: TypeNode): string {
    if (node.kind === "primitive") return `p:${node.name}`;
    if (node.kind === "literal") return `l:${JSON.stringify(node.value)}`;
    if (node.kind === "named") return `n:${node.id}`;
    if (node.kind === "record") {
      return `r:${
        JSON.stringify(node.fields.map((field) => [
          field.name,
          field.optional,
          field.type,
        ]))
      }`;
    }
    if (node.kind === "array") return `a:${node.element}`;
    if (node.kind === "tuple") return `t:${JSON.stringify(node.elements)}`;
    if (node.kind === "union") return `u:${JSON.stringify(node.members)}`;
    if (node.kind === "option") return `o:${node.element}`;
    if (node.kind === "ref") return `q:${node.element}`;
    if (node.kind === "retry-schedule") return `z:${node.error}`;
    if (node.kind === "schema") {
      return `h:${
        JSON.stringify([
          node.decoded,
          node.encoded,
          node.decodeRequirements,
          node.encodeRequirements,
          node.presence,
          node.makeInput ?? node.decoded,
          node.constructorDefault ?? false,
        ])
      }`;
    }
    if (node.kind === "effect") {
      return `x:${
        JSON.stringify([node.result, node.failures, node.requirements])
      }`;
    }
    if (node.kind === "stream") {
      return `s:${
        JSON.stringify([node.element, node.failures, node.requirements])
      }`;
    }
    if (node.kind === "sink") {
      return `k:${
        JSON.stringify([
          node.input,
          node.result,
          node.leftover,
          node.failures,
          node.requirements,
        ])
      }`;
    }
    if (node.kind === "function") {
      return `f:${
        JSON.stringify([
          node.execution,
          node.parameters,
          node.borrows ?? [],
          node.checked ?? [],
          node.result,
          node.failures,
          node.requirements,
        ])
      }`;
    }
    if (node.kind === "provider") {
      return `v:${
        JSON.stringify([
          node.provides,
          node.execution,
          node.failures,
          node.requirements,
        ])
      }`;
    }
    if (node.kind === "error") return "e";
    const unreachable: never = node;
    return unreachable;
  }

  /** Interns a node that is already in normal form. */
  function intern(node: TypeNode): TypeRef {
    const key = keyOf(node);
    const existing = storage.find(key);
    if (existing !== undefined) return existing;
    return storage.append(key, node);
  }

  function primitive(name: PrimitiveName): TypeRef {
    return intern({ kind: "primitive", name: name });
  }

  function literal(value: string | number | boolean | null): TypeRef {
    return intern({ kind: "literal", value: value });
  }

  function named(id: TypeId | ErrorId): TypeRef {
    return intern({ kind: "named", id: id });
  }

  /** Sorts the fields by name. Duplicate names keep the first field. */
  function record(fields: readonly RecordField[]): TypeRef {
    let byName = emptyMap<string, RecordField>();
    for (const field of fields) {
      if (!byName.has(field.name)) byName = byName.set(field.name, field);
    }
    const unique = [...byName.values()].toSorted((left, right) =>
      compareText(left.name, right.name)
    );
    return intern({ kind: "record", fields: unique });
  }

  function array(element: TypeRef): TypeRef {
    return intern({ kind: "array", element: element });
  }

  function tuple(elements: readonly TypeRef[]): TypeRef {
    return intern({ kind: "tuple", elements: [...elements] });
  }

  function option(element: TypeRef): TypeRef {
    return intern({ kind: "option", element: element });
  }

  function ref(element: TypeRef): TypeRef {
    return intern({ kind: "ref", element: element });
  }

  function retrySchedule(error: TypeRef): TypeRef {
    return intern({ kind: "retry-schedule", error: error });
  }

  function schema(
    decoded: TypeRef,
    encoded: TypeRef,
    decodeRequirements: readonly CapabilityId[],
    encodeRequirements: readonly CapabilityId[],
    options: SchemaOptions,
  ): TypeRef {
    const presence = options.presence ?? "required";
    const makeInput = options.makeInput ?? decoded;
    const constructorDefault = options.constructorDefault ?? false;
    const inputOption: {
      readonly makeInput?: TypeRef;
    } = makeInput === decoded ||
        (isAssignableIn(NO_MODULE, makeInput, decoded) &&
          isAssignableIn(NO_MODULE, decoded, makeInput))
      ? {}
      : { makeInput: makeInput };
    const nodeOptions: {
      readonly makeInput?: TypeRef;
      readonly constructorDefault?: true;
    } = constructorDefault
      ? { ...inputOption, constructorDefault: true }
      : inputOption;
    return intern({
      ...nodeOptions,
      kind: "schema",
      decoded: decoded,
      encoded: encoded,
      decodeRequirements: sortedUnique(decodeRequirements),
      encodeRequirements: sortedUnique(encodeRequirements),
      presence: presence,
    });
  }

  function effect(
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): TypeRef {
    return intern({
      kind: "effect",
      result: result,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  function stream(
    element: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): TypeRef {
    return intern({
      kind: "stream",
      element: element,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  function sink(
    input: TypeRef,
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
    leftover: TypeRef,
  ): TypeRef {
    return intern({
      kind: "sink",
      input: input,
      result: result,
      leftover: leftover,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  /**
   * Flattens nested unions, removes duplicates, and sorts the members by the
   * canonical JSON of their IR, the order that `typeToIr` emits. The order does
   * not depend on the order in which the table interned the types. A union of one
   * member is that member. An empty union is `never`. A union with the error type
   * is the error type.
   */
  function union(members: readonly TypeRef[]): TypeRef {
    let flat = emptySet<TypeRef>();
    for (const member of members) {
      const memberNode = node(member);
      if (memberNode.kind === "error") return error;
      if (memberNode.kind === "union") {
        for (const inner of memberNode.members) flat = flat.add(inner);
      } else {
        flat = flat.add(member);
      }
    }
    if (flat.size === 0) return never;
    const sorted = [...flat].toSorted((a, b) =>
      compareText(irKey(a), irKey(b)) || a - b
    );
    if (sorted.length === 1) return sorted[0];
    return intern({ kind: "union", members: sorted });
  }

  function irKey(ref: TypeRef): string {
    const key = storage.irKey(ref);
    if (key !== undefined) return key;
    return storage.cacheIrKey(ref, canonicalJson(typeToIr(table, ref)));
  }

  /** Sorts and deduplicates the failure and requirement sets. */
  function functionType(spec: FunctionSpec): TypeRef {
    const borrowOption: {
      readonly borrows?: readonly boolean[];
    } = spec.borrows?.some(Boolean) ? { borrows: [...spec.borrows] } : {};
    const options: {
      readonly borrows?: readonly boolean[];
      readonly checked?: readonly boolean[];
    } = spec.checked?.some(Boolean)
      ? { ...borrowOption, checked: [...spec.checked] }
      : borrowOption;
    return intern({
      ...options,
      kind: "function",
      execution: spec.execution,
      parameters: [...spec.parameters],
      result: spec.result,
      failures: sortedUnique(spec.failures),
      requirements: sortedUnique(spec.requirements),
    });
  }

  function provider(spec: ProviderSpec): TypeRef {
    return intern({
      kind: "provider",
      provides: sortedUnique(spec.provides),
      execution: spec.execution,
      failures: sortedUnique(spec.failures),
      requirements: sortedUnique(spec.requirements),
    });
  }

  /**
   * Registers the definition of an alias. The last definition wins. A guarded
   * alias is a recursive record that needs an array, an optional key, or a
   * tagged terminal choice.
   */
  function writeDefinition(id: TypeId, definition: AliasDef): TypeTable {
    const stored = defs.set(id, definition).get(id);
    return stored === definition
      ? table
      : panic(`type definition ${id} was not stored`);
  }

  function defineAlias(
    id: TypeId,
    target: TypeRef,
    isGuarded: boolean,
  ): TypeTable {
    return writeDefinition(id, {
      kind: "transparent",
      body: target,
      guarded: isGuarded,
    });
  }

  /** Defines an alias with identity by name. A sealed identity needs the authority of its module. */
  function defineIdentity(
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    isGuarded: boolean,
    predicate: Predicate | undefined,
  ): TypeTable {
    const options: { readonly predicate?: Predicate } = predicate === undefined
      ? {}
      : { predicate: predicate };
    return writeDefinition(id, {
      ...options,
      kind: "identity",
      body: body,
      sealed: sealed,
      guarded: isGuarded,
    });
  }

  /** Defines an identity record that carries a tag. */
  function defineTagged(
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    predicate: Predicate | undefined,
  ): TypeTable {
    const options: { readonly predicate?: Predicate } = predicate === undefined
      ? {}
      : { predicate: predicate };
    return writeDefinition(id, {
      ...options,
      kind: "tagged",
      body: body,
      sealed: sealed,
    });
  }

  /** Defines an opaque type. It has no body and is never sealed. */
  function defineOpaque(id: TypeId): TypeTable {
    return writeDefinition(id, { kind: "opaque" });
  }

  /** The definition behind a named type, or undefined for an error or another node. */
  function defOf(node: TypeNode): AliasDef | undefined {
    return node.kind === "named" && !isErrorId(node.id)
      ? defs.get(node.id)
      : undefined;
  }

  /** True for an opaque type, an alias with identity, or a tagged record. */
  function isIdentity(id: TypeId): boolean {
    const kind = defs.get(id)?.kind;
    return kind === "identity" || kind === "tagged" || kind === "opaque";
  }

  function isOpaque(id: TypeId): boolean {
    return defs.get(id)?.kind === "opaque";
  }

  function isSealed(id: TypeId): boolean {
    const def = defs.get(id);
    return (def?.kind === "identity" || def?.kind === "tagged") && def.sealed;
  }

  function ownsSealed(module: string, id: TypeId): boolean {
    return !isSealed(id) || moduleOfId(id) === module;
  }

  /** The sealed nominal identity below aliases, if this type is one. */
  function sealedRootOf(ref: TypeRef): TypeId | undefined {
    let current = ref;
    let seen = emptySet<TypeRef>();
    for (const _step of indices(defs.size() + 1)) {
      if (seen.has(current)) return undefined;
      seen = seen.add(current);
      const currentNode = node(current);
      if (currentNode.kind !== "named" || isErrorId(currentNode.id)) {
        return undefined;
      }
      if (isSealed(currentNode.id)) return currentNode.id;
      const alias = aliasOf(currentNode.id);
      if (alias === undefined) return undefined;
      current = alias;
    }
    return undefined;
  }

  /** A foreign sealed nominal identity contained in this type, if one exists. */
  function foreignSealedOf(module: string, ref: TypeRef): TypeId | undefined {
    let seen = emptySet<TypeRef>();
    function visit(current: TypeRef): TypeId | undefined {
      if (seen.has(current)) return undefined;
      seen = seen.add(current);
      const currentNode = node(current);
      if (currentNode.kind === "named") {
        if (!isErrorId(currentNode.id) && !ownsSealed(module, currentNode.id)) {
          return currentNode.id;
        }
        const target = isErrorId(currentNode.id)
          ? errorRecords.get(currentNode.id)
          : aliasOf(currentNode.id);
        return target === undefined ? undefined : visit(target);
      }
      for (const child of structuralChildren(currentNode)) {
        const found = visit(child);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    return visit(ref);
  }

  /** True when a type contains a sealed nominal type from another module. */
  function containsForeignSealed(module: string, ref: TypeRef): boolean {
    return foreignSealedOf(module, ref) !== undefined;
  }

  function defineError(id: ErrorId, record: TypeRef): TypeTable {
    const stored = errorRecords.set(id, record).get(id);
    return stored === record
      ? table
      : panic(`error definition ${id} was not stored`);
  }

  function aliasOf(id: TypeId): TypeRef | undefined {
    const def = defs.get(id);
    return def === undefined || def.kind === "opaque" ? undefined : def.body;
  }

  /** The base of an opaque type, or the body of an untagged identity. */
  function identityBaseOf(id: TypeId): TypeRef | undefined {
    const def = defs.get(id);
    if (def?.kind === "opaque") return unknown;
    return def?.kind === "identity" ? def.body : undefined;
  }

  /** The body of a tagged record. */
  function taggedRecordOf(id: TypeId): TypeRef | undefined {
    const def = defs.get(id);
    return def?.kind === "tagged" ? def.body : undefined;
  }

  /** The predicate of an identity or tagged record. */
  function predicateOf(id: TypeId): Predicate | undefined {
    const def = defs.get(id);
    return def?.kind === "identity" || def?.kind === "tagged"
      ? def.predicate
      : undefined;
  }

  /** The id of the type when it is a named tagged record, otherwise undefined. */
  function taggedIdOf(ref: TypeRef): TypeId | undefined {
    const typeNode = node(ref);
    return typeNode.kind === "named" && isTypeId(typeNode.id) &&
        taggedRecordOf(typeNode.id) !== undefined
      ? typeNode.id
      : undefined;
  }

  function errorRecordOf(id: ErrorId): TypeRef | undefined {
    return errorRecords.get(id);
  }

  /** True for a named error or a tagged record. An untagged identity, an opaque type, and an alias are not. */
  function isErrorOrTagged(id: TypeId | ErrorId): boolean {
    return isErrorId(id) || taggedRecordOf(id) !== undefined;
  }

  /** The record body of a named error or a tagged record. Any other id has none. */
  function recordBodyOf(id: TypeId | ErrorId): TypeRef | undefined {
    return isErrorId(id) ? errorRecordOf(id) : taggedRecordOf(id);
  }

  /** The record body, or the base of an untagged identity or an opaque type. An error has no base. */
  function nominalBodyOf(id: TypeId | ErrorId): TypeRef | undefined {
    return isErrorId(id)
      ? errorRecordOf(id)
      : taggedRecordOf(id) ?? identityBaseOf(id);
  }

  /** The alias or record body of a type id, or the record body of an error id. Any other id has none. */
  function declaredBodyOf(id: string): TypeRef | undefined {
    if (isTypeId(id)) return aliasOf(id) ?? taggedRecordOf(id);
    return isErrorId(id) ? errorRecordOf(id) : undefined;
  }

  /** The element type of an option type, or undefined when the type is no option or has several options. */
  function optionElementOf(ref: TypeRef | undefined): TypeRef | undefined {
    if (ref === undefined) return undefined;
    const options = flattenUnion(table, ref, (r) => unfold(r)).map((m) =>
      node(m)
    ).filter((m) => m.kind === "option");
    const only = options.length === 1 ? options[0] : undefined;
    return only?.kind === "option" ? only.element : undefined;
  }

  function isDefined(id: TypeId | ErrorId): boolean {
    return isErrorId(id) ? errorRecords.has(id) : defs.has(id);
  }

  /** Follows alias definitions until the type is not a defined alias. */
  function unfold(ref: TypeRef): TypeRef {
    return follow(ref, false);
  }

  /** Follows transparent aliases and stops at an alias that has identity. */
  function unfoldTransparent(ref: TypeRef): TypeRef {
    return follow(ref, true);
  }

  function follow(ref: TypeRef, stopAtIdentity: boolean): TypeRef {
    let current = ref;
    for (const _step of indices(defs.size() + 1)) {
      const currentNode = node(current);
      if (currentNode.kind !== "named" || isErrorId(currentNode.id)) {
        return current;
      }
      const def = defs.get(currentNode.id);
      if (def === undefined || def.kind === "opaque") return current;
      if (stopAtIdentity && def.kind !== "transparent") return current;
      current = def.body;
    }
    return error;
  }

  /**
   * True when the type is deeper than `limit` levels. A leaf has depth 1. A
   * composite type has 1 plus the largest depth of its children. An alias name
   * has 1 plus the depth of its target, so the levels inside aliases count. The
   * `memo` holds exact depths of types that fit in the limit. A walk that goes
   * past the limit stops and memoizes nothing for the nodes it aborted. The
   * recursion has at most `limit + 1` frames.
   */
  function exceedsDepth(
    ref: TypeRef,
    limit: number,
    memo: TypeDepthMemo,
  ): boolean {
    return heightWithin(ref, limit, memo) === Infinity;
  }

  /** The exact height of the type when it is at most `budget`, else `Infinity`. */
  function heightWithin(
    ref: TypeRef,
    budget: number,
    memo: TypeDepthMemo,
  ): number {
    const known = memo.get(ref);
    if (known !== undefined) return known <= budget ? known : Infinity;
    if (budget < 1) return Infinity;
    let tallest = 0;
    for (const child of childRefs(node(ref))) {
      const height = heightWithin(child, budget - 1, memo);
      if (height === Infinity) return Infinity;
      if (height > tallest) tallest = height;
    }
    const height = 1 + tallest;
    return memo.set(ref, height).get(ref) ?? height;
  }

  /**
   * The types that one level below `node` counts toward its height. An alias
   * name has its target as its child, unless the alias is guarded or undefined.
   */
  function childRefs(node: TypeNode): readonly TypeRef[] {
    if (node.kind !== "named") return structuralChildren(node);
    if (isErrorId(node.id)) return [];
    const def = defs.get(node.id);
    if (
      def === undefined || def.kind === "opaque" || def.kind === "tagged" ||
      def.guarded
    ) return [];
    return [def.body];
  }

  /**
   * True when a value of type `source` may be used where `target` is expected.
   * Every module owns every sealed type here. Use this form only for a test
   * that builds no value, such as a `null` equality or a literal pattern.
   */
  function isAssignable(source: TypeRef, target: TypeRef): boolean {
    return assignable(source, target, 0, true, undefined, true);
  }

  /** Compatibility in one source module. Sealed nominal widening needs this authority. */
  function isAssignableIn(
    module: string,
    source: TypeRef,
    target: TypeRef,
  ): boolean {
    return assignable(source, target, 0, true, module, true);
  }

  /**
   * `lift` is true only at the top of a value position. There a pure function
   * may fit an effect function type, because the emitter wraps the value. A
   * function nested in a record, array, option, tuple, union, result, or
   * parameter cannot be wrapped, so its execution must match.
   */
  function assignable(
    s: TypeRef,
    t: TypeRef,
    depth: number,
    lift: boolean,
    module: string | undefined,
    adopt: boolean,
  ): boolean {
    if (s === t) return true;
    if (depth > MAX_DEPTH) return false;
    const sn = node(s);
    const tn = node(t);
    // `adopt` is false for a value that has widened to the body of an identity:
    // it takes no other name at that level.
    function nested(
      source: TypeRef,
      target: TypeRef,
      nestedLift: boolean,
      nestedAdopt: boolean,
    ): boolean {
      return assignable(
        source,
        target,
        depth + 1,
        nestedLift,
        module,
        nestedAdopt,
      );
    }
    const sd = defOf(sn);
    const td = defOf(tn);
    // Two different guarded records never fit each other. Equal ids have equal refs.
    if (guarded(sd) && guarded(td)) return false;
    if (sn.kind === "error" || tn.kind === "error") return true;
    if (sn.kind === "primitive" && sn.name === "never") return true;
    function owns(id: TypeId | ErrorId): boolean {
      return module === undefined || isErrorId(id) || ownsSealed(module, id);
    }
    // A transparent alias unfolds. An alias with identity stays a name.
    if (sd?.kind === "transparent") return nested(sd.body, t, lift, adopt);
    if (td?.kind === "transparent") return nested(s, td.body, lift, adopt);
    // A union is not one value: each member keeps its name.
    if (sn.kind === "union") {
      return sn.members.every((member) => nested(member, t, false, adopt));
    }
    // An identity or a tagged record widens to its body, and takes no other name
    // there. A sealed one needs the authority of its module.
    if (
      sn.kind === "named" &&
      (sd?.kind === "identity" || sd?.kind === "tagged") &&
      owns(sn.id) && nested(sd.body, t, lift, false)
    ) return true;
    // A named target takes only its own name, or an unnamed value through the
    // body of an untagged identity. A tagged record takes a record literal only
    // through implicit construction.
    if (tn.kind === "named") {
      // `Duration` and `Instant` are closed: only a literal or an operation of
      // the type makes one.
      return adopt && sn.kind !== "named" && !isClosedUnitId(tn.id) &&
        td?.kind === "identity" &&
        td.predicate === undefined && owns(tn.id) &&
        nested(s, td.body, lift, true);
    }
    if (tn.kind === "union") {
      for (const member of tn.members) {
        if (nested(s, member, false, adopt)) return true;
      }
      return false;
    }
    if (tn.kind === "primitive") {
      if (sn.kind === "primitive") {
        return sn.name === tn.name ||
          (sn.name === "int" && tn.name === "number");
      }
      return sn.kind === "literal" && literalFitsPrimitive(sn.value, tn.name);
    }
    if (tn.kind === "literal") {
      return sn.kind === "literal" && sn.value === tn.value;
    }
    if (tn.kind === "record") {
      return sn.kind === "record" && sn.fields.length === tn.fields.length &&
        sn.fields.every((field, index) => {
          const other = tn.fields[index];
          return field.name === other.name &&
            field.optional === other.optional &&
            nested(field.type, other.type, false, true);
        });
    }
    if (tn.kind === "array") {
      return sn.kind === "array" &&
        nested(sn.element, tn.element, false, true);
    }
    if (tn.kind === "option") {
      return sn.kind === "option" &&
        nested(sn.element, tn.element, false, true);
    }
    if (tn.kind === "ref") {
      return sn.kind === "ref" &&
        nested(sn.element, tn.element, false, true) &&
        nested(tn.element, sn.element, false, true);
    }
    if (tn.kind === "retry-schedule") {
      return sn.kind === "retry-schedule" &&
        nested(sn.error, tn.error, false, true) &&
        nested(tn.error, sn.error, false, true);
    }
    if (tn.kind === "schema") {
      return sn.kind === "schema" &&
        sn.presence === tn.presence &&
        sn.constructorDefault === tn.constructorDefault &&
        nested(
          sn.makeInput ?? sn.decoded,
          tn.makeInput ?? tn.decoded,
          false,
          true,
        ) &&
        nested(
          tn.makeInput ?? tn.decoded,
          sn.makeInput ?? sn.decoded,
          false,
          true,
        ) &&
        nested(sn.decoded, tn.decoded, false, true) &&
        nested(tn.decoded, sn.decoded, false, true) &&
        nested(sn.encoded, tn.encoded, false, true) &&
        nested(tn.encoded, sn.encoded, false, true) &&
        isSubset(sn.decodeRequirements, tn.decodeRequirements) &&
        isSubset(sn.encodeRequirements, tn.encodeRequirements);
    }
    if (tn.kind === "effect") {
      return sn.kind === "effect" &&
        nested(sn.result, tn.result, false, true) &&
        isSubset(sn.failures, tn.failures) &&
        isSubset(sn.requirements, tn.requirements);
    }
    if (tn.kind === "stream") {
      return sn.kind === "stream" &&
        nested(sn.element, tn.element, false, true) &&
        isSubset(sn.failures, tn.failures) &&
        isSubset(sn.requirements, tn.requirements);
    }
    if (tn.kind === "sink") {
      return sn.kind === "sink" &&
        nested(tn.input, sn.input, false, true) &&
        nested(sn.result, tn.result, false, true) &&
        nested(sn.leftover, tn.leftover, false, true) &&
        isSubset(sn.failures, tn.failures) &&
        isSubset(sn.requirements, tn.requirements);
    }
    if (tn.kind === "tuple") {
      return sn.kind === "tuple" &&
        sn.elements.length === tn.elements.length &&
        sn.elements.every((element, index) =>
          nested(element, tn.elements[index], false, true)
        );
    }
    if (tn.kind === "function") {
      if (sn.kind !== "function") return false;
      if (sn.parameters.length !== tn.parameters.length) return false;
      const sourceBorrows = sn.borrows ?? [];
      if (
        (tn.borrows ?? []).some((borrow, index) =>
          borrow && !sourceBorrows[index]
        )
      ) {
        return false;
      }
      const sourceChecked = sn.checked ?? [];
      if (
        (tn.checked ?? []).some((checked, index) =>
          checked && !sourceChecked[index]
        )
      ) {
        return false;
      }
      if (
        sn.execution !== tn.execution &&
        !(lift && executionFits(sn.execution, tn.execution))
      ) return false;
      if (!isSubset(sn.failures, tn.failures)) return false;
      if (!isSubset(sn.requirements, tn.requirements)) return false;
      if (!nested(sn.result, tn.result, false, true)) return false;
      return tn.parameters.every((parameter, index) =>
        nested(parameter, sn.parameters[index], false, true)
      );
    }
    if (tn.kind === "provider") {
      return sn.kind === "provider" &&
        sameList(sn.provides, tn.provides) &&
        executionFits(sn.execution, tn.execution) &&
        isSubset(sn.failures, tn.failures) &&
        isSubset(sn.requirements, tn.requirements);
    }
    const unreachable: never = tn;
    return unreachable;
  }

  const table: TypeTable = {
    error: error,
    string: string,
    boolean: boolean,
    int: int,
    number: number,
    unit: unit,
    never: never,
    unknown: unknown,
    fork: fork,
    size: size,
    node: node,
    primitive: primitive,
    literal: literal,
    named: named,
    record: record,
    array: array,
    tuple: tuple,
    option: option,
    ref: ref,
    retrySchedule: retrySchedule,
    schema: schema,
    effect: effect,
    stream: stream,
    sink: sink,
    union: union,
    function: functionType,
    provider: provider,
    defineAlias: defineAlias,
    defineIdentity: defineIdentity,
    defineTagged: defineTagged,
    defineOpaque: defineOpaque,
    isIdentity: isIdentity,
    isOpaque: isOpaque,
    isSealed: isSealed,
    ownsSealed: ownsSealed,
    sealedRootOf: sealedRootOf,
    foreignSealedOf: foreignSealedOf,
    containsForeignSealed: containsForeignSealed,
    defineError: defineError,
    aliasOf: aliasOf,
    identityBaseOf: identityBaseOf,
    taggedRecordOf: taggedRecordOf,
    predicateOf: predicateOf,
    taggedIdOf: taggedIdOf,
    errorRecordOf: errorRecordOf,
    isErrorOrTagged: isErrorOrTagged,
    recordBodyOf: recordBodyOf,
    nominalBodyOf: nominalBodyOf,
    declaredBodyOf: declaredBodyOf,
    optionElementOf: optionElementOf,
    isDefined: isDefined,
    unfold: unfold,
    unfoldTransparent: unfoldTransparent,
    exceedsDepth: exceedsDepth,
    isAssignable: isAssignable,
    isAssignableIn: isAssignableIn,
  };
  return table;
}

/** Constructs an independent table with shared storage only after `fork`. */
export function TypeTable(): TypeTable {
  const table = createTypeTable({
    storage: createTypeStorage(),
    defs: createLookup<TypeId, AliasDef>([]),
    errorRecords: createLookup<ErrorId, TypeRef>([]),
  });
  const message = table.record([
    { name: "message", type: table.string, optional: false },
  ]);
  return table
    .defineError(SCHEMA_ERROR_ID, message)
    .defineError(SCHEMA_ISSUE_ID, table.record([]))
    .defineIdentity(DURATION_ID, table.int, false, false, undefined)
    .defineIdentity(INSTANT_ID, table.int, false, false, undefined)
    .defineError(TIMEOUT_ERROR_ID, message);
}

/**
 * The data-only rules. They differ in three decisions: whether the rule
 * rejects `unit`, the reserved Schema errors, and `unknown`.
 *
 * - "value": a value or an operation type. Accepts `unit` and the reserved
 *   Schema errors. Rejects `unknown`.
 * - "schema": a `Schema<...>` type. Rejects `unit`, the reserved Schema
 *   errors, and `unknown`.
 * - "entry": the type of a checked entry parameter. Accepts `unit` and
 *   `unknown`. Rejects the reserved Schema errors.
 */
type DataRule = "value" | "schema" | "entry";
export type TypeDecision = boolean;
export type LiteralValue = string | number | boolean | null;

/**
 * What each rule rejects. A `Record` over the closed union makes a new rule a
 * compile error until this table names its three decisions.
 */
const DATA_RULES: Readonly<
  Record<
    DataRule,
    {
      readonly unit: boolean;
      readonly reserved: boolean;
      readonly unknown: boolean;
    }
  >
> = {
  value: { unit: false, reserved: false, unknown: true },
  schema: { unit: true, reserved: true, unknown: true },
  entry: { unit: false, reserved: true, unknown: false },
};

/**
 * Whether `ref` is data only under `rule`. A type that already has a reported
 * error (`kind: "error"`) is data only when `acceptPoisoned` is true, so a
 * Schema derivation site does not report the same cause a second time.
 */
export function dataOnly(
  table: TypeTable,
  ref: TypeRef,
  rule: DataRule,
  acceptPoisoned: TypeDecision,
): TypeDecision {
  const rejects = DATA_RULES[rule];
  let seen = emptySet<TypeRef>();
  function visit(current: TypeRef): TypeDecision {
    const unfolded = table.unfold(current);
    if (seen.has(unfolded)) return true;
    seen = seen.add(unfolded);
    const type = table.node(unfolded);
    if (type.kind === "primitive") {
      return !(rejects.unknown && type.name === "unknown") &&
        !(rejects.unit && type.name === "unit");
    }
    if (type.kind === "literal") return true;
    if (type.kind === "record") {
      return type.fields.every((field) => visit(field.type));
    }
    if (type.kind === "array" || type.kind === "option") {
      return visit(type.element);
    }
    if (type.kind === "tuple") return type.elements.every(visit);
    if (type.kind === "union") return type.members.every(visit);
    if (type.kind === "named") {
      if (
        rejects.reserved &&
        isReservedErrorId(type.id)
      ) return false;
      const record = table.nominalBodyOf(type.id);
      return record !== undefined && visit(record);
    }
    if (type.kind === "error") return acceptPoisoned;
    if (
      type.kind === "retry-schedule" || type.kind === "ref" ||
      type.kind === "schema" || type.kind === "effect" ||
      type.kind === "stream" || type.kind === "sink" ||
      type.kind === "function" || type.kind === "provider"
    ) return false;
    const unreachable: never = type;
    return unreachable;
  }
  return visit(ref);
}

/** Unknown predicate inputs need entry validation instead of a static proof. */
export function containsUnknownPredicateInput(
  table: TypeTable,
  source: TypeRef,
  predicate: Predicate,
): TypeDecision {
  function unknownAt(
    ref: TypeRef,
    path: readonly string[],
    depth: number,
  ): TypeDecision {
    if (depth > MAX_DEPTH) return false;
    const node = table.node(table.unfold(ref));
    if (node.kind === "primitive" && node.name === "unknown") return true;
    if (node.kind === "union") {
      return node.members.some((member) => unknownAt(member, path, depth + 1));
    }
    if (path.length === 0 || node.kind !== "record") return false;
    const field = node.fields.find((field) => field.name === path[0]);
    return field !== undefined &&
      unknownAt(field.type, path.slice(1), depth + 1);
  }
  if (predicate.kind === "constant") return false;
  if (predicate.kind === "not") {
    return containsUnknownPredicateInput(table, source, predicate.operand);
  }
  if (predicate.kind === "and" || predicate.kind === "or") {
    return predicate.operands.some((operand) =>
      containsUnknownPredicateInput(table, source, operand)
    );
  }
  return [predicate.left, predicate.right].some((term) =>
    term.kind !== "zero" &&
    unknownAt(source, term.kind === "input" ? [] : term.path, 0)
  );
}

/**
 * Whether the type contains a function or deferred type at any depth: a value
 * without an encoded form, such as an Effect, a Stream, or a Ref. An alias
 * unfolds, and a repeated alias stops a cycle. A tagged record, an error, and a
 * type with identity stop the walk, because their own declarations are checked on their own.
 */
export function containsDeferredType(
  table: TypeTable,
  ref: TypeRef,
): TypeDecision {
  let seen = emptySet<TypeRef>();
  function visit(current: TypeRef): TypeDecision {
    if (seen.has(current)) return false;
    seen = seen.add(current);
    const type = table.node(current);
    if (
      type.kind === "function" || type.kind === "effect" ||
      type.kind === "stream" || type.kind === "sink" ||
      type.kind === "retry-schedule" || type.kind === "ref" ||
      type.kind === "schema" || type.kind === "provider"
    ) return true;
    if (type.kind === "named") {
      // A tagged record stops the walk: its own declaration is checked on its own.
      const alias = !isTypeId(type.id) || table.isErrorOrTagged(type.id)
        ? undefined
        : table.aliasOf(type.id);
      return alias !== undefined && visit(alias);
    }
    if (type.kind === "record") {
      return type.fields.some((field) => visit(field.type));
    }
    if (type.kind === "array" || type.kind === "option") {
      return visit(type.element);
    }
    if (type.kind === "tuple") return type.elements.some(visit);
    if (type.kind === "union") return type.members.some(visit);
    if (
      type.kind === "primitive" || type.kind === "literal" ||
      type.kind === "error"
    ) return false;
    const unreachable: never = type;
    return unreachable;
  }
  return visit(ref);
}

/**
 * Whether the type names an opaque type at any depth, which has no schema. An
 * alias unfolds, and a repeated alias stops a cycle. A tagged record, an error,
 * and a type with identity stop the walk, as in `containsDeferredType`. A function or
 * deferred type is `containsDeferredType`'s case, so it reports nothing here.
 */
export function containsOpaqueType(
  table: TypeTable,
  ref: TypeRef,
): TypeDecision {
  let seen = emptySet<TypeRef>();
  function visit(current: TypeRef): TypeDecision {
    if (seen.has(current)) return false;
    seen = seen.add(current);
    const type = table.node(current);
    if (type.kind === "named") {
      if (isErrorId(type.id)) return false;
      if (table.isOpaque(type.id)) return true;
      if (table.taggedRecordOf(type.id) !== undefined) return false;
      const alias = table.aliasOf(type.id);
      return alias !== undefined && visit(alias);
    }
    if (type.kind === "record") {
      return type.fields.some((field) => visit(field.type));
    }
    if (type.kind === "array" || type.kind === "option") {
      return visit(type.element);
    }
    if (type.kind === "tuple") return type.elements.some(visit);
    if (type.kind === "union") return type.members.some(visit);
    if (
      type.kind === "primitive" || type.kind === "literal" ||
      type.kind === "error" || type.kind === "retry-schedule" ||
      type.kind === "ref" || type.kind === "schema" ||
      type.kind === "effect" || type.kind === "stream" ||
      type.kind === "sink" || type.kind === "function" ||
      type.kind === "provider"
    ) return false;
    const unreachable: never = type;
    return unreachable;
  }
  return visit(ref);
}

/** True when a literal value is a member of a primitive: an `int` is a safe integer. */
export function literalFitsPrimitive(
  value: LiteralValue,
  name: PrimitiveName,
): TypeDecision {
  if (value === null) return false;
  if (typeof value === "string") return name === "string";
  if (typeof value === "boolean") return name === "boolean";
  return name === "number" ||
    (name === "int" && Number.isSafeInteger(value));
}

/** A pure function fits an effect target. An effect function does not fit a pure target. */
function executionFits(source: Execution, target: Execution): boolean {
  return source === target || (source === "pure" && target === "effect");
}
