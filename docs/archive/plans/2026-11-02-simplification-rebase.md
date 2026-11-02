# Simplification rebase

Prefixes: SR (items), SRD (decisions for the user). The evidence files use FB and AS (analysis findings of Fable and astra), and VF and VA (validation findings of Fable and astra).

Date: 2026-11-02. Base: `cb4abd3` (v0.12.1) on local `main`. Status: accepted on 2026-11-02 with SRD1, SRD2, and SRD3 at option a. SRD4 and SRD5 are decided at option a. Complete on 2026-11-02: every unit of Section 7 landed, and the SR13 measurement needed no policy. Section 11 holds the execution plan and the progress ledger.

## 1. Result

The pipeline shape is sound. Both analysts and both validators keep it, and none proposes a rewrite.
The size is in breadth: 117 prelude names, 123 IR expression kinds, and a second semantic implementation in the validator.

One removal is measured. A pilot removal of Map and Set (group G1) deleted 3,164 net lines in 45 files: 1,089 lines in `src/`, 2,023 in `tests/`, 37 in `fixtures/`, and 15 in `docs/`.
The applications, examples, tutorial, website examples, and golden files did not change. That is 2.1% of the 51,073 core lines.
The other six groups share infrastructure with kept code, so their size needs measurement. The G1 number does not scale by name count.

The largest lever is the validator: 11,086 source lines, 12,672 test lines in 17 files, 12,876 fixture lines, and 744 script lines.
The validators disagree on its removal. Section 6 gives the evidence and recommends a measured prototype first.

The analysis found five incorrect behaviors (SR0, SR1, SR5) and several incomplete or missing parts.
They are cheap to fix, and they need no product decision.

## 2. Method

The user asked for an analysis for large simplifications that keep the most important features.
The user also asked what is missing, what is not complete, what needs a better approach, and what is incorrect.

1. Fable and codex astra (`gpt-6-astra`) analyzed separate copies of `HEAD` independently. Fable reported 13 findings (FB1 to FB13). Astra reported 10 (AS1 to AS10).
2. The orchestrator (Opus) checked the main claims in the real repository and merged them into a draft with items SR1 to SR13.
3. Fable and astra validated the draft independently. Fable ran an oracle experiment and reported VF1 to VF7. Astra ran the G1 pilot and reported VA1 to VA10.
4. The orchestrator checked the conflicts in the real repository and wrote this proposal. Section 8 resolves each validation finding.

The evidence files are in [2026-11-02-simplification-rebase-evidence/](2026-11-02-simplification-rebase-evidence/). Their links to snapshot scratch files are plain text, because the snapshots were in `/tmp`.

## 3. Keep set

| Keep | Reason | Status |
| --- | --- | --- |
| Pipeline: lex, parse, resolve, check, lower to typed IR, emit Effect-TS | The 7 corpus roots (5 applications, examples, tutorial) check and build with `--tsc` with 0 diagnostics. | Fact |
| Source forms of the five applications | The 15 `.eff` files (623 lines) in `fixtures/applications/` use types with identity, records, errors, services, contracts, `match`, `try`, `provide`, `retry`, Option, and arrays. | Fact |
| Closed exported contracts, local inference, pure and effectful modes | `docs/language-rules.md:48-62`. | Fact |
| Host interfaces (`.effi`) and companion modules | D10. The service workflow uses them. | Fact |
| Incremental `Program`, lazy output, editor queries, the language server, the VS Code client | D4, D9, D16. The user owns the manual acceptance. | Fact |
| The playground | The user owns its acceptance. | User decision |
| Strict target check with the pinned lock | Invariant 7. It found SR1, and the validator did not. | Fact |
| Refinements and inferred input contracts | 0 application uses and 1 website example. All four reviewers keep them. | User decision, not reopened |
| The independent validator | SRD2. | User decision |
| `bench/`, the logging loop, the archive, the packaging checks | SRD3. | User decision |

## 4. Answers to the questions

Incorrect:

- SR0. The gate failed at `HEAD`: `CHANGELOG.md` ended at 0.12.0 and `deno.json` said 0.12.1. Repaired in `5bb3f71` before this plan.
- SR1. Source names `Math`, `Error`, `String`, and `globalThis` capture generated globals. Accepted programs fail `build --tsc`.
- SR5. Two live documents contradict the code (the `repeat` schedule option and the `--no-lock` flag).

Not complete: SR2 (the generated property stops before the target check), SR3 (website examples are not compiled), SR4 (record body diagnostic), SR11 (imports are not bound to producer exports), SR6 (the website IR copy is a hand copy).

Missing: SR14 (no type-level oracle for match coverage), SR16 (no written map of what each oracle catches), SR13 (no lifecycle for long language server sessions), SR17 (no rule for the IR version when IR kinds leave).

Better approach: SR8 (a second semantic implementation of the checker), SR6 (generate the website IR), SR10 (behavior capture through private source anchors).

Remove and simplify: SR9 (63 unused prelude names in seven groups), SR7 and SR8 (the validator), SR12 (tests of private sites), SR15 (unrelated advice in relayed TypeScript messages).

## 5. Items

Each item gives its sources, its effort (S, M, or L), and its acceptance check.
Each unit ends with `deno task check` and its own commit. Each logic change ends with `deno task mutate` on the module.

### Phase 1: correctness and oracles (no product decision)

SR0 (incorrect, from the corrections of astra's validation). Gate failure at `HEAD`. Done in `5bb3f71`: a 0.12.1 heading now lists the compiler reset repairs.

SR1 (incorrect, from AS1 and VA1). Source names capture generated globals.
`src/core/resolve.ts:220-233` reserves `undefined`, `Number`, `RangeError`, and others (decision D20). It omits `Math`, `Error`, `String`, and `globalThis`.
The emitter prints bare `Math.trunc` (`src/core/emit/expr.ts:1091-1095`), `Error` and `String` (`src/core/emit/outcome.ts:6-8`), and `globalThis` (`src/core/emit/fields.ts:184-227`).
Reproducers, each with `effektive.json` = `{}`:

```eff
type Int = int
export const divide = (Math: Int): Duration => 5s / Math
```

```eff
type Int = int
type Text = string
export const message = (Error: Int): Text => try { "ok" } catch { Defect(problem) => problem.message }
```

```eff
type Int = int
type Row = { toString?: Int }
export const globalThis: Int = 0
export const read = (row: Row): Option<Int> => row.toString
```

`build --tsc` gives TS2339 for the first, TS18046 and TS2359 for the second, and eight diagnostics for the third. Expected: 0 diagnostics.
Proposal: add the four names to the D20 list. SR2 finds the next omission by behavior, because a captured name is bound in the output and a free-name scan cannot see it.
Acceptance: each reproducer gives `declaration/002`. Effort S.

SR2 (incomplete, from AS9, VF7, VA). The generated acceptance property stops before the target check.
`tests/acceptance_property_slow_test.ts:113-159` lowers, validates, and emits, but does not type-check. Its edits reuse source tokens, so they cannot produce `Math`.
Proposal: a property renames legal bindings to names from a literal table of JavaScript and TypeScript globals. It runs `deno check` on batches under the pinned lock.
Each case must change the emitted text, because a cached check takes 0.08 s and an uncached 1-module check takes 0.57 s. The test asserts a nonzero count of accepted target cases, so a reservation of every name cannot make it vacuous.
Acceptance: the property fails on `cb4abd3` and passes after SR1. Effort M. After SR1.

SR3 (incomplete, from FB9, VF3, VA5). No test compiles the website examples.
The sibling has 21 `.eff` files and 5 projects. The 5 projects and 10 of the 11 single files pass `build --tsc` today. `effektive-examples/main.eff` imports `host:providers` and has no configuration, so it gives `module/002` and `requirement-contract/001`.
Proposal: a slow test reads a manifest of each example: entries, configuration, host interfaces, and expected result. It runs `check` and `build --tsc` on each. It skips with a printed reason when the sibling is absent. During SR9 work the sibling must be present.
The website gets the missing host material for `main.eff`, or the manifest marks it as a snippet. That is a separate commit in the sibling repository.
Acceptance: the test passes, and it fails when a removed name is still in a website example. Effort M. Before SR9.

SR4 (incomplete, from FB10). A record literal as an arrow body gives two misleading diagnostics.
`(): P => { a: 1, b: 2 }` gives `unknown-name/001` and `syntax/008`. The spec says that parentheses mark a returned record.
Proposal: when `parseBlock` sees `Ident :` or `...` first, report one new syntax diagnostic that asks for `({ ... })`, and parse the record for recovery.
Acceptance: one error fixture with one diagnostic. Programs that compile today do not change. Effort S.

SR5 (incorrect documents, from AS10 and FB8). Live documents contradict each other and the code.
`docs/language-rules.md:293` lets `repeat` take a general Schedule, and line 517 says that none does. Line 932 says that `--tsc` uses `--no-lock`, and `src/host/deno_io.ts:135` passes `--lock=`.
Proposal: correct both. Give each kind of rule one owner: source rules in `docs/language-rules.md`, API and adapter behavior in `docs/api.md`, commands in `docs/development.md`, status in `docs/status.md`. Replace each copy with a link. If SRD1 removes general Schedules, delete the Schedule rows instead.
Acceptance: the docs test passes, and each changed rule matches the code and a test. Effort S.

SR6 (replace, from FB11 and VA6). The website IR copy is a hand copy with a weak guard.
Plain `diff src/core/ir.ts ../effektive/public/typed-ir.ts` prints 430 lines. The guard cannot see an extra optional property.
`ir.ts` imports `Predicate` and `ProofCertificate` from `predicates.ts`, and the website file inlines them (lines 1-42). A direct copy fails with TS2307.
Proposal: a script generates a standalone `typed-ir.ts` with the predicate and proof declarations and a header. A test compares the bytes and checks the file alone. The website commit stays separate.
Acceptance: the test fails on any drift, and the generated file passes a standalone check. Effort M.

SR14 (missing, from VF1). No type-level oracle sees a non-exhaustive `match`.
The emitted fallback `$unmatched` takes `unknown` (`src/core/emit/decls.ts:789`). With a checker that skips `pattern/001`, a 2-arm match over 3 variants passes `build --tsc`.
Proposal: type the parameter as `never`, update `tests/emit_test.ts:812`, and add an error fixture whose target diagnostic is TS2345 when the checker is silent.
Evidence: 18 projects (examples, 5 applications, 5 website projects, 6 emit projects with a configuration, 1 probe) pass `build --tsc` with the change. Not covered: 4 emit directories without a configuration and nested patterns.
Acceptance: as stated. Effort S.

SR15 (simplify, from VF5). Relayed TypeScript messages carry unrelated advice.
TS2375 text ends with advice about `exactOptionalPropertyTypes`. `src/core/emit/tsc.ts:37-38` keeps the first line.
Proposal: cut the message after the first sentence for TS2375 and TS2322. Effort S.

SR16 (missing, from VF6). `docs/testing.md` does not say what the target check catches.
Proposal: add the oracle map of Section 6, SRD2. Effort S.

SR13 (missing, from AS8). Long language server sessions have no lifecycle. Measurement only in this phase.
The type table appends nodes and never frees them (`src/core/types.ts:489-500`, `614-620`). The language server never drops a project root (`src/lsp/projects.ts:377-393`, `540-548`).
Interned types grow from 11 to 1,013 after 1,000 edits of one record field. Heap bytes and latency are not measured.
Proposal: run `bench/m4.ts` over a long edit script now, before removals change the baseline. Choose a policy only if the numbers need one: a fresh `Program` from current files at a safe boundary, and removal of roots with no open document.
Acceptance: an M4 result in `docs/measurements.md`. Effort M.

### Phase 2: the validator as a test oracle

SR7 (simplify, from FB2, VA corrections). Remove the product paths of the validator.
`build --validate` (`src/cli/build.ts:95`), `Revision.validate` (`src/core/db.ts:230-235`), and the `validateProject` export (`src/core/frontend.ts:35`) leave. `bench/m2.ts:46,338` needs a direct import. Tests import the validator directly.
Acceptance: no product path imports `src/core/validate`, and the core boundary test enforces it. Effort S. Needs SRD2 option a or b.

SR11 (incomplete, from AS7). The validator does not bind imports to producer exports.
Astra combined an old consumer IR with a new producer IR in which `Count` changed from `int` to `string`. `validateProject` gave no diagnostic for either module.
Proposal: compare each import payload with the producer export. Compare identities, effects, predicates, execution modes, checked and borrow flags, and service contracts. Exclude spans. Define the rule for host imports and absent producers.
Acceptance: the mixed-revision case is rejected. Effort M. It is independent of SR8.

### Phase 3: prelude removals (SRD1)

SR9 (remove, from FB1, AS2, AS3, AS4, VA4, VA8). Remove prelude concepts that no program uses.
Each group below has no use in the applications, examples, tutorial, or website example files, except where the row says so. Each group is one unit and one commit.

| Group | Names | Count |
| --- | --- | --- |
| G1 Map and Set | `mapOf` `getMap` `putMap` `removeMap` `hasMap` `entriesMap` `setOf` `addSet` `removeSet` `hasSet` `itemsSet` | 11 |
| G2 General Schedule | `scheduleFromStep` `scheduleRecurs` `scheduleExponential` `scheduleCron` `scheduleJittered` `scheduleMap` `scheduleMax` `scheduleMin` `scheduleConcat` `scheduleSpaced` `aggregateWithinStream` | 11 |
| G3 Scope handles | `makeScope` `provideScope` `addScopeFinalizer` `closeScope` | 4 |
| G4 Codec and unused Schema operations | `codec` `decode` `encode` `schemaInvalid` `schemaAt` `schemaBoth` | 6 |
| G5 Fiber handles | `withFiber` `joinFiber` `interruptFiber` | 3 |
| G6 Result collection | `partitionAll` `validateAll` `allResults` | 3 |
| G7 Stream operators | `mapGroups` `scanStream` `mapAccumStream` `foldStream` `foldEffectStream` `collectStream` `headStream` `lastStream` `drainStream` `aggregateStream` `mergeStreams` `zipStreams` `concatStreams` `flatMapStreams` `switchMapStreams` `catchStream` `retryStream` `debounceStream` `throttleStream` `takeStream` `dropStream` `filterEffectStream` `takeWhileEffectStream` `takeUntilEffectStream` `dropWhileEffectStream` | 25 |

Total: 63 names. 54 names remain.

Group rules:

- G2 removes the general `Schedule` type and the `schedule` option of `repeat`. It keeps `RetrySchedule`, `retrySchedule`, and the `schedule` option of `retry` with a `RetrySchedule`, because `service-workflow/workflow.eff:21` and `scheduled-worker/worker.eff:28` use it. The website file `core1.eff:14-15` uses `scheduleSpaced` and `aggregateWithinStream`. Its rewrite is an expected change in the sibling repository.
- G3 removes the `CloseableScope` type. G4 removes the `Codec` type. G5 needs a decision in the unit about the `Fiber` type and the borrow rules.
- Kept with no corpus use: `timeout` `sleep` `race` `uninterruptible` `repeat` `random` `randomInt` `updateRef` `withResource`. They are basic effect vocabulary, and `using` can need `withResource`.
- Kept for the website: the 13 programmable Schema builders, for example `schemaStruct`. SRD1 option b removes them.

Checklist for each group (VA8): types and type walkers, IR kinds, lowering, the three families, diagnostics and their registration, editor data, test generators and their seeded distributions, the surface snapshot, the mutation register anchors, and generated output in fixture directories.
Read each test before deleting a file. Move a test of kept behavior even when the file name names the removed family. The G1 pilot moved a record-presence test this way.

The G1 pilot diff (`2026-11-02-simplification-rebase-evidence/g1-pilot.diff`, against `cb4abd3`) is the starting point of G1. It changed 26 source files and repaired 9 stale mutation anchors.
Acceptance for each group: the applications, examples, tutorial, and website examples compile unchanged, except the named website change. Golden files do not change. SR3 passes. Effort M for each group. After SR3.

This reopens FND1 of the foundation reset (2026-10-31), where the user kept all 117 names. That reset had to preserve all functionality. This request keeps the most important features.

SR17 (missing, from VA10). No rule for the IR version when kinds leave.
G1 removes 11 expression kinds and 2 type kinds, and the version stays 7. The published `typed-ir.ts` still defines them.
Proposal: the first removal unit raises the IR version to 8. Later units of this rebase do not raise it again before the next release. The release publishes the reduced contract through SR6. The validator rejects version 7, as it does for any other version.
Acceptance: the version test and the IR snapshot change in the first unit only. Effort S.

### Phase 4: the validator replacement, measured first (SRD2)

SR8 (replace, from FB2, VF2, VA2, VA3). Prototype a smaller validator before deleting any family.
Step 1, guarantee inventory: list each guarantee that the validator gives today, and the kept oracle for each. Use the oracle map in Section 6.
Step 2, fixture census: map each of the 22 cases in `fixtures/validate/` to a kept oracle. A case with no oracle keeps its check or gets a public test.
Step 3, prototype: build the smallest check that keeps the selected guarantees. The proof check needs semantic context: `validate/refinements.ts:154-302` finds obligations and rebuilds assumptions, and `validate/expr.ts:1633-1704` rebuilds branch facts. Measure the size of that kernel.
Step 4: the user decides SRD4 with the measured numbers.
Acceptance: the inventory, the census, and the measured prototype size. Effort L.

### Phase 5: test and tool cleanup

SR12 (remove, from FB6, VF4, VA9). Tests that read private source text.
`tests/internal_sites_test.ts` has 21 tests. Four of them test public behavior (lines 109-157 and 286-304). Its forged-IR tests call the public `lowerModule` and `emitModule`, and the guard at `src/core/emit/expr.ts:425` is the only oracle for a wrong execution mode.
Proposal: classify each test by behavior. Keep the public regressions and the forged-input tests of entry points. Delete only tests that read source text or anchor to private sites. After each SR9 group, delete the tests that only that group needed.
Acceptance: each reachable diagnostic keeps one public test. Reset a coverage floor only with a written reason. Effort M.

SR10 (replace, from FB5, AS6, VA7). Retire the behavior capture hooks after a replacement exists.
`scripts/behavior_capture.ts` patches five internal entry points and records eight result kinds. The golden files, the surface snapshot, and the runtime tests do not hold all eight.
Proposal: build a small named corpus that records the same observations through public entry points. Retire the hooks only after the corpus compares cleanly. Keep `scripts/lex_snapshot.ts`, which covers 20,000 seeded strings.
Acceptance: the corpus records each kept observation. Effort M to L. Last.

## 6. Decisions for the user

SRD1. Prelude surface (SR9).
(a) Remove the 63 names in groups G1 to G7, with the G2 rules of SR9. Keep the 9 basic effect names and the 13 website Schema builders. Recommended by the orchestrator and both validators.
(b) Option a, plus the 13 programmable Schema builders (AS2). 41 names remain, and website examples change.
(c) Keep all 117 names.

SRD2. The validator (SR7, SR8, SR11).
(a) Remove its product paths now (SR7), add producer binding (SR11), and run the SR8 prototype. Delete families only after a later decision with measured numbers. Recommended.
(b) SR7, then delete the semantic families now. Keep a structural check, SR14, the SR8 fixture census, and the forged-input tests. Accept the losses in the oracle map below.
(c) Keep the validator as a product feature. Add SR11, and replace the 22 expanded fixtures with seeds and mutations (AS5).

Reason for (a). Fable found option b safe with conditions. Astra rejected it: the proof check needs the semantic context that option b deletes, and its size is not measured.
The recommendation follows the rule "measure before scaling up". The prototype gives the number that option b needs.

Oracle map, from Fable's checker fault injections and astra's IR fault injections:

| Defect | Strict target check | Other kept oracle |
| --- | --- | --- |
| A contract narrower than the body (a dropped failure or requirement) | Caught: TS2375 at the source line | - |
| A captured global (SR1) | Caught | - |
| A contract wider than the body | Missed | Golden files, fixtures |
| A false rejection | Missed: the build stops before the check | Fixtures that must compile |
| A non-exhaustive `match` | Missed today. Caught after SR14 | - |
| A wrong execution mode | Missed | The emitter guard at `emit/expr.ts:425` |
| A wrong refinement proof | Missed: the type is `number` | Only the validator |
| An `int` literal `1.5` in IR | Missed | Only the validator |
| An extra failure in an inferred contract | Missed | Only the validator |

SRD3. Tools that Fable proposed to remove: `bench/` (FB4), the logging loop (FB3), the archive (FB7), and the packaging checks (FB12).
(a) Keep all four. Recommended by the orchestrator and both validators. `bench/` is the measurement tool for SR2 and SR13, and the user's rules ask for measurement instead of estimates. The logs hold 9 sessions in 14 days. The user cut v0.12.1 on 2026-11-01, so the release tools have a user.
(b) Remove them as Fable proposes.

SRD4 comes later, after SR8 step 3: delete the validator families, or keep them.

The user accepted SRD1, SRD2, and SRD3 at option a on 2026-11-02 ("as recommended"). The acceptance authorizes Section 7 up to SRD4. It does not authorize a push, a release, or a version change.

The user decided SRD4 and SRD5 at option a on 2026-11-02 ("a"). SRD4 (a) keeps the validator as a test oracle, so SR8 step 3 does not run. SRD5 (a) authorizes Phase 5: SR12, then SR10. The decision does not authorize a push, a release, or a version change.

## 7. Order

1. Phase 1: SR1, SR3, SR4, SR5, SR6, SR14, SR15, SR16, and the SR13 measurement. These units are independent. SR2 follows SR1.
2. Phase 2: SR7 and SR11, if SRD2 is a or b.
3. Phase 3: SR9, one group for each unit. G1 first from the pilot diff, with SR17. Then G2 to G7, each measured.
4. Phase 4: SR8 steps 1 to 3, then SRD4.
5. Phase 5: SR12 after each group and after SR8. SR10 last.
6. The SR13 policy, if the measurement needs one.

Run `deno task coverage` at the end of each phase. Reset a floor only with a written reason.

## 8. Resolution of the validation findings

| Finding | Resolution |
| --- | --- |
| VF1 match guard typed `never` | Accepted as SR14. |
| VF2 census of validator fixtures | Accepted as SR8 step 2. |
| VF3 website examples need emission and the target check | Accepted in SR3. |
| VF4 forged-IR tests are entry-point tests | Accepted in SR12. |
| VF5 unrelated advice in TS2375 | Accepted as SR15. |
| VF6 oracle row in `docs/testing.md` | Accepted as SR16. |
| VF7 the property must defeat the check cache | Accepted in SR2. |
| Fable's acceptance of SRD2 option b | Not adopted. VA3 shows that the proof check, which option b keeps, needs semantic context of unmeasured size. Option b stays available to the user. |
| VA1 `globalThis` capture | Accepted in SR1. |
| VA2 the target check does not replace source semantics | Accepted. It changes the SRD2 recommendation to option a and adds rows to the oracle map. |
| VA3 proof certificates need semantic reconstruction | Accepted as SR8 step 3. |
| VA4 G2 must keep `retry.schedule` | Accepted in the G2 rules. |
| VA5 website manifest and host setup | Accepted in SR3. |
| VA6 standalone IR generation | Accepted in SR6. |
| VA7 capture retirement needs an observation contract | Accepted. SR10 moves last, and the lexer snapshot stays. |
| VA8 checklist for each removal | Accepted in SR9. |
| VA9 SR12 must classify by behavior | Accepted in SR12. |
| VA10 IR version | Accepted as SR17. |
| Astra's docs test failure at `HEAD` | Confirmed in the real repository and repaired as SR0. |

## 9. Corrections to the draft

- The IR has 123 expression kinds, not 122: 122 inline alternatives and `ClosureExpr`.
- The applications have 623 lines of `.eff` in 15 files, not 627.
- The website IR diff is 430 lines. The 784 came from a zsh alias of `diff`.
- SRD1 option b removes 13 more names, not 16, and leaves 41.
- The validator tests total 12,672 lines in 17 files. The 9 files that the draft named total 10,214.
- The method is `Revision.validate`, not `Program.validate`.
- G1 removed 1,089 source lines in 26 files. Its two family files hold only 687 of them.
- The stream and schedule kind counts (35 and 13) are text matches, not disjoint families.
- 15 of 16 website check units pass today, not all.
- The draft said that TypeScript probably checks failures and requirements. The experiment confirms that only for a contract narrower than the body.
- The corpus probes show success for those inputs. SR1 shows that accepted source can still fail the target check.
- The orchestrator measured in the real repository the facts that the snapshots could not hold: 141 of 894 commits touch `src/core/validate`; commits `62d2161`, `d5f61f9`, and `14e027c` repair false rejections by the validator; 24 log files hold 9 sessions from 2026-10-27 to 2026-10-31.

## 10. Considered and rejected

- A rewrite of the pipeline, the parser, or the type table. All four reviewers reject it.
- A universal builtin registry. SBF27 measured structural work at 6% to 21% of builtin lines.
- A merge of the checker and validator logic. Shared mistakes would pass both.
- A split of `check_expr.ts` (3,001 lines). Its largest functions are flat dispatch.
- Removal of refinements or inferred inputs. All four reviewers keep them.
- Removal of `scripts/mutate.ts`, the surface snapshot, or the lexer snapshot.
- Removal of the 9 basic effect names.
- A reduction to the 25 names that the applications resolve. It removes the website vocabulary and the basic effect names.
- Routing every global through `globalThis` instead of reserving names (SR1). It changes all generated text, and source can still bind `globalThis`.

## 11. Execution

### Rules for each unit

Opus orchestrates. A Sonnet executor implements each unit in its own copy of local `main` under `/tmp`, made with `git archive`. A copy of the sibling website `HEAD` is at `/tmp/effektive`, so the copies find it at `../effektive/public/`.
The executor commits each item in its copy, one commit for each item, and runs `deno task mutate --only` on the changed logic sites there.
The executor does not edit `CHANGELOG.md`. The orchestrator adds the "Unreleased" entries.
The orchestrator reviews each commit line by line. It applies the commit to local `main`, runs `deno task check`, and commits. Website changes become separate commits in the sibling repository.
A bug fix starts with a test that fails for the reason of the bug.

### Phase 1 units

| Unit | Items | Model | Main files | Acceptance | Turn budget |
| --- | --- | --- | --- | --- | --- |
| U1 | SR1, SR14, SR15 | Sonnet | `src/core/resolve.ts`, `src/core/emit/decls.ts`, `src/core/emit/tsc.ts`, error fixtures, emitter tests, golden files, D20 row | The SR1 and SR14 acceptance checks; the relayed TS2375 text ends after its first sentence | 80 tool calls |
| U2 | SR4 | Sonnet | `src/core/parse.ts`, error fixtures, the diagnostic table of `docs/language-rules.md` | One diagnostic for a record body; no change for programs that compile today | 50 tool calls |
| U3 | SR3, SR6 | Sonnet | a new slow test and manifest, a new generator script, `tests/ir_site_slow_test.ts`, the website `typed-ir.ts` and `effektive-examples/` | Both tests pass against the updated website copy; the generated IR checks alone | 80 tool calls |
| U4 | SR5, SR16 | Sonnet | `docs/language-rules.md`, `docs/api.md`, `docs/development.md`, `docs/testing.md` | Both contradictions are gone; the oracle map is in `docs/testing.md`; the docs test passes | 50 tool calls |
| U5 | SR2 | Sonnet | `tests/acceptance_property_slow_test.ts` or a new slow test | Fails without SR1 and passes with it; nonzero accepted target cases | 60 tool calls |
| U6 | SR13 measurement | Opus | `docs/measurements.md` | One M4 result on a quiet machine | - |

U1 to U4 run at the same time. U5 starts after U1 lands. U6 runs when no executor runs.

### Progress ledger

| Item | Commit | Result |
| --- | --- | --- |
| SR0 | `5bb3f71` | The gate passes at `HEAD`. |
| SR5 | `448de13` | The `--tsc` row matches the code. Three duplicates in `docs/api.md` link to `docs/development.md`. The Schedule rows wait for G2. |
| SR3 | `51be1df`, sibling `304df02` | A slow test compiles 16 website units from `fixtures/website-examples.json` and runs `build --tsc` on each. `main.eff` gained its host files on the website. |
| SR6 | `7c3d400`, sibling `b6f036f` | `deno task site:ir` generates the website `typed-ir.ts`. Each change of `ir.ts` now needs a sibling commit. |
| SR1 | `cc531c0` | `Math`, `Error`, `String`, and `globalThis` give `declaration/002`. |
| SR14 | `6a7a1b8` | `$unmatched` takes `never`. A forged IR without one arm gives TS2345. |
| SR15 | `6628cf8` | The relay removes only the advice to add `undefined`. The executor's first-sentence cut also dropped useful second sentences. |
| SR16 | `e0d9852` | `docs/testing.md` holds the oracle map. |
| SR4 | `827d513` | A record literal body gives one `syntax/016`. |
| SR13 | `2886e4b` | 424 bytes for each new type shape at 50,000 edits. No lifecycle policy now. See `docs/measurements.md`. |
| SR2 | `ebeaf76`, `8aae21a`, this commit | A census places 102 names in 8 templates and type-checks 2,184 accepted programs in one `deno check` (about 4 s). It found two more captures: `TypeError` (the match fallback) and `BigInt` (refinement checks). Both are reserved. |
| Phase 1 coverage | - | Lines 97.51%, branches 95.36%, functions 99.31%. The floors are 97, 95, and 99. |
| SR7 | `500d15d` | No product path loads the validator. A slow test reads the module graph of the CLI, the LSP, and the playground. The playground bundle is 148 KB (13.8%) smaller. |
| SR11 | `566fb5a` | `validation/009` reports an import payload that differs from its producer export. 18 tests; no mutation fixture, because a fixture holds one module. |
| Phase 2 coverage | - | Lines 97.51%, branches 95.38%, functions 99.31%. |
| SR17 | `9a097a0`, sibling `84e8a3b` | The IR wire version is 8. Later groups keep 8. |
| G1 | `5c72430`, sibling `478ee45` | 117 to 106 prelude names, 123 to 112 expression kinds. Net lines: src -1,089, tests -2,023. Website draft 0.71 records the removal; later groups extend that note. |
| G2 | `92ec013`, sibling `62d13cd`, `24f0b39` | 106 to 95 prelude names, 112 to 101 expression kinds, 19 to 18 type kinds. Net lines: src -1,542, tests -2,012. Correction: the plan said that only `core1.eff` used G2 names. The spec example `spec-control-time` also used `scheduleMax`, `scheduleExponential`, and `scheduleSpaced`. It now uses `retry` with `times` and `while`. |
| Mutate `--only` | `d20bde1` | A second `--only` replaced the first, so executor runs with several sites tested only the last one. The fix keeps every site. Rerun results: see the next row. |
| Mutation rerun | - | SR4 `parse.ts` 1503 to 1524: 9 mutants, 8 killed, 1 timeout (an endless newline loop), 0 survivors. SR15 `tsc.ts:63`: the tool makes no mutant at this line. SR11 `validate_project.ts`, whole module: 44 mutants, 44 killed. G2 ran one site per command, so its runs were complete. |
| G3 | `fc02f2f`, sibling `dcc13a7` | 95 to 91 prelude names, 101 to 97 expression kinds, 18 to 17 type kinds. Net lines: src -306, tests -600. The executor deleted tests that used a scope handle as a probe of a kept rule. A mutation run of `check_binary.ts` (152 mutants, 150 killed, 2 registered equivalents) shows no gap in the `===` rule. |
| G6 | `85fd121`, sibling `3ccf437` | 91 to 88 prelude names, 97 to 94 expression kinds. Net lines: src -504, tests -530. |
| SR8 steps 1 and 2 | this commit | [sr8-inventory.md](2026-11-02-simplification-rebase-evidence/sr8-inventory.md). 55 guarantees: 10 covered by another oracle, 27 partly covered, 18 validator only. Of 22 forged fixtures, 6 fail the strict target check, 4 stop at an emitter guard, and 12 are validator only. The validator has 9,448 code lines; Phase 3 removes 1,032 more. The three validator-only defects of the oracle map need the expression walk, which is 6,325 of the 8,416 code lines left after Phase 3. So a prototype (step 3) is needed only for SRD4 option B, which also needs an obligation finder of unmeasured size. Correction: the plan range `validate/expr.ts:1633-1704` was shifted; it starts inside `ifExpr`. |
| G4 | `daadd62`, sibling `dc924f8` | 88 to 82 prelude names, 94 to 91 expression kinds, 17 to 16 type kinds. Net lines: src -628, tests -706. The first executor stopped at its budget; a second executor finished the unit. Two tested behaviors went with the issue constructors: a source factory that adds a parent path with `schemaAt`, and authored issue trees. `portable-publisher` output is byte-identical. |
| G5 | `c9e358a`, sibling `cd005c5` | 82 to 79 prelude names, 91 to 88 expression kinds, 16 to 15 type kinds. Net lines: src -499, tests -528. The rule that a `forkScoped` child outlives its spawning fiber kept its test: the spawner is now a member of a concurrent `all` record, and the test fails with a fiber-bound child. The orchestrator ran `check` and `build --tsc` on all seven corpus projects: 0 diagnostics. |
| G7 | `2b28b7d`, sibling `8bc51fa` | 79 to 54 prelude names, 88 to 59 expression kinds, type kinds stay 15. Net lines: src -2349, tests -5829, fixtures -224, docs -126. The four pure predicate kinds `filter-stream`, `take-while-stream`, `take-until-stream`, and `drop-while-stream` went with their `...EffectStream` names. No other kind, fact kind, or `ConcurrencyOperation` entry became unreachable. The runtime test of `bufferStream` was rebuilt from the deleted `mergeStreams` test, and a new test pins every invalid `bufferStream` capacity. One equivalent mutant in `streamBufferCapacity` is registered. The first executor stopped at its budget; a second executor finished the compiler part, and a third did the website prose. The orchestrator fixed a stale "Codecs" mention from G4 in `docs/language-rules.md` and two "merged streams" status sentences on the website. |
| Phase 3 coverage | - | Lines 97.27%, branches 95.04%, functions 99.19%. The floors are 97, 95, and 99. All three totals fell, because the removed code was well tested. The branch margin is 0.04 points. |
| SRD4 and SRD5 | - | The user chose option a for both. The validator stays at 8,293 code lines (measured after Phase 3; the SR8 projection was 8,416, because G4 and G5 also removed the codec and fiber type cases). SR8 step 3 does not run. Phase 5 starts. |
| SR12 | this commit | The orchestrator classified the nine FB6 files by behavior. No test file is deleted. `internal_sites_test.ts` keeps its 21 tests: four public regressions (VA9), 13 forged-input tests of the internal sites through the public `lowerModule` and `emitModule` (VF4), and four tests of other entry-point results. The four validator test files stay, because SRD4 keeps the validator and its walk must stay exhaustive. `builtin_report_sites_test.ts` and `builtin_arity_test.ts` call the public `checkProject` with exact messages. `core_boundary_test.ts` and `emit_families_test.ts` enforce the layering rules. The groups G1 to G7 already deleted the tests that only they needed. One private-site anchor kind remained: five line references in comments of `type_laws_property_test.ts`, four of them stale after the removals. They now name functions. |
| SR10 | `39b5ea2`, `b79ac72` | `deno task behavior:compare` runs one named corpus through the public entry points of two revisions: 122 fixture projects, 22 forged IR files, and four edit sequences. It gives 454 records of all eight kinds, and a full comparison took 0.78 s. Against the plan commit it compares cleanly. Against `cb4abd3` (v0.12.1) it finds 181 changed and 2 missing records, and each one comes from an "Unreleased" entry: the IR version 8, `syntax/016`, and the `$unmatched` signature. Mutation of the compare logic: 48 sites, 40 killed by fast tests, 8 registered as `slow-only`; the orchestrator confirmed two of them by hand. The orchestrator made the `missing-host-module` sequence import from the host, so it records `module/002`. The second commit retires the capture script, its tests, its task, and the hook filter of the core boundary test. The corpus sees only fixture inputs. |
| Phase 5 coverage | - | Lines 97.27%, branches 95.06%, functions 99.19%. Coverage counts only `src/` and `playground/src/`, so the scripts of SR10 do not change it. |
