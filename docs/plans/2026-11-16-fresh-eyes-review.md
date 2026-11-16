# Fresh-eyes review 2, 2026-11-16

Status: the user decided FZD1-FZD6 and approved the plan FZU1-FZU16 on 2026-11-16. Execution has started.

This document owns the findings, the decisions, and the plan of the second fresh-eyes review. FZ means a finding, FZD a decision, and FZU a unit of the plan.

The scope is the whole repository at `54e9e42b`. Commit `ff0dc9fa` (a pre-commit lint hook) changed no source file, so the line numbers also hold at `ff0dc9fa`. The first review ([2026-11-15](../archive/plans/2026-11-15-fresh-eyes-review.md)) ran before commit `76d63bfe`. That commit adopted the Light FP lint 0.8.0 and rewrote 305 files. Most findings below are residue of that rewrite. Each proposed change must stay lint-clean.

## Baseline

Opus measured these values at `54e9e42b` on 2026-11-16.

| Measure | Value |
| --- | --- |
| `deno task check` | Exit 0 in 9 minutes 20 seconds: format, lint, type check, 3312 fast tests passed and 6 ignored, 325 slow tests passed. The examiners started during this run, and the load average rose from 2 to 17. |
| Slow suite | 9 minutes 3 seconds. The two tests in `tests/proof_budget_slow_test.ts` took 4 minutes 14 seconds and 4 minutes 40 seconds. The adoption plan recorded 8 minutes 21 seconds for the slow suite. The review of 2026-11-15 recorded 53 seconds for the full gate. |
| Coverage | Both suites with coverage at HEAD: 151 source files. The slow suite took 15 minutes 16 seconds under load. Opus used the uncovered line ranges to check the test gaps. |
| Source lines under `src/` | 60719 |

## Decisions

On 2026-11-16 the user answered "as recommended". That answer selects option (a) for each of FZD1-FZD6.

| ID | Decision | Options | Decided |
| --- | --- | --- | --- |
| FZD1 | Scope of the cleanup | (a) All cleanup findings except the rejected rows and the rows marked "low". (b) Only the repository-wide residue FZ1-FZ10 and the dead code. (c) All rows, including the low rows. | (a) |
| FZD2 | FZ90, the resolver lookup loop without an exit | (a) Fix it first, as its own unit. Outputs do not change. (b) Leave it. | (a) |
| FZD3 | FZ91, the shorthand field escapes the scoped-operation rule | (a) Write a failing test, then count shorthand fields. This adds a diagnostic. (b) Record it and leave it. | (a) |
| FZD4 | FZ92, `generatedSourceOf` accepts more header lines than the old regex | (a) Restore the language of the old regex with a failing test first. (b) Keep the new language and document it. | (a) |
| FZD5 | FZ93, the pipe form of an error constructor infers a different input type than the call form | (a) Write a failing test, then give the pipe form the error-constructor branch, as FY130 did for a callback. (b) Leave it. | (a) |
| FZD6 | FZ100-FZ114, the behavior-changing candidates | (a) Keep them out of this pass, in this ledger. (b) Decide each one now. | (a) |

During FZU16 the orchestrator asked three more questions. The user did not answer within 60 seconds, so the orchestrator took the recommended option (a) of each. The user can still reverse each one.

| ID | Decision | Options | Decided |
| --- | --- | --- | --- |
| FZD7 | Scope of the register refresh. A full run of the 3366 sites of the 14 modules with stale rows takes about 80-100 minutes, measured at 1.45-1.72 s per site with 4 workers. `src/core/recursion_guard.ts` had 28 unregistered survivors at `a8d1e655` already. | (a) Update or delete each stale row, run the tool only on the changed lines and on the declarations with stale rows (877 mutants), register only the survivors that the cleanup created, and list the older ones. (b) Full runs at HEAD. (c) Full runs at HEAD and at the base, and a row for every survivor. | (a), by default |
| FZD8 | The test gaps that the executors skipped: the rest of FZ123 and FZ124, and the network part of FZ130 | (a) Record them as open. (b) One more Sonnet unit for FZ123 and FZ124. | (a), by default |
| FZD9 | The two rename texts of `editor_rename.ts` that no probe reached | (a) Keep both checks. (b) Delete the proved one. (c) Delete both. | (a), by default |

## Plan

This document is the plan authority. The plan applies FZD1 (a): every cleanup finding apart from the rejected proposals and the rows marked "low". The excluded low rows are FZ10, FZ94, FZ96, FZ131, the `export` removals of FZ58, and the `interface.ts` part of FZ115. FZ97-FZ99 need a measurement first, so they stay open. FZ100-FZ109 stay out (FZD6).

### Order

1. FZU1-FZU4 fix the four probable defects on `main`, one commit each. Opus does them directly, because each is a test and a small change.
2. Opus creates one detached worktree for each Sonnet unit from the commit of FZU4. FZU5-FZU15 then run at the same time.
3. FZU16 integrates the units one at a time, refreshes the mutation register, and runs the final checks.

Inside each Sonnet unit the order is: the test-gap rows first, then dead code, then the residue patterns FZ1-FZ9, then the other logic rows.

### Rules for all Sonnet units

The change preserves behavior. The diagnostics and their order, the IR, the emitted TypeScript, the CLI output, the LSP responses, the lexer snapshot, the golden files, and the surface records stay the same. A unit that finds that an item changes behavior skips the item and names it in its handback.

A test-gap row comes first in its unit. The new test must pass on the unchanged code. If it fails, the executor keeps it out of the commit, stops work on that row, and reports the failure as a probable defect.

Each item, or each group of items that change the same lines, gets one commit. The subject is short and imperative. The body gives the reason and names the FZ IDs. The last line is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before each commit, the executor runs the fast gate, and the fast gate must exit 0. The fast gate is `deno fmt --check && deno lint && deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts' && deno task test`. The executor tests the exit status of the gate command itself, not of a pipe.

The lint stays strict. No unit adds a lint exclusion, a rule disable, an ignore comment, or a layer header. A proposed form that the lint refuses is dropped and named in the handback.

A test changes only when it covers deleted dead code, or when it reads an internal shape that an item changes. The handback names each changed test. A unit does not change an expected value to make a test pass.

An executor may change a declaration that has a row in `fixtures/mutation/survivors.json`, but it does not edit that file. The handback names each such declaration. The mutation census test in `tests/mutate_slow_test.ts` is not part of the fast gate. Opus refreshes the register in FZU16.

Each Sonnet unit works only in its own worktree under `~/.claude/scratch/fz/`, which Opus creates. The executor commits only there. It does not run `git checkout`, `git restore`, `git stash`, `git reset`, or `git push`. It does not run `deno task check`, `deno task coverage`, or `deno task mutate`. It runs a slow test file only when its acceptance check names that file.

Each unit owns the files that its row lists. A unit that needs a change in a file of another unit stops that item and names it in the handback, unless its row grants the exact lines.

When a unit reaches its turn budget, it stops and hands back. The handback lists the commits, the FZ items done and skipped with a reason for each, the fast gate result, the changed tests, the touched register declarations, and the open issues. It contains no file contents and no full logs.

### Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| FZU1 (resolver lookup exit) | Opus | FZ90 | `src/core/resolve.ts` | No test can fail on outputs, because the outputs do not change. The evidence is a paired timing of `tests/proof_budget_slow_test.ts` before and after the change, at a recorded load. `deno task check` exits 0. | direct |
| FZU2 (shorthand field escape) | Opus | FZ91 | A test in the shape of `tests/borrowed_use_walkers_test.ts`, `src/core/check_builtins/scope.ts`, `check_builtins/context.ts`, `src/core/check_expr.ts` (`localUses`) | The new rows for a scoped record and for a borrowed handle fail for the reason of the defect, then pass. `deno task check` exits 0. A `CHANGELOG.md` entry. Opus checks the website specification of scoped records. | direct |
| FZU3 (generated header grammar) | Opus | FZ92 | A test, `src/core/paths.ts` | The new rows for an empty stem and for the three line terminators fail, then pass. `deno task check` exits 0. | direct |
| FZU4 (pipe into an error constructor) | Opus | FZ93 | `tests/inferred_inputs_test.ts`, `src/core/infer_inputs.ts` | The new pipe test fails for the reason of the defect, then passes. The call-form test passes before and after. `deno task check` exits 0. A `CHANGELOG.md` entry. Opus checks the website specification as for FY130. | direct |
| FZU5 (checker) | Sonnet | FZ120, FZ121; FZ11-FZ18; FZ59, FZ61-FZ69; FZ58 (`check_project.ts` aliases); the FZ1, FZ3-FZ5, and FZ7 sites in its files | `check_expr.ts` (not lines 1364-1365 and 1437-1447), `check_declarations.ts`, `check_project.ts`, `check_refinements.ts`, `signatures.ts`, `check_patterns.ts`, `types.ts` line 54 (the `export` of FZ62 only), their tests | Fast gate exits 0 at each commit. | 110 |
| FZU6 (builtin rows) | Sonnet | FZ122; FZ19-FZ20; FZ21 (`check_binary.ts`); FZ70 only with a lint-clean form; FZ71-FZ74; FZ110-FZ112; FZ58 (`check_binary.ts` alias); the FZ1, FZ3, FZ4, and FZ7 sites in its files | `src/core/check_builtins/`, `check_binary.ts`, `check_expr.ts` lines 1364-1365 and 1437-1447, `docs/builtin-changes.md`, the FZ112 lines of `tables.ts` and `lower.ts`, their tests | Fast gate exits 0 at each commit. | 90 |
| FZU7 (validator) | Sonnet | FZ123, FZ124; FZ2; FZ21 (`validate/expr.ts`); FZ22-FZ29; FZ30 (`recursion_checks.ts`); FZ58 (`ValidationCount`); FZ75-FZ78; FZ113; FZ8 (`flagAt`); the FZ1, FZ3, FZ4, FZ6, and FZ7 sites in its files | `src/core/validate/`, `src/core/validate_project.ts`, validator tests | Fast gate exits 0 at each commit. The validator imports nothing from the checker. | 120 |
| FZU8 (expression emission and lowering) | Sonnet | FZ9; FZ35-FZ40; FZ81; FZ114 (`emit/families/`, `emit/expr.ts`); the FZ1, FZ3, and FZ7 sites in its files | `emit/expr.ts`, `emit/families/`, `fields.ts`, `shape.ts`, `calls.ts`, `walk.ts`, `type_query.ts`, `identity.ts`, `failure.ts`, `lower.ts` (not the FZ112 lines), one new export in `emit/emitted.ts`, emitter tests | Fast gate exits 0 at each commit. `tests/emit*_slow_test.ts` and `tests/strict_target_slow_test.ts` pass at the last commit. | 100 |
| FZU9 (declaration emission) | Sonnet | FZ8 (`trueFlag`); FZ30 (`recursion_guard.ts`); FZ31-FZ34; FZ58 (`emit/tsc.ts` alias); FZ79; FZ80; FZ114 (`decls.ts`, `emit.ts`); the FZ1, FZ3, FZ4, FZ6, and FZ7 sites in its files | The other `src/core/emit/` files (not `emitted.ts`), `type_ir.ts`, `recursion_guard.ts`, a new `trueFlag` at the end of `util.ts`, `type_lower.ts` lines 584-603, emitter tests | Fast gate exits 0 at each commit. `tests/emit*_slow_test.ts` and `tests/strict_target_slow_test.ts` pass at the last commit. | 90 |
| FZU10 (front end) | Sonnet | FZ125; FZ43-FZ45; FZ82-FZ84; the FZ1, FZ3, FZ5, and FZ7 sites in its files | `lex.ts`, `parse.ts`, `resolve.ts`, `syntax.ts`, `syntax_queries.ts`, `patterns.ts`, `type_lower.ts` line 556, their tests | Fast gate exits 0 at each commit. The lexer snapshot and the parse fixtures do not change. | 100 |
| FZU11 (type model and inference) | Sonnet | FZ126; FZ41, FZ42; FZ60; FZ85; FZ118; FZ115 (`service_bounds.ts`); the FZ1, FZ3, FZ4, and FZ7 sites in its files | `types.ts` (not line 54), `predicates.ts`, `predicate_source.ts`, `type_lower.ts` (not lines 556 and 584-603), `type_show.ts`, `infer_inputs.ts`, `infer_contracts.ts`, `contract_origins.ts`, `requirement_provenance.ts`, `effect_set.ts`, `modes.ts`, `linear.ts`, `initialization.ts`, `body_env.ts`, `tables.ts` (not the FZ112 lines), `service_bounds.ts`, `referenced_ids.ts`, their tests | Fast gate exits 0 at each commit. | 100 |
| FZU12 (project services and editor) | Sonnet | FZ127 (before the FZ1 and FZ86 changes in those files); FZ46-FZ49; FZ58 (editor and `paths.ts` aliases); FZ86, FZ87; FZ115 (`editor_completion.ts`); the FZ1, FZ4, FZ6, and FZ7 sites in its files | The S10 files of `src/core/` (not `util.ts`), their tests | Fast gate exits 0 at each commit. | 90 |
| FZU13 (hosts and playground) | Sonnet | FZ128; FZ50-FZ54; FZ88; FZ115 (`outputs.ts`); the FZ4 and FZ7 sites in `log_schema.ts` | `src/cli/`, `src/host/`, `src/lsp/`, `playground/`, their tests, but not `tests/cli_helpers.ts` | Fast gate exits 0 at each commit. The CLI, LSP, and watch slow tests pass at the last commit. | 60 |
| FZU14 (scripts and test support) | Sonnet | FZ129; FZ55, FZ56; FZ89; FZ116 (`package_vscode_smoke.ts`); FZ6 (`tests/chain_helpers.ts`) | `scripts/`, the test support files of S12, `bench/generate.ts` lines 62-73 (the move of `makeRandom` into `scripts/lib.ts`) and the tests that import `makeRandom` | Fast gate exits 0 at each commit. The slow tests of the changed scripts pass at the last commit. | 70 |
| FZU15 (bench) | Sonnet | FZ130; FZ95 (first a test that records the side order with `pairs: 2`; the fix only if the test shows a, b, a, b); FZ57; FZ117; FZ116 (bench part); FZ6 (`bench/m2.ts`, `bench/m5_target.ts`) | `bench/` (not `generate.ts` lines 62-73), bench tests | Fast gate exits 0 at each commit. `tests/bench_*slow_test.ts` pass at the last commit. | 70 |
| FZU16 (integration) | Opus | all | all | Opus reviews each unit line by line and lands it with `git cherry-pick`. `deno task check` exits 0 on `main` after each unit, apart from the register census until the refresh. `deno task behavior:compare <FZU4 commit> HEAD` exits 0. `deno task behavior:compare 54e9e42b <FZU4 commit>` shows only the record changes that FZU2-FZU4 explain. `deno task mutate` with all sites exits 0 on each module with a touched register declaration, after the refresh. | direct |

FZU5, FZU6, FZU9, FZU10, and FZU11 share some files in disjoint line ranges, as the Files column states. Opus resolves a cherry-pick conflict in a shared file.

If FZU2 or FZU4 needs a new language rule, Opus stops and asks the user first.

After FZU16, Opus does Step 4 of the fresh-eyes method: it lists abstraction candidates that occur 3 or more times. It does not implement them without approval.

When the plan is complete, the completing commit moves this file to `docs/archive/plans/` and updates the registry path.

### Results

| Unit | Commits | Result |
| --- | --- | --- |
| FZU1 | 1 | FZ90 is fixed. `tests/proof_budget_slow_test.ts` took 7 minutes 16 seconds before the fix, at a load average of 6 to 12. It took 3.4 seconds after the fix on `main`, at a load average of 17.8. `deno task check` exits 0 in 46.5 seconds: 3312 fast tests passed and 6 ignored, 326 slow tests passed, and the slow suite took 31 seconds. Before the fix the slow suite took about 8 minutes. |
| FZU2 | 1 | FZ91 is fixed. Three new rows in `tests/borrowed_use_walkers_test.ts` (scoped record, borrowed handle, `borrow` parameter, each with `{ x }`) gave 0 reports where 1 is expected. They pass after `localUses` always counts a shorthand field. The `shorthand` parameter is gone. A fourth new row, `{ saved: handle }`, passed before and after. The website rule already forbids an escape through an aggregate, so it needs no change. |
| FZU3 | 1 | FZ92 is fixed. New rows in `tests/paths_test.ts` for the stems `.eff` and `.effi` and for U+000D, U+2028, and U+2029 failed at the first assertion, then pass. A differential probe of 10976 generated inputs found 0 differences between `generatedSourceOf` and the former regex. The defect came after release 0.15.9, so the change needs no `CHANGELOG.md` entry. |
| FZU4 | 1 | FZ93 is fixed, with a corrected scope. A pipe into an error constructor is invalid source in every form, so no valid program changes. An inferred input piped into `Issue` now gives the same `type-mismatch/010` as a literal argument, not `type-mismatch/003`, and the input infers `Int`. The new pipe test failed at HEAD with `type-mismatch/003` and passes after the fix. The new call-form test passes before and after. It also covers the first row of FZ126. The website inference rules do not separate a pipe stage from a call, so they need no change. |
| FZU13 | 5 | FZ128, FZ50-FZ54, FZ88 (with the inferred `LoadResult`), FZ115 (`outputs.ts`), and the FZ4 and FZ7 sites of `log_schema.ts` are done. Nothing was skipped. The new tests passed on the unchanged code. They include a confirmation of the inferred wire-log cap: the LSP keeps the first 1000 events before `initialize`. The `GET /replay` tests are in `tests/playground_serve_slow_test.ts`, because they need a writable folder. No changed declaration has a register row. On `main`, `deno task check` exits 0: 3322 fast tests passed and 6 ignored, and 330 slow tests passed. |
| FZU14 | 4 | FZ129, FZ55, FZ56, FZ6 (`tests/chain_helpers.ts`), FZ89, and FZ116 (`scripts/package_vscode_smoke.ts`) are done. The `test_slow.ts` part of FZ89 is skipped: a probe showed that `runProcess` gives the child a null stdin and `spawn()` inherits it. A run of 100000 numbers for seed 7 showed 0 differences between the old `mulberry32` copy in `scripts/mutate.ts` and the shared `makeRandom`, and the lexer snapshot is unchanged. The executor also corrected the `makeRandom` path in `docs/testing.md`. The register census fails from here until the refresh, because `main` and `selectSample` in `scripts/mutate.ts` changed. |
| FZU15 | 8 | FZ95 is confirmed and fixed. A new test with recording services showed the sampler order a, b, a, b, and `sampleVariant` reads it as a, b, b, a, so each odd pair swapped the two sides. The sampler now takes its side from `byTurn`. FZ130, FZ57, FZ6 (bench), FZ117, and FZ116 (bench) are done. Skipped: deriving `samples` from `pairs.flat()`, because `samples` keeps the run order and `pairs` keeps the side order. The cherry-pick conflicted with FZU14 in `bench/generate.ts`, and the resolution keeps both changes. Review found one regression: `loadInput` read the examples from a URL `pathname`, which keeps percent-encoding. Commit `94c6599d` uses `fromFileUrl`. No test covers it, because a test would need a repository path with a space. |
| FZU11 | 10 | FZ126 (second row), FZ41, FZ42, FZ118, FZ60, FZ85, FZ115 (`service_bounds.ts`), and the FZ1, FZ3, FZ4, and FZ7 sites are done. Review confirmed the non-local changes. `inferArrowInputs` calls `finish` once for each resolver, so the local `resolved` set of FZ42 keeps the result. `record` interns, so one shared `message` record keeps each builtin. The two `termKey` forms give the same partition, because a field name has no dot and the only length unit is `utf16`, and no code sorts by the key. `inputEngineNameType` only reads, so it can run before the constructor branches. Commit `d35139c6` removes one `kind_3` block that the unit left. |
| FZU5 | 4 | FZ120, FZ121, FZ11-FZ18, FZ58 (`check_project.ts`), FZ59, FZ61-FZ69, and the FZ1, FZ3, FZ5, and FZ7 sites are done. The executor could not change `localUses`, so commit `d35139c6` finishes FZ62 there. Review confirmed four changes. FZ64 `uniqueLocalName` returns the same name, because both seeds start with `$`, so the old loop always reaches the shortest free name. `annotation === "none"` holds exactly when the old `explicit` was false. The earlier `errorCount` increment in `unresolvedCall` is read only as a difference around a whole `try` body. `fieldStart` moves a pure lookup after the duplicate report. On `main` after FZU11 and FZU5, the fast suite passed 3346 tests with 6 ignored, and the slow suite failed only in the register census. |
| FZU10 | 8 | FZ125, FZ43-FZ45, FZ84, the FZ1, FZ3, and FZ5 sites, and parts of FZ82 and FZ83 are done. Skipped: `TOKEN_NAMES` (display strings), the other `syntax.ts` table copies, `parserParseServiceImport`, and the `finally` and `provides` parsers. An Opus reviewer compared the base and the unit on 193 parse runs, 182 resolve runs, and 30 fixture projects, with 0 differences. It confirmed every numeric kind value, `kindName`, `keywordKind` for prototype names, and the single malformed-number diagnostic. Commit `22b252bf` assigns `resolverSelf` before the `Resolver` returns again, because the unit left it `undefined` under the type `Resolver`, and removes a stale `tokenKind` doc. |
| FZU9 | 10 | FZ30 (`recursion_guard.ts`), FZ31-FZ34, FZ8, FZ79, FZ80, FZ114 (`decls.ts`, `emit.ts`), and the FZ1, FZ3, FZ4, FZ6, and FZ7 sites are done. Skipped: the `emit/tsc.ts` part of FZ58, because the file has no local `ModuleName`. An Opus reviewer proved the `hasDistinctTag` equivalence from the definitions and confirmed the helper name allocation order. `deno task behavior:compare a8d1e655 <FZU9 head>` gave every record equal. The 4 `guardedRecord` register rows are stale until the refresh. |
| FZU12 | 8 | FZ127 (except two rename texts), FZ46-FZ49, FZ58 (editor and `paths.ts`), FZ86, FZ87, FZ115 (`editor_completion.ts`), and the FZ1, FZ4, FZ6, and FZ7 sites are done. An Opus reviewer compared 137726 completion offsets, the semantic classifications, and the project load of 39 fixture directories, with 0 differences, and proved each dropped loop guard redundant. The rename text "The rename would invalidate the project configuration." has no reaching input. The text "The rename changes the meaning of a source occurrence." probably has none, but this is not proved. Both stay, because a removal is a source behavior change. |
| FZU6 | 11 | FZ122, FZ19-FZ21 (`check_binary.ts`), FZ58 (`check_binary.ts`), FZ71-FZ74, FZ110-FZ112, and the FZ3 and FZ7 sites are done. FZ70 is rejected: `Object.assign` breaks the lint, and `Object.fromEntries` needs a cast that removes the check that every prelude name has a row. An Opus reviewer ran the base and the unit on 4629 projects from the fast tests and on 75 edge cases. The diagnostics and the serialized IR were byte-identical. |
| FZU8 | 7 | FZ35-FZ40, FZ9, FZ81, FZ114 (`emit/expr.ts`, `emit/families/`), and the FZ1, FZ3, and FZ7 sites are done. An Opus reviewer compared the lowered IR of 48 projects and the emitted TypeScript of 82 modules, byte-identical. It found 19 nested default `emitted` calls that the unit missed: the base had 116 such calls, not 97. Commit `6021529b` converts them, restores `inGen` in the `expr.ts` header and puts the header above the imports, and corrects the `callOptions` doc from the FZU6 review. The cherry-picks of FZU6 and FZU8 had no conflict. |
| FZU7 | 19 | FZ2 (171 report sites through `flag` and `flagCore`), FZ8 (`flagAt`), FZ21-FZ30 (validator parts), FZ58 (`ValidationCount`), FZ75-FZ78, FZ113, the FZ6 and FZ7 sites, and parts of FZ123 and FZ124 are done. Skipped for lack of turns: the FZ123 rows that need forged IR or a checked entry function (about 15 lines in `validate/expr.ts`, `typing.ts`, and `refinements.ts`), and the exact texts of the retry, repeat, and callback-authority messages of FZ124. An Opus reviewer rewrote every old report copy mechanically into `flag` and `flagCore` and found no residual difference. A differential of 37510 cases with step budgets 0-30 showed the same results and step counts for the reordered `checkBranch` pop. The reviewer proved each removed term of `recursion_checks.ts` from its definitions, and judged the `schemaArg` call in `schemaOptionFromOptionalKey` intended, because the checker has the same rule. The validator imports nothing from the checker. On `main` with all units, the fast gate passed 3393 tests with 6 ignored. |

## Method and evidence limits

Thirteen read-only Opus examiners each examined one slice:

| Slice | Files |
| --- | --- |
| S1 | `src/core/check_expr.ts` |
| S2 | `check_declarations.ts`, `check_project.ts`, `check_refinements.ts`, `signatures.ts`, `check_patterns.ts` |
| S3 | `src/core/check_builtins/`, `check_binary.ts` |
| S4 | `src/core/validate/` body files: `expr.ts`, `typing.ts`, `refinements.ts`, `expr_walk.ts`, `predicates.ts`, `sets.ts`, `results.ts`, `guards.ts`, `report.ts`, `index.ts`, `prelude.ts` |
| S5 | The other `src/core/validate/` files, `validate/families/`, `validate_project.ts` |
| S6 | `src/core/emit/expr.ts`, `emit/families/`, `fields.ts`, `shape.ts`, `calls.ts`, `walk.ts`, `type_query.ts`, `identity.ts`, `failure.ts`, `src/core/lower.ts` |
| S7 | The other `src/core/emit/` files, `type_ir.ts`, `recursion_guard.ts`, `ir.ts` |
| S8 | `lex.ts`, `parse.ts`, `resolve.ts`, `syntax.ts`, `syntax_queries.ts`, `patterns.ts` |
| S9 | `types.ts`, `predicates.ts`, `predicate_source.ts`, `type_lower.ts`, `type_show.ts`, `infer_inputs.ts`, `infer_contracts.ts`, `contract_origins.ts`, `requirement_provenance.ts`, `effect_set.ts`, `modes.ts`, `linear.ts`, `initialization.ts`, `body_env.ts`, `tables.ts`, `service_bounds.ts`, `referenced_ids.ts` |
| S10 | The other `src/core/` files: project services, diagnostics, editor queries, entry points |
| S11 | `src/cli/`, `src/host/`, `src/lsp/`, `playground/` |
| S12 | `scripts/` and the test support files in `tests/` |
| S13 | `bench/` |

Each examiner read its slice in full, apart from small ranges at the end of this document. Line numbers refer to `54e9e42b`.

The Level column has three values. "Checked" means that the examiner read the code and its callers and confirmed the claim. "Inferred" means that the claim comes from types, names, or partial reading. "Confirmed" means that Opus ran the check again.

The examiners did not run the lint on most proposed forms. Lint acceptance rests on the same form in a file that passes the lint. One exception: S10 collapsed the FZ1 and FZ4 forms in scratch copies of 7 files, and `deno fmt`, `deno lint`, and `deno check` passed. Line savings are not measured unless a row gives a number.

## Probable defects

| ID | Location | Evidence | Proposed change | Level |
| --- | --- | --- | --- | --- |
| FZ90 | `src/core/resolve.ts:751-765` | Commit `76d63bfe` turned a `while` loop into `for (const _kind of resolverTree.kinds)` without an exit. After the scope chain ends, each name lookup still iterates once for each node of the file. Opus added `if (scope === undefined \|\| found !== undefined) break;` in a scratch worktree. `tests/proof_budget_slow_test.ts` then passed in 4.8 seconds: 1 second for each test, at a load average of 5 to 12. A paired run of the same file at HEAD took 7 minutes 16 seconds (3 minutes 40 seconds and 3 minutes 33 seconds) at a load average of 6 to 12. The test results are the same. No other converted loop in the repository has this form. | Add the `break`. `parse.ts` uses `break` 30 times, so the form is lint-clean. | Confirmed |
| FZ91 | `src/core/check_builtins/scope.ts:256,324`, `check_builtins/context.ts:148-154` | `scopedUses` and `scopedBorrowUses` call `localUses(body, id, false)`, so a use in a shorthand field is not found. S1 measured the probe and S3 ran it again: inside a `using` block, `const saved = { saved: file }; 1` gives one `type-mismatch/010`, and `const saved = { file }; 1` gives none. Commit `2b28b7d8` (2026-11-02) removed the only caller that passed `true`. The borrowed-handle case (`scopedBorrowUses`) was not run. | A failing row `{ name: "shorthand field", body: "const saved = { file }; 1", reports: 1 }` in the shape of `tests/borrowed_use_walkers_test.ts`. Then count shorthand fields always, and delete the `shorthand` parameter. The fix adds a diagnostic. | Checked by 2 probe runs |
| FZ92 | `src/core/paths.ts:145-153` | The rewrite replaced `/^\/\/ Generated from (.+\.effi?) by the Effektive compiler\. Do not edit\.$/` with prefix and suffix tests. A differential probe found more accepted inputs: the sources `.eff` and `.effi` (empty stem), and a name with U+000D, U+2028, or U+2029. The old code gives `undefined` for each. Effect: `src/host/workspace.ts:176` drops such a hand-written `.ts` file, and the overwrite guard in `src/host/outputs.ts:226,285` reads its first line as a header. `docs/light-fp-subset.md` requires a manual parser to keep the language of the regex that it replaces. | A failing test for each input, then require a non-empty stem and refuse the three line terminators. | Checked by probe |
| FZ93 | `src/core/infer_inputs.ts:345-516` | `inputEngineCall:367` has an error-constructor branch and `inputEnginePipe` has none. Probe: `type Int = int`, `error Issue = { value: Int }`, `const build = (input): Issue => ({ value: input }) \|> Issue` gives `type-mismatch/003 the argument of Issue has type { value: unknown }, but { value: Int } is expected`. The call form `Issue({ value: input })` gives no diagnostic and infers `Int`. The checker sends both forms to `errorConstruction`. FY130 was the same call-versus-pipe gap for a callback. Correction found in FZU4: a pipe into an error constructor is never valid. `({ value: 1 }) \|> Issue` also gives `type-mismatch/010` "needs a record literal". So the defect is the diagnostic: an inferred input gave `type-mismatch/003` in place of that rule. | A failing test, then the branch in the pipe form. | Checked by probe |
| FZ94 | `scripts/behavior_compare.ts:103-104,129` | `compareRecords` skips a record of an unknown kind on the base side. On the head side, `tally.get(record.kind)!.added++` throws a `TypeError`. `parseRecords` does not check `kind`. The CLI does not reach this today, because both runs use one copied runner. Not run. | Treat both sides in the same way. Low. | Inferred |
| FZ95 | `bench/m5_variants.ts:271-280,445-452` | The warm `ts.LanguageService` sampler takes `sides[turn++ % 2]`. With 0 warm-ups, service B never runs first, and `byTurn` puts B's time in the A slot on each odd pair. The "floor %" of the service rows then comes from mislabeled pairs. Check: record the side of each call with `pairs: 2`. The expected order is a, b, b, a. | Run the check. If it confirms the defect, alternate the order. | Inferred |
| FZ96 | `bench/m5_variants.ts:422-430` | When `createService` fails, both errors join with `""`, for example "...no filethe configuration...". No current target reaches it. | Low. | Inferred |

Performance observations that need a measurement before any change:

| ID | Location | Observation |
| --- | --- | --- |
| FZ97 | `src/core/emit/doc.ts:428` | `fits` now copies the whole render stack (`[...rest, next]`) on each call. Before `76d63bfe` it read the stack lazily. A synthetic flat document rendered in 6.0, 8.1, 14.8, and 34.3 ms for 500, 1000, 2000, and 4000 groups on a loaded machine. The effect on real modules needs to be measured. A lint-clean lazy form exists in `module_state.ts:420`. |
| FZ98 | `src/core/check_expr.ts:319` | `createFamilyRows` builds about 60 rows and their closures for each checked body. Before `76d63bfe` the rows were one module constant. The cost needs to be measured. |
| FZ99 | `src/core/syntax.ts:550-605`, `src/core/lex.ts:425-428` | A `walk`-based `hasProblem` loses its early exit. The length test in `isDeclarationStartWord` hard-codes 4 and 8. The benefit of each needs to be measured. |

## Repository-wide residue of the lint rewrite

Each row is one mechanical pattern across many files. Each row can be one unit.

| ID | Pattern and sites | Evidence | Proposed change | Behavior to keep | Level |
| --- | --- | --- | --- | --- | --- |
| FZ1 | `{ const _appendTargetN = xs; const _appendValueM = v; _appendTargetN[_appendTargetN.length] = _appendValueM; }`: 154 blocks in 23 files. The largest counts are `emit/doc.ts` 37, `emit/expr.ts` 20, `type_lower.ts` 10, `emit/decls.ts` 10. | The direct form passes the lint in `check_refinements.ts:759`, `check_declarations.ts:416`, `db.ts:478`, and others. No block writes the collection that its loop iterates, apart from `emit/decls.ts:193-197`, where rule ZTS622 applies. | `xs[xs.length] = v;`. Keep `decls.ts:193-197`. A multi-value block becomes one literal or one `for...of`. | Append order | Confirmed (count); lint passed on 7 files (S10) |
| FZ2 | Validator report copies: `ctx = { ...ctx, report: ctx.report.add(...) }` in `validate/expr.ts` (74), `refinements.ts` (5), `declaration_checks.ts`, `import_checks.ts`, `type_checks.ts`, `recursion_checks.ts` (27 in total); `c = { ...c, ctx: { ...c.ctx, report: c.add(...) } }` in `validate/families/` (63 blocks, 760 lines). | Before `76d63bfe` each site was one statement. `World` has one construction site (`index.ts:53`), and `Report.add` returns the same owner (`report.ts:60-71`). `optionExtras.bad` (`families/effect.ts:357-374`) already is the helper, written locally. | One helper for `Ctx` in `world_table.ts` and one for `ValidatorCore` in `families/context.ts`. Each site becomes `ctx = flag(ctx, ...)`. Delete `optionExtras.bad`. | Diagnostic text and order | Checked |
| FZ3 | Residue of the `switch` rewrite: bare `{}` blocks, `kind_N` and `subject_N` aliases (21), `else` after `return`, and a final `else { return self; }`. Sites in `check_declarations.ts`, `check_project.ts`, `check_refinements.ts`, `project_config.ts:70-85`, `referenced_ids.ts`, `requirement_provenance.ts`, `type_lower.ts`, `infer_inputs.ts`, `predicates.ts`, `emit/expr.ts` (21 blocks), `emit/families/` (31), `emit/fields.ts:39-75`, `lower.ts` (3 chains), `resolve.ts`, `recursion_guard.ts`, `emit/types.ts`, `emit/doc.ts`. | An early-return chain that ends in a `never` check passes the lint in `types.ts:331` and `type_show.ts:81`. | Remove the blocks and the aliases. Test `x.kind` directly. Keep each `never` check. In `fields.ts` `adapterBody`, delete `let fields`. | Each result and each internal message | Checked |
| FZ4 | Residue of the destructuring rewrite: `const binding2 = binding1;` and meaningless `bindingN` names. `editor_completion.ts` 15, `editor_actions.ts` 13, `editor_signature.ts` 3, `editor_index.ts` 2, `type_lower.ts` 4, `infer_contracts.ts` 2, `infer_inputs.ts` 1 and 8 names, `predicates.ts:192`, `recursion_guard.ts`, `src/host/log_schema.ts:350,385`. | The aliases do nothing. | Read the members from the original binding. Give each remaining binding the name of its part. | None | Confirmed in 7 files by S10 (lint, type check) |
| FZ5 | `owner = X(); return owner;` pairs: about 80 in `parse.ts`, 19 or more `resolverSelf` sites in `resolve.ts`, 8 in `check_patterns.ts` (176-183, 241-248, 300-301, 387-388, 401-406, 421-422). | The owner always holds the same record. Other owner assignments consume a result, which `no-discarded-values` requires; keep those. | `return X();` | None | Checked |
| FZ6 | Comments and imports that the rewrite moved: 11 type aliases between a JSDoc comment and its function (`recursion_guard.ts:12-18`, `doc.ts:162-169,288-289,401-405`, `emit/types.ts:68-69,402-408`, `tsc.ts:130-136`, `sourcemap.ts:32-33,187-188`, `spans.ts:146-147`, `helper_declarations.ts:206-207`); imports above the file header (`declaration_checks.ts:1`, `project_config.ts:1`, `editor_index.ts:1`, `editor_signature.ts:1`, `declaration_index.ts:1`, `interface.ts:1-10`, `editor_actions.ts:3`, `tests/chain_helpers.ts:1-7`, `bench/m5_target.ts:2-3`); second imports of one module in 11 validator files and `bench/m2.ts:22,41`. | `deno doc` and hover attach a moved comment to the alias. | Move each alias above its comment. Move each import below the header. Merge the duplicate imports. | None | Checked |
| FZ7 | Stale or deleted comments: 5 reason comments that the rewrite deleted in `validate/expr.ts` `pattern` and `binary`, and the `addDepth` doc (`report.ts:74`); `containsRefinement` doc (`typing.ts:750`); `check_expr.ts:161`; `check_binary.ts:403`; `check_builtins/schema.ts:886-887`; `docs/builtin-changes.md:26`; `emit/walk.ts:61`; `types.ts:329,1393,1406`; `typescript.ts:58-59`; `diagnostics.ts:375-376`; `log_schema.ts:274-277`; the header of `helper_declarations.ts:1-3` (misses `$at` and `$sort`). | Each comment names code that no longer exists or describes another declaration. | Restore the reason comments from `76d63bfe^`. Correct the others. | None | Checked |
| FZ8 | Exact-true helpers: 5 private `trueFlag` copies and 1 inline copy (`type_ir.ts:12,80`, `emit/decls.ts:60`, `emit/types.ts:166`, `module_state.ts:43`, `emit/emit.ts:52`); 7 `isTrue(flags === undefined ? undefined : flags[i])` sites in the validator (`expr.ts:455,488,500,535-537,1524-1527`, `typing.ts:400-403,409-412`). | ZTS620 bans `=== true`, and the lint bans `flags?.[i]`. | One `trueFlag` in `src/core/util.ts`. One `flagAt` in `validate/guards.ts`, so the validator stays independent. | Exact-true semantics on forged flags | Checked |
| FZ9 | 97 of the 119 `emitted(` calls in `emit/expr.ts` and `emit/families/` pass `undefined, undefined`. | The lint removed the default parameters. Each call takes 2 more lines after formatting. | One plain-doc export in `emit/emitted.ts`. | `prec` and flags | Checked (count) |
| FZ10 | Factory prefixes and parameter aliases from the class conversion: `inputEngine` 207 times in `infer_inputs.ts`, `inputContractResolver` 108 times in `infer_contracts.ts`, with aliases such as `inputEngineParameters = parameters`. | Other factories use short names. Many statements wrap only because of the prefix. | Delete the aliases. Rename the locals to short names. Low: a rename. | None | Checked |

## 1A Dead code

| ID | Location | Evidence | Proposed change | Keep | Level |
| --- | --- | --- | --- | --- | --- |
| FZ11 | `check_expr.ts:280,3178` | `BodyChecker.refinements` has no reader. It is the old class field. | Delete. | None | Checked |
| FZ12 | `check_expr.ts:2848-2852` | `if (branchInfo.type === table.never) continue;` is the last statement of the loop. The rewrite added it only to consume a result. | `arms = armBody(branch, expected, arms).arms;` | `match` reads `.info` | Checked |
| FZ13 | `check_project.ts:802-805` | `settled` always returns a policy, so `nextPolicy !== undefined` is always true. | `policy = policy.settled(...)` | Policy updates | Checked |
| FZ14 | `check_project.ts:145,694` | `CheckArguments.module` is written and never read. | Delete. | None | Checked |
| FZ15 | `check_project.ts:447` | `entries[component[0]] = finalized` has no reader. | Delete. Make the parameter `readonly Entry[]`. | `members` and `signatures` | Checked |
| FZ16 | `check_project.ts:313` | `return table.error` follows a chain that covers all 3 kinds. | Make the `provider` branch the final return. | Types | Checked |
| FZ17 | `check_patterns.ts:28,19` | `PatternContext.body` and its import have no reader since `recordLocal`. | Delete. | None | Checked |
| FZ18 | `check_declarations.ts:631-637` | `checkCycles` rebuilds `typeInfos` keyed by id. The ids are already unique. | `const nodes = typeInfos;` | Node order | Checked |
| FZ19 | `check_builtins/rows.ts:24-59`, `check_expr.ts:1364-1365`, 20 rows | The rewrite replaced a regex with a hand list of 20 fact names (`KeyFact`, `keyFact`). The panic at `rows.ts:58` never runs. | Each row writes its literal fact. Delete `KeyFact`, `keyFact`, the `"key"` branch, and the panic. Update `docs/builtin-changes.md:26`. About -35 lines. | Facts before the count test | Checked |
| FZ20 | `check_builtins/effect.ts:291,342-372` | `schedulePolicy` returns `PURE_EFFECTS` on every path. Its docs say that it adds effects. | Return the context, as `timesValue` does. | Effects, diagnostics | Checked |
| FZ21 | `check_binary.ts:64-77`; `validate/expr.ts:207-219` | `named` is never undefined after the guard. Register rows record the closed-unit tests as equivalent in both files. | Test `named === undefined` once. Update the register rows. | Operator results | Checked |
| FZ22 | `validate/families/schema.ts:498-507` | `schemaOptionFromOptionalKey` copies 3 flags that `schemaOf` already rejects, and `makeInput`, which line 511 overwrites. | Delete the 4 `if` blocks. | Result and key order | Checked |
| FZ23 | `validate/families/schema.ts:813-814,906` | Two guards cannot run. Register rows say so, and LCOV shows no run. | Delete both and their rows. | None | Checked |
| FZ24 | `validate/families/schema.ts:592-659` | After line 596 every item is a schema, so 7 arms of the maps cannot run (LCOV 615, 629). | Narrow once, as `schemaUnion` does. | Message and key order | Checked |
| FZ25 | `validate/builtins.ts:87-110` | `CALLBACK_BUILTINS` repeats the keys of `CALLBACK_SHAPES`. | `Object.hasOwn(CALLBACK_SHAPES, name)`, as `isSchemaOp` does. | Type guard | Checked |
| FZ26 | `validate/families/effect.ts:339-342,392,454,472-473,497` | `OptionExtrasResult.core` always equals the input. | Return only the `Active[]` list. | Report order | Checked |
| FZ27 | `validate/refinements.ts:232-235` | The first `if` is a subset of the next line. | Delete it. | `adoption` results | Checked |
| FZ28 | `validate/expr.ts:1994` | `ms.length > 0 &&` is redundant (register row). | Delete the term and the row. | Pattern diagnostics | Checked |
| FZ29 | `validate/predicates.ts:98-101` | `if (signed === undefined) break;` never runs (LCOV). | Pop first, then break on `undefined`, then spend. | `stepsUsed`, error tags | Checked |
| FZ30 | `recursion_guard.ts:79,93,113`; `validate/recursion_checks.ts:47-90,213-216` | `hasDistinctTag` implies `tagged`. Register rows record 3 equivalent mutants in `recursion_guard.ts` and 4 in `recursion_checks.ts`. The term `\|\| !members.some(tagged)` has no effect (register row). | Simplify both. Delete the register rows. A differential must confirm the removal of the whole `cycle` test before anyone deletes it. | Rule 11 results | Checked |
| FZ31 | `emit/decls.ts:270-276,918-924` | `DeclarationEmitter` fields `expr`, `scope`, `exported` have no reader. | Delete. | None | Checked |
| FZ32 | `emit/module_state.ts:126-133,147,160,183,772,782,803` | `ImportLedger` has no user. The `ModuleState` fields `module`, `config`, `containsFunction` have no outside reader. | Delete. | None | Checked |
| FZ33 | `emit/decls.ts:468-470,557` | `length === 0 ? "{}" : ...` repeats the test inside `bracketed` and `braces`. | Call the helpers. | Text | Checked |
| FZ34 | `emit/module_state.ts:676-679` | The first `set` in `moduleStateAddImport` is redundant. | One `set`. | Import order | Checked |
| FZ35 | `emit/expr.ts:577,586-590,2596,2599` | `ExprEmitter` members `inGen` and `returnStatement` have no outside reader. | Delete them from the type and the record. | None | Checked |
| FZ36 | `emit/calls.ts:9-13` and 12 rows | `Callee.kind: "method"` is a one-member union with no reader. | Delete. | Callee text | Checked |
| FZ37 | `emit/shape.ts:257` | `TABLE` only aliases `SHAPE_ROWS`. | Use `SHAPE_ROWS`. | Exhaustiveness | Checked |
| FZ38 | `emit/expr.ts:1728-1730` | An `if` returns the same internal error as the next line. | Delete the `if`. | Message | Checked |
| FZ39 | `emit/families/schema.ts:404-453` | The outer `if` of `schemaLeaf` is always true, so the `never` tail cannot run. | Delete the `if` and the tail. | Output | Checked |
| FZ40 | `lower.ts:960-965` | `builtins.set(...) !== builtins` is never true. | One `claim(id, instance)` that returns the stored entry. | Collision error, prelude order | Checked; replacement Inferred |
| FZ41 | `type_lower.ts:110,827` | `TypeLowerer.sink` has no reader. | Delete. | None | Checked |
| FZ42 | `infer_contracts.ts:96,231,308` | `PendingCalls.length = 0` has no later reader. `Resolved` goes out and comes back. | Delete the reset. Make `resolved` local. | Issue order | Checked |
| FZ43 | `lex.ts:326-327,338,359-372` | `ContextualWordInfo.startsDeclaration` has no reader. `DECLARATION_START_WORDS` is now a hand copy. | Delete the field. | Word sets | Checked |
| FZ44 | `syntax.ts:384,440-445` | `typeWord` has no user. `TYPE_WORDS = { get: typeWord }` wraps it for 2 callers. | Delete `TypeWords` and `TYPE_WORDS`. Call `typeWord`. | Parser slots | Checked |
| FZ45 | `resolve.ts:1096-1113` | Line 1109 assigns the value of line 1096 again. Two `resolverMethodRef` calls are the same. | Delete 1109. Merge the calls. | `declaration/003` first | Checked |
| FZ46 | `diagnostics.ts:369-378` | `keys.includes(key)` is always true. Its comment cites a removed `satisfies`. | Return the keys with a same-file alias cast. | Code list | Checked |
| FZ47 | `editor_index.ts:144-146` | `symbolIndex(revision)` only returns `revision.symbolIndex()`. 9 call sites. | Delete the wrapper. | One index for each revision | Checked |
| FZ48 | `content_id.ts:39-40`, `serialize.ts:60-61`, `interface.ts:83-85` | An `isRecord` guard exists only to narrow after a removed cast. | Reorder the tests. | Output | Inferred |
| FZ49 | `diagnostics.ts:384-417` | The private `diagnostic` has the body of `makeDiagnosticWithRelated`. | Delete it. | No `related` key when empty | Checked |
| FZ50 | `src/cli/main.ts:99` | `if (!options.tsc) return;` cannot be true for `"host-change"`. | Delete. | Watch output | Checked |
| FZ51 | `src/cli/build.ts:61` | `[...revision.diagnostics]` copies an array that is only read. | Use it directly. | Line order | Checked |
| FZ52 | `playground/build.ts:65-74` | `listFiles` has no caller and never had one. | Delete. | None | Checked |
| FZ53 | `playground/log_endpoint.ts:29` | Nothing produces the status `411` of `Refusal`. | Remove the member. | Status codes | Checked |
| FZ54 | `src/host/outputs.ts:161-250` | The `failed` flag equals `notes.length > 0`. | Return `notes.length > 0`. | `failed` | Checked |
| FZ55 | `scripts/mutate.ts:643` | `clean.timedOut \|\|` repeats `classify`. | Delete the term. Refresh 2 register rows. | Exit 2 | Checked |
| FZ56 | `tests/helpers.ts:683-685` | An empty section header. | Delete. | None | Checked |
| FZ57 | `bench/main.ts:209`; `bench/generate.ts:79-85,112` | The `m2` condition repeats line 124. `ALIAS_LINES` only builds `ALIASES`, used once. | `m2,`. Inline the 3 lines. | JSON and text | Checked |
| FZ58 | Exported names with no outside user: aliases in `validate/` (5), `emit/` (27), test types (7), `bench/lsp_script.ts` `Workspace` and `SessionOptions`; duplicate primitive aliases (`EditorPath` 3 times and 6 more in the editor modules; `ModuleName` and `ProjectRoot` in `check_project.ts:68-69`, `paths.ts:10`, `check_binary.ts:11`, `emit/tsc.ts:137`); `ValidationCount` (`report.ts:29`) has no user at all. | ZTS061 requires a name, not an export. | Delete `ValidationCount`. Import the shared aliases. Removing `export` is low. | Type checks | Checked |
| FZ118 | `predicates.ts:40-49,208-213` | `comparison` accepts `==` and `!=`, but only tests pass them (`predicates_test.ts:336,338`, `predicates_property_test.ts:19,23`). The production caller passes `ComparisonOperator`. No entry point exports `comparison`, and the website IR copy has no `Comparison` type. | Type the parameter as `ComparisonOperator`. Delete `Comparison` and `canonicalOperator`. Delete the 2 loose test rows, and make the property test use `===` and `!==`. | Output for each strict operator | Checked |

## 1B Tangled and duplicated logic

| ID | Location | Evidence | Proposed change | Keep | Level |
| --- | --- | --- | --- | --- | --- |
| FZ59 | `check_expr.ts:336-346,3185-3187` | `services()`, `infos()`, `facts()` are old getters, each called once. Local names shadow `infos()`. | Inline them. | Same maps | Checked |
| FZ60 | `infer_inputs.ts:345-516` | `inputEngineCall` and `inputEnginePipe` repeat 4 branches. The argument loop occurs 4 times. | One `apply` and one `visitArguments`. | Visit order, return types | Checked |
| FZ61 | `check_expr.ts:571-578,622-629`; `2504-2521,2570-2573,2683-2690,3221-3230` | `preserveRefinement` has one caller. Four sites write a local to 2 tables under repeated guards. | Merge the first pair. Add `bindLocal(id, type, init)`. | Proofs, locals | Checked |
| FZ62 | `check_expr.ts:788-792,1538-1543,1589-1593`; `251-255,1727-1733,2130` | The resource kinds are written 3 times. The `{name, type, optional}` field shape 3 times; `types.ts:54` has `RecordField`. | A module constant. Export `RecordField`. | Same tests | Checked |
| FZ63 | `check_expr.ts:880-886,972-976,1167-1176` | A nested builtin test repeats `optionConstructorOf`. `unresolvedCall` copies `rejectCall` (FY28 rest). `isPlainRecordLiteral` repeats `unparen`. | Use the existing helpers. | Results | Checked |
| FZ64 | `check_expr.ts:364-371` | `uniqueLocalName` is correct only because both seeds start with `$`. | Append `$` on each pass. | Minimal name | Checked by reasoning |
| FZ65 | `check_expr.ts:503,537,3194,3197` | The internal `checkFit` is exposed as `fits`, and `requireFit` as `checkFit`. | Rename (3 and 17 uses). | Rename only | Checked |
| FZ66 | `check_expr.ts:426-450`; `2135-2161,2277-2303` | `recordInfo` repeats `finish`. Record construction and update repeat their field-loop start. | One `NodeInfo` builder. One field-start helper. | Fields, diagnostic order | Checked; second Inferred |
| FZ67 | `check_declarations.ts:500-513,689,1025,1075` | Four fields are copied one by one. `explicit` always equals `annotation !== "none"`. A `typeof ... === "boolean" &&` test replaced `=== true`. | One spread. Test `annotation`. Keep the `typeof` test: ZTS620 bans `=== true`, and the current form already keeps the exact-true meaning. | Fields, diagnostics | Checked; spread Inferred |
| FZ68 | `check_project.ts:760-769` | Two named helpers only fill `CHECK_EVERY_MODULE`. | Arrow properties, as in `db.ts:432-497`. | Policy | Checked |
| FZ69 | `check_patterns.ts:304,327` | `pattern` looks up `target` twice. | Look up once. | Diagnostic order | Checked |
| FZ70 | `check_builtins/registry.ts:50-122` | The rewrite replaced 8 object spreads with 60 hand keys. ZTS614 allows one leading spread, so the old form fails the lint. | Only if a lint-clean form exists, for example `Object.fromEntries` over the tables. Otherwise reject. | Rows, key-set test | Inferred |
| FZ71 | `check_builtins/effect.ts:234-320,583-654,789-819`; `stream.ts:443-476` | `callOptions` and `logOptions` repeat one option-record frame. `retryTimes` and `streamBufferCapacity` are one reader. | One frame helper. One literal-integer reader in `context.ts`. About -50 lines. | Check order, texts, bounds | Checked |
| FZ72 | `check_builtins/collections.ts:74-78,127-136,203-207,224-233`, `stream.ts:87-91` | Three handlers repeat the optional concurrency bound. Two build the same parameter. | `concurrencyBound` accepts `undefined`. One parameter helper. | Diagnostic order | Checked |
| FZ73 | `check_builtins/schema.ts:790-847,799-810,903-914`; `effect.ts:64-67` | The nonnullable check occurs twice. Two calls differ only in `encoded`. `EffectContext` redeclares `LiteralRecordView`. | One helper. Reuse the builder. Use the view. | Texts, node | Checked |
| FZ74 | `check_binary.ts:163-177,387-487` | `operatorResult` (cyclomatic 52) repeats `isArithmeticOperator`, has a block that never runs, and a `let` flag. | Four functions with early returns. A boolean `closedUnitClass`. | Results | Checked |
| FZ75 | `validate/refinements.ts:313-326,212-215,452-461,474-477,747`; `validate/expr.ts:291-293,1421-1446,1478,2220-2223`; `recursion_checks.ts:209` | `checkProof` repeats `invalid`. A constant `Linear` is built 4 times. `if (!scope.delete(id)) continue;` only consumes a boolean. Two parallel subset blocks. A shadowed `fn`. An inner `isNull`. | Reuse `invalid`, `zeroLinear`, `deleteMapEntry`, `isNullType`. One `constantLinear`. A loop with a verb table. Rename. | Messages, deletions | Checked |
| FZ76 | `validate/typing.ts:563-613` | `unknownPredicateInput` nests 6 levels. | Extract `termReachesUnknown`. | Depth bound | Checked |
| FZ77 | `validate/refinements.ts:653-661`, `validate/predicates.ts:142-143,165-166,282-290` | Two identical `isNormalizedInteger` copies. `indices` with `n - offset - 1` repeats `reverseIndices`. | Export one copy inside the validator. Use `reverseIndices`. | `-0` accepted, order | Checked |
| FZ78 | `validate/recursion_checks.ts:13-29,154-161,166-181`; `validate_project.ts:95-103` | `collectOwnTargets` changes a shared array. `edgesOf` loops over at most one root. `knownDeclarations.add` copies `addFirst`. | `flatMap`. `??`. Export `addFirst`. | DFS order | Checked |
| FZ79 | `emit/module_state.ts:97-125,146-187,216-226,460-540` | `ModuleState` repeats 20 signatures. The rewrite expanded one helper record into 9 getters, 10 `let`s, and an `if` chain. | An intersection type. One `Map<HelperKey, string>` and one getter, as `moduleStateFieldHelper` does. | Names, allocation order | Checked |
| FZ80 | `emit/doc.ts:427-947`; `emit/emit.ts:68-95,229-232`; `emit/decls.ts:460-467,948-955`; `emit/types.ts:537-547`; `type_ir.ts:31-39,147-166,272-275`; `type_lower.ts:584-603` | About 15 sites build one child command. `blankSeparated` and `predicateDoc` rebuild `join`. `flatWidth()` replaced a constant. The struct-field mapping, the option builder, and the `SchemaPresence` flag mapping each occur twice. | A `child` helper. `join`. Restore `FLAT_WIDTH`. Share one helper for each pair. A `Record<SchemaPresence, ...>`. | Emitted text, allocation order | Checked; `child` Inferred |
| FZ81 | `emit/expr.ts:511-527,776-799`; `lower.ts:1618-1654,1764-1781` | Two appends after a 5-item literal. One `flush` ternary 3 times. Two handlers repeat their lookup. Three identical loops. | One literal. Compute `base` once. Build one handler from the other. One loop. | Text, key order | Checked |
| FZ82 | `lex.ts:10-61,118-175,341-394,600-630,734-773,1129-1177`; `syntax.ts:15-90,172-324` | Each kind table has 3 or 4 hand copies, about 400 lines. `ContextualWords` and `CONTEXTUAL_ENTRIES` repeat keys. `lexerDiagnostic` has one caller. `scanNumber` has 3 return blocks that differ in code and text. | `as const` tables with derived types, as `DIAGNOSTIC_CODES` and `PREC` do. Iterate the object inside the function. Inline. Report once. | Lexer snapshot, precedence, scanner end conditions | Checked at runtime; lint by precedent |
| FZ83 | `parse.ts:339-346,536-543,761-802,863-1999` (12 sites), `1039-1057,1189-1686` | The expect-then-skip-newlines block occurs 10 times. The Missing-node block 3 times. The newline-skip loop 4 times. Two clause parsers differ in 2 values. The import tail occurs twice. `parserParseServiceImport` is an FY90 leftover. | `parserExpectThenNl`, `parserMissingNode`, `parserNextSignificant`, one clause parser, `parserParseImportSource`, `parserReportAtToken`. | Tokens, nodes, diagnostics | Checked |
| FZ84 | `syntax.ts:550-605`; `syntax_queries.ts:28,425`; `resolve.ts:924-928,1521`, `describeKind` | `printTree` copies the stack loop of `walk` again (FY48 came back). `Array.of` builds a list on each call. `allowAlias` is `boolean \| undefined` with `?? false`. `describeKind` is an 11-arm `if` chain. | `printTree` on `walk`. Module constants. A `boolean` parameter. A `Record`. | `printTree` output | Checked |
| FZ85 | `types.ts:476,499,539-541,1368-1388`; `type_lower.ts:447-448,477-505`; `predicates.ts:95-146,357-363`; `predicate_source.ts:396-404` | The rewrite added the flag `initializeBuiltins`. `keyOf` encodes `presence` as 3 booleans. `collectUnion` has 2 same append branches. `and` and `or` are one function. `termKey` is copied. | Move the builtin chain into `TypeTable()`. Use `presence`. One branch. One `junction` helper. Export `termKey`. | Intern equality, order | Checked; `junction` Inferred |
| FZ86 | `project.ts:185-406,479-490` | `Loader` returns 2 methods that `loadProject` calls once in order. `reportFailure` changes and returns one array. | One `loadModules` function. A pure `failureDiagnostic`. | Texts, order, live queue iteration | Checked |
| FZ87 | `editor_tokens.ts:146-187`; `editor_completion.ts:102,119-128,207-212,486-492`; `editor_index.ts:116-130`; `paths.ts:134-139` | `semanticClassifications` (cyclomatic 51) has 3 keyword branches and 7 identical pushes. The `while` rewrites read `if (!(A && B)) break;` with guards that the bound makes true. A bare `0` names `TriviaKind.Whitespace`. `generatedHeader` writes the header text again. | `lexicalType`. De Morgan forms and `reverseIndices`. The named constant. The two header constants. | Branch order, header bytes | Checked |
| FZ88 | `src/host/log_schema.ts:278-296`; `playground/src/app.ts:77-83,221,697`; `playground/src/highlight.ts:42-54,167-168`; `src/lsp/protocol.ts:401-418` | `isSessionId` keeps a counter by hand. A local `errorMessage` shadows the core helper and line 697 repeats it. `CompileResult` is the core `Result`. Two one-line wrappers have one caller each. Two option blocks differ only in the name. | `every`. Rename and call `errorMessage`. Use `Result`. Inline. One `booleanOption`. | Acceptance, texts, warning order | Checked; `LoadResult` Inferred |
| FZ89 | `scripts/lex_snapshot.ts:36-46`, `scripts/mutate.ts:213-221`, `bench/generate.ts:62-73`; `scripts/rules_unfired.ts:87-92`, `coverage.ts:531-533,571-579`; `behavior_compare.ts:82-84`; `logs_replay.ts:394-403,524-528`; `logs_report.ts:160-165,215-221,301-328`; `test_slow.ts:24-35`; `tests/helpers.ts:516-544,722-756`; `tests/surface_cases.ts:106-119`, `lsp_helpers.ts:30-37`; `tests/target_helpers.ts:33-49,90-129` | Three copies of mulberry32 (a scratch run found 0 differences). Two `run` wrappers rename one field. `pad` only calls `padEnd`. `selected` repeats `selects`. `loadExamples` equals `exampleFiles()`. The sessions table repeats `table()`. One append step 3 times. A hand-run process. Three helpers build one project. Two `readTree`. Two helpers repeat `assertValidProject` and `withTemporaryDirectory`. | Reuse the existing helper in each case. Move `makeRandom` to `scripts/lib.ts`. | Hashes, sample order, texts, exit codes | Checked; `test_slow.ts` Inferred |
| FZ117 | `bench/m5_variants.ts:327-478`; `bench/m1.ts`, `m4.ts`, `m7.ts`; `bench/main.ts:71-72,107-226`; `bench/lsp_script.ts:101-111,198-203,431-529,585-592`; `bench/m5_target.ts:52-62,178-186`; `bench/generate.ts:560-564`; `bench/m2.ts:528-596`; `bench/profile.ts` | `runVariantsIn` repeats one skip block 4 times and has unreachable tests. Five sites open A then B. `run` repeats one failure block 7 times. `step` and `editOnDisk` share one change sequence. Two `readTree` and three write helpers. `samples` always equals `pairs.flat()`. | `measureService`, `openPair`, `reported`, `#change`, one `readTree` and `writeFiles`, derive `samples`. | Result order, texts, timer start | Checked |

## 1C Parameter bloat

| ID | Location | Evidence | Proposed change | Level |
| --- | --- | --- | --- | --- |
| FZ110 | `check_expr.ts:1437-1447`, `check_builtins/context.ts:62` | Both callers of `literalRecord` pass `count` as 1. | Remove `count`. | Checked |
| FZ111 | `check_builtins/stream.ts:227-232,377-401,512-516`; `effect.ts:79-84,751`; `schema.ts:705-736,991-995,1146-1158` | One-literal `name` parameters, a flag that `name` decides, and `optionalBridge` arguments that all come from `call`. | Remove or derive each one. | Checked |
| FZ112 | `check_builtins/effect.ts:571-578,626-630`, `schema.ts:1382`, `tables.ts:108-111,142-147`, `lower.ts:900-902,1157` | The `log` fact field is always `"fields"` or `undefined`. `options.on` is always `"on"`. | Booleans. The emitted IR must stay the same. | Checked; consumer side Inferred |
| FZ113 | `validate/import_checks.ts:282-291`; `type_checks.ts:287-294,322`; `refinements.ts:88-92,258-285,375,399-414,700-706`; `typing.ts:242-442` | `checkCallbackShape` reads only `env`. `containsDeferred`, `typeAssumptionsAt` default 2 values. `audit` always gets `exprChildren`. `invalid` always gets `ctx`. 13 of 19 `assignable` calls pass the same 3 values. | Pass `env`. Required parameters. Import. Read `ctx`. A `part(a, b)` helper. | Checked |
| FZ114 | `emit/families/effect.ts:41,48`; `schema.ts:154-155,366-386,472-513`; `emit/expr.ts:343-361,1473-1475`; `emit/decls.ts:277-281`, `emit.ts:113-114` | `mode` always travels with `kid`. `schemaConversion` has 8 parameters with 5 shared. `nestHeads` and `closure` get constant arguments. `DeclarationEmitter` gets 2 values from its own `scope.ir`. | Remove or derive each one. | Checked |
| FZ115 | `editor_completion.ts:303-338,500-506`; `interface.ts:234-286`; `service_bounds.ts:95-153`; `src/host/outputs.ts:263-310` | `declarationStart` is only set false and returned. Production always passes 2 optional values. `allowedServices` always gets the outer `allowed`. `removeStaleOutputs` gets one module in production. | Return the flag. Required parameters (low). Bind once (Inferred). One module, and split the test. | Checked |
| FZ116 | `bench/lsp_client.ts:26,64-107,272`; `bench/lsp_script.ts:353-374,744-768`; `bench/m4.ts:26,119`; `bench/m6.ts:35-53`; `scripts/package_vscode_smoke.ts:10-23` | Constant or always-passed arguments, an unused default, and a parallel client list. | Make them required or delete them. | Checked |

## 1D Premature optimization

No finding. FZ97-FZ99 need a measurement first. The examiners kept every cache.

## 1E Test gaps

LCOV of both suites marks the "Checked (LCOV)" lines as never run. The other rows assert only a code or a tag, so LCOV cannot show them.

| ID | Location | Gap | Level |
| --- | --- | --- | --- |
| FZ120 | `check_expr.ts:861-869,1184-1199,1562-1574,2728-2734` | Block-local recursion gives `execution-mode/003` (probe); the error-construction arity text; "requires an inline arrow callback"; `const { x, x: y } = r` gives `declaration/001`. | Checked (probe, LCOV) |
| FZ121 | `check_declarations.ts:215-270,838-862`; `check_patterns.ts:290-297,525-529,571-573` | Service borrow checks (probe: 2 diagnostics at one span); `checkHostContracts` asserts only one code (probe: exactly 2 at offsets 1 and 70); 3 pattern messages. | Checked (probe, LCOV) |
| FZ122 | `check_builtins/layer.ts:143-149`, `stream.ts:237-244`, `effect.ts:621` | Three messages that no test runs. | Checked (LCOV) |
| FZ123 | `validate/refinements.ts:232-235,621-686,785-786,884-891,954-955,1028,1032`; `validate/expr.ts:405-408,1944,1986-1987`; `validate/typing.ts:166,504-512,635-636,971` | 13 refinement-declaration rejections and other validator paths that no test runs. | Checked (LCOV) |
| FZ124 | `validate/families/schema.ts:150-174,283-299,980-996`; `import_checks.ts:253-262,304-312`; `serialization.ts:82-104`; `families/effect.ts:158-209,448-450,587-600`; `layer.ts:134-149`; `declaration_checks.ts:168-178,309-319`; `type_checks.ts:97-99,226-236` | Message texts that tests assert only by code. | Checked (LCOV for `import_checks.ts`); others Inferred |
| FZ125 | `parse.ts:890-892,2019-2031`; `resolve.ts:1116-1122` | `const {} =` gives `40-41 syntax/008`; `{ 1: 2 }` gives `41-42 syntax/011`; a 3-part qualified name gives `unknown-name/004` (probes). | Checked (probe, LCOV) |
| FZ126 | `infer_inputs.ts:367-376,446-455` | Error-constructor argument inference (`Int`); `input \|> Positive`. | Checked (LCOV) |
| FZ127 | `project_config.ts:193-344`; `project.ts:246-305`; `editor_rename.ts:123-192` | 10 of 11 config shape messages, 4 loader messages, and 6 of 8 rename texts are asserted only by tag or by `ok`. These tests must come before FZ1 and FZ86 touch those files. | Checked |
| FZ128 | `playground/serve.ts:105-127`; `src/lsp/jsonrpc.ts:274-323`; `src/lsp/wire_log.ts:21,57` | `GET /replay/<file>` has no test; 7 of 8 `classify` reasons; the 1000-event cap. | Checked; cap Inferred |
| FZ129 | `scripts/measure_kernel.ts`, `measure.ts`, `measure_functions.ts`; `logs_replay.ts`; `coverage.ts:157-216,314-417`; `release.ts:99-112`; `logs_report.ts` | The measure scripts have no test. Reason texts and 20 coverage messages are asserted only by tag. | Checked |
| FZ130 | `bench/lsp_script.ts:146-174,355-367`; `bench/m4.ts:121-148`; `bench/main.ts:107-226`; `bench/m5_variants.ts` | Setup failure texts and `run` exit codes. | Checked |
| FZ131 | `emit/families/effect.ts:90`, `schema.ts:298-299,509`; `emit/tsc.ts:125-129`; `emit/sourcemap.ts:45-47` | Three runtime failures in generated code; a malformed escape; one invariant. Low. | Inferred |

## Behavior-changing candidates (FZD6)

| ID | Location | Change |
| --- | --- | --- |
| FZ100 | `check_expr.ts:1191-1199,1284-1292` | The rest of FY29: `arityMessage` writes "takes 1 argument" where these sites write "takes one (record) argument". |
| FZ101 | `check_declarations.ts:857`, `check_builtins/scope.ts:234`, `validate/declaration_checks.ts:118` | Two wordings of the borrow rule. |
| FZ102 | `check_declarations.ts:838-862` | A borrow parameter in a `.eff` service gets two `type-mismatch/010` at one span. |
| FZ103 | `check_builtins/effect.ts:100-129,839-842` | `fail` is the only `"own-arity"` row. As a piped row, a wrong count gives the error type instead of `never`. |
| FZ104 | `validate/expr.ts:1557-1559` | A panic text names a class field that no longer exists. `tests/validate_builtin_test.ts:119` pins it. |
| FZ105 | `validate/refinements.ts:159-164` | A `readonly LocalId[]` parameter changes the result for malformed IR. |
| FZ106 | `lex.ts:255-264` | Nothing reads `KEYWORDS.get`. Removing it changes the type of a `frontend.ts` export. |
| FZ107 | `lower.ts:1503-1507` | Two unreachable internal errors with different texts. |
| FZ108 | `playground/src/highlight.ts:120-162,229-232` | The `where` test could read the token stream. Comments, newlines, and non-ASCII names would change the result. |
| FZ109 | `scripts/version_hook.ts:20-25`; `bench/stats.ts:68-84`; `bench/m2.ts:416-420`, `m5.ts:128-129`, `m5_variants.ts:278-279,422-430` | A failure text, the M2 checksum digits, and the order of `samples` in the JSON file. |

## Rejected proposals

- The examiner proposals for `signatures.ts:315-331` and `check_declarations.ts:407-415` use two conditional spreads in one record. ZTS614 allows one leading spread.
- The owner returns that consume a result, the `createMatchState` capability, the write handles in `check_declarations.ts`, and the `undefined` arguments that replace default parameters are forced by the lint.
- `GateLive` and `StoreLive` in `bench/generate.ts` are not exports: they occur only in generated source text.
- The renames of `exprEmitterScope` and the `bodyLowerer` aliases change about 140 uses for no net saving.
- The items rejected by the first review stay rejected.

## Unread ranges

- `src/lsp/protocol.ts` lines 1-59 and 139-239, and `playground/src/editor.ts` lines 1-35 and 165-296.
- `scripts/validate_fixtures.ts` lines 300-480 (grep only), and `tests/lift_slot_programs.ts` lines 20-57.
- `bench/m3.ts` 1-14, `m4.ts` 1-13, `m7.ts` 1-17, `ref_update.ts` 1-13.
- `src/core/sha256.ts` 19-84 (the constant table) and `diagnostics.ts` 120-320 (registry descriptions), which had a structure scan only.

## Register effects

These findings touch rows of `fixtures/mutation/survivors.json`: FZ21, FZ23, FZ28, FZ30, FZ55, FZ84 and FZ5 in `resolve.ts`, and FZ87 in `editor_actions.ts`, `editor_index.ts`, and `project_config.ts`. Each unit that touches a registered declaration runs `deno task mutate` on its module.
