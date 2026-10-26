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
import {
  fieldsOf,
  fits,
  identityBody,
  MAX_DEPTH,
  members,
  ownsSealed,
  unfold,
} from "./typing.ts";
import type { Ctx } from "./world.ts";

const QUERY_STEPS = 8_192;
const AGGREGATE_STEPS = 100_000;

type Linear = {
  readonly terms: ReadonlyMap<
    string,
    { readonly term: Term; readonly coefficient: bigint }
  >;
  readonly offset: bigint;
};

interface RefinementSnapshot {
  readonly locals: ReadonlyMap<LocalId, Type>;
  readonly aliases: readonly Predicate[];
  readonly branches: readonly Predicate[];
}

/** Independently reconstructs proof obligations from typed IR. */
export class RefinementValidator {
  private locals = new Map<LocalId, Type>();
  private aliases: Predicate[] = [];
  private branches: Predicate[] = [];
  private remainingSteps = AGGREGATE_STEPS;
  private readonly consumed = new Map<Expr, Set<RefinementProof>>();

  constructor(private readonly ctx: Ctx) {}

  snapshot(): RefinementSnapshot {
    return {
      locals: new Map(this.locals),
      aliases: [...this.aliases],
      branches: [...this.branches],
    };
  }

  restore(snapshot: RefinementSnapshot): void {
    this.locals = new Map(snapshot.locals);
    this.aliases = [...snapshot.aliases];
    this.branches = [...snapshot.branches];
  }

  leaveScope(scope: RefinementSnapshot): void {
    this.locals = new Map(scope.locals);
    const known = new Set<string>(scope.locals.keys());
    this.aliases = this.aliases.filter((fact) => withinScope(fact, known));
    this.branches = this.branches.filter((fact) => withinScope(fact, known));
  }

  join(states: readonly RefinementSnapshot[]): void {
    if (states.length === 0) return;
    const known = new Set<string>(this.locals.keys());
    const common = (key: "aliases" | "branches"): Predicate[] =>
      states[0][key].filter((fact) =>
        withinScope(fact, known) &&
        states.every((state) =>
          state[key].some((other) =>
            JSON.stringify(other) === JSON.stringify(fact)
          )
        )
      );
    this.aliases = common("aliases");
    this.branches = common("branches");
  }

  addLocal(parameter: Parameter, init?: Expr): void {
    this.locals.set(parameter.id, parameter.type);
    if (init === undefined || !quiet(init)) return;
    this.aliases.push(
      ...this.aliasEquations(parameter.id, parameter.type, init),
    );
  }

  release(ids: readonly string[]): void {
    for (const id of ids) {
      if (id.startsWith("local:")) {
        this.locals.delete(`local:${id.slice("local:".length)}`);
      }
    }
    this.aliases = this.aliases.filter((predicate) =>
      !mentionsAny(predicate, ids)
    );
  }

  addBranch(predicate: Predicate | undefined): void {
    if (predicate !== undefined) this.branches.push(predicate);
  }

  clearDerivedFacts(): void {
    this.aliases = [];
    this.branches = [];
  }

  condition(expression: Expr): Predicate | undefined {
    if (expression.kind !== "binary") return undefined;
    if (expression.operator === "&&" || expression.operator === "||") {
      const left = this.condition(expression.left);
      const right = this.condition(expression.right);
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
    const left = this.linear(expression.left);
    const right = this.linear(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : compare(left, expression.operator, right);
  }

  literalMatch(
    subject: Expr,
    value: string | number | boolean | null,
  ): Predicate | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      return undefined;
    }
    const left = this.linear(subject);
    const right: Linear = { terms: new Map(), offset: BigInt(value) };
    return left === undefined ? undefined : compare(left, "===", right);
  }

  /**
   * Checks refined adoption. `handled` means that ordinary type compatibility
   * must not emit a second diagnostic.
   */
  adoption(
    expression: Expr,
    source: Type,
    target: Type,
    path: string,
  ): "not-required" | "handled" {
    const refined = this.refinedTarget(target);
    if (refined === undefined) return "not-required";
    const found = unfoldTransparentType(this.ctx, source);
    if (
      found.kind === "named" && found.id === refined.id
    ) return "not-required";
    if (found.kind === "named") return "not-required";
    const base = identityBody(this.ctx.world.env, refined.id);
    if (base === undefined || !fits(this.ctx.world.env, found, base)) {
      return "not-required";
    }
    this.checkProof(expression, refined.id, refined.predicate, path);
    return "handled";
  }

  /** Requires a proof when an operation retains an already refined identity. */
  retain(expression: Expr, target: Type, path: string): void {
    const refined = this.refinedTarget(target);
    if (refined !== undefined) {
      this.checkProof(expression, refined.id, refined.predicate, path);
    }
  }

  /** Reports every proof that no independently reconstructed obligation used. */
  audit(
    expression: Expr,
    path: string,
    children: (expr: Expr) => readonly Expr[],
  ): void {
    expression.proofs?.forEach((proof, index) => {
      if (!this.consumed.get(expression)?.has(proof)) {
        this.ctx.report.add(
          AREA.types,
          `${path}.proofs[${index}]`,
          "the proof has no supported obligation on this expression",
          expression.span,
        );
      }
    });
    children(expression).forEach((child, index) =>
      this.audit(child, `${path}.$children[${index}]`, children)
    );
  }

  private refinedTarget(
    type: Type,
  ): { readonly id: TypeId; readonly predicate: Predicate } | undefined {
    const current = unfoldTransparentType(this.ctx, type);
    if (current.kind !== "named" || !current.id.startsWith("type:")) {
      return undefined;
    }
    const id: TypeId = `type:${current.id.slice("type:".length)}`;
    const declaration = this.ctx.world.types.get(id);
    return declaration?.predicate === undefined
      ? undefined
      : { id, predicate: declaration.predicate };
  }

  private checkProof(
    expression: Expr,
    target: TypeId,
    predicate: Predicate,
    path: string,
  ): void {
    const proofs =
      expression.proofs?.filter((proof) => proof.target === target) ?? [];
    const consumed = this.consumed.get(expression) ??
      new Set<RefinementProof>();
    this.consumed.set(expression, consumed);
    for (const proof of proofs) consumed.add(proof);
    if (proofs.length !== 1) {
      this.ctx.report.add(
        AREA.types,
        `${path}.proofs`,
        proofs.length === 0
          ? `a value adopted as ${target} needs one proof`
          : `a value adopted as ${target} has duplicate proofs`,
        expression.span,
      );
      return;
    }
    const proof = proofs[0];
    const declaration = this.ctx.world.types.get(target);
    if (
      declaration === undefined || declaration.opaque === true ||
      declaration.definition.kind !== "nominal" ||
      declaration.predicate === undefined ||
      !ownsSealed(this.ctx.world.env, target)
    ) {
      this.invalid(
        path,
        expression,
        "the proof target is not a constructible refined identity",
      );
      return;
    }
    const goal = this.substituteValue(predicate, expression);
    if (goal === undefined) {
      this.invalid(
        path,
        expression,
        "the proof claim uses an unsupported expression",
      );
      return;
    }
    if (proof.certificate.claim !== "proved") {
      this.invalid(
        path,
        expression,
        "the proof certificate does not prove its claim",
      );
      return;
    }
    if (this.remainingSteps === 0) {
      this.invalid(
        path,
        expression,
        "the aggregate proof validation limit is exhausted",
      );
      return;
    }
    const maxSteps = Math.min(QUERY_STEPS, this.remainingSteps);
    const assumptions = canonicalAnd([
      ...this.typeAssumptions(),
      ...this.aliases,
      ...this.branches,
    ]);
    const checked = verifyCertificate(
      assumptions,
      canonicalPredicate(goal),
      proof.certificate,
      { maxSteps },
    );
    if (!checked.ok) {
      this.remainingSteps -= maxSteps;
      this.invalid(
        path,
        expression,
        `the proof certificate is invalid: ${checked.error.tag}`,
      );
      return;
    }
    this.remainingSteps -= checked.value.stepsUsed;
  }

  private invalid(path: string, expression: Expr, message: string): void {
    this.ctx.report.add(AREA.types, `${path}.proofs`, message, expression.span);
  }

  private typeAssumptions(): Predicate[] {
    const assumptions: Predicate[] = [];
    for (const [id, type] of this.locals) {
      assumptions.push(...typeAssumptionsAt(this.ctx, type, [id]));
    }
    return assumptions;
  }

  private aliasEquations(id: LocalId, type: Type, init: Expr): Predicate[] {
    const result: Predicate[] = [];
    for (const path of proofPaths(this.ctx, type)) {
      const right = this.linearAt(init, path.path, path.length);
      if (right === undefined) continue;
      const left = linearForPath([id, ...path.path], path.length);
      const equal = compare(left, "===", right);
      if (equal !== undefined) result.push(equal);
    }
    return result;
  }

  private substituteValue(
    predicate: Predicate,
    expression: Expr,
  ): Predicate | undefined {
    return substitute(
      predicate,
      (term) =>
        this.linearAt(expression, termPath(term), term.kind === "length"),
    );
  }

  private linearAt(
    expression: Expr,
    path: readonly string[],
    length: boolean,
  ): Linear | undefined {
    if (path.length > 0) {
      const field = this.recordField(expression, path[0]);
      if (field !== undefined) {
        return this.linearAt(field, path.slice(1), length);
      }
      if (expression.kind === "update") {
        return this.linearAt(expression.record, path, length);
      }
      const base = this.pathOf(expression);
      if (base === undefined) return undefined;
      const target = [...base, ...path];
      return !length && !this.integerPath(target)
        ? undefined
        : linearForPath(target, length);
    }
    if (length) {
      if (
        expression.kind === "literal" && typeof expression.value === "string"
      ) return { terms: new Map(), offset: BigInt(expression.value.length) };
      if (expression.kind === "array" || expression.kind === "tuple") {
        return { terms: new Map(), offset: BigInt(expression.elements.length) };
      }
      const base = this.pathOf(expression);
      return base === undefined ? undefined : linearForPath(base, true);
    }
    return this.linear(expression);
  }

  private linear(expression: Expr): Linear | undefined {
    if (
      expression.kind === "literal" && typeof expression.value === "number" &&
      Number.isSafeInteger(expression.value) && expression.value >= 0
    ) {
      return { terms: new Map(), offset: BigInt(expression.value) };
    }
    const path = this.pathOf(expression);
    if (path !== undefined && this.integerPath(path)) {
      return linearForPath(path, false);
    }
    if (
      expression.kind !== "binary" ||
      (expression.operator !== "+" && expression.operator !== "-")
    ) return undefined;
    const left = this.linear(expression.left);
    const right = this.linear(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : addLinear(left, right, expression.operator === "+" ? 1n : -1n);
  }

  private pathOf(expression: Expr): readonly string[] | undefined {
    if (
      expression.kind === "reference" && expression.target.startsWith("local:")
    ) {
      const id: LocalId = `local:${expression.target.slice("local:".length)}`;
      return this.locals.has(id) ? [id] : undefined;
    }
    if (expression.kind !== "get") return undefined;
    const path = this.pathOf(expression.record);
    return path === undefined ? undefined : [...path, expression.field];
  }

  private integerPath(path: readonly string[]): boolean {
    const [id, ...names] = path;
    if (id === undefined) return false;
    const root = this.locals.get(id as LocalId);
    if (root === undefined) return false;
    let types: readonly Type[] = [root];
    for (const name of names) {
      const next: Type[] = [];
      for (const type of types) {
        for (const member of members(this.ctx.world.env, type)) {
          const field = fieldsOf(this.ctx.world.env, member)?.find(
            (candidate) => candidate.name === name,
          );
          if (field === undefined || field.optional) return false;
          next.push(field.type);
        }
      }
      types = next;
    }
    return types.length > 0 &&
      types.every((type) => integerType(this.ctx, type));
  }

  private recordField(expression: Expr, name: string): Expr | undefined {
    if (expression.kind === "record") {
      return expression.fields.find((field) => field.name === name)?.value;
    }
    if (expression.kind === "update") {
      return expression.fields.find((field) => field.name === name)?.value ??
        this.recordField(expression.record, name);
    }
    return undefined;
  }
}

/** Checks the shape and required base paths of one declared predicate. */
export function checkRefinementDeclaration(
  ctx: Ctx,
  declaration: TypeDecl,
  path: string,
): void {
  const predicate = declaration.predicate;
  if (predicate === undefined) return;
  if (declaration.span.source.endsWith(".effi")) {
    ctx.report.add(
      AREA.types,
      `${path}.predicate`,
      "host interfaces must expose unrefined data",
      declaration.span,
    );
  }
  if (
    declaration.opaque === true || declaration.definition.kind !== "nominal"
  ) {
    ctx.report.add(
      AREA.types,
      `${path}.predicate`,
      "a predicate belongs only to a non-opaque type with identity",
      declaration.span,
    );
    return;
  }
  const problem = predicateProblem(
    ctx,
    predicate,
    declaration.definition.base,
    0,
  );
  if (problem !== undefined) {
    ctx.report.add(AREA.types, `${path}.predicate`, problem, declaration.span);
  }
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
  switch (predicate.kind) {
    case "constant":
      return typeof predicate.value === "boolean"
        ? undefined
        : "a constant predicate needs a boolean value";
    case "not":
      return predicateProblem(ctx, predicate.operand, base, depth + 1);
    case "and":
    case "or":
      if (!Array.isArray(predicate.operands)) {
        return "a Boolean predicate needs an operand list";
      }
      for (const operand of predicate.operands) {
        const problem = predicateProblem(ctx, operand, base, depth + 1);
        if (problem !== undefined) return problem;
      }
      return undefined;
    case "difference": {
      if (!/^-?(0|[1-9][0-9]*)$/.test(predicate.maximum)) {
        return "a difference maximum must be a normalized integer";
      }
      return termProblem(ctx, predicate.left, base) ??
        termProblem(ctx, predicate.right, base);
    }
    default:
      return "a predicate has an unknown kind";
  }
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
  return term.kind === "field"
    ? integerType(ctx, resolved)
      ? undefined
      : "a compared field must have type int"
    : lengthType(ctx, resolved)
    ? undefined
    : "a length term needs a string or array";
}

function typeAssumptionsAt(
  ctx: Ctx,
  type: Type,
  path: readonly string[],
  seen: ReadonlySet<Type> = new Set(),
): Predicate[] {
  if (seen.has(type)) return [];
  const nextSeen = new Set(seen).add(type);
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
      if (compiled !== undefined) assumptions.push(compiled);
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
    const zero: Linear = { terms: new Map(), offset: 0n };
    const lower = difference(addLinear(zero, length, -1n), 0n);
    const upper = difference(
      addLinear(length, zero, -1n),
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    return lower === undefined || upper === undefined ? [] : [lower, upper];
  }
  return [];
}

function unfoldTransparentType(ctx: Ctx, type: Type): Type {
  let current = type;
  const seen = new Set<string>();
  while (
    current.kind === "named" && !ctx.world.env.identities.has(current.id) &&
    !seen.has(current.id)
  ) {
    const alias = ctx.world.env.aliases.get(current.id);
    if (alias === undefined) break;
    seen.add(current.id);
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
  prefix: readonly string[] = [],
  seen: ReadonlySet<Type> = new Set(),
): readonly { readonly path: readonly string[]; readonly length: boolean }[] {
  if (seen.has(type)) return [];
  const nextSeen = new Set(seen).add(type);
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
      : proofPaths(ctx, field.type, [...prefix, field.name], nextSeen)
  );
}

function termPath(term: Term): readonly string[] {
  return term.kind === "field" || term.kind === "length" ? term.path : [];
}

function linearForPath(path: readonly string[], length: boolean): Linear {
  const term: Term = length
    ? { kind: "length", path, unit: "utf16" }
    : { kind: "field", path };
  return {
    terms: new Map([[JSON.stringify(term), { term, coefficient: 1n }]]),
    offset: 0n,
  };
}

function addLinear(left: Linear, right: Linear, scale: bigint): Linear {
  const terms = new Map(left.terms);
  for (const [key, item] of right.terms) {
    terms.set(key, {
      term: item.term,
      coefficient: (terms.get(key)?.coefficient ?? 0n) +
        item.coefficient * scale,
    });
  }
  return { terms, offset: left.offset + right.offset * scale };
}

function substitute(
  predicate: Predicate,
  value: (term: Term) => Linear | undefined,
): Predicate | undefined {
  switch (predicate.kind) {
    case "constant":
      return predicate;
    case "not": {
      const operand = substitute(predicate.operand, value);
      return operand === undefined ? undefined : negate(operand);
    }
    case "and":
    case "or": {
      const operands: Predicate[] = [];
      for (const item of predicate.operands) {
        const compiled = substitute(item, value);
        if (compiled === undefined) return undefined;
        operands.push(compiled);
      }
      return predicate.kind === "and"
        ? canonicalAnd(operands)
        : canonicalPredicate({ kind: "or", operands });
    }
    case "difference": {
      const left = predicate.left.kind === "zero"
        ? { terms: new Map(), offset: 0n }
        : value(predicate.left);
      const right = predicate.right.kind === "zero"
        ? { terms: new Map(), offset: 0n }
        : value(predicate.right);
      if (left === undefined || right === undefined) return undefined;
      return difference(addLinear(left, right, -1n), BigInt(predicate.maximum));
    }
  }
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
  switch (operator) {
    case "<":
      return difference(forward, -1n);
    case "<=":
      return difference(forward, 0n);
    case ">":
      return difference(reverse, -1n);
    case ">=":
      return difference(reverse, 0n);
    case "===": {
      const a = difference(forward, 0n);
      const b = difference(reverse, 0n);
      return a === undefined || b === undefined
        ? undefined
        : canonicalAnd([a, b]);
    }
    case "!==": {
      const a = difference(forward, -1n);
      const b = difference(reverse, -1n);
      return a === undefined || b === undefined
        ? undefined
        : canonicalPredicate({ kind: "or", operands: [a, b] });
    }
  }
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
  const flat: Predicate[] = [];
  const add = (predicate: Predicate): void => {
    const canonical = canonicalPredicate(predicate);
    if (canonical.kind === "constant" && canonical.value) return;
    if (canonical.kind === "and") {
      for (const operand of canonical.operands) add(operand);
    } else flat.push(canonical);
  };
  for (const predicate of predicates) add(predicate);
  if (
    flat.some((predicate) => predicate.kind === "constant" && !predicate.value)
  ) {
    return { kind: "constant", value: false };
  }
  flat.sort(compareJson);
  if (flat.length === 0) return { kind: "constant", value: true };
  return flat.length === 1 ? flat[0] : { kind: "and", operands: flat };
}

function compareJson(left: Predicate, right: Predicate): number {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function quiet(expression: Expr): boolean {
  return expression.execution === "pure" &&
    expression.effects.failures.length === 0 &&
    expression.effects.requirements.length === 0;
}

function mentionsAny(predicate: Predicate, ids: readonly string[]): boolean {
  const mentioned = (term: Term): boolean =>
    (term.kind === "field" || term.kind === "length") &&
    ids.includes(term.path[0] ?? "");
  switch (predicate.kind) {
    case "constant":
      return false;
    case "difference":
      return mentioned(predicate.left) || mentioned(predicate.right);
    case "not":
      return mentionsAny(predicate.operand, ids);
    case "and":
    case "or":
      return predicate.operands.some((operand) => mentionsAny(operand, ids));
  }
}

function withinScope(
  predicate: Predicate,
  known: ReadonlySet<string>,
): boolean {
  switch (predicate.kind) {
    case "constant":
      return true;
    case "difference":
      return [predicate.left, predicate.right].every((term) => {
        const path = termPath(term);
        return path.length === 0 || known.has(path[0]);
      });
    case "not":
      return withinScope(predicate.operand, known);
    case "and":
    case "or":
      return predicate.operands.every((part) => withinScope(part, known));
  }
}
