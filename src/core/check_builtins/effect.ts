// Effect construction, execution, failure and retry checking.
import { isErrorId } from "../ids.ts";
import type { DiagnosticCode } from "../diagnostics.ts";
import {
  DURATION_ID,
  type ErrorId,
  INSTANT_ID,
  LOG_LEVELS,
  type LogLevel,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";
import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import { literalOf, recordFieldParts } from "../syntax_queries.ts";
import { combine, EFFECT_ONLY, type EffectSet } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import { dataOnly, type TypeNode, type TypeRef } from "../types.ts";
import { showType } from "../type_show.ts";
import { emptySet } from "../runtime.ts";
import {
  type Arg,
  type BuiltinContext,
  type FunctionNode,
  invocationOf,
  isEffectfulFunction,
  literalIntegerOption,
  type LiteralRecordView,
  type SyntaxView,
} from "./context.ts";
import { direct, piped, type PreludeCallName, type Rows } from "./rows.ts";
export type EffectContext =
  & Pick<
    BuiltinContext,
    | "table"
    | "assignable"
    | "argInfo"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "isError"
  >
  & SyntaxView
  & LiteralRecordView
  & {
    checkFit(
      node: NodeId,
      found: TypeRef,
      expected: TypeRef | undefined,
      what: string,
    ): EffectContext;
    report(code: DiagnosticCode, message: string, node: NodeId): EffectContext;
    fact(node: NodeId, fact: NodeFact): EffectContext;
    arity(
      node: NodeId,
      name: string,
      expectedCount: number,
      args: readonly Arg[],
      usage: string | undefined,
    ): boolean;
    jobFunction(
      name: string,
      arg: Arg,
      info: NodeInfo,
    ): FunctionNode | undefined;
  };

/**
 * The Effect element type of an array of Effect values, or undefined after a
 * diagnostic (`name` needs an array of Effect values). Used by `race`.
 */
function effectArrayMember(
  c: Pick<EffectContext, "table" | "isError" | "report">,
  name: string,
  jobs: NodeInfo,
  at: NodeId,
): Extract<TypeNode, { readonly kind: "effect" }> | undefined {
  const shape = c.table.node(c.table.unfold(jobs.type));
  const member = shape.kind === "array"
    ? c.table.node(c.table.unfold(shape.element))
    : undefined;
  if (member?.kind === "effect") return member;
  if (!c.isError(jobs.type)) {
    c = c.report(
      "type-mismatch/010",
      `\`${name}\` needs an array of Effect values`,
      at,
    );
  }
  return undefined;
}

function failCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  c = c.fact(node, { kind: "fail" });
  const rightCount = c.arity(node, "fail", 1, args, undefined);
  const infos = args.map((arg) => c.argInfo(arg, undefined));
  let failure: ErrorId | undefined;
  if (rightCount) {
    const unfolded = c.table.node(c.table.unfold(infos[0].type));
    if (unfolded.kind === "named" && isErrorId(unfolded.id)) {
      failure = unfolded.id;
    } else if (!c.isError(infos[0].type)) {
      c = c.report(
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
  const job = c.argInfo(args[0], undefined);
  const fn = c.jobFunction("retry", args[0], job);
  if (!timesOnlyOption(c, args[1])) {
    const failures = fn?.failures ?? [];
    const options = callOptions(c, args[1], {
      name: "retry",
      inputs: failures.map((f) => ({ label: f, type: c.table.named(f) })),
      element: c.table.union(failures.map((f) => c.table.named(f))),
    });
    c = c.fact(node, { kind: "retry-with-schedule" });
    return c.finish(
      node,
      fn?.result ?? c.table.error,
      combine([
        job,
        options.info,
        ...options.own,
        invocationOf(fn),
        EFFECT_ONLY,
      ]),
    );
  }
  const retry = literalIntegerOption(c, args[1], {
    key: "times",
    minimum: 0,
    message:
      "`retry` needs `{ times: N }`, where N is a finite nonnegative safe integer literal",
  });
  c = retry.context;
  c = c.fact(node, { kind: "retry", times: retry.value });
  const invocation: EffectSet = invocationOf(fn);
  return c.finish(
    node,
    fn?.result ?? c.table.error,
    combine([job, invocation, EFFECT_ONLY]),
  );
}

/** The option keys of each call. Only `retry` takes a `schedule`. */
const OPTION_KEYS: Readonly<Record<"retry" | "repeat", readonly string[]>> = {
  retry: ["times", "schedule", "while", "until"],
  repeat: ["times", "while", "until"],
};

/** The option keys of a call as source text, for example "`times`, `while`, or `until`". */
function keyList(call: "retry" | "repeat"): string {
  const keys = OPTION_KEYS[call].map((key) => `\`${key}\``);
  return `${keys.slice(0, -1).join(", ")}, or ${keys[keys.length - 1]}`;
}

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
  return recordFieldParts(c.tree, fields[0])?.label === "times";
}

/** What `callOptions` needs to know about a retry or a repeat call. */
type OptionsSpec = {
  /** The builtin name, used in messages. */
  readonly name: "retry" | "repeat";
  /** The values that a `schedule` input must accept, each with its display label. Empty for `repeat`. */
  readonly inputs: readonly {
    readonly label: string;
    readonly type: TypeRef;
  }[];
  /** The one type that `while` and `until` receive. */
  readonly element: TypeRef;
};

/** The label, name, and value of a `name: value` option field, or undefined after a diagnostic. */
function optionField(
  c: EffectContext,
  call: string,
  field: NodeId,
):
  | { readonly label: NodeId; readonly name: string; readonly value: NodeId }
  | undefined {
  const parts = recordFieldParts(c.tree, field);
  if (parts?.value === undefined) {
    c = c.report(
      "type-mismatch/010",
      `\`${call}\` options need the form \`name: value\``,
      field,
    );
    return undefined;
  }
  return { label: parts.labelNode, name: parts.label, value: parts.value };
}

/** The parts of an options record that differ between the calls that take one. */
type OptionFrame = {
  readonly call: string;
  readonly keys: readonly string[];
  /** The keys as source text, for the messages. */
  readonly keyText: string;
  /** Checks the value of one field and gives its info. */
  readonly check: (name: string, value: NodeId) => NodeInfo;
};

/**
 * Checks an options record literal: each key is one of `frame.keys`, at most
 * once. A record of another form reports and gives the info of its value
 * alone. The result is the info of the record with its checked fields.
 */
function optionRecord(
  c: EffectContext,
  arg: Arg,
  frame: OptionFrame,
): NodeInfo {
  const call = frame.call;
  if (
    arg.pre !== undefined ||
    kindOf(c.tree, arg.node) !== SyntaxKind.RecordExpr
  ) {
    c = c.report(
      "type-mismatch/010",
      `\`${call}\` needs an options record with ${frame.keyText}`,
      arg.node,
    );
    return c.argInfo(arg, undefined);
  }
  const fields = c.kids(arg.node);
  if (fields.length === 0) {
    c = c.report(
      "type-mismatch/010",
      `\`${call}\` needs at least one of ${frame.keyText}`,
      arg.node,
    );
  }
  const infos: NodeInfo[] = [];
  const types: { name: string; type: TypeRef; optional: boolean }[] = [];
  let seen = emptySet<string>();
  for (const field of fields) {
    const parsed = optionField(c, call, field);
    if (parsed === undefined) continue;
    const name = parsed.name;
    const info = frame.check(name, parsed.value);
    if (!frame.keys.includes(name)) {
      c = c.report(
        "type-mismatch/010",
        `\`${call}\` has no option \`${name}\`; the options are ${
          frame.keys.join(", ")
        }`,
        parsed.label,
      );
    } else if (seen.has(name)) {
      c = c.report(
        "type-mismatch/010",
        `\`${call}\` option \`${name}\` appears twice`,
        parsed.label,
      );
    } else {
      types[types.length] = { name: name, type: info.type, optional: false };
    }
    seen = seen.add(name);
    infos[infos.length] = info;
  }
  return c.finish(arg.node, c.table.record(types), combine(infos));
}

/**
 * Checks a general options record of `retry` or `repeat`: each key is `times`,
 * `while`, or `until`, at most once. A `retry` record also takes `schedule`. The result carries the effects
 * that the callbacks and the schedule add to the call.
 */
function callOptions(
  c: EffectContext,
  arg: Arg,
  spec: OptionsSpec,
): { readonly info: NodeInfo; readonly own: readonly EffectSet[] } {
  const call = spec.name;
  const own: EffectSet[] = [];
  const info = optionRecord(c, arg, {
    call: call,
    keys: OPTION_KEYS[call],
    keyText: keyList(call),
    check: (name, value) => {
      const valueArg: Arg = { node: value };
      if (name === "while" || name === "until") {
        const checked = c.callback(
          call,
          valueArg,
          [spec.element],
          c.table.boolean,
          true,
        ).info;
        const cb = c.functionOf(checked.type);
        if (cb !== undefined) {
          c = c.checkFit(
            value,
            cb.result,
            c.table.boolean,
            `the ${call} \`${name}\` result`,
          );
          own[own.length] = invocationOf(cb);
        }
        return checked;
      }
      const checked = c.argInfo(valueArg, undefined);
      if (name === "schedule" && call === "retry") {
        c = schedulePolicy(c, value, checked, spec);
      } else if (name === "times") {
        c = timesValue(c, value, call);
      }
      return checked;
    },
  });
  return { info: info, own: own };
}

function timesValue(
  c: EffectContext,
  value: NodeId,
  call: string,
): EffectContext {
  const literal = kindOf(c.tree, value) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, value)
    : undefined;
  if (
    typeof literal !== "number" || !Number.isSafeInteger(literal) || literal < 0
  ) {
    c = c.report(
      "type-mismatch/010",
      `\`${call}\` needs \`times\` to be a finite nonnegative safe integer literal`,
      value,
    );
  }
  return c;
}

/** Checks that the RetrySchedule of a `retry` `schedule` option accepts every failure of the call. */
function schedulePolicy(
  c: EffectContext,
  value: NodeId,
  info: NodeInfo,
  spec: OptionsSpec,
): EffectContext {
  const policy = c.table.node(c.table.unfold(info.type));
  if (policy.kind === "retry-schedule") {
    for (const input of spec.inputs) {
      const label = input.label;
      const type = input.type;
      if (!c.assignable(type, policy.error)) {
        c = c.report(
          "type-mismatch/003",
          `the ${spec.name} schedule does not accept ${label}`,
          value,
        );
      }
    }
    return c;
  }
  if (!c.isError(info.type)) {
    c = c.report(
      "type-mismatch/010",
      `\`${spec.name}\` needs a RetrySchedule in \`schedule\``,
      value,
    );
  }
  return c;
}

/** `repeat(job)` runs without end; `repeat(job, options)` returns the last success. */
function repeatCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0], undefined);
  const fn = c.jobFunction("repeat", args[0], job);
  c = c.fact(node, { kind: "repeat", options: args.length === 2 });
  const success = fn?.result ?? c.table.error;
  if (args[1] === undefined) {
    return c.finish(
      node,
      c.table.never,
      combine([job, invocationOf(fn), EFFECT_ONLY]),
    );
  }
  const options = callOptions(c, args[1], {
    name: "repeat",
    inputs: [],
    element: success,
  });
  return c.finish(
    node,
    success,
    combine([
      job,
      options.info,
      ...options.own,
      invocationOf(fn),
      EFFECT_ONLY,
    ]),
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
  const info = errorHint === undefined
    ? c.argInfo(args[0], undefined)
    : c.callback(
      "retrySchedule",
      args[0],
      [errorHint, c.table.int],
      c.table.option(c.table.named(DURATION_ID)),
      false,
    ).info;
  const fn = c.functionOf(info.type);
  if (fn === undefined) {
    if (!c.isError(info.type)) {
      c = c.report(
        "type-mismatch/010",
        "`retrySchedule` needs a function",
        args[0].node,
      );
    }
    return c.finish(node, c.table.error, combine([info]));
  }
  if (fn.parameters.length !== 2) {
    c = c.report(
      "type-mismatch/004",
      "the retry schedule callback takes an error and an attempt number",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([info]));
  }
  const error = c.table.node(c.table.unfold(fn.parameters[0]));
  if (error.kind !== "named" || !isErrorId(error.id)) {
    c = c.report(
      "type-mismatch/010",
      "the retry schedule callback needs a declared error parameter",
      args[0].node,
    );
  }
  c = c.checkFit(
    args[0].node,
    fn.parameters[1],
    c.table.int,
    "the retry attempt number",
  );
  c = c.checkFit(
    args[0].node,
    fn.result,
    c.table.option(c.table.named(DURATION_ID)),
    "the retry delay",
  );
  if (isEffectfulFunction(fn)) {
    c = c.report(
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
  const job = c.argInfo(args[0], undefined);
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
  const job = c.argInfo(args[0], undefined);
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
  const job = c.argInfo(args[0], undefined);
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
    c = c.checkFit(
      arg.node,
      info.type,
      c.table.int,
      index === 0 ? "the randomInt minimum" : "the randomInt maximum",
    );
    return info;
  });
  return c.finish(node, c.table.int, combine([...infos, EFFECT_ONLY]));
}

const LOG_KEYS: readonly string[] = ["level", "fields"];

/** `log(message)` and `log(message, { level?, fields? })`: one log entry, with no failure. */
function logCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const message = c.argInfo(args[0], c.table.string);
  c = c.checkFit(args[0].node, message.type, c.table.string, "the log message");
  const infos: NodeInfo[] = [message];
  let level: LogLevel = "info";
  let fields: string | undefined;
  if (args[1] !== undefined) {
    const options = logOptions(c, args[1]);
    infos[infos.length] = options.info;
    level = options.level;
    fields = options.fields;
  }
  c = c.fact(node, { kind: "log", level: level, fields: fields });
  return c.finish(node, c.table.unit, combine([...infos, EFFECT_ONLY]));
}

/** Checks the literal options record of `log`: `level` and `fields`, each at most once. */
function logOptions(
  c: EffectContext,
  arg: Arg,
): {
  readonly info: NodeInfo;
  readonly level: LogLevel;
  readonly fields: string | undefined;
} {
  let level: LogLevel = "info";
  let fieldsLabel: string | undefined;
  const info = optionRecord(c, arg, {
    call: "log",
    keys: LOG_KEYS,
    keyText: "`level` or `fields`",
    check: (name, value) => {
      const checked = c.argInfo({ node: value }, undefined);
      if (name === "level") level = logLevel(c, value) ?? level;
      else if (name === "fields") {
        c = logFields(c, value, checked);
        fieldsLabel = name;
      }
      return checked;
    },
  });
  return { info: info, level: level, fields: fieldsLabel };
}

/** The level of a literal `level` option, or undefined after a diagnostic. */
function logLevel(c: EffectContext, value: NodeId): LogLevel | undefined {
  const literal = kindOf(c.tree, value) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, value)
    : undefined;
  const level = LOG_LEVELS.find((candidate) => candidate === literal);
  if (level === undefined) {
    c = c.report(
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
function logFields(
  c: EffectContext,
  value: NodeId,
  info: NodeInfo,
): EffectContext {
  if (kindOf(c.tree, value) !== SyntaxKind.RecordExpr) {
    c = c.report(
      "type-mismatch/010",
      "`log` needs `fields` to be a record literal",
      value,
    );
    return c;
  }
  const record = c.table.node(c.table.unfold(info.type));
  if (record.kind !== "record") return c;
  for (const field of record.fields) {
    if (!dataOnly(c.table, field.type, "value", true)) {
      c = c.report(
        "type-mismatch/010",
        `\`log\` field \`${field.name}\` must be data, but has type ${
          showType(c.table, field.type)
        }`,
        value,
      );
    }
  }
  return c;
}

function durationInfo(c: EffectContext, arg: Arg, name: string): NodeInfo {
  const duration = c.table.named(DURATION_ID);
  const info = c.argInfo(arg, duration);
  c = c.checkFit(arg.node, info.type, duration, `the ${name} duration`);
  return info;
}

function runCall(
  c: EffectContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const value = c.argInfo(args[0], undefined);
  const type = c.table.node(c.table.unfold(value.type));
  if (type.kind !== "effect") {
    if (!c.isError(value.type)) {
      c = c.report(
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
  const left = c.argInfo(args[0], undefined);
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
  const right = c.argInfo(args[1], undefined);
  const a = c.table.node(c.table.unfold(left.type));
  const b = c.table.node(c.table.unfold(right.type));
  if (a.kind !== "effect" || b.kind !== "effect") {
    c = c.report("type-mismatch/010", "`race` needs two Effect values", node);
    return c.finish(node, c.table.error, combine([left, right]));
  }
  const aFitsB = c.assignable(a.result, b.result);
  const bFitsA = c.assignable(b.result, a.result);
  if (!aFitsB && !bFitsA) {
    c = c.report(
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

export function effectRows(): Pick<
  Rows<PreludeCallName, EffectContext>,
  | "fail"
  | "retry"
  | "repeat"
  | "retrySchedule"
  | "timeout"
  | "uninterruptible"
  | "now"
  | "log"
  | "random"
  | "randomInt"
  | "sleep"
  | "defer"
  | "run"
  | "race"
> {
  return {
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
      handle: (c, node) =>
        c.finish(node, c.table.named(INSTANT_ID), EFFECT_ONLY),
    },
    log: {
      prologue: {
        arity: (_name, args) => args.length === 2 ? 2 : 1,
        bail: "effect",
        pipeline: "direct",
        usage: "`log` takes a message and optional options",
        bailFact: { kind: "log", level: undefined, fields: undefined },
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
  };
}
