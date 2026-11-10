# Constant comparison fix (N3)

Date: 2026-11-10. Base: `89e895e` on local `main`. Author: Opus.
Status: done. On 2026-11-10 the user accepted option (a) of CCD1 and approved execution.
CCU1 is done. The commit that moved this plan to the archive holds the fix.

Prefixes: CC (shapes), CCD (decisions), CCU (units).

## Defect

Row N3 of the [completeness review](../../plans/2026-11-10-completeness-review.md) records the
defect. `check` accepts some comparisons, but `build --tsc` rejects the emitted text with
TS2367: "This comparison appears to be unintentional because the types 'true' and 'false'
have no overlap". So `check` and the TypeScript output disagree. The defect existed
before the unary operators. Since COU1a, `!e` lowers to `e === false`, so `!true` and
`!on` reach the same text.

## Measurements

Opus ran `deno check` on small TypeScript files and `build --tsc` on a scratch Effektive
project on 2026-11-10.

| Emitted TypeScript | TS2367 |
| --- | --- |
| `1 === 2`, and `true === false` from `!true` | yes |
| `(1 as number) === 2` | no |
| `const on = true; on === false` | yes |
| `const on: boolean = true; on === false`, which the emitter writes today | yes |
| `const on: boolean = true as boolean; on === false` | no |
| `const on = true; !on` | no |
| `const t: Tag = "a"; t === "b"`, with `type Tag = "a" \| "b"` | yes |
| `const on: boolean = true; const off: boolean = false; on === off` | yes |
| `const t: string = "a"; t === "b"` | no |
| `const x: number \| null = null; x === 5` | no |

TypeScript narrows a `const` declaration to the type of its value only when the declared
type is a union. `boolean` is the union `true | false`. A type annotation does not stop
this narrowing.

## Shapes

- CC1: both operands of `===` or `!==` are boolean, number, or string literals. Examples
  are `1 === 2`, `"x" === "y"`, and `!true`.
- CC2: a block `const` has a union type after aliases, such as `boolean` or a literal
  union, and its value is a literal. A later comparison of that constant with a different
  literal, or with another CC2 constant, fails.

Not affected: a module constant, a parameter, a constant of type `string`, `int`, or
`number`, and a comparison with `null`. A `null` literal in CC1 is not measured.

## Decision CCD1

Accepted on 2026-11-10: option (a).

- (a) The emitter widens. In a block `const` of shape CC2, the emitter writes the value as
  `<literal> as <type>`. In a comparison of shape CC1, the emitter writes the left operand
  as `(<literal> as <primitive>)`. The source rules, the diagnostics, the IR, and the
  validator do not change. TypeScript checks each `as` as a widening, so the cast hides no
  error. **Recommended**, because it is the smallest change and it keeps valid source
  valid.
- (b) The checker rejects a constant comparison. A new diagnostic covers CC1 and CC2. The
  validator, `docs/language-rules.md`, and the specification get the rule. The checker
  must copy the TypeScript narrowing rule for CC2, so a later TypeScript change can break
  the agreement again.
- (c) Both. The checker rejects CC1, which always gives a constant result. The emitter
  widens CC2.

## Unit for option (a)

| Unit | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- |
| CCU1 | Sonnet | `src/core/emit/expr.ts` (`step` near line 1354 and `binary` near line 1110, with `this.scope.resolve`), a new fixture `fixtures/emit/core-data/constant-comparison.eff` and its golden file, `tests/emit_test.ts`, `tests/emit_runtime_slow_test.ts`, which copies `fixtures/emit/core-data/` and runs `deno check` and `deno run` on the output | The fixture holds CC1 and CC2 in each measured form and builds with `--tsc` and 0 diagnostics. Its runtime test gives the exact values. No other golden file changes. `deno task check` passes. Directed mutation of the changed lines leaves no unregistered survivor. | 40 |

The executor writes the failing `build --tsc` test first and confirms TS2367. After the
commit, Opus updates row N3 of the completeness review.

## Result

The emitter writes `(1 as number) === 2` for CC1 and `const on: Flag = true as Flag;` for
CC2. The cast of CC2 names the declared type, not the primitive. The fixture
`fixtures/emit/core-data/constant-comparison.eff` holds each measured form. Before the
fix, its runtime test failed with seven TS2367 errors. After the fix, it passes, and no
other expected emitted text changed. `deno task check` passed with 3,169 fast and 318
slow tests.

## Out of scope

A value that is not a literal but has a narrower TypeScript type, such as an `if` with
the same literal in both branches. It waits for an example.
