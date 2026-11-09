---
title: Measure the whole slow suite before you add concurrency inside a slow test
date: 2026-11-03
category: workflow-issues
module: tests/target_helpers.ts, scripts/test_slow.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A change starts two or more `deno` subprocesses at the same time inside one slow test or slow-test helper"
  - "A change splits a long `*_slow_test.ts` file so that more workers run it"
  - "A task asks to make `deno task check` or `deno task test:slow` faster"
  - "One slow test file gets faster alone, and the change is about to land on that evidence"
tags: [slow-suite, test-slow, deno-test-parallel, deno-dir, concurrency, subprocess, a-b-timing, gate-time]
---

# Measure the whole slow suite before you add concurrency inside a slow test

## Context

A scan of the hot paths for sequential awaits found that `runStrictTarget` in `tests/target_helpers.ts` runs `deno check` and then `deno run` on the same emitted program. In Deno 2, `deno run` does not type-check by default, so the two subprocesses are independent. The helper and its wrappers `compileStrictTarget` and `compileAndRun` have 73 calls in 29 slow test files. A concurrent version looked like a clear gain for `deno task check`.

The slow suite already runs in parallel. `scripts/test_slow.ts:39` passes `--parallel` to `deno test`, and `scripts/test_slow.ts:13` gives each suite run a fresh, empty `DENO_DIR`. In this session, the suite ran 58 files on 14 cores.

An earlier change used the other lever: it split `tests/emit_slow_test.ts` into five files. That file summed 51.6 s, and the next file summed 19.3 s, so it was the critical path of the suite. The SB8 row of [the stable-base plan](../../archive/plans/2026-10-30-stable-base-reset.md) measured the suite at 72, 83, and 72 s before the split, and at 40, 41, and 41 s after it (session history).

## Guidance

Judge a concurrency change inside the slow suite by the wall time of the whole suite, `deno task test:slow`. Do not judge it by the time of one test file alone.

Compare the base commit and the change with an interleaved A/B run. Put the base commit in a detached worktree, and alternate the two sides in the order B, A, A, B. Record the real, user, and sys seconds of each run with `/usr/bin/time -p`, and record the load average. Change only the one unit under test on the B side.

Keep a rejected change out of the tree, and put a short comment at the site that names the measurement. `tests/target_helpers.ts:109` holds that comment for `runStrictTarget`.

## Why This Matters

The per-file result and the suite result pointed in opposite directions. These are the measurements of this session, on a 14-core machine that other projects also loaded:

| Change | One file alone | Whole slow suite |
| --- | --- | --- |
| `runStrictTarget` runs `deno check` and `deno run` at the same time | `tests/strict_target_slow_test.ts`: median 12.03 s to 10.48 s | 39.18 s and 41.31 s to 45.14 s and 46.73 s |
| `deno check` beside `deno test` in the application integration test | Warm cache: no gain. Fresh `DENO_DIR`: 3.42-3.50 s to 3.55-4.05 s | Not run |
| Split `tests/cli_slow_test.ts` (36 s, the longest file) into two files | Not applicable | 48.95 s and 45.45 s to 49.84 s and 53.81 s |

With the concurrent `runStrictTarget`, user CPU stayed at about 275 s, but sys CPU went from 42-51 s to 88-94 s. The probable cause is contention between the two `deno` processes on shared cache or lock files under the fresh `DENO_DIR`. This cause is not confirmed. A system-call profile of one strict-target case can confirm it.

Concurrency on the shared cold cache can also fail, not only slow down. All slow test files share the one fresh `DENO_DIR`. A change that ran the two `deno bundle` steps of `packageRelease` at the same time passed two gates and failed the third: one bundle stopped with "failed to copy esbuild binary", because the source file under the npm cache was missing. A stress loop on a new, empty `DENO_DIR` in each round reproduced it: 0 of 10 rounds failed with two concurrent bundles, and 1 of 10 failed with four. `tests/playground_build_slow_test.ts` also runs `deno bundle`, so the suite can start several cold bundles at once. The first timings of that change used the warm shared cache, so they could not show the race. That change was reverted. The race existed before it: after the revert, a gate failed in `tests/playground_build_slow_test.ts` with the same error, while the installation test bundled at the same time. `scripts/test_slow.ts` now runs one warm-up `deno bundle` of a stub before the tests, so esbuild is installed once. With six concurrent bundles on a new, empty `DENO_DIR` in each round, 3 of 15 rounds failed without the warm-up, and 0 of 30 rounds failed with it.

A comparison of a fresh worktree against the main checkout is biased. At the same commit, the main checkout passed 247 slow tests, and the worktree passed 228 and ignored 3. The probable cause is that some slow tests need files that git does not track. This session did not check it. Compare two worktrees of the same base, or check that both sides report the same test count.

## When to Apply

Apply this rule to any change that adds subprocess concurrency inside `tests/*_slow_test.ts` or their helpers, such as `tests/process_helpers.ts` and `tests/emit_slow_helpers.ts`. Apply it also to a change that moves slow tests between files to balance the workers. A critical-path argument alone is not enough. The emit split worked when the longest file was 2.7 times the next file. In this session's base run, `tests/cli_slow_test.ts` summed 36 s against 27 s for the next file, which is 1.3 times, and its split gave no gain under load.

Run the A/B only when no other heavy job runs. Earlier sessions saw slow tests fail at high load, and the gate rule is to hold the gate until the machine is quiet (session history). If other projects load the machine, alternate the sides and report the load beside each time.

Time a concurrency change for the gate with a fresh `DENO_DIR` on each run, as `scripts/test_slow.ts` does. A warm cache hides the cold-cache races and the cold-cache costs.

The rule does not apply to a tool that runs alone, outside the suite and its cache. In the same scan, `makeCopies` in `scripts/mutate.ts` started to extract the worker copies at the same time. Four extractions went from 0.40-0.47 s to 0.17-0.21 s, and that change stayed.

## Examples

The rejected change, which made one file faster and the suite slower:

```ts
const [checked, ran] = await Promise.all([command("check"), command("run")]);
```

The kept code in `tests/target_helpers.ts`:

```ts
// The commands run in order on purpose. At the same time, they made the
// slow suite slower: see docs/archive/plans/2026-11-03-concurrent-awaits.md.
for (const command of ["check", "run"]) {
```

The measurement loop, with the two trees as arguments:

```sh
for side in B A A B; do
  dir=$([ $side = A ] && echo "$BASE" || echo "$CHANGED")
  (cd "$dir" && /usr/bin/time -p deno task test:slow 2>&1 >/dev/null | grep -E '^(real|user|sys) ')
done
```

The full ledger of the scan, with each kept and rejected site, is in [the concurrent-awaits plan](../../archive/plans/2026-11-03-concurrent-awaits.md). Related: [Hold the test set constant to read behavior:capture](behavior-capture-hold-tests-constant.md) applies the same rule of one changed variable to behavior captures.
