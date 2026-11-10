// The pure data builtins: `div`, the rounding builtins `trunc`, `floor`,
// `round`, and `ceil`, `text`, and `len`. Each one is a builtin instance with a
// closed function type, as the collection builtins are, and lowering turns it
// into a call of that instance. A closed unit value (`Duration`, `Instant`) is
// not an argument of a numeric builtin or of `text`, although it widens to
// `int` elsewhere.

import { combine } from "../effect_set.ts";
import type { BuiltinInstanceName } from "../ids.ts";
import { CLOSED_UNIT_IDS } from "../ir.ts";
import type { NodeId } from "../syntax.ts";
import type { NodeInfo } from "../tables.ts";
import { functionTypeToIr } from "../type_ir.ts";
import { showType, showTypes } from "../type_show.ts";
import type { TypeRef, TypeTable } from "../types.ts";
import type { Arg, BuiltinContext, FactWriter } from "./context.ts";
import { piped, type PreludeCallName, type Rows } from "./rows.ts";

export interface DataContext extends
  Pick<
    BuiltinContext,
    "table" | "argInfo" | "assignable" | "finish" | "fits" | "report"
  >,
  FactWriter {}

/** The builtins that take plain numbers and give an `int`. */
type DataName = "div" | "trunc" | "floor" | "round" | "ceil";

function isClosedUnit(table: TypeTable, ref: TypeRef): boolean {
  const node = table.node(table.unfoldTransparent(ref));
  return node.kind === "named" && CLOSED_UNIT_IDS.has(node.id);
}

/** Records the closed function type of a builtin instance and gives the call its result. */
function instanceCall(
  c: DataContext,
  node: NodeId,
  name: BuiltinInstanceName,
  parameters: readonly TypeRef[],
  result: TypeRef,
  infos: readonly NodeInfo[],
): NodeInfo {
  const table = c.table;
  const specialized = table.function({
    execution: "pure",
    parameters,
    result,
    failures: [],
    requirements: [],
  });
  c.fact(node, {
    kind: "builtin",
    name,
    ir: functionTypeToIr(table, specialized),
  });
  return c.finish(node, result, combine(infos));
}

function dataCall(
  c: DataContext,
  node: NodeId,
  name: DataName,
  args: readonly Arg[],
): NodeInfo {
  const table = c.table;
  const parameters = name === "div" ? [table.int, table.int] : [table.number];
  const infos = args.map((arg, i) => {
    const info = c.argInfo(arg, parameters[i]);
    if (isClosedUnit(table, info.type)) {
      const [found, expected] = showTypes(table, info.type, parameters[i]);
      c.report(
        "type-mismatch/003",
        `the argument has type ${found}, but ${expected} is expected`,
        arg.node,
      );
    } else c.fits(arg.node, info.type, parameters[i], "the argument");
    return info;
  });
  return instanceCall(c, node, name, parameters, table.int, infos);
}

/**
 * `text` takes a `number` or a `boolean` and gives a `string`. An `int`, or an
 * identity over one of the three, takes the matching parameter. A closed unit
 * does not widen to the `number` parameter.
 */
function textCall(c: DataContext, node: NodeId, arg: Arg): NodeInfo {
  const table = c.table;
  const info = c.argInfo(arg);
  const parameter = !isClosedUnit(table, info.type) &&
      c.assignable(info.type, table.number)
    ? table.number
    : c.assignable(info.type, table.boolean)
    ? table.boolean
    : undefined;
  if (parameter === undefined) {
    c.report(
      "type-mismatch/003",
      `the argument has type ${
        showType(table, info.type)
      }, but number or boolean is expected`,
      arg.node,
    );
  }
  return instanceCall(
    c,
    node,
    "text",
    [parameter ?? table.number],
    table.string,
    [
      info,
    ],
  );
}

/**
 * `len` takes a `string` or an array and gives an `int`. An array argument keeps
 * its unfolded array type, so the instance names the element type.
 */
function lenCall(c: DataContext, node: NodeId, arg: Arg): NodeInfo {
  const table = c.table;
  const info = c.argInfo(arg);
  const unfolded = table.unfold(info.type);
  const parameter = table.node(unfolded).kind === "array" &&
      c.assignable(info.type, unfolded)
    ? unfolded
    : c.assignable(info.type, table.string)
    ? table.string
    : undefined;
  if (parameter === undefined) {
    c.report(
      "type-mismatch/003",
      `the argument has type ${
        showType(table, info.type)
      }, but string or an array is expected`,
      arg.node,
    );
  }
  return instanceCall(c, node, "len", [parameter ?? table.string], table.int, [
    info,
  ]);
}

/**
 * `at` takes an array and an `int` index and gives an `Option` of the element.
 * The instance keeps the unfolded array type, so it names the element type. A
 * closed unit does not widen to the index parameter.
 */
function atCall(
  c: DataContext,
  node: NodeId,
  array: Arg,
  index: Arg,
): NodeInfo {
  const table = c.table;
  const arrayInfo = c.argInfo(array);
  const unfolded = table.unfold(arrayInfo.type);
  const unfoldedNode = table.node(unfolded);
  const parameter = unfoldedNode.kind === "array" &&
      c.assignable(arrayInfo.type, unfolded)
    ? unfolded
    : undefined;
  if (parameter === undefined) {
    c.report(
      "type-mismatch/003",
      `the argument has type ${
        showType(table, arrayInfo.type)
      }, but an array is expected`,
      array.node,
    );
  }
  const indexInfo = c.argInfo(index, table.int);
  if (isClosedUnit(table, indexInfo.type)) {
    const [found, expected] = showTypes(table, indexInfo.type, table.int);
    c.report(
      "type-mismatch/003",
      `the argument has type ${found}, but ${expected} is expected`,
      index.node,
    );
  } else c.fits(index.node, indexInfo.type, table.int, "the argument");
  const element = unfoldedNode.kind === "array"
    ? unfoldedNode.element
    : table.int;
  return instanceCall(
    c,
    node,
    "at",
    [parameter ?? table.array(table.int), table.int],
    table.option(element),
    [arrayInfo, indexInfo],
  );
}

export const DATA_ROWS = {
  div: {
    prologue: piped(2, "pure"),
    handle: (c, node, name, args) => dataCall(c, node, name, args),
  },
  trunc: {
    prologue: piped(1, "pure"),
    handle: (c, node, name, args) => dataCall(c, node, name, args),
  },
  floor: {
    prologue: piped(1, "pure"),
    handle: (c, node, name, args) => dataCall(c, node, name, args),
  },
  round: {
    prologue: piped(1, "pure"),
    handle: (c, node, name, args) => dataCall(c, node, name, args),
  },
  ceil: {
    prologue: piped(1, "pure"),
    handle: (c, node, name, args) => dataCall(c, node, name, args),
  },
  text: {
    prologue: piped(1, "pure"),
    handle: (c, node, _name, args) => textCall(c, node, args[0]),
  },
  len: {
    prologue: piped(1, "pure"),
    handle: (c, node, _name, args) => lenCall(c, node, args[0]),
  },
  at: {
    prologue: piped(2, "pure"),
    handle: (c, node, _name, args) => atCall(c, node, args[0], args[1]),
  },
} satisfies Partial<Rows<PreludeCallName, DataContext>>;
