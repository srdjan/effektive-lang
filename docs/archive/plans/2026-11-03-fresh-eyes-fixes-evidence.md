# Fresh-eyes fixes: evidence and worklog

Authority: [fresh-eyes fixes](2026-11-03-fresh-eyes-fixes.md).

## Current state

Objective: complete the five approved repair phases on local `main`.
Initial commit: `28c7514`. The initial worktree was clean.
Constraints: separate local commits, no push, no deferred feature work, and no external source symlinks.

Accepted decisions: phase order, rejection of external source links, and permission to record and execute the plan.
Execution engine: native. Delegated implementation uses Sol (`gpt-5.6-sol`) with high reasoning effort.
No Compound Pack applies to this checkout.

Completed work: all five approved repair phases and their final review corrections.
Current work: none. The plan and evidence are archived.
Open issues: no confirmed repair remains open.

Next action: the user reviews the local commits.

## Review baseline

The fast suite passed 2,735 tests and failed one changelog-version test.
Formatting, lint, and type checks passed.
The 24 selected runtime and dependency-boundary checks passed.

Independent agents confirmed the filesystem findings and the source-map numeric defect.
The main agent reproduced both filesystem failures in temporary directories.
The main agent confirmed all seven findings against current source and documentation.

## Phase evidence

Each phase below records its changes, checks, commits, and evidence limits.

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
That edit was committed independently as `baf7c3e` and remains outside this repair scope.
Replay regression commit: `ac2c71d`. Its preceding complete check passed 2,737 fast tests and 263 slow tests.

All six selected replay validation mutations were killed.
The added forwarding expression in `wire_log.ts` has no mutation site under the tool's four operators.

### Correct numeric encoding

The new public API regressions failed before the repair.
Large negative safe integers decoded with positive signs, and oversized input returned success.
The codec now uses exact integer arithmetic for sign packing and digit accumulation.

Decoded values above the safe integer domain return a tagged `overflow` error.
The initial exact implementation passed all 16 source-map tests and the complete gate.
A separate probe measured 0.45 ms, 3.72 ms, and 141.55 ms for 1,024, 8,192, and 65,536 zero digits.

The decoder now saturates its scale above the accepted numeric domain.
Higher nonzero digits still cause overflow, while zero continuation digits retain their existing meaning.
The same three probe sizes then took 0.16 ms, 0.65 ms, and 2.80 ms.

These are single probe measurements, not latency guarantees.
All 16 source-map tests and the complete check passed after the bound.
The complete check passed 2,739 fast tests and 263 slow tests.

Commit: `a1e3ac1`. All four selected numeric mutations were killed.
Independent test review then found overflow when `decodeMappings` accumulates individually valid deltas.
The main agent reproduced unsafe generated columns after two large deltas.

A new public regression covers all four accumulated coordinates and safe boundary controls.
The regression fails against commit `a1e3ac1` in a temporary exported tree, with type checking disabled for the new error tag.
The decoder now returns a tagged error for unsafe accumulated positions.

Correction commit: `c0f0b41`. The complete check passed 2,741 fast tests and 263 slow tests.
The small mutation pipeline passed, then all four selected accumulated-position mutations were killed.

### Simplification review

Five Sol reviewers examined reuse, clarity, efficiency, test value, and comments without edits.
The main agent accepted the accumulated-position defect and repaired it in the numeric phase.
The main agent skipped the temporary-directory helper proposal because it rewrites a protected proof test.

The main agent retained fresh containment checks rather than reuse earlier filesystem observations.
The map serialization proposal has no measured application effect and remains outside this repair.
The resolver comment stays because it explains the platform distinction between a missing path and a dangling link.

The review applied one correctness repair and retained four low-value or constrained proposals without changes.

### Final review and correction

The ce-code-review run `fresh-eyes-07z8_391` completed with eight Sol reviewers and an independent validator.
The receipt is `/tmp/compound-engineering-501/ce-code-review/fresh-eyes-07z8_391/review.json`.
The review required one correction: native Windows separators were rejected by the new containment prefix.

The main agent reproduced that failure through `readWorkspace` with an in-memory filesystem.
The validator confirmed the separator defect and rejected a proposal to change the intended output preflight order.
The correction shares one separator-aware root check between the directory walk and individual path checks.

POSIX absolute paths keep backslashes as literal characters.
Root-relative module paths reject backslashes, consistent with `normalizeRelative` in the compiler.
The new public tests failed before the correction and pass after it.

A permission-error control also proves that a refused map inspection leaves both output files unchanged.
The 24 focused host and output tests pass.
The complete check passed 2,745 fast tests and 263 slow tests after the correction.

A separate Sol critique found no blocker in the changed containment rule.
That critique reran the four exact public regressions successfully and checked the diff.
Actual Windows execution, concurrent filesystem replacement, and hard-link isolation remain unverified.

Correction commit: `52c9a24`.
The native-path mutation sample passed, then all three selected separator mutations were killed.
The relative-path sample passed, then all seven selected lexical-guard mutations were killed.

Both selections reported no unregistered survivors or stale rows.
A temporary exported tree then swallowed a failed filesystem inspection deliberately.
The public permission-error regression failed against that fault, which confirms that the regression detects that failure.

### Align live documentation and complete the plan

The language rules now describe producer comparison and inferred contract changes in interface hashes.
The accepted application rule distinguishes its historical Deno baseline from the current compiler requirement.
The API documentation describes canonical containment, paired output checks, relative path rules, and filesystem limitations.

The testing documentation records the new guard and numeric regressions with their evidence limits.
The filesystem port comment now describes existing paths, including files.
The completing documentation commit moves this plan and evidence into the archive and updates the registry.

The complete check after archival passed formatting, lint, types, 2,745 fast tests, and 263 slow tests.
All four focused documentation tests also passed.
The main agent retains the independently committed README change.

The compiler boundaries, ordinary outputs, internal links, and replay behavior passed their selected public checks.
The complete check also covers formatting, lint, types, and the full fast and slow test suites.
The mutation results prove the selected sites only.

Browser acceptance, installed-editor acceptance, native Windows execution, concurrent replacement, and hard-link isolation remain outside the verified scope.