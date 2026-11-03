# Fresh-eyes fixes: evidence and worklog

Authority: [fresh-eyes fixes](2026-11-03-fresh-eyes-fixes.md).

## Current state

Objective: complete the five approved repair phases on local `main`.
Initial commit: `28c7514`. The initial worktree was clean.
Constraints: separate local commits, no push, no deferred feature work, and no external source symlinks.
Accepted decisions: phase order, rejection of external source links, and permission to record and execute the plan.
Execution engine: native. Delegated implementation uses Sol (`gpt-5.6-sol`) with high reasoning effort.
No Compound Pack applies to this checkout.
Current work: contain source fixes and generated writes through the shared host boundary.
Remaining work: project writes, numeric encoding, and documentation.
Open issues: none before implementation.
Next action: the main agent obtains a plan critique, then runs the first phase's checks.

## Review baseline

The fast suite passed 2,735 tests and failed one changelog-version test.
Formatting, lint, and type checks passed.
The 24 selected runtime and dependency-boundary checks passed.
Independent agents confirmed the filesystem findings and the source-map numeric defect.
The main agent reproduced both filesystem failures in temporary directories.
The main agent confirmed all seven findings against current source and documentation.

## Phase evidence

The main agent will append each phase's changed files, checks, commit, and evidence limits here.

### Plan critique

Sol reviewed the plan without edits.
The critique identified dangling output symlinks as a missing regression case.
The plan now requires checks for every generated file and map, including dangling links.
Port wrappers and test doubles may change if the filesystem contract needs that support.
The plan also states the commit-before-mutation sequence and the required correction loop.
No other blocking plan finding remained.

### Restore the baseline

The existing documentation test failed with 0.12.3 versus 0.13.0 before the changelog repair.
All four documentation tests then passed.
The first complete check passed the fast suite but failed two behavior-comparison tests in the slow suite.
The child process reported `NotCapable` for the resolved Homebrew Deno path.
The task permits the command `deno`, while the child executable reports a different absolute path.
The comparison now starts the permitted `deno` command, as the mutation tool already does.
This prerequisite stays in the baseline phase because that phase must restore the required complete check.
The focused behavior-comparison suite then passed both tests.
`deno task check` passed formatting, lint, type checks, 2,736 fast tests, and 258 slow tests.
Commit: `5cd6e3c` records the restored baseline and the approved plan.
The first one-site mutation sample killed its mutant but rejected two stale register offsets.
Replacing the Deno command shifted the two sites by nine characters.
The main agent checked the unchanged site text and slow-test reasons, then refreshed both measured offsets.
Correction commit: `f13f4b4`.
The repeated complete check passed, and the repeated one-site mutation sample killed its mutant with no stale rows.
That mutation sample used `tests/behavior_corpus_test.ts`; it does not prove subprocess permissions.
The focused slow tests and the complete gate prove the command repair.

### Protect playground cleanup

The new regression copied the build module into a disposable repository.
Before repair, an alias to `src/core` passed the guard and produced `bundle-failed` after deletion.
The guard now checks both lexical and physical paths.
A missing output resolves through its nearest existing parent.
A dangling link fails resolution and is refused.
The focused build and guard tests passed after repair, including normal external output.
`deno task check` passed 2,736 fast tests and 259 slow tests before commit `417e993`.
The one-site mutation pipeline passed.
The selected five-site run killed four mutants and exposed a gap in the chosen slow-test file.
That file tested aliased paths but omitted a direct protected path through `build`.
The regression now covers a direct protected directory in the same disposable repository.
Correction commit: `36b679f`. The complete check passed again.
All five selected mutants at lines 119, 137, and 140 of `playground/build.ts` were killed after the correction.
There were no unregistered survivors or stale rows in that selected run.
The selection does not cover every mutation site in the build module.

### Contain project writes

Sol added the no-follow `HostFs.entryKind` port and one shared containment helper in `workspace.ts`.
The helper checks each existing component and rejects unresolved links and external targets.
Source discovery, source fixes, generated pairs, and stale removal use that helper.
Both output paths pass containment before existing output is read.
Sol observed failing external-source and external-output regressions before changing production code.
The main agent reviewed all changed code and ran 31 focused host and filesystem tests successfully.
The main agent found two missing replay port implementations through type checking and added them.
All 15 replay tests then passed.
`deno task check` passed formatting, lint, type checking, 2,736 fast tests, and 263 slow tests.
Concurrent filesystem replacement remains unverified.
Commit: `a5deeb6`.
The small three-module mutation pipeline passed.
The selected full run killed 12 mutations across `deno_io.ts`, `workspace.ts`, and `outputs.ts`.
The selected mutation of the source-fix write check was also killed.
The main agent added a public replay regression for a refused no-follow inspection; all 16 replay tests pass.
An unrelated README edit appeared during execution. The main agent preserves it and excludes it from repair commits.
