import { isErrorId, isTypeId } from "./ids.ts";
import { TokenKind } from "./lex.ts";
import type { Revision } from "./db.ts";
import { declarationOf, occurrenceAt, symbolIndex } from "./editor_index.ts";
import { isTypeKind, kidsOf, nameTextOf } from "./syntax_queries.ts";
import {
  BUILTIN_TYPE_NAMES,
  EFFECT_ERROR_IDS,
  PRELUDE_NAMES,
} from "./resolve.ts";
import type { Span } from "./source.ts";
import {
  kindOf,
  type NodeId,
  SyntaxKind,
  type SyntaxTree,
  TYPE_WORDS,
} from "./syntax.ts";
import type { TypeRef } from "./types.ts";

export interface Completion {
  readonly label: string;
  readonly kind:
    | "variable"
    | "function"
    | "type"
    | "class"
    | "interface"
    | "method"
    | "property"
    | "keyword";
  readonly span: Span;
}

function containingNode(tree: SyntaxTree, offset: number): NodeId {
  let best = tree.root;
  for (let n = 0; n < tree.count; n++) {
    if (
      tree.starts[n] <= offset && offset <= tree.ends[n] &&
      tree.ends[n] - tree.starts[n] <= tree.ends[best] - tree.starts[best]
    ) best = n;
  }
  return best;
}

function recordFields(
  revision: Revision,
  ref: TypeRef,
  seen = new Set<TypeRef>(),
): readonly string[] {
  if (seen.has(ref)) return [];
  const table = revision.types;
  const node = table.node(ref);
  if (node.kind === "record") return node.fields.map((f) => f.name);
  if (node.kind === "named") {
    const target = isTypeId(node.id)
      ? table.aliasOf(node.id) ?? table.dataRecordOf(node.id)
      : isErrorId(node.id)
      ? table.errorRecordOf(node.id)
      : undefined;
    return target === undefined
      ? []
      : recordFields(revision, target, new Set([...seen, ref]));
  }
  if (node.kind === "union") {
    const fields = node.members.map((t) =>
      recordFields(revision, t, new Set([...seen, ref]))
    );
    return (fields[0] ?? []).filter((name) =>
      fields.every((f) => f.includes(name))
    );
  }
  return [];
}

/** What each position kind needs: the word under the cursor and its builders. */
interface Site {
  readonly revision: Revision;
  readonly path: string;
  readonly offset: number;
  readonly module: string;
  readonly tree: SyntaxTree;
  /** The start of the word under the cursor. */
  readonly start: number;
  readonly make: (label: string, kind: Completion["kind"]) => Completion;
  /** Keeps the labels that start with the typed prefix, sorted. */
  readonly filter: (values: readonly Completion[]) => Completion[];
}

/** A comment/string is never a code-completion context. */
function insideCommentOrString(tree: SyntaxTree, offset: number): boolean {
  const { lexed } = tree;
  return [...lexed.trivia.starts].some((start, i) =>
    start <= offset && offset < lexed.trivia.ends[i] &&
    lexed.trivia.kinds[i] !== 0
  ) ||
    [...lexed.starts].some((start, i) =>
      start < offset && offset <= lexed.ends[i] &&
      lexed.kinds[i] === TokenKind.String
    );
}

/** The word under the cursor, with the span that a completion replaces. */
function siteAt(
  revision: Revision,
  path: string,
  offset: number,
  module: string,
  tree: SyntaxTree,
): Site {
  const text = tree.text;
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
  const prefix = text.slice(start, offset);
  let end = offset;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
  const span = { source: path, start, end };
  return {
    revision,
    path,
    offset,
    module,
    tree,
    start,
    make: (label, kind) => ({ label, kind, span }),
    filter: (values) =>
      values.filter((v) => v.label.startsWith(prefix)).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
  };
}

/** The record binding that holds the offset, or -1. */
function recordBindingAt(tree: SyntaxTree, offset: number): NodeId {
  let bindingNode = containingNode(tree, offset);
  while (
    bindingNode >= 0 && kindOf(tree, bindingNode) !== SyntaxKind.RecordBinding
  ) bindingNode = tree.parents[bindingNode];
  return bindingNode;
}

/** The fields of the bound record that the pattern does not name yet. */
function recordBindingCompletions(
  site: Site,
  bindingNode: NodeId,
): readonly Completion[] {
  const { revision, tree, start, make, filter } = site;
  const declaration = tree.parents[bindingNode];
  const selected = new Set(
    kidsOf(tree, bindingNode).flatMap((field) => {
      const label = kidsOf(tree, field)[0];
      return label === undefined || tree.starts[label] === start
        ? []
        : [nameTextOf(tree, label)];
    }),
  );
  const checked = revision.checkedModule(site.module);
  const tables = [
    ...(checked?.functions.values() ?? []),
    ...(checked?.constants.values() ?? []),
  ].map((value) => value.table);
  for (const table of tables) {
    const fact = table.facts.get(declaration);
    if (fact?.kind !== "record-binding") continue;
    return filter(
      recordFields(revision, fact.captured.type).filter((name) =>
        !selected.has(name)
      ).map((name) => make(name, "property")),
    );
  }
  return [];
}

/** The last token that ends at or before the word, skipping newlines. */
function previousTokenOf(tree: SyntaxTree, start: number): number {
  const { lexed } = tree;
  let previousToken = -1;
  for (let i = 0; i < lexed.count; i++) {
    if (
      lexed.ends[i] <= start && lexed.kinds[i] !== TokenKind.Newline &&
      lexed.kinds[i] !== TokenKind.Eof
    ) previousToken = i;
  }
  return previousToken;
}

/** The methods of a service, or the fields of the value before the dot. */
function memberCompletions(
  site: Site,
  previousToken: number,
): readonly Completion[] {
  const { revision, path, tree, make, filter } = site;
  const { lexed, text } = tree;
  let baseToken = previousToken - 1;
  while (baseToken >= 0 && lexed.kinds[baseToken] === TokenKind.Newline) {
    baseToken--;
  }
  const baseEnd = baseToken >= 0
    ? lexed.ends[baseToken]
    : lexed.starts[previousToken];
  const baseOccurrence = occurrenceAt(revision, path, baseEnd);
  if (baseOccurrence?.target.kind === "service") {
    // The resolver's namespace contains imported service declarations too.
    const binding = revision.resolution(site.module)?.namespace.get(
      text.slice(baseOccurrence.span.start, baseOccurrence.span.end),
    );
    const methods = binding?.service?.entry.methodList ?? [];
    return filter(methods.map((m) => make(m.name, "method")));
  }
  const checked = revision.checkedModule(site.module);
  const fields = new Set<string>();
  const tables = [
    ...[...(checked?.functions.values() ?? [])].map((f) => f.table),
    ...[...(checked?.constants.values() ?? [])].map((c) => c.table),
  ];
  for (const table of tables) {
    for (const [node, nodeInfo] of table.info) {
      if (
        tree.ends[node] !== baseEnd || kindOf(tree, node) === SyntaxKind.Token
      ) continue;
      for (const name of recordFields(revision, nodeInfo.type)) {
        fields.add(name);
      }
    }
  }
  return filter([...fields].map((name) => make(name, "property")));
}

/** True when the word is the first on its line, or follows only `export`. */
function startsDeclaration(tree: SyntaxTree, start: number): boolean {
  const { lexed, text } = tree;
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const beforeOnLine: number[] = [];
  for (let i = 0; i < lexed.count; i++) {
    if (
      lexed.starts[i] >= lineStart && lexed.ends[i] <= start &&
      lexed.kinds[i] !== TokenKind.Newline &&
      lexed.kinds[i] !== TokenKind.Eof
    ) beforeOnLine.push(i);
  }
  return beforeOnLine.length === 0 ||
    (beforeOnLine.length === 1 &&
      lexed.kinds[beforeOnLine[0]] === TokenKind.KwExport);
}

type NameContext = "value" | "type" | "fails" | "uses";

/** The syntax context of the word, and whether a declaration word can start here. */
function nameContextAt(
  tree: SyntaxTree,
  start: number,
  declarationStart: boolean,
): { readonly context: NameContext; readonly declarationStart: boolean } {
  let node = containingNode(tree, start);
  let context: NameContext = "value";
  while (node >= 0) {
    const kind = kindOf(tree, node);
    if (
      kind === SyntaxKind.ConstDecl || kind === SyntaxKind.ImportDecl ||
      kind === SyntaxKind.TypeDecl || kind === SyntaxKind.ErrorDecl ||
      kind === SyntaxKind.ServiceDecl || kind === SyntaxKind.ProviderDecl
    ) declarationStart = false;
    if (kind === SyntaxKind.FailsClause) {
      context = "fails";
      break;
    }
    if (kind === SyntaxKind.UsesClause || kind === SyntaxKind.ProvidesClause) {
      context = "uses";
      break;
    }
    if (isTypeKind(kind)) {
      context = "type";
      break;
    }
    node = tree.parents[node];
  }
  return { context, declarationStart };
}

/** The names in scope that fit the context. */
function namespaceCompletions(
  site: Site,
  context: NameContext,
): Map<string, Completion> {
  const { revision, make } = site;
  const values = new Map<string, Completion>();
  const namespace = revision.resolution(site.module)?.namespace;
  for (const [name, binding] of namespace ?? []) {
    const kind = binding.target.kind;
    if (context === "type" && kind !== "type" && kind !== "error") continue;
    if (context === "fails" && kind !== "error") continue;
    if (context === "uses" && kind !== "service") continue;
    if (context === "value" && kind === "service") continue;
    const origin = declarationOf(revision, site.module, binding.target);
    const declaration = origin === undefined
      ? undefined
      : revision.moduleInfoAt(origin.source)?.index.decls.find((d) =>
        d.nameSpan.start === origin.start
      );
    values.set(
      name,
      make(
        name,
        kind === "type"
          ? "type"
          : kind === "error"
          ? "class"
          : kind === "service"
          ? "interface"
          : declaration?.isArrow
          ? "function"
          : "variable",
      ),
    );
  }
  return values;
}

/** Adds the locals, the prelude, the type names, or the effect errors that the context allows. */
function addContextNames(
  site: Site,
  values: Map<string, Completion>,
  context: NameContext,
  declarationStart: boolean,
): void {
  const { revision, path, offset, start, make } = site;
  if (context === "value") {
    const locals = (symbolIndex(revision).locals.get(path) ?? []).filter((l) =>
      l.scope.start <= offset && offset <= l.scope.end &&
      (l.parameter || l.declaration.end <= start)
    ).sort((a, b) =>
      (b.scope.end - b.scope.start) - (a.scope.end - a.scope.start)
    );
    for (const local of locals) {
      values.set(local.name, make(local.name, "variable"));
    }
    for (const name of PRELUDE_NAMES) {
      if (!values.has(name)) values.set(name, make(name, "function"));
    }
    if (declarationStart && !values.has("sealed")) {
      values.set("sealed", make("sealed", "keyword"));
    }
  } else if (context === "type") {
    for (
      const name of [
        ...BUILTIN_TYPE_NAMES,
        ...TYPE_WORDS.keys(),
        ...EFFECT_ERROR_IDS.keys(),
      ]
    ) if (!values.has(name)) values.set(name, make(name, "type"));
    if (!values.has("pure")) values.set("pure", make("pure", "keyword"));
  } else if (context === "fails") {
    for (const name of EFFECT_ERROR_IDS.keys()) {
      values.set(name, make(name, "class"));
    }
  }
}

/** The names that fit the syntax context of the word. */
function nameCompletions(site: Site): readonly Completion[] {
  const { context, declarationStart } = nameContextAt(
    site.tree,
    site.start,
    startsDeclaration(site.tree, site.start),
  );
  const values = namespaceCompletions(site, context);
  addContextNames(site, values, context, declarationStart);
  return site.filter([...values.values()]);
}

/** Visible names, filtered by context and prefix. No automatic import edits. */
export function completionsAt(
  revision: Revision,
  path: string,
  offset: number,
): readonly Completion[] {
  const info = revision.moduleInfoAt(path);
  if (info === undefined || offset < 0 || offset > info.tree.text.length) {
    return [];
  }
  const { tree } = info;
  if (insideCommentOrString(tree, offset)) return [];
  const site = siteAt(revision, path, offset, info.name, tree);
  const bindingNode = recordBindingAt(tree, offset);
  if (bindingNode >= 0) return recordBindingCompletions(site, bindingNode);
  const previousToken = previousTokenOf(tree, site.start);
  if (previousToken >= 0 && tree.lexed.kinds[previousToken] === TokenKind.Dot) {
    return memberCompletions(site, previousToken);
  }
  return nameCompletions(site);
}
