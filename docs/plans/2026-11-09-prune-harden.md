# Pruning and hardening list

Prefixes: PH (items), PHD (decisions for the user), PHF (findings of the adversarial reviews: PHF-A from codex astra, PHF-F from Fable), PHU (units).

Date: 2026-11-09. Base: `6ae0538` on local `main`. Status: accepted on 2026-11-09. The user answered "as recommended": PHD1 (a), PHD2 (a), and the execution of units PHU1 to PHU12. The acceptance authorizes one commit for each unit on local `main`, and one separate commit in `../effektive` for PHU12. It does not authorize a push, a release, or a version change. Section 11 holds the progress. The evidence is in [2026-11-09-prune-harden-evidence/](2026-11-09-prune-harden-evidence/).

The user asked for a list of unnecessary complexity, and for ways to reduce the design to a minimum without loss of functionality. This is the cleanup step before more features. The list ends with adversarial reviews and empirical checks.

## 1. Result

The source code is close to its minimum at the level of functions and modules. Eight earlier passes removed unused exports, one-use helpers, redundant checks, and try blocks. Six scouts and two reviewers found no dead function in `src/core/`. The measured pruning of `src/` that keeps all functionality is about 100 lines of 51,453.

The large reduction is outside `src/`. The committed validator fixtures are 13,646 lines that a generator already builds (PH8). A pilot removed them, and `behavior:compare` stayed equal.

The work found three defects, and both reviewers reproduced each one:
- PH1: invalid UTF-8 in a `.eff` file changes a string value silently.
- PH2: three forms of local curried closure emit TypeScript that `deno fmt --check` rejects.
- PH3: 130,000 diagnostics crash the CLI with exit 3.

A probable fourth defect is in the playground log server (PH6): it reads a body before it checks the origin, and it accepts a foreign `Host`.

Two decisions need the user. PHD1: remove `withResource`, which is a second spelling of `using`. PHD2: keep or remove builtins that the corpus does not call. The 2026-11-02 reason to keep them was a false count.

## 2. Method

1. Opus measured the baseline (Section 3) and a merged LCOV report of both suites.
2. Six read-only scouts searched one slice each: A language surface (Opus), B compiler core (Opus), C adapters (Sonnet), D tests and tools (Sonnet), E documents (Sonnet), and F hardening probes (Sonnet). The common brief listed the work of the earlier passes and the rejected ideas.
3. Opus checked the main claim of each kept item in the real tree.
4. Fable and codex astra (`gpt-6-astra`) reviewed the draft independently, each in its own snapshot. They reported 42 findings. Section 8 resolves each one.
5. Four Sonnet pilots applied the largest items in detached worktrees. Opus reviewed each diff and ran the full gate in each worktree (Section 9).

"M" marks a measured fact. "I" marks an inference from reading code. "Reproduced" means that Opus ran the reproduction.

## 3. Baseline

Opus measured these values at `6ae0538`:

| Measure | Value |
| --- | --- |
| Source lines under `src/` | 51,453 |
| Test lines under `tests/` (296 files) | 76,022 |
| Fixture lines under `fixtures/` | 38,813, of which `fixtures/validate/` has 13,646 in 23 files |
| Lines of `scripts/` and `bench/` | 5,758 and 5,147 |
| Deno tasks | 27 |
| Fast suite | 3,005 passed, 6 s |
| Slow suite | 296 passed, 50 s |
| Uncovered source lines, both suites merged | 993 |
| Source functions with no hit | 16, in adapters that run in subprocesses, and the inner `split` and `splitAdaptive` of `emit/expr.ts` |
| Commits that touch `src/core/lower.ts` since 2026-10-26 | 51, the most of any file |

Each uncovered range that the scouts read is an input without a test (PH7), a defensive internal check, or an exhaustive `never` default.

## 4. Hardening items

PH1 (silent change of string values: invalid UTF-8). Reproduced by Opus and both reviewers. A `.eff` file with the bytes `FF FE` in a string literal builds with exit 0 and 0 diagnostics. The emitted string holds two U+FFFD characters. Cause (read): `denoFs.readText` (`src/host/deno_io.ts:29`) uses `Deno.readTextFileSync`, which replaces invalid bytes. The CLI session, the workspace reader, and the LSP read through this one function (M, grep). `src/host/deno_io.ts:106` reads logs, not source. Change: decode with `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`, and map the failure to the existing read error ("x.eff cannot be read"). `ignoreBOM: true` is necessary: without it, the decoder removes a leading BOM, and `Deno.readTextFileSync` keeps it (M: 17 against 16 characters). First write a test with invalid bytes and a BOM case. Run it, and see it fail for this reason.

PH2 (emitted TypeScript that `deno fmt` rewrites). Reproduced by Opus and both reviewers. Three local curried closures in a function body build with 0 diagnostics, and `deno fmt --check` rejects the emitted file. Design record D12 (`docs/architecture.md:166`) says that the output passes `deno fmt --check` unchanged.

```text
const f = (a: IntVal) => (b: IntVal) => { const s = a + b; s + n }
const pairer = (a: IntVal) => (b: IntVal) => ({ left: a, right: b })
const pairerWithLongerName = (alpha: IntVal) => (beta: IntVal) => ({ leftSide: alpha, rightSide: beta, total: alpha + beta })
```

The block and object tail of `chainOptions` (`src/core/emit/expr.ts:331-341`) has no hit, and its inner `split` and `splitAdaptive` calls at `:337,339` have 0 calls (M). The probable cause is the choice order of `alt`, or a fit measure that starts at the first line of a prefix with several lines. A trace of the `alt` decision for these inputs can confirm it. Change: first add the three declarations, inside a function body, to `fixtures/emit/forms/forms.eff`. `tests/emit_slow_test.ts:121` runs `deno fmt --check` on its output. Then fix the layout choice.

PH3 (CLI crash on a large diagnostic count). Reproduced by Opus and both reviewers. A file of 130,000 `@` characters makes `check` and `build` exit 3 with "internal error: Maximum call stack size exceeded". Cause: `lines.push(...formatDiagnostics(...))` at `src/cli/build.ts:95` spreads the array into one call. Fable changed only that line to a loop, and `check` printed all 130,000 diagnostics (M). Change: a loop at `:95`, and at `:112` as a defensive step, because the `tsc` output can be large. The other spread sites grow with the module count or the fix count. Leave them.

PH4 (false facts in documents and comments). Read, and confirmed by both reviewers.
- Three solution notes name the task `behavior:capture`, which `b79ac72` removed on 2026-11-02: 12 uses in `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md` (9), `docs/solutions/logic-errors/pipeline-stage-effects-must-come-from-the-checker.md` (2), and `docs/solutions/workflow-issues/measure-the-whole-slow-suite-before-adding-concurrency.md` (1). Give each note a status line and a link to `behavior:compare`. Keep the old commands as history.
- `docs/measurements.md:22,71`, `bench/m5.ts:48`, and `bench/m5_target.ts:101` say "the five examples". `fixtures/examples/` has six `.eff` programs. The host companion is a seventh generated module; name it separately.
- `src/host/log.ts:54` says that `memoryLog` is "for tests". `playground/src/log_client.ts:69` uses it in production.
- `tests/internal_sites_test.ts:1-3` says that thirteen sites throw an internal failure, two in the lowering and eleven in the emitter. `src/core/lower.ts` has 30 `throw internal(` sites and `src/core/emit/` has 38 (M). Correct the count, or say which sites the file tests.

PH5 (log envelope date check). Reproduced by astra. `browserEnvelope` (`src/host/log_schema.ts:343-366`) checks only `typeof t === "string"`. `isReplayEnvelope` (`:370-380`) also requires a valid `Date.parse(t)`. A bad client can write a line that the report and the replay then drop without a message. Change: the same date check in both, and one literal test case for a bad date.

PH6 (the playground log server reads before it checks). Measured by astra in its snapshot, read by Fable. `playground/serve.ts:44-70`:
- It consumed 196,608 bytes of a body before it rejected the origin. The configured limit is 65,536.
- It accepted a request with a foreign `Host` and `Sec-Fetch-Site: same-origin`. This is the shape of a DNS rebinding request.
- It appended to an existing session file of 33,554,432 bytes after a restart, because the byte counter starts at 0.
- The session map has no bound.
The server binds loopback only. Change: check `Host` and the origin before the body is read. Refuse a body without `Content-Length` with status 411, so that the existing length check covers each body. Take the size of a session file from `stat` when the map does not know it. Bound the session map.

PH7 (missing tests for reachable branches). The LCOV counts are from Fable (M). Each input is from a scout or a reviewer.
- `src/core/resolve.ts:808-826` (15 of 17 lines uncovered): `n |> Nope.put`, `1 |> s.put`, and `n |> map.put` give `unknown-name/001` and `unknown-name/004` (M, reproduced by astra).
- `src/core/parse.ts:873-878` (5 of 5): `opaque type X` alone in a `.eff` file gives `syntax/012` (M). Do not write `opaque type X = int`, which adds `syntax/008`.
- `src/core/project_config.ts:206-207`, `:236-241`, `:288-294` (all lines): an import entry that is not an object, an import entry with an extra key, and a host module outside the root.
- `src/core/check_expr.ts:852-858` (5 of 6) and `:893-898` (5 of 5): `checkedTypeFits` with a union source and with a tuple source.
- `src/core/emit/expr.ts:1534-1547` (9 of 14) and `src/core/resolve.ts:336-346` (6 of 11): composite arguments in `isTrivial`, and the arms of `describeKind`.
Change: before each test, run the input through the CLI and record the diagnostic. Then write one literal test or one error fixture with the marker convention, and run `deno task mutate` on the module.

## 5. Pruning items

PH8 (generated validator fixtures). Pilot `8e884a8`. `fixtures/validate/` holds 13,646 lines in 23 files. `scripts/validate_fixtures.ts` builds each file from a lowered program and one mutation, and `tests/validate_test.ts:1011` asserts that the files equal `buildFixtures()`. Change: the tests iterate `buildFixtures()`. `behavior:compare` runs the head revision's builder into the exported head tree before both runs, so that both revisions read the same forged inputs and `readForged` stays the same (PHF-F2). A tree that still holds the files uses them. Two oracles must stay (PHF-A3):
- The committed manifest pins the expected code of each fixture apart from the generator. Add a literal table of fixture name and code to `tests/validate_test.ts`.
- The fixtures are the only IR snapshot of `fixtures/ir/empty-effect.eff` and `fixtures/ir/tagged.eff` (M: no other reader). Add both programs to `fixtures/ir/examples-baseline.json`.
Delta of the pilot (M): fixtures -13,646, scripts +44, tests -47, docs and other -2. The two oracles add lines; their size needs measurement.

PH9 (coverage ownership manifest). Pilot `5382674`. `fixtures/coverage/ownership.json` (177 lines) listed 149 runtime modules by hand, and 8 exceptions. It has 32 commits, and each module merge also edits it. Change: list only the exceptions, and treat each other file under `src/` and `playground/src/` as runtime. The pilot keeps each guarantee of the 2026-11-05 reset (RCP-3): the reasons and owners of the exceptions, canonical paths, the symlink check, the stale-entry check of the exceptions, and the complete LCOV requirement. Both reviewers confirm it. One behavior changes: a new type-only file fails after the suites, not before them, and the message names the manifest. Delta (M): -167 lines.

PH10 (one typed fact lookup in `lower.ts`). Pilot `088952b`. `src/core/lower.ts` has 12 `fact?.kind !==` sites. Ten have the same shape: `const fact = this.fact(n); if (fact?.kind !== "K") throw internal(...)`. The other two (`:1063` returns, `:1334` has a compound condition) stay. A generic `factOf(node, kind)` replaces the ten. It keeps the runtime check, and it needs one `as FactOf<K>` cast, because TypeScript does not narrow a generic kind (M: TS2322 without it). Three internal error texts become uniform, and no test asserts them. Delta (M): -22 lines. Trade-off: ten copies of a guard against one cast.

PH11 (a source map option that only tests set). Pilot `73262cd`. Only `tests/sourcemap_test.ts` sets `includeContent`. The product call in `src/core/typescript.ts:130` passes no options. `buildSourceMap` is a documented export (`docs/api.md:514`), and no code outside this repository imports the package, so the removal breaks no caller (PHF-A2). Change: delete `SourceMapOptions`, the `options` parameter, the `sourcesContent` field, branch, and serialization, the tests that set the option, and the clause at `docs/language-rules.md:638`. Also update `docs/api.md:514`, which the pilot missed. The pilot writes the five keys in a fixed object, so the key order stays; do not replace it with a bare `JSON.stringify`. Delta (M): -26 lines.

PH12 (server context fields that no handler reads). Pilot `ed9ab24`. `options`, `log`, and `notify` in `src/lsp/handler.ts:30-33`, and their implementation in `src/lsp/server.ts:252-265`, have no reader and no destructuring (M, both reviewers). Delta (M): -13 lines.

PH15 (repeated attach and detach in the LSP project set). Read by scout C, confirmed with conditions by astra. `didOpen`, `didClose`, and `#rebind` in `src/lsp/projects.ts` repeat the same attach steps, and two methods repeat a clear-and-publish loop. The detach paths differ: some read the disk again and mark the project dirty. Change: extract only the shared steps, and keep the order of each lifecycle step in its caller. Delta: needs a pilot. Proof: the LSP tests and `deno task mutate` on `projects.ts`.

PH19 (one builder of related spans). Read by scout A, confirmed by both reviewers. `src/core/service_bounds.ts:102-111` and `src/core/check_expr.ts:287-303` both build related spans with "requires `X` here". `check_expr.ts:302` sorts them, and the service bound keeps the grouping by capability. Change: share only the text and the span construction, and keep each order. A change of the order of related spans is outside this list. Delta: needs measurement. Do this item only if the shared part is more than the call overhead.

PH20 (a write flag that is always true). Found by astra, read by Opus. `runSaveRound` takes `write` (`src/host/save_round.ts:37`). The CLI passes `write: options.write` inside `if (options.write)` (`src/cli/build.ts:75-84`), and the LSP passes `write: true` (`src/lsp/projects.ts:563`). No caller reads `round.writable` (M: the tests read `planWrites(...).writable`, a different value). Change: remove the flag of the wrapper and the unread result field. Keep `writeGenerated(false)`, the ownership rule, and the removal rules. Delta (M, astra trial): -5 lines; 18, 39, and 57 tests of the output, CLI, and LSP files passed.

PH14 (copied test helpers). Read by scout D, corrected by both reviewers. `checkText` is defined in 4 test files, `diagnosticsOf` in 6 plus `tests/helpers.ts:722`, `offsetOf` in 4, and `isRecord` in 4 (M). Only `diagnosticsOf` has a shared form, and the copies differ: some return diagnostics, some return text, some take a mode or an occurrence index. Seven test bodies of 11 lines are equal in three application tests and four schema tests. 14 test files build `new Deno.Command(` at 22 sites, and `tests/process_helpers.ts:13` exports `deno(cwd, args)`; 10 of the 14 pass `stdin` or `env`. Change: merge only groups with equal bodies, and measure the net lines after the imports. Delta: needs measurement.

PH17 (hand-kept counts in documents). Read. `docs/testing.md:32-37` states counts that no test checks: surface records, expression kinds, lexer strings, behavior kinds, and golden files. Each count is true today (M). Change: delete the counts that a reader does not need, or check each one in `tests/docs_test.ts`.

PH18 (dated measurement records in live documents). Read, corrected by both reviewers. `docs/release-measurements.md` (155 lines), `docs/refinement-measurements.md` (56 lines), and `docs/evidence/` (6 files, 308 KiB) are records of dated runs. The raw JSON and the release screenshots of the earlier plan are already gone; `docs/archive/README.md:5` records it. Change: move the three records to `docs/archive/`. Update the five live links and one comment: `docs/status.md:236`, `docs/inferred-input-contracts.md:92`, `docs/measurements.md:117`, `docs/language-rules.md:752`, and `scripts/logs_report.ts:19`. `tests/docs_test.ts:37` checks each relative link. Keep `docs/release-assets/installed-vscode-review.json`, which `docs/installation.md:63` links. Value: low.

## 6. Decisions for the user

PHD1 (`withResource` is a second spelling of `using`). This reopens a rejected item with new evidence. On 2026-11-02 the reason to keep `withResource` was "`using` can need `withResource`". The checker sends `UsingExpr` to the same `withResourceCall` (`src/core/check_expr.ts:572-581`), so `using` needs the checker function, not the prelude name (read). The checker accepts only three inline closures (`src/core/check_builtins/scope.ts:160`), so each call has a `using` form with the same behavior. With block-bodied callbacks, the two forms give equal IR (M: `tests/concise_source_test.ts:336-347`; `normalized()` drops only spans and local names). With an expression body, `using` adds a `block` node around it (M, pilot). The corpus has 7 `using` blocks and 0 `withResource` calls. `fixtures/ir/resource-case.eff:3` calls it, 12 test files name it, and the website specification names it 8 times (M).
(a) Remove the prelude name and its lowering path. Keep `withResourceCall` and the `with-resource` IR node, which `using` needs. Rename the diagnostic text "withResource requires three inline arrow callbacks" and the callback names in `scope.ts:160-179` to `using`; the pilot kept the old name, which is wrong after the removal (PHF-F3). Rewrite the tests and `resource-case.eff` to `using`, and update the website specification as a separate commit. Source that calls `withResource` no longer compiles and gets `unknown-name/001`. Recommended by Opus: the language keeps one spelling for one operation, and a user can still write every program. Measured cost: `src/` -55 lines, `tests/` -22, the IR baseline +72.
(b) Keep both forms. Recommended by astra (PHF-A6), because existing source that calls `withResource` breaks. Opus does not adopt this: no code outside this repository uses the language, and the corpus has no call.

PHD2 (builtins that no application calls). On 2026-11-02 the reason to keep `now`, `run`, `all`, and `log` was a corpus count. That count is false (M): each match in the applications is a service method (`Clock.now()`, `Users.all()`, `consumer.run()`) or a user export named `log`. Other uses exist outside the applications: the website specification calls `log("ready")` and documents `now()` (`effektive-spec.html:64,288,292,1419`), and `fixtures/ir/empty-effect.eff:2` calls `run(defer(...))` (M, PHF-F6). The `borrow` modifier, the duration pattern, and `try ... finally` without `using` also have no application use. A removal loses functionality, so it is outside the stated goal. Line ranges give a candidate scope, not a measured saving: `log` 232 lines, `all` 146, `run` 65, `now` about 13.
(a) Keep all of them, and correct the false count in the record. Recommended by Opus and both reviewers.
(b) Remove `log`, `all`, `run`, and `now` in a later pass, one pilot for each group, with the website and the IR fixture changed in the same unit.

## 7. Checked and kept

The scouts and the reviewers checked these candidates and rejected them. Each line gives the reason.

- PH13 (the `unchanged` branch at `src/cli/main.ts:225`): the line narrows the result type, so its removal fails `deno check` with TS2339 (M, pilot and astra). The second `sync()` after `check --fix` can also give `unchanged` (I, Fable).
- PH16 (merge `measure_functions.ts` into `measure.ts`, and drop the `fmt` and `lint` tasks): the two scripts count in different scopes (PHF-A9), and the two tasks cost one line each.
- `docs/rejected.md`: it holds a live protocol for measured rejections as well as the gap list (PHF-A11).
- The source file map in `docs/api.md` (210 lines, 191 rows, checked by `tests/docs_test.ts:96`): it has the maintenance cost of PH9, but each row gives a description that a reader uses. Fable recommends to keep it.
- The LSP has no cap on one `publishDiagnostics` message. A file with 300,000 diagnostics gives one message of 52.9 MB, and the server answers later requests (M, scout F and astra). The input is not realistic. The probe does not measure the responsiveness of an editor.
- An `int` can be `-0`, for example `0 * -1`, and `$int` accepts it (M). `===`, JSON, and string conversion do not show it; `Object.is`, `1 / x`, and `Math.atan2` do (PHF-A21). It is ordinary JavaScript behavior, and a change would alter the emitted runtime helper.
- The log kinds `cli.change`, `cli.tsc`, and `pg.layout` have no automated reader. `docs/logging.md` lists each of them, and an agent reads sessions by hand (PHF-A22, PHF-F14). Decision SRD3 keeps the logging loop.
- Dead code in `src/core/`: none. The 61 uncovered lines of `src/core/validate/refinements.ts` are about 30 ranges of 1 to 7 lines, which fits defensive branches (PHF-F).
- `src/host/deno_io.ts` functions `sourceEvents`, `watch`, and `denoCheck`: they run in subprocess tests.
- A merge of `validate/expr_walk.ts` `exprChildren` with `emit/shape.ts` `childrenOf`: the separation is deliberate, and the merge is on the rejected list.
- The type printers `type_show.ts` and `emit/types.ts`: different input and output.
- The incremental memos: `deno task bench --quick m3` shows 1 parse and 1 check for a body edit at each size. The cost of the lowering memo in build and watch sessions needs measurement with M7.
- The written and inferred contract paths: one path handles both. `with never` and an omitted `with` give different IR.
- The module service bound against the `with` clause: they measure different requirement sets.
- LSP capabilities: each of the 11 advertised providers has a handler, and the VS Code client uses each feature.
- A simpler model of project rebinding: none with equal output.
- Document overlap: `docs/language-rules.md` and the website specification share 1.5% of 8-word sequences.
- Test duplication: 32 groups of 161 tests differ only in literals, but the literals are multi-line sources, so a table saves only wrapper lines.
- Tool size: each large script has a test file of similar size, a task, and a document. Each bench harness has a user.
- The 16 Schema builders, `scoped`, `forkScoped`, and `defer`: the website uses them.

Hardening probes that passed (scout F, M):
- Nesting: the parser limit of 512 gives `syntax/009` at every depth up to 100,000, for 13 constructs. No stage throws `RangeError` except PH3.
- Size: 50,000 declarations build in 0.85 s, 20,000 statements in 0.27 s, and a 10 MB string in 0.09 s. Growth is linear.
- Malformed text: a BOM, CRLF, bare CR, NUL, an empty file, and a comment-only file give clean results.
- Configuration and imports: malformed `effektive.json`, wrong field types, `..` and absolute paths, symlink loops, a self-import, a cycle of 1,000 modules, and a chain of 2,000 modules give diagnostics without a crash.
- Determinism: the 5 applications build to 57 byte-equal files from two roots and two working directories.
- LSP: 14 probe groups (malformed frames, bad lengths, deep params, early requests, unknown methods, bad ranges, 500 rapid edits, shutdown without exit, odd URIs) leave the server alive with a correct or sensible response.
- Reserved names: 50 Effect and JavaScript names in 6 positions each give clean `--tsc` output.

The coverage gate fails in a scratch worktree under `~/.claude/scratch/` with "no LCOV record: src/lsp/main.ts", and passes in the main tree under the same load (M, Section 9). The cause is not confirmed. A probable cause is the worktree path, because the child process of the language server writes the only record of `src/lsp/main.ts`. A check is to run the base in a worktree outside a hidden directory.

Low findings that this list does not schedule: a project root that is a file reports "does not exist"; a BOM in `effektive.json` is a JSON error; U+2028 prints raw in a diagnostic; `Option<` at the nesting limit reports 977 type arguments after `syntax/009`.

## 8. Adversarial reviews

Fable and codex astra each reviewed the draft in a separate snapshot at `6ae0538`. Their full reports are in the evidence directory. This table gives the resolution of each finding.

| Finding | Target | Verdict | Resolution |
| --- | --- | --- | --- |
| PHF-F1 | PH1 | wrong change | Accepted: `ignoreBOM: true`, one read site, a BOM test case. |
| PHF-A4 | PH1, PH3 | confirmed | Accepted: `deno_io.ts:106` reads logs. |
| PHF-F5 | PH3 | change too large | Accepted: fix `:95`, and `:112` as a defensive step. |
| PHF-A7, PHF-F16 | PH2 | confirmed | Accepted: the fixture keeps the enclosing function. The cause stays probable until a trace. |
| PHF-A1, PHF-F11 | PH6 | understated, smaller change | Accepted: both measurements and both changes are in PH6. |
| PHF-A15 | PH5 | confirmed | Accepted. |
| PHF-A14, PHF-F10, PHF-F17 | PH4 | confirmed, one site missing | Accepted: the header of `tests/internal_sites_test.ts` is added. |
| PHF-A16, PHF-F12 | PH7 | confirmed with conditions | Accepted: a witness before each test; `check_expr.ts:876-880` leaves the list; `opaque type X` alone. |
| PHF-A3 | PH8 | understated | Accepted: a literal code table and two programs in the IR baseline. |
| PHF-F2 | PH8 | understated | Already met by the pilot: the head builder writes into the exported head tree before both runs. |
| PHF-A8, PHF-F9 | PH9 | confirmed with conditions | Already met by the pilot. |
| PHF-A17, PHF-F8 | PH10, PH12 | confirmed, count | Accepted: 12 sites, 10 in the helper. |
| PHF-A2 | PH11 | wrong change | Partly accepted: `docs/api.md:514` changes too. Not adopted: the option has no caller, and no code outside this repository imports the package. The pilot keeps a fixed key order. |
| PHF-A5, PHF-F4 | PH13 | wrong change | Accepted: PH13 is rejected. |
| PHF-A12 | PH15, PH19 | confirmed with conditions | Accepted: shared steps only, and each order stays. |
| PHF-A13, PHF-F7, PHF-F19 | PH14 | overstated, missing | Accepted: equal groups only, measured first; the `Deno.Command` sites join PH14. |
| PHF-A9, PHF-F15 | PH16 | wrong change, confirmed | The reviewers disagree. Opus rejects PH16: the scripts count different scopes, and the value is two task lines. |
| PHF-A18 | PH17 | overstated | Accepted: the golden count is true. |
| PHF-A10, PHF-F13 | PH18 | false, understated | Accepted: the earlier deletion is complete; the link list is in PH18. |
| PHF-A6 | PHD1 | understated | Accepted: the source break is stated. Option b stays available. |
| PHF-F3 | PHD1 | incomplete change | Accepted: the `using` messages change name, and the extra sites are listed. |
| PHF-A19, PHF-F6 | PHD2 | confirmed, overstated | Accepted: the website and the IR fixture uses are recorded. |
| PHF-A20 | PHD3 | confirmed | Accepted: the claim is limited to the server. PHD3 moves to Section 7. |
| PHF-A21 | PHD4 | overstated | Accepted: `Math.atan2` also shows `-0`. PHD4 moves to Section 7. |
| PHF-A22, PHF-F14 | PHD5 | confirmed, imprecise | Accepted: `docs/logging.md` lists the kinds. PHD5 moves to Section 7. |
| PHF-A11 | PHD6 | wrong change | Accepted: PHD6 moves to Section 7. |
| PHF-F18 | missing | decision | Not adopted as a decision: the file map stays (Section 7). |
| PHF-A23 | missing | prune | Accepted as PH20. |

## 9. Empirical validation

Reproduced by Opus at `6ae0538`, with the probe inputs in `~/.claude/scratch/prune-2026-11-09/`:

| Item | Command | Result |
| --- | --- | --- |
| PH1 | `deno run -A src/cli/main.ts build probe-f2 --no-log` | exit 0, 0 diagnostics, two U+FFFD characters in the emitted string |
| PH2 | `build probe-b1`, then `deno fmt --check m.ts` | build exit 0; fmt reports 1 file not formatted, 3 declarations |
| PH3 | `check probe-f1 --no-log` with 130,000 `@` | exit 3, "Maximum call stack size exceeded" |

Four Sonnet pilots applied items in detached worktrees at `6ae0538` under `~/.claude/scratch/prune-2026-11-09/`. Opus reviewed each diff line by line.

| Pilot | Commit | Net lines (M) | Checks of the pilot (M) | Result |
| --- | --- | --- | --- | --- |
| PH8 | `8e884a8` | fixtures -13,646; scripts +44; tests -47; docs and other -2 | 399 tests of 6 files pass; `behavior_compare_slow_test.ts` 2 pass; `deno task behavior:compare 6ae0538 HEAD` exit 0, 461 records equal, 44 forged records as before | Works. Needs the two oracles of PHF-A3. |
| PH9 | `5382674` | fixtures -155; scripts -4; tests -9; docs +1 | 35 tests of the two coverage test files pass; the runtime set from the new manifest equals the old list of 149 paths | Works. |
| PH10, PH11, PH12 | `088952b`, `73262cd`, `ed9ab24` | -22, -26, -13 | 107, 171, and 195 tests of the named files pass | Works. PH11 needs the `docs/api.md` line. |
| PH13 | none | 0 | `deno check` fails with TS2339 | Rejected. |
| PHD1 (a) | `aadb6b1` | src -55; tests -22; fixtures +72 | 913 tests of 27 files pass; `withResource(...)` gives `unknown-name/001` | Works. Needs the message rename of PHF-F3. |

Opus then ran `deno task check` (format, lint, type check, fast suite, slow suite) in each pilot worktree, one after another, at a load average of 22 to 38 from other projects on the machine:

| Worktree | `deno task check` | Other checks |
| --- | --- | --- |
| PH8 | exit 1: 1 slow test failed, `tests/mutate_slow_test.ts` "each row of the survivor register matches exactly one current site". The pilot moved two anchored rows of `scripts/behavior_compare.ts` (`records` and `<module>`). PHU7 must re-anchor them. | - |
| PH9 | exit 0 | `deno task coverage`: exit 1 twice, "required runtime modules have no LCOV record: src/lsp/main.ts". The unchanged base fails the same way in a scratch worktree (load 43), and passes in the main tree (load 30 to 44). `src/lsp/main.ts` is a runtime module in both manifests. So the change does not cause it. PHU8 runs the coverage gate in the main tree. |
| PH10, PH11, PH12 | exit 0 | `deno task behavior:compare 6ae0538 HEAD`: exit 0, every record equal, 0 changed, 0 missing, 0 added |
| PHD1 (a) | exit 0 | - |

## 10. Units

Each unit starts from local `main`, keeps the rules of the deeper-modules plan (no change to a declaration with a row in `fixtures/mutation/survivors.json`), and ends with `deno task check` on `main`. A unit that changes `src/` also runs `deno task behavior:compare <before> HEAD` and `deno task mutate` on each changed module with register rows. A unit for a defect starts with a test that fails for the reason of the defect.

| Unit | Items | Model | Files | Acceptance | Turn budget |
| --- | --- | --- | --- | --- | --- |
| PHU1 | PH1 | Sonnet | `src/host/deno_io.ts`, a CLI or host test | The new test fails before the fix and passes after it; the BOM case keeps its columns. | 30 |
| PHU2 | PH2 | Sonnet | `fixtures/emit/forms/forms.eff`, `src/core/emit/expr.ts` | `tests/emit_slow_test.ts` fails before the fix and passes after it; the golden files do not change. | 50 |
| PHU3 | PH3 | Opus | `src/cli/build.ts`, a CLI test | A test with more than 130,000 diagnostics exits 1. | direct |
| PHU4 | PH5, PH6 | Sonnet | `src/host/log_schema.ts`, `playground/serve.ts`, their tests | One failing test for each probe of PH6 and for the bad date, then all pass. | 40 |
| PHU5 | PH4, PH17, PH18 | Opus | documents, comments, `tests/internal_sites_test.ts` header | `tests/docs_test.ts` passes. | direct |
| PHU6 | PH7 | Sonnet | tests and error fixtures only | Each new test passes, and the uncovered ranges of PH7 get hits. | 50 |
| PHU7 | PH8 | Sonnet | from pilot `8e884a8`, plus the code table, the IR baseline, and the two re-anchored register rows of `scripts/behavior_compare.ts` | `deno task behavior:compare` equal; `tests/mutate_slow_test.ts` passes. | 30 |
| PHU8 | PH9 | Opus | from pilot `5382674` | `deno task coverage` exit 0. | direct |
| PHU9 | PH10, PH11, PH12, PH20 | Opus | from the pilot commits, plus `docs/api.md:514` and PH20 | Gate and `behavior:compare` equal. | direct |
| PHU10 | PH15, PH19 | Sonnet | `src/lsp/projects.ts`, `src/core/service_bounds.ts`, `src/core/check_expr.ts`, `src/core/contract_origins.ts` | Gate equal; mutate on the two modules; no change of order. | 40 |
| PHU11 | PH14 | Sonnet | `tests/` | The test count stays; net lines are negative. | 40 |
| PHU12 | PHD1 (a), if approved | Sonnet | from pilot `aadb6b1`, plus the message rename; then the website | Gate; website strict checks. | 40 |

Order: PHU1 to PHU4 first (defects), then PHU5 to PHU9, then PHU10 to PHU12. PHU1, PHU2, PHU4, and PHU6 touch different files and can run in parallel worktrees.

## 11. Progress

| Unit | State | Commit |
| --- | --- | --- |
| PHU1 | open | - |
| PHU2 | open | - |
| PHU3 | open | - |
| PHU4 | open | - |
| PHU5 | open | - |
| PHU6 | open | - |
| PHU7 | open | - |
| PHU8 | open | - |
| PHU9 | open | - |
| PHU10 | open | - |
| PHU11 | open | - |
| PHU12 | open | - |
