# Project status

This file is the one place for the current project status. It holds the
application stopping rule, the application dispositions, the language and
compiler state, the remaining and deferred gaps, and the open items. Other
documents link here and do not restate these facts. History is in
[archive/](archive/README.md).

## Stopping rule

The accepted
[application acceptance rule](plans/2026-10-19-application-acceptance-rule.md)
bounds gap work. Gap features stop when three complete applications compile with
precise contracts and pass failure, cancellation, and cleanup checks. The three
applications are a service workflow, a scheduled worker, and a stream processor.
Application orchestration stays in `.eff`. Typed host adapters may supply
drivers and the runtime entry point.

All three application gates pass with existing language forms. The order
lifecycle application is a witness for types with identity and tagged records.
The portable publisher is an exploratory witness. Neither witness is a gate
application, and both pass.

The stopping rule is satisfied, so automatic API parity additions stop. Select a
new language feature only for a demonstrated application blocker or an explicit
change to the accepted target. First try existing source compositions. Gap item 9
(broader package interoperability) remains deferred by user instruction. Release
acceptance (editor behavior, packaging, performance, external integration) is
separate work. The full rule is in the linked plan.

## Application dispositions

Each application uses existing Effektive forms. No compiler, IR, builtin, or
syntax change was selected for any of them. The original deterministic drivers
record calls in memory. A separate service-workflow acceptance driver uses
loopback HTTP and file-backed SQLite; [integration evidence](integration.md)
records its narrower guarantees. The fixture README of each application gives
the build and run commands.

| Application                                                             | Gate result                                                                                                                                                                                                                                                                | Limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Service workflow](../fixtures/applications/service-workflow/README.md) | Passes with a registered atomic SQL adapter and fifteen compiled runtime cases. Source owns validation, catalog use, retry selection, and the exported contract. The adapter owns one atomic save and its connection lifecycle.                                            | Separate [HTTP/SQLite checks](integration.md) cover local persistence, rollback, cancellation and cleanup. Source-authored transaction callbacks, idempotency and exactly-once submission remain outside the witness. An ambiguous commit stays Permanent, because a retry could duplicate a committed write. The simulated COMMIT error proves no retry, not real ambiguous-commit behavior. Plan: [service workflow](archive/plans/2026-10-19-service-workflow-application.md#disposition-and-limits). |
| [Scheduled worker](../fixtures/applications/scheduled-worker/README.md) | Passes with ten compiled runtime cases. A source-authored concrete policy owns repetition, transient retry, and resource release. The runtime entry point owns whole-worker interruption.                                                                                  | General opaque Schedule consumers remain an API gap. The native reference comparison covers the selected fixed policy, timing, and results only. A future application that needs opaque policies, richer scheduling, or an in-source shutdown protocol must supply its own blocker witness. Plan: [scheduled worker](archive/plans/2026-10-19-scheduled-worker-application.md#disposition-and-limits).                                                                                                   |
| [Stream processor](../fixtures/applications/stream-processor/README.md) | Passes with ordered concurrent mapping, backpressure, selective fallback, and thirteen compiled runtime cases. Source owns the whole pipeline and the session lifetime.                                                                                                    | The application promises no rollback, no exactly-once delivery, no recovery of arbitrary mixed causes, and no global memory bound from one queue capacity. Native `catchTags` can hide an accompanying defect. Plan: [stream processor](archive/plans/2026-10-19-stream-processor-application.md#disposition-and-limits).                                                                                                                                                                                |
| [Order lifecycle](../fixtures/applications/order-lifecycle/README.md)   | A witness for types with identity and tagged records, not a gate application. Passes with nine compiled runtime cases. Four tagged record states cross a module boundary. A `match` by name covers each state. A recursive pricing rule tree uses a tagged record. Decoding keeps the module-qualified `_tag`. | The application has no service, no driver, and no concurrency. Percent pricing is not possible, because `/` gives `number`. Plan: [nominal examples](archive/plans/2026-10-23-nominal-examples.md), written before the type identity plan.                                                                                                                                                                                                                                                                                                              |
| [Portable publisher](../fixtures/applications/portable-publisher/README.md) | An exploratory portability witness, not a gate application. Source owns publication, conflict policy, grants, and serial batching. Memory and SQLite pass one shared KV suite. | The checks cover local storage in one process, finite batch completion, interruption, and cleanup. A committed write with a simulated lost acknowledgement returns uncertainty without retry. No crash recovery, exactly-once delivery, or HTTP admission protocol is promised. [Plan](archive/plans/2026-10-23-portable-applications.md); [gap assessment](archive/plans/portable-applications-gaps.md). |

## Language and compiler state

### Compiler structure

The package has three entry points: the whole API, the frontend, and the
TypeScript backend. `TypeScriptOutputs` owns lazy generated output, so source
hover does not lower or emit. The IR has version 7, and the validator rejects
other wire versions without conversion. The
[migration guide](api.md#migrating-the-frontend-and-typescript-apis) gives the
API and IR replacements. [architecture.md](architecture.md) describes the
pipeline and its layering rules. The
[completed plan](archive/plans/2026-10-24-compiler-boundaries-source-forms.md)
records the parity, performance, and editor evidence.

### Concise source forms

Bare single-parameter arrows, lazy Option `??`, flat block-local record
bindings, and explicit `using` and `finally` expressions lower to existing IR
operations. Exported contracts remain explicit and closed. All five application
witnesses pass independent validation, strict target checks, and their runtime
checks.

### Type identity

A `type` declaration has identity by name
([plan](archive/plans/2026-10-24-type-identity.md)). The `nominal` declaration
word, the `data` declaration, and `Brand<T>` are deleted. They are in the
[nominal keyword plan](archive/plans/2026-10-23-nominal-keyword.md) and the
[nominal data types plan](archive/plans/2026-10-23-nominal-data-types.md). A
body that is a union with a non-literal member, or a bare name, gives a
transparent alias that has no identity. Every other body gives identity. A record
identity is a tagged record, with a runtime `_tag`, when a union alias of its
own module lists it. `nominal` is an ordinary name, `data` is an ordinary name,
and `Brand` and `unbrand` are unknown names.

A value of a type with identity fits its body. Sealed types restrict that
conversion to their declaring module. A value of another type with identity needs
the constructor. An unnamed value fits an untagged type with identity whose body
it fits. Operators compare and combine values by class: `id === "u1"` and
`total > 0` are legal, `total * 2` gives the type of `total`, and `cents + meters`
is an error.

A function, deferred, or opaque type in a tagged record or an error field gives
`declaration/015` or `declaration/016`. The code `declaration/014` is deleted.
The code `declaration/017` rejects `sealed` on a transparent alias. A `match`
selects tagged records and errors by name. A tagged record can be recursive when
every cycle has a base case. The IR node `nominal` constructs a value of a type
with identity. The editor, the TextMate grammar, and the playground highlighter
do not know the word `nominal`. The website and the canonical specification
describe type identity from draft 0.64.

### Host interfaces

Each `.effi` file has a generated companion module, such as `host.effi.ts`
([plan](archive/plans/2026-10-23-host-interface-companion.md)). It holds the
types with identity, errors, and services of the interface. Source modules and
host modules import them from it, so the compiler owns every tag string. So
`.eff` code can construct an `.effi` type with identity, and the run time checks
a provider result that is a tagged record.

Tagged record values from unsound host code fail loudly at run time
([plan](archive/plans/2026-10-23-host-boundary-checks.md)). A `match` whose last
arm is not `_` tests that arm and throws for a value outside its type. A host
provider whose methods return tagged record values is wrapped, and each such
result or stream element goes through `Schema.is`. The language rules list the
positions that stay trusted, under "Host provider checks".

The table gives the measured cost on emitted code, with an in-memory host. The
machine was an Apple M4 Pro with Deno 2.9.8 and Effect 4.0.5. The cost in an
application with real I/O is not measured.

| Case                                   | Plain alias | Wrapped provider | Added cost                     |
| -------------------------------------- | ----------- | ---------------- | ------------------------------ |
| One `provide`, one data result         | 3.7 us      | 9.0 us           | 5.3 us                         |
| One `provide`, 100 calls               | 12.0 us     | 31.6 us          | about 0.14 us for each call    |
| One `provide`, one array of 100 values | 3.6 us      | 19.4 us          | 15.8 us                        |
| One `provide`, a stream of 1000 values | 6.6 us      | 133.4 us         | about 0.13 us for each element |
| The extra arm test of one `match`      | -           | -                | about 0.27 ns                  |

### Portable extensions

The user approved the
[portable extensions](archive/plans/2026-10-23-portable-extensions.md) after the
publishing witness established its existing composition. Sealed types restrict
construction, updates, arithmetic, widening, and schema derivation to the
declaring module. Pure function types require pure execution and empty effect
sets. Optional import rules restrict direct dependency edges. Existing open types
with identity, unmarked function types, and projects without import rules keep
their behavior.

The [extension worklog](archive/plans/portable-extensions-worklog.md) records the
compiler, validator, editor, and example checks. The sibling website includes
paired source and TypeScript panels and a runnable project for all three
controls. These changes do not expand the three-application stopping rule. Named
platforms continue to use existing services and Layers.

### Inferred input contracts and refinements

The compiler infers closed input requirements from omitted parameter types and
explicit `unknown`. Exported inferred contracts validate raw input and require
`fails SchemaError`. Local functions use static inference. Exported results and
effect contracts keep their existing requirements. Types with identity support
concrete integer and length predicates through contextual `where` clauses. IR
version 7 (as version 6 before it) transports contracts and independently checked proof certificates.

[Input contracts](inferred-input-contracts.md) describe the behavior and limits.
[Measurements](refinement-measurements.md) record bounded solver and
compiler-update checks. Generics and abstract predicates remain deferred. Host
mutation through retained aliases remains an evidence limit.

The [reset plan](archive/plans/2026-10-25-reset.md) fixed two refinement defects. A
union result no longer skips the refinement proof of a record literal (RBF20).
The checker now keeps `or` facts in the canonical form of the validator, so
commuted `or` facts at a branch join agree (RBF12).

## Remaining and deferred gaps

The tables below record the boundaries that remain after all three
[application gates](plans/2026-10-19-application-acceptance-rule.md) passed.
They are a record of gaps, not an implementation queue.

### Open API and language gaps outside the accepted target

| Area                                | Remaining boundary                                                                                                                                                                                                                                              | Existing support and evidence                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General Effect and concurrency APIs | Other first-class combinators and coordination primitives lack general source forms.                                                                                                                                                 | Effect values, collections, racing, timeout, repetition, defect recovery, outcome-aware cleanup, supervised fibers and scope-bound children cover the selected subset. See the [coverage map](archive/effect-4-gap-audit.md#coverage-map).                                                                                          |
| Full Scope parity                   | Supplied close Exits, exit-aware scope finalizers, parallel finalization strategies, mandatory closure and static dependency-cycle detection remain outside the selected contract.                                                                                     | Shared CloseableScope authority closes once with Exit.void and caches cleanup completion. See the [ownership contract](archive/plans/2026-10-18-scope-ownership-contract.md).                                                                                          |
| General Stream and Sink APIs        | Other operators, arbitrary source Sink constructors, chunk-cost throttling and unrestricted nested group streams need additional source and lifetime rules.                                                                                                     | Leftovers, transduction, aggregation and callback-owned keyed groups are implemented. Selected external interruption has a source composition. See the [investigation](archive/plans/2026-10-18-general-stream-schedule-design.md).                                    |
| General Schedule APIs               | Composition with incomparable input types, other combinators and cron policies remain uncovered.                                                                                                            | `retry` and `repeat` consume general Schedules, and `scheduleExponential` and `scheduleJittered` exist. RetrySchedule and a concrete source repetition policy meet the worker gate. General schedules support aggregation and selected comparable-input composition. See the [worker limits](archive/plans/2026-10-19-scheduled-worker-application.md#disposition-and-limits). |
| Time control                        | A general source clock and time-control API remains a candidate without a demonstrated application blocker.                                                                                                                                                     | Primitive clock services and native virtual-time checks cover the selected applications. See the [accepted rule](plans/2026-10-19-application-acceptance-rule.md#feature-selection).                                                                                   |
| Schema and recursion                | Recursive Option data in an alias, mutual recursion of aliases, arbitrary self-bearing transformations and general Schema AST construction remain unsupported. Tagged records support guarded and mutual recursion (see [type identity](#type-identity)). | Guarded recursion preserves separate decoded, encoded and make-input types through selected adapters. See the [recursive field contract](archive/plans/2026-10-19-schema-recursive-adapters-contract.md).                                                              |
| General language extensions         | User-defined generics, effect-row polymorphism, source purity assertions, macros and early returns remain deferred language extensions.                                                                                                                         | Builtin generic types and concrete source compositions cover the accepted applications. The [specification](../../effektive/public/effektive-spec.html#examples) retains the broader language boundary.                                                                |

Reopen an item only for a demonstrated application blocker or an explicit change
to the accepted target. On 2026-10-24 the user accepted one such change: a
compiler or syntax change that makes source more terse and elegant needs no
application blocker. The
[terse source plan](archive/plans/2026-10-24-terse-source.md) records the first
such changes: open contracts on local functions, named error sets, union joins of
tagged records, expected types in builtin callbacks, and inlay hints. First check
equivalent existing source compositions. Record a minimal witness, intended
contract, observed diagnostic or behavior, and the required failure,
cancellation, and cleanup semantics. No item has an automatic priority or
implementation commitment.

### Effect 4 features to surface in source

On 2026-10-27 the user accepted a second change to the target. Effektive hides
the verbosity of Effect. A source form exposes an Effect 4 feature only when the
feature carries user intent that the compiler cannot infer. The transpiler uses
the other features in the emitted TypeScript only. The user selected items 1 to
8 and 19 to 21 first. Items 1 to 4, 6 to 8 and 19 to 21 are done in the
[effect surface plan](archive/plans/2026-10-27-effect-surface.md), units ES1 to
ES11. Item 5 (Cron) stays open. The other items have no implementation
commitment. The forms of the open items are candidates, not accepted syntax.

The unit ES1b added the closed type `Duration` (type word, literals such as
`200ms`, `5s`, `2m` and `1h`). A bare `int` never fits a `Duration`. The
builtins that take a time (`timeout`, `sleep`, `scheduleSpaced`,
`scheduleExponential`, `debounceStream`, `throttleStream`) take a `Duration`.
The IR is at version 7.

| Item | User intent | Candidate form | Hidden Effect modules |
| --- | --- | --- | --- |
| 1 Timeout (done, ES2) | Time limit | `timeout(job, 5s)` with a typed timeout error | `Duration` |
| 2 Delay (done, ES2) | Wait time | `sleep(200ms)` | `Duration`, `Clock` |
| 3 Repetition (done, ES4) | Repeat or loop | `repeat(job)` and `repeat(job, options)` | `Schedule` consumers |
| 4 General policies (done, ES3) | Backoff, jitter, limits, stop conditions | `retry` accepts any `Schedule` and the options `times`, `schedule`, `while` and `until`, with `scheduleExponential` and `scheduleJittered` | `Schedule` |
| 5 Cron | Calendar policy | A cron schedule constructor | `Cron` |
| 6 Outcome-aware cleanup (done, ES5) | Action on success, failure or interruption | `finally (outcome) { ... }` | `Exit` |
| 7 Defect recovery (done, ES6) | Where unexpected failures stop | A defect arm in `catch` | `Cause` |
| 8 Interruption masks (done, ES7) | Region that must not be interrupted | `uninterruptible(job)` | Interruption masks |
| 9 Detached work | Lifetime beyond the caller | A daemon variant of `forkScoped` | `Fiber` status APIs |
| 10 Keyed background jobs | Replace by key, or a set | One keyed form | `FiberMap`, `FiberSet` |
| 11 Coordination | Producer-consumer and fan-out design | `Queue`, `PubSub`, `Deferred`, `Semaphore` types | `Latch`, `Take` |
| 12 Observable state | Watch changes | A `Ref` change Stream | `SubscriptionRef` |
| 13 Atomic updates | Transaction boundary | `atomic { ... }` over `Ref` values | `Tx*` modules |
| 14 Caching and pools | TTL, capacity, size | `cached(job, options)`, `pool(acquire, options)` | `Cache`, `ScopedCache`, `Pool`, `RcRef`, `RcMap` |
| 15 Request batching | A batched service method | A `batched` marker | `Request`, `RequestResolver` |
| 16 Logging and metrics | Messages, levels, metric names | `log(level, message, fields?)`, counters, histograms | `Logger`, `LogLevel`, `Metric` |
| 17 Configuration | Keys and secret status | A `config` declaration and `Secret<T>` | `Config`, `ConfigProvider`, `Redacted` |
| 18 Time and randomness | Current time, random values | `now()`, `random()` | `Clock`, `Random` |
| 19 Effectful collection callbacks (done, ES8) | Effects inside `map`, `filter`, `fold` | Relax the pure-callback rule | `Effect.forEach`, `Effect.filter`, `Effect.reduce` |
| 20 Effectful `updateRef` (done, ES9) | Effects inside an atomic update | Relax the pure-callback rule | `SynchronizedRef` |
| 21 `race` over an array (done, ES10) | First of many | Accept an array | `Effect.raceAll` |
| 22 `Map` and `Set` types | Keyed and unique data | `Map<K,V>`, `Set<T>` with derived equality | `HashMap`, `HashSet`, `Equal`, `Hash` |
| 23 Recursive types | Recursive Option data, mutual alias recursion | Ordinary type declarations | Schema recursion |

The transpiler may use these modules without a source form: `Chunk`,
`Channel`, `Pull`, `Take`, `Cause` internals, `Scheduler`, `Runtime`,
`ManagedRuntime`, `MutableRef`, `ScopedRef`, tracing spans, `JsonSchema`,
`Arbitrary`, `StandardSchema`, `SchemaAST`, derived `Equal`, `Hash` and `Order`
instances, and `TestClock`. Blocks, `if`, `??` and `try`/`catch` replace `tap`,
`zipWith`, `orElse`, `when`, `filterOrFail` and the `Option` and `Result`
combinators. Platform modules stay under the item 9 deferral.

### Explicit user deferral: item 9

Broader package interoperability remains deferred until the user revisits it.
This covers arbitrary external package imports, external values and
constructors, and package-specific API objects or builders authored directly in
source. Direct source composition of HTTP, SQL, RPC, AI and observability
builders belongs to this deferral. The registered typed host interface remains
available for concrete adapters. The
[adapter investigation](archive/plans/2026-10-18-schema-ecosystem-design.md)
records the supported route and its limits.

A new application blocker does not revoke the explicit deferral of item 9. The
user must change that instruction before broader interoperability work starts.

### Deferred TypeScript content mapper integration

Deferred by the user on 2026-10-24. The
[integration plan](plans/2026-10-24-typescript-content-mappers.md) preserves the
TypeScript 7.1 content mapper analysis, a bounded experiment, acceptance checks,
and unresolved mapping, import-identity and unsaved-project-state risks. The
scope is integration with the existing compiler and language server. No
experiment or adoption is authorized. Resume only when the user explicitly
reopens the work. Broader package interoperability remains deferred separately.

### Runtime behavior and evidence limits

These are limits of the selected witnesses, not automatically selected features.
The three application gates and the order lifecycle witness establish neither
complete Effect API parity nor external integration coverage.

| Boundary                        | Recorded behavior or evidence limit                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed recovery and mixed causes | Native catchTags can select a typed reason and discard an accompanying defect. The stream witness records this limit. A `Defect` arm in `catch` (ES6) now recovers a defect in source, but the limit still applies to typed handlers. Its session finalizers run outside item recovery.                         |
| Transaction cancellation        | Body interruption awaits rollback and release. Interruption after COMMIT starts can preserve a committed row. The simulated COMMIT error proves no retry, not actual ambiguous-commit behavior. |
| Stream failure and buffering    | Native transduction can emit a partial batch before upstream failure. The pinned backpressure trace establishes no global memory bound.                                                         |
| Delivery guarantees             | The applications promise neither exactly-once delivery nor rollback of earlier successful batches.                                                                                              |
| External services               | Seven [loopback HTTP and file-backed SQLite checks](integration.md) cover the service workflow. Remote services, RPC, AI and telemetry acceptance remain outside that coverage.                 |

The
[service workflow](archive/plans/2026-10-19-service-workflow-application.md#disposition-and-limits)
and
[stream processor](archive/plans/2026-10-19-stream-processor-application.md#disposition-and-limits)
record these boundaries with compiled checks.

### Release acceptance

Editor behavior, packaging, performance and external integration acceptance are
tracked separately from the application gates. The selected automated release
checks pass. The manual editor and playground acceptance by the user remains
pending (see the open items). The
[editor and release plan](archive/plans/2026-10-21-editor-release.md) selects the
editor capabilities, local installation, HTTP/SQLite integration, and automated
release checks. It selects no new language forms. The
[save-round measurements](release-measurements.md#save-rounds) record the M7 and
M4 results of the
[save-transpilation plan](archive/plans/2026-10-21-save-transpilation.md).

## Open items

The list gives the items that still need a person.

| Item | State | Owner |
| --- | --- | --- |
| Hand test of the VS Code client | The installed VSIX passed automated references, rename, completion, semantic tokens, contract quick fixes, generated output, save, error recovery and restart on 2026-10-21; [installation evidence](installation.md). User acceptance check 5 of the [language server plan](archive/plans/2026-10-16-lsp.md) remains pending.                                                                                           | User  |
| Playground acceptance           | The user has not accepted the page (acceptance check 5 of the [playground plan](archive/plans/2026-10-16-playground.md)). An [automated browser review on 2026-10-21](archive/playground-review-2026-10-21.md) passed at 375, 720 and 1280 pixels, including keyboard navigation, type/syntax error recovery and screenshot inspection. It does not replace the user’s manual acceptance.                                        | User  |
| Rederive review | VAL-8 of the [rederive review](archive/plans/2026-10-20-rederive-review.md) is complete. ARC-5 is declined after its name-only mapping prerequisite failed; the [assessment](archive/plans/rederive-review-evidence/arc-5-builtin-facts.md) records six names with context-dependent lowering kinds. R12 FE-2, CHK-11, CHK-12, R13, R15a, R15b, C10 and A6 are complete. The reset plan closed C7, F3, and F9b as declined. No item has an owner. | User |
| Measured numbers                | Earlier evidence remains in `rejected.md` (the lexer split) and the audit fix plan (AU1). The [full release measurements](release-measurements.md) meet the unchanged 100 ms large-input p90 diagnostics budget and include three open documents with 10,000 distinct edits. Raw RSS, heap and type-table samples record growth; they establish no memory bound.                                                         | User  |
