---
title: Census the mutation register to find stale rows without a mutation run
date: 2026-11-07
category: workflow-issues
module: scripts/mutate.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A deno task mutate run prints stale register rows after a change"
  - "A refactor changes code inside a declaration that has a register row"
  - "A reviewer must know if a stale row predates the change under review"
tags: [mutation, survivor-register, stale-row, census, worktree]
---

# Census the mutation register to find stale rows without a mutation run

## Context

A row of `fixtures/mutation/survivors.json` identifies its mutant by file, declaration, offset, operator, and text (`keyOf`, `scripts/mutate.ts:368`). The offset counts from the start of the declaration. A row is stale when it does not match exactly one site (`scripts/mutate.ts:420`).

`deno task mutate` checks staleness only for the files that the run scans (`scripts/mutate.ts:33`). A row of a file that nobody mutates again can thus stay stale for a long time.

Plan KN (`docs/archive/plans/2026-11-07-untangle-knots.md`) refactored 13 knots. After each refactor, two questions came up. Did the refactor move a register row? Did a stale row that a run printed exist before the change? A whole-module mutation run answers these questions for one file only, and it takes minutes.

## Guidance

`matchRegister` is a pure function. Give it all sites of each register file and an empty survivor list. Its `stale` list is then the full set of stale rows. No mutant runs.

```ts
// Run from the repository root:
// deno run --allow-read --allow-env census.ts
import { matchRegister, mutantsOf, parseRegister } from "./scripts/mutate.ts";

const text = Deno.readTextFileSync("fixtures/mutation/survivors.json");
const register = parseRegister(text);
if (!register.ok) throw new Error(register.error);
const files = [...new Set(register.value.map((row) => row.file))];
const sites = files.flatMap((file) => mutantsOf(file, Deno.readTextFileSync(file)));
const { stale } = matchRegister(sites, [], register.value, files);
for (const row of stale) {
  console.log(row.file, row.declaration, row.offset, row.text);
}
```

The `--allow-env` permission is necessary, because `scripts/mutate.ts` loads the TypeScript compiler. Keep the script out of the commit, for example in the gitignored `demos/` directory.

Run the census at the base commit and at the head. Use a detached worktree for the base. A row that is stale at the head but not at the base is stale because of the change. Move only that row to its new site. Report the other stale rows as earlier debt.

## Why This Matters

Without the census, an agent can blame its change for old stale rows. It can also miss a row that its change moved. On 2026-11-07, the census found both cases on branch `untangle-knots`:

- Main had 51 stale rows in 7 files: 20 in `scripts/mutate.ts`, 17 in `src/core/editor_actions.ts`, 6 in `src/core/types.ts`, 4 in `scripts/behavior_compare.ts`, 2 in `src/core/check_builtins/schema.ts`, 1 in `src/core/resolve.ts`, and 1 in `src/core/check_binary.ts`.
- A `deno task mutate` run of `src/core/editor_actions.ts` reported the same 17 stale rows as the census.
- Knot KN8 replaced a cycle test in `scheduleRuns` (`src/core/check_project.ts`) with a call to `isCycle`. The code before the row got 45 characters shorter, so the row offset moved from 2797 to 2752. Main had no stale row there, so the branch caused this one.

The census read 26 files and 130 rows in 3.5 s of wall time. That time includes the start of Deno and the load of the TypeScript compiler. A whole-module mutation run of one file can take minutes. For an example, see `mutation-baseline-diff-finds-new-survivors.md`.

## Prevention

A test that asserts an empty stale list for all register files would stop the drift. This test is a recommendation, not done work. It cannot pass now, because 50 rows are stale at the head of `untangle-knots`. Someone must first check each stale row and its reason again. Measure the run time of the test before you put it in the fast suite or the slow suite.

## When to Apply

Run the census before you act on a stale row that a mutation run prints. Also run it after a refactor that changes code inside a declaration with a register row. For new survivors, as opposed to stale rows, see `mutation-baseline-diff-finds-new-survivors.md`.
