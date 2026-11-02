# Analysis report: simplify and rebase the Effektive compiler

Analyst: Fable. Snapshot: `/tmp/eff-fable`, a copy of `cb4abd3`. Finding prefix: FB (renamed from F when the report entered the repository).

Evidence limits. The snapshot has one commit, so file churn and dates come from the documents, not from git. I ran 15 probe programs through `deno task effektive check` and `build`, and one `build --tsc`. I did not run the full suites. Line counts are `wc -l` unless a row says `loc`, which is nonblank, noncomment lines from `scripts/measure.ts`. "Use" of a prelude name is a word match in `.eff` and `.effi` files, counted by `scratch/prelude_usage.ts`.

## 1. Keep set

Each row names a feature, the evidence that it matters, and whether the row is a fact or a user decision.

| Keep | Evidence | Status |
| --- | --- | --- |
| The pipeline: lex, parse, resolve, check, lower to typed IR, emit Effect-TS | `docs/architecture.md` pipeline table. The five applications, the examples, and the website project `order-lifecycle` compile with 0 diagnostics in the snapshot. `build --tsc` of the examples passes. | Fact |
| Source forms of the applications: types with identity, records, errors, services, `fails` and `uses` contracts, `match`, `try`/`catch`/`finally`, `provide`, `retry`, Option, arrays, blocks | 627 lines of `.eff` across the 5 applications in `fixtures/applications/` use them. The spec sections "Data and types" through "Modules and boundaries" describe them. | Fact |
| The 27 prelude names that an application uses | `fail`(31) `Some`(13) `None`(12) `now`(7) `schema`(5) `run`(4) `schemaDecode`(4) `provide`(3) `layer`(3) `fold`(3) `retry`(2) `mergeLayers`(2) `retrySchedule`(2) `decode`(2) `encode`(2) and 12 names used once: `unfold` `mapEffect` `sinkForEach` `takeSink` `transduceStream` `runStream` `bufferStream` `makeRef` `getRef` `setRef` `schemaEncode` `traverse`. | Fact |
| The 22 prelude names that only the website examples or the tutorial use | `schemaStruct`(21) `schemaConstructorDefault`(11) `schemaDefaultKey`(9) `schemaMake`(9) `all`(9) `schemaArray`(4) `schemaOptionalKey`(4) `map`(4) `filter`(3) `schemaUnion`(3) `schemaRecursive`(3) and 11 names used once or twice: `log` `defer` `scoped` `forkScoped` `aggregateWithinStream` `scheduleSpaced` `schemaNullToMissingKey` `schemaOptionFromOptionalKey` `schemaOptionalTransform` `schemaOptionalFromRequired` `schemaTransform`. | User decision: the website documents them, so removal changes the specification |
| The command-line tool `check`, `build`, `watch` | `src/cli/args.ts:25-36`. The application READMEs give the build commands. | Fact |
| The language server and the VS Code client | 19 LSP methods in `src/lsp/`. D1 and D16 in `docs/architecture.md`. The user still owns the hand test (`docs/status.md`, open items). | Fact, pending user acceptance |
| The playground | `playground/src/`, 1,736 loc. The user still owns the acceptance. | User decision |
| Host interfaces (`.effi`) and companion modules | `fixtures/applications/service-workflow/host.effi` and `fixtures/examples/host/`. D10. | Fact |
| Incremental `Program` with module-level cutoff | `src/core/db.ts` (509 lines). The LSP and the playground build on it (`playground/src/compile.ts:130`). D4 and D9. | Fact |
| Strict target check with the pinned lock | `src/cli/target_lock.json`, `src/core/emit/tsc.ts`, invariant 7. | Fact |
| Refinements (`where`) and inferred input contracts | 0 uses in applications. 1 website example (`effektive-examples/refined-entry.eff`) uses both. Core cost: 2,948 lines of refinement files plus 1,020 lines of inference files. Named test files: 4,775 lines. | User decision: specified features with no application use |
| The independent validator as a test oracle | D11. One recorded catch: `docs/solutions/logic-errors/pipeline-stage-effects-must-come-from-the-checker.md`. See FB2 for the cost. | User decision |

## 2. Thesis

The pipeline is sound and the stage boundaries are right; the earlier resets proved that and I found no incorrect behavior in 15 probes. The weight is breadth, not structure. The language carries 117 prelude names and 122 IR expression kinds, and each builtin touches 10 to 11 core files plus about 10 test files, while the five applications use 27 names. A second semantic implementation, the validator, repeats the checker on purpose at 11,086 lines plus 10,214 test lines, and no product path runs it. Tools that serve no reader add about 11,800 lines in `bench/`, `scripts/`, and the logging loop, with 0 real session logs. The largest simplification is to shrink the surface to the demonstrated subset, demote the validator to a test oracle or delete it, and remove the tools with no reader; the core then holds about half of its lines with no change to the pipeline.

## 3. Findings

### FB1 (remove) Prelude names that no program uses

Evidence. `src/core/resolve.ts:1-173` defines 117 prelude names. 90 have no use in the 5 applications. 68 have no use in the applications, the examples, the tutorial, or the 21 website example files. The 68 are: `timeout` `sleep` `random` `randomInt` `uninterruptible` `repeat` `makeScope` `provideScope` `addScopeFinalizer` `closeScope` `withResource` `mapGroups` `scanStream` `mapAccumStream` `foldStream` `foldEffectStream` `collectStream` `headStream` `lastStream` `drainStream` `aggregateStream` `scheduleFromStep` `scheduleRecurs` `scheduleExponential` `scheduleCron` `scheduleJittered` `scheduleMap` `scheduleMax` `scheduleMin` `scheduleConcat` `mergeStreams` `zipStreams` `concatStreams` `flatMapStreams` `switchMapStreams` `catchStream` `retryStream` `debounceStream` `throttleStream` `takeStream` `dropStream` `filterEffectStream` `takeWhileEffectStream` `takeUntilEffectStream` `dropWhileEffectStream` `race` `mapOf` `getMap` `putMap` `removeMap` `hasMap` `entriesMap` `setOf` `addSet` `removeSet` `hasSet` `itemsSet` `updateRef` `codec` `schemaInvalid` `schemaAt` `schemaBoth` `withFiber` `joinFiber` `interruptFiber` `partitionAll` `validateAll` `allResults`. 47 of the 68 appear in no `.eff` file at all, only in inline test strings.

Cost of one builtin: `mapOf` appears in 10 `src` files, `throttleStream` in 11 `src` files and 10 test or fixture files. The IR has 122 expression kinds (`src/core/ir.ts:168-290`), and 35 of them are stream kinds, 13 schedule kinds, 11 Map and Set kinds. Family sizes in lines: stream 2,796 (`check_builtins/stream.ts` 1,407, `validate/families/stream.ts` 1,084, `emit/families/stream.ts` 305) plus `tests/emit_stream_slow_test.ts` 2,248; schedule 856; Map and Set 687 plus `tests/map_set_ops_test.ts` 1,047; scope 939; fiber 341. The 25 unused stream names appear in 13 test files that total 22,834 lines; the attributable share needs measurement after a pilot removal.

This reopens FND1 of the foundation reset, where the user chose "keep all 117". New evidence: this brief asks for the most important features, not for preserved functionality, and the use counts above are measured against the website too.

Proposal. Remove the 68 names in family order: Map and Set first (0 uses anywhere, the newest family), then the 25 stream operators, the 10 schedule constructors, the 4 explicit scope names, the 3 fiber names, and the rest. Keep the 27 application names. Decide the 22 website-only names separately (see section 6). Each removal deletes the family rows in the checker, validator, emitter, the IR kinds, the lowering cases, the `ROWS` and `exprChildren` rows, the prelude entry, the tests, and the `docs/language-rules.md` rows. The spec and the website lose the matching entries.

Effect. Needs measurement by pilot; the stream family alone is 2,796 core lines and about 2,300 slow-test lines. A rough bound from the family files is 5,000 to 6,000 core lines and 35 to 60 IR kinds.

Preserves and risks. The applications, examples, and tutorial compile unchanged. Golden files do not change. Risk: the website specification and `docs/language-rules.md` need matching edits, and a future application may want a removed name back; git history keeps it.

Effort L (across families; each family is M). Confidence high for the counts, medium for the line effect. Depends on a user decision (section 6, question 1).

### FB2 (replace, then remove) The independent validator as product code

Evidence. `src/core/validate/` is 24 files, 11,086 lines, 10,532 loc, 3,304 branches. No product path runs it: 0 call sites in `src/cli`, `src/host`, `src/lsp`, and `playground/src` except the opt-in `build --validate` flag (`src/cli/args.ts:29`) and `Program.validate` (`src/core/db.ts:234`). It is by design a second implementation: `check_refinements.ts` and `validate/refinements.ts` share 250 distinct identical nontrivial lines (126 shared 10-line windows); `guardedRecord` at `types.ts:65` and `validate/world.ts:795` are 107 lines each with 22 differing lines; `types.ts` shares 104 identical lines with `validate/typing.ts` and 92 with `validate/world.ts`. The validator-only tests are 10,214 lines in 9 files (`validate_test.ts` 3,562, `validate_family_mutation_test.ts` 1,271, `validate_rejections_test.ts` 1,232, `validate_typing_test.ts` 1,143, `validate_expr_children_test.ts` 787, `validate_reference_walkers_test.ts` 759, `validate_mutation_test.ts` 647, `validate_schema_constructor_guards_test.ts` 407, `schema_validator_forged_test.ts` 406), plus 23 files in `fixtures/validate/`, `scripts/validate_fixtures.ts` (591), `scripts/rules_unfired.ts` (153), and 2 tasks. Value recorded: one checker and lowering defect, in `docs/solutions/logic-errors/pipeline-stage-effects-must-come-from-the-checker.md`. The spec mentions the validator 18 times, including "The independent validator lives in the effektive-lang repository".

Proposal, in two steps. Step 1: make the validator a test oracle. Remove `--validate`, `Program.validate`, and `validateProject` from the entry points, and keep `validateModule` reachable only from tests. Step 2, a user decision: delete the semantic families and keep a structural IR check of about 500 lines (wire version, serialization, reference integrity, exhaustive child walk) that the emitter's `ROWS` table can share once invariant 2 no longer forbids it. The remaining oracles are `deno check` of emitted code under the pinned lock, the golden files, the application runtime tests, and the property tests.

Effect. Step 1: about 60 lines. Step 2: removes about 10,500 core lines, about 10,000 test lines, 23 fixtures, 744 script lines, 2 tasks, the type-laws cross check in `tests/type_laws_property_test.ts`, and invariant 2.

Preserves and risks. Emitted text, diagnostics, and the IR do not change. Risk: the one recorded defect class (lowering copies a checker fact and diverges) loses its oracle; a cheaper replacement is a lowering test that compares IR facts with checker facts for the examples. The spec sentence about the validator changes. D11 is reversed, which needs the user.

Effort S for step 1, L for step 2. Confidence high for the measurements, medium for the risk judgment. FB1 shrinks step 2.

### FB3 (remove) The logging, report, and replay loop

Evidence. The loop is 2,203 lines of code (`src/host/log.ts` 239, `src/host/events.ts` 51, `src/lsp/wire_log.ts` 181, `playground/src/log_client.ts` 122, `playground/log_endpoint.ts` 99, `playground/src/replay.ts` 97, `scripts/logs_report.ts` 665, `scripts/logs_replay.ts` 589, `src/cli/session.ts` 160), 2,184 lines in 9 test files, 6 hand-written logs in `fixtures/logs/`, 2 tasks, and `docs/logging.md` (118 lines). `playground/.effektive/logs/` holds 0 files. The FR1 to FR7 findings wait for real logs (memory note and the foundation reset, section 10). The stable base reset kept the log kinds because "the FR work waits for real logs"; after seven days there are none.

Proposal. Remove the report and replay scripts, their tests, the fixtures, the two tasks, the FR backlog, and the playground log client and endpoint. Keep or remove the session writer in `src/host/log.ts` as the user prefers; without a reader it has no value.

Effect. Removes about 2,200 code lines, about 2,200 test lines, 6 fixtures, 2 tasks, 1 document, and the `--no-log` and `--log` flags of the command-line tool.

Preserves and risks. No compiler output changes. Risk: a future debugging session has no replay. The surface snapshot changes for the removed flags.

Effort M. Confidence high. No dependency.

### FB4 (remove) The measurement harnesses

Evidence. `bench/` is 17 files, 5,155 lines, 4,567 loc. `docs/rejected.md:24` states "No candidate change has been measured", and its evidence-gap list has 14 unmeasured items. The one decision that the harness served is the D9 budget, measured once on 2026-10-17. `bench/m5_variants.ts` installs npm packages into a temporary workspace. `tests/type_laws_property_test.ts`, `tests/incremental_property_test.ts`, and `tests/acceptance_property_slow_test.ts` import `makeRandom` from `bench/generate.ts` (584 lines), and `tests/bench_generate_test.ts` tests it. `docs/measurements.md` (101), `docs/release-measurements.md` (155), and `docs/refinement-measurements.md` (56) describe the runs.

Proposal. Delete `bench/` except `generate.ts`, which moves to `tests/` with its test. Delete the `bench` task and `bench/lsp_client.ts` with it. Move the three measurement documents to `docs/archive/`, with one line in `docs/status.md` that records the D9 budget and its date.

Effect. Removes 16 files, about 4,570 lines, 1 task, 3 live documents.

Preserves and risks. Property tests keep their generator. Risk: a future performance regression has no harness; a single `m2`-style timing of `checkProject` on the generated large project is about 100 lines if the need returns.

Effort S. Confidence high. No dependency.

### FB5 (remove) Refactor-time oracles with no current refactor

Evidence. `scripts/behavior_capture.ts` (387) with `tests/behavior_capture_test.ts` and `tests/behavior_capture_slow_test.ts`; `scripts/lex_snapshot.ts` (112) with `fixtures/lex/snapshot.json` and `tests/lex_snapshot_test.ts`; `scripts/rules_unfired.ts` (153). `docs/testing.md` records that the capture "sees only its record kinds and the test inputs" and that the unfired check "is textual". Each served one reset. `scripts/mutate.ts` (772) stays: `AGENTS.md` requires it after a logic change, and it produced the 25-row survivor register.

Proposal. Delete the three scripts, their tests, the lexer snapshot fixture, and the tasks `behavior:capture`, `lex:update`, and `rules:unfired`. Keep `mutate`, `coverage`, `golden:update`, `surface:update`, and `measure`.

Effect. Removes about 650 script lines, 3 tasks, 1 fixture file, and 3 test files (needs measurement for the test lines).

Preserves and risks. The golden files, the surface snapshot, and the mutation register keep their roles. Risk: a later large refactor rewrites a capture tool; the archive keeps the design.

Effort S. Confidence high. No dependency.

### FB6 (remove) Structural tests that assert private sites and file layout

Evidence. Nine test files, 5,635 lines, read source text or forge private inputs: `validate_family_mutation_test.ts` 1,271, `validate_expr_children_test.ts` 787, `validate_reference_walkers_test.ts` 759, `builtin_report_sites_test.ts` 746, `validate_mutation_test.ts` 647, `internal_sites_test.ts` 570, `core_boundary_test.ts` 481, `builtin_arity_test.ts` 294, `emit_families_test.ts` 80. `internal_sites_test.ts:1-8` says its 13 sites are ones "no source program reaches". The house testing rule says not to assert private state or file layout. The checker has 95 `throw` sites, 33 in `lower.ts`, and all are `internal` failures that the checker excludes.

Proposal. Keep `core_boundary_test.ts` and `emit_families_test.ts`, which enforce the stated layering rules. Delete `internal_sites_test.ts`. Delete the validator walker and mutation tests with FB2 step 2. Review `builtin_report_sites_test.ts` and `builtin_arity_test.ts`: keep each case that a source program can reach, and move it to a fixture in `fixtures/errors/`.

Effect. Removes about 4,000 to 5,000 test lines, measured after FB2.

Preserves and risks. Reachable diagnostics keep a test through the public API. Risk: coverage of the 13 internal sites drops, and the coverage floors (97 lines, 95 branches, 99 functions) may need a lower value or an exclusion of unreachable guards, as `docs/testing.md` already does for eight solver sites.

Effort M. Confidence medium. Depends on FB2.

### FB7 (remove) The archive as a search target

Evidence. `docs/archive/` holds 105 Markdown files, 23,012 lines, 2.1 MB, against 3,851 lines of live documents. `AGENTS.md` asks an agent to search the documents before a change, so the archive is a context cost on every task. The foundation reset kept it because live documents link 80 of its files. The registry in `docs/plans/README.md` has 36 rows, all archived except one deferred plan.

Proposal. Keep the decision records that live documents cite for a rule (`architecture-review-2026-10-25.md`, the disagreement audit, the contracts that `docs/language-rules.md` cites). Delete the worklogs, ledgers, progress tables, and the reset plans of 2026-10-25 to 2026-11-01, and replace each link with the commit hash. Reduce `docs/plans/README.md` to the open prefixes.

Effect. Needs measurement; a count of the files that `docs/language-rules.md`, `docs/architecture.md`, and `docs/status.md` cite gives the keep list.

Preserves and risks. Git history keeps every file. Risk: a broken link in a kept archive file; the link test skips `docs/archive`.

Effort M. Confidence medium. Depends on a user decision (section 6, question 4).

### FB8 (simplify) Hand-maintained duplicates in the live documents

Evidence. `docs/api.md` (953 lines) holds a source file map with 166 `.ts` references that mirrors the header comment of each file; every core file starts with such a comment. `docs/language-rules.md` (998 lines) and `docs/status.md:48-165` both describe the language state (FNF24 reported the overlap and FN11 reduced it, and 213 lines remain). The spec in the sibling repository is the authority for the language.

Proposal. Generate the file map from the header comments with a 40-line script, or delete the map and point to the headers. Cut the "Language and compiler state" table of `docs/status.md` to one link per row.

Effect. Removes about 150 lines from `docs/api.md` and about 60 from `docs/status.md`; the generated map replaces hand edits.

Preserves and risks. No code change. Risk: none beyond stale links, which the link test catches.

Effort S. Confidence high. No dependency.

### FB9 (missing) No test compiles the website example projects

Evidence. The sibling site holds 21 `.eff` files and 5 project directories with `effektive.json` under `/Users/srdjans/Code/effektive/public/effektive-examples/`. `tests/ir_site_slow_test.ts` guards only the typed IR copy. The foundation reset lists "Nothing ties website examples to fixtures" as an open risk. A copy of the website `order-lifecycle` project compiles in the snapshot with 2 modules and 0 diagnostics, so the check is cheap today.

Proposal. Add one slow test that compiles each website project directory and each single file with `checkProject`, skipped when the sibling is absent, as the IR site test does.

Effect. Adds about 60 test lines. Closes one recorded risk.

Preserves and risks. Nothing changes in the compiler. Risk: the test depends on a sibling checkout, like the existing IR site test.

Effort S. Confidence high. No dependency, and it should land before FB1 so that the removed names show up on the website.

### FB10 (incomplete) A record literal as an arrow body gives two misleading diagnostics

Reproducer. File `scratch/probe2/d.eff` before correction:

```eff
export type Int = int
export type P = { a: Int, b: Int }
export const p = (): P => { a: 1, b: 2 }
```

Command: `deno task effektive check scratch/probe2`. Observed: `d.eff:3:29: error unknown-name/001: unknown name 'a'` and `d.eff:3:30: error syntax/008: expected end of line or ';', found ':'`. Expected: one diagnostic that says a record literal body needs parentheses, as the spec states ("Parentheses distinguish a returned record"). Cause, confirmed in `src/core/parse.ts`: `parseBody` always calls `parseBlock` for `{`, and the block parser reads `a` as an expression statement. With parentheses the same program compiles and emits `$record<P>({ a: 1, b: 2 })`.

Proposal. In `parseBlock`, when the first tokens are `Ident :` or `...`, report one `syntax/0xx` diagnostic "a record literal body needs parentheses: ({ ... })" and parse the record for recovery.

Effect. About 20 parser lines, 1 error fixture, 1 diagnostic code, 1 row in `docs/language-rules.md`.

Preserves and risks. Programs that compile today do not change. Risk: the surface snapshot and the error fixture change.

Effort S. Confidence high. No dependency.

### FB11 (replace) The website IR copy is a hand copy with a weak guard

Evidence. `command diff src/core/ir.ts /Users/srdjans/Code/effektive/public/typed-ir.ts` prints 784 lines. `tests/ir_site_slow_test.ts:1-5` says the guard "cannot see an extra optional property on one side, so it does not prove equal members". The stable base reset rejected a declaration normalizer as too much for 430 diff lines; the diff has grown.

Proposal. Replace the hand copy with a generated file: a script copies `ir.ts` into the website repository with a header, and the test compares the two files byte for byte after the header. The website commit stays separate, as `AGENTS.md` asks.

Effect. About 30 script lines; the assignability test shrinks to a byte comparison.

Preserves and risks. The IR contract does not change. Risk: the website file gains the checker-side comments of `ir.ts`; the spec owner may want a shorter form.

Effort S. Confidence high. No dependency.

### FB12 (remove, user decision) Packaging and installation checks for a package with no consumer

Evidence. `scripts/package.ts` (250), `scripts/package_vscode_smoke.ts` (175), `scripts/release.ts` (182), `tests/installation_slow_test.ts`, `editors/vscode/test/installed.js` (198), and the tasks `package`, `release`, `test:installation`, `test:vscode`. Invariant 5 states that no outside code imports the package, and no publish is authorized. The VSIX is the user's local install path (`docs/installation.md`).

Proposal. Keep `package.ts` for the VSIX. Delete `release.ts` (it only edits the changelog and runs the gate and coverage), the installation test, and the VS Code smoke test with its task. Record the two manual steps in `docs/development.md`.

Effect. Removes about 560 script and test lines and 3 tasks.

Preserves and risks. The VSIX build stays. Risk: a packaging regression is seen only on the next local install.

Effort S. Confidence medium. Depends on a user decision (section 6, question 5).

### FB13 (incorrect) No confirmed incorrect behavior

I ran 15 probe programs: `__proto__`, `constructor`, and `toString` as record fields (emitted as `["__proto__"]` with a null-prototype record), string escapes with quotes, backslashes, `${`, backticks, and U+2028, a duplicate record field (`type-mismatch/005`), a duplicate match arm (`pattern/002`), an integer literal beyond the safe range (typed `number`, rejected against `Int`), a non-exhaustive `match` on `int` (`pattern/001`), a prelude shadow (`declaration/002`), 3,000 nested parentheses (`syntax/009`, exit 1, no crash), and a refinement with `+ 1`, `- 1`, a proven literal, and a disproved literal (two `type-mismatch/013`). Each result matched the documented rule. The `build --tsc` run of the examples passed. I found no incorrect finding with a run reproducer. The honest answer is that the checker and emitter held on these inputs; a wider search needs a fuzzing pass beyond the token edits that the acceptance property test covers.

## 4. Order of work

Phase 0, user decisions (section 6). Phase 1, no language change and low risk: FB9 (website test, so later removals are visible), FB4 (bench), FB3 (logging loop), FB5 (refactor oracles), FB12 (packaging, if accepted), FB8 (documents). Each lands as one commit with `deno task check`. Phase 2, FB2 step 1 (validator as test oracle) and FB11 (generated IR copy). Phase 3, FB1 family by family, Map and Set first, with the website edit in the sibling repository for each family; FB2 step 2 after the first family proves the process. Phase 4, FB6 (structural tests) and FB7 (archive) once FB1 and FB2 settle the test set. Phase 5, FB10 (record body diagnostic). Run `deno task coverage` at the end of each phase, and set the floors again with a reason if they move.

## 5. Considered and rejected

- A universal builtin table or family registries. SBF27 measured 6.3% mechanical lines. FB1 reduces volume instead, which is the inverse of SBF27's reopen condition.
- Elaboration in the checker to drop lowering. Rejected by the foundation reset; lazy lowering is what keeps hover cheap. No new evidence.
- A split of `check_expr.ts` (3,001 lines) or `check_body_test.ts` (6,814 lines, 249 tests). The largest functions are flat dispatch; a split moves lines.
- Removal of refinements and inferred inputs. 0 application uses, but the spec documents both and the solver is measured and proven. Listed as a keep-set user decision, not a finding.
- Removal of the surface snapshot (4,222 JSON lines). It is a cheap message oracle and `surface:update` is one command.
- Removal of `scripts/mutate.ts`. `AGENTS.md` requires it and the survivor register has 25 justified rows.
- One LSP client for `bench/lsp_client.ts` and `tests/lsp_helpers.ts`. One is a process client and the other an in-process harness; FB4 deletes the first.
- A rewrite of the parser or the type table. Both held under the probes, and RSTF9 found no reason.
- A hosted CI. D24 says the gate is `deno task check`.
- Pruning entry-point exports. FN7 did it; `frontend.ts` has 68 named exports and `typescript.ts` 23, and the brief says no outside code imports them.

## 6. Open questions for the user

1. Prelude surface (FB1). (a) Remove the 68 names with no use anywhere. (b) Remove the 90 names with no application use, and rewrite the website examples that use the 22 website-only names. (c) Keep all 117. Recommendation: (a) now, and (b) after the website owner agrees.
2. Validator (FB2). (a) Test oracle only. (b) Test oracle now, then delete the semantic families and keep a structural check. (c) Keep as is. Recommendation: (b).
3. Logging loop (FB3). (a) Delete the loop and the FR backlog. (b) Keep only the session writer. (c) Keep all until real logs exist. Recommendation: (a).
4. Archive (FB7). (a) Prune to cited decision records. (b) Keep all. Recommendation: (a).
5. Packaging checks (FB12). (a) Keep the VSIX build only. (b) Keep all. Recommendation: (a).
6. Refinements and inferred inputs. (a) Keep both as specified features. (b) Open a separate review. Recommendation: (a).

Areas I did not examine in depth: `src/core/emit/doc.ts` and `module_state.ts` printer internals, `src/lsp/projects.ts` workspace handling, the playground build and serve scripts, the fixture directories `emit/` and `errors/` file by file, and `editors/vscode/extension.js` beyond its header.

The next action belongs to the user: answer questions 1 to 6, then the orchestrator writes the phase 1 plan.
