// Emission of the Stream and Sink builtins: the stream operators and the sink
// operators.

import {
  at,
  callArguments,
  concurrencyArguments,
  type Emitted,
  emitted,
  type Kid,
  PREC,
} from "../emitted.ts";
import { resolvedAs } from "../module_state.ts";
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
  switch (e.kind) {
    case "unfold": {
      const stream = c.scope.effect("Stream");
      const effect = c.scope.effect("Effect");
      const option = c.scope.effect("Option");
      const state = c.scope.temp();
      const callback = c.effectCallback(e.next);
      const next = emitted([
        `${effect}.map`,
        callArguments([
          emitted([
            at(callback, PREC.member),
            callArguments([emitted(state)]),
          ]),
          emitted(`${option}.getOrUndefined`),
        ]),
      ]);
      return emitted([
        `${stream}.unfold`,
        callArguments([
          kid(e.seed),
          emitted(c.arrow(`(${state})`, next)),
        ]),
      ]);
    }
    case "map-effect": {
      const stream = c.scope.effect("Stream");
      return emitted([
        `${stream}.mapEffect`,
        callArguments([
          kid(e.stream),
          c.effectCallback(e.transform),
          ...concurrencyArguments(e.concurrency),
        ]),
      ]);
    }
    case "take-sink": {
      const type = resolvedAs(
        c.scope,
        e.type,
        "sink",
        "takeSink has no Sink type",
      );
      return emitted([
        `${c.scope.effect("Sink")}.take`,
        typeArguments([typeDoc(c.scope, type.input)]),
        callArguments([emitted(String(e.count))]),
      ]);
    }
    case "transduce-stream": {
      const message = "transduction has invalid operands";
      const source = resolvedAs(c.scope, e.stream.type, "stream", message);
      const sink = resolvedAs(c.scope, e.sink.type, "sink", message);
      return emitted([
        `${c.scope.effect("Stream")}.transduce`,
        typeArguments([
          typeDoc(c.scope, sink.input),
          ...channelTypeArguments(c.scope, source.effects),
          typeDoc(c.scope, sink.result),
          ...channelTypeArguments(c.scope, sink.effects),
        ]),
        callArguments([kid(e.stream), kid(e.sink)]),
      ]);
    }
    case "buffer-stream": {
      const stream = c.scope.effect("Stream");
      return emitted([
        `${stream}.buffer`,
        callArguments([
          kid(e.stream),
          emitted(`{ capacity: ${e.capacity}, strategy: "suspend" }`),
        ]),
      ]);
    }
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}
