// The pure data builtins: `div` and the rounding builtins `trunc`, `floor`,
// `round`, and `ceil`. Each one is a builtin instance with a closed function
// type, as the collection builtins are, and lowering turns it into a call of
// that instance. A closed unit value (`Duration`, `Instant`) is not an argument,
// although it widens to `int` elsewhere.

import { combine } from "../effect_set.ts";
import { CLOSED_UNIT_IDS } from "../ir.ts";
import type { NodeId } from "../syntax.ts";
import type { NodeInfo } from "../tables.ts";
import { functionTypeToIr } from "../type_ir.ts";
import { showTypes } from "../type_show.ts";
import type { TypeRef, TypeTable } from "../types.ts";
import type { Arg, BuiltinContext, FactWriter } from "./context.ts";
import { piped, type PreludeCallName, type Rows } from "./rows.ts";

export interface DataContext extends
  Pick<
    BuiltinContext,
    "table" | "argInfo" | "finish" | "fits" | "report"
  >,
  FactWriter {}

/** The builtins that take plain numbers and give an `int`. */
type DataName = "div" | "trunc" | "floor" | "round" | "ceil";

function isClosedUnit(table: TypeTable, ref: TypeRef): boolean {
  const node = table.node(table.unfoldTransparent(ref));
  return node.kind === "named" && CLOSED_UNIT_IDS.has(node.id);
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
  const specialized = table.function({
    execution: "pure",
    parameters,
    result: table.int,
    failures: [],
    requirements: [],
  });
  c.fact(node, {
    kind: "builtin",
    name,
    ir: functionTypeToIr(table, specialized),
  });
  return c.finish(node, table.int, combine(infos));
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
} satisfies Partial<Rows<PreludeCallName, DataContext>>;
