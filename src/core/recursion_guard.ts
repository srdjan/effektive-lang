// Rule 11: a recursive data alias needs a guard that ends the recursion.

import type { Type, TypeId } from "./ir.ts";

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
