// Syntax queries shared by indexing, checking and lowering. They depend only
// on the lossless tree and lexer, never on checker state or inferred types.

import {
  type ContextualWord,
  isDurationText,
  numberValue,
  TokenKind,
} from "./lex.ts";
import {
  childrenOf,
  decodeString,
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";

const TYPE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.NamedType,
  SyntaxKind.EffectType,
  SyntaxKind.StreamType,
  SyntaxKind.SinkType,
  SyntaxKind.SchemaType,
  SyntaxKind.LayerType,
  SyntaxKind.LiteralType,
  SyntaxKind.RecordType,
  SyntaxKind.TupleType,
  SyntaxKind.ArrayType,
  SyntaxKind.UnionType,
  SyntaxKind.FunctionType,
  SyntaxKind.ParenType,
]);

export function isTypeKind(kind: SyntaxKind): boolean {
  return TYPE_KINDS.has(kind);
}

/** The lexer kind of a Token node, or undefined for any other node. */
export function tokenKindOf(
  tree: SyntaxTree,
  node: NodeId,
): TokenKind | undefined {
  return kindOf(tree, node) === SyntaxKind.Token
    ? tree.lexed.kinds[tree.tokens[node]] as TokenKind
    : undefined;
}

function isWordToken(
  tree: SyntaxTree,
  node: NodeId | undefined,
  word: ContextualWord,
): boolean {
  return node !== undefined && tokenKindOf(tree, node) === TokenKind.Ident &&
    tree.text.slice(tree.starts[node], tree.ends[node]) === word;
}

/** The index of the leading word child of a node: the first child, or the one after `export`. */
function headIndex(tree: SyntaxTree, children: Uint32Array): number {
  return tokenKindOf(tree, children[0]) === TokenKind.KwExport ? 1 : 0;
}

/**
 * True when the parser wrote the contextual modifier `word` as the leading
 * word token of `node`: the first child, or the one after `export`. The check
 * reads the word token the parser wrote, and nothing else about the node.
 */
export function hasModifier(
  tree: SyntaxTree,
  node: NodeId,
  word: ContextualWord,
): boolean {
  const children = childrenOf(tree, node);
  return isWordToken(tree, children[headIndex(tree, children)], word);
}

/**
 * True for `opaque type`: the leading word token `opaque` is followed by the
 * word token `type`. After `opaque` without `type`, the parser writes a Missing
 * node and the declaration is not opaque.
 */
export function isOpaqueTypeDecl(tree: SyntaxTree, decl: NodeId): boolean {
  const children = childrenOf(tree, decl);
  const head = headIndex(tree, children);
  return isWordToken(tree, children[head], "opaque") &&
    isWordToken(tree, children[head + 1], "type");
}

/** The text of a Name node, or undefined when the parser did not read an identifier. */
export function nameTextOf(
  tree: SyntaxTree,
  nameNode: NodeId,
): string | undefined {
  const first = childrenOf(tree, nameNode)[0];
  if (first === undefined || tokenKindOf(tree, first) !== TokenKind.Ident) {
    return undefined;
  }
  return tree.text.slice(tree.starts[first], tree.ends[first]);
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

/** The operators of the arithmetic class: `+ - * /`. */
export type ArithmeticOperator = "+" | "-" | "*" | "/";

export function isArithmeticOperator(
  operator: BinaryOperator | undefined,
): operator is ArithmeticOperator {
  return operator === "+" || operator === "-" || operator === "*" ||
    operator === "/";
}

const OPERATORS: ReadonlyMap<TokenKind, BinaryOperator> = new Map([
  [TokenKind.Plus, "+"],
  [TokenKind.Minus, "-"],
  [TokenKind.Star, "*"],
  [TokenKind.Slash, "/"],
  [TokenKind.EqEqEq, "==="],
  [TokenKind.BangEqEq, "!=="],
  [TokenKind.Lt, "<"],
  [TokenKind.LtEq, "<="],
  [TokenKind.Gt, ">"],
  [TokenKind.GtEq, ">="],
  [TokenKind.AmpAmp, "&&"],
  [TokenKind.PipePipe, "||"],
]);

/** Child nodes of a node that are not tokens or Missing nodes. */
export function kidsOf(tree: SyntaxTree, node: NodeId): NodeId[] {
  const result: NodeId[] = [];
  for (const child of childrenOf(tree, node)) {
    const kind = kindOf(tree, child);
    if (kind !== SyntaxKind.Token && kind !== SyntaxKind.Missing) {
      result.push(child);
    }
  }
  return result;
}

/** Child nodes of a node that have the given kind. */
export function kidsOfKind(
  tree: SyntaxTree,
  node: NodeId,
  kind: SyntaxKind,
): NodeId[] {
  return kidsOf(tree, node).filter((k) => kindOf(tree, k) === kind);
}

/**
 * Strips nested parenthesis expressions. A parenthesis without an inner node,
 * such as `(` with a Missing child, stays as the result.
 */
export function unparen(tree: SyntaxTree, node: NodeId): NodeId {
  let current = node;
  while (kindOf(tree, current) === SyntaxKind.ParenExpr) {
    const inner = kidsOf(tree, current)[0];
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

/** The source text of the Number token of a literal node, if it has one. */
export function numberTextOf(
  tree: SyntaxTree,
  node: NodeId,
): string | undefined {
  for (const child of childrenOf(tree, node)) {
    if (kindOf(tree, child) !== SyntaxKind.Token) continue;
    if (tree.lexed.kinds[tree.tokens[child]] !== TokenKind.Number) continue;
    return nodeText(tree, child);
  }
  return undefined;
}

/** True when the literal node is a Number token with a duration suffix. */
export function isDurationLiteral(tree: SyntaxTree, node: NodeId): boolean {
  const text = numberTextOf(tree, node);
  return text !== undefined && isDurationText(text);
}

export function literalOf(
  tree: SyntaxTree,
  node: NodeId,
): string | number | boolean | null | undefined {
  for (const child of childrenOf(tree, node)) {
    if (kindOf(tree, child) !== SyntaxKind.Token) continue;
    const kind = tree.lexed.kinds[tree.tokens[child]] as TokenKind;
    const text = nodeText(tree, child);
    if (kind === TokenKind.String) return decodeString(text);
    if (kind === TokenKind.Number) {
      const value = numberValue(text);
      return Number.isFinite(value) ? value : undefined;
    }
    if (kind === TokenKind.KwTrue) return true;
    if (kind === TokenKind.KwFalse) return false;
    if (kind === TokenKind.KwNull) return null;
  }
  return undefined;
}

export function operatorOf(
  tree: SyntaxTree,
  node: NodeId,
): BinaryOperator | undefined {
  for (const child of childrenOf(tree, node)) {
    if (kindOf(tree, child) !== SyntaxKind.Token) continue;
    const kind = tree.lexed.kinds[tree.tokens[child]] as TokenKind;
    const operator = OPERATORS.get(kind);
    if (operator !== undefined) return operator;
  }
  return undefined;
}

/** The last arrow child outside its parameters, clauses and result type. */
export function arrowBody(tree: SyntaxTree, node: NodeId): NodeId | undefined {
  return kidsOf(tree, node).filter((child) => {
    const kind = kindOf(tree, child);
    return kind !== SyntaxKind.ParamList && kind !== SyntaxKind.FailsClause &&
      kind !== SyntaxKind.WithClause && !isTypeKind(kind);
  }).pop();
}

/**
 * The parts of a function-shaped node (an arrow, a function type, a method, a
 * signature): its parameter list, its first type child, and its `fails` and
 * `with` clauses. Each part is undefined when the parser wrote none.
 */
export interface FunctionParts {
  readonly paramList: NodeId | undefined;
  readonly result: NodeId | undefined;
  readonly fails: NodeId | undefined;
  readonly uses: NodeId | undefined;
}

export function functionParts(tree: SyntaxTree, node: NodeId): FunctionParts {
  const kids = kidsOf(tree, node);
  const first = (kind: SyntaxKind): NodeId | undefined =>
    kids.find((kid) => kindOf(tree, kid) === kind);
  return {
    paramList: first(SyntaxKind.ParamList),
    result: kids.find((kid) => isTypeKind(kindOf(tree, kid))),
    fails: first(SyntaxKind.FailsClause),
    uses: first(SyntaxKind.WithClause),
  };
}

/** The Param nodes of a parameter list, or none when the list is absent. */
export function paramNodes(
  tree: SyntaxTree,
  paramList: NodeId | undefined,
): NodeId[] {
  return paramList === undefined
    ? []
    : kidsOf(tree, paramList).filter((kid) =>
      kindOf(tree, kid) === SyntaxKind.Param
    );
}

/** The name node and the first other child (the written type) of a Param node. */
export interface ParamParts {
  readonly name: NodeId | undefined;
  readonly type: NodeId | undefined;
}

export function paramParts(tree: SyntaxTree, param: NodeId): ParamParts {
  const pieces = kidsOf(tree, param);
  const name = pieces.find((piece) => kindOf(tree, piece) === SyntaxKind.Name);
  return { name, type: pieces.find((piece) => piece !== name) };
}

/** The base expression and the member Name node of a FieldExpr. */
export interface MemberAccessParts {
  readonly base: NodeId | undefined;
  readonly member: NodeId | undefined;
}

export function memberAccessParts(
  tree: SyntaxTree,
  node: NodeId,
): MemberAccessParts {
  const kids = kidsOf(tree, node);
  return {
    base: kids[0],
    member: kids.find((kid, index) =>
      index > 0 && kindOf(tree, kid) === SyntaxKind.Name
    ),
  };
}

/** The label, label node, and value node of a record field. The value is absent in a shorthand field. */
export interface RecordFieldParts {
  readonly label: string;
  readonly labelNode: NodeId;
  readonly value: NodeId | undefined;
}

/** Undefined when the node is not a RecordField or ShorthandField, or its label has no identifier. */
export function recordFieldParts(
  tree: SyntaxTree,
  field: NodeId,
): RecordFieldParts | undefined {
  const kind = kindOf(tree, field);
  if (kind !== SyntaxKind.RecordField && kind !== SyntaxKind.ShorthandField) {
    return undefined;
  }
  const kids = kidsOf(tree, field);
  const labelNode = kids.find((kid) => kindOf(tree, kid) === SyntaxKind.Name);
  if (labelNode === undefined) return undefined;
  const label = nameTextOf(tree, labelNode);
  if (label === undefined) return undefined;
  return {
    label,
    labelNode,
    value: kind === SyntaxKind.ShorthandField
      ? undefined
      : kids.find((kid) => kid !== labelNode),
  };
}

/** The argument nodes of the first ArgList child of a call or a pipe stage. */
export function argNodes(tree: SyntaxTree, node: NodeId): NodeId[] {
  const list = kidsOf(tree, node).find((kid) =>
    kindOf(tree, kid) === SyntaxKind.ArgList
  );
  return list === undefined ? [] : kidsOf(tree, list);
}

/** The left value of a PipeExpr and its first PipeStage child. */
export interface PipeParts {
  readonly left: NodeId | undefined;
  readonly stage: NodeId | undefined;
}

export function pipeParts(tree: SyntaxTree, node: NodeId): PipeParts {
  const kids = kidsOf(tree, node);
  return {
    left: kids[0],
    stage: kids.find((kid) => kindOf(tree, kid) === SyntaxKind.PipeStage),
  };
}

/** The qualified callee name of a PipeStage and its written arguments. The left value is not among them. */
export interface StageParts {
  readonly callee: NodeId | undefined;
  readonly args: NodeId[];
}

export function stageParts(tree: SyntaxTree, stage: NodeId): StageParts {
  return {
    callee: kidsOf(tree, stage).find((kid) =>
      kindOf(tree, kid) === SyntaxKind.QualifiedName
    ),
    args: argNodes(tree, stage),
  };
}

/** The last declaration child outside its binding name and type annotation. */
export function initOf(
  tree: SyntaxTree,
  node: NodeId,
  nameNode: NodeId | undefined,
): NodeId | undefined {
  return kidsOf(tree, node).filter((child) =>
    child !== nameNode && !isTypeKind(kindOf(tree, child))
  ).pop();
}

const PATTERN_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.WildcardPattern,
  SyntaxKind.LiteralPattern,
  SyntaxKind.NamePattern,
  SyntaxKind.CtorPattern,
  SyntaxKind.RecordPattern,
]);

export function isPatternKind(kind: SyntaxKind): boolean {
  return PATTERN_KINDS.has(kind);
}
