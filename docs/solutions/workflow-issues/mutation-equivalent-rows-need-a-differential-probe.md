---
title: Test an equivalent mutation row against a mutated copy
date: 2026-11-01
category: workflow-issues
module: scripts/mutate.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A mutation survivor seems to need a register row of class equivalent"
  - "A proof of equivalence is a case analysis of source lines"
  - "The mutated code is near MAX_DEPTH or any other bound"
  - "Subagents close a batch of survivors with deno task mutate"
  - "A test that kills a survivor would pin a behavior that looks wrong"
  - "A differential probe shows no difference between the source and a mutant"
tags: [mutation, survivor-register, equivalent-mutant, differential-probe, depth-bound, forged-ir, private-clone, reach-count]
last_updated: 2026-11-07
---

# Test an equivalent mutation row against a mutated copy

## Context

`deno task mutate` lists survivors, and `docs/testing.md` asks for a test or a register row for each one. The class `equivalent` means that no input can observe the change. A row does not run, so the gate cannot detect a wrong proof.

In the work of 2026-11-01, a subagent registered survivor MUS101 as equivalent. Its case analysis read correctly, and it said that a nested type past `MAX_DEPTH` was its only doubt. A probe against a mutated copy disproved the row. With 1,535 chained aliases, the source accepted a wrong literal pattern and the mutant rejected it.

The same probe found a real defect: `tagMayEqual` returned `true` at `MAX_DEPTH`, while other comparisons fail at that bound. The repair is `fdadb8d`. The false row would have hidden that defect, because a registered survivor stops asking for a test.

## Guidance

Before you accept an `equivalent` row, run the same inputs through the source and through a copy that holds the mutant. Then compare the output. Include an input at each bound near the code.

```bash
git archive HEAD src deno.json deno.lock | tar -x -C <scratch>/orig
git archive HEAD src deno.json deno.lock | tar -x -C <scratch>/mut
# Apply the one-token mutant to <scratch>/mut. Assert that the old text occurs once.
for x in orig mut; do
  deno run --no-check --allow-read --allow-env --config <scratch>/$x/deno.json \
    probe.ts <scratch>/$x > <scratch>/$x.txt 2>&1
done
diff <scratch>/orig.txt <scratch>/mut.txt
```

`probe.ts` imports `src/core/mod.ts` from the directory that it receives, so one script serves both copies. Use `--no-check`, because some mutants do not pass the type check. Print a sanity row first: an input with a known rejection shows that the probe reaches the rule. An early probe here gave no difference only because each program stopped at an unrelated diagnostic.

A sanity row that reaches the rule does not show that the probe reaches the mutant. A mutant changes the result only for some inputs. For `A || B` changed to `A && B`, the result changes only when exactly one term is true. So make one more copy that keeps the source and logs each time the two expressions disagree:

```ts
if ((A || B) !== (A && B)) console.log("REACH", site);
```

Count the `REACH` lines. Zero lines means that the probe tested nothing, whatever the diff shows.

In the work of 2026-11-07, six language-server scenarios for the survivor `path === undefined || !project.published.has(path)` in `ProjectSet.#removeDeadProjects` gave no difference. The logging copy showed that none of them reached a defined path with no published entry. Two fixture mistakes kept the outer project out of that state. `Int` gave `unknown type`, and the `type Num = number` declarations of two modules were different types (`main#Num` and `sub/y#Num`). Each mistake gave the outer project a diagnostic for the path, so the project published an entry for it. After the fix, four of ten removal scenarios reached the case, and the outputs still matched.

A difference disproves the row, so write a test. No difference over a wide input set supports the row, but it does not prove it. Keep the proof in the row, and name the fact that it rests on. Do not cite a line number, because a line number goes stale.

A survivor can also show a defect. Do not write a test that pins the defect. Leave the survivor open, record the finding, and ask for a decision. After the repair, a test for the repaired behavior usually kills the survivor. Here, one test killed both open survivors.

These facts about the tool save time when you work on survivors:

- The tool swaps one operator token and adds no parentheses (`scripts/mutate.ts`). So normal precedence regroups the expression. A swap of the second `||` in `A || B || C || D` gives `A || (B && C) || D`. Only the two terms next to the token change.
- One forged input that makes a single term true kills the mutants on both sides of that term. So a chain usually needs fewer tests than survivors.
- The tool reads the committed `HEAD`. So give each batch a private clone of local `main`, and let it make scratch commits there. The orchestrator reviews the result, and it merges by a file copy. Each batch adds its own test file, so batches cannot conflict.
- A run with `--tests <file>` also lists mutants that the rest of the fast suite kills. Only a run without `--tests` is a true measure.
- A timeout counts as a kill. Repeat that line with `--only` before you accept it.

Hold `deno task check` until mutation runs finish. At a load average of 124 on 14 cores, `tests/watch_host_slow_test.ts` failed, and the same tree passed at normal load.

## When to Apply

Apply this to each `equivalent` row, and most of all to a row from a subagent or a row near a bound. The result of 2026-11-01 was 126 survivors in three modules, closed with 117 tests and 8 equivalent rows. One more site went away with the repair, and full mutation runs of the three modules exit 0.

## Related

- [`docs/testing.md`](../../testing.md): the mutation tool and the register rule.
- [`docs/archive/plans/2026-11-01-mutation-survivors.md`](../../archive/plans/2026-11-01-mutation-survivors.md): the plan, finding MUF1, and the ledger.
- [`docs/archive/plans/2026-11-07-project-rebinding.md`](../../archive/plans/2026-11-07-project-rebinding.md): the plan whose PBU3 probe needed the reach count.
- [`behavior-capture-hold-tests-constant.md`](behavior-capture-hold-tests-constant.md): the capture method for a change that alters behavior, which the repair used.
