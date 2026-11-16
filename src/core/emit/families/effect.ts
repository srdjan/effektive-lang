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
  plainEmitted,
  PREC,
} from "../emitted.ts";
import { resolvedAs } from "../type_query.ts";
import {
  type ExprOf,
  hoistedOperands,
  isStableValue,
  type LeafOf,
  repeatOperands,
} from "../shape.ts";
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
export function effectStructural(
  c: ExprCore,
  e: ExprOf<EffectStructuralKind>,
  kid: Kid,
  mode: Mode,
): Emitted {
  if (e.kind === "defer") {
    {
      const effect = c.scope.effect("Effect");
      const from = c.functionTypeOf(e.job.type);
      const job = from !== undefined && from.execution === "pure"
        ? c.fit(e.job, { ...from, execution: "effect" }, mode)
        : kid(e.job, undefined);
      return plainEmitted([`${effect}.suspend`, callArguments([job])]);
    }
  }
  if (e.kind === "retry-schedule") {
    {
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
      const error = typeDoc(c.scope, type.error, undefined);
      // A step expression that computes its callback runs once, where the
      // source writes it. The returned schedule applies the value on each
      // attempt, so it cannot run the expression. A stable step stays inline.
      const bound = e.step.execution === "effect" || !isStableValue(e.step);
      const stepName = bound ? c.scope.temp() : null;
      const step = stepName === null
        ? c.pure(e.step, undefined)
        : plainEmitted(stepName);
      const metadata = c.scope.temp();
      const decision = c.scope.temp();
      const built = plainEmitted([
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
        [
          "((",
          stepName,
          ") => ",
          free(built),
          ")(",
          free(kid(e.step, undefined)),
          ")",
        ],
        PREC.member,
        undefined,
      );
    }
  }
  if (e.kind === "race-all") {
    {
      const effect = c.scope.effect("Effect");
      const jobs = c.scope.temp();
      // The array is evaluated at the call, like the operands of `race(left, right)`.
      return plainEmitted([
        `((${jobs}) => ${jobs}.length === 0 ? ${effect}.die(new RangeError("race of no jobs")) : ${effect}.raceAll(${jobs}))(`,
        free(kid(e.jobs, undefined)),
        ")",
      ]);
    }
  }
  {
    const unreachable: never = e;
    return unreachable;
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
  return plainEmitted([
    `${effect}.suspend(() => { const ${ms}: number = `,
    free(duration),
    `; if (${ms} < 0) throw new RangeError("negative duration"); return `,
    free(build(emitted(ms, undefined, undefined))),
    `; })`,
  ]);
}
export function effectLeaf(
  c: ExprCore,
  e: ExprOf<EffectLeafKind>,
  children: readonly Emitted[],
): Emitted {
  if (e.kind === "now") {
    return plainEmitted(`${c.scope.effect("Clock")}.currentTimeMillis`);
  }
  if (e.kind === "random") {
    return plainEmitted(`${c.scope.effect("Random")}.next`);
  }
  const effect = c.scope.effect("Effect");
  if (e.kind === "log") {
    {
      // `annotateLogs(effect, record)` evaluates the message, then the fields, once.
      const entry = plainEmitted([
        // The Effect severity is the level name with a capital first letter.
        `${effect}.logWithLevel("${
          e.level.charAt(0).toUpperCase() + e.level.slice(1)
        }")`,
        callArguments([children[0]]),
      ]);
      return children[1] === undefined ? entry : plainEmitted([
        `${effect}.annotateLogs`,
        callArguments([entry, children[1]]),
      ]);
    }
  }
  if (e.kind === "random-int") {
    {
      // The bound check is a defect, like the negative duration.
      const random = c.scope.effect("Random");
      const min = c.scope.temp();
      const max = c.scope.temp();
      return plainEmitted([
        `${effect}.suspend(() => { const ${min}: number = `,
        free(children[0]),
        `; const ${max}: number = `,
        free(children[1]),
        `; if (!(${max} > ${min})) throw new RangeError("randomInt needs max greater than min"); return ${random}.nextIntBetween(${min}, ${max}, { halfOpen: true }); })`,
      ]);
    }
  }
  if (e.kind === "run") {
    return children[0];
  }
  if (e.kind === "retry") {
    {
      const hoisted = hoistedOperands([e.job], children)[0];
      const job = c.suspended(e.job, hoisted);
      const options = emitted(`{ times: ${e.times} }`, PREC.member, {
        huggable: true,
      });
      return plainEmitted([`${effect}.retry`, callArguments([job, options])]);
    }
  }
  if (e.kind === "retry-with-schedule") {
    {
      const operands = hoistedOperands([e.job, e.options], children);
      const jobValue = operands[0];
      const options = operands[1];
      return plainEmitted([
        `${effect}.retry`,
        callArguments([
          c.suspended(e.job, jobValue),
          options ?? c.pure(e.options, undefined),
        ]),
      ]);
    }
  }
  if (e.kind === "repeat") {
    {
      const operands = hoistedOperands(repeatOperands(e), children);
      const jobValue = operands[0];
      const options = operands[1];
      const job = c.suspended(e.job, jobValue);
      return e.options === null
        ? plainEmitted([`${effect}.forever`, callArguments([job])])
        : plainEmitted([
          `${effect}.repeat`,
          callArguments([job, options ?? c.pure(e.options, undefined)]),
        ]);
    }
  }
  if (e.kind === "timeout") {
    {
      const hoisted = e.job.execution === "effect";
      return guardedDuration(
        c,
        children[hoisted ? 1 : 0],
        (ms) =>
          plainEmitted([
            `${effect}.timeout`,
            callArguments([
              c.suspended(e.job, hoisted ? children[0] : undefined),
              ms,
            ]),
          ]),
      );
    }
  }
  if (e.kind === "uninterruptible") {
    {
      const job = hoistedOperands([e.job], children)[0];
      return plainEmitted([
        `${effect}.uninterruptible`,
        callArguments([c.suspended(e.job, job)]),
      ]);
    }
  }
  if (e.kind === "sleep") {
    return guardedDuration(
      c,
      children[0],
      (ms) => plainEmitted([`${effect}.sleep`, callArguments([ms])]),
    );
  }
  {
    const unreachable: never = e;
    return unreachable;
  }
}
