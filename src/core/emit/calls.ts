// The simple calls of the emitter. A simple call prints as `callee(operands)`
// and differs from another only in the callee and in how it prints each
// operand. One table states the structural kinds, and one table states the leaf
// kinds. A kind that is in neither table needs its own case in `expr.ts`, and
// the compiler rejects a kind that has neither.

import type { Expr } from "../ir.ts";
import type { EffectModule } from "./type_query.ts";
import type { ExprOf } from "./shape.ts";

export interface Callee {
  readonly kind: "method";
  readonly module: EffectModule;
  readonly method: string;
}

function method(module: EffectModule, name: string): Callee {
  return { kind: "method", module, method: name };
}

/**
 * How the emitter prints an operand.
 * - `value`: the expression as it is.
 * - `callback`: a closure prints without parameter types.
 * - `effect-callback`: a function value prints as an effect function.
 */
export type Treatment = "value" | "callback" | "effect-callback";

type Operand = readonly [expression: Expr, treatment: Treatment];

interface OperandCall<E extends Expr> {
  readonly callee: Callee;
  readonly operands: (e: E) => readonly Operand[];
}

/** The structural kinds that print as a simple call. */
export type OperandCallKind =
  | "map-stream"
  | "sink-for-each"
  | "merge-layers"
  | "race";

export const OPERAND_CALLS: {
  readonly [K in OperandCallKind]: OperandCall<ExprOf<K>>;
} = {
  "map-stream": {
    callee: method("Stream", "map"),
    operands: (e) => [[e.stream, "value"], [e.transform, "callback"]],
  },
  "sink-for-each": {
    callee: method("Sink", "forEach"),
    operands: (e) => [[e.consume, "effect-callback"]],
  },
  "merge-layers": {
    callee: method("Layer", "merge"),
    operands: (e) => [[e.left, "value"], [e.right, "value"]],
  },
  race: {
    callee: method("Effect", "race"),
    operands: (e) => [[e.left, "value"], [e.right, "value"]],
  },
};

/**
 * The leaf kinds that print as a call of their evaluated children. The
 * emitter prints the children first, so a row states the callee only.
 */
type LeafCallKind =
  | "fail"
  | "scoped"
  | "run-stream"
  | "make-ref"
  | "get-ref"
  | "set-ref"
  | "update-ref";

/** `updateRef` with an effectful callback. */
export const UPDATE_REF_EFFECT: Callee = method(
  "SynchronizedRef",
  "updateEffect",
);

export const LEAF_CALLS: { readonly [K in LeafCallKind]: Callee } = {
  fail: method("Effect", "fail"),
  scoped: method("Effect", "scoped"),
  "run-stream": method("Stream", "run"),
  "make-ref": method("SynchronizedRef", "make"),
  "get-ref": method("SynchronizedRef", "get"),
  "set-ref": method("SynchronizedRef", "set"),
  "update-ref": method("SynchronizedRef", "update"),
};
