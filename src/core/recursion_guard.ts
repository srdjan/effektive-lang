import {
  emptyMap,
  emptySet,
  mapFrom,
  setFrom,
  stackValues,
} from "./runtime.ts";
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
type TagText = string;
type Guarded = boolean;

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
  {
    const kind_1 = part.kind;
    if (kind_1 === "named") {
      return part.id === id;
    } else if (kind_1 === "array" || kind_1 === "option") {
      return containsNamed(part.element, id);
    } else if (kind_1 === "record") {
      return part.fields.some((field) => containsNamed(field.type, id));
    } else if (kind_1 === "union") {
      return part.members.some((member) => containsNamed(member, id));
    } else if (
      kind_1 === "primitive" || kind_1 === "literal" || kind_1 === "tuple" ||
      kind_1 === "ref" || kind_1 === "retry-schedule" || kind_1 === "schema" ||
      kind_1 === "effect" || kind_1 === "stream" || kind_1 === "sink" ||
      kind_1 === "function" || kind_1 === "provider"
    ) {
      return false;
    } else {
      {
        const unreachable: never = part;
        return unreachable;
      }
    }
  }
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
  const tagNames = tagged
    ? records[0].fields
      .filter((field) => !field.optional && tagOf(field.type) !== undefined)
      .map((field) => field.name)
    : [];
  const hasDistinctTag = tagNames.some((name) => {
    const fields = records.map((member) =>
      member.fields.find((field) => field.name === name)
    );
    return fields.every((field) =>
      field !== undefined && !field.optional &&
      tagOf(field.type) !== undefined
    ) && setFrom(fields.map((field) =>
          field === undefined ? undefined : tagOf(field.type)
        )).size === fields.length;
  });
  if (type.kind !== "record" && !(tagged && hasDistinctTag)) {
    return false;
  }
  let found = false;
  function visit(part: Type, guarded: boolean): boolean {
    {
      const kind_2 = part.kind;
      if (kind_2 === "named") {
        if (part.id !== id) {
          return true;
        }
        found = true;
        return guarded;
      } else if (kind_2 === "array") {
        return visit(part.element, true);
      } else if (kind_2 === "record") {
        return part.fields.every((field) =>
          visit(field.type, guarded || field.optional)
        );
      } else if (kind_2 === "union") {
        return (guarded || (part === type && tagged && hasDistinctTag)) &&
          part.members.every((member) => visit(member, true));
      } else if (kind_2 === "primitive" || kind_2 === "literal") {
        return true;
      } else if (
        kind_2 === "tuple" || kind_2 === "option" || kind_2 === "ref" ||
        kind_2 === "retry-schedule" || kind_2 === "schema" ||
        kind_2 === "effect" || kind_2 === "stream" || kind_2 === "sink" ||
        kind_2 === "function" || kind_2 === "provider"
      ) {
        return false;
      } else {
        {
          const unreachable: never = part;
          return unreachable;
        }
      }
    }
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
      [...targets].filter((binding1) => {
        const binding2 = binding1;
        const to = binding2[0];
        const bare = binding2[1];
        return keep(from, to, bare);
      }).map((binding3) => {
        const binding4 = binding3;
        const to = binding4[0];
        return to;
      })
    );
    return stronglyConnectedComponents(members.length, graph).some((c) =>
      isCycle(c, graph)
    );
  }
  return !cyclic((from, to) => !members[from].tagged && !members[to].tagged) &&
    !cyclic((_from, _to, bare) => bare);
}
