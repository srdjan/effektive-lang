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
  function ownSet(node: NodeId): EffectSet | undefined {
    return body.stageSets.get(node) ?? body.info.get(node);
  }
  function carries(node: NodeId): boolean {
    const set = ownSet(node);
    if (set === undefined) return false;
    return entry.kind === "failure"
      ? set.failures.includes(entry.error)
      : set.requirements.includes(entry.capability);
  }
  function handlesEntry(handler: NodeId): boolean {
    const fact = body.facts.get(handler);
    return entry.kind === "failure" && fact?.kind === "handler" &&
      fact.error === entry.error;
  }
  function arrowReplacement(node: NodeId): NodeId | undefined {
    if (body.facts.get(node)?.kind !== "arrow") return undefined;
    if (kindOf(tree, node) === SyntaxKind.ArrowExpr) {
      return arrowBody(tree, node);
    }
    return kidsOf(tree, node).pop();
  }
  // The syntax children that stand in for the children of `node`.
  function stand(node: NodeId, skipProtected: boolean): NodeId[] {
    const result: NodeId[] = [];
    const protectedBlock = skipProtected
      ? kidsOf(tree, node).find((k) => kindOf(tree, k) === SyntaxKind.Block)
      : undefined;
    for (const child of kidsOf(tree, node)) {
      if (child === protectedBlock) continue;
      const replacement = arrowReplacement(child);
      if (replacement !== undefined) {
        result[result.length] = replacement;
      } else if (ownSet(child) === undefined) {
        for (const descendant of stand(child, false)) {
          result[result.length] = descendant;
        }
      } else {
        result[result.length] = child;
      }
    }
    return result;
  }
  function namesHandler(node: NodeId): boolean {
    return kindOf(tree, node) === SyntaxKind.TryExpr &&
      kidsOf(tree, node).some((k) =>
        kindOf(tree, k) === SyntaxKind.CatchClause &&
        kidsOf(tree, k).some((h) =>
          kindOf(tree, h) === SyntaxKind.Handler && handlesEntry(h)
        )
      );
  }
  function visit(node: NodeId): readonly Span[] {
    const selected = stand(node, namesHandler(node)).filter(carries);
    if (selected.length === 0) {
      return [nodeSpan(tree, node)];
    }
    return selected.flatMap(visit);
  }
  if (!carries(root)) return [];
  return visit(root).filter((span, index, spans) =>
    spans.findIndex((candidate) =>
      candidate.start === span.start && candidate.end === span.end
    ) === index
  ).toSorted((a, b) => a.start - b.start || a.end - b.end);
}
