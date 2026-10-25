// Graph helpers shared by the checker, the project loader, and the emitter.

/**
 * Strongly connected components of a graph over the nodes `0 .. count - 1`. The
 * result lists components so that a component comes after every component that
 * it reaches: callees before callers. A component lists its nodes in ascending
 * order. `edges[n]` lists the nodes that `n` points to.
 */
export function stronglyConnectedComponents(
  count: number,
  edges: readonly (readonly number[])[],
): number[][] {
  const index = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  // An explicit stack keeps long reference chains from overflowing the call stack.
  const visit = (root: number): void => {
    const frames: { node: number; next: number }[] = [{ node: root, next: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = edges[frame.node] ?? [];
      if (frame.next < targets.length) {
        const next = targets[frame.next++];
        if (index[next] < 0) {
          index[next] = low[next] = counter++;
          stack.push(next);
          onStack[next] = true;
          frames.push({ node: next, next: 0 });
        } else if (onStack[next]) {
          low[frame.node] = Math.min(low[frame.node], index[next]);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low[parent.node] = Math.min(low[parent.node], low[frame.node]);
      }
      if (low[frame.node] !== index[frame.node]) continue;
      const component: number[] = [];
      for (
        let member = stack.pop();
        member !== undefined;
        member = stack.pop()
      ) {
        onStack[member] = false;
        component.push(member);
        if (member === frame.node) break;
      }
      components.push(component.sort((a, b) => a - b));
    }
  };
  for (let n = 0; n < count; n++) {
    if (index[n] < 0) visit(n);
  }
  return components;
}
