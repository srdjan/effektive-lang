# Completeness review of 2026-11-10

Date: 2026-11-10. Base: `6d40e2d` (v0.15.6) on local `main`. Website base: `0c72199`.
Status: on 2026-11-10 the user answered "as recommended": FCD1 (a), FCD2 (a), FCD3 (a),
FCD4 (a), and FCD5 (a). Execution is in the section "Execution".

Opus wrote a draft with 27 findings (FC1 to FC27). Fable and codex astra each validated
the draft independently and added findings: Fable as FF1 to FF11, astra as FA1 to FA5.
Opus reproduced each new finding that this ledger accepts, and each correction that
changes a verdict. Prefixes: FC (draft findings), FF (Fable findings), FA (astra
findings), FCD (decisions).

## Result

The three gate applications, the compiler, the language server, and the playground work
within their recorded limits. Neither reviewer marked a draft finding WRONG.
Fable gave 23 CONFIRMED and 4 PARTLY. Astra gave 19 CONFIRMED and 8 PARTLY.

The review found four reproduced compiler or CLI defects (FA1 to FA4), a red release
state in both repositories (FC1), and three wrong documentation sentences. The largest
feature gap is not in the Effect service primitives of `docs/status.md`. It is in core
data operations: integer arithmetic, text, arrays, tuples, and union narrowing (FF1 to
FF5). Both reviewers infer the same cause: the gate applications keep this work in host
code, so the stopping rule never sees it. This cause is probable, not confirmed. A
review of the host code of the five application witnesses can confirm it.

## Health at HEAD

Opus measured these on 2026-11-10.

| Check | Result |
| --- | --- |
| `deno task check`, fast suite | 3,018 passed, 1 failed, 6 ignored. The failure is `tests/docs_test.ts:135` (FC1). The slow suite did not run inside the gate. |
| `deno task test:slow`, run separately | 301 passed, 0 failed |
| Website `deno task test` | 11 passed, 1 failed: "pages load assets with the deno.json version" (FC1) |
| `deno task logs:report` | No sessions in 24 hours. `.effektive/logs/` has 0 files. `playground/.effektive/logs/` has 6 files, newest 2026-11-07. |

## A. Incorrect: needs a fix

| ID | Defect | Evidence (reproduced by) | Severity |
| --- | --- | --- | --- |
| FC1 | Both repositories fail their own tests at HEAD. Commit `6d40e2d` and website commit `0c72199` changed only `deno.json` to 0.15.6. `CHANGELOG.md` still starts with `## Unreleased` above `## 0.15.5`, and the website pages load `?v=0.15.5`. The release bypassed `deno task release`. This is the ninth bare version commit that broke the gate (see FCD4). Both commits are pushed. | Test output above (Opus; both reviewers confirm) | High |
| FA1 | The checker accepts a pure callback inside an array or tuple whose element type needs an Effect callback. The emitter prints the callback without conversion. `--tsc` fails, and a run fails with `Fiber.runLoop: Not a valid effect: 1`. Source: `export const make = (): (() => Int)[] => [() => 1]`. Cause per astra: `src/core/emit/expr.ts:759-764` emits array and tuple children without an expected element type. | `check` 0 diagnostics; `build --tsc` gives TS2322 (Opus, astra) | High |
| FA3 | `retry` and `repeat` reject an effectful job or option expression during emission after `check` accepts it. Source: `retry(make(), { times: 0 })`, where `make` sleeps and returns a callback. `build` prints `cannot emit main: pure() received an effect-mode call node`, followed by "1 module, 0 diagnostics". Binding the factory result first works. | `check` 0 diagnostics; `build` internal error (Opus, astra) | Medium |
| FA2 | Conversion of a computed pure callback to an Effect callback moves the computation into the wrapper. `make(x)` then runs at each callback call, not at construction: the emitted code is `() => Effect.succeed(make(x)())`. A defect such as integer overflow moves to another program point, possibly outside the surrounding recovery scope, and the computation repeats at each call. | Emitted code (Opus); runtime trace (astra) | Medium |
| FA4 | A source file named `-main.eff` passes `check`. `build --tsc` then fails with `unexpected argument '-m' found`, because `src/host/deno_io.ts:161-163` passes file names to `deno check` without `--` or `./`. | `check` 0 diagnostics; `build --tsc` fails (Opus, astra) | Low |
| N1 | A function with four parameters and a function-type result, such as `(first: Int, second: Int, third: Int, fourth: Int): () => Int`, passes `check`. `build` exits 0 and writes TypeScript that does not parse: the broken function type prints its empty parameter list as `(\n  ,\n)`. `--tsc` gives `SyntaxError: Expected '=>', got ':'`. Found by Fable during the plan validation. | `build` output (Opus, Fable) | High |
| N2 | A long signature whose result type is a function type with one parameter, or a long inline record, breaks inside the result type, and `Option<() => Int>[]` breaks as `Effect.Effect<\n Int\n>>>`. The text is valid TypeScript, and `deno fmt` keeps it, but `deno fmt` of the flat form breaks elsewhere. Layout only, in the family of PH23 and PH24. Found by the FCU6 and FCU1 executors. | Executor reports; fixture `fixtures/emit/lift-containers/` (Opus) | Low |
| FF9, FA5 | `docs/tutorial.md:105` says that the compiler does not infer the parameter types of an export. An export with an omitted parameter type builds without a diagnostic and emits `n: unknown` with a checked input. Only the result type is mandatory. | `build` of `(n): N => n * 2` (Opus, Fable, astra) | Low |
| FC5 (doc part) | The order lifecycle row of `docs/status.md:53` says "Percent pricing is not possible". Both reviewers built it through the duration type: `Cents((subtotal * 90 * 1ms) / 100)`. The sentence is too strong. The workaround is not a good language form. | Reviewer runs (Fable, astra) | Low |
| FC14 (doc part) | `docs/api.md` "Known limits" says "Nested projects are not supported". Since 0.15.4 the server rebinds documents and transfers diagnostic ownership to a nested project (`src/lsp/projects.ts:479-497`, `649-651`). The outer disk walk still reads inner files. The sentence needs that qualification. | 10 nested tests pass (astra) | Low |
| FC2 | Two mutation survivors in `hasSchemaMetadata` (`src/core/emit/types.ts:170`) have no classification and no register entry. A missing test is one possible cause. An equivalent mutant or a slow-test kill are others (`docs/testing.md:153-160`). | `docs/status.md:69` (all three) | Low |
| FC3 | Emitted layout breaks D12 for PH23 and PH24. Layout only. | `docs/status.md:70` | Low |

## B. Missing

Core data operations. Both reviewers rank these above the service primitives.

| ID | Gap | Evidence (reproduced by Opus) |
| --- | --- | --- |
| FF1, FC5 | No integer division, no remainder, no rounding, no `number` to `int` conversion. `n % 2` gives `syntax/001`. `n / 2` gives `number`. `Duration / int` truncates, so integer division works only through a time unit. `schemaDecode` can reject a fraction but cannot round. | `mod`, `idiv` reproducers |
| FF2 | No text operations. `"n=" + n` gives `type-mismatch/007`. No length, interpolation, or number to text conversion exists. `"a" + s` works for two strings only. Source cannot build a message that contains a number. | `concat` reproducer |
| FF3, FC6 | Arrays have no length, index, first element, list pattern, append, or sort. `xs.length` gives `type-mismatch/006`, `xs[0]` gives `syntax/008`, `[...xs, x]` gives `syntax/008`. A count is possible through `fold`. The collection builtins are `all`, `traverse`, `map`, `filter`, and `fold`. Sort is item 24, requested by the user for a later selection. | `len`, `idx`, `append` reproducers |
| FF4 | A tuple cannot be read. `const [a, b] = p` gives `syntax/008`, and a tuple pattern gives `syntax/011`. `all([...])` returns a tuple, so a user must use the record form of `all`. | `tup1`, `tup2` reproducers |
| FF5 | A declared union of non-literal members cannot be consumed. `match` on `N \| null` gives `pattern/004`, and `=== null` does not narrow. | `nullable` reproducer |
| FF7 | Unary `-` and `!` give `syntax/010` with a hint. A negative literal is `0 - 1`. The specification does not state this limit. | `neg`, `not` reproducers |
| FC7, FF8 | No early return or early-fail guard (AD11). No catch-all handler: `catch { _ => 0 }` gives `unknown-name/001`. A `finally` block must have type `void`. A record pattern field cannot bind. | `catchall` reproducer; others by Fable |
| FC8 | No user-defined generics and no effect-row polymorphism. A helper over a closed union already serves several types (astra), so the gap is for helpers that preserve arbitrary type relations. | `docs/status.md:99` |
| FC9 | A block-level function cannot call itself (`execution-mode/003`). | Fable, astra |
| FC11 | Service primitives: configuration and secrets (item 17), metrics, queues and coordination (item 11), caching (item 14), keyed jobs (item 10), detached work, test clock (AD12). Each waits for an application blocker. Fable ranks configuration first among them. | `docs/status.md:156-168` |

Tooling.

| ID | Gap |
| --- | --- |
| FC12 | No source formatter: no `effektive fmt` and no LSP `textDocument/formatting`. |
| FC13 | No `run`, no `init`, no source test runner, no host entry check (AD5a, ranked 4th on 2026-11-04, not built). `.eff` logic is testable only through TypeScript host code. |
| FC14 | Language server: no folding ranges, workspace symbols, document highlight, code lens, call hierarchy, automatic imports, delta tokens, cancellation inside the core, or definition from generated `.ts` into `.eff`. |
| FC15 | Playground: no execution (AD10), no persistence or share links (AD9), no inlay hints (AD8). |
| FC16 | No output directory: `build` writes `.ts` and `.ts.map` beside each source. |
| FF10 | No `--version`: `effektive --version` gives "unknown command". With FC1 open, a user cannot report the version. |
| FF6 | No test compiles the 30 inline Effektive tabs of `effektive-spec.html`. The compiler tests compile only the files of `effektive-examples/` (`tests/website_examples_slow_test.ts`). The website `deno task typecheck` checks the hand-written Effect-TS tabs only. AGENTS.md makes the Effektive check a manual step. |
| FF11 | Common first tries give a diagnostic without a hint: `%`, a single-quoted string, a template literal, a missing `effektive.json`. No warning exists for an unused binding. |
| FC17 | Native Windows behavior is unverified (accepted scope limit). |

## C. Not quite complete

| ID | Item |
| --- | --- |
| FC18 | The user has not done the manual acceptance of the VS Code client and the playground, pending since 2026-10-21. |
| FC19 | The self-improvement loop has almost no real-use data (see health). FR1 to FR7 wait for 24 hours of real logs (user decision of 2026-10-27). |
| FC20 | The last broad mutation sample (seed 20261031) does not establish current mutation acceptance. |
| FC21 | External integration covers loopback HTTP and file-backed SQLite only. |
| FC4 | The host-check cost table was measured with Effect 4.0.5. The pin is 4.1.2. The cost with real I/O is not measured. |
| FC24 | The benchmark harness has no interleaved comparison of two builds. Separate runs on each build are possible, with disclosed drift (astra correction). |
| FC23 | Refinements have no generics or abstract predicates. Recursive Option data in an alias and mutual alias recursion are unsupported (item 23). |

## D. Replace with a better approach

| ID | Current approach | Better approach |
| --- | --- | --- |
| FC25 | The version tests exist in both repositories (`tests/docs_test.ts:135`, website `stamp_assets_test.ts`). A manual bump bypasses them, and `scripts/release.ts` does not stamp the website. | Make one command do the release of both repositories, or block a commit that changes the version without its heading. See FCD4. |
| FA3, FA1 | The emitter assumes operand modes and expected element types that the checker does not guarantee. | Emit from the checked mode and expected type of each operand, so `check` acceptance implies a valid emission. A fixture that crosses each container and builtin option with each callback mode can guard this boundary. |

## Reviewer claims that this ledger rejects or narrows

- FF6 (Fable): the `spec-duration` Effect-TS tab uses `Math.trunc`, while the compiler emits `$int`. This is not a defect. The website README defines each Effect-TS tab as a hand-written translation.
- FC22 (draft): the removed Schedule forms, scope handles, aggregation, and keyed groups do not leave a gap in a gate application. Both reviewers agree. The item is context only.
- FC26 (draft): no real case of failure drift was found. Decision 5 of 2026-11-04 stands.
- FC27 (draft): the documentation weight has no measurement of cost. The item is dropped.
- FC10 (draft): the removal of `Map` and `Set` is a closed decision without new evidence. The item is context only.

## Checks with no defect found

Fable ran the tutorial as written: the build, `deno check`, the run output, and the Step 7
diagnostic match. Fable also checked reserved-name guards, evaluation order,
short-circuit evaluation, cleanup order, and `$int` overflow. Astra found no case in which
an inferred failure or requirement set omits an entry. Neither review establishes
soundness across the whole compiler.

## Decisions

FCD1 (repair FC1). (a) Opus moves the Unreleased entries under `## 0.15.6 - 2026-11-09`,
stamps the website assets with 0.15.6, runs both test suites, and commits once in each
repository. Recommended. (b) The user repairs it.

FCD2 (fix FA1 to FA4). (a) Opus writes a plan with one unit for each defect. Sonnet
executes each unit: a failing test first, then the fix. Opus reviews and runs the gate.
Recommended. (b) Record the defects in `docs/status.md` only.

FCD3 (correct the three documentation sentences: FF9, the FC5 percent sentence, the FC14
nested-project sentence). (a) Opus corrects them in one commit. Recommended. (b) No change.

FCD4 (release path, FC25). A bare version commit broke the gate nine times: v0.12.2,
v0.12.3, v0.13.5, v0.14.0, v0.14.1, v0.15.2, v0.15.3, v0.15.5, and v0.15.6. The releases
do not use `deno task release`. (a) A committed pre-commit hook in each repository
completes a bare version commit. In this repository, the hook moves the Unreleased
entries under the new heading. In the website repository, it runs `deno task stamp`.
The hook adds the result to the same commit. Recommended: it fits the observed release
habit and needs no new command. (b) `deno task release` also stamps the website. This
needs a change of habit, and nine recurrences show that the habit persists. (c) No change.

FCD5 (core data gaps FF1 to FF5, FF7). The stopping rule needs an application blocker or
an explicit target change. The terse-source exception of 2026-10-24 can cover unary
operators, `%`, and tuple destructuring. (a) Accept a target change for core data
operations, and let Opus write a selection plan without implementation. Recommended:
both reviewers rank these gaps above every service primitive. (b) Select only the terse
subset under the existing exception. (c) Keep the gaps as a record.

## Execution

| Decision | State | Commits and checks |
| --- | --- | --- |
| FCD1 | Done. | `126d98d` (heading); website `7b52c43` (stamp). `deno task check` exited 0 with 3,019 fast and 301 slow tests passed. Website `deno task test` exited 0 with 12 tests passed. |
| FCD2 | In progress. | FCU4 `bbfda0c`, FCU1 `712efa2`, FCU6 `eb8c9bf`. Directed mutation of the FCU1 lines: 3 sites, 3 killed. FCU2, FCU3a, and FCU3b open; see "Defect plan". |
| FCD3 | Done. | `3808b91`. |
| FCD4 | Done. | `1a9004a` (FCU5) and `8148cb8` (mutation: 16 sites, 16 killed); website `8a6cc82`. Both clones have `core.hooksPath .githooks`. |
| FCD5 | Plan written: [core data operations](2026-11-10-core-data-operations.md), decisions COD1 to COD4 wait for the user. | |

Refinement of FA1 by Opus on 2026-11-10: a record literal and `Some` already lift a pure
callback at an expected Effect callback type, and pass `--tsc`
(`({ f: () => 1 })` emits `f: () => Effect.succeed(1)`). An array or tuple literal does
not. A pure callback array through a binding gets `type-mismatch/003`, as the rule at
`docs/language-rules.md:613` requires. So the defect is in the emitter only: array and
tuple literals must pass the expected element type to each element, as records do.

## Defect plan

Units FCU1 to FCU5 carry out FCD2 (FA1 to FA4) and FCD4. Each executor writes a failing
test first and confirms that it fails for the reason of the defect. Executors do not
commit, do not edit `CHANGELOG.md`, and do not run `git checkout`, `git restore`, or
`git stash`. Opus reviews each diff, writes the changelog entry, runs `deno task check`,
commits, and runs `deno task mutate --only <path:line>` on the changed logic lines.

FCU1, FCU2, FCU3a, and FCU3b change the emitter, so they run one after another in this
order. FCU6 changes the layout printer and runs in parallel with FCU1. FCU4 and FCU5 ran
in parallel and are done.

Fable validated FCU1 to FCU3 on 2026-11-10
(`~/.claude/scratch/assess/fcu-validation.md`, reproducers in
`~/.claude/scratch/assess/evidence/fable-fcu/`). The three causes are correct, but each
unit was too narrow. FA1 occurs in 17 positions. FA2 also occurs for a pure block at a
lifted slot. FA3 also occurs for `timeout`, `uninterruptible`, `provide`, and the
`retrySchedule` step. The table includes these changes. Fable also found N1, which Opus
reproduced: `export const make = (first: Int, second: Int, third: Int, fourth: Int): () => Int => () => first`
passes `check`, and `build` exits 0 but writes `): (\n  ,\n) => Effect.Effect<Int> =>`,
which does not parse.

FCU4 correction by Opus: the executor used a `--` separator. After `--`, `deno check`
ignores the file names and checks every file, so five website example tests failed.
Opus replaced it with a `./` prefix and added an unrelated file with a type error to the
test.

| Unit | Defect | Model | Files | Acceptance check | Turns |
| --- | --- | --- | --- | --- | --- |
| FCU1 | FA1 | Sonnet | `src/core/emit/expr.ts` (array and tuple literal children, near lines 752-764), `tests/emit_lift_slot_test.ts` | The element type comes from `expected` when it is an array or tuple, else from the type of the literal node, as the record case does (`fieldType(expected ?? e.type, ...)`). The 17 positions of the validation report each emit the lift and pass `build --tsc`. Each new test fails before the fix. | 40 |
| FCU2 | FA2 | Sonnet | `src/core/emit/expr.ts` (`fit`, near lines 707-709), one test file | A converted computed callback, and a pure block at a lifted slot, evaluate once, at construction. Defect-point runtime checks for a lifted return, `defer`, `traverse` over `[]`, and a block arm. Reviewed golden changes are permitted. | 40 |
| FCU3a | FA3 | Sonnet | `src/core/emit/shape.ts` (near lines 107-110 and 145-171), `src/core/emit/expr.ts` (near lines 1814-1820), `src/core/emit/families/effect.ts` (near lines 165-175), one test file | Effectful job and option expressions of `retry`, `repeat` (also without options), the `schedule` option, and the `retrySchedule` step build and pass `--tsc`. `retry(mkP(), { times: 0 })` with a pure callback from an effectful factory works. A runtime test counts factory runs (1) and job runs (3), equal to the bind-first control. The FCU2 runtime checks pass again. | 40 |
| FCU3b | FA3 | Sonnet | `src/core/emit/families/effect.ts` (near line 63), `src/core/emit/families/layer.ts` (near lines 75-78), one test file | Effectful job expressions of `timeout`, `uninterruptible`, and `provide`, and an effectful layer expression of `provide`, build and pass `--tsc` with the bind-first runtime result. | 35 |
| FCU4 | FA4 | Sonnet | `src/host/deno_io.ts` (near lines 161-163), `tests/cli_slow_test.ts` | A project with `-main.eff` passes `build --tsc` with exit 0. | 25 |
| FCU6 | N1 | Sonnet | the layout printer of function types (`src/core/emit/`, not `expr.ts`), `tests/emit_slow_test.ts` or `fixtures/emit/forms/forms.eff` | A function with four parameters and a result type `() => Int` emits valid TypeScript. `build` never writes TypeScript that does not parse. | 30 |
| FCU5 | FCD4, this repository | Sonnet | `.githooks/pre-commit`, `.githooks/post-commit`, `scripts/version_hook.ts`, `scripts/release.ts` (export `describe`), `tests/version_hook_slow_test.ts`, `docs/development.md` | In a temporary repository, a bare version commit made with `git commit -am`, and one made with `git commit deno.json -m`, both commit the changelog heading and leave a clean status. A bump with an empty Unreleased fails the commit. A commit without a version change does not start Deno. | 40 |

Opus adds the website hook after FCU5, as shell only, and checks it in a scratch
repository.
