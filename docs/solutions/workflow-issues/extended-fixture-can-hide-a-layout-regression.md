---
title: A changed record of an extended fixture can hide a regression
date: 2026-11-09
category: workflow-issues
module: scripts/behavior_compare.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A change adds declarations to a fixture and also changes the compiler"
  - "behavior:compare reports one changed record, and that record is the extended fixture"
  - "An emitter change adds new layout cases to fixtures/emit/forms/forms.eff"
tags: [behavior-compare, fixture, emitter, layout, regression, oracle]
---

# A changed record of an extended fixture can hide a regression

## Context

`deno task behavior:compare <base> <head>` gives one record for each fixture
program. When a change adds declarations to a fixture, the record of that
fixture changes. This change is expected. But the same record also changes when
the compiler changes the output of an old declaration. One "changed" line
cannot show which of the two occurred.

On 2026-11-09, unit PHU2 added five local curried closures to
`fixtures/emit/forms/forms.eff` and changed the layout code in
`src/core/emit/expr.ts` (`5a6879c`). The comparison reported only
`changed: emit emit/forms#forms`. The change also put the type annotation of
the old `adder` binding in `wideLocalChain` on seven lines instead of one. Both
layouts pass `deno fmt --check`, so the fixed-point test in
`tests/emit_slow_test.ts` did not fail.

## Guidance

When the changed record is a fixture that the change extended, build the base
version of that fixture with both compilers, and compare the outputs:

```sh
S=~/.claude/scratch/formscheck
mkdir -p $S/base $S/in-base $S/in-head
git archive <base> | tar -x -C $S/base
git archive <base> fixtures/emit/forms | tar -x -C $S/in-base
git archive <base> fixtures/emit/forms | tar -x -C $S/in-head
(cd $S/base && deno run -A src/cli/main.ts build $S/in-base/fixtures/emit/forms --no-log)
deno run -A src/cli/main.ts build $S/in-head/fixtures/emit/forms --no-log
command diff -r -q $S/in-base $S/in-head
```

Equal outputs show that the changed record comes only from the added
declarations. A difference names the old declaration that the change moved.
Then pin its old layout with a test that fails first, and fix the compiler.

## Why This Matters

A layout change of an old declaration is a regression even when `deno fmt`
accepts it. The emitter must keep every other output the same. Without this
check, the reviewer reads the changed record as the effect of the new cases.

## When to Apply

- A unit changes the compiler and adds cases to the fixture that tests it.
- `behavior:compare` reports a changed record for that fixture and nothing else.

## Examples

The fix `0c7673b` moved the prefix of `chainDeclaration` into each layout
option. The printer measures each `alt` option in flat mode, so a type
annotation printed before the choice broke on its own. The test "an arrow
chain that is too long moves below the equals sign" in `tests/emit_test.ts`
now pins the one-line annotation of `adder`. After the fix, the base
`forms.eff` emitted the base output byte for byte.

A golden file of the emitted `forms.ts` would catch this class in the gate. It
needs a change to `scripts/golden_update.ts`, so it was not added.

## Related

- `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`
  covers the retired `behavior:capture` task.
- `docs/archive/plans/2026-11-09-prune-harden.md`, Section 11, records the finding.
