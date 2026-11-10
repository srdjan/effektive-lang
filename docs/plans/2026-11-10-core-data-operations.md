# Core data operations: selection plan

Date: 2026-11-10. Base: `3808b91` on local `main`. Author: Opus.
Status: on 2026-11-10 the user accepted COD1 (a), COD2 (a), COD3 (a), and COD4 (a). All
nine items are selected. Phase 1 (CO1 to CO5) is done: "Phase 1 result" below gives the
commits and the checks. "Phase 2 execution plan" below is a draft that waits for a Fable
validation and a user approval. Phase 3 needs a detail plan and a user approval before
implementation. So this plan stays in `docs/plans/`.

Prefixes: CO (items), COD (decisions), COU (phase 1 units), COV (phase 1 validation
findings), CPD (phase 2 decisions), CPR (phase 2 shared rules), CPU (phase 2 units),
CPV (phase 2 validation findings).

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

Base: `28bb822`. Author: Opus. Status: draft. Fable validates it, and then the user
decides CPD1 to CPD4 and approves the plan. No code changes before that approval.
Units CPU1 to CPU5 carry out CO6 and CO7. CO8 depends on CPD4.

### Facts that changed the items

Opus checked these facts with scratch builds on 2026-11-10.

- An inline `all([defer(() => 1), defer(() => "a")])` fails with `type-mismatch/012`,
  also when the result type is `[Int, Text]`. A tuple comes only from a value that
  already has a tuple type. So the premise of CO8, "`all([...])` returns a tuple", is
  true only for such a value.
- `const { n, t } = all({ n: defer(() => 1), t: defer(() => "a") })` builds with `--tsc`
  and 0 diagnostics. So the record form covers the case that CO8 names.
- `len(p)` of a tuple `p` gives `type-mismatch/003` "string or an array is expected".
  `at` and `sort` take an array in the same way.
- `0 / 0` builds as a `number`, so a `sort` key can be NaN.
- `a < b` checks for two `Duration` values. The operators `<`, `<=`, `>`, and `>=` order
  only numeric classes today (`src/core/check_binary.ts:400-413`), so no source form
  orders strings yet.
- No builtin returns `Option` today. `at` is the first.
- `fixtures/applications/stream-processor/processor.eff:15` counts a batch with
  `fold(0, (count, _item) => count + 1)`. Phase 1 added `len` for this case.

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
  form of `all` with record destructuring covers the named case. **Recommended**,
  because it removes the only IR kind of phase 2. (b) Tuple destructuring
  `const [a, b] = p` for a value of tuple type only, with a new IR kind `element`.
  (c) Option (b), and `all` also infers a tuple from an inline list literal, so
  `const [n, t] = all([one, two])` checks.

The units below assume option (a) of each decision. Another option changes the named
unit before execution.

### Shared rules

The phase 1 rules P1, P2, P2b, P4, P6, P7, and P8 apply unchanged. These rules replace
or add to them.

- CPR1 (instance types). `at` is `(E[], int) => Option<E>`. `sort` is `(E[]) => E[]` or
  `(E[], pure (E) => K) => E[]`. E without a key, or K with a key, must be a type that
  `<` orders (an `int`, a `number`, a closed unit, or a type with identity over one of
  them), or `string`, or a type with identity over `string`. A boolean key gives a type
  mismatch, as `<` does. The internal instance `concat` is `(E[], E[], ...) => E[]`
  with one or more parameters. It is not a prelude name, so source `concat(...)` stays
  an unknown name. Each instance is pure, with empty effect sets.
- CPR2 (closed units). An index of `at` that is a closed unit gives a type mismatch, so
  `at` joins `UNITLESS_BUILTINS` in `src/core/validate/expr.ts`. `sort` accepts a closed
  unit element or key, because sorting does not change a value.
- CPR3 (IR). Phase 2 adds no IR expression kind. The instance names `at`, `sort`, and
  `concat` change the wire contract (`src/core/validate/import_checks.ts:289-297`).
  The IR version stays 9 by the rule of `docs/status.md:62`, because no release came
  after `99fb296`. Each unit extends the version 9 line under `## Unreleased` in
  `CHANGELOG.md:15`.
- CPR4 (emission). `at(xs, i)` prints `$at(xs, i)`. `sort` prints `$sort(xs)` or
  `$sort(xs, key)`. A helper copies the array, so the argument does not change.
  `concat` prints one array literal: an array literal argument prints its elements, and
  any other argument prints as `...value`. So `[...xs, x]` prints `[...xs, x]`. The new
  helpers follow the `$div` registration (`src/core/emit/helper_declarations.ts`,
  `module_state.ts`, `src/core/emit/emit.ts:121-130`). The order of `$sort` is
  `a < b ? -1 : a > b ? 1 : 0` with the NaN rule of CPD3. JavaScript sort is stable.
- CPR5 (fixtures). Each unit adds one `.eff` file to `fixtures/emit/core-data/`, with an
  exact emit test in `tests/emit_test.ts` and exact runtime values in
  `tests/emit_runtime_slow_test.ts`. CPU3 adds a property test.

### Units

The units run one after another in the main tree, with the review order of phase 1
(COV13): the executor writes a failing test first and hands back without a commit. Opus
reviews the diff, runs `deno task check`, commits, and runs `deno task mutate --only`
on the changed logic lines, `deno task rules:unfired`, and `deno task coverage`.

| Unit | Item | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- | --- |
| CPU1 | CO6 `at` | Sonnet | P2 sites; `src/core/check_builtins/collections.ts` (follow `lenCall` in `data.ts:121-143` for the array parameter); `$at` helper sites; `src/core/validate/expr.ts` `UNITLESS_BUILTINS` | `fixtures/emit/core-data/at.eff`. `at([10, 20, 30], 1)` gives `Some(20)`; the indexes `3` and `-1` give `None`. A tuple argument, a `string` index, and a `Duration` index each give the exact checker diagnostic. A forged instance with a wrong type gives `validation/002`. `const c: Cents = ...` of the element type checks. | 60 |
| CPU2 | CO6 spread | Sonnet | `src/core/parse.ts` list literal (`1436-1441`) with a new `SyntaxKind.SpreadElement`; every `ListExpr` consumer: `resolve.ts:1145-1153`, `check_expr.ts` `listExpr` (`1567-1639`) and `markCheckedSlots` (`824`), `check_refinements.ts:287`, `infer_inputs.ts:235`, `requirement_provenance.ts:185`, `check_builtins/schema.ts:595,1182`; `lower.ts:462-469`; the `concat` instance at the P2 sites, without a `PRELUDE` entry | `fixtures/emit/core-data/spread.eff`. `[0, ...[1, 2], 3]` gives `[0, 1, 2, 3]`, and `[...xs, ...ys]` gives the joined array. A spread of a non-array, a spread where the expected type is a tuple, and a spread element of another element type each give the exact diagnostic. A refinement over the length of a literal with a spread does not count the spread as one element. The emitted text has no `concat` name. | 80 |
| CPU3 | CO7 `sort` | Sonnet | P2 sites; `collections.ts` (follow `mapCall` `222-243` for the key callback); `check_binary.ts:82-109` `comparisonClass` (export it, or reuse its validator twin `validate/typing.ts:815-853`); `validate/import_checks.ts` `checkCallbackShape` (`171-264`) and the callback rule `validate/expr.ts:1419-1453`; `$sort` helper sites | `fixtures/emit/core-data/sort.eff`. `sort([3, 1, 2])` gives `[1, 2, 3]`; `sort(["b", "a", "B"])` gives `["B", "a", "b"]`; a keyed sort of records with equal keys keeps their input order; `sort([2, 0 / 0, 1])` gives `[1, 2, NaN]`; the argument is unchanged after the call. A boolean element, an effectful key, and a tuple argument each give the exact diagnostic. A new `tests/sort_property_slow_test.ts`, in the pattern of `tests/division_property_slow_test.ts`, shows a permutation, an ordered key sequence, and stability. | 70 |
| CPU4 | Witness and status | Sonnet | `fixtures/applications/stream-processor/processor.eff:15` and its generated files; `docs/status.md`; rows FF3/FC6 and FF4 of `docs/plans/2026-11-10-completeness-review.md`; `docs/language-rules.md:729-738` | The processor uses `len(batch) > 0`, and its runtime test passes unchanged. Status rows name the phase 2 commits. Row FF4 gives the CPD4 result and the facts above. | 40 |
| CPU5 | Website | Sonnet | `../effektive/public/effektive-spec.html` (both tabs); `../effektive/public/effektive-examples/stream-processor/`; the draft number in the files that COU6 changed | One checked example for `at`, `sort`, and spread. The website `deno task test` and `deno task typecheck` pass. The compiler tests `website_examples_slow_test` and `ir_site_slow_test` pass. | 60 |

### Out of scope for phase 2

A descending sort option, a sort with a comparison function, index syntax `xs[i]`, a
spread in a tuple, string order for `<`, and `at` on a string. Each waits for an
example.
