---
title: Diff the survivors of the base and the head to find new mutation survivors
date: 2026-11-03
category: workflow-issues
module: scripts/mutate.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A whole-module deno task mutate run lists unregistered survivors after a change"
  - "A change alters semantics, so an old test can pass for a different reason"
  - "A run with --only on the changed lines exits 0, and the rest of the module is unknown"
tags: [mutation, survivor-register, baseline, weakened-test, worktree]
---

# Diff the survivors of the base and the head to find new mutation survivors

## Context

Plan EI (`docs/archive/plans/2026-11-03-inferred-export-failures.md`) changed the language semantics. An exported function stopped closing its `fails` set. Unit EIU6 ran `deno task mutate` with `--only` on the changed lines. Each changed line was then killed or registered.

Whole-module runs told a different story. Several changed modules listed unregistered survivors, for example 15 in `src/core/check_declarations.ts`. The executor could not tell old survivors from new ones. It ran out of its turn budget before it knew.

One survivor was new. In `src/core/editor_actions.ts`, the test "contract actions: a body error that ends the function blocks the action" used an export without a `fails` clause. After the change, that export had an open set. The test still passed, but for a different reason, so a mutant of an unchanged line survived. A run with `--only` on the changed lines cannot see this, because the weakened test guards an unchanged line.

## Guidance

Run the same whole-module mutation at the base commit and at the head, one run after the other, and diff the survivor lines without their line numbers. Only a line that the head adds needs a test or a register row.

```bash
S=~/.claude/scratch/<name>
git worktree add --detach $S/base <base-commit>
git worktree add --detach $S/head <head-commit>
(cd $S/base && deno task mutate --sample all src/core/check_declarations.ts > $S/base.log 2>&1)
(cd $S/head && deno task mutate --sample all src/core/check_declarations.ts > $S/head.log 2>&1)
for x in base head; do
  sed 's/\x1b\[[0-9;]*m//g' $S/$x.log |
    grep -E '^\s*src/core/check_declarations.ts:[0-9]+' |
    sed -E 's/check_declarations.ts:[0-9]+(:[0-9]+)?//' | sort > $S/$x.surv
done
diff $S/base.surv $S/head.surv
git worktree remove --force $S/base
git worktree remove --force $S/head
```

A survivor line has the form `src/core/check_declarations.ts:265 boolean-return: return false; -> true`. The line number moves when the change adds or removes lines above it, so the diff drops it. The operator and the code text identify the mutant.

The tool reads the committed `HEAD` of its directory, so each revision needs its own worktree. Both runs exit 1 when old survivors have no register row, so read the survivor lines, not the exit code.

Run the two revisions one after the other, not at the same time. On 2026-11-03, `check_declarations.ts` had 254 sites. The base run took 147 s and the head run 155 s, while no other mutation run was active.

For plan EI, the diff showed the same 15 survivors at `7d5adc2` and `8587f91`. So the change weakened no test of `check_declarations.ts`. The executor found equal counts for `editor_hints.ts`, `type_show.ts`, and `check_project.ts` the same way.

## Prevention

A `--baseline <commit>` option in `scripts/mutate.ts` could run both revisions and report only the new survivors. This tool change is a recommendation, not done work.

## When to Apply

Use the diff after a change that alters the meaning of an existing rule, when a whole-module run lists unregistered survivors. A pure rename rarely weakens a test, so `--only` on the changed lines is usually enough for it. For a mutation row of class `equivalent`, see `mutation-equivalent-rows-need-a-differential-probe.md`.
