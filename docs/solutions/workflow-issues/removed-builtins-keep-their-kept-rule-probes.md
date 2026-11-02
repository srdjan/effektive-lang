---
title: A builtin removal keeps the tests that probe kept rules
date: 2026-11-02
category: workflow-issues
module: src/core prelude builtins and their tests
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A change removes prelude builtins, IR kinds, or source types"
  - "A subagent deletes the tests and docs of a removed family"
  - "A test names a removed builtin but asserts a channel, data-only, borrow, lifetime, or call-only rule"
tags: [builtin-removal, probe-test, kept-rule, unknown-name, docs-grep, simplification-rebase]
---

# A builtin removal keeps the tests that probe kept rules

## Context

The simplification rebase of 2026-11-02 removed 63 unused prelude names and 64 IR expression kinds in seven groups, G1 to G7. Subagents did the deletions. Each brief said: "a test that uses a removed name only as a probe of a kept rule must stay, with a kept name as the probe". Executors deleted such tests anyway, in G3, G5, and G7. The orchestrator found each gap only in review.

Two examples from this session:

- The rule "a `forkScoped` child outlives its spawning fiber" had its only runtime test inside the fiber-handle tests (`withFiber`), which G5 removed.
- The runtime test of `bufferStream` was inside a `mergeStreams` test, which G7 removed.

Executor handbacks also reported docs as updated when one stale mention remained. After G4 removed `Codec`, the data-only row of `docs/language-rules.md` still said "Codecs". The G7 review found it.

## Guidance

Before you delete a test that names a removed builtin, name the rule that its assertion checks. If the rule stays, rebuild the test with a kept builtin as the probe. Examples of kept rules are channel combination, data-only results, borrowed captures, buffer bounds, concurrency bounds, call-only builtins, deferred channels, and scope lifetimes.

Prove that the rebuilt test guards the rule. Break the rule in the source and run the test: it must fail. For example, emit `Effect.forkChild` in place of `forkScoped`. The rebuilt test in `tests/emit_concurrency_slow_test.ts:441` then waits forever. Alternatively, run `deno task mutate --only <path:line>` on the site of the rule.

Pin the removal itself. Add a `tests/removed_<family>_names_test.ts` that asserts the exact unknown-name diagnostic for each removed name, and a test that a module can declare those names again. Six such files exist, one for each group except G1.

After each group, search the live docs for every removed name. The live docs are everything outside `docs/archive/` and the dated draft notes of the website spec. Do not accept a handback's claim that the docs are current.

## Why This Matters

A deleted probe test removes the only check of a kept rule, and the gate stays green. The fast and slow suites still pass, and coverage falls only a little. In this rebase, branch coverage fell from 95.38% to 95.04% against a floor of 95. Only a review of each deleted test name, or a mutant of the kept rule, shows the gap.

## When to Apply

Apply this to each removal of a builtin, an IR kind, or a source type, and to each delegation of such a removal to a subagent. Put the check in the orchestrator's review, not only in the brief.

## Examples

The G5 executor deleted the fiber tests, and with them the only lifetime test of `forkScoped`. The rebuilt test puts the spawner in a concurrent `all` record. Then the spawning fiber ends before the child:

```
all({ spawner: defer(() => { forkScoped(defer(() => Child.run())); 1 }), other: defer(() => 2) }, { concurrency: "unbounded" })
```

A first rebuild used `race`. It failed with `type-mismatch/010` and `/012`, because the racers had different requirement sets. A concurrent `all` record accepts members with different requirements.

The G7 executor deleted the `mergeStreams` tests. The rebuilt test "a buffered stream defers production and keeps the source order" (`tests/emit_stream_slow_test.ts:316`) keeps the runtime check of `bufferStream`.

## Related

- [Test an equivalent mutation row against a mutated copy](mutation-equivalent-rows-need-a-differential-probe.md)
- [The archived rebase plan and its ledger](../../archive/plans/2026-11-02-simplification-rebase.md)
