// Collection checking. Prelude dispatch retains arity and lowering-fact policy.
import type { NodeId } from "../syntax.ts";
import type { DiagnosticCode } from "../diagnostics.ts";
import { isOrderable } from "../check_binary.ts";
import { combine } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import type { TypeRef } from "../types.ts";
import { functionTypeToIr } from "../type_ir.ts";
import { showType } from "../type_show.ts";
import {
  type Arg,
  type BuiltinContext,
  concurrencyBound,
  concurrencyParameter,
  isEffectfulFunction,
  type LiteralRecordView,
} from "./context.ts";
import {
  optionalLast,
  piped,
  type PreludeCallName,
  type Rows,
} from "./rows.ts";

export type CollectionContext =
  & Pick<
    BuiltinContext,
    | "table"
    | "argInfo"
    | "assignable"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "isError"
    | "widen"
  >
  & LiteralRecordView
  & {
    checkFit(
      node: NodeId,
      found: TypeRef,
      expected: TypeRef | undefined,
      what: string,
    ): CollectionContext;
    report(
      code: DiagnosticCode,
      message: string,
      node: NodeId,
    ): CollectionContext;
    fact(node: NodeId, fact: NodeFact): CollectionContext;
    noPipeline(name: string, args: readonly Arg[]): CollectionContext;
  };

/** The collection builtins that take an array first. */
type CollectionName = "map" | "filter" | "fold" | "traverse";

function allCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const input = c.argInfo(args[0], undefined);
  const table = c.table;
  const shape = table.node(table.unfold(input.type));
  let effectTypes: readonly TypeRef[] | undefined;
  if (shape.kind === "tuple") effectTypes = shape.elements;
  if (shape.kind === "record") {
    effectTypes = shape.fields.map((field) => field.type);
  }
  if (shape.kind === "array") effectTypes = [shape.element];
  const option = args[1] === undefined
    ? undefined
    : c.argInfo(args[1], undefined);
  const concurrencyResult = concurrencyBound(c, args[1], "all");
  c = concurrencyResult.state;
  const concurrency = concurrencyResult.bound;
  if (effectTypes === undefined) {
    c = c.report(
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
    c = c.report(
      "type-mismatch/010",
      "`all` requires every record field to be present",
      args[0].node,
    );
  }
  const effects = effectTypes.map((type) => {
    const member = table.node(table.unfold(type));
    if (member.kind !== "effect") {
      c = c.report(
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
  let result = table.array(results[0]);
  if (shape.kind === "tuple") result = table.tuple(results);
  if (shape.kind === "record") {
    result = table.record(shape.fields.map((field, index) => ({
      name: field.name,
      type: results[index],
      optional: false,
    })));
  }
  const specialized = table.function({
    execution: "effect",
    parameters: args.length === 2
      ? [
        input.type,
        concurrencyParameter(table, concurrency),
      ]
      : [input.type],
    result: result,
    failures: invocation.failures,
    requirements: invocation.requirements,
  });
  c = c.fact(node, {
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
  const xs = c.argInfo(args[0], undefined);
  return { xs: xs, element: arrayElement(c, name, args[0], xs) };
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
  c = c.fact(node, {
    kind: "builtin",
    name: name,
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
  const input = collectionInput(c, "traverse", args);
  const xs = input.xs;
  const element = input.element;
  const table = c.table;
  const infos: NodeInfo[] = [xs];
  const cb = c.callback("traverse", args[1], [element], undefined, true);
  infos[infos.length] = cb.info;
  const concurrencyResult = concurrencyBound(c, args[2], "traverse");
  c = concurrencyResult.state;
  const concurrency = concurrencyResult.bound;
  if (args[2] !== undefined) {
    infos[infos.length] = c.argInfo(args[2], undefined);
  }
  const fn = c.functionOf(cb.info.type);
  const failures = fn?.failures ?? [];
  const requirements = fn?.requirements ?? [];
  const callbackType = table.function({
    execution: "effect",
    parameters: [element],
    result: cb.result,
    failures: failures,
    requirements: requirements,
  });
  const result = table.array(cb.result);
  const specialized = table.function({
    execution: "effect",
    parameters: args.length === 3
      ? [
        table.array(element),
        callbackType,
        concurrencyParameter(table, concurrency),
      ]
      : [table.array(element), callbackType],
    result: result,
    failures: failures,
    requirements: requirements,
  });
  return finishCollection(c, node, "traverse", infos, result, specialized);
}

function mapCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const input = collectionInput(c, "map", args);
  const xs = input.xs;
  const element = input.element;
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
  const input = collectionInput(c, "filter", args);
  const xs = input.xs;
  const element = input.element;
  const table = c.table;
  const cb = c.callback("filter", args[1], [element], table.boolean, true);
  c = c.checkFit(
    args[1].node,
    cb.result,
    table.boolean,
    "the predicate result",
  );
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
  const input = collectionInput(c, "fold", args);
  const xs = input.xs;
  const element = input.element;
  const table = c.table;
  const initial = c.argInfo(args[1], expected);
  const accumulator = expected ?? c.widen(initial.type);
  c = c.checkFit(args[1].node, initial.type, accumulator, "the initial value");
  const cb = c.callback(
    "fold",
    args[2],
    [accumulator, element],
    accumulator,
    true,
  );
  c = c.checkFit(args[2].node, cb.result, accumulator, "the callback result");
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

/**
 * `sort` takes an array and an optional pure key function. The element, or the
 * key without a key function, must be orderable. The instance keeps the unfolded
 * array type, so the result fits an array of an identity.
 */
function sortCall(
  c: CollectionContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const table = c.table;
  const xs = c.argInfo(args[0], undefined);
  const unfolded = table.unfold(xs.type);
  const shape = table.node(unfolded);
  const array = shape.kind === "array" && c.assignable(xs.type, unfolded)
    ? shape
    : undefined;
  if (array === undefined && !c.isError(xs.type)) {
    c = c.report(
      "type-mismatch/003",
      `the argument has type ${
        showType(table, xs.type)
      }, but an array is expected`,
      args[0].node,
    );
  }
  const element = array?.element ?? table.error;
  const parameters: TypeRef[] = [unfolded];
  const infos: NodeInfo[] = [xs];
  if (args[1] === undefined) {
    if (array !== undefined && !isOrderable(table, element)) {
      c = c.report(
        "type-mismatch/003",
        `the argument has type ${
          showType(table, xs.type)
        }, but an array of an orderable type is expected`,
        args[0].node,
      );
    }
  } else {
    const key = c.callback("sort", args[1], [element], undefined, false);
    if (!c.isError(key.result) && !isOrderable(table, key.result)) {
      c = c.report(
        "type-mismatch/003",
        `the key has type ${
          showType(table, key.result)
        }, but an orderable type is expected`,
        args[1].node,
      );
    }
    parameters[parameters.length] = table.function({
      execution: "pure",
      parameters: [element],
      result: key.result,
      failures: [],
      requirements: [],
    });
    infos[infos.length] = key.info;
  }
  c = c.fact(node, {
    kind: "builtin",
    name: "sort",
    ir: functionTypeToIr(
      table,
      table.function({
        execution: "pure",
        parameters: parameters,
        result: unfolded,
        failures: [],
        requirements: [],
      }),
    ),
  });
  return c.finish(node, unfolded, combine(infos));
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
    c = c.report(
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
    execution: execution,
    parameters: outer(c.table.function({
      execution: execution,
      parameters: parameters,
      result: callbackResult,
      failures: failures,
      requirements: requirements,
    })),
    result: result,
    failures: failures,
    requirements: requirements,
  });
}

export function collectionRows(): Pick<
  Rows<PreludeCallName, CollectionContext>,
  "all" | "traverse" | "map" | "sort" | "filter" | "fold"
> {
  return {
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
      prologue: piped(2, "pure", {}),
      handle: (c, node, _name, args) => mapCall(c, node, args),
    },
    sort: {
      prologue: optionalLast(
        1,
        "`sort` takes an array and an optional key function",
      ),
      handle: (c, node, _name, args) => sortCall(c, node, args),
    },
    filter: {
      prologue: piped(2, "pure", {}),
      handle: (c, node, _name, args) => filterCall(c, node, args),
    },
    fold: {
      prologue: piped(3, "pure", {}),
      handle: (c, node, _name, args, expected) =>
        foldCall(c, node, args, expected),
    },
  };
}
