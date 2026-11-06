import type { Term } from "./predicates.ts";

/** One term of a linear integer expression with its non-zero or zero coefficient. */
export interface LinearTerm {
  readonly term: Term;
  readonly coefficient: bigint;
}

/** A sum of terms plus an integer offset. The caller chooses the key of each term. */
export interface Linear {
  readonly terms: ReadonlyMap<string, LinearTerm>;
  readonly offset: bigint;
}

/** Returns `left + scale * right`. Terms with equal keys merge. */
export function addLinear(left: Linear, right: Linear, scale: bigint): Linear {
  const terms = new Map(left.terms);
  for (const [key, item] of right.terms) {
    terms.set(key, {
      term: item.term,
      coefficient: (terms.get(key)?.coefficient ?? 0n) +
        item.coefficient * scale,
    });
  }
  return { terms, offset: left.offset + right.offset * scale };
}

/** The two terms of a difference constraint `positive - negative`. */
interface DifferenceShape {
  readonly positive: Term;
  readonly negative: Term;
  /** True when the expression has no term with a non-zero coefficient. */
  readonly constant: boolean;
}

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
