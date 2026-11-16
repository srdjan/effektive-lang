import type { ValidationPath } from "./report.ts";
import { isTrue } from "./guards.ts";
import {
  bigInteger,
  emptyMap,
  emptySet,
  indices,
  mapFrom,
  setFrom,
} from "../runtime.ts";
import type {
  Expr,
  LocalId,
  Parameter,
  RefinementProof,
  Type,
  TypeDecl,
  TypeId,
} from "../ir.ts";
import type { Predicate, Term } from "../predicates.ts";
import { verifyCertificate } from "./predicates.ts";
import { AREA } from "./report.ts";
import { invocationOf, isQuiet } from "./sets.ts";
import { MAX_DEPTH } from "./type_children.ts";
import {
  fieldsOf,
  fits,
  identityBody,
  members,
  ownsSealed,
  unfold,
} from "./typing.ts";
import type { Ctx } from "./world_table.ts";

const QUERY_STEPS = 8_192;
const AGGREGATE_STEPS = 100_000;

type Linear = {
  readonly terms: ReadonlyMap<
    string,
    { readonly term: Term; readonly coefficient: bigint }
  >;
  readonly offset: bigint;
};

function zeroLinear(): Linear {
  return { terms: emptyMap(), offset: 0n };
}

type RefinementSnapshot = {
  readonly locals: ReadonlyMap<LocalId, Type>;
  readonly aliases: readonly Predicate[];
  readonly branches: readonly Predicate[];
};

type LocalPath = readonly [LocalId, ...readonly string[]];

export type RefinementValidator = {
  readonly snapshot: () => RefinementSnapshot;
  readonly restore: (snapshot: RefinementSnapshot) => RefinementValidator;
  readonly leaveScope: (scope: RefinementSnapshot) => RefinementValidator;
  readonly join: (states: readonly RefinementSnapshot[]) => RefinementValidator;
  readonly addLocal: (
    parameter: Parameter,
    init: Expr | undefined,
  ) => RefinementValidator;
  readonly release: (ids: readonly string[]) => RefinementValidator;
  readonly addBranch: (
    predicate: Predicate | undefined,
  ) => RefinementValidator;
  readonly clearDerivedFacts: () => RefinementValidator;
  readonly condition: (expression: Expr) => Predicate | undefined;
  readonly literalMatch: (
    subject: Expr,
    value: string | number | boolean | null,
  ) => Predicate | undefined;
  readonly adoption: (
    expression: Expr,
    source: Type,
    target: Type,
    path: string,
  ) => "not-required" | "handled";
  readonly retain: (
    expression: Expr,
    target: Type,
    path: string,
  ) => RefinementValidator;
  readonly audit: (
    expression: Expr,
    path: string,
    children: (expr: Expr) => readonly Expr[],
  ) => RefinementValidator;
};

/** Independently reconstructs proof obligations from typed IR. */
export function createRefinementValidator(ctx: Ctx): RefinementValidator {
  let locals = emptyMap<LocalId, Type>();
  let aliases: Predicate[] = [];
  let branches: Predicate[] = [];
  let remainingSteps = AGGREGATE_STEPS;
  let consumedProofs = emptyMap<Expr, Set<RefinementProof>>();
  let validator: RefinementValidator;

  function snapshot(): RefinementSnapshot {
    return {
      locals: mapFrom(locals),
      aliases: [...aliases],
      branches: [...branches],
    };
  }

  function restore(snapshot: RefinementSnapshot): RefinementValidator {
    locals = mapFrom(snapshot.locals);
    aliases = [...snapshot.aliases];
    branches = [...snapshot.branches];
    return validator;
  }

  function leaveScope(scope: RefinementSnapshot): RefinementValidator {
    locals = mapFrom(scope.locals);
    const known = setFrom<string>(scope.locals.keys());
    aliases = aliases.filter((fact) => withinScope(fact, known));
    branches = branches.filter((fact) => withinScope(fact, known));
    return validator;
  }

  function join(states: readonly RefinementSnapshot[]): RefinementValidator {
    if (states.length === 0) return validator;
    const known = setFrom<string>(locals.keys());
    function common(key: "aliases" | "branches"): Predicate[] {
      return states[0][key].filter((fact) =>
        withinScope(fact, known) &&
        states.every((state) =>
          state[key].some((other) =>
            JSON.stringify(other) === JSON.stringify(fact)
          )
        )
      );
    }
    aliases = common("aliases");
    branches = common("branches");
    return validator;
  }

  function addLocal(
    parameter: Parameter,
    init: Expr | undefined,
  ): RefinementValidator {
    locals = locals.set(parameter.id, parameter.type);
    // Only a quiet initializer, which is pure and has no failure or requirement, aliases.
    if (init === undefined || !isQuiet(invocationOf(init))) return validator;
    aliases = [
      ...aliases,
      ...aliasEquations(parameter.id, parameter.type, init),
    ];
    return validator;
  }

  function release(ids: readonly string[]): RefinementValidator {
    for (const id of ids) {
      if (id.startsWith("local:")) {
        if (!locals.delete(`local:${id.slice("local:".length)}`)) continue;
      }
    }
    aliases = aliases.filter((predicate) => !mentionsAny(predicate, ids));
    return validator;
  }

  function addBranch(
    predicate: Predicate | undefined,
  ): RefinementValidator {
    if (predicate !== undefined) branches[branches.length] = predicate;
    return validator;
  }

  function clearDerivedFacts(): RefinementValidator {
    aliases = [];
    branches = [];
    return validator;
  }

  function condition(expression: Expr): Predicate | undefined {
    if (expression.kind !== "binary") return undefined;
    if (expression.operator === "&&" || expression.operator === "||") {
      const left = condition(expression.left);
      const right = condition(expression.right);
      if (left === undefined || right === undefined) return undefined;
      return expression.operator === "&&"
        ? canonicalAnd([left, right])
        : canonicalPredicate({ kind: "or", operands: [left, right] });
    }
    if (
      expression.operator !== "<" && expression.operator !== "<=" &&
      expression.operator !== "===" && expression.operator !== "!==" &&
      expression.operator !== ">=" && expression.operator !== ">"
    ) return undefined;
    const left = linear(expression.left);
    const right = linear(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : compare(left, expression.operator, right);
  }

  function literalMatch(
    subject: Expr,
    value: string | number | boolean | null,
  ): Predicate | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      return undefined;
    }
    const left = linear(subject);
    const right: Linear = {
      terms: emptyMap(),
      offset: bigInteger(value.toString()),
    };
    return left === undefined ? undefined : compare(left, "===", right);
  }

  /**
   * Checks refined adoption. `handled` means that ordinary type compatibility
   * must not emit a second diagnostic.
   */
  function adoption(
    expression: Expr,
    source: Type,
    target: Type,
    path: string,
  ): "not-required" | "handled" {
    const refined = refinedTarget(target);
    if (refined === undefined) return "not-required";
    const found = unfoldTransparentType(ctx, source);
    if (
      found.kind === "named" && found.id === refined.id
    ) return "not-required";
    if (found.kind === "named") return "not-required";
    const base = identityBody(ctx.world.env, refined.id);
    if (base === undefined || !fits(ctx.world.env, found, base)) {
      return "not-required";
    }
    ctx = checkProof(expression, refined.id, refined.predicate, path);
    return "handled";
  }

  /** Requires a proof when an operation retains an already refined identity. */
  function retain(
    expression: Expr,
    target: Type,
    path: string,
  ): RefinementValidator {
    const refined = refinedTarget(target);
    if (refined !== undefined) {
      ctx = checkProof(expression, refined.id, refined.predicate, path);
    }
    return validator;
  }

  /** Reports every proof that no independently reconstructed obligation used. */
  function audit(
    expression: Expr,
    path: string,
    children: (expr: Expr) => readonly Expr[],
  ): RefinementValidator {
    for (const entry of (expression.proofs ?? []).entries()) {
      const proof = entry[1];
      const index = entry[0];
      if (!consumedProofs.get(expression)?.has(proof)) {
        ctx = {
          ...ctx,
          report: ctx.report
            .add(
              AREA.types,
              `${path}.proofs[${index}]`,
              "the proof has no supported obligation on this expression",
              expression.span,
            ),
        };
      }
    }
    for (const entry of children(expression).entries()) {
      const child = entry[1];
      const index = entry[0];
      validator = audit(child, `${path}.$children[${index}]`, children);
    }
    return validator;
  }

  function refinedTarget(
    type: Type,
  ): { readonly id: TypeId; readonly predicate: Predicate } | undefined {
    const current = unfoldTransparentType(ctx, type);
    if (current.kind !== "named" || !current.id.startsWith("type:")) {
      return undefined;
    }
    const id: TypeId = `type:${current.id.slice("type:".length)}`;
    const declaration = ctx.world.types.get(id);
    return declaration?.predicate === undefined
      ? undefined
      : { id: id, predicate: declaration.predicate };
  }

  function checkProof(
    expression: Expr,
    target: TypeId,
    predicate: Predicate,
    path: string,
  ): Ctx {
    const proofs =
      expression.proofs?.filter((proof) => proof.target === target) ?? [];
    let consumed = consumedProofs.get(expression) ??
      emptySet<RefinementProof>();
    consumedProofs = consumedProofs.set(expression, consumed);
    for (const proof of proofs) consumed = consumed.add(proof);
    if (proofs.length !== 1) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.types,
          `${path}.proofs`,
          proofs.length === 0
            ? `a value adopted as ${target} needs one proof`
            : `a value adopted as ${target} has duplicate proofs`,
          expression.span,
        ),
      };
      return ctx;
    }
    const proof = proofs[0];
    const declaration = ctx.world.types.get(target);
    if (
      declaration === undefined || isTrue(declaration.opaque) ||
      declaration.definition.kind !== "nominal" ||
      declaration.predicate === undefined ||
      !ownsSealed(ctx.world.env, target)
    ) {
      return invalid(
        ctx,
        path,
        expression,
        "the proof target is not a constructible refined identity",
      );
    }
    const goal = substitute(
      predicate,
      (term) => linearAt(expression, termPath(term), term.kind === "length"),
    );
    if (goal === undefined) {
      return invalid(
        ctx,
        path,
        expression,
        "the proof claim uses an unsupported expression",
      );
    }
    if (proof.certificate.claim !== "proved") {
      return invalid(
        ctx,
        path,
        expression,
        "the proof certificate does not prove its claim",
      );
    }
    if (remainingSteps === 0) {
      return invalid(
        ctx,
        path,
        expression,
        "the aggregate proof validation limit is exhausted",
      );
    }
    const maxSteps = Math.min(QUERY_STEPS, remainingSteps);
    const assumptions = canonicalAnd([
      ...[...locals].flatMap((entry) => {
        const id = entry[0];
        const type = entry[1];
        return typeAssumptionsAt(ctx, type, [id], undefined);
      }),
      ...aliases,
      ...branches,
    ]);
    const checked = verifyCertificate(
      assumptions,
      canonicalPredicate(goal),
      proof.certificate,
      { maxSteps: maxSteps },
    );
    if (!checked.ok) {
      remainingSteps = remainingSteps - maxSteps;
      return invalid(
        ctx,
        path,
        expression,
        `the proof certificate is invalid: ${checked.error.tag}`,
      );
    }
    remainingSteps = remainingSteps - checked.value.stepsUsed;
    return ctx;
  }

  function invalid(
    current: Ctx,
    path: string,
    expression: Expr,
    message: string,
  ): Ctx {
    return {
      ...current,
      report: current.report.add(
        AREA.types,
        `${path}.proofs`,
        message,
        expression.span,
      ),
    };
  }

  function aliasEquations(id: LocalId, type: Type, init: Expr): Predicate[] {
    const result: Predicate[] = [];
    for (const path of proofPaths(ctx, type)) {
      const right = linearAt(init, path.path, path.length);
      if (right === undefined) continue;
      const left = linearForPath([id, ...path.path], path.length);
      const equal = compare(left, "===", right);
      if (equal !== undefined) result[result.length] = equal;
    }
    return result;
  }

  function linearAt(
    expression: Expr,
    path: readonly string[],
    length: boolean,
  ): Linear | undefined {
    if (path.length > 0) {
      const field = recordField(expression, path[0]);
      if (field !== undefined) {
        return linearAt(field, path.slice(1), length);
      }
      if (expression.kind === "update") {
        return linearAt(expression.record, path, length);
      }
      const base = pathOf(expression);
      if (base === undefined) return undefined;
      const target: LocalPath = [base[0], ...base.slice(1), ...path];
      return !length && !integerPath(target)
        ? undefined
        : linearForPath(target, length);
    }
    if (length) {
      if (
        expression.kind === "literal" && typeof expression.value === "string"
      ) {
        return {
          terms: emptyMap(),
          offset: bigInteger(expression.value.length.toString()),
        };
      }
      if (expression.kind === "array" || expression.kind === "tuple") {
        return {
          terms: emptyMap(),
          offset: bigInteger(expression.elements.length.toString()),
        };
      }
      const base = pathOf(expression);
      return base === undefined ? undefined : linearForPath(base, true);
    }
    return linear(expression);
  }

  function linear(expression: Expr): Linear | undefined {
    if (
      expression.kind === "literal" && typeof expression.value === "number" &&
      Number.isSafeInteger(expression.value) && expression.value >= 0
    ) {
      return {
        terms: emptyMap(),
        offset: bigInteger(expression.value.toString()),
      };
    }
    const path = pathOf(expression);
    if (path !== undefined && integerPath(path)) {
      return linearForPath(path, false);
    }
    if (
      expression.kind !== "binary" ||
      (expression.operator !== "+" && expression.operator !== "-")
    ) return undefined;
    const left = linear(expression.left);
    const right = linear(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : addLinear(left, right, expression.operator === "+" ? 1n : -1n);
  }

  function pathOf(expression: Expr): LocalPath | undefined {
    if (
      expression.kind === "reference" && expression.target.startsWith("local:")
    ) {
      const id: LocalId = `local:${expression.target.slice("local:".length)}`;
      return locals.has(id) ? [id] : undefined;
    }
    if (expression.kind !== "get") return undefined;
    const path = pathOf(expression.record);
    return path === undefined ? undefined : [
      path[0],
      ...path.slice(1),
      expression.field,
    ];
  }

  function integerPath(path: LocalPath): boolean {
    const id = path[0];
    const names = path.slice(1);
    const root = locals.get(id);
    if (root === undefined) return false;
    let types: readonly Type[] = [root];
    for (const name of names) {
      const next: Type[] = [];
      for (const type of types) {
        for (const member of members(ctx.world.env, type)) {
          const field = fieldsOf(ctx.world.env, member)?.find(
            (candidate) => candidate.name === name,
          );
          if (field === undefined || field.optional) return false;
          next[next.length] = field.type;
        }
      }
      types = next;
    }
    return types.length > 0 &&
      types.every((type) => integerType(ctx, type));
  }

  function recordField(expression: Expr, name: string): Expr | undefined {
    if (expression.kind === "record") {
      return expression.fields.find((field) => field.name === name)?.value;
    }
    if (expression.kind === "update") {
      return expression.fields.find((field) => field.name === name)?.value ??
        recordField(expression.record, name);
    }
    return undefined;
  }

  validator = {
    snapshot: snapshot,
    restore: restore,
    leaveScope: leaveScope,
    join: join,
    addLocal: addLocal,
    release: release,
    addBranch: addBranch,
    clearDerivedFacts: clearDerivedFacts,
    condition: condition,
    literalMatch: literalMatch,
    adoption: adoption,
    retain: retain,
    audit: audit,
  };
  return validator;
}

/** Checks the shape and required base paths of one declared predicate. */
export function checkRefinementDeclaration(
  ctx: Ctx,
  declaration: TypeDecl,
  path: ValidationPath,
): Ctx {
  const predicate = declaration.predicate;
  if (predicate === undefined) return ctx;
  if (declaration.span.source.endsWith(".effi")) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.predicate`,
        "host interfaces must expose unrefined data",
        declaration.span,
      ),
    };
  }
  if (
    isTrue(declaration.opaque) || declaration.definition.kind !== "nominal"
  ) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.predicate`,
        "a predicate belongs only to a non-opaque type with identity",
        declaration.span,
      ),
    };
    return ctx;
  }
  const problem = predicateProblem(
    ctx,
    predicate,
    declaration.definition.base,
    0,
  );
  if (problem !== undefined) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.predicate`,
        problem,
        declaration.span,
      ),
    };
  }
  return ctx;
}

function predicateProblem(
  ctx: Ctx,
  predicate: Predicate,
  base: Type,
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return `predicate nesting exceeds ${MAX_DEPTH} levels`;
  if (typeof predicate !== "object" || predicate === null) {
    return "a predicate is not an object";
  }
  if (predicate.kind === "constant") {
    return typeof predicate.value === "boolean"
      ? undefined
      : "a constant predicate needs a boolean value";
  }
  if (predicate.kind === "not") {
    return predicateProblem(ctx, predicate.operand, base, depth + 1);
  }
  if (predicate.kind === "and" || predicate.kind === "or") {
    if (!Array.isArray(predicate.operands)) {
      return "a Boolean predicate needs an operand list";
    }
    for (const operand of predicate.operands) {
      const problem = predicateProblem(ctx, operand, base, depth + 1);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (predicate.kind !== "difference") {
    return "a predicate has an unknown kind";
  }
  if (!isNormalizedInteger(predicate.maximum)) {
    return "a difference maximum must be a normalized integer";
  }
  return termProblem(ctx, predicate.left, base) ??
    termProblem(ctx, predicate.right, base);
}

function isNormalizedInteger(text: string): boolean {
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (digits === "0") return true;
  if (digits.length === 0 || digits.startsWith("0")) return false;
  for (const digit of digits) {
    if (digit < "0" || digit > "9") return false;
  }
  return true;
}

function termProblem(ctx: Ctx, term: Term, base: Type): string | undefined {
  if (typeof term !== "object" || term === null) {
    return "a predicate term is not an object";
  }
  if (term.kind === "zero") return undefined;
  if (term.kind === "input") {
    return integerType(ctx, base)
      ? undefined
      : "an input term must have type int";
  }
  if (term.kind !== "field" && term.kind !== "length") {
    return "a predicate term has an unknown kind";
  }
  if (
    !Array.isArray(term.path) ||
    !term.path.every((part) => typeof part === "string")
  ) {
    return "a predicate term path must be a string list";
  }
  if (term.kind === "field" && term.path.length === 0) {
    return "a field term needs a field path";
  }
  if (term.kind === "length" && term.unit !== "utf16") {
    return "a length term must use UTF-16 units";
  }
  const resolved = typeAtRequiredPath(ctx, base, term.path);
  if (typeof resolved === "string") return resolved;
  if (term.kind === "field") {
    return integerType(ctx, resolved)
      ? undefined
      : "a compared field must have type int";
  }
  return lengthType(ctx, resolved)
    ? undefined
    : "a length term needs a string or array";
}

function typeAssumptionsAt(
  ctx: Ctx,
  type: Type,
  path: readonly string[],
  seen: ReadonlySet<Type> | undefined,
): Predicate[] {
  const visited = seen === undefined ? emptySet<Type>() : seen;
  if (visited.has(type)) return [];
  const nextSeen = setFrom(visited).add(type);
  const current = unfoldTransparentType(ctx, type);
  if (current.kind === "named" && current.id.startsWith("type:")) {
    const id: TypeId = `type:${current.id.slice("type:".length)}`;
    const declaration = ctx.world.types.get(id);
    const assumptions: Predicate[] = [];
    if (declaration?.predicate !== undefined) {
      const compiled = substitute(
        declaration.predicate,
        (term) =>
          linearForPath(
            [...path, ...termPath(term)],
            term.kind === "length",
          ),
      );
      if (compiled !== undefined) assumptions[assumptions.length] = compiled;
    }
    const base = identityBody(ctx.world.env, id) ??
      ctx.world.env.taggedRecords.get(id);
    return base === undefined
      ? assumptions
      : [...assumptions, ...typeAssumptionsAt(ctx, base, path, nextSeen)];
  }
  if (current.kind === "record") {
    return current.fields.flatMap((field) =>
      field.optional ? [] : typeAssumptionsAt(
        ctx,
        field.type,
        [...path, field.name],
        nextSeen,
      )
    );
  }
  if (
    current.kind === "array" ||
    (current.kind === "primitive" && current.name === "string") ||
    (current.kind === "literal" && typeof current.value === "string")
  ) {
    const length = linearForPath(path, true);
    const zero: Linear = { terms: emptyMap(), offset: 0n };
    const lower = difference(addLinear(zero, length, -1n), 0n);
    const upper = difference(
      addLinear(length, zero, -1n),
      bigInteger(Number.MAX_SAFE_INTEGER.toString()),
    );
    return lower === undefined || upper === undefined ? [] : [lower, upper];
  }
  return [];
}

function unfoldTransparentType(ctx: Ctx, type: Type): Type {
  let current = type;
  let seen = emptySet<string>();
  for (const _index of indices(MAX_DEPTH + 1)) {
    if (current.kind !== "named") break;
    if (ctx.world.env.identities.has(current.id)) break;
    if (seen.has(current.id)) break;
    const alias = ctx.world.env.aliases.get(current.id);
    if (alias === undefined) break;
    seen = seen.add(current.id);
    current = alias;
  }
  return current;
}

function typeAtRequiredPath(
  ctx: Ctx,
  base: Type,
  path: readonly string[],
): Type | string {
  let current = base;
  for (const name of path) {
    const fields = fieldsOf(ctx.world.env, current);
    if (fields === undefined) {
      return `the predicate path reaches non-record field ${name}`;
    }
    const field = fields.find((candidate) => candidate.name === name);
    if (field === undefined) return `the predicate base has no field ${name}`;
    if (field.optional) return `the predicate field ${name} must be required`;
    current = field.type;
  }
  return current;
}

function integerType(ctx: Ctx, type: Type): boolean {
  const current = unfold(ctx.world.env, type);
  if (current.kind === "primitive") return current.name === "int";
  if (current.kind === "literal") {
    return typeof current.value === "number" &&
      Number.isSafeInteger(current.value);
  }
  return current.kind === "union" &&
    current.members.every((member) => integerType(ctx, member));
}

function lengthType(ctx: Ctx, type: Type): boolean {
  const current = unfold(ctx.world.env, type);
  if (current.kind === "array") return true;
  if (current.kind === "primitive") return current.name === "string";
  if (current.kind === "literal") return typeof current.value === "string";
  return current.kind === "union" &&
    current.members.every((member) => lengthType(ctx, member));
}

function proofPaths(
  ctx: Ctx,
  type: Type,
): readonly { readonly path: readonly string[]; readonly length: boolean }[] {
  return proofPathsAt(ctx, type, [], emptySet());
}

function proofPathsAt(
  ctx: Ctx,
  type: Type,
  prefix: readonly string[],
  seen: ReadonlySet<Type>,
): readonly { readonly path: readonly string[]; readonly length: boolean }[] {
  if (seen.has(type)) return [];
  const nextSeen = setFrom(seen).add(type);
  const node = unfold(ctx.world.env, type);
  if (node.kind === "primitive") {
    if (node.name === "int") return [{ path: prefix, length: false }];
    if (node.name === "string") return [{ path: prefix, length: true }];
    return [];
  }
  if (node.kind === "literal") {
    if (typeof node.value === "number" && Number.isSafeInteger(node.value)) {
      return [{ path: prefix, length: false }];
    }
    return typeof node.value === "string"
      ? [{ path: prefix, length: true }]
      : [];
  }
  if (node.kind === "array") return [{ path: prefix, length: true }];
  if (node.kind !== "record") return [];
  return node.fields.flatMap((field) =>
    field.optional
      ? []
      : proofPathsAt(ctx, field.type, [...prefix, field.name], nextSeen)
  );
}

function termPath(term: Term): readonly string[] {
  return term.kind === "field" || term.kind === "length" ? term.path : [];
}

function linearForPath(path: readonly string[], length: boolean): Linear {
  const term: Term = length
    ? { kind: "length", path: path, unit: "utf16" }
    : { kind: "field", path: path };
  return {
    terms: mapFrom([[JSON.stringify(term), { term: term, coefficient: 1n }]]),
    offset: 0n,
  };
}

function addLinear(left: Linear, right: Linear, scale: bigint): Linear {
  let terms = mapFrom(left.terms);
  for (const entry of right.terms) {
    const key = entry[0];
    const item = entry[1];
    terms = terms.set(key, {
      term: item.term,
      coefficient: (terms.get(key)?.coefficient ?? 0n) +
        item.coefficient * scale,
    });
  }
  return { terms: terms, offset: left.offset + right.offset * scale };
}

function substitute(
  predicate: Predicate,
  value: (term: Term) => Linear | undefined,
): Predicate | undefined {
  if (predicate.kind === "constant") return predicate;
  if (predicate.kind === "not") {
    const operand = substitute(predicate.operand, value);
    return operand === undefined ? undefined : negate(operand);
  }
  if (predicate.kind === "and" || predicate.kind === "or") {
    const operands: Predicate[] = [];
    for (const item of predicate.operands) {
      const compiled = substitute(item, value);
      if (compiled === undefined) return undefined;
      operands[operands.length] = compiled;
    }
    return predicate.kind === "and"
      ? canonicalAnd(operands)
      : canonicalPredicate({ kind: "or", operands: operands });
  }
  const left = predicate.left.kind === "zero"
    ? zeroLinear()
    : value(predicate.left);
  const right = predicate.right.kind === "zero"
    ? zeroLinear()
    : value(predicate.right);
  if (left === undefined || right === undefined) return undefined;
  return difference(
    addLinear(left, right, -1n),
    bigInteger(predicate.maximum),
  );
}

function difference(linear: Linear, maximum: bigint): Predicate | undefined {
  const terms = [...linear.terms.values()].filter((item) =>
    item.coefficient !== 0n
  );
  if (
    terms.length > 2 ||
    terms.filter((item) => item.coefficient > 0n).length > 1 ||
    terms.filter((item) => item.coefficient < 0n).length > 1 ||
    terms.some((item) => item.coefficient !== 1n && item.coefficient !== -1n)
  ) return undefined;
  const positive = terms.find((item) => item.coefficient === 1n)?.term ??
    { kind: "zero" as const };
  const negative = terms.find((item) => item.coefficient === -1n)?.term ??
    { kind: "zero" as const };
  if (terms.length === 0) {
    return { kind: "constant", value: linear.offset <= maximum };
  }
  return {
    kind: "difference",
    left: positive,
    right: negative,
    maximum: (maximum - linear.offset).toString(),
  };
}

function compare(
  left: Linear,
  operator: "<" | "<=" | "===" | "!==" | ">=" | ">",
  right: Linear,
): Predicate | undefined {
  const forward = addLinear(left, right, -1n);
  const reverse = addLinear(right, left, -1n);
  if (operator === "<") return difference(forward, -1n);
  if (operator === "<=") return difference(forward, 0n);
  if (operator === ">") return difference(reverse, -1n);
  if (operator === ">=") return difference(reverse, 0n);
  if (operator === "===") {
    const a = difference(forward, 0n);
    const b = difference(reverse, 0n);
    return a === undefined || b === undefined
      ? undefined
      : canonicalAnd([a, b]);
  }
  const a = difference(forward, -1n);
  const b = difference(reverse, -1n);
  return a === undefined || b === undefined
    ? undefined
    : canonicalPredicate({ kind: "or", operands: [a, b] });
}

function negate(predicate: Predicate): Predicate {
  if (predicate.kind === "constant") {
    return { kind: "constant", value: !predicate.value };
  }
  return predicate.kind === "not"
    ? predicate.operand
    : { kind: "not", operand: predicate };
}

export function negateRefinement(
  predicate: Predicate | undefined,
): Predicate | undefined {
  return predicate === undefined ? undefined : negate(predicate);
}

function canonicalPredicate(predicate: Predicate): Predicate {
  if (predicate.kind === "and") return canonicalAnd(predicate.operands);
  if (predicate.kind === "or") {
    // Nested ors flatten, so `a || (b || c)` and `c || b || a` compare equal.
    const operands = predicate.operands.flatMap((operand) => {
      const canonical = canonicalPredicate(operand);
      return canonical.kind === "or" ? canonical.operands : [canonical];
    });
    return { kind: "or", operands: operands.sort(compareJson) };
  }
  if (predicate.kind === "not") {
    return { kind: "not", operand: canonicalPredicate(predicate.operand) };
  }
  return predicate;
}

function canonicalAnd(predicates: readonly Predicate[]): Predicate {
  let flat: Predicate[] = [];
  function add(current: Predicate[], predicate: Predicate): Predicate[] {
    const canonical = canonicalPredicate(predicate);
    if (canonical.kind === "constant" && canonical.value) return current;
    if (canonical.kind === "and") {
      for (const operand of canonical.operands) {
        current = add(current, operand);
      }
    } else current[current.length] = canonical;
    return current;
  }
  for (const predicate of predicates) flat = add(flat, predicate);
  if (
    flat.some((predicate) => predicate.kind === "constant" && !predicate.value)
  ) {
    return { kind: "constant", value: false };
  }
  flat = flat.toSorted(compareJson);
  if (flat.length === 0) return { kind: "constant", value: true };
  return flat.length === 1 ? flat[0] : { kind: "and", operands: flat };
}

function compareJson(left: Predicate, right: Predicate): number {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function mentionsAny(predicate: Predicate, ids: readonly string[]): boolean {
  function mentioned(term: Term): boolean {
    return (term.kind === "field" || term.kind === "length") &&
      ids.includes(term.path[0] ?? "");
  }
  if (predicate.kind === "constant") return false;
  if (predicate.kind === "difference") {
    return mentioned(predicate.left) || mentioned(predicate.right);
  }
  if (predicate.kind === "not") return mentionsAny(predicate.operand, ids);
  return predicate.operands.some((operand) => mentionsAny(operand, ids));
}

function withinScope(
  predicate: Predicate,
  known: ReadonlySet<string>,
): boolean {
  if (predicate.kind === "constant") return true;
  if (predicate.kind === "difference") {
    return [predicate.left, predicate.right].every((term) => {
      const path = termPath(term);
      return path.length === 0 || known.has(path[0]);
    });
  }
  if (predicate.kind === "not") return withinScope(predicate.operand, known);
  return predicate.operands.every((part) => withinScope(part, known));
}
