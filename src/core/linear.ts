import type { Term } from "./predicates.ts";
import { mapFrom } from "./runtime.ts";

/** One term of a linear integer expression with its non-zero or zero coefficient. */
type LinearTerm = {
  readonly term: Term;
  readonly coefficient: bigint;
};

/** A sum of terms plus an integer offset. The caller chooses the key of each term. */
export type Linear = {
  readonly terms: ReadonlyMap<string, LinearTerm>;
  readonly offset: bigint;
};

/** Returns `left + scale * right`. Terms with equal keys merge. */
export function addLinear(left: Linear, right: Linear, scale: bigint): Linear {
  let terms = mapFrom(left.terms);
  for (const entry of right.terms) {
    const key = entry[0];
    const item = entry[1];
    terms = terms.set(key, {
      term: item.term,
      coefficient: (terms.get(key)?.coefficient ?? 0n) +
        item.coefficient * scale,
    });
  }
  return { terms: terms, offset: left.offset + right.offset * scale };
}

/** The two terms of a difference constraint `positive - negative`. */
type DifferenceShape = {
  readonly positive: Term;
  readonly negative: Term;
  /** True when the expression has no term with a non-zero coefficient. */
  readonly constant: boolean;
};

/**
 * Reads a linear expression as a difference constraint. An expression has this shape when at
 * most one term has coefficient 1, at most one has coefficient -1, and none has another
 * non-zero coefficient. A missing side is the zero term.
 */
export function differenceShape(linear: Linear): DifferenceShape | undefined {
  const terms = [...linear.terms.values()].filter((item) =>
    item.coefficient !== 0n
  );
  if (
    terms.length > 2 ||
    terms.filter((item) => item.coefficient === 1n).length > 1 ||
    terms.filter((item) => item.coefficient === -1n).length > 1 ||
    terms.some((item) => item.coefficient !== 1n && item.coefficient !== -1n)
  ) return undefined;
  return {
    positive: terms.find((item) => item.coefficient === 1n)?.term ??
      { kind: "zero" },
    negative: terms.find((item) => item.coefficient === -1n)?.term ??
      { kind: "zero" },
    constant: terms.length === 0,
  };
}
