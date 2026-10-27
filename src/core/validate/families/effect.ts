// Validation of the effect builtins: retry, repeat, timeout, sleep, retrySchedule, defer, run, and race.

import { type Expr, TIMEOUT_ERROR_ID, type Type } from "../../ir.ts";
import { AREA } from "../report.ts";
import {
  type Active,
  combine,
  invocationOf,
  isQuiet,
  unionEffects,
} from "../sets.ts";
import {
  asFunction,
  BOOLEAN,
  fits,
  INT,
  NEVER,
  show,
  unfold,
  UNIT,
} from "../typing.ts";
import {
  type Comp,
  derivedResult,
  EFFECT_ONLY,
  type Out,
  type ValidatorCore,
} from "./context.ts";

export function retry(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "retry" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "retry");
  if (!Number.isSafeInteger(e.times) || e.times < 0) {
    c.add(
      AREA.control,
      `${path}.times`,
      `retry needs a finite nonnegative safe integer count, recorded ${e.times}`,
      e.span,
    );
  }
  if (fn === undefined) return c.poison();
  return derivedResult(
    fn.result,
    combine([job, invocationOf(fn), EFFECT_ONLY]),
  );
}

export function timeout(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "timeout" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const duration = c.check(e.durationMs, `${path}.durationMs`);
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "timeout");
  if (!fits(c.env, duration.type, INT)) {
    c.add(
      AREA.types,
      `${path}.durationMs`,
      `timeout needs an int duration, found ${show(duration.type)}`,
      e.durationMs.span,
    );
  }
  if (fn === undefined) return c.poison();
  return derivedResult(
    fn.result,
    combine([job, duration, invocationOf(fn), {
      failures: [TIMEOUT_ERROR_ID],
      requirements: [],
      execution: "effect",
    }]),
  );
}

export function sleep(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "sleep" }>,
  path: string,
): Comp {
  const duration = c.check(e.durationMs, `${path}.durationMs`);
  if (!fits(c.env, duration.type, INT)) {
    c.add(
      AREA.types,
      `${path}.durationMs`,
      `sleep needs an int duration, found ${show(duration.type)}`,
      e.durationMs.span,
    );
  }
  return derivedResult(UNIT, combine([duration, EFFECT_ONLY]));
}

export function retrySchedule(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "retry-schedule" }>,
  path: string,
): Comp {
  const step = c.check(e.step, `${path}.step`);
  const fn = asFunction(c.env, step.type);
  if (fn === undefined || fn.parameters.length !== 2) {
    c.add(
      AREA.control,
      `${path}.step`,
      "retry schedule needs a two-parameter callback",
      e.step.span,
    );
    return c.poison();
  }
  const error = unfold(c.env, fn.parameters[0]);
  if (error.kind !== "named" || !c.env.errors.has(error.id)) {
    c.add(
      AREA.types,
      `${path}.step`,
      "retry schedule needs a declared error parameter",
      e.step.span,
    );
  }
  if (
    !fits(c.env, INT, fn.parameters[1]) ||
    !fits(c.env, fn.result, { kind: "option", element: INT })
  ) {
    c.add(
      AREA.types,
      `${path}.step`,
      "retry schedule needs an Int attempt and Option<Int> result",
      e.step.span,
    );
  }
  if (!isQuiet(invocationOf(fn))) {
    c.add(
      AREA.control,
      `${path}.step`,
      "retry schedule callback must be pure",
      e.step.span,
    );
  }
  return derivedResult(
    { kind: "retry-schedule", error: fn.parameters[0] },
    combine([step]),
  );
}

const OPTION_KEYS: ReadonlySet<string> = new Set([
  "times",
  "schedule",
  "while",
  "until",
]);

/** What `optionExtras` needs to know about a retry or a repeat call. */
interface OptionsSpec {
  readonly name: "retry" | "repeat";
  /** The values that a schedule and a predicate must accept, with display labels. */
  readonly inputs: readonly { readonly label: string; readonly type: Type }[];
  /** True when a RetrySchedule is allowed in `schedule`. */
  readonly retrySchedule: boolean;
}

/**
 * Checks the options record of `retry` or `repeat` and returns the effects that
 * its schedule and predicates add.
 */
function optionExtras(
  c: ValidatorCore,
  options: Out,
  expr: Expr,
  path: string,
  spec: OptionsSpec,
): readonly Active[] {
  const call = spec.name;
  const extras: Active[] = [];
  const bad = (field: string, what: string): void =>
    c.add(AREA.control, field, what, expr.span);
  const accepts = (input: Type, at: string, what: string): void => {
    for (const { label, type } of spec.inputs) {
      if (!fits(c.env, type, input)) {
        bad(at, `${what} does not accept ${label}`);
      }
    }
  };
  if (expr.kind !== "record") {
    bad(`${path}.options`, `${call} needs an options record`);
    return extras;
  }
  const shape = unfold(c.env, options.type);
  const typeOf = (name: string): Type | undefined =>
    shape.kind === "record"
      ? shape.fields.find((f) => f.name === name)?.type
      : undefined;
  if (expr.fields.length === 0) {
    bad(`${path}.options`, `${call} needs at least one option`);
  }
  const seen = new Set<string>();
  expr.fields.forEach((field, i) => {
    const at = `${path}.options.fields[${i}]`;
    if (!OPTION_KEYS.has(field.name)) {
      bad(at, `${call} has no option ${field.name}`);
      return;
    }
    if (seen.has(field.name)) {
      bad(at, `${call} option ${field.name} appears twice`);
      return;
    }
    seen.add(field.name);
    const type = typeOf(field.name);
    if (field.name === "times") {
      const v = field.value;
      if (
        v.kind !== "literal" || typeof v.value !== "number" ||
        !Number.isSafeInteger(v.value) || v.value < 0
      ) {
        bad(
          `${at}.value`,
          `${call} needs a finite nonnegative safe integer literal for times`,
        );
      }
    } else if (field.name === "schedule") {
      const policy = type === undefined ? undefined : unfold(c.env, type);
      if (policy?.kind === "retry-schedule" && spec.retrySchedule) {
        accepts(policy.error, at, `${call} schedule`);
      } else if (policy?.kind === "retry-schedule") {
        bad(
          at,
          `${call} needs a schedule in schedule; a retry schedule takes failures as input`,
        );
      } else if (policy?.kind === "schedule") {
        const open = unfold(c.env, policy.input);
        if (open.kind !== "primitive" || open.name !== "unknown") {
          accepts(policy.input, at, `${call} schedule`);
        }
        extras.push({ ...policy.effects, execution: "effect" });
      } else {
        bad(
          at,
          spec.retrySchedule
            ? `${call} needs a retry schedule or a schedule in schedule`
            : `${call} needs a schedule in schedule`,
        );
      }
    } else {
      const cb = type === undefined ? undefined : asFunction(c.env, type);
      if (cb === undefined || cb.parameters.length !== 1) {
        bad(at, `${call} ${field.name} needs a one-parameter function`);
        return;
      }
      accepts(cb.parameters[0], at, `${call} ${field.name}`);
      if (!fits(c.env, cb.result, BOOLEAN)) {
        bad(at, `${call} ${field.name} needs a boolean result`);
      }
      extras.push(invocationOf(cb));
    }
  });
  return extras;
}

export function retryWithSchedule(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "retry-with-schedule" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const options = c.check(e.options, `${path}.options`);
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "retry");
  const extras = optionExtras(c, options, e.options, path, {
    name: "retry",
    inputs: (fn?.effects.failures ?? []).map((id) => ({
      label: id,
      type: { kind: "named", id },
    })),
    retrySchedule: true,
  });
  if (fn === undefined) return c.poison();
  return derivedResult(
    fn.result,
    combine([job, options, invocationOf(fn), EFFECT_ONLY, ...extras]),
  );
}

export function repeat(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "repeat" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const options = e.options === null
    ? undefined
    : c.check(e.options, `${path}.options`);
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "repeat");
  const extras = options === undefined || e.options === null || fn === undefined
    ? []
    : optionExtras(c, options, e.options, path, {
      name: "repeat",
      inputs: [{ label: show(fn.result), type: fn.result }],
      retrySchedule: false,
    });
  if (fn === undefined) return c.poison();
  return derivedResult(
    options === undefined ? NEVER : fn.result,
    combine([
      job,
      ...(options === undefined ? [] : [options]),
      invocationOf(fn),
      EFFECT_ONLY,
      ...extras,
    ]),
  );
}

export function defer(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "defer" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "defer");
  if (fn === undefined) return c.poison();
  return derivedResult({
    kind: "effect",
    result: fn.result,
    effects: fn.effects,
  }, combine([job]));
}

export function run(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "run" }>,
  path: string,
): Comp {
  const value = c.check(e.value, `${path}.value`);
  const type = unfold(c.env, value.type);
  if (type.kind !== "effect") {
    c.add(
      AREA.control,
      `${path}.value`,
      `run needs an Effect value, but the expression has type ${
        show(value.type)
      }`,
      e.value.span,
    );
    return c.poison();
  }
  return derivedResult(
    type.result,
    combine([
      value,
      {
        failures: type.effects.failures,
        requirements: type.effects.requirements,
        execution: "effect",
      },
    ]),
  );
}

export function race(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "race" }>,
  path: string,
): Comp {
  const left = c.check(e.left, `${path}.left`);
  const right = c.check(e.right, `${path}.right`);
  const a = unfold(c.env, left.type);
  const b = unfold(c.env, right.type);
  if (a.kind !== "effect" || b.kind !== "effect") {
    c.add(AREA.types, path, "race needs two Effect values", e.span);
    return c.poison();
  }
  const aFitsB = fits(c.env, a.result, b.result);
  const bFitsA = fits(c.env, b.result, a.result);
  if (!aFitsB && !bFitsA) {
    c.add(AREA.types, path, "race needs compatible success types", e.span);
  }
  return derivedResult({
    kind: "effect",
    result: aFitsB ? b.result : a.result,
    effects: {
      ...unionEffects(a.effects, b.effects),
    },
  }, combine([left, right]));
}
