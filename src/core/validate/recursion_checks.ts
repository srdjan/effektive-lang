// The recursion guard of the validator: finite self recursion and legal data
// groups, rechecked without the checker.

import type { ModuleIR, Type } from "../ir.ts";
import { AREA } from "./report.ts";
import { dataOnly } from "./typing.ts";
import { MAX_DEPTH } from "./type_children.ts";
import { typeChildren } from "./type_children.ts";
import type { Ctx, World } from "./world_table.ts";

/** Rechecks finite self recursion without trusting the checker. */
function guardedRecord(
  type: Type,
  id: string,
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
      case "ref":
      case "tuple":
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
  let sawSelf = false;
  const walk = (part: Type, guarded: boolean): boolean => {
    switch (part.kind) {
      case "named":
        if (part.id !== id) return true;
        sawSelf = true;
        return guarded;
      case "array":
        return walk(part.element, true);
      case "record":
        return part.fields.every((field) =>
          walk(field.type, guarded || field.optional)
        );
      case "union":
        return (guarded || (part === type && tagged && hasDistinctTag)) &&
          part.members.every((member) => walk(member, true));
      case "primitive":
      case "literal":
        return true;
      case "option":
      case "ref":
      case "tuple":
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
  return walk(type, false) && sawSelf;
}

/**
 * The member sets of the legal recursive groups of a module (rule 11): each
 * group is a cycle of declared data types and aliases, with a data type in it.
 * No cycle may be made of aliases alone, and every cycle must pass through an
 * `Option`, an array, an optional field, or a union that has a member outside
 * the group.
 */
function guardedDataGroups(
  world: World,
  ids: readonly string[],
): Map<string, number> {
  const { env } = world;
  const own = new Set(ids);
  const edgesOf = (id: string, within: ReadonlySet<string>) => {
    const found = new Map<string, boolean>();
    const mentions = (type: Type, depth: number): boolean =>
      type.kind === "named" ? within.has(type.id) : depth <= MAX_DEPTH &&
        typeChildren(type).some((c) => mentions(c.type, depth + 1));
    const reach = (target: string, guarded: boolean): void => {
      if (within.has(target)) {
        found.set(target, (found.get(target) ?? false) || !guarded);
      }
    };
    const visit = (type: Type, guarded: boolean, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      if (type.kind === "named") return reach(type.id, guarded);
      if (
        type.kind === "option" || type.kind === "array"
      ) {
        return visit(type.element, true, depth + 1);
      }
      if (type.kind === "union") {
        const outside = type.members.some((m) => !mentions(m, depth + 1));
        for (const m of type.members) visit(m, guarded || outside, depth + 1);
        return;
      }
      if (type.kind === "record") {
        for (const f of type.fields) {
          visit(f.type, guarded || f.optional, depth + 1);
        }
        return;
      }
      for (const c of typeChildren(type)) visit(c.type, guarded, depth + 1);
    };
    const tagged = env.taggedRecords.get(id);
    const alias = env.aliases.get(id);
    const roots: readonly Type[] = tagged !== undefined
      ? [tagged]
      : alias !== undefined
      ? [alias]
      : [];
    for (const root of roots) visit(root, false, 0);
    return found;
  };
  // Tarjan's components of the reference graph of the module.
  const graph = new Map<string, string[]>();
  for (const id of ids) {
    const targets: string[] = [];
    const roots: Type[] = [];
    const alias = env.aliases.get(id);
    const opaqueBase = env.opaqueBases.get(id);
    if (alias !== undefined) roots.push(alias);
    if (opaqueBase !== undefined) roots.push(opaqueBase);
    for (
      const f of env.taggedRecords.get(id)?.fields ?? env.errors.get(id) ?? []
    ) {
      roots.push(f.type);
    }
    const walk = (type: Type, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      if (type.kind === "named") {
        if (own.has(type.id)) targets.push(type.id);
        return;
      }
      for (const c of typeChildren(type)) walk(c.type, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    graph.set(id, targets);
  }
  const number = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups = new Map<string, number>();
  let counter = 0;
  let groupCount = 0;
  const strong = (id: string): void => {
    number.set(id, counter);
    low.set(id, counter++);
    stack.push(id);
    onStack.add(id);
    for (const next of graph.get(id) ?? []) {
      if (!number.has(next)) {
        strong(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, number.get(next) ?? 0));
      }
    }
    if (low.get(id) !== number.get(id)) return;
    const members: string[] = [];
    for (let m = stack.pop(); m !== undefined; m = stack.pop()) {
      onStack.delete(m);
      members.push(m);
      if (m === id) break;
    }
    const cycle = members.length > 1 || (graph.get(id) ?? []).includes(id);
    if (!cycle || !members.some((m) => env.taggedRecords.has(m))) return;
    if (!members.every((m) => env.taggedRecords.has(m) || env.aliases.has(m))) {
      return;
    }
    const within = new Set(members);
    const edges = new Map(members.map((m) => [m, edgesOf(m, within)]));
    const cyclic = (
      keep: (from: string, to: string, bare: boolean) => boolean,
    ) => {
      // A cycle exists when some member reaches itself through the kept edges.
      const reaches = (
        from: string,
        target: string,
        seen: Set<string>,
      ): boolean => {
        for (const [to, bare] of edges.get(from) ?? []) {
          if (!keep(from, to, bare)) continue;
          if (to === target) return true;
          if (!seen.has(to)) {
            seen.add(to);
            if (reaches(to, target, seen)) return true;
          }
        }
        return false;
      };
      return members.some((m) => reaches(m, m, new Set()));
    };
    const aliasOnly = (from: string, to: string) =>
      !env.taggedRecords.has(from) && !env.taggedRecords.has(to);
    if (cyclic(aliasOnly) || cyclic((_f, _t, bare) => bare)) return;
    groupCount += 1;
    for (const m of members) groups.set(m, groupCount);
  };
  for (const id of ids) if (!number.has(id)) strong(id);
  return groups;
}

/** Reports cycles other than a single array-guarded data record. */
export function checkRecursion(ctx: Ctx, ir: ModuleIR): void {
  const { world } = ctx;
  const state = new Map<string, 1 | 2>();
  const index = new Map<string, number>();
  ir.declarations.forEach((d, i) => {
    if (d.kind === "type" || d.kind === "error") index.set(d.id, i);
  });
  const guarded = new Set<string>();
  // A tag is an inline string literal or a name that reaches one through
  // literal aliases. The validator reads the aliases from its own world.
  const tagOf = (type: Type): string | undefined => {
    const seen = new Set<string>();
    let current: Type | undefined = type;
    while (current !== undefined) {
      if (current.kind === "literal") {
        return typeof current.value === "string" ? current.value : undefined;
      }
      if (current.kind !== "named" || seen.has(current.id)) return undefined;
      seen.add(current.id);
      current = world.env.aliases.get(current.id);
    }
    return undefined;
  };
  ir.declarations.forEach((d) => {
    if (d.kind !== "type") return;
    // An untagged record identity is a guarded alias like a record alias.
    const body = d.definition.kind === "alias"
      ? d.definition.type
      : d.opaque !== true && d.definition.tagged !== true
      ? d.definition.base
      : undefined;
    if (
      body !== undefined && guardedRecord(body, d.id, tagOf) &&
      dataOnly(world.env, body, "schema")
    ) guarded.add(d.id);
  });
  const legal = guardedDataGroups(world, [...index.keys()]);
  const reported = new Set<string>();
  const decls = ir.declarations;
  const reaches = (type: Type, from: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      // An imported declaration has no index here: its own module reports it.
      const at = index.get(from);
      if (at !== undefined) {
        ctx.report.addDepth(`declarations[${at}]`, MAX_DEPTH, decls[at].span);
      }
      return;
    }
    if (type.kind === "named") {
      if (type.id === from && guarded.has(from)) return;
      const group = legal.get(from);
      if (group !== undefined && legal.get(type.id) === group) return;
      visit(type.id);
      return;
    }
    for (const c of typeChildren(type)) reaches(c.type, from, depth + 1);
  };
  const visit = (id: string): void => {
    const mark = state.get(id);
    if (mark === 2) return;
    if (mark === 1) {
      const at = index.get(id);
      if (at !== undefined && !reported.has(id)) {
        reported.add(id);
        const decl = ir.declarations[at];
        ctx.report.add(
          AREA.types,
          `declarations[${at}]`,
          `the type ${id} refers to itself; version 0 has no recursive types`,
          decl.span,
        );
      }
      return;
    }
    state.set(id, 1);
    const alias = world.env.aliases.get(id);
    const opaqueBase = world.env.opaqueBases.get(id);
    const fields = world.env.taggedRecords.get(id)?.fields ??
      world.env.errors.get(id);
    if (alias !== undefined) reaches(alias, id, 0);
    if (opaqueBase !== undefined) reaches(opaqueBase, id, 0);
    if (fields !== undefined) fields.forEach((f) => reaches(f.type, id, 0));
    state.set(id, 2);
  };
  for (const id of index.keys()) visit(id);
}
