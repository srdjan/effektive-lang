# Old mutation survivors and register reasons, 2026-11-15

This plan uses the prefixes OS (items) and OSU (units). It applies three decisions of the [fresh-eyes review](2026-11-15-fresh-eyes-review.md). On 2026-11-15 the user accepted the recommended option of each decision.

Status: complete. All five units are on local `main`. The [results](#results) section records the checks, one deviation, and one open item.

## Decisions

| Decision | Result |
| --- | --- |
| D1 (open item FYO1) | A plan gives each old survivor a test, or a register row that a probe supports. |
| D2 (Step 4 candidates) | Only FYA1: call the existing `nodeText` at the sites that slice node text by hand. |
| D3 (line numbers in reasons) | Rewrite each register reason that cites a line number, and add a census test that rejects such a citation. |

## Items

| ID | Item | Evidence |
| --- | --- | --- |
| OS1 | 17 survivors in `src/core/resolve.ts` have no test and no row. | Full mutation runs at `327cc9f` and at `d0cced7`. |
| OS2 | 4 survivors in `scripts/behavior_compare.ts` have no test and no row: `exportRevisionTree` (`exported.ok`), `materializeForged` (`filled === undefined`, two operators), and `records` (`!forged.ok`). | The same runs. |
| OS3 | 9 of 143 register reasons cite a line number such as `ir.ts:7`. A line number goes stale, and 2 cited lines pointed at other code at `327cc9f`. | A scan of `fixtures/mutation/survivors.json`. |
| OS4 | `src/core/declaration_index.ts`, `src/core/editor_hints.ts`, and `src/core/editor_index.ts` slice node text by hand. `nodeText` in `src/core/syntax.ts` does the same. | `git grep` of `text.slice(tree.starts[`. |

## Rules

A survivor gets a test when an input can observe the mutant. Otherwise it gets a row of class `equivalent` or `slow-only`, as `docs/testing.md` describes.

An `equivalent` row needs a differential probe with a reach count, as [the probe note](../../solutions/workflow-issues/mutation-equivalent-rows-need-a-differential-probe.md) describes. A `slow-only` row needs a run of the named slow test against a copy that holds the mutant. A reason names functions and types, not line numbers.

A survivor that shows a defect gets no test that pins the defect. The unit records the finding and stops work on that survivor.

A timeout counts as a kill only after an isolated rerun with `--only`.

## Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| OSU1 | Sonnet | OS1 | `tests/resolve_mutation_test.ts` (new), and the `src/core/resolve.ts` rows of `fixtures/mutation/survivors.json` | `deno task mutate --seed 1 --sample all src/core/resolve.ts` exits 0. The fast gate exits 0 at each commit. | 80 |
| OSU2 | Opus | OS2 | the `scripts/behavior_compare.ts` rows of `fixtures/mutation/survivors.json` | `deno task mutate --seed 1 --sample all scripts/behavior_compare.ts` exits 0. | direct |
| OSU3 | Opus | OS3 | `tests/mutate_slow_test.ts`, the 9 rows | The new test fails on the 9 rows before the rewrite, and passes after it. | direct |
| OSU4 | Opus | OS4 | the 3 files of OS4 | The fast gate exits 0. A full mutation run of each file leaves no survivor without a row. | direct |
| OSU5 | Opus | all | all | Opus reviews the OSU1 diff line by line and lands it with `git cherry-pick`. `deno task check` exits 0 on `main`. | direct |

OSU1 works in a detached worktree under `~/.claude/scratch/`, made from local `main` at the plan commit. OSU2-OSU4 work on `main` while OSU1 runs. Each unit adds rows next to the rows of its own file, so the units do not change the same lines.

## Results

| Unit | Commits | Result |
| --- | --- | --- |
| OSU1 | `e049359`, `45feb98` | 7 tests in `tests/resolve_mutation_test.ts` kill 11 mutants. 6 `equivalent` rows cover the rest. Each row rests on a probe of 19169 inputs: each fixture whole, at every 11th prefix, and with each line deleted. No survivor showed a defect. Opus changed the test helper to use `assert`, and corrected the count in the commit body. |
| OSU2 | `c4f70a8` | 4 `slow-only` rows. `tests/behavior_compare_slow_test.ts` failed against a copy that held each mutant. |
| OSU3 | `82d8b0d` | 9 reasons name functions and types. The new census test failed on the 9 rows before the rewrite, and it passes after it. |
| OSU4 | `30bf1b1` | 3 sites call `nodeText`. |
| OSU5 | this section | Opus reviewed the OSU1 diff line by line, and recounted the probe outputs that the rows cite. The fast gate exited 0 at each OSU1 commit. |

Opus ran these checks on `main` at `45feb98`:

| Check | Result |
| --- | --- |
| `deno task check` | exit 0: 3285 fast tests and 325 slow tests passed |
| `deno task mutate --seed 1 --sample all scripts/behavior_compare.ts` | exit 0: 50 sites, 10 survivors, all with rows, no timeout, 39 s |
| `deno task mutate --seed 1 --sample all src/core/resolve.ts` | exit 0: 331 sites, 8 survivors, all with rows, no timeout, 101 s |
| `deno task mutate --seed 1 --sample all src/core/editor_hints.ts` | exit 0 at `30bf1b1`: 42 sites, no survivor, 32 s |

Deviation: the OSU4 check needs a full run of each file with no survivor without a row. It fails for `declaration_index.ts` and `editor_index.ts`. Runs at `82d8b0d`, before OSU4, found the same survivors by declaration, operator, and text. OSU4 moved some offsets by 31 characters, which is the length that `nodeText` saves. So OSU4 added no survivor. These survivors are open item OS5.

## Open items

| ID | Item | Owner |
| --- | --- | --- |
| OS5 | Survivors without a row that existed before this plan: 2 in `src/core/declaration_index.ts` (`eq < 0`, and `kind !== SyntaxKind.Token && kind !== SyntaxKind.Missing`), and 12 in `src/core/editor_index.ts` (in `isArrowDeclaration`, `localScope`, `occurrenceAt`, `referencesAt`, and `symbolIndex`). The `\|\|` mutant of `parent >= 0 &&` in `localScope` times out alone with `--only`. The probable cause is a parent walk that never stops. That site also needs a test or a row. | The user decides whether a plan takes them. |
