// Questions about an IR type that need no emitter state: the Effect module
// names, the deferred Type kinds, and the checked narrowing of a resolved type.

import type { Type } from "../ir.ts";
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

/**
 * The Type kinds that have no schema and no runtime value: functions and the
 * effectful or handle types. The type printers throw for them, and an alias
 * that contains one is type-only.
 */
type DeferredKind =
  | "function"
  | "effect"
  | "stream"
  | "sink"
  | "provider"
  | "ref"
  | "retry-schedule"
  | "schema";

type DeferredType = Extract<Type, { readonly kind: DeferredKind }>;

const DEFERRED_KINDS = {
  "function": true,
  "effect": true,
  "stream": true,
  "sink": true,
  "provider": true,
  "ref": true,
  "retry-schedule": true,
  "schema": true,
} as const satisfies Record<DeferredKind, true>;

/**
 * True for a deferred Type kind. After this guard fails, a switch over the
 * rest of the kinds is exhaustive, so a new kind is a compile error there.
 */
export function isDeferredType(type: Type): type is DeferredType {
  return Object.hasOwn(DEFERRED_KINDS, type.kind);
}

function hasKind<K extends Type["kind"]>(
  type: Type,
  kind: K,
): type is Extract<Type, { readonly kind: K }> {
  return type.kind === kind;
}

/** `type` after `resolve`, when it has `kind`. Else an internal failure with `message`. */
export function resolvedAs<K extends Type["kind"]>(
  scope: { resolve(type: Type): Type },
  type: Type,
  kind: K,
  message: string,
): Extract<Type, { readonly kind: K }> {
  const resolved = scope.resolve(type);
  if (!hasKind(resolved, kind)) throw internal(message);
  return resolved;
}
