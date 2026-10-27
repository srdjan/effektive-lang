---
title: A compile-time check of an Effect parser mirrors the parser and proves agreement with a differential test
date: 2026-10-27
category: architecture-patterns
module: src/core/cron.ts, src/core/check_builtins/schedule.ts, src/core/validate/families/schedule.ts, src/core/emit/families/schedule.ts
problem_type: architecture_pattern
component: type_checker
related_components: [validator, emitter, testing_framework]
severity: medium
applies_when:
  - "A builtin takes a literal that an Effect API parses at run time, such as a cron expression or a time zone"
  - "You want an invalid literal to be a compile-time diagnostic instead of a typed failure or a defect"
  - "The Effect constructor keeps a parse error in its error channel even after the value is valid"
  - "The independent IR validator must check the same literal again"
retire_when: "The pinned effect version changes. Re-run tests/schedule_cron_slow_test.ts against the new version, and compare Cron.parse and DateTime.zoneFromString with src/core/cron.ts."
tags: [cron, schedule-cron, effect-target, compile-time-check, differential-test, validator-independence, time-zone, error-channel]
---

# A compile-time check of an Effect parser mirrors the parser and proves agreement with a differential test

## Context

Paths that start with `dist/` are inside the pinned `effect@4.0.5` package, not in this repository.

The unit EL3 of the
[effect surface leftovers plan](../../archive/plans/2026-10-27-effect-surface-leftovers.md)
added `scheduleCron(expression, zone?)`. The user chose string literals and a
compile-time check, so the schedule has no failures. Effect checks a cron
expression only at run time, with `Cron.parse`. The compiler does not import
Effect, so it cannot call that parser.

The first plan said that a zone is valid when `Intl.DateTimeFormat` accepts it.
A plan validation found that this was wrong. `Cron.parse` sends a string zone
to `DateTime.zoneFromString`. That function first tests the prefix
`/^(?:GMT|[+-])/` (`effect@4.0.5`, `dist/internal/dateTime.js:321`). A zone with
that prefix is valid only when it ends with `+hh:mm` or `-hh:mm`
(`dist/internal/dateTime.js:541`). `Intl` accepts `"GMT"` and `"-0530"`, but Effect rejects
them. With the `Intl` check alone, `scheduleCron("* * * * *", "GMT")` compiled
and then failed when the schedule first ran.

The emission also had a trap. `Schedule.cron` keeps `CronParseError` in its
error channel even for a parsed `Cron` value (`dist/Schedule.d.ts:593`).
`Schedule` has no combinator that removes an error. So the emitted schedule
type would show a failure that the compiler already excluded.

## Guidance

- Put the mirror in one module that imports nothing: `src/core/cron.ts`. Its
  functions `cronExpressionProblem` (`src/core/cron.ts:81`) and `cronZoneProblem`
  (`src/core/cron.ts:101`) return a reason or `undefined`. Copy the Effect rules in
  their order, from `dist/Cron.js` (`parse`, `parseSegment`, `splitStep`,
  `splitRange`, `aliasOrValue`) and from `zoneFromString`. The order matters.
  For example, the step check runs before the value check, and the weekday
  range check runs before 7 becomes 0, so `mon-sun` fails and `sun-7` passes.
- Call the mirror from both the checker (`scheduleCronCall`,
  `src/core/check_builtins/schedule.ts:74`) and the validator (`scheduleCron`,
  `src/core/validate/families/schedule.ts:127`). The validator independence test allows
  only listed modules outside `src/core/validate/`. Add the mirror to that list
  (`tests/validate_test.ts:1629`). A dependency-free mirror of a target parser is
  not checker policy, so this keeps the rule that the validator imports no
  checker code.
- Prove the mirror with a differential test against the pinned target. The
  root `deno.json` has no `effect` import, so the test runs `Cron.parse` in a
  subprocess with the target import map
  (`tests/schedule_cron_slow_test.ts:19`). It compares validity only, not
  Effect's messages. Keep the inputs in one list (`tests/cron_cases.ts`), and
  add each rule and each edge case: separators inside an item (`1/2/3`,
  `1-2-3`), `*` inside a range, alias lookups of object keys (`constructor`,
  `__proto__`), and each zone form.
- Emit the schedule without the parse error channel. Build the step with
  `Schedule.fromStepWithMetadata` and `Cron.next`, as the body of
  `Schedule.cron` does (`dist/Schedule.js:404-416`). Call
  `Cron.parseUnsafe` inside `Effect.suspend`
  (`src/core/emit/families/schedule.ts:54`). The compiler check makes a parse failure
  impossible except for an ICU difference between hosts, which then becomes a
  defect at the first step.

## Why This Matters

A mirror that differs from the target in one rule moves a failure from compile
time to run time, and nothing reports the difference. Both the checker and the
validator call the same mirror, so the validator does not catch a mirror
defect. Only the differential test checks the mirror against the target. The
`Intl` shortcut looked correct and passed every compiler test, but it accepted
zones that the target rejects.

The error channel matters because Effektive closes failure sets. A
`CronParseError` in the emitted type would join every `retry` or `repeat` that
uses the schedule, and the strict target check would disagree with the source
contract.

## When to Apply

- A new builtin takes a literal that an Effect API parses, for example a time
  zone for a clock builtin, a date format, or a duration string.
- A target constructor declares a failure that a compile-time check excludes.
- A target version upgrade. Re-run the differential test before you trust the
  mirror.

## Examples

The zone rule, before and after the validation finding:

```ts
// Before: accepts "GMT" and "-0530", which Cron.parse rejects.
new Intl.DateTimeFormat("en-US", { timeZone: zone });

// After: the order of DateTime.zoneFromString.
if (/^(?:GMT|[+-])/.test(zone)) {
  return /([+-])(\d{2}):(\d{2})$/.test(zone) ? undefined : "an offset zone must end with +hh:mm or -hh:mm";
}
new Intl.DateTimeFormat("en-US", { timeZone: zone }); // other names
```

The emitted step for `scheduleCron("0 4 * * *")`, with no error channel:

```ts
Schedule.fromStepWithMetadata(Effect.suspend(() => {
  const cron = Cron.parseUnsafe("0 4 * * *", "UTC");
  return Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
    if (meta.now === Number.POSITIVE_INFINITY) return Cause.done(0);
    const delay = Cron.next(cron, meta.now).getTime() - meta.now;
    return Effect.succeed([delay, Duration.millis(delay)] as [number, Duration.Duration]);
  });
}))
```

## Related

- [checker-result-type-from-expected-hint.md](../logic-errors/checker-result-type-from-expected-hint.md): the validator is an independent second check of the same schedule module.
- [pipeline-stage-effects-must-come-from-the-checker.md](../logic-errors/pipeline-stage-effects-must-come-from-the-checker.md): one owner for each derived fact.
- [builtin-identity-needs-a-closed-fit-to-check-units.md](builtin-identity-needs-a-closed-fit-to-check-units.md): the `Duration` type that `scheduleCron` outputs.
