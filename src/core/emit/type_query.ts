// Questions about an IR type that need no emitter state: the Effect module
// names, and the checked narrowing of a resolved type.
import type { Type } from "../ir.ts";
import type { InvariantMessage } from "../source.ts";
import { internal } from "./failure.ts";
export type EffectModule =
  | "Effect"
  | "Context"
  | "Layer"
  | "Option"
  | "Schema"
  | "SchemaIssue"
  | "SchemaGetter"
  | "SchemaTransformation"
  | "Stream"
  | "Sink"
  | "SynchronizedRef"
  | "Schedule"
  | "Duration"
  | "Cause"
  | "Clock"
  | "Random"
  | "Exit"
  | "Scope";
function hasKind<K extends Type["kind"]>(
  type: Type,
  kind: K,
): type is Extract<Type, {
  readonly kind: K;
}> {
  return type.kind === kind;
}
/** `type` after `resolve`, when it has `kind`. Else an internal failure with `message`. */
export function resolvedAs<K extends Type["kind"]>(
  scope: {
    resolve(type: Type): Type;
  },
  type: Type,
  kind: K,
  message: InvariantMessage,
): Extract<Type, {
  readonly kind: K;
}> {
  const resolved = scope.resolve(type);
  if (!hasKind(resolved, kind)) {
    return internal(message);
  }
  return resolved;
}
