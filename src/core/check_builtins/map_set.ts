// The Map and Set operations that need no private checker member. Every
// operation is pure. `mapOf` and `setOf` infer from list literals, so they sit
// in the body checker. Prelude dispatch checks arity and records facts first.

import type { NodeId } from "../syntax.ts";
import { combine, type NodeInfo } from "../tables.ts";
import type { TypeRef } from "../types.ts";
import type { Arg, BuiltinContext } from "./context.ts";
import { direct, type PreludeCallName, type Rows } from "./rows.ts";

type MapSetName =
  | "getMap"
  | "putMap"
  | "removeMap"
  | "hasMap"
  | "entriesMap"
  | "addSet"
  | "removeSet"
  | "hasSet"
  | "itemsSet";

/** The key and value of a Map type, or the error type after a report. */
function mapParts(
  c: BuiltinContext,
  name: MapSetName,
  info: NodeInfo,
  arg: Arg,
): { readonly key: TypeRef; readonly value: TypeRef } {
  const type = c.table.node(c.table.unfold(info.type));
  if (type.kind === "map") return { key: type.key, value: type.value };
  if (!c.isError(info.type)) {
    c.report("type-mismatch/010", `\`${name}\` needs a Map value`, arg.node);
  }
  return { key: c.table.error, value: c.table.error };
}

/** The element of a Set type, or the error type after a report. */
function setElement(
  c: BuiltinContext,
  name: MapSetName,
  info: NodeInfo,
  arg: Arg,
): TypeRef {
  const type = c.table.node(c.table.unfold(info.type));
  if (type.kind === "set") return type.element;
  if (!c.isError(info.type)) {
    c.report("type-mismatch/010", `\`${name}\` needs a Set value`, arg.node);
  }
  return c.table.error;
}

/** An argument that must fit `expected`, given as a hint to the argument. */
function slot(
  c: BuiltinContext,
  arg: Arg,
  expected: TypeRef,
  what: string,
): NodeInfo {
  const hint = c.isError(expected) ? undefined : expected;
  const info = c.argInfo(arg, hint);
  c.fits(arg.node, info.type, hint, what);
  return info;
}

function mapCall(
  c: BuiltinContext,
  node: NodeId,
  name: MapSetName,
  args: readonly Arg[],
): NodeInfo {
  const map = c.argInfo(args[0]);
  const { key: keyType, value: valueType } = mapParts(c, name, map, args[0]);
  const infos = [map];
  if (name !== "entriesMap") {
    infos.push(slot(c, args[1], keyType, "the Map key"));
  }
  if (name === "putMap") {
    infos.push(slot(c, args[2], valueType, "the Map value"));
  }
  const bad = c.isError(keyType);
  const type = name === "getMap"
    ? (bad ? c.table.error : c.table.option(valueType))
    : name === "hasMap"
    ? c.table.boolean
    : name === "entriesMap"
    ? (bad ? c.table.error : c.table.array(c.table.tuple([keyType, valueType])))
    : (bad ? c.table.error : c.table.map(keyType, valueType));
  return c.finish(node, type, combine(infos));
}

function setCall(
  c: BuiltinContext,
  node: NodeId,
  name: MapSetName,
  args: readonly Arg[],
): NodeInfo {
  const set = c.argInfo(args[0]);
  const element = setElement(c, name, set, args[0]);
  const infos = [set];
  if (name !== "itemsSet") {
    infos.push(slot(c, args[1], element, "the Set element"));
  }
  const bad = c.isError(element);
  const type = name === "hasSet"
    ? c.table.boolean
    : name === "itemsSet"
    ? (bad ? c.table.error : c.table.array(element))
    : (bad ? c.table.error : c.table.set(element));
  return c.finish(node, type, combine(infos));
}

/** The rows of the Map and Set operations, except `mapOf` and `setOf`. */
export const MAP_SET_ROWS = {
  getMap: {
    prologue: direct(2, "pure", { fact: { kind: "get-map" } }),
    handle: (c, node, name, args) => mapCall(c, node, name, args),
  },
  putMap: {
    prologue: direct(3, "pure", { fact: { kind: "put-map" } }),
    handle: (c, node, name, args) => mapCall(c, node, name, args),
  },
  removeMap: {
    prologue: direct(2, "pure", { fact: { kind: "remove-map" } }),
    handle: (c, node, name, args) => mapCall(c, node, name, args),
  },
  hasMap: {
    prologue: direct(2, "pure", { fact: { kind: "has-map" } }),
    handle: (c, node, name, args) => mapCall(c, node, name, args),
  },
  entriesMap: {
    prologue: direct(1, "pure", { fact: { kind: "entries-map" } }),
    handle: (c, node, name, args) => mapCall(c, node, name, args),
  },
  addSet: {
    prologue: direct(2, "pure", { fact: { kind: "add-set" } }),
    handle: (c, node, name, args) => setCall(c, node, name, args),
  },
  removeSet: {
    prologue: direct(2, "pure", { fact: { kind: "remove-set" } }),
    handle: (c, node, name, args) => setCall(c, node, name, args),
  },
  hasSet: {
    prologue: direct(2, "pure", { fact: { kind: "has-set" } }),
    handle: (c, node, name, args) => setCall(c, node, name, args),
  },
  itemsSet: {
    prologue: direct(1, "pure", { fact: { kind: "items-set" } }),
    handle: (c, node, name, args) => setCall(c, node, name, args),
  },
} satisfies Partial<Rows<PreludeCallName, BuiltinContext>>;
