// The initialization cycles of a module. A module constant depends on each
// declaration that its initializer references. A reference to a function adds
// every declaration that the function body references, transitively. A cycle
// that holds a constant cannot be initialized. The emitter orders the emitted
// constants itself, from the IR.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import { shortName } from "./ids.ts";
import type { ValueId } from "./ir.ts";
import type { Span } from "./source.ts";

interface InitializationNode {
  readonly id: ValueId;
  readonly kind: "function" | "constant";
  /** Module-level declarations that the body or initializer references. */
  readonly references: readonly ValueId[];
}

/**
 * For each node, the sorted positions of the nodes that its references name.
 * A reference to an id outside `nodes` is dropped.
 */
export function referenceEdges(
  nodes: readonly {
    readonly id: ValueId;
    readonly references: readonly ValueId[];
  }[],
): number[][] {
  const position = new Map<ValueId, number>();
  nodes.forEach((node, i) => position.set(node.id, i));
  return nodes.map((node) =>
    [...new Set(node.references)]
      .map((id) => position.get(id))
      .filter((p): p is number => p !== undefined)
      .sort((a, b) => a - b)
  );
}

/** A node with the span of its name, for the cycle diagnostics. */
interface NamedNode extends InitializationNode {
  readonly nameSpan: Span;
}

/** One `module/004` diagnostic for each initialization cycle of the nodes. */
export function checkInitialization(
  nodes: readonly NamedNode[],
): readonly Diagnostic[] {
  const position = new Map<ValueId, number>();
  nodes.forEach((node, i) => position.set(node.id, i));
  const edges = referenceEdges(nodes);
  const cycles: ValueId[][] = [];
  for (const component of stronglyConnectedComponents(nodes.length, edges)) {
    if (!isCycle(component, edges)) continue;
    if (!component.some((p) => nodes[p].kind === "constant")) continue;
    cycles.push(component.map((p) => nodes[p].id));
  }
  // A cycle lists ids of `nodes`, so each first id has a position.
  const firstPosition = (cycle: readonly ValueId[]): number => {
    const at = position.get(cycle[0]);
    if (at === undefined) {
      throw new Error("internal: a cycle id has no position");
    }
    return at;
  };
  cycles.sort((a, b) => firstPosition(a) - firstPosition(b));

  const diagnostics: Diagnostic[] = [];
  const byId = new Map<ValueId, NamedNode>(nodes.map((n) => [n.id, n]));
  for (const cycle of cycles) {
    // A cycle lists ids of `nodes`, so every id has a node.
    const members = cycle.map((id) => {
      const node = byId.get(id);
      if (node === undefined) {
        throw new Error("internal: a cycle id has no signature");
      }
      return node;
    });
    const first = members.find((m) => m.kind === "constant") ?? members[0];
    const loop = [...cycle.map(shortName), shortName(cycle[0])].join(" -> ");
    diagnostics.push(makeDiagnostic(
      "module/004",
      `module initialization cycle: ${loop}`,
      first.nameSpan,
      members.filter((m) => m !== first).map((m) => ({
        span: m.nameSpan,
        message: "also part of the cycle",
      })),
    ));
  }
  return diagnostics;
}
