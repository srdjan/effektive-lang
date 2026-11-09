---
title: Work that only the program memo reads must stay out of the shared module step
date: 2026-11-06
category: performance-issues
module: src/core/check_project.ts and src/core/db.ts
problem_type: performance_issue
component: type_checker
symptoms:
  - "The `check` stage of bench M2 was 15 to 20 percent slower than at the base, at every project size"
  - "All tests and `deno task behavior:compare` stayed green"
  - "A sequential quick bench at machine load 68 to 100 flagged no row"
root_cause: misplaced_computation
resolution_type: code_fix
severity: medium
tags: [bench, m2, performance, regression, bisect, noise-floor, alternating-runs, payload-hash, program-memo, check-project]
---

# Work that only the program memo reads must stay out of the shared module step

## Problem

`driveProject` runs one module step for the fresh check (`checkAnalysis`) and for the incremental `Program`. A refactor moved the interface payload hash into that shared step. So the fresh check paid for a hash that only the `Program` memo reads, and its `check` stage became 15 to 20 percent slower.

## Symptoms

- Bench M2, four base runs and four head runs in alternation at load 6 to 11, separated the `check` row at every size. Small went from 1.03-1.09 ms to 1.23-1.27 ms, and medium from 5.46-5.90 ms to 6.58-6.83 ms. Large went from 48.7-55.4 ms to 58.2-61.1 ms.
- No other stage row separated. The `lower` stage did not get faster, so no work had moved from `lower` into `check`.
- No test, no behavior record, and no diagnostic changed.

## What Didn't Work

- A sequential quick bench (`deno task bench --quick m1 m2 m6`, two base runs and then two head runs) at load 68 to 100 flagged 0 of 110 rows. The per-row noise floors were 22 to 2278 percent, so a 20 percent change stayed inside them.
- Five base and five head M2 runs under the same load also separated no row. The large `check` median ratio was 1.15, but the ranges overlapped.
- A second bisect looked for a residual of about 2 percent after the fix. It blamed a commit that changes only a plan document. That commit has the same `src` and `bench` as its parent, which the bisect had passed. So one bisect step of three alternating pairs has an A/A floor of at least 1.8 percent, and the residual stayed unlocalized.

## Solution

The module step returns only the checked module and its type graph (`src/core/check_project.ts:551`). The memo computes the payload hash itself, at the two points where it records an entry. These are a fresh check and an interface refresh (`src/core/db.ts:404` and `src/core/db.ts:416`):

```ts
// src/core/db.ts:132
function payloadOf(step: ModuleStep, fallback: string): string {
  const built = step.checked.interface;
  return built.ok ? payloadHash(built.value.payload) : fallback;
}
```

Before the fix, `withInterface` in `check_project.ts` computed `payloadHash(built.value.payload)` for every module and stored it on the step. `payloadHash` is the FNV-1a 64 of the canonical JSON of the whole payload with its spans (`src/core/interface.ts:96`).

The cause was found with a timer of only the medium `check` stage. The timer imports `runM2` from the `bench/m2.ts` of each tree. It runs one size with 60 iterations and 15 warm-ups, and with no incremental path. Then it prints the median of the `check` samples. Its code is in the section "The check-only timer" of the evidence file below. Each bisect step timed the base and the candidate in alternation, two runs each, and marked the candidate slow above a ratio of 1.085. Eight steps over 152 commits found one step: every earlier commit gave 1.000 to 1.008, and the culprit gave 1.19.

To prove the cause, a three-way run timed the base, the culprit commit with only its eager hash line removed, and the fixed tree. In four rounds at load 4.8 to 6.5, the culprit without the hash was within 0.6 percent of the base. The fixed tree gave medians of 5.50-5.64 ms against 5.43-5.49 ms at the base.

## Why This Works

The fresh check and the program memo share the driver so that both give the same checked result. The payload hash is not part of that result. It is a memo key: it decides when an importer must lower again after a span move. Only `Program` has importers to lower again. When the hash lives in the memo, the fresh path does no work for a key that it never reads. The memo still computes the same value at the same two points, so the memo keys do not change. A fault that replaces the hash with the fallback makes 13 fast tests fail, in `tests/db_test.ts`, `tests/incremental_property_test.ts`, `tests/output_characterization_test.ts`, and `tests/revision_isolation_test.ts`.

## Prevention

- Before you move a value into `checkModuleStep`, `withInterface`, or `driveProject`, name each reader of the value. If only `Program` in `db.ts` reads it, compute it in the memo policy, not in the step.
- After a refactor of a shared path, compare the base and the head with bench M2 in alternation. Use at least four runs on each side, and record the load with each run. Do not accept a sequential quick bench under high load as evidence of "no slowdown". A loaded machine widens the noise floor of each row, and a real change stays inside it.
- To find the commit, time only the slow stage, with a timer that imports the bench module of each tree. Alternate base and candidate inside each step. Set the threshold at the midpoint between 1.00 and the measured ratio.
- Measure the A/A floor of one bisect step before you bisect a small difference. If two trees with the same code differ by more than half the difference, the bisect cannot localize it. Then report the difference as unsettled.
- No test can hold this, because the defect is only a cost. A test of whether the fresh path computes the hash would assert private calls. The bench is the check.

## Related Issues

- `docs/solutions/workflow-issues/measure-the-whole-slow-suite-before-adding-concurrency.md` teaches the same alternating A/B discipline for the wall time of the slow suite.
- `docs/measurements.md` defines M2 and the M6 noise floor.
- The full run data, the bisect logs, and the three-way timing are in `docs/archive/plans/2026-11-06-untangle-codebase-evidence/bench.md`.
