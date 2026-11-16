// The recursion guard of the validator: finite self recursion and legal data
// groups, rechecked without the checker.

import { isTrue } from "./guards.ts";
import {
  deleteMapEntry,
  emptyMap,
  emptySet,
  indices,
  mapFrom,
  setFrom,
} from "../runtime.ts";
import type { ModuleIR, Type } from "../ir.ts";
import { AREA, type Report } from "./report.ts";
import { dataOnly } from "./typing.ts";
import { MAX_DEPTH, typeChildren } from "./type_children.ts";
import { type Ctx, flag, type World } from "./world_table.ts";

function collectOwnTargets(
  own: ReadonlySet<string>,
  targets: string[],
  type: Type,
  depth: number,
): string[] {
  if (depth > MAX_DEPTH) return targets;
  if (type.kind === "named") {
    if (own.has(type.id)) targets[targets.length] = type.id;
    return targets;
  }
  let found = targets;
  for (const child of typeChildren(type)) {
    found = collectOwnTargets(own, found, child.type, depth + 1);
  }
  return found;
}

/** Rechecks finite self recursion without trusting the checker. */
function guardedRecord(
  type: Type,
  id: string,
  tagOf: (type: Type) => string | undefined,
): boolean {
  function containsSelf(part: Type): boolean {
    if (part.kind === "named") return part.id === id;
    if (part.kind === "array") return containsSelf(part.element);
    if (part.kind === "option") return containsSelf(part.element);
    if (part.kind === "record") {
      return part.fields.some((field) => containsSelf(field.type));
    }
    if (part.kind === "union") return part.members.some(containsSelf);
    return false;
  }
  const tagged = type.kind === "union" && type.members.length >= 2 &&
    type.members.every((member) => member.kind === "record") &&
    type.members.some((member) => !containsSelf(member));
  const firstMember = type.kind === "union" ? type.members[0] : undefined;
  const tagNames = tagged && firstMember?.kind === "record"
    ? firstMember.fields.map((field) => field.name)
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
    ) && setFrom(fields.map((field) =>
          field === undefined ? undefined : tagOf(field.type)
        )).size === fields.length;
  });
  if (type.kind !== "record" && !hasDistinctTag) return false;
  let sawSelf = false;
  function walk(part: Type, guarded: boolean): boolean {
    if (part.kind === "named") {
      if (part.id !== id) return true;
      sawSelf = true;
      return guarded;
    }
    if (part.kind === "array") return walk(part.element, true);
    if (part.kind === "record") {
      return part.fields.every((field) =>
        walk(field.type, guarded || field.optional)
      );
    }
    if (part.kind === "union") {
      return (guarded || (part === type && hasDistinctTag)) &&
        part.members.every((member) => walk(member, true));
    }
    return part.kind === "primitive" || part.kind === "literal";
  }
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
  const env = world.env;
  const own = setFrom(ids);
  function edgesOf(
    id: string,
    within: ReadonlySet<string>,
  ): Map<string, boolean> {
    function mentions(type: Type, depth: number): boolean {
      return type.kind === "named" ? within.has(type.id) : depth <= MAX_DEPTH &&
        typeChildren(type).some((c) => mentions(c.type, depth + 1));
    }
    function reach(
      found: Map<string, boolean>,
      target: string,
      guarded: boolean,
    ): Map<string, boolean> {
      if (within.has(target)) {
        return found.set(target, (found.get(target) ?? false) || !guarded);
      }
      return found;
    }
    function visit(
      found: Map<string, boolean>,
      type: Type,
      guarded: boolean,
      depth: number,
    ): Map<string, boolean> {
      if (depth > MAX_DEPTH) return found;
      if (type.kind === "named") return reach(found, type.id, guarded);
      if (
        type.kind === "option" || type.kind === "array"
      ) {
        return visit(found, type.element, true, depth + 1);
      }
      if (type.kind === "union") {
        const outside = type.members.some((m) => !mentions(m, depth + 1));
        for (const m of type.members) {
          found = visit(found, m, guarded || outside, depth + 1);
        }
        return found;
      }
      if (type.kind === "record") {
        for (const f of type.fields) {
          found = visit(found, f.type, guarded || f.optional, depth + 1);
        }
        return found;
      }
      for (const c of typeChildren(type)) {
        found = visit(found, c.type, guarded, depth + 1);
      }
      return found;
    }
    const tagged = env.taggedRecords.get(id);
    const alias = env.aliases.get(id);
    let roots: readonly Type[] = [];
    if (tagged !== undefined) roots = [tagged];
    else if (alias !== undefined) roots = [alias];
    let found = emptyMap<string, boolean>();
    for (const root of roots) found = visit(found, root, false, 0);
    return found;
  }
  // Tarjan's components of the reference graph of the module.
  let graph = emptyMap<string, string[]>();
  for (const id of ids) {
    const targets: string[] = [];
    const roots: Type[] = [];
    const alias = env.aliases.get(id);
    const opaqueBase = env.opaqueBases.get(id);
    if (alias !== undefined) roots[roots.length] = alias;
    if (opaqueBase !== undefined) roots[roots.length] = opaqueBase;
    for (
      const f of env.taggedRecords.get(id)?.fields ?? env.errors.get(id) ?? []
    ) {
      roots[roots.length] = f.type;
    }
    let foundTargets = targets;
    for (const root of roots) {
      foundTargets = collectOwnTargets(own, foundTargets, root, 0);
    }
    graph = graph.set(id, foundTargets);
  }
  let number = emptyMap<string, number>();
  let low = emptyMap<string, number>();
  const stack: string[] = [];
  let onStack = emptyMap<string, boolean>();
  let groups = emptyMap<string, number>();
  let counter = 0;
  let groupCount = 0;
  function strong(id: string): number {
    number = number.set(id, counter);
    low = low.set(id, counter);
    counter = counter + 1;
    stack[stack.length] = id;
    onStack = onStack.set(id, true);
    for (const next of graph.get(id) ?? []) {
      if (!number.has(next)) {
        counter = strong(next);
        low = low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low = low.set(id, Math.min(low.get(id) ?? 0, number.get(next) ?? 0));
      }
    }
    if (low.get(id) !== number.get(id)) return counter;
    const members: string[] = [];
    for (const _index of indices(stack.length)) {
      const m = stack.pop();
      if (m === undefined) break;
      onStack = deleteMapEntry(onStack, m).map;
      members[members.length] = m;
      if (m === id) break;
    }
    const cycle = members.length > 1 || (graph.get(id) ?? []).includes(id);
    if (!cycle) return counter;
    if (!members.every((m) => env.taggedRecords.has(m) || env.aliases.has(m))) {
      return counter;
    }
    const within = setFrom(members);
    const edges = mapFrom(members.map((m) => [m, edgesOf(m, within)]));
    function cyclic(
      keep: (from: string, to: string, bare: boolean) => boolean,
    ): boolean {
      // A cycle exists when some member reaches itself through the kept edges.
      function reaches(
        from: string,
        target: string,
        seen: Set<string>,
      ): boolean {
        for (const entry of edges.get(from) ?? []) {
          const to = entry[0];
          const bare = entry[1];
          if (!keep(from, to, bare)) continue;
          if (to === target) return true;
          if (!seen.has(to)) {
            seen = seen.add(to);
            if (reaches(to, target, seen)) return true;
          }
        }
        return false;
      }
      return members.some((m) => reaches(m, m, emptySet()));
    }
    function aliasOnly(from: string, to: string): boolean {
      return !env.taggedRecords.has(from) && !env.taggedRecords.has(to);
    }
    if (cyclic(aliasOnly) || cyclic((_f, _t, bare) => bare)) return counter;
    groupCount = groupCount + 1;
    for (const m of members) groups = groups.set(m, groupCount);
    return counter;
  }
  for (const id of ids) {
    if (!number.has(id)) counter = strong(id);
  }
  return groups;
}

/** Reports cycles other than a single array-guarded data record. */
export function checkRecursion(ctx: Ctx, ir: ModuleIR): Report {
  const world = ctx.world;
  let state = emptyMap<string, 1 | 2>();
  let index = emptyMap<string, number>();
  for (const entry of ir.declarations.entries()) {
    const d = entry[1];
    const i = entry[0];
    if (d.kind === "type" || d.kind === "error") index = index.set(d.id, i);
  }
  let guarded = emptySet<string>();
  // A tag is an inline string literal or a name that reaches one through
  // literal aliases. The validator reads the aliases from its own world.
  function tagOf(type: Type): string | undefined {
    let seen = emptySet<string>();
    let current: Type | undefined = type;
    for (const _index of indices(world.env.aliases.size + 1)) {
      if (current === undefined) break;
      if (current.kind === "literal") {
        return typeof current.value === "string" ? current.value : undefined;
      }
      if (current.kind !== "named" || seen.has(current.id)) return undefined;
      seen = seen.add(current.id);
      current = world.env.aliases.get(current.id);
    }
    return undefined;
  }
  for (const d of ir.declarations) {
    if (d.kind !== "type") continue;
    let body: Type | undefined;
    if (d.definition.kind === "alias") body = d.definition.type;
    else if (!isTrue(d.opaque) && !isTrue(d.definition.tagged)) {
      body = d.definition.base;
    }
    if (
      body !== undefined && guardedRecord(body, d.id, tagOf) &&
      dataOnly(world.env, body, "schema")
    ) guarded = guarded.add(d.id);
  }
  const legal = guardedDataGroups(world, [...index.keys()]);
  let reported = emptySet<string>();
  const decls = ir.declarations;
  function reaches(
    currentCtx: Ctx,
    type: Type,
    from: string,
    depth: number,
  ): Ctx {
    if (depth > MAX_DEPTH) {
      // An imported declaration has no index here: its own module reports it.
      const at = index.get(from);
      if (at !== undefined) {
        currentCtx = {
          ...currentCtx,
          report: currentCtx.report.addDepth(
            `declarations[${at}]`,
            MAX_DEPTH,
            decls[at].span,
          ),
        };
      }
      return currentCtx;
    }
    if (type.kind === "named") {
      if (type.id === from && guarded.has(from)) return currentCtx;
      const group = legal.get(from);
      if (group !== undefined && legal.get(type.id) === group) {
        return currentCtx;
      }
      return visit(currentCtx, type.id);
    }
    for (const c of typeChildren(type)) {
      currentCtx = reaches(currentCtx, c.type, from, depth + 1);
    }
    return currentCtx;
  }
  function visit(currentCtx: Ctx, id: string): Ctx {
    const mark = state.get(id);
    if (mark === 2) return currentCtx;
    if (mark === 1) {
      const at = index.get(id);
      if (at !== undefined && !reported.has(id)) {
        reported = reported.add(id);
        const decl = ir.declarations[at];
        currentCtx = flag(
          currentCtx,
          AREA.types,
          `declarations[${at}]`,
          `the type ${id} refers to itself; version 0 has no recursive types`,
          decl.span,
        );
      }
      return currentCtx;
    }
    state = state.set(id, 1);
    const alias = world.env.aliases.get(id);
    const opaqueBase = world.env.opaqueBases.get(id);
    const fields = world.env.taggedRecords.get(id)?.fields ??
      world.env.errors.get(id);
    if (alias !== undefined) currentCtx = reaches(currentCtx, alias, id, 0);
    if (opaqueBase !== undefined) {
      currentCtx = reaches(currentCtx, opaqueBase, id, 0);
    }
    if (fields !== undefined) {
      for (const f of fields) {
        currentCtx = reaches(currentCtx, f.type, id, 0);
      }
    }
    state = state.set(id, 2);
    return currentCtx;
  }
  for (const id of index.keys()) ctx = visit(ctx, id);
  return ctx.report;
}
