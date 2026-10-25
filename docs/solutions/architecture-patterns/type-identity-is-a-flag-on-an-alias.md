---
title: Type identity is a property of an alias, and a widened value takes no second name
date: 2026-10-24
category: architecture-patterns
module: src/core/types.ts, src/core/check.ts, src/core/check_expr.ts, and src/core/validate/typing.ts
problem_type: architecture_pattern
component: type_checker
severity: high
applies_when:
  - "You change how a `type` declaration gets identity by name, or add a new kind of named type"
  - "You reorder or add a step in `TypeTable.assignable`"
  - "You add a rule that lets an unnamed value fit a named type"
  - "You compare two types for equality in the IR validator"
last_updated: 2026-10-25
tags: [type-identity, transparent-alias, tagged-record, assignability, widening, type-table, validator, nominal]
---

# Type identity is a property of an alias, and a widened value takes no second name

## Context

The TI plan (`docs/archive/plans/2026-10-24-type-identity.md`, commits ea9dce2 to b5c7b48) removed the `nominal` keyword. A plain `type` declaration now has identity by name, unless its body is a union with a non-literal member or a bare name. CONCEPTS.md defines the terms: type identity, transparent alias, tagged record, and sealed type. The TD plan (`docs/archive/plans/2026-10-25-type-identity-rederive.md`) then fixed a union leak and rederived the storage and the assignability steps.

Before the TI change, the checker kept a nominal type in separate tables (`brands` for primitives, `dataRecords` for records). Each structural query had to know about those kinds. The work found four rules that the final code does not explain by itself. If a later change breaks one of them, the checker accepts wrong programs or rejects correct ones. No test failure points to the cause.

## Guidance

**1. Keep identity a property of the alias definition.** `TypeTable` keeps one `AliasDef` for each type id (`src/core/types.ts:337`, map at line 382). The kinds are `transparent`, `identity`, `tagged`, and `opaque`. A writer replaces the whole definition: `defineAlias`, `defineIdentity`, `defineTagged`, and `defineOpaque`. Each takes every field of its kind, including `guarded` and `sealed`, so no writer changes an existing definition and no write can leave an illegal state. `unfold` still follows the body of every alias kind (`src/core/types.ts:1029`). `unfoldTransparent` stops at an identity or a tagged record (`src/core/types.ts:1034`). Both use one walk, `follow` (`src/core/types.ts:1038`). Use `unfold` for structural questions: field reads, array builtins, and pattern shapes. Use `unfoldTransparent` only where a name matters: operator classes, the tagged target in `recordTarget` (`src/core/check_expr.ts:1528`), and the tagged domain of a `match`. With a separate type kind for identities, each structural query would need a new case.

**2. In assignability, a widened value takes no second name.** The identity steps of `TypeTable.assignable` (`src/core/types.ts:1441-1469`) run in this order, after the guarded-record check and the error and `never` exits:

1. A transparent alias unfolds, on the source side and on the target side.
2. A source union splits. Each member must fit, and each named member keeps its name.
3. An identity or a tagged record source widens to its body. The recursive call passes `adopt=false`.
4. A named target takes only its own name, or an unnamed value through the body of an untagged identity. This needs `adopt=true`.
5. A target union and the structural `switch` come last.

`adopt=false` is the key. Without it, a widened value takes a second name: a `Cents` value would widen to `int` and then fit `Score` as an unnamed `int`. Step 2 must come before step 4. Before TD1 (fixed 2026-10-25), a union source counted as an unnamed value, so `(v: Cents | Meters): Score => v` built with no diagnostic in the checker and the validator. The sealed guard (`ownsSealed`) on steps 3 and 4 keeps a sealed type closed outside its module. The validator copy in `src/core/validate/typing.ts` follows the same order in its own code.

**3. Keep tagged records out of the unnamed-value rule.** Step 4 accepts an unnamed value only for the `identity` kind, not for `tagged` or `opaque`. A tagged record value carries a runtime `_tag`. If an inline record literal fits a tagged record by assignability, the program gets a value with the tagged type and no `_tag` (NI24 in the ideation document). Implicit construction happens in `recordConstruction` instead (`src/core/check_expr.ts:1594`). A record literal at exactly the expected tagged type gets a `data-construction` fact (`src/core/check_expr.ts:1711`), and the emitter prints `Name.make(...)`. A computed record needs `Name(value)`.

**4. Give the validator equality a name signature.** The IR validator `same()` (`src/core/validate/typing.ts:492`) once meant two-way assignability. With type identity, `int` and an identity over `int` fit each other in both directions, but they are different types. `same()` now also compares `nameSignature` (`src/core/validate/typing.ts:467`). Without it, `unionOf` merges `Cents` and `int` into one member, and the validator accepts IR that the checker did not produce. Known limit, accepted: the signature is a sorted set, so `[Cents, int]` and `[int, Cents]` count as equal.

A bare-name body gives a transparent alias (`hasIdentity` in `src/core/check.ts`). So source cannot make an identity whose body is another identity. An earlier version of this doc used `type UserId = Text` as an identity over `Text`. That was wrong, and the doc no longer uses it.

## Why This Matters

Each rule fails without a clear symptom. A missing `adopt=false` or a union that counts as unnamed lets a value change its name, which removes the main guarantee of the feature. A tagged record without `_tag` builds, type-checks, and then fails at runtime in a `match` or a decode. A weak `same()` makes the validator agree with a wrong checker, so the second check stops working.

Keeping identity on the alias also kept the change small: structural queries that call `unfold` needed no new case. The session history found one earlier constraint: a `try` whose `catch` arm returns a different tagged record joins to a union (TE3, merged as commit `8b98961`). The design kept that join (session history).

## When to Apply

- When you add a named-type kind, first check whether a new `AliasDef` kind is enough.
- When you edit `TypeTable.assignable` or the validator `assignable`, keep the step order above, and run `tests/types_test.ts`, `tests/validate_typing_test.ts`, and the union tests in `tests/check_body_test.ts`.
- When you add a coercion from an unnamed value, exclude tagged and opaque targets and union sources, and put construction in the checker, not in assignability.
- When the validator compares types, decide whether names matter. If they do, use `same()`, not two-way `assignable`.

## Examples

A source probe gave these results:

```
type Text = string
type UserId = Text        // transparent alias: a bare-name body
type Cents = int
type Meters = int
type Score = int

Text   -> UserId          fits: UserId unfolds to Text (step 1)
Text   -> string          fits: step 3 widens
Cents | Meters -> Score   rejected: step 2 splits, and each member keeps its name
Cents  -> Score           rejected: step 3 widens with adopt=false, then step 4
1 | 2  -> Cents           fits: step 2 splits, and step 4 takes each literal
{ x: 1 } -> Circle        not by assignability; recordConstruction builds Circle.make
```

## Related

- `docs/solutions/logic-errors/union-member-order-must-not-depend-on-intern-order.md`: the same table and `recordTarget`. Its "record brand" wording now means a tagged record.
- `docs/solutions/logic-errors/emitted-fields-must-use-own-presence.md`: emitter construction of tagged records. Its "nominal record" wording is older than this change.
- `docs/solutions/logic-errors/checker-result-type-from-expected-hint.md`: another case where the checker and the validator must agree on typing.
- `docs/archive/plans/2026-10-24-implicit-nominal-ideation.md` (NI), `docs/archive/plans/2026-10-24-type-identity.md` (TI), and `docs/archive/plans/2026-10-25-type-identity-rederive.md` (TD).
