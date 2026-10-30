# Changelog

## Unreleased

- `build --tsc` resolves the pinned dependency closure of the target, not the
  newest versions in range. A host import whose range overlaps the closure
  also takes the pinned version.
- A file with very many diagnostics returns all of them and no longer crashes.
- The proof budget belongs to one module, not to one run. A module no longer
  spends the budget of an earlier module.
- `build --validate` accepts a `withFiber` callback whose parameter names the
  child type, such as `(fiber: Fiber<Int, never>) => 1` over a literal child.
  `check` and `build --tsc` already accepted it.

## 0.10.4 - 2026-10-29

Source can use more Effect features, and the playground and the logs are new.

Time and retry:

- Duration literals such as `5s` and `100ms` make a value of the new closed
  type `Duration`. `Duration` supports addition, subtraction, scaling, and
  comparison.
- `timeout(job, 5s)` limits a job and fails with the reserved error
  `TimeoutError`. `sleep(1s)` waits.
- `repeat(job)` runs a job again after each success. `repeat(job, options)`
  takes `times`, `schedule`, `while`, and `until`.
- `retry` takes the options `times`, `schedule`, `while`, and `until`, and a
  general `Schedule`.
- `scheduleExponential`, `scheduleJittered`, and `scheduleCron` build
  schedules. `scheduleCron` checks its cron expression and time zone at
  compile time.
- `now()` returns the current time as the closed type `Instant`. `Instant`
  minus `Instant` gives a `Duration`.

Failure and cleanup:

- `finally (outcome) { ... }` binds the outcome of the protected part:
  `Success`, `Failure`, `Defect`, or `Interrupted`. A `using` release can bind
  it too.
- A `catch` block can hold one `Defect(name) => expression` arm. It handles a
  defect with a `message`.
- `uninterruptible(job)` runs a job to its end, even when a `timeout` or a
  `race` interrupts it.

Callbacks and values:

- `map`, `filter`, and `fold` accept effectful callbacks. `updateRef` accepts
  an effectful callback and keeps each update atomic.
- `race` takes an array of Effect values.
- `random()` and `randomInt(min, max)` return random values from the Effect
  runtime. `log(message, options)` writes a log line with a level and fields.
- `Map<K, V>` and `Set<T>` are builtin types. `mapOf`, `getMap`, `putMap`,
  `removeMap`, `hasMap`, `entriesMap`, `setOf`, `addSet`, `removeSet`,
  `hasSet`, and `itemsSet` build and read them.

Tools:

- The playground looks and works like an IDE: a file explorer, editor tabs, a
  Problems panel, and a status bar with the cursor position and the contract.
- The playground status bar shows how many fewer code characters the source
  has than its generated Effect-TS.
- The command-line tool, the language server, and the playground write a
  local session log. `deno task logs:report` summarizes the logs, and
  `deno task logs:replay` runs a session again as a regression check. See
  [docs/logging.md](docs/logging.md).

Breaking changes:

- The IR moves to version 7. It adds the expression kinds `timeout`, `sleep`,
  `repeat`, `uninterruptible`, `ensure`, `race-all`, `schedule-exponential`,
  and `schedule-jittered`. The `catch` node has an optional `defect` handler.
  A `with-resource` release closure has one or two parameters. See
  [docs/archive/api-migrations.md](docs/archive/api-migrations.md#ir-version-7).
- `Duration` and `Instant` are closed. A bare `int` does not fit them. A
  module cannot declare a type named `Duration`, `Instant`, `Map`, or `Set`.
- Millisecond arguments became `Duration` values: `scheduleSpaced`,
  `debounceStream`, and the `throttleStream` option `duration` (before
  `durationMs`). `retrySchedule` callbacks return `Option<Duration>`.
  `scheduleFromStep` decisions use `delay`, and `ScheduleMetadata` uses
  `duration`, both of type `Duration`.

Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.10.3 - 2026-10-26

Refinement proofs are stricter and do not depend on names or operand order.

- A record literal that takes a refined member of an expected union must prove
  the predicate of that member. Before, the checker accepted it with no proof.
- When a record literal fits several union members, it takes a member with no
  predicate.
- An `||` fact survives a branch join when the branches write its operands in
  a different order or grouping.
- The `type-mismatch/010` message for `mapGroups` keys now names one primitive
  type with identity.

The checker, the language server, and the tests have a simpler internal
layout. [docs/architecture.md](docs/architecture.md) describes it.

Breaking changes:

- A record literal at a refined union member with no proof now fails with
  `type-mismatch/013`. Prove the predicate, for example with an `if` that tests
  it.

Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.10.2 - 2026-10-25

Functions can omit input types, and refinement types check their predicates.

- `type Positive = int where n => n > 0` declares a refinement type.
  Construction, arithmetic, and record updates must prove the predicate. The
  independent validator checks each proof certificate again.
- An omitted parameter type or `unknown` takes its contract from the function
  body. An exported function validates raw input when its Effect executes. It
  must declare `fails SchemaError`.
- Proof facts use only integer values. A `number` value cannot establish an
  integer fact.
- A record predicate with unknown inputs is checked at the exported entry.
- A written local annotation stays authoritative during input inference.

Breaking changes:

- The IR moves to version 6.
- A host interface cannot declare a refinement or expose a refined type.

[docs/inferred-input-contracts.md](docs/inferred-input-contracts.md) describes
the rules and their limits. Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.10.1 - 2026-10-25

- The generated-code view of the editor and the playground shows the
  companion module `h.effi.ts` for a host interface file `h.effi`.
- The build no longer overwrites a `.ts` file that it did not generate. It
  reports an error and leaves the file and its map unwritten. Files from
  versions before the rename to Effektive carry another header and are now
  refused. Delete them once.
- `deno.json` is the only source of the release version. `deno task package`
  writes it into the packaged extension manifest. The VSIX file is now
  `dist/effektive-vscode.vsix`, with no version in its name.
- The build prints the message of an emit error, and names the missing source
  of a source-map error.

Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.10.0 - 2026-10-25

- A union keeps the names of its members in assignability. So
  `(v: Cents | Meters): Score => v` is now an error in the checker and the
  validator.

Breaking changes:

- Source that gives a union of types with identity where another type with
  identity is expected now fails to check.

Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.9.0 - 2026-10-25

A plain `type` declaration now has identity by name. The `nominal` keyword is gone.

- `type UserId = string`, `type Cents = int`, and `type Status = "pending" | "paid"`
  have identity. Two different types with identity never mix, also when their
  bodies are equal. A literal or an operator result fits the type with no call.
- A union with a non-literal member, such as `type Article = Draft | Published`,
  and a bare name, such as `type Alias = User`, stay transparent aliases.
- A record type that a union of its own module lists is a tagged record. A
  record literal at exactly that type constructs it with no call.
- The emitted TypeScript of an untagged type is the schema and the type of its body.

Breaking changes:

- `nominal` is an ordinary name. Replace `nominal Name = T` with `type Name = T`.
- The IR moves to version 5. It adds the flag `tagged` on a `nominal` definition.
- `declaration/014` is deleted. `declaration/017` reports `sealed` on a transparent alias.

The [language rules](docs/language-rules.md) and the language specification
describe type identity. Requires Deno 2.9.8 and targets Effect 4.0.5.

## 0.8.0 - 2026-10-24

Write less source while keeping explicit exported contracts:

- Omit parentheses around a single unannotated callback parameter: `user => user.name`.
- Unwrap an Option with `option ?? fallback`; the fallback runs only for `None`.
- Bind record fields inside a block: `const { id, revision: expectedRevision } = article`.
- Manage resources with `using (job = openJob()) { job.execute() } finally { job.close() }`.

The editor supports navigation, rename, completion, hover, and highlighting for
these forms. Examples and the language specification use the new syntax.

Includes the standalone CLI, language server, VS Code extension, and browser
playground. Requires Deno 2.9.8 and targets Effect 4.0.5.
