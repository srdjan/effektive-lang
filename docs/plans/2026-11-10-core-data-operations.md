# Core data operations: selection plan

Date: 2026-11-10. Base: `3808b91` on local `main`. Author: Opus.
Status: on 2026-11-10 the user accepted COD1 (a), COD2 (a), COD3 (a), and COD4 (a). All
nine items are selected. Phase 1 is authorized, and the "Phase 1 execution plan" below
carries it out. Phases 2 and 3 each need a detail plan and a user approval before
implementation.

Prefixes: CO (items), COD (decisions), COU (phase 1 units).

## Origin and target change

The [completeness review](2026-11-10-completeness-review.md) found that source has no
integer remainder, no exact integer division, no rounding, no number-to-text conversion,
no text or array length, no array index or append, no sort, no tuple read, no
consumption of a nullable primitive union, and no unary operators (FF1 to FF5, FF7, FC5,
FC6). Fable and codex astra both ranked these gaps above every open Effect service
primitive. The gate applications keep this work in host code, so the stopping rule
never showed the gaps. This cause is probable, not confirmed.

On 2026-11-10 the user accepted decision FCD5 (a): a change to the accepted target for
core data operations. A core data operation can be selected without an application
blocker. This plan is the selection step. Implementation needs a second user approval
of the items that COD1 selects.

## Rules for every item

Each item follows these rules.

- Extend an existing source form before a new builtin name (AGENTS.md).
- Add no implicit conversion. Effektive has no JavaScript truthiness, so it also gets no
  implicit number-to-text conversion.
- A fault of integer arithmetic is a defect, as the `$int` guard already makes an
  overflow a defect (`RangeError("int overflow")`, `src/core/emit/helper_declarations.ts:22`).
- An `int` result of a new form fits a type with identity over `int` in the same way that
  an operator result does (specification, "Data and types": an unnamed value is a
  literal, an operator result, or an inline literal). Each item must state this rule.
- Each item updates the checker, the lowering, the emitter, the independent validator,
  `docs/language-rules.md`, the canonical specification and its Effect-TS tab, the
  TextMate grammar and the playground highlighter when the lexer changes, and
  completion when the prelude changes.
- Each item has a fixture witness, a golden emit file, and a runtime test with exact
  values. An item with a numeric algorithm also has a property test.

## Items

Relative size is an Opus judgment from the files that each item touches. It is not a
measurement.

### CO1 Unary `-` and `!` (FF7)

Today `-x` and `!x` give `syntax/010` with a hint (`src/core/parse.ts:1433-1451`).
Candidate: accept both. `-x` lowers to the existing binary `0 - x`, and `!x` lowers to
`x === false`. The lowering keeps the current semantics exactly. For example, `0 - x`
gives `0` and not `-0` for `x = 0`. No IR change is necessary. A negative literal such as
`-1` must also work as a literal pattern in `match`, so the pattern rule needs one new
row. The terse-source exception of 2026-10-24 also covers this item. Size: small.

### CO2 Remainder `%` (FF1)

Today `%` gives `syntax/001`. Candidate: a binary operator `%` with the precedence of `*`
and `/`. Two `int` operands give `int`, with the JavaScript sign rule (the sign of the
dividend). A remainder by zero gives `NaN`, and the `$int` guard turns it into a defect.
Two `number` operands give `number`. The identity arithmetic rule of `*` applies. The IR
binary operator list (`src/core/ir.ts:230`) gets `%`. That is a wire change, so the IR
version rule in `docs/architecture.md` applies. Size: medium.

### CO3 Integer division and conversion from `number` to `int` (FF1, FC5)

Today `/` gives `number`, and only `Duration / int` truncates. Candidate: four builtins
`trunc(x)`, `floor(x)`, `round(x)`, and `ceil(x)` from `number` to `int`, and one
builtin `div(a, b)` for exact integer division of two `int` values. Each result goes
through the `$int` guard, so `NaN`, an infinity, or an unsafe integer is a defect.
`trunc(a / b)` is not exact for all safe integers, because the floating-point quotient
can round up to the next integer. So `div` needs an emitted helper that corrects the
quotient. A property test over generated pairs of safe integers must prove that
`div(a, b) * b + a % b === a`. COD2 and COD3 decide the names and the rounding mode.
Size: medium.

### CO4 Conversion to text (FF2)

Today `"n=" + n` gives `type-mismatch/007`, and a string `+` works only for two strings.
Candidate: one builtin `text(x)` for `int`, `number`, `boolean`, and a type with identity
over one of them. It emits `String(x)`. COD4 decides the form. Text formatting with a
fixed number of decimals is out of scope until an example needs it. Size: small.

### CO5 Length of text and arrays (FF2, FF3)

Today `xs.length` gives `type-mismatch/006`. Refinement predicates already have
`len(x)` for strings and arrays (`docs/inferred-input-contracts.md:78`, specification
"Data and types"). Candidate: make `len(x)` a value builtin with the same meaning. String
length counts UTF-16 code units, as the predicate does. This extends an existing source
form. Size: small.

### CO6 Array element and append (FF3)

Today `xs[0]` gives `syntax/008`, and `[...xs, x]` gives `syntax/008`. Candidate: a
builtin `at(xs, i)` that gives `Option<T>`, so an index outside the array is `None`.
For append and concatenation, a spread in an array literal, `[...xs, x]`, which extends
the existing record update form `{ ...user, name }`. The lowering can call an internal
helper, so no IR kind is necessary for the spread. Size: medium.

### CO7 Sort (FC6, item 24)

The user asked for a sort builtin on 2026-10-27 "for a later selection". Candidate:
`sort(xs)` for an array of primitives or of types with identity over a primitive, in
natural order, and `sort(xs, x => key)` for any element type with a key of such a type.
The sort is stable. Strings compare by code unit, as `compareText` does in the CLI.
Descending order is `sort(xs, x => 0 - key)` for numbers. A descending option waits for
an example. Size: medium.

### CO8 Tuple reads (FF4)

Today `const [a, b] = p` gives `syntax/008`, and a tuple pattern gives `syntax/011`.
`all([...])` returns a tuple, so a user must use the record form of `all`. Candidate:
tuple destructuring in a block, `const [a, b] = p`, which extends the existing record
destructuring `const { a, b } = r`. The element count must equal the tuple length.
Tuple patterns in `match` stay out of scope. The IR has no element read, so this item
needs one IR kind or an element form of `get`. Size: medium.

### CO9 Nullable primitive unions (FF5)

Today `match` on `N | null` gives `pattern/004`, and `docs/language-rules.md:513` says
"There is no flow narrowing". Candidate: a `match` on `T | null` with the arms
`null => ...` and `name => ...`, where the binding arm gets `T`. Flow narrowing after
`=== null` stays out of scope. Unions of two different primitives, such as `N | S`,
stay out of scope. Size: medium.

## Recommended order

The order puts the smallest items that unblock the most common programs first.

| Phase | Items | Reason |
| --- | --- | --- |
| 1 | CO1, CO2, CO3, CO4, CO5 | Arithmetic and text. A program that computes a percentage or prints a number needs them. Only CO2 changes the IR. |
| 2 | CO6, CO7, CO8 | Array and tuple work. CO8 changes the IR. |
| 3 | CO9 | Union consumption. It changes the match rules, so it goes last. |

The order lifecycle witness is the acceptance example of phase 1: its percent pricing
must use `round` or `div` instead of the duration workaround
`Cents((subtotal * 90 * 1ms) / 100)`.

## Decisions

COD1 (selection). (a) Select all nine items in the three phases above, and plan phase 1
in detail first. Recommended. (b) Select phase 1 only. (c) Select a different set,
named by item.

COD2 (names of integer division and conversion). (a) `div(a, b)` and the four builtins
`trunc`, `floor`, `round`, and `ceil`. Recommended: each name reads as one word in
source, and JavaScript users know the names. (b) `div(a, b)` and one builtin
`toInt(x, mode)` with the mode `"trunc"`, `"floor"`, `"round"`, or `"ceil"`. It adds one
name, but each call is longer. (c) `div(a, b)` and `round` only.

COD3 (rounding mode of `round`). (a) Half away from zero: `round(2.5)` is 3 and
`round(-2.5)` is -3. Recommended: it is the rule that most people expect for money.
(b) The JavaScript rule of `Math.round`: `round(-2.5)` is -2. (c) Half to even.

COD4 (conversion to text). (a) The builtin `text(x)`. Recommended: the conversion stays
visible, and the lexer does not change. (b) Accept `string + number` with an implicit
conversion. (c) String interpolation. This changes the lexical core, which the
specification excludes today.

## Phase 1 execution plan

Base: `cf33c4b`. Author: Opus. Units COU1 to COU6 carry out CO1 to CO5.

The units run one after another in the main tree, because they share the parser, the
checker, the lowering, the emitter, and the validator. A Sonnet executor does each
unit. The executor writes a failing test first, makes it pass, runs `deno task check`,
and hands back without a commit. Opus reviews the diff line by line, runs the gate,
runs `deno task mutate --only` on the changed logic lines, and commits the unit.

### Shared rules

- P1 (shadowable names). Each new builtin is a prelude name with `shadowable: true` in
  `src/core/resolve.ts:73`. Ten fixtures bind `text` as a module constant, for example
  `fixtures/emit/schema-constructor.eff:15`, and they must still compile.
- P2 (builtin instances). `div`, `trunc`, `floor`, `round`, `ceil`, `text`, and `len`
  reuse the path of the collection builtins. A checker family row records the fact
  `{ kind: "builtin", name, ir }` (`src/core/check_builtins/collections.ts:156`).
  Lowering makes a `call` of a `$builtin/<name>/<hash>` reference
  (`src/core/lower.ts:633`). The emitter prints the call in `builtinCall`
  (`src/core/emit/expr.ts:1274`). No IR expression kind is added.
- P3 (IR version 9). COU2 adds `%` to the binary operator union (`src/core/ir.ts:230`)
  and raises the IR version from 8 to 9 once, in the way that `9a097a0` raised it to 8.
  The new builtin instance names of COU3 and COU4 use the same version. The validator
  rejects version 8.
- P4 (faults are defects). An `int` remainder or a `div` by zero throws
  `RangeError("division by zero")`. A rounding result that is NaN, infinite, or outside
  the safe integers throws `RangeError("int overflow")` through `$int`.
- P5 (no negative zero). An `int` result of `%`, `div`, or a rounding builtin is never
  `-0`. For example, `-6 % 3` and `ceil(-0.5)` give `0`, and `Object.is(result, 0)` is
  true.
- P6 (identity fit). A plain `int` or `string` result fits an untagged identity through
  the existing rule at `src/core/types.ts:975`. So `const c: Cents = round(x)` checks
  with no new rule. Each unit has one test of this fit.
- P7 (documents). Each unit adds its rows to `docs/language-rules.md` and an entry
  under `## Unreleased` in `CHANGELOG.md`. COU6 updates the website.

### Units

| Unit | Item | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- | --- |
| COU1 | CO1 unary `-` and `!` | Sonnet | `src/core/parse.ts:1433-1451`, the syntax kinds, the checker of the new node, `src/core/lower.ts`, the literal pattern rule, editor token and census tables that list syntax kinds, tests, a fixture | See COU1 below | 60 |
| COU2 | CO2 `%`, IR version 9 | Sonnet | `src/core/lex.ts`, `src/core/parse.ts`, `src/core/check_binary.ts`, `src/core/ir.ts`, `src/core/lower.ts`, the validator binary rule, `src/core/emit/expr.ts:1133`, `src/core/emit/helper_declarations.ts`, the files of `9a097a0`, `editors/vscode/syntaxes/effektive.tmLanguage.json`, the playground highlighter, tests, a fixture | See COU2 below | 80 |
| COU3 | CO3 `div` and rounding | Sonnet | `src/core/resolve.ts`, a new family file `src/core/check_builtins/numbers.ts` and `registry.ts`, `src/core/ids.ts:96`, `src/core/validate/builtins.ts`, `src/core/emit/expr.ts` (`builtinCall` and the counts at 1707), `src/core/emit/helper_declarations.ts`, tests, a fixture | See COU3 below | 80 |
| COU4 | CO4 `text`, CO5 `len` | Sonnet | The COU3 files, and `src/core/predicate_source.ts:239` | See COU4 below | 60 |
| COU5 | Phase 1 witness and status | Sonnet | `fixtures/applications/order-lifecycle/` (`orders.eff`, `README.md`, `runtime_test.ts`, the generated files), `docs/status.md` | See COU5 below | 40 |
| COU6 | Website | Sonnet | `../effektive/public/effektive-spec.html` (both tabs), `../effektive/public/typed-ir.ts` through `deno task site:ir`, an example in `../effektive/public/effektive-examples/` when one fits | See COU6 below | 60 |

COU1 (unary `-` and `!`). `-e` binds tighter than `*`, so `-a * b` is `(0 - a) * b`.
The checker types `-e` as `0 - e`, and lowering makes the IR `binary` `-` with a literal
`0` on the left. So `-x` for `x = 0` gives `0`, not `-0`. `!e` needs a `boolean` and
lowers to the IR `binary` `===` with a literal `false` on the right. A diagnostic for a
wrong operand names the unary operator. `+e` keeps `syntax/010`. A `Duration` operand
gives the mismatch of `0 - d`, and the language rules row says to write `0ms - d`. A
`match` literal pattern accepts `-` before a numeric literal, as a negative literal. No
IR change. The check: a fixture with `-x`, `-(a * b)`, `- -x`, `!flag`, and a `match`
arm `-1 =>`; a golden emit file; a runtime test with the exact values `-5`, `0` (with
`Object.is`), `false`, and the matched arm; the old `syntax/010` tests for `-` and `!`
become success tests; `deno task check` exits 0.

COU2 (`%`). The lexer gets a `%` token. `%` has the precedence of `*` and is left
associative. Two `int` operands give `int`, and the identity rule of `*` applies
(`adoptedNumericIdentity`, `src/core/check_binary.ts:447`), so `Cents % 7` gives
`Cents`. Two `number` operands, or one `int` and one `number`, give `number`. A
`Duration` or `Instant` operand gives a type mismatch through new rows of the unit table.
The sign follows the dividend, as in JavaScript. An `int` remainder emits a new helper
`$rem(a, b)` that throws for `b === 0` and returns `a % b + 0`. A `number` remainder emits
`a % b`. The validator learns `%`. The IR version goes to 9 with the mechanical changes of
`9a097a0`. The TextMate grammar and the playground highlighter learn `%`. The check: a
fixture and a golden file; a runtime test with the exact values `7 % 3 = 1`,
`-7 % 3 = -1`, `7 % -3 = 1`, `-6 % 3 = 0` (with `Object.is`), `7.5 % 2 = 1.5`, and the
defect message "division by zero"; a test that `5s % 2` gives the mismatch code; a test
that the validator rejects version 8; a forged validator fixture with a wrong `%`
operand type; `deno task check` exits 0.

COU3 (`div` and rounding). `trunc`, `floor`, `round`, and `ceil` take one `number` (an
`int` or a number identity widens) and give `int`. `round` rounds half away from zero
(COD3). Emission: `trunc`, `floor`, and `ceil` emit `$int(Math.<name>(x) + 0)`. `round`
emits `$int` of a helper that gives `-Math.round(-x) + 0` for `x < 0` and
`Math.round(x) + 0` otherwise, because `Math.round(-0)` is `-0`. `div(a, b)` takes two `int` values and gives the quotient truncated toward
zero, the partner of `%`. It emits a helper that throws for `b === 0` and returns
`Number(BigInt(a) / BigInt(b))`. BigInt division is exact by construction, so the
helper needs no float correction. The check: a fixture and a golden file; a runtime test
with the exact values `div(7, 2) = 3`, `div(-7, 2) = -3`, `div(7, -2) = -3`,
`div(9007199254740991, 2) = 4503599627370495`, `trunc(-2.7) = -2`, `floor(-2.5) = -3`,
`ceil(-0.5) = 0` (with `Object.is`), `round(2.5) = 3`, `round(-2.5) = -3`,
`round(0.49999999999999994) = 0`, and the defect messages for `div(1, 0)` and
`round(1e300)`; a property test after `docs/testing.md` "Property tests" that checks
`div(a, b) * b + a % b === a` in BigInt, `|a % b| < |b|`, and the sign rule on seeded
pairs that include the safe integer limits, with literal outcome counts; the P6 fit
test; a module constant named `round` still compiles; `deno task check` exits 0.

COU4 (`text` and `len`). `text(x)` takes one `int`, `number`, `boolean`, or an identity
over one of them, and gives `string`. It emits `String(x)`, so it gives the JavaScript
form, for example `"1e+21"`. `len(x)` takes one `string`, one array, or an identity over
one of them, and gives `int`. It counts UTF-16 code units, as the predicate `len` does,
and emits `x.length`. A refinement predicate `len` keeps its meaning. The check: a
fixture and a golden file; a runtime test with the exact values `text(42) = "42"`,
`text(-1.5) = "-1.5"`, `text(true) = "true"`, `len("héllo") = 5`, `len("😀") = 2`, and
`len([1, 2, 3]) = 3`; `"n=" + text(n)` checks; `text("a")` gives a type mismatch; a
refined type with `where len(x) > 0` still checks next to a value `len`; the existing
fixtures that bind `text` still compile; `deno task check` exits 0.

COU5 (witness and status). The order lifecycle application gets a percent rule that
uses `div` or `round`, and no duration form. The README sentence "A percent rule is not
possible" changes. `runtime_test.ts` gets one exact-value case for the new rule.
`docs/status.md` replaces the percent sentence and records phase 1 as done. The check:
`deno test --allow-all tests/application_slow_test.ts` passes; `deno task check` exits 0.

COU6 (website). The specification states `%`, the unary operators, and the seven
builtins, with an Effect-TS tab for each new example. `typed-ir.ts` shows IR version 9.
The check: the compiler builds each changed Effektive example; the website
`deno task test` and `deno task typecheck` exit 0. The website edits get their own
commit in `../effektive`.

### Out of scope for phase 1

A negative literal in a type position, unary `-` on a `Duration`, `%` on a unit, text
formatting with a fixed number of decimals, and a descending sort. Each waits for an
example.
