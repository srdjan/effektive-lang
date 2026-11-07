# Changelog

## Unreleased

- Diagnostics and hover contracts name a reserved error type or capability by its short name, such as `SchemaIssue` or `Scope`.
  Before, a type mismatch could print an internal id such as `error:effect/SchemaIssue`.

## 0.15.2 - 2026-11-05

- Failed workspace inspections retain the last complete inputs and generated outputs.
  Directory links propagate inspection failures instead of silently omitting source files.
- Composite forwarding preserves input requirements through aliases, destructuring, records, tuples, and lists.
  Locally produced computations still require the appropriate service header.
- Coverage checks require an owner for every production module and reject incomplete or invalid reports.
- Language server discovery uses native path operations.
  The process launcher handles encoded spaces in checkout paths.
  Native Windows validation is outside this reset's acceptance scope and remains unverified.

## 0.15.1 - 2026-11-05

- Effect 4.1.2 preserves defects in mixed failure causes. Typed recovery skips
  such causes and converts their typed errors to defects.
- Replaying one raw Schema constructor Effect now returns a fresh result.
  Earlier replay results remain unchanged.
- Generated projects and target checks pin Effect and its Node platform packages
  to 4.1.2. The target lock pins their transitive dependencies.
- Applications that use the Node platform packages require Node.js 22.19.0 or
  later when they run on Node.js.

## 0.15.0 - 2026-11-04

- A source module can declare an external service with
  `imports Users from "./users-service.eff"`. Each header uses an explicit
  source path and must precede ordinary imports and declarations.
- Service headers bind services without providing implementations. They also
  bound the external service requirements that the module can infer.
- A module with service headers infers each function's actual omitted `with` set,
  including exported functions. A written `with` clause remains a checked
  upper bound.
- Module bounds include requirements from calls and produced values. They
  exclude input-only requirements and reserved Effect capabilities.
- `provide` removes the supplied service before the module bound check.
  Provider acquisition requirements remain.

## 0.14.1 - 2026-11-04

- The editor offers an action that writes the inferred failure set of a
  function as a `fails` clause, such as `fails StoreUnavailable | UserMissing`,
  or `fails never` for an empty set. The cursor must be in the header of a
  function with a written result type, no `fails` clause, and no diagnostic.
  The language server sends the action with the kind `refactor.rewrite`, and it
  honors `context.only`.
- The contract quick fix and `check --fix` replace a written `fails never` or
  `with never` with the missing entries, instead of appending them.
- Diagnostics, note lines, inlay hints, and signature help name a reserved
  Effect error by its source name, such as `SchemaError`, instead of
  `error:effect/SchemaError`.
- A function with an unknown name in its body gets no inlay hint and no
  contract quick fix, because its inferred sets are unreliable.
- `failure-contract/001` and `requirement-contract/001` carry a related
  location at each node of the body that introduces a missing entry: a
  `fail(...)`, a service method call, a call of a function, or a builtin call.
  Through a call, the location is the call. The `SchemaError` form names each
  checked parameter. The language server shows the locations as related
  information.
- The command-line tool prints each related location of a diagnostic as a note
  line, `path:line:column: note: message`, directly after the diagnostic line.
  This also shows the related locations that the tool dropped before, such as
  the first declaration of a duplicate name and the members of a cycle.

## 0.14.0 - 2026-11-03

- The contract keyword `uses` is now `with`, as in `User with Users`. `with` is
  a keyword, so a name cannot be `with` (`syntax/008`). The keyword applies to
  arrow headers, function types, and `.effi` providers. The meaning, the IR, and
  the emitted TypeScript do not change.
- An exported function with a body infers an omitted `fails` clause from its
  body, as a local function does. A written `fails` clause stays a checked upper
  bound. An exported function still closes its `with` clause, so an omitted
  `with` clause means no services.
- An exported function with a checked input and no `fails` clause infers
  `SchemaError`. A written `fails` clause must list `SchemaError`.
- A new failure in an export with an inferred failure set reaches host
  TypeScript with no diagnostic. Write a `fails` clause to guard against it.
- The interface of a module carries the inferred failure set of each export.
- The inlay hint shows the inferred failures of an export, before a written
  `with` clause.
- `check --fix` and the quick fix add failures only to a written `fails` clause.
  They add a missing service to the `with` clause of an export.
- The examples, the applications, and the tutorial drop the `fails` clause of
  their exported functions.

## 0.13.5 - 2026-11-03

## 0.13.0 - 2026-11-03

- The slow test runner installs esbuild once before the parallel tests start.
  This prevents concurrent bundle commands from racing during installation.
- The mutation tool extracts worker copies concurrently, reads the last test
  summary, and rejects an empty path in `--only`.
- Command-line tests cover the mutation tool and its survivor register.

## 0.12.3 - 2026-11-02

- The command `effektive check [root] --fix` adds the missing `fails` and
  `uses` entries to the exported functions. It works in rounds over all `.eff`
  files, writes each changed file once, and then prints the remaining
  diagnostics. The summary ends with `fixed K functions in M files`. The flag
  is not valid for `build` and `watch`, and `logs:replay` does not support a
  `--fix` session.
- The quick fix "Add missing fails/uses entries" now adds a service name to
  the `uses` clause when the function needs every method of the service. It
  adds method names when the function needs only some methods.

## 0.12.2 - 2026-11-02

- The IR wire version is 8, and the validator rejects version 7. This
  release removes IR kinds, so it raises the version once. A later removal in
  the same release keeps version 8.
- The `Map` and `Set` types and their eleven operations are gone: `mapOf`,
  `getMap`, `putMap`, `removeMap`, `hasMap`, `entriesMap`, `setOf`, `addSet`,
  `removeSet`, `hasSet`, and `itemsSet`. No application used them. `Map` and
  `Set` are ordinary names again, and `declaration/019` is gone. The IR loses
  the type kinds `map` and `set` and eleven expression kinds.
- The general `Schedule` forms are gone: `scheduleFromStep`,
  `scheduleRecurs`, `scheduleSpaced`, `scheduleExponential`, `scheduleCron`,
  `scheduleJittered`, `scheduleMap`, `scheduleMax`, `scheduleMin`,
  `scheduleConcat`, `aggregateWithinStream`, and the types `Schedule`,
  `ScheduleInput`, `ScheduleMetadata`, and `ScheduleDecision`. No application
  used them. `repeat` has no `schedule` option. The `schedule` option of
  `retry` takes only a `RetrySchedule`, and another value gives
  `type-mismatch/010`. The IR loses the type kind `schedule` and eleven
  expression kinds.
- The scope handles are gone: `makeScope`, `provideScope`,
  `addScopeFinalizer`, `closeScope`, and the type `CloseableScope`. No
  application used them. `scoped`, `forkScoped`, and `withResource` stay. The
  IR loses the type kind `closeable-scope` and four expression kinds.
- `partitionAll`, `validateAll`, and `allResults` are gone. No application
  used them. `all`, `traverse`, `map`, `filter`, and `fold` stay. The IR
  loses three expression kinds.
- `codec`, `decode`, `encode`, the type `Codec`, and the issue constructors
  `schemaInvalid`, `schemaAt`, and `schemaBoth` are gone. No application used
  them. The Schema builders stay, and `SchemaIssue` stays as a reserved
  error: `schemaMake` and host services still fail with it. A source
  factory can no longer add a parent path to an issue. The IR loses the type
  kind `codec` and three expression kinds.
- `withFiber`, `joinFiber`, `interruptFiber`, and the type `Fiber` are gone.
  No application used them. `scoped`, `forkScoped`, `race`, and `all` stay;
  `forkScoped` never returned a handle. The IR loses the type kind `fiber`
  and three expression kinds.
- 25 stream operators are gone: `mapGroups`, `scanStream`,
  `mapAccumStream`, `foldStream`, `foldEffectStream`, `collectStream`,
  `headStream`, `lastStream`, `drainStream`, `aggregateStream`,
  `mergeStreams`, `zipStreams`, `concatStreams`, `flatMapStreams`,
  `switchMapStreams`, `catchStream`, `retryStream`, `debounceStream`,
  `throttleStream`, `takeStream`, `dropStream`, `filterEffectStream`,
  `takeWhileEffectStream`, `takeUntilEffectStream`, and
  `dropWhileEffectStream`. No application used them. `unfold`, `mapEffect`,
  `sinkForEach`, `takeSink`, `transduceStream`, `runStream`, and
  `bufferStream` stay. The IR loses 29 expression kinds.
- `build --validate` and `Revision.validate` are gone, and `frontend.ts` no
  longer exports `validateProject`. The independent IR validator is a test
  oracle: tests import it from `src/core/validate_project.ts`. The command-line
  tool, the language server, and the playground no longer load it, and the
  playground bundle is 148 KB smaller (13.8%).
- `validateProject` reports `validation/009` when an import payload differs
  from the export of its producer module in the same call, so a consumer IR
  from a stale build no longer passes.
- A source declaration or binding named `Math`, `Error`, `String`,
  `globalThis`, `TypeError`, or `BigInt` now gives `declaration/002`. Before, such a program passed
  `check` and then failed the strict target check, because the emitted
  TypeScript uses these names as globals.
- The emitted fallback of a `match` takes `never`. So the strict target check
  reports TS2345 for a match that lacks a variant, also when the checker
  misses it. Emitted text changes in this one signature.
- A relayed TypeScript message no longer ends with the advice "Consider
  adding 'undefined' to the types of the target's properties". The
  generated code is not the user's to edit.
- A record literal used directly as a body after `=>` gives one diagnostic,
  `syntax/016`, that asks for `({ ... })`. Before, it gave `unknown-name/001`
  and `syntax/008`.
- `deno task mutate` keeps each `--only` site. Before, a second `--only`
  replaced the first without a message, so the run tested fewer sites.
- `deno task site:ir` writes the website `typed-ir.ts` from `src/core/ir.ts`
  and the predicate types that it needs. A slow test compares the two files
  byte for byte.
- `deno task behavior:compare <base> <head>` replaces
  `deno task behavior:capture`. It runs one named corpus through the public
  entry points of both revisions: the fixture projects, the forged IR files,
  and four edit sequences. It names each changed or missing record and writes
  both result texts. The capture patched private call sites and recorded only
  hashes, so a moved test changed its records.

## 0.12.1 - 2026-11-01

This reset repairs three defects. It changes no source form, no wire format,
and no IR version.

- A direct call of a parameter no longer reports `type-mismatch/011` when a
  local annotation gives that parameter a function type.
- An annotated local arrow keeps its callable evidence through bindings,
  aliases, and local record fields, so it no longer reports
  `type-mismatch/003`.
- A change of host order in `effektive.json` now updates the companion
  imports after an incremental compilation, as a fresh compilation does.
- Input contract inference resolves deferred callback contracts before it
  reports input diagnostics. Contract resolution is separate from syntax
  traversal.

## 0.12.0 - 2026-11-01

This reset changes no source form, no wire format, and no emitted text.

- `frontend.ts` and `typescript.ts` no longer export 20 names that no code
  imported. Six span helpers left the core, and nine unread fields left
  exported records.
- The declaration index holds no declaration hashes, and no header or body
  spans.
- An emission failure has the tag `internal`. The tag `unsupported` is gone.
- `deno task coverage` enforces floors over both test suites, and
  `deno task release` runs it.
- `deno task mutate` measures fault detection, and
  `fixtures/mutation/survivors.json` records each accepted survivor.
- `docs/testing.md` describes each test layer and each oracle.
- `deno task release` moves the "Unreleased" entries, sets the version, and
  runs the release checks.
- Raw measurement JSON files and review PNG files left the tree. Commit
  `5dfef94` holds them.
- `build --validate` accepts a `null` comparison of a foreign sealed type that
  holds `null`, as `check` does.
- `check` rejects a Schema with a foreign sealed make input where the Schema
  does not match, as `build --validate` does.
- `build --validate` accepts `schema()` for a named Schema type and for a make
  input that is equivalent to the decoded type, as `check` does.
- `build --validate` accepts `schemaRecursive` under a named Schema type, as
  `check` does.
- The validator rejects a literal pattern on an alias chain past its depth bound.
  It accepted any literal there before. Only a forged IR reaches that bound.

## 0.11.1 - 2026-10-30

- Retained program revisions keep their original type definitions for delayed
  lowering and editor queries.
- The playground build rejects repository output directories whose names start
  with two dots.

## 0.11.0 - 2026-10-30

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
