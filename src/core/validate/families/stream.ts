// Validation of the Stream builtins: the sources, the element operators, the sinks,
// and the Stream runners. The tables of the operator kinds sit here.

import type { Expr } from "../../ir.ts";
import { AREA } from "../report.ts";
import {
  combine,
  invocationOf,
  isQuiet,
  QUIET,
  unionEffects,
} from "../sets.ts";
import { asFunction, fits, NEVER, unfold, UNIT } from "../typing.ts";
import { streamState, type ValidatorCore } from "./context.ts";
import { type Comp, derivedResult } from "../results.ts";

/** The Stream operators that map the elements, with the callback rule and the message. */
type StreamMap = Extract<Expr, { kind: "map-effect" | "map-stream" }>;

const STREAM_MAPS: Record<
  StreamMap["kind"],
  {
    readonly name: string;
    /** The callback must be pure. Its effects then stay out of the result. */
    readonly pure: boolean;
    readonly needs: string;
  }
> = {
  "map-effect": {
    name: "mapEffect",
    pure: false,
    needs: "mapEffect needs a Stream and an element callback",
  },
  "map-stream": {
    name: "mapStream",
    pure: true,
    needs: "mapStream needs a Stream and a pure element callback",
  },
};

export function unfoldStream(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "unfold" }>,
  path: string,
): Comp {
  const seed = c.check(e.seed, `${path}.seed`);
  const next = c.check(e.next, `${path}.next`);
  const fn = asFunction(c.env, next.type);
  if (e.next.kind !== "closure") {
    c.add(
      AREA.control,
      `${path}.next`,
      "unfold requires an inline closure",
      e.next.span,
    );
  }
  const state = streamState(c.env, seed.type);
  if (
    fn === undefined || fn.parameters.length !== 1 ||
    !fits(c.env, state, fn.parameters[0])
  ) {
    c.add(
      AREA.types,
      `${path}.next`,
      "unfold needs a callback accepting the state",
      e.next.span,
    );
    return c.poison();
  }
  const option = unfold(c.env, fn.result);
  const pair = option.kind === "option"
    ? unfold(c.env, option.element)
    : undefined;
  if (
    pair?.kind !== "tuple" || pair.elements.length !== 2 ||
    !fits(c.env, pair.elements[1], state)
  ) {
    c.add(
      AREA.types,
      `${path}.next`,
      "unfold callback must return Option<[Element, State]>",
      e.next.span,
    );
    return c.poison();
  }
  return derivedResult({
    kind: "stream",
    element: pair.elements[0],
    effects: fn.effects,
  }, combine([seed, next]));
}

export function mapElements(
  c: ValidatorCore,
  e: StreamMap,
  path: string,
): Comp {
  const row = STREAM_MAPS[e.kind];
  if (e.kind === "map-effect") c.checkConcurrency(e, path, row.name);
  const stream = c.check(e.stream, `${path}.stream`);
  const transform = c.check(e.transform, `${path}.transform`);
  const source = unfold(c.env, stream.type);
  const fn = asFunction(c.env, transform.type);
  if (e.transform.kind !== "closure") {
    c.add(
      AREA.control,
      `${path}.transform`,
      `${row.name} requires an inline closure`,
      e.transform.span,
    );
  }
  if (
    source.kind !== "stream" || fn === undefined ||
    fn.parameters.length !== 1 ||
    !fits(c.env, source.element, fn.parameters[0]) ||
    (row.pure && !isQuiet(invocationOf(fn)))
  ) {
    c.add(AREA.types, path, row.needs, e.span);
    return c.poison();
  }
  return derivedResult({
    kind: "stream",
    element: fn.result,
    effects: row.pure
      ? source.effects
      : { ...unionEffects(source.effects, fn.effects) },
  }, combine([stream, transform]));
}

export function sinkForEach(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "sink-for-each" }>,
  path: string,
): Comp {
  const consume = c.check(e.consume, `${path}.consume`);
  const fn = asFunction(c.env, consume.type);
  if (e.consume.kind !== "closure") {
    c.add(
      AREA.control,
      `${path}.consume`,
      "sinkForEach requires an inline closure",
      e.consume.span,
    );
  }
  if (
    fn === undefined || fn.parameters.length !== 1 ||
    !fits(c.env, fn.result, UNIT)
  ) {
    c.add(
      AREA.types,
      path,
      "sinkForEach needs a one-argument void callback",
      e.span,
    );
    return c.poison();
  }
  return derivedResult({
    kind: "sink",
    input: fn.parameters[0],
    result: UNIT,
    effects: fn.effects,
  }, combine([consume]));
}

export function takeSink(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "take-sink" }>,
  path: string,
): Comp {
  if (!Number.isSafeInteger(e.count) || e.count <= 0) {
    c.add(
      AREA.control,
      path,
      "takeSink needs a positive safe integer count",
      e.span,
    );
  }
  const sink = unfold(c.env, e.type);
  if (sink.kind !== "sink") {
    c.add(AREA.types, path, "takeSink needs a Sink annotation", e.span);
    return c.poison();
  }
  return derivedResult({
    kind: "sink",
    input: sink.input,
    result: { kind: "array", element: sink.input },
    leftover: sink.input,
    effects: { failures: [], requirements: [] },
  }, QUIET);
}

export function transduceStream(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "transduce-stream" }>,
  path: string,
): Comp {
  return sinkTransformStream(c, e, path, "transduceStream");
}

function sinkTransformStream(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "transduce-stream" }>,
  path: string,
  name: "transduceStream",
): Comp {
  const stream = c.check(e.stream, `${path}.stream`);
  const sink = c.check(e.sink, `${path}.sink`);
  const source = unfold(c.env, stream.type);
  const consumer = unfold(c.env, sink.type);
  if (
    source.kind !== "stream" || consumer.kind !== "sink" ||
    !fits(c.env, source.element, consumer.input) ||
    !fits(c.env, consumer.leftover ?? NEVER, consumer.input)
  ) {
    c.add(
      AREA.types,
      path,
      `${name} needs compatible input and replayable Sink leftovers`,
      e.span,
    );
    return c.poison();
  }
  return derivedResult({
    kind: "stream",
    element: consumer.result,
    effects: {
      ...unionEffects(source.effects, consumer.effects),
    },
  }, combine([stream, sink]));
}

export function runStream(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "run-stream" }>,
  path: string,
): Comp {
  const stream = c.check(e.stream, `${path}.stream`);
  const sink = c.check(e.sink, `${path}.sink`);
  const source = unfold(c.env, stream.type);
  const consumer = unfold(c.env, sink.type);
  if (
    source.kind !== "stream" || consumer.kind !== "sink" ||
    !fits(c.env, source.element, consumer.input)
  ) {
    c.add(
      AREA.types,
      path,
      "runStream needs compatible Stream and Sink values",
      e.span,
    );
    return c.poison();
  }
  return derivedResult(
    consumer.result,
    combine([stream, sink, {
      ...unionEffects(source.effects, consumer.effects),
      execution: "effect",
    }]),
  );
}

export function bufferStream(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "buffer-stream" }>,
  path: string,
): Comp {
  const stream = c.check(e.stream, `${path}.stream`);
  const source = unfold(c.env, stream.type);
  if (source.kind !== "stream") {
    c.add(AREA.types, path, "bufferStream needs a Stream value", e.span);
    return c.poison();
  }
  if (!Number.isSafeInteger(e.capacity) || e.capacity <= 0) {
    c.add(
      AREA.control,
      path,
      "bufferStream capacity must be a positive safe integer",
      e.span,
    );
  }
  return derivedResult(source, combine([stream]));
}
