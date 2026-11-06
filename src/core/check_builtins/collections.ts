// Collection checking. Prelude dispatch retains arity and lowering-fact policy.
import type { NodeId } from "../syntax.ts";
import { combine } from "../effect_set.ts";
import type { NodeInfo } from "../tables.ts";
import type { TypeRef } from "../types.ts";
import { functionTypeToIr } from "../type_ir.ts";
import { showType } from "../type_show.ts";
import {
  type Arg,
  type BuiltinContext,
  concurrencyBound,
  type FactWriter,
  isEffectfulFunction,
  type LiteralRecordView,
} from "./context.ts";
import {
  optionalLast,
  piped,
  type PreludeCallName,
  type Rows,
} from "./rows.ts";

export interface CollectionContext extends
  Pick<
    BuiltinContext,
    | "table"
    | "argInfo"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "isError"
    | "report"
    | "widen"
  >,
  FactWriter,
  LiteralRecordView {
  noPipeline(name: string, args: readonly Arg[]): void;
}

/** The collection builtins that take an array first. */
type CollectionName = "map" | "filter" | "fold" | "traverse";

function allCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const input = c.argInfo(args[0]);
  const table = c.table;
  const shape = table.node(table.unfold(input.type));
  const effectTypes = shape.kind === "tuple"
    ? shape.elements
    : shape.kind === "record"
    ? shape.fields.map((field) => field.type)
    : shape.kind === "array"
    ? [shape.element]
    : undefined;
  const option = args[1] === undefined ? undefined : c.argInfo(args[1]);
  const concurrency = args[1] === undefined
    ? undefined
    : concurrencyBound(c, args[1], "all");
  if (effectTypes === undefined) {
    c.report(
      "type-mismatch/010",
      "`all` needs a tuple, record, or array of Effect values",
      args[0].node,
    );
    return c.finish(
      node,
      table.error,
      combine([input, ...(option === undefined ? [] : [option])]),
    );
  }
  if (shape.kind === "record" && shape.fields.some((field) => field.optional)) {
    c.report(
      "type-mismatch/010",
      "`all` requires every record field to be present",
      args[0].node,
    );
  }
  const effects = effectTypes.map((type) => {
    const member = table.node(table.unfold(type));
    if (member.kind !== "effect") {
      c.report(
        "type-mismatch/010",
        "`all` requires an Effect value at every position",
        args[0].node,
      );
      return { result: table.error, failures: [], requirements: [] };
    }
    return member;
  });
  const invocation = combine(effects.map((effect) => ({
    failures: effect.failures,
    requirements: effect.requirements,
    mode: "effect" as const,
  })));
  const results = effects.map((effect) => effect.result);
  const result = shape.kind === "tuple"
    ? table.tuple(results)
    : shape.kind === "record"
    ? table.record(shape.fields.map((field, i) => ({
      name: field.name,
      type: results[i],
      optional: false,
    })))
    : table.array(results[0]);
  const specialized = table.function({
    execution: "effect",
    parameters: args.length === 2
      ? [
        input.type,
        table.record([{
          name: "concurrency",
          type: concurrency === "unbounded" ? table.string : table.int,
          optional: false,
        }]),
      ]
      : [input.type],
    result,
    failures: invocation.failures,
    requirements: invocation.requirements,
  });
  c.fact(node, {
    kind: "builtin",
    name: "all",
    ir: functionTypeToIr(table, specialized),
  });
  return c.finish(
    node,
    result,
    combine([input, ...(option === undefined ? [] : [option]), invocation]),
  );
}

/** Checks the array that every collection builtin takes first. */
function collectionInput(
  c: CollectionContext,
  name: CollectionName,
  args: readonly Arg[],
): { readonly xs: NodeInfo; readonly element: TypeRef } {
  const xs = c.argInfo(args[0]);
  return { xs, element: arrayElement(c, name, args[0], xs) };
}

/** Records the builtin fact of a collection call and gives the call its result. */
function finishCollection(
  c: CollectionContext,
  node: NodeId,
  name: CollectionName,
  infos: readonly NodeInfo[],
  result: TypeRef,
  specialized: TypeRef,
): NodeInfo {
  c.fact(node, {
    kind: "builtin",
    name,
    ir: functionTypeToIr(c.table, specialized),
  });
  const invocation = c.table.node(specialized);
  return c.finish(
    node,
    result,
    invocation.kind === "function" && invocation.execution === "effect"
      ? combine([...infos, {
        failures: invocation.failures,
        requirements: invocation.requirements,
        mode: invocation.execution,
      }])
      : combine(infos),
  );
}

function traverseCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { xs, element } = collectionInput(c, "traverse", args);
  const table = c.table;
  const infos: NodeInfo[] = [xs];
  const cb = c.callback("traverse", args[1], [element], undefined, true);
  infos.push(cb.info);
  const concurrency = args[2] === undefined
    ? undefined
    : concurrencyBound(c, args[2]);
  if (args[2] !== undefined) {
    infos.push(c.argInfo(args[2]));
  }
  const fn = c.functionOf(cb.info.type);
  const failures = fn?.failures ?? [];
  const requirements = fn?.requirements ?? [];
  const callbackType = table.function({
    execution: "effect",
    parameters: [element],
    result: cb.result,
    failures,
    requirements,
  });
  const result = table.array(cb.result);
  const specialized = table.function({
    execution: "effect",
    parameters: args.length === 3
      ? [
        table.array(element),
        callbackType,
        table.record([{
          name: "concurrency",
          type: concurrency === "unbounded" ? table.string : table.int,
          optional: false,
        }]),
      ]
      : [table.array(element), callbackType],
    result,
    failures,
    requirements,
  });
  return finishCollection(c, node, "traverse", infos, result, specialized);
}

function mapCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { xs, element } = collectionInput(c, "map", args);
  const table = c.table;
  const cb = c.callback("map", args[1], [element], undefined, true);
  const result = table.array(cb.result);
  const specialized = callbackFunction(
    c,
    cb.info,
    [element],
    cb.result,
    (cbType) => [
      table.array(element),
      cbType,
    ],
    result,
  );
  return finishCollection(c, node, "map", [xs, cb.info], result, specialized);
}

function filterCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { xs, element } = collectionInput(c, "filter", args);
  const table = c.table;
  const cb = c.callback("filter", args[1], [element], table.boolean, true);
  c.fits(args[1].node, cb.result, table.boolean, "the predicate result");
  const result = table.array(element);
  const specialized = callbackFunction(
    c,
    cb.info,
    [element],
    table.boolean,
    (cbType) => [result, cbType],
    result,
  );
  return finishCollection(
    c,
    node,
    "filter",
    [xs, cb.info],
    result,
    specialized,
  );
}

function foldCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  const { xs, element } = collectionInput(c, "fold", args);
  const table = c.table;
  const initial = c.argInfo(args[1], expected);
  const accumulator = expected ?? c.widen(initial.type);
  c.fits(args[1].node, initial.type, accumulator, "the initial value");
  const cb = c.callback(
    "fold",
    args[2],
    [accumulator, element],
    accumulator,
    true,
  );
  c.fits(args[2].node, cb.result, accumulator, "the callback result");
  const specialized = callbackFunction(
    c,
    cb.info,
    [accumulator, element],
    accumulator,
    (cbType) => [table.array(element), accumulator, cbType],
    accumulator,
  );
  return finishCollection(
    c,
    node,
    "fold",
    [xs, initial, cb.info],
    accumulator,
    specialized,
  );
}

function arrayElement(
  c: CollectionContext,
  name: string,
  arg: Arg,
  info: NodeInfo,
): TypeRef {
  const node = c.table.node(c.table.unfold(info.type));
  if (node.kind === "array") {
    return node.element;
  }
  if (!c.isError(info.type)) {
    c.report(
      "type-mismatch/010",
      `\`${name}\` needs an array as its first argument, but the value has type ${
        showType(c.table, info.type)
      }`,
      arg.node,
    );
  }
  return c.table.error;
}

/**
 * The specialized type of map, filter or fold. A pure callback gives a pure
 * type. An effectful callback makes the call run as an effect with the
 * callback failures and requirements.
 */
function callbackFunction(
  c: CollectionContext,
  callback: NodeInfo,
  parameters: readonly TypeRef[],
  callbackResult: TypeRef,
  outer: (callback: TypeRef) => readonly TypeRef[],
  result: TypeRef,
): TypeRef {
  const fn = c.functionOf(callback.type);
  const failures = fn?.failures ?? [];
  const requirements = fn?.requirements ?? [];
  const effectful = fn !== undefined && isEffectfulFunction(fn);
  const execution = effectful ? "effect" : "pure";
  return c.table.function({
    execution,
    parameters: outer(c.table.function({
      execution,
      parameters,
      result: callbackResult,
      failures,
      requirements,
    })),
    result,
    failures,
    requirements,
  });
}

export const COLLECTION_ROWS = {
  all: {
    prologue: optionalLast(
      1,
      "`all` takes an Effect collection and an optional concurrency record",
    ),
    handle: (c, node, _name, args) => allCall(c, node, args),
  },
  traverse: {
    prologue: optionalLast(
      2,
      "`traverse` takes two arguments and an optional concurrency record",
    ),
    handle: (c, node, _name, args) => traverseCall(c, node, args),
  },
  map: {
    prologue: piped(2, "pure"),
    handle: (c, node, _name, args) => mapCall(c, node, args),
  },
  filter: {
    prologue: piped(2, "pure"),
    handle: (c, node, _name, args) => filterCall(c, node, args),
  },
  fold: {
    prologue: piped(3, "pure"),
    handle: (c, node, _name, args, expected) =>
      foldCall(c, node, args, expected),
  },
} satisfies Partial<Rows<PreludeCallName, CollectionContext>>;
