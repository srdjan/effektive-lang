# Effect surface, first selection

Date: 2026-10-27. Baseline: `fb0cb8d`. ES identifies this plan's units.

On 2026-10-27 the user accepted a change to the target. Effektive exposes an
Effect 4 feature only when the feature carries user intent that the compiler
cannot infer. The transpiler uses every other feature in the emitted TypeScript.
The candidate list is in
[status.md](../status.md#effect-4-features-to-surface-in-source). The user
selected items 1 to 8 and 19 to 21 first. This plan covers those items, plus
duration literals (ES1), which items 1 to 4 need.

## Design rules

- Extend an existing form before adding a builtin name.
- A control operation takes a zero-argument function, as `retry` and `provide`
  do. The spec rule "These control functions require a zero-argument function"
  applies unchanged.
- A duration is an `int` count of milliseconds. The existing `DelayMs` alias,
  `scheduleSpaced`, `debounceStream` and `throttleStream` use the same unit.
- A negative duration is a runtime defect, as for `retrySchedule`.
- No Effect module name becomes a source name or a source type word. `Exit`,
  `Cause`, `Duration` and `SynchronizedRef` stay in the emitted TypeScript.
- Each new IR kind and each new rule gets an independent validator rule, as
  [builtin-changes.md](../builtin-changes.md) requires.
- Every new prelude name is `shadowable: true`: `timeout`, `sleep`, `repeat`,
  `uninterruptible`, `scheduleExponential` and `scheduleJittered`. No fixture or
  website example uses these words as identifiers. Each unit adds its names to
  the builtin pattern of `editors/vscode/syntaxes/effektive.tmLanguage.json`
  and to the builtin tables of `docs/language-rules.md`.
- Pipeline forms: `timeout`, `repeat` and `uninterruptible` use `piped`, like
  `retry` (`check_builtins/effect.ts:331`). `sleep`, `race` and the schedule
  constructors use `direct`.

The Effect target is the pinned `effect@4.0.5`. The plan and its validation
checked these facts in its `dist/*.d.ts` files:

- `Effect` exports `timeout`, `sleep`, `repeat`, `forever`, `onExit`,
  `uninterruptible`, `catchDefect`, `raceAll`, `filter`, `reduce` and
  `forEach`.
- `Effect.retry` and `Effect.repeat` accept `{ times, schedule, while, until }`.
  The predicates can be pure or return an Effect.
- `Effect.repeat` with an options record returns the last success value `A`,
  also when the record holds a `schedule`.
- `Schedule.exponential` returns `Schedule<Duration>`. `Schedule.jittered` is a
  combinator that keeps `<O,I,E,R>`. `Schedule` has no `while` or `until`.
- `Schedule.max` recurs while all schedules recur. `Schedule.min` recurs while
  any schedule recurs and uses the shorter delay. The first version of this plan
  stated the `min` rule incorrectly; the ES3 runtime test found the error.
- `SynchronizedRef<A>` does not extend `Ref<A>`. It holds a backing `Ref` and a
  `Semaphore`. `updateEffect` keeps the old value when the callback fails.
- `Effect.timeout` fails with `Cause.TimeoutError`, after the interrupted job
  completes its finalizers.
- `Effect.raceAll` returns the first success and fails only when all fail.
- `Effect.reduce` takes the initial value as a function. `Effect.filter` with an
  effectful predicate has only the curried form.

## Decisions

These decisions change the source that users write. On 2026-10-27 the user
chose (a) for ES-D1 to ES-D5. ES-D3 (a) still depends on the ES9 measurement.
After ES1 to ES5 landed, the user changed ES-D1 to (b): a `Duration` type. A
rework unit, ES1b, replaces the `int` durations of ES1 to ES3.

- **ES-D1 (duration syntax).** (a) Literals `200ms`, `5s`, `2m` and `1h` that
  mean an `int` count of milliseconds (recommended). (b) A `Duration` type.
  (c) Plain integers only.
- **ES-D2 (form of `uninterruptible`).** (a) A call with a zero-argument
  function, `uninterruptible(() => { ... })`, which matches `retry` and needs no
  parser change (recommended). (b) A block form, `uninterruptible { ... }`.
- **ES-D3 (representation of `Ref`).** (a) `makeRef` always emits a
  `SynchronizedRef`, so one source type supports pure and effectful updates
  (recommended, if the ES9 measurement shows an acceptable cost). (b) A separate
  source type for effectful updates.
- **ES-D4 (outcome shape).** (a) An anonymous structural tagged union with the
  members `Success`, `Failure`, `Defect` and `Interrupted`, and no new type
  word, like the result of `allResults` (recommended). (b) A named builtin type
  `Outcome<A,E>`. (c) A boolean pair for failure and interruption.
- **ES-D5 (finalizer failures).** (a) Finalizer failures join the result, as
  `using` release failures do today (`check_builtins/scope.ts:215-230`) and as
  `Effect.onExit` and `acquireUseRelease` allow (recommended). (b) Every
  finalizer must have an empty failure set. This breaks existing `using` code.

## ES1: duration literals (ES-D1)

The lexer accepts a suffix `ms`, `s`, `m` or `h` directly after the digits of an
integer, inside the `Number` token. Today `scanNumber` (`src/core/lex.ts:266-303`)
reports syntax/006 "a number cannot be followed by letters" for `5s`, so no
valid program changes meaning. The suffix is accepted only for these four units.
A fraction (`1.5s`) or an exponent (`5e3ms`) with a suffix keeps a lex
diagnostic.

The one literal-value reader, `src/core/syntax_queries.ts:104-116`, converts the
suffix to milliseconds: `200ms` is 200, `5s` is 5000, `2m` is 120000, `1h` is
3600000. A value above the safe integer range is a diagnostic. The type is
`int`, so every existing millisecond parameter accepts the literal. The IR does
not change. Hover, semantic tokens and generated source maps keep the source
spelling.

Files: `src/core/lex.ts`, `src/core/syntax_queries.ts`, diagnostics,
`editors/vscode/syntaxes/effektive.tmLanguage.json` (number pattern), tests.
Verification: each unit, the fraction, exponent and overflow diagnostics, a
literal passed to `scheduleSpaced`, hover text, and an unchanged lexer snapshot
for the existing fixtures.

## ES1b: the `Duration` type (ES-D1 b, ES-D6 a, ES-D7 a)

The user changed ES-D1 to (b) after ES1 to ES10 landed, and chose (a) for
ES-D6 and ES-D7. Effektive has no users yet, so the breaking changes below need
no migration path; the fixtures, examples and tests migrate in this unit.

Type. `Duration` is a builtin type word. It is a builtin nominal type over
`int`, with the identity `type:effect/Duration`, defined like the builtin error
identities (`types.ts`, `resolve.ts`, `validate/world.ts`). It follows the
existing nominal rules: a `Duration` fits `int`; an `int` does not fit
`Duration`; `+` and `-` on two `Duration` values give a `Duration`; comparisons
work. A new rule adds scaling: `Duration * int`, `int * Duration` and
`Duration / int` give a `Duration`. Division rounds toward zero, as `int`
division does. Every other operator widens to the base type, as for any nominal.

Literals. A duration literal (`5s`) has the type `Duration`. Lowering wraps the
millisecond value in the existing `nominal` IR node, so the IR gains no kind and
the validator checks it like any nominal construction. A bare `int` literal
never becomes a `Duration`. Source code has no `Duration(...)` constructor
call; `n * 1ms` converts a runtime `int`.

Emission. A `Duration` is a plain number of milliseconds at run time. The
emitted type is a branded number, as other numeric nominals emit, so Effect
APIs that take a millisecond number accept it. Effect's `Duration` module stays
hidden.

Builtins that change from `int` to `Duration`:

- `timeout` and `sleep` take a `Duration`.
- `scheduleSpaced(delay)` and `scheduleExponential(base, factor?)` take a
  `Duration`. Their output type becomes `Duration`.
- `debounceStream(stream, delay)` takes a `Duration` literal. `throttleStream`
  options rename `durationMs` to `duration`, a `Duration` literal.
- `retrySchedule` callbacks return `Option<Duration>`. The builtin alias
  `DelayMs` is removed.
- `scheduleFromStep` decisions rename `delayMillis` to `delay: Duration`.
  `ScheduleInput` fields `elapsed` and `elapsedSincePrevious` become `Duration`.
  `start` and `now` are clock instants, not durations, and stay `int`.
  `ScheduleMetadata` renames `durationMillis` to `duration: Duration`.

The implementer lists every other millisecond site found before changing it.
Fixtures, examples, tests and `docs/language-rules.md` migrate in the same unit.
The golden outputs change only where the source changed.

Verification: `timeout(job, 5)` and `scheduleSpaced(retries)` give a type
diagnostic; `n * 1s` and `1s + 500ms` type as `Duration`; `5s * 2.5` widens and
does not fit `Duration`; a `Duration` passes where an `int` is expected; each
renamed field; forged IR for a `Duration` literal and a scaling operation; all
application gates and runtime tests pass after migration.

## ES2: `timeout` and `sleep` (items 1 and 2), and IR version 7

`timeout(job, durationMs)` takes a zero-argument function and an `int`. It runs
the job with a time limit. Its result type is the job result type. Its failure
set is the job failures plus the builtin error `TimeoutError`. Its requirements
are the job requirements. When the limit passes, the job is interrupted, and its
finalizers complete before `TimeoutError` is raised.

`TimeoutError` is a builtin error identity, `error:effect/TimeoutError`. Source
can name it in `fails` clauses and `catch` arms, but cannot construct it. It
follows each site that reserves `SchemaError` today:

- `resolve.ts:178-181` (`EFFECT_ERROR_IDS`) and `resolve.ts:189-199`
  (`TARGET_NAMES`).
- `types.ts:384-387` (`defineError`, with a `message` field), and the
  data-only rejection at `types.ts:1436-1439` and `validate/typing.ts:162-165,
  610`.
- `check_expr.ts:954-962` (no construction).
- `validate/world.ts:102-105` and `validate/expr.ts:1229-1235`.
- `emit/scope.ts:678-679` (type positions emit `Cause.TimeoutError`) and
  `emit/expr.ts:383-385` (the tag).

`sleep(durationMs)` takes an `int`, returns `unit`, and has no failures or
requirements. It has effect execution mode.

IR: this unit bumps the IR to version 7. ES3 to ES10 add their kinds under
version 7. The version consumers are `lower.ts:1827`,
`validate/serialization.ts:48-54`, `tests/lower_test.ts:691`,
`tests/emit_alias_resolution_test.ts:37`, `fixtures/ir/examples-baseline.json`,
`../effektive/public/log.ir.json` and the spec sentence "IR version 6". Check the
compiler cache keys for the version. Regenerate the baseline only after naming
the expected difference (the version field). New kinds:
`timeout { job; durationMs }` and `sleep { durationMs }`. Both duration children
are expressions.

Emission: `Effect.timeout(Effect.suspend(job), ms)` and `Effect.sleep(ms)`, each
with a runtime check that the duration is not negative.

Files: `src/core/ir.ts`, `resolve.ts`, `check_builtins/effect.ts`, `tables.ts`,
`lower.ts`, the `TimeoutError` sites above, `validate/families/`,
`emit/families/`, `emit/calls.ts`, tests.
Verification: a job that ends before the limit, a job that exceeds it, a `catch`
arm for `TimeoutError`, a finalizer inside the timed job that runs before the
handler (slow test), a negative duration defect, construction of `TimeoutError`
(diagnostic), and forged IR for each new kind.

## ES3: general retry options (item 4)

`retry(job, options)` takes a literal options record with at least one of these
keys:

- `times`: a nonnegative safe integer literal, as today.
- `schedule`: a `RetrySchedule<E>`, as today, or a general `Schedule<O,I,E2,R2>`
  whose input `I` accepts every job failure. The result adds `E2` and `R2`.
- `while` and `until`: a one-parameter callback over the job failure union that
  returns `boolean`. The callback can be pure or effectful. Its failures and
  requirements join the result.

An unknown key, a duplicate key, or an empty record is a diagnostic. Defects and
interruption are not retried.

Lowering: `{ times: N }` alone keeps kind `retry`. Every other record lowers to
`retry-with-schedule` with the record as `options`. Today `retryTimes`
(`check_builtins/effect.ts:280-282`) requires exactly one field, and
`retryScheduleOption` (`effect.ts:308-326`) detects a one-field `schedule`
record. Both change. The validator checks each key of the record independently.

New Schedule operations:

- `scheduleExponential(baseMs, factor?)` has `unknown` input and `int` output in
  milliseconds. It emits
  `Schedule.map(Schedule.exponential(ms, factor), ...)` with `Duration.toMillis`,
  as the `schedule-max` emitter does (`emit/families/schedule.ts:59-71`).
- `scheduleJittered(schedule)` keeps the schedule type `<O,I,E,R>`. It emits
  `Schedule.jittered`.

Only `scheduleMax` limits an exponential schedule by count, for example
`scheduleMax(scheduleExponential(100ms), scheduleRecurs(5))`. `scheduleMin`
does not stop by count, and it takes the zero delay of `scheduleRecurs` while
both recur.

IR: new kinds `schedule-exponential` and `schedule-jittered`.
Verification: each key alone and in combination, unknown and duplicate keys, a
schedule input that does not accept a job failure (diagnostic), effectful
`while`, attempt counts and delays for exponential backoff under virtual time,
and forged IR.

## ES4: `repeat` (item 3)

`repeat(job)` runs the job again after each success, without end. Its result
type is `never`. Only a typed failure, a defect or an interruption ends it, so a
caller uses `race`, `timeout` or a fiber to stop it.

`repeat(job, options)` takes the ES3 keys with the job success type in place of
the failure type. A `RetrySchedule` in `schedule` is a diagnostic, because it
takes failures as input. The call returns the last success value. The first run
is not a repetition, and `times` counts the repetitions after it. A typed
failure stops repetition and propagates.

IR: new kind `repeat { job; options: Expr | null }`.
Emission: `Effect.forever(Effect.suspend(job))` or
`Effect.repeat(Effect.suspend(job), options)`.
Verification: `times`, a schedule, `while` over the success value, a
`RetrySchedule` diagnostic, `repeat(job)` stopped by `timeout`, typed failure
propagation, and forged IR.

## ES5: outcome-aware cleanup (item 6, ES-D4, ES-D5)

The grammar of `try` becomes
`"try" block ["catch" "{" handlers "}"] ["finally" ["(" Name ")"] block]`, with
at least one of `catch` and `finally`. The `using` finalizer accepts the same
optional binding: `finally (outcome) { ... }`. A `withResource` release
callback can take a second parameter.

The binding has an anonymous structural tagged union type:
`{ _tag: "Success", success: A } | { _tag: "Failure", failure: E } |
{ _tag: "Defect", message: string } | { _tag: "Interrupted" }`.
`A` and `E` are the result type and remaining failure union of the protected
part. When `E` is empty, the `Failure` member is omitted. For `try`, the
protected part is the block and its `catch` handlers. When a cause has an
interruption and other reasons, the outcome is `Interrupted` only if the cause
has no typed failure and no defect. Otherwise a typed failure wins over a defect.
The `Success` member keeps the data-only rule of the `using` result.

The finalizer returns `unit`. Under ES-D5 (a), its failures and requirements
join the result, as release failures do today. It runs once, without
interruption, after the protected part ends. The implementer confirms the
interruption mask of `Effect.onExit` in the Effect 4.0.5 runtime with a test.

Files: `parse.ts` and `syntax.ts` (a finally clause node and its binding),
`resolve.ts` (binding scope), `check_expr.ts`, `check_builtins/scope.ts`,
`lower.ts` (today it looks only for `CatchClause` at `lower.ts:1537-1553`, and
the release closure takes only the resource parameter at `lower.ts:720-760`),
`validate/families/scope.ts` (today arity one at lines 197 and 210),
`emit/families/scope.ts`, and the spec grammar `tryExpr`.

IR: the `with-resource` release closure takes one or two parameters. New kind
`ensure { body; finalizer: ClosureExpr }`, where the closure has zero or one
parameter.
Emission: `Effect.onExit` and the release callback of `acquireUseRelease`, with
one emitted helper that maps an `Exit` to the outcome record.

Verification: each outcome member at runtime, including interruption by `race`
(slow test), a finalizer that fails, `try` with only `finally`, `catch` before
`finally`, an omitted `Failure` member, the outcome type in hover, and forged IR.

## ES6: defect recovery (item 7)

A `catch` block can hold one arm `Defect(name) => expression`. The binding has
type `{ message: string }`. The message is the `message` of an `Error` defect,
else the string form of the defect. The arm does not need a failure in the
protected set. Its body type joins the result like other handlers. Interruption
is not caught. Because `catchDefect` wraps outside the typed handlers, the arm
also catches a defect raised inside a typed handler body.

`Defect` is a handler keyword, not an error identity. It is added only to
`TARGET_NAMES` (`resolve.ts:189-199`), so a user error named `Defect` is a
declaration diagnostic. The special case runs before the error-target lookup at
`check_expr.ts:2600-2640`.

IR: the `catch` node gets an optional `defect` handler.
Emission: `Effect.catchDefect` outside the typed handlers.
Verification: a thrown host defect, an `int` arithmetic defect, a defect inside
a typed handler, a typed failure and an interruption that the arm does not
catch, the reserved name diagnostic, and forged IR.

## ES7: `uninterruptible` (item 8, ES-D2)

`uninterruptible(job)` takes a zero-argument function and keeps its result,
failures and requirements. An interruption request waits until the job ends.

IR: new kind `uninterruptible { job }`.
Emission: `Effect.uninterruptible(Effect.suspend(job))`.
Verification: a `race` that loses during the job and still lets the job finish
(slow test), and forged IR.

## ES8: effectful collection callbacks (item 19)

`map`, `filter` and `fold` accept effectful callbacks. With a pure callback,
nothing changes. With an effectful callback, the call has effect mode, and its
failures and requirements are those of the callback. Execution is sequential and
stops at the first typed failure. Effectful `map` without options overlaps
`traverse` without options. This redundancy is accepted, and `traverse` stays
for concurrency options.

IR: none. The specialized builtin types carry the callback execution and
effects, as for `traverse`. The validator change is in the builtin
specialization check (`validate/builtins.ts`, `validate/world.ts:1116-1172`),
which today treats only `traverse` and `all` as effectful.

Emission: `Effect.forEach` for `map`. `Effect.filter` in its curried form
`Effect.filter(predicate)(items)` for `filter`. `Effect.reduce(items, () =>
initial, callback)` for `fold`, because `reduce` takes the initial value as a
function.

Verification: each builtin in direct and pipeline form, pure behavior unchanged
(golden output), order of side effects, stop at the first failure, and forged
specialization types.

## ES9: effectful `updateRef` (item 20, ES-D3)

`updateRef(ref, callback)` accepts an effectful callback. Updates on one `Ref`
stay atomic. The call adds the callback failures and requirements. A failed
callback leaves the value unchanged.

Before the implementation, measure the cost of ES-D3 (a): time `Ref.update`
against `SynchronizedRef.update` with the bench harness, and record the result in
`docs/measurements.md`. Report the result to the user before choosing (a) or
(b). Check that no host interface accepts or returns a `Ref`.

Measured on 2026-10-27 with `Deno.bench`, `effect@4.0.5`, Deno 2.9.8, one Mac,
two runs. Each case ran 1,000 updates inside one `Effect.gen`.
`Ref.update` took 36.2 and 36.9 µs. `SynchronizedRef.update` took 184.3 and
182.2 µs. `SynchronizedRef.updateEffect` took 241.7 and 237.7 µs. A pure
update costs about 150 ns more, about five times as much. The effect on an
application is not measured. The user confirmed ES-D3 (a) after this result.
The ES9 commit adds the benchmark script and this result to
`docs/measurements.md`.

Emission under (a): `makeRef`, `getRef`, `setRef` and `updateRef` use
`SynchronizedRef`, and an effectful callback uses `SynchronizedRef.updateEffect`.
`emit/types.ts` emits `SynchronizedRef.SynchronizedRef<A>` for every Ref type.
The expected golden difference is the Ref module and type names only, with no
behavior change.

Verification: atomicity under bounded `traverse` with an effectful update, a
failing callback, and existing Ref runtime tests unchanged.

## ES10: `race` over an array (item 21)

`race(jobs)` accepts a homogeneous array of Effect values, as `partitionAll`
does. It returns an Effect value, as `race(left, right)` does
(`check_builtins/effect.ts:214-245`). The Effect returns the first success and
interrupts the others. If every job fails, it fails with the union of their
failures. An empty array is a runtime defect. `race(left, right)` does not
change. The `race` row is `direct(2, "pure")` today (`effect.ts:355`), so it
needs an arity rule for one or two arguments.

IR: new kind `race-all { jobs }`.
Emission: `Effect.raceAll`, after a check for an empty array.
Verification: first success, all failures, loser finalizers (slow test), empty
array defect, arity diagnostics, and forged IR.

## ES11: documentation and close

Update the spec, its grammar and its examples in `../effektive/public/`. Copy
`src/core/ir.ts` to `../effektive/public/typed-ir.ts` and update `log.ir.json`.
Commit the website separately. Update `docs/language-rules.md`, `docs/api.md`,
the playground and editor completion where they list builtins, and the status
table (mark the done items). Move this plan to `docs/archive/plans/` and update
the registry.

## Order and gates

ES1b runs after ES10 and before ES11, because the user changed ES-D1 after the
other units landed.

ES1 comes first. ES2 comes next, because it bumps the IR version. ES3 comes
before ES4, because ES4 reuses the ES3 option checks. ES5 comes before ES6,
because both change `catch`. ES7, ES8 and ES10 are independent. ES9 waits for
the measurement and the user's choice on ES-D3. ES11 comes last, after ES2 and
ES5 change the IR. Each unit ends with `deno task check` and its own commit.
