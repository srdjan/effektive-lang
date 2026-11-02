# Validation of the simplification proposal

The proposal needs revision. The G1 pilot removes 3,164 net lines and preserves the checked application corpus.
The proposed replacement of semantic validation does not yet preserve the stated guarantees.

The baseline is snapshot commit `7c9035c12cadcf4774ff6231884eddbcba57518f`, copied from `cb4abd3`.
All source citations refer to that baseline unless marked “pilot”. The immutable source copy is under `scratch/validation/base/src/`.
Deno is version 2.9.8. The website was read only. The real compiler checkout was neither read nor written.
No full gate, full test suite, coverage task, mutation task, or commit ran.
The working diff remains in place and in `scratch/g1-pilot.diff`.

## 1. Verdict table

There are 5 accept verdicts, 10 modify verdicts, and 1 reject verdict.
Acceptance means acceptance of the proposal item. It does not mean approval to edit the production checkout.

| Item or decision | Verdict | Reason and required change | Evidence |
| --- | --- | --- | --- |
| SR1: generated global names | Modify | Add `globalThis` to the reproduced defect set. Preserve TypeScript type-name restrictions. Make the census aware of lexical scopes and namespaces. | Both original reproducers fail target checking. The new `globalThis` reproducer gives eight target diagnostics. `resolve.ts:214-233`; `emit/fields.ts:184-227`; VA1. |
| SR2: generated target property | Modify | Test accepted renames and intentional source rejections separately. Assert nonzero accepted target cases, so reserving every candidate cannot make the property vacuous. | `tests/acceptance_property_slow_test.ts:98-159` stops at emission. The reproduced collisions pass source checking and validation. |
| SR3: website example guard | Modify | Add an explicit example manifest and host setup. Require this guard before removals when the website exists. Report a skipped checkout explicitly. | There are 21 source files and five project configurations. Of 16 check units, 15 pass; `main.eff` reports two diagnostics. VA5. |
| SR4: record arrow diagnostic | Accept | The ambiguity and both misleading diagnostics reproduce. The proposed recovery can preserve valid programs. | `scratch/validation/record-check.log`; `parse.ts` dispatches a brace body to block parsing. |
| SR5: document ownership | Accept | Both contradictions remain. Consolidating the rules is appropriate. The existing version mismatch prevents an unconditional claim that the complete docs test passes today. | `language-rules.md:293,517,932`; `host/deno_io.ts:129-135`; `scratch/validation/pilot-extra.log`. |
| SR6: generated website IR | Modify | Generate a standalone contract with its predicate dependencies. A header plus a direct copy does not compile. | `ir.ts:1`; website `typed-ir.ts:1-42`; copied file fails TS2307. VA6. |
| SR7: validator as test oracle | Modify | Remove the product surface only after defining the test adapter and benchmark exception. The method is `Revision.validate`. | `db.ts:135,230-235,280`; `frontend.ts:35`; `bench/m2.ts:46,338`; 53 test files mention project or revision validation. |
| SR8: structural replacement | Reject as written | Proof checking requires semantic reconstruction. Target checking also misses integer validity and exact inferred failures. Preserve an independent semantic kernel before reconsidering deletion. | VA2 and VA3; `scratch/validation/semantic-oracle/results.json`; `validate/refinements.ts:154-302`. |
| SR9: prelude removals | Modify | The pilot supports staged removals. Retain `retry.schedule` for `RetrySchedule`. Name intentional website changes and include all integration checks. | G1 removes 1,089 source lines. Two applications use `retry.schedule`. Website `core1.eff:14-15` uses two proposed removals. VA4 and VA8. |
| SR10: capture retirement | Modify | Define the replacement observations first. Preserve the fixed lexer corpus or approve its loss separately. Existing artifacts do not replace every capture record. | Five hooks produce eight record kinds. The lexer snapshot covers 20,000 seeded strings. VA7. |
| SR11: producer binding | Accept | The mixed-revision witness reproduces. Add this independently of SR8, with explicit partial-project and host rules. | Both mixed modules return empty diagnostic lists. `validate_project.ts:32-54`; `validate/world.ts:1348-1384`; `scratch/validation/mixed-import.log`. |
| SR12: private-site tests | Modify | Classify individual tests by behavior. Preserve public regressions and retained semantic mutation cases. Moving public tests into fixtures does not itself simplify them. | `internal_sites_test.ts` has 21 tests, including four public regressions. The arity and report suites already call `checkProject`. VA9. |
| SR13: session lifecycle | Accept | Measure memory and latency before choosing a policy. Preserve retained revisions, pending saves, output subscriptions, and disk/overlay separation. | The growth probe again gives 11 to 1,013 nodes after 1,000 edits. `bench/m4.ts:17-30` already supports distinct edits and saves. |
| SRD1: prelude decision | Modify | Recommend option (a), with corrected G2 boundaries and explicit website migration. Option (b) removes 13 additional names, leaving 41. | The resolved census uses 25 of 117 names. Option (a) removes 63 and leaves 54. G1 pilot and VA4 support phased execution. |
| SRD2: validator decision | Modify | Recommend option (a), retaining independent semantics as a test oracle. Reconsider option (b) after a measured prototype preserves the approved guarantees. | The target check accepts two semantic corruptions that the validator rejects. Proof obligations depend on semantic analysis. VA2 and VA3. |
| SRD3: tools decision | Accept | Recommend option (a): keep measurements, logs, archives, and packaging checks. Snapshot omissions do not establish that these tools have no user. | `bench/m4.ts` serves SR13. Installation and release tasks remain configured. The snapshot cannot verify the real checkout's log or history counts. |

## 2. Experiment

### G1 scope and measurement

G1 removes `mapOf`, `getMap`, `putMap`, `removeMap`, `hasMap`, `entriesMap`, `setOf`, `addSet`, `removeSet`, `hasSet`, and `itemsSet`.
The pilot also removes the source types `Map` and `Set`, their IR kinds, and their type-system cases.
JavaScript `Map` and `Set` remain in the compiler implementation. The array `map` builtin remains.

The pilot removes two dedicated family files. Map and Set emission lives in shared emitter files, rather than a dedicated family file.
The removal also reaches deferred key checks, schema derivation, field adapters, recursion checks, signatures, diagnostic registration, and test generators.
Four dedicated test files and one error fixture leave the tree.
A record-presence test moves from a deleted file into `tests/sensitive_fields_slow_test.ts`.
The separate rejection of record equality remains covered by `tests/check_body_test.ts:2885-2909`.

The final command is `git diff --shortstat`:

```text
45 files changed, 82 insertions(+), 3246 deletions(-)
```

The net removal is **3,164 lines**. These counts exclude untracked reports and scratch evidence.
Per-directory totals include every tracked text file, including comments and blank lines.

| Directory | Changed files | Lines before | Lines after | Added | Deleted | Net removed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `src/` | 26 | 56,194 | 55,105 | 2 | 1,091 | 1,089 |
| `tests/` | 12 | 79,040 | 77,017 | 66 | 2,089 | 2,023 |
| `fixtures/` | 3 | 36,104 | 36,067 | 8 | 45 | 37 |
| `docs/` | 4 | 31,454 | 31,439 | 6 | 21 | 15 |
| Total | 45 | 202,792 | 199,628 | 82 | 3,246 | 3,164 |

The prelude changes from 117 names to 106. The expression union changes from 123 kinds to 112.
The 687 lines in the dedicated families are a subtotal. The complete source reduction is 1,089 lines across 26 files.

The measured wall time is **1,342.116 seconds**, or 22 minutes and 22.116 seconds.
The interval runs from 12:45:33.425216 UTC to 13:07:55.540921 UTC on 2026-11-02.
It includes concurrent proposal validation, delegation, review, and repairs. It is not exclusive editing time or a forecast for another group.
Timing (`scratch/validation/timing.json`), directory measurements (`scratch/g1-measurements.json`), and per-file counts (`scratch/g1-numstat.txt`) retain the measurements.

### Commands and observed results

The worker first ran `deno test --allow-all tests/map_set_types_test.ts` before deletion.
That small run passed 29 tests in 2.40 seconds and established the working test pipeline.
The main validator reviewed the diff and independently repeated the retained checks.

| Check | Observed result |
| --- | --- |
| `deno check 'src/**/*.ts' 'tests/**/*.ts'` | Exit 0; 0.758 seconds in the independent run. |
| `deno lint` | Final exit 0; 646 files checked. |
| Targeted retained tests | 647 plus 260 passes; zero failures. Independent command times total 3.859 seconds. |
| `deno test --allow-all tests/sensitive_fields_slow_test.ts` | Eight passes; zero failures; 6.351 seconds. This includes the preserved record test. |
| Extra editor, IR, and documentation checks | 60 passes and one pre-existing failure; 0.462 seconds. |
| Seven source checks and seven strict builds | All 14 commands exit 0. Independent warm-cache command times total 0.972 seconds. |
| Surface check after generated-file cleanup | 91 passes; zero failures. The CLI snapshot has 89 records; the LSP snapshot has 28 messages. |
| Formatting of changed TypeScript and JSON files | Exit 0. |
| `git diff --check` | Exit 0. |
| Static mutation-register audit | Nine stale anchors before repair; zero afterward. No mutant ran. |

The only extra-test failure is `tests/docs_test.ts:135`.
The baseline changelog starts at `0.12.0`, while the baseline manifest says `0.12.1`.
The pilot does not change either file. This is not a green full repository gate.

The retained test batches cover the changed surviving tests and their resolver, lowering, emitter, validator, schema, error, and surface dependencies.
The full commands and log paths are in pilot-verification.json (`scratch/validation/pilot-verification.json`).
The reproducible runner is verify-pilot.py (`scratch/validation/verify-pilot.py`).
The worker's earlier runs remain in g1-results.jsonl (`scratch/g1-results.jsonl`).

Each corpus root ran these commands:

```sh
TMPDIR=/tmp/eff-astra/scratch/tmp deno task effektive check <root> --no-log
TMPDIR=/tmp/eff-astra/scratch/tmp deno task effektive build <root> --tsc --no-log
```

The seven roots are `fixtures/applications/order-lifecycle`, `portable-publisher`, `scheduled-worker`, `service-workflow`, and `stream-processor`, plus `fixtures/examples` and `fixtures/tutorial`.
Each application name after the first shares the `fixtures/applications/` prefix.
Their source files remain unchanged. Golden files also remain unchanged, and the retained emitter tests compare their bytes.
The build times include target-cache reuse. They establish command success, not a performance improvement.

The CLI writes generated files beside source files and has no `--out` option.
These files changed surface-test write events when left in fixture directories.
The runners archived only newly generated files, then removed those generated copies before repeating the surface check.
The main run's generated outputs remain in pilot-generated.tar.gz (`scratch/validation/pilot-generated.tar.gz`).

### What was hard and what the pilot proves

The first source pass produced 54 type errors. These exposed shared type walkers, schema paths, and property generators.
Grouped switch labels required care because retained kinds still used the shared bodies.
Changing the random type vocabulary changed measured distributions throughout the seeded property tests.
The review also found nine stale mutation-register anchors: one deleted Map site and eight shifted offsets.
The repaired register preserves the original reasons for the eight retained sites.

The pilot proves that G1 can leave this compiler with a measured reduction and passing selected checks.
It does not prove runtime improvement, full-suite coverage, mutation strength, or compatibility for removed source programs.
It does not establish the safety of SR8. The semantic validator remains in use during the pilot tests.
The website was not synchronized. The published IR still includes the removed kinds, and the wire-version decision remains open.

The G1 result cannot be multiplied by the number of names in other groups.
G2, general Schedules, shares retry options and affects a website example.
G3, scope handles, shares files with retained resource ownership and scoped children.
G4, Codec and Schema removals, shares Schema metadata and error types with retained operations.
G5, fiber handles, needs an explicit decision about the `Fiber` type and borrow machinery.
G6, result collection, must preserve outcome handling used by retained recovery and finalization.
G7, stream operators, leaves stream operations used by applications and by shared `map` and `filter` dispatch.
The net reduction and work duration for G2 through G7 **need measurement**.

### Other reproduced evidence

The baseline reproducer runner is run_probes.py (`scratch/validation/run_probes.py`).
It uses the immutable baseline source while the worker edits the pilot.

| Probe | Observed result |
| --- | --- |
| SR1 `Math` binding | Source check exits 0. Build with `--validate --tsc` exits 1 with TS2339. |
| SR1 `Error` binding | Source check exits 0. Build with `--validate --tsc` exits 1 with TS18046 and TS2359. |
| SR4 record arrow body | Check exits 1 with `unknown-name/001` and `syntax/008`. |
| SR11 mixed imports | Both producer and consumer receive empty validation diagnostics. Both emit successfully. |
| SR13 ten edits | Interned types change from 11 to 23; no modules remain after removal. |
| SR13 1,000 edits | Interned types change from 11 to 1,013; no modules remain after removal. |
| Resolved application census | Seven roots and 22 `.eff` entries check cleanly. They use 25 of 117 prelude names. |
| Website census | Five projects and 11 individual entries produce 16 check units. Fifteen pass; one has two diagnostics. |
| Website census after G1 | Results equal the baseline results, including the pre-existing host failure. |

The growth run first used scale 10, then changed only the scale parameter to 1,000.
Heap use, latency growth, root-retirement cost, and a safe replacement threshold still need measurement.

The semantic experiment changes lowered IR, then uses the production strict target configuration and pinned lock.
It does not patch checker code. The proposal's exact checker-fault injection therefore remains a separate acceptance check.

| Controlled IR change | Independent validator | Strict target check |
| --- | --- | --- |
| Change an integer literal from `1` to `1.5`, retaining its `int` annotation | Two `validation/002` diagnostics | Exit 0 |
| Remove `Bad` from a function's written failure contract, retaining the failing body | `validation/003` | Exit 1, TS2375 |
| Add unused `Extra` to an inferred failure contract | `validation/003` | Exit 0 |

semantic-oracle.ts (`scratch/validation/semantic-oracle.ts`) retains the complete experiment.
Its results (`scratch/validation/semantic-oracle/results.json`) include diagnostics and target exits.
The generated file with unused declarations is saved as `main.ts.txt`, so intentional probe output does not pollute repository lint.
Running the script recreates its target files.

The main validator also repeated 15 proof-related tests and 318 public-regression and validator tests. Both commands passed.
Logs are proof-checks.log (`scratch/validation/proof-checks.log`) and public-regressions.log (`scratch/validation/public-regressions.log`).
These checks establish current behavior. They do not validate an unwritten structural replacement.

## 3. Corrections

| Proposal claim | Measured correction or evidence limit |
| --- | --- |
| The IR has 122 expression kinds. | It has 123: 122 inline alternatives plus `ClosureExpr`. The existing walker test also asserts 123. G1 leaves 112. |
| The application sources have 627 lines. | The 15 tracked `.eff` files have 623 lines. Both newline counts and logical-line counts give 623. |
| The website IR diff prints 784 lines. | A fresh normal `diff` against the immutable baseline prints 430 lines. This is output length, not a semantic difference count. |
| SRD1(b) removes 16 more names than option (a). | It removes 13 more. G4 already removes `schemaInvalid`, `schemaAt`, and `schemaBoth`, plus Codec operations. Option (b) leaves 41 names. |
| The validator-only tests total 10,214 lines. | The listed nine files total 10,214. Sixteen `validate_*_test.ts` files total 12,266. Adding `schema_validator_forged_test.ts` gives 12,672 across 17 files. |
| The method is `Program.validate`. | The method is `Revision.validate`. `Program` begins later in `db.ts`. |
| Map and Set family files give a 687-line bound. | The two dedicated files total 687 lines. G1 removes 1,089 source lines across 26 files, including shared emission and type code. |
| SR3 passes on all website examples today. | Under explicit empty configuration for individual entries, `main.eff` reports `module/002` and `requirement-contract/001`. The downloadable root lacks its provider registration. |
| A header plus an IR copy gives a usable standalone website file. | The copied file imports absent `./predicates.ts` and fails TS2307. The existing website file passes a standalone check. |
| G2 removes the `schedule` option from `retry` while preserving applications. | Both service-workflow and scheduled-worker use that option with retained `RetrySchedule` values. Only the general Schedule branch can leave. |
| All website examples compile unchanged after SR9. | `core1.eff` calls `aggregateWithinStream` and `scheduleSpaced`. G2 deliberately removes both. Its migration must be an explicit expected change. |
| Deleting `internal_sites_test.ts` removes only unreachable private tests. | The file has 21 tests. At least four exercise reachable public behavior. Its 13-site header does not describe the whole file. |
| Successful corpus probes show that the pipeline is sound. | They show success for those inputs. The reproduced target failures disprove an unrestricted soundness claim. The pipeline shape can still remain. |

The original validator source count is correct: 24 files and 11,086 lines.
The 23 validator fixture files contain 12,876 lines. The 22 expanded cases contain 12,649 lines and 318,792 bytes.
The two validator-related scripts total 744 lines. The stream, Schedule, scope, and Codec subtotals also reproduce.
The proposed 63-name removal and 54-name remainder are correct for option SRD1(a).
Five golden files contain `Effect.Effect<` annotations. That fact does not establish all semantic guarantees.

The 35 stream rows and 13 schedule rows are textual classifications, not disjoint semantic families.
For example, `aggregate-within-stream` contributes to the schedule text count.
The complete census is measurements.json (`scratch/validation/measurements.json`).

The current website IR SHA-256 is `387e05bef40213686bb58f8b819d4b27fecd0771da82c17d964207398617fcec`.
The snapshot has one commit, so it cannot verify the claimed 141 of 894 commits or the three historical fixes.
The real checkout's 24 logs, nine sessions, latency statistics, and transient syntax codes were not independently verified.
The supplied orchestrator report remains the source for those claims. Snapshot absence supplies no contrary evidence.

## 4. Additional findings

Effort labels describe scope: S means small, M means medium, and L means large. They are not time estimates.

### VA1: Incorrect - SR1 omits an existing globalThis collision

Evidence: `resolve.ts:220-233` does not reserve `globalThis`. `emit/fields.ts:184-227` emits bare references to it.
This accepted source triggers the optional-field helper:

```eff
type Int = int
type Row = { toString?: Int }
export const globalThis: Int = 0
export const read = (row: Row): Option<Int> => row.toString
```

The source check exits 0. `build --validate --tsc` exits 1 with eight diagnostics, including TS2448, TS2454, TS2339, and TS18046.
The commands use the baseline CLI and `scratch/validation/global-shadow`; the build log (`scratch/validation/global-shadow.log`) retains the complete output.
The expected target result for accepted source is zero diagnostics.

Proposal: include `globalThis` in SR1 and test helper-producing programs under binding renames.
Retain restrictions on `any`, `bigint`, `object`, and `symbol` if generated declarations retain source names.
A free-identifier census alone cannot detect every capture, because a captured reference is bound in the generated program.
Effect: closes another reproduced accepted-source failure. Risk: reservation changes the accepted identifier set; renaming changes output and source maps.
Effort: M.

### VA2: Incorrect - the target oracle does not replace source semantics

Evidence: the integer and inferred-failure corruptions pass strict target checking and fail independent validation.
`emit/types.ts:169-174` prints `int` as `number`. `validate/expr.ts:543-587` checks equality for inferred effects.
The emitted integer witness contains `export const count: Int = 1.5;`.
A written failure bound and an exact inferred failure set are different guarantees.

Proposal: list every retained guarantee and its independent oracle before removing semantic validation.
Preserve adversarial witnesses for integers, exact effects, identity authority, borrowing, and proof obligations.
A checker-to-IR equality test cannot catch a wrong checker fact copied consistently into IR.
Effect: prevents an unacknowledged loss of validation. Risk: a smaller oracle may intentionally support fewer guarantees, which requires an explicit decision.
Effort: M for the guarantee inventory; replacement size needs measurement.

### VA3: Missing - proof certificates require semantic reconstruction

Evidence: `ir.ts:115-118` stores a proof target and certificate, not independently trusted assumptions and goals.
`validate/predicates.ts:41-68` checks the certificate against caller-supplied assumptions and predicates.
`validate/refinements.ts:154-302` discovers obligations, reconstructs assumptions, and rejects absent, duplicate, or unused proofs.
`validate/expr.ts:1633-1637,1674-1704` invalidates facts after effects and reconstructs branch facts.
The refinement module and certificate verifier alone contain 917 and 328 lines, before their typing and world dependencies.

Proposal: prototype a retained semantic kernel before deleting the families that supply its context.
The kernel must independently bind each proof to its expression, type, scope, authority, and control-flow assumptions.
Effect: preserves proof meaning. Net savings need measurement.
Risk: a valid certificate over forged assumptions can validate the wrong expression. Effort: L.

### VA4: Incorrect - G2 removes a required retry option

Evidence: `fixtures/applications/service-workflow/workflow.eff:21` passes `storageRetry` through `schedule`.
`fixtures/applications/scheduled-worker/worker.eff:28` passes `retryPolicy(policy)` through the same option.
`check_builtins/effect.ts:297-345` separates `RetrySchedule` from general Schedule handling.

Proposal: remove general Schedule support while retaining `retry.schedule: RetrySchedule<E>`.
Remove `repeat.schedule` if general Schedules leave. Preserve the ordinary retry and repetition limits and callbacks.
Effect: keeps both application witnesses unchanged. Risk: deleting the shared option parser would break the keep set. Effort: S for the plan correction.

### VA5: Incomplete - website examples need a complete build manifest

Evidence: website `effektive-examples/main.eff:2` imports `host:providers`.
The downloaded root has no `effektive.json` or provider interface for that import.
The baseline census produces `module/002` and a downstream `requirement-contract/001` for this entry.
The five configured projects and ten other individual entries check cleanly.
G1 preserves all 16 results exactly.

Proposal: describe each example's entries, configuration, host interfaces, dependencies, and expected result in one manifest.
Provide the missing host material or identify the file as an explicitly incomplete snippet.
Require a present website checkout during the removal work; a local optional guard may still skip an absent sibling.
Effect: makes the guard reproducible and exposes stale website contracts. Risk: broad skips could hide exactly the drift SR3 should detect.
Effort: M.

### VA6: Incomplete - IR generation must include its dependency closure

Evidence: the first line of `ir.ts` imports `Predicate` and `ProofCertificate` from `predicates.ts`.
The current website file inlines those declarations in lines 1-42.
A direct baseline copy fails standalone checking with TS2307. The current published file passes the same standalone check.
Commands and exits are in boundary-checks.json (`scratch/validation/boundary-checks.json`).

Proposal: generate a standalone contract, including the required predicate and proof declarations, with a deterministic header.
Check the generated bytes and compile the artifact independently.
Keep the website update in its separate repository, as required by the project rules.
Effect: removes hand-copy drift without introducing an unresolved import. Risk: copying solver implementation would enlarge the published contract unnecessarily.
Effort: M.

### VA7: Incomplete - capture retirement lacks an observation contract

Evidence: `scripts/behavior_capture.ts:4-11,112-163` records eight result kinds through five hooks.
These include serialized IR, update errors, lowering errors, emission errors, and validator diagnostics.
`tests/lex_snapshot_test.ts:1-4,25-45` compares tokens, offsets, trivia, and diagnostics for 20,000 seeded strings.
The proposed golden, surface, runtime, and website artifacts do not contain all these observations.

Proposal: establish a small named comparison corpus before retiring the hooks.
Record the retained observations, expected intentional changes, and full mismatch artifacts.
Preserve the lexer corpus or explicitly accept its removal as a separate reduction in evidence.
Effect: reduces dependence on private anchors while preserving a stated comparison boundary.
Risk: deleting the old tool first can hide missing observations. Effort: M or L; net reduction needs measurement.

### VA8: Missing - removal units need integration and cleanup checks

Evidence: G1 changes 26 source files and invalidates nine mutation-register anchors.
It also changes a diagnostic fixture, a surface row, walker counts, and seeded distributions.
The review preserved a record test from a nominally Map/Set-only file.
Generated output in fixture directories changed surface-test write events.

Proposal: give each removal an explicit checklist for types, IR, diagnostics, editor data, test generators, snapshots, mutation anchors, and generated outputs.
Inspect individual tests before deleting family files. Preserve retained behavior even when a test filename names the removed family.
Use isolated output copies or exact generated-file cleanup when a command writes beside source.
Effect: prevents residual coupling from appearing only in a later full gate.
Risk: broad cleanup could delete authored files; this pilot archived and removed only newly generated files.
Effort: M per removal; each group's duration needs measurement.

### VA9: Incorrect - SR12 treats test names as evidence of private behavior

Evidence: `internal_sites_test.ts:109-157` contains three reachable source-diagnostic regressions.
Lines 286-304 contain successful emission of an effect-mode branch returning a pure function.
`builtin_report_sites_test.ts:690-703` and `builtin_arity_test.ts:225-249` call the public checker.
The main validator repeated these suites successfully with the retained proof tests.

Proposal: retain the four public regressions before pruning internal-only cases.
Preserve valid-source pairs, exact messages, and the builtin census when moving cases into fixtures.
Keep exhaustive walker tests if the structural validator still promises an exhaustive walk.
Effect: removes obsolete tests without silently deleting public contracts. Risk: coverage percentages cannot identify the lost behavior.
Effort: M.

### VA10: Missing - the rebase needs an explicit IR compatibility decision

Evidence: the pilot removes eleven expression kinds and two type kinds while `ModuleIR.version` remains 7.
The published standalone IR still defines those kinds. `docs/architecture.md:97-106` treats typed IR as an authored and published contract.
The snapshot has no outside package consumer, but stored fixtures and the website still consume that contract.

Proposal: define the version transition and the treatment of old serialized IR before production removals.
Publish the reduced contract with the compiler change, and explicitly reject or migrate old payloads as selected.
Keep the experiment's unchanged version as a stated limit, rather than a release-ready compatibility claim.
Effect: prevents two different closed contracts from sharing an unexplained version.
Risk: a version change requires deliberate fixture and website updates. Effort: M.

## 5. Order and risk

First, define the retained guarantees, corpus observations, and intentional language losses.
Correct SRD1's count and G2's retry boundary before seeking a product decision.
Select SRD2(a) while the semantic replacement remains unproven.

Next, complete SR1 and SR2 together, including the `globalThis` witness and non-vacuous target cases.
Make SR3 reproducible by supplying its host setup. Replace SR6's direct copy with standalone generation.
SR4 and the two concrete SR5 corrections can proceed independently.

Then establish the small comparison corpus and add SR11 producer binding with the existing validator available.
Producer binding must compare reachable interfaces, including identities, effects, predicates, execution, checked flags, borrow flags, and service contracts.
It must exclude spans and define behavior for host imports and missing producers.
Fixture compression can proceed without waiting for semantic-validator deletion.

After those guards exist, apply approved SR9 groups separately and measure each diff.
Use the G1 integration checklist, preserve `RetrySchedule`, and record the intentional G2 website change.
Coordinate the IR version and published contract before treating a group as complete for release.

SR7 can move validation into test infrastructure after its test and benchmark adapters exist.
SR8 needs a separate prototype and guarantee review; the current deletion step should not proceed.
SR10 should retire hooks only after the replacement observations pass comparison.
SR12 should remove individual obsolete tests after each feature removal, while retaining public regressions.

Start SR13 measurement early, before large removals confound its baseline.
Choose a lifecycle policy only after memory, latency, and retained-revision measurements justify it.
The pilot's targeted results do not replace the production full gate, coverage review, or permitted mutation checks.
Those checks remain work for the later authorized implementation session.

## 6. Total judgment

The proposal identifies real simplification opportunities, and G1 removes 3,164 net lines while preserving the selected corpus.
Its 1,089-line core reduction is 2.13% of the 51,073-line baseline core, so G1 alone is not a dramatic compiler reduction.
The total reduction from G2 through G7 needs measurement, because the groups share retained infrastructure.
SR8 cannot currently deliver its stated proof guarantees through a structural check and strict target typing.
A solid foundation requires complete name handling, producer binding, explicit oracle coverage, and synchronized source and IR contracts.
I recommend corrected SRD1(a), SRD2(a), and SRD3(a), with a separate measured decision on further Schema removal.
The pilot diff remains available for review and is not a production release or full-gate result.
The orchestrator owns the next action: revise the proposal with these corrections before requesting the user's implementation decision.
