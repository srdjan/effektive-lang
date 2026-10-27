# Effect surface leftovers

Date: 2026-10-27. Baseline: `9e0227e`. EL identifies this plan's units.
Status: validated by Fable, approved by the user on 2026-10-27, complete.

The [effect surface plan](2026-10-27-effect-surface.md) closed
with four open points, (a) to (d). On 2026-10-27 the user chose to close them
in one plan before a second selection of Effect features. This plan covers
those four points. It selects no other item of the
[status table](../../status.md#effect-4-features-to-surface-in-source).

## Evidence from the baseline

The plan author checked each point with the compiler at `9e0227e`. The probe
project was a scratch directory with an empty `effektive.json`.

- **Point (a) is a documentation gap only.** The archived plan states that
  source has no way to get an `Int` millisecond count from a `Duration`. That
  statement is wrong. With `type Ms = int`, `Ms(d)` converts a `Duration` to an
  `Ms`, and `n * 1ms` converts an `Ms` to a `Duration`. Both pass
  `effektive build --validate --tsc`. The emitted code is `d` and
  `$int(n * 1)`. Only the implicit fit is closed: `(d: Duration): Ms => d` gives
  `type-mismatch/003`, as the closed-identity rule requires.
- **Point (b) is a defect of the closed-identity rule.** A duration literal
  pattern lowers to the IR pattern `literal { value: 5000 }`. So the checker and
  the validator cannot tell `5s` from `5000`. Three observed behaviors follow:
  - `match (n) { 5s => ..., _ => ... }` with `n: Int` passes with no
    diagnostic and compares with 5000.
  - `match (d) { 5000 => ..., _ => ... }` with `d: Duration` passes with no
    diagnostic. A bare int never fits a `Duration` anywhere else.
  - `match (t) { 5s => ... }` with `t: Text` gives `pattern/003` with the text
    "5000 does not belong to the subject". The text does not show the source
    spelling `5s`.
  `docs/language-rules.md:18` records the first two behaviors as a rule.
- **Point (c) is smaller than stated.** The validator requires empty failure
  and requirement rows on a pure function type (`validate/world.ts:372-380`).
  So the three-part test in the `update-ref` case (`emit/expr.ts:1768-1771`) is
  equal to the existing helper `isEffectfulFunction` (`emit/expr.ts:411`), which
  the ES8 call path uses through `isLeaf`. The checker repeats the same
  three-part test on a checker `FunctionNode` at
  `check_builtins/collections.ts:504-505`, `check_builtins/effect.ts:417-419`
  and `check_expr.ts:1448-1450`.
- **Point (d), Cron, needs a new builtin.** `effect@4.0.5` has `Cron.parse`,
  `Cron.parseUnsafe`, `Cron.next` and `Schedule.cron`. The declared type of
  `Schedule.cron` is `Schedule<Duration, unknown, CronParseError>`. The error
  channel holds `CronParseError` even when the argument is a parsed `Cron`
  value. `Schedule` has no combinator that removes an error. The emitter already
  builds schedules with `Schedule.fromStepWithMetadata` and `Cause.done`
  (`emit/families/schedule.ts:92-138`), so a cron schedule can use the same
  route with no error channel.

## Decisions

These decisions change the source that users write. On 2026-10-27 the user
chose (a) for EL-D1 and EL-D2.

- **EL-D1 (cron expression).** (a) The expression must be a string literal.
  The compiler checks its grammar and reports an invalid expression as a
  diagnostic. The schedule has no failures (recommended). (b) Any `Text`
  value. The schedule fails with a new reserved error `CronParseError`, and
  each `retry` or `repeat` that uses it must handle that error.
- **EL-D2 (time zone).** (a) An optional second string literal names an IANA
  time zone. Without it, the schedule uses UTC (recommended, because the
  result then does not depend on the host). (b) Without it, the schedule uses
  the local time zone of the host, as Effect does.

## EL1: one effectful-callback test (point c)

This unit changes no behavior.

- Emitter: the `update-ref` case uses `this.isEffectfulFunction(e.transform.type)`
  in place of its three-part test.
- Checker: add one exported function, `isEffectfulFunction(fn: FunctionNode)`,
  next to `FunctionNode` and `invocationOf` in `check_builtins/context.ts`. It
  returns true when the execution is not `pure` or when a failure or
  requirement set is not empty. The helper keeps all three parts, because
  `table.function` (`types.ts:742`) does not enforce empty rows on a pure
  function. The three checker sites above use it. At
  `collections.ts:504`, `fn` can be undefined, so the call is
  `fn !== undefined && isEffectfulFunction(fn)`. The diagnostics and their
  order do not change.
- `check_expr.ts:538` tests a run result, not a `FunctionNode`. It stays as it
  is.
- The validator keeps its own checks. A validator module must not import
  checker code.

Verification: `deno task check`, and `deno task behavior:capture 9e0227e HEAD`
with zero missing records and no changed records. Golden outputs do not change.

## EL2: typed duration patterns (point b)

A duration literal pattern has the type `Duration`. A plain number pattern
keeps its current type.

- **IR.** Add the pattern kind `duration { millis: number; span }` to
  `src/core/ir.ts`. A new kind makes each exhaustive `switch` over `Pattern`
  fail to compile until it handles the kind. The IR version stays 7, because
  Effektive has no users yet. Cache keys hash file text (`db.ts:401`), not the
  version, and no fixture uses the new kinds, so `examples-baseline.json` does
  not change. EL4 adds the kind to the website copy of the IR.
- **Pattern domain** (`patterns.ts:100-160`). `domainOf` unfolds a `Duration`
  subject to `{ kind: "open", primitive: "int" }` today. Add a `duration` flag
  to the `open` domain. `describeDomain` (`check_patterns.ts:439-440`) prints
  "a Duration" for it.
- **Checker fact** (`tables.ts:88`). `PatternFact` gets a `duration` kind with
  the millisecond value and the source text.
- **Checker** (`check_patterns.ts`, the `LiteralPattern` case near line 277).
  The case asks `isDurationText` (`lex.ts:278`, exported by ES1b) whether the
  token has a duration suffix.
  - A duration pattern fits only an open domain with the `duration` flag.
    Otherwise it is `pattern/003`.
  - A plain number pattern does not fit an open domain with the `duration`
    flag. It gives `pattern/003`, as the closed fit requires.
  - The `pattern/003` text shows the source spelling, for example "5s does not
    belong to the subject (a string)".
  - Exhaustiveness and reachability use the millisecond value, so `5s` and a
    later `5000ms` arm are the same value, and the second arm is
    `pattern/002`.
  - A union subject such as `Duration | Text` stays `pattern/004`, as today. An
    `Option<Duration>` subject works through a nested `match`.
- **Checker narrowing** (`check_expr.ts:2840`). The call to
  `refinements.matchLiteral` runs for a `duration` fact too, with the
  millisecond value.
- **Lowering** (`lower.ts` near line 1547) emits `duration` for a duration fact.
- **Validator** (`validate/expr.ts`, `pattern` near line 1731, and `matchExpr`
  near line 1683). A `duration` pattern needs a subject whose members include
  `type:effect/Duration`. A numeric `literal` pattern does not fit a
  `Duration` member. The refinement step treats `duration` as the numeric
  literal `millis`. A forged `duration` pattern with a non-integer or unsafe
  `millis` is a diagnostic.
- **Emitter.** Each site that handles a `literal` pattern handles `duration` as
  the number `millis`: `emit/walk.ts:23` and `armTest` in `emit/expr.ts:1439`.
  The emitted TypeScript of an existing `5s` pattern on a `Duration` subject
  does not change.
- **Tests that change.** `tests/duration_type_test.ts:245-253` asserts the old
  behavior and flips. `tests/lower_test.ts:618` asserts the set of pattern
  kinds in the wide fixture, so that fixture gets one duration pattern.
  `serialization.ts` and the validator walkers do not switch on pattern kinds.

Verification:

- `5s` on a `Duration` subject passes and runs.
- `5s` on an `Int` subject and `5000` on a `Duration` subject give
  `pattern/003`.
- `5s` on a `Text` subject gives the text with `5s`.
- `5s` and then `5000ms` gives the existing unreachable-arm diagnostic.
- Forged IR: a `duration` pattern on an `int` subject, a `literal` 5000 on a
  `Duration` subject, and a `duration` pattern with `millis: 1.5`.
- No fixture, golden output, website example or `fixtures/validate/*.json`
  uses a duration pattern at the baseline. Golden outputs do not change.

## EL3: `scheduleCron` (point d)

This unit follows the user's choice of EL-D1 (a) and EL-D2 (a).

**Form.** `scheduleCron(expression)` and `scheduleCron(expression, zone)`.
Both arguments are string literals. The call is pure, like the other schedule
constructors. The row uses `optionalLast` (`rows.ts:100`) for the one-or-two
arity, and the prelude entry is `shadowable: true`. The result is
`Schedule<Duration>` with `unknown` input, no failures and no requirements. The
output is the delay to the next matching time, in milliseconds.

**Grammar check.** A new module, `src/core/cron.ts`, holds a pure function that
checks an expression and returns a reason for each invalid one. It imports no
checker or validator code, as `predicates.ts` does today, so both the checker
and the validator can use it. The grammar copies `Cron.parse` of
`effect@4.0.5` (`dist/Cron.js`, `parse` and `parseSegment`):

- Five or six fields, split on white space. Tabs and outer spaces are
  accepted. Four and seven fields fail. Five fields mean seconds `0`.
- The field ranges are seconds 0-59, minutes 0-59, hours 0-23, days 1-31,
  months 1-12 and weekdays 0-7, where 7 means Sunday.
- A field is a comma list. An empty item, as in `1,,2`, fails. Each item is
  `*`, a value, or a range `a-b`, with an optional step `/n`. `*` is valid at
  any list position, as in `*,5` and `5,*`. `*/1` equals `*`.
- A value is decimal digits. Leading zeros pass (`01`). `+1`, `1.5` and `-1`
  fail.
- A plain value with a step means the value to the field maximum: `5/10` is
  5, 15, 25 and so on.
- The step check runs before the value check. A step is an integer greater
  than 0 and no greater than the field maximum.
- A range must have `a <= b`. The range check runs before the weekday 7 becomes
  0, so `5-7`, `7-7` and `sun-7` pass, and `mon-sun` fails.
- Months accept `jan` to `dec`, and weekdays accept `sun` to `sat`, in any
  letter case, also inside a range.

The time zone check mirrors `DateTime.zoneFromString` of `effect@4.0.5`
(`dist/internal/dateTime.js`), which `Cron.parse` uses (`Cron.js:419`):

- A zone that starts with `GMT`, `+` or `-` passes only when it ends with an
  offset `+hh:mm` or `-hh:mm`. So `"+03:00"` passes, and `"GMT"` and `"-0530"`
  fail, although `Intl` accepts them.
- Every other zone passes when `Intl.DateTimeFormat` accepts it as `timeZone`.
  So `"UTC"`, `"utc"` and `"europe/london"` pass.

This check runs in Deno and in the browser playground. The ICU data of the
compiling host can differ from that of the running host. The plan records this
limit and does not try to remove it.

**Diagnostics.** An expression or a zone that is not a string literal, and an
invalid expression or zone, give the existing `type-mismatch/010` ("a prelude
function gets an argument it does not accept"). For an invalid value, the text
adds the reason from `cron.ts`. The span is the argument.

**IR.** New kind `schedule-cron { expression: string; zone: string }`. Lowering
stores `"UTC"` when the source has no zone. The validator runs the grammar and
zone checks of `cron.ts` again and recomputes the type
`Schedule<Duration, unknown>`.

**Emission.** Add `"Cron"` to `EffectModule` (`emit/scope.ts:33`). The
emitter has no general hoist for module constants (`emit.ts:148-156` emits
fixed helpers only), so the schedule parses inline:
`Schedule.fromStepWithMetadata(Effect.suspend(() => ...))` calls
`Cron.parseUnsafe(expression, zone)` once for each execution of the schedule.
The compiler check makes a parse failure impossible, except for an ICU
difference between hosts. Such a failure is a defect at the first step, not at
module load. Each step is as follows:

- When `now` is `Number.POSITIVE_INFINITY`, the step returns `Cause.done(0)`.
  The output is a number of milliseconds, not `Duration.zero`.
- Otherwise the step computes `Cron.next(cron, now)` and the delay
  `next - now`. It returns the delay as the output in milliseconds and as
  `Duration.millis(delay)`.

This mirrors the body of `Schedule.cron` in `dist/Schedule.js:404-416`, without
the parse error channel. `Cron.next` accepts a number (`Cron.d.ts:439`), and
`InputMetadata.now` is a millisecond number (`Schedule.d.ts:58`).

**Recognition and editor.** Add `scheduleCron` to `PRELUDE` in `resolve.ts`, one
row to `SCHEDULE_ROWS`, the builtin pattern of
`editors/vscode/syntaxes/effektive.tmLanguage.json` (line 122) and the builtin
tables of `docs/language-rules.md`. The playground highlighter and editor
completion derive from `PRELUDE_NAMES`, so they need no change.
`tests/builtin_rows_test.ts` checks the new row.

Verification:

- A differential test in `tests/` compares `cron.ts` with `Cron.parse` of
  `effect@4.0.5` on a fixed list of valid and invalid expressions. The list
  covers each rule of the grammar list above and each zone case of the zone
  list. The test compares validity only, not Effect's messages. The two must
  agree on each input.
- `repeat(job, { schedule: scheduleCron("*/5 * * * * *") })` under `TestClock`
  runs at the expected virtual times. A second case uses a zone that is not UTC
  and checks the virtual time of the first run.
- `retry` with a cron schedule waits until the next match.
- `scheduleMax(scheduleCron(...), scheduleRecurs(3))` stops after three
  repetitions.
- Diagnostics: a non-literal expression, an invalid expression, an invalid
  zone, and wrong arity.
- Forged IR: an invalid expression, an invalid zone, and a wrong result type.
- Strict target check of the emitted TypeScript shows no `CronParseError` in
  any exported type.

## EL4: documentation and close

- Point (a): `docs/language-rules.md` row 19 and the website spec state that a
  constructor of a user identity over `int`, such as `Ms(d)`, converts a
  `Duration`, and that `n * 1ms` converts back. A test fixes this behavior with
  `--validate` and `--tsc`.
- Point (b): replace the pattern sentence in `docs/language-rules.md` row 18.
- Point (d): add `scheduleCron` rows. Mark status item 5 as done in
  `docs/status.md`.
- Update the spec, its grammar and its examples in `../effektive/public/`.
  Add the two new kinds to `../effektive/public/typed-ir.ts` by hand, as the
  ES11 website commit `2690fbc` did. That file is not a verbatim copy of
  `ir.ts`: it inlines the predicate types. Commit the website separately.
- Correct open point (a) of the archived effect surface plan with a pointer to
  this plan.
- Move this plan to `docs/archive/plans/` and update the registry.

## Order and gates

EL1 comes first, because it is a refactor and EL2 and EL3 touch the same files.
EL2 comes before EL3, because both add IR shapes and EL4 updates the website
IR once.
EL4 comes last. Each unit
ends with `deno task check` and its own commit.

## Validation

A Fable subagent validated the first draft on 2026-10-27 and re-ran the
baseline probes. It confirmed the evidence for points (a) to (d). The plan
author accepted all seven corrections:

1. The zone check mirrors `DateTime.zoneFromString`, not `Intl` alone.
   Otherwise `"GMT"` passes the compiler and throws at run time.
2. A `Duration` subject needs a `duration` flag in the pattern domain. The
   union clause was removed, because a union subject is `pattern/004` today.
3. EL2 names the missed sites: `PatternFact`, the checker narrowing, the
   emitter arm test and two tests that change.
4. Emission adds `Cron` to `EffectModule`, parses inline, and states the
   `Cause.done(0)` case.
5. The grammar list states the full rules of `Cron.parse`.
6. Diagnostics reuse `type-mismatch/010`, and the row uses `optionalLast`.
7. EL4 edits the website IR by hand, because it is not a copy of `ir.ts`.

The validation also noted that `pattern/003` prints "a int" for an int
subject (`check_patterns.ts:440`). This plan does not change that text.

## After this plan

On 2026-10-27 the user also chose the second selection of Effect features:
item 22 (`Map` and `Set`), item 18 (`now()` and `random()`) and item 16
(logging). That selection gets its own plan after EL4.

## Disposition

Units EL1 to EL4 are done. The commit that archives this plan completes EL4.

- Plan: `f289c3c`, approval and EL-D1 and EL-D2 (a): `6cdd74b`.
- EL1 one effectful-callback test: `2df8ff0`. The behavior capture of
  `6cdd74b` and `2df8ff0` gave 11865 records on each side, 0 new and 0
  missing.
- EL2 typed duration patterns: `cae9e60`.
- EL3 `scheduleCron`: `e45a929`.
- EL4 website spec draft 0.67: `f4e0904` in `../effektive`.

These points stay open:

- (a) `pattern/003` prints "a int" for an int subject.
- (b) A host whose ICU data differs from the compiling host can reject a zone
  that the compiler accepted. The schedule then fails with a defect at its
  first step.
- (c) The second selection (items 22, 18 and 16) needs its own plan.
