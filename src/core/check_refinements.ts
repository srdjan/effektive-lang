import { compareText } from "./util.ts";
import type { LocalId, RefinementProof, TypeId } from "./ir.ts";
import { and, entails, not, type Predicate, type Term } from "./predicates.ts";
import { flattenMembers } from "./patterns.ts";
import type { Target } from "./resolve.ts";
import {
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import { kidsOf, literalOf, nameTextOf, operatorOf } from "./syntax_queries.ts";
import type { TypeRef, TypeTable } from "./types.ts";

const REFINEMENT_QUERY_STEPS = 8_192;
export const REFINEMENT_AGGREGATE_STEPS = 100_000;

export interface ProofBudget {
  remaining: number;
}

type Linear = {
  readonly terms: ReadonlyMap<
    string,
    { readonly term: Term; readonly coefficient: bigint }
  >;
  readonly offset: bigint;
};

interface RefinementSnapshot {
  readonly locals: ReadonlyMap<LocalId, TypeRef>;
  readonly aliases: readonly Predicate[];
  readonly branches: readonly Predicate[];
}

export type RefinementDecision =
  | { readonly status: "proved"; readonly proof: RefinementProof }
  | { readonly status: "not-required" }
  | {
    readonly status: "failed";
    readonly reason: "disproved" | "unknown" | "exhausted";
  };

/** Source refinement facts for one declaration body. */
export class RefinementChecker {
  private locals = new Map<LocalId, TypeRef>();
  private aliases: Predicate[] = [];
  private branches: Predicate[] = [];
  private readonly budget: ProofBudget;

  constructor(
    private readonly tree: SyntaxTree,
    private readonly table: TypeTable,
    private readonly module: string,
    private readonly targets: ReadonlyMap<NodeId, Target>,
    budget?: ProofBudget,
  ) {
    this.budget = budget ?? { remaining: REFINEMENT_AGGREGATE_STEPS };
  }

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

  addLocal(id: LocalId, type: TypeRef, init?: NodeId): void {
    this.locals.set(id, type);
    if (init === undefined) return;
    this.aliases.push(...this.aliasEquations(id, type, init));
  }

  addFieldLocal(
    id: LocalId,
    type: TypeRef,
    record: LocalId,
    field: string,
  ): void {
    this.addLocal(id, type);
    for (const path of proofPaths(this.table, type)) {
      const left = linearForPath([id, ...path.path], path.length);
      const right = linearForPath([record, field, ...path.path], path.length);
      const equal = compare(left, "===", right);
      if (equal !== undefined) this.aliases.push(equal);
    }
  }

  addBranch(predicate: Predicate | undefined): void {
    if (predicate !== undefined) this.branches.push(predicate);
  }

  clearDerivedFacts(): void {
    this.aliases = [];
    this.branches = [];
  }

  condition(node: NodeId): Predicate | undefined {
    const inner = this.unwrap(node);
    if (kindOf(this.tree, inner) !== SyntaxKind.BinaryExpr) return undefined;
    const operator = operatorOf(this.tree, inner);
    const [left, right] = kidsOf(this.tree, inner);
    if (operator === undefined || left === undefined || right === undefined) {
      return undefined;
    }
    if (operator === "&&" || operator === "||") {
      const l = this.condition(left);
      const r = this.condition(right);
      if (l === undefined || r === undefined) return undefined;
      return operator === "&&"
        ? canonicalAnd([l, r])
        : { kind: "or", operands: [l, r] };
    }
    if (
      operator !== "<" && operator !== "<=" && operator !== "===" &&
      operator !== "!==" && operator !== ">=" && operator !== ">"
    ) return undefined;
    const l = this.linear(left);
    const r = this.linear(right);
    if (l === undefined || r === undefined) return undefined;
    return compare(l, operator, r);
  }

  matchLiteral(
    subject: NodeId,
    value: string | number | boolean | null,
  ): Predicate | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      return undefined;
    }
    const left = this.linear(subject);
    return left === undefined
      ? undefined
      : compare(left, "===", { terms: new Map(), offset: BigInt(value) });
  }

  prove(node: NodeId, expected: TypeRef): RefinementDecision {
    const target = refinedTarget(this.table, expected);
    if (target === undefined) return { status: "not-required" };
    if (!this.table.ownsSealed(this.module, target.id)) {
      return { status: "failed", reason: "unknown" };
    }
    return this.proveTarget(node, target.id, target.predicate);
  }

  proveIdentity(node: NodeId, id: TypeId): RefinementDecision {
    const predicate = this.table.predicateOf(id);
    return predicate === undefined
      ? { status: "not-required" }
      : this.proveTarget(node, id, predicate);
  }

  private proveTarget(
    node: NodeId,
    target: TypeId,
    predicate: Predicate,
  ): RefinementDecision {
    const goal = this.substituteValue(predicate, node);
    if (goal === undefined) return { status: "failed", reason: "unknown" };
    if (this.budget.remaining === 0) {
      return { status: "failed", reason: "exhausted" };
    }
    const maxSteps = Math.min(REFINEMENT_QUERY_STEPS, this.budget.remaining);
    const assumptions = canonicalAnd([
      ...this.typeAssumptions(),
      ...this.aliases,
      ...this.branches,
    ]);
    const result = entails(assumptions, canonicalPredicate(goal), { maxSteps });
    if (!result.ok) return { status: "failed", reason: "unknown" };
    this.budget.remaining -= result.value.stepsUsed;
    if (result.value.status === "unknown") {
      return {
        status: "failed",
        reason: result.value.reason === "exhausted" ? "exhausted" : "unknown",
      };
    }
    if (result.value.status === "disproved") {
      return { status: "failed", reason: "disproved" };
    }
    return {
      status: "proved",
      proof: { target, certificate: result.value.certificate },
    };
  }

  private typeAssumptions(): Predicate[] {
    const assumptions: Predicate[] = [];
    for (const [id, type] of this.locals) {
      assumptions.push(...typeAssumptionsAt(this.table, type, [id]));
    }
    return assumptions;
  }

  private aliasEquations(
    id: LocalId,
    type: TypeRef,
    init: NodeId,
  ): Predicate[] {
    const result: Predicate[] = [];
    for (const path of proofPaths(this.table, type)) {
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
    node: NodeId,
  ): Predicate | undefined {
    return substitute(
      predicate,
      (term) => this.linearAt(node, termPath(term), term.kind === "length"),
    );
  }

  private linearAt(
    node: NodeId,
    path: readonly string[],
    length: boolean,
  ): Linear | undefined {
    const inner = this.unwrap(node);
    if (path.length > 0) {
      const field = this.recordField(inner, path[0]);
      if (field !== undefined) {
        return this.linearAt(field, path.slice(1), length);
      }
      const spread = this.recordSpread(inner);
      if (spread !== undefined) return this.linearAt(spread, path, length);
      const base = this.pathOf(inner);
      if (base === undefined) return undefined;
      const target = [...base, ...path];
      return !length && !this.integerPath(target)
        ? undefined
        : linearForPath(target, length);
    }
    if (length) {
      const literal = literalOf(this.tree, inner);
      if (typeof literal === "string") {
        return { terms: new Map(), offset: BigInt(literal.length) };
      }
      if (kindOf(this.tree, inner) === SyntaxKind.ListExpr) {
        return {
          terms: new Map(),
          offset: BigInt(kidsOf(this.tree, inner).length),
        };
      }
      const base = this.pathOf(inner);
      return base === undefined ? undefined : linearForPath(base, true);
    }
    return this.linear(inner);
  }

  private linear(node: NodeId): Linear | undefined {
    const inner = this.unwrap(node);
    if (kindOf(this.tree, inner) === SyntaxKind.LiteralExpr) {
      const text = nodeText(this.tree, inner);
      const value = literalOf(this.tree, inner);
      if (
        typeof value !== "number" || !Number.isSafeInteger(value) ||
        !/^[0-9]+$/.test(text)
      ) return undefined;
      return { terms: new Map(), offset: BigInt(text) };
    }
    const path = this.pathOf(inner);
    if (path !== undefined && this.integerPath(path)) {
      return linearForPath(path, false);
    }
    if (kindOf(this.tree, inner) !== SyntaxKind.BinaryExpr) return undefined;
    const operator = operatorOf(this.tree, inner);
    const [leftNode, rightNode] = kidsOf(this.tree, inner);
    if (
      (operator !== "+" && operator !== "-") || leftNode === undefined ||
      rightNode === undefined
    ) return undefined;
    const left = this.linear(leftNode);
    const right = this.linear(rightNode);
    if (left === undefined || right === undefined) return undefined;
    return addLinear(left, right, operator === "+" ? 1n : -1n);
  }

  private pathOf(node: NodeId): readonly string[] | undefined {
    const kind = kindOf(this.tree, node);
    if (kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name) {
      const target = this.targets.get(node);
      return target?.kind === "local" && this.locals.has(target.id)
        ? [target.id]
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) return undefined;
    const [base, member] = kidsOf(this.tree, node);
    if (base === undefined || member === undefined) return undefined;
    const path = this.pathOf(this.unwrap(base));
    const name = nameTextOf(this.tree, member);
    return path === undefined || name === undefined
      ? undefined
      : [...path, name];
  }

  private integerPath(path: readonly string[]): boolean {
    const [id, ...fields] = path;
    if (id === undefined) return false;
    const root = this.locals.get(id as LocalId);
    if (root === undefined) return false;
    let types: readonly TypeRef[] = [root];
    for (const name of fields) {
      const next: TypeRef[] = [];
      for (const type of types) {
        for (const member of flattenMembers(this.table, type)) {
          const node = this.table.node(member);
          if (node.kind !== "record") return false;
          const field = node.fields.find((candidate) =>
            candidate.name === name
          );
          if (field === undefined || field.optional) return false;
          next.push(field.type);
        }
      }
      types = next;
    }
    return types.length > 0 &&
      types.every((type) =>
        flattenMembers(this.table, type).every((member) => {
          const node = this.table.node(member);
          return node.kind === "primitive"
            ? node.name === "int"
            : node.kind === "literal" && typeof node.value === "number" &&
              Number.isSafeInteger(node.value);
        })
      );
  }

  private recordField(node: NodeId, name: string): NodeId | undefined {
    if (kindOf(this.tree, node) !== SyntaxKind.RecordExpr) return undefined;
    const fields = kidsOf(this.tree, node);
    for (const field of fields) {
      const parts = kidsOf(this.tree, field);
      const label = parts.find((part) =>
        kindOf(this.tree, part) === SyntaxKind.Name
      );
      if (label === undefined || nameTextOf(this.tree, label) !== name) {
        continue;
      }
      const value = parts.find((part) => part !== label);
      return value ?? label;
    }
    return undefined;
  }

  private recordSpread(node: NodeId): NodeId | undefined {
    if (kindOf(this.tree, node) !== SyntaxKind.RecordExpr) return undefined;
    const first = kidsOf(this.tree, node)[0];
    return first !== undefined &&
        kindOf(this.tree, first) === SyntaxKind.SpreadField
      ? kidsOf(this.tree, first)[0]
      : undefined;
  }

  private unwrap(node: NodeId): NodeId {
    let current = node;
    while (kindOf(this.tree, current) === SyntaxKind.ParenExpr) {
      const inner = kidsOf(this.tree, current)[0];
      if (inner === undefined) break;
      current = inner;
    }
    return current;
  }
}

function refinedTarget(
  table: TypeTable,
  ref: TypeRef,
): { readonly id: TypeId; readonly predicate: Predicate } | undefined {
  const node = table.node(table.unfoldTransparent(ref));
  if (node.kind !== "named" || !node.id.startsWith("type:")) return undefined;
  const id = node.id as TypeId;
  const predicate = table.predicateOf(id);
  return predicate === undefined ? undefined : { id, predicate };
}

function typeAssumptionsAt(
  table: TypeTable,
  ref: TypeRef,
  path: readonly string[],
  seen: ReadonlySet<TypeRef> = new Set(),
): Predicate[] {
  if (seen.has(ref)) return [];
  const nextSeen = new Set(seen).add(ref);
  const node = table.node(table.unfoldTransparent(ref));
  if (node.kind === "named" && node.id.startsWith("type:")) {
    const id = node.id as TypeId;
    const assumptions: Predicate[] = [];
    const predicate = table.predicateOf(id);
    if (predicate !== undefined) {
      const compiled = substitute(
        predicate,
        (term) =>
          linearForPath(
            [...path, ...termPath(term)],
            term.kind === "length",
          ),
      );
      if (compiled !== undefined) assumptions.push(compiled);
    }
    const base = table.identityBaseOf(id) ?? table.taggedRecordOf(id);
    return base === undefined
      ? assumptions
      : [...assumptions, ...typeAssumptionsAt(table, base, path, nextSeen)];
  }
  if (node.kind === "record") {
    return node.fields.flatMap((field) =>
      field.optional ? [] : typeAssumptionsAt(
        table,
        field.type,
        [...path, field.name],
        nextSeen,
      )
    );
  }
  if (
    node.kind === "array" ||
    (node.kind === "primitive" && node.name === "string") ||
    (node.kind === "literal" && typeof node.value === "string")
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

function proofPaths(
  table: TypeTable,
  ref: TypeRef,
  prefix: readonly string[] = [],
  seen: ReadonlySet<TypeRef> = new Set(),
): readonly { readonly path: readonly string[]; readonly length: boolean }[] {
  if (seen.has(ref)) return [];
  const nextSeen = new Set(seen).add(ref);
  const node = table.node(table.unfold(ref));
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
      : proofPaths(table, field.type, [...prefix, field.name], nextSeen)
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
      return operand === undefined ? undefined : not(operand);
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
        : { kind: "or", operands };
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
    terms.filter((item) => item.coefficient === 1n).length > 1 ||
    terms.filter((item) => item.coefficient === -1n).length > 1 ||
    terms.some((item) => item.coefficient !== 1n && item.coefficient !== -1n)
  ) return undefined;
  const positive = terms.find((item) => item.coefficient === 1n)?.term ?? {
    kind: "zero" as const,
  };
  const negative = terms.find((item) => item.coefficient === -1n)?.term ?? {
    kind: "zero" as const,
  };
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
        : { kind: "or", operands: [a, b] };
    }
  }
}

function canonicalPredicate(predicate: Predicate): Predicate {
  if (predicate.kind === "and") return canonicalAnd(predicate.operands);
  if (predicate.kind === "or") {
    return {
      kind: "or",
      operands: predicate.operands.map(canonicalPredicate).sort(compareJson),
    };
  }
  if (predicate.kind === "not") {
    return { kind: "not", operand: canonicalPredicate(predicate.operand) };
  }
  return predicate;
}

function canonicalAnd(predicates: readonly Predicate[]): Predicate {
  const flat: Predicate[] = [];
  const add = (predicate: Predicate): void => {
    if (predicate.kind === "and") {
      for (const operand of predicate.operands) add(operand);
      return;
    }
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
  return flat.length === 1 ? flat[0] : and(...flat);
}

function compareJson(left: Predicate, right: Predicate): number {
  return compareText(JSON.stringify(left), JSON.stringify(right));
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
