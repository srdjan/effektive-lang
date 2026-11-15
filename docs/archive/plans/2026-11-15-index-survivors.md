# Old survivors of the declaration and editor indexes, 2026-11-15

This plan uses the prefixes IX (items) and IXU (units). It applies decision D4 of the [old survivors plan](2026-11-15-old-survivors.md), open item OS5. On 2026-11-15 the user chose option (a): each old survivor gets a test or a register row.

Status: complete. All three units are on local `main`. The [results](#results) section records the checks.

## Items

| ID | Item | Evidence |
| --- | --- | --- |
| IX1 | 12 survivors in `src/core/editor_index.ts` have no test and no row. They are in `isArrowDeclaration`, `localScope`, `symbolIndex`, `occurrenceAt`, and `referencesAt`. | Full mutation runs at `82d8b0d` and at `30bf1b1`. |
| IX2 | The `\|\|` mutant of `parent >= 0 &&` in `localScope` times out, also alone with `--only`. The probable cause is a parent walk that never stops at the root. | The same runs, and an isolated rerun. |
| IX3 | 2 survivors in `src/core/declaration_index.ts` have no test and no row. Both are in `isArrowConst`. | The same runs. |

## Rules

The rules of the [old survivors plan](2026-11-15-old-survivors.md#rules) apply. A survivor gets a test when an input can observe it. Otherwise it gets an `equivalent` row that a differential probe with a reach count supports, or a `slow-only` row. A reason names functions and types, not line numbers. A survivor that shows a defect gets no test that pins the defect.

A timeout is not a kill. IX2 is closed when an isolated rerun confirms the hang, and a reading of the loop explains it. A test cannot fail fast on a loop that never stops, so a test is not required for IX2.

## Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| IXU1 | Sonnet | IX1, IX2 | `tests/editor_index_mutation_test.ts` (new), and new rows at the end of `fixtures/mutation/survivors.json` | `deno task mutate --seed 1 --sample all src/core/editor_index.ts` exits 0. The handback explains each timeout. The fast gate exits 0 at each commit. | 80 |
| IXU2 | Opus | IX3 | `tests/declaration_index_mutation_test.ts` (new), and new rows before the first `src/core/resolve.ts` row | `deno task mutate --seed 1 --sample all src/core/declaration_index.ts` exits 0. | direct |
| IXU3 | Opus | all | all | Opus reviews the IXU1 diff line by line and lands it with `git cherry-pick`. `deno task check` exits 0 on `main`. | direct |

IXU1 works in a detached worktree under `~/.claude/scratch/`, made from local `main` at the plan commit. IXU2 works on `main` while IXU1 runs. The two units add rows at different places in the register, so they do not change the same lines.

## Results

| Unit | Commits | Result |
| --- | --- | --- |
| IXU1 | `4db0bad`, `dc1365d` | 2 tests in `tests/editor_index_mutation_test.ts` kill 2 mutants. 10 `equivalent` rows cover the rest. Seven rest on the parser fact that `Parser.end` gives a parent a higher id than each child, so no parent id is 0. Three rest on the fact that each occurrence span is one identifier token, so two spans never overlap or touch, and no span is empty. A probe of 7844 inputs supports each row, and 2 control mutants changed 7554 and 4992 output lines. Opus corrected the wording of the `binding >= 0` reason: the node is the grandparent of the binding field, not of the name. |
| IXU2 | `72cf9c0` | A `documentSymbols` test kills the value-filter mutant of `isArrowConst`. When an arrow starts on the line after `=`, a newline token comes between `=` and the arrow. The `eq < 0` mutant gets an `equivalent` row, because `parseConstBody` consumes the `const` keyword before `=`. A probe of 21124 inputs supports it. |
| IXU3 | this section | Opus reviewed the IXU1 diff line by line, read the parser and index code that each reason cites, and recounted the probe outputs. The fast gate exited 0 at each IXU1 commit. |

IX2 is closed. With the `\|\|` mutant, the walk in `localScope` does not stop at the first scope node. It climbs to the root, where the parent id is -1. `kindOf` of -1 is undefined, so the loop continues with an undefined parent and never ends. An isolated `--only` rerun repeats the timeout. The probable cause in this plan's items table was close, but this is the exact path.

Opus ran these checks on `main` at `dc1365d`:

| Check | Result |
| --- | --- |
| `deno task check` | exit 0: 3288 fast tests and 325 slow tests passed |
| `deno task mutate --seed 1 --sample all src/core/declaration_index.ts` | exit 0: 42 sites, 1 survivor with a row, no timeout, 18 s |
| `deno task mutate --seed 1 --sample all src/core/editor_index.ts` | exit 0: 58 sites, 10 survivors with rows, 1 timeout (IX2), 84 s |
