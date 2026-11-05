# Codebase reset plan

This document is the sole plan authority for the reset review of 2026-11-05.
The detailed findings, execution phases, review results, and work record belong here.
The original review baseline is `a3504d4e9c682ca12b01758c5ffca7eb148d5a9b` on local `main`.
The preservation baseline is `05bdc3c783fcd52d7e450e5f00d150b35ec73050`, which the user confirmed after the review.

The reset retains the compiler pipeline and every supported source form.
Two public probes reproduce product defects: incomplete workspace reads delete generated outputs, and composite forwarding receives a false service diagnostic.
The plan repairs those defects, strengthens evidence accounting, and removes duplicated editor-action mechanics.
It does not authorize a general rewrite.

Status: the plan is complete; the newly authorized implementation run is active.
Codex Astra at xhigh effort accepted the plan before execution.
The user's explicit plan-only limit governed the first `compound-engineering:lfg` invocation.
The main agent continued beyond that limit; the existing changes are recorded below and remain preserved.
After the final planning report, the user invoked `compound-engineering:lfg` again to continue this reset.
That later instruction authorizes implementation and review of the existing patches.
The existing patches still require their stated acceptance checks.

## Scope and constraints

The reset must preserve current functionality and accepted source contracts.
The reset can change code structure only when evidence supports correctness, simpler maintenance, or stronger tests.
New language features, dependency upgrades, release work, and unrelated cleanup are outside this reset.

The completed planning request allowed changes only to this document.
The later implementation request authorizes the owned files and verification listed in the reset phases.
The future implementation must register this plan before its first source change.
The reserved prefix is `RCP`, which means reset correctness plan.
Each identifier will state its meaning where it first appears.

## Review orchestration

The main agent owns this document, source confirmation, measurement, integration, and final verification.
Each scout has read-only access and cannot delegate or edit files.
Each budget counts agent turns, including tool turns.
An agent must return its evidence and open questions when its budget ends.

| Unit | Model and effort | Files and responsibility | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| Compiler review | `gpt-5.6-sol`, high | `src/core/`, compiler tests, relevant architecture decisions | Confirm narrow correctness and simplification findings with exact source locations | 18 |
| Boundary and test review | `gpt-5.6-sol`, high | `src/host/`, `src/cli/`, `src/lsp/`, `scripts/`, adapter tests, playground, editor configuration | Confirm preservation risks and gaps in test or coverage enforcement | 18 |
| Plan validation | `gpt-6-astra`, xhigh | This document and cited source or tests | Challenge phase scope, evidence, compatibility, oracles, commands, and stop conditions | 18 |

The two scouts will work independently.
The main agent will validate their findings against current source.
The main agent will complete the draft before requesting Astra validation.
The validation result and its disposition will remain in this document.

## Work record

The initial working tree was clean.
The checkout uses Deno 2.9.8 and package version 0.15.1.
The earlier reset and repair plans are archived.
Current source and current commands take precedence over historical notes.
Both scouts completed read-only reviews.
The main agent confirmed retained findings against source and reproduced both product defects through public APIs.
Astra independently reproduced both defects and accepted the reconciled plan.
The initial planning pass changed only this document and created no commit.
The implementation intake found one later commit, `05bdc3c`, which converts imported types on first lookup.
That change remains in scope as preserved baseline behavior; the reset must not revert its lazy conversion.
The plan remains implementation-ready after the source comparison.
The main agent incorrectly treated the LFG invocation as implementation authorization.
That interpretation did not preserve the explicit stop condition.
The main agent stopped source edits, verification pipelines, and commits at the planning handoff.
The later LFG invocation resumes those operations within the accepted reset scope.
The explicit repository rules for local `main`, local commits, and no push remain in force.

## Findings review

### Baseline and evidence limits

The findings below describe the original review snapshot and its tests.
Source locations refer to that snapshot unless the section identifies a later probe.
Historical results identify relevant checks but do not establish the current baseline.
Commit `05bdc3c` changes only imported-value type conversion in `src/core/check_project.ts`.
The change retains IR types until the checker reads each imported value.
The reset must preserve that conversion behavior when it repairs provenance in the same file.
The recorded comparison found no fixture behavior differences between `a3504d4` and `05bdc3c`.
That comparison does not establish performance or cover every program.

| Check | Observed result | Scope |
| --- | --- | --- |
| `deno --version` | Deno 2.9.8 | Local macOS arm64 environment |
| `deno fmt --check` | Pass, 580 files | Configured format scope |
| `deno lint` | Pass, 487 files | Configured lint scope |
| `deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts'` | Pass | Configured TypeScript inputs |
| `deno task test` | 2,855 pass, one failure | Fast suite; test report: three seconds; command wall time: 4.73 seconds |
| `deno test --allow-read tests/docs_test.ts --filter 'the newest versioned heading'` | Fail: 0.15.0 differs from 0.15.1 | Independent confirmation of the baseline failure |
| `deno task check` | Not run as a combined command | Its fast suite has a confirmed failure |
| Slow suite, coverage, mutation, behavior comparison | Not run during planning | These commands create artifacts or require the failed baseline to pass |

The review does not establish current coverage percentages, slow-test results, mutation strength, browser acceptance, or installed-editor acceptance.
The configured coverage floors are 97% lines, 95% branches, and 99% functions.
These floors are requirements, not current measurements.
Native Windows behavior and concurrent filesystem replacement remain unmeasured.

### Structural measurements

`deno task measure src/core/diagnostic_delta.ts` validated the measurement pipeline first.
The pilot reported 74 code lines and 12 branch sites.
The same command then measured every TypeScript file in the listed directories.
Only the input file set changed.

The existing script counts nonblank lines except lines that start with `//`.
Block comments therefore remain in its line count.
Branch sites follow `scripts/measure_kernel.ts`, including short circuits, optional access, and early returns within branches.
The measurements compare revisions under this definition; they do not measure semantic complexity directly.

| Directory | TypeScript files | Code lines | Branch sites | Import declarations |
| --- | ---: | ---: | ---: | ---: |
| `src/core/` | 107 | 42,236 | 10,603 | 606 |
| `src/host/` | 8 | 1,073 | 217 | 23 |
| `src/cli/` | 8 | 932 | 148 | 33 |
| `src/lsp/` | 9 | 2,728 | 501 | 38 |
| `playground/src/` | 8 | 1,778 | 255 | 32 |
| `scripts/` | 19 | 4,767 | 923 | 40 |
| `bench/` | 18 | 4,613 | 698 | 82 |
| Total | 177 | 58,127 | 13,345 | 854 |

The test tree contains 265 test files, including 62 slow test files.
The total does not establish coverage for any individual module.

The next table uses `deno task measure:functions` for the largest measured function in each file.
This script counts each function's own body and includes class methods.
The file script's `maxCyclo` omits class methods and includes nested functions in its top-level counts.
Those two fields are not interchangeable.
Cyclomatic complexity means one plus the script's decision count.

Incoming imports count relative literal references within the 177 measured files.
The count includes type imports and excludes test consumers.
It is an inventory, not a complete dependency graph.

| File | Code lines | Branch sites | Largest own function complexity | Imports out | Imports in |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src/core/check_expr.ts` | 2,881 | 776 | 44 | 30 | 2 |
| `src/core/check_project.ts` | 990 | 197 | 25 | 23 | 7 |
| `src/core/types.ts` | 1,366 | 543 | 110 | 6 | 27 |
| `src/core/db.ts` | 411 | 61 | 16 | 17 | 12 |
| `src/core/infer_inputs.ts` | 634 | 215 | 22 | 13 | 2 |
| `src/core/infer_contracts.ts` | 332 | 85 | 14 | 4 | 1 |
| `src/core/validate/typing.ts` | 904 | 494 | 109 | 5 | 11 |
| `src/core/validate/expr.ts` | 1,960 | 516 | 66 | 16 | 1 |
| `src/core/emit/expr.ts` | 1,736 | 465 | 49 | 19 | 1 |
| `src/core/lower.ts` | 1,680 | 284 | 28 | 16 | 7 |
| `src/host/outputs.ts` | 231 | 51 | 23 | 4 | 1 |
| `src/host/save_round.ts` | 78 | 8 | 6 | 5 | 2 |
| `src/lsp/jsonrpc.ts` | 301 | 64 | 16 | 1 | 5 |
| `src/lsp/server.ts` | 422 | 57 | 10 | 7 | 4 |
| `scripts/mutate.ts` | 697 | 158 | 22 | 3 | 0 |
| `scripts/coverage.ts` | 251 | 37 | 12 | 1 | 0 |

Per-file coverage and per-module test runtimes need measurement after the baseline repair.
No projected line saving, speed improvement, or coverage increase is assumed.

### First-principles design

The compiler must classify source, publish closed contracts, preserve execution order, and generate target code with matching behavior.
Incremental compilation must produce the same observable results as fresh compilation.
Retained revisions must keep their earlier definitions and query results.
Expected input and filesystem failures must remain explicit result values.

The existing architecture already separates source analysis, checking, typed intermediate representation, and TypeScript emission.
The intermediate representation is the checked contract between those stages.
The independent validator recomputes semantics in tests.
The adapters own filesystem access, subprocesses, protocol messages, and browser events.
These boundaries support the reset and will remain.

The reset will simplify responsibilities inside those boundaries.
A new abstraction must remove repeated policy, prevent an invalid state, or remove a proved failure path.
Moving code into another file does not establish simplification.
Lower branch counts cannot justify weaker diagnostics, less precise contracts, or fewer supported programs.

### Confirmed baseline failure

`RCP-F1` means restore the version-consistency gate.
`deno.json:3` declares version 0.15.1, but `CHANGELOG.md:14` starts the latest versioned section at 0.15.0.
`tests/docs_test.ts:135-147` rejects that mismatch.
The fast suite therefore fails before the reset starts.

The repair must reconcile the changelog with the existing release commit.
The repair must not downgrade the package or publish a release.
The current `Unreleased` entries require inspection against the release diff before their placement changes.
This finding has high confidence and low implementation risk.
The repair is a prerequisite for every later phase.

### Ranked findings

The following table lists every retained finding.
The priority reflects prerequisites, observed effects, and repair risk.
Structural findings describe missing guarantees or duplicated policy; they do not claim a demonstrated product failure.

| Identifier and meaning | Kind | Evidence | Impact | Effort and risk |
| --- | --- | --- | --- | --- |
| `RCP-F1`: restore version consistency | Observed gate failure | `deno.json:3`; `CHANGELOG.md:14`; `tests/docs_test.ts:135-147` | The normal gate cannot pass | Small; low |
| `RCP-F2`: reject incomplete workspace snapshots | Observed correctness defect | `src/host/workspace.ts:28-34,110-117`; `src/cli/session.ts:89-113`; `src/host/save_round.ts:72-80` | A transient inspection failure deletes valid generated outputs | Medium; medium |
| `RCP-F3`: preserve input provenance through composite values | Observed correctness defect | `src/core/check_project.ts:655-797,838-848`; `tests/service_imports_test.ts:533-584` | Equivalent forwarding expressions receive different service diagnostics | Medium; medium |
| `RCP-F4`: account for coverage inputs | Structural gap in verification | `scripts/coverage.ts:98-126,264-282`; `tests/coverage_test.ts:111-116` | An omitted runtime module has no completeness check | Medium; low |
| `RCP-F5`: classify timeout evidence before acceptance | Documented oracle limit | `scripts/mutate.ts:18-22,727-769`; `docs/status.md:63` | Exit zero alone does not explain a timeout | Small; low |
| `RCP-F6`: use platform paths for LSP discovery | Source-confirmed platform defect | `src/lsp/positions.ts:87-99`; `src/lsp/projects.ts:184-196,528-539` | Windows paths cannot reach the expected project root | Medium; medium; native acceptance pending |
| `RCP-F7`: share contract-action mechanics | Structural duplication | `src/core/editor_actions.ts:82-225,235-295` | Two actions separately parse headers and compile speculative edits | Small to medium; low to medium |

All retained findings have high confidence within their stated evidence scope.
Effort describes relative scope; it is not a duration estimate.

### RCP-F2: reject incomplete workspace snapshots

`readWorkspace` catches a directory-resolution exception and silently omits the directory.
The function returns success with the remaining files.
`Session.read` treats the resulting file map as a complete snapshot.
The save round removes outputs for modules absent from that snapshot.

The main agent reproduced this sequence through the public CLI function `main` and the existing in-memory filesystem.
The initial project held `/proj/effektive.json` and `/proj/sub/a.eff`.
The first watch round wrote `sub/a.ts` and `sub/a.ts.map`.
The next event changed no source file.
One call to `absolute("/proj/sub")` then threw `permission denied`.
Later inspections succeeded.

The command returned zero and reported zero diagnostics.
The source still existed, but both generated files were absent.
The recorded messages included `removed: sub/a.ts.map` and `removed: sub/a.ts`.
This reproduction used memory only and changed no repository files.

`tests/workspace_test.ts:181-194` currently expects successful omission after a resolution exception.
That assertion protects the defective behavior and must change with the repair.
The tests for cycles, repeated directory links, and links outside the root remain valid.

The new invariant is simple: a failed required inspection cannot publish a complete workspace snapshot.
The implementation must return an error before it updates known inputs or performs output cleanup.
The implementation must preserve the previous revision and generated files until a complete read succeeds.
Confirmed disappearance during a file read retains the documented skip behavior.

`HostFs.kind` also maps every `stat` failure to `missing` in `src/host/deno_io.ts:71-76`.
That port cannot distinguish absence from inspection failure.
The directory listing calls that method for symlink targets at `src/host/deno_io.ts:81-85`.
A failed target inspection therefore reports a directory link as a non-directory entry.
A link name without a source extension can then leave the workspace snapshot silently.
This route is confirmed by source inspection; the review did not run a native permission-failure probe.
The reset must close this route through the existing result of `list`, while preserving documented cycle behavior.
No separate ownership failure was reproduced during this review.
The snapshot phase must add the ownership probe before changing that contract.
A broad filesystem-port migration is not authorized without that evidence.

### RCP-F3: preserve input provenance through composite values

The accepted service rule excludes requirements that occur only in input types.
`transferredRequirements` instead classifies each complete expression as input-only or locally produced.
The input-only check recognizes direct inputs, aliases, fields, block results, and reference reads.
The check does not decompose reconstructed records, tuples, or lists.
The fallback collects requirements from the complete expression type.

The main agent reproduced the following three cases through `checkProject(memoryHost(...))`.
The project configuration was `{}`.
The shared service file was:

```eff
export type Int = int
export service Users { read(): Int }
export service Allowed { publish(input: { job: Effect<Int, never, Users.read> }): void }
```

Each main module used this header and function signature:

```eff
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (input: { job: Effect<Int, never, Users.read> }): void => EXPRESSION
```

| Expression replacing `EXPRESSION` | Current diagnostics | Required result |
| --- | --- | --- |
| `Allowed.publish(input)` | None | None |
| `Allowed.publish({ job: input.job })` | `requirement-contract/002` for `Users.read` | None |
| `Allowed.publish({ job: defer(() => Users.read()) })` | `requirement-contract/002` for `Users.read` | Keep the rejection |

The repair needs provenance at component boundaries, not a larger list of whole-expression exceptions.
Provenance means the origin of a value: an input, a local producer, or an unresolved origin.
The analysis must follow aliases and component selection while retaining every locally introduced dependency.
Mixed values must retain local dependencies even when another component comes from an input.

One small module will own deferred-value provenance and produced requirements.
The module will consume checked facts, resolution, syntax queries, and the revision's type table.
The module will return requirement data; module scheduling will own diagnostics and service bounds.
The module must not import the project driver, emitter, or validator.
The repair must remove the replaced whole-expression walk after equivalent coverage exists.

The implementation must not subtract all capabilities found in parameter types.
That subtraction would hide a newly produced dependency that happens to share an input capability.
The implementation must preserve provision, reference updates, recursive origins, and reserved Effect capabilities.

### RCP-F4: account for coverage inputs

The coverage command delegates percentage floors to Deno.
The review found no observed bypass of those floors.
The command checks for an `SF:` record but never compares reported files with required runtime modules.
The summary parser also permits duplicate file records and incomplete counters.
An empty summary reports 100%, although the command separately rejects output without `SF:`.

The reset needs an explicit owner for each file category.
Runtime modules require complete report records.
Type-only modules require the strict type check.
Process entry points require subprocess tests, including coverage when Deno supplies it.
Browser startup and the VS Code client require their existing browser, VM, or installed-editor checks.

The implementation must distinguish a pure display parser from the gate that accepts a complete coverage report.
The gate must reject missing required modules, duplicate records, malformed counters, and counters that exceed their totals.
A valid module with zero branches must remain valid.
Exclusions must name their reason and their verification owner.
The reset must not add empty imports only to improve the report.

### RCP-F5: classify timeout evidence before acceptance

The mutation command partitions outcomes into killed mutants, survivors, timeouts, and infrastructure failures.
Its exit status checks only unregistered survivors and stale register rows after infrastructure checks.
Timeouts appear in the report but do not prevent exit zero.
The current status document records one timeout in an earlier measurement.
This review did not rerun mutation or classify that historical timeout.

The existing policy intentionally counts timeout as a kill.
The solution note `docs/solutions/workflow-issues/mutation-equivalent-rows-need-a-differential-probe.md` requires an isolated rerun before acceptance.
The reset will preserve the command's exit semantics and enforce that evidence rule at phase acceptance.
An unexplained timeout must prevent a phase from closing.
An isolated rerun can establish a deterministic nontermination fault or expose infrastructure trouble.
The report must retain that distinction and the exact command.
A timeout must never become an equivalent survivor by default.

### RCP-F6: use platform paths for LSP discovery

`uriToPath` uses the platform implementation of `fromFileUrl`.
On Windows, the result uses backslashes.
`parentOf` searches only for `/` and returns `/` when it finds none.
`sourcePathUnder` also requires a `/` prefix.
The discovery loop therefore cannot find the intended Windows project.

The scout reproduced the parent calculation with `@std/path/windows`.
For `file:///C:/work/app/main.eff`, the path was `C:\work\app\main.eff` and the computed parent was `/`.
The main agent confirmed the cited source and its callers.
The review did not run a native Windows language server.

The repair will use platform path operations at the LSP adapter boundary.
The core will retain root-relative paths with `/` separators.
The repair must reject paths outside the root through component-aware containment.
Drive roots, UNC roots, encoded characters, and POSIX names need separate cases.
The repair must not globally replace backslashes in POSIX filenames.

The process harness has a separate path defect.
`bench/lsp_client.ts:22,107-108` builds executable paths from `URL.pathname`.
That property retains URI encoding and has the wrong drive-path form for native Windows execution.
The platform phase must use `fromFileUrl` and native joins in the launcher.
Project discovery must terminate when a path's parent equals the path, including drive and UNC roots without configuration files.

### RCP-F7: share contract-action mechanics

Both editor actions locate arrow headers and arrow tokens.
Both actions clone revision inputs, apply edits, construct a fresh `Program`, and recover the changed function.
`contractActionsAt` has measured own-function complexity 41.
`failsClauseActionsAt` has measured own-function complexity 28.

The action policies differ and must remain separate.
The repair action can permit caller contract gaps when the CLI requests that behavior.
The inferred-failure action must preserve exact failures, requirements, and mode.
Their titles, ranges, edit text, and public signatures remain unchanged.

The solution note `docs/solutions/logic-errors/editor-queries-must-read-project-diagnostics.md` records an earlier shared assumption about incomplete module diagnostics.
The current source has already repaired that defect through `diagnosticInside`.
The reset must retain that repair.

The refactor will extract one header view and one speculative-check result.
The helpers can remain private within `editor_actions.ts`.
No action framework or new exported API is needed.
The refactor must delete the duplicated mechanics that the helpers replace.

### Checked boundaries and rejected candidates

The core has enforced boundaries for host APIs, public entry points, and output imports.
The frontend does not load the emitter.
The emitter does not load checker code through value imports.
The independent validator remains outside product dependency graphs.
These boundaries have dedicated tests and will remain reset invariants.

The earlier reset already repaired host-order invalidation and separated input traversal from contract resolution.
The current `db.ts:118-124` retains configured host order in its cache key.
The reset will preserve that behavior and retained-revision tests.

The earlier simplification plan rejected a universal builtin registry and a size-only split of `check_expr.ts`.
It also retained the independent validator after an oracle comparison.
This review found no new evidence that justifies reversing those decisions.
The checker and validator must not share compatibility or proof logic.

The high complexity of assignability identifies a risk area, not an authorized rewrite.
The current type-law tests deliberately compare independent implementations.
Those tests remain, including their justified internal imports.
A future change needs a concrete defect or a measured simplification trial before it alters that relation.

CLI watch forgets a failed removal; the language server retries it.
The accepted save-round contract preserves this distinction.
The reset will retain partial-write recovery, disk versus overlay separation, output ownership, and source maps.
It will not merge the CLI and language-server sessions.

No dependency removal or public feature removal has sufficient evidence in this review.
Pruning is limited to replaced walks, duplicated action mechanics, obsolete helpers, and redundant tests proved unnecessary by stronger public checks.
No test can leave solely because the test uses an internal function or has a large fixture.

## Reset phases

### Rules shared by every phase

The future orchestrator will recheck the baseline, active checkout, dirty files, and this authority before implementation.
The implementation will use local `main` and preserve unrelated work.
Each complete unit will receive a separate local commit.
No phase authorizes a push, release, dependency upgrade, or source-language change.

The orchestrator will record each phase's starting commit as `RCP_PHASE_BASE` before edits.
After the phase passes its focused checks, the orchestrator will run `deno task check` before the source commit.
Mutation uses committed `HEAD`, so the source and regression tests must be committed before mutation starts.
The phase remains open until mutation and required comparisons finish.
Any repair receives a separate commit and repeats the relevant checks.

The executor will run a sub-minute pilot before scaling an unfamiliar pipeline.
Only the scale parameter can change after the pilot passes.
If a required script exceeds two minutes, the executor will pause under the repository rule and request authorization for that named command.
An elapsed-time estimate cannot replace measurement.

For a behavior-preserving compiler change, the exact comparison is:

```sh
deno task behavior:compare "$RCP_PHASE_BASE" HEAD --out "$RCP_EVIDENCE/behavior"
```

`RCP_EVIDENCE` is an executor-created temporary directory outside the repository.
The executor will record its actual path and the resolved commits here.
The comparison uses the current runner and the head corpus for both compilers.
It excludes inline test programs and adapter behavior.
Surface and integration tests must cover those boundaries.

For a pure refactor, changed, missing, and added record counts must all equal zero.
The current tool permits added records with exit zero, so the reviewer must inspect all eight summary rows.
For a defect repair, the reviewer will list allowed changes by case name before accepting differences.
No unrelated change to diagnostics, IR, target text, maps, or ordering is allowed.

Every production-logic phase requires `deno task coverage` after its source commit.
The aggregate floors remain 97% lines, 95% branches, and 99% functions.
The percentage scope remains `src/` and `playground/src/`.
Changed modules within that scope must retain measured coverage and cover each new success, rejection, and failure branch.
A new module needs the combined coverage report and directed mutation evidence.
Percentage floors alone do not establish test quality.
Scripts remain outside production percentage floors.
Script changes require their public command tests, directed fault cases, and mutation evidence.
The report must not claim a script coverage percentage from the production report.

The initial mutation pilot is:

```sh
deno task mutate --seed 1 --sample 1 PATH
```

`PATH` means the actual changed module path listed by the phase.
The final command replaces `1` with `all` and leaves the seed and module unchanged.
For a large existing module, `--only path:line` can select changed declarations after the executor records every selected site.
The evidence must include the complete site count, kills, survivors, timeouts, register matches, and chosen tests.
Zero selected sites do not establish mutation coverage.
An unsupported mutation operator requires a directed public fault probe.
Each timeout requires an isolated rerun with the same seed, tests, module, and exact `--only path:line` site.
A repeatable nontermination fault can count as a kill when the clean run completes and the changed operation explains the loop.
An unexplained timeout remains open even when the command exits zero.
Every new equivalent-survivor row needs a public differential probe and a written reason.

Mechanical refactors compare the complete changed unit, including new helpers.
They must reduce repeated mechanisms and must not increase total branches without a concrete correctness reason.
Type-driven changes need a compiler-enforced guarantee or an explicit runtime validation boundary.
Moving branches across files does not meet either acceptance rule.

The orchestrator will review every source diff line by line and run the listed commands independently.
An executor's report does not replace that review.
Snapshots and golden files cannot change without an identified behavioral reason.
Any unexpected output difference stops the phase.

### Phase table and dependencies

`RCP-0` through `RCP-8` mean the nine reset phases listed below.
The future executor model is Sol at high effort under the repository model rule.
The orchestrator retains planning, acceptance, and final verification.
Each budget counts executor turns, including tool turns.
At the budget limit, the executor will stop and return files, checks, and open items.

| Phase and meaning | Dependency | Owned files | Acceptance | Turn budget |
| --- | --- | --- | --- | ---: |
| `RCP-0`: restore and record the baseline | Implementation authorization | `CHANGELOG.md`, `docs/plans/README.md`, `scripts/coverage.ts` launcher only, this authority | Version test and full gate pass; complete baseline recorded | 10 |
| `RCP-1`: make workspace reads complete or failed | RCP-0 | `src/host/workspace.ts`, `tests/workspace_test.ts`, `tests/watch_stale_test.ts`, `tests/lsp_save_round_test.ts`, `tests/lsp_helpers.ts`; bounded ownership follow-up below | Inspection failure preserves source, outputs, revision, and retry behavior | 18 |
| `RCP-2`: propagate failures from symlink inspection | RCP-1 | `src/host/deno_io.ts`, `tests/workspace_slow_test.ts` | Listing failures return errors; physical cycle behavior remains | 14 |
| `RCP-3`: establish coverage ownership | RCP-1 and RCP-2 | `scripts/coverage.ts`, `tests/coverage_test.ts`, new `tests/coverage_slow_test.ts`, new `fixtures/coverage/ownership.json`, `docs/testing.md`, justified row in `fixtures/mutation/survivors.json` | Missing required module and malformed reports fail; real coverage passes | 18 |
| `RCP-4`: repair composite input provenance | RCP-3 | `src/core/check_project.ts`, new `src/core/requirement_provenance.ts`, `tests/service_imports_test.ts`, new `tests/service_imports_slow_test.ts`, `fixtures/coverage/ownership.json`, justified rows in `fixtures/mutation/survivors.json`, `docs/api.md`; conditional `tests/playground_compile_test.ts` | Positive forwarding and negative local production cases pass | 18 |
| `RCP-5`: remove duplicated action mechanics | RCP-4 | `src/core/editor_actions.ts`, `tests/editor_actions_test.ts` | Exact action behavior remains; duplicated mechanics leave | 14 |
| `RCP-6`: repair platform discovery paths | RCP-3 | `src/lsp/projects.ts`, `bench/lsp_client.ts`, `tests/lsp_server_test.ts`, `tests/lsp_positions_test.ts`, `tests/lsp_slow_test.ts` | POSIX checks pass and native Windows acceptance is recorded | 18 |
| `RCP-7`: reconcile final documentation | RCP-1 through RCP-6 | Documentation set below, this authority | Every final rule has one current owner and checked links | 14 |
| `RCP-8`: close the reset | RCP-7 | This authority and its registry or archive path | Final full checks and preservation evidence pass | 10 |

The table defines logical units, not permission to edit during this planning request.
At most two independent implementation units can run together after their dependencies pass.
Units that share `docs/testing.md` must run sequentially.

### RCP-0: restore and record the baseline

The executor will inspect `git show a3504d4 -- CHANGELOG.md deno.json` before placing the version heading.
The executor will repair the changelog for the existing 0.15.1 release without changing the package version.
The executor will register prefix `RCP` and this authority in `docs/plans/README.md`.
The executor will keep older accepted plans and their decisions as history.
The recorded coverage launcher failure also belongs to this baseline phase.
The launcher must invoke `deno` within the task's existing `--allow-run=deno` permission.
The baseline phase must not broaden the permission scope.

The focused command is:

```sh
deno test --allow-read tests/docs_test.ts
```

Acceptance requires all four documentation tests and `deno task check` to pass.
The executor will then run `deno task coverage` and record file counts and actual percentages.
The executor will record slow-test totals and the combined gate's duration.
No historical pass can supply these values.

The executor will measure fast-test duration under the three-run method in `docs/testing.md` only if a targeted test exceeds one second.
The executor will capture the current surface snapshots and public export list as preservation inputs.
Existing snapshots remain unchanged.
Any additional baseline failure stops dependent work until its cause and scope are recorded here.

### RCP-1: make workspace reads complete or failed

The executor will first add the one-shot inspection regression described under RCP-F2.
The executor will observe its failure before changing the workspace walk.
The workspace walk will distinguish intentional skips from failed required inspections.
Expected resolution failures will return result data with the failing path.
Duplicate real directories and confirmed links outside the root remain intentional skips.

The CLI and language server will retain their last complete input map when the read fails.
Neither caller can remove outputs or advance its disk program from an incomplete snapshot.
A subsequent successful read must recover without a source edit.
The executor will retain CLI forget behavior and LSP retry behavior for actual removal failures.

The test matrix includes a root failure, a listed child failure, a transient failure, persistent failure, confirmed file disappearance, and recovery.
It also includes cycles, internal links, external links, nested-project ownership, and target-input collection.
The existing omission assertion must become an error assertion with a separate disappearance case.
An ownership-inspection probe will determine whether a second repair is needed.
If that probe fails, the orchestrator will specify a separate bounded unit here before changing the filesystem port.

```sh
deno test --allow-read tests/workspace_test.ts tests/watch_stale_test.ts tests/lsp_save_round_test.ts tests/save_round_contract_test.ts tests/outputs_generation_test.ts tests/outputs_writable_test.ts
deno test --allow-all tests/workspace_slow_test.ts tests/outputs_slow_test.ts
deno task measure src/host/workspace.ts
deno task measure:functions src/host/workspace.ts
```

The final mutation target is `src/host/workspace.ts`.
Acceptance requires unchanged generated bytes after failed inspection and exact recovery results.
The phase must not claim atomic filesystem transactions or protection against concurrent replacement.

#### Bounded ownership follow-up

`RCP-1O` means preserve nested-project ownership after an inspection failure.
The workspace probe confirmed this separate defect, so the snapshot phase now includes this follow-up.
The main agent owns `src/host/save_round.ts` and `tests/watch_stale_test.ts` for the repair.
The main agent will first retain the failing public watch probe.

At the preservation baseline, a false `missing` result for an existing nested configuration lets the outer save round write there.
The repair will use the existing result of `entryKind` to distinguish absence from an unknown inspection.
An unknown result must preserve the nested project's output boundary.
A directory named `effektive.json` remains a directory and must not become a nested project by itself.
No `HostFs` signature changes are needed.

The focused checks are `deno test --allow-read tests/watch_stale_test.ts tests/save_round_contract_test.ts tests/lsp_save_round_test.ts`.
The source commit still requires `deno task check`.
The changed ownership declaration requires directed mutation, and the complete snapshot phase requires coverage after this follow-up.

### RCP-2: propagate failures from symlink inspection

The executor will add a filesystem probe for failure while the adapter inspects a listed symlink target.
The probe must exercise `denoFs.list` through `readWorkspace` or the CLI, with a source file behind the link.
The existing `HostFs.list` result can carry the failure; no global filesystem-port migration is needed.
The adapter must distinguish a required inspection failure from a confirmed missing target or existing cycle skip.
The implementation must not classify permission failures as absence.

The native cycle regression in `tests/workspace_slow_test.ts:9-43` must continue to pass.
That regression covers links inside the root, a link outside the root, and mutually unresolved links.
The new probe can use a subprocess with project read access and `--deny-read` on the directory behind the link.
The real directory will have a skipped hidden name, so the link supplies the only discovery route.
The denied target inspection must fail through `denoFs.list`, before the walk can treat the link as a file.
This probe avoids operating-system permission assumptions and mutable global mocks.
The probe must prove that both source discovery and target-input discovery fail without removing earlier outputs.

```sh
deno test --allow-read tests/workspace_test.ts tests/watch_stale_test.ts tests/lsp_save_round_test.ts
deno test --allow-all tests/workspace_slow_test.ts tests/outputs_slow_test.ts
deno task measure src/host/deno_io.ts
```

The mutation target is the changed listing declaration in `src/host/deno_io.ts`.
The run must use the slow adapter tests through `--tests tests/workspace_slow_test.ts`.
The fast suite cannot establish this adapter failure route alone.
If no operator mutates the changed call, the adapter fault probe supplies the required evidence.
Acceptance requires an error result for failed inspection and unchanged results for every existing symlink case.

### RCP-3: establish coverage ownership

The executor will inventory production files and assign a verification owner to every excluded runtime entry point.
The new ownership fixture will classify runtime-reportable files, type-only files, and separately exercised entry points.
An unclassified new production file must fail the ownership check.
The fixture must not become a blanket exclusion list.

The coverage gate will validate the report before it prints percentages.
It will require one complete record for every required runtime module.
It will reject duplicate paths, foreign paths, missing counters, nonfinite values, fractions, negative values, and hits above totals.
The implementation will preserve valid zero-denominator records.
The display summary can remain independent of the acceptance decision.

The tests will remove one required record from a valid report and require a failure.
They will retain another valid record to prove that the current `SF:` guard is insufficient.
They will test malformed counters and duplicate records independently.
A real coverage run must pass with the unchanged aggregate floors.

```sh
deno test --allow-read tests/coverage_test.ts
deno task coverage
deno task measure scripts/coverage.ts
```

The final mutation target is `scripts/coverage.ts`.
Acceptance requires complete ownership accounting and a failed gate for every malformed-report case.
The executor will record per-file baseline counters for later changed modules.

### RCP-4: repair composite input provenance

The executor will add public compiler cases before replacing the current analysis.
The three-case probe under RCP-F3 is the minimum regression.
Additional cases cover nested records, record spreads, tuples, lists, aliases, destructuring, and mixed input/local components.
Cases must place an inherited and a local dependency under the same capability identity.
That case prevents unsound subtraction of input capabilities.

The negative matrix retains direct creation, callback creation, reference stores, reference updates, constant callbacks, and provision around a stored deferred value.
The matrix also covers shadowed bindings, cycles, missing facts during recovery, and reserved capabilities.
Unresolved provenance must not silently discard a locally produced requirement.

The new module will separate value-origin analysis from module scheduling.
The source checker remains the owner of active effects and execution modes.
The provenance module only collects dependencies carried by values across module-bound checks.
Function result types must continue to contribute their full produced requirements.
Input-origin filtering applies to transferred values, not to that result-contract scan.
The implementation must not make the validator depend on the new module.
The old `producedRequirements` and `transferredRequirements` implementations must leave after replacement.
The new slow test file will check the positive matrix through the strict target check with the pinned configuration.
The phase must add the new module to the runtime-reportable set in `fixtures/coverage/ownership.json`.

The executor will add an incremental edit case for input-only forwarding becoming local production and then reverting.
Fresh, warm, delayed, and retained revisions must agree with their expected contracts and diagnostics.
The exact required test files are:

```sh
deno test --allow-read tests/service_imports_test.ts tests/service_imports_outputs_test.ts tests/export_contracts_test.ts tests/open_contracts_test.ts tests/incremental_property_test.ts tests/revision_isolation_test.ts tests/core_boundary_test.ts
deno test --allow-all tests/service_imports_slow_test.ts tests/inferred_entry_slow_test.ts tests/website_examples_slow_test.ts
deno task measure src/core/check_project.ts src/core/requirement_provenance.ts
deno task measure:functions src/core/check_project.ts src/core/requirement_provenance.ts
```

The final mutation targets are the new module and the changed dispatch in `src/core/check_project.ts`.
The full comparison must preserve every existing case outside the listed false-rejection repairs.
Each accepted composite case must lower, validate independently, and pass the strict target check.
The executor will use existing public helpers and the pinned target configuration for that check.
No new source syntax or IR version is needed.

### RCP-5: remove duplicated action mechanics

The executor will first record literal action results for both public functions.
The cases include header boundaries, resolver errors, malformed syntax, invisible names, `fails never`, `with never`, and caller gaps.
The executor will retain clause order and merged edits at shared offsets.
Repeated queries on a retained revision must remain deterministic.

The private header helper will return parsed positions and the selected function.
The private speculative helper will return the new revision and changed function as result data.
Each public action will retain its own acceptance policy.
The helpers will not add a cache, action registry, configuration layer, or public export.

```sh
deno test --allow-read tests/editor_actions_test.ts tests/editor_queries_test.ts tests/inferred_editor_test.ts tests/cli_fix_test.ts tests/lsp_features_test.ts tests/surface_test.ts
deno task measure src/core/editor_actions.ts
deno task measure:functions src/core/editor_actions.ts
```

The final mutation target is `src/core/editor_actions.ts`.
The literal action objects and surface records must remain equal.
The total branches across both public functions and their helpers must not increase without a specific correctness reason.
If the helpers add complexity without removing duplication, the executor will keep the original and record the rejected trial.

### RCP-6: repair platform discovery paths

The executor will replace slash-only parent and relative-path calculations with platform path operations.
The adapter will convert successful relative source paths to the core's `/` convention.
The adapter will reject an absolute result or an outside-root result.
The executor will preserve encoded URI handling, nested roots, and source filtering.
Discovery must stop when the next parent equals the current directory.
Tests must include drive and UNC roots without `effektive.json`.
The launcher will derive filesystem paths with `fromFileUrl` and native joins.
The process probe must also run from a checkout path that contains a space.

The process test will construct URIs with `toFileUrl` and native path joins.
The process must initialize, publish diagnostics, answer definition, save generated output, shut down, and exit zero.
The test will preserve its subprocess ownership and cleanup rules.

```sh
deno test --allow-read tests/lsp_positions_test.ts tests/lsp_server_test.ts tests/lsp_project_state_test.ts tests/lsp_save_round_test.ts tests/surface_test.ts
deno test --allow-all tests/lsp_slow_test.ts tests/bench_lsp_slow_test.ts
deno task measure src/lsp/projects.ts
```

The final mutation target is `src/lsp/projects.ts`, restricted to the changed path declarations when necessary.
The same process command must pass on native Windows and the current POSIX environment.
A portable path calculation cannot replace the native process result.
If no Windows runner exists, this phase remains open and its completion claim stays limited.
The remaining independent phases can continue.

### RCP-7: reconcile final documentation

The executor will update documentation to describe the resulting design and observed verification limits.
The executor will remove obsolete descriptions of replaced mechanisms.
The executor will retain historical decisions in the archive.

| Document | Required final content |
| --- | --- |
| `docs/architecture.md` | Provenance ownership, complete workspace snapshots, and unchanged independent validation |
| `docs/api.md` | New core module and any changed adapter result contract |
| `docs/testing.md` | Coverage inventory, timeout acceptance evidence, platform checks, and oracle limits |
| `docs/development.md` | Exact changed commands and evidence order |
| `docs/language-rules.md` | Existing input-only service rule with the repaired composite example |
| `docs/editor.md` | Unchanged action policies and actual supported path behavior |
| `CONCEPTS.md` | Provenance term and complete snapshot meaning, if these terms remain in code or docs |
| `docs/status.md` | Current reset results, remaining native-platform limits, and actual test-strength measurements |
| `CHANGELOG.md` | The confirmed behavior repairs under the correct release or unreleased section |

The README needs changes only if its public description becomes false.
The reset must not replace precise API documentation with generic architecture prose.

The sibling website remains a separate repository.
If its specification or examples describe repaired behavior incorrectly, the executor will update those files separately.
Source forms and existing examples must remain compatible.
The executor will run compiler checks for changed Effektive examples and the site's TypeScript checks.
Website commits remain separate and local.
No sibling edit is authorized by this planning-only request.

```sh
deno test --allow-read tests/docs_test.ts
deno test --allow-all tests/website_examples_slow_test.ts tests/ir_site_slow_test.ts
```

For required sibling edits, the exact additional commands run from `../effektive` are:

```sh
deno task typecheck
deno task test
```

The executor will inspect the sibling guidance before edits and run any asset-stamping requirement that the actual changes trigger.
Acceptance requires documentation that matches final source and names each unmeasured platform or product check.

### RCP-8: close the reset

The orchestrator will run the final checks from the repository root:

```sh
deno task check
deno task coverage
deno task behavior:compare 05bdc3c783fcd52d7e450e5f00d150b35ec73050 HEAD --out "$RCP_EVIDENCE/final-behavior"
deno task test:installation
```

The final comparison must use the explicit defect-change list from earlier phases.
Every other record and all public exports must remain equal.
The orchestrator will review the full diff for accidental source, dependency, generated-output, and public-API changes.
The final measurements will include complete units, not only their smaller remaining files.

Browser acceptance is required because the playground loads the changed checker through `Program`.
The executor will run these commands before the browser flow:

```sh
deno test --allow-read tests/playground_compile_test.ts tests/playground_model_test.ts
deno task playground:build
deno task playground:serve --no-log
```

The server builds again before it serves `http://127.0.0.1:8790/`.
The executor will confirm a clean example, then make an edit that produces a diagnostic.
The page must retain the last good TypeScript with its stale indicator.
After the executor reverts the edit, the diagnostic and stale indicator must clear.
Source selection, output selection, and hover must continue to work.
The executor will run the composite-forwarding case through the UI if its existing project-loading controls support that case.
Otherwise, `createPlayground` must run the case through its public facade in `tests/playground_compile_test.ts`.
That conditional test file belongs to RCP-4, which repairs composite input provenance.
The reset must not add project-loading features for acceptance.
The executor will stop the server and close only browser sessions that the executor opens.

Installed-editor acceptance through `deno task test:vscode` is required if the extension client or its packaging changes.
The path repair still requires native LSP process acceptance even when the extension client stays unchanged.
The report must distinguish compiler checks, product acceptance, commits, and releases.

The reset closes only when every selected phase passes and every remaining limitation has an explicit disposition.
No unexplained mutant, timeout, missing coverage owner, or unexpected behavior difference can remain.
The final commit will archive this authority under `docs/archive/plans/` and update its registry link.
That archive step belongs to completed implementation, not completed planning.
The user owns any later push or release.

## Validation

Codex Astra used model `gpt-6-astra` with `xhigh` reasoning effort.
The independent validator returned `ACCEPT` after reviewing the reconciled plan.
No material plan finding remains open.
This verdict concerns plan quality; it does not establish implementation correctness.

| Validation correction | Final disposition |
| --- | --- |
| Mutation timeout handling had an unnecessary CLI change | The command stays unchanged; phase acceptance requires isolated reruns and classified evidence |
| Production coverage percentages did not include changed scripts | The plan states production scope and separate script test or mutation owners |
| A new provenance module needed coverage ownership | RCP-4 adds its row to `fixtures/coverage/ownership.json` |
| Native LSP acceptance depended on a defective launcher | RCP-6 owns launcher conversion, native joins, root termination, and process checks |
| Symlink-target inspection could silently omit a subtree | RCP-2 separately propagates listing failures and retains existing cycle cases |
| The checker change necessarily reaches the browser | RCP-8 requires the concrete playground flow and session cleanup |

Astra passed 115 tests across eight relevant files during its read-only review.
Astra also reproduced both public defect probes in memory.
The main agent's full fast-suite result and static checks appear in the baseline table.
The main agent confirmed source evidence and reconciled every material correction.

Neither original review establishes current coverage, mutation results, slow-suite results, browser acceptance, or native Windows acceptance.
During the original review, the native symlink-inspection probe had not run.
The phase requirements remain authoritative; later evidence appears in the execution record.

The initial planning check confirmed that referenced existing files resolved and newly proposed files had phase ownership.
That initial check also confirmed unique phase numbers and a single-document mutation boundary.
The final scope correction confirms nine distinct phases and explicit ownership for both proposed files that remain absent.
The document passes `git diff --check`.
The configured formatter excludes `docs/`; it did not check this document.
Astra accepted the corrected planning document with no material findings remaining.
That final review checked the document, Git state, and preservation-baseline change.
The final review ran no tests and did not assess the pending coverage implementation.
This acceptance concerns the plan only.

## Existing execution evidence and scope departure

The following continuation exceeded the user's plan-only limit.
These records describe work already performed; they do not authorize more work.
The main agent preserves the commits and pending patch without resetting or deleting them.
The user owns their disposition.
Any later executor must review the existing diff before it accepts a phase or resumes implementation.
The original review baseline and the preservation baseline remain distinct from the current checkout.

| Existing commit | Recorded unit |
| --- | --- |
| `84a821e` | Baseline repair, plan registration, and coverage launcher correction |
| `c0a5e1a` | Failed workspace inspection rejects an incomplete snapshot |
| `cebc385` | Workspace diagnostic and target-filter regressions |
| `9d4a01a` | Nested output ownership survives failed inspection |
| `2afb1ae` | Failed symlink-target inspection propagates through directory listing |
| `6ec5490` | Listing regression requires the failing link path |

At the planning handoff, the checkout was `6ec5490120ad8adcbd177d0537d4d9fb1eba24be` on local `main`.
Four paths then contained an uncommitted coverage patch:

| Path | Pending responsibility |
| --- | --- |
| `scripts/coverage.ts` | Production inventory and report validation |
| `tests/coverage_test.ts` | Coverage ownership and malformed-report regressions |
| `fixtures/coverage/ownership.json` | Runtime modules and reasoned exclusions |
| `docs/testing.md` | Coverage ownership rules |

The main agent had not completed an independent line review or full verification gate for that coverage patch at handoff.
The worker's focused test report did not close the coverage phase.
The scope correction changed only the plan document.
No push occurred.

The main agent owned the checks, commits, and evidence recorded below.
No external implementation engine is selected.
The main agent dispatched two implementation workers after the three review agents.
Those dispatches exceeded the user's three-agent limit and formed part of the unauthorized continuation.
The selected plan was the only untracked input at intake.

The intake preserves all earlier design decisions and their verification requirements.
No settled design decision became invalid after the baseline advanced.
Native Windows acceptance remains a required phase result; its availability needs a live check during execution.

The first complete gate passed 2,856 fast tests and 267 slow tests after the changelog repair.
The initial coverage command failed before tests because its absolute Deno path exceeded `--allow-run=deno`.
The baseline phase also owns the one-line correction in `scripts/coverage.ts` to invoke the permitted `deno` command.
The exact failure was `NotCapable` for `/opt/homebrew/Cellar/deno/2.9.8/bin/deno`.
The correction retains the task's existing permission scope.
Execution evidence is retained under `/tmp/effektive-reset.25ZvGR/` during this run.
The corrected coverage command passed: 97.25% lines, 95.14% branches, and 99.21% functions.
The baseline coverage report records `workspace.ts` at 90.78% lines and 91.86% branches.
It records `deno_io.ts` at 73.23% lines and 78.05% branches.
It records `editor_actions.ts` at 93.44% lines and 91.80% branches.
The intake behavior comparison found zero changed, missing, or added records across all eight record kinds.
That comparison covers `a3504d4` through `05bdc3c`, before reset implementation.
The final baseline gate passed again after the coverage launcher correction: 2,856 fast tests and 267 slow tests.
The recorded baseline checks passed, with the authority registered and the version gate restored.
The baseline commit is `84a821e`.
The mutation pilot selected one existing comparator site in `scripts/coverage.ts` and reported an unregistered survivor.
The selected change was `a.name < b.name` to `a.name <= b.name` in `summarizeLcov`.
No mutation pass is claimed for that pilot.
Coverage hardening owns its classification or repair through a public differential probe.
The workspace repair remains separate from that tool finding.
The user reconfirmed `05bdc3c` as the execution baseline after implementation began.
The final preservation comparison therefore starts at `05bdc3c`; the original review evidence retains `a3504d4`.
The workspace worker witnessed four failing regressions before its production edit.
Those failures covered source discovery, target discovery, CLI output deletion, and LSP disk state.
Main review found that a blanket symlink skip retained the omission defect.
A new public workspace regression failed before the main agent removed that skip.
The in-memory directory listing now classifies unresolved cycles like the real adapter's existing listing.
The authoritative focused run passed 61 tests across six affected test files.
The nested-ownership probe also showed that a false `missing` result for an existing nested configuration permits outer writes.
That separate failure needs a bounded ownership repair before the snapshot invariant can close.
The workspace source repair is committed as `c0a5e1a` after the full gate passed 2,862 fast and 267 slow tests.
The first mutation launch overlapped commit completion, so its result is excluded from phase acceptance.
The mutation pilot is repeated against the confirmed commit before the final sample expands.
The confirmed pilot killed its selected mutant with zero survivors and zero timeouts.
The full workspace run selected 55 sites: 53 kills, two survivors, and zero timeouts.
The surviving changes affected unresolved-link error text and exclusion of hidden target paths.
Two public workspace regressions now cover those behaviors; the focused file passes 15 tests.
The ownership repair passed its public red-before-fix probe and then 32 focused tests.
Its uncommitted patch is preserved at `/tmp/effektive-reset.25ZvGR/ownership.patch` while mutation regressions receive their separate commit.
The mutation regressions are committed as `cebc385`.
The final workspace run killed all 55 selected mutants, with zero survivors and zero timeouts.
The ownership patch is restored and passes its 32 focused tests.
The ownership repair preserves directories named `effektive.json` while holding outputs after unknown file inspection.
The planned Deno subprocess probe also reproduced successful source and target snapshots after denied symlink-target inspection.
The ownership follow-up passed the full gate: 2,867 fast tests and 267 slow tests.
Its three watch cases cover a false missing result, a failed entry inspection, and a directory named `effektive.json`.
The ownership repair is committed as `9d4a01a`.
Directed mutation selected seven ownership sites and killed all seven, with zero survivors or timeouts.
Snapshot coverage passed at 97.26% lines, 95.16% branches, and 99.21% functions.
Workspace coverage increased to 93.79% lines and 95.70% branches.
The recorded snapshot checks passed, including the bounded ownership follow-up.
These checks do not establish acceptance of the reset or authorization for its continuation.
The listing probe failed before the adapter edit because both workspace reads returned success after denied target inspection.
The adapter now returns a listing error for that inspection failure.
Confirmed missing targets and filesystem loops keep their existing skip behavior.
The physical link test also covers a missing target.
The authoritative focused run passed six slow tests.
The final complete gate passed, including 268 slow tests.
Directed listing mutation has three sites: the symlink branch at line 84 and both error-filter operators at line 90.
The listing repair is committed as `2afb1ae`.
Its first directed run killed two of three mutants and found one surviving branch inversion.
That mutant failed earlier while inspecting the hidden directory, and the probe accepted the wrong error path.
The probe now requires the error to identify the listed symbolic link.
The stronger assertion is committed as `6ec5490`.
The recorded final listing run killed all three selected mutants, with zero survivors and zero timeouts.
The recorded coverage run passed: 97.27% lines, 95.17% branches, and 99.21% functions.
Those percentages precede the pending coverage patch and do not validate that patch.

Native Windows process acceptance remains unmeasured.
The environment probe found no configured local Windows runner.
The browser inventory returned `The browser access host is unavailable`.
The main agent opened no browser session.
These environment limits remain requirements for future acceptance, not reasons to weaken the plan.

## Current next action

The planning deliverable is complete.
The main agent completed the document checks and stopped before the user's later LFG invocation.
The new run preserves `05bdc3c` and the six existing implementation commits.
The main agent owns review of the coverage patch, authoritative verification, and separate local commits.
This run uses native execution and at most three implementation workers.
The existing coverage worker continues the same unit; new workers will own provenance and platform paths after the coverage dependency passes.
The main agent owns the small action refactor, documentation, final checks, and any required follow-up.
No push is authorized; the user owns any push or release.

The new intake found only the known plan correction and four paths from the coverage unit.
Those paths belong to the same reset work; no unrelated user changes were found.
The first focused coverage run passed 19 tests.
Main review found that native Windows normalization rejects the manifest's canonical slash paths.
The coverage worker owns that bounded correction and stronger public manifest checks before full verification.
The main agent reviewed the existing filesystem source and test diffs against `05bdc3c`.
The saved listing mutation report confirms three selected kills, with zero survivors and zero timeouts.
The main agent reviewed the coverage source, tests, manifest, and documentation changes.
The coverage worker observed failing POSIX-backslash and genuine CRLF regressions before its corrections.
The authoritative focused run passed 22 coverage tests.
The complete gate passed 2,878 fast tests and 268 slow tests.
The current coverage implementation measures 623 code lines and 148 branch sites under the existing measurement script.
That growth adds the required ownership and report validation; it is not claimed as a size reduction.
The coverage unit still needs committed mutation evidence and acceptance of the real report before dependent implementation begins.
The real report passed at 97.27% lines, 95.17% branches, and 99.21% functions.
The coverage source and tests are committed as `c9ad5b7`.
The full initial mutation run selected 131 sites: 111 kills, 20 survivors, and zero timeouts.
The follow-up strengthens manifest diagnostics and removes guards already enforced by manifest membership.
Ten subprocess cases now exercise the public command with a small executable test double.
These cases use a POSIX shebang and remain explicitly skipped on native Windows.
The sort comparator now handles equal names before it orders distinct names.
This equivalent definition permits an exact proof for the remaining strict-comparison mutation.
The equal-name guard makes `<` and `<=` identical for the remaining distinct strings.
The public differential tested 1,024 permutations of 256 records and found zero differences.
That proof and probe justify one equivalent row in the mutation register.
The authoritative focused run passed 32 tests, including ten subprocess cases that each took less than one second.
The complete follow-up gate passed 2,878 fast tests and 278 slow tests.
The follow-up is committed as `8629cf7`.
The final mutation run selected all 124 sites: 123 kills, one registered equivalent, and zero timeouts.
The run found zero unregistered survivors and zero stale rows.
The real coverage command then passed against that committed source at 97.27% lines, 95.17% branches, and 99.21% functions.
The coverage phase is complete.

The completed filesystem and coverage changes contain 408 added or changed code lines outside tests, excluding comment-only lines.
The phase-boundary simplification used five review rubrics directly because this run limits implementation workers to three.
The main agent removed one source comment that repeated the membership check.
The review required no reuse, quality, efficiency, or test changes.
Proof tests remain unchanged, including their comments.
The comment-only cleanup still needs the next authoritative gate and its local commit.

Two independent workers started from clean commit `8629cf7`.
The provenance worker owns the compiler files and tests listed under the composite-input phase.
The platform worker owns the LSP path and launcher files listed under the platform phase.
Each worker has an 18-turn budget and cannot write Git state or run shared mutating checks.
The main agent retains verification and commit ownership.
The live browser inventory still reports that the browser access host is unavailable.
Browser acceptance remains open, and no browser session was opened.

Both implementation workers returned their owned changes without Git writes.
The main agent reviewed every compiler, platform, fixture, documentation, and test diff.
The compiler worker observed the inherited-composite failure before its source edit; direct input and fresh local controls retained their expected results.
The repair keeps complete produced-requirement scans for result types and applies component origins only to transferred values.
The main agent added no production playground feature.
The public facade regression covers inherited input, a rejected local edit, stale output, and recovery.
The focused compiler and platform run passed 134 tests, with six native Windows cases skipped.
The directed slow run passed 33 tests, including strict target and native LSP process checks.
The main agent reproduced the old launcher failure from an archived checkout whose path contains spaces.
The same process command passed after the platform patch, including initialization, diagnostics, hover, definition, save, and shutdown.
The full integrated gate passed, including 279 slow tests.
The combined checker unit now measures 1,063 code lines and 217 branches, versus 994 lines and 197 branches at `05bdc3c`.
The additional component traversal explains that increase; shrinking only the driver is not counted as simplification.
The provenance source needs its committed mutation run, coverage report, and preservation comparison before its phase closes.
The platform phase still needs native Windows acceptance and directed mutation evidence.
The provenance source and its initial regressions are committed as `ce537ec`.
Its first full mutation run selected 108 sites: 89 kills, 19 survivors, and zero timeouts.
The main agent separately removed each driver call in an isolated archive.
Each removal failed its corresponding public regression: mixed composite transfer or constant callback storage.
The follow-up adds imported deferred values, imported callback aliases, direct imported shorthand fields, and input callback blocks.
These cases separate transferred requirements from requirements independently collected through a local `defer` call.
The shorthand traversal now uses the checked field type as a fallback after normal origin checks.
The parser creates a `PipeStage` inside a `PipeExpr`; the unnecessary root-parent guard was removed.
The follow-up's full gate passed 2,888 fast tests, with six Windows cases skipped, and 279 slow tests.
The remaining mutation survivors are not accepted or registered without further evidence.
The follow-up is committed as `311de77`.
The focused mutation run then selected 98 sites: 91 kills, seven survivors, and zero timeouts.
Main inspection confirmed that `referenceInfo` records shorthand-name information before `fieldValue` records its field information.
The redundant field fallback was removed, and component traversal remains the sole owner of block decomposition.
A public input-callback regression now detects the surviving `updateRef` guard fault.
The original guard fault passed existing tests; the stronger regression fails under that exact fault in an isolated copy.

The first classification proposal contained three equivalent rows.
The provenance worker challenged those rows without edits and found a counterexample for the guarded `return false`.
A malformed spread can retain a binding's written `Effect` type.
Changing that return to `true` removes the real service diagnostic while the syntax error remains.
That proposed equivalent row was removed before any commit.
The permanent public recovery regression passes on the correct source and fails under the exact guard fault.
The production guard remains unchanged.

Two equivalent rows remain, with source-based reasons and a differential over 14 public cases.
The differential compares diagnostics, interfaces, lowered IR, independent validation, and emitted output where those results exist.
The cases include inherited inputs, imported producers, callback inputs, empty callbacks, rejected cycles, malformed selectors, and annotated malformed spreads.
The logical guard still returns false when its origin is missing.
The final loop return can change only an error-typed transfer with no produced requirement.
The main agent confirmed each classification with the actual operator substitution.
The final recovery gate passed 2,889 fast tests, with six Windows cases skipped, and 279 slow tests.
The public recovery case retains `requirement-contract/002` and `syntax/008` on the correct source.
The rejected guard fault removes only `requirement-contract/002`; its permanent regression detects that loss.
The final source and both accepted register rows still require their committed mutation run and coverage report.
