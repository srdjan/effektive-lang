// The result types of the body validator: what a checked node contributes to
// its parent, and the annotation that the validator recomputes for a node.
// `expr.ts` and the builtin families share them.

import type { Type } from "../ir.ts";
import type { Active } from "./sets.ts";

/** What a checked node contributes to its parent. */
export interface Out extends Active {
  readonly type: Type;
}

/** The recomputed annotation of a node. */
export type Comp =
  | {
    readonly kind: "derived";
    readonly type: Type;
    /** Exact equality, or assignability to the recorded type. */
    readonly match: "exact" | "fit";
    readonly active: Active;
  }
  /** The node checks its own type, or reports why it cannot be recomputed. */
  | { readonly kind: "checked"; readonly active: Active }
  /** Effects cannot be recomputed; the recorded sets stand. */
  | { readonly kind: "poisoned" };

export function derivedResult(
  type: Type,
  active: Active,
  match: "exact" | "fit" = "exact",
): Comp {
  return { kind: "derived", type, active, match };
}
