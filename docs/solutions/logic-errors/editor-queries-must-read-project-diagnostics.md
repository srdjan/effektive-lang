---
title: Editor queries must read the project diagnostics, not the list of the checked module
date: 2026-11-04
category: logic-errors
module: src/core/editor_hints.ts and src/core/editor_actions.ts
problem_type: logic_error
component: tooling
symptoms:
  - "A function whose body has an unknown name (`unknown-name/001`) still gets an inlay hint, such as ` fails Stop`"
  - "The same function, with a written `fails` clause that misses an entry, still gets the quick fix \"Add missing fails entries\""
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [editor, inlay-hints, quick-fix, contract-actions, diagnostics, resolver, unknown-name, checked-module, single-owner]
---

# Editor queries must read the project diagnostics, not the list of the checked module

## Problem

The inlay hint and the contract actions must skip a function that has a diagnostic inside its span, because the inferred effect sets of a broken body are unreliable. They read `revision.checkedModuleAt(path).diagnostics`. That list does not hold resolver diagnostics, such as `unknown-name/001`. So a function with an unknown name got a hint and a quick fix from an unreliable set.

## Symptoms

- `type Int = int`, `error Stop = {}`, and `export const f = (): Int => if (missing) { fail(Stop({})) } else { 1 }` gave the hint ` fails Stop` and one `unknown-name/001` diagnostic.
- With `fails Other` written and `fail(Other({}))` in the else branch, `contractActionsAt` offered "Add missing fails entries".
- `docs/editor.md` states that a function with a diagnostic inside its span has no hint. The code broke that rule.

## What Didn't Work

Plan WF (`docs/archive/plans/2026-11-04-write-inferred-fails.md`) told the new `failsClauseActionsAt` to skip a function "as for the inlay hint". The orchestrator, a Fable plan validator, and the original hint code all assumed that the list of the checked module is complete. Nobody checked which diagnostics it holds.

The gap became visible only through a test. Case W10 of the plan gives a function an unknown name in its body and expects no action. While the new query read the module list, W10 still got a `fails never` action (finding WFF9 of the plan).

## Solution

`diagnosticInside(revision, path, span, ignored)` (`src/core/editor_hints.ts:47`) reads `revision.diagnostics` and keeps the entries whose source is the file and whose span lies inside `span`. `inlayHintsAt`, `contractActionsAt`, and `failsClauseActionsAt` all call it. `contractActionsAt` passes its two contract codes as `ignored`, because those are the diagnostics that it repairs.

```ts
// Before: misses resolver diagnostics.
module.diagnostics.some((d) =>
  d.span.start >= signature.span.start && d.span.end <= signature.span.end
);

// After: the project list, filtered by file.
diagnosticInside(revision, module.path, signature.span);
```

## Why This Works

`CheckedModule.diagnostics` holds the declaration and body diagnostics of one module (`src/core/check_project.ts:113-114`). The resolver reports name errors to the project list only. `CheckedProject.diagnostics` holds all diagnostics of the project (`src/core/check_project.ts:123-124`), and `Revision.diagnostics` returns that list (`src/core/db.ts:174-177`). A syntax error inside a function also leaves the module list empty, but the declaration is then broken, and each query skips a broken declaration through the module index. Lowering already reads both lists before it accepts a module: `CheckedProject.blocked` (`src/core/check_project.ts:126-130`) counts them, and lowering reads it at `src/core/lower.ts:1601-1604`.

## Prevention

- The mistake is possible because two lists answer "which diagnostics does this file have", and only one is complete. One owner would remove it: rename `CheckedModule.diagnostics` so that its name says it holds only checker diagnostics, or give the checked module the complete list. That change belongs to the owner of `src/core/check_project.ts`, and it is not done.
- A new editor query that gates on "no diagnostic in this span" calls `diagnosticInside`. It does not read the module list.
- A test of such a gate uses a body with an unknown name, such as `missing`, and asserts that the query gives nothing.
- Three tests hold the rule today: "inlay hints skip a function with an unknown name" (`tests/editor_queries_test.ts`), "contract actions: an unknown name in the body blocks the action", and "fails clause: W10 a function with a body error gives no action" (`tests/editor_actions_test.ts`).
