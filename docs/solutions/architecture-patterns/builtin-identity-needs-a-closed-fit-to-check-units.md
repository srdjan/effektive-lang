---
title: A builtin identity over int is open by default, so a unit type needs a closed fit and its own operator rules
date: 2026-10-27
last_updated: 2026-10-27
category: architecture-patterns
module: src/core/types.ts, src/core/check_binary.ts, src/core/validate/typing.ts, src/core/validate/expr.ts, and src/core/emit/
problem_type: architecture_pattern
component: type_checker
severity: high
applies_when:
  - "You add a builtin type with identity whose purpose is to reject bare values, such as a unit or a currency"
  - "You expect a non-sealed identity to reject an unnamed int or number"
  - "You add a builtin identity that has no declaration in any module"
  - "You add a second closed unit type that combines with an existing one, as Instant combines with Duration"
tags: [type-identity, nominal, duration, instant, closed-identity, closed-unit-ids, operator-order, comparison, adoption, ni25, assignability, validator, emitter]
---

# A builtin identity over int is open by default, so a unit type needs a closed fit and its own operator rules

## Context

The ES1b unit added `Duration`, a builtin identity over `int` whose job is to
reject a bare number in a time position. The first plan relied on the existing
nominal rules. A plan validation found that those rules would have accepted
`timeout(job, 5)`, `scheduleSpaced(retries)` and `5s + 3` without a diagnostic,
so the type would have checked nothing.

Two existing rules cause this:

- **Implicit fit.** A named target takes an unnamed value through the body of an
  untagged identity when the identity has no predicate and the module "owns" it
  (`TypeTable.assignable`, `src/core/types.ts` near line 1237). "Owns" means
  `ownsSealed` (`src/core/types.ts:835-837`), which returns true for every identity that
  is not sealed. So a non-sealed identity accepts any unnamed `int` in any
  module. `docs/language-rules.md` documents this as "An unnamed value fits an
  untagged identity whose body it fits".
- **NI25 adoption.** `adoptedNumericIdentity` (`src/core/check_binary.ts:52`, validator
  mirror `src/core/validate/expr.ts:198`) gives `Identity op int` the identity type for
  `+`, `-` and `*`. So `5s + 3` would type as `Duration` and silently add 3
  milliseconds.

`sealed` does not fix it. A builtin id such as `type:effect/Duration` has no
`#`, so `moduleOfId` returns undefined, no module owns it, and sealing would
block the wanted widening from `Duration` to `int` and trigger the
foreign-sealed arithmetic errors.

## Guidance

Make the identity closed in both the checker and the validator, and give it its
own operator table that runs before NI25 adoption.

- Exclude the id from the implicit fit. The code keeps the closed ids in one
  set, `CLOSED_UNIT_IDS` in `src/core/ir.ts`, and tests
  `!CLOSED_UNIT_IDS.has(tn.id)` in `src/core/types.ts` (near 1269) and
  `!CLOSED_UNIT_IDS.has(t.id)` in `src/core/validate/typing.ts` (near 314).
  Widening from the identity to its base stays, because the id is not sealed.
  A new closed unit type joins the set instead of adding its own branches.
- Skip the id in both `adoptedNumericIdentity` functions, and add an explicit
  rule (`durationArithmetic` in `src/core/check_binary.ts` and in `src/core/validate/expr.ts`):
  `D+D`, `D-D` give `D`; `D+n` and `D-n` are a mismatch for any numeric `n`,
  including a non-integer `number` (the first implementation missed this case);
  `D*int`, `int*D` give `D`; `D/int` gives `D`; `D/D` gives `number`.
- Produce values of the type only from forms that carry the unit: the duration
  literal lowers to the existing `nominal` IR node, so the validator checks it
  like any construction and the IR needs no new kind.
- A builtin id has no declaration, so the emitter needs explicit cases:
  `nameOf` prints `number` (`src/core/emit/scope.ts` near 704), `resolve` reaches `int`
  so the `$int` overflow guard stays (`src/core/emit/scope.ts` near 668), and the
  `nominal` expression erases to its value (`src/core/emit/expr.ts` near 726). Without
  these, emission falls through to `Duration.make(...)`.
- `int / int` gives `number` in Effektive, so an integral division result needs
  its own emission: `Math.trunc` inside the int guard.

### A second closed unit type

The unit SL1 of the
[second selection plan](../../archive/plans/2026-10-27-second-effect-selection.md)
added `Instant`, which combines with `Duration`. A plan validation found that
the existing rules gave wrong results for it:

- An `Instant` widens to `int`, so `durationArithmetic` saw `Instant + Duration`
  as `int + Duration` and rejected it.
- The shared-identity rule of `operatorResult` typed `Instant - Instant` as
  `Instant`, not `Duration`.

The fix is an `instantArithmetic` rule that runs before `durationArithmetic`
and before the shared-identity rule, in the checker
(`src/core/check_binary.ts`, called near line 309) and in the validator
(`src/core/validate/expr.ts`). Order the unit rules from the type whose
operators produce the other type to the base type.

Comparisons need the same care. `comparisonClass` widens an identity to its
base, so `Duration < int` type-checked before SL1. A comparison with a closed
unit operand now needs two values of the same closed unit type
(`closedUnitsDiffer`, `src/core/check_binary.ts` near line 195, with a validator
mirror). That change broke one fixture, which now compares with `0ms`.

Tests that prove the type is closed must assert diagnostics for a bare literal,
an `int` variable, an `int` field read, `D + int` and `D + number`, in the
checker and through forged IR in the validator.

## Applicability

Use this pattern for any future builtin type whose value is to keep a bare
number out, such as a currency or a byte size. A user `type X = int` is itself
an identity, so a closed builtin type does not fit a user alias over `int`
implicitly. The constructor converts it: `Ms(d)` with `type Ms = int`, and
`n * 1ms` converts back. An earlier version of this note said that no
conversion existed; that was wrong
([leftovers plan](../../archive/plans/2026-10-27-effect-surface-leftovers.md)).
The general identity rules are in
[type-identity-is-a-flag-on-an-alias.md](type-identity-is-a-flag-on-an-alias.md).
