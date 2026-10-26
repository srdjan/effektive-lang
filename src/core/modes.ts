// Execution modes and open effect sets of recursive groups (design I1 and I4).
// Modules are acyclic, so a strongly connected component of the module-local
// call graph never spans modules. The solver starts every pending member at
// `pure` with empty sets, runs one round of body checks against the current
// state, and repeats until nothing changes. A mode only moves from `pure` to
// `effect`, and a set only grows, so the rounds end. A round cap guards the
// loop all the same.

import type { CapabilityId, ErrorId, Execution, ValueId } from "./ir.ts";
import { sortedUnique } from "./util.ts";

/** The most rounds that one group may take (design 4.6, resource caps). */
const ROUND_CAP = 32;

/** The invocation state of a function that its body decides: the mode and the sets. */
export interface Solved {
  readonly mode: Execution;
  /** Sorted and unique. */
  readonly failures: readonly ErrorId[];
  /** Sorted and unique. */
  readonly requirements: readonly CapabilityId[];
}

/** What one round of body checks returns. */
interface Round<R> {
  /** The checks of this round. The last round's results are the final ones. */
  readonly results: R;
  /** The state that each pending member computed against the assumed state. */
  readonly computed: ReadonlyMap<ValueId, Solved>;
}

interface GroupSolution<R> {
  /** The settled state of the pending members. */
  readonly solved: ReadonlyMap<ValueId, Solved>;
  /** The results of the last round. When `settled`, they used the final modes. */
  readonly results: R;
  readonly rounds: number;
  /** False when the round cap ended the loop. */
  readonly settled: boolean;
}

const PURE: Solved = { mode: "pure", failures: [], requirements: [] };

/** The join of two states: `effect` wins, and the sets unite. */
function join(a: Solved, b: Solved): Solved {
  return {
    mode: a.mode === "effect" || b.mode === "effect" ? "effect" : "pure",
    failures: sortedUnique([...a.failures, ...b.failures]),
    requirements: sortedUnique([...a.requirements, ...b.requirements]),
  };
}

function same(a: Solved, b: Solved): boolean {
  return a.mode === b.mode && a.failures.length === b.failures.length &&
    a.requirements.length === b.requirements.length;
}

/**
 * Solves the mode and set equations of one group. `pending` lists the members
 * whose mode or sets the body decides. `round` checks every member of the group
 * against the assumed state. A join keeps the state monotone, so `same` can
 * compare lengths.
 */
export function solveModeGroup<R>(
  pending: readonly ValueId[],
  round: (assumed: ReadonlyMap<ValueId, Solved>) => Round<R>,
  cap: number = ROUND_CAP,
): GroupSolution<R> {
  let solved = new Map<ValueId, Solved>(pending.map((id) => [id, PURE]));
  for (let rounds = 1;; rounds++) {
    const result = round(solved);
    const next = new Map(solved);
    let changed = false;
    for (const id of pending) {
      const before = solved.get(id) ?? PURE;
      const after = join(before, result.computed.get(id) ?? PURE);
      if (!same(after, before)) changed = true;
      next.set(id, after);
    }
    if (!changed) {
      return { solved, results: result.results, rounds, settled: true };
    }
    solved = next;
    if (rounds >= cap) {
      return { solved, results: result.results, rounds, settled: false };
    }
  }
}
