import { bigInteger, emptyMap, emptySet, mapFrom, setFrom } from "./runtime.ts";
import { compareText } from "./util.ts";
import { addLinear, differenceShape, type Linear } from "./linear.ts";
import { isLocalId, isTypeId, type ModuleName } from "./ids.ts";
import type { ProofBudget } from "./body_env.ts";
import type { LocalId, RefinementProof, TypeId } from "./ir.ts";
import {
  COMPARISON_BOUNDS,
  type ComparisonOperator,
  entails,
  not,
  type Predicate,
  type Term,
} from "./predicates.ts";
import { flattenMembers } from "./patterns.ts";
import type { Target } from "./resolve.ts";
import {
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import {
  kidsOf,
  literalOf,
  memberAccessParts,
  nameTextOf,
  operatorOf,
  unaryOperatorOf,
  unparen,
} from "./syntax_queries.ts";
import type { TypeRef, TypeTable } from "./types.ts";
const REFINEMENT_QUERY_STEPS = 8192;
const REFINEMENT_AGGREGATE_STEPS = 100000;
/** A new aggregate proof budget: the steps that the bodies of one module may spend together. */
export function newProofBudget(): ProofBudget {
  let remaining = REFINEMENT_AGGREGATE_STEPS;
  const budget: ProofBudget = {
    remaining: () => remaining,
    spend: (steps: number) => {
      remaining = remaining - steps;
      return budget;
    },
  };
  return budget;
}
type RefinementSnapshot = {
  readonly locals: ReadonlyMap<LocalId, TypeRef>;
  readonly aliases: readonly Predicate[];
  readonly branches: readonly Predicate[];
};
export type RefinementDecision = {
  readonly status: "proved";
  readonly proof: RefinementProof;
} | {
  readonly status: "not-required";
} | {
  readonly status: "failed";
  readonly reason: "disproved" | "unknown" | "exhausted";
};
/** Source refinement facts for one declaration body. */
export type RefinementChecker = {
  readonly snapshot: () => RefinementSnapshot;
  readonly restore: (snapshot: RefinementSnapshot) => RefinementChecker;
  readonly leaveScope: (scope: RefinementSnapshot) => RefinementChecker;
  readonly join: (states: readonly RefinementSnapshot[]) => RefinementChecker;
  readonly addLocal: (
    id: LocalId,
    type: TypeRef,
    init: NodeId | undefined,
  ) => RefinementChecker;
  readonly addFieldLocal: (
    id: LocalId,
    type: TypeRef,
    record: LocalId,
    field: string,
  ) => RefinementChecker;
  readonly addBranch: (predicate: Predicate | undefined) => RefinementChecker;
  readonly clearDerivedFacts: () => RefinementChecker;
  readonly condition: (node: NodeId) => Predicate | undefined;
  readonly matchLiteral: (
    subject: NodeId,
    value: string | number | boolean | null,
  ) => Predicate | undefined;
  readonly prove: (node: NodeId, expected: TypeRef) => RefinementDecision;
  readonly proveIdentity: (node: NodeId, id: TypeId) => RefinementDecision;
};
export function RefinementChecker(
  tree: SyntaxTree,
  table: TypeTable,
  module: ModuleName,
  targets: ReadonlyMap<NodeId, Target>,
  budget: ProofBudget,
): RefinementChecker {
  let locals = emptyMap<LocalId, TypeRef>();
  let aliases: Predicate[] = [];
  let branches: Predicate[] = [];
  function snapshot(): RefinementSnapshot {
    return {
      locals: mapFrom(locals),
      aliases: [...aliases],
      branches: [...branches],
    };
  }
  function restore(snapshot: RefinementSnapshot): RefinementChecker {
    locals = mapFrom(snapshot.locals);
    aliases = [...snapshot.aliases];
    branches = [...snapshot.branches];
    return self;
  }
  function leaveScope(scope: RefinementSnapshot): RefinementChecker {
    locals = mapFrom(scope.locals);
    const known = setFrom<string>(scope.locals.keys());
    aliases = aliases.filter((fact) => withinScope(fact, known));
    branches = branches.filter((fact) => withinScope(fact, known));
    return self;
  }
  function join(states: readonly RefinementSnapshot[]): RefinementChecker {
    if (states.length === 0) {
      return self;
    }
    const known = setFrom<string>(locals.keys());
    function common(key: "aliases" | "branches"): readonly Predicate[] {
      return states[0][key].filter((fact) =>
        withinScope(fact, known) &&
        states.every((state) =>
          state[key].some((other) =>
            JSON.stringify(other) === JSON.stringify(fact)
          )
        )
      );
    }
    aliases = [...common("aliases")];
    branches = [...common("branches")];
    return self;
  }
  function addLocal(
    id: LocalId,
    type: TypeRef,
    init: NodeId | undefined,
  ): RefinementChecker {
    locals = locals.set(id, type);
    if (init === undefined) {
      return self;
    }
    for (const equation of aliasEquations(id, type, init)) {
      aliases[aliases.length] = equation;
    }
    return self;
  }
  function addFieldLocal(
    id: LocalId,
    type: TypeRef,
    record: LocalId,
    field: string,
  ): RefinementChecker {
    locals = locals.set(id, type);
    for (const path of proofPaths(table, type, undefined, undefined)) {
      const left = linearForPath([id, ...path.path], path.length);
      const right = linearForPath([record, field, ...path.path], path.length);
      const equal = compare(left, "===", right);
      if (equal !== undefined) aliases[aliases.length] = equal;
    }
    return self;
  }
  function addBranch(predicate: Predicate | undefined): RefinementChecker {
    if (predicate !== undefined) branches[branches.length] = predicate;
    return self;
  }
  function clearDerivedFacts(): RefinementChecker {
    aliases = [];
    branches = [];
    return self;
  }
  function condition(node: NodeId): Predicate | undefined {
    const inner = unparen(tree, node);
    if (kindOf(tree, inner) !== SyntaxKind.BinaryExpr) {
      return undefined;
    }
    const operator = operatorOf(tree, inner);
    const children = kidsOf(tree, inner);
    const left = children[0];
    const right = children[1];
    if (operator === undefined || left === undefined || right === undefined) {
      return undefined;
    }
    if (operator === "&&" || operator === "||") {
      const l = condition(left);
      const r = condition(right);
      if (l === undefined || r === undefined) {
        return undefined;
      }
      return operator === "&&"
        ? canonicalAnd([l, r])
        : canonicalPredicate({ kind: "or", operands: [l, r] });
    }
    if (
      operator !== "<" && operator !== "<=" && operator !== "===" &&
      operator !== "!==" && operator !== ">=" && operator !== ">"
    ) {
      return undefined;
    }
    const l = linear(left);
    const r = linear(right);
    if (l === undefined || r === undefined) {
      return undefined;
    }
    return compare(l, operator, r);
  }
  function matchLiteral(
    subject: NodeId,
    value: string | number | boolean | null,
  ): Predicate | undefined {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      return undefined;
    }
    const left = linear(subject);
    return left === undefined
      ? undefined
      : compare(left, "===", { terms: emptyMap(), offset: bigInteger(value) });
  }
  function prove(node: NodeId, expected: TypeRef): RefinementDecision {
    const named = table.node(table.unfoldTransparent(expected));
    if (named.kind !== "named" || !isTypeId(named.id)) {
      return { status: "not-required" };
    }
    const id = named.id;
    const predicate = table.predicateOf(id);
    if (predicate === undefined) {
      return { status: "not-required" };
    }
    if (!table.ownsSealed(module, id)) {
      return { status: "failed", reason: "unknown" };
    }
    return proveTarget(node, id, predicate);
  }
  function proveIdentity(node: NodeId, id: TypeId): RefinementDecision {
    const predicate = table.predicateOf(id);
    return predicate === undefined
      ? { status: "not-required" }
      : proveTarget(node, id, predicate);
  }
  function proveTarget(
    node: NodeId,
    target: TypeId,
    predicate: Predicate,
  ): RefinementDecision {
    const goal = substitute(
      predicate,
      (term) => linearAt(node, termPath(term), term.kind === "length"),
    );
    if (goal === undefined) {
      return { status: "failed", reason: "unknown" };
    }
    if (budget.remaining() === 0) {
      return { status: "failed", reason: "exhausted" };
    }
    const maxSteps = Math.min(REFINEMENT_QUERY_STEPS, budget.remaining());
    const assumptions = canonicalAnd([
      ...[...locals].flatMap((entry) =>
        typeAssumptionsAt(table, entry[1], [entry[0]], undefined)
      ),
      ...aliases,
      ...branches,
    ]);
    const result = entails(assumptions, canonicalPredicate(goal), {
      maxSteps: maxSteps,
    });
    if (!result.ok) {
      return { status: "failed", reason: "unknown" };
    }
    budget = budget.spend(result.value.stepsUsed);
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
      proof: { target: target, certificate: result.value.certificate },
    };
  }
  function aliasEquations(
    id: LocalId,
    type: TypeRef,
    init: NodeId,
  ): Predicate[] {
    const result: Predicate[] = [];
    for (const path of proofPaths(table, type, undefined, undefined)) {
      const right = linearAt(init, path.path, path.length);
      if (right === undefined) {
        continue;
      }
      const left = linearForPath([id, ...path.path], path.length);
      const equal = compare(left, "===", right);
      if (equal !== undefined) result[result.length] = equal;
    }
    return result;
  }
  function linearAt(
    node: NodeId,
    path: readonly string[],
    length: boolean,
  ): Linear | undefined {
    const inner = unparen(tree, node);
    if (path.length > 0) {
      const field = recordField(inner, path[0]);
      if (field !== undefined) {
        return linearAt(field, path.slice(1), length);
      }
      // The operand of a spread in a record update.
      const first = kindOf(tree, inner) === SyntaxKind.RecordExpr
        ? kidsOf(tree, inner)[0]
        : undefined;
      const spread = first !== undefined &&
          kindOf(tree, first) === SyntaxKind.SpreadField
        ? kidsOf(tree, first)[0]
        : undefined;
      if (spread !== undefined) {
        return linearAt(spread, path, length);
      }
      const base = pathOf(inner);
      if (base === undefined) {
        return undefined;
      }
      const target = [...base, ...path];
      return !length && !integerPath(target)
        ? undefined
        : linearForPath(target, length);
    }
    if (length) {
      const literal = literalOf(tree, inner);
      if (typeof literal === "string") {
        return { terms: emptyMap(), offset: bigInteger(literal.length) };
      }
      if (kindOf(tree, inner) === SyntaxKind.ListExpr) {
        // A spread has no known length, so the literal has no linear form.
        if (
          kidsOf(tree, inner).some((kid) =>
            kindOf(tree, kid) === SyntaxKind.SpreadElement
          )
        ) {
          return undefined;
        }
        return {
          terms: emptyMap(),
          offset: bigInteger(kidsOf(tree, inner).length),
        };
      }
      const base = pathOf(inner);
      return base === undefined ? undefined : linearForPath(base, true);
    }
    return linear(inner);
  }
  function linear(node: NodeId): Linear | undefined {
    const inner = unparen(tree, node);
    if (kindOf(tree, inner) === SyntaxKind.LiteralExpr) {
      const text = nodeText(tree, inner);
      const value = literalOf(tree, inner);
      if (
        typeof value !== "number" || !Number.isSafeInteger(value) ||
        !isDecimalInteger(text)
      ) {
        return undefined;
      }
      return { terms: emptyMap(), offset: bigInteger(text) };
    }
    const path = pathOf(inner);
    if (path !== undefined && integerPath(path)) {
      return linearForPath(path, false);
    }
    if (kindOf(tree, inner) === SyntaxKind.UnaryExpr) {
      // `-e` reads as `0 - e`. `!e` gives no fact.
      const operand = kidsOf(tree, inner)[0];
      if (
        operand === undefined ||
        unaryOperatorOf(tree, inner)?.operator !== "-"
      ) {
        return undefined;
      }
      const value = linear(operand);
      return value === undefined
        ? undefined
        : addLinear({ terms: emptyMap(), offset: 0n }, value, -1n);
    }
    if (kindOf(tree, inner) !== SyntaxKind.BinaryExpr) {
      return undefined;
    }
    const operator = operatorOf(tree, inner);
    const children = kidsOf(tree, inner);
    const leftNode = children[0];
    const rightNode = children[1];
    if (
      (operator !== "+" && operator !== "-") || leftNode === undefined ||
      rightNode === undefined
    ) {
      return undefined;
    }
    const left = linear(leftNode);
    const right = linear(rightNode);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return addLinear(left, right, operator === "+" ? 1n : -1n);
  }
  function pathOf(node: NodeId): readonly string[] | undefined {
    const kind = kindOf(tree, node);
    if (kind === SyntaxKind.NameExpr || kind === SyntaxKind.Name) {
      const target = targets.get(node);
      return target?.kind === "local" && locals.has(target.id)
        ? [target.id]
        : undefined;
    }
    if (kind !== SyntaxKind.FieldExpr) {
      return undefined;
    }
    const access = memberAccessParts(tree, node);
    const base = access.base;
    const member = access.member;
    if (base === undefined || member === undefined) {
      return undefined;
    }
    const path = pathOf(unparen(tree, base));
    const name = nameTextOf(tree, member);
    return path === undefined || name === undefined
      ? undefined
      : [...path, name];
  }
  function integerPath(path: readonly string[]): boolean {
    const id = path[0];
    const fields = path.slice(1);
    if (id === undefined || !isLocalId(id)) {
      return false;
    }
    const root = locals.get(id);
    if (root === undefined) {
      return false;
    }
    let types: readonly TypeRef[] = [root];
    for (const name of fields) {
      const next: TypeRef[] = [];
      for (const type of types) {
        for (const member of flattenMembers(table, type)) {
          const node = table.node(member);
          if (node.kind !== "record") {
            return false;
          }
          const field = node.fields.find((candidate) =>
            candidate.name === name
          );
          if (field === undefined || field.optional) {
            return false;
          }
          next[next.length] = field.type;
        }
      }
      types = next;
    }
    return types.length > 0 &&
      types.every((type) =>
        flattenMembers(table, type).every((member) => {
          const node = table.node(member);
          return node.kind === "primitive"
            ? node.name === "int"
            : node.kind === "literal" && typeof node.value === "number" &&
              Number.isSafeInteger(node.value);
        })
      );
  }
  function recordField(node: NodeId, name: string): NodeId | undefined {
    if (kindOf(tree, node) !== SyntaxKind.RecordExpr) {
      return undefined;
    }
    const fields = kidsOf(tree, node);
    for (const field of fields) {
      const parts = kidsOf(tree, field);
      const label = parts.find((part) =>
        kindOf(tree, part) === SyntaxKind.Name
      );
      if (label === undefined || nameTextOf(tree, label) !== name) {
        continue;
      }
      const value = parts.find((part) => part !== label);
      return value ?? label;
    }
    return undefined;
  }
  const self: RefinementChecker = {
    snapshot: snapshot,
    restore: restore,
    leaveScope: leaveScope,
    join: join,
    addLocal: addLocal,
    addFieldLocal: addFieldLocal,
    addBranch: addBranch,
    clearDerivedFacts: clearDerivedFacts,
    condition: condition,
    matchLiteral: matchLiteral,
    prove: prove,
    proveIdentity: proveIdentity,
  };
  return self;
}
function typeAssumptionsAt(
  table: TypeTable,
  ref: TypeRef,
  path: readonly string[],
  seen: ReadonlySet<TypeRef> | undefined,
): Predicate[] {
  const visited = seen ?? emptySet<TypeRef>();
  if (visited.has(ref)) {
    return [];
  }
  const nextSeen = setFrom(visited).add(ref);
  const node = table.node(table.unfoldTransparent(ref));
  if (node.kind === "named" && isTypeId(node.id)) {
    const id = node.id;
    const assumptions: Predicate[] = [];
    const predicate = table.predicateOf(id);
    if (predicate !== undefined) {
      const compiled = substitute(
        predicate,
        (term) =>
          linearForPath([...path, ...termPath(term)], term.kind === "length"),
      );
      if (compiled !== undefined) assumptions[assumptions.length] = compiled;
    }
    const base = table.nominalBodyOf(id);
    return base === undefined
      ? assumptions
      : [...assumptions, ...typeAssumptionsAt(table, base, path, nextSeen)];
  }
  if (node.kind === "record") {
    return node.fields.flatMap((field) =>
      field.optional
        ? []
        : typeAssumptionsAt(table, field.type, [...path, field.name], nextSeen)
    );
  }
  if (
    node.kind === "array" ||
    (node.kind === "primitive" && node.name === "string") ||
    (node.kind === "literal" && typeof node.value === "string")
  ) {
    const length = linearForPath(path, true);
    const zero: Linear = { terms: emptyMap(), offset: 0n };
    const lower = difference(addLinear(zero, length, -1n), 0n);
    const upper = difference(
      addLinear(length, zero, -1n),
      bigInteger(Number.MAX_SAFE_INTEGER),
    );
    return lower === undefined || upper === undefined ? [] : [lower, upper];
  }
  return [];
}
function proofPaths(
  table: TypeTable,
  ref: TypeRef,
  prefix: readonly string[] | undefined,
  seen: ReadonlySet<TypeRef> | undefined,
): readonly {
  readonly path: readonly string[];
  readonly length: boolean;
}[] {
  const visited = seen ?? emptySet<TypeRef>();
  if (visited.has(ref)) {
    return [];
  }
  const nextSeen = setFrom(visited).add(ref);
  const path = prefix ?? [];
  const node = table.node(table.unfold(ref));
  if (node.kind === "primitive") {
    if (node.name === "int") {
      return [{ path: path, length: false }];
    }
    if (node.name === "string") {
      return [{ path: path, length: true }];
    }
    return [];
  }
  if (node.kind === "literal") {
    if (typeof node.value === "number" && Number.isSafeInteger(node.value)) {
      return [{ path: path, length: false }];
    }
    return typeof node.value === "string" ? [{ path: path, length: true }] : [];
  }
  if (node.kind === "array") {
    return [{ path: path, length: true }];
  }
  if (node.kind !== "record") {
    return [];
  }
  return node.fields.flatMap((field) =>
    field.optional
      ? []
      : proofPaths(table, field.type, [...path, field.name], nextSeen)
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
function substitute(
  predicate: Predicate,
  value: (term: Term) => Linear | undefined,
): Predicate | undefined {
  if (predicate.kind === "constant") {
    return predicate;
  }
  if (predicate.kind === "not") {
    const operand = substitute(predicate.operand, value);
    return operand === undefined ? undefined : not(operand);
  }
  if (predicate.kind === "and" || predicate.kind === "or") {
    const operands: Predicate[] = [];
    for (const item of predicate.operands) {
      const compiled = substitute(item, value);
      if (compiled === undefined) {
        return undefined;
      }
      operands[operands.length] = compiled;
    }
    return predicate.kind === "and"
      ? canonicalAnd(operands)
      : canonicalPredicate({ kind: "or", operands: operands });
  }
  if (predicate.kind === "difference") {
    const left: Linear | undefined = predicate.left.kind === "zero"
      ? { terms: emptyMap(), offset: 0n }
      : value(predicate.left);
    const right: Linear | undefined = predicate.right.kind === "zero"
      ? { terms: emptyMap(), offset: 0n }
      : value(predicate.right);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return difference(
      addLinear(left, right, -1n),
      bigInteger(predicate.maximum),
    );
  }
}
function difference(linear: Linear, maximum: bigint): Predicate | undefined {
  const shape = differenceShape(linear);
  if (shape === undefined) {
    return undefined;
  }
  if (shape.constant) {
    return { kind: "constant", value: linear.offset <= maximum };
  }
  return {
    kind: "difference",
    left: shape.positive,
    right: shape.negative,
    maximum: (maximum - linear.offset).toString(),
  };
}
function compare(
  left: Linear,
  operator: ComparisonOperator,
  right: Linear,
): Predicate | undefined {
  const forward = addLinear(left, right, -1n);
  const reverse = addLinear(right, left, -1n);
  const comparison = COMPARISON_BOUNDS[operator];
  const join = comparison.join;
  const parts = comparison.parts;
  const bounds = parts.map((part) =>
    difference(part.reversed ? reverse : forward, part.slack)
  );
  const defined: Predicate[] = [];
  for (const bound of bounds) {
    if (bound === undefined) {
      return undefined;
    }
    defined[defined.length] = bound;
  }
  if (join === "single") {
    return defined[0];
  }
  if (join === "and") {
    return canonicalAnd(defined);
  }
  if (join === "or") {
    return canonicalPredicate({ kind: "or", operands: defined });
  }
}
function canonicalPredicate(predicate: Predicate): Predicate {
  if (predicate.kind === "and") {
    return canonicalAnd(predicate.operands);
  }
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
  function add(predicate: Predicate): Predicate[] {
    if (predicate.kind === "and") {
      for (const operand of predicate.operands) flat = add(operand);
      return flat;
    }
    const canonical = canonicalPredicate(predicate);
    if (canonical.kind === "constant" && canonical.value) return flat;
    if (canonical.kind === "and") {
      for (const operand of canonical.operands) flat = add(operand);
    } else flat[flat.length] = canonical;
    return flat;
  }
  for (const predicate of predicates) flat = add(predicate);
  if (
    flat.some((predicate) => predicate.kind === "constant" && !predicate.value)
  ) {
    return { kind: "constant", value: false };
  }
  flat = flat.sort(compareJson);
  if (flat.length === 0) return { kind: "constant", value: true };
  return flat.length === 1 ? flat[0] : { kind: "and", operands: flat };
}

function isDecimalInteger(text: string): boolean {
  for (const char of text) {
    if (char < "0" || char > "9") return false;
  }
  return text.length > 0;
}

function compareJson(left: Predicate, right: Predicate): number {
  return compareText(JSON.stringify(left), JSON.stringify(right));
}
function withinScope(
  predicate: Predicate,
  known: ReadonlySet<string>,
): boolean {
  if (predicate.kind === "constant") {
    return true;
  }
  if (predicate.kind === "difference") {
    return [predicate.left, predicate.right].every((term) => {
      const path = termPath(term);
      return path.length === 0 || known.has(path[0]);
    });
  }
  if (predicate.kind === "not") {
    return withinScope(predicate.operand, known);
  }
  return predicate.operands.every((part) => withinScope(part, known));
}
