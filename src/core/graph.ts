// Graph helpers shared by the checker, the project loader, and the emitter.

import { indices } from "./runtime.ts";

export type GraphIndex = number;
export type GraphCount = number;
export type GraphComponent = readonly GraphIndex[];
export type GraphEdges = readonly GraphComponent[];
export type GraphComponents = readonly GraphComponent[];
export type Cycle = boolean;

/** Whether a component of `stronglyConnectedComponents` is a cycle: it has two nodes or a self-loop. */
export function isCycle(
  component: GraphComponent,
  edges: GraphEdges,
): Cycle {
  return component.length > 1 || edges[component[0]].includes(component[0]);
}

/**
 * Strongly connected components of a graph over the nodes `0 .. count - 1`. The
 * result lists components so that a component comes after every component that
 * it reaches: callees before callers. A component lists its nodes in ascending
 * order. `edges[n]` lists the nodes that `n` points to.
 */
export function stronglyConnectedComponents(
  count: GraphCount,
  edges: GraphEdges,
): GraphComponents {
  const index = Array.from(indices(count), () => -1);
  const low = Array.from(indices(count), () => 0);
  const onStack = Array.from(indices(count), () => false);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  // An explicit stack keeps long reference chains from overflowing the call stack.
  const stepBound = count + edges.reduce(
    (total, targets) => total + targets.length,
    0,
  );

  function visit(root: GraphIndex): undefined {
    const frames: { node: number; next: number }[] = [{ node: root, next: 0 }];
    index[root] = counter;
    low[root] = counter;
    counter = counter + 1;
    stack[stack.length] = root;
    onStack[root] = true;
    for (const _step of indices(stepBound)) {
      if (frames.length === 0) return undefined;
      const frame = frames[frames.length - 1];
      const targets = edges[frame.node] ?? [];
      if (frame.next < targets.length) {
        const next = targets[frame.next];
        frame.next = frame.next + 1;
        if (index[next] < 0) {
          index[next] = counter;
          low[next] = counter;
          counter = counter + 1;
          stack[stack.length] = next;
          onStack[next] = true;
          frames[frames.length] = { node: next, next: 0 };
        } else if (onStack[next]) {
          low[frame.node] = Math.min(low[frame.node], index[next]);
        }
        continue;
      }
      const _removedFrame = frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low[parent.node] = Math.min(low[parent.node], low[frame.node]);
      }
      if (low[frame.node] !== index[frame.node]) continue;
      const component: number[] = [];
      const memberBound = stack.length;
      for (const _memberIndex of indices(memberBound)) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack[member] = false;
        component[component.length] = member;
        if (member === frame.node) break;
      }
      components[components.length] = component.sort((a, b) => a - b);
    }
    return undefined;
  }
  for (const node of indices(count)) {
    if (index[node] < 0) {
      const _visited = visit(node);
    }
  }
  return components;
}
