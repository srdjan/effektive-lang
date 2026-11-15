# Old survivors of the declaration and editor indexes, 2026-11-15

This plan uses the prefixes IX (items) and IXU (units). It applies decision D4 of the [old survivors plan](../archive/plans/2026-11-15-old-survivors.md), open item OS5. On 2026-11-15 the user chose option (a): each old survivor gets a test or a register row.

Status: approved. The units have started.

## Items

| ID | Item | Evidence |
| --- | --- | --- |
| IX1 | 12 survivors in `src/core/editor_index.ts` have no test and no row. They are in `isArrowDeclaration`, `localScope`, `symbolIndex`, `occurrenceAt`, and `referencesAt`. | Full mutation runs at `82d8b0d` and at `30bf1b1`. |
| IX2 | The `\|\|` mutant of `parent >= 0 &&` in `localScope` times out, also alone with `--only`. The probable cause is a parent walk that never stops at the root. | The same runs, and an isolated rerun. |
| IX3 | 2 survivors in `src/core/declaration_index.ts` have no test and no row. Both are in `isArrowConst`. | The same runs. |

## Rules

The rules of the [old survivors plan](../archive/plans/2026-11-15-old-survivors.md#rules) apply. A survivor gets a test when an input can observe it. Otherwise it gets an `equivalent` row that a differential probe with a reach count supports, or a `slow-only` row. A reason names functions and types, not line numbers. A survivor that shows a defect gets no test that pins the defect.

A timeout is not a kill. IX2 is closed when an isolated rerun confirms the hang, and a reading of the loop explains it. A test cannot fail fast on a loop that never stops, so a test is not required for IX2.

## Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| IXU1 | Sonnet | IX1, IX2 | `tests/editor_index_mutation_test.ts` (new), and new rows at the end of `fixtures/mutation/survivors.json` | `deno task mutate --seed 1 --sample all src/core/editor_index.ts` exits 0. The handback explains each timeout. The fast gate exits 0 at each commit. | 80 |
| IXU2 | Opus | IX3 | `tests/declaration_index_mutation_test.ts` (new), and new rows before the first `src/core/resolve.ts` row | `deno task mutate --seed 1 --sample all src/core/declaration_index.ts` exits 0. | direct |
| IXU3 | Opus | all | all | Opus reviews the IXU1 diff line by line and lands it with `git cherry-pick`. `deno task check` exits 0 on `main`. | direct |

IXU1 works in a detached worktree under `~/.claude/scratch/`, made from local `main` at the plan commit. IXU2 works on `main` while IXU1 runs. The two units add rows at different places in the register, so they do not change the same lines.
