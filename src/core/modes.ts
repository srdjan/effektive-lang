// Execution modes and open effect sets of recursive groups (design I1 and I4).
// Modules are acyclic, so a strongly connected component of the module-local
// call graph never spans modules. The solver starts every pending member at
// `pure` with empty sets, runs one round of body checks against the current
// state, and repeats until nothing changes. A mode only moves from `pure` to
// `effect`, and a set only grows, so the rounds end. A round cap guards the
// loop all the same.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import type { CapabilityId, ErrorId, Execution, ValueId } from "./ir.ts";
import type { Span } from "./source.ts";
import { sortedUnion } from "./effect_set.ts";
import { mapFrom } from "./runtime.ts";

/** The most rounds that one group may take (design 4.6, resource caps). */
const ROUND_CAP = 32;
export type RecursiveName = string;
export type RoundCap = number;

/** `execution-mode/003`: a member of a recursive group lacks a written parameter or result type. */
export function recursiveAnnotationDiagnostic(
  name: RecursiveName,
  nameSpan: Span,
): Diagnostic {
  return makeDiagnostic(
    "execution-mode/003",
    `\`${name}\` is recursive, so it needs explicit parameter and result annotations`,
    nameSpan,
  );
}

/** `execution-mode/004`: the group of `name` did not settle within the round cap. */
export function unsettledGroupDiagnostic(
  name: RecursiveName,
  nameSpan: Span,
): Diagnostic {
  return makeDiagnostic(
    "execution-mode/004",
    `the execution modes and effect sets of the recursive group with \`${name}\` did not settle within the round cap`,
    nameSpan,
  );
}

/** The invocation state of a function that its body decides: the mode and the sets. */
export type Solved = {
  readonly mode: Execution;
  /** Sorted and unique. */
  readonly failures: readonly ErrorId[];
  /** Sorted and unique. */
  readonly requirements: readonly CapabilityId[];
};

type Round<R> = {
  /** The checks of this round. The last round's results are the final ones. */
  readonly results: R;
  /** The state that each pending member computed against the assumed state. */
  readonly computed: ReadonlyMap<ValueId, Solved>;
};

type GroupSolution<R> = {
  readonly solved: ReadonlyMap<ValueId, Solved>;
  /** The results of the last round. When `settled`, they used the final modes. */
  readonly results: R;
  readonly rounds: number;
  /** False when the round cap ended the loop. */
  readonly settled: boolean;
};

const PURE: Solved = { mode: "pure", failures: [], requirements: [] };

/** The join of two states: `effect` wins, and the sets unite. */
function join(a: Solved, b: Solved): Solved {
  return {
    mode: a.mode === "effect" || b.mode === "effect" ? "effect" : "pure",
    failures: sortedUnion([a.failures, b.failures]),
    requirements: sortedUnion([a.requirements, b.requirements]),
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
  cap: RoundCap | undefined,
): GroupSolution<R> {
  const resolvedCap = cap ?? ROUND_CAP;
  function solveRound(
    solved: ReadonlyMap<ValueId, Solved>,
    rounds: RoundCap,
  ): GroupSolution<R> {
    const result = round(solved);
    const nextEntries = [...solved].map((entry) => {
      const id = entry[0];
      const before = entry[1];
      const after = join(before, result.computed.get(id) ?? PURE);
      return [id, after] as const;
    });
    const next = mapFrom(nextEntries);
    const changed = nextEntries.some((entry) => {
      const id = entry[0];
      const after = entry[1];
      return !same(after, solved.get(id) ?? PURE);
    });
    if (!changed) {
      return {
        solved: solved,
        results: result.results,
        rounds: rounds,
        settled: true,
      };
    }
    if (rounds >= resolvedCap) {
      return {
        solved: next,
        results: result.results,
        rounds: rounds,
        settled: false,
      };
    }
    return solveRound(next, rounds + 1);
  }
  return solveRound(
    mapFrom(pending.map((id) => [id, PURE] as const)),
    1,
  );
}
