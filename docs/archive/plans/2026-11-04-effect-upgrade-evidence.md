# Effect upgrade evidence

## Current objective and constraints

Upgrade all active target pins from 4.0.5 to exact 4.1.2 while preserving Effektive source behavior.
The accepted plan is [Effect upgrade](2026-11-04-effect-upgrade.md).
Both repositories were clean at implementation start. Both use local `main`.
Deno is 2.9.8. Node.js is 24.21.0.
The requested Sol model is unavailable. Execution is sequential, with no claimed independent model review.

## Evidence strategy

This change updates dependency configuration and existing target expectations.
Existing public compiler, CLI, runtime, application, installation, and website tests supply compatibility evidence.
No duplicate tests are needed unless those checks expose missing behavior coverage.
The full compiler gate runs before each compiler commit.

## Progress

The target and application locks were regenerated in empty temporary directories.
The root lock needed `deno cache --frozen=false bench/ref_update.ts` after `deno install --frozen=false`.
Deno retained the unused old root resolution. That stale entry was removed after checking active imports.
The target lock retains 14 packages. Only Effect packages and required `ws` 8.22.1 changed.
All other target resolutions and all JSR application resolutions stayed unchanged.

The focused version and CLI tests passed: 52 tests.
The strict target smoke passed: one recursive alias case, including execution, in 2.96 seconds.
The sibling strict checker passed: 65 units, with zero missing panels.

The baseline documentation check failed before dependency edits.
`deno.json` reports 0.15.0, but the newest changelog heading reports 0.14.1.
Decision 2 asks whether to add the missing existing release heading or preserve the failed gate.
The user accepted Decision 2: add the existing 0.15.0 release heading.
The Effektive release version stays unchanged. Upgrade entries remain under Unreleased.

## Compatibility inventory

Upstream sources: [4.1 upgrade notes](https://effect.website/blog/releases/effect/41) and
[package changelog](https://github.com/Effect-TS/effect/blob/main/packages/effect/CHANGELOG.md).
npm metadata confirms 4.1.2 as the newest stable 4.1 patch on 2026-11-04.
The platform packages require Node.js 22.19.0 when applications run on Node.js.

| Surface | Upstream change and repository disposition |
| --- | --- |
| Schema | Parser reruns, formatting, and optional tuple encoding changed across the release range. Existing presence, default, recursion, and adapter probes remain the oracle. Defensive guards stay. |
| Effect, Context, Layer | New overloads and internal fixes need no source additions. Strict target and application tests check existing emitted calls and service requirements. |
| Schedule and Duration | New ISO operations and Cron overlap options are outside active source forms. Existing retry and repeat tests use TestClock. |
| Streams and references | Cancellation, cleanup, retry, and stream composition fixes need existing runtime checks. Reference imports now use the exact target version. |
| Node file services | Host adapters use NodeFileSystem layers. No custom Effect FileSystem implementation needs `readDirectoryEntries`. |
| Crypto and child processes | Active source and host fixtures do not use removed Crypto APIs or changed ChildProcess templates. Compiler subprocesses use Deno.Command. |
| Persistence, RPC, AI, SQL migrations, terminals, cookies | No active use of changed upstream entry points was found. No migration or source addition is needed. |

Full compatibility checks passed. No emitter change was required.


## Compatibility failures and corrections

The first focused run passed 55 tests and failed six tests.
Three failures came from the missing `driver` field in SqlClient.make.
The adapter now names its existing SQLite driver in both repositories.
One test required old constructor replay aliasing. Upstream fixed parser replay state reuse.
The test now requires fresh results and an unchanged first result.
Two application tests required old mixed-cause behavior.
An isolated native probe compared 4.0.5 with 4.1.2 before test changes.
The [upstream mixed-cause change](https://github.com/Effect-TS/effect/pull/9516) explains the difference.
The updated tests require both original reasons as defects, preserved order, and completed cleanup.
The stream test also requires zero output batches after a mixed failure.
No emitter or source contract change was required.

The first website test run found stale asset stamps for the existing release version.
`deno task stamp` corrected the stamps. All 12 website tests then passed.
The historical validation report stays unchanged until new evidence is appended.

The full gate exposed another mixed-cause assertion in the SQL workflow.
The corrected test checks both preserved defects, one lease, no retry, and completed cleanup.
A strict TypeScript check rejected a union of different Exit success types in the new stream assertion.
The native comparison now uses a void fallback, matching the processor's success type.
A stronger rollback assertion initially used error formatting. The final assertion checks the exact original rollback error instead.
The manual NodeFileSystem probe first lacked Deno's `uid` system permission. Its rerun grants only that system permission.


## Final checks and review

| Command or check | Result |
| --- | --- |
| `deno task check` | Passed: format, lint, type checking, 2,856 fast tests, and 264 slow tests. Measured duration: 42.38 seconds. |
| `deno task test:installation` | Passed: one offline installation test with an empty cache. |
| Sibling `deno task typecheck` | Passed: 65 strict units and zero missing panels. |
| Sibling `deno task test` | Passed: 12 server and asset-stamp tests. |
| Manual frozen target probe | Strict host check and NodeFileSystem execution passed. An unpinned old Effect import failed. Lockfile bytes stayed unchanged. |
| Active pin search | No 4.0.5 pin remains in compiler source, tests, benchmarks, fixture configurations, or website target configurations. |
| `git diff --check` in both repositories | Passed. |

The final gate includes all five application witnesses and canonical website examples.
The final SQL cleanup test checks the original rollback error, rather than error formatting.
The schema and mixed-cause changes follow upstream fixes. The compiler emitter stays unchanged.
No new branch or failure logic was added to production code, so mutation checks were not required.
The production edits change version data and the required SQL driver name.
Historical measurements and release validation records retain their original versions.

The ce-code-review skill completed a lite correctness review in the main context.
It found no actionable issues after corrections. The review checked the accepted plan and repository instructions.
The review receipt is `/tmp/compound-engineering-501/ce-code-review/effect-upgrade-red8a22d/review.json`.
No reviewer agent, external peer, or independent model review ran.
The allowed executor model was unavailable. This evidence does not claim independent review.
The temporary receipt is supplementary; this file contains the durable review summary.

## Completion

All four units are complete within the recorded review limits.
The sibling website commit is `0c360cb`: Pin website examples and checks to Effect 4.1.2.
The compiler commit contains the coupled pins, locks, compatibility assertions, documentation, and archived plan evidence.
The compiler commit also includes the accepted correction to the existing 0.15.0 changelog heading.
No pre-existing dirty work was present at implementation start. No unrelated changes were included.
The user owns the next action: inspect the two local commits and push them when ready.
