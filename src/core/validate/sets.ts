// Effect sets as sorted lists of unique identities. The order is the order of
// JavaScript string comparison, as in the serializer.

import type { ValidationFlag, ValidationTexts } from "./report.ts";
import { setFrom } from "../runtime.ts";
import type { CapabilityId, Effects, ErrorId, Execution } from "../ir.ts";

export function sortedUnique<T extends string>(items: readonly T[]): T[] {
  function compare(left: T, right: T): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }
  return [...setFrom(items)].sort(compare);
}

export function isSubset(
  small: ValidationTexts,
  large: ValidationTexts,
): ValidationFlag {
  const set = setFrom(large);
  return small.every((item) => set.has(item));
}

/** Both the failure set and the requirement set of `small` are subsets of those of `large`. */
export function effectsFit(small: Effects, large: Effects): ValidationFlag {
  return isSubset(small.failures, large.failures) &&
    isSubset(small.requirements, large.requirements);
}

export function sameSet(
  a: ValidationTexts,
  b: ValidationTexts,
): ValidationFlag {
  return isSubset(a, b) && isSubset(b, a);
}

export function minus<T extends string>(
  items: readonly T[],
  removed: ValidationTexts,
): T[] {
  const set = setFrom(removed);
  return items.filter((item) => !set.has(item));
}

/** The active effects of one evaluation: sets and mode. */
export type Active = {
  readonly failures: readonly ErrorId[];
  readonly requirements: readonly CapabilityId[];
  readonly execution: Execution;
};

export const QUIET: Active = {
  failures: [],
  requirements: [],
  execution: "pure",
};

export const EFFECT_ONLY: Active = {
  failures: [],
  requirements: [],
  execution: "effect",
};

export function effectOf(
  failures: readonly ErrorId[],
  requirements: readonly CapabilityId[],
): Active {
  return {
    failures: failures,
    requirements: requirements,
    execution: "effect",
  };
}

export function isQuiet(active: Active): ValidationFlag {
  return active.execution === "pure" && active.failures.length === 0 &&
    active.requirements.length === 0;
}

export function invocationOf(fn: {
  readonly execution: Execution;
  readonly effects: Effects;
}): Active {
  return {
    failures: fn.effects.failures,
    requirements: fn.effects.requirements,
    execution: fn.execution,
  };
}

/** The sorted union of the failure sets and of the requirement sets of the parts. */
export function unionEffects(parts: readonly Effects[]): Effects {
  return {
    failures: sortedUnique(parts.flatMap((part) => [...part.failures])),
    requirements: sortedUnique(parts.flatMap((part) => [...part.requirements])),
  };
}

/**
 * The union of several evaluations. The mode is effect when any part is
 * effect or when a set is nonempty (spec: nonempty sets require effect mode).
 */
export function combine(parts: readonly Active[]): Active {
  const failures: ErrorId[] = [];
  const requirements: CapabilityId[] = [];
  let effect = false;
  for (const part of parts) {
    for (const failure of part.failures) {
      failures[failures.length] = failure;
    }
    for (const requirement of part.requirements) {
      requirements[requirements.length] = requirement;
    }
    if (part.execution === "effect") effect = true;
  }
  const f = sortedUnique(failures);
  const r = sortedUnique(requirements);
  return {
    failures: f,
    requirements: r,
    execution: effect || f.length > 0 || r.length > 0 ? "effect" : "pure",
  };
}
