import {
  emptyMap,
  emptySet,
  mapFrom,
  setFrom,
  stackValues,
} from "./runtime.ts";
// Rule 11: a recursive data alias needs a guard that ends the recursion.
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import { isDeferredKind, type Type, type TypeId } from "./ir.ts";
import { referencedIds } from "./referenced_ids.ts";
type TagText = string;
type Guarded = boolean;

/**
 * The string tag that a field type reaches: an inline string literal, or a
 * name that reaches one through literal aliases. `aliasOf` gives the IR type
 * that an id stands for, or undefined when the id is not an alias. A repeated
 * name stops an alias cycle.
 */
export function literalTagOf(
  type: Type,
  aliasOf: (id: string) => Type | undefined,
): TagText | undefined {
  let seen = emptySet<string>();
  const pending: Type[] = [type];
  for (const current of stackValues(pending)) {
    if (current.kind === "literal") {
      return typeof current.value === "string" ? current.value : undefined;
    }
    if (current.kind !== "named" || seen.has(current.id)) {
      return undefined;
    }
    seen = seen.add(current.id);
    const next = aliasOf(current.id);
    if (next !== undefined) pending[pending.length] = next;
  }
  return undefined;
}
/** Whether a type names the id at any depth, not through a tuple or a function. */
export function containsNamed(part: Type, id: TypeId): Guarded {
  if (part.kind === "named") return part.id === id;
  if (part.kind === "array" || part.kind === "option") {
    return containsNamed(part.element, id);
  }
  if (part.kind === "record") {
    return part.fields.some((field) => containsNamed(field.type, id));
  }
  if (part.kind === "union") {
    return part.members.some((member) => containsNamed(member, id));
  }
  if (
    part.kind === "primitive" || part.kind === "literal" ||
    part.kind === "tuple" || isDeferredKind(part)
  ) {
    return false;
  }
  const unreachable: never = part;
  return unreachable;
}
/** A single recursive data alias needs an array, optional key, or tagged terminal choice. */
export function guardedRecord(
  type: Type,
  id: TypeId,
  tagOf: (type: Type) => string | undefined,
): Guarded {
  const members = type.kind === "union" ? type.members : [];
  const records = members.filter((member) => member.kind === "record");
  const tagged = records.length >= 2 && records.length === members.length &&
    records.some((member) => !containsNamed(member, id));
  const hasDistinctTag = tagged && records[0].fields.some((first) => {
    const fields = records.map((member) =>
      member.fields.find((field) => field.name === first.name)
    );
    return fields.every((field) =>
      field !== undefined && !field.optional &&
      tagOf(field.type) !== undefined
    ) && setFrom(fields.map((field) =>
          field === undefined ? undefined : tagOf(field.type)
        )).size === fields.length;
  });
  if (type.kind !== "record" && !hasDistinctTag) {
    return false;
  }
  let found = false;
  function visit(part: Type, guarded: boolean): boolean {
    if (part.kind === "named") {
      if (part.id !== id) return true;
      found = true;
      return guarded;
    }
    if (part.kind === "array") return visit(part.element, true);
    if (part.kind === "record") {
      return part.fields.every((field) =>
        visit(field.type, guarded || field.optional)
      );
    }
    if (part.kind === "union") {
      return (guarded || (part === type && hasDistinctTag)) &&
        part.members.every((member) => visit(member, true));
    }
    if (part.kind === "primitive" || part.kind === "literal") return true;
    if (
      part.kind === "tuple" || part.kind === "option" ||
      isDeferredKind(part)
    ) {
      return false;
    }
    const unreachable: never = part;
    return unreachable;
  }
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
  members: readonly {
    readonly id: string;
    readonly tagged: boolean;
  }[],
  roots: readonly (readonly Type[])[],
): Guarded {
  const index = mapFrom(members.map((m, n) => [m.id, n]));
  function inGroup(type: Type): boolean {
    const ids = referencedIds(type, emptySet<string>());
    return [...ids].some((id) => index.has(id));
  }
  // The edges of a member, and whether a path with no guard reaches the target.
  const edges = roots.map((types) => {
    let found = emptyMap<number, boolean>();
    function reach(id: string, guarded: boolean): Map<number, boolean> {
      const target = index.get(id);
      if (target !== undefined) {
        found = found.set(target, (found.get(target) ?? false) || !guarded);
      }
      return found;
    }
    function visit(type: Type, guarded: boolean): Map<number, boolean> {
      if (type.kind === "named") return reach(type.id, guarded);
      if (type.kind === "option" || type.kind === "array") {
        return visit(type.element, true);
      }
      if (type.kind === "union") {
        const outside = type.members.some((member) => !inGroup(member));
        for (const member of type.members) {
          found = visit(member, guarded || outside);
        }
      } else if (type.kind === "record") {
        for (const field of type.fields) {
          found = visit(field.type, guarded || field.optional);
        }
      } else if (type.kind === "tuple") {
        for (const element of type.elements) found = visit(element, guarded);
      } else {
        const ids = referencedIds(type, emptySet<string>());
        for (const id of ids) found = reach(id, guarded);
      }
      return found;
    }
    for (const type of types) found = visit(type, false);
    return found;
  });
  function cyclic(
    keep: (from: number, to: number, bare: boolean) => boolean,
  ): boolean {
    const graph = edges.map((targets, from) =>
      [...targets].filter((edge) => keep(from, edge[0], edge[1])).map((edge) =>
        edge[0]
      )
    );
    return stronglyConnectedComponents(members.length, graph).some((c) =>
      isCycle(c, graph)
    );
  }
  return !cyclic((from, to) => !members[from].tagged && !members[to].tagged) &&
    !cyclic((_from, _to, bare) => bare);
}
