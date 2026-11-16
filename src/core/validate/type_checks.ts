// Checks of the types inside declarations: every identity in a type resolves,
// and no record type repeats a field name.

import { AREA, type ValidationFlag, type ValidationPath } from "./report.ts";
import { isTrue } from "./guards.ts";
import { emptySet, setFrom } from "../runtime.ts";
import {
  type Field,
  type FunctionType,
  SCHEMA_ERROR_ID,
  SCOPE_CAPABILITY,
  type Span,
  type Type,
} from "../ir.ts";
import {
  containsRefinement,
  dataOnly,
  entrySchemaDerivable,
  type TypeEnv,
} from "./typing.ts";
import { MAX_DEPTH, typeChildren, walkTypeBounded } from "./type_children.ts";
import { type Ctx, flag } from "./world_table.ts";

/**
 * Checks that every identity in a type resolves: named types, failure
 * identities, and capability identities. Returns true when all resolve.
 */
export function checkTypeIds(
  ctx: Ctx,
  type: Type,
  path: ValidationPath,
  span: Span,
): { readonly ctx: Ctx; readonly valid: ValidationFlag } {
  const world = ctx.world;
  type State = {
    readonly report: Ctx["report"];
    readonly valid: ValidationFlag;
  };
  function fail(state: State, at: string, what: string): State {
    return {
      report: state.report.add(AREA.identity, at, what, span),
      valid: false,
    };
  }
  function effects(state: State, at: string, e: {
    readonly failures: readonly string[];
    readonly requirements: readonly string[];
  }): State {
    let next = state;
    for (const entry of e.failures.entries()) {
      const id = entry[1];
      const i = entry[0];
      if (!world.errors.has(id)) {
        next = fail(
          next,
          `${at}.failures[${i}]`,
          `the failure ${id} is not a declared error`,
        );
      }
    }
    for (const entry of e.requirements.entries()) {
      const id = entry[1];
      const i = entry[0];
      if (!world.methods.has(id) && id !== SCOPE_CAPABILITY) {
        next = fail(
          next,
          `${at}.requirements[${i}]`,
          `the requirement ${id} is not a declared service method`,
        );
      }
    }
    return next;
  }
  function functionFlags(state: State, t: FunctionType, at: string): State {
    let next = state;
    function invalid(current: State, message: string): State {
      return {
        report: current.report.add(
          AREA.contracts,
          `${at}.checked`,
          message,
          span,
        ),
        valid: false,
      };
    }
    if (t.borrows !== undefined && t.borrows.length !== t.parameters.length) {
      next = fail(next, at, "borrow flags must match function parameters");
    }
    if (
      t.checked !== undefined &&
      (t.checked.length !== t.parameters.length ||
        t.checked.some((checked) => typeof checked !== "boolean"))
    ) {
      next = fail(
        next,
        at,
        "checked flags must be booleans and match function parameters",
      );
    }
    if (t.checked?.some(Boolean)) {
      if (t.execution !== "effect") {
        next = invalid(next, "a checked function must have effect execution");
      }
      if (!t.effects.failures.includes(SCHEMA_ERROR_ID)) {
        next = invalid(next, "a checked function must declare SchemaError");
      }
      const checkedFlags = t.checked;
      for (const entry of t.parameters.entries()) {
        const parameter = entry[1];
        const index = entry[0];
        const checked = checkedFlags === undefined
          ? undefined
          : checkedFlags[index];
        if (checked && !entrySchemaDerivable(world.env, parameter)) {
          next = invalid(
            next,
            "a checked function parameter needs a schema-derivable contract",
          );
        }
      }
    }
    return next;
  }
  function schemaShape(
    state: State,
    t: Extract<Type, { readonly kind: "schema" }>,
    at: string,
  ): State {
    let next = state;
    // The IR allows each flag to be absent or exactly true.
    for (
      const flag of [
        "optionalKey",
        "encodedOptionalKey",
        "decodedOptionalKey",
        "constructorDefault",
      ] as const
    ) {
      const value: unknown = t[flag];
      if (value !== undefined && !isTrue(value)) {
        next = fail(
          next,
          at,
          `the Schema flag ${flag} must be absent or true`,
        );
      }
    }
    if (
      Number(isTrue(t.optionalKey)) +
          Number(isTrue(t.encodedOptionalKey)) +
          Number(isTrue(t.decodedOptionalKey)) > 1
    ) {
      next = fail(
        next,
        at,
        "Schema field optionality flags are mutually exclusive",
      );
    }
    if (
      !dataOnly(world.env, t.decoded, "schema") ||
      !dataOnly(world.env, t.encoded, "schema") ||
      !dataOnly(world.env, t.makeInput ?? t.decoded, "schema")
    ) {
      next = fail(
        next,
        at,
        "Schema decoded and encoded types must be data only",
      );
    }
    next = effects(next, `${at}.decodeRequirements`, {
      failures: [],
      requirements: t.decodeRequirements,
    });
    return effects(next, `${at}.encodeRequirements`, {
      failures: [],
      requirements: t.encodeRequirements,
    });
  }
  // A function checks its flags before its children.
  function enter(state: State, t: Type, at: string): State {
    if (t.kind === "function") return functionFlags(state, t, at);
    return state;
  }
  function leave(state: State, t: Type, at: string): State {
    // Every other check of a kind follows its children.
    if (t.kind === "primitive") return state;
    if (t.kind === "literal") return state;
    if (t.kind === "record") return state;
    if (t.kind === "array") return state;
    if (t.kind === "option") return state;
    if (t.kind === "ref") return state;
    if (t.kind === "tuple") return state;
    if (t.kind === "union") return state;
    if (t.kind === "named") {
      let found = false;
      if (t.id.startsWith("type:")) found = world.types.has(t.id);
      else if (t.id.startsWith("error:")) found = world.errors.has(t.id);
      if (!found) return fail(state, at, `the type ${t.id} is not declared`);
      return state;
    }
    if (t.kind === "retry-schedule") {
      if (t.error.kind !== "named" || !t.error.id.startsWith("error:")) {
        return fail(state, at, "a retry schedule needs a declared error type");
      }
      return state;
    }
    if (t.kind === "schema") return schemaShape(state, t, at);
    if (t.kind === "effect") return effects(state, `${at}.effects`, t.effects);
    if (t.kind === "stream") return effects(state, `${at}.effects`, t.effects);
    if (t.kind === "sink") return effects(state, `${at}.effects`, t.effects);
    if (t.kind === "function") {
      let next = effects(state, `${at}.effects`, t.effects);
      if (
        t.execution === "pure" &&
        (t.effects.failures.length > 0 || t.effects.requirements.length > 0)
      ) {
        next = {
          report: next.report.add(
            AREA.types,
            at,
            "a pure function type must have empty failure and requirement rows",
            span,
          ),
          valid: false,
        };
      }
      return next;
    }
    let next = state;
    for (const entry of t.provides.entries()) {
      const id = entry[1];
      const i = entry[0];
      if (!world.methods.has(id)) {
        next = fail(
          next,
          `${at}.provides[${i}]`,
          `the provided capability ${id} is not a declared service method`,
        );
      }
    }
    return effects(next, `${at}.acquisition.effects`, t.acquisition.effects);
  }
  const initial = { report: ctx.report, valid: true };
  const result = walkTypeBounded(initial, span, type, path, enter, leave);
  return { ctx: { ...ctx, report: result.report }, valid: result.valid };
}

export function checkFieldNames(
  ctx: Ctx,
  fields: readonly Field[],
  path: ValidationPath,
  span: Span,
): Ctx {
  let seen = emptySet<string>();
  for (const entry of fields.entries()) {
    const f = entry[1];
    const i = entry[0];
    if (seen.has(f.name)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}[${i}]`,
        `the field ${f.name} appears twice`,
        span,
      );
    }
    seen = seen.add(f.name);
  }
  return ctx;
}

/** The type kinds without an encoded form. */
const DEFERRED_KINDS: readonly Type["kind"][] = [
  "function",
  "effect",
  "stream",
  "sink",
  "retry-schedule",
  "ref",
  "schema",
  "provider",
];

/**
 * True when the type contains a function or deferred type, directly or
 * through an alias. A repeated alias stops a cycle. Data types, errors, and
 * opaque types stop the walk, because their own declarations are checked on their own.
 */
function containsDeferred(
  env: TypeEnv,
  type: Type,
  seen: ReadonlySet<string> | undefined,
  depth: number | undefined,
): boolean {
  const visited = seen === undefined ? emptySet<string>() : seen;
  const currentDepth = depth === undefined ? 0 : depth;
  if (DEFERRED_KINDS.includes(type.kind)) return true;
  if (currentDepth > MAX_DEPTH) return false;
  if (type.kind === "named") {
    const alias = env.aliases.get(type.id);
    if (alias === undefined || visited.has(type.id)) return false;
    return containsDeferred(
      env,
      alias,
      setFrom([...visited, type.id]),
      currentDepth + 1,
    );
  }
  return typeChildren(type).some((c) =>
    containsDeferred(env, c.type, visited, currentDepth + 1)
  );
}

/** Reports each field of a data or error declaration that holds a function or deferred type. */
export function checkDeferredFields(
  ctx: Ctx,
  fields: readonly Field[],
  path: ValidationPath,
  span: Span,
): Ctx {
  for (const entry of fields.entries()) {
    const f = entry[1];
    const i = entry[0];
    if (containsDeferred(ctx.world.env, f.type, undefined, undefined)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}[${i}].type`,
        `the field ${f.name} has a function or deferred type, which a tagged record or error declaration cannot hold`,
        span,
      );
    }
  }
  return ctx;
}

export function checkRecordFields(
  ctx: Ctx,
  type: Type,
  path: ValidationPath,
  span: Span,
): Ctx {
  const initial = { report: ctx.report, valid: true };
  const result = walkTypeBounded(initial, span, type, path, (state, t, at) => {
    if (t.kind === "record") {
      const next = checkFieldNames(
        { ...ctx, report: state.report },
        t.fields,
        `${at}.fields`,
        span,
      );
      return { ...state, report: next.report };
    }
    return state;
  }, undefined);
  return { ...ctx, report: result.report };
}

export function checkDeclaredType(
  ctx: Ctx,
  type: Type,
  path: ValidationPath,
  span: Span,
): Ctx {
  if (
    span.source.endsWith(".effi") && containsRefinement(ctx.world.env, type)
  ) {
    ctx = flag(
      ctx,
      AREA.types,
      path,
      "host interfaces must expose unrefined data",
      span,
    );
  }
  ctx = checkTypeIds(ctx, type, path, span).ctx;
  return checkRecordFields(ctx, type, path, span);
}
