# Concurrent awaits on hot paths

Date: 2026-11-03. Status: complete. CA identifies the units of this plan.

## Goal

Find each `await` on a hot path that waits for work that does not depend on it. Start that work at the same time. Keep each output, each exit code, and each error message the same.

## Hot paths

The product hot paths are the CLI `build`, `check`, and `watch` commands, the language server request loop, and the playground compile and startup. The development hot paths are `deno task check`, which runs before each commit, and `deno task mutate`, which runs after each change of logic.

## Scan method

`deno lint --rules-include=no-await-in-loop` over `src`, `playground`, `scripts`, `bench`, `tests`, and `editors/vscode/src` found 101 awaits in loops, in 34 files. A manual read of each `await` outside a loop in `src`, `playground`, and `scripts` found the remaining candidates.

## Findings that stay sequential

The product source has no unnecessary sequential await. The compiler core is synchronous behind a synchronous IO port. The CLI awaits only `deno check`, which reads the build output. The language server reads frames from standard input in order.

| Site | Reason |
| --- | --- |
| `src/cli/main.ts` watch loop, `src/host/events.ts`, `src/host/deno_io.ts` | Event-driven loops. The debounce window is 100 ms, and a round without `--tsc` is synchronous. |
| `bench/` (57 findings) | A measurement must run alone. Concurrent runs change the timings. |
| `scripts/mutate.ts` worker body | Each worker restores its file before the next mutant. The workers already run in parallel. |
| `scripts/release.ts`, `scripts/coverage.ts` | Release-only. Concurrent test suites fail the timing-sensitive watch test. |
| `scripts/behavior_compare.ts` `treeOf` pair | The memoized export of the head revision already starts in the other `records` call. |
| `playground/src/app.ts` replay fetch, `scripts/rules_unfired.ts`, `scripts/site_ir.ts` | Not on a hot path. |
| `tests/installation_slow_test.ts` two `packageRelease` calls | Both write the same output directory and run `npm ci` in the same directory. |
| `tests/task_permissions_slow_test.ts` | Both builds write the same project directory. |
| Polling loops, timed replays, ordered protocol frames, ordered UI steps | The order is the behavior under test. |

## Units

| Unit | Files | Change | Outcome |
| --- | --- | --- | --- |
| CA1 | `tests/target_helpers.ts` | `runStrictTarget` starts `deno check` and `deno run` at the same time. | Rejected. The slow suite got slower. A comment at the loop records the reason. |
| CA2 | `scripts/package.ts` | `packageRelease` starts `npm ci` and the two `deno bundle` runs at the same time. It waits for all three, then reports the first failure in the old order. | Reverted. Concurrent `deno bundle` runs on an empty cache race in the slow suite. |
| CA3 | `scripts/mutate.ts` | `makeCopies` extracts all worker copies at the same time. | Landed. |
| CA4 | `tests/parse_chain_slow_test.ts` | The five cold probes run at the same time. | Reverted. No gain for the suite, which shares one fresh cache. |
| CA5 | `tests/application*_slow_test.ts` | `deno check` in parallel with `deno test`. | Rejected. No gain with a warm cache, and slower with a fresh cache. |
| CA6 | `tests/docs_test.ts`, `tests/core_boundary_test.ts` | Concurrent file reads. | Rejected. The two files run 11 tests in 128 ms. |
| CA7 | `tests/cli_slow_test.ts` | Move nine `build --tsc accepts` tests to a second file, so that two workers run them. | Rejected. No gain under the measured load. |

## Evidence

Each comparison alternates the base commit `22f1aa9` (A) and the changed tree (B). The machine has 14 cores. Other projects loaded it during all runs, so each row gives the load average.

| Unit | Command | A (s) | B (s) | Load |
| --- | --- | --- | --- | --- |
| CA1 | `deno test -A tests/strict_target_slow_test.ts` | 12.55, 11.83, 12.03 | 11.73, 10.36, 10.48 | 6-7 |
| CA1 | `deno task test:slow`, CA1 only | 39.18, 41.31 | 45.14, 46.73 | 13-28 |
| CA2 | `deno test -A tests/installation_slow_test.ts` | 3.88, 1.62, 2.46 | 1.21, 1.43, 1.12 | 7-8 |
| CA3 | four `tar -xf` extractions of the `HEAD` archive | 0.397, 0.473, 0.428, 0.422, 0.400 | 0.212, 0.208, 0.168, 0.205, 0.170 | 7-8 |
| CA4 | `deno test -A tests/parse_chain_slow_test.ts` | 1.85, 0.29, 0.28 | 0.12, 0.12, 0.12 | 8 |
| CA5 | application integration test, warm cache | 2.33, 0.81, 0.77 | 0.87, 0.86, 0.83 | 9 |
| CA5 | application integration test, fresh `DENO_DIR` | 3.50, 3.50, 3.42 | 3.83, 4.05, 3.55 | 8 |
| CA7 | `deno task test:slow` | 48.95, 45.45 | 49.84, 53.81 | 24-32 |

CA1 is faster for one file alone, but slower for the whole suite. With CA1, user CPU stayed at about 275 s, and system CPU went from 42-51 s to 88-94 s. The probable cause is contention between the two `deno` processes on shared cache or lock files. A system-call profile of one strict-target case can confirm it.

The slow suite runs 58 files on 14 workers. The sum of the test times is 402 s, and the longest file, `tests/cli_slow_test.ts`, takes 36 s. Under the measured load, neither more concurrency in a file (CA1) nor a split of the longest file (CA7) made the suite faster.

CA2 and CA4 do not change the time of `deno task check`, because their files take 4.0 s and 0.5 s of a 40-50 s suite. CA3 saves about 0.2 s at the start of each `deno task mutate` run with four workers.

CA2 then failed the third gate. In `tests/installation_slow_test.ts`, one `deno bundle` stopped with "failed to copy esbuild binary", because the source file under the npm cache of the fresh `DENO_DIR` was missing. All slow test files share that one cache, and `tests/playground_build_slow_test.ts` also runs `deno bundle`. A stress loop ran several `deno bundle` processes at the same time on a new, empty `DENO_DIR` in each round. With two processes, 0 of 10 rounds failed. With four processes, 1 of 10 rounds failed with the same error. So concurrent bundles on a cold cache race inside Deno, and CA2 raised the number of such bundles in the suite. CA2 was reverted. CA4 was reverted too, because it gives the suite no gain and also starts concurrent processes on the shared cold cache.

The race existed before this plan. After the reverts, the next gate failed in `tests/playground_build_slow_test.ts` with the same error, because its `deno bundle` ran at the same time as the bundle of `tests/installation_slow_test.ts`. That gate flake is open. One possible fix is a warm-up `deno bundle` in `scripts/test_slow.ts` before the tests start.

## Mutation

`deno task mutate --only` ran on the two changed conditions. The fast suite did not kill the two mutants of the `settleInOrder` condition in `scripts/package.ts`, and a run with `--tests tests/installation_slow_test.ts` killed both. The revert of CA2 removed `settleInOrder` and its two `slow-only` register rows.

The `makeCopies` condition in `scripts/mutate.ts` survives, and no test kills it. The old loop had the same unregistered condition. The module has no register rows, and all 12 sites of a `--sample 12` run survived the fast suite, because `tests/mutate_slow_test.ts` is a slow file. That gap is open and out of the scope of this plan.
