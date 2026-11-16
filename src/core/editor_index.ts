// Resolver identities and declaration anchors shared by editor queries. The
// cache belongs to a Revision; retaining a Program does not retain old indices.
import { emptyMap, emptySet, indices as integerIndices } from "./runtime.ts";
import type { CheckedModule } from "./check_project.ts";
import type { Revision } from "./db.ts";
import { isIdentifier } from "./lex.ts";
import { methodOfCapability, serviceOfCapability } from "./ids.ts";
import type { BodyTable } from "./tables.ts";
import { type Target, targetText } from "./resolve.ts";
import type { Span } from "./source.ts";
import { compareText } from "./util.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  nodeSpan,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
/** The body tables of the functions, then the constants, of a checked module. */
export function bodyTablesOf(
  module: CheckedModule | undefined,
): readonly BodyTable[] {
  return [
    ...(module?.functions.values() ?? []),
    ...(module?.constants.values() ?? []),
  ].map((body) => body.table);
}
type DeclarationKind = "type" | "class" | "interface";
/** The editor kind of a type, error, or service declaration. Other kinds need the declaration. */
export function declarationKind(
  kind: DeclarationName,
): DeclarationKind | undefined {
  if (kind === "type") return "type";
  if (kind === "error") return "class";
  if (kind === "service") return "interface";
  return undefined;
}
type DeclarationName = string;
type Matched = boolean;
type SourcePath = string;
type SourceOffset = number;
/** True when the name span `declaration` names a const whose value is an arrow. */
export function isArrowDeclaration(
  revision: Revision,
  declaration: Span | undefined,
): Matched {
  if (declaration === undefined) return false;
  const arrow = revision.moduleInfoAt(declaration.source)?.index.decls.find((
    entry,
  ) => entry.nameSpan.start === declaration.start)?.isArrow;
  return typeof arrow === "boolean" && arrow;
}
export type SymbolOccurrence = {
  readonly identity: string;
  readonly target: Target;
  readonly span: Span;
  readonly declaration: Span | undefined;
  readonly isDeclaration: boolean;
  readonly node: NodeId;
  readonly shorthand: boolean;
};
type LocalScope = {
  readonly identity: string;
  readonly name: string;
  readonly declaration: Span;
  readonly scope: Span;
  readonly parameter: boolean;
};
export type SymbolIndex = {
  readonly occurrences: readonly SymbolOccurrence[];
  readonly byIdentity: ReadonlyMap<string, readonly SymbolOccurrence[]>;
  readonly byPath: ReadonlyMap<string, readonly SymbolOccurrence[]>;
  readonly locals: ReadonlyMap<string, readonly LocalScope[]>;
};
export function sameSpan(a: Span | undefined, b: Span | undefined): Matched {
  return a !== undefined && b !== undefined && a.source === b.source &&
    a.start === b.start && a.end === b.end;
}
export function declarationOf(
  revision: Revision,
  module: DeclarationName,
  target: Target,
): Span | undefined {
  if (target.kind === "local") {
    return revision.resolution(module)?.locals.get(target.id);
  }
  if (
    target.kind === "builtin" || target.kind === "builtin-type" ||
    target.kind === "field" || target.kind === "unresolved"
  ) {
    return undefined;
  }
  const id = target.kind === "cap" ? serviceOfCapability(target.id) : target.id;
  if (id === undefined) {
    return undefined;
  }
  const entry = revision.declEntry(id);
  return target.kind === "cap"
    ? entry?.methods.get(methodOfCapability(target.id) ?? "")?.nameSpan
    : entry?.nameSpan;
}
function localScope(
  tree: SyntaxTree,
  node: NodeId,
  identity: string,
): LocalScope {
  let parent = tree.parents[node];
  const binding = parent >= 0 &&
      Array.of<SyntaxKind>(SyntaxKind.BindingField, SyntaxKind.ShorthandBinding)
        .includes(kindOf(tree, parent))
    ? tree.parents[tree.parents[parent]]
    : -1;
  const parameter = parent >= 0 && kindOf(tree, parent) === SyntaxKind.Param;
  for (const _step of integerIndices(tree.count)) {
    if (
      !(parent >= 0 &&
        !Array.of<SyntaxKind>(
          SyntaxKind.UsingExpr,
          SyntaxKind.ArrowExpr,
          SyntaxKind.Block,
          SyntaxKind.MatchArm,
          SyntaxKind.Handler,
          SyntaxKind.FinallyClause,
          SyntaxKind.ResourceRelease,
        ).includes(kindOf(tree, parent)))
    ) break;
    parent = tree.parents[parent];
  }
  return {
    identity: identity,
    name: nodeText(tree, node),
    declaration: nodeSpan(tree, node),
    scope: parent >= 0
      ? {
        ...nodeSpan(tree, parent),
        start: binding >= 0 ? tree.ends[binding] : tree.starts[parent],
      }
      : nodeSpan(tree, tree.root),
    parameter: parameter,
  };
}
export function buildSymbolIndex(revision: Revision): SymbolIndex {
  let occurrences: SymbolOccurrence[] = [];
  let byIdentity = emptyMap<string, SymbolOccurrence[]>();
  let byPath = emptyMap<string, SymbolOccurrence[]>();
  let locals = emptyMap<string, LocalScope[]>();
  for (const info of revision.moduleInfos()) {
    const module = info.name;
    const resolution = revision.resolution(module);
    if (resolution === undefined) {
      continue;
    }
    const tree = info.tree;
    let file: SymbolOccurrence[] = [];
    const scopes: LocalScope[] = [];
    let seen = emptySet<string>();
    for (const entry of resolution.targets) {
      const node = entry[0];
      const target = entry[1];
      const span = nodeSpan(tree, node);
      const text = tree.text.slice(span.start, span.end);
      // FieldExpr/QualifiedName also carry capability identities. Their Name
      // children own the editable token; never edit the entire S.method span.
      if (!isIdentifier(text)) {
        continue;
      }
      const identity = targetText(target);
      const key = `${span.start}:${span.end}:${identity}`;
      if (seen.has(key)) {
        continue;
      }
      seen = seen.add(key);
      const declaration = declarationOf(revision, module, target);
      const isDeclaration = sameSpan(span, declaration);
      const parent = tree.parents[node];
      const occurrence: SymbolOccurrence = {
        identity: identity,
        target: target,
        span: span,
        declaration: declaration,
        isDeclaration: isDeclaration,
        node: node,
        shorthand: parent >= 0 &&
          Array.of<SyntaxKind>(
            SyntaxKind.ShorthandField,
            SyntaxKind.ShorthandBinding,
          ).includes(kindOf(tree, parent)),
      };
      occurrences[occurrences.length] = occurrence;
      file[file.length] = occurrence;
      const group = byIdentity.get(identity) ?? [];
      group[group.length] = occurrence;
      byIdentity = byIdentity.set(identity, group);
      if (isDeclaration && target.kind === "local") {
        const local = localScope(tree, node, identity);
        if (parent >= 0 && kindOf(tree, parent) === SyntaxKind.UsingExpr) {
          for (const region of childrenOf(tree, parent)) {
            if (
              Array.of<SyntaxKind>(
                SyntaxKind.ResourceUse,
                SyntaxKind.ResourceRelease,
              ).includes(kindOf(tree, region))
            ) {
              scopes[scopes.length] = {
                ...local,
                scope: nodeSpan(tree, region),
                parameter: true,
              };
            }
          }
        } else {
          scopes[scopes.length] = local;
        }
      }
    }
    file = file.sort((a, b) =>
      a.span.start - b.span.start || a.span.end - b.span.end
    );
    byPath = byPath.set(info.path, file);
    locals = locals.set(info.path, scopes);
  }
  occurrences = occurrences.sort((a, b) =>
    compareText(a.span.source, b.span.source) || a.span.start - b.span.start
  );
  const result = {
    occurrences: occurrences,
    byIdentity: byIdentity,
    byPath: byPath,
    locals: locals,
  };
  return result;
}
export function occurrenceAt(
  revision: Revision,
  path: SourcePath,
  offset: SourceOffset,
): SymbolOccurrence | undefined {
  const file = revision.symbolIndex().byPath.get(path) ?? [];
  return file.find((o) => o.span.start <= offset && offset < o.span.end) ??
    file.find((o) => o.span.end === offset && o.span.start < offset);
}
export function referencesAt(
  revision: Revision,
  path: SourcePath,
  offset: SourceOffset,
  includeDeclaration: Matched | undefined,
): readonly Span[] {
  const hit = occurrenceAt(revision, path, offset);
  if (hit?.declaration === undefined || hit.target.kind === "field") {
    return [];
  }
  return (revision.symbolIndex().byIdentity.get(hit.identity) ?? []).filter((
    o,
  ) => (includeDeclaration ?? true) || !o.isDeclaration).map((o) => o.span);
}
