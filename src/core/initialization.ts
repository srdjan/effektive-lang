// The initialization cycles of a module. A module constant depends on each
// declaration that its initializer references. A reference to a function adds
// every declaration that the function body references, transitively. A cycle
// that holds a constant cannot be initialized. The emitter orders the emitted
// constants itself, from the IR.

import { type Diagnostic, makeDiagnosticWithRelated } from "./diagnostics.ts";
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import { shortName } from "./ids.ts";
import type { ValueId } from "./ir.ts";
import { emptyMap, setFrom } from "./runtime.ts";
import type { Span } from "./source.ts";

type InitializationNode = {
  readonly id: ValueId;
  readonly kind: "function" | "constant";
  /** Module-level declarations that the body or initializer references. */
  readonly references: readonly ValueId[];
};

/**
 * For each node, the sorted positions of the nodes that its references name.
 * A reference to an id outside `nodes` is dropped.
 */
export type ReferenceEdges = readonly (readonly number[])[];

export function referenceEdges(
  nodes: readonly {
    readonly id: ValueId;
    readonly references: readonly ValueId[];
  }[],
): ReferenceEdges {
  let position = emptyMap<ValueId, number>();
  for (const entry of nodes.entries()) {
    const index = entry[0];
    const node = entry[1];
    position = position.set(node.id, index);
  }
  return nodes.map((node) =>
    [...setFrom(node.references)]
      .map((id) => position.get(id))
      .filter((p): p is number => p !== undefined)
      .sort((a, b) => a - b)
  );
}

/** A node with the span of its name, for the cycle diagnostics. */
type NamedNode = InitializationNode & {
  readonly nameSpan: Span;
};

/** One `module/004` diagnostic for each initialization cycle of the nodes. */
export function checkInitialization(
  nodes: readonly NamedNode[],
): readonly Diagnostic[] {
  const edges = referenceEdges(nodes);
  const cycles: { readonly at: number; readonly members: NamedNode[] }[] = [];
  for (const component of stronglyConnectedComponents(nodes.length, edges)) {
    if (!isCycle(component, edges)) continue;
    if (!component.some((p) => nodes[p].kind === "constant")) continue;
    cycles[cycles.length] = {
      at: component[0],
      members: component.map((p) => nodes[p]),
    };
  }
  const sortedCycles = cycles.toSorted((a, b) => a.at - b.at);

  const diagnostics: Diagnostic[] = [];
  for (const cycle of sortedCycles) {
    const members = cycle.members;
    const first = members.find((m) => m.kind === "constant") ?? members[0];
    const ids = members.map((m) => m.id);
    const loop = [...ids.map(shortName), shortName(ids[0])].join(" -> ");
    diagnostics[diagnostics.length] = makeDiagnosticWithRelated(
      "module/004",
      `module initialization cycle: ${loop}`,
      first.nameSpan,
      members.filter((m) => m !== first).map((m) => ({
        span: m.nameSpan,
        message: "also part of the cycle",
      })),
    );
  }
  return diagnostics;
}
