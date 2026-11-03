# Fresh-eyes fixes: evidence and worklog

Authority: [fresh-eyes fixes](2026-11-03-fresh-eyes-fixes.md).

## Current state

Objective: complete the five approved repair phases on local `main`.
Initial commit: `28c7514`. The initial worktree was clean.
Constraints: separate local commits, no push, no deferred feature work, and no external source symlinks.
Accepted decisions: phase order, rejection of external source links, and permission to record and execute the plan.
Execution engine: native. Delegated implementation uses Sol (`gpt-5.6-sol`) with high reasoning effort.
No Compound Pack applies to this checkout.
Current work: verify playground cleanup against physical filesystem targets.
Remaining work: playground cleanup, project writes, numeric encoding, and documentation.
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
