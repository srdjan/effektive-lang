// Rule 11: a recursive data alias needs a guard that ends the recursion.

import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import type { Type, TypeId } from "./ir.ts";
import { referencedIds } from "./referenced_ids.ts";

/**
 * The string tag that a field type reaches: an inline string literal, or a
 * name that reaches one through literal aliases. `aliasOf` gives the IR type
 * that an id stands for, or undefined when the id is not an alias. A repeated
 * name stops an alias cycle.
 */
export function literalTagOf(
  type: Type,
  aliasOf: (id: string) => Type | undefined,
): string | undefined {
  const seen = new Set<string>();
  let current: Type | undefined = type;
  while (current !== undefined) {
    if (current.kind === "literal") {
      return typeof current.value === "string" ? current.value : undefined;
    }
    if (current.kind !== "named" || seen.has(current.id)) return undefined;
    seen.add(current.id);
    current = aliasOf(current.id);
  }
  return undefined;
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
        return containsSelf(part.element);
      case "record":
        return part.fields.some((field) => containsSelf(field.type));
      case "union":
        return part.members.some(containsSelf);
      case "primitive":
      case "literal":
      case "tuple":
      case "ref":
      case "retry-schedule":
      case "schema":
      case "effect":
      case "stream":
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
      case "ref":
      case "retry-schedule":
      case "schema":
      case "effect":
      case "stream":
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

/**
 * Rule 11 for one group of tagged records and aliases that refer to each other.
 * `roots[n]` lists the IR types of member `n`: the record of a tagged record, or
 * the target of an alias. The group is guarded when no cycle is made of aliases
 * alone, and no cycle is made of references that avoid an `Option`, an array,
 * an optional field, and a union with a member outside the group.
 */
export function recursionIsGuarded(
  members: readonly { readonly id: string; readonly tagged: boolean }[],
  roots: readonly (readonly Type[])[],
): boolean {
  const index = new Map(members.map((m, n) => [m.id, n]));
  const inGroup = (type: Type): boolean => {
    const ids = new Set<string>();
    referencedIds(type, ids);
    return [...ids].some((id) => index.has(id));
  };
  // The edges of a member, and whether a path with no guard reaches the target.
  const edges = roots.map((types) => {
    const found = new Map<number, boolean>();
    const reach = (id: string, guarded: boolean): void => {
      const target = index.get(id);
      if (target !== undefined) {
        found.set(target, (found.get(target) ?? false) || !guarded);
      }
    };
    const visit = (type: Type, guarded: boolean): void => {
      switch (type.kind) {
        case "named":
          reach(type.id, guarded);
          return;
        case "option":
        case "array":
          visit(type.element, true);
          return;
        case "union": {
          const outside = type.members.some((m) => !inGroup(m));
          for (const member of type.members) visit(member, guarded || outside);
          return;
        }
        case "record":
          // A value can leave out an optional field, so the field ends the recursion.
          for (const field of type.fields) {
            visit(field.type, guarded || field.optional);
          }
          return;
        case "tuple":
          for (const element of type.elements) visit(element, guarded);
          return;
        default: {
          const ids = new Set<string>();
          referencedIds(type, ids);
          for (const id of ids) reach(id, guarded);
        }
      }
    };
    for (const type of types) visit(type, false);
    return found;
  });
  const cyclic = (
    keep: (from: number, to: number, bare: boolean) => boolean,
  ) => {
    const graph = edges.map((targets, from) =>
      [...targets].filter(([to, bare]) => keep(from, to, bare)).map(([to]) =>
        to
      )
    );
    return stronglyConnectedComponents(members.length, graph).some((c) =>
      isCycle(c, graph)
    );
  };
  return !cyclic((from, to) => !members[from].tagged && !members[to].tagged) &&
    !cyclic((_from, _to, bare) => bare);
}
