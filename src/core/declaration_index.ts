// The declaration index of one file. It lists each top-level declaration by name
// with its kind, export flag, spans, and methods.

import { TokenKind } from "./lex.ts";
import type { Span } from "./source.ts";
import {
  hasModifier,
  kidsOf,
  nameTextOf,
  tokenKindOf,
} from "./syntax_queries.ts";
import {
  childrenOf,
  decodeString,
  hasProblem,
  kindOf,
  type NodeId,
  nodeSpan,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";

type DeclKind = "type" | "error" | "service" | "provider" | "const";

export interface MethodEntry {
  readonly name: string;
  /** The ServiceMethod node. */
  readonly node: NodeId;
  readonly nameNode: NodeId;
  readonly nameSpan: Span;
  readonly span: Span;
}

export interface DeclEntry {
  readonly name: string;
  readonly kind: DeclKind;
  readonly exported: boolean;
  /** True only for a `sealed type` declaration. */
  readonly sealed: boolean;
  readonly node: NodeId;
  readonly nameNode: NodeId;
  readonly nameSpan: Span;
  readonly span: Span;
  /** Methods by name. The first method wins when a name repeats. Empty unless a service. */
  readonly methods: ReadonlyMap<string, MethodEntry>;
  /** Every method in source order, including repeated names. */
  readonly methodList: readonly MethodEntry[];
  /** True for a const whose value is an arrow expression. */
  readonly isArrow: boolean;
  /** True when the declaration contains an Error or Missing node. */
  readonly broken: boolean;
}

interface ImportName {
  readonly name: string;
  readonly node: NodeId;
  readonly span: Span;
}

export type ImportRole = "ordinary" | "service";

export interface ImportEntry {
  readonly role: ImportRole;
  readonly node: NodeId;
  readonly span: Span;
  /** The decoded specifier string, or undefined when the string is absent or broken. */
  readonly specifier: string | undefined;
  readonly specifierSpan: Span | undefined;
  readonly names: readonly ImportName[];
}

export interface FileIndex {
  /** Every declaration whose name parsed, in source order. */
  readonly decls: readonly DeclEntry[];
  /** The first declaration for each name. Later declarations of the name are duplicates. */
  readonly byName: ReadonlyMap<string, DeclEntry>;
  readonly imports: readonly ImportEntry[];
}

function firstChildOfKind(
  tree: SyntaxTree,
  node: NodeId,
  kind: SyntaxKind,
): NodeId | undefined {
  for (const child of childrenOf(tree, node)) {
    if (kindOf(tree, child) === kind) return child;
  }
  return undefined;
}

/**
 * True for a const whose first value node after `=` is an arrow expression. A
 * const with no `=` or no value is not an arrow. A broken arrow still counts.
 */
function isArrowConst(tree: SyntaxTree, decl: NodeId): boolean {
  const children = childrenOf(tree, decl);
  const eq = children.findIndex((c) => tokenKindOf(tree, c) === TokenKind.Eq);
  if (eq < 0) return false;
  const value = children.slice(eq + 1).find((c) => {
    const kind = kindOf(tree, c);
    return kind !== SyntaxKind.Token && kind !== SyntaxKind.Missing;
  });
  return value !== undefined && kindOf(tree, value) === SyntaxKind.ArrowExpr;
}

const DECL_KINDS: ReadonlyMap<SyntaxKind, DeclKind> = new Map([
  [SyntaxKind.TypeDecl, "type"],
  [SyntaxKind.ErrorDecl, "error"],
  [SyntaxKind.ServiceDecl, "service"],
  [SyntaxKind.ProviderDecl, "provider"],
  [SyntaxKind.ConstDecl, "const"],
]);

function indexMethods(tree: SyntaxTree, service: NodeId): MethodEntry[] {
  const methods: MethodEntry[] = [];
  for (const child of childrenOf(tree, service)) {
    if (kindOf(tree, child) !== SyntaxKind.ServiceMethod) continue;
    const nameNode = firstChildOfKind(tree, child, SyntaxKind.Name);
    if (nameNode === undefined) continue;
    const name = nameTextOf(tree, nameNode);
    if (name === undefined) continue;
    methods.push({
      name,
      node: child,
      nameNode,
      nameSpan: nodeSpan(tree, nameNode),
      span: nodeSpan(tree, child),
    });
  }
  return methods;
}

function indexDecl(
  tree: SyntaxTree,
  decl: NodeId,
  kind: DeclKind,
): DeclEntry | undefined {
  const nameNode = firstChildOfKind(tree, decl, SyntaxKind.Name);
  if (nameNode === undefined) return undefined;
  const name = nameTextOf(tree, nameNode);
  if (name === undefined) return undefined;
  const children = childrenOf(tree, decl);
  const exported = tokenKindOf(tree, children[0]) === TokenKind.KwExport;
  const sealed = kind === "type" && hasModifier(tree, decl, "sealed");
  const span = nodeSpan(tree, decl);
  const methodList = kind === "service" ? indexMethods(tree, decl) : [];
  const methods = new Map<string, MethodEntry>();
  for (const method of methodList) {
    if (!methods.has(method.name)) methods.set(method.name, method);
  }
  return {
    name,
    kind,
    exported,
    sealed,
    node: decl,
    nameNode,
    nameSpan: nodeSpan(tree, nameNode),
    span,
    methods,
    methodList,
    isArrow: kind === "const" && isArrowConst(tree, decl),
    broken: hasProblem(tree, decl),
  };
}

function indexImport(tree: SyntaxTree, node: NodeId): ImportEntry {
  const children = childrenOf(tree, node);
  const names: ImportName[] = [];
  let specifier: string | undefined;
  let specifierSpan: Span | undefined;
  for (const child of children) {
    const kind = kindOf(tree, child);
    if (kind === SyntaxKind.Name) {
      const name = nameTextOf(tree, child);
      if (name !== undefined) {
        names.push({ name, node: child, span: nodeSpan(tree, child) });
      }
    } else if (tokenKindOf(tree, child) === TokenKind.String) {
      specifierSpan = nodeSpan(tree, child);
      specifier = decodeString(
        tree.text.slice(tree.starts[child], tree.ends[child]),
      );
    }
  }
  return {
    role: hasModifier(tree, node, "imports") ? "service" : "ordinary",
    node,
    span: nodeSpan(tree, node),
    specifier,
    specifierSpan,
    names,
  };
}

export function buildIndex(tree: SyntaxTree): FileIndex {
  const decls: DeclEntry[] = [];
  const byName = new Map<string, DeclEntry>();
  const imports: ImportEntry[] = [];
  for (const child of kidsOf(tree, tree.root)) {
    const kind = kindOf(tree, child);
    if (kind === SyntaxKind.ImportDecl) {
      imports.push(indexImport(tree, child));
      continue;
    }
    const declKind = DECL_KINDS.get(kind);
    if (declKind === undefined) continue;
    const entry = indexDecl(tree, child, declKind);
    if (entry === undefined) continue;
    decls.push(entry);
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return { decls, byName, imports };
}
