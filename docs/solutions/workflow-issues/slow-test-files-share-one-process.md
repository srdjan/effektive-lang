---
title: Slow test files share one process, so a folder prefix with the process ID is not private to one file
date: 2026-11-17
category: workflow-issues
module: tests/bench_lsp_slow_test.ts, bench/lsp_script.ts, scripts/test_slow.ts
problem_type: test_failure
component: testing_framework
symptoms:
  - "`deno task check` fails the M1, M3, and M4 tests of `tests/bench_lsp_slow_test.ts` with `Values are not equal` on two lists of folder names"
  - "Each slow test file passes when it runs alone"
root_cause: test_isolation
resolution_type: test_fix
severity: medium
tags: [slow-suite, test-slow, deno-test-parallel, deno-pid, temporary-folder, leftover-check, bench, lsp, test-isolation]
---

# Slow test files share one process, so a folder prefix with the process ID is not private to one file

## Problem

The leftover checks of `tests/bench_lsp_slow_test.ts` assume that only that file makes bench folders in its process. A unit of the fresh-eyes follow-up added a test that calls `runM7` in a new slow test file. In the full gate, the two files ran at the same time in one process, and the leftover checks failed.

## Symptoms

- On 2026-11-17, `deno task check` failed 3 of 340 slow tests: M1, M3, and M4 in `tests/bench_lsp_slow_test.ts`. Each failure was `Values are not equal` on a list of folder names.
- In the M1 failure, the list after the run had two names with the prefix `effektive-bench-lsp-23417-`. The list before the run had one other name with the same prefix.
- `deno test --allow-all tests/bench_lsp_slow_test.ts` passed 8 of 8 alone. With `--parallel` and `tests/bench_mutation_slow_test.ts`, the same command failed 3 of 11.

## What Didn't Work

The executor of the unit ran each new slow test file alone, and each passed. The mutation tool also runs one test file with `--tests`. Neither run puts two slow files in one process, so neither showed the problem. Only `deno task test:slow`, which `deno task check` runs, puts all slow files together.

## Solution

The commit "Move the M7 cold-pair test into the bench LSP slow test file" moved the test into `tests/bench_lsp_slow_test.ts`. In one file, the tests run one after another, so each leftover check sees only the folders of its own test. After the move, the parallel pair passed 11 of 11, and the full gate passed all 340 slow tests.

The moved test kept its body. Only its place changed:

```ts
// Before: tests/bench_mutation_slow_test.ts, a second file that starts the LSP bench.
Deno.test("M7 times one cold save for each side of each cold pair", async () => {
  const result = await runM7({/* ... */});
  // ...
});

// After: the same test at the end of tests/bench_lsp_slow_test.ts.
```

## Why This Works

`scripts/test_slow.ts:29` passes `--parallel` to `deno test`. With `--parallel`, Deno runs all test files in one process. A probe on Deno 2.9.8 measured this: three test files that print `Deno.pid` printed the same number. The failure agrees: the folders from the other file had the process ID of the checking test.

`bench/lsp_script.ts:185` builds `TEMP_PREFIX` from `Deno.pid`, and `bench/lsp_script.ts:190` makes each workspace folder with that prefix. `tempLeftovers` at `tests/bench_lsp_slow_test.ts:18` lists every folder with that prefix in the system temporary folder. Seven tests of that file compare that list before and after their run, among them the M1, M3, and M4 tests. So a bench run in another file of the same suite run changes the list. In one file, no other bench run can overlap a check.

## Prevention

- Put each test that starts the LSP bench in `tests/bench_lsp_slow_test.ts`. The LSP bench starts through `runM1`, `runM3`, `runM4`, `runM7`, and the workspace helpers of `bench/lsp_script.ts`.
- In a slow test, do not treat a name that holds `Deno.pid` as private to one test file. Keep all tests that make such a name in one file, or check only a name that one test alone can make.
- Before you land a new `*_slow_test.ts` file, run it with `--parallel` together with the slow files that it can affect. As an alternative, run `deno task test:slow`. A run of one file alone does not show interference between files.
- No new test holds this rule. The leftover checks already fail in the full gate. A test of which file imports the bench runners would assert file layout.

## Related Issues

- [Measure the whole slow suite before you add concurrency inside a slow test](measure-the-whole-slow-suite-before-adding-concurrency.md) describes the same `--parallel` run of the slow suite from the side of its wall time.
- [Fresh-eyes follow-up](../../plans/2026-11-16-fresh-eyes-follow-up.md), units FWU9 and FWU10, records the failure and the move.
