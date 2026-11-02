# Effektive compiler: independent simplification analysis

## 1. Keep set

The largest useful reduction requires language decisions. Another rearrangement of the compiler will not remove the semantic cost of its builtin families.

Each item below is a **recommended user decision**. The evidence establishes current behavior and purpose, not the user's future priorities.

| Recommended keep item                                                                                                           | Evidence and reason                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closed exported contracts, local inference, and separate pure and effectful execution                                           | language-rules.md (`docs/language-rules.md`):48-62 defines these boundaries. They let source omit local detail while exports retain explicit obligations.                                                                        |
| Named and sealed types, tagged records, optional fields, and checked input boundaries                                           | language-rules.md (`docs/language-rules.md`):25-56 defines the distinctions. The order-lifecycle witness exercises identities across modules. These distinctions carry domain intent.                                            |
| Services, providers, typed host interfaces, and application orchestration in `.eff`                                             | status.md (`docs/status.md`):11-46 records the three application gates and two additional witnesses. Host code should provide platform operations and protocol conversion.                                                       |
| Structured resource ownership, cancellation, finalization, and bounded concurrency                                              | check_builtins/scope.ts (`src/core/check_builtins/scope.ts`):192-271 checks resource use and release. These guarantees support the application gates. Explicit transferable scope handles are a separate decision under AS4.      |
| The stream and sink operations required by the application gates, plus concrete retry and repetition policies                   | status.md (`docs/status.md`):39-46,87 distinguishes application needs from general API coverage. The fresh census confirms those needs use only part of the available surface.                                                   |
| The existing compiler pipeline, typed intermediate representation, canonical serialization, and independent validator           | architecture.md (`docs/architecture.md`):18-29,85-106 defines the boundaries. Independent checking can detect mistakes that a shared implementation would repeat.                                                                |
| Bounded refinement proofs and inferred input contracts                                                                          | architecture.md (`docs/architecture.md`):22-26 and inferred-input-contracts.md (`docs/inferred-input-contracts.md`):1 describe separate responsibilities. These features infer obligations from intent already present in source. |
| Incremental revisions, lazy TypeScript output, source maps, editor queries, the language server, VS Code client, and playground | api.md (`docs/api.md`):538-594 describes revisions and isolation. These tools make the language usable. Their manual acceptance remains a separate user task.                                                                    |

The application gates are service-workflow, scheduled-worker, and stream-processor. Order-lifecycle and portable-publisher are additional witnesses, not extra gates.

The census checked all five witnesses, examples, and tutorial sources. All seven project roots produced zero checker diagnostics across 22 `.eff` entries.

Only 25 of 117 prelude names resolved as builtin calls or values in that corpus. The other 92 names are candidates for review, not proven dead code.
Syntax can use a builtin operation without naming it. For example, `using` can require resource machinery despite no resolved `withResource` call.
The census excludes dedicated feature fixtures and tests. It therefore measures application use, not total repository use.

The census script is `scratch/features.ts`. Its complete name lists and per-project results are in `scratch/features.json`.
The command was `deno run --allow-read --allow-write=scratch scratch/features.ts`.

### Scope and evidence limits

The dispatch identifies the source revision as `cb4abd3`. This copied repository has a local snapshot commit named `7c9035c12cadcf4774ff6231884eddbcba57518f`.
I analyzed this snapshot with Deno 2.9.8. I did not inspect the real compiler checkout or change the sibling website.

The measured core matches the brief: 121 files and 51,073 lines, including blanks and comments.
The validator occupies 24 files and 11,086 lines. The emitter occupies 28 files and 8,840 lines.
The measurements are in `scratch/census.json` and `scratch/feature-costs.json`.
Counts that include JSON or other assets differ from the brief's TypeScript-only counts for some directories.

| Area examined                                                              | Result of the analysis                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Lexer, parser, resolution, checking, lowering, serialization, and emission | Keep the pipeline. AS1 identifies a reproduced emission defect. AS2-AS4 reduce semantic surface.                             |
| Validator, type identities, refinements, and input inference               | Keep independent semantics and proof checks. AS7 completes a project boundary. Recent inference separation already exists. |
| Revision storage, editor queries, language server, and VS Code client      | Keep frontend isolation and separate disk and overlay state. AS8 adds a lifecycle policy.                                  |
| Playground, CLI, host adapters, output writes, logging, and replay         | Keep the shared compiler and host boundaries. Existing manual acceptance and replay limits remain explicit.               |
| Benchmarks, scripts, tests, and fixtures                                   | Keep benchmark correctness checks and focused runtime tests. AS5, AS6, and AS9 improve representation and evidence.          |
| Active docs, reset archives, and sibling website specification             | AS10 removes conflicting ownership of live rules. Feature removals need later website updates. Archives remain evidence.   |

The following targeted tests passed: `inferred_inputs_test.ts` had 36 passes; `type_laws_property_test.ts` had 26; `revision_isolation_test.ts` had 12.
Each command used `deno test --allow-all tests/<file>`. Their logs remain under `scratch/`.
No full check, test suite, coverage run, mutation run, browser flow, or installed-editor test ran during this analysis.
Historical application runtime results come from repository evidence. The fresh application census checked source only.

## 2. Thesis

The proposed rebase keeps the compiler pipeline and removes selected language concepts across all stages.
The best candidates are programmable Schema and Codec construction, general Schedules, and transferable scope handles.
Together, these proposals remove 34 prelude names while preserving the observed application vocabulary.
Their gross source footprint is 5,171 lines across 14 files; retained functionality still needs parts of those files.
The first phase fixes target-name hygiene, strengthens project validation, and establishes a lifecycle for long-running compiler sessions.
The next phase reduces fixture duplication and replaces capture instrumentation that binds preservation evidence to internal function names.

## 3. Findings

Effort uses three labels: S means a localized change; M means several coordinated modules; L means a language change across compiler stages.
Confidence distinguishes confidence in the evidence from confidence in the proposed product decision.

### AS1 - incorrect - Legal source bindings capture generated JavaScript globals

**Evidence.** The resolver reserves some target names, but omits `Math`, `Error`, and `String`.
See resolve.ts (`src/core/resolve.ts`):214-233.
Duration division emits bare `Math.trunc` at emit/expr.ts (`src/core/emit/expr.ts`):1091-1095.
Defect messages emit bare `Error` and `String` at emit/outcome.ts (`src/core/emit/outcome.ts`):6-8.
A source binding with the same name changes the meaning of those generated references.

The minimal project has `scratch/shadow/effektive.json` containing `{}` and this `scratch/shadow/main.eff`:

```eff
type Int = int
export const divide = (Math: Int): Duration => 5s / Math
```

Commands, run from `/tmp/eff-astra`:

```sh
TMPDIR=/tmp/eff-astra/scratch/tmp deno task effektive check scratch/shadow --no-log
TMPDIR=/tmp/eff-astra/scratch/tmp deno task effektive build scratch/shadow --validate --tsc --no-log
```

The check exited 0 and printed `1 module, 0 diagnostics`.
The build exited 1 and printed:

```text
main.eff:2:48: error TS2339: Property 'trunc' does not exist on type 'number'.
1 module, 1 diagnostic
```

The expected build result is exit 0 with zero diagnostics. The parameter should not replace the emitter's reference to the global object.
The run proves a target typing failure. It does not claim a measured runtime result.

A second project, `scratch/error`, has the same configuration and this source:

```eff
type Int = int
type Text = string
export const message = (Error: Int): Text => try { "ok" } catch { Defect(problem) => problem.message }
```

The command `TMPDIR=/tmp/eff-astra/scratch/tmp deno task effektive build scratch/error --validate --tsc --no-log` exited 1.
It reported TS18046 and TS2359 at `main.eff:3:46`. The full output is in `scratch/error-build.log`.
The emitter used the number parameter as the right operand of `instanceof`. The expected result is another successful target check.

**Proposal.** The maintainer should route emitted global references through a binding mechanism that cannot collide with source bindings.
The maintainer should allocate or rename bindings consistently across declarations, references, and source maps.
Merely changing `Math` to `globalThis.Math` leaves the same problem when source binds `globalThis`.

**Effect.** Fixes two reproduced failures in accepted source. Exact changed files and lines need measurement during implementation.

**Preserves and risks.** The change must preserve legal names and runtime meaning. The main risks are inconsistent renaming, changed output snapshots, and displaced source mappings.
The maintainer should add strict target tests for both examples and mapped diagnostics. Update output goldens only for explained differences.
No source-language restriction is required if generated bindings remain isolated.

**Effort:** M. **Confidence:** high. **Dependencies:** none; AS9 prevents similar omissions.

### AS2 - remove - Keep derived schemas and remove programmable Schema and Codec builders

**Evidence.** check_builtins/schema.ts (`src/core/check_builtins/schema.ts`):1386-1415 registers 19 Schema operations.
The application census uses only `schema`, `schemaDecode`, and `schemaEncode`.
It uses none of `codec`, `decode`, and `encode` from check_builtins/codec.ts (`src/core/check_builtins/codec.ts`):1-28.

The checker, validator, and emitter Schema families total 2,871 lines across three files.
The three Codec families add 341 lines. Files with `schema` in their test filename total 5,515 lines across 26 files.
Those test files also cover retained behavior, so 5,515 lines is a review surface, not a deletion claim.
Schema constructor presence and defaults also extend the type model at types.ts (`src/core/types.ts`):200-209.

**Proposal.** The proposal retains automatic schema derivation, `schema`, `schemaDecode`, `schemaEncode`, and checked boundary validation.
The proposal removes the other 16 Schema operations and all three Codec operations from source.
The proposal removes the `Codec` type and its IR cases after auditing their complete dependency set.
The proposal keeps existing Schema signatures initially; simplify their metadata only when no retained operation needs it.

The maintainer should use ordinary typed source functions for simple domain conversions. Use a typed host adapter for complex external wire formats.
Application sequencing, failure policy, and domain decisions remain in `.eff`.

**Effect.** Removes 19 prelude names and the three Codec family files, totaling 341 lines.
It also removes portions of the 2,871-line Schema implementation and dependent metadata. Net savings need measurement.

**Preserves and risks.** The change must preserve identity-aware decoding, recursive derived schemas, optional-field presence, refinements, and current application boundaries.
Custom defaults, bidirectional transformations, and programmable recursive schemas cease to be source features.
This is deliberate feature loss. Host migration can reduce portability and move errors outside compiler visibility.
The maintainer should update dedicated Schema and Codec tests, IR cases, docs, website examples, and migration notes.

This reopens the earlier keep-all decision in foundation-reset.md (`docs/archive/plans/2026-10-31-foundation-reset.md`):258,289-291.
That reset required preservation. This brief permits removal, and the new census uses resolved names instead of word matches.

**Effort:** L. **Confidence:** high for footprint and corpus use; medium for removal value. **Dependencies:** a user decision and the preservation baseline in AS6.

### AS3 - remove - Remove general Schedules while preserving concrete worker policies

**Evidence.** The ten `schedule*` constructors and combinators have no resolved use in the application census.
Neither does `aggregateWithinStream`. The scheduled-worker witness uses `retrySchedule` instead.
status.md (`docs/status.md`):87 explicitly states that concrete repetition and RetrySchedule meet the worker gate.

The three Schedule family files total 856 lines. cron.ts (`src/core/cron.ts`):1-113 adds 113 lines.
Only the checker and validator Schedule families import the cron helpers from production source.
types.ts (`src/core/types.ts`):228-234 adds a separate type with output, input, failures, and requirements.
check_builtins/effect.ts (`src/core/check_builtins/effect.ts`):297-345 carries both general Schedule and RetrySchedule paths.

**Proposal.** The proposal removes general `Schedule`, `ScheduleInput`, `ScheduleMetadata`, `ScheduleDecision`, their ten constructors, and `aggregateWithinStream`.
The proposal retains `RetrySchedule`, `retrySchedule`, retry limits and callbacks, repetition limits and callbacks, and source-defined worker policy.
The proposal removes general Schedule branches from retry and repeat checking, validation, lowering, and emission.

**Effect.** Removes 11 prelude names and four dedicated source files totaling 969 lines.
Additional branches, fixtures, and docs can shrink. Their net reduction needs measurement.

**Preserves and risks.** The change must preserve the existing worker gate and ordinary stream processing.
This loses reusable general policies, cron syntax, comparable-input composition, and timed aggregation.
A future cron application would require an explicit capability or a new product decision.
The maintainer should update Schedule, aggregation, retry, and repeat tests, type walkers, serialized IR, language rules, and website panels.

This reopens the same preservation-only decision as AS2. No claim says these features are broken or unused outside the measured corpus.

**Effort:** L. **Confidence:** high for evidence; medium for removal value. **Dependencies:** a user decision and AS6's baseline.

### AS4 - remove - Remove transferable scope handles and keep structured lifetimes

**Evidence.** The census uses none of `makeScope`, `provideScope`, `addScopeFinalizer`, or `closeScope`.
Their registrations are at check_builtins/scope.ts (`src/core/check_builtins/scope.ts`):408-422.
They require a distinct `closeable-scope` type at types.ts (`src/core/types.ts`):193.
emit/explicit_scope.ts (`src/core/emit/explicit_scope.ts`):13-47 emits a shared scope, completion cell, and close coordination.

The three scope family files and the explicit runtime emitter total 990 lines across four files.
Most of that surface also supports resource behavior that must remain.
The dedicated explicit runtime emitter contains 51 lines.

**Proposal.** The proposal removes the four names and `CloseableScope` from source.
The proposal retains `scoped`, `forkScoped`, supervised fibers, `withResource`, `using`, and `finally`.
The proposal removes only the type cases and runtime coordination specific to transferable handles.

**Effect.** Removes four prelude names and the 51-line dedicated runtime emitter.
The remaining reduction within the mixed scope families needs measurement.

**Preserves and risks.** The change must preserve acquisition, release, borrowed-handle restrictions, cancellation, and finalizer ordering for structured scopes.
Resources with ownership transferred across independent roots lose an explicit source representation.
Structured scopes cannot replace every such program. This is a product restriction, not a behavior-preserving refactor.
The maintainer should update explicit-scope fixtures, closure and cancellation tests, IR types, docs, and website examples.

This also reopens the earlier keep-all decision. The new basis is the permitted reduction in language scope and the resolved-use census.

**Effort:** L. **Confidence:** high for evidence; medium for removal value. **Dependencies:** a user decision and AS6's baseline.

### AS5 - simplify - Store validator cases as shared frozen seeds and explicit mutations

**Evidence.** The 22 expanded invalid-IR JSON files contain 12,649 lines and 318,792 bytes.
Their manifest adds another file; the full directory totals 12,876 lines.
validate_fixtures.ts (`scripts/validate_fixtures.ts`):539-574 already describes each case as a base module and one mutation.
The same script lowers current source to obtain each base.
validate_test.ts (`tests/validate_test.ts`):2209-2247 loads the expanded copies, then checks that regeneration reproduces them.

**Proposal.** The proposal keeps small, frozen valid IR seeds and explicit case mutations with literal diagnostic expectations.
Construct invalid cases in memory. Store expanded failing artifacts only when a test fails.
The proposal keeps a separate canonical serialization test and independent hand-forged cases.
The maintainer should not replace independent invalid-IR evidence with only fresh lowering output.

**Effect.** Replaces 22 expanded copies with shared seeds and case descriptions.
The 12,649 lines are the gross replaceable representation. The seed and case size, and net reduction, need measurement.
The 591-line generator can lose disk expansion and synchronization work, while useful mutations remain.

**Preserves and risks.** The change must preserve every expected rejection code, diagnostic path, malformed shape, and source mapping.
Incorrect seed reuse could couple unrelated tests. Mutable shared objects could contaminate later cases.
The maintainer should clone each seed and compare all existing case outcomes before removing expanded files.
The maintainer should update `validate:update`, fixture documentation, and the validator tests. Preserve wire-format coverage in `ir_snapshot_test.ts`.

**Effort:** M. **Confidence:** high. **Dependencies:** none; coordinate with AS6 before changing capture inputs.

### AS6 - replace - Replace internal capture hooks with a fixed named comparison corpus

**Evidence.** behavior_capture.ts (`scripts/behavior_capture.ts`):65-155 rewrites five internal entry points through source-text anchors.
Its 387 lines also patch subprocess permissions and run revision-specific tests at lines 265-316.
Records contain hashes and lengths, but no case name or result text, at lines 41-57.

The repository documents repeated comparison ambiguity when tests move or APIs change.
See behavior-capture-hold-tests-constant.md (`docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`):30-38,77-95.
Holding tests constant is a valid workaround. It does not make the capture independent of internal APIs or test organization.

**Proposal.** Build a named corpus of source projects, edit sequences, malformed IR, and adapter traces.
The maintainer should run the same corpus against both revisions through small version adapters.
The maintainer should compare diagnostics, interfaces, serialized IR, output, maps, editor results, and selected runtime observations under explicit case names.
The proposal retains full mismatching artifacts. Keep ordinary unit tests separate from this comparison contract.

The maintainer should start with a small corpus that completes in under one minute. Increase only the corpus size after the comparison works.
During migration, the maintainer should keep existing capture and compare coverage before removing any hook.
The maintainer should record intentional language changes by case and expected difference. Do not accept unexplained missing records.

**Effect.** Replaces the capture script's five source anchors and test-layout dependency.
This primarily reduces maintenance coupling. Net file count, line count, and runtime changes need measurement.

**Preserves and risks.** The change must preserve behavior comparison and independent oracles. A small corpus could silently lose coverage from inline tests and subprocesses.
The maintainer should inventory current capture inputs before retirement. Keep target runtime tests and process-level CLI and language-server tests.
The maintainer should update capture tests, `docs/testing.md`, and the existing comparison guidance.

Earlier resets retained the fresh project driver because tests and capture still used it.
This proposal does not delete that driver first. It replaces a dependency that obstructs later API simplification.

**Effort:** L. **Confidence:** high for coupling; medium for replacement cost. **Dependencies:** none; AS1 and AS9 supply initial named cases.

### AS7 - incomplete - Project validation does not bind imports to producer contracts

**Evidence.** validate_project.ts (`src/core/validate_project.ts`):32-54 validates modules independently and checks their map keys.
validate/world.ts (`src/core/validate/world.ts`):1348-1384 checks import payloads against themselves.
It does not compare them with the corresponding producer module.
language-rules.md (`docs/language-rules.md`):50 explicitly records this limit.

The executed probe compiled two valid versions of `lib.eff`:

```eff
export type Count = int
export const answer = (): Count => 1
```

```eff
export type Count = string
export const answer = (): Count => "x"
```

Both versions used this `main.eff`:

```eff
import { Count, answer } from "./lib.eff"
export const result = (): Count => answer()
```

The script combined the old consumer IR with the new producer IR, then called `validateProject`.
Command: `deno run --allow-write=scratch scratch/imports.ts`.
Both `lib` and `main` returned empty diagnostic lists. Both modules also emitted successfully.
The mixed payloads are in `scratch/imports-result.json`.

This confirms a validation boundary, not an observed incremental-cache defect. The current compiler need not produce this mixture during normal compilation.

**Proposal.** The maintainer should add independent project-level checks between import payloads and producer exports.
The maintainer should compare the complete reachable contract, including identities, sealed flags, effects, services, and refinement metadata.
The maintainer should exclude spans from semantic equality. Define explicit rules for host declarations and prelude imports that have no producer IR.
The maintainer should not call the checker's interface comparison as the independent oracle.

**Effect.** Rejects mismatched producer and consumer contracts that currently pass validation.
Added files and lines need measurement. This does not authenticate arbitrary external IR or prove every checker rule independently.

**Preserves and risks.** The change must preserve independent module validation for partial results.
Project validation needs an explicit completeness policy before rejecting an absent producer.
The maintainer should add stale-import, forged-export, transitive-contract, and host-import cases. Update the documented validation limit.

This revisits a documented limitation with a newly executed mixed-revision witness. No earlier completion claim is contradicted.

**Effort:** M. **Confidence:** high. **Dependencies:** none; coordinate new cases with AS5.

### AS8 - missing - Long-running sessions have no retirement policy for interned types and inactive roots

**Evidence.** types.ts (`src/core/types.ts`):489-500 shares intern storage between definition-map forks.
Lines 614-620 append new structural types without reclaiming them.
projects.ts (`src/lsp/projects.ts`):377-393 removes an open document but retains its project.
Lines 540-548 add discovered roots to the project map. The map has no corresponding project-removal path.

The probe repeatedly changed one exported record field name, then removed the module.
Command: `deno run scratch/growth.ts 10`.
It measured 11 initial interned types and 23 final types, with no modules remaining.
The same script with scale parameter `1000` measured 11 initial types and 1,013 final types.
Every edit passed checking. These are type-node counts, not measured heap bytes or latency.

The existing memory benchmark already supports distinct edits, concurrent documents, and save rounds.
See `bench/m4.ts`:17-30. Adding those capabilities again would repeat completed work.

**Proposal.** The maintainer should define when an inactive project can be discarded and when an active program should start a fresh intern store.
The maintainer should measure root churn and sustained unique-type edits before selecting a threshold.
The maintainer should rebuild a replacement program from current files at a safe session boundary.
Retained revisions must own their original tables. Do not compact shared storage in place or reuse live type references.

**Effect.** Adds a lifecycle mechanism for growth that currently lasts until server shutdown.
Peak memory, latency cost, and an appropriate threshold need measurement.

**Preserves and risks.** The change must preserve retained-revision queries, lazy output, diagnostic versions, generated-document subscriptions, and separate disk and overlay states.
Premature disposal could drop pending saves or subscriptions. Rebuilding could cause a noticeable pause.
Extend the existing memory benchmark and revision-isolation tests with close/reopen and replacement-program cases.
The maintainer should update session ownership documentation in `docs/api.md`.

This does not reverse the completed revision-isolation fix. Its append-only storage remains valid within a program lifetime.

**Effort:** M. **Confidence:** high for growth; medium for the best retirement mechanism. **Dependencies:** none.

### AS9 - missing - Generated acceptance properties stop before strict target checking

**Evidence.** acceptance_property_slow_test.ts (`tests/acceptance_property_slow_test.ts`):113-159 checks accepted source through lowering, validation, and emission.
It does not type-check or run the emitted TypeScript.
Its edits reuse tokens from the original source at lines 98-110, so they cannot introduce absent collision names such as `Math`.
AS1 supplies two valid programs that reach emission but fail the strict target check.

Existing target and runtime tests remain valuable. This finding concerns the generated acceptance property, not an absence of target testing throughout the repository.

**Proposal.** The maintainer should add a focused generated property for legal binding renames across parameters, locals, imports, and module declarations.
Check representative generated targets in batches under the production strict configuration.
The maintainer should compare runtime results for a small subset with explicit expected values.
The maintainer should include global-helper names and nested scopes. Preserve minimal failing `.eff` cases with their seed and command.

**Effect.** Extends the 230-line acceptance property's evidence boundary beyond emitter success.
The additional source size and execution cost need measurement. Start with AS1's cases before increasing generated coverage.

**Preserves and risks.** The proposal keeps fast compiler properties and existing target goldens.
Subprocess expansion can make the slow suite expensive. Batch targets and measure before choosing the generation count.
The maintainer should update `docs/testing.md` to state the exact property and its limits.

**Effort:** M. **Confidence:** high. **Dependencies:** AS1 supplies confirmed regression cases; AS6 can reuse the resulting corpus.

### AS10 - simplify - Give live semantics and tooling contracts separate document owners

**Evidence.** language-rules.md (`docs/language-rules.md`):517 says general Schedules cannot drive `Effect.repeat`.
The same document permits them at line 293. check_builtins/effect.ts (`src/core/check_builtins/effect.ts`):328-369 implements that permission.

language-rules.md (`docs/language-rules.md`):932 says target checking uses `--no-lock`.
api.md (`docs/api.md`):658-666 describes a pinned temporary lockfile.
deno_io.ts (`src/host/deno_io.ts`):129-135 writes that lockfile and passes `--lock=`.
These are concrete disagreements in active documentation, not evidence of broken target checking.

**Proposal.** The proposal keeps source semantics in `language-rules.md`, API and adapter behavior in `api.md`, and commands in `development.md`.
Replace duplicated live rules with links to their owner.
The proposal keeps historical decisions in archives and current dispositions in `status.md`.
The maintainer should use small executable assertions for command flags where a test already exposes them.

**Effect.** Removes duplicated contract text from active documents.
Exact line savings need measurement after the ownership map. No runtime files need change for the two observed disagreements.

**Preserves and risks.** The change must preserve conditions, exceptions, and historical reasons. Consolidation must not silently change a language rule.
The maintainer should run documentation link checks and review each moved rule against code and tests.
If AS3 removes general Schedules, delete the obsolete rule instead of repairing it first.

**Effort:** S. **Confidence:** high. **Dependencies:** incorporate accepted outcomes from AS2-AS4.

## 4. Order of work

| Phase                                    | Work and owner                                                                                        | Acceptance before continuing                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Correctness baseline                  | The compiler maintainer fixes AS1 and adds the focused cases from AS9.                                  | Both reproduced projects pass validation and strict target checking. Renamed variants preserve runtime results and source mappings.                            |
| 2. Foundation boundaries                 | The compiler maintainer addresses AS7 and measures AS8. These are separate units.                       | Mixed contracts fail project validation. Retained revisions survive program replacement. Session measurements show the disposal policy's cost.                 |
| 3. Comparison and fixture representation | The maintainer pilots AS6, then migrates AS5.                                                           | The fixed corpus explains each compared result. Every existing mutation case retains its expected code and path.                                               |
| 4. Language decisions                    | The user selects AS2, AS3, and AS4 independently against the keep set.                                   | Each accepted removal has an explicit migration and loss statement. No language removal follows from census results alone.                                     |
| 5. Independent removal units             | The maintainer removes AS3, AS4, and AS2 in separate units, subject to the user's choices.               | Each unit preserves application checking, independent validation, target checking, runtime cancellation, and cleanup. Intentional changes have named evidence. |
| 6. Documentation and product acceptance  | The maintainer completes AS10 and updates the website separately. The user performs manual acceptance. | Spec examples compile. Website TypeScript panels pass strict checks. VS Code and playground acceptance remains distinct from scripted checks.                  |

The maintainer should measure each removal's actual diff before starting the next one.
The fixed comparison baseline must precede removals. Complete retirement of the old capture hooks need not block them.
The three proposed language removals affect 34 names: 19 under AS2, 11 under AS3, and four under AS4.
Eight dedicated source files total 1,361 lines across those proposals. Remaining family reductions are partial and still need measurement.
The 5,171-line gross footprint must not be reported as an achieved reduction.

Implementation work should run the repository's full required gates in its own authorized session.
This analysis did not run those gates and does not authorize implementation or commits.

## 5. Considered and rejected

| Candidate                                                        | Reason for rejection                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace the compiler pipeline or rewrite it in another language  | The measured problems concern semantic surface and boundary checks. No current measurement justifies the migration cost.                                                                                                               |
| Merge the checker and validator type logic                       | Shared mistakes would pass both stages. The validator's size reflects deliberate independent checking.                                                                                                                                 |
| Generate all builtin behavior from one universal registry        | The previous reset measured structural work at 12% to 21% of new builtin core lines. Semantic obligations dominate. See foundation-reset.md (`docs/archive/plans/2026-10-31-foundation-reset.md`):233-242.                              |
| Delete all 92 names absent from the application census           | Syntax can invoke hidden operations. Tests and specified use cases remain valid evidence. The census cannot prove that every absent name lacks value.                                                                                  |
| Delete refinements or input inference because they are expensive | Their five refinement modules contain 2,912 lines, and two inference modules contain 1,020. They infer source obligations rather than expose target API detail. The keep-set decision should precede any removal.                      |
| Repeat the inference split or revision-isolation reset           | Both changes already exist. The three targeted suites passed in this snapshot. AS8 concerns lifetime policy, not isolation semantics.                                                                                                   |
| Merge the two source predicate normalizers                       | Prior differential work found equal meanings with different output structures. The result concerns `predicate_source.ts` and `check_refinements.ts`. See foundation-reset.md (`docs/archive/plans/2026-10-31-foundation-reset.md`):854. |
| Replace the formatter to save the printer's code                 | The existing formatter records source spans during layout and satisfies an accepted formatting contract. Replacement needs its own measured design and mapping proof.                                                                  |
| Remove the fresh project driver before replacing its consumers   | Benchmarks, tests, and capture still use it. AS6 addresses one dependency first.                                                                                                                                                        |
| Treat long arithmetic expressions as a confirmed parser crash    | A 100-term probe passed. A 1,000-term probe returned bounded syntax diagnostics instead of crashing. The script is `scratch/stress.ts`.                                                                             |
| Collapse disk and overlay programs in the language server        | Unsaved editor text and saved build output have different owners. Combining them risks writing output from unsaved source.                                                                                                             |
| Remove the CLI, language server, playground, logs, or benchmarks | These tools test or deliver distinct user boundaries. No measured maintenance benefit outweighs that role. Existing replay exclusions remain documented.                                                                               |
| Declare editor and browser release acceptance complete           | Current status still assigns manual acceptance to the user. Historical automated reviews cannot supply that decision.                                                                                                                  |
| Delete archives or broad groups of tests                         | Archives explain accepted exceptions. Tests contain distinct target, cancellation, and ownership evidence. AS5 removes repeated representation without discarding cases.                                                                |

## 6. Open questions for the user

**Decision 1: language keep set.** Option A keeps the proposed contracts, identities, inference, refinements, typed host boundaries, and application scope. **Recommended.**
Option B changes that product target before any removal plan. Acceptance of this report alone does not authorize edits.

**Decision 2: Schema and Codec surface.** Option A adopts AS2 and keeps only derived schemas with decode and encode operations. **Recommended.**
Option B retains programmable schemas and codecs, with their current compiler and test cost.

**Decision 3: general Schedules.** Option A adopts AS3 and keeps concrete retry and repetition policies. **Recommended.**
Option B retains general policies, cron, and timed aggregation as required product capabilities.

**Decision 4: scope ownership.** Option A adopts AS4 and limits source resource ownership to structured lifetimes. **Recommended.**
Option B retains transferable scope handles because independent-root ownership is a required source capability.

The next action belongs to the user: select the product boundaries before the maintainer writes an implementation plan.
Which options do you select for decisions 1, 2, 3, and 4?
