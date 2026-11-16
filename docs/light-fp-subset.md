# Working with the Light FP TypeScript subset

These notes record the ongoing `0.8.0` migration. They are not a completed skill.
The [adoption plan](plans/2026-11-16-light-fp-adoption.md) owns execution and acceptance.
Examples below passed focused checks. The integrated migration remains incomplete.

## Own mutable collections explicitly

A readonly view can describe data while a capability owns its native collection.
A capability is a record of operations that controls access to state.
Keep native maps and arrays inside the owner. Return the actual owner or the operation result.
Callers must consume that returned value.

`createBodyBuilder` in `src/core/tables.ts` owns side tables.
`createReport` in `src/core/validate/report.ts` owns diagnostics.
Their write methods return their owning capability. Their read methods expose readonly data.
The native `Map.set` result can update a local binding: `entries = entries.set(key, value)`.
This retains native collection behavior without a mutable data alias.

A generic helper that changes a buffer and returns an unrelated supplied state token does not establish ownership.
The first ValueBuffer design used that pattern. The winning parser factory owns native arrays directly. No ValueBuffer remains.
Do not remove readonly modifiers through a mapped type.
Do not hide mutable data behind a type-only ReturnType helper.

## Return the real accumulated result

A traversal can return a count, a set, or the first matching expression.
`walkExpr` in `src/core/emit/walk.ts` now carries that result explicitly.
Tests consume a numeric count or the collected expression kinds.
An unused binding does not make an ignored result meaningful.

Some compiler operations must retain diagnostics while discarding an invalid type's value.
TypeLowerer uses a specific result containing the owning lowerer and the lowered value.
The invalid-argument path consumes the owner, which holds those diagnostics.
This pattern requires review of actual ownership. An arbitrary state token is insufficient.

## Preserve argument presence

A missing native argument can differ from an explicit undefined argument.
Deno returned `2` for `[1, 2, 1].lastIndexOf(1)` and `0` with explicit undefined.
Deno returned `[2, 3]` for `[1, 2, 3].splice(1)` and `[]` with explicit undefined.
The first general caller script changed native calls and caused a test failure.
The correction limits insertion to new required parameters in migrated core declarations.
Review each omitted parameter's original default before changing its callers.

## Preserve strict boolean checks

A truthy value can change a malformed input's meaning.
Replacing an exact true check with truthiness enabled forged schema and nominal flags.
Public tests reproduced both failures before correction.
Type narrowing now retains the exact boolean behavior.
The tests are in `tests/schema_presence_test.ts` and `tests/types_test.ts`.

## Keep the original termination condition

A bounded iterator does not replace a scanner's original end condition.
The first lexer rewrite let unterminated strings and line comments continue beyond the input.
Public regression tests reproduced both failures before correction.
Each scanner now checks the input end inside its bounded loop.
The 20,000-input lexer snapshot passes with unchanged expected data.
A separate duration test requires a nonempty suffix before treating an integer as a duration.

## Measure the resulting design

Zero lint diagnostics do not establish behavior or performance.
The rejected owner-buffer parser matched 190 complete fixtures and the prefix oracle.
Eight paired samples measured 92.74-97.13 ms against the original 35.77-40.43 ms.
The winning direct-array factory preserves those outputs and passes 45 parser tests.
Preliminary paired timing samples remain slower than the original. Host load limits the timing evidence.
The lexer uses dynamic native arrays and converts the final output into typed arrays.
Ten 16 MiB comment runs measured median peak RSS of 60,424,192 bytes, against the original 65,658,880 bytes.
These values measure the process, including its runtime. They do not isolate allocations from the lexer.
Keep efficient native collections. Avoid repeated array spreads in a growing accumulator.

## Keep native primitives small

`src/core/runtime.ts` constructs native collections and exposes deterministic native operations.
Compiler algorithms stay in their domain modules.
A prelude header must not hide arbitrary compiler algorithms.
A private invariant brand separates expected emitter and lowerer faults from unrelated exceptions.
The public entries retain their Result behavior and rethrow unrelated faults.

## Preserve stack and queue behavior

A linear recursive rewrite can overflow where an iterative algorithm succeeds.
Public tests reproduce span lookup and predicate guard failures with 20,000 levels.
Span lookup now uses bounded iteration. Predicate guards use the native inherited-property check.
A prototype walk must preserve inherited properties without recursive JavaScript calls.
A work queue can grow during traversal. A snapshot of its initial length loses appended imports.
The project loader uses the live native array iterator. A 10,000-module project test covers the traversal.

## Compare replacement parsers with the original grammar

A manual parser must preserve the exact accepted language of a removed regular expression.
Review found mismatches in diagnostic severity, identity prefixes, and line terminators.
Public regression tests failed before correction. A differential corpus compares 4,917 cases with the original behavior.
The cases preserve embedded severity text and reject the original forbidden identity forms.

## Use honest layer declarations

A genuine host or test adapter can use the adapter layer. Pure compiler algorithms keep strict rules.
The native prelude exposes small native operations. It does not hide compiler logic.
The frontend facade exports shared primitives for strict browser modules, preserving the existing boundary test.
