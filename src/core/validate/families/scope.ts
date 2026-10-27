// Validation of the Scope builtins: scoped, forkScoped, the explicit scope operations,
// and withResource. This file also holds the borrow walk of a function parameter.

import {
  type ErrorId,
  type Expr,
  type Field,
  SCOPE_CAPABILITY,
  type Span,
  type Type,
} from "../../ir.ts";
import { AREA } from "../report.ts";
import { combine, invocationOf, minus } from "../sets.ts";
import {
  asFunction,
  dataOnly,
  fits,
  same,
  show,
  unfold,
  UNIT,
} from "../typing.ts";
import { walkExprs } from "../expr_walk.ts";
import {
  type Comp,
  derivedResult,
  EFFECT_ONLY,
  type ValidatorCore,
} from "./context.ts";

export function scoped(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "scoped" }>,
  path: string,
): Comp {
  const value = c.check(e.value, `${path}.value`);
  const effect = unfold(c.env, value.type);
  if (effect.kind !== "effect") {
    c.add(AREA.control, path, "scoped needs an Effect value", e.span);
    return c.poison();
  }
  return derivedResult(
    effect.result,
    combine([value, {
      failures: effect.effects.failures,
      requirements: minus(effect.effects.requirements, [SCOPE_CAPABILITY]),
      execution: "effect",
    }]),
  );
}

export function forkScoped(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "fork-scoped" }>,
  path: string,
): Comp {
  const job = c.check(e.job, `${path}.job`);
  const effect = unfold(c.env, job.type);
  if (effect.kind !== "effect") {
    c.add(AREA.control, path, "forkScoped needs an Effect value", e.span);
    return c.poison();
  }
  if (effect.effects.failures.length > 0) {
    c.add(
      AREA.control,
      path,
      "forkScoped needs an Effect value without typed failures",
      e.span,
    );
  }
  return derivedResult(
    UNIT,
    combine([job, {
      failures: [],
      requirements: [...effect.effects.requirements, SCOPE_CAPABILITY],
      execution: "effect",
    }]),
  );
}

export function explicitScope(
  c: ValidatorCore,
  e: Extract<
    Expr,
    { kind: "provide-scope" | "add-scope-finalizer" | "close-scope" }
  >,
  path: string,
): Comp {
  const owner = c.check(e.owner, `${path}.owner`);
  if (!fits(c.env, owner.type, { kind: "closeable-scope" })) {
    c.add(
      AREA.control,
      path,
      `${e.kind} needs a CloseableScope owner`,
      e.span,
    );
  }
  if (e.kind === "close-scope") {
    return derivedResult(UNIT, combine([owner, EFFECT_ONLY]));
  }
  const job = c.check(e.job, `${path}.job`);
  const effect = unfold(c.env, job.type);
  if (effect.kind !== "effect") {
    c.add(AREA.control, path, `${e.kind} needs an Effect value`, e.span);
    return c.poison();
  }
  if (
    e.kind === "add-scope-finalizer" && (
      !fits(c.env, effect.result, UNIT) ||
      effect.effects.failures.length > 0 ||
      effect.effects.requirements.includes(SCOPE_CAPABILITY)
    )
  ) {
    c.add(
      AREA.control,
      path,
      "a scope finalizer must return void without typed failures or the reserved Scope requirement",
      e.span,
    );
  }
  return derivedResult(
    e.kind === "provide-scope" ? effect.result : UNIT,
    combine([owner, job, {
      failures: e.kind === "provide-scope" ? effect.effects.failures : [],
      requirements: e.kind === "provide-scope"
        ? minus(effect.effects.requirements, [SCOPE_CAPABILITY])
        : effect.effects.requirements,
      execution: "effect",
    }]),
  );
}

function checkOperationRecord(
  c: ValidatorCore,
  type: Type,
  path: string,
  span: Span,
): void {
  const value = unfold(c.env, type);
  if (
    value.kind !== "record" || value.fields.length === 0 ||
    value.fields.some((f) => f.optional)
  ) {
    c.add(
      AREA.types,
      path,
      "acquisition must return a nonempty record of required operations",
      span,
    );
    return;
  }
  for (const field of value.fields) {
    const fn = asFunction(c.env, field.type);
    if (
      fn === undefined || !fn.parameters.every((p) =>
        dataOnly(c.env, p, "value")
      ) ||
      !dataOnly(c.env, fn.result, "value")
    ) {
      c.add(
        AREA.types,
        `${path}.${field.name}`,
        "an operation must take and return data-only values",
        span,
      );
    }
  }
}

function scopedReferences(
  c: ValidatorCore,
  body: Expr,
  id: string,
  path: string,
): void {
  walkExprs(body, (e, parent, grandparent, nested) => {
    if (e.kind === "reference" && e.target === id) {
      if (
        nested || parent?.kind !== "get" || parent.record !== e ||
        grandparent?.kind !== "call" || grandparent.callee !== parent
      ) {
        c.add(
          AREA.control,
          path,
          "a scoped operation record may only be the direct receiver of an operation call",
          e.span,
        );
      }
    }
  });
}

/**
 * The type of an outcome binding, recomputed from the success type and the
 * failures that remain. The Failure member is absent when none remain.
 */
function outcomeOf(result: Type, failures: readonly ErrorId[]): Type {
  const member = (tag: string, ...fields: Field[]): Type => ({
    kind: "record",
    fields: [
      {
        name: "_tag",
        type: { kind: "literal", value: tag },
        optional: false,
      },
      ...fields,
    ],
  });
  const field = (name: string, type: Type): Field => ({
    name,
    type,
    optional: false,
  });
  return {
    kind: "union",
    members: [
      member("Success", field("success", result)),
      ...(failures.length === 0 ? [] : [member(
        "Failure",
        field("failure", {
          kind: "union",
          members: failures.map((id) => ({ kind: "named" as const, id })),
        }),
      )]),
      member("Defect", field("message", { kind: "primitive", name: "string" })),
      member("Interrupted"),
    ],
  };
}

export function ensure(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "ensure" }>,
  path: string,
): Comp {
  const body = c.check(e.body, `${path}.body`);
  const finalizer = c.check(e.finalizer, `${path}.finalizer`);
  const f = asFunction(c.env, finalizer.type);
  if (
    e.finalizer.kind !== "closure" || f === undefined ||
    f.parameters.length > 1 ||
    e.finalizer.parameters.length !== f.parameters.length
  ) {
    c.add(
      AREA.control,
      `${path}.finalizer`,
      "an ensure finalizer is a closure with zero or one parameter",
      e.span,
    );
    return c.poison();
  }
  if (f.parameters.length === 1) {
    const expected = outcomeOf(e.type, body.failures);
    if (!same(c.env, f.parameters[0], expected)) {
      c.add(
        AREA.types,
        `${path}.finalizer.parameters[0]`,
        `the outcome has type ${show(expected)}, recorded ${
          show(f.parameters[0])
        }`,
        e.finalizer.span,
      );
    }
    if (!dataOnly(c.env, e.type, "value")) {
      c.add(
        AREA.types,
        `${path}.type`,
        "an outcome binding needs a data-only protected result",
        e.span,
      );
    }
  }
  if (!fits(c.env, f.result, UNIT)) {
    c.add(
      AREA.types,
      `${path}.finalizer.type.result`,
      "a finalizer must return void",
      e.finalizer.span,
    );
  }
  return derivedResult(
    body.type,
    combine([body, finalizer, invocationOf(f), EFFECT_ONLY]),
    "fit",
  );
}

export function withResource(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "with-resource" }>,
  path: string,
): Comp {
  const acquire = c.check(e.acquire, `${path}.acquire`);
  const use = c.check(e.use, `${path}.use`);
  const release = c.check(e.release, `${path}.release`);
  const a = asFunction(c.env, acquire.type);
  const u = asFunction(c.env, use.type);
  const r = asFunction(c.env, release.type);
  if (
    e.acquire.kind !== "closure" || e.use.kind !== "closure" ||
    e.release.kind !== "closure" || a === undefined || u === undefined ||
    r === undefined
  ) {
    c.add(
      AREA.control,
      path,
      "with-resource requires three inline closures",
      e.span,
    );
    return c.poison();
  }
  if (
    a.parameters.length !== 0 || u.parameters.length !== 1 ||
    r.parameters.length < 1 || r.parameters.length > 2 ||
    e.acquire.parameters.length !== 0 || e.use.parameters.length !== 1 ||
    e.release.parameters.length !== r.parameters.length
  ) {
    c.add(
      AREA.control,
      path,
      "with-resource callback arity or scoped identity is invalid",
      e.span,
    );
    return c.poison();
  }
  const acquired = unfold(c.env, a.result);
  const opaque = acquired.kind === "named" &&
    c.ctx.world.types.get(acquired.id)?.opaque === true;
  if (!opaque) {
    checkOperationRecord(
      c,
      a.result,
      `${path}.acquire.type.result`,
      e.acquire.span,
    );
  }
  if (
    !same(c.env, a.result, u.parameters[0]) ||
    !same(c.env, a.result, r.parameters[0])
  ) {
    c.add(
      AREA.types,
      path,
      "use and release must accept the acquired operation record",
      e.span,
    );
  }
  if (r.parameters.length === 2) {
    const expected = outcomeOf(u.result, u.effects.failures);
    if (!same(c.env, r.parameters[1], expected)) {
      c.add(
        AREA.types,
        `${path}.release.parameters[1]`,
        `the outcome has type ${show(expected)}, recorded ${
          show(r.parameters[1])
        }`,
        e.release.span,
      );
    }
  }
  if (!fits(c.env, r.result, UNIT)) {
    c.add(
      AREA.types,
      `${path}.release.type.result`,
      "release must return void",
      e.release.span,
    );
  }
  if (!dataOnly(c.env, u.result, "value")) {
    c.add(
      AREA.types,
      `${path}.use.type.result`,
      "use must return data only",
      e.use.span,
    );
  }
  if (opaque) {
    borrowedReferences(
      c,
      e.use.body,
      e.use.parameters[0].id,
      `${path}.use.body`,
    );
    borrowedReferences(
      c,
      e.release.body,
      e.release.parameters[0].id,
      `${path}.release.body`,
    );
  } else {
    scopedReferences(c, e.use.body, e.use.parameters[0].id, `${path}.use.body`);
    scopedReferences(
      c,
      e.release.body,
      e.release.parameters[0].id,
      `${path}.release.body`,
    );
  }
  return derivedResult(
    u.result,
    combine([
      acquire,
      use,
      release,
      invocationOf(a),
      invocationOf(u),
      invocationOf(r),
      EFFECT_ONLY,
    ]),
  );
}

export function borrowedReferences(
  c: ValidatorCore,
  body: Expr,
  id: string,
  path: string,
): void {
  walkExprs(body, (expr, parent, _grandparent, nested) => {
    if (expr.kind === "reference" && expr.target === id) {
      const index = parent?.kind === "perform" || parent?.kind === "call"
        ? parent.arguments.indexOf(expr)
        : -1;
      const method = parent?.kind === "perform"
        ? c.ctx.world.methods.get(parent.capability)
        : undefined;
      const functionType =
        parent?.kind === "call" && parent.callee.kind === "reference"
          ? c.ctx.world.values.get(parent.callee.target)
          : undefined;
      const borrowed = method?.borrows?.[index] === true ||
        (functionType?.kind === "function" &&
          functionType.borrows?.[index] === true);
      if (nested || index < 0 || !borrowed) {
        c.add(
          AREA.control,
          path,
          "borrowed handle may only pass to a borrow-qualified method",
          expr.span,
        );
      }
    }
  });
}
