// Bottom-up recomputation of the annotations of one declaration body. For each
// node the validator recomputes the type, the failure set, the requirement set,
// and the execution mode from the children and from the identities in scope.
// It then compares the result with the recorded annotation.
//
// After a disagreement the validator continues with the recomputed value, so one
// bad node gives one diagnostic and its parents stay consistent. When a node
// cannot be recomputed (an unknown identity), the validator continues with the
// recorded annotation.
//
// The equations come from the spec, "Equations and validation".

import { isTrue } from "./guards.ts";
import { emptyMap, emptySet, setFrom } from "../runtime.ts";
import { panic } from "../source.ts";
import {
  type BuiltinCallName,
  CALLBACK_SHAPES,
  classifyBuiltinCall,
  isCallbackBuiltin,
  isConcurrencyOption,
} from "./builtins.ts";

/** The builtins that do not take a closed unit argument, although a closed unit widens to `int`. */
const UNITLESS_BUILTINS: readonly (BuiltinCallName | undefined)[] = [
  "div",
  "trunc",
  "floor",
  "round",
  "ceil",
  "text",
  "at",
];

import type {
  ConstantDecl,
  Effects,
  ErrorId,
  Execution,
  Expr,
  FunctionDecl,
  FunctionType,
  Parameter,
  Pattern,
  Span,
  Type,
} from "../ir.ts";
import {
  DURATION_ID,
  INSTANT_ID,
  isClosedUnitId,
  SCHEMA_ERROR_ID,
} from "../ir.ts";
import { AREA, type AreaCode, type Report } from "./report.ts";
import {
  type Active,
  combine,
  EFFECT_ONLY,
  effectOf,
  invocationOf,
  isQuiet,
  isSubset,
  minus,
  QUIET,
  sameSet,
  sortedUnique,
} from "./sets.ts";
import { isReservedError } from "./prelude.ts";
import { MAX_DEPTH } from "./type_children.ts";
import {
  asFunction,
  BOOLEAN,
  closedUnitsDiffer,
  comparisonClass,
  compatibleClasses,
  containsUnknown,
  dataOnly,
  entrySchemaDerivable,
  fieldsOf,
  fits,
  fitsCheckedInput,
  fitsNullComparison,
  foreignSealedOf,
  identityBody,
  identityMembers,
  INT,
  isBooleanLike,
  isDurationType,
  isInstantType,
  isNever,
  isNumericClass,
  isStringClass,
  members,
  NEVER,
  NUMBER,
  numericIdentityOf,
  ownsSealed,
  same,
  sealedRootOf,
  show,
  STRING,
  type TypeEnv,
  unfold,
  unionOf,
  UNIT,
} from "./typing.ts";
import { checkTypeIds } from "./type_checks.ts";
import { type Ctx, flag } from "./world_table.ts";
import { exprChildren } from "./expr_walk.ts";
import type { ValidatorCore } from "./families/context.ts";
import { type Comp, derivedResult, fittedResult, type Out } from "./results.ts";
import {
  defer,
  log,
  race,
  raceAll,
  randomInt,
  repeat,
  retry,
  retrySchedule,
  retryWithSchedule,
  run,
  sleep,
  timeout,
  uninterruptible,
} from "./families/effect.ts";
import { layer, mergeLayers, provide } from "./families/layer.ts";
import {
  borrowedReferences,
  ensure,
  forkScoped,
  scoped,
  withResource,
} from "./families/scope.ts";
import {
  bufferStream,
  mapElements,
  runStream,
  sinkForEach,
  takeSink,
  transduceStream,
  unfoldStream,
} from "./families/stream.ts";
import { schema, schemaOperation } from "./families/schema.ts";
import { refOperation } from "./families/ref.ts";
import {
  createRefinementValidator,
  negateRefinement,
  type RefinementValidator,
} from "./refinements.ts";

/** An identity list in a message, such as `[A, B]`. */
function list(items: readonly string[]): string {
  return `[${items.join(", ")}]`;
}

function checkedResult(active: Active): Comp {
  return { kind: "checked", active: active };
}

function isNullType(env: TypeEnv, type: Type): boolean {
  const unfolded = unfold(env, type);
  return unfolded.kind === "literal" && unfolded.value === null;
}

/** Equality can match unknown values and the runtime base of types with identity. */
function tagMayEqual(
  env: TypeEnv,
  type: Type,
  value: string | number | boolean | null,
): boolean {
  return tagMayEqualSeen(env, type, value, emptySet());
}

function tagMayEqualSeen(
  env: TypeEnv,
  type: Type,
  value: string | number | boolean | null,
  seen: Set<Type>,
): boolean {
  if (seen.has(type)) return true;
  // A type past the depth bound fails, as it does in `fits`.
  if (seen.size >= MAX_DEPTH) return false;
  const next = setFrom(seen).add(type);
  if (type.kind === "named") {
    const base = env.aliases.get(type.id) ?? env.opaqueBases.get(type.id);
    return base !== undefined && tagMayEqualSeen(env, base, value, next);
  }
  if (type.kind === "union") {
    return type.members.some((m) => tagMayEqualSeen(env, m, value, next));
  }
  if (type.kind === "primitive" && type.name === "unknown") return true;
  return fits(env, { kind: "literal", value: value }, type);
}

/**
 * The identity type when exactly one operand is a numeric identity and the
 * other operand is unnamed and fits the body of that identity.
 */
function adoptedNumericIdentity(
  env: TypeEnv,
  left: Type,
  right: Type,
): Type | undefined {
  const l = numericIdentityOf(env, left);
  const r = numericIdentityOf(env, right);
  if ((l === undefined) === (r === undefined)) return undefined;
  const named = l ?? r;
  // `Duration` and `Instant` have their own operator rules.
  if (named?.kind !== "named" || isClosedUnitId(named.id)) return undefined;
  const unnamed = l === undefined ? left : right;
  const body = identityBody(env, named.id);
  return body !== undefined && fits(env, unnamed, body) ? named : undefined;
}

/** The type of the binding of a `Defect` arm. */
const DEFECT_RECORD: Type = {
  kind: "record",
  fields: [{ name: "message", type: STRING, optional: false }],
};

export type BodyValidator = ValidatorCore & {
  readonly checkFunction: (
    declaration: FunctionDecl,
    path: string,
  ) => Report;
  readonly checkConstant: (
    declaration: ConstantDecl,
    path: string,
  ) => Report;
};

export function createBodyValidator(ctx: Ctx): BodyValidator {
  let scope = emptyMap<string, Type>();
  let declared = emptySet<string>();
  let checkedRaw = emptySet<Expr>();
  let refinements = createRefinementValidator(ctx);
  const env = ctx.world.env;

  function add(
    area: AreaCode,
    path: string,
    what: string,
    span: Span,
  ): Report {
    return ctx.report.add(area, path, what, span);
  }

  function declareLocal(
    p: Parameter,
    path: string,
    init: Expr | undefined,
    generated: boolean,
  ): Ctx {
    if (!p.id.startsWith("local:")) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.id`,
        `${p.id} is not a local identity`,
        p.span,
      );
    }
    if (declared.has(p.id)) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.id`,
        `the local ${p.id} is declared twice in this function`,
        p.span,
      );
    }
    declared = declared.add(p.id);
    scope = scope.set(p.id, p.type);
    if (!generated) refinements = refinements.addLocal(p, init);
    ctx = checkTypeIds(ctx, p.type, `${path}.type`, p.span).ctx;
    return ctx;
  }

  function release(ids: readonly string[]): Ctx {
    for (const id of ids) {
      if (!scope.delete(id)) continue;
    }
    refinements = refinements.release(ids);
    return ctx;
  }

  /**
   * Runs `run` with the locals that it declares in scope, and releases them
   * when `run` returns. A local cannot stay in scope after its region. A throw
   * ends the validator: the guard in `index.ts` makes a new one per declaration.
   */
  function withLocals<T>(
    run: (
      declare: (
        p: Parameter,
        path: string,
        init: Expr | undefined,
        generated: boolean,
      ) => Ctx,
    ) => T,
  ): T {
    const added: string[] = [];
    const result = run((p, path, init, generated) => {
      ctx = declareLocal(p, path, init, generated);
      added[added.length] = p.id;
      return ctx;
    });
    ctx = release(added);
    return result;
  }

  function checkParameterTypes(
    parameters: readonly Parameter[],
    recorded: readonly Type[],
    path: string,
    countMessage: string,
    span: Span,
  ): Ctx {
    if (recorded.length !== parameters.length) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type.parameters`,
        countMessage,
        span,
      );
      return ctx;
    }
    for (const entry of parameters.entries()) {
      const p = entry[1];
      const j = entry[0];
      if (!same(env, p.type, recorded[j])) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.type.parameters[${j}]`,
          `expected ${show(p.type)}, recorded ${show(recorded[j])}`,
          p.span,
        );
      }
    }
    return ctx;
  }

  /** Checks ordinary compatibility or one independently verified refinement. */
  function accepts(
    expression: Expr,
    source: Type,
    target: Type,
    path: string,
  ): boolean {
    return acceptsMode(expression, source, target, path, false);
  }

  function acceptsMode(
    expression: Expr,
    source: Type,
    target: Type,
    path: string,
    checked: boolean,
  ): boolean {
    if (fits(env, source, target)) return true;
    const raw = checked || checkedRaw.has(expression);
    if (
      raw && containsUnknown(env, source) &&
      fitsCheckedInput(env, source, target)
    ) return true;
    if (expression.execution === "effect") {
      refinements = refinements.clearDerivedFacts();
    }
    if (
      refinements.adoption(expression, source, target, path) === "handled"
    ) return true;
    return raw && fitsCheckedInput(env, source, target);
  }

  /** Marks only direct aggregate values that execute inside a checked call. */
  function markCheckedRaw(expression: Expr, marked: Set<Expr>): Set<Expr> {
    marked = marked.add(expression);
    if (expression.kind === "some") {
      return markCheckedRaw(expression.value, marked);
    }
    if (expression.kind === "record" || expression.kind === "update") {
      for (const field of expression.fields) {
        marked = markCheckedRaw(field.value, marked);
      }
      return marked;
    }
    if (expression.kind === "array" || expression.kind === "tuple") {
      for (const element of expression.elements) {
        marked = markCheckedRaw(element, marked);
      }
      return marked;
    }
    if (expression.kind === "block") {
      return markCheckedRaw(expression.result, marked);
    }
    if (expression.kind === "if") {
      marked = markCheckedRaw(expression.then, marked);
      return markCheckedRaw(expression.else, marked);
    }
    if (expression.kind === "match") {
      for (const arm of expression.arms) {
        marked = markCheckedRaw(arm.body, marked);
      }
    }
    return marked;
  }

  /** The recorded execution mode must follow the body mode and the effect sets. */
  function checkExecution(
    recorded: { readonly execution: Execution; readonly effects: Effects },
    body: Active,
    path: string,
    span: Span,
  ): Ctx {
    const nonempty =
      recorded.effects.failures.length + recorded.effects.requirements.length >
        0;
    const expected = nonempty || body.execution === "effect"
      ? "effect"
      : "pure";
    if (recorded.execution !== expected) {
      ctx = flag(
        ctx,
        AREA.execution,
        `${path}.type.execution`,
        `expected ${expected}, recorded ${recorded.execution}`,
        span,
      );
    }
    return ctx;
  }

  function checkFunction(d: FunctionDecl, path: string): Report {
    const checkedFlags = d.type.checked;
    const checkedIds = d.parameters.filter((_, index) =>
      isTrue(checkedFlags === undefined ? undefined : checkedFlags[index])
    ).map((parameter) => parameter.id);
    const recordedChecks = d.entryValidation ?? [];
    if (
      recordedChecks.length !== checkedIds.length ||
      recordedChecks.some((id, index) => id !== checkedIds[index]) ||
      (checkedIds.length === 0 && d.entryValidation !== undefined)
    ) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.entryValidation`,
        "entry validation must list exactly the checked parameters in declaration order",
        d.span,
      );
    }
    if (checkedIds.length > 0 && !ctx.world.exports.has(d.id)) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.entryValidation`,
        "only an exported function can have checked entry parameters",
        d.span,
      );
    }
    for (const entry of d.parameters.entries()) {
      const parameter = entry[1];
      const index = entry[0];
      if (
        isTrue(checkedFlags === undefined ? undefined : checkedFlags[index]) &&
        (!entrySchemaDerivable(env, parameter.type) ||
          foreignSealedOf(env, parameter.type) !== undefined)
      ) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.parameters[${index}].type`,
          "a checked entry parameter needs a schema-derivable closed data type",
          parameter.span,
        );
      }
    }
    const body = withLocals((declare) => {
      for (const entry of d.parameters.entries()) {
        const p = entry[1];
        const j = entry[0];
        ctx = declare(p, `${path}.parameters[${j}]`, undefined, false);
      }
      ctx = checkParameterTypes(
        d.parameters,
        d.type.parameters,
        path,
        `the function type has ${d.type.parameters.length} parameters, the function declares ${d.parameters.length}`,
        d.span,
      );
      const checked = check(d.body, `${path}.body`);
      if (
        d.type.borrows !== undefined &&
        d.type.borrows.length !== d.parameters.length
      ) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.type.borrows`,
          "borrow flags must match function parameters",
          d.span,
        );
      }
      const borrowFlags = d.type.borrows;
      for (const entry of d.parameters.entries()) {
        const parameter = entry[1];
        const index = entry[0];
        const borrowFlag = borrowFlags === undefined
          ? undefined
          : borrowFlags[index];
        if (isTrue(borrowFlag) && !isTrue(parameter.borrow)) {
          ctx = flag(
            ctx,
            AREA.types,
            `${path}.parameters[${index}]`,
            "borrow parameter flag disagrees with function type",
            parameter.span,
          );
        }
        if (!isTrue(parameter.borrow)) continue;
        const type = unfold(env, parameter.type);
        if (
          type.kind !== "named" ||
          !isTrue(ctx.world.types.get(type.id)?.opaque)
        ) {
          ctx = flag(
            ctx,
            AREA.types,
            `${path}.parameters[${index}]`,
            "a borrow parameter needs an opaque type",
            parameter.span,
          );
        }
        if (!isTrue(borrowFlag)) {
          ctx = flag(
            ctx,
            AREA.types,
            `${path}.type.borrows[${index}]`,
            "borrow flag missing from function type",
            parameter.span,
          );
        }
        if (!dataOnly(env, d.type.result, "value")) {
          ctx = flag(
            ctx,
            AREA.types,
            `${path}.type.result`,
            "a borrow function must return data only",
            d.span,
          );
        }
        ctx = {
          ...ctx,
          report: borrowedReferences(
            validator,
            d.body,
            parameter.id,
            `${path}.body`,
          ).ctx.report,
        };
      }
      return checked;
    });
    const activeBody = checkedIds.length === 0 ? body : {
      failures: sortedUnique([...body.failures, SCHEMA_ERROR_ID]),
      requirements: body.requirements,
      execution: "effect" as const,
      type: body.type,
    };
    if (!accepts(d.body, body.type, d.type.result, `${path}.body`)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.body`,
        `the body type ${show(body.type)} does not fit the declared result ${
          show(d.type.result)
        }`,
        d.body.span,
      );
    }
    // A written set bounds the body from above. An inferred set equals the body.
    ctx = checkContractSet(d, activeBody, path, "failures", "can fail with");
    ctx = checkContractSet(d, activeBody, path, "requirements", "requires");
    ctx = checkExecution(d.type, activeBody, path, d.span);
    refinements = refinements.audit(d.body, `${path}.body`, exprChildren);
    return ctx.report;
  }

  /** Checks one declared set of a function against the set of its body. `verb` names what the body does with the set. */
  function checkContractSet(
    d: FunctionDecl,
    body: Effects,
    path: string,
    key: "failures" | "requirements",
    verb: string,
  ): Ctx {
    const declared = d.type.effects[key];
    if (d.written[key === "failures" ? "fails" : "uses"]) {
      const extra = minus(body[key], declared);
      if (extra.length > 0) {
        ctx = flag(
          ctx,
          AREA.contracts,
          `${path}.body`,
          `the body ${verb} ${list(extra)}, which the declared ${key} ${
            list(declared)
          } do not list`,
          d.body.span,
        );
      }
    } else if (!sameSet(declared, body[key])) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.type.effects.${key}`,
        `an inferred contract equals the body: expected ${
          list(body[key])
        }, recorded ${list(declared)}`,
        d.span,
      );
    }
    return ctx;
  }

  function checkConstant(d: ConstantDecl, path: string): Report {
    const out = check(d.value, `${path}.value`);
    if (!accepts(d.value, out.type, d.type, `${path}.value`)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.value`,
        `the initializer type ${
          show(out.type)
        } does not fit the constant type ${show(d.type)}`,
        d.value.span,
      );
    }
    const v = d.value;
    if (!isQuiet(invocationOf(v))) {
      ctx = flag(
        ctx,
        AREA.initialization,
        `${path}.value`,
        `a module constant needs a pure initializer with empty sets; recorded ${v.execution}, failures ${
          list(v.effects.failures)
        }, requirements ${list(v.effects.requirements)}`,
        v.span,
      );
    }
    refinements = refinements.audit(d.value, `${path}.value`, exprChildren);
    return ctx.report;
  }

  function check(e: Expr, path: string): Out {
    return checkMode(e, path, false);
  }

  function checkMode(e: Expr, path: string, callee: boolean): Out {
    return finish(e, path, compute(e, path, callee));
  }

  function finish(e: Expr, path: string, comp: Comp): Out {
    const checkedType = checkTypeIds(ctx, e.type, `${path}.type`, e.span);
    ctx = checkedType.ctx;
    const typeOk = checkedType.valid;
    let type = e.type;
    if (comp.kind === "derived" && typeOk) {
      const good = comp.match === "exact"
        ? same(env, comp.type, e.type)
        : accepts(e, comp.type, e.type, path);
      if (!good) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.type`,
          comp.match === "exact"
            ? `expected ${show(comp.type)}, recorded ${show(e.type)}`
            : `the recomputed type ${
              show(comp.type)
            } does not fit the recorded type ${show(e.type)}`,
          e.span,
        );
        type = comp.type;
      }
    }
    const recorded: Active = {
      failures: sortedUnique(e.effects.failures),
      requirements: sortedUnique(e.effects.requirements),
      execution: e.execution,
    };
    if (comp.kind === "poisoned") return { ...recorded, type: type };
    const active = comp.active;
    for (const key of ["failures", "requirements"] as const) {
      if (!sameSet(recorded[key], active[key])) {
        ctx = flag(
          ctx,
          AREA.contracts,
          `${path}.effects.${key}`,
          `expected ${list(active[key])}, recorded ${list(recorded[key])}`,
          e.span,
        );
      }
    }
    if (recorded.execution !== active.execution) {
      ctx = flag(
        ctx,
        AREA.execution,
        `${path}.execution`,
        `expected ${active.execution}, recorded ${recorded.execution}`,
        e.span,
      );
    }
    return { ...active, type: type };
  }

  function poison(): Comp {
    return { kind: "poisoned" };
  }

  /** Reports a concurrency limit that is neither `unbounded` nor a positive safe integer. */
  function checkConcurrency(
    e: {
      readonly concurrency: number | "unbounded" | undefined;
      readonly span: Span;
    },
    path: string,
    name: string,
  ): Report {
    // A limit is `unbounded` or a positive safe integer. Undefined selects the default.
    const limit = e.concurrency;
    if (
      limit === undefined || limit === "unbounded" ||
      (Number.isSafeInteger(limit) && limit > 0)
    ) return ctx.report;
    return add(
      AREA.control,
      `${path}.concurrency`,
      `${name} concurrency must be a positive safe integer or unbounded`,
      e.span,
    );
  }

  function compute(e: Expr, path: string, callee: boolean): Comp {
    if (e.kind === "null") {
      return derivedResult({ kind: "literal", value: null }, QUIET);
    }
    if (e.kind === "literal") {
      const type = e.value === null
        ? UNIT
        : { kind: "literal" as const, value: e.value };
      return fittedResult(type, QUIET);
    }
    if (e.kind === "reference") {
      return reference(e.target, e.span, path, callee);
    }
    if (e.kind === "record") return recordLike(e, path);
    if (e.kind === "array") return arrayLike(e, path);
    if (e.kind === "tuple") return tupleLike(e, path);
    if (e.kind === "get") return get(e, path);
    if (e.kind === "update") return update(e, path);
    if (e.kind === "nominal") return nominal(e, path);
    if (e.kind === "some") {
      const v = check(e.value, `${path}.value`);
      const target = e.type.kind === "option" ? e.type : undefined;
      if (
        target !== undefined &&
        !accepts(e.value, v.type, target.element, `${path}.value`)
      ) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.value`,
          `the Some value has type ${show(v.type)}, which does not fit ${
            show(target.element)
          }`,
          e.value.span,
        );
      }
      return fittedResult({
        kind: "option",
        element: target?.element ?? v.type,
      }, combine([v]));
    }
    if (e.kind === "none") {
      return fittedResult({ kind: "option", element: NEVER }, QUIET);
    }
    if (e.kind === "error") return errorConstruction(e, path);
    if (e.kind === "closure") return closure(e, path);
    if (e.kind === "call") return call(e, path);
    if (e.kind === "defer") return defer(validator, e, path);
    if (e.kind === "run") return run(validator, e, path);
    if (e.kind === "scoped") return scoped(validator, e, path);
    if (e.kind === "fork-scoped") return forkScoped(validator, e, path);
    if (e.kind === "with-resource") return withResource(validator, e, path);
    if (e.kind === "unfold") return unfoldStream(validator, e, path);
    if (e.kind === "map-effect" || e.kind === "map-stream") {
      return mapElements(validator, e, path);
    }
    if (e.kind === "sink-for-each") return sinkForEach(validator, e, path);
    if (e.kind === "take-sink") return takeSink(validator, e, path);
    if (e.kind === "transduce-stream") {
      return transduceStream(validator, e, path);
    }
    if (e.kind === "run-stream") return runStream(validator, e, path);
    if (e.kind === "buffer-stream") return bufferStream(validator, e, path);
    if (e.kind === "race") return race(validator, e, path);
    if (
      e.kind === "make-ref" || e.kind === "get-ref" || e.kind === "set-ref" ||
      e.kind === "update-ref"
    ) return refOperation(validator, e, path);
    if (e.kind === "layer") return layer(validator, e, path);
    if (e.kind === "merge-layers") return mergeLayers(validator, e, path);
    if (e.kind === "retry-schedule") return retrySchedule(validator, e, path);
    if (e.kind === "retry-with-schedule") {
      return retryWithSchedule(validator, e, path);
    }
    if (e.kind === "schema") return schema(validator, e, path);
    if (
      e.kind === "schema-make" || e.kind === "schema-decode" ||
      e.kind === "schema-encode"
    ) return schemaOperation(validator, e, path);
    if (e.kind === "perform") return perform(e, path);
    if (e.kind === "block") return block(e, path);
    if (e.kind === "if") return ifExpr(e, path);
    if (e.kind === "match") return matchExpr(e, path);
    if (e.kind === "fail") return fail(e, path);
    if (e.kind === "catch") return catchExpr(e, path);
    if (e.kind === "ensure") return ensure(validator, e, path);
    if (e.kind === "retry") return retry(validator, e, path);
    if (e.kind === "timeout") return timeout(validator, e, path);
    if (e.kind === "repeat") return repeat(validator, e, path);
    if (e.kind === "sleep") return sleep(validator, e, path);
    if (e.kind === "log") return log(validator, e, path);
    if (e.kind === "random") return derivedResult(NUMBER, EFFECT_ONLY);
    if (e.kind === "random-int") return randomInt(validator, e, path);
    if (e.kind === "now") {
      return derivedResult({ kind: "named", id: INSTANT_ID }, EFFECT_ONLY);
    }
    if (e.kind === "race-all") return raceAll(validator, e, path);
    if (e.kind === "uninterruptible") {
      return uninterruptible(validator, e, path);
    }
    if (e.kind === "provide") return provide(validator, e, path);
    return binary(e, path);
  }

  function reference(
    target: string,
    span: Span,
    path: string,
    callee: boolean,
  ): Comp {
    const world = ctx.world;
    let type: Type | undefined;
    if (target.startsWith("local:")) type = scope.get(target);
    else if (target.startsWith("value:")) type = world.values.get(target);
    if (type === undefined) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.target`,
        `the target ${target} is not a parameter, a binding, or a declaration in scope`,
        span,
      );
      return poison();
    }
    if (world.builtins.has(target) && !callee) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.target`,
        `the builtin ${target} may appear only as the callee of a call`,
        span,
      );
    }
    return derivedResult(type, QUIET);
  }

  /** Checks field values against declared fields. Used by records, updates, and errors. */
  function checkFieldValues(
    e: {
      readonly fields: readonly {
        readonly name: string;
        readonly value: Expr;
      }[];
      readonly span: Span;
    },
    outs: readonly Out[],
    declared: readonly {
      readonly name: string;
      readonly type: Type;
      readonly optional: boolean;
    }[],
    path: string,
    requireAll: boolean,
    what: string,
  ): Ctx {
    let seen = emptySet<string>();
    for (const entry of e.fields.entries()) {
      const f = entry[1];
      const i = entry[0];
      const at = `${path}.fields[${i}]`;
      if (seen.has(f.name)) {
        ctx = flag(
          ctx,
          AREA.types,
          at,
          `the field ${f.name} appears twice`,
          e.span,
        );
        continue;
      }
      seen = seen.add(f.name);
      const field = declared.find((d) => d.name === f.name);
      if (field === undefined) {
        ctx = flag(
          ctx,
          AREA.types,
          at,
          `${what} has no field ${f.name}`,
          e.span,
        );
        continue;
      }
      if (
        !accepts(
          f.value,
          outs[i].type,
          field.type,
          `${at}.value`,
        )
      ) {
        ctx = flag(
          ctx,
          AREA.types,
          `${at}.value`,
          `the value of ${f.name} has type ${
            show(outs[i].type)
          }, which does not fit ${show(field.type)}`,
          f.value.span,
        );
      }
    }
    if (requireAll) {
      const missing = declared.filter((d) => !d.optional && !seen.has(d.name))
        .map((d) => d.name);
      if (missing.length > 0) {
        ctx = flag(
          ctx,
          AREA.types,
          path,
          `the construction is missing the required fields ${list(missing)}`,
          e.span,
        );
      }
    }
    return ctx;
  }

  /** A literal at a foreign sealed type is a construction by a module that cannot make one. */
  function requireSealedLiteralOwner(
    e: Extract<Expr, { kind: "record" | "array" | "tuple" }>,
    path: string,
  ): Ctx {
    const sealed = sealedRootOf(env, e.type);
    if (sealed !== undefined && !ownsSealed(env, sealed)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type`,
        `the module cannot construct the foreign sealed type ${sealed}`,
        e.span,
      );
    }
    return ctx;
  }

  function recordLike(
    e: Extract<Expr, { kind: "record" }>,
    path: string,
  ): Comp {
    ctx = requireSealedLiteralOwner(e, path);
    const outs = e.fields.map((f, i) =>
      check(f.value, `${path}.fields[${i}].value`)
    );
    const target = unfold(env, e.type);
    if (target.kind !== "record") {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type`,
        `a record construction has a record type, recorded ${show(e.type)}`,
        e.span,
      );
    } else {
      ctx = checkFieldValues(
        e,
        outs,
        target.fields,
        path,
        true,
        `the record type ${show(e.type)}`,
      );
    }
    refinements = refinements.retain(e, e.type, path);
    return checkedResult(combine(outs));
  }

  /** Reports each element that does not fit the target type that `target` gives for its index. */
  function checkElements(
    e: { readonly elements: readonly Expr[] },
    outs: readonly Out[],
    target: (index: number) => Type,
    path: string,
  ): Ctx {
    for (const entry of outs.entries()) {
      const o = entry[1];
      const i = entry[0];
      if (
        !accepts(
          e.elements[i],
          o.type,
          target(i),
          `${path}.elements[${i}]`,
        )
      ) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.elements[${i}]`,
          `the element has type ${show(o.type)}, which does not fit ${
            show(target(i))
          }`,
          e.elements[i].span,
        );
      }
    }
    return ctx;
  }

  function arrayLike(
    e: Extract<Expr, { kind: "array" }>,
    path: string,
  ): Comp {
    ctx = requireSealedLiteralOwner(e, path);
    const outs = e.elements.map((x, i) => check(x, `${path}.elements[${i}]`));
    const target = unfold(env, e.type);
    if (target.kind !== "array") {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type`,
        `an array construction has an array type, recorded ${show(e.type)}`,
        e.span,
      );
    } else {
      ctx = checkElements(e, outs, () => target.element, path);
    }
    refinements = refinements.retain(e, e.type, path);
    return checkedResult(combine(outs));
  }

  function tupleLike(
    e: Extract<Expr, { kind: "tuple" }>,
    path: string,
  ): Comp {
    ctx = requireSealedLiteralOwner(e, path);
    const outs = e.elements.map((x, i) => check(x, `${path}.elements[${i}]`));
    const target = unfold(env, e.type);
    if (target.kind !== "tuple" || target.elements.length !== outs.length) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type`,
        `a tuple construction of ${outs.length} elements has a tuple type of equal length, recorded ${
          show(e.type)
        }`,
        e.span,
      );
    } else {
      ctx = checkElements(e, outs, (i) => target.elements[i], path);
    }
    refinements = refinements.retain(e, e.type, path);
    return checkedResult(combine(outs));
  }

  function get(e: Extract<Expr, { kind: "get" }>, path: string): Comp {
    const base = check(e.record, `${path}.record`);
    const types: Type[] = [];
    let optional = false;
    for (const member of members(env, base.type)) {
      const fields = fieldsOf(env, member);
      const field = fields?.find((f) => f.name === e.field);
      if (field === undefined) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.field`,
          fields === undefined
            ? `a value of type ${show(base.type)} has no fields`
            : `the type ${show(member)} has no field ${e.field}`,
          e.span,
        );
        return checkedResult(combine([base]));
      }
      if (field.optional) optional = true;
      types[types.length] = field.type;
    }
    const type = unionOf(env, types);
    return derivedResult(
      optional ? { kind: "option", element: type } : type,
      combine([base]),
    );
  }

  function update(e: Extract<Expr, { kind: "update" }>, path: string): Comp {
    const base = check(e.record, `${path}.record`);
    const outs = e.fields.map((f, i) =>
      check(f.value, `${path}.fields[${i}].value`)
    );
    const active = combine([base, ...outs]);
    const sealed = sealedRootOf(env, base.type);
    if (sealed !== undefined && !ownsSealed(env, sealed)) {
      ctx = flag(
        ctx,
        AREA.types,
        path,
        `a foreign module cannot retain the sealed type ${sealed} after an update`,
        e.span,
      );
    }
    const unfolded = unfold(env, base.type);
    const fields = unfolded.kind === "union"
      ? undefined
      : fieldsOf(env, unfolded);
    if (fields === undefined) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.record`,
        `a record update needs a record, but the base has type ${
          show(base.type)
        }`,
        e.span,
      );
      return checkedResult(active);
    }
    ctx = checkFieldValues(
      e,
      outs,
      fields,
      path,
      false,
      `the record type ${show(base.type)}`,
    );
    refinements = refinements.retain(e, base.type, path);
    return derivedResult(base.type, active);
  }

  function nominal(e: Extract<Expr, { kind: "nominal" }>, path: string): Comp {
    const v = check(e.value, `${path}.value`);
    const decl = ctx.world.types.get(e.nominal);
    if (decl === undefined) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.nominal`,
        `the type ${e.nominal} is not a declared type`,
        e.span,
      );
      return checkedResult(combine([v]));
    }
    if (decl.definition.kind !== "nominal") {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.nominal`,
        `${e.nominal} is not a type with identity`,
        e.span,
      );
    } else if (isTrue(decl.opaque)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.nominal`,
        "an opaque type cannot be constructed in source",
        e.span,
      );
    } else if (
      isTrue(decl.definition.sealed) &&
      !ownsSealed(env, e.nominal)
    ) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.nominal`,
        `the module cannot construct the foreign sealed type ${e.nominal}`,
        e.span,
      );
    } else if (
      !accepts(
        e.value,
        v.type,
        decl.definition.base,
        `${path}.value`,
      )
    ) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.value`,
        `the value has type ${show(v.type)}, which does not fit the base ${
          show(decl.definition.base)
        }`,
        e.value.span,
      );
    }
    if (
      decl.predicate !== undefined &&
      !same(env, v.type, { kind: "named", id: e.nominal })
    ) {
      refinements = refinements.retain(
        e.value,
        { kind: "named", id: e.nominal },
        `${path}.value`,
      );
    }
    return derivedResult({ kind: "named", id: e.nominal }, combine([v]));
  }

  function errorConstruction(
    e: Extract<Expr, { kind: "error" }>,
    path: string,
  ): Comp {
    const outs = e.fields.map((f, i) =>
      check(f.value, `${path}.fields[${i}].value`)
    );
    const active = combine(outs);
    if (isReservedError(e.error)) {
      ctx = flag(
        ctx,
        AREA.types,
        path,
        "reserved target errors cannot be constructed as source errors",
        e.span,
      );
      return checkedResult(active);
    }
    const decl = ctx.world.errors.get(e.error);
    if (decl === undefined) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.error`,
        `the error ${e.error} is not declared`,
        e.span,
      );
      return checkedResult(active);
    }
    ctx = checkFieldValues(
      e,
      outs,
      decl.fields,
      path,
      true,
      `the error ${e.error}`,
    );
    return derivedResult({ kind: "named", id: e.error }, active);
  }

  function closure(e: Extract<Expr, { kind: "closure" }>, path: string): Comp {
    const refinementScope = refinements.snapshot();
    const body = withLocals((declare) => {
      for (const entry of e.parameters.entries()) {
        const p = entry[1];
        const j = entry[0];
        ctx = declare(p, `${path}.parameters[${j}]`, undefined, false);
      }
      return check(e.body, `${path}.body`);
    });
    refinements = refinements.restore(refinementScope);
    const fn = asFunction(env, e.type);
    if (fn === undefined) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.type`,
        `a closure has a function type, recorded ${show(e.type)}`,
        e.span,
      );
      return checkedResult(QUIET);
    }
    if (fn.checked?.some(Boolean)) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.type.checked`,
        "a closure cannot claim checked entry validation",
        e.span,
      );
    }
    ctx = checkParameterTypes(
      e.parameters,
      fn.parameters,
      path,
      `the closure declares ${e.parameters.length} parameters, its type has ${fn.parameters.length}`,
      e.span,
    );
    if (!accepts(e.body, body.type, fn.result, `${path}.body`)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.body`,
        `the body type ${show(body.type)} does not fit the closure result ${
          show(fn.result)
        }`,
        e.body.span,
      );
    }
    if (!isSubset(body.failures, fn.effects.failures)) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.type.effects.failures`,
        `the body can fail with ${
          list(body.failures)
        }, the closure type lists ${list(fn.effects.failures)}`,
        e.span,
      );
    }
    if (!isSubset(body.requirements, fn.effects.requirements)) {
      ctx = flag(
        ctx,
        AREA.contracts,
        `${path}.type.effects.requirements`,
        `the body requires ${list(body.requirements)}, the closure type lists ${
          list(fn.effects.requirements)
        }`,
        e.span,
      );
    }
    ctx = checkExecution(fn, body, path, e.span);
    // Construction evaluates no part of the body: closure construction is pure.
    return checkedResult(QUIET);
  }

  function checkArguments(
    args: readonly Expr[],
    outs: readonly Out[],
    fn: FunctionType,
    path: string,
    span: Span,
    builtin: BuiltinCallName | undefined,
  ): Ctx {
    const parameters = fn.parameters;
    const checked = fn.checked;
    if (outs.length !== parameters.length) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.arguments`,
        `the function takes ${parameters.length} arguments, the call has ${outs.length}`,
        span,
      );
      return ctx;
    }
    for (const entry of outs.entries()) {
      const o = entry[1];
      const i = entry[0];
      if (builtin === "other") {
        const fn = asFunction(env, o.type);
        if (
          fn !== undefined &&
          !isQuiet(invocationOf(fn))
        ) {
          ctx = flag(
            ctx,
            AREA.execution,
            `${path}.arguments[${i}]`,
            "a builtin callback is pure with empty failure and requirement sets",
            args[i].span,
          );
          continue;
        }
      }
      const compatible = acceptsMode(
        args[i],
        o.type,
        parameters[i],
        `${path}.arguments[${i}]`,
        isTrue(checked === undefined ? undefined : checked[i]),
      );
      if (!compatible) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.arguments[${i}]`,
          `the argument has type ${
            show(o.type)
          }, which does not fit the parameter ${show(parameters[i])}`,
          args[i].span,
        );
      }
    }
    return ctx;
  }

  function call(e: Extract<Expr, { kind: "call" }>, path: string): Comp {
    const callee = checkMode(e.callee, `${path}.callee`, true);
    const fn = asFunction(env, callee.type);
    const outs = e.arguments.map((argument, index) => {
      const previous = checkedRaw;
      const checkedFlags = fn?.checked;
      const checked = checkedFlags === undefined
        ? undefined
        : checkedFlags[index];
      if (isTrue(checked)) {
        checkedRaw = setFrom(previous);
        checkedRaw = markCheckedRaw(argument, checkedRaw);
      }
      const out = check(argument, `${path}.arguments[${index}]`);
      checkedRaw = previous;
      return out;
    });
    if (fn === undefined) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.callee`,
        `the callee has type ${show(callee.type)}, which is not a function`,
        e.callee.span,
      );
      return checkedResult(combine([callee, ...outs]));
    }
    const metadata = e.callee.kind === "reference"
      ? ctx.world.builtinInfo.get(e.callee.target)
      : undefined;
    // Keep malformed names on the original guarded expression path.
    let builtin: BuiltinCallName | undefined;
    if (metadata?.call.parsed) builtin = metadata.call.name;
    else if (e.callee.kind === "reference") {
      const recordedName = ctx.world.builtins.get(e.callee.target);
      if (recordedName !== undefined && typeof recordedName !== "string") {
        return panic(
          "this.ctx.world.builtins.get(...)?.split is not a function",
        );
      }
      builtin = classifyBuiltinCall(
        recordedName?.split("/")[1],
      );
    }
    ctx = checkArguments(
      e.arguments,
      outs,
      fn,
      path,
      e.span,
      builtin,
    );
    if (
      isCallbackBuiltin(builtin) &&
      CALLBACK_SHAPES[builtin].counts.includes(outs.length)
    ) {
      const callback = asFunction(
        env,
        outs[CALLBACK_SHAPES[builtin].index].type,
      );
      const effectful = builtin === "traverse" ||
        (callback !== undefined && !isQuiet(invocationOf(callback)));
      if (
        fn.execution !== (effectful ? "effect" : "pure") ||
        callback === undefined ||
        !sameSet(fn.effects.failures, callback.effects.failures) ||
        !sameSet(fn.effects.requirements, callback.effects.requirements)
      ) {
        ctx = flag(
          ctx,
          AREA.contracts,
          path,
          `${builtin} must invoke the callback with its declared failures and requirements`,
          e.span,
        );
      }
      if (builtin === "traverse" && outs.length === 3) {
        ctx = checkConcurrencyLiteral(builtin, 2, e, path);
      }
    }
    if (UNITLESS_BUILTINS.includes(builtin)) {
      for (const entry of outs.entries()) {
        const out = entry[1];
        const i = entry[0];
        if (
          isDurationType(env, out.type) ||
          isInstantType(env, out.type)
        ) {
          ctx = flag(
            ctx,
            AREA.types,
            `${path}.arguments[${i}]`,
            `${builtin} does not take a closed unit argument of type ${
              show(out.type)
            }`,
            e.arguments[i].span,
          );
        }
      }
    }
    if (builtin === "all" && outs.length === 2) {
      ctx = checkConcurrencyLiteral(builtin, 1, e, path);
    }
    return derivedResult(
      fn.result,
      combine([callee, ...outs, invocationOf(fn)]),
    );
  }

  /** Reports an options argument that is not a concurrency literal. */
  function checkConcurrencyLiteral(
    name: "traverse" | "all",
    index: number,
    e: Extract<Expr, { kind: "call" }>,
    path: string,
  ): Ctx {
    const options = e.arguments[index];
    if (isConcurrencyOption(options)) return ctx;
    ctx = flag(
      ctx,
      AREA.control,
      `${path}.arguments[${index}]`,
      `${name} needs a positive safe integer or unbounded concurrency literal`,
      options?.span ?? e.span,
    );
    return ctx;
  }

  function perform(e: Extract<Expr, { kind: "perform" }>, path: string): Comp {
    const outs = e.arguments.map((a, i) => check(a, `${path}.arguments[${i}]`));
    const method = ctx.world.methods.get(e.capability);
    if (method === undefined) {
      ctx = flag(
        ctx,
        AREA.identity,
        `${path}.capability`,
        `the capability ${e.capability} is not a method of a service of this module or of an import`,
        e.span,
      );
      return poison();
    }
    const fn = method.type;
    ctx = checkArguments(
      e.arguments,
      outs,
      fn,
      path,
      e.span,
      undefined,
    );
    return derivedResult(
      fn.result,
      combine([
        ...outs,
        invocationOf(fn),
        effectOf([], [e.capability]),
      ]),
    );
  }

  function block(e: Extract<Expr, { kind: "block" }>, path: string): Comp {
    const refinementScope = refinements.snapshot();
    const parts: Out[] = [];
    const result = withLocals((declare) => {
      for (const entry of e.steps.entries()) {
        const step = entry[1];
        const i = entry[0];
        const at = `${path}.steps[${i}]`;
        const value = check(step.value, `${at}.value`);
        parts[parts.length] = value;
        if (step.kind === "bind") {
          if (
            !accepts(
              step.value,
              value.type,
              step.binding.type,
              `${at}.binding.type`,
            )
          ) {
            ctx = flag(
              ctx,
              AREA.types,
              `${at}.binding.type`,
              `the value has type ${
                show(value.type)
              }, which does not fit the binding type ${
                show(step.binding.type)
              }`,
              step.binding.span,
            );
          }
          if (step.generated !== undefined && !isTrue(step.generated)) {
            ctx = flag(
              ctx,
              AREA.types,
              `${at}.generated`,
              "a generated capture marker must be true",
              step.binding.span,
            );
          }
          ctx = declare(
            step.binding,
            `${at}.binding`,
            step.value,
            isTrue(step.generated),
          );
        }
        if (
          value.execution === "effect" && step.value.kind !== "if" &&
          step.value.kind !== "match"
        ) {
          refinements = refinements.clearDerivedFacts();
        }
      }
      return check(e.result, `${path}.result`);
    });
    const type = accepts(
        e.result,
        result.type,
        e.type,
        `${path}.result`,
      )
      ? e.type
      : result.type;
    const combined = derivedResult(type, combine([...parts, result]));
    refinements = refinements.leaveScope(refinementScope);
    return combined;
  }

  function branchFits(
    branch: Out,
    recorded: Type,
    path: string,
    expression: Expr,
    area: typeof AREA.types | typeof AREA.recovery,
  ): Ctx {
    if (!accepts(expression, branch.type, recorded, path)) {
      ctx = flag(
        ctx,
        area,
        path,
        `the branch has type ${
          show(branch.type)
        }, which does not fit the recorded type ${show(recorded)}`,
        expression.span,
      );
    }
    return ctx;
  }

  function ifExpr(e: Extract<Expr, { kind: "if" }>, path: string): Comp {
    const cond = check(e.condition, `${path}.condition`);
    if (!isBooleanLike(env, cond.type)) {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.condition`,
        `a condition must be boolean, but it has type ${show(cond.type)}`,
        e.condition.span,
      );
    }
    if (cond.execution === "effect") {
      refinements = refinements.clearDerivedFacts();
    }
    const condition = refinements.condition(e.condition);
    const base = refinements.snapshot();
    const successful: ReturnType<RefinementValidator["snapshot"]>[] = [];
    const outs: Out[] = [];
    for (const entry of [e.then, e.else].entries()) {
      const index = entry[0];
      const expression = entry[1];
      refinements = refinements.restore(base);
      refinements = refinements.addBranch(
        index === 0 ? condition : negateRefinement(condition),
      );
      const at = `${path}.${index === 0 ? "then" : "else"}`;
      const out = check(expression, at);
      ctx = branchFits(out, e.type, at, expression, AREA.types);
      outs[outs.length] = out;
      if (!isNever(unfold(env, out.type))) {
        successful[successful.length] = refinements.snapshot();
      }
    }
    refinements = refinements.restore(base);
    refinements = refinements.join(successful);
    return checkedResult(combine([cond, ...outs]));
  }

  function matchExpr(e: Extract<Expr, { kind: "match" }>, path: string): Comp {
    const subject = check(e.subject, `${path}.subject`);
    if (subject.execution === "effect") {
      refinements = refinements.clearDerivedFacts();
    }
    const parts: Out[] = [subject];
    const successful: ReturnType<RefinementValidator["snapshot"]>[] = [];
    const excluded: ReturnType<RefinementValidator["condition"]>[] = [];
    let nullSeen = false;
    for (const entry of e.arms.entries()) {
      const arm = entry[1];
      const i = entry[0];
      const at = `${path}.arms[${i}]`;
      const branch = refinements.snapshot();
      for (const fact of excluded) {
        refinements = refinements.addBranch(fact);
      }
      const added = pattern(
        arm.pattern,
        subject.type,
        `${at}.pattern`,
        nullSeen,
      );
      if (arm.pattern.kind === "literal" && arm.pattern.value === null) {
        nullSeen = true;
      }
      if (arm.pattern.kind === "literal" || arm.pattern.kind === "duration") {
        const matched = refinements.literalMatch(
          e.subject,
          arm.pattern.kind === "literal"
            ? arm.pattern.value
            : arm.pattern.millis,
        );
        refinements = refinements.addBranch(matched);
        excluded[excluded.length] = negateRefinement(matched);
      }
      const body = check(arm.body, `${at}.body`);
      ctx = branchFits(body, e.type, `${at}.body`, arm.body, AREA.types);
      ctx = release(added);
      if (!isNever(unfold(env, body.type))) {
        successful[successful.length] = refinements.snapshot();
      }
      refinements = refinements.restore(branch);
      parts[parts.length] = body;
    }
    refinements = refinements.join(successful);
    return checkedResult(combine(parts));
  }

  function pattern(
    p: Pattern,
    subject: Type,
    path: string,
    nullSeen: boolean,
  ): string[] {
    const added: string[] = [];
    function bind(binding: Parameter, expected: Type | undefined): Ctx {
      ctx = declareLocal(binding, `${path}.binding`, undefined, false);
      added[added.length] = binding.id;
      if (expected !== undefined && !same(env, binding.type, expected)) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.binding.type`,
          `expected ${show(expected)}, recorded ${show(binding.type)}`,
          binding.span,
        );
      }
      return ctx;
    }
    function foreign(what: string): Ctx {
      ctx = flag(
        ctx,
        AREA.types,
        path,
        `${what} does not belong to the subject of type ${show(subject)}`,
        p.span,
      );
      return ctx;
    }
    const unfolded = unfold(env, subject);
    if (p.kind === "wildcard") return added;
    if (p.kind === "literal") {
      // A bare number never fits a `Duration` member: the identity is closed.
      const all = identityMembers(env, subject);
      let fitting = tagMayEqual(env, subject, p.value);
      if (
        typeof p.value === "number" &&
        all.some((m) => isDurationType(env, m))
      ) {
        fitting = all.some((m) =>
          !isDurationType(env, m) && tagMayEqual(env, m, p.value)
        );
      }
      if (!fitting) ctx = foreign(`the literal ${JSON.stringify(p.value)}`);
      return added;
    }
    if (p.kind === "duration") {
      if (!Number.isSafeInteger(p.millis)) {
        ctx = flag(
          ctx,
          AREA.types,
          `${path}.millis`,
          `a duration pattern needs a safe integer of milliseconds, found ${p.millis}`,
          p.span,
        );
      }
      if (!identityMembers(env, subject).some((m) => isDurationType(env, m))) {
        ctx = foreign(`the duration ${p.millis}ms`);
      }
      return added;
    }
    if (p.kind === "none") {
      if (unfolded.kind !== "option") ctx = foreign("None");
      return added;
    }
    if (p.kind === "bind") {
      const all = identityMembers(env, subject);
      const rest = all.filter((m) => !isNullType(env, m));
      const hidden = rest.some((m) =>
        members(env, m).some((member) => isNullType(env, member))
      );
      const literalOnly = members(env, subject).every((m) =>
        m.kind === "literal" ||
        (m.kind === "primitive" && m.name === "boolean")
      );
      let fault: string | undefined;
      if (rest.length === all.length) {
        fault = "needs a subject with a null member";
      } else if (hidden) {
        fault = "needs a subject in which no other member hides a null";
      } else if (literalOnly) {
        fault = "needs a subject with a member that is not a literal";
      } else if (!nullSeen) {
        fault = "needs an earlier arm with the pattern null";
      }
      if (fault !== undefined) {
        ctx = flag(
          ctx,
          AREA.types,
          path,
          `a binding arm ${fault}; the subject has type ${show(subject)}`,
          p.span,
        );
      }
      ctx = bind(
        p.binding,
        fault === undefined ? unionOf(env, rest) : undefined,
      );
      return added;
    }
    if (p.kind === "some") {
      if (unfolded.kind !== "option") {
        ctx = foreign("Some");
        ctx = bind(p.binding, undefined);
      } else ctx = bind(p.binding, unfolded.element);
      return added;
    }
    if (p.kind === "error" || p.kind === "nominal") {
      const id = p.kind === "error" ? p.error : p.nominal;
      const ms = identityMembers(env, subject);
      const ok = ms.every((m) =>
        m.kind === "named" &&
        (env.errors.has(m.id) || env.taggedRecords.has(m.id))
      ) && ms.some((m) => m.kind === "named" && m.id === id) &&
        (p.kind === "error" ? env.errors.has(id) : env.taggedRecords.has(id));
      if (!ok) {
        ctx = foreign(
          `the ${p.kind === "error" ? "error" : "tagged record"} ${id}`,
        );
      }
      ctx = bind(p.binding, ok ? { kind: "named", id: id } : undefined);
      return added;
    }
    const ms = members(env, subject);
    const records = ms.every((m) => m.kind === "record");
    const narrowed = records
      ? ms.filter((m) => {
        if (m.kind !== "record") return false;
        const field = m.fields.find((f) => f.name === p.field);
        return field !== undefined && tagMayEqual(env, field.type, p.value);
      })
      : [];
    if (!records || narrowed.length === 0) {
      ctx = foreign(`the tag ${p.field}: ${JSON.stringify(p.value)}`);
    }
    if (p.binding !== null) {
      ctx = bind(
        p.binding,
        narrowed.length > 0 ? unionOf(env, narrowed) : undefined,
      );
    }
    return added;
  }

  function fail(e: Extract<Expr, { kind: "fail" }>, path: string): Comp {
    const err = check(e.error, `${path}.error`);
    const unfolded = unfold(env, err.type);
    const declaration = unfolded.kind === "named"
      ? ctx.world.errors.get(unfolded.id)
      : undefined;
    let failures: ErrorId[] = [];
    if (declaration !== undefined) {
      failures = [declaration.id];
    } else {
      ctx = flag(
        ctx,
        AREA.types,
        `${path}.error`,
        `fail needs a value of a named error type, but the value has type ${
          show(err.type)
        }`,
        e.error.span,
      );
    }
    return derivedResult(
      NEVER,
      combine([
        err,
        effectOf(failures, []),
      ]),
    );
  }

  function catchExpr(e: Extract<Expr, { kind: "catch" }>, path: string): Comp {
    const body = check(e.body, `${path}.body`);
    ctx = branchFits(body, e.type, `${path}.body`, e.body, AREA.recovery);
    let handled = emptySet<string>();
    let seen = emptySet<string>();
    const outs: Out[] = [];
    for (const entry of e.handlers.entries()) {
      const h = entry[1];
      const i = entry[0];
      const at = `${path}.handlers[${i}]`;
      if (!ctx.world.errors.has(h.error)) {
        ctx = flag(
          ctx,
          AREA.identity,
          `${at}.error`,
          `the handled error ${h.error} is not declared`,
          h.span,
        );
      }
      if (seen.has(h.error)) {
        ctx = flag(
          ctx,
          AREA.recovery,
          `${at}.error`,
          `the error ${h.error} has two handlers`,
          h.span,
        );
      } else if (!body.failures.includes(h.error)) {
        ctx = flag(
          ctx,
          AREA.recovery,
          `${at}.error`,
          `the protected block cannot fail with ${h.error}; its failures are ${
            list(body.failures)
          }`,
          h.span,
        );
      } else {
        handled = handled.add(h.error);
      }
      seen = seen.add(h.error);
      const out = withLocals((declare) => {
        ctx = declare(h.binding, `${at}.binding`, undefined, false);
        if (
          ctx.world.errors.has(h.error) &&
          !same(env, h.binding.type, { kind: "named", id: h.error })
        ) {
          ctx = flag(
            ctx,
            AREA.types,
            `${at}.binding.type`,
            `expected ${h.error}, recorded ${show(h.binding.type)}`,
            h.binding.span,
          );
        }
        return check(h.body, `${at}.body`);
      });
      outs[outs.length] = out;
      ctx = branchFits(out, e.type, `${at}.body`, h.body, AREA.recovery);
    }
    const d = e.defect;
    if (d !== undefined) {
      const at = `${path}.defect`;
      const out = withLocals((declare) => {
        ctx = declare(d.binding, `${at}.binding`, undefined, false);
        if (!same(env, d.binding.type, DEFECT_RECORD)) {
          ctx = flag(
            ctx,
            AREA.types,
            `${at}.binding.type`,
            `expected { message: string }, recorded ${show(d.binding.type)}`,
            d.binding.span,
          );
        }
        return check(d.body, `${at}.body`);
      });
      outs[outs.length] = out;
      ctx = branchFits(out, e.type, `${at}.body`, d.body, AREA.recovery);
    }
    const remaining: Active = {
      failures: minus(body.failures, [...handled]),
      requirements: body.requirements,
      execution: body.execution,
    };
    return checkedResult(combine([remaining, ...outs, EFFECT_ONLY]));
  }

  /**
   * The function type of a retry or provide job. A job with parameters is
   * reported, but its sets still count. A job that is no function is
   * reported, and the caller keeps the recorded annotation of the node.
   */
  function jobFunction(
    job: Out,
    path: string,
    span: Span,
    what: string,
  ): ReturnType<typeof asFunction> {
    const fn = asFunction(env, job.type);
    if (fn === undefined) {
      ctx = flag(
        ctx,
        AREA.control,
        path,
        `${what} needs a function that takes no arguments, but the job has type ${
          show(job.type)
        }`,
        span,
      );
    } else if (fn.parameters.length > 0) {
      ctx = flag(
        ctx,
        AREA.control,
        path,
        `${what} needs a function that takes no arguments, but the job takes ${fn.parameters.length}`,
        span,
      );
    }
    return fn;
  }

  function binary(e: Extract<Expr, { kind: "binary" }>, path: string): Comp {
    const left = check(e.left, `${path}.left`);
    const branch = refinements.snapshot();
    if (e.operator === "&&" || e.operator === "||") {
      const condition = refinements.condition(e.left);
      refinements = refinements.addBranch(
        e.operator === "||" ? negateRefinement(condition) : condition,
      );
    }
    const right = check(e.right, `${path}.right`);
    refinements = refinements.restore(branch);
    const active = combine([left, right]);
    function mismatch(): Comp {
      ctx = flag(
        ctx,
        AREA.types,
        path,
        `the operator ${e.operator} does not accept operands of type ${
          show(left.type)
        } and ${show(right.type)}`,
        e.span,
      );
      return checkedResult(active);
    }
    function isNull(type: Type): boolean {
      const value = unfold(env, type);
      return value.kind === "literal" && value.value === null;
    }
    const l = comparisonClass(env, left.type);
    const r = comparisonClass(env, right.type);
    if (
      (e.operator === "+" || e.operator === "-" || e.operator === "*" ||
        e.operator === "/" || e.operator === "%") &&
      (foreignSealedOf(env, left.type) !== undefined ||
        foreignSealedOf(env, right.type) !== undefined)
    ) {
      ctx = flag(
        ctx,
        AREA.types,
        path,
        "arithmetic cannot use a foreign sealed type",
        e.span,
      );
    }
    // Two values of one numeric identity add and subtract (D32).
    const leftIdentity = numericIdentityOf(env, left.type);
    const shared =
      leftIdentity !== undefined && same(env, leftIdentity, right.type)
        ? leftIdentity
        : undefined;
    if (e.operator === "&&" || e.operator === "||") {
      return isBooleanLike(env, left.type) && isBooleanLike(env, right.type)
        ? derivedResult(BOOLEAN, active)
        : mismatch();
    }
    if (
      e.operator === "<" || e.operator === "<=" || e.operator === ">" ||
      e.operator === ">="
    ) {
      const comparable = !closedUnitsDiffer(l, r) && l !== undefined &&
        r !== undefined && compatibleClasses(env, l, r) &&
        isNumericClass(env, l) && isNumericClass(env, r);
      return comparable ? derivedResult(BOOLEAN, active) : mismatch();
    }
    if (e.operator === "===" || e.operator === "!==") {
      const nullable = (isNull(left.type) &&
        fitsNullComparison(env, left.type, right.type)) ||
        (isNull(right.type) && fitsNullComparison(env, right.type, left.type));
      const comparable = nullable || l !== undefined && r !== undefined &&
          compatibleClasses(env, l, r) && !closedUnitsDiffer(l, r);
      return comparable ? derivedResult(BOOLEAN, active) : mismatch();
    }
    const instant = instantArithmetic(e.operator, left.type, right.type);
    if (instant === "mismatch") return mismatch();
    if (instant !== undefined) return derivedResult(instant, active);
    const duration = durationArithmetic(e.operator, left.type, right.type);
    if (duration === "mismatch") return mismatch();
    if (duration !== undefined) return derivedResult(duration, active);
    if (l === undefined || r === undefined || !compatibleClasses(env, l, r)) {
      return mismatch();
    }
    if (shared !== undefined && (e.operator === "+" || e.operator === "-")) {
      refinements = refinements.retain(e, shared, path);
      return derivedResult(shared, active);
    }
    const adopted = e.operator !== "/"
      ? adoptedNumericIdentity(env, left.type, right.type)
      : undefined;
    if (adopted !== undefined) {
      refinements = refinements.retain(e, adopted, path);
      return derivedResult(adopted, active);
    }
    if (isNumericClass(env, l) && isNumericClass(env, r)) {
      const integral = e.operator !== "/" && fits(env, left.type, INT) &&
        fits(env, right.type, INT);
      return derivedResult(integral ? INT : NUMBER, active);
    }
    if (e.operator === "+" && isStringClass(env, l) && isStringClass(env, r)) {
      return derivedResult(STRING, active);
    }
    return mismatch();
  }

  /**
   * The arithmetic of `Instant`: undefined when no operand is an `Instant`, and
   * "mismatch" for every mix that the table does not list.
   */
  function instantArithmetic(
    operator: "+" | "-" | "*" | "/" | "%",
    left: Type,
    right: Type,
  ): Type | "mismatch" | undefined {
    const l = isInstantType(env, left);
    const r = isInstantType(env, right);
    if (!l && !r) return undefined;
    if (l && r) {
      return operator === "-" ? { kind: "named", id: DURATION_ID } : "mismatch";
    }
    const duration = isDurationType(env, l ? right : left);
    if (operator === "+" && duration) return { kind: "named", id: INSTANT_ID };
    if (operator === "-" && l && duration) {
      return { kind: "named", id: INSTANT_ID };
    }
    return "mismatch";
  }

  /**
   * The arithmetic of `Duration`: undefined when the general rules decide, and
   * "mismatch" when a bare number meets a `Duration` in `+` or `-`, and for `%`
   * with a `Duration` operand.
   */
  function durationArithmetic(
    operator: "+" | "-" | "*" | "/" | "%",
    left: Type,
    right: Type,
  ): Type | "mismatch" | undefined {
    const l = isDurationType(env, left);
    const r = isDurationType(env, right);
    if (!l && !r) return undefined;
    const duration: Type = { kind: "named", id: DURATION_ID };
    if (operator === "%") return "mismatch";
    if (l && r) {
      if (operator === "/") return NUMBER;
      return operator === "*" ? undefined : duration;
    }
    const integral = fits(env, l ? right : left, INT);
    if (operator === "+" || operator === "-") {
      return integral || fits(env, l ? right : left, NUMBER)
        ? "mismatch"
        : undefined;
    }
    if (operator === "*") return integral ? duration : undefined;
    return l && integral ? duration : undefined;
  }

  const validator: BodyValidator = {
    ctx: ctx,
    env: env,
    add: add,
    check: check,
    poison: poison,
    checkConcurrency: checkConcurrency,
    jobFunction: jobFunction,
    checkFunction: checkFunction,
    checkConstant: checkConstant,
  };
  return validator;
}
