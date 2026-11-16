// Checks of the shape of the imports: declarations that an import carries and
// the builtin shapes of the prelude import.

import { emptySet, setFrom } from "../runtime.ts";
import type { FunctionType, Import, ModuleIR, Span, Type } from "../ir.ts";
import { AREA, moduleSpan, type Report } from "./report.ts";
import {
  BOOLEAN,
  comparisonClass,
  INT,
  isNever,
  isNumericClass,
  isStringClass,
  NUMBER,
  same,
  STRING,
  unfold,
} from "./typing.ts";
import { invocationOf, isQuiet, sameSet } from "./sets.ts";
import {
  type BuiltinName,
  CALLBACK_SHAPES,
  containerEntries,
  isConcurrencyType,
  rebuildContainer,
} from "./builtins.ts";
import { type Ctx, flag, PRELUDE_MODULE, type World } from "./world_table.ts";
import { checkDeclaredType } from "./type_checks.ts";
import {
  checkErrorDecl,
  checkServiceDecl,
  checkTypeDecl,
} from "./declaration_checks.ts";

function checkBuiltinShape(
  ctx: Ctx,
  name: BuiltinName,
  type: Type,
  path: string,
  span: Span,
): Ctx {
  const world = ctx.world;
  let report = ctx.report;
  const env = world.env;
  if (type.kind !== "function") {
    report = report.add(
      AREA.types,
      path,
      `a builtin has a function type, recorded ${type.kind}`,
      span,
    );
    return { ...ctx, report: report };
  }
  function wrong(current: Report, what: string): Report {
    return current.add(
      AREA.types,
      path,
      `the builtin ${name} ${what}`,
      span,
    );
  }
  if (name === "all") report = checkAllShape(report, env, type, wrong);
  else if (name === "div") {
    report = checkDataShape(report, env, type, 2, "int", wrong);
  } else if (
    name === "trunc" || name === "floor" || name === "round" ||
    name === "ceil"
  ) report = checkDataShape(report, env, type, 1, "number", wrong);
  else if (name === "text") report = checkTextShape(report, env, type, wrong);
  else if (name === "len") report = checkLenShape(report, env, type, wrong);
  else if (name === "at") report = checkAtShape(report, env, type, wrong);
  else if (name === "concat") {
    report = checkConcatShape(report, env, type, wrong);
  } else if (name === "sort") report = checkSortShape(report, env, type, wrong);
  else {
    report = checkCallbackShape(report, env, name, type, path, span, wrong);
  }
  return { ...ctx, report: report };
}

type Wrong = (report: Report, what: string) => Report;

/** A builtin shape is pure, with no failure and no requirement. */
function requirePure(
  report: Report,
  type: FunctionType,
  wrong: Wrong,
): Report {
  if (!isQuiet(invocationOf(type))) {
    return wrong(report, "is pure, with no failure and no requirement");
  }
  return report;
}

/** `div` is `(int, int) => int`, and a rounding builtin is `(number) => int`, each pure with no failure or requirement. */
function checkDataShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  count: number,
  parameter: "int" | "number",
  wrong: Wrong,
): Report {
  const expected = parameter === "int" ? INT : NUMBER;
  if (
    type.parameters.length !== count ||
    type.parameters.some((p) => !same(env, p, expected))
  ) {
    report = wrong(
      report,
      `takes ${count} ${parameter} parameter${count === 1 ? "" : "s"}`,
    );
  }
  if (!same(env, type.result, INT)) report = wrong(report, "returns an int");
  return requirePure(report, type, wrong);
}

/** `text` is `(number) => string` or `(boolean) => string`, pure with no failure or requirement. */
function checkTextShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  if (
    type.parameters.length !== 1 ||
    !(same(env, type.parameters[0], NUMBER) ||
      same(env, type.parameters[0], BOOLEAN))
  ) report = wrong(report, "takes 1 number or boolean parameter");
  if (!same(env, type.result, STRING)) {
    report = wrong(report, "returns a string");
  }
  return requirePure(report, type, wrong);
}

/** `len` is `(string) => int` or `(E[]) => int`, pure with no failure or requirement. */
function checkLenShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  if (
    type.parameters.length !== 1 ||
    !(type.parameters[0].kind === "array" ||
      same(env, type.parameters[0], STRING))
  ) report = wrong(report, "takes 1 string or array parameter");
  if (!same(env, type.result, INT)) {
    report = wrong(report, "returns an int");
  }
  return requirePure(report, type, wrong);
}

/** `at` is `(E[], int) => Option<E>`, pure with no failure or requirement. */
function checkAtShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  const array = type.parameters[0];
  const index = type.parameters[1];
  if (
    type.parameters.length !== 2 || array.kind !== "array" ||
    !same(env, index, INT)
  ) report = wrong(report, "takes an array and an int parameter");
  if (
    type.result.kind !== "option" ||
    array?.kind !== "array" ||
    !same(env, type.result.element, array.element)
  ) report = wrong(report, "returns an option of the element");
  return requirePure(report, type, wrong);
}

/** `concat` is `(E[], ...) => E[]`: each parameter is the result array type. Pure, no failure or requirement. */
function checkConcatShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  if (
    type.parameters.length === 0 || type.result.kind !== "array" ||
    !type.parameters.every((parameter) =>
      parameter.kind === "array" && same(env, parameter, type.result)
    )
  ) report = wrong(report, "takes one or more arrays of the result type");
  return requirePure(report, type, wrong);
}

/** `sort` is `(E[]) => E[]` or `(E[], (E) => K) => E[]`. E, or K with a key, is orderable. Pure, no failure or requirement. */
function checkSortShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  const count = type.parameters.length;
  const first = count === 1 || count === 2
    ? unfold(env, type.parameters[0])
    : undefined;
  if (first === undefined || first.kind !== "array") {
    return wrong(report, "takes an array and an optional key function");
  }
  if (!same(env, type.result, first)) {
    report = wrong(report, "returns the array type");
  }
  const key = count === 2 ? unfold(env, type.parameters[1]) : undefined;
  if (key !== undefined) {
    if (
      key.kind !== "function" || key.parameters.length !== 1 ||
      !same(env, key.parameters[0], first.element) ||
      !isQuiet(invocationOf(key))
    ) {
      return wrong(report, "takes a pure key function of the element");
    }
  }
  const ordered = key === undefined ? first.element : key.result;
  const cls = comparisonClass(env, ordered);
  if (
    cls === undefined || !(isNumericClass(env, cls) || isStringClass(env, cls))
  ) {
    report = wrong(report, "orders by a number or a string");
  }
  return requirePure(report, type, wrong);
}

function checkAllShape(
  report: Report,
  env: World["env"],
  type: FunctionType,
  wrong: Wrong,
): Report {
  const count = type.parameters.length;
  if (count !== 1 && count !== 2) {
    return wrong(report, `has an invalid parameter count ${count}`);
  }
  if (count === 2) {
    if (!isConcurrencyType(env, type.parameters[1])) {
      report = wrong(report, "requires a concurrency options record");
    }
  }
  const input = unfold(env, type.parameters[0]);
  const container = containerEntries(input);
  if (container === undefined) {
    return wrong(report, "takes a tuple, record, or array of Effects");
  }
  if (
    input.kind === "record" && input.fields.some((field) => field.optional)
  ) {
    report = wrong(report, "requires every record field to be present");
  }
  const effects = container.entries.map((entry) => unfold(env, entry));
  if (effects.some((entry) => entry.kind !== "effect")) {
    return wrong(report, "requires an Effect at every position");
  }
  const effectEntries = effects.filter((entry) => entry.kind === "effect");
  const results = effectEntries.map((entry) => entry.result);
  const result = rebuildContainer(container, results);
  if (!same(env, type.result, result)) {
    report = wrong(report, "must preserve input shape");
  }
  if (
    type.execution !== "effect" ||
    !sameSet(
      type.effects.failures,
      effectEntries.flatMap((entry) => entry.effects.failures),
    ) ||
    !sameSet(
      type.effects.requirements,
      effectEntries.flatMap((entry) => entry.effects.requirements),
    )
  ) {
    report = wrong(
      report,
      "must carry the failures and requirements of every Effect",
    );
  }
  return report;
}

function checkCallbackShape(
  report: Report,
  env: World["env"],
  name: "map" | "filter" | "fold" | "traverse",
  type: FunctionType,
  path: string,
  span: Span,
  wrong: Wrong,
): Report {
  const count = type.parameters.length;
  if (!CALLBACK_SHAPES[name].counts.includes(count)) {
    return wrong(report, `has an invalid parameter count ${count}`);
  }
  if (name === "traverse" && count === 3) {
    if (!isConcurrencyType(env, type.parameters[2])) {
      report = wrong(
        report,
        "requires a concurrency options record as its third parameter",
      );
    }
  }
  const first = unfold(env, type.parameters[0]);
  if (first.kind !== "array") {
    return wrong(report, "takes an array as its first parameter");
  }
  const callbackType = type.parameters[CALLBACK_SHAPES[name].index];
  const callback = unfold(env, callbackType);
  if (callback.kind !== "function") {
    return wrong(report, "takes a function as its last parameter");
  }
  const effectful = name === "traverse" ||
    !isQuiet(invocationOf(callback));
  if (
    type.execution !== (effectful ? "effect" : "pure") ||
    (name === "traverse" && callback.execution !== "effect") ||
    !sameSet(type.effects.failures, callback.effects.failures) ||
    !sameSet(type.effects.requirements, callback.effects.requirements)
  ) {
    report = report.add(
      AREA.contracts,
      path,
      name === "traverse"
        ? "traverse invokes an effect callback and carries its failures and requirements"
        : `${name} invokes its callback and carries its failures and requirements`,
      span,
    );
  }
  if (name === "fold") {
    const accumulator = type.parameters[1];
    const ok = callback.parameters.length === 2 &&
      same(env, callback.parameters[0], accumulator) &&
      same(env, callback.parameters[1], first.element) &&
      same(env, callback.result, accumulator) &&
      same(env, type.result, accumulator);
    if (!ok) return wrong(report, "does not keep one accumulator type");
    return report;
  }
  const ok = callback.parameters.length === 1 &&
    same(env, callback.parameters[0], first.element);
  if (!ok) {
    return wrong(
      report,
      "passes the callback an element that is not the element type",
    );
  }
  const result = unfold(env, type.result);
  if (name === "map" || name === "traverse") {
    if (
      result.kind !== "array" || !same(env, result.element, callback.result)
    ) {
      return wrong(report, "returns an array of the callback result");
    }
    return report;
  }
  if (
    !same(env, callback.result, BOOLEAN) ||
    isNever(callback.result) || !same(env, type.result, first)
  ) return wrong(report, "returns the array type with a boolean predicate");
  return report;
}

function checkImport(
  ctx: Ctx,
  imp: Import,
  i: number,
  ir: ModuleIR,
  own: ReadonlySet<string>,
): Ctx {
  const world = ctx.world;
  const path = `imports[${i}]`;
  const span: Span = moduleSpan(ir);
  let ids = emptySet<string>();
  function add(current: Ctx, id: string, at: string, s: Span): Ctx {
    if (imp.module !== PRELUDE_MODULE && typeof id === "string") {
      const colon = id.indexOf(":");
      const hash = id.indexOf("#", colon + 1);
      if (
        colon >= 0 && hash > colon &&
        id.slice(colon + 1, hash) === ir.module
      ) {
        current = flag(
          current,
          AREA.identity,
          at,
          `an import payload cannot claim this module's identity ${id}`,
          s,
        );
      }
    }
    if (ids.has(id)) {
      current = flag(
        current,
        AREA.identity,
        at,
        `the payload declares ${id} twice`,
        s,
      );
    }
    if (own.has(id)) {
      current = flag(
        current,
        AREA.identity,
        at,
        `the payload declares ${id}, which this module declares itself`,
        s,
      );
    }
    ids = ids.add(id);
    return current;
  }
  for (const entry of imp.types.entries()) {
    const t = entry[1];
    const j = entry[0];
    ctx = add(ctx, t.id, `${path}.types[${j}].id`, t.span);
    ctx = checkTypeDecl(ctx, t, `${path}.types[${j}]`);
  }
  for (const entry of imp.errors.entries()) {
    const e = entry[1];
    const j = entry[0];
    ctx = add(ctx, e.id, `${path}.errors[${j}].id`, e.span);
    ctx = checkErrorDecl(ctx, e, `${path}.errors[${j}]`);
  }
  const seenMethods = emptySet<string>();
  for (const entry of imp.services.entries()) {
    const s = entry[1];
    const j = entry[0];
    ctx = add(ctx, s.id, `${path}.services[${j}].id`, s.span);
    ctx = checkServiceDecl(ctx, s, `${path}.services[${j}]`, seenMethods);
  }
  for (const entry of imp.values.entries()) {
    const v = entry[1];
    const j = entry[0];
    ctx = add(ctx, v.id, `${path}.values[${j}].id`, span);
    ctx = checkDeclaredType(ctx, v.type, `${path}.values[${j}].type`, span);
  }
  const exported = setFrom(imp.exports);
  for (const entry of imp.exports.entries()) {
    const id = entry[1];
    const j = entry[0];
    if (!ids.has(id)) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.exports[${j}]`,
        `the module ${imp.module} exports ${id}, which its payload does not declare`,
        span,
      );
    }
  }
  for (const entry of imp.bindings.entries()) {
    const b = entry[1];
    const j = entry[0];
    if (!exported.has(b.target)) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.bindings[${j}].target`,
        `the binding ${b.name} targets ${b.target}, which the module ${imp.module} does not export`,
        span,
      );
    }
  }
  if (imp.module !== PRELUDE_MODULE) return ctx;
  if (
    imp.bindings.length > 0 || imp.types.length > 0 ||
    imp.errors.length > 0 || imp.services.length > 0
  ) {
    ctx = flag(
      ctx,
      AREA.identity,
      path,
      "the prelude import has no bindings, types, errors, or services",
      span,
    );
  }
  if (!sameSet(imp.exports, imp.values.map((v) => v.id))) {
    ctx = flag(
      ctx,
      AREA.identity,
      `${path}.exports`,
      "the prelude import exports exactly the builtin ids of its values",
      span,
    );
  }
  for (const entry of imp.values.entries()) {
    const v = entry[1];
    const j = entry[0];
    const at = `${path}.values[${j}]`;
    const identity = world.builtinInfo.get(v.id)?.identity;
    if (identity === undefined || identity.module !== ir.module) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${at}.id`,
        `a builtin identity has the form value:${ir.module}#$builtin/<name>/<hash>, recorded ${v.id}`,
        span,
      );
      continue;
    }
    if (v.name !== v.id.slice(v.id.indexOf("#") + 1)) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${at}.name`,
        `the builtin name is the text after # in its identity, recorded ${v.name}`,
        span,
      );
    }
    ctx = checkBuiltinShape(ctx, identity.name, v.type, `${at}.type`, span);
  }
  return ctx;
}

export function checkImports(ctx: Ctx, ir: ModuleIR): Report {
  const own = setFrom(ir.declarations.map((d) => d.id));
  for (const entry of ir.imports.entries()) {
    const imp = entry[1];
    const i = entry[0];
    ctx = checkImport(ctx, imp, i, ir, own);
  }
  return ctx.report;
}
