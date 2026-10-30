// Interned types and type compatibility. Equal structural types share one
// integer id (a `TypeRef`), so type equality is id equality. Aliases keep their
// name: a `named` type points at the alias `TypeId`, and compatibility unfolds
// the alias on demand. Types with identity, tagged records, and errors are nominal by identity.
//
// Tables share interned storage and keep separate definition maps. The ids
// depend on the order of interning, so no output may depend on a raw id. The
// serialization functions below sort by canonical text, not by id.

import type {
  CapabilityId,
  ErrorId,
  Execution,
  Field,
  Type,
  TypeId,
} from "./ir.ts";
import {
  CLOSED_UNIT_IDS,
  DURATION_ID,
  INSTANT_ID,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "./ir.ts";
import { isErrorId, isTypeId, moduleOfId } from "./ids.ts";
import type { Predicate } from "./predicates.ts";
import { typeFromIr, typeToIr } from "./type_ir.ts";
import { canonicalJson, compareText, sortedUnique } from "./util.ts";

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

/** A single recursive data alias needs an array, optional key, or tagged terminal choice. */
export function guardedRecord(
  type: Type,
  id: TypeId,
  tagOf: (type: Type) => string | undefined,
): boolean {
  const containsSelf = (part: Type): boolean => {
    switch (part.kind) {
      case "named":
        return part.id === id;
      case "array":
      case "option":
      case "set":
        return containsSelf(part.element);
      case "map":
        return containsSelf(part.key) || containsSelf(part.value);
      case "record":
        return part.fields.some((field) => containsSelf(field.type));
      case "union":
        return part.members.some(containsSelf);
      case "primitive":
      case "literal":
      case "tuple":
      case "ref":
      case "closeable-scope":
      case "retry-schedule":
      case "codec":
      case "schema":
      case "fiber":
      case "effect":
      case "stream":
      case "schedule":
      case "sink":
      case "function":
      case "provider":
        return false;
      default: {
        const unreachable: never = part;
        return unreachable;
      }
    }
  };
  const tagged = type.kind === "union" && type.members.length >= 2 &&
    type.members.every((member) => member.kind === "record") &&
    type.members.some((member) => !containsSelf(member));
  const tagNames = tagged && type.kind === "union"
    ? (type.members[0] as Extract<Type, { kind: "record" }>).fields
      .filter((field) => !field.optional && tagOf(field.type) !== undefined)
      .map((field) => field.name)
    : [];
  const hasDistinctTag = type.kind === "union" && tagNames.some((name) => {
    const fields = type.members.map((member) =>
      member.kind === "record"
        ? member.fields.find((field) => field.name === name)
        : undefined
    );
    return fields.every((field) =>
      field !== undefined && !field.optional &&
      tagOf(field.type) !== undefined
    ) && new Set(fields.map((field) =>
          field === undefined ? undefined : tagOf(field.type)
        )).size === fields.length;
  });
  if (type.kind !== "record" && !(tagged && hasDistinctTag)) return false;
  let found = false;
  const visit = (part: Type, guarded: boolean): boolean => {
    switch (part.kind) {
      case "named":
        if (part.id !== id) return true;
        found = true;
        return guarded;
      case "array":
        return visit(part.element, true);
      case "record":
        return part.fields.every((field) =>
          visit(field.type, guarded || field.optional)
        );
      case "union":
        return (guarded || (part === type && tagged && hasDistinctTag)) &&
          part.members.every((member) => visit(member, true));
      case "primitive":
      case "literal":
        return true;
      case "tuple":
      case "option":
      case "map":
      case "set":
      case "ref":
      case "closeable-scope":
      case "retry-schedule":
      case "codec":
      case "schema":
      case "fiber":
      case "effect":
      case "stream":
      case "schedule":
      case "sink":
      case "function":
      case "provider":
        return false;
      default: {
        const unreachable: never = part;
        return unreachable;
      }
    }
  };
  return visit(type, false) && found;
}

/** The interned form. Records are sorted by field name, unions by ref. */
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
  | {
    readonly kind: "map";
    readonly key: TypeRef;
    readonly value: TypeRef;
  }
  | { readonly kind: "set"; readonly element: TypeRef }
  | { readonly kind: "closeable-scope" }
  | { readonly kind: "retry-schedule"; readonly error: TypeRef }
  | {
    readonly kind: "codec";
    readonly decoded: TypeRef;
    readonly encoded: TypeRef;
  }
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
    readonly kind: "fiber";
    readonly result: TypeRef;
    readonly failures: readonly ErrorId[];
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
    readonly kind: "schedule";
    readonly output: TypeRef;
    readonly input: TypeRef;
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

// ------------------------------------------------------------------ the table

/** What a graph of imported declarations supplies to the table. */
interface DefinitionSource {
  readonly types: readonly {
    readonly id: TypeId;
    readonly opaque?: boolean;
    readonly predicate?: Predicate;
    readonly definition:
      | { readonly kind: "alias"; readonly type: Type }
      | {
        readonly kind: "nominal";
        readonly base: Type;
        readonly tagged?: true;
        readonly sealed?: true;
      };
  }[];
  readonly errors: readonly {
    readonly id: ErrorId;
    readonly fields: readonly Field[];
  }[];
}

// The bound on the recursion of one comparison. The parser limits written
// nesting to 512 levels and `declaration/012` limits an alias to 128 levels.
// So one type is at most about 640 levels deep, and two types give at most
// about 1280 frames. 1536 leaves room above that.
export const MAX_DEPTH = 1536;

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

export class TypeTable {
  private readonly storage: TypeStorage;
  private readonly defs: Map<TypeId, AliasDef>;
  private readonly errorRecords: Map<ErrorId, TypeRef>;

  /** The recovery type. */
  readonly error: TypeRef;
  readonly string: TypeRef;
  readonly boolean: TypeRef;
  readonly int: TypeRef;
  readonly number: TypeRef;
  readonly unit: TypeRef;
  readonly never: TypeRef;
  readonly unknown: TypeRef;
  readonly closeableScope: TypeRef;

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
    this.closeableScope = this.intern({ kind: "closeable-scope" });
    if (state !== undefined) return;
    this.defineError(
      "error:effect/SchemaError",
      this.record([{ name: "message", type: this.string, optional: false }]),
    );
    this.defineError("error:effect/SchemaIssue", this.record([]));
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

  // -------------------------------------------------------------- interning

  /** The intern key of a node. Each kind has its own prefix, so keys of different kinds never collide. */
  private keyOf(node: TypeNode): string {
    switch (node.kind) {
      case "closeable-scope":
        return "closeable-scope";
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
      case "map":
        return `m:${node.key}:${node.value}`;
      case "set":
        return `s:${node.element}`;
      case "ref":
        return `q:${node.element}`;
      case "retry-schedule":
        return `z:${node.error}`;
      case "codec":
        return `c:${node.decoded}:${node.encoded}`;
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
      case "fiber":
        return `i:${node.result}:${JSON.stringify(node.failures)}`;
      case "effect":
        return `x:${
          JSON.stringify([node.result, node.failures, node.requirements])
        }`;
      case "stream":
        return `s:${
          JSON.stringify([node.element, node.failures, node.requirements])
        }`;
      case "schedule":
        return `d:${
          JSON.stringify([
            node.output,
            node.input,
            node.failures,
            node.requirements,
          ])
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

  map(key: TypeRef, value: TypeRef): TypeRef {
    return this.intern({ kind: "map", key, value });
  }

  set(element: TypeRef): TypeRef {
    return this.intern({ kind: "set", element });
  }

  ref(element: TypeRef): TypeRef {
    return this.intern({ kind: "ref", element });
  }

  retrySchedule(error: TypeRef): TypeRef {
    return this.intern({ kind: "retry-schedule", error });
  }

  codec(decoded: TypeRef, encoded: TypeRef): TypeRef {
    return this.intern({ kind: "codec", decoded, encoded });
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
          (this.isAssignable(makeInput, decoded) &&
            this.isAssignable(decoded, makeInput))
        ? {}
        : { makeInput }),
      ...(constructorDefault ? { constructorDefault: true as const } : {}),
    });
  }

  fiber(result: TypeRef, failures: readonly ErrorId[]): TypeRef {
    return this.intern({
      kind: "fiber",
      result,
      failures: sortedUnique(failures),
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

  schedule(
    output: TypeRef,
    input: TypeRef,
    failures: readonly ErrorId[],
    requirements: readonly CapabilityId[],
  ): TypeRef {
    return this.intern({
      kind: "schedule",
      output,
      input,
      failures: sortedUnique(failures),
      requirements: sortedUnique(requirements),
    });
  }

  scheduleInput(input: TypeRef): TypeRef {
    return this.record([
      { name: "input", type: input, optional: false },
      { name: "attempt", type: this.int, optional: false },
      ...["start", "now", "elapsed", "elapsedSincePrevious"].map((name) => ({
        name,
        type: name === "start" || name === "now"
          ? this.named(INSTANT_ID)
          : this.named(DURATION_ID),
        optional: false,
      })),
    ]);
  }

  scheduleMetadata(output: TypeRef, input: TypeRef): TypeRef {
    const base = this.node(this.scheduleInput(input));
    if (base.kind !== "record") throw new Error("invalid schedule input");
    return this.record([
      ...base.fields,
      { name: "output", type: output, optional: false },
      { name: "duration", type: this.named(DURATION_ID), optional: false },
    ]);
  }

  scheduleDecision(state: TypeRef, output: TypeRef): TypeRef {
    return this.union([
      this.record([
        { name: "kind", type: this.literal("Continue"), optional: false },
        { name: "state", type: state, optional: false },
        { name: "output", type: output, optional: false },
        { name: "delay", type: this.named(DURATION_ID), optional: false },
      ]),
      this.record([
        { name: "kind", type: this.literal("Done"), optional: false },
        { name: "output", type: output, optional: false },
      ]),
    ]);
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

  // -------------------------------------------------------------- definitions

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
    const visitAll = (refs: readonly TypeRef[]): TypeId | undefined => {
      for (const child of refs) {
        const found = visit(child);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const visit = (current: TypeRef): TypeId | undefined => {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const node = this.node(current);
      switch (node.kind) {
        case "named": {
          if (!isErrorId(node.id) && !this.ownsSealed(module, node.id)) {
            return node.id;
          }
          const target = isErrorId(node.id)
            ? this.errorRecords.get(node.id)
            : this.aliasOf(node.id);
          return target === undefined ? undefined : visit(target);
        }
        case "record":
          return visitAll(node.fields.map((field) => field.type));
        case "array":
        case "option":
        case "set":
        case "ref":
          return visit(node.element);
        case "map":
          return visitAll([node.key, node.value]);
        case "tuple":
          return visitAll(node.elements);
        case "union":
          return visitAll(node.members);
        case "retry-schedule":
          return visit(node.error);
        case "codec":
          return visitAll([node.decoded, node.encoded]);
        case "schema":
          return visitAll([
            node.decoded,
            node.encoded,
            ...(node.makeInput === undefined ? [] : [node.makeInput]),
          ]);
        case "fiber":
        case "effect":
          return visit(node.result);
        case "stream":
          return visit(node.element);
        case "schedule":
          return visitAll([node.output, node.input]);
        case "sink":
          return visitAll([node.input, node.result, node.leftover]);
        case "function":
          return visitAll([...node.parameters, node.result]);
        case "primitive":
        case "literal":
        case "closeable-scope":
        case "provider":
        case "error":
          return undefined;
        default: {
          const unreachable: never = node;
          return unreachable;
        }
      }
    };
    return visit(ref);
  }

  /** True when a type contains a sealed nominal type from another module. */
  containsForeignSealed(module: string, ref: TypeRef): boolean {
    return this.foreignSealedOf(module, ref) !== undefined;
  }

  /** Registers the field record of an error declaration. */
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

  /** True when a definition for the id exists. */
  isDefined(id: TypeId | ErrorId): boolean {
    return isErrorId(id) ? this.errorRecords.has(id) : this.defs.has(id);
  }

  /**
   * Registers the declarations of an imported module graph. A definition that
   * the table already has stays as it is.
   */
  load(source: DefinitionSource): void {
    // The table registers the declarations one at a time, so a tag alias may
    // come after the alias that uses it. The source lists all of them.
    const aliasTypes = new Map<string, Type>();
    for (const decl of source.types) {
      if (decl.definition.kind === "alias") {
        aliasTypes.set(decl.id, decl.definition.type);
      } else if (decl.definition.tagged !== true && decl.opaque !== true) {
        aliasTypes.set(decl.id, decl.definition.base);
      }
    }
    const tagOf = (type: Type): string | undefined => {
      const seen = new Set<string>();
      let current: Type | undefined = type;
      while (current !== undefined) {
        if (current.kind === "literal") {
          return typeof current.value === "string" ? current.value : undefined;
        }
        if (current.kind !== "named" || seen.has(current.id)) return undefined;
        seen.add(current.id);
        current = aliasTypes.get(current.id);
      }
      return undefined;
    };
    for (const decl of source.types) {
      if (this.isDefined(decl.id)) continue;
      if (decl.definition.kind === "alias") {
        this.defineAlias(
          decl.id,
          typeFromIr(this, decl.definition.type),
          guardedRecord(decl.definition.type, decl.id, tagOf),
        );
      } else if (decl.opaque === true) {
        this.defineOpaque(decl.id);
      } else {
        // A nominal type is an alias with identity. A tagged one is a tagged record.
        const body = typeFromIr(this, decl.definition.base);
        const sealed = decl.definition.sealed === true;
        if (decl.definition.tagged === true) {
          this.defineTagged(decl.id, body, sealed, decl.predicate);
        } else {
          this.defineIdentity(
            decl.id,
            body,
            sealed,
            guardedRecord(decl.definition.base, decl.id, tagOf),
            decl.predicate,
          );
        }
      }
    }
    for (const decl of source.errors) {
      if (this.isDefined(decl.id)) continue;
      this.defineError(
        decl.id,
        this.record(decl.fields.map((f) => ({
          name: f.name,
          type: typeFromIr(this, f.type),
          optional: f.optional,
        }))),
      );
    }
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
   * A switch over every node kind makes a new kind a compile error here.
   */
  private childRefs(node: TypeNode): readonly TypeRef[] {
    switch (node.kind) {
      case "named": {
        if (isErrorId(node.id)) return [];
        const def = this.defs.get(node.id);
        if (
          def === undefined || def.kind === "opaque" || def.kind === "tagged" ||
          def.guarded
        ) return [];
        return [def.body];
      }
      case "record":
        return node.fields.map((field) => field.type);
      case "array":
      case "option":
      case "set":
      case "ref":
      case "stream":
        return [node.element];
      case "map":
        return [node.key, node.value];
      case "tuple":
        return node.elements;
      case "union":
        return node.members;
      case "function":
        return [node.result, ...node.parameters];
      case "effect":
      case "fiber":
        return [node.result];
      case "retry-schedule":
        return [node.error];
      case "schema":
        return node.makeInput === undefined
          ? [node.decoded, node.encoded]
          : [node.makeInput, node.decoded, node.encoded];
      case "codec":
        return [node.decoded, node.encoded];
      case "schedule":
        return [node.output, node.input];
      case "sink":
        return [node.input, node.result, node.leftover];
      case "primitive":
      case "literal":
      case "provider":
      case "closeable-scope":
      case "error":
        return [];
      default: {
        const unreachable: never = node;
        return unreachable;
      }
    }
  }

  // -------------------------------------------------------------- compatibility

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
      case "closeable-scope":
        return sn.kind === "closeable-scope";
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
      case "set":
        return sn.kind === "set" &&
          nested(sn.element, tn.element);
      case "map":
        return sn.kind === "map" &&
          nested(sn.key, tn.key) &&
          nested(tn.key, sn.key) &&
          nested(sn.value, tn.value);
      case "ref":
        return sn.kind === "ref" &&
          nested(sn.element, tn.element) &&
          nested(tn.element, sn.element);
      case "retry-schedule":
        return sn.kind === "retry-schedule" &&
          nested(sn.error, tn.error) &&
          nested(tn.error, sn.error);
      case "codec":
        return sn.kind === "codec" &&
          nested(sn.decoded, tn.decoded) &&
          nested(tn.decoded, sn.decoded) &&
          nested(sn.encoded, tn.encoded) &&
          nested(tn.encoded, sn.encoded);
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
      case "fiber":
        return sn.kind === "fiber" &&
          nested(sn.result, tn.result) &&
          sameList(sn.failures, tn.failures);
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
      case "schedule":
        return sn.kind === "schedule" &&
          nested(sn.output, tn.output) &&
          (this.unfold(sn.input) === this.unknown ||
            nested(tn.input, sn.input)) &&
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
 * - "codec": a codec type. Accepts `unit` and rejects the reserved Schema
 *   errors, which have no compiler-derived schema.
 * - "schema": a `Schema<...>` type. Rejects `unit` and the reserved Schema
 *   errors.
 */
type DataRule = "value" | "codec" | "schema" | "entry";

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
  codec: { unit: false, reserved: true, unknown: true },
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
    case "set":
      return nested(type.element);
    case "map":
      return nested(type.key) && nested(type.value);
    case "tuple":
      return type.elements.every(nested);
    case "union":
      return type.members.every(nested);
    case "named": {
      if (
        rejects.reserved &&
        (type.id === SCHEMA_ERROR_ID || type.id === SCHEMA_ISSUE_ID ||
          type.id === TIMEOUT_ERROR_ID)
      ) return false;
      const record = isErrorId(type.id)
        ? table.errorRecordOf(type.id)
        : table.taggedRecordOf(type.id) ?? table.identityBaseOf(type.id);
      return record !== undefined && nested(record);
    }
    case "error":
      return acceptPoisoned;
    case "closeable-scope":
    case "retry-schedule":
    case "ref":
    case "codec":
    case "schema":
    case "fiber":
    case "effect":
    case "stream":
    case "schedule":
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
    case "fiber":
    case "stream":
    case "sink":
    case "schedule":
    case "retry-schedule":
    case "ref":
    case "codec":
    case "schema":
    case "provider":
    case "closeable-scope":
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
    case "set":
      return any([type.element]);
    case "map":
      return any([type.key, type.value]);
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
    case "set":
      return any([type.element]);
    case "map":
      return any([type.key, type.value]);
    case "tuple":
      return any(type.elements);
    case "union":
      return any(type.members);
    default:
      return false;
  }
}

function literalFitsPrimitive(
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
