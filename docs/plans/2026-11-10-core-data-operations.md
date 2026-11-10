# Core data operations: selection plan

Date: 2026-11-10. Base: `3808b91` on local `main`. Author: Opus.
Status: draft. It waits for the user decisions COD1 to COD4. No implementation is
authorized.

Prefixes: CO (items), COD (decisions).

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
