# Feature review of 2026-11-04

This record holds the feature review of 2026-11-04 at commit `928d1b0`: the core
features and philosophy, the ranked candidates (AD0 to AD18), the fresh-eyes
critique (K1 to K10), and the decisions of the user. The orchestrator wrote the
list. Fable and Astra analysed it, and a fresh subagent critiqued the top three.
The selected first item is planned in
[the contract provenance plan](plans/2026-11-04-contract-provenance.md).

Repository: `effektive-lang` at `928d1b0` (v0.14.0).
Sources: the orchestrator's study, Fable (subagent, model `fable`), and Astra
(`codex exec -m gpt-6-astra`). Each code claim below was checked by the orchestrator unless
it says "probable".

Cost scale: S changes one or two files and no IR. M crosses several modules,
or the checker, lowering, validator, emitter, or specification. L adds a
runtime, a language form, or a new subsystem. "Machine time" means a long
unattended run.

## Core features and philosophy (verified)

Features:

- F1 Direct-call functional language that compiles to Effect 4 TypeScript.
  `README.md:3-7`, `docs/architecture.md:10-30`.
- F2 Function contracts: an export writes its result type and services
  (`with`); the compiler infers the failure set; a written `fails` clause is a
  checked upper bound. A recursive local needs parameter and result
  annotations. `docs/language-rules.md:59,67`, `CONCEPTS.md:169-189`.
- F3 Type identity by name. An untagged identity is erased in TypeScript: it
  prints as a plain alias with no brand. `docs/language-rules.md:34,588`.
- F4 Typed host boundary: `.effi` interfaces, generated companion modules, and
  run-time checks of tagged values in host provider results. Typed errors,
  Effect values, functions, and callback arguments stay trusted.
  `docs/status.md:58,63-73`, `docs/language-rules.md:595`.
- F5 Inferred input contracts and concrete refinements, with a bounded proof
  search and proof certificates. `docs/status.md:60`,
  `src/core/check_refinements.ts:193`.
- F6 Effect behind small source forms: `try`/`catch`/`finally` with an outcome
  binding, `Defect` arm, `retry`, `race`, `timeout`, `repeat`, `sleep`, `using`,
  `withResource`, `scoped`/`forkScoped`, Duration literals, `now`, `log`,
  `random`, streams and sinks, Schema. `docs/language-rules.md:18-23,55-98,116-121,184-196`.
- F7 Query-shaped incremental `Program` with an interface-hash cutoff and
  per-revision type tables. `docs/architecture.md:30,55-73`. The last full
  latency run is at `90f0fbe` (2026-10-31), before the inferred-failure change
  (`docs/release-measurements.md:146`). The typed-arrow workload at 2,000
  arrows exceeds the 100 ms budget (`docs/refinement-measurements.md:51-52`).
- F8 Tooling: CLI `check`/`build`/`watch`/`--fix`/`--tsc`; a language server
  with diagnostics, hover, definition, symbols, references, rename,
  completion, semantic tokens, signature help, contract quick fixes, and inlay
  hints; a VS Code client; a browser playground. `docs/api.md:593-971`,
  `docs/editor.md`.
- F9 Verification as a product value: an independent IR validator as a
  differential test oracle, byte-identical golden emission, a mutation
  register, coverage floors, surface, lexer and IR snapshots, a behavior
  comparison, and log replay. `docs/architecture.md:27,90-123`,
  `docs/testing.md:24-50`.
- F10 Local session logs, a report, and a replay. `docs/logging.md`.

Philosophy:

- P1 "Direct calls. Effect types." Expose an Effect feature only for intent
  that the compiler cannot infer. `AGENTS.md` Feature Selection,
  `docs/status.md:107-112`.
- P2 Evidence-gated scope: a new language feature needs an application
  blocker, or it must fall under an accepted exception (terse source,
  2026-10-24; Effect hiding, 2026-10-27). Unused features were removed on
  2026-11-02. `docs/status.md:9-29,92-136`.
- P3 Written results and services at module boundaries; inferred failures,
  with an optional written bound. EI plan decisions EID1-EID4.
- P4 Measure, do not guess. `docs/rejected.md`.
- P5 A core with no host I/O and downward layering, enforced by seven tests.
  `docs/architecture.md:75-89`.
- P6 Honest limits on each application and each oracle.
  `docs/status.md:40-46,197-215`, `docs/testing.md:24-50`.
- P7 An update task never runs to make a test pass; a reviewer reads each
  fixture diff. `docs/architecture.md:107-111`.
- P8 One place for status; the website specification stays current with each
  source change. `docs/status.md:3-7`, `AGENTS.md`.

## Ranking

Criteria: innovative, accretive (it compounds an existing strength), useful,
compelling.

| Rank | ID | Why |
| --- | --- | --- |
| Prerequisite | AD0, AD1 | Both gates are red; two documents state wrong facts. |
| 1 | AD2 Contract provenance | Fable and Astra both rank it first. It turns an inferred contract into an explanation. It compounds F2, the per-node check tables, hover, and inlay hints. |
| 2 | AD3 Contract change report | Fable and Astra both rank it second. It answers the one cost that the 2026-11-03 change left open (a silent new failure, XC3) without the snapshot file that EID4 rejected. |
| 3 | AD5 Project and host scaffolding | Astra ranks it third. It shortens the path from checked source to a running program. It needs no language change, so the stopping rule does not apply. Fable ranks AD6 third instead. |

## All candidates

### AD0 Repair the two red release gates (correctness)

- User problem: `deno task check` fails on `main`, so every commit is blocked.
  `tests/docs_test.ts:135` fails, because `928d1b0` (v0.14.0) changed only
  `deno.json`. The website test `../effektive/stamp_assets_test.ts:15` fails,
  because `5e87e85` changed only `deno.json` and the pages load `?v=0.13.5`.
- Changed files: `CHANGELOG.md`; website `public/index.html` and
  `public/effektive-spec.html` through `deno task stamp`.
- Cost: S.
- Main risk: a wrong release date in the heading.
- Success check: both named tests pass, then `deno task check` exits 0.

### AD1 Correct two documentation errors (correctness)

- User problem: `docs/tutorial.md:270` says that TypeScript rejects a plain
  `string` as a `BookId`. The emitted type is `Schema.String`
  (`fixtures/tutorial/library.ts:22`), so TypeScript accepts it. EIF10 in
  `docs/archive/plans/2026-11-03-inferred-export-failures.md` says that EIU2
  did not touch `check_expr.ts`, but `f9b358f` changed 5 lines in it.
- Changed files: `docs/tutorial.md`, the archived EI plan, and the website
  tutorial copy if one exists (probable; check `../effektive/public`).
- Cost: S.
- Main risk: none.
- Success check: the tutorial sentence matches the erasure rule; the docs test
  passes.

### AD2 Contract provenance (feature, UX) - rank 1

- User problem: the export header no longer shows failures. When the inferred
  set holds a surprising error, or `failure-contract/001` fires, the
  diagnostic spans the whole body and names no origin
  (`src/core/check_expr.ts:487-509`). No tool answers "why can this export
  fail with X?".
- Mechanism: each checked node already stores its failures and requirements
  (`src/core/editor.ts:163-170`). A core query finds the smallest nodes that
  introduce each member. The two contract diagnostics carry `related` spans
  (`src/core/diagnostics.ts:362`; the LSP already maps them at
  `src/lsp/projects.ts:220-233`). The inlay hint tooltip lists the origins.
- Changed files: new `src/core/editor_origins.ts` or `editor_hints.ts`,
  `src/core/check_expr.ts`, `src/core/frontend.ts`, `src/lsp/features.ts`,
  `src/cli/format.ts`, `docs/editor.md`, `docs/language-rules.md`, tests,
  `fixtures/surface/`.
- Cost: M. Fable rates M because the data exists. Astra rates L because of
  calls across modules and recursive groups.
- Main risk: a misleading origin. A failure that a `catch` arm handles must not
  appear. An origin through an imported call stops at the call site. A
  recursive group can only name the group.
- Success check: on the tutorial `findBook`, the tooltip names `Shelf.find`
  for `StoreDown` and the `fail(...)` for `BookMissing`, with lines. A caught
  failure is absent. Each `failure-contract/001` record in the surface
  snapshot carries one related span for each extra failure.
- Reopens: none.

### AD3 Contract change report (feature) - rank 2

- User problem: a new failure in an export with an inferred set reaches host
  TypeScript with no diagnostic (`docs/status.md:56`, finding XC3).
- Mechanism: compare the module interfaces of two revisions. Report each
  export whose failures, services, or result changed, each removed export, and
  each record that became tagged (a wire-format change). First in `watch`
  (`src/core/db.ts` already computes changed modules), later against a git
  revision.
- Changed files: `src/core/interface.ts`, `src/core/db.ts`, new
  `src/core/contract_diff.ts`, `src/cli/main.ts`, `src/cli/report.ts`,
  `docs/api.md`, tests, `fixtures/surface/`. A git variant also changes the
  run permission in `deno.json`.
- Cost: M.
- Main risk: noise from identity or order changes that are not contract
  changes. The watch variant sees only changes inside one session.
- Success check: in `watch` over the service workflow, add `fail(X)` to
  `submit`; the tool prints `submit: fails +X`. A comment edit prints nothing.
- Reopens: extends EID4 without a snapshot file.

### AD4 Write the inferred failure set as a bound (UX)

- User problem: the EID4 guard needs a written `fails` clause, and the user
  must type the set by hand.
- Mechanism: a code action and an optional `check --fix` flag write the
  inferred set as `fails A | B`. The current action rule requires a removed
  diagnostic (`src/core/editor_actions.ts:199-201`), so this needs its own
  action kind.
- Changed files: `src/core/editor_actions.ts`, `src/lsp/features.ts`,
  `src/cli/fix.ts`, `docs/editor.md`, tests.
- Cost: S-M.
- Main risk: an error name that the module cannot see. The XCD5 deferral
  forbids an added import, so the action must refuse.
- Success check: the action writes `fails UserMissing | StoreUnavailable` on
  `getUser`; `check` stays clean; a later new `fail(...)` gives
  `failure-contract/001`.
- Reopens: none.

### AD5 Project and host scaffolding (tooling) - rank 3

- AD5a Named host entry in `--tsc`. User problem: the tutorial `main.ts` is not
  checked by `build --tsc` (`docs/tutorial.md:314-316`). Registered host
  provider modules are checked (`src/cli/tsc.ts:71-72`); a plain entry point is
  not. Changed files: `src/core/project.ts`, `src/cli/tsc.ts`, `docs/api.md`,
  `docs/tutorial.md`, tests. Cost: S. Risk: path containment rules. Success
  check: a type error planted in `fixtures/tutorial/main.ts` makes
  `build --tsc` exit 1 with the error.
- AD5b `effektive init` with Layer stubs. User problem: tutorial step 1 writes
  `effektive.json` and a pinned `deno.json` by hand; step 10 writes each
  Layer by hand. Changed files: `src/cli/args.ts`, new `src/cli/init.ts`, an
  emitter helper for stubs, `docs/installation.md`, `docs/tutorial.md`, tests,
  `fixtures/surface/`. Cost: M. Risk: templates drift from the pinned versions;
  stubs look runnable. Success check: in an empty directory, `init`, then
  `build --tsc` exits 0; a run reports the unimplemented stub; after one
  method is filled in, the program runs.
- Reopens: none.

### AD6 Rounding or integer conversion builtin (language)

- User problem: a percent price cannot be written, because `/` gives `number`
  and the prelude has no rounding function
  (`fixtures/applications/order-lifecycle/README.md:40-41`).
- Changed files: `src/core/resolve.ts`, `tables.ts`, a builtin checker module,
  `lower.ts`, `ir.ts`, `emit/*`, `validate/*`, the specification, the
  generated `typed-ir.ts`.
- Cost: M.
- Main risk: rounding semantics at halves; `$int` range defects.
- Success check: a percent rule in the order lifecycle compiles, and a runtime
  case asserts exact cents.
- Reopens: the stopping rule. The order lifecycle is a witness, not a gate
  application.

### AD7 Sort builtin, item 24 (language)

- User problem: ordered output needs host code (`docs/status.md:139-142`).
  The recorded reason was the hash order of Map and Set, which were removed on
  2026-11-02 (`docs/archive/plans/2026-10-27-second-effect-selection.md:423-425`).
- Changed files: all compiler stages, the specification, `typed-ir.ts`.
- Cost: M.
- Main risk: comparator semantics and stability.
- Success check: a stable sort by key of an identity type, with a literal
  expected order.
- Reopens: selects item 24, which the user put in a later selection.

### AD8 Inlay hints in the playground (UX)

- User problem: the playground shows inferred failures only on hover. The
  frontend exports `inlayHintsAt` (`src/core/frontend.ts:66`), but no file in
  `playground/src` calls it.
- Changed files: `playground/src/editor.ts`, `playground/src/compile.ts`,
  `playground/app.css`, tests.
- Cost: S.
- Main risk: layout at 375 pixels.
- Success check: in a browser, each export in `users.eff` shows ` fails ...`
  after its result type.
- Reopens: none.

### AD9 Playground persistence and share links (UX)

- User problem: a reload discards edits (`docs/api.md:929-931`).
- Changed files: `playground/src/app.ts`, `playground/src/model.ts`, a new
  storage module, tests.
- Cost: S-M.
- Main risk: a stored project from an older version; URL length.
- Success check: edit, reload, and see the edit; a share link opens the same
  text; reset restores the examples.
- Reopens: none.

### AD10 Playground execution (feature)

- User problem: the playground compiles but does not run
  (`docs/api.md:929`).
- Changed files: the playground build, a new runner with in-memory layers,
  tests.
- Cost: L.
- Main risk: bundle size, isolation, and cancellation of a long run.
- Success check: a run shows success, failure, and cleanup for one example.
- Reopens: none.

### AD11 Early-fail guard statement (language)

- User problem: `fixtures/applications/service-workflow/workflow.eff:11-22`
  nests `if ... else` to fail early.
- Changed files: parser, modes, lowering, validator, emitter, specification.
- Cost: L.
- Main risk: control-flow rules inside blocks; a new IR form.
- Success check: the rewritten workflow passes its 15 runtime cases.
- Reopens: the deferral of early returns (`docs/status.md:90`), under the
  terse-source exception.

### AD12 Source test clock (defer)

- User problem: none demonstrated (`docs/status.md:88`).
- Cost: L. Risk: two clock authorities. Success check: first show a failure
  that host `TestClock` cannot handle. Reopens: the stopping rule.

### AD13 Mutation baselines for `check_expr.ts` and `parse.ts` (quality)

- User problem: no survivor baseline exists for the two largest checker and
  parser modules (EI plan EIF10).
- Changed files: `fixtures/mutation/survivors.json`, new tests.
- Cost: M plus machine time.
- Main risk: the run needs a quiet machine; equivalent mutants need proof.
- Success check: `deno task mutate` exits 0 for each module, with a register
  row for each survivor.

### AD14 Latency evidence at the head (quality, performance)

- User problem: the D9 evidence predates EIU2, and the typed-arrow workload
  exceeds the budget (p90 151 ms at 2,000 arrows).
- Changed files: `docs/release-measurements.md`; a fix would touch the
  signature-help path.
- Cost: S plus machine time; M for a fix.
- Main risk: load noise.
- Success check: four large rows under 100 ms p90 at the head; a recorded
  typed-arrow result.

### AD15 Measure the `$int` helper (evidence)

- User problem: D14 asked for this measurement on 2026-10-17
  (`docs/rejected.md:38`).
- Changed files: a new bench file, `docs/measurements.md` or
  `docs/rejected.md`.
- Cost: S.
- Main risk: the optimizer removes the work.
- Success check: a row with the ratio and the noise floor.

### AD16 IR snapshot to all expression kinds (quality)

- User problem: the IR snapshot reaches 27 of 59 expression kinds
  (`docs/testing.md:36`).
- Changed files: `fixtures/ir/`, its test.
- Cost: M.
- Main risk: snapshot churn.
- Success check: the testing row says 59 of 59.

### AD17 Split `checkFunctionBody` (refactor)

- User problem: cyclomatic complexity 26 in a 3,002-line module
  (`src/core/check_expr.ts:2895`).
- Changed files: `src/core/check_expr.ts`, a new `check_contracts.ts`.
- Cost: M.
- Main risk: churn with no measured pain; mutation baselines move.
- Success check: byte-identical golden and IR fixtures.

### AD18 Retained host alias witness (evidence)

- User problem: host mutation through a retained alias is a documented limit
  with no witness (`docs/inferred-input-contracts.md:109`).
- Changed files: a new runtime fixture and test.
- Cost: S.
- Main risk: a trusted-host misuse reported as a compiler defect.
- Success check: a compiled test records the observed result.

## Fresh-eyes critique of the top three (critic: fresh subagent, Opus)

Each item was checked by the orchestrator against the code unless it says "probable".

| ID | What fails, condition, effect | Revision | Orchestrator check | Orchestrator view |
| --- | --- | --- | --- | --- |
| K1 | The two contract diagnostics underline the whole body when a written clause misses an entry; the user must search the body. | First ship one related span for each missing entry, at the node that introduces it. Defer the tooltip. | Confirmed (`check_expr.ts:487-509`). The CLI prints no related spans today (no `related` in `src/cli`), so the CLI part needs a format change under the one-line message rule. | Accept |
| K2 | Node info holds the effect set of the whole subtree, so a search must descend. Through a call to a local or imported function, the smallest origin is the call, not the callee's `fail`. Effects of non-quiet pipeline stages are in `stageSets`, not node info, so a descent can miss them (probable). Recursive groups: probable gap. | State "the call site in this function" as the contract. Test `catch`, `??`, an imported call, a recursive group, and a pipeline stage. | Confirmed `check_expr.ts:294-302`, `1516-1520`, `2713`. | Accept |
| K3 | The AD2 success check uses only the simple `findBook`, so a wrong origin can pass. | A fixture matrix with the exact line of each origin. | Agreed. | Accept |
| K4 | AD3 against a git revision acts as a stored baseline; EID4 ("no snapshot file") was confirmed on 2026-11-03. The draft said "extends EID4", which was too soft. | Make it a numbered user decision before any work. | Agreed. | Accept |
| K5 | `watch` keeps its baseline in memory only, so a change between sessions or commits, the case that breaks a host, is not reported. | Drop the watch-only variant. If built, compare against a git revision. | Confirmed (`src/cli/main.ts:89`). | Accept |
| K6 | No durable guard exists unless the user types the `fails` set. | Keep the action that writes the inferred set (AD4). | Agreed. | Accept |
| K7 | The AD3 check covers only an added failure. | Add a removed export, a service change, and a tagged change. | Agreed. | Accept if AD3 survives |
| K8 | `init` in an empty directory has no services to stub, so the draft success check contradicts the design. | Drop the stub part of `init`. | Agreed; an error of the draft. | Accept |
| K9 | Stubs that type-check and die at run time pass `--tsc`, mislead, and go stale when a service changes. | No stubs. | Agreed. | Accept |
| K10 | A new `effektive.json` key is tooling with no application blocker. | Check every `.ts` that imports a generated module, with no key. | Partly wrong: `docs/status.md:24-29` limits the stopping rule to language features and puts packaging and editor work under release acceptance; `AGENTS.md:43` has broader wording. Auto-discovery can pull in test files and scripts. D10 already uses an explicit `host:` map. | Reject |

Corrections to the draft: (1) `failure-contract/001` fires only when a `fails`
clause is written (`check_expr.ts:487-489`); for an inferred set no diagnostic
fires and only the inlay hint names the failures. (2) The tutorial host is
already checked by `tests/tutorial_slow_test.ts`, but only as a repository
test; a user's own `main.ts` is still outside `build --tsc`.

## Revised list after Decisions 1 to 4 (user: "as recommended", 2026-11-04)

Decision 1 (a): K1-K3 accepted. Decision 2 (a): K4-K7 accepted. Decision 3 (a):
K8-K9 accepted. Decision 4 (a): K10 rejected.

| Rank | ID | Change from the draft |
| --- | --- | --- |
| Prerequisite | AD0, AD1 | Unchanged. |
| 1 | AD2 Contract provenance | Two phases. Phase 1: one related location for each missing entry on `failure-contract/001` and `requirement-contract/001`, at the call site in this function; the CLI prints related locations. Phase 2: the inlay hint tooltip, only after a fixture set proves the search for `catch`, `??`, an imported call, a recursive group, and a pipeline stage, with exact lines. |
| 2 | AD4 Write the inferred set as a `fails` clause | Promoted (K6). With AD2 phase 1, a later new failure gives a diagnostic that points at its origin. |
| 3 | AD8 Inlay hints in the playground | New third place. `playground/src/compile.ts:189` already queries a checked revision for hover; `inlayHintsAt` takes the same revision. `playground/src/editor.ts` already uses CodeMirror decorations. |
| 4 | AD5a Host entry check | `init` and stubs dropped (K8, K9). An explicit `effektive.json` key (K10 rejected). Cost S. |
| Pending | AD3 Contract change report | The watch-only report is dropped (K5). A git-revision comparison reopens EID4 and needs a user decision (K4). If built, its check covers an added failure, a removed export, a service change, and a tagged change (K7). |
| Removed | AD5b `init` with Layer stubs | Dropped by K8 and K9. |

The other candidates (AD6, AD7, AD9 to AD18) are unchanged.

## Decisions 5 and 6 (user: "a", 2026-11-04)

- Decision 5 (a): EID4 stays closed. AD3 (the git comparison) is not built.
  Revisit only after a real case of failure drift.
- Decision 6 (a): the prerequisite repairs are committed, not pushed.
  - `effektive-lang` `fe4e73f`: the `## 0.14.0 - 2026-11-03` heading (AD0).
  - `effektive-lang` `0520ffd`: the tutorial `BookId` sentence and the EIF10
    record (AD1).
  - `effektive` `db5706e`: the asset stamp `?v=0.14.0` (AD0).
  - Checks: `deno task check` exit 0 before each `effektive-lang` commit
    (2,766 fast and 263 slow tests passed); website `deno task test` exit 0
    (12 passed) before `db5706e`.
