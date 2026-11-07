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
  CLOSED_UNIT_IDS,
  DURATION_ID,
  INSTANT_ID,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "./ir.ts";
import { isErrorId, isReservedErrorId, isTypeId, moduleOfId } from "./ids.ts";
import type { Predicate } from "./predicates.ts";
import { typeToIr } from "./type_ir.ts";
import { canonicalJson } from "./content_id.ts";
import { compareText, sortedUnique } from "./util.ts";

declare const typeRefBrand: unique symbol;

/** An interned type. Equal structural types have equal refs. */
export type TypeRef = number & { readonly [typeRefBrand]: true };

export type SchemaPresence =
  | "required"
  | "optional"
  | "encoded-optional"
  | "decoded-optional";

interface SchemaOptions {
  readonly presence?: SchemaPresence;
  readonly makeInput?: TypeRef;
  /** Constructor defaults are independent of field presence. */
  readonly constructorDefault?: boolean;
}

type PrimitiveName =
  | "string"
  | "boolean"
  | "int"
  | "number"
  | "unit"
  | "never"
  | "unknown";

interface RecordField {
  readonly name: string;
  readonly type: TypeRef;
  readonly optional: boolean;
}

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

interface FunctionSpec {
  readonly execution: Execution;
  readonly parameters: readonly TypeRef[];
  readonly borrows?: readonly boolean[];
  readonly checked?: readonly boolean[];
  readonly result: TypeRef;
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
}

interface ProviderSpec {
  readonly provides: readonly CapabilityId[];
  readonly execution: Execution;
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
}

function isSubset(
  small: readonly string[],
  large: readonly string[],
): boolean {
  const set = new Set(large);
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
  const out: TypeRef[] = [];
  const visit = (current: TypeRef, depth: number): void => {
    const unfolded = unfold(current);
    const node = table.node(unfolded);
    if (node.kind === "union" && depth < MAX_DEPTH) {
      for (const member of node.members) visit(member, depth + 1);
    } else {
      out.push(unfolded);
    }
  };
  visit(ref, 0);
  return out;
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
  | "optionElementOf"
  | "isSealed"
  | "error"
  | "size"
>;

interface TypeStorage {
  readonly nodes: TypeNode[];
  readonly byKey: Map<string, TypeRef>;
  /** Canonical IR text depends on immutable nodes, not definitions. */
  readonly irKeys: Map<TypeRef, string>;
}

interface TypeTableState {
  readonly storage: TypeStorage;
  readonly defs: Map<TypeId, AliasDef>;
  readonly errorRecords: Map<ErrorId, TypeRef>;
}

/**
 * The children of each node kind except `named`, in visit order. The first
 * match of `foreignSealedOf` selects a diagnostic, so this order is observable.
 * A switch over every kind makes a new kind a compile error here.
 */
function structuralChildren(
  node: Exclude<TypeNode, { readonly kind: "named" }>,
): readonly TypeRef[] {
  switch (node.kind) {
    case "record":
      return node.fields.map((field) => field.type);
    case "array":
    case "option":
    case "ref":
    case "stream":
      return [node.element];
    case "tuple":
      return node.elements;
    case "union":
      return node.members;
    case "retry-schedule":
      return [node.error];
    case "schema":
      return node.makeInput === undefined
        ? [node.decoded, node.encoded]
        : [node.decoded, node.encoded, node.makeInput];
    case "effect":
      return [node.result];
    case "sink":
      return [node.input, node.result, node.leftover];
    case "function":
      return [...node.parameters, node.result];
    case "primitive":
    case "literal":
    case "provider":
    case "error":
      return [];
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

export class TypeTable {
  private readonly storage: TypeStorage;
  private readonly defs: Map<TypeId, AliasDef>;
  private readonly errorRecords: Map<ErrorId, TypeRef>;

  readonly error: TypeRef;
  readonly string: TypeRef;
  readonly boolean: TypeRef;
  readonly int: TypeRef;
  readonly number: TypeRef;
  readonly unit: TypeRef;
  readonly never: TypeRef;
  readonly unknown: TypeRef;

  constructor(state?: TypeTableState) {
    this.storage = state?.storage ?? {
      nodes: [],
      byKey: new Map(),
      irKeys: new Map(),
    };
    this.defs = state?.defs ?? new Map();
    this.errorRecords = state?.errorRecords ?? new Map();
    this.error = this.intern({ kind: "error" });
    this.string = this.primitive("string");
    this.boolean = this.primitive("boolean");
    this.int = this.primitive("int");
    this.number = this.primitive("number");
    this.unit = this.primitive("unit");
    this.never = this.primitive("never");
    this.unknown = this.primitive("unknown");
    if (state !== undefined) return;
    this.defineError(
      SCHEMA_ERROR_ID,
      this.record([{ name: "message", type: this.string, optional: false }]),
    );
    this.defineError(SCHEMA_ISSUE_ID, this.record([]));
    this.defineIdentity(DURATION_ID, this.int, false);
    this.defineIdentity(INSTANT_ID, this.int, false);
    this.defineError(
      TIMEOUT_ERROR_ID,
      this.record([{ name: "message", type: this.string, optional: false }]),
    );
  }

  /** Shares interned nodes and copies the definitions for independent writes. */
  fork(): TypeTable {
    return new TypeTable({
      storage: this.storage,
      defs: new Map(this.defs),
      errorRecords: new Map(this.errorRecords),
    });
  }

  /** Number of interned types across tables that share storage. */
  get size(): number {
    return this.storage.nodes.length;
  }

  node(ref: TypeRef): TypeNode {
    const node = this.storage.nodes[ref];
    if (node === undefined) throw new Error(`unknown type ref ${ref}`);
    return node;
  }

  /** The intern key of a node. Each kind has its own prefix, so keys of different kinds never collide. */
  private keyOf(node: TypeNode): string {
    switch (node.kind) {
      case "primitive":
        return `p:${node.name}`;
      case "literal":
        return `l:${JSON.stringify(node.value)}`;
      case "named":
        return `n:${node.id}`;
      case "record":
        return `r:${
          JSON.stringify(node.fields.map((f) => [f.name, f.optional, f.type]))
        }`;
      case "array":
        return `a:${node.element}`;
      case "tuple":
        return `t:${JSON.stringify(node.elements)}`;
      case "union":
        return `u:${JSON.stringify(node.members)}`;
      case "option":
        return `o:${node.element}`;
      case "ref":
        return `q:${node.element}`;
      case "retry-schedule":
        return `z:${node.error}`;
      case "schema":
        return `h:${
          JSON.stringify([
            node.decoded,
            node.encoded,
            node.decodeRequirements,
            node.encodeRequirements,
            node.presence === "optional",
            node.presence === "encoded-optional",
            node.presence === "decoded-optional",
            node.makeInput ?? node.decoded,
            node.constructorDefault === true,
          ])
        }`;
      case "effect":
        return `x:${
          JSON.stringify([node.result, node.failures, node.requirements])
        }`;
      case "stream":
        return `s:${
          JSON.stringify([node.element, node.failures, node.requirements])
        }`;
      case "sink":
        return `k:${
          JSON.stringify([
            node.input,
            node.result,
            node.leftover,
            node.failures,
            node.requirements,
          ])
        }`;
      case "function":
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
      case "provider":
        return `v:${
          JSON.stringify([
            node.provides,
            node.execution,
            node.failures,
            node.requirements,
          ])
        }`;
      case "error":
        return "e";
    }
  }

  /** Interns a node that is already in normal form. */
  private intern(node: TypeNode): TypeRef {
    const key = this.keyOf(node);
    const existing = this.storage.byKey.get(key);
    if (existing !== undefined) return existing;
    const ref = this.storage.nodes.length as TypeRef;
    this.storage.nodes.push(node);
    this.storage.byKey.set(key, ref);
    return ref;
  }

  primitive(name: PrimitiveName): TypeRef {
    return this.intern({ kind: "primitive", name });
  }

  literal(value: string | number | boolean | null): TypeRef {
    return this.intern({ kind: "literal", value });
  }

  named(id: TypeId | ErrorId): TypeRef {
    return this.intern({ kind: "named", id });
  }

  /** Sorts the fields by name. Duplicate names keep the first field. */
  record(fields: readonly RecordField[]): TypeRef {
    const seen = new Set<string>();
    const unique: RecordField[] = [];
    for (const field of fields) {
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      unique.push(field);
    }
    unique.sort((a, b) => compareText(a.name, b.name));
    return this.intern({ kind: "record", fields: unique });
  }

  array(element: TypeRef): TypeRef {
    return this.intern({ kind: "array", element });
  }

  tuple(elements: readonly TypeRef[]): TypeRef {
    return this.intern({ kind: "tuple", elements: [...elements] });
  }

  option(element: TypeRef): TypeRef {
    return this.intern({ kind: "option", element });
  }

  ref(element: TypeRef): TypeRef {
    return this.intern({ kind: "ref", element });
  }

  retrySchedule(error: TypeRef): TypeRef {
    return this.intern({ kind: "retry-schedule", error });
  }

  schema(
    decoded: TypeRef,
    encoded: TypeRef,
    decodeRequirements: readonly CapabilityId[],
    encodeRequirements: readonly CapabilityId[],
    options: SchemaOptions = {},
  ): TypeRef {
    const {
      presence = "required",
      makeInput = decoded,
      constructorDefault = false,
    } = options;
    return this.intern({
      kind: "schema",
      decoded,
      encoded,
      decodeRequirements: sortedUnique(decodeRequirements),
      encodeRequirements: sortedUnique(encodeRequirements),
      presence,
      ...(makeInput === decoded ||
          // The interned type serves every module, so the test needs no authority.
          (this.isAssignableIn(NO_MODULE, makeInput, decoded) &&
            this.isAssignableIn(NO_MODULE, decoded, makeInput))
        ? {}
        : { makeInput }),
      ...(constructorDefault ? { constructorDefault: true as const } : {}),
    });
  }

  effect(
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): TypeRef {
    return this.intern({
      kind: "effect",
      result,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  stream(
    element: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): TypeRef {
    return this.intern({
      kind: "stream",
      element,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  sink(
    input: TypeRef,
    result: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
    leftover: TypeRef = this.never,
  ): TypeRef {
    return this.intern({
      kind: "sink",
      input,
      result,
      leftover,
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
  union(members: readonly TypeRef[]): TypeRef {
    const flat = new Set<TypeRef>();
    for (const member of members) {
      const node = this.node(member);
      if (node.kind === "error") return this.error;
      if (node.kind === "union") {
        for (const inner of node.members) flat.add(inner);
      } else {
        flat.add(member);
      }
    }
    if (flat.size === 0) return this.never;
    const sorted = [...flat].sort((a, b) =>
      compareText(this.irKey(a), this.irKey(b)) || a - b
    );
    if (sorted.length === 1) return sorted[0];
    return this.intern({ kind: "union", members: sorted });
  }

  private irKey(ref: TypeRef): string {
    let key = this.storage.irKeys.get(ref);
    if (key === undefined) {
      key = canonicalJson(typeToIr(this, ref));
      this.storage.irKeys.set(ref, key);
    }
    return key;
  }

  /** Sorts and deduplicates the failure and requirement sets. */
  function(spec: FunctionSpec): TypeRef {
    return this.intern({
      kind: "function",
      execution: spec.execution,
      parameters: [...spec.parameters],
      ...(spec.borrows?.some(Boolean) ? { borrows: [...spec.borrows] } : {}),
      ...(spec.checked?.some(Boolean) ? { checked: [...spec.checked] } : {}),
      result: spec.result,
      failures: sortedUnique(spec.failures),
      requirements: sortedUnique(spec.requirements),
    });
  }

  provider(spec: ProviderSpec): TypeRef {
    return this.intern({
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
  defineAlias(id: TypeId, target: TypeRef, guarded = false): void {
    this.defs.set(id, { kind: "transparent", body: target, guarded });
  }

  /** Defines an alias with identity by name. A sealed identity needs the authority of its module. */
  defineIdentity(
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    guarded = false,
    predicate?: Predicate,
  ): void {
    this.defs.set(id, {
      kind: "identity",
      body,
      sealed,
      guarded,
      ...(predicate === undefined ? {} : { predicate }),
    });
  }

  /** Defines an identity record that carries a tag. */
  defineTagged(
    id: TypeId,
    body: TypeRef,
    sealed: boolean,
    predicate?: Predicate,
  ): void {
    this.defs.set(id, {
      kind: "tagged",
      body,
      sealed,
      ...(predicate === undefined ? {} : { predicate }),
    });
  }

  /** Defines an opaque type. It has no body and is never sealed. */
  defineOpaque(id: TypeId): void {
    this.defs.set(id, { kind: "opaque" });
  }

  /** The definition behind a named type, or undefined for an error or another node. */
  private defOf(node: TypeNode): AliasDef | undefined {
    return node.kind === "named" && !isErrorId(node.id)
      ? this.defs.get(node.id)
      : undefined;
  }

  /** True for an opaque type, an alias with identity, or a tagged record. */
  isIdentity(id: TypeId): boolean {
    const kind = this.defs.get(id)?.kind;
    return kind === "identity" || kind === "tagged" || kind === "opaque";
  }

  isOpaque(id: TypeId): boolean {
    return this.defs.get(id)?.kind === "opaque";
  }

  isSealed(id: TypeId): boolean {
    const def = this.defs.get(id);
    return (def?.kind === "identity" || def?.kind === "tagged") && def.sealed;
  }

  ownsSealed(module: string, id: TypeId): boolean {
    return !this.isSealed(id) || moduleOfId(id) === module;
  }

  /** The sealed nominal identity below aliases, if this type is one. */
  sealedRootOf(ref: TypeRef): TypeId | undefined {
    let current = ref;
    const seen = new Set<TypeRef>();
    while (!seen.has(current)) {
      seen.add(current);
      const node = this.node(current);
      if (node.kind !== "named" || isErrorId(node.id)) return undefined;
      if (this.isSealed(node.id)) return node.id;
      const alias = this.aliasOf(node.id);
      if (alias === undefined) return undefined;
      current = alias;
    }
    return undefined;
  }

  /** A foreign sealed nominal identity contained in this type, if one exists. */
  foreignSealedOf(module: string, ref: TypeRef): TypeId | undefined {
    const seen = new Set<TypeRef>();
    const visit = (current: TypeRef): TypeId | undefined => {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const node = this.node(current);
      if (node.kind === "named") {
        if (!isErrorId(node.id) && !this.ownsSealed(module, node.id)) {
          return node.id;
        }
        const target = isErrorId(node.id)
          ? this.errorRecords.get(node.id)
          : this.aliasOf(node.id);
        return target === undefined ? undefined : visit(target);
      }
      for (const child of structuralChildren(node)) {
        const found = visit(child);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return visit(ref);
  }

  /** True when a type contains a sealed nominal type from another module. */
  containsForeignSealed(module: string, ref: TypeRef): boolean {
    return this.foreignSealedOf(module, ref) !== undefined;
  }

  defineError(id: ErrorId, record: TypeRef): void {
    this.errorRecords.set(id, record);
  }

  aliasOf(id: TypeId): TypeRef | undefined {
    const def = this.defs.get(id);
    return def === undefined || def.kind === "opaque" ? undefined : def.body;
  }

  /** The base of an opaque type, or the body of an untagged identity. */
  identityBaseOf(id: TypeId): TypeRef | undefined {
    const def = this.defs.get(id);
    if (def?.kind === "opaque") return this.unknown;
    return def?.kind === "identity" ? def.body : undefined;
  }

  /** The body of a tagged record. */
  taggedRecordOf(id: TypeId): TypeRef | undefined {
    const def = this.defs.get(id);
    return def?.kind === "tagged" ? def.body : undefined;
  }

  /** The predicate of an identity or tagged record. */
  predicateOf(id: TypeId): Predicate | undefined {
    const def = this.defs.get(id);
    return def?.kind === "identity" || def?.kind === "tagged"
      ? def.predicate
      : undefined;
  }

  /** The id of the type when it is a named tagged record, otherwise undefined. */
  taggedIdOf(ref: TypeRef): TypeId | undefined {
    const node = this.node(ref);
    return node.kind === "named" && isTypeId(node.id) &&
        this.taggedRecordOf(node.id) !== undefined
      ? node.id
      : undefined;
  }

  errorRecordOf(id: ErrorId): TypeRef | undefined {
    return this.errorRecords.get(id);
  }

  /** True for a named error or a tagged record. An untagged identity, an opaque type, and an alias are not. */
  isErrorOrTagged(id: TypeId | ErrorId): boolean {
    return isErrorId(id) || this.taggedRecordOf(id) !== undefined;
  }

  /** The record body of a named error or a tagged record. Any other id has none. */
  recordBodyOf(id: TypeId | ErrorId): TypeRef | undefined {
    return isErrorId(id) ? this.errorRecordOf(id) : this.taggedRecordOf(id);
  }

  /** The record body, or the base of an untagged identity or an opaque type. An error has no base. */
  nominalBodyOf(id: TypeId | ErrorId): TypeRef | undefined {
    return isErrorId(id)
      ? this.errorRecordOf(id)
      : this.taggedRecordOf(id) ?? this.identityBaseOf(id);
  }

  /** The element type of an option type, or undefined when the type is no option or has several options. */
  optionElementOf(ref: TypeRef | undefined): TypeRef | undefined {
    if (ref === undefined) return undefined;
    const options = flattenUnion(this, ref, (r) => this.unfold(r)).map((m) =>
      this.node(m)
    ).filter((m) => m.kind === "option");
    const only = options.length === 1 ? options[0] : undefined;
    return only?.kind === "option" ? only.element : undefined;
  }

  isDefined(id: TypeId | ErrorId): boolean {
    return isErrorId(id) ? this.errorRecords.has(id) : this.defs.has(id);
  }

  /** Follows alias definitions until the type is not a defined alias. */
  unfold(ref: TypeRef): TypeRef {
    return this.follow(ref, false);
  }

  /** Follows transparent aliases and stops at an alias that has identity. */
  unfoldTransparent(ref: TypeRef): TypeRef {
    return this.follow(ref, true);
  }

  private follow(ref: TypeRef, stopAtIdentity: boolean): TypeRef {
    let current = ref;
    for (let steps = 0; steps <= this.defs.size; steps++) {
      const node = this.node(current);
      if (node.kind !== "named" || isErrorId(node.id)) return current;
      const def = this.defs.get(node.id);
      if (def === undefined || def.kind === "opaque") return current;
      if (stopAtIdentity && def.kind !== "transparent") return current;
      current = def.body;
    }
    return this.error;
  }

  /**
   * True when the type is deeper than `limit` levels. A leaf has depth 1. A
   * composite type has 1 plus the largest depth of its children. An alias name
   * has 1 plus the depth of its target, so the levels inside aliases count. The
   * `memo` holds exact depths of types that fit in the limit. A walk that goes
   * past the limit stops and memoizes nothing for the nodes it aborted. The
   * recursion has at most `limit + 1` frames.
   */
  exceedsDepth(
    ref: TypeRef,
    limit: number,
    memo: Map<TypeRef, number>,
  ): boolean {
    return this.heightWithin(ref, limit, memo) === Infinity;
  }

  /** The exact height of the type when it is at most `budget`, else `Infinity`. */
  private heightWithin(
    ref: TypeRef,
    budget: number,
    memo: Map<TypeRef, number>,
  ): number {
    const known = memo.get(ref);
    if (known !== undefined) return known <= budget ? known : Infinity;
    if (budget < 1) return Infinity;
    let tallest = 0;
    for (const child of this.childRefs(this.node(ref))) {
      const height = this.heightWithin(child, budget - 1, memo);
      if (height === Infinity) return Infinity;
      if (height > tallest) tallest = height;
    }
    const height = 1 + tallest;
    memo.set(ref, height);
    return height;
  }

  /**
   * The types that one level below `node` counts toward its height. An alias
   * name has its target as its child, unless the alias is guarded or undefined.
   */
  private childRefs(node: TypeNode): readonly TypeRef[] {
    if (node.kind !== "named") return structuralChildren(node);
    if (isErrorId(node.id)) return [];
    const def = this.defs.get(node.id);
    if (
      def === undefined || def.kind === "opaque" || def.kind === "tagged" ||
      def.guarded
    ) return [];
    return [def.body];
  }

  /** True when a value of type `source` may be used where `target` is expected. */
  isAssignable(source: TypeRef, target: TypeRef): boolean {
    return this.assignable(source, target, 0, true);
  }

  /** Compatibility in one source module. Sealed nominal widening needs this authority. */
  isAssignableIn(module: string, source: TypeRef, target: TypeRef): boolean {
    return this.assignable(source, target, 0, true, module);
  }

  /**
   * `lift` is true only at the top of a value position. There a pure function
   * may fit an effect function type, because the emitter wraps the value. A
   * function nested in a record, array, option, tuple, union, result, or
   * parameter cannot be wrapped, so its execution must match.
   */
  private assignable(
    s: TypeRef,
    t: TypeRef,
    depth: number,
    lift = false,
    module?: string,
    adopt = true,
  ): boolean {
    if (s === t) return true;
    if (depth > MAX_DEPTH) return false;
    const sn = this.node(s);
    const tn = this.node(t);
    // `adopt` is false for a value that has widened to the body of an identity:
    // it takes no other name at that level.
    const nested = (
      source: TypeRef,
      target: TypeRef,
      nestedLift = false,
      nestedAdopt = true,
    ) =>
      this.assignable(
        source,
        target,
        depth + 1,
        nestedLift,
        module,
        nestedAdopt,
      );
    const sd = this.defOf(sn);
    const td = this.defOf(tn);
    // Two different guarded records never fit each other. Equal ids have equal refs.
    if (guarded(sd) && guarded(td)) return false;
    if (sn.kind === "error" || tn.kind === "error") return true;
    if (sn.kind === "primitive" && sn.name === "never") return true;
    const owns = (id: TypeId | ErrorId) =>
      module === undefined || isErrorId(id) || this.ownsSealed(module, id);
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
      return adopt && sn.kind !== "named" && !CLOSED_UNIT_IDS.has(tn.id) &&
        td?.kind === "identity" &&
        td.predicate === undefined && owns(tn.id) &&
        nested(s, td.body, lift);
    }
    if (tn.kind === "union") {
      for (const member of tn.members) {
        if (nested(s, member, false, adopt)) return true;
      }
      return false;
    }
    switch (tn.kind) {
      case "primitive":
        if (sn.kind === "primitive") {
          return sn.name === tn.name ||
            (sn.name === "int" && tn.name === "number");
        }
        if (sn.kind === "literal") {
          return literalFitsPrimitive(sn.value, tn.name);
        }
        return false;
      case "literal":
        return sn.kind === "literal" && sn.value === tn.value;
      case "record":
        if (sn.kind !== "record") return false;
        if (sn.fields.length !== tn.fields.length) return false;
        for (let i = 0; i < sn.fields.length; i++) {
          const field = sn.fields[i];
          const other = tn.fields[i];
          if (
            field.name !== other.name || field.optional !== other.optional ||
            !nested(field.type, other.type)
          ) return false;
        }
        return true;
      case "array":
        return sn.kind === "array" &&
          nested(sn.element, tn.element);
      case "option":
        return sn.kind === "option" &&
          nested(sn.element, tn.element);
      case "ref":
        return sn.kind === "ref" &&
          nested(sn.element, tn.element) &&
          nested(tn.element, sn.element);
      case "retry-schedule":
        return sn.kind === "retry-schedule" &&
          nested(sn.error, tn.error) &&
          nested(tn.error, sn.error);
      case "schema":
        return sn.kind === "schema" &&
          sn.presence === tn.presence &&
          sn.constructorDefault === tn.constructorDefault &&
          nested(
            sn.makeInput ?? sn.decoded,
            tn.makeInput ?? tn.decoded,
          ) &&
          nested(
            tn.makeInput ?? tn.decoded,
            sn.makeInput ?? sn.decoded,
          ) &&
          nested(sn.decoded, tn.decoded) &&
          nested(tn.decoded, sn.decoded) &&
          nested(sn.encoded, tn.encoded) &&
          nested(tn.encoded, sn.encoded) &&
          isSubset(sn.decodeRequirements, tn.decodeRequirements) &&
          isSubset(sn.encodeRequirements, tn.encodeRequirements);
      case "effect":
        return sn.kind === "effect" &&
          nested(sn.result, tn.result) &&
          isSubset(sn.failures, tn.failures) &&
          isSubset(sn.requirements, tn.requirements);
      case "stream":
        return sn.kind === "stream" &&
          nested(sn.element, tn.element) &&
          isSubset(sn.failures, tn.failures) &&
          isSubset(sn.requirements, tn.requirements);
      case "sink":
        return sn.kind === "sink" &&
          nested(tn.input, sn.input) &&
          nested(sn.result, tn.result) &&
          nested(sn.leftover, tn.leftover) &&
          isSubset(sn.failures, tn.failures) &&
          isSubset(sn.requirements, tn.requirements);
      case "tuple":
        if (sn.kind !== "tuple" || sn.elements.length !== tn.elements.length) {
          return false;
        }
        for (let i = 0; i < sn.elements.length; i++) {
          if (!nested(sn.elements[i], tn.elements[i])) {
            return false;
          }
        }
        return true;
      case "function":
        if (sn.kind !== "function") return false;
        if (sn.parameters.length !== tn.parameters.length) return false;
        if (
          tn.borrows?.some((borrow, i) => borrow && sn.borrows?.[i] !== true)
        ) return false;
        if (
          tn.checked?.some((checked, i) => checked && sn.checked?.[i] !== true)
        ) return false;
        if (
          sn.execution !== tn.execution &&
          !(lift && executionFits(sn.execution, tn.execution))
        ) {
          return false;
        }
        if (!isSubset(sn.failures, tn.failures)) return false;
        if (!isSubset(sn.requirements, tn.requirements)) return false;
        if (!nested(sn.result, tn.result)) return false;
        for (let i = 0; i < tn.parameters.length; i++) {
          if (!nested(tn.parameters[i], sn.parameters[i])) {
            return false;
          }
        }
        return true;
      case "provider":
        return sn.kind === "provider" &&
          sameList(sn.provides, tn.provides) &&
          executionFits(sn.execution, tn.execution) &&
          isSubset(sn.failures, tn.failures) &&
          isSubset(sn.requirements, tn.requirements);
    }
  }
}

/**
 * The data-only rules. They differ in two decisions.
 *
 * - "value": a value or an operation type. Accepts `unit` and the reserved
 *   Schema errors.
 * - "schema": a `Schema<...>` type. Rejects `unit` and the reserved Schema
 *   errors.
 */
type DataRule = "value" | "schema" | "entry";

/**
 * What each rule rejects. A `Record` over the closed union makes a new rule a
 * compile error until this table names its two decisions.
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
  acceptPoisoned = false,
  seen = new Set<TypeRef>(),
): boolean {
  const unfolded = table.unfold(ref);
  if (seen.has(unfolded)) return true;
  seen.add(unfolded);
  const type = table.node(unfolded);
  const rejects = DATA_RULES[rule];
  const nested = (child: TypeRef): boolean =>
    dataOnly(table, child, rule, acceptPoisoned, seen);
  switch (type.kind) {
    case "primitive":
      return !(rejects.unknown && type.name === "unknown") &&
        !(rejects.unit && type.name === "unit");
    case "literal":
      return true;
    case "record":
      return type.fields.every((field) => nested(field.type));
    case "array":
    case "option":
      return nested(type.element);
    case "tuple":
      return type.elements.every(nested);
    case "union":
      return type.members.every(nested);
    case "named": {
      if (
        rejects.reserved &&
        isReservedErrorId(type.id)
      ) return false;
      const record = table.nominalBodyOf(type.id);
      return record !== undefined && nested(record);
    }
    case "error":
      return acceptPoisoned;
    case "retry-schedule":
    case "ref":
    case "schema":
    case "effect":
    case "stream":
    case "sink":
    case "function":
    case "provider":
      return false;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

/** Unknown predicate inputs need entry validation instead of a static proof. */
export function containsUnknownPredicateInput(
  table: TypeTable,
  source: TypeRef,
  predicate: Predicate,
): boolean {
  const unknownAt = (
    ref: TypeRef,
    path: readonly string[],
    depth = 0,
  ): boolean => {
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
  };
  switch (predicate.kind) {
    case "constant":
      return false;
    case "not":
      return containsUnknownPredicateInput(table, source, predicate.operand);
    case "and":
    case "or":
      return predicate.operands.some((operand) =>
        containsUnknownPredicateInput(table, source, operand)
      );
    case "difference":
      return [predicate.left, predicate.right].some((term) =>
        term.kind !== "zero" &&
        unknownAt(source, term.kind === "input" ? [] : term.path)
      );
  }
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
  seen = new Set<TypeRef>(),
): boolean {
  if (seen.has(ref)) return false;
  seen.add(ref);
  const type = table.node(ref);
  const any = (children: readonly TypeRef[]): boolean =>
    children.some((child) => containsDeferredType(table, child, seen));
  switch (type.kind) {
    case "function":
    case "effect":
    case "stream":
    case "sink":
    case "retry-schedule":
    case "ref":
    case "schema":
    case "provider":
      return true;
    case "named": {
      // A tagged record stops the walk: its own declaration is checked on its own.
      const alias =
        isErrorId(type.id) || table.taggedRecordOf(type.id) !== undefined
          ? undefined
          : table.aliasOf(type.id);
      return alias !== undefined && any([alias]);
    }
    case "record":
      return any(type.fields.map((f) => f.type));
    case "array":
    case "option":
      return any([type.element]);
    case "tuple":
      return any(type.elements);
    case "union":
      return any(type.members);
    case "primitive":
    case "literal":
    case "error":
      return false;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
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
  seen = new Set<TypeRef>(),
): boolean {
  if (seen.has(ref)) return false;
  seen.add(ref);
  const type = table.node(ref);
  const any = (children: readonly TypeRef[]): boolean =>
    children.some((child) => containsOpaqueType(table, child, seen));
  switch (type.kind) {
    case "named": {
      if (isErrorId(type.id)) return false;
      if (table.isOpaque(type.id)) return true;
      if (table.taggedRecordOf(type.id) !== undefined) return false;
      const alias = table.aliasOf(type.id);
      return alias !== undefined && any([alias]);
    }
    case "record":
      return any(type.fields.map((f) => f.type));
    case "array":
    case "option":
      return any([type.element]);
    case "tuple":
      return any(type.elements);
    case "union":
      return any(type.members);
    default:
      return false;
  }
}

/** True when a literal value is a member of a primitive: an `int` is a safe integer. */
export function literalFitsPrimitive(
  value: string | number | boolean | null,
  name: PrimitiveName,
): boolean {
  if (value === null) return false;
  switch (typeof value) {
    case "string":
      return name === "string";
    case "boolean":
      return name === "boolean";
    case "number":
      return name === "number" ||
        (name === "int" && Number.isSafeInteger(value));
  }
}

/** A pure function fits an effect target. An effect function does not fit a pure target. */
function executionFits(source: Execution, target: Execution): boolean {
  return source === target || (source === "pure" && target === "effect");
}
