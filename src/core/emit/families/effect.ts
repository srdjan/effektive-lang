// Emission of the Effect builtins: defer, the retry forms, and run.

import {
  at,
  callArguments,
  type Emitted,
  emitted,
  free,
  type Kid,
  type Mode,
  PREC,
} from "../emitted.ts";
import { resolvedAs } from "../scope.ts";
import type { ExprOf } from "../shape.ts";
import { typeDoc } from "../types.ts";
import type { ExprCore } from "./context.ts";

type EffectStructuralKind = "defer" | "retry-schedule";

type EffectLeafKind =
  | "retry"
  | "retry-with-schedule"
  | "run"
  | "timeout"
  | "repeat"
  | "sleep"
  | "uninterruptible";

export function effectStructural(
  c: ExprCore,
  e: ExprOf<EffectStructuralKind>,
  kid: Kid,
  mode: Mode,
): Emitted {
  switch (e.kind) {
    case "defer": {
      const effect = c.scope.effect("Effect");
      const from = c.functionTypeOf(e.job.type);
      const job = from !== undefined && from.execution === "pure"
        ? c.fit(e.job, { ...from, execution: "effect" }, mode)
        : kid(e.job);
      return emitted([`${effect}.suspend`, callArguments([job])]);
    }
    case "retry-schedule": {
      const schedule = c.scope.effect("Schedule");
      const effect = c.scope.effect("Effect");
      const option = c.scope.effect("Option");
      const cause = c.scope.effect("Cause");
      const duration = c.scope.effect("Duration");
      const type = resolvedAs(
        c.scope,
        e.type,
        "retry-schedule",
        "retry schedule has wrong type",
      );
      const error = typeDoc(c.scope, type.error);
      const step = c.pure(e.step);
      const metadata = c.scope.temp();
      const decision = c.scope.temp();
      return emitted([
        `${schedule}.fromStepWithMetadata<`,
        error,
        `, number, never, never, never, never>(${effect}.succeed((${metadata}: ${schedule}.InputMetadata<`,
        error,
        `>) => { const ${decision} = `,
        at(step, PREC.member),
        `(${metadata}.input, ${metadata}.attempt); if (${option}.isNone(${decision})) return ${cause}.done(${metadata}.attempt); `,
        `if (${decision}.value < 0) throw new RangeError("negative retry delay"); `,
        `return ${effect}.succeed([${metadata}.attempt, ${duration}.millis(${decision}.value)] as [number, ${duration}.Duration]); }))`,
      ]);
    }
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

/**
 * Runs `build` on a duration that has passed the negative check. The check is a
 * defect (a thrown RangeError inside `Effect.suspend`), like the retry delay.
 */
function guardedDuration(
  c: ExprCore,
  duration: Emitted,
  build: (ms: Emitted) => Emitted,
): Emitted {
  const effect = c.scope.effect("Effect");
  const ms = c.scope.temp();
  return emitted([
    `${effect}.suspend(() => { const ${ms}: number = `,
    free(duration),
    `; if (${ms} < 0) throw new RangeError("negative duration"); return `,
    free(build(emitted(ms))),
    `; })`,
  ]);
}

export function effectLeaf(
  c: ExprCore,
  e: ExprOf<EffectLeafKind>,
  children: readonly Emitted[],
): Emitted {
  const effect = c.scope.effect("Effect");
  switch (e.kind) {
    case "run":
      return children[0];
    case "retry": {
      const job = c.suspended(e.job);
      const options = emitted(`{ times: ${e.times} }`, PREC.member, {
        huggable: true,
      });
      return emitted([`${effect}.retry`, callArguments([job, options])]);
    }
    case "retry-with-schedule":
      return emitted([
        `${effect}.retry`,
        callArguments([c.suspended(e.job), c.pure(e.options)]),
      ]);
    case "repeat": {
      const job = c.suspended(e.job);
      return e.options === null
        ? emitted([`${effect}.forever`, callArguments([job])])
        : emitted([
          `${effect}.repeat`,
          callArguments([job, c.pure(e.options)]),
        ]);
    }
    case "timeout":
      return guardedDuration(c, children[0], (ms) =>
        emitted([
          `${effect}.timeout`,
          callArguments([c.suspended(e.job), ms]),
        ]));
    case "uninterruptible":
      return emitted([
        `${effect}.uninterruptible`,
        callArguments([c.suspended(e.job)]),
      ]);
    case "sleep":
      return guardedDuration(
        c,
        children[0],
        (ms) => emitted([`${effect}.sleep`, callArguments([ms])]),
      );
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}
