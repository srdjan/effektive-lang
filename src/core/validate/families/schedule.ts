// Validation of the Schedule builtins: scheduleRecurs, scheduleSpaced, scheduleFromStep,
// scheduleExponential, scheduleCron, scheduleJittered, scheduleMap, scheduleMax, scheduleMin, and scheduleConcat.

import { cronExpressionProblem, cronZoneProblem } from "../../cron.ts";
import { DURATION_ID, type Expr, INSTANT_ID, type Type } from "../../ir.ts";

const DURATION: Type = { kind: "named", id: DURATION_ID };
const INSTANT: Type = { kind: "named", id: INSTANT_ID };
import { AREA } from "../report.ts";
import { combine, unionEffects } from "../sets.ts";
import {
  asFunction,
  fieldsOf,
  fits,
  INT,
  isUnknown,
  members,
  NUMBER,
  show,
  unfold,
  unionOf,
} from "../typing.ts";
import { type Comp, derivedResult, type ValidatorCore } from "./context.ts";

function scheduleInput(
  input: Type,
): Extract<Type, { kind: "record" }> {
  return {
    kind: "record",
    fields: [
      { name: "input", type: input, optional: false },
      { name: "attempt", type: INT, optional: false },
      ...["start", "now", "elapsed", "elapsedSincePrevious"].map((name) => ({
        name,
        type: name === "start" || name === "now" ? INSTANT : DURATION,
        optional: false,
      })),
    ],
  };
}

function scheduleDecision(state: Type, output: Type): Type {
  return {
    kind: "union",
    members: [
      {
        kind: "record",
        fields: [
          {
            name: "kind",
            type: { kind: "literal", value: "Continue" },
            optional: false,
          },
          { name: "state", type: state, optional: false },
          { name: "output", type: output, optional: false },
          { name: "delay", type: DURATION, optional: false },
        ],
      },
      {
        kind: "record",
        fields: [
          {
            name: "kind",
            type: { kind: "literal", value: "Done" },
            optional: false,
          },
          { name: "output", type: output, optional: false },
        ],
      },
    ],
  };
}

export function simpleSchedule(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-recurs" | "schedule-spaced" }>,
  path: string,
): Comp {
  const argument = e.kind === "schedule-recurs" ? e.times : e.delayMillis;
  const field = e.kind === "schedule-recurs" ? "times" : "delayMillis";
  const value = c.check(argument, `${path}.${field}`);
  if (
    !fits(c.env, value.type, e.kind === "schedule-recurs" ? INT : DURATION)
  ) {
    c.add(AREA.types, path, "invalid schedule argument", argument.span);
  }
  return derivedResult({
    kind: "schedule",
    output: INT,
    input: { kind: "primitive", name: "unknown" },
    effects: { failures: [], requirements: [] },
  }, combine([value]));
}

export function scheduleExponential(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-exponential" }>,
  path: string,
): Comp {
  const base = c.check(e.baseMs, `${path}.baseMs`);
  const factor = e.factor === null
    ? undefined
    : c.check(e.factor, `${path}.factor`);
  if (!fits(c.env, base.type, DURATION)) {
    c.add(
      AREA.types,
      `${path}.baseMs`,
      `scheduleExponential needs a Duration base, found ${show(base.type)}`,
      e.baseMs.span,
    );
  }
  if (factor !== undefined && !fits(c.env, factor.type, NUMBER)) {
    c.add(
      AREA.types,
      `${path}.factor`,
      `scheduleExponential needs a number factor, found ${show(factor.type)}`,
      e.span,
    );
  }
  return derivedResult({
    kind: "schedule",
    output: DURATION,
    input: { kind: "primitive", name: "unknown" },
    effects: { failures: [], requirements: [] },
  }, combine(factor === undefined ? [base] : [base, factor]));
}

export function scheduleCron(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-cron" }>,
  path: string,
): Comp {
  const expression = typeof e.expression === "string"
    ? cronExpressionProblem(e.expression)
    : "the expression is not a string";
  if (expression !== undefined) {
    c.add(
      AREA.types,
      `${path}.expression`,
      `scheduleCron needs a valid cron expression: ${expression}`,
      e.span,
    );
  }
  const zone = typeof e.zone === "string"
    ? cronZoneProblem(e.zone)
    : "the time zone is not a string";
  if (zone !== undefined) {
    c.add(
      AREA.types,
      `${path}.zone`,
      `scheduleCron needs a valid time zone: ${zone}`,
      e.span,
    );
  }
  return derivedResult({
    kind: "schedule",
    output: DURATION,
    input: { kind: "primitive", name: "unknown" },
    effects: { failures: [], requirements: [] },
  }, combine([]));
}

export function scheduleJittered(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-jittered" }>,
  path: string,
): Comp {
  const schedule = c.check(e.schedule, `${path}.schedule`);
  const policy = unfold(c.env, schedule.type);
  if (policy.kind !== "schedule") {
    c.add(
      AREA.types,
      `${path}.schedule`,
      `scheduleJittered needs a Schedule, found ${show(schedule.type)}`,
      e.schedule.span,
    );
    return c.poison();
  }
  return derivedResult(policy, combine([schedule]));
}

export function scheduleFromStep(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-from-step" }>,
  path: string,
): Comp {
  const initial = c.check(e.initial, `${path}.initial`);
  const decide = c.check(e.decide, `${path}.decide`);
  const factory = asFunction(c.env, initial.type);
  const step = asFunction(c.env, decide.type);
  if (
    e.initial.kind !== "closure" || e.decide.kind !== "closure" ||
    factory === undefined || factory.parameters.length !== 0 ||
    step === undefined || step.parameters.length !== 2
  ) {
    c.add(
      AREA.types,
      path,
      "scheduleFromStep needs inline state and decision callbacks",
      e.span,
    );
    return c.poison();
  }
  const input = fieldsOf(c.env, step.parameters[1])?.find((field) =>
    field.name === "input"
  )?.type;
  const outputs = members(c.env, step.result).map((member) =>
    fieldsOf(c.env, member)?.find((field) => field.name === "output")?.type
  ).filter((type): type is Type => type !== undefined);
  const output = unionOf(c.env, outputs);
  if (
    input === undefined || outputs.length === 0 ||
    !fits(c.env, factory.result, step.parameters[0]) ||
    !fits(c.env, scheduleInput(input), step.parameters[1]) ||
    !fits(
      c.env,
      step.result,
      scheduleDecision(factory.result, output),
    )
  ) {
    c.add(
      AREA.types,
      path,
      "scheduleFromStep needs ScheduleInput and ScheduleDecision<State, Output>",
      e.span,
    );
    return c.poison();
  }
  return derivedResult({
    kind: "schedule",
    output,
    input,
    effects: {
      ...unionEffects(factory.effects, step.effects),
    },
  }, combine([initial, decide]));
}

export function scheduleMap(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "schedule-map" }>,
  path: string,
): Comp {
  const schedule = c.check(e.schedule, `${path}.schedule`);
  const transform = c.check(e.transform, `${path}.transform`);
  const policy = unfold(c.env, schedule.type);
  const fn = asFunction(c.env, transform.type);
  if (
    e.transform.kind !== "closure" || policy.kind !== "schedule" ||
    fn === undefined || fn.parameters.length !== 1
  ) {
    c.add(
      AREA.types,
      path,
      "scheduleMap needs a Schedule and inline callback",
      e.span,
    );
    return c.poison();
  }
  const base = scheduleInput(policy.input);
  const metadata: Type = {
    kind: "record",
    fields: [
      ...base.fields,
      { name: "output", type: policy.output, optional: false },
      { name: "duration", type: DURATION, optional: false },
    ],
  };
  if (!fits(c.env, metadata, fn.parameters[0])) {
    c.add(
      AREA.types,
      path,
      "scheduleMap callback needs ScheduleMetadata<Output, Input>",
      e.span,
    );
  }
  return derivedResult({
    kind: "schedule",
    output: fn.result,
    input: policy.input,
    effects: {
      ...unionEffects(policy.effects, fn.effects),
    },
  }, combine([schedule, transform]));
}

export function scheduleCompose(
  c: ValidatorCore,
  e: Extract<
    Expr,
    { kind: "schedule-max" | "schedule-min" | "schedule-concat" }
  >,
  path: string,
): Comp {
  const left = c.check(e.left, `${path}.left`);
  const right = c.check(e.right, `${path}.right`);
  const first = unfold(c.env, left.type);
  const second = unfold(c.env, right.type);
  if (first.kind !== "schedule" || second.kind !== "schedule") {
    c.add(
      AREA.types,
      path,
      "schedule composition needs two Schedules",
      e.span,
    );
    return c.poison();
  }
  const accepts = (input: Type, offered: Type): boolean =>
    isUnknown(c.env, input) || fits(c.env, offered, input);
  const input = accepts(second.input, first.input)
    ? first.input
    : accepts(first.input, second.input)
    ? second.input
    : undefined;
  if (input === undefined) {
    c.add(
      AREA.types,
      path,
      "schedule composition needs comparable input types",
      e.span,
    );
    return c.poison();
  }
  return derivedResult({
    kind: "schedule",
    output: e.kind === "schedule-concat"
      ? unionOf(c.env, [first.output, second.output])
      : NUMBER,
    input,
    effects: {
      ...unionEffects(first.effects, second.effects),
    },
  }, combine([left, right]));
}
