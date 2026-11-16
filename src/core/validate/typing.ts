// Type compatibility for the validator. The rules come from the spec ("Data
// and types", "Execution order and mode", "Retry and providers") and from the
// lift rule in docs/language-rules.md. This file does not use the checker.
//
//   - A transparent alias unfolds structurally. An alias with identity, an opaque
//     type, and an error are nominal. Two different identities never mix. An
//     identity widens to its body, and an unnamed value fits an identity whose
//     body it fits. A sealed identity keeps both steps in its own module. A
//     comparison with `null` needs no sealed authority (`fitsNullComparison`).
//   - int fits number. A literal fits its primitive. never fits every type.
//   - A union fits a target when each member fits. A source fits a union
//     target when it fits one member.
//   - Records need equal field names and equal optional flags. Phase A has no
//     width subtyping. Field order does not matter.
//   - Arrays, options, and tuples are covariant.
//   - A function has contravariant parameters, a covariant result, and effect
//     sets that are subsets of the target sets. The execution modes must be
//     equal, except for the lift: a pure function fits an effect function type
//     only at the top of a value position.
//   - unknown is not a top type.

import type { ValidationFlag, ValidationText } from "./report.ts";
import { flagAt, isTrue } from "./guards.ts";
import { emptySet, indices } from "../runtime.ts";
import {
  DURATION_ID,
  type Execution,
  type Field,
  type FunctionType,
  INSTANT_ID,
  isClosedUnitId,
  type Type,
} from "../ir.ts";
import { isReservedError } from "./prelude.ts";
import { effectsFit, isSubset, sameSet, sortedUnique } from "./sets.ts";
import { MAX_DEPTH, typeChildren } from "./type_children.ts";
import type { Predicate, Term } from "../predicates.ts";

export type TypeEnv = {
  readonly module: string;
  /** Alias identity to the aliased type. */
  readonly aliases: ReadonlyMap<string, Type>;
  /** Identities of the aliases that have identity by name. */
  readonly identities: ReadonlySet<string>;
  /** Opaque type identity to the base type. */
  readonly opaqueBases: ReadonlyMap<string, Type>;
  /** Tagged record identity to its base record type. */
  readonly taggedRecords: ReadonlyMap<
    string,
    Extract<Type, { readonly kind: "record" }>
  >;
  /** Error identity to its fields. */
  readonly errors: ReadonlyMap<string, readonly Field[]>;
  /** Identities of opaque types. An opaque type does not widen to its base. */
  readonly opaque: ReadonlySet<string>;
  /** Identities of sealed types. */
  readonly sealed: ReadonlySet<string>;
  /** Identities whose values must satisfy a declared predicate. */
  readonly refined?: ReadonlySet<string>;
  readonly predicates?: ReadonlyMap<string, Predicate>;
};

export const INT: Type = { kind: "primitive", name: "int" };
export const NUMBER: Type = { kind: "primitive", name: "number" };
export const STRING: Type = { kind: "primitive", name: "string" };
export const BOOLEAN: Type = { kind: "primitive", name: "boolean" };
export const UNIT: Type = { kind: "primitive", name: "unit" };
export const NEVER: Type = { kind: "primitive", name: "never" };

export type TypeDepth = number;

export function isNever(type: Type): ValidationFlag {
  return type.kind === "primitive" && type.name === "never";
}

/** True when a nominal type is open or belongs to the module under validation. */
export function ownsSealed(env: TypeEnv, id: ValidationText): ValidationFlag {
  return !env.sealed.has(id) || id.startsWith(`type:${env.module}#`);
}

/** The base of an opaque type, or the body of an alias with identity. */
export function identityBody(
  env: TypeEnv,
  id: ValidationText,
): Type | undefined {
  return env.opaqueBases.get(id) ??
    (env.identities.has(id) ? env.aliases.get(id) : undefined);
}

/** The body of a named type: an alias, a tagged record, an opaque base, or error fields. */
function namedBody(env: TypeEnv, id: string): Type | undefined {
  const fields = env.errors.get(id);
  return env.aliases.get(id) ?? env.taggedRecords.get(id) ??
    env.opaqueBases.get(id) ??
    (fields === undefined ? undefined : { kind: "record", fields: fields });
}

/** Follows transparent aliases and stops at an alias with identity. */
function unfoldTransparent(env: TypeEnv, type: Type): Type {
  return follow(env, type, true);
}

/** Follows aliases until the type is not an alias. A type with identity or an error stays named. */
export function unfold(env: TypeEnv, type: Type): Type {
  return follow(env, type, false);
}

function follow(env: TypeEnv, type: Type, stopAtIdentity: boolean): Type {
  let current = type;
  for (const _index of indices(MAX_DEPTH)) {
    if (current.kind !== "named") return current;
    if (stopAtIdentity && env.identities.has(current.id)) return current;
    const alias = env.aliases.get(current.id);
    if (alias === undefined) return current;
    current = alias;
  }
  return current;
}

/**
 * The data-only rules. They differ in two decisions.
 *
 * - "value": a value or an operation type. Accepts `unit` and the reserved
 *   Schema errors.
 * - "schema": a `Schema<...>` type. Rejects `unit` and the reserved Schema
 *   errors.
 */
type DataRule = "value" | "schema";

/**
 * What each rule rejects. A `Record` over the closed union makes a new rule a
 * compile error until this table names its two decisions.
 */
const DATA_RULES: Readonly<
  Record<DataRule, { readonly unit: boolean; readonly reserved: boolean }>
> = {
  value: { unit: false, reserved: false },
  schema: { unit: true, reserved: true },
};

/** Whether `type` is data only under `rule`. A cycle through `seen` counts as data. */
export function dataOnly(
  env: TypeEnv,
  type: Type,
  rule: DataRule,
): ValidationFlag {
  return dataOnlySeen(env, type, rule, emptySet());
}

function dataOnlySeen(
  env: TypeEnv,
  type: Type,
  rule: DataRule,
  seen: Set<Type>,
): ValidationFlag {
  const value = unfold(env, type);
  if (seen.has(value)) return true;
  seen = seen.add(value);
  const rejects = DATA_RULES[rule];
  function nested(child: Type): boolean {
    return dataOnlySeen(env, child, rule, seen);
  }
  if (value.kind === "primitive") {
    return value.name !== "unknown" &&
      !(rejects.unit && value.name === "unit");
  }
  if (value.kind === "literal") return true;
  if (value.kind === "record") {
    return value.fields.every((field) => nested(field.type));
  }
  if (value.kind === "array") return nested(value.element);
  if (value.kind === "option") return nested(value.element);
  if (value.kind === "tuple") return value.elements.every(nested);
  if (value.kind === "union") return value.members.every(nested);
  if (value.kind !== "named") return false;
  if (rejects.reserved && isReservedError(value.id)) return false;
  const errorFields = env.errors.get(value.id);
  const base = env.taggedRecords.get(value.id) ??
    env.opaqueBases.get(value.id) ??
    (errorFields !== undefined
      ? { kind: "record" as const, fields: errorFields }
      : undefined);
  return base !== undefined && nested(base);
}

/** The members of a type after aliases unfold and unions flatten. */
export function members(env: TypeEnv, type: Type): readonly Type[] {
  return membersAtDepth(env, type, 0);
}

export function membersAtDepth(
  env: TypeEnv,
  type: Type,
  depth: TypeDepth,
): readonly Type[] {
  return flatten(env, type, depth, unfold);
}

/** As `members`, but an alias with identity stops the unfold. */
export function identityMembers(env: TypeEnv, type: Type): readonly Type[] {
  return identityMembersAtDepth(env, type, 0);
}

export function identityMembersAtDepth(
  env: TypeEnv,
  type: Type,
  depth: TypeDepth,
): readonly Type[] {
  return flatten(env, type, depth, unfoldTransparent);
}

function flatten(
  env: TypeEnv,
  type: Type,
  depth: number,
  step: (env: TypeEnv, type: Type) => Type,
): readonly Type[] {
  const unfolded = step(env, type);
  if (unfolded.kind === "union" && depth < MAX_DEPTH) {
    return unfolded.members.flatMap((member) =>
      flatten(env, member, depth + 1, step)
    );
  }
  return [unfolded];
}

function literalFits(
  value: string | number | boolean | null,
  name: string,
): boolean {
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

/** Each type fits the other: the position is invariant. */
function invariant(env: TypeEnv, a: Type, b: Type, depth: number): boolean {
  return assignable(env, a, b, false, depth + 1, true) &&
    assignable(env, b, a, false, depth + 1, true);
}

function assignable(
  env: TypeEnv,
  s: Type,
  t: Type,
  lift: boolean,
  depth: number,
  adopt: boolean,
): boolean {
  if (depth > MAX_DEPTH) return false;
  if (s.kind === "named" && t.kind === "named" && s.id === t.id) return true;
  // Preserve a recursive alias's identity before unfolding it into a union arm.
  if (
    s.kind === "named" && t.kind === "union" &&
    t.members.some((member) => member.kind === "named" && member.id === s.id)
  ) return true;
  if (
    s.kind === "named" && t.kind === "named" && s.id !== t.id &&
    guardedAlias(env, s.id) && guardedAlias(env, t.id)
  ) return false;
  if (s.kind === "primitive" && s.name === "never") return true;
  // A transparent alias unfolds. An alias with identity stays a name.
  if (s.kind === "named" && !env.identities.has(s.id)) {
    const alias = env.aliases.get(s.id);
    if (alias !== undefined) {
      return assignable(env, alias, t, lift, depth + 1, adopt);
    }
  }
  if (t.kind === "named" && !env.identities.has(t.id)) {
    const alias = env.aliases.get(t.id);
    if (alias !== undefined) {
      return assignable(env, s, alias, lift, depth + 1, adopt);
    }
  }
  // A union is not one value: each member keeps its name.
  if (s.kind === "union") {
    return s.members.every((member) =>
      assignable(env, member, t, false, depth + 1, adopt)
    );
  }
  // An identity widens to its body, and a tagged record to its record. It takes
  // no other name there. A sealed one needs its own module.
  if (s.kind === "named" && ownsSealed(env, s.id)) {
    const body = env.identities.has(s.id)
      ? env.aliases.get(s.id)
      : env.taggedRecords.get(s.id);
    if (
      body !== undefined && assignable(env, body, t, lift, depth + 1, false)
    ) return true;
  }
  // A named target takes only its own name, or an unnamed value through the
  // body of an untagged identity.
  if (t.kind === "named") {
    const body = env.identities.has(t.id) ? env.aliases.get(t.id) : undefined;
    // `Duration` and `Instant` are closed: an unnamed value never fits them.
    return adopt && !isTrue(env.refined?.has(t.id)) && s.kind !== "named" &&
      !isClosedUnitId(t.id) && body !== undefined &&
      ownsSealed(env, t.id) && assignable(env, s, body, lift, depth + 1, true);
  }
  if (t.kind === "union") {
    for (const member of t.members) {
      if (assignable(env, s, member, false, depth + 1, adopt)) return true;
    }
    return false;
  }
  if (t.kind === "primitive") {
    if (s.kind === "primitive") {
      return s.name === t.name || (s.name === "int" && t.name === "number");
    }
    if (s.kind === "literal") return literalFits(s.value, t.name);
    return false;
  }
  if (t.kind === "literal") return s.kind === "literal" && s.value === t.value;
  if (t.kind === "record") {
    if (s.kind !== "record") return false;
    if (s.fields.length !== t.fields.length) return false;
    for (const tf of t.fields) {
      const sf = s.fields.find((f) => f.name === tf.name);
      if (
        sf === undefined || sf.optional !== tf.optional ||
        !assignable(env, sf.type, tf.type, false, depth + 1, true)
      ) return false;
    }
    return true;
  }
  if (t.kind === "array") {
    return s.kind === "array" &&
      assignable(env, s.element, t.element, false, depth + 1, true);
  }
  if (t.kind === "option") {
    return s.kind === "option" &&
      assignable(env, s.element, t.element, false, depth + 1, true);
  }
  if (t.kind === "ref") {
    return s.kind === "ref" && invariant(env, s.element, t.element, depth);
  }
  if (t.kind === "retry-schedule") {
    return s.kind === "retry-schedule" &&
      invariant(env, s.error, t.error, depth);
  }
  if (t.kind === "schema") {
    return s.kind === "schema" && s.optionalKey === t.optionalKey &&
      s.encodedOptionalKey === t.encodedOptionalKey &&
      s.decodedOptionalKey === t.decodedOptionalKey &&
      s.constructorDefault === t.constructorDefault &&
      invariant(
        env,
        s.makeInput ?? s.decoded,
        t.makeInput ?? t.decoded,
        depth,
      ) &&
      invariant(env, s.decoded, t.decoded, depth) &&
      invariant(env, s.encoded, t.encoded, depth) &&
      isSubset(s.decodeRequirements, t.decodeRequirements) &&
      isSubset(s.encodeRequirements, t.encodeRequirements);
  }
  if (t.kind === "effect") {
    return s.kind === "effect" &&
      assignable(env, s.result, t.result, false, depth + 1, true) &&
      effectsFit(s.effects, t.effects);
  }
  if (t.kind === "stream") {
    return s.kind === "stream" &&
      assignable(env, s.element, t.element, false, depth + 1, true) &&
      effectsFit(s.effects, t.effects);
  }
  if (t.kind === "sink") {
    return s.kind === "sink" &&
      assignable(env, t.input, s.input, false, depth + 1, true) &&
      assignable(env, s.result, t.result, false, depth + 1, true) &&
      assignable(
        env,
        s.leftover ?? NEVER,
        t.leftover ?? NEVER,
        false,
        depth + 1,
        true,
      ) &&
      effectsFit(s.effects, t.effects);
  }
  if (t.kind === "tuple") {
    if (s.kind !== "tuple" || s.elements.length !== t.elements.length) {
      return false;
    }
    for (const i of indices(s.elements.length)) {
      if (
        !assignable(env, s.elements[i], t.elements[i], false, depth + 1, true)
      ) {
        return false;
      }
    }
    return true;
  }
  if (t.kind === "function") {
    if (s.kind !== "function") return false;
    if (s.parameters.length !== t.parameters.length) return false;
    const sourceBorrows = s.borrows;
    if (
      t.borrows?.some((borrow, i) => borrow && !flagAt(sourceBorrows, i))
    ) return false;
    const sourceChecked = s.checked;
    if (
      t.checked?.some((checked, i) => checked && !flagAt(sourceChecked, i))
    ) return false;
    if (
      s.execution !== t.execution &&
      !(lift && executionFits(s.execution, t.execution))
    ) return false;
    if (!effectsFit(s.effects, t.effects)) return false;
    if (!assignable(env, s.result, t.result, false, depth + 1, true)) {
      return false;
    }
    for (const i of indices(t.parameters.length)) {
      if (
        !assignable(
          env,
          t.parameters[i],
          s.parameters[i],
          false,
          depth + 1,
          true,
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return s.kind === "provider" && sameSet(s.provides, t.provides) &&
    executionFits(s.acquisition.execution, t.acquisition.execution) &&
    effectsFit(s.acquisition.effects, t.acquisition.effects);
}

function guardedAlias(env: TypeEnv, id: string): boolean {
  const alias = env.aliases.get(id);
  if (alias?.kind !== "record" && alias?.kind !== "union") return false;
  function visit(type: Type, guarded: boolean): boolean {
    if (type.kind === "named") return type.id === id && guarded;
    if (type.kind === "array") return visit(type.element, true);
    if (type.kind === "record") {
      return type.fields.some((field) =>
        visit(field.type, guarded || field.optional)
      );
    }
    if (type.kind === "union") {
      return type.members.some((member) => visit(member, true));
    }
    return false;
  }
  return visit(alias, false);
}

/** A value of type `source` fits a value position of type `target`. The lift applies at the top. */
export function fits(env: TypeEnv, source: Type, target: Type): ValidationFlag {
  return assignable(env, source, target, true, 0, true);
}

/**
 * A comparison reads the value, so it needs no sealed authority. The checker
 * has the same result through `isAssignable`.
 */
export function fitsNullComparison(
  env: TypeEnv,
  source: Type,
  target: Type,
): ValidationFlag {
  return fits({ ...env, sealed: emptySet() }, source, target);
}

/**
 * A checked entry accepts unknown values recursively. Every known shape and
 * identity still follows ordinary assignment rules.
 */
export function fitsCheckedInput(
  env: TypeEnv,
  source: Type,
  target: Type,
): ValidationFlag {
  return fitsCheckedInputAtDepth(env, source, target, 0);
}

export function fitsCheckedInputAtDepth(
  env: TypeEnv,
  source: Type,
  target: Type,
  depth: TypeDepth,
): ValidationFlag {
  if (depth > MAX_DEPTH) return false;
  if (fits(env, source, target)) return true;
  const s = unfoldTransparent(env, source);
  const t = unfoldTransparent(env, target);
  if (s.kind === "primitive" && s.name === "unknown") return true;
  if (s.kind === "union") {
    return s.members.every((member) =>
      fitsCheckedInputAtDepth(env, member, t, depth + 1)
    );
  }
  if (t.kind === "union") {
    return t.members.some((member) =>
      fitsCheckedInputAtDepth(env, s, member, depth + 1)
    );
  }
  if (t.kind === "named" && s.kind !== "named") {
    const base = identityBody(env, t.id);
    const predicate = env.predicates?.get(t.id);
    if (
      !ownsSealed(env, t.id) ||
      (isTrue(env.refined?.has(t.id)) &&
        (predicate === undefined ||
          !unknownPredicateInput(env, s, predicate))) ||
      env.taggedRecords.has(t.id)
    ) return false;
    return base !== undefined &&
      fitsCheckedInputAtDepth(env, s, base, depth + 1);
  }
  if (s.kind === "named" && t.kind !== "named") {
    if (!ownsSealed(env, s.id)) return false;
    const base = identityBody(env, s.id) ?? env.taggedRecords.get(s.id);
    return base !== undefined &&
      fitsCheckedInputAtDepth(env, base, t, depth + 1);
  }
  if (s.kind === "record" && t.kind === "record") {
    if (s.fields.length !== t.fields.length) return false;
    return t.fields.every((targetField) => {
      const sourceField = s.fields.find((field) =>
        field.name === targetField.name
      );
      return sourceField !== undefined &&
        sourceField.optional === targetField.optional &&
        fitsCheckedInputAtDepth(
          env,
          sourceField.type,
          targetField.type,
          depth + 1,
        );
    });
  }
  if (s.kind === "array" && t.kind === "array") {
    return fitsCheckedInputAtDepth(env, s.element, t.element, depth + 1);
  }
  if (s.kind === "option" && t.kind === "option") {
    return fitsCheckedInputAtDepth(env, s.element, t.element, depth + 1);
  }
  if (s.kind === "tuple" && t.kind === "tuple") {
    return s.elements.length === t.elements.length &&
      s.elements.every((element, index) =>
        fitsCheckedInputAtDepth(env, element, t.elements[index], depth + 1)
      );
  }
  return false;
}

/** True when a member on the path of `term` through `source` has the type unknown. */
function termReachesUnknown(env: TypeEnv, source: Type, term: Term): boolean {
  if (term.kind === "zero") return false;
  const path = term.kind === "input" ? [] : term.path;
  let candidates = [source];
  for (const index of indices(path.length + 1)) {
    const next: Type[] = [];
    for (
      const candidate of candidates.flatMap((type) => members(env, type))
    ) {
      const value = unfold(env, candidate);
      if (value.kind === "primitive" && value.name === "unknown") return true;
      if (index < path.length) {
        const field = fieldsOf(env, candidate)?.find((field) =>
          field.name === path[index]
        );
        if (field !== undefined) next[next.length] = field.type;
      }
    }
    candidates = next;
  }
  return false;
}

function unknownPredicateInput(
  env: TypeEnv,
  source: Type,
  predicate: Predicate,
): boolean {
  let pending = [predicate];
  let seen = emptySet<Predicate>();
  for (const _depth of indices(MAX_DEPTH + 1)) {
    const nextPredicates: Predicate[] = [];
    for (const current of pending) {
      if (seen.has(current)) continue;
      seen = seen.add(current);
      if (current.kind === "not") {
        nextPredicates[nextPredicates.length] = current.operand;
      } else if (current.kind === "and" || current.kind === "or") {
        for (const operand of current.operands) {
          nextPredicates[nextPredicates.length] = operand;
        }
      } else if (
        current.kind === "difference" &&
        [current.left, current.right].some((term) =>
          termReachesUnknown(env, source, term)
        )
      ) return true;
    }
    if (nextPredicates.length === 0) break;
    pending = nextPredicates;
  }
  return false;
}

/** True when the generated entry validator can derive a closed schema. */
export function entrySchemaDerivable(env: TypeEnv, type: Type): ValidationFlag {
  let seen = emptySet<string>();
  function visit(current: Type): boolean {
    if (current.kind === "named") {
      if (
        isReservedError(current.id) || env.opaque.has(current.id)
      ) return false;
      if (seen.has(current.id)) return true;
      seen = seen.add(current.id);
      const body = namedBody(env, current.id);
      return body !== undefined && visit(body);
    }
    if (current.kind === "primitive" || current.kind === "literal") return true;
    if (current.kind === "record") {
      return current.fields.every((field) => visit(field.type));
    }
    if (current.kind === "array" || current.kind === "option") {
      return visit(current.element);
    }
    if (current.kind === "tuple") return current.elements.every(visit);
    if (current.kind === "union") return current.members.every(visit);
    return false;
  }
  return visit(type);
}

/** The sorted names that a type holds, not looking into the body of an identity. */
function nameSignature(env: TypeEnv, type: Type): string {
  let names = emptySet<string>();
  let seen = emptySet<Type>();
  function visit(current: Type, depth: number): Set<string> {
    if (seen.has(current) || depth > MAX_DEPTH) return names;
    seen = seen.add(current);
    if (current.kind === "named") {
      const alias = env.identities.has(current.id)
        ? undefined
        : env.aliases.get(current.id);
      if (alias === undefined) names = names.add(current.id);
      else names = visit(alias, depth + 1);
      return names;
    }
    for (const child of typeChildren(current)) {
      names = visit(child.type, depth + 1);
    }
    return names;
  }
  names = visit(type, 0);
  return sortedUnique([...names]).join(",");
}

/**
 * Each type fits the other, with no lift, and both hold the same names. This is
 * type equality up to transparent aliases and union order. `int` and an
 * identity over `int` fit each other, but they are not the same type.
 */
export function same(env: TypeEnv, a: Type, b: Type): ValidationFlag {
  return assignable(env, a, b, false, 0, true) &&
    assignable(env, b, a, false, 0, true) &&
    nameSignature(env, a) === nameSignature(env, b);
}

/** A union of the given types without duplicates. One type stands for itself. */
export function unionOf(env: TypeEnv, types: readonly Type[]): Type {
  const kept: Type[] = [];
  for (const type of types) {
    if (!kept.some((k) => same(env, k, type))) kept[kept.length] = type;
  }
  if (kept.length === 0) return NEVER;
  return kept.length === 1 ? kept[0] : { kind: "union", members: kept };
}

/** The fields of a record type, or of a named error or data type. */
export function fieldsOf(
  env: TypeEnv,
  type: Type,
): readonly Field[] | undefined {
  const unfolded = unfold(env, type);
  if (unfolded.kind === "record") return unfolded.fields;
  if (unfolded.kind === "named") {
    const error = env.errors.get(unfolded.id);
    if (error !== undefined) return error;
    return env.taggedRecords.get(unfolded.id)?.fields;
  }
  return undefined;
}

/** The sealed nominal identity below aliases, if this type is one. */
export function sealedRootOf(
  env: TypeEnv,
  type: Type,
): ValidationText | undefined {
  let current = type;
  let seen = emptySet<Type>();
  for (const _index of indices(MAX_DEPTH + 1)) {
    if (seen.has(current)) break;
    seen = seen.add(current);
    if (current.kind !== "named") return undefined;
    if (env.sealed.has(current.id)) return current.id;
    const alias = env.aliases.get(current.id);
    if (alias === undefined) return undefined;
    current = alias;
  }
  return undefined;
}

/** A foreign sealed nominal identity contained in this type, if one exists. */
export function foreignSealedOf(
  env: TypeEnv,
  type: Type,
): ValidationText | undefined {
  let seen = emptySet<Type>();
  function visit(current: Type): string | undefined {
    if (seen.has(current)) return undefined;
    seen = seen.add(current);
    if (current.kind === "named") {
      if (!ownsSealed(env, current.id)) return current.id;
      const target = namedBody(env, current.id);
      return target === undefined ? undefined : visit(target);
    }
    for (const child of typeChildren(current)) {
      const found = visit(child.type);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return visit(type);
}

export function asFunction(env: TypeEnv, type: Type): FunctionType | undefined {
  const unfolded = unfold(env, type);
  return unfolded.kind === "function" ? unfolded : undefined;
}

/** True when the type, or a type that it contains, is a refined type. */
export function containsRefinement(
  env: TypeEnv,
  type: Type,
): ValidationFlag {
  return containsRefinementSeen(env, type, emptySet());
}

function containsRefinementSeen(
  env: TypeEnv,
  type: Type,
  seen: Set<Type>,
): ValidationFlag {
  if (seen.has(type)) return false;
  seen = seen.add(type);
  if (type.kind === "named") {
    if (env.refined?.has(type.id)) return true;
    const fields = env.errors.get(type.id);
    const body = env.aliases.get(type.id) ?? env.opaqueBases.get(type.id) ??
      env.taggedRecords.get(type.id);
    return body !== undefined
      ? containsRefinementSeen(env, body, seen)
      : isTrue(
        fields?.some((field) => containsRefinementSeen(env, field.type, seen)),
      );
  }
  return typeChildren(type).some((child) =>
    containsRefinementSeen(env, child.type, seen)
  );
}

/** True when a structural input contains an unknown component. */
export function containsUnknown(
  env: TypeEnv,
  type: Type,
): ValidationFlag {
  return containsUnknownSeen(env, type, emptySet());
}

function containsUnknownSeen(
  env: TypeEnv,
  type: Type,
  seen: Set<Type>,
): ValidationFlag {
  const current = unfoldTransparent(env, type);
  if (seen.has(current)) return false;
  seen = seen.add(current);
  if (current.kind === "primitive") return current.name === "unknown";
  if (current.kind === "named" && ownsSealed(env, current.id)) {
    const body = identityBody(env, current.id) ??
      env.taggedRecords.get(current.id);
    return body !== undefined && containsUnknownSeen(env, body, seen);
  }
  return typeChildren(current).some((child) =>
    containsUnknownSeen(env, child.type, seen)
  );
}

export function isBooleanLike(env: TypeEnv, type: Type): ValidationFlag {
  return fits(env, type, BOOLEAN) && !isNever(type);
}

/** True when the type, after transparent aliases, is `Duration`. */
export function isDurationType(env: TypeEnv, type: Type): ValidationFlag {
  const unfolded = unfoldTransparent(env, type);
  return unfolded.kind === "named" && unfolded.id === DURATION_ID;
}

/** A closed unit type compares only with a value of the same closed unit type. */
export function closedUnitsDiffer(
  l: ValidationText | undefined,
  r: ValidationText | undefined,
): ValidationFlag {
  function closed(cls: string | undefined): boolean {
    return cls !== undefined && cls.startsWith(IDENTITY_CLASS) &&
      isClosedUnitId(cls.slice(IDENTITY_CLASS.length));
  }
  return (closed(l) || closed(r)) && l !== r;
}

export function isInstantType(env: TypeEnv, type: Type): ValidationFlag {
  const unfolded = unfoldTransparent(env, type);
  return unfolded.kind === "named" && unfolded.id === INSTANT_ID;
}

/**
 * The identity type when the type, after transparent aliases, is an identity
 * over `int` or `number`. An identity over a literal union is not numeric.
 */
export function numericIdentityOf(env: TypeEnv, type: Type): Type | undefined {
  const unfolded = unfoldTransparent(env, type);
  if (unfolded.kind !== "named") return undefined;
  const base = identityBody(env, unfolded.id);
  if (base === undefined) return undefined;
  const baseType = unfold(env, base);
  return baseType.kind === "primitive" &&
      (baseType.name === "int" || baseType.name === "number")
    ? unfolded
    : undefined;
}

/**
 * The comparison class of a type for `===` and `!==`: a primitive class, or a
 * primitive identity. Every member of a union must have the same class.
 */
export function comparisonClass(
  env: TypeEnv,
  type: Type,
): ValidationText | undefined {
  return comparisonClassAtDepth(env, type, 0);
}

export function comparisonClassAtDepth(
  env: TypeEnv,
  type: Type,
  depth: TypeDepth,
): ValidationText | undefined {
  if (depth > MAX_DEPTH) return undefined;
  let found: string | undefined;
  for (const member of identityMembers(env, type)) {
    let current: string | undefined;
    if (member.kind === "literal") {
      current = member.value === null ? "null" : typeof member.value;
    } else if (member.kind === "primitive") {
      if (member.name === "int" || member.name === "number") current = "number";
      else if (member.name === "string" || member.name === "boolean") {
        current = member.name;
      }
    } else if (member.kind === "named") {
      const base = identityBody(env, member.id);
      if (
        base !== undefined &&
        comparisonClassAtDepth(env, base, depth + 1) !== undefined
      ) {
        current = `${IDENTITY_CLASS}${member.id}`;
      }
    }
    if (current === undefined) return undefined;
    if (found !== undefined && found !== current) return undefined;
    found = current;
  }
  return found;
}

const IDENTITY_CLASS = "identity:";

/** The class of the body of an identity class, or undefined for another class. */
function baseClass(env: TypeEnv, cls: string): string | undefined {
  if (!cls.startsWith(IDENTITY_CLASS)) return undefined;
  const base = identityBody(env, cls.slice(IDENTITY_CLASS.length));
  return base === undefined ? undefined : comparisonClass(env, base);
}

/** The class and the classes of its bases, as far as widening reaches. */
function classChain(env: TypeEnv, cls: string): readonly string[] {
  const chain = [cls];
  let next = baseClass(env, cls);
  for (const _index of indices(MAX_DEPTH + 1)) {
    if (next === undefined) break;
    if (chain.includes(next)) break;
    chain[chain.length] = next;
    next = baseClass(env, next);
  }
  return chain;
}

/** Two classes are compatible when one widens to the other. */
export function compatibleClasses(
  env: TypeEnv,
  l: ValidationText,
  r: ValidationText,
): ValidationFlag {
  return classChain(env, l).includes(r) || classChain(env, r).includes(l);
}

/** True when the class widens to `number`. */
export function isNumericClass(
  env: TypeEnv,
  cls: ValidationText,
): ValidationFlag {
  return classChain(env, cls).includes("number");
}

export function isStringClass(
  env: TypeEnv,
  cls: ValidationText,
): ValidationFlag {
  return classChain(env, cls).includes("string");
}

/** The members of an identity set, or `never` for the empty set. */
function orNever(items: readonly string[]): string {
  return items.join(" | ") || "never";
}

/** A readable form for messages. */
export function show(type: Type): ValidationText {
  if (type.kind === "primitive") {
    return type.name === "unit" ? "void" : type.name;
  }
  if (type.kind === "literal") return JSON.stringify(type.value);
  if (type.kind === "named") {
    return isClosedUnitId(type.id)
      ? type.id.slice(type.id.indexOf("/") + 1)
      : type.id;
  }
  if (type.kind === "record") {
    if (type.fields.length === 0) return "{}";
    return `{ ${
      type.fields.map((f) =>
        `${f.name}${f.optional ? "?" : ""}: ${show(f.type)}`
      ).join(", ")
    } }`;
  }
  if (type.kind === "array") {
    const inner = show(type.element);
    return type.element.kind === "union" || type.element.kind === "function"
      ? `(${inner})[]`
      : `${inner}[]`;
  }
  if (type.kind === "tuple") return `[${type.elements.map(show).join(", ")}]`;
  if (type.kind === "union") return type.members.map(show).join(" | ");
  if (type.kind === "option") return `Option<${show(type.element)}>`;
  if (type.kind === "ref") return `Ref<${show(type.element)}>`;
  if (type.kind === "retry-schedule") {
    return `RetrySchedule<${show(type.error)}>`;
  }
  if (type.kind === "schema") {
    let name = "Schema";
    if (isTrue(type.optionalKey)) name = "SchemaOptional";
    else if (isTrue(type.encodedOptionalKey)) name = "SchemaEncodedOptional";
    else if (isTrue(type.decodedOptionalKey)) name = "SchemaDecodedOptional";
    return `${name}${
      isTrue(type.constructorDefault) ? "ConstructorDefault" : ""
    }<${show(type.decoded)}, ${show(type.encoded)}, ${
      orNever(type.decodeRequirements)
    }, ${orNever(type.encodeRequirements)}${
      type.makeInput === undefined ? "" : `, ${show(type.makeInput)}`
    }>`;
  }
  if (type.kind === "effect") {
    return `Effect<${show(type.result)}, ${orNever(type.effects.failures)}, ${
      orNever(type.effects.requirements)
    }>`;
  }
  if (type.kind === "stream") {
    return `Stream<${show(type.element)}, ${orNever(type.effects.failures)}, ${
      orNever(type.effects.requirements)
    }>`;
  }
  if (type.kind === "sink") {
    return `Sink<${show(type.input)}, ${show(type.result)}, ${
      orNever(type.effects.failures)
    }, ${orNever(type.effects.requirements)}${
      type.leftover === undefined ? "" : `, ${show(type.leftover)}`
    }>`;
  }
  if (type.kind === "function") {
    const fails = type.effects.failures.length === 0
      ? ""
      : ` fails ${type.effects.failures.join(" | ")}`;
    const withText = type.effects.requirements.length === 0
      ? ""
      : ` with ${type.effects.requirements.join(" | ")}`;
    return `(${type.parameters.map(show).join(", ")}) => ${
      show(type.result)
    }${fails}${withText} [${type.execution}]`;
  }
  return `provider provides ${
    type.provides.join(" | ")
  } [${type.acquisition.execution}]`;
}
