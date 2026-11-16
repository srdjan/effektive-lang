// Stream and Sink construction, callbacks, and execution.
import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import type { DiagnosticCode } from "../diagnostics.ts";
import { isPatternKind, literalOf } from "../syntax_queries.ts";
import { combine, EFFECT_ONLY, PURE_EFFECTS } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import type { TypeNode, TypeRef } from "../types.ts";
import {
  type Arg,
  type BuiltinContext,
  concurrencyBound,
  type FactView,
  type LiteralRecordView,
  type ResolveView,
  type SyntaxView,
} from "./context.ts";
import {
  direct,
  optionalLast,
  type PreludeCallName,
  type Rows,
} from "./rows.ts";
export type StreamContext =
  & BuiltinContext
  & SyntaxView
  & ResolveView
  & FactView
  & LiteralRecordView
  & {
    checkFit(
      node: NodeId,
      found: TypeRef,
      expected: TypeRef | undefined,
      what: string,
    ): StreamContext;
    report(code: DiagnosticCode, message: string, node: NodeId): StreamContext;
    fact(node: NodeId, fact: NodeFact): StreamContext;
    inlineStreamCallback(name: string, arg: Arg): StreamContext;
    noPipeline(name: string, args: readonly Arg[]): StreamContext;
  };

function unfoldCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  c = c.inlineStreamCallback("unfold", args[1]);
  const seed = c.argInfo(args[0], undefined);
  const state = c.widen(seed.type);
  const next = c.callback("unfold", args[1], [state], undefined, true);
  const fn = c.functionOf(next.info.type);
  const option = c.table.node(c.table.unfold(next.result));
  const pair = option.kind === "option"
    ? c.table.node(c.table.unfold(option.element))
    : undefined;
  let element = c.table.error;
  if (pair?.kind !== "tuple" || pair.elements.length !== 2) {
    if (!c.isError(next.result)) {
      c = c.report(
        "type-mismatch/010",
        "`unfold` callback must return Option<[Element, State]>",
        args[1].node,
      );
    }
  } else {
    element = pair.elements[0];
    c = c.checkFit(
      args[1].node,
      pair.elements[1],
      state,
      "the next stream state",
    );
  }
  const type = c.table.stream(
    element,
    fn?.failures ?? [],
    fn?.requirements ?? [],
  );
  return c.finish(node, type, combine([seed, next.info]));
}

function mapEffectCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const concurrencyResult = args[2] === undefined
    ? { state: c, bound: undefined }
    : concurrencyBound(c, args[2], "mapEffect");
  c = concurrencyResult.state;
  const concurrency = concurrencyResult.bound;
  c = c.noPipeline("mapEffect", args);
  c = c.inlineStreamCallback("mapEffect", args[1]);
  const input = streamArg(c, "mapEffect", args[0]);
  const stream = input.info;
  const source = input.source;
  const element = input.element;
  const transform = c.callback(
    "mapEffect",
    args[1],
    [element],
    undefined,
    true,
  );
  const fn = c.functionOf(transform.info.type);
  // Only a pure callback without options compiles to the pure operation.
  c = c.fact(
    node,
    args[2] === undefined && fn !== undefined && fn.execution === "pure" &&
      fn.failures.length === 0 && fn.requirements.length === 0
      ? { kind: "map-stream" }
      : { kind: "map-effect", concurrency: concurrency },
  );
  const type = c.table.stream(transform.result, [
    ...(source.kind === "stream" ? source.failures : []),
    ...(fn?.failures ?? []),
  ], [
    ...(source.kind === "stream" ? source.requirements : []),
    ...(fn?.requirements ?? []),
  ]);
  return c.finish(
    node,
    type,
    combine([
      stream,
      transform.info,
      ...(args[2] === undefined ? [] : [c.argInfo(args[2], undefined)]),
    ]),
  );
}

function sinkForEachCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  c = c.inlineStreamCallback("sinkForEach", args[0]);
  // A sink hint gives the callback its input type. A sink with no hint
  // keeps the annotated input.
  const hint = expected === undefined
    ? undefined
    : c.table.node(c.table.unfold(expected));
  const consume = c.argInfo(
    args[0],
    hint?.kind === "sink"
      ? c.table.function({
        execution: "pure",
        parameters: [hint.input],
        result: c.table.unit,
        failures: [],
        requirements: [],
      })
      : undefined,
  );
  const fn = c.functionOf(consume.type);
  if (fn === undefined || fn.parameters.length !== 1) {
    if (!c.isError(consume.type)) {
      c = c.report(
        "type-mismatch/010",
        "`sinkForEach` needs a one-argument callback with an annotated input",
        args[0].node,
      );
    }
    return c.finish(node, c.table.error, consume);
  }
  c = c.checkFit(
    args[0].node,
    fn.result,
    c.table.unit,
    "the sink callback result",
  );
  const type = c.table.sink(
    fn.parameters[0],
    c.table.unit,
    fn.failures,
    fn.requirements,
    c.table.never,
  );
  return c.finish(node, type, consume);
}

function takeSinkCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  const literal = args[0].pre === undefined &&
      kindOf(c.tree, args[0].node) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, args[0].node)
    : undefined;
  const count = typeof literal === "number" && Number.isSafeInteger(literal) &&
      literal > 0
    ? literal
    : undefined;
  let countInfo: NodeInfo;
  if (count === undefined) {
    countInfo = c.argInfo(args[0], undefined);
    c = c.report(
      "type-mismatch/010",
      "`takeSink` needs a positive safe integer literal count",
      args[0].node,
    );
  } else {
    countInfo = c.finish(args[0].node, c.table.int, PURE_EFFECTS);
  }
  c = c.fact(node, { kind: "take-sink", count: count });
  const hint = expected === undefined
    ? undefined
    : c.table.node(c.table.unfold(expected));
  if (hint?.kind !== "sink") {
    c = c.report(
      "type-mismatch/010",
      "`takeSink` needs an expected Sink type to determine its input",
      node,
    );
    return c.finish(node, c.table.error, countInfo);
  }
  return c.finish(
    node,
    c.table.sink(hint.input, c.table.array(hint.input), [], [], hint.input),
    countInfo,
  );
}

function sinkTransformStreamCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
  name: "transduceStream",
): NodeInfo {
  const stream = c.argInfo(args[0], undefined);
  const producer = c.table.node(c.table.unfold(stream.type));
  const sink = c.argInfo(args[1], sinkHint(c, stream.type, args[1]));
  const consumer = c.table.node(c.table.unfold(sink.type));
  if (producer.kind !== "stream" || consumer.kind !== "sink") {
    c = c.report(
      "type-mismatch/010",
      `\`${name}\` needs Stream and Sink values`,
      node,
    );
    return c.finish(node, c.table.error, combine([stream, sink]));
  }
  c = c.checkFit(
    args[0].node,
    producer.element,
    consumer.input,
    "the sink input",
  );
  c = c.checkFit(
    args[1].node,
    consumer.leftover,
    consumer.input,
    "the replayed sink leftovers",
  );
  return c.finish(
    node,
    c.table.stream(consumer.result, [
      ...producer.failures,
      ...consumer.failures,
    ], [...producer.requirements, ...consumer.requirements]),
    combine([stream, sink]),
  );
}

function runStreamCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const stream = c.argInfo(args[0], undefined);
  const producer = c.table.node(c.table.unfold(stream.type));
  const sink = c.argInfo(args[1], sinkHint(c, stream.type, args[1]));
  const consumer = c.table.node(c.table.unfold(sink.type));
  if (producer.kind !== "stream" && !c.isError(stream.type)) {
    c = c.report(
      "type-mismatch/010",
      "`runStream` needs a Stream as its first argument",
      args[0].node,
    );
  }
  if (consumer.kind !== "sink" && !c.isError(sink.type)) {
    c = c.report(
      "type-mismatch/010",
      "`runStream` needs a Sink as its second argument",
      args[1].node,
    );
  }
  if (producer.kind !== "stream" || consumer.kind !== "sink") {
    return c.finish(node, c.table.error, combine([stream, sink, EFFECT_ONLY]));
  }
  c = c.checkFit(
    args[1].node,
    producer.element,
    consumer.input,
    "the sink input",
  );
  return c.finish(
    node,
    consumer.result,
    combine([stream, sink, {
      failures: [...producer.failures, ...consumer.failures],
      requirements: [...producer.requirements, ...consumer.requirements],
      mode: "effect",
    }]),
  );
}

function bufferStreamCall(
  c: StreamContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const stream = streamArg(c, "bufferStream", args[0]).info;
  const option = streamBufferCapacity(c, args[1]);
  c = option.context;
  c = c.fact(node, { kind: "buffer-stream", capacity: option.capacity });
  return c.finish(node, stream.type, combine([stream, option.info]));
}

/**
 * The Stream shape of a checked argument. When it is neither a Stream nor an
 * error, this reports `type-mismatch/010` and returns the other shape.
 */
function streamOf(
  c: StreamContext,
  name: string,
  arg: Arg,
  info: NodeInfo,
): TypeNode {
  const source = c.table.node(c.table.unfold(info.type));
  if (source.kind !== "stream" && !c.isError(info.type)) {
    c = c.report(
      "type-mismatch/010",
      `\`${name}\` needs a Stream value`,
      arg.node,
    );
  }
  return source;
}

/** Checks an argument that must be a Stream and gives its shape and element type. */
function streamArg(c: StreamContext, name: string, arg: Arg): {
  info: NodeInfo;
  source: TypeNode;
  element: TypeRef;
} {
  const info = c.argInfo(arg, undefined);
  const source = streamOf(c, name, arg, info);
  return {
    info: info,
    source: source,
    element: source.kind === "stream" ? source.element : c.table.error,
  };
}

/**
 * The expected Sink type for a sink argument of a stream. The input is the
 * stream element, and no channels are allowed. `takeSink` needs the element
 * to find its input and has an array of it as result. `sinkForEach` gets the
 * element as the type of its callback parameter and has the unit result.
 * An expected type also constrains each `if` and `match` branch, so a sink
 * with no `takeSink` result, such as a branch between named sinks, gets no
 * expected type. A `sinkForEach` only gets one when it is the whole argument,
 * because a branch could add failures that the hint does not allow.
 */
function sinkHint(
  c: StreamContext,
  stream: TypeRef,
  sink: Arg,
): TypeRef | undefined {
  const producer = c.table.node(c.table.unfold(stream));
  if (producer.kind !== "stream" || sink.pre !== undefined) {
    return undefined;
  }
  if (resultsInSink(c, sink.node, "takeSink", true)) {
    return c.table.sink(
      producer.element,
      c.table.array(producer.element),
      [],
      [],
      producer.element,
    );
  }
  return resultsInSink(c, sink.node, "sinkForEach", false)
    ? c.table.sink(producer.element, c.table.unit, [], [], c.table.never)
    : undefined;
}

/**
 * Whether a direct call of the named sink builtin is a result of the
 * expression: the expression itself, or the result of a block inside it.
 * With `branches`, also a branch of an `if` or an arm of a `match`.
 */
function resultsInSink(
  c: StreamContext,
  node: NodeId,
  name: "takeSink" | "sinkForEach",
  branches: boolean,
): boolean {
  const kids = c.kids(node);
  const kind = kindOf(c.tree, node);
  if (kind === SyntaxKind.CallExpr) {
    const target = kids[0] === undefined ? undefined : c.targets.get(kids[0]);
    return target?.kind === "builtin" && target.name === name;
  }
  if (kind === SyntaxKind.ParenExpr) {
    return kids[0] !== undefined && resultsInSink(c, kids[0], name, branches);
  }
  if (kind === SyntaxKind.Block) {
    const last = kids.at(-1);
    return last !== undefined &&
      kindOf(c.tree, last) !== SyntaxKind.ConstDecl &&
      resultsInSink(c, last, name, branches);
  }
  if (kind === SyntaxKind.IfExpr) {
    return branches &&
      kids.slice(1, 3).some((branch) =>
        resultsInSink(c, branch, name, branches)
      );
  }
  if (kind === SyntaxKind.MatchExpr) {
    return branches && kids.slice(1).some((arm) => {
      if (kindOf(c.tree, arm) !== SyntaxKind.MatchArm) return false;
      const parts = c.kids(arm);
      const pattern = parts.find((child) =>
        isPatternKind(kindOf(c.tree, child))
      );
      const body = parts.filter((child) => child !== pattern).pop();
      return body !== undefined && resultsInSink(c, body, name, branches);
    });
  }
  return false;
}

type StreamBufferCapacity = {
  readonly context: StreamContext;
  readonly capacity: number | undefined;
  readonly info: NodeInfo;
};

function streamBufferCapacity(
  c: StreamContext,
  arg: Arg,
): StreamBufferCapacity {
  const record = c.literalRecord(arg, 1);
  const capacity = record.ok ? record.value.get("capacity") : undefined;
  const value = capacity?.value;
  if (
    capacity === undefined || typeof value !== "number" ||
    !Number.isSafeInteger(value) || value <= 0
  ) {
    c = c.report(
      "type-mismatch/010",
      "`bufferStream` needs `{ capacity: N }` with a positive safe integer literal",
      arg.node,
    );
    return {
      context: c,
      capacity: undefined,
      info: c.argInfo(arg, undefined),
    };
  }
  const capacityInfo = c.finish(capacity.node, c.table.int, PURE_EFFECTS);
  const info = c.finish(
    arg.node,
    c.table.record([{
      name: "capacity",
      type: capacityInfo.type,
      optional: false,
    }]),
    PURE_EFFECTS,
  );
  return { context: c, capacity: value, info: info };
}

export function streamRows(): Pick<
  Rows<PreludeCallName, StreamContext>,
  | "unfold"
  | "mapEffect"
  | "sinkForEach"
  | "takeSink"
  | "transduceStream"
  | "runStream"
  | "bufferStream"
> {
  return {
    unfold: {
      prologue: direct(2, "pure", { fact: { kind: "unfold" } }),
      handle: (c, node, _name, args) => unfoldCall(c, node, args),
    },
    mapEffect: {
      prologue: optionalLast(
        2,
        "`mapEffect` takes a Stream, a callback, and an optional concurrency record",
      ),
      handle: (c, node, _name, args) => mapEffectCall(c, node, args),
    },
    sinkForEach: {
      prologue: direct(1, "pure", { fact: { kind: "sink-for-each" } }),
      handle: (c, node, _name, args, expected) =>
        sinkForEachCall(c, node, args, expected),
    },
    takeSink: {
      prologue: direct(1, "pure", {
        fact: { kind: "take-sink", count: undefined },
      }),
      handle: (c, node, _name, args, expected) =>
        takeSinkCall(c, node, args, expected),
    },
    transduceStream: {
      prologue: direct(2, "pure", { fact: { kind: "transduce-stream" } }),
      handle: (c, node, name, args) =>
        sinkTransformStreamCall(c, node, args, name),
    },
    runStream: {
      prologue: direct(2, "effect", { fact: { kind: "run-stream" } }),
      handle: (c, node, _name, args) => runStreamCall(c, node, args),
    },
    bufferStream: {
      prologue: direct(2, "pure", {
        bailFact: { kind: "buffer-stream", capacity: undefined },
      }),
      handle: (c, node, _name, args) => bufferStreamCall(c, node, args),
    },
  };
}
