# Remaining follow-ups of the knots work

Status: complete on local `main`. On 2026-11-07 the user asked to complete the remaining tasks by the recommendations of the knots follow-up. The user pushes; this plan does not.

## Units

| Unit | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| RTU1 (relocate stale register rows) | Opus | `fixtures/mutation/survivors.json` | The register census finds 0 stale rows. Each moved row keeps its text and operator. | direct |
| RTU2 (first mutation pass of `scripts/lib.ts`) | Sonnet | `scripts/lib.ts` tests, `fixtures/mutation/survivors.json` | `deno task mutate --sample all scripts/lib.ts` exits 0. | 40 |
| RTU3 (kill the `editor_index.ts:175` survivor) | Sonnet | one test file | The new test fails on the `\|\|` to `&&` mutant and passes on the source. | 30 |
| RTU4 (website version 0.15.4) | Opus | `../effektive` | `deno task test` passes in `../effektive`. | direct |
| RTU5 (decide the four open items) | Opus | `docs/status.md`, this plan | Each item has a decision with its reason, and the code change if one is needed. | direct |
| RTU6 (one `from` rule for both highlighters) | Sonnet | `src/core/lex.ts`, `src/core/frontend.ts`, `src/core/editor_tokens.ts`, `playground/src/highlight.ts`, two test files, `fixtures/surface/lsp.json`, `CHANGELOG.md` | New tests fail before the fix and pass after it. Only `from` entries change in the surface snapshot. | 40 |

## RTU1 facts

A census of all 26 register files found 50 stale rows on 2026-11-07:

- 40 rows moved inside their declaration. One current site has the same operator and text.
- 1 row moved from `defaultKeyOp` to `defaultKeyChoice` in `src/core/check_builtins/schema.ts`.
- 4 rows of `src/core/types.ts` are leftovers. `guardedRecord` moved to `src/core/recursion_guard.ts`, which has its own 4 current rows.
- 5 rows of `scripts/mutate.ts` and `scripts/behavior_compare.ts` cover subprocess checks that moved to `scripts/lib.ts`. RTU2 covers that file.

RTU1 moves the 41 rows, deletes the 9 others, and checks the reason of each moved row against the current declaration.

## Decisions

RTU5 decides the four open items that the knots follow-up added to `docs/status.md`.

- RTD1 (hardcoded severity): no change. The core has one severity, `error`. A severity map in each adapter would serve only a possible future severity, and the knots plan already judged it speculative.
- RTD2 (sealed-type authority): the form is on purpose. Only the `null` equality in `src/core/check_binary.ts` and the literal pattern test in `src/core/patterns.ts` call `isAssignable`, and neither builds a value. A doc comment on `TypeTable.isAssignable` now says so.
- RTD3 (`from` highlighting): both highlighters were partly wrong. The editor marked `from` as a name in an import, and the playground marked it as a keyword in `const from = 1`. The parser checks `from` only before the module path string. RTU6 adds that rule to `src/core/lex.ts`, and both highlighters use it.
- RTD4 (`\r\n` position rule): no change. With `\r\n` line ends, the 164 `.eff` fixtures give 392 diagnostics, and none has an offset between a `\r` and its `\n`. The language server moves each client position to the line end.

## Results

- RTU1 (`28cbf49`): 41 rows moved, 9 rows deleted. The census finds 0 stale rows. A new test, "each row of the survivor register matches exactly one current site" in `tests/mutate_slow_test.ts`, keeps the register current. It fails on a copy with one shifted row.
- RTU2 (`229bf42` to `7a600cb`): the first run found 17 survivors in `scripts/lib.ts`. No fast test can start a process, so each survivor has a `slow-only` row, proven on a mutated copy. New slow tests kill the ones that no test covered. The timeout test used a process that never ended, so two mutants made it hang. Its process now ends after 5 s, and the test fails under both mutants. `deno task mutate --sample all scripts/lib.ts` exits 0.
- RTU3 (`3c4b007`): a rename test kills the `editor_index.ts:175` mutant. Under the mutant, the error changes to "The rename would capture or conflict with another binding."
- RTU4 (`../effektive` `045ba13`): the site version is 0.15.4, with stamped assets. `deno task test` passes in `../effektive`.
- RTU5: the four decisions above. RTD2 is the doc comment in `cf0c33a`.
- RTU6 (`3c4f746`): `isFromKeyword` in `src/core/lex.ts`. Two new tests failed before the fix. Two surface snapshot entries changed, both `from` tokens.
- A directed mutation run on the changed lines of `editor_index.ts`, `lex.ts`, `editor_tokens.ts`, and `playground/src/highlight.ts` killed all 8 mutants.

