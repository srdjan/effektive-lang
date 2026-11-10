# Sealed literal construction fix (N4)

Date: 2026-11-10. Base: `b9d8ad2` on local `main`. Author: Opus.
Status: on 2026-11-10 the user accepted option (a) of SCD1 and approved execution
without a separate plan validation.

Prefixes: SC (shapes), SCD (decisions), SCU (units).

## Defect

Row N4 of the [completeness review](2026-11-10-completeness-review.md) records the
defect. The rule "Sealed type authority" of `docs/language-rules.md` gives the declaring
module construction authority, and it rejects foreign construction and unnamed flow-in.
A literal in another module breaks this rule: `check`, the validator, and `build --tsc`
accept it. The defect exists at `d89ff26`, before phase 2 of the core data operations.

## Measurements

Opus ran `check` and `build --tsc` on a scratch project on 2026-11-10. `lib.eff`
declares `export sealed type Bag = Int[]`, `Pair = [Int, Int]`, `Article = { title: Text }`,
`Count = int`, `Name = string`, and `Handler = (x: Int) => Int`, each sealed. `main.eff`
imports them.

| Source in `main.eff` | Result today |
| --- | --- |
| `(a: Int): Bag => [a]` | 0 diagnostics |
| `(): Bag => []` | 0 diagnostics |
| `(a: Int): Pair => [a, a]` | 0 diagnostics |
| `(t: Text): Article => ({ title: t })` | 0 diagnostics |
| `(a: Int): Bag[] => [[a]]` | 0 diagnostics |
| `(a: Int): { b: Bag } => ({ b: [a] })` | 0 diagnostics |
| `(a: Int): Option<Bag> => Some([a])` | 0 diagnostics |
| `(xs: Bag, a: Int): Bag => [...xs, a]` | `type-mismatch/003` twice: the spread and the body |
| `(): Count => 1` and `(a: Int): Count => a` | `type-mismatch/003` |
| `(): Name => "x"` | `type-mismatch/003` |
| `(): Handler => (x) => x` | `type-mismatch/003` |
| `(a: Int): Bag => Bag([a])` | `sealed/001` "only the declaring module can construct the sealed type `Bag`" |

The same literals in `lib.eff`, the declaring module, are valid and must stay valid.

## Shapes

- SC1: a record, array, or tuple literal whose expected type is a foreign sealed
  identity at the top level, after transparent aliases. The empty array `[]` is in SC1.
- SC2: SC1 nested in another literal, a record field, or `Some`. The inner literal gets
  the sealed type as its expected type, so the SC1 check covers it.

Not affected: a value of a foreign sealed type that flows through a literal, such as
`[b]` with `b: Bag` at `Bag[]`. Only the top-level expected type of a literal counts.
`foreignSealedOf` in `src/core/types.ts` finds a sealed identity anywhere inside a type,
so it is the wrong test for SC1. The validator helper `sealedRootOf` in
`src/core/validate/typing.ts` tests the top level only.

## Code sites

- Checker: `recordExpr` and `listExpr` in `src/core/check_expr.ts`. Today each gives the
  literal its expected type. The explicit constructor reports through
  `requireSealedOwner` in the same file.
- Validator: `recordLike`, `arrayLike`, and `tupleLike` in `src/core/validate/expr.ts`.
  The `nominal` case of the same file rejects a foreign constructor with "the module
  cannot construct the foreign sealed type X". The literal cases have no such test.

## Decision SCD1

Accepted on 2026-11-10: option (a). The diagnostic of SC1.

- (a) `sealed/001` with the message of the constructor: "only the declaring module can
  construct the sealed type `Bag`". The validator gives `validation/002` with the
  message of its `nominal` case. **Recommended**, because a literal at a sealed type is
  a construction, and one code then covers both forms.
- (b) `type-mismatch/003`, as for a primitive literal at a foreign sealed type: "the
  function body has type Int[], but Bag is expected". This message does not name the
  sealed rule.

## Unit

| Unit | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- |
| SCU1 | Sonnet | `src/core/check_expr.ts`, `src/core/validate/expr.ts`, a test file such as `tests/check_sealed_literal_test.ts`, the forged validator test file of the sealed rules, `docs/language-rules.md`, `CHANGELOG.md` | Each 0-diagnostic row of the measurement table gives the SCD1 diagnostic, once for each literal. The same literals in the declaring module give 0 diagnostics. `[b]` with `b: Bag` at `Bag[]` gives 0 diagnostics. A forged IR array, tuple, and record of a foreign sealed type each give `validation/002`. `deno task check` passes. Directed mutation of the changed lines leaves no unregistered survivor. `deno task rules:unfired` reports 0. | 50 |

The executor writes the failing tests first and confirms that each fails for the reason
of the defect. Then Opus reviews the diff, runs the gate, commits, and updates row N4.

The change rejects source that `check` accepts today. A fixture or website example that
constructs a foreign sealed record, array, or tuple by a literal will fail. The gate and
`tests/website_examples_slow_test.ts` find each one. Each such example then uses the
owner's exported constructor or function.

## Website

The specification already states the rule. `../effektive/public/effektive-spec.html`
says that other modules "cannot construct values" of a sealed type. So SCU1 brings the
compiler into line with the specification, and the specification text does not change.

## Out of scope

A literal at a foreign identity that is not sealed. The rule "Unmarked types with
identity stay open" makes it valid.
