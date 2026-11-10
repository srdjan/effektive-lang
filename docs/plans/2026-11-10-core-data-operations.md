# Core data operations: selection plan

Date: 2026-11-10. Base: `3808b91` on local `main`. Author: Opus.
Status: on 2026-11-10 the user accepted COD1 (a), COD2 (a), COD3 (a), and COD4 (a). All
nine items are selected. Phase 1 (CO1 to CO5) is done: "Phase 1 result" below gives the
commits and the checks. "Phase 2 execution plan" below is validated, and its decisions are
accepted, and phase 2 is done. "Phase 3 execution plan" below has accepted decisions
CQD1 to CQD5 and is validated. The user approved execution on 2026-11-10. So this plan
stays in `docs/plans/`.

Prefixes: CO (items), COD (decisions), COU (phase 1 units), COV (phase 1 validation
findings), CPD (phase 2 decisions), CPR (phase 2 shared rules), CPU (phase 2 units),
CPV (phase 2 validation findings), CQD (phase 3 decisions), CQR (phase 3 shared rules),
CQU (phase 3 units), CQV (phase 3 validation findings).

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

Deferred on 2026-11-10 by CPD4 (a). It waits for an example that needs a tuple read.

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

Base: `cf33c4b`. Author: Opus. Validation: Fable on 2026-11-10 at `114aede`, findings
COV1 to COV26 (2 blockers, 13 changes, 11 notes). This revision applies every change.
Units COU1a to COU6 carry out CO1 to CO5.

The units run one after another in the main tree, because they share the parser, the
checker, the lowering, the emitter, and the validator. A Sonnet executor does each
unit. The executor writes a failing test first, makes it pass, runs `deno task check`,
and hands back without a commit. Opus reviews the diff line by line and runs the gate.
Then Opus commits the unit, and runs `deno task mutate --only` on the changed logic
lines, `deno task rules:unfired`, and `deno task coverage` in the main tree (COV13). A
survivor or an unfired rule gets a test in a follow-up commit.

### Shared rules

- P1 (shadowable names). Each new builtin is a prelude name with `shadowable: true` in
  `src/core/resolve.ts:73`. Fourteen fixture files bind `text` as a module constant,
  for example `fixtures/emit/schema-constructor.eff:15`, and they must still compile.
- P2 (builtin instances). `div`, `trunc`, `floor`, `round`, `ceil`, `text`, and `len`
  reuse the path of the collection builtins: the fact `{ kind: "builtin", name, ir }`,
  a `call` of a `$builtin/<name>/<hash>` reference, and an emission case. No IR
  expression kind is added. A new name is registered at these sites (COV9):
  `src/core/resolve.ts:73`; a family row in a new file `src/core/check_builtins/data.ts`
  and in `registry.ts` (`FAMILY_ROW_TABLES`, `FAMILY_ROWS`, `FamilyContext`);
  `src/core/ids.ts:96`; `src/core/emit/expr.ts` `builtinCall` and the `counts` record
  at line 1707, with a `throw internal(...)` case in the `switch (builtin)` below it;
  `src/core/validate/builtins.ts:6`; a shape rule in
  `src/core/validate/import_checks.ts` `checkBuiltinShape`; an arity row in
  `tests/builtin_arity_test.ts`; `editors/vscode/syntaxes/effektive.tmLanguage.json:130`;
  the file map and the prelude list of `docs/api.md`. A new emitter helper also needs
  `src/core/emit/module_state.ts` and `src/core/emit/emit.ts:120`. Completion and the
  playground highlighter read `PRELUDE_NAMES` and need no edit.
- P2a (instance types). `div` is `(int, int) => int`. Each rounding builtin is
  `(number) => int`. `text` is `(number) => string` or `(boolean) => string`. `len` is
  `(string) => int` or `(E[]) => int` with the unfolded array type. The validator shape
  rule accepts exactly these types, pure, with empty effect sets. A forged fixture in
  `scripts/validate_fixtures.ts` shows each rejection.
- P2b (pipeline). Each new builtin uses the `piped` prologue, so `n |> text` and
  `subtotal * 90 |> div(100)` check. A bare builtin name is not a value, so a user
  writes `map(xs, (x) => round(x))` (COV11).
- P3 (IR version 9). COU2a raises the IR version from 8 to 9. COU2b adds `%` to the
  binary operator union. The new builtin instance names of COU3 and COU4 change the
  wire contract too (`src/core/validate/import_checks.ts:289-297`), and they use the
  same version, if no release happens between COU2a and COU4 (COV24). Each additive
  change raised the version before (CHANGELOG versions 5, 6, 7, and `9a097a0`).
- P4 (faults are defects). An `int` remainder or a `div` by zero throws
  `RangeError("division by zero")`. A rounding result that is NaN, infinite, or outside
  the safe integers throws `RangeError("int overflow")` through `$int`.
- P5 (no negative zero). An `int` result of `%`, `div`, or a rounding builtin is never
  `-0`. For example, `-6 % 3` and `ceil(-0.5)` give `0`, and `Object.is(result, 0)` is
  true. The existing `$int(0 * -5)` still gives `-0`, and a `number` remainder can give
  `-0` or `NaN`. The language rules state both facts (COV18).
- P6 (identity fit). A plain `int` or `string` result fits an untagged identity that
  has no predicate and that the module owns (`src/core/types.ts:975-984`). So
  `const c: Cents = round(x)` checks, and `const p: Pos = round(x)` is rejected for a
  refined `Pos`. Each unit tests both cases.
- P7 (documents). Each unit adds its rows to `docs/language-rules.md` and an entry
  under `## Unreleased` in `CHANGELOG.md`.
- P8 (fixtures). Each unit adds one `.eff` file to one project directory
  `fixtures/emit/core-data/`. A fast emit test asserts the exact emitted text, and
  `tests/emit_runtime_slow_test.ts` holds the runtime cases. The `emit/` row of
  `docs/development.md:113` names the directory (COV14).

### Units

| Unit | Item | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- | --- |
| COU2a | IR version 9, done in `99fb296` and website `d81866e` | Sonnet | The version sites of COV12, `../effektive/public/typed-ir.ts` (`deno task site:ir`), `../effektive/public/log.ir.json`, `../effektive/public/effektive-spec.html:898` | See COU2a | 30 |
| COU1a | CO1 unary expressions, done in `d7f510e` | Sonnet | `src/core/parse.ts`, `src/core/syntax.ts`, `src/core/resolve.ts:1138-1147`, `src/core/infer_inputs.ts:207-230`, `src/core/check_expr.ts`, `src/core/check_refinements.ts`, `src/core/predicate_source.ts`, `src/core/lower.ts`, `src/core/diagnostics.ts:64-66`, `fixtures/errors/syntax-unary-operator.eff`, `fixtures/surface/cli.json`, `tests/check_body_test.ts:293`, `tests/helpers.ts:297-327`, `tests/parse_test.ts` | See COU1a | 60 |
| COU1b | CO1 negative literal pattern, done in `6181d41` | Sonnet | `src/core/parse.ts:1754-1757` and `1787-1790`, `src/core/syntax_queries.ts` (`literalOf`, `numberTextOf`), `src/core/check_patterns.ts`, `src/core/check_refinements.ts` (`matchLiteral`) | See COU1b | 40 |
| COU2b | CO2 `%`, done in `d9d638d` and website `0a1fe61` | Sonnet | `src/core/lex.ts`, `fixtures/lex/snapshot.json`, `src/core/syntax_queries.ts:102-135`, `src/core/parse.ts:89-91`, `src/core/check_binary.ts`, `src/core/ir.ts:230`, `src/core/lower.ts`, `src/core/validate/expr.ts:1941` and `2051-2077`, `src/core/emit/expr.ts:1133`, the helper sites of P2, the TextMate grammar, the website IR files | See COU2b | 70 |
| COU3 | CO3 `div` and rounding, done in `b726c86` | Sonnet | The P2 sites | See COU3 | 80 |
| COU4 | CO4 `text`, CO5 `len`, done in `e3a8e04` | Sonnet | The P2 sites | See COU4 | 60 |
| COU5 | Phase 1 witness and status, done in `965e3d4` | Sonnet | `fixtures/applications/order-lifecycle/` (`contracts.eff`, `orders.eff`, `README.md`, `runtime_test.ts`, the generated files), `docs/status.md`, `docs/plans/2026-11-10-completeness-review.md` | See COU5 | 40 |
| COU6 | Website, done in website `b8c7685` | Sonnet | `../effektive/public/effektive-spec.html` (both tabs), `../effektive/public/effektive-examples/order-lifecycle/` | See COU6 | 60 |

COU2a (IR version 9). The mechanical raise of `9a097a0`, at the sites of COV12. Do not
change the six document versions `version: 8` in `tests/lsp_editor_test.ts`. Run
`deno task site:ir`, copy `fixtures/ir/example/log.ir.json` to the website, and change
the version sentence of `effektive-spec.html:898`. The website files get their own
commit in `../effektive`. The check: the validator rejects version 8; `deno task check`
exits 0, including `tests/ir_site_slow_test.ts`; the website `deno task test` and
`deno task typecheck` exit 0.

COU1a (unary expressions). `-e` binds tighter than `*`. The checker types `-e` as
`0 - e`, and lowering makes the IR `binary` `-` with a literal `0` on the left. So `-x`
for `x = 0` gives `0`, not `-0`. `!e` needs a `boolean` and lowers to the IR `binary`
`===` with a literal `false` on the right. A diagnostic for a wrong operand names the
unary operator. `+e` keeps `syntax/010`. A `Duration` operand gives the mismatch of
`0 - d`. A refined operand needs a proof, so `-p` for a refined `Pos` is rejected and
the user writes `-Int(p)` (COV5). The refinement checker reads `-e` as `0 - e` in
`linear`, gives no fact for `!e`, and applies `preserveRefinement` to the unary node
(COV4). The block rule of D1 applies (COV2). The predicate rule of D2 applies (COV6).
The `syntax/010` description in `src/core/diagnostics.ts` changes, and
`deno task surface:update` runs. The check: precedence tests for `-a * b`, `-a.b`,
`-f(x)`, `!a === b`, `!a && b`, `a - -b`, and `-x |> f`; the D1 test; the D2 tests;
`(s: Sym): Sym => -s` and `const t: Temp = -5` check, validate, and build;
`(n) => -n` infers `n`; `{ concurrency: -1 }` gives the literal-option error; the P8
fixture and runtime values `-5`, `0` (with `Object.is`), and `false`;
`deno task check` exits 0.

COU1b (negative literal pattern). A pattern and a record pattern field accept `-`
before a numeric literal as a negative literal. The check: arms `-1 =>` and
`{ n: -1 } =>`; `-5s`, `-"a"`, and `-true` as a pattern give `syntax/011`; arms `0` and
`-0` give the duplicate-arm diagnostic; a runtime value of the matched arm;
`deno task check` exits 0.

COU2b (`%`). Append `Percent` at the end of `TokenKind`, and add it to `TOKEN_NAMES`,
`OPERATOR_KINDS`, and the single-character table. Run `deno task lex:update`. `%` has
the precedence of `*` and is left associative. The typing follows `*` (D3): two `int`
operands give `int`; the same identity twice gives `int`; an identity and an unnamed
value give the identity, so `Cents % 7` gives `Cents`; two different identities give
`type-mismatch/007`; a refined identity needs a proof; `number` with `int` or `number`
gives `number`. Three new rows of the unit table make `Duration % Duration`,
`Duration % numeric`, and `numeric % Duration` a mismatch. `Instant` needs no row. The
validator gives the same mismatch in `durationArithmetic`, and its operator parameter
types learn `%`. The sign follows the dividend. An `int` remainder emits a new helper
`$rem(a, b)` that throws for `b === 0` and returns `a % b + 0`. A `number` remainder
emits `a % b`. Run `deno task site:ir` again for the website IR file. The check: tests
for `Cents % Cents`, `Cents % Count`, `5s % 2`, `5s % 3s`, and `2 % 5s`; a forged
validator fixture with a wrong `%` operand; the P8 fixture; runtime values
`7 % 3 = 1`, `-7 % 3 = -1`, `7 % -3 = 1`, `-6 % 3 = 0` (with `Object.is`),
`7.5 % 2 = 1.5`, and the defect "division by zero"; `deno task check` exits 0.

COU3 (`div` and rounding). `trunc`, `floor`, `round`, and `ceil` take one `number` and
give `int`. `round` rounds half away from zero (COD3). `trunc`, `floor`, and `ceil` emit
`$int(Math.<name>(x) + 0)`. `round` emits `$int` of a helper that gives
`-Math.round(-x) + 0` for `x < 0` and `Math.round(x) + 0` otherwise, because
`Math.round(-0)` is `-0`. `div(a, b)` takes two `int` values and gives the quotient
truncated toward zero, the partner of `%`. It emits a helper that throws for `b === 0`
and returns `Number(BigInt(a) / BigInt(b))`. The argument rule of D4 applies (COV10).
A foreign sealed value does not widen, so it is rejected. The check: the P8 fixture;
runtime values `div(7, 2) = 3`, `div(-7, 2) = -3`, `div(7, -2) = -3`,
`div(9007199254740991, 2) = 4503599627370495`, `trunc(-2.7) = -2`, `floor(-2.5) = -3`,
`ceil(-0.5) = 0` (with `Object.is`), `round(2.5) = 3`, `round(-2.5) = -3`,
`round(0.49999999999999994) = 0`, and the defects of `div(1, 0)` and `round(1e300)`; a
property test in a `*_slow_test.ts` that compiles one program and runs seeded pairs in
one subprocess, after `docs/testing.md` "Property tests", and checks
`div(a, b) * b + a % b === a` in BigInt, `|a % b| < |b|`, and the sign rule, with the
safe integer limits and literal outcome counts; the P6 tests; a pipeline case; a module
constant named `round` still compiles; `deno task check` exits 0.

COU4 (`text` and `len`). `text(x)` takes one `int`, `number`, or `boolean`, or an
identity over one of them, and gives `string`. It emits `String(x)`, so it gives the
JavaScript form, for example `"1e+21"`. `len(x)` takes one `string` or one array, or
an identity over one of them, and gives `int`. It counts UTF-16 code units, as the
predicate `len` does, and emits `x.length`. The argument rule of D4 applies. A
refinement predicate `len` stays syntactic, so a module constant `len` shadows only
the value builtin, and a value `len(x)` gives no refinement fact (COV22). The check:
the P8 fixture; runtime values `text(42) = "42"`, `text(-1.5) = "-1.5"`,
`text(true) = "true"`, `len("héllo") = 5` with a composed `é`, `len("😀") = 2`, and
`len([1, 2, 3]) = 3`; `"n=" + text(n)` checks; `text("a")` gives a type mismatch; a
refined type with `where len(x) > 0` still checks next to a value `len`; the existing
fixtures that bind `text` still compile; a pipeline case; `deno task check` exits 0.

COU5 (witness and status). The order lifecycle application gets a percent rule in
`contracts.eff` and `orders.eff` that uses `div` or `round`, and no duration form. The
README sentence "A percent rule is not possible" changes. `runtime_test.ts` gets one
exact-value case. `docs/status.md` replaces the percent sentence and records phase 1 as
done. The completeness ledger marks FF1, FF2, FF7, and FC5. The check:
`deno test --allow-all tests/application_slow_test.ts` passes; `deno task check`
exits 0.

COU6 (website). The specification states `%`, the unary operators, and the seven
builtins, with an Effect-TS tab for each new example and a new draft entry. The order
lifecycle sources and README are copied to the website example. The check: the
compiler builds each changed Effektive example; the website `deno task test` and
`deno task typecheck` exit 0. The website edits get their own commit in `../effektive`.

### Decisions D1 to D4

On 2026-11-10 the user accepted option (a) of D1, D2, D3, and D4. COU2a did not depend
on them.

D1 (unary `-` at the start of a block item, COV2). (a) A block item that is not the
first item cannot start with unary `-`. It keeps `syntax/010` with the hint "put `-` at
the end of the previous line, or write `(-x)`". Recommended: today the same source
gives `syntax/010`, so no program changes its meaning. (b) No block item can start with
unary `-`. (c) Accept the hazard and document it.

D2 (`-` and `!` in a refinement predicate, COV6). (a) `compileLinear` reads `-e` as
`0 - e`, and `!e` gets the message "a refinement does not support `!`". Recommended.
(b) Both forms get a specific unsupported message.

D3 (the type of `Cents % Cents`, COV8). (a) Plain `int`, the rule of `*`. Recommended:
fewer parts. (b) `Cents`, the rule of `+` and `-`.

D4 (a `Duration` or `Instant` argument of the new builtins, COV10). (a) `div`, the
rounding builtins, `text`, and `len` reject it with a type mismatch, as `%` does.
Recommended. (b) Accept it through widening.

### Notes from the validation

COV17 corrects CO3: `Math.trunc(a / b)` is probably exact for safe integers. Fable gives
a proof sketch and 2,000,000 seeded pairs with no mismatch. The BigInt form stays,
because it is exact by construction. Its cost needs a measurement if `div` runs in a
loop. COV20 corrects two references: `adoptedNumericIdentity` is defined at
`src/core/check_binary.ts:53`, and `docs/architecture.md` has no IR version rule.

### Phase 1 result

Each unit row above names its commit. Follow-up commits killed the directed mutation
survivors: `4c638ed` and `f4b6db0` for COU1a, `04e1dd0` for COU1b, and `0395551` and
`ed557a3` for COU3. COU1a and COU1b registered two equivalent mutants. `ab0ba8f` tests a
validator rejection site that was already unfired at `cf33c4b`. After `965e3d4`,
`deno task rules:unfired` reports no site, and `deno task check` passes.

`deno task coverage` failed four times in the main tree with "no LCOV record:
src/lsp/main.ts", at load averages from 29 to 67. A fifth run at `965e3d4`, which started
at load 22, passed every floor: lines 97.74%, branches 95.66%, functions 99.55%. So the
phase 1 code does not cause the failure. High load is the probable cause.

One defect is open. Row N3 of the completeness review records that `!true` and `!local`
on a narrowed constant pass `check` but fail `build --tsc` with TS2367.

### Out of scope for phase 1

A negative literal in a type position, unary `-` on a `Duration`, `%` on a unit, text
formatting with a fixed number of decimals, and a descending sort. Each waits for an
example.

## Phase 2 execution plan

Base: `28bb822`. Author: Opus. Validation: Fable on 2026-11-10 at `3452650`, findings
CPV1 to CPV18 (1 blocker, 11 changes, 6 notes). This revision applies every change and
the plan text of the notes CPV15 and CPV16. Status: on 2026-11-10 the user accepted
option (a) of CPD1, CPD2, CPD3, and CPD4, and approved execution. Units CPU1 to CPU5
carry out CO6 and CO7. CO8 is deferred. The "Phase 2 result" section records the
commits.

The N3 fix ([constant comparison plan](../archive/plans/2026-11-10-constant-comparison.md), unit CCU1)
also edits `src/core/emit/expr.ts`. So CCU1 and the phase 2 units run one after another,
not in parallel (CPV2). The line numbers below are at `3452650`.

### Facts that changed the items

Opus checked these facts with scratch builds on 2026-11-10, and Fable confirmed them
(CPV1).

- An inline `all([defer(() => 1), defer(() => "a")])` fails with `type-mismatch/012`,
  also when the result type is `[Int, Text]`. A tuple comes only from a value that
  already has a tuple type: `all(p)` with `p: [Effect<Int>, Effect<Text>]` checks. So
  the premise of CO8, "`all([...])` returns a tuple", is true only for such a value.
- `const { n, t } = all({ n: defer(() => 1), t: defer(() => "a") })` builds with `--tsc`
  and 0 diagnostics. So the record form covers the case that CO8 names.
- `len(p)` of a tuple `p` gives `type-mismatch/003` "string or an array is expected".
  `at` and `sort` take an array in the same way.
- `0 / 0` builds as a `number`, so a `sort` key can be NaN.
- `a < b` checks for two `Duration` values and for two `Instant` values, and both emit
  as `number`. `<` on two `string` values gives `type-mismatch/007`, because `<`, `<=`,
  `>`, and `>=` order only numeric classes (`src/core/check_binary.ts:400-413`).
- No builtin returns `Option` today. `at` is the first. `o ?? 0` and a `match` with
  `Some` and `None` already check on an `Option<Int>`.
- `fixtures/applications/stream-processor/processor.eff:15` counts a batch with
  `fold(0, (count, _item) => count + 1)`. Phase 1 added `len` for this case.
- No fixture, playground example, or website example uses `at`, `sort`, or `concat` as
  a name (CPV18).

### Decisions CPD1 to CPD4

- CPD1, `at` with a negative index. (a) `at(xs, -1)` gives `None`, as every index
  outside the array does. **Recommended**, because one rule covers every bad index.
  (b) A negative index counts from the end, as JavaScript `Array.prototype.at` does.
- CPD2, spread positions. (a) A spread can stand at any position, and a literal can
  hold several spreads: `[x, ...xs]`, `[...xs, x]`, and `[...xs, ...ys]`.
  **Recommended**, because prepend and concatenation need the same form. (b) Only the
  append form `[...xs, x]`.
- CPD3, a NaN key in `sort`. (a) NaN sorts after every other number, and two NaN keys
  are equal, so the order stays stable and complete. **Recommended**, because the result
  is then defined for every input. (b) A NaN key is a defect, `RangeError("NaN sort
  key")`. (c) The order is not specified, as in JavaScript.
- CPD4, CO8 tuple reads. (a) Defer CO8 until an example needs a tuple read. The record
  form of `all` with record destructuring covers the named case. A value of tuple type
  still has no read form, so row FF4 stays open. **Recommended**, because it removes the
  only IR kind of phase 2. (b) Tuple destructuring `const [a, b] = p` for a value of
  tuple type only, with a new IR kind `element`. (c) Option (b), and `all` also infers a
  tuple from an inline list literal, so `const [n, t] = all([one, two])` checks. Option
  (c) needs new inference, because `all` does not pass an expected tuple type to an
  inline list (CPV16).

The units below follow option (a) of each decision. The execution order is CCU1, then
CPU1, CPU2, CPU3, CPU4, and CPU5.

### Shared rules

The phase 1 rules P1, P2, P4, P6, P7, and P8 apply. One line of P2 has moved: the
`counts` record is now at `src/core/emit/expr.ts:1747` (CPV2). These rules replace or
add to them.

- CPR1 (instance types). `at` is `(E[], int) => Option<E>`. `sort` is `(E[]) => E[]` or
  `(E[], pure (E) => K) => E[]`. An orderable type is an `int`, a `number`, a closed
  unit, a `string`, a union of string literals or of number literals, or a type with
  identity over one of them. E without a key, or K with a key, must be orderable. A
  boolean, a nullable union such as `Int | null`, and a union of two identities are not
  orderable, as `<` rejects them (CPV10). The internal instance `concat` is
  `(E[], E[], ...) => E[]`, with one parameter for each child of the literal. It is not a
  prelude name, so source `concat(...)` stays `unknown-name/001` (CPV3). Each instance is
  pure, with empty effect sets.
- CPR2 (closed units). An index of `at` that is a closed unit gives a type mismatch, so
  `at` joins `UNITLESS_BUILTINS` (`src/core/validate/expr.ts:20-27`). Its message
  follows `div`: "... but int is expected" (CPV9). `sort` accepts a closed unit element
  or key, because sorting does not change a value.
- CPR3 (IR). Phase 2 adds no IR expression kind. The instance names `at`, `sort`, and
  `concat` change the wire contract (`src/core/validate/import_checks.ts:289-297`).
  The IR version stays 9 by the rule of `docs/status.md:62`, because no release came
  after `99fb296`. Each unit extends the version 9 line under `## Unreleased` in
  `CHANGELOG.md:15`.
- CPR4 (arity and pipeline). `at` uses `piped(2, "pure")`, so `xs |> at(0)` checks.
  `sort` takes one or two arguments, so it uses
  `optionalLast(1, "`sort` takes an array and an optional key function")`
  (`src/core/check_builtins/rows.ts:120-131`), and its arity test row uses `bounded`
  (CPV8). `xs |> sort` and `xs |> sort((x) => x.k)` check.
- CPR5 (key callback). The `sort` key does not follow `mapCall`, which allows effects
  (`src/core/check_builtins/collections.ts:229`). It omits `allowEffects`, as
  `src/core/check_builtins/schema.ts:517` does, and does not use `callbackFunction`. So
  an effectful key gives `execution-mode/001` "the callback of `sort` must be pure with
  empty failure and requirement sets" (`src/core/check_expr.ts:1420-1425`). The
  validator selects its callback rule by name (`src/core/validate/expr.ts:1419-1423`),
  so `sort` must join that rule. The checker exports one predicate
  `isOrderable(table, ref)` from `check_binary.ts`: `comparisonClass` is defined, and
  `isNumericClass` or `isStringClass` holds. The validator shape rule uses
  `comparisonClass`, `isNumericClass`, and `isStringClass` of
  `src/core/validate/typing.ts:815-883`, which are already exported (CPV8).
- CPR6 (emission). `at(xs, i)` prints `$at(xs, i)`. `$at` is
  `<T>(xs: ReadonlyArray<T>, i: number): Option.Option<T>`. It tests
  `i >= 0 && i < xs.length` and gives `Option.some(xs[i])`, else `Option.none()`. It
  does not use a nullish test, because an element can be `null`. It gets the `Option`
  name through `scope.effect("Option")`, as `hostCheckDeclaration` gets `Schema`
  (`src/core/emit/helper_declarations.ts:103-108`) (CPV6). `sort` prints `$sort(xs)` or
  `$sort(xs, key)`. `$sort` constrains the element or the key to `number | string`, so
  the strict check of `deno run --check` accepts its `<` (CPV17). It copies the array,
  so the argument does not change. Its order gives -1 for `a < b`, 1 for `a > b`, and 0
  for equal values. NaN against NaN gives 0, NaN against a number gives 1, and a number
  against NaN gives -1 (CPD3 (a), CPV15). JavaScript sort is stable. The new helpers
  follow the `$div` registration (`helper_declarations.ts`, `module_state.ts`,
  `src/core/emit/emit.ts:121-130`).
- CPR7 (spread lowering, CPV5). A list literal with no spread stays an `array` node, so
  no existing golden file changes. For a literal with a spread:
  - The checker records the `list` fact (`src/core/tables.ts:141`) with a new optional
    field `concat: FunctionType`, the closed type of the instance. `lower.ts:462` reads
    the `list` fact, so a `builtin` fact on a `ListExpr` would throw.
  - The instance has one parameter for each child of the literal, each of the unfolded
    type `E[]`. A spread child lowers to its value. Each other child lowers to a
    one-element `array` node. That node takes its type from the instance parameter, and
    its `execution`, `effects`, and `span` from the child. The callee reference uses the
    span of the list.
  - The emitter prints one array literal. It prints the elements of an `array` argument
    and `...value` for each other argument. It gives each element the element type as
    the expected type, as `src/core/emit/expr.ts:772-780` does. So `[...xs, x]` prints
    `[...xs, x]`, and no `concat` name appears. A pure builtin call prints an effectful
    child inline, so the source order holds.
  - The `counts` row of `concat` is `[]`, and `concat` joins the cases that are not an
    effect leaf.
  - The validator shape rule accepts one or more parameters, each an array type that is
    the same as the result, pure, with empty effect sets.
- CPR8 (tests). Each unit adds one `.eff` file to `fixtures/emit/core-data/`, with an
  exact emit test in `tests/emit_test.ts` and exact runtime values in
  `tests/emit_runtime_slow_test.ts`. The runtime tests print with `JSON.stringify`, so
  an `Option` result asserts `Option.isSome` and its value, or `Option.isNone`, and a
  NaN asserts `Number.isNaN` (CPV12). Each rejection test asserts the exact code and
  message below. A new message gets its row in `docs/language-rules.md`, or
  `deno task rules:unfired` fails (CPV13). Each forged validator fixture gives
  `validation/002`.

### Units

The units run one after another in the main tree, with the review order of phase 1
(COV13): the executor writes a failing test first and hands back without a commit. Opus
reviews the diff, runs `deno task check`, commits, and runs `deno task mutate --only`
on the changed logic lines, `deno task rules:unfired`, and `deno task coverage`.

#### CPU1: CO6 `at` (Sonnet, 60 turns)

Files: the P2 sites; `atCall` in `src/core/check_builtins/data.ts` next to `lenCall`
(`121-143`), because `isClosedUnit` and `instanceCall` are private to that file (CPV6);
the `$at` helper sites; `UNITLESS_BUILTINS` in `src/core/validate/expr.ts`.

Acceptance, in `fixtures/emit/core-data/at.eff`:
- `at([10, 20, 30], 1)` is `Some(20)`. The indexes `3` and `-1` give `None`.
- `at(xs, 0) ?? 0`, a `match` with `Some` and `None`, and `xs |> at(0)` check and give
  exact values.
- `at(cents, 0)` with `cents: Cents[]` fits `Option<Cents>`. `at(ints, 0)` with
  `ints: Int[]` at `Option<Cents>` gives `type-mismatch/003`.
- `type-mismatch/003` "the argument has type Pair, but an array is expected" for a tuple
  argument. `type-mismatch/003` "... but int is expected" for a `string` index and for a
  `Duration` index.
- A forged `at` instance with a wrong type, and a forged call with a `Duration` index,
  each give `validation/002`.

#### CPU2: CO6 spread (Sonnet, 80 turns)

Files: `src/core/parse.ts` list literal (`1436-1441`) with a new
`SyntaxKind.SpreadElement`; every `ListExpr` consumer: `src/core/resolve.ts:1145-1155`
(its default returns silently, so it needs a case), `src/core/check_expr.ts` `listExpr`
(`1567-1639`) and `markCheckedSlots` (`824`), `src/core/check_refinements.ts:287`,
`src/core/infer_inputs.ts:235`, `src/core/requirement_provenance.ts:257-262`,
`src/core/check_builtins/schema.ts:595,1182`; `src/core/tables.ts:141`;
`src/core/lower.ts:462-469`; the `concat` instance at the P2 sites, without a `PRELUDE`
entry. The lexer already has `...`, so the TextMate grammar and the playground
highlighter need no edit (CPV7).

Acceptance, in `fixtures/emit/core-data/spread.eff`:
- `[0, ...[1, 2], 3]` gives `[0, 1, 2, 3]`, and `[...xs, ...ys]` gives the joined
  array. `all([...jobs, job])` checks and runs. The emitted text has no `concat` name.
- `[...missing]` gives `unknown-name/001`.
- A parameter without a type, used as `[...xs, 1]`, gives `type-mismatch/003` "the spread
  has type unknown, but an array is expected", as `len(xs)` gives today.
- `type-mismatch/003` "the spread has type Int, but an array is expected" for a spread
  of a non-array.
- `type-mismatch/012` "a spread gives an array, but the tuple [Int, Int] is expected" for
  a spread where the expected type is a tuple.
- `type-mismatch/012` "spread element 2 has element type Text, which has no common array
  element type with Int" for a spread of another element type.
- A spread in the list of `schemaUnion` gives `type-mismatch/003` "`schemaUnion` takes
  a list literal of schemas without a spread", and no internal error.
- `const v: NonEmpty = [1, ...ys]` gives `type-mismatch/013` "the function body does
  not prove the required refinement NonEmpty", because a literal with a spread has no
  proven length.
- A forged `concat` instance whose parameter is not an array gives `validation/002`.

#### CPU3: CO7 `sort` (Sonnet, 70 turns)

Files: the P2 sites; `sortCall` in `src/core/check_builtins/collections.ts`, with the key
callback of CPR5; `isOrderable` in `src/core/check_binary.ts`;
`src/core/validate/import_checks.ts` `checkCallbackShape` (`171-264`) and the callback
rule in `src/core/validate/expr.ts:1419-1453`; the `$sort` helper sites.

Acceptance, in `fixtures/emit/core-data/sort.eff`:
- `sort([3, 1, 2])` gives `[1, 2, 3]`. `sort(["b", "a", "B"])` gives `["B", "a", "b"]`.
  A keyed sort of records with equal keys keeps their input order. `sort([2, 0 / 0, 1])`
  gives `1` and `2` first, and `Number.isNaN` holds for the third value. The argument is
  unchanged after the call.
- `sort` of `Duration[]`, `sort` of `Cents[]` that fits `Cents[]`, `sort` of `Name[]`,
  a keyed sort with a `string` key, `xs |> sort`, and `xs |> sort((x) => x.k)` check
  and give exact values (CPV14).
- `type-mismatch/003` "the argument has type Flag[], but an array of an orderable type
  is expected" for a boolean element. `type-mismatch/003` "the key has type Flag, but an
  orderable type is expected" for a boolean key. `type-mismatch/003` "the argument has
  type Pair, but an array is expected" for a tuple argument. `execution-mode/001` for an
  effectful key.
- A forged `sort` instance with a `boolean` key type, and a forged call with an
  effectful key closure, each give `validation/002`.
- A new `tests/sort_property_slow_test.ts`, in the pattern of
  `tests/division_property_slow_test.ts`, shows a permutation, an ordered key sequence,
  and stability.

#### CPU4: witness and status (Sonnet, 40 turns)

Files: `fixtures/applications/stream-processor/processor.eff:15` and its generated
files; `docs/status.md`; rows FF3/FC6 and FF4 of
`docs/plans/2026-11-10-completeness-review.md`.

Acceptance: the processor uses `len(batch) > 0`, and its runtime test passes unchanged.
The status rows name the phase 2 commits. Row FF4 says "open, deferred by CPD4" and
gives the facts above (CPV16).

#### CPU5: website (Sonnet, 60 turns)

Files: `../effektive/public/effektive-spec.html` (both tabs);
`../effektive/public/effektive-examples/stream-processor/`; the draft number in the
files that COU6 changed.

Acceptance: one checked example for `at`, `sort`, and spread. The website
`deno task test` and `deno task typecheck` pass. The compiler tests
`website_examples_slow_test` and `ir_site_slow_test` pass.

### Phase 2 result

CCU1 ran first, in `3d1f53a`, with mutation tests in `0b6e562`. CPU1 is `ebc2fec`, CPU2
is `865e6a7`, and CPU3 is `6a35c93`. Follow-up commits killed the directed mutation
survivors: `89c6612` for CPU1, `d4a9673` and `3dcf595` for CPU2, and `4cb9c5d` for CPU3.
Two commits deleted code that no test can observe: `8cfb28e` (a count guard that
`concat` never reaches) and `07e3fb8` (a key execution test that `isQuiet` already
makes). No survivor is registered. CPU4 is `4e2f8a8`. CPU5 is website `68c9a2d`, draft
0.79. Opus kept the service headers of the website stream processor example and changed
only its batch count to `len`.

Opus changed three executor results during review. CPU1 got a runtime case for a
`null` element, which gives `Some(null)`. CPU2 got tests that show a literal with a
spread does not prove a refined argument or field. CPU3 got tests that reject a union
of two identities and a record element, and accept a union of number literals.

Two facts differ from the plan text. A literal with a spread at an expected array type
has the unfolded type `E[]`, because the validator compares the call type with the
`concat` result. So `const v: NonEmpty = [1, ...ys]` reports "the constant does not
prove the required refinement NonEmpty". A spread of another element type at an
expected array type gives the `type-mismatch/003` message "spread element N has type
T, but U[] is expected". The `type-mismatch/012` message of the plan fires only when the
element type is inferred.

The plan named `markCheckedSlots` as a CPU2 site, and it did not change. It marks the
children of a list for a checked host parameter, but not the value inside a spread. So
a spread value at a checked parameter gets the strict fit. A looser fit would also need
a run-time check of each spread element.

The review found the defect N4 of the completeness review, which existed before phase 2:
a list literal constructs a foreign sealed array type.

### Out of scope for phase 2

A descending sort option, a sort with a comparison function, index syntax `xs[i]`, a
spread in a tuple, string order for `<`, and `at` on a string. Each waits for an
example.

## Phase 3 execution plan

Base: `aada289` (release 0.15.7). Author: Opus. Validation: Fable on 2026-11-10 at
`307980b`, findings CQV1 to CQV17 (3 blockers, 9 changes, 5 notes). This revision
applies each blocker and change, and the plan text of the notes. Status: on 2026-11-10
the user accepted option (a) of CQD1, CQD2, CQD3, CQD4, and CQD5, and approved
execution. Units CQU1 to CQU3 carry out CO9. The line
numbers below are at `aada289`.

### Facts that changed the item

Opus checked these facts with a scratch project on 2026-11-10.

- `match x { null => 0, _ => 1 }` on `type MaybeInt = Int | null` gives `pattern/004` "a
  match cannot take a value of type MaybeInt; version 0 matches options, errors, ...".
  `domainOf` (`src/core/patterns.ts:90-151`) returns `unsupported`, because the members
  are not all literals and not one primitive.
- `match x { null => 0, _ => 1 }` on `type MaybeShape = Shape | null`, with `Shape` a
  union of two tagged records, gives the `mixed` diagnostic `pattern/004`.
- A literal-only union with `null`, such as `type Mode = "a" | "b" | null`, already
  matches with literal arms and `null`. Such a union has identity (`docs/language-rules.md:51`).
  A union with a non-literal member, such as `Int | null`, is a transparent alias
  (`docs/language-rules.md:52`), so `flattenIdentityMembers` sees its `null` member.
- A bare name arm `n => 1` gives `unknown-name/001` "unknown error `n`". The resolver
  sends a `NamePattern` to `ctorRef` (`src/core/resolve.ts:789-803,1371-1375`), which
  knows only `None`, `Some`, types, and errors.
- `x ?? 0` on `Int | null` gives `type-mismatch/010` "the left operand of `??` must be
  an Option" (`src/core/check_expr.ts:2773-2804`). `??` on an Option lowers to an IR
  `match` with a `some` and a `none` arm (`src/core/lower.ts:1228-1258`).
- The emitter prints a match that is not an option match as a selector chain
  (`src/core/emit/expr.ts:1533-1602`), and a binding arm as `((n) => body)(selector)`.
  A scratch file shows that `deno run --check` accepts
  `(($s) => $s === null ? 0 : ((n) => n + 1)($s))(x)` for `x: number | null`:
  TypeScript narrows the selector after the `null` test and types `n` from it.
- Release 0.15.7 shipped IR version 9 (`src/core/ir.ts:323`,
  `src/core/validate/serialization.ts:41`). A new pattern kind changes the wire form, so
  phase 3 raises the version to 10 by the rule of `docs/status.md`.
- No gate application and no website example consumes a nullable union.
  `../effektive/public/effektive-examples/core1.eff` declares one.
- `type Nil = null` has identity, and the language rules tell users to write `Nil` in
  annotations. `match` on `Int | Nil` gives the same `pattern/004` as `Int | null`. In
  `type M = Mode | Int`, the `null` is inside the identity `Mode`, and `match` gives
  `pattern/004` too.
- A block constant `const s: MaybeItem = null` emits as `const s: MaybeItem = null`,
  and TypeScript narrows `s` to `null`. Then the selector
  `(($s) => $s === null ? 0 : ((n) => n.r)($s))(s)` fails `deno check` with TS2339
  "Property 'r' does not exist on type 'never'". With the annotated selector
  `($s: MaybeItem) => ...`, the same text passes. This is the family of N3.
- `tests/ir_site_slow_test.ts` compares `../effektive/public/typed-ir.ts` byte for byte
  with the text that `scripts/site_ir.ts` generates from `src/core/ir.ts`, and it
  compares `../effektive/public/log.ir.json` with `fixtures/ir/example/log.ir.json`. So
  each change of `ir.ts` needs a paired website commit, as `99fb296` and website
  `d81866e` did for version 9.
- No test or error fixture expects `unknown-name/001` or `unknown-name/004` for a
  bare-name arm. A module constant `f1` as an arm gives `unknown-name/004` "`f1` is a
  value, not an error" today (CQV5).
  `fixtures/errors/pattern-nominal-subject.eff:48` has `Circle => "bare"`, and `Circle`
  is a type, so it keeps `pattern/004`.

### Decisions CQD1 to CQD5

- CQD1, the form that reads the value. (a) A binding arm in `match`: `null => d` and
  then `n => f(n)`, where `n` gets the subject type without `null`. This is the CO9
  candidate. It extends `match`, and it adds no builtin name. A misspelled constructor
  such as `Nnoe` becomes a binding, so the checker rejects a binding arm in every other
  place with a message that names this cause. **Recommended.** (b) A builtin `option(x)`
  from `T | null` to `Option<T>`, emitted as `Option.fromNullable(x)`. The existing
  `Some` and `None` arms and `??` then apply. It needs no pattern or resolver rule. The
  instance name changes the wire contract, so it also raises the IR version, and it
  needs a validator shape rule (CPR3). Each use adds a call, and AGENTS.md prefers an
  extended form to a new name.
- CQD2, `??` on a nullable union. (a) `x ?? d` accepts each subject that CQR1 calls
  `nullable`. A literal-only union with `null`, such as `Mode`, keeps
  `type-mismatch/010`. It lowers to the same match as `match x { null => d, v => v }`,
  so it adds no IR kind of its own. The result type joins the type without `null` and
  the fallback. **Recommended**, because a
  default value is the most frequent use, and TypeScript users expect this form. (b) Only
  `match` reads a nullable union.
- CQD3, the subjects that take a binding arm. (a) Every subject whose members include
  `null` and at least one member that is not a literal: `Int | null`, `Cents | null`,
  `Item | null` for a record, `Shape | null` for tagged records, and `Int | Text | null`.
  The binding gets the other members. The one exception is a `null` inside another
  identity, as in `Mode | Int` (CQR1). **Recommended**, because the rule needs no list
  of member kinds. (b) Only `null` with one primitive or one identity over a primitive, as the CO9
  title says. Every other nullable union keeps `pattern/004`.
- CQD4, validation of this plan. (a) A Fable subagent validates the plan before
  execution, as for phase 2, and Opus resolves each finding CQV before CQU1 starts.
  **Recommended**, because AGENTS.md asks for a reviewer before a non-trivial plan runs.
  (b) Execution starts after the user accepts CQD1 to CQD3.
- CQD5, a binding name with an upper-case first letter (CQV17). By CQR3, a misspelled
  name such as `Circl` in `match s { null => 0, Circl => 1 }` on `MaybeShape` is a
  binding, and the match checks. (a) Keep CQR3: any name that is not a constructor is a
  binding. **Recommended**: in a nullable match a constructor arm is foreign anyway, and
  the misspelled name then matches every value except `null`, as the arm text says. In
  every other match the name gives the `pattern/004` "is not a constructor" message.
  Effektive has no case rule today, and this option adds none. (b) A name with an
  upper-case first letter keeps `ctorRef`, so `Circl` gives `unknown-name/001`. This
  adds a case rule to the language.

The units below follow option (a) of each decision.

### Shared rules

The phase 1 rules P7 (documents) and P8 (fixtures) and the phase 2 rule CPR8 (tests)
apply. The rules P1, P2, P4, and P6 are about builtin names and `int` results, and phase 3
adds neither. These rules add to them.

- CQR1 (domain). `domainOf` gets a new kind `{ kind: "nullable"; rest: TypeRef }`. A
  null member is an identity member (`flattenIdentityMembers`) whose unfolded node is
  the literal `null`, so both `null` and `Nil` count. The kind applies when the subject
  has a null member and `literalValuesOf(table, subject)` is `undefined` (CQV1). So
  `Bool | null`, `M2 | null`, and `M2 | Nil` with `M2 = "a" | "b"` stay `literals`, and
  their literal arms keep working. The test comes before the nominal test, so
  `Shape | null` is `nullable`, not `mixed`. `rest` is the union of the identity members
  that are not null members, so `Cents | null` and `Cents | Nil` give `Cents`. When
  another identity member hides `null` in its body, as `Mode` does in `Mode | Int`, the
  subject keeps `pattern/004`, because `rest` cannot drop that `null` and keep the
  identity. `describeDomain` gives "the nullable union T", with T the shown subject type.
- CQR2 (arms). A `nullable` subject takes three arm forms: the literal `null`, `_`, and
  a binding `n`. A binding arm must come after the `null` arm. It matches every value
  except `null`, and its local has the type `rest`. An arm after a binding arm is
  unreachable. Every other pattern gives `pattern/003` with the new domain text. The
  coverage message lists `null` and `_` for what is missing. `MatchState` gets a field
  for a binding arm, because `reach` prints the "`_` arm" text from `state.wildcard`,
  and `src/core/check_expr.ts:2897` skips coverage only for `state.wildcard` (CQV6).
  A rejected binding arm calls `bindLocal` with the error type and records the fact
  `invalid`, as the rejected `CtorPattern` paths do (`check_patterns.ts:155-165`). In a
  silent domain (`error`, `mixed`, `unsupported`) a binding arm gives no diagnostic of
  its own. `n => 1, null => 0` gives exactly one diagnostic, the `pattern/004`: no
  `pattern/002` on the `null` arm and no `pattern/001`.
- CQR3 (resolver). In `pattern` (`src/core/resolve.ts:1368`), a `NamePattern` keeps
  `ctorRef` when its name is `None` or `Some`, a namespace target of kind `type`,
  `error`, or `unresolved`, or a key of `EFFECT_ERROR_IDS` (`resolve.ts:757-776`, CQV4).
  Every other name declares a local, as the binding of `Some(x)` does. So a binding can
  shadow a module constant. A reserved prelude name or a target name gives
  `declaration/002`, as for every local. Before this change, such a name gave
  `unknown-name/001` or `unknown-name/004`, and no test or error fixture expects either
  code for a match arm (CQV5). The case of the first letter does not matter (CQD5).
- CQR4 (IR). The IR `Pattern` union (`src/core/ir.ts:126-133`) gets
  `{ kind: "bind"; binding: Parameter; span: Span }`. The IR version becomes 10 at the
  sites that `99fb296` changed: `src/core/ir.ts`, `src/core/lower.ts:1707`,
  `src/core/validate/serialization.ts:41`, `fixtures/ir/example/log.ir.json`,
  `fixtures/ir/examples-baseline.json`, the five tests
  `tests/emit_alias_resolution_test.ts`, `tests/emit_module_state_test.ts`,
  `tests/lower_test.ts`, `tests/serialize_layout_test.ts`, and
  `tests/validate_test.ts` (CQV9), and the version sentence in `docs/api.md`,
  `docs/architecture.md`, `docs/inferred-input-contracts.md`, and `docs/status.md`.
  `tests/lsp_editor_test.ts:60` has an LSP document `version: 9`, which does not change.
  The sentence "The IR version 9 holds the `%` operator" in `docs/language-rules.md:27`
  stays true and does not change. One new `CHANGELOG.md` line under `## Unreleased` says
  that version 10 adds the pattern `bind` and that the validator rejects version 9. The
  paired website change follows website `d81866e`: `scripts/site_ir.ts` regenerates
  `../effektive/public/typed-ir.ts`, `../effektive/public/log.ir.json` copies the
  fixture, and the specification sentence names version 10. `ir_site_slow_test` reads
  the website working tree, so the uncommitted website files satisfy it during review.
  Opus commits the two repositories at the same time (CQV16).
- CQR5 (validator). The validator does not trust the checker. The rule is in
  `matchExpr` (`src/core/validate/expr.ts:1659`), because it needs state across arms. A
  `bind` pattern needs an earlier arm with the literal pattern `null`. The subject needs
  at least one null member: an identity member `m` with `unfold(env, m)` equal to the
  literal `null`. No other identity member may have `null` in `members(env, m)` (CQV7).
  The binding type must be `same` as the union of the identity members that are not
  null members. Each fault gives `validation/002`, and each new `.add(AREA.` site gets a
  forged fast test, or `deno task rules:unfired` fails. Forged cases follow the
  registry in `scripts/validate_fixtures.ts:315-325`.
- CQR6 (emission). `patternBinding` (`src/core/emit/walk.ts:15`) returns the binding of
  `bind`. In `armTest` (`src/core/emit/expr.ts:1604`), a `bind` arm has no test, as `_`
  has none. In `selectorMatch`, `finalWildcard` (`expr.ts:1565`) is also true for a
  final `bind` arm, so that arm is the else branch and not `$unmatched(selector)`.
  `optionLike` (`expr.ts:1491-1497`) stays false for a match with a `bind` arm. A match
  with a `bind` arm annotates the selector parameter with the subject type, so a
  narrowed block constant does not make the binding `never`. The selector reaches
  `this.arrow` as a string at `expr.ts:1578-1590`, so the annotation needs a Doc with
  `typeDoc(this.scope, subjectType)`, as at `expr.ts:1240` (CQV8). The output is
  `(($t0: MaybeInt) => $t0 === null ? d : ((n) => body)($t0))(x)` in the form that
  `deno fmt` keeps. `build --tsc` must pass for each new fixture. Fable checked the
  pure form, the effectful form in `Effect.gen`, an effectful `??` fallback, a nested
  tagged match, and the narrowed constant with `deno check` and `deno fmt` (CQV13).

### Units

The units run one after another in the main tree, with the review order of phase 2: the
executor writes a failing test first and hands back without a commit. Opus reviews the
diff, runs `deno task check`, commits, and runs `deno task mutate --only` on the changed
logic lines, `deno task rules:unfired`, and `deno task coverage`.

Source rule for all units (CQV2): `null` is legal only inside a type or error
declaration, so `(x: Cents | null)` gives `declaration/013`. Each subject below is a
declared alias: `type MaybeInt = Int | null`, `type MaybeCents = Cents | null`,
`type MaybeShape = Shape | null`, `type MaybeItem = Item | null` with
`type Item = { r: Int }`, `type MaybeBool = Bool | null`, and `type MaybeM2 = M2 | null`.
`Int | Nil` with `type Nil = null` is legal in an annotation.

Test placement (CQV3): `fixtures/emit/core-data/` is one emit project that must build
with `--tsc`. So only accepted cases go to `fixtures/emit/core-data/nullable.eff`, with
the exact emitted text and runtime values of CPR8. Each rejection goes to a checker
test with the exact code and message, or to a file in `fixtures/errors/` with the
marker convention of `docs/development.md`.

#### CQU1: binding arm (Sonnet, 110 turns)

Files: `src/core/resolve.ts`; `src/core/patterns.ts`; `src/core/check_patterns.ts`
(`missingOf`, `pattern`, `reach`, `describeDomain`, `MatchState`); `src/core/tables.ts`
(`PatternFact` kind `bind`); `src/core/check_expr.ts` (`match`: the subject message at
`2817`, the refinement local of a `bind` binding at `2866`, and the coverage skip at
`2897`); `src/core/diagnostics.ts:203-218` (the descriptions of `pattern/001`,
`pattern/002`, and `pattern/004`); `src/core/lower.ts` (`pattern` at `1286`);
`src/core/ir.ts`; `src/core/validate/expr.ts`; `src/core/validate/serialization.ts`;
`scripts/validate_fixtures.ts`; `src/core/emit/walk.ts`; `src/core/emit/expr.ts`;
`docs/language-rules.md` (the row "null in matches and equality", the row "Match by
name limits" at line 90, and the rows of `pattern/004`); `CHANGELOG.md`; the version
sites of CQR4; the website files of CQR4, without a website commit. No LSP file changes:
rename, references, completion, and semantic tokens follow the resolver target of kind
`local` (`src/core/editor_index.ts:53,84,151`) (CQV15).

Accepted cases, in `fixtures/emit/core-data/nullable.eff`:
- `match x { null => 0, n => n + 1 }` on `MaybeInt` gives `0` for `null` and `3` for
  `2`. The same match on `MaybeCents` fits a `Cents` result for `n`, and the same match
  on `Int | Nil` checks.
- A block constant `const s: MaybeItem = null`, followed by a match with a binding arm
  that reads `n.r`, passes `build --tsc` and gives the `null` arm value.
- A binding arm on `MaybeShape` gives a binding that fits a `Shape` parameter, and a
  nested match on it with `Circle(c)` and `Square(s)` arms gives exact values (CQV11).
- `null => 0, _ => 1` on `MaybeInt` checks.
- `match` on `MaybeBool` with the arms `null`, `true`, and `false`, and `match` on
  `MaybeM2` and on `M2 | Nil` with literal arms, still check (CQV1).
- A subject whose type comes from another module, and a subject type whose annotation
  is longer than 80 columns, pass `build --tsc` and keep the `deno fmt` form (CQV13).
- `TimeoutError => 0` keeps its `pattern/004` "a constructor pattern needs a binding"
  in a checker test (CQV4).

Rejected cases, in checker tests or `fixtures/errors/`:
- `match x { null => 0 }` on `MaybeInt` gives `pattern/001` "the match is not
  exhaustive; it needs _".
- `n => 1, null => 0` gives only `pattern/004` "a binding arm must come after the
  `null` arm".
- An arm after `n => ...` gives `pattern/002` "this arm is unreachable, because an
  earlier binding arm matches every value except null".
- `Nnoe => 0, Some(v) => v` on an Option gives `pattern/004` "`Nnoe` is not a
  constructor; a binding arm applies only after the `null` arm of a nullable union", and
  `pattern/001` "the match is not exhaustive; it needs None" (CQV6).
- `f1 => 0`, with `f1` a module constant, on a non-nullable subject gives the same
  `pattern/004` message with `f1` (CQV5).
- `Circle(c) => 0` on `MaybeShape` gives `pattern/003` "`Circle` does not belong to the
  subject (the nullable union MaybeShape)".
- `match` on `Mode | Int` keeps the `pattern/004` subject message, and that message
  lists nullable unions.
- A forged `bind` without an earlier `null` arm, a forged `bind` binding of the type
  `MaybeInt`, and a forged `bind` on the subject `Mode | Int` each give
  `validation/002`. A version 9 IR gives the existing version error.

Hover (CQV11): the executor first writes a hover test on the binding of `Some(x)`. If
hover shows its type, a second test shows the type of `n` without `null`. If hover
shows nothing for `Some(x)`, the hover case leaves CQU1, and the executor reports it.

The executor writes each message exactly as above. If a message must change, the
executor reports the reason in the handback.

#### CQU2: `??` on a nullable union (Sonnet, 50 turns)

Files: `src/core/check_expr.ts` (`optionFallback` at `2773`); `src/core/tables.ts` (the
`option-fallback` fact gets a field that says which subject kind it has); `src/core/lower.ts`
(`optionFallback` at `1228`); `docs/language-rules.md`, including line 726, which says
that `??` "does not unwrap null" (CQV10); `CHANGELOG.md`.

Accepted cases, in `fixtures/emit/core-data/nullable.eff`:
- `x ?? 0` on `MaybeInt` gives `0` for `null` and `5` for `5`. `c ?? 0` on
  `MaybeCents` fits `Cents`.
- An effectful fallback runs only for `null`. The runtime test shows this with a counter
  or a failure that does not occur for a value.
- A test shows that the lowered IR of `x ?? 0` has the arms `literal null` and `bind`,
  so the validator rule of CQR5 covers it.

Rejected cases, in checker tests: `x ?? 0` on `Int`, `m ?? "a"` on `Mode`, and
`b ?? false` on `MaybeBool` each give `type-mismatch/010` "the left operand of `??`
must be an Option or a nullable union". No test asserts the old message today, so CQU2
adds the first exact test of it (CQV12).

#### CQU3: website (Sonnet, 60 turns)

Files: `../effektive/public/effektive-spec.html` (both tabs: the match section and the
`??` row); one example in `../effektive/public/effektive-examples/`; the draft number in
the files that COU6 changed.

Acceptance: one checked example for the binding arm and for `??` on a nullable union.
The website `deno task test` and `deno task typecheck` pass. The compiler tests
`website_examples_slow_test` and `ir_site_slow_test` pass.

Opus updates `docs/status.md`, row FF5 of the completeness review, and the status line
of this plan after CQU2.

### Out of scope for phase 3

Flow narrowing after `x === null` in `if`. A binding arm in a literal-only union with
`null`, such as `Mode`, because literal arms already cover it. Tagged or error arms in
the same match as `null`: the source nests a match in the binding arm. A binding arm on
a subject without `null`. A shorter emitted form `x ?? d` for a nullable `??`. Each
waits for an example.
