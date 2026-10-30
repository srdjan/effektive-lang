# Reset implementation plan for a stable base

Status: implementation complete; final LFG review pending. Date: 2026-10-30.
Planned revision: `fd20ff599fdfb43d1df20d4dbbaf7141536dd411` on local `main`.
Documentation refresh revision: `66834187fc930198b97e6f5d481a8dd586097293`.
The refresh changes the changelog and status guide only; the reviewed source remains equal.

## Authority and scope

This document is the sole authority for this proposed reset.
It contains the detailed findings review, target design, phases, verification, and validation record.
The completed reset plans remain historical evidence.
The canonical specification and current project status retain their existing authority.

The original planning request authorized changes to this document only.
During planning, this agent changed only this document.
Concurrent edits by other workspace actors are recorded below and preserved.
The later LFG invocation authorized the implementation phases and required verification.
The coordinator registered this authority in the baseline phase.

NB identifies phases for the new base.
NBF identifies findings for the new base.
NBD identifies design decisions for the new base.
These prefixes were absent from `docs/plans/README.md` at the planned revision.

## Planning worklog

Objective: define small reset phases that preserve current functionality.
Accepted direction: retain the current architecture and repair the two remaining code gaps below.
Evidence: the main agent reproduced every accepted finding.
Concurrent change: another workspace actor committed the changelog correction as `26b7eb4`.
The same actor also changed the Schedule row in `docs/status.md`.
Commit `6683418` records that status correction.
The main agent did not make or revert those edits.
User steering: include the six known risks without adding action.
Completed: independent reviews, reproduced findings, Astra validation, and reconciliation.
Authorization: the user invoked LFG to execute this plan on 2026-10-30.
The invocation authorizes required verification, including captures and full measurements that exceed two minutes.
The coordinator will preserve the six known risks without adding remediation tasks.
Completed: registered baseline, committed guard repair, committed table fork, committed revision repair, and required measurements.
Completed: unchanged-corpus capture with zero new or missing records.
Completed: final documentation gate and archive link checks.
Current work: commit the archive move, then run final LFG review and delivery checks.

| Unit | Owner and model | Read scope | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| Compiler review | Independent Sol reviewer, high reasoning | `src/core/`, related tests, architecture, solved problems | Current evidence, concrete impact, existing protection, bounded direction | One turn; at most 18 tool calls |
| Adapter review | Independent Sol reviewer, high reasoning | Host, CLI, LSP, playground, editor, scripts, tests | Current evidence, concrete impact, existing protection, bounded direction | One turn; at most 18 tool calls |
| Synthesis | Main agent, configured model and effort | Documents and cited source | One self-contained plan with exact checks | One planning turn |
| Validation | Codex Astra, xhigh reasoning | This document and cited source | Challenge preservation, scope, dependencies, commands, and completion | One turn; at most 18 tool calls |
| Reconciliation | Main agent, configured model and effort | This document and cited source | Resolve material validation findings and confirm file scope | One reconciliation turn |

The available Sol model is `gpt-6.1-sol`; the historical `gpt-5.6-sol` identifier is unavailable.
The user's explicit Astra instruction governs validation: `gpt-6-astra`, with `xhigh` reasoning.
All reviewers have read-only scope.
The two independent reviews completed without file edits.
The main agent inspected their cited evidence and ran both reproducers below.

## Baseline and evidence limits

The checkout started clean at the planned revision.
The package version is 0.11.0, and generated TypeScript targets Effect 4.0.5.
The local runtime reports Deno 2.9.8, V8 15.0.245.2-rusty, and TypeScript 6.0.3.
The imported `typescript@5.9.3` supports tools; it does not select the compiler behind `deno check`.

| Check | Current observation |
| --- | --- |
| `deno task test` | Exit 1: 2,868 passed, one failed; measured wall time 5.258 seconds |
| `deno task check` | Exit 1: format, lint, and type checks passed; the fast suite failed the same documentation check; 4.412 seconds |
| `deno task test:slow` | Exit 0: 282 passed, zero failed; 41.585 seconds |
| Retained-revision probe below | All checker diagnostics empty; cold validation has zero errors; delayed validation has three errors |
| Playground path probe below | `src` unsafe; `..scratch` incorrectly safe; parent unsafe; `playground/dist` safe |
| Repository scope after checks | Only this untracked plan document; sibling website clean |

These baseline observations precede a concurrent changelog edit.
The working copy later gained the correct `0.11.0 - 2026-10-30` heading.
The main agent then reran `deno test --allow-read tests/docs_test.ts`: all four checks passed.
That edit belongs to another workspace actor and stays outside this agent's write scope.
NB0 must reconcile the existing edit instead of overwriting or claiming it.
Commit `26b7eb4` subsequently recorded the correction.
The concurrent status correction remains separate from this planning work.
The main agent reran `deno task check` after the heading correction.
It exited zero in 82.778 seconds, including 282 passing slow tests.
This refresh establishes a green working-copy baseline without a source change.

The slow suite ran separately because the full gate stopped before its slow stage.
Its passing result does not make the full gate pass.
The slow suite includes application, target, installation, and playground-build checks.
These results establish the existing tested cases only.
The planning review ran no behavior capture, full benchmark, browser session, or installed-editor acceptance.
The planning review ran no fixture generator and made no source repair.

The main agent inspected public entries, compiler stages, revision storage, adapter policies, documentation, and verification commands.
The compiler reviewer inspected `src/core/` and related tests.
The adapter reviewer inspected adapters, playground build, scripts, and existing surface tests.
Both reviewers checked prior reset work.
This bounded review does not prove that every possible defect is absent.

## First-principles design

A compiler must associate each result with the source and definitions that produced that result.
An incremental compiler must preserve that association when later edits reuse storage.
A build tool must identify its output directory before it removes files.
A verification gate must agree with the repository's own version record.
These requirements establish the reset scope.

The current pipeline already provides suitable boundaries.
Source checking produces typed intermediate representation, abbreviated IR.
An independent validator checks the IR, and a separate backend emits TypeScript.
The frontend, CLI, language server, editor client, and playground share this core.
The reset will keep these boundaries.

The independent validator deliberately duplicates checker rules.
Sharing those rules would remove its independent comparison.
The confirmed revision defect concerns shared mutable definitions inside one incremental program.
The repair therefore belongs between program storage and revision storage.
A compiler rewrite or new dependency framework would add unrelated work.

### Design selections

These numbered selections state this proposal's recommended design.
They do not record user approval to implement it.

| Decision | Options | Recommendation and reason |
| --- | --- | --- |
| NBD1: architecture | Retain the pipeline; replace the compiler architecture | Retain the pipeline. The reproduced failure has a narrower storage cause. |
| NBD2: revision definitions | Fork definition maps; eagerly lower each revision; rebuild each revision completely | Fork definition maps over shared interned nodes. This preserves lazy queries, stable references, and incremental reuse. |
| NBD3: output paths | Repair path-component comparison; restrict all builds to one directory | Repair path-component comparison. Existing external output directories remain supported. |
| NBD4: version record | Document 0.11.0; revert to 0.10.4; weaken the version test | Document 0.11.0. The planned revision explicitly selected that version. |

### Ownership after the reset

An interned type has one stable numeric reference, called `TypeRef`.
One append-only storage object will own interned nodes, intern keys, and canonical IR keys.
Each `TypeTable` fork will own separate alias definitions and error-record definitions.
A revision will retain the table used to check that revision.
Lazy lowering and editor queries will use that retained table.

The shared storage will contain `nodes`, `byKey`, and `irKeys`.
The separate maps will contain `defs` and `errorRecords`.
Forks will copy those maps before a checker can replace definitions.
Forks will share immutable definition values until a writer replaces a complete value.
Forks must not retain a parent table or previous maps.
This design starts with map copies; its runtime and memory costs require measurement.

Lowering also interns function types, so a read-only wrapper alone cannot provide the required table.
The fork must retain interning methods while keeping definition writes separate.
`TypeRef` values must remain valid across reused modules.
The existing `TypeReader` shape will remain unchanged.
Its `size` will remain the shared, cumulative count of interned nodes.
The reset does not redefine counters or promise a fixed storage size for retained revisions.

An unchanged module may continue to share its `Entry` and cached lowering.
That sharing requires unchanged semantic and lowering keys.
The repair must preserve interface cutoffs, span invalidation, and weak output-cache keys.
The reset will not lower eagerly or clear all caches after every edit.

Each cached `CheckedModule` also retains its last-check table through `declarations.env.table`.
That environment remains the module's last-check state.
`Revision.types` provides the current revision's definition view.
The repair will preserve both meanings and existing checked-module object identity.
It will not rebind or remove the public environment field.

Without caller-retained objects, distinct retained tables cannot exceed the current cached-module count plus the current table.
This is a structural count bound, not a byte bound.
Each retained table may hold copied definition maps.
Caller-retained revisions or checked modules can retain additional tables.
All-module measurements below must expose that storage cost before acceptance.

## Detailed findings review

This section contains the complete findings review for this reset.
“Confirmed” means that the main agent inspected the cited code and reproduced the condition.
Additional reader paths indicate exposure; they do not establish separate reproduced failures.

### NBF1: the version record prevents a green baseline

Priority: high prerequisite. Confidence: confirmed. Disposition: corrected externally in `26b7eb4`; NB0 confirms the baseline.

`deno.json:3` selects version `0.11.0`.
Commit `fd20ff5` changed only that version field.
`CHANGELOG.md:3` holds Unreleased notes, followed by `0.10.4` at line 16.
`tests/docs_test.ts:135-147` compares the newest versioned heading with the package version.
Both measured gate attempts fail this check.
The concurrent correction repaired this heading; the original planned commit still contains the mismatch.

Condition: an executor runs the required gate at the planned revision.
Effect: the executor cannot complete the required check before a commit.
The test already detects the mismatch, so another version checker is unnecessary.
The repair will document the existing version and preserve all existing change notes.
The repair will not select a new version, tag, target, or release.

### NBF2: later edits change retained revisions

Priority: high. Confidence: confirmed. Disposition: NB2 and NB3, isolate definitions for each revision.

`src/core/db.ts:288` retains one `TypeTable` for the whole program.
`src/core/db.ts:444-446` puts that table into each checked project.
`src/core/db.ts:180-182` exposes it through `Revision.types`.
`src/core/db.ts:266-274` delays lowering until a query requests a module.
These choices allow an old revision to read definitions from a later edit.

`src/core/types.ts:379-380` stores mutable alias and error-record definitions.
Writers at lines 798, 810, 826, 836, and 960 replace those map entries.
`src/core/lower.ts:1400` reads the current tagged-record definition during implicit construction.
Condition: a later edit changes that record before the earlier revision first lowers it.
Effect: earlier IR combines original expression fields with a later type annotation.
Independent validation rejects that inconsistent IR.

The main agent reproduced three `validation/002` errors for the retained revision.
A fresh program for the original source validates without errors.
Both source versions check without diagnostics.
The serialized IR differs, but emitted TypeScript stays byte-equal.
Emitted-output equality alone therefore cannot protect this boundary.

Existing tests cover different query orders.
`tests/output_characterization_test.ts:20-23` requests earlier output before the later edit.
Its later assertions read an existing cache entry.
`tests/db_test.ts:97-115` compares each revision with a fresh program immediately.
Neither case delays the earlier revision's first lowering across a definition change.

The same maps support additional revision queries.
`editor_completion.ts:55-63` follows alias, tagged-record, and error fields.
`editor_signature.ts:33-37` unfolds function aliases.
`editor.ts:140-144` reads sealed status, and `editor_tokens.ts:49-53` reads tagged status.
`lower.ts:1218-1223` reads identity definitions during proof adoption.
These paths need regression coverage, although the review did not reproduce each path separately.

The repair must include both definition maps.
Freezing only `Revision.types` would leave `lowerModule` attached to the mutable checked table.
`lower.ts:1718` also interns a function type during finalizer lowering.
The proposed fork preserves that capability without sharing definition writes.
`type_ir.ts` serializes named references without unfolding them, which permits shared canonical IR keys.

The first draft understated retention after the fork.
`signatures.ts:133-135` exposes `ModuleDeclarations.env`, whose `table` field appears at line 60.
`check.ts:183-184` retains that environment in each checked module.
`tests/db_test.ts:199-201,238,287` requires reuse of checked modules and declarations.
Consequently, discarding a revision does not necessarily release its table.
The final design preserves that bounded ownership and measures its cost.

### NBF3: the deletion guard confuses a prefix with a path component

Priority: medium. Confidence: confirmed. Disposition: NB1, repair the output-path guard.

`playground/build.ts:92-98` uses `startsWith("..")` to identify paths outside the repository.
A repository child called `..scratch` satisfies that prefix check.
The pure `isUnsafe` API incorrectly returns `false` for that child.
`playground/build.ts:113` removes an accepted output directory recursively.
Condition: a caller supplies such a repository child as the output directory.
Effect: the build can remove that child despite its documented repository protection.

The review called only the pure guard; it did not run a deletion reproducer.
`tests/playground_build_test.ts:11-21` covers ordinary directories, parents, allowed distribution paths, and external directories.
Those tests omit directory names that start with two dots.
The repair will compare path components, with the platform separator.
External output directories and `playground/dist` descendants will remain supported.
This phase does not change symlink policy or claim physical-path containment.

### Findings considered and rejected

| Candidate | Evidence and disposition |
| --- | --- |
| Repeat the prior stable-base reset | Its ledger records completed lock, oracle, proof-budget, disk-session, and test-structure work. Those tasks are absent here. |
| Reopen the parallel reset plan | `docs/archive/plans/2026-10-30-reset-implementation.md` was not selected. This proposal creates one new execution authority only. |
| Consolidate CLI and language-server sessions | Saved-source and overlay policies differ. Existing `DiskSession` ownership already removes the earlier split state. |
| Unify watch and save removal policy | `src/host/save_round.ts` makes policy explicit. CLI forgets failed removals; the language server retries them. |
| Add another general surface oracle | `tests/surface_test.ts` already compares committed CLI and language-server observations. This reset preserves those expectations. |
| Add watch replay or target-check replay | Current exclusions are deliberate. Neither addition repairs the confirmed findings. |
| Split `BodyChecker` or files by length | No new separable ownership defect survived review. File size alone does not justify a phase. |
| Share checker and validator rules | Independent derivation is a required protection. |
| Prune public exports or unread public fields | Current functionality includes those contracts. No repository caller does not mean no public contract. |
| Introduce persistent caches or hosted CI | No confirmed finding requires either system. |
| Adopt content mappers or broader package imports | Both areas retain explicit user deferrals in `docs/status.md`. |
| Expand application or Effect coverage | The application gates already satisfy the stopping rule. New features do not support this reset. |
| Regenerate publication types or fixtures | No wire or output change is required. Existing publication checks have documented limits. |
| Correct all historical documents or benchmark gaps | Archived evidence remains historical. Documentation work covers only facts affected by this reset. |

The selected historical reset is `docs/archive/plans/2026-10-30-stable-base-reset.md`.
Its post-closure ledger records the version-pin and `withFiber` validator repairs.
This plan does not reopen those findings.
The application rule remains `docs/plans/2026-10-19-application-acceptance-rule.md`.
The content-mapper plan remains deferred.

Behavior capture observes selected compiler results, rather than every public query.
Surface fixtures observe selected CLI and language-server transitions, rather than every log envelope.
Replay skips CLI watch and target checking.
The published IR assignment guard cannot detect every extra optional property.
None of those documented limits requires a new framework for the three accepted findings.

## Known risks: no action needed now

The user supplied these six risks on 2026-10-30.
The counts and prior attempts describe the earlier review.
This planning task does not remeasure those counts or add remediation phases.

- Nothing ties published website examples to compiler fixtures. The examples can drift again, as the scheduled worker did.
- Of 65 website code blocks, 22 are not fully checked. They are fragments or need declarations from elsewhere.
- `withFiber` is the only callback the user fixed. Three attempts could not express the `mapGroups` case in source.
  That site has no evidence either way.
- `tests/target_helpers.ts:106` still uses `--no-lock`.
- Two fast cases in `tests/proof_budget_test.ts` run close to the time limit.
- The earlier p90 spike has no confirmed cause. Other machine work is the probable cause.

A controlled alternating benchmark with machine-load records could test the p90 explanation.
That possible check is not a new task in this reset.
The known risks remain open evidence limits after the reset.

## Preservation contract

The reset preserves intended current functionality and repairs the two reproduced incorrect behaviors.
NBF2 restores retained-revision semantics.
NBF3 restores the documented output-directory restriction.
These repairs are the only allowed behavioral differences.
NBF1 changes the version record without changing executable behavior.

| Surface | Required result |
| --- | --- |
| Language and checking | Existing forms, contracts, proof rules, diagnostics, and ordering remain equal. |
| Typed IR | Version 7, node forms, identities, annotations, proofs, and serialization remain equal for unaffected queries. |
| Retained revisions | Original definitions determine delayed lowering and editor results, regardless of later edits. |
| TypeScript | Existing text, companion modules, imports, maps, and span tables remain equal. |
| Public API | The three entries in `deno.json` retain exported names, signatures, result variants, lazy behavior, and counters. |
| Incremental work | Module cutoffs and cache reuse remain; unrelated edits cause no additional checks, lowerings, or emits. |
| Adapters | CLI flags, exit codes, messages, protocol, save ordering, retries, and disk-versus-overlay policy remain equal. |
| Logs | Envelope formats, event names, retention, replay outcomes, and exclusions remain equal. |
| Playground build | Valid output directories work; repository paths with misleading dot prefixes are rejected. |
| Runtime and packaging | Existing application, cancellation, cleanup, entry-point, VSIX, and offline-install checks remain. |
| Documentation | Current guides describe final ownership and version. Historical evidence retains its dates and limits. |

The reset will not regenerate golden, lexer, mutation, IR, or surface fixtures to accept a difference.
The reset will not weaken existing tests or the independent validator.
Effect 4.0.5, Deno 2.9.8, package version 0.11.0, and dependency locks stay fixed.
The linked portable-publisher fixture remains.

## Execution rules and shared verification

The original planning request authorized no implementation.
The later LFG invocation authorizes execution and required verification of this plan.
The future coordinator will compare the live checkout with the planned revision.
The coordinator will reconcile changes to cited files before dispatch.
The coordinator will preserve unrelated edits and work on local `main`.
Each complete unit will receive a separate local commit after its required gate.
No phase authorizes a push, publication, deployment, history rewrite, or worktree.

Each phase lists its exact write scope.
This plan also receives phase status and evidence updates during authorized implementation.
The coordinator will review every changed line and rerun the listed checks.
A reviewer claim alone is not acceptance evidence.
At its turn budget, an executor will stop and return changed files, checks, and open items.

The drift checks are:

~~~sh
git branch --show-current
git status --short
git log --oneline fd20ff599fdfb43d1df20d4dbbaf7141536dd411..HEAD
git diff fd20ff599fdfb43d1df20d4dbbaf7141536dd411 -- src deno.json deno.lock playground/build.ts tests docs/architecture.md CHANGELOG.md
deno --version
~~~

Expected: local `main`, Deno 2.9.8, and understood changes only.
An advanced HEAD requires reconciliation, rather than an automatic reset or checkout.
The coordinator will record each phase entry SHA before edits.

Before every implementation commit, `deno task check` must exit zero.
The observed baseline failure is allowed only before NB0 finishes.
Every later failure blocks the next phase.
The shared fixture check is:

~~~sh
git diff --exit-code fd20ff599fdfb43d1df20d4dbbaf7141536dd411 -- fixtures src/core/ir.ts src/cli/target_lock.json tests/application_lock.json deno.lock
~~~

Expected: no differences.
The coordinator will inspect `git diff --name-status <phase-entry-SHA>` against the phase scope.
New test filenames below are proposed files.

Capture and full benchmark commands can exceed two minutes.
The coordinator must obtain the permission required by project instructions before those commands run during implementation.
The later LFG invocation supplies that verification permission for this run.
It does not authorize unrelated long scripts or destructive operations.

## Phases

Each phase supports a green baseline, correct ownership, or evidence and documentation for that ownership.
NB1 and NB2 are independent after NB0.
NB3 requires NB2.
NB4 requires all earlier phases.
Recommended order: NB0, NB1, NB2, NB3, NB4.

### NB0: restore and register the baseline

Owner: main coordinator, configured model and effort.
Budget: one turn, at most 12 tool calls.
Write scope: `CHANGELOG.md`, `docs/plans/README.md`, and this plan.
Dependency: none.

The coordinator will confirm the existing `0.11.0 - 2026-10-30` changelog heading.
The correction already exists in `26b7eb4`; NB0 will not repeat it.
If later drift removes that heading, the coordinator will reconcile ownership before making a correction.
The coordinator will retain existing Unreleased notes under that heading without adding unobserved release claims.
The coordinator will preserve older entries.
The coordinator will register NB, NBF, and NBD with this document's path.
The coordinator will record the green baseline SHA here.

Verification:

~~~sh
deno test --allow-read tests/docs_test.ts tests/versions_test.ts
deno task check
git diff --exit-code fd20ff599fdfb43d1df20d4dbbaf7141536dd411 -- src tests fixtures deno.json deno.lock playground editors scripts bench
~~~

Expected: both test commands pass, and the final command prints nothing.
Package and changelog versions both remain 0.11.0.
The registry contains one row for this plan and no reused prefix.
The full suite retains all baseline cases and assertions.
The commit normally contains only the registry and this plan.
No unrelated or externally owned edit belongs in that commit.

### NB1: repair the playground path boundary

Owner: main coordinator, configured model and effort.
Budget: one turn, at most 12 tool calls.
Write scope: `playground/build.ts`, `tests/playground_build_test.ts`, and this plan.
Dependency: NB0.

The coordinator will distinguish the complete `..` component from names that start with `..`.
The check will use `SEPARATOR` for a parent followed by another component.
An empty relative path still denotes the same directory.
An absolute relative result still denotes a different root.
The guard will reject the repository root, parents, and repository children outside the allowed distribution subtree.
The repair will retain the existing `BuildError` shape.

The coordinator will extend the pure guard tests:

| Path relative to repository root | Expected `isUnsafe` |
| --- | --- |
| `..scratch` | `true` |
| `..scratch/nested` | `true` |
| `...` | `true` |
| `src/../..scratch` after resolution | `true` |
| `playground/dist-other` | `true` |
| `playground/dist/nested` | `false` |
| External sibling, including a name that starts with dots | `false` |

The tests will call the pure API without creating a repository directory for deletion.
The existing slow test already checks supported external output.

Verification:

~~~sh
deno test --allow-read tests/playground_build_test.ts
deno task test:slow --filter 'build writes the page files and the examples'
deno task check
~~~

Expected: all guard cases pass, and the external build succeeds.
The shared fixture check prints nothing.
No build-time deletion probe may target repository data.
Browser acceptance is unnecessary because this phase changes no page behavior.

### NB2: add a table fork with separate definitions

Owner: one Sol executor with high reasoning; the coordinator reviews and verifies.
Budget: one turn, at most 18 tool calls.
Write scope: `src/core/types.ts`, `tests/types_test.ts`, and this plan.
Dependency: NB0.

The executor will add `TypeTable.fork()` without changing the default constructor's behavior.
A small internal storage structure will group `nodes`, `byKey`, and `irKeys`.
Forks will share that structure and copy `defs` and `errorRecords`.
The executor will preserve existing methods and reference values.
No production caller will use the fork in this phase.
The fork will contain no parent pointer.

Tests will use the class's public methods.
They will verify stable references for the same interned node across forks.
They will verify independent changes to transparent, identity, tagged, opaque, sealed, predicate, and error definitions.
They will verify that changing the original cannot change a fork.
They will verify that changing a fork cannot change its original or another fork.
They will verify that tables can intern new nodes and resolve the shared references.

The executor will inspect every mutable table field before grouping it.
Only values whose meaning depends on immutable nodes can enter shared storage.
A new definition-sensitive cache requires review before the scope expands.
The coordinator will check that default builtins initialize correctly and remain available in forks.

Verification:

~~~sh
deno test --allow-read tests/types_test.ts tests/core_boundary_test.ts tests/check_body_test.ts
deno task check
~~~

Expected: independent definitions, unchanged reference identity, unchanged union ordering, and a passing gate.
The shared fixture check prints nothing.
The coordinator will confirm that `db.ts` has no new fork call yet.
This phase adds a tested storage operation; it does not repair retained revisions yet.

### NB3: bind each revision to its definitions

Owner: one Sol executor with high reasoning; the coordinator specifies, reviews, and verifies.
Budget: two turns, at most 30 tool calls in total.
Write scope: `src/core/db.ts`, new `tests/revision_isolation_test.ts`, `docs/architecture.md`, and this plan.
Dependency: NB2.

Before edits, the coordinator will record `NB_CAPTURE_BASE` as the current commit SHA.
The executor will fork the current table before module checking can replace definitions.
Every `checkModuleStep` in that update will use the fork.
The checked project and `Revision.types` will retain that same fork.
The program will publish the fork as its current table after checking finishes.
Configuration failures will retain existing `Result` behavior and file-change semantics.

The executor will preserve module keys, `Entry` sharing, lazy lowering, and counters.
The executor will not remap references or rebuild every module.
The executor will not add a table-history collection or parent links.
Cached module environments will retain their last-check tables, as specified in the ownership section.
The architecture guide will explain shared interned storage and separate revision definitions.

The new tests will use `frontend.ts` and `typescript.ts`.
A fresh program will provide the expected original results.
The new tests will cover this matrix:

| Case | Required observation |
| --- | --- |
| Tagged-record edit before the earlier first query | Original and fresh-original IR equal; both validate |
| Warm original output, then edit | Existing object reuse and original output remain |
| Cold original output, newer output queried first | Original output, maps, and span tables equal fresh-original results |
| Imported alias or tagged definition changes | Earlier imports retain definitions; current revision equals a fresh current build |
| Error field changes | Earlier `errorRecordOf` and related editor fields remain original |
| Identity kind, sealed flag, and predicate changes | Earlier public reader observations remain original |
| Function alias changes | Earlier signature help remains original |
| Tagged membership changes | Earlier semantic classifications remain original |
| Definition removal and restoration | Earlier queries remain valid; current checks follow current source |
| Failed configuration update and recovery | Retained results stay original; recovery behavior remains |
| Interface-span-only edit and unrelated edit | Existing invalidation and unchanged-module counts remain |
| Interleaved retained-revision queries | Query order cannot change results |
| Finalizer lowering after a later update | Lazy function interning remains valid and independently checked |
| Rotating edits across independent modules | Reachable table count remains bounded by current cached modules plus one |

Each test will run in under one second.
The executor will split cases by behavior.
Tests must assert IR and validation, because emitted text alone misses NBF2.
Editor assertions will compare public results with a fresh program for the original source.
Numeric reference order must not become an expected semantic result.
The retention case will use current `Revision.types` and each current `checkedModule(name).declarations.env.table`.
The test will discard earlier revision handles before counting distinct table identities.
Several complete edit sweeps must respect the same structural bound.
The test must also preserve checked-module identity on unrelated edits.

Focused verification:

~~~sh
deno test --allow-read tests/revision_isolation_test.ts tests/db_test.ts tests/output_characterization_test.ts tests/core_boundary_test.ts
deno test --allow-read tests/editor_queries_test.ts tests/editor_test.ts tests/signature_help_test.ts tests/inferred_editor_test.ts tests/validate_test.ts
deno task check
~~~

Expected: all tests pass.
The retained-revision probe below must show zero validation errors, equal IR, and an unchanged earlier reader.
Emitted bytes stay equal.
The current revision also equals a fresh current check.
The shared fixture check prints nothing.

The coordinator will measure the baseline and candidate with the existing harness.
The initial small pipeline check is:

~~~sh
deno test --allow-all tests/bench_lsp_slow_test.ts
~~~

After that check passes, both revisions will run the same workloads:

~~~sh
deno task bench --quick m1 m3 m4
deno task bench --full m1 m3 m4
~~~

Only the profile changes when scale increases.
The baseline uses NB2; the candidate includes NB3 source.
Sequential exports of committed revisions can supply both checkouts without branches.
The coordinator will record SHAs, commands, runtime, row values, and comparison here.
Optional raw artifacts belong in gitignored `demos/`.
Benchmark runs must not overlap gates, captures, or other benchmarks.

M1, the diagnostic-latency measurement, must retain the existing large-input p90 limit of 100 ms.
A noise floor is the observed variation between paired runs of the same build.
Differences below a measured row's noise floor are inconclusive.
M3, the incremental-work measurement, must retain existing check, lowering, and emit counts for the same steps.
M4, the memory measurement, must run with both saved-output settings, as the existing task already does.
M4 has no adopted numerical memory budget.
The coordinator must report measured storage cost and inspect growth across edit counts.

The normal M4 profile rotates only three documents.
That profile cannot establish the cost when many cached modules retain different tables.
The coordinator will therefore run this additional bounded measurement through existing public benchmark functions:

~~~sh
NB_BENCH_SIZE=small deno eval --check '
import { runM4 } from "./bench/m4.ts";
import { loadInput } from "./bench/lsp_script.ts";
const size = Deno.env.get("NB_BENCH_SIZE");
if (size !== "small" && size !== "medium" && size !== "large") {
  throw Error("NB_BENCH_SIZE must name an existing size");
}
const input = loadInput(size, 1);
const count = [...input.files.keys()].filter(path => path.endsWith(".eff")).length;
for (const writeOnSave of [false, true]) {
  const result = await runM4({
    seed: 1,
    size,
    openDocuments: count,
    stepCounts: [count, 2 * count, 4 * count],
    timeoutMs: 60000,
    writeOnSave
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  console.log(JSON.stringify(result.value));
}
'
~~~

The small run must first complete the full measurement pipeline in under one minute.
The coordinator will then repeat the identical command with only `NB_BENCH_SIZE` changed to `medium` and `large`.
Each size must run on both the NB2 baseline and NB3 candidate.
The measured document count and per-document edit counts must prove that every source module received edits.
The output must contain successful runs for both saved-output settings.
The coordinator will compare initial, peak, and final heap and RSS samples at each complete sweep.
Counts and memory values must come from the output, rather than a prediction.
This check adds no production harness file.

A sustained new growth trend requires investigation before acceptance.
No guessed percentage can replace measurement.
The coordinator will also inspect ownership for discarded revisions.
No new parent link or revision-history collection may retain definition maps.
Current cached module environments and caller-retained objects may retain old maps.
The table census checks the first retention path without relying on garbage collection.
It does not measure bytes or prove garbage-collection timing.
If copying misses the latency limit, NB3 stays open pending a revised design and review.

Cross-revision capture needs the same existing tests on both sides.
New regression tests cannot run against broken source as a parity oracle.
After the gate passes and the source unit has its local commit, the coordinator will create this temporary comparison commit:

~~~sh
NB_CAPTURE_SCRATCH=$(mktemp -d)
GIT_INDEX_FILE="$NB_CAPTURE_SCRATCH/index" git read-tree HEAD
GIT_INDEX_FILE="$NB_CAPTURE_SCRATCH/index" git rm -r -q -f --cached tests
GIT_INDEX_FILE="$NB_CAPTURE_SCRATCH/index" git read-tree --prefix=tests/ "$NB_CAPTURE_BASE:tests"
NB_PARITY_TREE=$(GIT_INDEX_FILE="$NB_CAPTURE_SCRATCH/index" git write-tree)
NB_PARITY_HEAD=$(git commit-tree "$NB_PARITY_TREE" -p HEAD -m "Temporary comparison with unchanged tests")
deno task behavior:capture "$NB_CAPTURE_BASE" "$NB_PARITY_HEAD"
rm -r "$NB_CAPTURE_SCRATCH"
~~~

The temporary commit does not move `main` or change the working tree.
Expected: zero new and zero missing records for the unchanged corpus.
The coordinator will inspect every difference.
Capture guidance documents occasional clean-program variance; a rerun must resolve that variance before acceptance.
No missing record receives an automatic waiver.
The new regression suite separately proves the NBF2 correction.
Capture does not replace those assertions or committed surface fixtures.

### NB4: document the final base and close the reset

Owner: main coordinator, configured model and effort.
Budget: one turn, at most 18 tool calls.
Write scope: `CONCEPTS.md`, `docs/architecture.md`, `docs/api.md`, `docs/status.md`, `docs/development.md`, `CHANGELOG.md`, the plan registry, and this plan.
Dependency: NB0 through NB3.

The coordinator will update only statements affected by this reset.
The type-table term will distinguish shared nodes from definitions retained by a revision.
The API guide will state that retained queries use original definitions.
The development guide will name the delayed-query regression test and the path-component guard.
The changelog will record the repairs without claiming a release.
The status guide will link the completed reset and preserve deferrals and manual acceptance items.

The coordinator will inspect `../effektive/public/effektive-spec.html` for affected claims.
This reset changes no source form or wire version.
The plan therefore expects no website edit.
If a source example or specification statement becomes false, closure stops for a scoped amendment.
An authorized website change requires compiler checks, strict TypeScript-panel checks, and a separate repository commit.
Implementation must not silently expand into website work.

Findings, design, validation, and execution evidence stay in this document.
No separate findings report will become another authority.
At implementation completion, the coordinator will move this document to `docs/archive/plans/2026-10-30-reset-base.md`.
The registry and status links will change in the same closure commit.
This planning task leaves the proposed plan at its current path.

Verification:

~~~sh
deno test --allow-read tests/docs_test.ts tests/versions_test.ts
deno task check
git diff --exit-code fd20ff599fdfb43d1df20d4dbbaf7141536dd411 -- fixtures src/core/ir.ts src/cli/target_lock.json tests/application_lock.json deno.lock
git status --short
git -C ../effektive status --short
~~~

Expected: tests pass, preserved artifacts have no differences, and changed files belong to phase scopes.
The website stays unchanged unless an amendment explicitly allowed edits.
The final review will check every preservation row against evidence.
Manual editor and playground acceptance remain with the user.
Neither item becomes an automatic completion claim.

## Reproduction commands

These commands use in-memory programs and create no reproduction file.
The path command performs no deletion.

The retained-revision reproduction is:

~~~sh
deno eval '
import { Program, serializeModule } from "./src/core/frontend.ts";
import { TypeScriptOutputs } from "./src/core/typescript.ts";
const first = "type N = int\ntype A = { n: N }\ntype B = { b: N }\ntype U = A | B\nexport const f = (x: N): A => ({ n: x })\n";
const second = first.replaceAll("n: N", "changed: N").replace("n: x", "changed: x");
const files = { "effektive.json": "{}", "m.eff": first };
const coldResult = new Program().update({ set: files });
const program = new Program();
const retainedResult = program.update({ set: files });
if (!coldResult.ok || !retainedResult.ok) throw Error("config");
const cold = coldResult.value;
const retained = retainedResult.value;
const id = retained.checkedModule("m")!.declarations.types.find(t => t.name === "A")!.id;
const before = retained.types.taggedRecordOf(id);
const edit = program.update({ set: { "m.eff": second } });
if (!edit.ok) throw Error("config");
const a = cold.lowered("m");
const b = retained.lowered("m");
if (a === undefined || b === undefined || !a.ok || !b.ok) throw Error("lowering");
const outputs = new TypeScriptOutputs();
const x = outputs.emitted(cold, "m");
const y = outputs.emitted(retained, "m");
const coldIr = serializeModule(a.value);
const retainedIr = serializeModule(b.value);
if (!coldIr.ok || !retainedIr.ok) throw Error("serialization");
console.log({
  diagnostics: [cold.diagnostics.length, retained.diagnostics.length, edit.value.diagnostics.length],
  coldValidation: [...cold.validate(new Map([["m", a]]))].flatMap(([, ds]) => ds).length,
  retainedValidation: [...retained.validate(new Map([["m", b]]))].flatMap(([, ds]) => ds).length,
  irEqual: coldIr.value === retainedIr.value,
  emittedBytesEqual: x?.ok && y?.ok && x.value.text === y.value.text,
  readerChanged: before !== retained.types.taggedRecordOf(id)
});
'
~~~

Before NB3, the measured result is:

~~~text
diagnostics: [0, 0, 0]
coldValidation: 0
retainedValidation: 3
irEqual: false
emittedBytesEqual: true
readerChanged: true
~~~

After NB3, expected values are `[0, 0, 0]`, `0`, `0`, `true`, `true`, and `false`, respectively.
Throws in the probe assert unexpected setup failures.
They do not propose exceptions for expected compiler failures.
The implementation review corrected this probe to compare serialized text values.
The original draft compared two `Result` objects by identity, so its IR comparison alone was not evidence.
The independent validation failure and definition-reader change still established the baseline defect.
The regression tests compare serialization results by deep value equality.

The path reproduction is:

~~~sh
deno eval '
import { isUnsafe, REPOSITORY_ROOT } from "./playground/build.ts";
import { join } from "@std/path";
for (const name of ["src", "..scratch", "..", "playground/dist"]) {
  console.log(name, isUnsafe(join(REPOSITORY_ROOT, name)));
}
'
~~~

Before NB1, measured values are `true`, `false`, `true`, and `false`.
After NB1, expected values are `true`, `true`, `true`, and `false`.

## Stop conditions

The coordinator will stop the affected phase under these conditions:

- A preservation check changes an unrelated diagnostic, IR value, emitted byte, protocol event, or public signature.
- A fixture generator appears necessary to pass a reset check.
- A fork changes reference identity, default definitions, or canonical union ordering.
- A definition-sensitive cache requires ownership changes outside the specified scope.
- The design requires eager lowering, broad cache invalidation, or retained table history.
- A measurement misses the latency limit or reveals unexplained memory growth.
- A required command fails twice for the same unresolved cause.
- A command expected to exceed two minutes lacks required permission.
- New evidence requires edits outside the phase scope.

A failing completed source commit requires a corrective commit or reverting commit.
The coordinator will not rewrite history to hide a failed gate.
The coordinator will update this authority before restarting changed work.

## Completion criteria

Implementation finishes only when every phase passes its exact verification.
The full gate must pass at the final revision.
Delayed-query tests must prove original-revision behavior through public APIs.
The existing corpus must retain captured behavior and surface observations.
The path guard must reject the reproduced repository-child case.
Current guides must describe the final state.
The registry must identify this single reset authority.

There is no speedup, line-count, or memory-reduction target.
The reset succeeds when both remaining code gaps close and the baseline stays green.
Deferred features and manual acceptance stay outside completion.

## Independent validation

Codex Astra, `gpt-6-astra`, completed one validation turn with `xhigh` reasoning on 2026-10-30.
Its verdict was ready after one material amendment.
The validator inspected source and ran a public-API probe.
It changed no files and ran no gate, capture, benchmark, generator, or deletion probe.

| Review finding | Condition and effect | Final disposition |
| --- | --- | --- |
| Medium: retained module ownership | Reused `CheckedModule.declarations.env.table` keeps an older table after its revision handle disappears. The initial draft understated memory retention. | Corrected the ownership contract, preserved checked-module identity, specified the table-count bound, and added a public census plus all-module measurements. |
| Low: source references | Two draft line ranges did not identify the cited revision methods. | Corrected the ranges to `db.ts:180-182` and `db.ts:266-274`. |

The main agent independently inspected the retained environment and existing identity assertions.
The validator confirmed that shared interned storage and separate definition maps fit current code.
The validator also confirmed the temporary-index procedure and current task interfaces.
The six user-supplied risks remain observations without remediation tasks.
The main agent reconciled both findings in this document.
Implementation measurements remain mandatory; validation does not establish their outcome.

### Planning document checks

The final focused command was `deno test --allow-read tests/docs_test.ts tests/versions_test.ts`.
It passed all 17 tests with zero failures.
The document's referenced existing file paths and task interfaces were checked.
Proposed test files, example output paths, and the future archive path are identified as such.
The shell interface and benchmark exports for the additional memory command were inspected.
That measurement command remains unexecuted until implementation.

Another workspace actor committed an earlier draft of this document as `26d4fc6` during planning.
The main agent did not create that commit or alter its history.
At planning completion, this agent had changed only the plan document.
The LFG implementation began later.
Its changes and checks appear in the execution ledger.

## Execution ledger

### Comparison checkpoint

The source repair is commit `e44a6802ddf7200b586feea68d8bc8079dbefe94`.
Its comparison baseline is `650cd813408e943fa3aee21f518d8f02afb36d79`.
Both benchmarks use committed exports and run serially.
The small benchmark pipeline passed eight tests in 4.935 seconds.

Quick baseline and candidate runs completed in 52.799 and 61.020 seconds, respectively.
Their M3 rows match exactly.
Candidate large-input p90 values are 17.743, 70.045, 68.977, and 66.108 ms for body, header, alias, and mode-flip edits.
Those quick values satisfy the 100 ms limit.
They do not replace the full measurements.

The full baseline and candidate completed in 666.346 and 855.392 seconds, respectively.
Their M3 rows match exactly, including every step count and interface or mode change.
All candidate large-input p90 values satisfy the 100 ms limit.
Median differences remain within the larger measured noise floor of each pair.
The sequential runs do not establish a speedup.

| Large edit | Baseline p90, ms | Candidate p90, ms | Baseline floor, percent | Candidate floor, percent |
| --- | --- | --- | --- | --- |
| Body | 15.146 | 12.886 | 23.0 | 9.2 |
| Header | 71.339 | 65.819 | 11.0 | 7.8 |
| Alias | 68.843 | 63.194 | 11.8 | 7.7 |
| Mode flip | 148.572 | 65.800 | 28.3 | 12.5 |

The baseline mode-flip spike precedes the revision repair.
Its cause remains unconfirmed.
The candidate run satisfies the latency limit without changing the measurement workload.
The higher total candidate runtime remains an observation, rather than evidence of equal throughput.
The plan adopts no benchmark wall-time budget.

The tables below give final heap samples for the two server processes, A and B.
MiB means 1,048,576 bytes.
The harness samples after steps and does not force garbage collection.

| Saved output | Edits per server | Baseline heap A/B, MiB | Candidate heap A/B, MiB |
| --- | --- | --- | --- |
| Off | 200 | 49.587 / 42.454 | 35.701 / 37.454 |
| Off | 500 | 58.169 / 61.918 | 46.931 / 44.886 |
| Off | 1,000 | 48.942 / 73.232 | 56.760 / 46.590 |
| Off | 10,000 | 38.496 / 90.882 | 50.083 / 47.708 |
| On | 200 | 43.192 / 71.915 | 66.717 / 78.417 |
| On | 500 | 67.211 / 35.503 | 56.983 / 41.321 |
| On | 1,000 | 63.188 / 88.471 | 105.487 / 103.882 |
| On | 10,000 | 53.935 / 53.780 | 93.960 / 67.501 |

Every row ends with 99 interned types per server on both builds.
The candidate heap samples do not increase from 1,000 to 10,000 saved edits.
The source review found no parent link or table-history collection.
Cached module environments retain their last-check tables, as the public census proves.
These observations do not establish a bound in bytes or garbage-collection timing.

The all-module runs cover 3, 7, and 52 source modules.
Every module received edits on both servers and both saved-output settings.
The small baseline and candidate pipelines completed in 4.137 and 4.076 seconds before scaling.
Only the size parameter changed for the medium and large runs.

| Modules | Saved output | Last row: edits per server | Baseline final heap A/B, MiB | Candidate final heap A/B, MiB |
| --- | --- | --- | --- | --- |
| 3 | Off | 12 | 14.717 / 14.701 | 14.739 / 14.740 |
| 3 | On | 12 | 19.854 / 19.665 | 19.853 / 19.633 |
| 7 | Off | 28 | 31.236 / 31.256 | 31.326 / 31.286 |
| 7 | On | 28 | 68.722 / 61.349 | 68.851 / 61.270 |
| 52 | Off | 208 | 119.215 / 133.547 | 119.278 / 182.998 |
| 52 | On | 208 | 202.499 / 192.697 | 128.315 / 313.730 |

RSS is the memory that a process currently holds in RAM.
Across the large all-module rows, peak RSS reached 625.562 MiB in the baseline and 714.328 MiB in the candidate.
The paired samples vary; the wider case does not show a consistent increasing heap trend on both candidate servers.
No memory budget exists, and these samples do not prove memory parity or a memory saving.
The coordinator accepted the structural ownership check and measured cost under those limits.

Raw commands, samples, and execution records stay in gitignored `demos/`.
The unchanged-corpus capture compares `650cd81` with temporary commit `3103d97486e43db4ec1fe1e60c5b95ba6dbc178f`.
That commit holds source `e44a680` and the baseline tests without moving `main`.
Capture passed in 416.912 seconds: 12,849 records per side, zero new, and zero missing.
No variance waiver or fixture update was required.

| Phase | State | Entry SHA | Commit and evidence |
| --- | --- | --- | --- |
| NB0: restore baseline | Done | `26d4fc6` | Commit `fa0d244`. Registry added. Focused documentation/version checks: 17 passed. Full gate: exit 0 in 46.934 s, including 282 slow tests. Source, tests, fixtures, and configuration equal the reviewed source. |
| NB1: path boundary | Done | `fa0d244` | Commit `16c87b6`. Existing guard test failed on `..scratch` before the fix. Both guard tests and the external build test pass. Full gate: exit 0 in 54.532 s, including 282 slow tests. Fixtures unchanged. |
| NB2: table fork | Done | `fa0d244` | Commit `650cd81`. Sol added the fork and three public-method tests. The red run failed only because `fork` was absent. Main reviewed every changed line and passed 296 focused tests. Full gate: exit 0 in 54.671 s, with 2,872 fast and 282 slow tests. No production fork caller or fixture change. |
| NB3: revision ownership | Done | `650cd81` | Commit `e44a680`. Main reviewed the three changed files and 12 public regression cases. The red test had three `validation/002` errors. Main passed 40 revision tests, 204 editor/validator tests, and the full gate in 80.539 s: 2,884 fast and 282 slow tests. All planned measurements passed their stated checks. Capture: 12,849 records per side, zero new or missing. Corrected probe and fixture checks pass. |
| NB4: final documents | Done | `e44a680` | Glossary, API, development, status, and changelog updated. The plan and registry move to the archive together. Focused checks: 17 passed. Full gate: exit 0 in 69.128 s, with 2,884 fast and 282 slow tests. Fixtures, IR, and locks unchanged. The website specification has no revision-storage contract; no source form or wire type changed. Website unchanged. |

Next owner: the main coordinator will run the remaining LFG quality and delivery checks.
