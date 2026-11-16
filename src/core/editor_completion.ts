import type { EditorOffset, EditorPath } from "./editor.ts";
import { emptyMap, emptySet, indices, setFrom } from "./runtime.ts";
import { isIdentPart, TokenKind } from "./lex.ts";
import type { Revision } from "./db.ts";
import type { ModuleInfo } from "./project.ts";
import {
  bodyTablesOf,
  declarationKind,
  declarationOf,
  isArrowDeclaration,
  occurrenceAt,
} from "./editor_index.ts";
import { isTypeKind, kidsOf, nameTextOf } from "./syntax_queries.ts";
import {
  BUILTIN_TYPE_NAMES,
  EFFECT_ERROR_IDS,
  PRELUDE_NAMES,
} from "./resolve.ts";
import type { Span } from "./source.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  SyntaxKind,
  type SyntaxTree,
  typeWords,
} from "./syntax.ts";
import type { TypeRef } from "./types.ts";
import { compareText } from "./util.ts";
type Completion = {
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
};
function containingNode(tree: SyntaxTree, offset: number): NodeId {
  let best = tree.root;
  for (const n of indices(tree.count)) {
    if (
      tree.starts[n] <= offset && offset <= tree.ends[n] &&
      tree.ends[n] - tree.starts[n] <= tree.ends[best] - tree.starts[best]
    ) {
      best = n;
    }
  }
  return best;
}
function recordFields(
  revision: Revision,
  ref: TypeRef,
  seen: ReadonlySet<TypeRef> | undefined,
): readonly string[] {
  const visited = seen ?? emptySet<TypeRef>();
  if (visited.has(ref)) {
    return [];
  }
  const table = revision.types;
  const node = table.node(ref);
  if (node.kind === "record") {
    return node.fields.map((f) => f.name);
  }
  if (node.kind === "named") {
    const target = table.declaredBodyOf(node.id);
    return target === undefined
      ? []
      : recordFields(revision, target, setFrom([...visited, ref]));
  }
  if (node.kind === "union") {
    const fields = node.members.map((t) =>
      recordFields(revision, t, setFrom([...visited, ref]))
    );
    return (fields[0] ?? []).filter((name) =>
      fields.every((f) => f.includes(name))
    );
  }
  return [];
}
type Site = {
  readonly revision: Revision;
  readonly path: string;
  readonly offset: number;
  readonly module: string;
  readonly tree: SyntaxTree;
  readonly start: number;
  readonly make: (label: string, kind: Completion["kind"]) => Completion;
  /** Keeps the labels that start with the typed prefix, sorted. */
  readonly filter: (values: readonly Completion[]) => Completion[];
};
function insideCommentOrString(tree: SyntaxTree, offset: number): boolean {
  const binding1 = tree;
  const lexed = binding1.lexed;
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
  for (const _step of indices(start)) {
    if (!(start > 0 && isIdentPart(text.charCodeAt(start - 1)))) break;
    start = start - 1;
  }
  const prefix = text.slice(start, offset);
  let end = offset;
  for (const _step of indices(text.length - end)) {
    if (!isIdentPart(text.charCodeAt(end))) break;
    end = end + 1;
  }
  const span = { source: path, start: start, end: end };
  return {
    revision: revision,
    path: path,
    offset: offset,
    module: module,
    tree: tree,
    start: start,
    make: (label, kind) => ({ label: label, kind: kind, span: span }),
    filter: (values) =>
      values.filter((v) => v.label.startsWith(prefix)).sort((a, b) =>
        compareText(a.label, b.label)
      ),
  };
}
/** The fields of the bound record that the pattern does not name yet. */
function recordBindingCompletions(
  site: Site,
  bindingNode: NodeId,
): readonly Completion[] {
  const binding2 = site;
  const revision = binding2.revision;
  const tree = binding2.tree;
  const start = binding2.start;
  const make = binding2.make;
  const filter = binding2.filter;
  const declaration = tree.parents[bindingNode];
  const selected = setFrom(
    kidsOf(tree, bindingNode).flatMap((field) => {
      const label = kidsOf(tree, field)[0];
      return label === undefined || tree.starts[label] === start
        ? []
        : [nameTextOf(tree, label)];
    }),
  );
  for (const table of bodyTablesOf(revision.checkedModule(site.module))) {
    const fact = table.facts.get(declaration);
    if (fact?.kind !== "record-binding") {
      continue;
    }
    return filter(
      recordFields(revision, fact.captured.type, undefined).filter((name) =>
        !selected.has(name)
      ).map((name) => make(name, "property")),
    );
  }
  return [];
}
/** The last token that ends at or before the word, skipping newlines. */
function previousTokenOf(tree: SyntaxTree, start: number): number {
  const binding3 = tree;
  const lexed = binding3.lexed;
  let previousToken = -1;
  for (const i of indices(lexed.count)) {
    if (
      lexed.ends[i] <= start && lexed.kinds[i] !== TokenKind.Newline &&
      lexed.kinds[i] !== TokenKind.Eof
    ) {
      previousToken = i;
    }
  }
  return previousToken;
}
/** The methods of a service, or the fields of the value before the dot. */
function memberCompletions(
  site: Site,
  previousToken: number,
): readonly Completion[] {
  const binding4 = site;
  const revision = binding4.revision;
  const path = binding4.path;
  const tree = binding4.tree;
  const make = binding4.make;
  const filter = binding4.filter;
  const binding5 = tree;
  const lexed = binding5.lexed;
  const text = binding5.text;
  let baseToken = previousToken - 1;
  for (const _step of indices(baseToken + 1)) {
    if (!(baseToken >= 0 && lexed.kinds[baseToken] === TokenKind.Newline)) {
      break;
    }
    baseToken = baseToken - 1;
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
  let fields = emptySet<string>();
  for (const table of bodyTablesOf(revision.checkedModule(site.module))) {
    for (const binding6 of table.info) {
      const binding7 = binding6;
      const node = binding7[0];
      const nodeInfo = binding7[1];
      if (
        tree.ends[node] !== baseEnd || kindOf(tree, node) === SyntaxKind.Token
      ) {
        continue;
      }
      for (const name of recordFields(revision, nodeInfo.type, undefined)) {
        fields = fields.add(name);
      }
    }
  }
  return filter([...fields].map((name) => make(name, "property")));
}
/** True when the word is the first on its line, or follows only `export`. */
function startsDeclaration(tree: SyntaxTree, start: number): boolean {
  const binding8 = tree;
  const lexed = binding8.lexed;
  const text = binding8.text;
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const beforeOnLine: number[] = [];
  for (const i of indices(lexed.count)) {
    if (
      lexed.starts[i] >= lineStart && lexed.ends[i] <= start &&
      lexed.kinds[i] !== TokenKind.Newline &&
      lexed.kinds[i] !== TokenKind.Eof
    ) {
      beforeOnLine[beforeOnLine.length] = i;
    }
  }
  return beforeOnLine.length === 0 ||
    (beforeOnLine.length === 1 &&
      lexed.kinds[beforeOnLine[0]] === TokenKind.KwExport);
}
function serviceHeaderKeywordAllowed(site: Site): boolean {
  const binding9 = site;
  const revision = binding9.revision;
  const module = binding9.module;
  const tree = binding9.tree;
  const start = binding9.start;
  const headers =
    revision.moduleInfo(module)?.index.imports.filter((entry) =>
      entry.role === "service" && entry.span.end <= start
    ) ?? [];
  function insideHeader(token: number): boolean {
    return headers.some((entry) =>
      entry.span.start <= tree.lexed.starts[token] &&
      tree.lexed.ends[token] <= entry.span.end
    );
  }
  let previous = -1;
  for (const i of indices(tree.lexed.count)) {
    if (tree.lexed.ends[i] > start) {
      break;
    }
    if (tree.lexed.kinds[i] !== TokenKind.Eof) {
      previous = i;
    }
    if (
      tree.lexed.kinds[i] !== TokenKind.Newline &&
      tree.lexed.kinds[i] !== TokenKind.Semicolon &&
      tree.lexed.kinds[i] !== TokenKind.Eof &&
      !insideHeader(i)
    ) {
      return false;
    }
  }
  return previous < 0 || tree.lexed.kinds[previous] === TokenKind.Newline ||
    tree.lexed.kinds[previous] === TokenKind.Semicolon;
}
type NameContext = "value" | "type" | "fails" | "with";
/** The syntax context of the word, and whether a declaration word can start here. */
function nameContextAt(
  tree: SyntaxTree,
  start: number,
  declarationStart: boolean,
): {
  readonly context: NameContext;
  readonly declarationStart: boolean;
} {
  let node = containingNode(tree, start);
  let context: NameContext = "value";
  for (const _step of indices(tree.count)) {
    if (node < 0) break;
    const kind = kindOf(tree, node);
    if (
      kind === SyntaxKind.ConstDecl || kind === SyntaxKind.ImportDecl ||
      kind === SyntaxKind.TypeDecl || kind === SyntaxKind.ErrorDecl ||
      kind === SyntaxKind.ServiceDecl || kind === SyntaxKind.ProviderDecl
    ) {
      declarationStart = false;
    }
    if (kind === SyntaxKind.FailsClause) {
      context = "fails";
      break;
    }
    if (kind === SyntaxKind.WithClause || kind === SyntaxKind.ProvidesClause) {
      context = "with";
      break;
    }
    if (isTypeKind(kind)) {
      context = "type";
      break;
    }
    node = tree.parents[node];
  }
  return { context: context, declarationStart: declarationStart };
}
function namespaceCompletions(
  site: Site,
  context: NameContext,
): Map<string, Completion> {
  const binding10 = site;
  const revision = binding10.revision;
  const make = binding10.make;
  let values = emptyMap<string, Completion>();
  const namespace = revision.resolution(site.module)?.namespace;
  for (const binding11 of namespace ?? []) {
    const binding12 = binding11;
    const name = binding12[0];
    const binding = binding12[1];
    const kind = binding.target.kind;
    if (context === "type" && kind !== "type" && kind !== "error") {
      continue;
    }
    if (context === "fails" && kind !== "error") {
      continue;
    }
    if (context === "with" && kind !== "service") {
      continue;
    }
    if (context === "value" && kind === "service") {
      continue;
    }
    const origin = declarationOf(revision, site.module, binding.target);
    values = values.set(
      name,
      make(
        name,
        declarationKind(kind) ??
          (isArrowDeclaration(revision, origin) ? "function" : "variable"),
      ),
    );
  }
  return values;
}
function addContextNames(
  site: Site,
  values: Map<string, Completion>,
  context: NameContext,
  declarationStart: boolean,
): Map<string, Completion> {
  const binding13 = site;
  const revision = binding13.revision;
  const path = binding13.path;
  const offset = binding13.offset;
  const start = binding13.start;
  const make = binding13.make;
  if (context === "value") {
    const locals = (revision.symbolIndex().locals.get(path) ?? []).filter((l) =>
      l.scope.start <= offset && offset <= l.scope.end &&
      (l.parameter || l.declaration.end <= start)
    ).sort((a, b) =>
      (b.scope.end - b.scope.start) - (a.scope.end - a.scope.start)
    );
    for (const local of locals) {
      values = values.set(local.name, make(local.name, "variable"));
    }
    for (const name of PRELUDE_NAMES) {
      if (!values.has(name)) {
        values = values.set(name, make(name, "function"));
      }
    }
    if (declarationStart && !values.has("sealed")) {
      values = values.set("sealed", make("sealed", "keyword"));
    }
    if (serviceHeaderKeywordAllowed(site) && !values.has("imports")) {
      values = values.set("imports", make("imports", "keyword"));
    }
  } else if (context === "type") {
    for (
      const name of [
        ...BUILTIN_TYPE_NAMES,
        ...typeWords(),
        ...EFFECT_ERROR_IDS.keys(),
      ]
    ) {
      if (!values.has(name)) {
        values = values.set(name, make(name, "type"));
      }
    }
    if (!values.has("pure")) {
      values = values.set("pure", make("pure", "keyword"));
    }
  } else if (context === "fails") {
    for (const name of EFFECT_ERROR_IDS.keys()) {
      values = values.set(name, make(name, "class"));
    }
  }
  return values;
}
function serviceImportCompletions(
  site: Site,
  info: ModuleInfo,
): readonly Completion[] | undefined {
  const index = info.index.imports.findIndex((entry) =>
    entry.role === "service" && entry.span.start <= site.offset &&
    site.offset <= entry.span.end
  );
  if (index < 0) {
    return undefined;
  }
  const entry = info.index.imports[index];
  const atName = entry.names.some((name) =>
    name.span.start <= site.start && site.start <= name.span.end
  );
  const keyword = childrenOf(info.tree, entry.node)[0];
  const atMissingName = entry.names.length === 1 &&
    entry.names[0].name === "from" && keyword !== undefined &&
    info.tree.ends[keyword] <= site.offset &&
    site.offset <= entry.names[0].span.start;
  if (!atName && !atMissingName) {
    return undefined;
  }
  const target = info.links[index]?.target;
  if (target === undefined) {
    return [];
  }
  const declarations = site.revision.moduleInfo(target)?.index.decls ?? [];
  return site.filter(
    declarations.filter((entry) => entry.exported && entry.kind === "service")
      .map((entry) => site.make(entry.name, "interface")),
  );
}
/** Visible names, filtered by context and prefix. No automatic import edits. */
export function completionsAt(
  revision: Revision,
  path: EditorPath,
  offset: EditorOffset,
): readonly Completion[] {
  const info = revision.moduleInfoAt(path);
  if (info === undefined || offset < 0 || offset > info.tree.text.length) {
    return [];
  }
  const binding14 = info;
  const tree = binding14.tree;
  if (insideCommentOrString(tree, offset)) {
    return [];
  }
  const site = siteAt(revision, path, offset, info.name, tree);
  const serviceImports = serviceImportCompletions(site, info);
  if (serviceImports !== undefined) {
    return serviceImports;
  }
  let bindingNode = containingNode(tree, offset);
  for (const _step of indices(tree.count)) {
    if (
      !(bindingNode >= 0 &&
        kindOf(tree, bindingNode) !== SyntaxKind.RecordBinding)
    ) break;
    bindingNode = tree.parents[bindingNode];
  }
  if (bindingNode >= 0) {
    return recordBindingCompletions(site, bindingNode);
  }
  const previousToken = previousTokenOf(tree, site.start);
  if (previousToken >= 0 && tree.lexed.kinds[previousToken] === TokenKind.Dot) {
    return memberCompletions(site, previousToken);
  }
  const binding15 = nameContextAt(
    tree,
    site.start,
    startsDeclaration(tree, site.start),
  );
  const context = binding15.context;
  const declarationStart = binding15.declarationStart;
  const values = addContextNames(
    site,
    namespaceCompletions(site, context),
    context,
    declarationStart,
  );
  return site.filter([...values.values()]);
}
