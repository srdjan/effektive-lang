import type { Result, Span } from "./ir.ts";
import {
  and,
  comparison,
  constant,
  or,
  type Predicate,
  type Term,
} from "./predicates.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import { arrowBody, kidsOf, nameTextOf, operatorOf } from "./syntax_queries.ts";
import type { TypeRef, TypeTable } from "./types.ts";

interface PredicateSourceError {
  readonly message: string;
  readonly span: Span;
}

interface LinearTerm {
  readonly term: Term;
  readonly coefficient: bigint;
}

interface Linear {
  readonly terms: ReadonlyMap<string, LinearTerm>;
  readonly offset: bigint;
}

interface Context {
  readonly tree: SyntaxTree;
  readonly table: TypeTable;
  readonly inputName: string;
  readonly inputType: TypeRef;
}

/** Compiles one contextual `where` clause into its normalized predicate. */
export function predicateFromSource(
  tree: SyntaxTree,
  clause: NodeId,
  table: TypeTable,
  inputType: TypeRef,
): Result<Predicate, PredicateSourceError> {
  const arrow = kidsOf(tree, clause).find((node) =>
    kindOf(tree, node) === SyntaxKind.ArrowExpr
  );
  if (arrow === undefined) {
    return fail(tree, clause, "a refinement needs one predicate function");
  }
  const paramList = kidsOf(tree, arrow).find((node) =>
    kindOf(tree, node) === SyntaxKind.ParamList
  );
  const parameters = paramList === undefined
    ? []
    : kidsOf(tree, paramList).filter((node) =>
      kindOf(tree, node) === SyntaxKind.Param
    );
  if (parameters.length !== 1) {
    return fail(tree, arrow, "a refinement predicate needs one parameter");
  }
  const parameterParts = kidsOf(tree, parameters[0]);
  const nameNode = parameterParts.find((node) =>
    kindOf(tree, node) === SyntaxKind.Name
  );
  const inputName = nameNode === undefined
    ? undefined
    : nameTextOf(tree, nameNode);
  if (inputName === undefined || parameterParts.length !== 1) {
    return fail(
      tree,
      parameters[0],
      "a refinement parameter must be one unannotated name",
    );
  }
  const body = arrowBody(tree, arrow);
  if (body === undefined) {
    return fail(tree, arrow, "a refinement predicate needs a body");
  }
  return compilePredicate({ tree, table, inputName, inputType }, body);
}

function compilePredicate(
  context: Context,
  node: NodeId,
): Result<Predicate, PredicateSourceError> {
  const inner = unwrap(context.tree, node);
  const kind = kindOf(context.tree, inner);
  if (kind === SyntaxKind.LiteralExpr) {
    const text = nodeText(context.tree, inner);
    if (text === "true") return { ok: true, value: constant(true) };
    if (text === "false") return { ok: true, value: constant(false) };
  }
  if (kind !== SyntaxKind.BinaryExpr) {
    return fail(
      context.tree,
      inner,
      "a refinement supports Boolean connectives and integer comparisons",
    );
  }
  const operator = operatorOf(context.tree, inner);
  const operands = kidsOf(context.tree, inner);
  if (operands.length !== 2 || operator === undefined) {
    return fail(context.tree, inner, "the refinement expression is incomplete");
  }
  if (operator === "&&" || operator === "||") {
    const left = compilePredicate(context, operands[0]);
    if (!left.ok) return left;
    const right = compilePredicate(context, operands[1]);
    if (!right.ok) return right;
    return {
      ok: true,
      value: operator === "&&"
        ? and(left.value, right.value)
        : or(left.value, right.value),
    };
  }
  if (
    operator !== "<" && operator !== "<=" && operator !== "===" &&
    operator !== "!==" && operator !== ">=" && operator !== ">"
  ) {
    return fail(
      context.tree,
      inner,
      "a refinement comparison supports only integer addition and subtraction",
    );
  }
  const left = compileLinear(context, operands[0]);
  if (!left.ok) return left;
  const right = compileLinear(context, operands[1]);
  if (!right.ok) return right;
  return compareLinear(context.tree, inner, left.value, operator, right.value);
}

function compareLinear(
  tree: SyntaxTree,
  node: NodeId,
  left: Linear,
  operator: "<" | "<=" | "===" | "!==" | ">=" | ">",
  right: Linear,
): Result<Predicate, PredicateSourceError> {
  const terms = new Map<string, LinearTerm>();
  mergeTerms(terms, left.terms, 1n);
  mergeTerms(terms, right.terms, -1n);
  const nonzero = [...terms.values()].filter((item) => item.coefficient !== 0n);
  if (
    nonzero.length > 2 ||
    nonzero.filter((item) => item.coefficient > 0n).length > 1 ||
    nonzero.filter((item) => item.coefficient < 0n).length > 1 ||
    nonzero.some((item) => item.coefficient !== 1n && item.coefficient !== -1n)
  ) {
    return fail(tree, node, "the comparison is not a difference constraint");
  }
  const positive = nonzero.find((item) => item.coefficient === 1n)?.term ?? {
    kind: "zero" as const,
  };
  const negative = nonzero.find((item) => item.coefficient === -1n)?.term ?? {
    kind: "zero" as const,
  };
  const result = comparison(
    positive,
    (left.offset - right.offset).toString(),
    operator,
    negative,
    "0",
  );
  return result.ok
    ? result
    : fail(tree, node, "the integer comparison is not supported");
}

function compileLinear(
  context: Context,
  node: NodeId,
): Result<Linear, PredicateSourceError> {
  const inner = unwrap(context.tree, node);
  if (kindOf(context.tree, inner) === SyntaxKind.LiteralExpr) {
    const text = nodeText(context.tree, inner);
    if (!/^[0-9]+$/.test(text)) {
      return fail(context.tree, inner, "a refinement needs integer literals");
    }
    return { ok: true, value: { terms: new Map(), offset: BigInt(text) } };
  }
  if (kindOf(context.tree, inner) === SyntaxKind.BinaryExpr) {
    const operator = operatorOf(context.tree, inner);
    const operands = kidsOf(context.tree, inner);
    if (
      operands.length !== 2 || (operator !== "+" && operator !== "-")
    ) {
      return fail(
        context.tree,
        inner,
        "a refinement integer expression supports only `+` and `-`",
      );
    }
    const left = compileLinear(context, operands[0]);
    if (!left.ok) return left;
    const right = compileLinear(context, operands[1]);
    if (!right.ok) return right;
    const terms = new Map<string, LinearTerm>();
    mergeTerms(terms, left.value.terms, 1n);
    mergeTerms(terms, right.value.terms, operator === "+" ? 1n : -1n);
    return {
      ok: true,
      value: {
        terms,
        offset: left.value.offset +
          (operator === "+" ? right.value.offset : -right.value.offset),
      },
    };
  }
  const term = compileTerm(context, inner);
  return term.ok
    ? {
      ok: true,
      value: {
        terms: new Map([[termKey(term.value), {
          term: term.value,
          coefficient: 1n,
        }]]),
        offset: 0n,
      },
    }
    : term;
}

function compileTerm(
  context: Context,
  node: NodeId,
): Result<Term, PredicateSourceError> {
  if (kindOf(context.tree, node) === SyntaxKind.CallExpr) {
    return compileLength(context, node);
  }
  const path = pathOf(context.tree, node, context.inputName);
  if (!path.ok) return path;
  const type = typeAtPath(context, path.value, node);
  if (!type.ok) return type;
  if (!isInteger(context.table, type.value)) {
    return fail(context.tree, node, "a compared value must have type `int`");
  }
  return {
    ok: true,
    value: path.value.length === 0
      ? { kind: "input" }
      : { kind: "field", path: path.value },
  };
}

function compileLength(
  context: Context,
  node: NodeId,
): Result<Term, PredicateSourceError> {
  const parts = kidsOf(context.tree, node);
  const callee = parts[0];
  const args = parts[1];
  if (
    callee === undefined || args === undefined ||
    kindOf(context.tree, callee) !== SyntaxKind.NameExpr ||
    nodeText(context.tree, callee) !== "len"
  ) {
    return fail(
      context.tree,
      node,
      "a refinement supports only the `len` call",
    );
  }
  const arguments_ = kidsOf(context.tree, args);
  if (arguments_.length !== 1) {
    return fail(context.tree, node, "`len` needs one input or field path");
  }
  const path = pathOf(context.tree, arguments_[0], context.inputName);
  if (!path.ok) return path;
  const type = typeAtPath(context, path.value, arguments_[0]);
  if (!type.ok) return type;
  if (!hasLength(context.table, type.value)) {
    return fail(context.tree, arguments_[0], "`len` needs a string or array");
  }
  return {
    ok: true,
    value: { kind: "length", path: path.value, unit: "utf16" },
  };
}

function pathOf(
  tree: SyntaxTree,
  node: NodeId,
  inputName: string,
): Result<readonly string[], PredicateSourceError> {
  const inner = unwrap(tree, node);
  if (kindOf(tree, inner) === SyntaxKind.NameExpr) {
    return nodeText(tree, inner) === inputName
      ? { ok: true, value: [] }
      : fail(tree, inner, "a refinement can read only its input parameter");
  }
  if (kindOf(tree, inner) !== SyntaxKind.FieldExpr) {
    return fail(tree, inner, "a refinement term must be an input field path");
  }
  const parts = kidsOf(tree, inner);
  const base = parts[0];
  const fieldNode = parts[1];
  const field = fieldNode === undefined
    ? undefined
    : nameTextOf(tree, fieldNode);
  if (base === undefined || field === undefined) {
    return fail(tree, inner, "the refinement field path is incomplete");
  }
  const prefix = pathOf(tree, base, inputName);
  return prefix.ok ? { ok: true, value: [...prefix.value, field] } : prefix;
}

function typeAtPath(
  context: Context,
  path: readonly string[],
  node: NodeId,
): Result<TypeRef, PredicateSourceError> {
  let current = context.inputType;
  for (const name of path) {
    const type = context.table.node(context.table.unfold(current));
    if (type.kind !== "record") {
      return fail(
        context.tree,
        node,
        `the path reaches non-record field \`${name}\``,
      );
    }
    const field = type.fields.find((candidate) => candidate.name === name);
    if (field === undefined) {
      return fail(context.tree, node, `the input has no field \`${name}\``);
    }
    if (field.optional) {
      return fail(context.tree, node, `the field \`${name}\` must be required`);
    }
    current = field.type;
  }
  return { ok: true, value: current };
}

function isInteger(table: TypeTable, ref: TypeRef): boolean {
  const node = table.node(table.unfold(ref));
  if (node.kind === "primitive") return node.name === "int";
  if (node.kind === "literal") {
    return typeof node.value === "number" && Number.isSafeInteger(node.value);
  }
  return node.kind === "union" &&
    node.members.every((member) => isInteger(table, member));
}

function hasLength(table: TypeTable, ref: TypeRef): boolean {
  const node = table.node(table.unfold(ref));
  if (node.kind === "array") return true;
  if (node.kind === "primitive") return node.name === "string";
  if (node.kind === "literal") return typeof node.value === "string";
  return node.kind === "union" &&
    node.members.every((member) => hasLength(table, member));
}

function mergeTerms(
  target: Map<string, LinearTerm>,
  source: ReadonlyMap<string, LinearTerm>,
  scale: bigint,
): void {
  for (const [key, item] of source) {
    const coefficient = (target.get(key)?.coefficient ?? 0n) +
      item.coefficient * scale;
    target.set(key, { term: item.term, coefficient });
  }
}

function termKey(term: Term): string {
  switch (term.kind) {
    case "zero":
    case "input":
      return term.kind;
    case "field":
      return `field:${term.path.join(".")}`;
    case "length":
      return `length:${term.path.join(".")}:${term.unit}`;
  }
}

function unwrap(tree: SyntaxTree, node: NodeId): NodeId {
  let current = node;
  while (kindOf(tree, current) === SyntaxKind.ParenExpr) {
    const inner = kidsOf(tree, current)[0];
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

function fail<T>(
  tree: SyntaxTree,
  node: NodeId,
  message: string,
): Result<T, PredicateSourceError> {
  return { ok: false, error: { message, span: nodeSpan(tree, node) } };
}
