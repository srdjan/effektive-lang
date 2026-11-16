// Validation of the Layer builtins: layer, mergeLayers, and provide.

import type { ValidationPath } from "../report.ts";
import { setFrom } from "../../runtime.ts";
import type { Expr } from "../../ir.ts";
import { AREA } from "../report.ts";
import {
  type Active,
  combine,
  EFFECT_ONLY,
  effectOf,
  minus,
  sortedUnique,
  unionEffects,
} from "../sets.ts";
import { asFunction, fits, show, unfold } from "../typing.ts";
import { flagCore, type ValidatorCore } from "./context.ts";
import { type Comp, derivedResult } from "../results.ts";

export function layer(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "layer" }>,
  path: ValidationPath,
): Comp {
  const acquire = c.check(e.acquire, `${path}.acquire`);
  const service = c.ctx.world.services.get(e.service);
  const fn = asFunction(c.env, acquire.type);
  if (
    service === undefined || fn === undefined || fn.parameters.length !== 0 ||
    e.acquire.kind !== "closure"
  ) {
    c = flagCore(
      c,
      AREA.control,
      path,
      "layer needs a declared service and inline zero-argument callback",
      e.span,
    );
    return c.poison();
  }
  const implementation = unfold(c.env, fn.result);
  if (
    implementation.kind !== "record" ||
    implementation.fields.length !== service.methods.length
  ) {
    c = flagCore(
      c,
      AREA.types,
      `${path}.acquire`,
      "layer must return exactly the service methods",
      e.acquire.span,
    );
    return c.poison();
  }
  for (const method of service.methods) {
    const field = implementation.fields.find((f) => f.name === method.name);
    if (
      field === undefined || field.optional ||
      !fits(c.env, field.type, method.type)
    ) {
      c = flagCore(
        c,
        AREA.types,
        `${path}.acquire`,
        `layer method ${method.name} does not fit its service contract`,
        e.acquire.span,
      );
    }
  }
  const provides = sortedUnique(service.methods.map((m) => m.id));
  if (fn.effects.requirements.some((r) => provides.includes(r))) {
    c = flagCore(
      c,
      AREA.control,
      path,
      "layer acquisition requires a method it provides",
      e.span,
    );
  }
  return derivedResult({
    kind: "provider",
    provides: provides,
    acquisition: { execution: "effect", effects: fn.effects },
  }, combine([acquire]));
}

export function mergeLayers(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "merge-layers" }>,
  path: ValidationPath,
): Comp {
  const left = c.check(e.left, `${path}.left`);
  const right = c.check(e.right, `${path}.right`);
  const a = unfold(c.env, left.type);
  const b = unfold(c.env, right.type);
  if (a.kind !== "provider" || b.kind !== "provider") {
    c = flagCore(
      c,
      AREA.types,
      path,
      "mergeLayers needs two Layer values",
      e.span,
    );
    return c.poison();
  }
  const services = setFrom(
    a.provides.map((id) => id.slice(0, id.lastIndexOf("."))),
  );
  if (
    b.provides.some((id) => services.has(id.slice(0, id.lastIndexOf("."))))
  ) {
    c = flagCore(
      c,
      AREA.control,
      path,
      "mergeLayers cannot provide one service twice",
      e.span,
    );
  }
  return derivedResult({
    kind: "provider",
    provides: sortedUnique([...a.provides, ...b.provides]),
    acquisition: {
      execution: "effect",
      effects: unionEffects([a.acquisition.effects, b.acquisition.effects]),
    },
  }, combine([left, right]));
}

export function provide(
  c: ValidatorCore,
  e: Extract<Expr, { kind: "provide" }>,
  path: ValidationPath,
): Comp {
  const provider = c.check(e.provider, `${path}.provider`);
  const job = c.check(e.job, `${path}.job`);
  const providerType = unfold(c.env, provider.type);
  if (providerType.kind !== "provider") {
    c = flagCore(
      c,
      AREA.control,
      `${path}.provider`,
      `provide needs a provider, but the expression has type ${
        show(provider.type)
      }`,
      e.provider.span,
    );
  }
  const fn = c.jobFunction(job, `${path}.job`, e.job.span, "provide");
  if (fn === undefined || providerType.kind !== "provider") {
    return c.poison();
  }
  const invocation: Active = {
    failures: fn.effects.failures,
    requirements: minus(fn.effects.requirements, providerType.provides),
    execution: fn.execution,
  };
  const acquisition: Active = effectOf(
    providerType.acquisition.effects.failures,
    providerType.acquisition.effects.requirements,
  );
  return derivedResult(
    fn.result,
    combine([provider, job, invocation, acquisition, EFFECT_ONLY]),
  );
}
