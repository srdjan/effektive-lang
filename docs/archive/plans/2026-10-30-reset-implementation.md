# Reset implementation plan

Not selected. On 2026-10-30 the user selected the [stable base reset plan](2026-10-30-stable-base-reset.md) as the reset authority.

Date: 2026-10-30. Planned revision: `45218f36931f02999251c127614e9c48c821e122` (`v0.10.4`).
Plan status: complete and independently validated; ready for user review.
Implementation has not started.

## Authority and boundary

This document is the sole authority for this reset's findings, design, phases, acceptance checks, and execution evidence.
`docs/status.md` remains the authority for project status and the application stopping rule.
`docs/architecture.md` remains the reference for the current architecture until implementation changes it.
Archived plans remain historical evidence. They do not add reset tasks.

The reset will give future work clear ownership boundaries and reliable checks for behavior preservation.
It will preserve current functionality, public package contracts, generated output, and supported workflows.
The reset will retain the current architecture and make two bounded ownership changes within it.
A prerequisite repair will first restore compatible target resolution in the failing verification gate.
A replacement compiler, new language features, and a new framework do not support this goal.

The current request authorizes this document only.
The plan registry, source files, tests, configuration, website, and other documents remain unchanged during planning.
The planning restriction postpones registration of this document until implementation starts.
The plan's completion does not authorize implementation.

`RST` identifies reset phases. `RSTF` identifies review findings. `RSTD` identifies design decisions.
These prefixes were absent from `docs/plans/README.md` at the planned revision.
The implementation coordinator will register these prefixes in RST0, the baseline phase.

## Planning worklog and review method

The main agent reviewed the compiler pipeline, public entry points, host output path, language server, playground, test infrastructure, and current documentation.
The review used source reads, caller searches, existing tests, repository guidance, archived decisions, and the measurement script.
The main agent ran the fast suite and recorded its result below.
The main agent also ran the full gate and the documentation tests during plan validation.
The full gate failed in one FileSystem adapter test; the result appears below.
The review did not run browser acceptance or a full behavior capture.
Reading an existing test does not establish its current result.

| Planning unit | Owner and model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| Review and draft | Main agent, configured model and effort | Read repository files; write this document only | Every accepted finding has current evidence, bounded work, and an observable result | One planning turn |
| Independent validation | Codex Astra, `gpt-6-astra`, `xhigh` | Read this document and cited files; write nothing | Challenge preservation, scope, dependencies, commands, and completion criteria | One review turn, at most 18 tool calls |
| Reconcile validation | Main agent, configured model and effort | This document only | Resolve every material validation finding in this document | One reconciliation turn |

The user's explicit Astra instruction governs the validation model.
The validator returned findings and evidence limits without changing files or starting implementation.
Section "Independent validation" records the review and its disposition.
The final scope check found only this plan document changed.

## Baseline and evidence limits

The workspace was clean on local `main` before planning.
The local runtime reported Deno 2.9.8, V8 15.0.245.2-rusty, and TypeScript 6.0.3.
The package version is 0.10.4. The generated target uses Effect 4.0.5.
The `typescript@5.9.3` import supports measurement tools; it does not select the compiler behind `deno check`.

| Check or measurement | Observed result | Exact command |
| --- | --- | --- |
| Fast suite | 2,676 passed; zero failed; 3.350 seconds of measured wall time | `deno task test` |
| Physical lines | `check_expr.ts`: 3,279; `lower.ts`: 2,073; `lsp/projects.ts`: 631 | `wc -l src/core/check_expr.ts src/core/lower.ts src/lsp/projects.ts` |
| Static measurement | `check_expr.ts`: 3,107 code lines, 831 branch nodes; `lsp/projects.ts`: 562 code lines, 124 branch nodes | `deno task measure src/core/check_expr.ts src/lsp/projects.ts scripts/logs_replay.ts scripts/behavior_capture.ts` |
| Documentation checks | Two passed; zero failed | `deno test --allow-read tests/docs_test.ts` |
| Full gate | Failed after 73.825 seconds; 277 slow tests passed and one failed | `deno task check` |
| IR publication | Bidirectional `ModuleIR` assignment passed; file bytes differ intentionally | IR publication check in the shared gate below |
| Cross-revision capture | Not run during planning | `deno task behavior:capture 45218f3 HEAD` |
| Runtime and installation | Included in the attempted full gate; its failed result does not establish complete acceptance | Existing slow tests |

The measurement script counts syntax branches. These numbers do not establish runtime cost or defects.
Its function summary excludes class methods, so its maximum complexity number does not characterize `BodyChecker`.
No reset task has a predicted speed, memory, or line reduction target.
Any performance claim needs a measurement with the existing harness and its noise floor.

The isolated reproduction command was:

```sh
deno task test:slow --filter 'a typed FileSystem host adapter builds and maps package failures'
```

The failed test was `a typed FileSystem host adapter builds and maps package failures` in `tests/cli_slow_test.ts:402`.
Its runtime subprocess returned exit code 1 where line 436 requires exit code 0.
An isolated fresh-cache rerun also failed: zero passed, one failed, and 277 filtered out.
The package graph selected `@effect/platform-node-shared@4.1.0` beside the pinned `effect@4.0.5`.
The shared package requires `effect@^4.1.0` and imports an unavailable `effect/4.0.5/dist/process/CommandLine.js`.
The runtime reported `ERR_MODULE_NOT_FOUND` for that import.
This establishes an incompatible resolved graph, rather than a failure caused by the planned refactors.
No source file changed before or during this gate attempt.

## First-principles design

A compiler needs one owner for each source decision and an explicit contract between stages.
Effektive already has this structure: source checking, typed intermediate representation, independent validation, and TypeScript emission.
Typed intermediate representation, abbreviated IR, is the serialized contract between checking and later stages.
The reset will preserve that structure.

Rule duplication between the checker and independent validator is deliberate.
Sharing those rules would remove the independent check that detects disagreements.
Duplication within one checker family has a different purpose and can use one owner.
The Map and Set constructors therefore belong with their existing checker family.

One disk session needs one state owner.
The language server must still keep its disk program separate from its program for unsaved documents.
One optional disk-session object can own the program, output cache, inputs, previous modules, and held-output reasons.
That object needs no new framework or shared abstraction with the command-line session.

Behavior preservation requires observations that do not derive their expectations from the changed implementation.
Existing golden files and behavior capture provide that check for compiler results.
Existing adapter tests provide selected observations, but generated session recordings compare the current implementation with itself.
Small fixed traces will cover the adapter transitions that this reset changes.

Each source phase will change one ownership boundary and retain the same tests on both capture sides.
Documentation will describe each changed boundary in the same phase.
The final phase will reconcile the complete design and close only this reset.

## Preservation contract

| Surface | Behavior that must remain equal | Existing evidence and required checks |
| --- | --- | --- |
| Source language | Accepted forms, rejected forms, error recovery, type identity, sealed construction, inferred inputs, and refinement rules | Error fixtures, parser/checker tests, application tests, and behavior capture |
| Diagnostics | Codes, messages, severity, ordering, spans, and related locations | Error fixtures, normalization tests, fixed adapter traces, and behavior capture |
| Typed IR | Wire version 7, node shapes, annotations, proofs, identities, interface hashes, and canonical serialization | `ir_snapshot_test.ts`, lowering tests, mutation tests, and behavior capture |
| TypeScript output | Exact text, companion modules, paths, imports, tags, source maps, and span tables | Golden files, output characterization, strict target tests, and behavior capture |
| Public library | Exported value names, type names, signatures, result variants, lazy queries, and old-revision behavior | Three entries in `deno.json`, `frontend.ts`, `typescript.ts`, `mod.ts`, and public API tests |
| Command line | Flags, exit codes, stdout, stderr, write ordering, watch behavior, and target-check behavior | CLI tests, stale-output tests, fixed traces, and subprocess tests |
| Language server | Protocol replies, document versions, diagnostics, edit queries, save behavior, retry rules, and restart behavior | Server tests, save tests, fixed traces, and subprocess tests |
| Playground | Editing, diagnostics, hover, output caching, stale-output labels, and replay | Facade, model, replay, build, and browser acceptance evidence |
| Logs and replay | Event names, envelope version, ordering, blob retention, supported sessions, and existing replay exclusions | Logging tests, wire-log tests, report tests, and replay tests |
| Packaging and applications | Installed entry points, VSIX contents, offline installation, and existing application results | Installation tests, application slow tests, and unchanged package scripts |

The wire contract of `src/core/ir.ts` must remain structurally compatible with `../effektive/public/typed-ir.ts` in both directions.
The website publishes standalone predicate types; the compiler imports those types and adds runtime helper constants.
Their file bytes differ before this reset.
The reset must not regenerate golden, lexer, validation, application, or specification fixtures to accept a difference.
New characterization expectations must come from the baseline before a source refactor.
The reset must not remove existing tests or reduce their assertions to make a refactor pass.
RST0a may change internal target configuration to restore compatible resolution under the existing Effect 4.0.5 contract.
That repair must preserve emitted TypeScript, source behavior, CLI flags, and diagnostic mapping.

The CLI watch loop forgets failed removals. The language server retries failed removals.
`runSaveRound` exposes both policies deliberately; the reset will preserve both.
The language server emits saved disk text, even when another document has an unsaved overlay.
Source hover remains independent of lowering and emission.

## Detailed findings review

### RSTF1: Map and Set construction has split ownership

**Observation: confirmed maintenance issue; no demonstrated behavior defect.**
`src/core/check_expr.ts:1186-1205` owns constructor rows for `mapOf` and `setOf`.
`src/core/check_expr.ts:1238-1506` also owns their expected-type handling, pair inference, joins, and data checks.
`src/core/check_builtins/map_set.ts:1-158` owns the remaining Map and Set operations.
`src/core/check_builtins/registry.ts:22-29` lists both constructors as core exceptions.

A change to Map or Set checking can therefore cross the body dispatcher and its family module.
The constructor helpers have no callers outside this constructor group, according to the current caller search.
The helpers use operations already available through `BuiltinContext`, `SyntaxView`, and `FactWriter`.
Expression checking can use `argInfo({ node })`; the family does not need access to the private body state.

**Disposition: accept RST2, the constructor-ownership phase.**
The family will own both constructor rows and their helpers.
`BodyChecker` will retain evaluation state, refinement state, and the dispatcher.
`Some` will remain a core row because this reset does not require another extraction.

`tests/map_set_ops_test.ts` already covers expected types, empty constructors, pair inference, invalid entries, and diagnostic text.
`tests/map_set_types_test.ts` covers variance and data restrictions.
`tests/builtin_rows_test.ts` checks unique ownership and complete prelude coverage.
Runtime tests assert literal operation results through the emitted public functions.

### RSTF2: The disk session has distributed state

**Observation: confirmed representation issue; no demonstrated save defect.**
`src/lsp/projects.ts:86-97` stores `diskProgram`, `diskOutputs`, `diskInputs`, `diskModules`, and `heldReasons` separately.
`src/lsp/projects.ts:453-457` initializes the first two fields separately and updates the inputs.
The rest of `saveRound`, through line 501, reads and writes the remaining fields.
Caller searches found no other production owner of these fields.

The representation does not express that these fields belong to one lazily created session.
A future reset of one field can leave the other session fields unchanged.
That effect is a maintenance risk, not a failure observed by this review.
The current overlay `ProjectPhase` already pairs revisions and deltas correctly; it needs no redesign.

**Disposition: accept RST3, the disk-session phase.**
One `DiskSession` object will own the five fields.
Creation will remain after a successful workspace read and behind `writeOnSave`.
Input advancement after an unsuccessful configuration update will remain unchanged.
Previous modules and held reasons will survive failed updates exactly as they do now.

The existing `diskProgram` read in `tests/lsp_save_round_test.ts:379-381` checks lazy creation.
A read-only compatibility getter will preserve that observation without exposing another state owner.
`tests/lsp_save_round_test.ts` already covers disk versus overlay text, failed removal retries, nested roots, and held-output messages.
The new fixed traces will cover the transition sequence across errors and recovery.

### RSTF3: Current session replay is insufficient as a refactor oracle

**Observation: confirmed evidence limit.**
`tests/logs_replay_test.ts:1-3` explicitly records a session from the current build before replaying that session.
`scripts/behavior_capture.ts:1-24` records compiler results, rather than complete CLI and language-server observations.
`scripts/logs_replay.ts:176-259` excludes watch sessions, skips target checking, and limits comparison to selected CLI events.
Passing these checks alone cannot prove that a refactor preserves all adapter output.

**Disposition: accept RST1, the fixed-contract phase.**
Small baseline traces will retain CLI output, language-server output, and final files for the transitions in this reset.
Existing replay behavior and exclusions will remain unchanged.
The reset will not build a universal replay system or extend watch replay.
The traces supplement existing public behavior tests; they do not replace runtime or installation checks.

### RSTF4: Behavior capture has known variance and test-set sensitivity

**Observation: confirmed limitation from recorded evidence; not reproduced during this planning run.**
`scripts/behavior_capture.ts:331-343` compares record multisets, which preserve duplicate counts.
The archived solution records transient clean program records and comparisons with changed test inputs.
See `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`.
The script exits unsuccessfully for missing records, but added records alone do not make it fail.

An exit code of zero therefore does not establish complete equality.
A changed test set can also hide or create apparent source differences.
**Disposition: acceptance rule in RST0, RST2, RST3, and RST4; no capture-tool redesign.**
The coordinator will inspect both added and missing records.
Unexplained differences will stop a phase, including clean program differences.
The historical variance allowance will not automatically accept a difference in this reset.

### RSTF5: The principal compiler boundaries are already explicit

**Observation: confirmed structure worth preserving.**
`deno.json` exports the whole API, frontend API, and TypeScript API separately.
`src/core/frontend.ts` exports source queries; `src/core/typescript.ts:64-140` owns the weak output cache.
`tests/core_boundary_test.ts` checks host isolation, source-query reachability, and adapter imports.
`tests/emit_families_test.ts` checks emitter dependencies.

**Disposition: retain the structure.**
An umbrella compiler service, new dependency-injection framework, or new backend protocol would add an unnecessary boundary.
The reset will not rename or reshape the public API.
The reset will not replace `Program`, `Revision`, or `TypeScriptOutputs`.

### RSTF6: The validator's repeated rules are intentional

**Observation: confirmed independence requirement.**
`src/core/validate/index.ts:1-17` identifies the independent validation boundary.
`tests/validate_test.ts` restricts imports into the validator.
`src/core/emit/shape.ts:1-8` requires separate child traversal in the validator.
The shared target-parser mirror has a separate differential check, as the concepts document requires.

**Disposition: reject rule consolidation across checker, validator, and emitter.**
This reset adds no shared semantic registry, shared annotation derivation, or shared expression walker across those boundaries.
Repeated independent rules are a correctness mechanism, not removable boilerplate.

### RSTF7: Lowering already has a closed positional-builder contract

**Observation: confirmed existing simplification.**
`src/core/lower.ts:220-246` maps each positional fact kind to the matching IR body shape.
Its mapped type rejects missing builders and incorrect fields.
Context-dependent builtins still require facts that the checker records.
The archived `arc-5-builtin-facts.md` assessment demonstrates why resolved builtin names cannot replace all those facts.

**Disposition: reject another lowering registry or a universal builtin specification.**
Moving the positional table into another file alone would not improve ownership or remove a semantic decision.
The reset will preserve checker-owned stage effects and contextual facts.

### RSTF8: Existing host abstractions encode different supported policies

**Observation: confirmed intentional differences.**
`src/host/generation.ts:33-73` converts lazy output queries into a closed `Generation` result.
`src/host/save_round.ts:20-26` explicitly distinguishes removal retry from removal forgetting.
`src/cli/build.ts` and `src/lsp/projects.ts` both use that shared output round.
The playground instead retains the last good output for display.

**Disposition: retain the current host output boundary and the separate surface controllers.**
A universal session would merge disk output, overlays, asynchronous CLI target checks, and stale browser output.
The reset needs none of that behavior combined.
The disk-session object remains local to the language server.

### RSTF9: File size alone does not justify a parser or type-system rewrite

**Observation: measured size; benefit from a rewrite remains unmeasured.**
`check_expr.ts`, `lower.ts`, and `parse.ts` are large files, but existing families and contracts already isolate several responsibilities.
The review found one separable constructor group with a complete existing context boundary.
The review did not establish another extraction with a comparable ownership benefit.

**Disposition: reject broad file splitting, class removal, type-table replacement, and refinement redesign in this reset.**
The reset sets no arbitrary file-size limit.
Interned type growth and declaration-level invalidation remain separate measurement questions.
Their current evidence limits remain in `docs/measurements.md` and `docs/status.md`.

### RSTF10: Existing plans and user deferrals need reconciliation, not reopening

**Observation: confirmed current planning state.**
`docs/archive/plans/2026-10-25-reset.md` records the previous reset as complete.
`docs/plans/` contains the accepted application rule, deferred TypeScript integration, and the registry.
`docs/status.md:311-323` retains manual acceptance and measurement ownership.
The website keeps the canonical specification in the sibling repository.

**Disposition: preserve these authorities and update only reset-related references during implementation.**
The new reset does not supersede the application rule or reopen TypeScript integration.
Broader package interoperability remains deferred.
The reset will not claim manual VS Code or playground acceptance.
The reset will not change application functionality or convert historical evidence into a new acceptance claim.

### RSTF11: The documented IR copy invariant is inaccurate

**Observation: confirmed documentation drift; no demonstrated wire incompatibility.**
`docs/architecture.md:57` says that `ir.ts` remains a copy of the sibling `typed-ir.ts`.
`docs/development.md:114` repeats the copy explanation for the formatting exclusion.
The files differ in predicate imports, standalone declarations, runtime helper constants, and formatting.
The bidirectional `ModuleIR` assignment check passed on the current files.

**Disposition: correct the invariant in RST4, the documentation phase.**
The reference must describe structural wire compatibility and the standalone publication boundary.
The reset will retain the compiler's current helper constants and the website's standalone type definitions.
It will not make file bytes equal or introduce a new publishing system.
The publication check proves type compatibility, not equality of independently executed runtime helpers.

### RSTF12: A cold target check resolves incompatible transitive packages

**Observation: reproduced baseline failure.**
`src/cli/tsc.ts:26-37` pins `effect` and `@effect/platform-node` to 4.0.5 in generated configurations.
Those configurations do not carry the compiler repository's dependency lock.
The cached package metadata for `@effect/platform-node@4.0.5` declares `@effect/platform-node-shared@^4.0.5`.
The fresh slow-test cache resolved that range to 4.1.0, which requires a newer Effect peer.
The FileSystem test then failed with the missing-module error recorded in the baseline.

**Disposition: prerequisite repair in RST0a, the target-resolution phase.**
The repair will keep Effect 4.0.5 and restore the existing FileSystem test's supported behavior.
An exact shared-package root pin is the first candidate, not a demonstrated resolver fix.
The executor must prove the resolved graph in a fresh cache before selecting that candidate.
An implementation that only works with a warm repository cache will fail acceptance.
RST0a intentionally restores a currently failing cold-cache path; it is not a behavior-preserving refactor of that failure.
The preservation baseline for both ownership changes comes after this repair.

## Design decisions

These decisions specify the recommended implementation. They are not permission to start it.
No unresolved product decision prevents completion of this plan.

| Decision | Options | Recommendation and reason |
| --- | --- | --- |
| RSTD1: reset depth | A: retain stages and repair ownership; B: replace the compiler architecture | A, recommended. Current contracts and tests already support the required functions. |
| RSTD2: constructor ownership | A: complete the existing Map/Set family; B: retain core exceptions; C: add a universal builtin schema | A, recommended. The required family contexts already exist. |
| RSTD3: disk state | A: one local optional session object; B: separate mutable fields; C: one session abstraction across all surfaces | A, recommended. One object states ownership without combining different surface policies. |
| RSTD4: behavior evidence | A: fixed adapter traces plus existing compiler capture; B: current-build replay alone; C: a new general replay engine | A, recommended. The selected evidence covers this reset with bounded changes. |

## Implementation sequence and shared gate

RST0 establishes the baseline. RST0a restores compatible target resolution before characterization.
RST1 freezes the behavior observations before either ownership refactor.
RST2 and RST3 both depend on RST1. RST3 follows RST2 to keep capture comparisons and local commits simple.
RST4 reconciles documentation and closes the reset after both source phases pass.
Each phase is independently reviewable and ends with its own local commit.
No phase requires a branch, worktree, history rewrite, push, or package release.

The coordinator owns review, evidence, commands, and commits on local `main`.
An executor owns only the files named in its dispatch.
The coordinator will use the repository's available Sol model for delegated implementation, with high reasoning effort.
If the configured Sol identifier is unavailable, the coordinator will resolve the model before dispatch.
This plan does not silently substitute an implementation model.

One executor turn may change one phase only.
A phase has a budget of two executor turns and one coordinator review turn.
An executor that reaches its budget will return changed paths, check results, and open issues.
The coordinator will split unfinished work before another dispatch.
The coordinator will not accept an executor's check claim without running the checks.

All commands below run from the compiler repository root unless a command names another working directory.
Each phase starts with its targeted checks and ends with `deno task check` before its commit.
RST0 may record the reproduced prerequisite failure; RST0a and every later phase require a passing full gate.
The full gate checks formatting, lint, types, fast tests, and slow tests.
The coordinator will first confirm a sub-minute targeted check before running a broader check.
Only the test scope changes when the coordinator broadens a check.
The existing rule for scripts exceeding two minutes still applies.
The coordinator will request approval before continuing a check that exceeds that limit.

The IR publication check uses type-only imports and two compile-time assignments.
It requires the existing sibling checkout and writes no project file.
The exact command is:

```sh
deno run --check --no-lock --ext=ts - <<'TS'
import type { ModuleIR as CoreModuleIR } from "./src/core/ir.ts";
import type { ModuleIR as SiteModuleIR } from "../effektive/public/typed-ir.ts";
type Assert<T extends true> = T;
export type CoreFitsSite = Assert<[CoreModuleIR] extends [SiteModuleIR] ? true : false>;
export type SiteFitsCore = Assert<[SiteModuleIR] extends [CoreModuleIR] ? true : false>;
TS
```

Expected result: exit zero with no type error in either assignment.
If the sibling checkout is unavailable, the coordinator will stop this check and report the missing contract.

Before either ownership phase starts, the coordinator will record its entry SHA in this document.
That SHA remains the phase's base through all attempts and corrections.
The coordinator will set `RESET_PHASE_BASE` to that recorded full SHA and `RESET_PHASE_HEAD` to the candidate full SHA.
The exact comparison is `deno task behavior:capture "$RESET_PHASE_BASE" "$RESET_PHASE_HEAD"`.
Each protected-path diff below uses those same fixed endpoints.
An executor resuming in a new shell will restore both variables from this document.
The coordinator will preserve the phase's tests on both sides.
Expected result: no added records and no missing records.
The coordinator will inspect the report even when the script exits with zero.

If a comparison differs, the coordinator will investigate the difference before another phase starts.
A same-revision diagnostic comparison uses `deno task behavior:capture HEAD HEAD`.
Known variance is a reason to investigate, not a permission to weaken the preservation contract.
If test changes become necessary, the coordinator will separate them before the source phase.
The documented fixed-test comparison procedure then applies; it must not change local `main` or the working tree.

### RST0: establish the baseline and register the authority

**Purpose:** make drift and preservation failures visible before code changes.
**Owner:** implementation coordinator. **Dependencies:** implementation authorization. **Risk:** low.

**Allowed writes:** this document, `docs/plans/README.md`, and `docs/status.md`.
The coordinator will add the registry row and one active-reset link in the status document.
The coordinator will retain all existing deferrals and manual acceptance states.
The coordinator will record the current revision, workspace state, full-gate result, and command durations in this document.
If source changed after `45218f3`, the coordinator will review that drift against every accepted finding first.

```sh
git branch --show-current
git status --short
git diff 45218f3 -- src tests scripts deno.json deno.lock playground editors
deno --version
deno test --allow-read tests/core_boundary_test.ts tests/emit_families_test.ts tests/docs_test.ts
deno task check
```

**Expected results:** branch `main`; unrelated changes identified and preserved; Deno 2.9.8; targeted checks exit zero.
The coordinator will also run the exact IR publication check from the shared gate.
Both assignment directions must pass.
The registry row must define `RST`, `RSTF`, and `RSTD` and link to this document.
The status change must identify this plan without changing a product acceptance claim.
The coordinator will record the full-gate result, including any reproduced target-resolution failure.
That known failure permits only RST0a to start; no ownership refactor may start with a failing gate.
Any different failure needs diagnosis and a bounded disposition before source work starts.

**Commit:** `Register the reset implementation authority`.
The phase adds no compiler behavior and needs no cross-revision capture.

### RST0a: restore compatible resolution of the pinned target

**Purpose:** restore a reproducible verification base without upgrading the supported runtime target.
**Owner:** one target-check executor. **Dependencies:** RST0. **Risk:** medium.

**Allowed writes:** `src/cli/tsc.ts`, `tests/cli_test.ts`, `tests/cli_slow_test.ts`, `docs/development.md`, and this document.
The executor will retain `EFFECT_VERSION = "4.0.5"` and the existing strict target options.
The executor will first test an exact `@effect/platform-node-shared@4.0.5` root import in the generated target configuration.
The executor will not assume that a root import constrains every transitive resolution.
The existing slow test will run `deno info --json --config deno.json run.ts` in its temporary project.
The test will assert the three resolved package versions and reject an incompatible peer warning.
The executor will record those versions and the fresh-cache check result in this document.
If the candidate does not constrain the graph, the executor will stop before introducing another resolution mechanism.
The coordinator will then revise this bounded phase with the observed resolver evidence.

The executor will preserve the existing literal FileSystem result and its missing-file and invalid-path cases.
The executor will update the generated-configuration assertion in `tests/cli_test.ts` for the selected exact pin.
The executor may strengthen the existing slow test to assert the compatible graph.
The executor will not suppress the peer warning, skip the runtime import, or weaken the literal assertions.
The root dependency files, fixtures, generated TypeScript, IR, and source-language semantics must remain unchanged.

```sh
deno test --allow-read tests/cli_test.ts
deno task test:slow --filter 'a typed FileSystem host adapter builds and maps package failures'
deno task check
git diff --exit-code -- fixtures deno.json deno.lock src/core
```

**Expected results:** each command exits zero, including the exact previously failing case in its fresh `DENO_DIR`.
The runtime graph must resolve `effect`, `@effect/platform-node`, and `@effect/platform-node-shared` to 4.0.5.
The runtime must return the unchanged literal result, without the missing-module error or incompatible-peer warning.
The coordinator will record the graph and the successful full-gate result before RST1 starts.
The repair restores an existing asserted contract; it does not establish broader package interoperability.

**Commit:** `Keep the pinned target packages compatible`.
This prerequisite has no valid passing cold-cache baseline at `45218f3` for a full capture comparison.
The unchanged literal test and the restored full gate establish the repair; RST1 then establishes the refactor baseline.

### RST1: freeze the behavior observations

**Purpose:** close the adapter-evidence gap before either refactor.
**Owner:** one test executor. **Dependencies:** RST0. **Risk:** low.

**Allowed writes:** new `tests/reset_contract_test.ts`, this document, and a short note in `docs/development.md`.
Existing source files and fixture baselines remain unchanged.
The executor will reuse `tests/cli_helpers.ts` and `tests/lsp_helpers.ts` through their existing interfaces.
The executor will store small fixed expectations directly in the new test file.
The executor will derive and review those expectations on the baseline before any source change.
The test must not regenerate expectations from the current compiler during assertions.

The new file will contain these bounded observations:

| Case | Public action sequence | Fixed observations |
| --- | --- | --- |
| Constructor recovery | Check minimal `mapOf` and `setOf` programs with expected types, inferred pairs, empty inputs, and invalid entries | Complete diagnostics, spans, and unchanged valid emitted text |
| CLI removal policy | Run `main` in watch mode; remove a generated module; fail map removal; permit removal; trigger another source edit | Exit code, exact stdout/stderr order, and final generated file contents showing the existing forget policy |
| Disk session recovery | Open two documents; leave one overlay unsaved; save valid disk text; introduce invalid configuration; repair configuration; save again | Exact published diagnostics and log messages, generated file bytes, and disk-only output |
| Disk removal retry | Run the ordered sequence below | Complete log and file observations after each save |

The disk-removal trace will use this exact order:

| Step | Action before the save | Required observation after the save |
| --- | --- | --- |
| 1 | The executor will save valid sources. The executor will delete one source and block map removal. The executor will save again. | The pending deletion remains after the failed removal. |
| 2 | The executor will invalidate a surviving module, then save. | The server reports the held module and retains the pending deletion. |
| 3 | The executor will save without another edit. | The server retries deletion and suppresses the repeated held reason. |
| 4 | The executor will invalidate the configuration, then save. | The server reports the configuration failure and retains both states. |
| 5 | The executor will repair only the configuration, then save. | The server retries deletion; the surviving module stays invalid without another held message. |
| 6 | The executor will permit deletion, then save. | The server removes the pending outputs while retaining the held module. |
| 7 | The executor will repair the surviving module, then save. | The server writes the module and clears its held reason. |
| 8 | The executor will invalidate the surviving module again, then save. | The server reports the held reason again. |

The executor will keep timestamps, session identities, and timing values out of fixed expectations.
The executor will preserve diagnostic order, event order, document versions, file paths, and generated bytes.
The executor will use in-memory failure controls and explicit message delivery instead of elapsed-time waits.
Existing tests already cover ordinary application behavior; this phase adds no duplicate application suite.
Each new test must complete in under one second.

```sh
deno test --allow-read tests/reset_contract_test.ts
deno test --allow-read tests/map_set_ops_test.ts tests/map_set_types_test.ts tests/builtin_arity_test.ts
deno test --allow-read tests/watch_stale_test.ts tests/lsp_save_round_test.ts tests/lsp_project_state_test.ts tests/logs_replay_test.ts
deno task check
git diff --exit-code -- src fixtures playground editors deno.json deno.lock
```

**Expected results:** all tests pass; each new test reports less than one second; the final diff command finds no changes.
The coordinator will compare each fixed expectation with the baseline source behavior and existing policy tests.
The coordinator will reject expectations that silently discard ordering or replace literal results with inferred expectations.

**Commit:** `Freeze reset behavior contracts`.
The coordinator will record this commit's full SHA as the behavior baseline in this document.
All later source comparisons will retain this test file unchanged.

### RST2: complete ownership of Map and Set checking

**Purpose:** make one existing family own each Map and Set source operation.
**Owner:** one compiler executor. **Dependencies:** RST1. **Risk:** medium.

**Allowed writes:** `src/core/check_expr.ts`, `src/core/check_builtins/map_set.ts`, `src/core/check_builtins/registry.ts`, `docs/architecture.md`, and this document.
No test or fixture changes belong in the source commit.

The executor will move the two constructor rows into `MAP_SET_ROWS`.
The executor will move their dedicated helpers from `check_expr.ts` into `map_set.ts`.
The helper group is `expectedMap`, `expectedSet`, `pairParts`, `isListLiteral`, `joinTypes`, `requireInferredData`, and `inferPairs`.
The moved handlers are `mapOfCall` and `setOfCall`.
The executor will remove the two constructor names from `CoreRowName` and `CORE_ROW_NAMES`.
`Some` will remain the sole core row.

The family context will combine `BuiltinContext`, `SyntaxView`, and `FactWriter`.
The executor will use `argInfo({ node })` for an unhinted expression and `showType` for local diagnostic rendering.
The executor will update `FamilyContext` in `registry.ts` to include the constructor context.
The executor will remove imports and methods that have no remaining callers.
The executor will preserve every call order, expected type, fact write, diagnostic span, and error-recovery result.
The executor will preserve `direct(1, "pure", ...)` and both constructor facts.
The extraction must not expose `BodyChecker`, add a callback framework, or add a checker import to the validator or emitter.

```sh
deno test --allow-read tests/map_set_ops_test.ts tests/map_set_types_test.ts tests/builtin_rows_test.ts tests/builtin_arity_test.ts tests/reset_contract_test.ts
deno test --allow-read tests/lower_test.ts tests/lower_stage_effects_test.ts tests/ir_snapshot_test.ts tests/core_boundary_test.ts tests/emit_families_test.ts
deno task check
```

**Expected results:** all tests pass; row ownership remains unique and covers every prelude call name.
`mapOf` and `setOf` must appear in the Map/Set family and not in the core exception list.
The architecture note must identify the constructor ownership without adding a new architectural layer.

After the local commit, the coordinator will run:

```sh
deno task behavior:capture "$RESET_PHASE_BASE" "$RESET_PHASE_HEAD"
git diff --exit-code "$RESET_PHASE_BASE" "$RESET_PHASE_HEAD" -- tests fixtures deno.json deno.lock src/core/ir.ts
```

**Expected results:** zero added records, zero missing records, and no changes in the protected paths.
The coordinator will inspect the moved code line by line and confirm that the constructor helpers have no residual callers in `BodyChecker`.

**Commit:** `Keep Map and Set checking in one family`.
If the context requires private checker state beyond the three named interfaces, the executor will stop and return that dependency.
The coordinator will revise the extraction before adding another context operation.

### RST3: give the disk session one owner

**Purpose:** express the existing lifecycle with one lazily created object.
**Owner:** one language-server executor. **Dependencies:** RST1 and completed RST2. **Risk:** medium.

**Allowed writes:** `src/lsp/projects.ts`, `docs/architecture.md`, and this document.
No test, protocol, host-output, or fixture changes belong in the source commit.

The executor will define a local `DiskSession` interface in `projects.ts`.
Its fields will be `program`, `outputs`, `inputs`, `modules`, and `heldReasons`.
The program and output cache references will be read-only.
The input map and previous-module list will advance at their current points in `saveRound`.
The held-reasons map will keep its current message-suppression behavior.

`ProjectState` will own one optional disk-session field and an operation that initializes the complete session.
`saveRound` will obtain that object only after `writeOnSave` and workspace-read checks pass.
The executor will retain a read-only `diskProgram` getter for the existing lazy-creation test.
The getter will return the session's program or `undefined`; it will not allocate state.
The executor will remove the separate mutable disk fields and use the session for every read and write.

The executor will preserve update ordering on configuration failure and recovery.
The executor will preserve stale-module retry, nested ownership, output ordering, and held-reason reset behavior.
The executor will leave overlay `ProjectPhase`, diagnostic publication, and query caches unchanged.
This phase adds no general session class, shared CLI state machine, event log field, or protocol field.

```sh
deno test --allow-read tests/lsp_save_round_test.ts tests/lsp_project_state_test.ts tests/reset_contract_test.ts
deno test --allow-read tests/lsp_server_test.ts tests/output_characterization_test.ts tests/watch_stale_test.ts tests/logs_replay_test.ts tests/core_boundary_test.ts
deno task check
```

**Expected results:** all tests pass, including the existing check that disabled save output creates no disk program.
The fixed traces must remain byte-identical to their RST1 expectations.
The architecture note must distinguish the disk session from the overlay program.

After the local commit, the coordinator will run:

```sh
deno task behavior:capture "$RESET_PHASE_BASE" "$RESET_PHASE_HEAD"
git diff --exit-code "$RESET_PHASE_BASE" "$RESET_PHASE_HEAD" -- tests fixtures deno.json deno.lock src/core
```

**Expected results:** zero added records, zero missing records, and no changes in the protected paths.
The coordinator will inspect every state mutation against the original `saveRound` order.
If a public protocol or CLI behavior must change, the executor will stop instead of expanding this phase.

**Commit:** `Keep disk compilation state in one session`.

### RST4: reconcile the final design and close the reset

**Purpose:** leave one accurate reference set and a complete preservation record.
**Owner:** implementation coordinator. **Dependencies:** RST2 and RST3 with passing evidence. **Risk:** low.

**Allowed writes:** this document, `docs/architecture.md`, `docs/api.md`, `docs/development.md`, `docs/status.md`, `docs/plans/README.md`, `CONCEPTS.md`, and `README.md`.
The final commit will move this document to `docs/archive/plans/2026-10-30-reset-implementation.md`.
Documentation edits must follow an actual change or correct a directly checked inconsistency.
This phase is not a general prose rewrite or a second architecture proposal.

The coordinator will reconcile the constructor family, disk-session ownership, and fixed-contract test instructions.
The coordinator will check the source file map and the public API descriptions against the final source.
The coordinator will retain existing application dispositions, unsupported features, performance limits, and pending manual acceptance.
The coordinator will record each phase's revision, targeted results, full-gate result, and capture result in this document.
The coordinator will record the RST1 behavior baseline and the final source revision as full SHAs.

The coordinator will review `../effektive/public/index.html` and `../effektive/public/effektive-spec.html` for affected claims.
This plan changes no source form or application disposition, so it selects no website edit by default.
If a website statement becomes false, the coordinator will correct that statement in a separate sibling-repository commit.
The correction must stay within this reset's design; it must not add examples or a feature campaign.
If a TypeScript panel changes, the coordinator will run `deno task typecheck` from `../effektive`.
If an Effektive example changes, the coordinator will compile it with validation and strict target checks before its separate commit.
An example change that needs new source semantics is outside this plan and stops completion.

```sh
deno test --allow-read tests/docs_test.ts tests/core_boundary_test.ts tests/emit_families_test.ts tests/reset_contract_test.ts
deno task check
git diff --exit-code 45218f3 -- fixtures deno.json deno.lock src/core/ir.ts
git diff --check
```

**Expected results:** every command exits zero; protected contracts and fixtures remain unchanged.
The coordinator will also run the exact IR publication check from the shared gate.
Both assignment directions must pass.
The full gate includes strict target and runtime application tests; no new acceptance claim may exceed those tests.
The coordinator will compare the RST1 baseline with the final source revision using `deno task behavior:capture <RST1-SHA> <final-source-SHA>`.
The two SHA placeholders mean the full recorded revisions, not the current working tree.
Expected result: zero added records and zero missing records, with the same test files on both sides.
The final source revision precedes this documentation-only archive commit.

After moving this document, the coordinator will run `deno test --allow-read tests/docs_test.ts` again.
The registry must point to the archive path, and the active-reset row must leave `docs/status.md`.
This document remains the reset authority at its archive path.

**Commit:** `Document and close the reset implementation`.
The coordinator will not push, release, or mark the manual acceptance items complete.

## Rollout, recovery, and stop conditions

The reset has no external migration and no switch between old and new compiler behavior.
Each source phase replaces one internal ownership boundary after its characterization phase passes.
The public package version and IR version remain unchanged.

If the baseline changes, the coordinator will review the drift before executing a phase.
If a phase changes supported behavior, the coordinator will stop and record the difference in this document.
If a fixture update appears necessary, the coordinator will treat that need as a failed preservation check.
If tests need changes during a source phase, the coordinator will separate those changes before comparing source revisions.
If source capture is unstable, the coordinator will investigate or stop; a passing fast suite alone is insufficient.
If an executor exceeds its turn budget, the executor will hand back its status without continuing.

The coordinator will revert an isolated source commit if the completed phase fails preservation and cannot receive a bounded correction.
A revert will use a new commit on local `main`; it will not rewrite history.
The coordinator will preserve unrelated user changes.
An incomplete or reverted phase does not satisfy the reset's completion criteria.

## Completion criteria

The reset is complete only when all six phases have the required recorded evidence.
RST0a must restore a passing full gate before characterization or ownership changes start.
Map and Set checking must have one family owner, with `Some` as the remaining core exception.
The disk compilation session must have one state owner and retain the separate overlay program.
The fixed adapter traces and unchanged compiler capture must establish preservation over the selected behaviors.
The full gate must pass at the final source revision and before the final commit.
The public API, IR, generated fixtures, language forms, protocol, and application dispositions must remain unchanged.
Current documents must describe the final ownership boundaries and evidence limits.
The registry and archive path must identify this single plan authority.

Passing these criteria establishes this reset, not full Effect parity, bounded memory, or manual editor acceptance.
No new cleanup queue follows automatically from completion.

## Independent validation

Requested reviewer: Codex Astra, `gpt-6-astra`, `xhigh`.
Review state: complete on 2026-10-30. Verdict: ready for user review, with no unresolved material plan finding.
The validator changed no files.

| Material finding | Failure condition and effect | Resolution |
| --- | --- | --- |
| Incomplete recovery trace | Without an invalid surviving module and intermediate saves, the trace cannot establish retained held reasons across configuration failure. | RST1 now specifies eight ordered steps, with saves and observations at every transition. |
| Moving capture baseline | A corrective commit compared with `HEAD~1` can hide the original phase's behavior change. | RST2 and RST3 retain fixed entry and candidate SHAs for capture and protected-path comparisons. |
| Incorrect byte-equality gate | The compiler and standalone website contract already have different file bytes. | The tested bidirectional `ModuleIR` check replaces file equality; RSTF11 records the documentation correction. |
| Repair versus preservation | Restoring a failing target graph changes the cold-cache outcome and cannot count as preservation of that failure. | RST0a declares restoration separately; RST1 establishes the later refactors' preservation baseline. |

The validator confirmed that the constructor extraction fits the existing three interfaces.
The validator also confirmed that the disk-session design preserves lazy creation and mutation order.
The validator independently passed the bidirectional IR check.
The validator ran 134 focused tests with zero failures.
Those tests covered Map/Set behavior, row ownership, LSP saves and state, watch policy, boundaries, and documentation.
The main agent's fast-suite run independently covered those files within the 2,676 passing tests.

The validator did not run the full gate, behavior capture, runtime tests, or installation tests.
The validator did not independently reproduce the dependency failure; the main agent reproduced it as recorded above.
The candidate target pin remains unproven and has a required fresh-cache check and stop condition.
Validation establishes that the plan is ready for review; it does not establish that the proposed changes already pass.

## Implementation evidence

Implementation has not started. The following table is the complete reset execution ledger.
The coordinator will keep detailed results here instead of creating a second authority.

| Phase | Status | Revision | Targeted checks | Full gate | Capture or exemption |
| --- | --- | --- | --- | --- | --- |
| RST0: baseline and authority | Not started | Pending | Pending | Pending | Documentation only |
| RST0a: compatible target resolution | Not started | Pending | Pending | Pending | Restored literal contract and fresh-cache full gate |
| RST1: fixed behavior contracts | Not started | Pending | Pending | Pending | New tests only; becomes behavior baseline |
| RST2: constructor ownership | Not started | Pending | Pending | Pending | Fixed phase-entry-to-candidate comparison required |
| RST3: disk-session ownership | Not started | Pending | Pending | Pending | Fixed phase-entry-to-candidate comparison required |
| RST4: final design and closure | Not started | Pending | Pending | Pending | Baseline-to-final-source comparison required |

Next action: the user will review this completed plan before an implementation request.
