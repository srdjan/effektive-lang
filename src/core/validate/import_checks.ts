// Checks of the shape of the imports: declarations that an import carries and
// the builtin shapes of the prelude import.

import type { FunctionType, Import, ModuleIR, Span, Type } from "../ir.ts";
import { AREA, moduleSpan } from "./report.ts";
import { isNever, same, unfold } from "./typing.ts";
import { invocationOf, isQuiet, sameSet } from "./sets.ts";
import {
  type BuiltinName,
  containerEntries,
  isConcurrencyType,
  rebuildContainer,
} from "./builtins.ts";
import { type Ctx, PRELUDE_MODULE, type World } from "./world_table.ts";
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
): void {
  const { world, report } = ctx;
  const env = world.env;
  if (type.kind !== "function") {
    report.add(
      AREA.types,
      path,
      `a builtin has a function type, recorded ${type.kind}`,
      span,
    );
    return;
  }
  const wrong = (what: string): void =>
    report.add(AREA.types, path, `the builtin ${name} ${what}`, span);
  switch (name) {
    case "all":
      return checkAllShape(env, type, wrong);
    case "div":
      return checkDataShape(env, type, 2, "int", wrong);
    case "trunc":
    case "floor":
    case "round":
    case "ceil":
      return checkDataShape(env, type, 1, "number", wrong);
    case "text":
      return checkTextShape(env, type, wrong);
    case "len":
      return checkLenShape(env, type, wrong);
    case "at":
      return checkAtShape(env, type, wrong);
    default:
      return checkCallbackShape(ctx, name, type, path, span, wrong);
  }
}

/** `div` is `(int, int) => int`, and a rounding builtin is `(number) => int`, each pure with no failure or requirement. */
function checkDataShape(
  env: World["env"],
  type: FunctionType,
  count: number,
  parameter: "int" | "number",
  wrong: (what: string) => void,
): void {
  const primitive = (name: "int" | "number"): Type => ({
    kind: "primitive",
    name,
  });
  if (
    type.parameters.length !== count ||
    type.parameters.some((p) => !same(env, p, primitive(parameter)))
  ) wrong(`takes ${count} ${parameter} parameter${count === 1 ? "" : "s"}`);
  if (!same(env, type.result, primitive("int"))) wrong("returns an int");
  if (type.execution !== "pure" || !isQuiet(invocationOf(type))) {
    wrong("is pure, with no failure and no requirement");
  }
}

/** `text` is `(number) => string` or `(boolean) => string`, pure with no failure or requirement. */
function checkTextShape(
  env: World["env"],
  type: FunctionType,
  wrong: (what: string) => void,
): void {
  const primitive = (name: "number" | "boolean" | "string"): Type => ({
    kind: "primitive",
    name,
  });
  if (
    type.parameters.length !== 1 ||
    !(same(env, type.parameters[0], primitive("number")) ||
      same(env, type.parameters[0], primitive("boolean")))
  ) wrong("takes 1 number or boolean parameter");
  if (!same(env, type.result, primitive("string"))) wrong("returns a string");
  if (type.execution !== "pure" || !isQuiet(invocationOf(type))) {
    wrong("is pure, with no failure and no requirement");
  }
}

/** `len` is `(string) => int` or `(E[]) => int`, pure with no failure or requirement. */
function checkLenShape(
  env: World["env"],
  type: FunctionType,
  wrong: (what: string) => void,
): void {
  if (
    type.parameters.length !== 1 ||
    !(type.parameters[0].kind === "array" ||
      same(env, type.parameters[0], { kind: "primitive", name: "string" }))
  ) wrong("takes 1 string or array parameter");
  if (!same(env, type.result, { kind: "primitive", name: "int" })) {
    wrong("returns an int");
  }
  if (type.execution !== "pure" || !isQuiet(invocationOf(type))) {
    wrong("is pure, with no failure and no requirement");
  }
}

/** `at` is `(E[], int) => Option<E>`, pure with no failure or requirement. */
function checkAtShape(
  env: World["env"],
  type: FunctionType,
  wrong: (what: string) => void,
): void {
  const [array, index] = type.parameters;
  if (
    type.parameters.length !== 2 || array.kind !== "array" ||
    !same(env, index, { kind: "primitive", name: "int" })
  ) wrong("takes an array and an int parameter");
  if (
    type.result.kind !== "option" ||
    array?.kind !== "array" ||
    !same(env, type.result.element, array.element)
  ) wrong("returns an option of the element");
  if (type.execution !== "pure" || !isQuiet(invocationOf(type))) {
    wrong("is pure, with no failure and no requirement");
  }
}

function checkAllShape(
  env: World["env"],
  type: FunctionType,
  wrong: (what: string) => void,
): void {
  const count = type.parameters.length;
  if (count !== 1 && count !== 2) {
    wrong(`has an invalid parameter count ${count}`);
    return;
  }
  if (count === 2) {
    if (!isConcurrencyType(env, type.parameters[1])) {
      wrong("requires a concurrency options record");
    }
  }
  const input = unfold(env, type.parameters[0]);
  const container = containerEntries(input);
  if (container === undefined) {
    wrong("takes a tuple, record, or array of Effects");
    return;
  }
  if (
    input.kind === "record" && input.fields.some((field) => field.optional)
  ) {
    wrong("requires every record field to be present");
  }
  const effects = container.entries.map((entry) => unfold(env, entry));
  if (effects.some((entry) => entry.kind !== "effect")) {
    wrong("requires an Effect at every position");
    return;
  }
  const effectEntries = effects.filter((entry) => entry.kind === "effect");
  const results = effectEntries.map((entry) => entry.result);
  const result = rebuildContainer(container, results);
  if (!same(env, type.result, result)) wrong("must preserve input shape");
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
  ) wrong("must carry the failures and requirements of every Effect");
}

function checkCallbackShape(
  ctx: Ctx,
  name: "map" | "filter" | "fold" | "traverse",
  type: FunctionType,
  path: string,
  span: Span,
  wrong: (what: string) => void,
): void {
  const { report } = ctx;
  const env = ctx.world.env;
  const count = type.parameters.length;
  const validCount = name === "fold"
    ? count === 3
    : name === "traverse"
    ? count === 2 || count === 3
    : count === 2;
  if (!validCount) {
    wrong(`has an invalid parameter count ${count}`);
    return;
  }
  if (name === "traverse" && count === 3) {
    if (!isConcurrencyType(env, type.parameters[2])) {
      wrong("requires a concurrency options record as its third parameter");
    }
  }
  const first = unfold(env, type.parameters[0]);
  if (first.kind !== "array") {
    wrong("takes an array as its first parameter");
    return;
  }
  const callbackIndex = name === "fold" ? 2 : 1;
  const callbackType = type.parameters[callbackIndex];
  const callback = unfold(env, callbackType);
  if (callback.kind !== "function") {
    wrong("takes a function as its last parameter");
    return;
  }
  const effectful = name === "traverse" ||
    !isQuiet(invocationOf(callback));
  if (
    type.execution !== (effectful ? "effect" : "pure") ||
    (name === "traverse" && callback.execution !== "effect") ||
    !sameSet(type.effects.failures, callback.effects.failures) ||
    !sameSet(type.effects.requirements, callback.effects.requirements)
  ) {
    report.add(
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
    if (!ok) wrong("does not keep one accumulator type");
    return;
  }
  const ok = callback.parameters.length === 1 &&
    same(env, callback.parameters[0], first.element);
  if (!ok) {
    wrong("passes the callback an element that is not the element type");
    return;
  }
  const result = unfold(env, type.result);
  switch (name) {
    case "map":
    case "traverse":
      if (
        result.kind !== "array" || !same(env, result.element, callback.result)
      ) {
        wrong("returns an array of the callback result");
      }
      return;
    case "filter":
      if (
        !same(env, callback.result, { kind: "primitive", name: "boolean" }) ||
        isNever(callback.result) || !same(env, type.result, first)
      ) {
        wrong("returns the array type with a boolean predicate");
      }
      return;
    default: {
      const unreachable: never = name;
      return unreachable;
    }
  }
}

function checkImport(
  ctx: Ctx,
  imp: Import,
  i: number,
  ir: ModuleIR,
  own: ReadonlySet<string>,
): void {
  const { world, report } = ctx;
  const path = `imports[${i}]`;
  const span: Span = moduleSpan(ir);
  const ids = new Set<string>();
  const add = (id: string, at: string, s: Span): void => {
    if (imp.module !== PRELUDE_MODULE && typeof id === "string") {
      const colon = id.indexOf(":");
      const hash = id.indexOf("#", colon + 1);
      if (
        colon >= 0 && hash > colon &&
        id.slice(colon + 1, hash) === ir.module
      ) {
        report.add(
          AREA.identity,
          at,
          `an import payload cannot claim this module's identity ${id}`,
          s,
        );
      }
    }
    if (ids.has(id)) {
      report.add(AREA.identity, at, `the payload declares ${id} twice`, s);
    }
    if (own.has(id)) {
      report.add(
        AREA.identity,
        at,
        `the payload declares ${id}, which this module declares itself`,
        s,
      );
    }
    ids.add(id);
  };
  imp.types.forEach((t, j) => {
    add(t.id, `${path}.types[${j}].id`, t.span);
    checkTypeDecl(ctx, t, `${path}.types[${j}]`);
  });
  imp.errors.forEach((e, j) => {
    add(e.id, `${path}.errors[${j}].id`, e.span);
    checkErrorDecl(ctx, e, `${path}.errors[${j}]`);
  });
  const seenMethods = new Set<string>();
  imp.services.forEach((s, j) => {
    add(s.id, `${path}.services[${j}].id`, s.span);
    checkServiceDecl(ctx, s, `${path}.services[${j}]`, seenMethods);
  });
  imp.values.forEach((v, j) => {
    add(v.id, `${path}.values[${j}].id`, span);
    checkDeclaredType(ctx, v.type, `${path}.values[${j}].type`, span);
  });
  const exported = new Set(imp.exports);
  imp.exports.forEach((id, j) => {
    if (!ids.has(id)) {
      report.add(
        AREA.identity,
        `${path}.exports[${j}]`,
        `the module ${imp.module} exports ${id}, which its payload does not declare`,
        span,
      );
    }
  });
  imp.bindings.forEach((b, j) => {
    if (!exported.has(b.target)) {
      report.add(
        AREA.identity,
        `${path}.bindings[${j}].target`,
        `the binding ${b.name} targets ${b.target}, which the module ${imp.module} does not export`,
        span,
      );
    }
  });
  if (imp.module !== PRELUDE_MODULE) return;
  if (
    imp.bindings.length > 0 || imp.types.length > 0 ||
    imp.errors.length > 0 || imp.services.length > 0
  ) {
    report.add(
      AREA.identity,
      path,
      "the prelude import has no bindings, types, errors, or services",
      span,
    );
  }
  if (!sameSet(imp.exports, imp.values.map((v) => v.id))) {
    report.add(
      AREA.identity,
      `${path}.exports`,
      "the prelude import exports exactly the builtin ids of its values",
      span,
    );
  }
  imp.values.forEach((v, j) => {
    const at = `${path}.values[${j}]`;
    const identity = world.builtinInfo.get(v.id)?.identity;
    if (identity === undefined || identity.module !== ir.module) {
      report.add(
        AREA.identity,
        `${at}.id`,
        `a builtin identity has the form value:${ir.module}#$builtin/<name>/<hash>, recorded ${v.id}`,
        span,
      );
      return;
    }
    if (v.name !== v.id.slice(v.id.indexOf("#") + 1)) {
      report.add(
        AREA.identity,
        `${at}.name`,
        `the builtin name is the text after # in its identity, recorded ${v.name}`,
        span,
      );
    }
    checkBuiltinShape(ctx, identity.name, v.type, `${at}.type`, span);
  });
}

export function checkImports(ctx: Ctx, ir: ModuleIR): void {
  const own = new Set(ir.declarations.map((d) => d.id));
  ir.imports.forEach((imp, i) => checkImport(ctx, imp, i, ir, own));
}
