// The eager dependency graph of module initialization. A module constant
// depends on each declaration that its initializer references. A reference to a
// function adds every declaration that the function body references,
// transitively. A cycle that holds a constant cannot be initialized. The emitter
// orders the emitted constants by `order`.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import { stronglyConnectedComponents } from "./graph.ts";
import { shortName } from "./ids.ts";
import type { ValueId } from "./ir.ts";
import type { Span } from "./source.ts";

export interface InitializationGraph {
  /** Module constants in source order. */
  readonly constants: readonly ValueId[];
  /**
   * For each constant, the other constants that must be initialized first. A
   * reference through functions counts. Sorted by source order.
   */
  readonly dependencies: ReadonlyMap<ValueId, readonly ValueId[]>;
  /** The constants in an order that satisfies `dependencies`. Source order breaks ties. */
  readonly order: readonly ValueId[];
  /** Each cycle that holds a constant, as its members in source order. */
  readonly cycles: readonly (readonly ValueId[])[];
}

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

/** Builds the graph. `nodes` lists every function and constant in source order. */
function buildInitializationGraph(
  nodes: readonly InitializationNode[],
): InitializationGraph {
  const position = new Map<ValueId, number>();
  nodes.forEach((node, i) => position.set(node.id, i));
  const edges = referenceEdges(nodes);
  const constants = nodes.filter((n) => n.kind === "constant").map((n) => n.id);

  const dependencies = new Map<ValueId, readonly ValueId[]>();
  nodes.forEach((node, start) => {
    if (node.kind !== "constant") return;
    const found = new Set<number>();
    const seen = new Set<number>([start]);
    const pending = [...edges[start]];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (nodes[next].kind === "constant") {
        found.add(next);
      } else {
        for (const edge of edges[next]) {
          pending.push(edge);
        }
      }
    }
    dependencies.set(
      node.id,
      [...found].sort((a, b) => a - b).map((p) => nodes[p].id),
    );
  });

  const cycles: ValueId[][] = [];
  for (const component of stronglyConnectedComponents(nodes.length, edges)) {
    const selfLoop = component.length === 1 &&
      edges[component[0]].includes(component[0]);
    if (component.length === 1 && !selfLoop) continue;
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

  // Kahn's algorithm. A constant in a cycle never becomes ready, so the leftover
  // constants follow in source order.
  const remaining = new Map<ValueId, Set<ValueId>>();
  for (const id of constants) {
    // Every constant got an entry in the dependency loop above.
    const found = dependencies.get(id);
    if (found === undefined) {
      throw new Error("internal: a constant has no dependency entry");
    }
    const pending = new Set(found);
    pending.delete(id);
    remaining.set(id, pending);
  }
  const order: ValueId[] = [];
  const done = new Set<ValueId>();
  while (done.size < constants.length) {
    const ready = constants.find((id) => {
      if (done.has(id)) return false;
      // `remaining` holds every constant.
      const pending = remaining.get(id);
      if (pending === undefined) {
        throw new Error("internal: a constant has no pending set");
      }
      return [...pending].every((d) => done.has(d));
    });
    const next = ready ?? constants.find((id) => !done.has(id));
    // The loop runs while a constant is left, so `find` always succeeds.
    if (next === undefined) throw new Error("internal: no constant is left");
    done.add(next);
    order.push(next);
  }

  return { constants, dependencies, order, cycles };
}

/** A node with the span of its name, for the cycle diagnostics. */
interface NamedNode extends InitializationNode {
  readonly nameSpan: Span;
}

/** The initialization graph of the nodes, and one `module/004` diagnostic for each cycle. */
export function checkInitialization(nodes: readonly NamedNode[]): {
  readonly graph: InitializationGraph;
  readonly diagnostics: readonly Diagnostic[];
} {
  const graph = buildInitializationGraph(nodes);
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<ValueId, NamedNode>(nodes.map((n) => [n.id, n]));
  for (const cycle of graph.cycles) {
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
  return { graph, diagnostics };
}
