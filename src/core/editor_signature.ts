// Signature help for ordinary calls. The query reads checked callee types from
// body tables and keeps LSP wire types outside the core.
import type { Revision } from "./db.ts";
import { moduleOfId } from "./ids.ts";
import type { LocalId } from "./ir.ts";
import { TokenKind } from "./lex.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import { initOf, kidsOf, tokenKindOf } from "./syntax_queries.ts";
import type { BodyTable } from "./tables.ts";
import { effectText, showType } from "./type_show.ts";
import type { TypeNode, TypeReader, TypeRef } from "./types.ts";

type FunctionNode = Extract<TypeNode, { readonly kind: "function" }>;

export interface SignatureParameter {
  readonly label: string;
  readonly documentation?: string;
}

export interface SignatureHelp {
  readonly label: string;
  readonly parameters: readonly SignatureParameter[];
  readonly activeParameter: number;
}

function functionOf(
  table: TypeReader,
  ref: TypeRef,
): FunctionNode | undefined {
  const node = table.node(table.unfold(ref));
  return node.kind === "function" ? node : undefined;
}

function tablesOf(revision: Revision, module: string): readonly BodyTable[] {
  const checked = revision.checkedModule(module);
  return checked === undefined ? [] : [
    ...[...checked.functions.values()].map((fn) => fn.table),
    ...[...checked.constants.values()].map((constant) => constant.table),
  ];
}

function aliasTargetNode(
  revision: Revision,
  module: string,
  tree: SyntaxTree,
  node: NodeId,
): NodeId | undefined {
  let current = node;
  while (kindOf(tree, current) === SyntaxKind.ParenExpr) {
    const inner = kidsOf(tree, current)[0];
    if (inner === undefined) return undefined;
    current = inner;
  }
  return revision.resolution(module)?.targets.has(current)
    ? current
    : undefined;
}

function parameterNames(
  revision: Revision,
  module: string,
  tree: SyntaxTree,
  callee: NodeId,
  count: number,
): readonly string[] {
  let currentModule = module;
  let currentTree = tree;
  let currentNode = aliasTargetNode(
    revision,
    currentModule,
    currentTree,
    callee,
  );
  const seen = new Set<string>();
  const localDeclarations = new Map<string, Map<LocalId, NodeId>>();
  while (currentNode !== undefined) {
    const resolution = revision.resolution(currentModule);
    if (resolution === undefined) break;
    const target = resolution.targets.get(currentNode);
    if (
      target === undefined ||
      target.kind !== "local" && target.kind !== "value" ||
      seen.has(target.id)
    ) break;
    seen.add(target.id);
    if (target.kind === "local") {
      let declarations = localDeclarations.get(currentModule);
      if (declarations === undefined) {
        declarations = new Map();
        for (const [node, candidate] of resolution.targets) {
          if (candidate.kind !== "local") continue;
          const span = resolution.locals.get(candidate.id);
          if (
            span !== undefined && currentTree.starts[node] === span.start &&
            currentTree.ends[node] === span.end
          ) declarations.set(candidate.id, node);
        }
        localDeclarations.set(currentModule, declarations);
      }
      const declaration = declarations.get(target.id);
      const binding = declaration === undefined
        ? undefined
        : currentTree.parents[declaration];
      const init = binding === undefined || binding < 0 ||
          kindOf(currentTree, binding) !== SyntaxKind.ConstDecl
        ? undefined
        : initOf(currentTree, binding, declaration);
      currentNode = init === undefined
        ? undefined
        : aliasTargetNode(revision, currentModule, currentTree, init);
      continue;
    }
    if (target.kind !== "value") break;
    const owner = moduleOfId(target.id);
    const checked = owner === undefined
      ? undefined
      : revision.checkedModule(owner);
    const fn = checked?.functions.get(target.id);
    if (fn !== undefined) return fn.signature.parameters.map((p) => p.name);
    const constant = checked?.constants.get(target.id);
    if (
      owner === undefined || checked === undefined ||
      constant?.initNode === undefined
    ) {
      break;
    }
    currentModule = owner;
    currentTree = checked.tree;
    currentNode = aliasTargetNode(
      revision,
      currentModule,
      currentTree,
      constant.initNode,
    );
  }
  return Array.from({ length: count }, (_, index) => `arg${index + 1}`);
}

function containsCursor(
  tree: SyntaxTree,
  args: NodeId,
  offset: number,
): boolean {
  if (offset <= tree.starts[args]) return false;
  if (offset < tree.ends[args]) return true;
  if (offset !== tree.ends[args]) return false;
  return ![...childrenOf(tree, args)].some((child) =>
    tokenKindOf(tree, child) === TokenKind.RParen
  );
}

function activeParameter(
  tree: SyntaxTree,
  args: NodeId,
  offset: number,
  count: number,
): number {
  let active = 0;
  for (const child of childrenOf(tree, args)) {
    if (
      tokenKindOf(tree, child) === TokenKind.Comma &&
      tree.ends[child] <= offset
    ) active++;
  }
  return count === 0 ? 0 : Math.min(active, count - 1);
}

/** Returns signature help for the innermost ordinary call at `offset`. */
export function signatureHelpAt(
  revision: Revision,
  path: string,
  offset: number,
): SignatureHelp | undefined {
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !path.endsWith(".eff")) return undefined;
  const { tree } = module;
  const tables = tablesOf(revision, module.module);
  let best:
    | {
      readonly callee: NodeId;
      readonly args: NodeId;
      readonly fn: FunctionNode;
      readonly width: number;
    }
    | undefined;
  for (let node = 0; node < tree.count; node++) {
    if (kindOf(tree, node) !== SyntaxKind.CallExpr) continue;
    const children = kidsOf(tree, node);
    const callee = children[0];
    const args = children.find((child) =>
      kindOf(tree, child) === SyntaxKind.ArgList
    );
    if (
      callee === undefined || args === undefined ||
      !containsCursor(tree, args, offset)
    ) {
      continue;
    }
    let type: TypeRef | undefined;
    for (const table of tables) {
      type = table.info.get(callee)?.type;
      if (type !== undefined) break;
    }
    if (type === undefined) continue;
    const fn = functionOf(revision.types, type);
    if (fn === undefined) continue;
    const width = tree.ends[node] - tree.starts[node];
    if (best === undefined || width < best.width) {
      best = { callee, args, fn, width };
    }
  }
  if (best === undefined) return undefined;
  const names = parameterNames(
    revision,
    module.module,
    tree,
    best.callee,
    best.fn.parameters.length,
  );
  const parameters = best.fn.parameters.map((type, index) => {
    const contract = showType(revision.types, type);
    const checked = best.fn.checked?.[index] === true;
    return {
      label: `${names[index] ?? `arg${index + 1}`}: ${
        checked ? `unknown -> ${contract}` : contract
      }`,
      ...(checked
        ? {
          documentation:
            `This entry accepts unknown input and validates it as ${contract}.`,
        }
        : {}),
    };
  });
  return {
    label: `${nodeText(tree, best.callee)}(${
      parameters.map((parameter) => parameter.label).join(", ")
    }): ${showType(revision.types, best.fn.result)}${
      effectText(best.fn.failures, best.fn.requirements)
    }`,
    parameters,
    activeParameter: activeParameter(
      tree,
      best.args,
      offset,
      parameters.length,
    ),
  };
}
