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
- No Effect module name becomes a source name. `Exit`, `Cause`, `Duration` and
  `SynchronizedRef` stay in the emitted TypeScript.
- Each new IR kind and each new rule gets an independent validator rule, as
  [builtin-changes.md](../builtin-changes.md) requires.

The Effect target is the pinned `effect@4.0.5`. The plan checked these facts in
its `dist/*.d.ts` files:

- `Effect` exports `timeout`, `sleep`, `repeat`, `forever`, `onExit`,
  `uninterruptible`, `catchDefect`, `raceAll`, `filter`, `reduce` and
  `forEach`.
- `Effect.retry` and `Effect.repeat` accept `{ times, schedule, while, until }`.
  The predicates can be pure or return an Effect.
- `Effect.repeat` with an options record returns the last success value `A`,
  also when the record holds a `schedule`.
- `Schedule` exports `exponential`, `jittered`, `fibonacci`, `upTo` and
  `forever`. It does not export `while` or `until`.
- `SynchronizedRef<A>` does not extend `Ref<A>`. It holds a backing `Ref` and a
  `Semaphore`.
- `Effect.timeout` fails with `Cause.TimeoutError`.

## Decisions

These decisions change the source that users write. Each has a recommendation.

- **ES-D1 (duration syntax).** (a) Literals `200ms`, `5s`, `2m` and `1h` that
  lex to an `int` count of milliseconds (recommended). (b) A `Duration` type.
  (c) Plain integers only.
- **ES-D2 (form of `uninterruptible`).** (a) A call with a zero-argument
  function, `uninterruptible(() => { ... })`, which matches `retry` and needs no
  parser change (recommended). (b) A block form, `uninterruptible { ... }`.
- **ES-D3 (representation of `Ref`).** (a) `makeRef` always emits a
  `SynchronizedRef`, so one source type supports pure and effectful updates
  (recommended, if the ES9 measurement shows an acceptable cost). (b) A separate
  source type for effectful updates.
- **ES-D4 (outcome shape).** (a) A tagged union `Outcome<A,E>` with the members
  `Success`, `Failure`, `Defect` and `Interrupted` (recommended). (b) A boolean
  pair for failure and interruption.

## ES1: duration literals (for ES-D1)

An integer literal followed directly by `ms`, `s`, `m` or `h` is a duration
literal. It lexes to one `int` literal token whose value is the count of
milliseconds: `200ms` is 200, `5s` is 5000, `2m` is 120000, `1h` is 3600000.
The type is `int`, so every existing millisecond parameter accepts it. A
fraction, such as `1.5s`, is a lex diagnostic. A value above the safe integer
range is a lex diagnostic.

Today `5s` gives a parse error, so no valid program changes meaning. The IR does
not change: the literal is an ordinary number. Hover, semantic tokens and the
formatter must keep the source spelling.

Files: `src/core/lex.ts`, the token tables in `src/core/syntax.ts`,
diagnostics, editor token classification, tests.
Verification: each unit, the fraction and overflow diagnostics, a literal passed
to `scheduleSpaced`, hover text, and an unchanged lexer snapshot for the
existing fixtures.

## ES2: `timeout` and `sleep` (items 1 and 2)

`timeout(job, durationMs)` takes a zero-argument function and an `int`. It runs
the job with a time limit. Its result type is the job result type. Its failure
set is the job failures plus the builtin error `TimeoutError`. Its requirements
are the job requirements. When the limit passes, the job is interrupted, and its
finalizers complete before `TimeoutError` is raised.

`TimeoutError` is a builtin error identity, `error:effect/TimeoutError`, handled
like `SchemaError`: source can name it in `fails` clauses and `catch` arms, but
cannot construct it. The emitted tag is the `_tag` of `Cause.TimeoutError`.

`sleep(durationMs)` takes an `int`, returns `unit`, and has no failures or
requirements. It has effect execution mode.

IR: version 7. New kinds `timeout { job; durationMs }` and
`sleep { durationMs }`. Both duration children are expressions.
Emission: `Effect.timeout(Effect.suspend(job), ms)` and `Effect.sleep(ms)`, each
with a runtime check that the duration is not negative.

Files: `src/core/ir.ts` (and its sibling copy, see ES10), `resolve.ts` prelude,
`check_builtins/effect.ts`, `tables.ts`, `lower.ts`, `validate/families/`,
`emit/families/`, `emit/calls.ts`, tests.
Verification: a job that ends before the limit, a job that exceeds it, a `catch`
arm for `TimeoutError`, a finalizer inside the timed job that runs before the
handler (slow test), a negative duration defect, and forged IR for each new kind.

## ES3: general retry options (item 4)

`retry(job, options)` keeps the existing `{ times: N }` and
`{ schedule: RetrySchedule<E> }` forms. It also accepts:

- `schedule` with a general `Schedule<O,I,E2,R2>` whose input `I` accepts every
  job failure. The result adds `E2` and `R2`.
- `while` and `until` with a one-parameter predicate over the job failure union.
  A predicate can be pure or effectful; its failures and requirements join the
  result.
- `scheduleExponential(baseMs, factor?)` and `scheduleJittered(schedule)` as new
  Schedule constructors with `unknown` input and numeric output. The existing
  `scheduleMin`, `scheduleMax` and `scheduleRecurs` combine them with limits.

The options record is a literal record. At least one key is required. `times`
keeps its literal rule. Defects and interruption are not retried.

IR: `retry-with-schedule` keeps its shape. The validator recomputes which
schedule type the options hold. New kinds `schedule-exponential` and
`schedule-jittered`.
Emission: `Effect.retry(Effect.suspend(job), options)` and
`Schedule.exponential`, `Schedule.jittered`.

Verification: each key alone and in combination, an input type that does not
accept a job failure (diagnostic), effectful `while`, runtime attempt counts for
exponential backoff under virtual time, and forged IR.

## ES4: `repeat` (item 3)

`repeat(job)` runs the job again after each success, without end. Its result
type is `never`. `repeat(job, options)` takes the same option keys as ES3, with
the job success type in place of the failure type. It returns the last success
value. The first run counts as the first execution, and `times` counts the
repetitions after it. A typed failure stops repetition and propagates.

IR: new kind `repeat { job; options: Expr | null }`.
Emission: `Effect.forever` or `Effect.repeat(Effect.suspend(job), options)`.

Verification: `times`, a schedule, `while` over the success value, `forever`
interrupted by `race` or `timeout`, typed failure propagation, and forged IR.

## ES5: outcome-aware cleanup (item 6, ES-D4)

The grammar of `try` becomes
`"try" block ["catch" "{" handlers "}"] ["finally" ["(" Name ")"] block]`, with
at least one of `catch` and `finally`. The `using` finalizer accepts the same
optional binding: `finally (outcome) { ... }`. `withResource` accepts a release
callback with a second parameter.

The binding has the builtin type `Outcome<A,E>`:
`{ _tag: "Success", success: A } | { _tag: "Failure", failure: E } |
{ _tag: "Defect", message: string } | { _tag: "Interrupted" }`.
`A` and `E` are the result type and remaining failure set of the protected part.
For `try`, the protected part is the block and its `catch` handlers. When the
cause has both an interruption and other reasons, the outcome is `Interrupted`
only if the cause has no typed failure and no defect. Otherwise a typed failure
wins over a defect.

The finalizer returns `unit`, must have an empty failure set, and its
requirements join the result. It runs once, without interruption, after the
protected part ends. The `Success` member keeps the data-only rule of the
`using` result.

IR: `with-resource` gets an optional second release parameter. New kind
`ensure { body; finalizer: ClosureExpr }`, where the closure has zero or one
parameter.
Emission: `Effect.onExit` and the release callback of `acquireUseRelease`, with
one emitted helper that maps an `Exit` to the outcome record.

Verification: each outcome member at runtime, including interruption by `race`
(slow test), a finalizer that fails (diagnostic), `try` with only `finally`,
`catch` before `finally`, the outcome type in hover, and forged IR.

## ES6: defect recovery (item 7)

A `catch` block can hold one arm `Defect(name) => expression`. The binding has
type `{ message: string }`. The message is the `message` of an `Error` defect,
else the string form of the defect. The arm does not need `Defect` in the
protected failure set. Interruption is not caught. `Defect` is a reserved
handler name, like `SchemaError`; a user error named `Defect` is a declaration
diagnostic.

IR: the `catch` node gets an optional `defect` handler.
Emission: `Effect.catchDefect` outside the typed handlers.

Verification: a thrown host defect, an `int` arithmetic defect, a typed failure
that the defect arm does not catch, interruption that it does not catch, the
reserved name diagnostic, and forged IR.

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
stops at the first typed failure. `traverse` stays for concurrency options.

IR: none. The specialized builtin types carry the callback effects, as for
`traverse`.
Emission: `Effect.forEach`, `Effect.filter` and `Effect.reduce`.

Verification: each builtin in direct and pipeline form, pure behavior unchanged
(golden output), order of side effects, stop at the first failure, and the
validator rule that replaces "callbacks of map, filter and fold are pure".

## ES9: effectful `updateRef` (item 20, ES-D3)

`updateRef(ref, callback)` accepts an effectful callback. Updates on one `Ref`
stay atomic. The call adds the callback failures and requirements. A failed
callback leaves the value unchanged.

Before the implementation, measure the cost of ES-D3 (a): time `Ref.update`
against `SynchronizedRef.update` with the bench harness, and record the result in
`docs/measurements.md`. Report the result to the user before choosing (a) or
(b). Check that no host interface accepts or returns a `Ref`.

Emission under (a): `makeRef`, `getRef`, `setRef` and `updateRef` use
`SynchronizedRef`, and an effectful callback uses `SynchronizedRef.updateEffect`.

Verification: atomicity under bounded `traverse` with an effectful update, a
failing callback, and existing Ref tests unchanged.

## ES10: `race` over an array (item 21)

`race(jobs)` accepts a homogeneous array of Effect values, as `partitionAll`
does. It returns the first success and interrupts the others. If every job
fails, it fails with the union of their failures. An empty array is a runtime
defect. `race(left, right)` does not change.

IR: new kind `race-all { jobs }`.
Emission: `Effect.raceAll`, after a check for an empty array.

Verification: first success, all failures, loser finalizers (slow test), empty
array defect, and forged IR.

## ES11: documentation and close

Update the spec and examples in `../effektive/public/` and copy `src/core/ir.ts`
to `../effektive/public/typed-ir.ts`. Commit the website separately. Update
`docs/language-rules.md`, `docs/api.md` and the status table (mark the done
items). Move this plan to `docs/archive/plans/` and update the registry.

## Order and gates

ES1 comes first. ES2, ES3 and ES4 follow in order, because ES4 reuses the ES3
option checks. ES5 comes before ES6, because both change `catch`. ES7, ES8 and
ES10 are independent. ES9 waits for the measurement and the user's choice on
ES-D3. Each unit ends with `deno task check` and its own commit.
