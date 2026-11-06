// Checks of the types inside declarations: every identity in a type resolves,
// and no record type repeats a field name.

import type { Field, FunctionType, Span, Type } from "../ir.ts";
import { SCHEMA_ERROR_ID, SCOPE_CAPABILITY } from "../ir.ts";
import { AREA } from "./report.ts";
import {
  containsRefinement,
  dataOnly,
  entrySchemaDerivable,
  type TypeEnv,
} from "./typing.ts";
import { MAX_DEPTH, typeChildren, walkTypeBounded } from "./type_children.ts";
import type { Ctx } from "./world_table.ts";

/**
 * Checks that every identity in a type resolves: named types, failure
 * identities, and capability identities. Returns true when all resolve.
 */
export function checkTypeIds(
  ctx: Ctx,
  type: Type,
  path: string,
  span: Span,
): boolean {
  const { world, report } = ctx;
  let ok = true;
  const fail = (at: string, what: string): void => {
    ok = false;
    report.add(AREA.identity, at, what, span);
  };
  const effects = (
    at: string,
    e: {
      readonly failures: readonly string[];
      readonly requirements: readonly string[];
    },
  ): void => {
    e.failures.forEach((id, i) => {
      if (!world.errors.has(id)) {
        fail(
          `${at}.failures[${i}]`,
          `the failure ${id} is not a declared error`,
        );
      }
    });
    e.requirements.forEach((id, i) => {
      if (!world.methods.has(id) && id !== SCOPE_CAPABILITY) {
        fail(
          `${at}.requirements[${i}]`,
          `the requirement ${id} is not a declared service method`,
        );
      }
    });
  };
  const functionFlags = (t: FunctionType, at: string): void => {
    if (t.borrows !== undefined && t.borrows.length !== t.parameters.length) {
      fail(at, "borrow flags must match function parameters");
    }
    if (
      t.checked !== undefined &&
      (t.checked.length !== t.parameters.length ||
        t.checked.some((checked) => typeof checked !== "boolean"))
    ) {
      fail(at, "checked flags must be booleans and match function parameters");
    }
    if (t.checked?.some(Boolean)) {
      const invalid = (message: string): void => {
        ok = false;
        report.add(AREA.contracts, `${at}.checked`, message, span);
      };
      if (t.execution !== "effect") {
        invalid("a checked function must have effect execution");
      }
      if (!t.effects.failures.includes(SCHEMA_ERROR_ID)) {
        invalid("a checked function must declare SchemaError");
      }
      t.parameters.forEach((parameter, index) => {
        if (t.checked?.[index] && !entrySchemaDerivable(world.env, parameter)) {
          invalid(
            "a checked function parameter needs a schema-derivable contract",
          );
        }
      });
    }
  };
  const schemaShape = (
    t: Extract<Type, { readonly kind: "schema" }>,
    at: string,
  ): void => {
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
      if (value !== undefined && value !== true) {
        fail(at, `the Schema flag ${flag} must be absent or true`);
      }
    }
    if (
      Number(t.optionalKey === true) +
          Number(t.encodedOptionalKey === true) +
          Number(t.decodedOptionalKey === true) > 1
    ) fail(at, "Schema field optionality flags are mutually exclusive");
    if (
      !dataOnly(world.env, t.decoded, "schema") ||
      !dataOnly(world.env, t.encoded, "schema") ||
      !dataOnly(world.env, t.makeInput ?? t.decoded, "schema")
    ) {
      fail(at, "Schema decoded and encoded types must be data only");
    }
    effects(`${at}.decodeRequirements`, {
      failures: [],
      requirements: t.decodeRequirements,
    });
    effects(`${at}.encodeRequirements`, {
      failures: [],
      requirements: t.encodeRequirements,
    });
  };
  // A function checks its flags before its children.
  const enter = (t: Type, at: string): void => {
    if (t.kind === "function") functionFlags(t, at);
  };
  const leave = (t: Type, at: string): void => {
    // Every other check of a kind follows its children.
    switch (t.kind) {
      case "primitive":
      case "literal":
      case "record":
      case "array":
      case "option":
      case "ref":
      case "tuple":
      case "union":
        return;
      case "named": {
        const found = t.id.startsWith("type:")
          ? world.types.has(t.id)
          : t.id.startsWith("error:")
          ? world.errors.has(t.id)
          : false;
        if (!found) fail(at, `the type ${t.id} is not declared`);
        return;
      }
      case "retry-schedule":
        if (t.error.kind !== "named" || !t.error.id.startsWith("error:")) {
          fail(at, "a retry schedule needs a declared error type");
        }
        return;
      case "schema":
        schemaShape(t, at);
        return;
      case "effect":
      case "stream":
      case "sink":
        effects(`${at}.effects`, t.effects);
        return;
      case "function":
        effects(`${at}.effects`, t.effects);
        if (
          t.execution === "pure" &&
          (t.effects.failures.length > 0 ||
            t.effects.requirements.length > 0)
        ) {
          report.add(
            AREA.types,
            at,
            "a pure function type must have empty failure and requirement rows",
            span,
          );
          ok = false;
        }
        return;
      case "provider":
        t.provides.forEach((id, i) => {
          if (!world.methods.has(id)) {
            fail(
              `${at}.provides[${i}]`,
              `the provided capability ${id} is not a declared service method`,
            );
          }
        });
        effects(`${at}.acquisition.effects`, t.acquisition.effects);
        return;
      default: {
        const unreachable: never = t;
        return unreachable;
      }
    }
  };
  walkTypeBounded(report, span, type, path, enter, leave);
  return ok;
}

export function checkFieldNames(
  ctx: Ctx,
  fields: readonly Field[],
  path: string,
  span: Span,
  tagReserved = false,
): void {
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (tagReserved && f.name === "_tag") {
      ctx.report.add(
        AREA.types,
        `${path}[${i}]`,
        "the field name _tag is reserved for generated tags",
        span,
      );
    }
    if (seen.has(f.name)) {
      ctx.report.add(
        AREA.types,
        `${path}[${i}]`,
        `the field ${f.name} appears twice`,
        span,
      );
    }
    seen.add(f.name);
  });
}

/** The type kinds without an encoded form. */
const DEFERRED_KINDS: ReadonlySet<Type["kind"]> = new Set([
  "function",
  "effect",
  "stream",
  "sink",
  "retry-schedule",
  "ref",
  "schema",
  "provider",
]);

/**
 * True when the type contains a function or deferred type, directly or
 * through an alias. A repeated alias stops a cycle. Data types, errors, and
 * opaque types stop the walk, because their own declarations are checked on their own.
 */
function containsDeferred(
  env: TypeEnv,
  type: Type,
  seen = new Set<string>(),
  depth = 0,
): boolean {
  if (DEFERRED_KINDS.has(type.kind)) return true;
  if (depth > MAX_DEPTH) return false;
  if (type.kind === "named") {
    const alias = env.aliases.get(type.id);
    if (alias === undefined || seen.has(type.id)) return false;
    return containsDeferred(env, alias, new Set([...seen, type.id]), depth + 1);
  }
  return typeChildren(type).some((c) =>
    containsDeferred(env, c.type, seen, depth + 1)
  );
}

/** Reports each field of a data or error declaration that holds a function or deferred type. */
export function checkDeferredFields(
  ctx: Ctx,
  fields: readonly Field[],
  path: string,
  span: Span,
): void {
  fields.forEach((f, i) => {
    if (containsDeferred(ctx.world.env, f.type)) {
      ctx.report.add(
        AREA.types,
        `${path}[${i}].type`,
        `the field ${f.name} has a function or deferred type, which a tagged record or error declaration cannot hold`,
        span,
      );
    }
  });
}

export function checkRecordFields(
  ctx: Ctx,
  type: Type,
  path: string,
  span: Span,
): void {
  walkTypeBounded(ctx.report, span, type, path, (t, at) => {
    if (t.kind === "record") {
      checkFieldNames(ctx, t.fields, `${at}.fields`, span);
    }
  });
}

export function checkDeclaredType(
  ctx: Ctx,
  type: Type,
  path: string,
  span: Span,
): void {
  if (
    span.source.endsWith(".effi") && containsRefinement(ctx.world.env, type)
  ) {
    ctx.report.add(
      AREA.types,
      path,
      "host interfaces must expose unrefined data",
      span,
    );
  }
  checkTypeIds(ctx, type, path, span);
  checkRecordFields(ctx, type, path, span);
}
