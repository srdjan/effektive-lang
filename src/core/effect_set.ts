// The algebra of effect sets: failures, requirements, and the execution mode
// of one evaluation. The checker, the lowering, and the mode solver share it.
// All sets are sorted and unique. The checker's mode is `effect` whenever a
// set is nonempty (spec, "Execution order and mode").

import type { CapabilityId, ErrorId, Execution } from "./ir.ts";
import { sortedUnique } from "./util.ts";

/** The effects of one evaluation: failures, requirements, and the mode. */
export interface EffectSet {
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  readonly mode: Execution;
}

export const PURE_EFFECTS: EffectSet = {
  failures: [],
  requirements: [],
  mode: "pure",
};

export const EFFECT_ONLY: EffectSet = {
  failures: [],
  requirements: [],
  mode: "effect",
};

/** The sorted, unique union of several lists. */
export function sortedUnion<T extends string>(
  ...lists: readonly (readonly T[])[]
): T[] {
  return sortedUnique(lists.flat());
}

/**
 * The union of several evaluations. The mode is `effect` when any part is
 * effect or when a set is nonempty.
 */
export function combine(parts: readonly EffectSet[]): EffectSet {
  const failures = sortedUnion(...parts.map((part) => part.failures));
  const requirements = sortedUnion(...parts.map((part) => part.requirements));
  const effect = parts.some((part) => part.mode === "effect");
  return {
    failures,
    requirements,
    mode: effect || failures.length > 0 || requirements.length > 0
      ? "effect"
      : "pure",
  };
}

/** True when an evaluation is pure and has no failure and no requirement. */
export function isQuiet(set: EffectSet): boolean {
  return set.mode === "pure" && set.failures.length === 0 &&
    set.requirements.length === 0;
}

/** Items of `items` that are not in `removed`, in their order. */
export function without<T extends string>(
  items: readonly T[],
  removed: readonly string[],
): T[] {
  const set = new Set<string>(removed);
  return items.filter((item) => !set.has(item));
}
