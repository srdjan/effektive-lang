// The Map and Set operations. Every operation is pure. `mapOf` and `setOf`
// infer from list literals. Prelude dispatch checks arity and records facts
// first.

import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import { combine, type NodeInfo, PURE_EFFECTS } from "../tables.ts";
import { dataOnly, type TypeRef } from "../types.ts";
import { showType, showTypes } from "../type_show.ts";
import type { Arg, BuiltinContext, FactWriter, SyntaxView } from "./context.ts";
import { direct, type PreludeCallName, type Rows } from "./rows.ts";

/** The checker operations that `mapOf` and `setOf` read. */
export interface MapSetContext extends BuiltinContext, SyntaxView, FactWriter {}

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

/** The key and value of an expected Map type, when the expected type is one. */
function expectedMap(
  c: MapSetContext,
  expected: TypeRef | undefined,
): { readonly key: TypeRef; readonly value: TypeRef } | undefined {
  if (expected === undefined) return undefined;
  const node = c.table.node(c.table.unfold(expected));
  return node.kind === "map" ? { key: node.key, value: node.value } : undefined;
}

/** The element of an expected Set type, when the expected type is one. */
function expectedSet(
  c: MapSetContext,
  expected: TypeRef | undefined,
): TypeRef | undefined {
  if (expected === undefined) return undefined;
  const node = c.table.node(c.table.unfold(expected));
  return node.kind === "set" ? node.element : undefined;
}

/** The key and value of an array of two-element tuples, or undefined. */
function pairParts(
  c: MapSetContext,
  ref: TypeRef,
): { readonly key: TypeRef; readonly value: TypeRef } | undefined {
  const list = c.table.node(c.table.unfold(ref));
  if (list.kind !== "array") return undefined;
  const pair = c.table.node(c.table.unfold(list.element));
  return pair.kind === "tuple" && pair.elements.length === 2
    ? { key: pair.elements[0], value: pair.elements[1] }
    : undefined;
}

function isListLiteral(c: MapSetContext, arg: Arg): boolean {
  return arg.pre === undefined &&
    kindOf(c.tree, arg.node) === SyntaxKind.ListExpr;
}

/** The common type of the widened `types`, or the error type after a report. */
function joinTypes(
  c: MapSetContext,
  types: readonly TypeRef[],
  nodes: readonly NodeId[],
  what: string,
): TypeRef {
  let joined = c.widen(types[0]);
  for (let i = 1; i < types.length; i++) {
    const next = c.widen(types[i]);
    if (c.isError(joined) || c.isError(next)) {
      joined = c.table.error;
    } else if (c.assignable(next, joined)) {
      continue;
    } else if (c.assignable(joined, next)) {
      joined = next;
    } else {
      const [nextText, joinedText] = showTypes(c.table, next, joined);
      c.report(
        "type-mismatch/012",
        `${what} ${
          i + 1
        } has type ${nextText}, which has no common type with ${joinedText}`,
        nodes[i],
      );
      joined = c.table.error;
    }
  }
  return joined;
}

/** Reports `declaration/019` when an inferred key or element is not data. */
function requireInferredData(
  c: MapSetContext,
  role: string,
  type: TypeRef,
  node: NodeId,
): void {
  if (c.isError(type) || dataOnly(c.table, type, "value", true)) return;
  c.report(
    "declaration/019",
    `A ${role} must be data, found \`${showType(c.table, type)}\``,
    node,
  );
}

/**
 * Infers the entries of `mapOf` from a list literal with no expected type.
 * Each inner two-element list literal is a pair. The checker joins the key
 * types and the value types separately.
 */
function inferPairs(
  c: MapSetContext,
  list: NodeId,
): {
  readonly key: TypeRef;
  readonly value: TypeRef;
  readonly info: NodeInfo;
} {
  const table = c.table;
  const keys: TypeRef[] = [];
  const values: TypeRef[] = [];
  const keyNodes: NodeId[] = [];
  const valueNodes: NodeId[] = [];
  const infos: NodeInfo[] = [];
  let broken = false;
  c.kids(list).forEach((entry, i) => {
    const parts = c.kids(entry);
    if (
      kindOf(c.tree, entry) === SyntaxKind.ListExpr && parts.length === 2
    ) {
      c.fact(entry, { kind: "list", shape: "tuple" });
      const [k, v] = parts.map((part) => c.argInfo({ node: part }));
      const info = c.finish(
        entry,
        table.tuple([c.widen(k.type), c.widen(v.type)]),
        combine([k, v]),
      );
      infos.push(info);
      keys.push(k.type);
      values.push(v.type);
      keyNodes.push(parts[0]);
      valueNodes.push(parts[1]);
      return;
    }
    const info = c.argInfo({ node: entry });
    infos.push(info);
    const pair = pairParts(c, table.array(info.type));
    if (pair === undefined) {
      broken = true;
      if (!c.isError(info.type)) {
        c.report(
          "type-mismatch/012",
          `mapOf entry ${i + 1} must be a [key, value] pair`,
          entry,
        );
      }
      return;
    }
    keys.push(pair.key);
    values.push(pair.value);
    keyNodes.push(entry);
    valueNodes.push(entry);
  });
  c.fact(list, { kind: "list", shape: "array" });
  if (broken) {
    return {
      key: table.error,
      value: table.error,
      info: c.finish(list, table.array(table.error), combine(infos)),
    };
  }
  const key = joinTypes(c, keys, keyNodes, "map key");
  const value = joinTypes(c, values, valueNodes, "map value");
  const info = c.finish(
    list,
    table.array(table.tuple([key, value])),
    combine(infos),
  );
  return { key, value, info };
}

function mapOfCall(
  c: MapSetContext,
  node: NodeId,
  arg: Arg,
  expected: TypeRef | undefined,
): NodeInfo {
  const table = c.table;
  const wanted = expectedMap(c, expected);
  if (wanted !== undefined) {
    const hint = table.array(table.tuple([wanted.key, wanted.value]));
    const info = c.argInfo(arg, hint);
    if (!c.fits(arg.node, info.type, hint, "the mapOf entries")) {
      return c.finish(node, table.error, info);
    }
    const given = pairParts(c, info.type);
    const sameKey = given !== undefined &&
      c.assignable(wanted.key, given.key) &&
      c.assignable(given.key, wanted.key);
    return c.finish(
      node,
      sameKey || given === undefined
        ? table.map(wanted.key, wanted.value)
        : table.map(given.key, given.value),
      info,
    );
  }
  if (isListLiteral(c, arg)) {
    if (c.kids(arg.node).length === 0) {
      c.fact(arg.node, { kind: "list", shape: "array" });
      c.report(
        "type-mismatch/012",
        "`mapOf([])` needs an expected Map type",
        arg.node,
      );
      const info = c.finish(
        arg.node,
        table.array(table.error),
        PURE_EFFECTS,
      );
      return c.finish(node, table.error, info);
    }
    const inferred = inferPairs(c, arg.node);
    if (c.isError(inferred.key) || c.isError(inferred.value)) {
      return c.finish(node, table.error, inferred.info);
    }
    requireInferredData(c, "Map key", inferred.key, arg.node);
    return c.finish(
      node,
      table.map(inferred.key, inferred.value),
      inferred.info,
    );
  }
  const info = c.argInfo(arg);
  const pair = pairParts(c, info.type);
  if (pair === undefined) {
    if (!c.isError(info.type)) {
      c.report(
        "type-mismatch/003",
        `the mapOf entries has type ${
          showType(c.table, info.type)
        }, but an array of [key, value] pairs is expected`,
        arg.node,
      );
    }
    return c.finish(node, table.error, info);
  }
  requireInferredData(c, "Map key", pair.key, arg.node);
  return c.finish(node, table.map(pair.key, pair.value), info);
}

function setOfCall(
  c: MapSetContext,
  node: NodeId,
  arg: Arg,
  expected: TypeRef | undefined,
): NodeInfo {
  const table = c.table;
  const wanted = expectedSet(c, expected);
  if (wanted !== undefined) {
    const hint = table.array(wanted);
    const info = c.argInfo(arg, hint);
    if (!c.fits(arg.node, info.type, hint, "the setOf items")) {
      return c.finish(node, table.error, info);
    }
    return c.finish(node, table.set(wanted), info);
  }
  if (isListLiteral(c, arg) && c.kids(arg.node).length === 0) {
    c.fact(arg.node, { kind: "list", shape: "array" });
    c.report(
      "type-mismatch/012",
      "`setOf([])` needs an expected Set type",
      arg.node,
    );
    const info = c.finish(
      arg.node,
      table.array(table.error),
      PURE_EFFECTS,
    );
    return c.finish(node, table.error, info);
  }
  const info = c.argInfo(arg);
  const list = table.node(table.unfold(info.type));
  if (list.kind !== "array") {
    if (!c.isError(info.type)) {
      c.report(
        "type-mismatch/003",
        `the setOf items has type ${
          showType(c.table, info.type)
        }, but an array is expected`,
        arg.node,
      );
    }
    return c.finish(node, table.error, info);
  }
  if (c.isError(list.element)) return c.finish(node, table.error, info);
  requireInferredData(c, "Set element", list.element, arg.node);
  return c.finish(node, table.set(list.element), info);
}

/** The rows of the Map and Set operations. */
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
  mapOf: {
    prologue: direct(1, "pure", { fact: { kind: "map-of" } }),
    handle: (c, node, _name, args, expected) =>
      mapOfCall(c, node, args[0], expected),
  },
  setOf: {
    prologue: direct(1, "pure", { fact: { kind: "set-of" } }),
    handle: (c, node, _name, args, expected) =>
      setOfCall(c, node, args[0], expected),
  },
} satisfies Partial<Rows<PreludeCallName, MapSetContext>>;
