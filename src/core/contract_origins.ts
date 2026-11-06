// The origins of a missing contract entry: the nodes of one function body that
// introduce a failure or a requirement which a written clause omits.

import type { CapabilityId, ErrorId } from "./ir.ts";
import type { Span } from "./source.ts";
import {
  kindOf,
  type NodeId,
  nodeSpan,
  SyntaxKind,
  type SyntaxTree,
} from "./syntax.ts";
import { arrowBody, kidsOf } from "./syntax_queries.ts";
import type { EffectSet } from "./effect_set.ts";
import type { BodyTable } from "./tables.ts";

export type ContractEntry =
  | { readonly kind: "failure"; readonly error: ErrorId }
  | { readonly kind: "requirement"; readonly capability: CapabilityId };

/**
 * The spans of the smallest nodes in the body at `root` that introduce `entry`,
 * without duplicates, in source order.
 */
export function contractOrigins(
  tree: SyntaxTree,
  body: BodyTable,
  root: NodeId,
  entry: ContractEntry,
): Span[] {
  const ownSet = (node: NodeId): EffectSet | undefined =>
    body.stageSets.get(node) ?? body.info.get(node);
  const carries = (node: NodeId): boolean => {
    const set = ownSet(node);
    if (set === undefined) return false;
    return entry.kind === "failure"
      ? set.failures.includes(entry.error)
      : set.requirements.includes(entry.capability);
  };
  const handlesEntry = (handler: NodeId): boolean => {
    const fact = body.facts.get(handler);
    return entry.kind === "failure" && fact?.kind === "handler" &&
      fact.error === entry.error;
  };
  const arrowReplacement = (node: NodeId): NodeId | undefined => {
    if (body.facts.get(node)?.kind !== "arrow") return undefined;
    if (kindOf(tree, node) === SyntaxKind.ArrowExpr) {
      return arrowBody(tree, node);
    }
    return kidsOf(tree, node).pop();
  };
  // The syntax children that stand in for the children of `node`.
  const stand = (node: NodeId, skipProtected: boolean): NodeId[] => {
    const result: NodeId[] = [];
    const protectedBlock = skipProtected
      ? kidsOf(tree, node).find((k) => kindOf(tree, k) === SyntaxKind.Block)
      : undefined;
    for (const child of kidsOf(tree, node)) {
      if (child === protectedBlock) continue;
      const replacement = arrowReplacement(child);
      if (replacement !== undefined) {
        result.push(replacement);
      } else if (ownSet(child) === undefined) {
        result.push(...stand(child, false));
      } else {
        result.push(child);
      }
    }
    return result;
  };
  const namesHandler = (node: NodeId): boolean =>
    kindOf(tree, node) === SyntaxKind.TryExpr &&
    kidsOf(tree, node).some((k) =>
      kindOf(tree, k) === SyntaxKind.CatchClause &&
      kidsOf(tree, k).some((h) =>
        kindOf(tree, h) === SyntaxKind.Handler && handlesEntry(h)
      )
    );
  const found = new Map<string, Span>();
  const visit = (node: NodeId): void => {
    const selected = stand(node, namesHandler(node)).filter(carries);
    if (selected.length === 0) {
      const span = nodeSpan(tree, node);
      found.set(`${span.start}:${span.end}`, span);
      return;
    }
    for (const child of selected) visit(child);
  };
  if (carries(root)) visit(root);
  return [...found.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
