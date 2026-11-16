// Emission of the Stream and Sink builtins: the stream operators and the sink
// operators.
import {
  at,
  callArguments,
  concurrencyArguments,
  type Emitted,
  type Kid,
  plainEmitted,
  PREC,
} from "../emitted.ts";
import { resolvedAs } from "../type_query.ts";
import type { ExprOf } from "../shape.ts";
import { channelTypeArguments, typeArguments, typeDoc } from "../types.ts";
import type { ExprCore } from "./context.ts";
type StreamStructuralKind =
  | "unfold"
  | "map-effect"
  | "take-sink"
  | "transduce-stream"
  | "buffer-stream";
export function streamStructural(
  c: ExprCore,
  e: ExprOf<StreamStructuralKind>,
  kid: Kid,
): Emitted {
  if (e.kind === "unfold") {
    const stream = c.scope.effect("Stream");
    const effect = c.scope.effect("Effect");
    const option = c.scope.effect("Option");
    const state = c.scope.temp();
    const callback = c.effectCallback(e.next);
    const next = plainEmitted([
      `${effect}.map`,
      callArguments([
        plainEmitted([
          at(callback, PREC.member),
          callArguments([plainEmitted(state)]),
        ]),
        plainEmitted(`${option}.getOrUndefined`),
      ]),
    ]);
    return plainEmitted([
      `${stream}.unfold`,
      callArguments([
        kid(e.seed, undefined),
        plainEmitted(c.arrow(`(${state})`, next, undefined)),
      ]),
    ]);
  }
  if (e.kind === "map-effect") {
    const stream = c.scope.effect("Stream");
    return plainEmitted([
      `${stream}.mapEffect`,
      callArguments([
        kid(e.stream, undefined),
        c.effectCallback(e.transform),
        ...concurrencyArguments(e.concurrency),
      ]),
    ]);
  }
  if (e.kind === "take-sink") {
    const type = resolvedAs(
      c.scope,
      e.type,
      "sink",
      "takeSink has no Sink type",
    );
    return plainEmitted([
      `${c.scope.effect("Sink")}.take`,
      typeArguments([typeDoc(c.scope, type.input, undefined)]),
      callArguments([
        plainEmitted(String(e.count)),
      ]),
    ]);
  }
  if (e.kind === "transduce-stream") {
    const message = "transduction has invalid operands";
    const source = resolvedAs(c.scope, e.stream.type, "stream", message);
    const sink = resolvedAs(c.scope, e.sink.type, "sink", message);
    return plainEmitted([
      `${c.scope.effect("Stream")}.transduce`,
      typeArguments([
        typeDoc(c.scope, sink.input, undefined),
        ...channelTypeArguments(c.scope, source.effects),
        typeDoc(c.scope, sink.result, undefined),
        ...channelTypeArguments(c.scope, sink.effects),
      ]),
      callArguments([kid(e.stream, undefined), kid(e.sink, undefined)]),
    ]);
  }
  if (e.kind === "buffer-stream") {
    const stream = c.scope.effect("Stream");
    return plainEmitted([
      `${stream}.buffer`,
      callArguments([
        kid(e.stream, undefined),
        plainEmitted(`{ capacity: ${e.capacity}, strategy: "suspend" }`),
      ]),
    ]);
  }
  const unreachable: never = e;
  return unreachable;
}
