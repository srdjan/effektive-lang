// Effect construction, execution, failure and retry checking.
import { isErrorId } from "../ids.ts";
import {
  DURATION_ID,
  type ErrorId,
  INSTANT_ID,
  LOG_LEVELS,
  type LogLevel,
  type Result,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";
import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import { literalOf, nameTextOf } from "../syntax_queries.ts";
import {
  combine,
  EFFECT_ONLY,
  type EffectSet,
  type NodeInfo,
  PURE_EFFECTS,
} from "../tables.ts";
import { dataOnly, type TypeRef } from "../types.ts";
import { showType } from "../type_show.ts";
import {
  type Arg,
  type BuiltinContext,
  type FactWriter,
  type FunctionNode,
  invocationOf,
  isEffectfulFunction,
  type LiteralField,
  type SyntaxView,
} from "./context.ts";
import { effectArrayMember } from "./collections.ts";
import { direct, piped, type PreludeCallName, type Rows } from "./rows.ts";
export interface EffectContext extends
  Pick<
    BuiltinContext,
    | "table"
    | "assignable"
    | "argInfo"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "isError"
    | "report"
  >,
  SyntaxView,
  FactWriter {
  arity(
    node: NodeId,
    name: string,
    expectedCount: number,
    args: readonly Arg[],
    usage?: string,
  ): boolean;
  literalRecord(
    arg: Arg,
    count: number,
  ): Result<ReadonlyMap<string, LiteralField>, "shape">;
  jobFunction(name: string, arg: Arg, info: NodeInfo): FunctionNode | undefined;
}

function failCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  c.fact(node, { kind: "fail" });
  const rightCount = c.arity(node, "fail", 1, args);
  const infos = args.map((a) => c.argInfo(a));
  let failure: ErrorId | undefined;
  if (rightCount) {
    const unfolded = c.table.node(c.table.unfold(infos[0].type));
    if (unfolded.kind === "named" && isErrorId(unfolded.id)) {
      failure = unfolded.id;
    } else if (!c.isError(infos[0].type)) {
      c.report(
        "type-mismatch/010",
        `\`fail\` needs a value of a named error type, but the value has type ${
          showType(c.table, infos[0].type)
        }`,
        args[0].node,
      );
    }
  }
  const own: EffectSet = {
    failures: failure === undefined ? [] : [failure],
    requirements: [],
    mode: "effect",
  };
  return c.finish(node, c.table.never, combine([...infos, own]));
}

function retryCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const fn = c.jobFunction("retry", args[0], job);
  if (!timesOnlyOption(c, args[1])) {
    const failures = fn?.failures ?? [];
    const { info, own } = callOptions(c, args[1], {
      name: "retry",
      inputs: failures.map((f) => ({ label: f, type: c.table.named(f) })),
      element: c.table.union(failures.map((f) => c.table.named(f))),
      retrySchedule: true,
    });
    c.fact(node, { kind: "retry-with-schedule" });
    return c.finish(
      node,
      fn?.result ?? c.table.error,
      combine([job, info, ...own, invocationOf(fn), EFFECT_ONLY]),
    );
  }
  const times = retryTimes(c, args[1]);
  c.fact(node, { kind: "retry", times });
  const invocation: EffectSet = invocationOf(fn);
  return c.finish(
    node,
    fn?.result ?? c.table.error,
    combine([job, invocation, EFFECT_ONLY]),
  );
}

const RETRY_KEYS: ReadonlySet<string> = new Set([
  "times",
  "schedule",
  "while",
  "until",
]);

/** True for a literal record of the one field `times`: the form that lowers to `retry`. */
function timesOnlyOption(c: EffectContext, arg: Arg): boolean {
  if (
    arg.pre !== undefined ||
    kindOf(c.tree, arg.node) !== SyntaxKind.RecordExpr
  ) return false;
  const fields = c.kids(arg.node);
  if (
    fields.length !== 1 || kindOf(c.tree, fields[0]) !== SyntaxKind.RecordField
  ) {
    return false;
  }
  const label = c.kids(fields[0]).find((k) =>
    kindOf(c.tree, k) === SyntaxKind.Name
  );
  return label !== undefined && nameTextOf(c.tree, label) === "times";
}

/** What `callOptions` needs to know about a retry or a repeat call. */
interface OptionsSpec {
  /** The builtin name, used in messages. */
  readonly name: "retry" | "repeat";
  /** The values that a `schedule` input must accept, each with its display label. */
  readonly inputs: readonly {
    readonly label: string;
    readonly type: TypeRef;
  }[];
  /** The one type that `while` and `until` receive. */
  readonly element: TypeRef;
  /** True when a RetrySchedule is allowed in `schedule`; it takes failures as input. */
  readonly retrySchedule: boolean;
}

/** The label, name, and value of a `name: value` option field, or undefined after a diagnostic. */
function optionField(
  c: EffectContext,
  call: string,
  field: NodeId,
):
  | { readonly label: NodeId; readonly name: string; readonly value: NodeId }
  | undefined {
  const parts = c.kids(field);
  const label = parts.find((k) => kindOf(c.tree, k) === SyntaxKind.Name);
  const value = parts.find((k) => k !== label);
  const name = label === undefined ? undefined : nameTextOf(c.tree, label);
  if (
    kindOf(c.tree, field) !== SyntaxKind.RecordField || label === undefined ||
    name === undefined || value === undefined
  ) {
    c.report(
      "type-mismatch/010",
      `\`${call}\` options need the form \`name: value\``,
      field,
    );
    return undefined;
  }
  return { label, name, value };
}

/**
 * Checks a general options record of `retry` or `repeat`: each key is `times`,
 * `schedule`, `while`, or `until`, at most once. The result carries the effects
 * that the callbacks and the schedule add to the call.
 */
function callOptions(
  c: EffectContext,
  arg: Arg,
  spec: OptionsSpec,
): { readonly info: NodeInfo; readonly own: readonly EffectSet[] } {
  const { name: call } = spec;
  if (
    arg.pre !== undefined ||
    kindOf(c.tree, arg.node) !== SyntaxKind.RecordExpr
  ) {
    c.report(
      "type-mismatch/010",
      `\`${call}\` needs an options record with \`times\`, \`schedule\`, \`while\`, or \`until\``,
      arg.node,
    );
    return { info: c.argInfo(arg), own: [] };
  }
  const fields = c.kids(arg.node);
  if (fields.length === 0) {
    c.report(
      "type-mismatch/010",
      `\`${call}\` needs at least one of \`times\`, \`schedule\`, \`while\`, or \`until\``,
      arg.node,
    );
  }
  const infos: NodeInfo[] = [];
  const own: EffectSet[] = [];
  const types: { name: string; type: TypeRef; optional: boolean }[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const parsed = optionField(c, call, field);
    if (parsed === undefined) continue;
    const { label, name, value } = parsed;
    const valueArg: Arg = { node: value };
    let info: NodeInfo;
    if (name === "while" || name === "until") {
      info = c.callback(
        call,
        valueArg,
        [spec.element],
        c.table.boolean,
        true,
      ).info;
      const cb = c.functionOf(info.type);
      if (cb !== undefined) {
        c.fits(
          value,
          cb.result,
          c.table.boolean,
          `the ${call} \`${name}\` result`,
        );
        own.push(invocationOf(cb));
      }
    } else if (name === "schedule") {
      info = c.argInfo(valueArg);
      own.push(schedulePolicy(c, value, info, spec));
    } else {
      info = c.argInfo(valueArg);
      if (name === "times") timesValue(c, value, call);
    }
    if (!RETRY_KEYS.has(name)) {
      c.report(
        "type-mismatch/010",
        `\`${call}\` has no option \`${name}\`; the options are times, schedule, while, until`,
        label,
      );
    } else if (seen.has(name)) {
      c.report(
        "type-mismatch/010",
        `\`${call}\` option \`${name}\` appears twice`,
        label,
      );
    } else {
      types.push({ name, type: info.type, optional: false });
    }
    seen.add(name);
    infos.push(info);
  }
  return {
    info: c.finish(arg.node, c.table.record(types), combine(infos)),
    own,
  };
}

function timesValue(c: EffectContext, value: NodeId, call: string): void {
  const literal = kindOf(c.tree, value) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, value)
    : undefined;
  if (
    typeof literal !== "number" || !Number.isSafeInteger(literal) || literal < 0
  ) {
    c.report(
      "type-mismatch/010",
      `\`${call}\` needs \`times\` to be a finite nonnegative safe integer literal`,
      value,
    );
  }
}

/** The effects that a `schedule` option adds, after checking that it accepts every input of the call. */
function schedulePolicy(
  c: EffectContext,
  value: NodeId,
  info: NodeInfo,
  spec: OptionsSpec,
): EffectSet {
  const policy = c.table.node(c.table.unfold(info.type));
  const accepts = (input: TypeRef): void => {
    for (const { label, type } of spec.inputs) {
      if (!c.assignable(type, input)) {
        c.report(
          "type-mismatch/003",
          `the ${spec.name} schedule does not accept ${label}`,
          value,
        );
      }
    }
  };
  if (policy.kind === "retry-schedule" && spec.retrySchedule) {
    accepts(policy.error);
    return PURE_EFFECTS;
  }
  if (policy.kind === "retry-schedule") {
    c.report(
      "type-mismatch/010",
      `\`${spec.name}\` needs a Schedule in \`schedule\`; a RetrySchedule takes failures as input`,
      value,
    );
    return PURE_EFFECTS;
  }
  if (policy.kind !== "schedule") {
    if (!c.isError(info.type)) {
      c.report(
        "type-mismatch/010",
        spec.retrySchedule
          ? `\`${spec.name}\` needs a RetrySchedule or a Schedule in \`schedule\``
          : `\`${spec.name}\` needs a Schedule in \`schedule\``,
        value,
      );
    }
    return PURE_EFFECTS;
  }
  if (c.table.unfold(policy.input) !== c.table.unknown) accepts(policy.input);
  return {
    failures: policy.failures,
    requirements: policy.requirements,
    mode: "effect",
  };
}

/** `repeat(job)` runs without end; `repeat(job, options)` returns the last success. */
function repeatCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const fn = c.jobFunction("repeat", args[0], job);
  c.fact(node, { kind: "repeat", options: args.length === 2 });
  const success = fn?.result ?? c.table.error;
  if (args[1] === undefined) {
    return c.finish(
      node,
      c.table.never,
      combine([job, invocationOf(fn), EFFECT_ONLY]),
    );
  }
  const { info, own } = callOptions(c, args[1], {
    name: "repeat",
    inputs: [{ label: showType(c.table, success), type: success }],
    element: success,
    retrySchedule: false,
  });
  return c.finish(
    node,
    success,
    combine([job, info, ...own, invocationOf(fn), EFFECT_ONLY]),
  );
}

function retryScheduleCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  const expectedType = expected === undefined
    ? undefined
    : c.table.node(c.table.unfold(expected));
  const errorHint = expectedType?.kind === "retry-schedule"
    ? expectedType.error
    : undefined;
  const info = errorHint === undefined ? c.argInfo(args[0]) : c.callback(
    "retrySchedule",
    args[0],
    [errorHint, c.table.int],
    c.table.option(c.table.named(DURATION_ID)),
  ).info;
  const fn = c.functionOf(info.type);
  if (fn === undefined) {
    if (!c.isError(info.type)) {
      c.report(
        "type-mismatch/010",
        "`retrySchedule` needs a function",
        args[0].node,
      );
    }
    return c.finish(node, c.table.error, combine([info]));
  }
  if (fn.parameters.length !== 2) {
    c.report(
      "type-mismatch/004",
      "the retry schedule callback takes an error and an attempt number",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([info]));
  }
  const error = c.table.node(c.table.unfold(fn.parameters[0]));
  if (error.kind !== "named" || !isErrorId(error.id)) {
    c.report(
      "type-mismatch/010",
      "the retry schedule callback needs a declared error parameter",
      args[0].node,
    );
  }
  c.fits(
    args[0].node,
    fn.parameters[1],
    c.table.int,
    "the retry attempt number",
  );
  c.fits(
    args[0].node,
    fn.result,
    c.table.option(c.table.named(DURATION_ID)),
    "the retry delay",
  );
  if (isEffectfulFunction(fn)) {
    c.report(
      "execution-mode/001",
      "the retry schedule callback must be pure",
      args[0].node,
    );
  }
  const type = error.kind === "named" && isErrorId(error.id)
    ? c.table.retrySchedule(fn.parameters[0])
    : c.table.error;
  return c.finish(node, type, combine([info]));
}

function deferCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const fn = c.jobFunction("defer", args[0], job);
  return c.finish(
    node,
    fn === undefined
      ? c.table.error
      : c.table.effect(fn.result, fn.failures, fn.requirements),
    job,
  );
}

function timeoutCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const fn = c.jobFunction("timeout", args[0], job);
  const duration = durationInfo(c, args[1], "timeout");
  const own: EffectSet = {
    failures: [TIMEOUT_ERROR_ID],
    requirements: [],
    mode: "effect",
  };
  return c.finish(
    node,
    fn?.result ?? c.table.error,
    combine([job, duration, invocationOf(fn), own]),
  );
}

function uninterruptibleCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const fn = c.jobFunction("uninterruptible", args[0], job);
  return c.finish(
    node,
    fn?.result ?? c.table.error,
    combine([job, invocationOf(fn), EFFECT_ONLY]),
  );
}

function sleepCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const duration = durationInfo(c, args[0], "sleep");
  return c.finish(node, c.table.unit, combine([duration, EFFECT_ONLY]));
}

function randomIntCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const infos = args.map((arg, index) => {
    const info = c.argInfo(arg, c.table.int);
    c.fits(
      arg.node,
      info.type,
      c.table.int,
      index === 0 ? "the randomInt minimum" : "the randomInt maximum",
    );
    return info;
  });
  return c.finish(node, c.table.int, combine([...infos, EFFECT_ONLY]));
}

const LOG_KEYS: ReadonlySet<string> = new Set(["level", "fields"]);

/** `log(message)` and `log(message, { level?, fields? })`: one log entry, with no failure. */
function logCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const message = c.argInfo(args[0], c.table.string);
  c.fits(args[0].node, message.type, c.table.string, "the log message");
  const infos: NodeInfo[] = [message];
  let level: LogLevel = "info";
  if (args[1] !== undefined) {
    const options = logOptions(c, args[1]);
    infos.push(options.info);
    level = options.level;
  }
  c.fact(node, { kind: "log", level });
  return c.finish(node, c.table.unit, combine([...infos, EFFECT_ONLY]));
}

/** Checks the literal options record of `log`: `level` and `fields`, each at most once. */
function logOptions(
  c: EffectContext,
  arg: Arg,
): { readonly info: NodeInfo; readonly level: LogLevel } {
  let level: LogLevel = "info";
  if (
    arg.pre !== undefined ||
    kindOf(c.tree, arg.node) !== SyntaxKind.RecordExpr
  ) {
    c.report(
      "type-mismatch/010",
      "`log` needs an options record with `level` or `fields`",
      arg.node,
    );
    return { info: c.argInfo(arg), level };
  }
  const fields = c.kids(arg.node);
  if (fields.length === 0) {
    c.report(
      "type-mismatch/010",
      "`log` needs at least one of `level` or `fields`",
      arg.node,
    );
  }
  const infos: NodeInfo[] = [];
  const types: { name: string; type: TypeRef; optional: boolean }[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const parsed = optionField(c, "log", field);
    if (parsed === undefined) continue;
    const { label, name, value } = parsed;
    const info = c.argInfo({ node: value });
    if (name === "level") level = logLevel(c, value) ?? level;
    else if (name === "fields") logFields(c, value, info);
    if (!LOG_KEYS.has(name)) {
      c.report(
        "type-mismatch/010",
        `\`log\` has no option \`${name}\`; the options are level, fields`,
        label,
      );
    } else if (seen.has(name)) {
      c.report(
        "type-mismatch/010",
        `\`log\` option \`${name}\` appears twice`,
        label,
      );
    } else {
      types.push({ name, type: info.type, optional: false });
    }
    seen.add(name);
    infos.push(info);
  }
  return {
    info: c.finish(arg.node, c.table.record(types), combine(infos)),
    level,
  };
}

/** The level of a literal `level` option, or undefined after a diagnostic. */
function logLevel(c: EffectContext, value: NodeId): LogLevel | undefined {
  const literal = kindOf(c.tree, value) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, value)
    : undefined;
  const level = LOG_LEVELS.find((candidate) => candidate === literal);
  if (level === undefined) {
    c.report(
      "type-mismatch/010",
      `\`log\` needs \`level\` to be one of the string literals ${
        LOG_LEVELS.map((l) => `"${l}"`).join(", ")
      }`,
      value,
    );
  }
  return level;
}

/** A `fields` option is a record literal whose field values are data. */
function logFields(c: EffectContext, value: NodeId, info: NodeInfo): void {
  if (kindOf(c.tree, value) !== SyntaxKind.RecordExpr) {
    c.report(
      "type-mismatch/010",
      "`log` needs `fields` to be a record literal",
      value,
    );
    return;
  }
  const record = c.table.node(c.table.unfold(info.type));
  if (record.kind !== "record") return;
  for (const field of record.fields) {
    if (!dataOnly(c.table, field.type, "value", true)) {
      c.report(
        "type-mismatch/010",
        `\`log\` field \`${field.name}\` must be data, but has type ${
          showType(c.table, field.type)
        }`,
        value,
      );
    }
  }
}

function durationInfo(c: EffectContext, arg: Arg, name: string): NodeInfo {
  const duration = c.table.named(DURATION_ID);
  const info = c.argInfo(arg, duration);
  c.fits(arg.node, info.type, duration, `the ${name} duration`);
  return info;
}

function runCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const value = c.argInfo(args[0]);
  const type = c.table.node(c.table.unfold(value.type));
  if (type.kind !== "effect") {
    if (!c.isError(value.type)) {
      c.report(
        "type-mismatch/010",
        `\`run\` needs an Effect value, but the argument has type ${
          showType(c.table, value.type)
        }`,
        args[0].node,
      );
    }
    return c.finish(node, c.table.error, combine([value, EFFECT_ONLY]));
  }
  return c.finish(
    node,
    type.result,
    combine([
      value,
      {
        failures: type.failures,
        requirements: type.requirements,
        mode: "effect",
      },
    ]),
  );
}

function raceCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const left = c.argInfo(args[0]);
  if (args.length === 1) {
    const member = effectArrayMember(c, "race", left, args[0].node);
    return c.finish(
      node,
      member === undefined
        ? c.table.error
        : c.table.effect(member.result, member.failures, member.requirements),
      combine([left]),
    );
  }
  const right = c.argInfo(args[1]);
  const a = c.table.node(c.table.unfold(left.type));
  const b = c.table.node(c.table.unfold(right.type));
  if (a.kind !== "effect" || b.kind !== "effect") {
    c.report("type-mismatch/010", "`race` needs two Effect values", node);
    return c.finish(node, c.table.error, combine([left, right]));
  }
  const aFitsB = c.assignable(a.result, b.result);
  const bFitsA = c.assignable(b.result, a.result);
  if (!aFitsB && !bFitsA) {
    c.report(
      "type-mismatch/010",
      "`race` needs compatible success types",
      node,
    );
  }
  const type = c.table.effect(aFitsB ? b.result : a.result, [
    ...a.failures,
    ...b.failures,
  ], [...a.requirements, ...b.requirements]);
  return c.finish(node, type, combine([left, right]));
}

function retryTimes(c: EffectContext, arg: Arg): number | undefined {
  const record = c.literalRecord(arg, 1);
  const times = record.ok ? record.value.get("times") : undefined;
  const value = times?.value;
  if (
    times === undefined || typeof value !== "number" ||
    !Number.isSafeInteger(value) || value < 0
  ) {
    c.report(
      "type-mismatch/010",
      "`retry` needs `{ times: N }`, where N is a finite nonnegative safe integer literal",
      arg.node,
    );
    return undefined;
  }
  c.finish(times.node, c.table.int, PURE_EFFECTS);
  c.finish(
    arg.node,
    c.table.record([{
      name: "times",
      type: c.table.int,
      optional: false,
    }]),
    PURE_EFFECTS,
  );
  return value;
}

/** The rows of the Effect builtins. */
export const EFFECT_ROWS = {
  fail: {
    prologue: "own-arity",
    handle: (c, node, _name, args) => failCall(c, node, args),
  },
  retry: {
    prologue: piped(2, "effect", {
      bailFact: { kind: "retry", times: undefined },
    }),
    handle: (c, node, _name, args) => retryCall(c, node, args),
  },
  repeat: {
    prologue: {
      arity: (_name, args) => args.length === 2 ? 2 : 1,
      bail: "effect",
      pipeline: "any",
      usage: "`repeat` takes a job and optional options",
    },
    handle: (c, node, _name, args) => repeatCall(c, node, args),
  },
  retrySchedule: {
    prologue: piped(1, "pure", { fact: { kind: "retry-schedule" } }),
    handle: (c, node, _name, args, expected) =>
      retryScheduleCall(c, node, args, expected),
  },
  timeout: {
    prologue: piped(2, "effect", { fact: { kind: "timeout" } }),
    handle: (c, node, _name, args) => timeoutCall(c, node, args),
  },
  uninterruptible: {
    prologue: piped(1, "effect", { fact: { kind: "uninterruptible" } }),
    handle: (c, node, _name, args) => uninterruptibleCall(c, node, args),
  },
  now: {
    prologue: direct(0, "effect", { fact: { kind: "now" } }),
    handle: (c, node) => c.finish(node, c.table.named(INSTANT_ID), EFFECT_ONLY),
  },
  log: {
    prologue: {
      arity: (_name, args) => args.length === 2 ? 2 : 1,
      bail: "effect",
      pipeline: "direct",
      usage: "`log` takes a message and optional options",
      bailFact: { kind: "log", level: undefined },
    },
    handle: (c, node, _name, args) => logCall(c, node, args),
  },
  random: {
    prologue: direct(0, "effect", { fact: { kind: "random" } }),
    handle: (c, node) => c.finish(node, c.table.number, EFFECT_ONLY),
  },
  randomInt: {
    prologue: direct(2, "effect", { fact: { kind: "random-int" } }),
    handle: (c, node, _name, args) => randomIntCall(c, node, args),
  },
  sleep: {
    prologue: direct(1, "effect", { fact: { kind: "sleep" } }),
    handle: (c, node, _name, args) => sleepCall(c, node, args),
  },
  defer: {
    prologue: piped(1, "pure", { fact: { kind: "defer" } }),
    handle: (c, node, _name, args) => deferCall(c, node, args),
  },
  run: {
    prologue: piped(1, "effect", { fact: { kind: "run" } }),
    handle: (c, node, _name, args) => runCall(c, node, args),
  },
  race: {
    prologue: {
      arity: (_name, args) => args.length === 1 ? 1 : 2,
      bail: "pure",
      pipeline: "direct",
      usage: "`race` takes an Effect array or two Effect values",
      fact: (_c, _name, args) =>
        args.length === 1 ? { kind: "race-all" } : { kind: "race" },
    },
    handle: (c, node, _name, args) => raceCall(c, node, args),
  },
} satisfies Partial<Rows<PreludeCallName, EffectContext>>;
