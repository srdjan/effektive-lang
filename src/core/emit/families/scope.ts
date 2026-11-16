// Emission of the Scope builtins: forkScoped and the `using` block.
import {
  at,
  callArguments,
  type Emitted,
  emitted,
  plainEmitted,
  PREC,
} from "../emitted.ts";
import { internal } from "../failure.ts";
import type { ExprOf, LeafOf } from "../shape.ts";
import type { ExprCore } from "./context.ts";
import type { ClosureExpr } from "../../ir.ts";
/** `(r, exit) => release(r, outcome(exit))`, the release callback of `acquireUseRelease`. */
function releaseWithOutcome(c: ExprCore, release: ClosureExpr): Emitted {
  const resource = c.scope.temp();
  const exit = c.scope.temp();
  const call = plainEmitted([
    at(c.closure(release, true, true), PREC.member),
    callArguments([
      emitted(resource, undefined, undefined),
      emitted(
        `${c.scope.outcome().make}(${exit})`,
        undefined,
        undefined,
      ),
    ]),
  ]);
  return emitted(
    c.arrow(`(${resource}, ${exit})`, call, undefined),
    PREC.yield,
    undefined,
  );
}
type ScopeLeafKind = LeafOf<"fork-scoped" | "with-resource">;
export function scopeLeaf(
  c: ExprCore,
  e: ExprOf<ScopeLeafKind>,
  children: readonly Emitted[],
): Emitted {
  const effect = c.scope.effect("Effect");
  if (e.kind === "fork-scoped") {
    return plainEmitted([
      `${effect}.as`,
      callArguments([
        emitted(
          [`${effect}.forkScoped`, callArguments([children[0]])],
          undefined,
          undefined,
        ),
        emitted("undefined", undefined, undefined),
      ]),
    ]);
  }
  if (e.kind === "with-resource") {
    if (
      e.acquire.kind !== "closure" || e.use.kind !== "closure" ||
      e.release.kind !== "closure"
    ) {
      return internal("with-resource requires three closures");
    }
    const acquire = c.closure(e.acquire, false, true);
    const use = c.closure(e.use, false, true);
    const release = e.release.parameters.length === 2
      ? releaseWithOutcome(c, e.release)
      : c.closure(e.release, false, true);
    return plainEmitted([
      `${effect}.acquireUseRelease`,
      callArguments([
        emitted(
          [`${effect}.suspend`, callArguments([acquire])],
          undefined,
          undefined,
        ),
        use,
        release,
      ]),
    ]);
  }
  const unreachable: never = e;
  return unreachable;
}
