// Emission of the Effect builtins: defer, race-all, the retry and repeat forms,
// timeout, sleep, now, log, random, uninterruptible, and run.

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
import type { Expr } from "../../ir.ts";
import { resolvedAs } from "../type_query.ts";
import { type ExprOf, type LeafOf, repeatOperands } from "../shape.ts";
import { typeDoc } from "../types.ts";
import type { ExprCore } from "./context.ts";

type EffectStructuralKind = "defer" | "retry-schedule" | "race-all";

type EffectLeafKind = LeafOf<
  | "retry"
  | "retry-with-schedule"
  | "run"
  | "timeout"
  | "repeat"
  | "sleep"
  | "now"
  | "log"
  | "random"
  | "random-int"
  | "uninterruptible"
>;

/**
 * The emitted value of each operand that the shape table hoists, in operand
 * order, and undefined for an operand that stays deferred. `children` holds
 * only the hoisted operands.
 */
function hoistedOperands(
  operands: readonly Expr[],
  children: readonly Emitted[],
): (Emitted | undefined)[] {
  let next = 0;
  return operands.map((x) =>
    x.execution === "effect" ? children[next++] : undefined
  );
}

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
      // An effectful step expression runs once, where the source writes it.
      // The returned schedule applies the value, so it cannot run the step.
      const stepName = e.step.execution === "effect" ? c.scope.temp() : null;
      const step = stepName === null ? c.pure(e.step) : emitted(stepName);
      const metadata = c.scope.temp();
      const decision = c.scope.temp();
      const built = emitted([
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
      return stepName === null ? built : emitted(
        ["((", stepName, ") => ", free(built), ")(", free(kid(e.step)), ")"],
        PREC.member,
      );
    }
    case "race-all": {
      const effect = c.scope.effect("Effect");
      const jobs = c.scope.temp();
      // The array is evaluated at the call, like the operands of `race(left, right)`.
      return emitted([
        `((${jobs}) => ${jobs}.length === 0 ? ${effect}.die(new RangeError("race of no jobs")) : ${effect}.raceAll(${jobs}))(`,
        free(kid(e.jobs)),
        ")",
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
  if (e.kind === "now") {
    return emitted(`${c.scope.effect("Clock")}.currentTimeMillis`);
  }
  if (e.kind === "random") {
    return emitted(`${c.scope.effect("Random")}.next`);
  }
  const effect = c.scope.effect("Effect");
  switch (e.kind) {
    case "log": {
      // `annotateLogs(effect, record)` evaluates the message, then the fields, once.
      const entry = emitted([
        // The Effect severity is the level name with a capital first letter.
        `${effect}.logWithLevel("${
          e.level.charAt(0).toUpperCase() + e.level.slice(1)
        }")`,
        callArguments([children[0]]),
      ]);
      return children[1] === undefined ? entry : emitted([
        `${effect}.annotateLogs`,
        callArguments([entry, children[1]]),
      ]);
    }
    case "random-int": {
      // The bound check is a defect, like the negative duration.
      const random = c.scope.effect("Random");
      const min = c.scope.temp();
      const max = c.scope.temp();
      return emitted([
        `${effect}.suspend(() => { const ${min}: number = `,
        free(children[0]),
        `; const ${max}: number = `,
        free(children[1]),
        `; if (!(${max} > ${min})) throw new RangeError("randomInt needs max greater than min"); return ${random}.nextIntBetween(${min}, ${max}, { halfOpen: true }); })`,
      ]);
    }
    case "run":
      return children[0];
    case "retry": {
      const [hoisted] = hoistedOperands([e.job], children);
      const job = c.suspended(e.job, hoisted);
      const options = emitted(`{ times: ${e.times} }`, PREC.member, {
        huggable: true,
      });
      return emitted([`${effect}.retry`, callArguments([job, options])]);
    }
    case "retry-with-schedule": {
      const [jobValue, options] = hoistedOperands([e.job, e.options], children);
      return emitted([
        `${effect}.retry`,
        callArguments([
          c.suspended(e.job, jobValue),
          options ?? c.pure(e.options),
        ]),
      ]);
    }
    case "repeat": {
      const [jobValue, options] = hoistedOperands(repeatOperands(e), children);
      const job = c.suspended(e.job, jobValue);
      return e.options === null
        ? emitted([`${effect}.forever`, callArguments([job])])
        : emitted([
          `${effect}.repeat`,
          callArguments([job, options ?? c.pure(e.options)]),
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
