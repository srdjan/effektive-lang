# Stable base reset plan

Date: 2026-10-30. Base revision: `b2f356d`. Its source, tests, and fixtures equal `45218f3` (v0.10.4). Status: complete on 2026-10-30. Astra validated this plan, and the user approved it on 2026-10-30 with Decision 1 (a) and Decision 2 (a). SB identifies the phases of this plan. SBF identifies its findings.

## 1. Authority and goal

This document is the plan authority for this reset. The user selected it in Decision 1. It holds the findings review, the design, the phases, the verification of each phase, and the progress ledger. When another document disagrees with this plan about reset work, this plan wins. `docs/status.md` stays the authority for the project status and the stopping rule. `docs/architecture.md` stays the reference for the current architecture until a phase changes it.

A second plan exists. `docs/archive/plans/2026-10-30-reset-implementation.md` came from a parallel session and was committed as `b2f356d` during this review. It uses the prefixes RST, RSTF, and RSTD. This plan does not edit that document. Section 4 checks its findings against the source, and this plan adopts the parts that hold, with credit. Only one of the two plans can run, and Decision 1 selected this one.

The goal is a simple and stable base for future work. "Stable" means that the same commit gives the same gate result, and that each refactor has an oracle for each surface. "Simple" means that each decision has one owner, each document states only true facts, and code with no reader is gone. The reset preserves all current functionality. Section 5 lists the three intended changes, and all three are repairs.

The reset adds no feature. Each task must have one of these results: it makes the gate reproducible, closes an oracle gap, removes a nondeterminism, gives a decision one owner, removes unused code, or makes a document true. A task that only moves lines without one of these results is not in the plan.

The planning request authorized this document only, so SB0 unit 3 registered it in `docs/plans/README.md`. Approval of this plan authorizes the phases of section 8 on local `main`, with the scripts that run longer than two minutes (`behavior:capture`, `bench --full`). Approval does not authorize a push, a release, or a push of the website repository.

## 2. Baseline

"Base" means the repository at `b2f356d`. "Scratch copy" means a `git archive` export in `/tmp`, with the patch of a phase applied. No scratch change is in the repository. All numbers are from one Apple machine on 2026-10-30, with Deno 2.9.8. One run is one sample.

| Measure | Value | Command or source |
| --- | --- | --- |
| Full gate at base | exit 1 in 1 min 09 s: 2,676 fast passed, 277 slow passed, 1 slow failed | `deno task check` |
| Full gate, scratch copy with the SB0 patch | exit 0 in 71 s: 2,676 fast and 278 slow passed | `deno task check` |
| Full gate, scratch copy with SB0 unit 1 and SB1 units 1 and 2 | exit 0 in 69 s: 2,676 fast and 278 slow passed | `deno task check` |
| Byte identity at base | exit 0 | section 8 byte identity command, on an export |
| Capture at base | exit 1 after 188 s: the failing slow test stops it | `deno task behavior:capture HEAD HEAD`, on an export |
| Capture, scratch copy with SB0 unit 1 and SB1 units 1 and 2 | exit 0 in 5 min 47 s: 12,544 records on each side, 0 new, 0 missing | `deno task behavior:capture HEAD HEAD`, on an export |
| IR type agreement with the website | exit 0 in both directions | SB9 unit 1 command |
| `src/` | 56,054 lines | `git ls-files src \| xargs wc -l` |
| `src/core` | 119 files, 51,053 lines | `find src/core -name '*.ts' \| xargs wc -l` |
| `tests/` | 234 tracked files, 68,057 lines, 53 slow files | `git ls-files tests \| xargs wc -l` |
| `fixtures/` | 296 tracked files | `git ls-files fixtures \| wc -l` |
| `docs/` | 154 tracked files, of which 99 are in `docs/archive/` | `git ls-files docs \| wc -l` |
| `docs/status.md` | 320 lines (260 when the last reset closed) | `wc -l` and `git show 86d359e:docs/status.md` |
| Slowest slow file | `emit_slow_test.ts`: 51.6 s summed, 91 tests | gate log of the scratch copy |
| Commits since the last reset base | 116 before `b2f356d` | `git rev-list --count 610f7fe..45218f3` |

The two review agents reported these figures, and the main session did not repeat them. Value import cycles: 0. Type-only cycles: 4. Lines of source in the last 15 builtin commits: 3,878 in `src/core` and 7,300 in tests. Validator and checker rejection sites: 209 and 231, with 52 and 4 never fired by the fast suite.

## 3. First principles

The repository must do five things. It must turn Effektive source into checked, typed IR. It must check that IR independently. It must emit Effect-TS from the IR. It must serve the command-line tool, the language server, the VS Code client, and the playground from one core. It must prove each of these.

This structure is sound, and the reset keeps it. The review found no evidence for a new compiler architecture. The stages, the IR contract, and the independent validator give the right boundaries. The cost of a builtin is real semantics on both sides of the oracle (SBF27), so a universal builtin table does not pay.

The weakness is in the base under that structure. Future work needs these seven conditions, and each one fails today:

1. The gate result depends only on the commit. Today, an npm release turned the gate red with no commit (SBF1).
2. A refactor has an oracle on each surface. Today, the capture cannot run at the base, and no oracle compares command-line or language server output between revisions (SBF7, SBF8).
3. The same input gives the same result on each path. Today, a fresh check and an incremental update can disagree (SBF11).
4. The oracle is proven to reject. Today, at least 52 validator rejection sites never fired in a fast test (SBF9).
5. Each decision has one owner. Today, Map and Set checking and the disk session each have split ownership (SBF13, SBF14).
6. Code with no reader is gone, and comments state only true facts (SBF16, SBF17).
7. Each document states only true facts, and a test keeps the important ones true (SBF21 to SBF26).

These invariants hold through the reset. Numbers 1 to 3, 5, and 6 are the invariants of `docs/architecture.md`, and SB9 corrects the wording of numbers 2 and 3.

1. The layers depend only downward.
2. The validator stays an independent oracle. Its deliberate copies of checker rules stay.
3. The typed IR stays the contract, at wire version 7.
4. Emitted text, golden files, and mutation fixtures stay byte-identical.
5. The three package entry points keep their exported names.
6. The path `fixtures/applications/portable-publisher` stays, because the website links to it.

## 4. Findings review

Three reviews collected the evidence. One agent reviewed `src/core`. One agent reviewed `src/cli`, `src/host`, `src/lsp`, the playground, the editor client, `scripts/`, `bench/`, `tests/`, and `fixtures/`. The main session reviewed the documents, reproduced the gate failure, tested the fix on a scratch copy, and rechecked the high findings. The parallel plan is a fourth input. Astra then validated this plan, and section 12 records its findings V1 to V13.

"Confirmed" means that the main session read the source or ran the reproducer. "Reported" means that one review agent measured it and the main session did not repeat it. "Probable" means that the cause is not proven, and the finding names the check that can confirm it.

### Corrections to the inputs

Six claims did not survive the check. They stay here so that a later reader does not repeat them.

- The core review said that the move of `mapOf` and `setOf` widens the context by 28 members. The source does not support this. Lines 1238 to 1506 of `check_expr.ts` use `finish`, `table`, `isError`, `report`, `widen`, `kids`, `fact`, `assignable`, `argInfo`, `tree`, and `fits`, which the three existing interfaces hold. They also use `expr` and the private `show`, and `argInfo({ node })` and `showType` replace those two. The parallel plan is correct here (SBF13).
- The tools review listed every temporary target configuration as a floating dependency. `effect@4.0.5` has no npm dependencies (registry metadata), so a project that imports only `effect` does not float. Only paths through `@effect/platform-node` float, and only `fixtures/host-adapter-files/files-live.ts` uses that package.
- The parallel plan selects an exact root import of `@effect/platform-node-shared` as the first candidate for its RST0a. An entry in `imports` alone does not constrain the graph: probe A still resolved 4.1.0 and failed at run time. A real direct import does constrain it (probe K), but a generated configuration holds no import statement. So RST0a would reach its own stop condition.
- The main session first reported a second capture defect. That report was wrong. The scratch copy had lost three tracked files, because its `git add -A` skipped files that `.gitignore` matches. The real repository tracks them. The trap is real for a contributor (SBF26), but the capture is not broken by it.
- The core review said that the `specialized` field of the `builtin` fact has no reader. No code in the repository reads it. But `CheckedModule` exposes it through the public frontend API, so its removal is a public change. Section 5 does not allow that change, so the field stays.
- A draft of this plan said that exact fixture pins close the application float. A later draft said that a copy of the root lockfile closes it. The probes of SBF3 show that both claims were wrong. An application run with the copy gave 7 passed, but that run could not tell a held version from the newest version.

### Reproducibility

SBF1 (high, confirmed). The gate result depends on the npm registry, not only on the commit. `@effect/platform-node@4.0.5` declares `@effect/platform-node-shared: ^4.0.5`. Version 4.1.0 of that package was published on 2026-10-29 at 03:45 UTC, and it requires `effect@^4.1.0`. `scripts/test_slow.ts:6,18` gives each run an empty `DENO_DIR`, and the temporary project of `tests/cli_slow_test.ts:402` has no lockfile. So a fresh resolution mixes 4.1.0 with `effect@4.0.5`, and the run stops with `ERR_MODULE_NOT_FOUND` for `effect/4.0.5/dist/process/CommandLine.js`. Effect: `deno task check` fails at the base with no code change, so no commit can pass the gate. Disposition: SB0.

SBF2 (high, confirmed). The `--tsc` path ships the same float to users. `src/host/deno_io.ts:131-132` runs `deno check --no-lock` with a generated configuration, and `src/cli/tsc.ts:25-41` pins only the two direct imports. The failing test shows the effect: line 406 builds with `--tsc` and passes, and line 436 then fails at run time. Probes in an empty cache gave these results.

| Probe | Method | Result |
| --- | --- | --- |
| A | `imports` entry for the shared package | exit 1, resolved 4.1.0 |
| C and F | `overrides` in `deno.json`, with a version or an `npm:` specifier | exit 1, resolved 4.1.0 |
| G | `npm.overrides` in `deno.json` | exit 1, resolved 4.1.0 |
| D | `overrides` in `package.json` with `nodeModulesDir: "auto"` | exit 0, resolved 4.0.5, but it needs a `package.json` beside the source |
| I | `deno run --frozen` with a seeded lockfile, no `package.json`, no `node_modules` | exit 0, resolved 4.0.5 |
| J | `deno check --lock=<seed>` without `--frozen`, with an extra npm package in a host module | exit 0, resolved 4.0.5, and nothing written in the project |
| K | a real direct import of the shared package at 4.0.5 | exit 0, resolved 4.0.5, but it needs an import statement |
| L | `deno check --lock=<seed>` without `--frozen`, with a host module that imports `npm:@effect/platform-node-shared@^4.0.5` and `npm:ws@^8` | exit 0, all 14 entries kept, the shared package stayed at 4.0.5, `ws` stayed at 8.22.0, and no entry was added |

Disposition: SB0 seeds the lockfile (probes I, J, and L). The closure has 14 packages. A seeded lock without `--frozen` accepts a host module that imports another package (probe J). A host range that overlaps the closure resolves to the pin, not to the newest version in range (probe L). Section 5 item 1 covers that change.

SBF3 (medium, confirmed). The application fixtures float two packages. The five `fixtures/applications/*/deno.json` files are byte-identical. They declare `jsr:@std/assert@^1`, and their harnesses pass `--no-lock`. `@std/assert@1.0.19` depends on `jsr:@std/internal@^1.0.12` (`deno.lock:30-34`), so an exact pin of the direct package leaves the second package open. Effect: a new release of either package can change the gate with no commit, as in SBF1. These probes ran in an empty cache. Each seed held an older version than the newest one, so each result can tell a held version from a floating one.

| Probe | Method | Result |
| --- | --- | --- |
| M | copy of the root lock, older `@std/internal`, fixture `^1` | `@std/internal` 1.0.12 held, `@std/assert` is the newest on both paths, so it proves nothing for that package |
| N | copy of the root lock, older `@std/assert`, fixture `^1` | not held: resolved 1.0.19 |
| P | copy of the root lock, older `@std/assert`, fixture `@1` | not held: resolved 1.0.19 |
| Q | copy of the root lock, older `@std/internal`, fixture exact `1.0.19` | not held: resolved 1.0.14 |
| R | lock generated from the fixture configuration, older versions of both packages, `--frozen` | both held: 1.0.18 and 1.0.12 for `deno test`, and `deno check` and `deno run` passed |
| S | the lock of probe R, fixture exact `1.0.19`, `--frozen` | exit 1, "The lockfile is out of date" |

The probable cause of N, P, and Q: Deno drops lock entries when the `workspace` section of a lock differs from the configuration. The plan does not depend on this cause, because `--frozen` rejects any difference (probe S). Disposition: SB1 generates one lock from the fixture configuration and uses it with `--frozen`.

SBF4 (medium, confirmed). The gate does not freeze the root lockfile and does not check the Deno version. `deno.json` has no `lock` key, and only `scripts/package.ts:159` freezes it. The golden files depend on `deno fmt` (`tests/emit_slow_test.ts:4107`), but only the packaging path checks the Deno version. Effect: a changed import can rewrite `deno.lock` during the gate, and another Deno version can change the result. Disposition: SB1.

SBF5 (medium, reported). Version facts have sources with no test. The Deno version has one tie (`tests/vscode_client_test.ts:229-237`), and it leaves `editors/vscode/package.json:68` open. The Effect version is in `src/cli/tsc.ts:16`, six fixture `deno.json` files, and `bench/ref_update.ts:7-9`, and `tests/cli_test.ts:351-352` restates it. Effect: a version change can leave stale pins, and the gate does not see them. Disposition: SB1.

SBF6 (medium, confirmed). `README.md:24-26` understates what the gate needs. It says the first test run needs network access "once", but each slow run starts from an empty cache. It lists npm only for the VS Code extension, but `tests/installation_slow_test.ts:28-31` runs `npm ci`, and line 38 runs `unzip`. Effect: a contributor can fail the gate with no clear reason. Disposition: SB1.

### Oracles

SBF7 (high, confirmed). The capture cannot run at the base. `scripts/behavior_capture.ts:301-307` stops when a test fails, and the SBF1 test fails: exit 1 after 188 s. Fixing the head does not repair it, because `git archive` of an older revision still holds the old test. Also, lines 239 to 244 print the last 40 lines of stdout followed by stderr. The `Check` lines fill those 40 lines, so the failing test name is not visible. Effect: the main refactor oracle is unavailable, and its failure does not say why. Disposition: SB0 repairs the output, and each capture uses a base at or after SB0.

SBF8 (high, confirmed). No oracle compares command-line or language server output between revisions. `CONCEPTS.md` says that the capture does not cover this output. `tests/logs_replay_test.ts:1-3` records a session on the current build, so it compares the build with itself. `scripts/logs_replay.ts` skips `--tsc` and watch sessions, and it compares no exit code. The parallel plan found the same gap (its RSTF3). Effect: a refactor can change a message or the order of replies, and only a test that happens to pin that text can see it. Disposition: SB2.

SBF9 (high, reported, sample confirmed). The oracle is not proven to reject. The core review found that 52 of 209 counted validator rejection sites never fire in a fast test, against 4 of 231 in the checker. The largest groups are `validate/expr.ts` (11), `families/scope.ts` (10), `families/effect.ts` (7), and `families/layer.ts` (5). The count is a lower bound, because the search misses `report.add(...)`, and subprocess tests are not fully measured. The main session confirmed three samples: `timeout needs a Duration`, `scheduleExponential needs a Duration base`, and `scheduleMap needs a Schedule and inline callback` have no match in `tests/` or `fixtures/`. Effect: if a checker regression reaches one of these rules, nothing proves that the rule fires. `docs/builtin-changes.md` asks for forged payload tests, and recent work did not always add them. Disposition: SB4.

SBF10 (low, probable). The emitter `ROWS` and validator `exprChildren` differential may not reach every kind. `tests/emit_shape_test.ts` walks only real IR, and a pass over the fixtures lowered 63 of 123 kinds. Today the two tables agree on all 123 kinds. The check that confirms it: count the kinds that `emit_shape_test.ts` visits. Disposition: SB4 compares the exported `childrenOf` with `exprChildren` on the synthetic nodes of `tests/validate_expr_children_test.ts`. This coupling is in a test only, so production stays independent.

### Determinism and robustness

SBF11 (high, confirmed). The proof budget makes a result depend on unrelated modules and on the memo. `db.ts:366` and `check_project.ts:650` create one budget for each project run, and only rechecked modules spend it. A fresh run over `a.eff` with 10,000 proofs and `z.eff` with one proof gives one `type-mismatch/013` ("exceeds the proof limit") on `z.eff`. A `Program` that reaches the same texts by an edit gives 0 diagnostics. A small control gives 0 in both. Effect: a clean language server can disagree with a fresh `check`, and module order decides which module fails. No test holds the text `exceeds the proof limit`. `docs/refinement-measurements.md:31` documents the limit as "per compiler update", so this is a behavior question. Disposition: SB3, under Decision 2.

SBF12 (medium, confirmed). Enough diagnostics in one file crash the compiler. `analyze.ts:40` runs `diagnostics.push(...module.parseDiagnostics)`. With the input `"@ ".repeat(130000)`, `RangeError: Maximum call stack size exceeded` escapes `checkProject`. With 100,000 repetitions, the check returns 100,000 diagnostics. Seven sites use this form for diagnostics (`analyze.ts:40,43`, `check_project.ts:310,400,525,666`, `db.ts:445`). `src/core` has 30 spread pushes in total, and the other 23 are not reviewed. Effect: a large broken file gives a crash and no diagnostics. The likelihood is low. Disposition: SB3.

### Ownership

SBF13 (medium, confirmed). Map and Set checking has two owners. `check_builtins/map_set.ts` owns nine operations. `check_expr.ts:1188-1205` and `1238-1506` own `mapOf`, `setOf`, and seven private helpers, and `registry.ts:20-27` lists both names as core exceptions. The nine helpers and handlers have no caller outside this group. Effect: one change to Map checking crosses the body dispatcher and a family file, and `BodyChecker` keeps about 270 lines that need no private state. The parallel plan found this (its RSTF1), and section 4 confirms it. Disposition: SB5.

SBF14 (low, confirmed). The disk session has five separate fields. `src/lsp/projects.ts:86-97` declares `diskProgram`, `diskOutputs`, `diskInputs`, `diskModules`, and `heldReasons`, and `saveRound` (lines 453 to 501) uses them together. Only `tests/lsp_save_round_test.ts:380` reads one from outside. Effect: the type does not state that the five fields form one session, so a reset of one field can leave the others stale. No save defect is shown. The parallel plan found this (its RSTF2). Disposition: SB6.

SBF15 (low, confirmed). The IR contract imports its proof types from the solver. `ir.ts:1` imports `Predicate` and `ProofCertificate` from `predicates.ts`, and this is one of the four type-only cycles. The core review said that a move of these types removes the type-only exception in the validator import rule. That is not true, because `validate/predicates.ts:2-7` also imports `SolverLimits`. The last reset declined to break type-only cycles, because they have no runtime effect, and that reason stands. Disposition: declined, section 9.

### Unused code and comments

SBF16 (low, confirmed). Code with no reader. `lower.ts:628` `functionOf` has no caller, and its return type `FunctionNode` at `lower.ts:81` has no other use. Four exports have no importer in `src`, `tests`, `bench`, `scripts`, or `playground`: `ScheduleContext` (`check_builtins/schedule.ts:20`), `OutcomeNames` (`emit/scope.ts:266`), the `SourceEdit` re-export (`editor_rename.ts:19`), and `Fixture` (`scripts/validate_fixtures.ts:16`). The first two have uses in their own files, and `Fixture` has none. Disposition: SB7.

SBF17 (low, confirmed). Stale comments. About 20 comment lines in `src/core` cite old plan numbering, such as "plan section 5.3" and "part A7". `emit/shape.ts:5-6` names the wrong file for `exprChildren`. Disposition: SB7. The word "nominal" on 31 avoidable lines is a separate matter, and section 9 declines those renames.

SBF18 (low, reported). One real same-side duplicate. The option-field walk at `check_builtins/effect.ts:199-212` and `558-571` repeats 13 exact lines. The duplication survey found about 1 to 2 percent exact clones in each stage. Most of them are exhaustive `case` lists that force a compile error on a new kind. Those stay. Disposition: SB7, this one pair only.

### Tests

SBF19 (medium, confirmed for the timing). `emit_slow_test.ts` sets the wall time of the slow suite. It has 5,591 lines, 91 tests, and 51.6 s of summed time, and the next file has 19.3 s. In the tools review log, the last 63 of 278 completions were all from this file. The slow suite runs in parallel by file, so one large file is the critical path. The last reset declined test file splits because a split saves no time. That reason held for `check_body_test.ts`, which is fast, and the suite was not parallel at that time. So this one file is reopened. The saving is not measured. Disposition: SB8.

SBF20 (medium, reported). Duplicated test helpers. `compileAndRun` has 16 definitions, of which 11 fall in two identical groups, and `diagnosticsOf` has 18, of which 13 fall in two identical groups. `tests/target_helpers.ts:21` already offers a shared entry. Tests add 1.9 lines for each line of core in recent builtin work, so this helper cost repeats on each feature. Disposition: SB8.

### Documents

SBF21 (medium, confirmed). The IR copy claim is false in four documents, and nothing guards the two files. `docs/architecture.md:57` and `docs/api.md:12` say that `ir.ts` is a copy of the sibling. `docs/builtin-changes.md:16` calls it the canonical copy from the sibling. `docs/development.md:114` says it stays as it is in the sibling. The files differ by 430 diff lines. `ir.ts:3` gives the true direction: the website publishes a standalone copy. The core review found equal `Type` and `Expr` members, and the type assignment check passes in both directions. The parallel plan found the drift and wrote that check (its RSTF11). Effect: an agent can copy the wrong file in the wrong direction. Disposition: SB9.

SBF22 (low, confirmed). Invariant 2 and the layering table omit real shared code. `docs/architecture.md:45` omits `cron.ts`, and invariant 2 says that the validator shares no code with the checker. `tests/validate_test.ts:1613` allows `cron.ts`, and `CONCEPTS.md` describes the exception. Disposition: SB9.

SBF23 (medium, confirmed). The changelog and the release path are behind. `deno.json` says 0.10.4, but `CHANGELOG.md` has no 0.10.4 section. None of `timeout`, `sleep`, `repeat`, `scheduleCron`, `Duration`, `Instant`, `randomInt`, `mapOf`, `uninterruptible`, or `Defect` occurs in it. The repository has no release tag and no written release steps. Disposition: SB9.

SBF24 (medium, confirmed). `docs/status.md` grew again. It has 320 lines, up from 260 when the last reset closed. The largest section is the Effect feature table, at 61 lines. Thirteen of its 24 rows are done, one more is half done, and `docs/language-rules.md` already holds those rules. Two rows of "Open items" need no person: "Rederive review" ends with "No item has an owner", and "Measured numbers" names no action. Effect: the file that should show the current state holds finished history. Disposition: SB9.

SBF25 (low, confirmed). Smaller document drift. `CONCEPTS.md` ("Prelude table") says that the checker keeps two tables, but `check_builtins/rows.ts` has one row with a prologue and a handler. `docs/api.md:924-1018` holds migration and IR version history. `README.md:106` and `docs/development.md:59` use history labels such as "Phase A" and "parts A8 and L5". `docs/release-measurements.md` dates from 2026-10-21, and `docs/architecture.md:120` asks for a new run when the core changes. Disposition: SB9.

SBF26 (low, confirmed). Two contracts are not written down. First, `.gitignore` ignores `fixtures/**/*.ts`, and three tracked files match that rule (`git ls-files -ci --exclude-standard`). A new hand-written fixture is silently untracked, so tests pass locally and fail under `git archive`. Second, only `build --validate` runs the validator. The language server and the playground do not. Disposition: SB9 documents both.

### Builtin edit cost

SBF27 (no defect, reported). No single-table builtin design pays. The core review measured 15 builtin commits: 3,878 core lines, with 37.3% in the checker, 30.2% in the validator, 15.7% in the emitter, and 4.8% in lowering. Mechanical lines are 245 of 3,878 (6.3%). A name-to-fact derivation removes 1.0%, field-list lowering 0.5%, and family dispatch registries 1.7%. A shared child table removes 2.5%, but it breaks invariant 2. The old count of four edit sites is too low: the smallest case touches 11 core files. The conclusion of the last reset stands. Disposition: declined, section 9. SB9 corrects the worked text in `docs/builtin-changes.md` if it states a count.

### Found during execution

SBF28 (medium, confirmed, not fixed). `build --validate` rejects a program that the checker accepts. SB4 unit 4 found this case. With `type Int = int`, take `withFiber(defer(() => 1), (fiber: Fiber<Int, never>) => 1)`. The parameter lowers as `named type:m#Int`, and the child result lowers as `primitive int`. The function `same` at `validate/typing.ts:704` compares name signatures, so `validate/families/fiber.ts:43` reports `validation/002`.

Observed results: `check`, `build`, and `build --tsc` exit 0 on that program, and only `build --validate` exits 1. The bare callback `(fiber) => 1` passes all four. A child whose declared result is `Int` also passes. `Fiber<int, never>` fails with `declaration/013`, so a literal child has no annotation that validates. The other 26 `same` calls in `src/core/validate/` have no test for this condition.

Disposition: this plan does not change the rule. A fix changes an observable result outside section 5. A fix also needs a language decision: the checker or the validator is wrong. `docs/status.md` holds the open item.

### Areas that stay as they are

The reviews looked at these areas and found no reason to change them.

- `Program` invalidation and cutoff. The core review compared seven cross-module scenarios and 194 mutations on the five applications with a fresh run. Only the budget of SBF11 leaks.
- Entry order. Reversing it gave identical diagnostics, IR, and text on all five applications.
- Input robustness. 60,000 mutated programs gave 0 throws, apart from SBF12.
- All 81 diagnostic codes have a reporter and a test or fixture. All 115 fact kinds have a reader.
- The checker and validator copies, `ROWS` and `exprChildren` as separate tables, and the flat dispatch functions.
- The three public entry points, `Program`, `Revision`, and `TypeScriptOutputs`.
- The host output boundary. `src/host/save_round.ts:20-26` encodes two removal policies on purpose.
- The packaged artifacts, the offline installation test, the reproducible ZIP, and `npm ci`.
- The `logs:replay` engine, the log writer, and each log kind.
- The fixture directory layout. No orphan fixture was found.
- `check_body_test.ts` and `validate_test.ts` as single files. A split saves no time.

## 5. Preservation contract

The parallel plan wrote a good preservation table, and this one follows it.

| Surface | What stays equal | Oracle |
| --- | --- | --- |
| Source language | Accepted forms, rejected forms, recovery, type identity, inferred inputs, refinement rules | Error fixtures, parser and checker tests, application tests, capture |
| Diagnostics | Codes, messages, severity, order, spans | Error fixtures, surface snapshot (from SB2), capture |
| Typed IR | Wire version 7, node shapes, annotations, proofs, interface hashes | `tests/ir_snapshot_test.ts`, mutation fixtures, capture |
| TypeScript output | Exact text, companion modules, source maps, span tables | Golden files, strict target tests, capture |
| Public library | Exported value and type names, result variants, lazy queries | `tests/core_boundary_test.ts`, public API tests |
| Command line | Flags, exit codes, stdout, stderr, write order, watch behavior | `tests/cli_test.ts`, surface snapshot, slow tests |
| Language server | Replies, order, diagnostics, save behavior, retry rules | `tests/lsp_*`, surface snapshot, disk session trace |
| Playground | Editing, diagnostics, hover, stale labels, replay | Facade, model, and replay tests |
| Logs and replay | Event names, envelope, order, blob retention, replay exclusions | Log, wire log, report, and replay tests |
| Packaging and applications | Entry points, VSIX contents, offline installation, application results | Installation and application slow tests |

These three changes are intended. Each is a repair, and each has its own test. No other observable change is allowed.

1. `build --tsc` resolves the pinned closure of the target, not the newest versions in range (SB0). This also applies to a host import whose range overlaps the closure (probe L).
2. A file with very many diagnostics returns them and does not crash (SB3).
3. Under Decision 2 (a), the proof budget belongs to one module, not to one run (SB3).

## 6. Inherited open items

| Item | Source | Disposition | Reason |
| --- | --- | --- | --- |
| FR1 to FR7 (log findings) | `docs/archive/plans/2026-10-26-self-improvement-loop.md` | Stay deferred | The user chose to wait for real session logs. A ranking from a reset review would replace that choice. |
| Item 9 (broader package interoperability) | `docs/status.md` | Stays deferred by the user | Only the user can reopen it. |
| TCM (TypeScript content mappers) | `docs/plans/2026-10-24-typescript-content-mappers.md` | Stays deferred by the user | Only the user can reopen it. |
| Metrics (item 16) and sort (item 24) | `docs/status.md` | Stay candidates | These are features. The reset adds no feature. |
| Hand test of the VS Code client | `docs/status.md`, open items | Stays with the user | Manual acceptance. |
| Playground acceptance | `docs/status.md`, open items | Stays with the user | Manual acceptance. |
| "Rederive review" and "Measured numbers" rows | `docs/status.md`, open items | Removed in SB9 | Neither row names an action for a person. |

## 7. Design after the reset

The compiler stages do not change. The base under them does.

The gate depends only on the commit. One committed lockfile, `src/cli/target_lock.json`, pins the closure of the Effect target, and `deno check` seeds its temporary lock from it. A second committed lockfile, `tests/application_lock.json`, pins the graph of the application fixtures, and their harnesses use it with `--frozen`. The root lockfile is frozen. A test ties each version pin to its source.

Each surface has a refactor oracle. The capture covers core results. A new surface snapshot, `fixtures/surface/`, covers command-line text and language server replies. Its update task follows the pattern of `golden:update`. A short ordered trace pins the disk session. A new task lists validator rejection sites that no test fires.

A module result depends only on the module text and its dependency interfaces. Under Decision 2 (a), each module has its own proof budget.

In the core, `check_builtins/map_set.ts` owns all Map and Set checking, and `Some` is the one core row. In the language server, one `DiskSession` object owns the disk state, and it stays separate from the overlay program.

The documents state the true direction of `ir.ts`, and a slow test checks type compatibility with the website. `docs/status.md` holds the current state and open candidates only. `CHANGELOG.md` matches `deno.json`, and a test keeps them equal.

## 8. Phases

### Rules for every phase

Work on local `main`. Make one commit for each unit. Run `deno task check` before each commit, and test its exit status, not the exit status of a pipe. Do not run `golden:update`, `validate:update`, or `surface:update` to make a test pass. In this shell, `grep`, `diff`, `du`, and `curl` are aliases, so write `command grep`, `command diff`, and `command rm -f`.

Before a phase starts, record its entry commit in section 13 as the full SHA. That SHA stays the phase base through all attempts and corrections, so that a correction cannot hide the first behavior change. The parallel plan's validator found this rule.

For each phase that changes `src/`, run the capture from SB0 onward:

```sh
deno task behavior:capture <phase-base> <phase-head>
```

Read the report even when it exits 0. New records must come only from tests that the phase adds, and missing records must be 0. One exception exists: up to two new or missing clean `program` records (result `[]`) can be run variance (`docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`). If such a record appears, run the capture again with the same phase base, and confirm that the record does not repeat. Any other difference stops the phase. If a phase moves or renames tests, hold the test set constant with the procedure in the same document. The capture exceeds two minutes, so run it in the background.

For each phase that changes the checker, lowering, or the emitter, prove byte identity:

```sh
deno task golden:update && deno task validate:update && git diff --exit-code fixtures/
```

This command must print nothing and exit 0. From SB2 on, add `deno task surface:update` before the `git diff`. If a file changes, discard the change with `git checkout -- fixtures/` and fix the code.

The model names follow `AGENTS.md`, and they apply when Claude Code orchestrates. If Codex executes, use the model names in the global instructions of Codex. Opus orchestrates, reviews each diff line by line, and runs each verification command itself. Sonnet executes each unit through the `sonnet-implementer` agent, unless the unit table says Opus. A turn budget is a limit. An executor that reaches it stops and hands back its status and open items. Each dispatch carries the unit text, the finding text, and the rules above. If verification fails twice for one cause, ask Fable or Astra for advice before the next attempt.

### SB0. Reproducible target and working capture

Goal: restore a passing gate and a working capture, with no change to the Effect target (SBF1, SBF2, SBF7).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Target lock | Sonnet | `src/cli/target_lock.json` (new), `src/cli/tsc.ts`, `src/host/io.ts`, `src/host/deno_io.ts`, `bench/m5.ts`, `tests/cli_test.ts`, `tests/cli_slow_test.ts`, `docs/development.md`, `docs/api.md` | Gate exit 0 | 30 |
| 2. Capture failure text | Sonnet | `scripts/behavior_capture.ts`, `tests/behavior_capture_test.ts` | Fast test passes, capture exit 0 | 15 |
| 3. Authority | Opus | `docs/plans/README.md`, `docs/status.md`, this plan, the parallel plan (move only) | `tests/docs_test.ts` passes | 5 |

Unit 1. The existing test at `tests/cli_slow_test.ts:402` already fails for this bug, so it is the failing test that the fix must turn green. Do not weaken it.

Generate the lockfile in an empty temporary directory, in these steps:

1. Write a `deno.json` with `"nodeModulesDir": "auto"` and the two entries of `TARGET_IMPORTS`.
2. Write a `package.json` with `{ "overrides": { "@effect/platform-node-shared": "4.0.5" } }`.
3. Write `a.ts`, which imports `NodeFileSystem` from `@effect/platform-node` and `Effect` from `effect`.
4. Run `deno run --allow-read --allow-env --config deno.json a.ts`.
5. Delete the key `workspace.packageJson` from the new `deno.lock`, and save the file as `src/cli/target_lock.json`.
6. Run `deno fmt src/cli/target_lock.json`.

The `npm` section must have 14 entries, and it must name `effect@4.0.5`, `@effect/platform-node-shared@4.0.5_effect@4.0.5`, and `@effect/platform-node@4.0.5_effect@4.0.5_redis@6.3.1`. The other 11 are the transitive packages at their versions on the day of generation.

Then make these changes. The scratch copy holds the same patch, and its gate passed.

- In `src/cli/tsc.ts`, import the JSON file and add `tscLock(): string`, which returns its text with a final newline. Pass `lock: tscLock()` to `io.denoCheck`.
- In `src/host/io.ts`, add `readonly lock: string` to `DenoCheckRequest`.
- In `src/host/deno_io.ts`, write the lock to `${directory}/deno.lock`, and replace `--no-lock` with `--lock=${lock}`. Do not add `--frozen`, because a host module can import another npm package (probe J).
- In `bench/m5.ts:81`, pass `lock: tscLock()`.
- In `tests/cli_slow_test.ts`, in the test at line 402, also write `deno.lock` from `tscLock()`, and add `--frozen` to the `deno run` arguments.
- Add a fast test in `tests/cli_test.ts` that parses `request.lock` and asserts the literal `specifiers` object and the literal key `@effect/platform-node-shared@4.0.5_effect@4.0.5`.
- Add a slow test in `tests/cli_slow_test.ts`: a host module that also imports `npm:ms@2.1.3` builds with `--tsc` and exit 0. It proves that the seed does not reject another package.
- Add a second slow test in `tests/cli_slow_test.ts` for a range that overlaps the closure. Write `tscConfig()` and `tscLock()` to a temporary directory. Run `deno check --lock=deno.lock` on a host module that imports `npm:@effect/platform-node-shared@^4.0.5` and `npm:ws@^8`. Then read the lock. Assert 14 package entries, the literal key `@effect/platform-node-shared@4.0.5_effect@4.0.5`, and integrity values equal to those of `tscLock()`.
- In `docs/api.md:635` state the pin and its limit: `--tsc` checks with the pinned closure, an overlapping host range resolves to the pin, and a user's own `deno run` needs its own lockfile. In `docs/development.md`, add the six generation steps, and state that a change of `EFFECT_VERSION` needs a new lockfile.

Do not change `fixtures/`, `src/core/`, `EFFECT_VERSION`, or the emitted text.

Unit 2. Print stderr first and stdout last, so that the failure summary stays in the last 40 lines. Extract one exported pure function for the text, and give it one fast test with literal input. Keep the output limit.

Unit 3. Under Decision 1 (a): add registry rows for SB and SBF, and for RST, RSTF, and RSTD. Move the parallel plan to `docs/archive/plans/` with `git mv`, and add one line under its title that names this plan as the selected authority. Add one row to the open items of `docs/status.md` that names this plan. Run unit 3 last, because a commit needs a passing gate.

Preserve: all emitted text, all IR, all diagnostics, and all command-line flags.

Verify:

```sh
deno test --allow-read tests/cli_test.ts tests/behavior_capture_test.ts
deno task test:slow --filter 'a typed FileSystem host adapter builds and maps package failures'
deno task golden:update && deno task validate:update && git diff --exit-code fixtures/
git diff --exit-code 45218f3 -- src/core fixtures
deno task check; echo "exit=$?"
deno task behavior:capture HEAD HEAD
```

The filtered slow run passes 1 test in a fresh `DENO_DIR`. Both `git diff` commands print nothing. The gate prints `exit=0`. The capture exits 0. Record its record count, its time, and its new and missing counts in section 13. In the scratch run, both counts were 0. The base `45218f3` cannot serve as a capture base, so the literal test and the gate prove this phase.

### SB1. Frozen locks and true requirements

Goal: close the rest of the floating inputs, and state what the gate needs (SBF3 to SBF6).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Application lock | Sonnet | `tests/application_lock.json` (new), `tests/application_slow_test.ts`, `tests/application_integration_slow_test.ts`, `tests/application_publisher_integration_slow_test.ts`, `docs/development.md` | Gate exit 0 | 8 |
| 2. Frozen root lock | Sonnet | `deno.json`, `docs/development.md` | Gate exit 0 | 5 |
| 3. Version table test | Sonnet | `tests/versions_test.ts` (new), `tests/cli_test.ts` if a literal moves | Fast test passes | 15 |
| 4. Requirements text | Sonnet | `README.md`, `docs/development.md` | `tests/docs_test.ts` passes | 5 |

Unit 1. Do not change the five fixture configurations. Generate the lockfile in an empty temporary directory, in these steps:

1. Copy `fixtures/applications/order-lifecycle/deno.json` to `deno.json`.
2. Write `a.ts`, which imports `Effect` from `effect` and `assertEquals` from `@std/assert`.
3. Run `deno cache a.ts`.
4. Save the new `deno.lock` as `tests/application_lock.json`.
5. Run `deno fmt tests/application_lock.json`.

Then change the three harnesses. Copy `tests/application_lock.json` to `${dir}/deno.lock` before the first `deno` subprocess. Replace each `--no-lock` with `--frozen`. A later change to a fixture configuration then fails with "The lockfile is out of date" (probe S). In `docs/development.md`, add the five steps, and state that such a change needs a new lockfile.

Unit 2. Add `"lock": { "path": "./deno.lock", "frozen": true }` to `deno.json`. In `docs/development.md`, state how to change a dependency on purpose: run `deno install --frozen=false`, and commit the new lockfile.

Unit 3. Add one fast test with a table of literal rows. Each row gives a file and the exact text that it must hold. Cover `editors/vscode/package.json`, the six fixture `deno.json` files that pin Effect, `bench/ref_update.ts`, and `README.md`. Add one test that asserts `Deno.version.deno` equals `REQUIRED_DENO_VERSION`.

Unit 4. State in `README.md` that each slow run needs network access, because it starts from an empty cache. State that `deno task check` needs npm and `unzip`.

Verify:

```sh
command grep -n -e '--no-lock' tests/application*_slow_test.ts   # no output
deno test --allow-read tests/versions_test.ts tests/docs_test.ts
deno task check; echo "exit=$?"
git status --short deno.lock tests/application_lock.json         # no output
```

Then make two temporary edits, one at a time. First, change the Effect version in one fixture configuration, run `deno test --allow-read tests/versions_test.ts`, and see it fail. Second, change `@std/assert` to `jsr:@std/assert@1.0.19` in one fixture configuration, run `deno test --allow-all tests/application_slow_test.ts`, and see the text "The lockfile is out of date". Restore the file with `git checkout` after each edit. No capture is needed, because no `src/` file changes.

### SB2. Surface oracle

Goal: give the command-line tool and the language server a refactor oracle before any phase touches them (SBF8).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Surface snapshot | Sonnet | `tests/surface_cases.ts`, `tests/surface_test.ts`, `scripts/surface_update.ts`, `fixtures/surface/cli.json`, `fixtures/surface/lsp.json`, `deno.json`, `docs/development.md`, `docs/api.md` | Fast test passes, negative checks fail | 35 |
| 2. Disk and watch traces | Sonnet | `tests/save_round_contract_test.ts` | Fast test passes | 25 |
| 3. Glossary | Opus | `CONCEPTS.md` | `tests/docs_test.ts` passes | 3 |

Unit 1. `tests/surface_cases.ts` holds a literal list of command-line cases and a runner. The runner calls `main(args, io)` with the memory ports of `tests/cli_helpers.ts`, inside one ordered event recorder. The recorder adds one event for each stdout write, stderr write, file write, file removal, and failure. A file event holds the path and the SHA-256 of its text. The runner records `{ args, code, events }`. Separate `stdout` and `stderr` arrays lose the order between streams, and a final file map loses repeated writes, so the records do not use them.

The cases cover `check`, `build`, and `build --validate` over `fixtures/examples`; `check` over each entry of `fixtures/errors/` (a census, which the test rules permit); and the usage cases: no arguments, `--help`, an unknown command, a missing project, and an unknown flag. Keep times, session IDs, and absolute temporary paths out of the records.

The language server part drives `tests/lsp_helpers.ts` through one scripted session, and it records each message out in order. The session sends valid parameters for each of the 22 methods that `src/lsp/server.ts` handles:

- Requests (13): `textDocument/hover`, `textDocument/references`, `textDocument/prepareRename`, `textDocument/rename`, `textDocument/completion`, `textDocument/signatureHelp`, `textDocument/semanticTokens/full`, `textDocument/codeAction`, `textDocument/inlayHint`, `textDocument/definition`, `textDocument/documentSymbol`, `effektive/generatedTypeScript`, `effektive/stats`.
- Notifications (5): `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didClose`, `textDocument/didSave`, `workspace/didChangeWatchedFiles`.
- Lifecycle (4): `initialize`, `initialized`, `shutdown`, `exit`.

Add one case for an unsupported request and one case for an ignored notification.

`scripts/surface_update.ts` writes the two fixture files, and the task `surface:update` runs it. This is the pattern of `golden:update`. `tests/surface_test.ts` compares the current records with the files, with read permission only. Each test must run in under one second. If the census exceeds that, split it into one test for each error category. Add the script to the file map in `docs/api.md`, and add the task to `docs/development.md`. `tests/docs_test.ts` fails without the file map entry.

Unit 2. Add the fixed traces that the parallel plan designed in its RST1. They use literal expected values, in-memory failure controls, and no elapsed-time wait.

- Watch removal: run `main` in watch mode, remove a generated module, fail its removal, permit removal, and edit a source. Assert the exit code, the order of stdout and stderr, and the final files. This pins the forget policy.
- Disk recovery: open two documents, leave one overlay unsaved, save valid disk text, break the configuration, repair it, and save. Assert the diagnostics, the log messages, and the generated bytes.
- Disk removal retry, in eight saves: (1) save valid sources, delete one source, block its removal, and save; (2) break a surviving module and save; (3) save with no edit; (4) break the configuration and save; (5) repair only the configuration and save; (6) permit removal and save; (7) repair the module and save; (8) break it again and save.

After each save, assert the pending deletion and the held reason. Step 3 retries the deletion and repeats no held message. Step 5 retries with no new held message. Step 7 clears the reason, and step 8 reports it again.

Unit 3. Update "Behavior capture" in `CONCEPTS.md`, and add "Surface snapshot".

Preserve: no `src/` file changes in this phase.

Verify:

```sh
deno test --allow-read tests/surface_test.ts tests/save_round_contract_test.ts
deno task surface:update && git diff --exit-code fixtures/surface
git diff --exit-code <SB2 base> HEAD -- src
deno task check; echo "exit=$?"
```

The expected values come from the base of this phase, and the reviewer reads them against the current code. A second `surface:update` run must change nothing, so the records are deterministic. Then make three temporary edits, one at a time: change one command-line message, change one exit code, and swap the order of two replies. Run `tests/surface_test.ts` after each edit, see it fail, and restore the file. Record the three results in section 13.

### SB3. One result for one input

Goal: remove the crash and the nondeterminism (SBF11, SBF12).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. No spread of diagnostics | Sonnet | `src/core/analyze.ts`, `src/core/check_project.ts`, `src/core/db.ts`, one new test file | Test failed first, then passes | 12 |
| 2. Proof budget of one module | Sonnet | `src/core/db.ts`, `src/core/check_project.ts`, `src/core/check_refinements.ts`, one new test file, `docs/refinement-measurements.md`, `docs/language-rules.md` if it states the limit | Test failed first, then passes | 15 |

Unit 1. First write a test with the input `"@ ".repeat(130000)` that calls `checkProject`, and see the `RangeError` at `analyze.ts:40`. Then replace the spread at the seven sites of SBF12 with a loop or `concat`. Read the other 23 spread pushes, and record in section 13 which ones have a bounded size. Change only a site whose size depends on input. The diagnostic order must stay equal. Put the test in a `*_slow_test.ts` file if it exceeds one second.

Unit 2, only under Decision 2 (a). First write a test with the two-module program of SBF11, and see that a fresh `checkProject` gives one diagnostic while `Program` gives 0. Then remove the shared budget at `db.ts:366,395` and `check_project.ts:650`, so that the default at `check_project.ts:596` gives each module its own budget. The test then asserts 0 diagnostics on both paths. Add a second test: one module above the limit gives `type-mismatch/013` on both paths, with the same message. Update `docs/refinement-measurements.md:31` to "per module". This matches the direction of the validator, which already gives each declaration its own allowance (`validate/index.ts:72-74`, `docs/refinement-measurements.md:55`). The aggregate constant stays 100,000. Under option (b), skip this unit, and add a test that records the current difference with a comment that names SBF11.

Preserve: the diagnostic order, and every result of a program under the limit.

Verify:

```sh
deno test --allow-read tests/refinement_proofs_test.ts tests/refinement_validation_test.ts
deno task golden:update && deno task validate:update && deno task surface:update && git diff --exit-code fixtures/
deno task check; echo "exit=$?"
deno task behavior:capture <SB3 base> HEAD
```

Read the capture under the rule of section 8. Before unit 2 merges, run a fresh check, the five applications, and the existing refinement tests, and confirm that no diagnostic count changes.

### SB4. Prove that the oracle rejects

Goal: each validator rejection site has a test that fires it, or a recorded reason (SBF9, SBF10). This phase adds tests and one script. It changes no validator rule.

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Unfired site list | Sonnet | `scripts/rules_unfired.ts`, `deno.json`, `docs/builtin-changes.md`, `docs/development.md`, `docs/api.md`, `tests/rules_unfired_test.ts` | Task prints the list, list in section 13 | 15 |
| 2. Core and scope rows | Sonnet | `tests/validate_rejections_test.ts` | Each row fires its site | 25 |
| 3. Effect, schedule, and layer rows | Sonnet | `tests/validate_rejections_test.ts` | Each row fires its site | 25 |
| 4. Remaining families | Sonnet | `tests/validate_rejections_test.ts` | Each row fires its site | 20 |
| 5. Child table comparison | Sonnet | `tests/validate_expr_children_test.ts` | Fast test passes | 8 |

Unit 1. The task `rules:unfired` runs the fast suite with `--coverage` into a temporary directory. It reads `deno coverage --lcov` for `src/core/validate/`. It prints each uncovered line that reports a rejection, including `report.add(...)`. It starts with a pure function that parses the lcov text, and that function has a fast test with literal input. Add the script to the file map in `docs/api.md`, and add the task to `docs/development.md`. Record the first output in section 13. This list replaces the figure 52, which is a lower bound.

Units 2 to 4. Add one table row for each site on the list: a forged IR payload and the literal expected code, path, and message. Use the existing `forged` helper. A row must fail if the site is deleted. If forging cannot reach a site, because an earlier check always fires first, do not delete the site. Record the reason in section 13, and name the earlier check. A dead rule needs a separate user decision.

Unit 5. `ROWS` is private to `src/core/emit/shape.ts`, and this phase changes no source. So reuse the synthetic node of each kind in `tests/validate_expr_children_test.ts`, and compare the exported `childrenOf()` with `exprChildren()` for all 123 kinds. Compare the two results as multisets of node identities, with the existing `identityCounts` helper. A child can occur twice, so a set is not enough. If a kind gives a different order, record that kind and its reason in section 13. Only the test imports both functions.

Verify:

```sh
deno task rules:unfired                                   # every remaining line has a reason in section 13
deno test --allow-read tests/validate_rejections_test.ts tests/validate_expr_children_test.ts
git diff --exit-code <SB4 base> HEAD -- src
deno task check; echo "exit=$?"
```

Then delete three rejection sites in a scratch edit, one from each of units 2, 3, and 4. Run the test after each deletion, see it fail, and restore the file. Record the results. Add one line to the verification section of `docs/builtin-changes.md`: run `rules:unfired` before a builtin plan closes.

### SB5. One owner for Map and Set checking

Goal: `check_builtins/map_set.ts` owns all Map and Set checking (SBF13). This phase moves code, with one substitution each for `expr` and `show`.

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Move the constructors | Sonnet | `src/core/check_expr.ts`, `src/core/check_builtins/map_set.ts`, `src/core/check_builtins/registry.ts`, `docs/builtin-changes.md` | Capture and byte identity pass | 20 |

Move the two rows `mapOf` and `setOf` into `MAP_SET_ROWS`, with the same prologues: `direct(1, "pure", { fact: ... })`. Move `mapOfCall`, `setOfCall`, `expectedMap`, `expectedSet`, `pairParts`, `isListLiteral`, `joinTypes`, `requireInferredData`, and `inferPairs` to `map_set.ts` as functions over a context. The context combines `BuiltinContext`, `SyntaxView`, and `FactWriter`. Replace `this.expr(node)` with `c.argInfo({ node })`, which calls `expr` when `pre` is absent (`check_expr.ts:606`). Replace `this.show(ref)` with `showType(c.table, ref)`.

Remove both names from `CoreRowName` and `CORE_ROW_NAMES`. Update `FamilyContext` if the type needs it. Update the header comment of `map_set.ts`, which says that these names sit in the body checker. Remove imports that lose their last use. Keep every call order, expected type, fact write, span, and recovery result. Do not expose `BodyChecker`, and do not add a callback framework. If the move needs another private member, stop and hand back.

Verify:

```sh
deno test --allow-read tests/map_set_ops_test.ts tests/map_set_types_test.ts tests/builtin_rows_test.ts tests/builtin_arity_test.ts tests/surface_test.ts
command grep -n 'mapOf\|setOf' src/core/check_builtins/registry.ts      # no output
deno task golden:update && deno task validate:update && deno task surface:update && git diff --exit-code fixtures/
deno task check; echo "exit=$?"
deno task behavior:capture <SB5 base> HEAD                              # section 8 rule
git diff --exit-code <SB5 base> HEAD -- tests fixtures deno.json deno.lock src/core/ir.ts
```

### SB6. One owner for the disk session

Goal: one object owns the disk state of a language server project (SBF14). This design comes from the parallel plan, and its validator confirmed that the design keeps lazy creation and the order of mutations.

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. `DiskSession` | Sonnet | `src/lsp/projects.ts`, `docs/architecture.md` | Traces, capture, and snapshot pass | 15 |

Define a local `DiskSession` interface in `src/lsp/projects.ts`, with the fields `program`, `outputs`, `inputs`, `modules`, and `heldReasons`. `ProjectState` owns one optional session. `saveRound` creates it at the point where `diskProgram ??=` runs today, after the `writeOnSave` and workspace read checks. Keep a read-only `diskProgram` getter, which returns the program of the session or `undefined` and allocates nothing, because `tests/lsp_save_round_test.ts:380` reads it. Advance `inputs` and `modules` at their current points. Keep the order on a configuration failure. Do not touch the overlay `ProjectPhase`, the query caches, or the protocol.

Verify:

```sh
deno test --allow-read tests/lsp_save_round_test.ts tests/lsp_project_state_test.ts tests/save_round_contract_test.ts tests/surface_test.ts
deno task surface:update && git diff --exit-code fixtures/surface
deno task check; echo "exit=$?"
deno task behavior:capture <SB6 base> HEAD                              # section 8 rule
git diff --exit-code <SB6 base> HEAD -- tests fixtures deno.json deno.lock src/core
```

The reviewer compares each state change with the old `saveRound`, line by line.

### SB7. Remove what has no reader

Goal: remove unused code and correct false comments (SBF16 to SBF18).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. Dead code | Sonnet | `src/core/lower.ts`, `src/core/check_builtins/schedule.ts`, `src/core/emit/scope.ts`, `src/core/editor_rename.ts`, `scripts/validate_fixtures.ts` | Gate exit 0 | 8 |
| 2. Option field helper | Sonnet | `src/core/check_builtins/effect.ts` | Byte identity passes | 8 |
| 3. False comments | Sonnet | The 19 files that unit 3 lists | Capture and byte identity pass | 10 |

Unit 1. Delete `functionOf` at `lower.ts:628` and the type `FunctionNode` at `lower.ts:81`, and remove each import that loses its last use. Remove `export` from `ScheduleContext` and `OutcomeNames`, because each file still uses its name. Delete the `Fixture` interface, because no file uses it. Delete the `SourceEdit` re-export. Confirm each with `command grep` first. If the gate rejects one of these changes, keep that item, and record the reason in section 13.

Unit 2. Put the walk at `effect.ts:199-212` and `558-571` in one helper in the same file. Read both copies first. Keep each diagnostic text.

Unit 3. Correct `emit/shape.ts:5-6` to name `validate/expr_walk.ts`. In these 18 files, remove old plan numbers from comments, or replace them with the reason: `project.ts`, `parse.ts`, `tables.ts`, `lower.ts`, `initialization.ts`, `check_project.ts`, `patterns.ts`, `resolve.ts`, `db.ts`, and `decls.ts`, `expr.ts`, `scope.ts`, `sourcemap.ts`, `emit.ts`, `tsc.ts`, `doc.ts`, `types.ts`, and `spans.ts` in `emit/`. All are in `src/core`. Rename no identifier. Do not change any string that reaches a user.

Verify:

```sh
command grep -n 'functionOf\|FunctionNode' src/core/lower.ts         # no output
command grep -n 'Fixture\b' scripts/validate_fixtures.ts             # no output
deno test --allow-read tests/core_boundary_test.ts tests/emit_families_test.ts tests/ir_snapshot_test.ts
deno task golden:update && deno task validate:update && deno task surface:update && git diff --exit-code fixtures/
deno task check; echo "exit=$?"
deno task behavior:capture <SB7 base> HEAD                           # section 8 rule
git diff --exit-code <SB7 base> HEAD -- tests fixtures deno.json deno.lock src/core/ir.ts
```

### SB8. Test structure

Goal: remove the slow suite critical path and the duplicated helpers (SBF19, SBF20). This phase changes no test expectation.

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. One `compileAndRun` | Sonnet | `tests/target_helpers.ts`, and the 11 files that unit 1 lists | Same test count, capture passes | 20 |
| 2. One `diagnosticsOf` | Sonnet | `tests/helpers.ts`, and the 13 files that unit 2 lists | Same test count | 15 |
| 3. Split the emit slow tests | Sonnet | `tests/emit_slow_test.ts`, new `tests/emit_*_slow_test.ts` files, `tests/emit_slow_helpers.ts` | 91 tests kept, wall time recorded | 25 |

Units 1 and 2. Replace only the definitions that are identical after a temporary path prefix is normalized. Leave the unique definitions. Do not change a test body.

Unit 1 files, in two identical groups. The line number gives the current definition.

- Group of nine: `uninterruptible_slow_test.ts:15`, `repeat_slow_test.ts:15`, `schedule_cron_slow_test.ts:48`, `outcome_slow_test.ts:15`, `race_all_slow_test.ts:15`, `retry_options_slow_test.ts:16`, `defect_slow_test.ts:15`, `schedule_emit_slow_test.ts:16`, `timeout_slow_test.ts:15`.
- Group of two: `duration_type_slow_test.ts:8`, `instant_slow_test.ts:8`.

Five definitions are unique and stay: `schema_slow_test.ts`, `map_set_types_slow_test.ts`, `log_builtin_slow_test.ts`, `random_slow_test.ts`, and `map_set_ops_slow_test.ts`.

Unit 2 files, in two identical groups:

- Group of eleven: `uninterruptible_test.ts:11`, `defect_test.ts:21`, `map_set_types_test.ts:23`, `outcome_test.ts:22`, `duration_type_test.ts:17`, `race_all_test.ts:14`, `timeout_test.ts:11`, `log_builtin_test.ts:10`, `map_set_ops_test.ts:20`, `instant_test.ts:21`, `random_test.ts:11`.
- Group of two: `retry_options_test.ts:19`, `repeat_test.ts:18`.

Five definitions are unique and stay: `temporal_stream_test.ts`, `diagnostic_cascade_test.ts`, `schedule_cron_test.ts`, `check_primitive_position_test.ts`, and `builtin_report_sites_test.ts`.

Unit 3. Split by the existing banners and by topic. Move only the helper declarations in lines 1 to 184 to `tests/emit_slow_helpers.ts`. The test at lines 142 to 183 moves to exactly one test file. A helper file that holds a test registers it again in each importer. Keep each test name and body. The runtime banner has 3,830 lines, so it needs more than one file. Stop splitting when no file has more than about 15 s of summed time. Do not set a wall time target. Record the wall time of `deno task test:slow` before and after, with three runs each.

Verify:

```sh
deno task test 2>&1 | command grep "passed |"                         # the count of the phase base
deno task test:slow 2>&1 | command grep "passed |"                    # the count of the phase base
git diff --exit-code <SB8 base> HEAD -- src fixtures
deno task check; echo "exit=$?"
deno task behavior:capture <SB8 base> HEAD                           # section 8 rule
```

The moved tests run the same programs, so the capture must meet the rule of section 8 with no new test. Compare the sorted list of test names before and after, and record the result.

### SB9. Documents of the final design

Goal: the documents describe the state after the reset, and tests keep the key facts true (SBF21 to SBF26).

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| 1. IR direction and guard | Sonnet | `docs/architecture.md`, `docs/api.md`, `docs/builtin-changes.md`, `docs/development.md`, `tests/ir_site_slow_test.ts` | Slow test passes | 10 |
| 2. Invariants and contracts | Sonnet | `docs/architecture.md`, `CONCEPTS.md`, `docs/development.md`, `docs/api.md`, `README.md` | `tests/docs_test.ts` passes | 12 |
| 3. Status | Opus | `docs/status.md` | Every fact keeps a home | 10 |
| 4. Changelog and release | Sonnet | `CHANGELOG.md`, `docs/development.md`, `tests/docs_test.ts` | New guard passes | 12 |
| 5. History out of `api.md` | Sonnet | `docs/api.md`, `docs/archive/api-migrations.md` | `tests/docs_test.ts` passes | 6 |
| 6. Measurements and closure | Opus | `docs/release-measurements.md`, `docs/evidence/`, this plan, `docs/plans/README.md`, `docs/status.md` | Plan in the archive | 8 |

Unit 1. State that `src/core/ir.ts` is the authored contract, and that `../effektive/public/typed-ir.ts` is a published standalone copy. Correct the four documents of SBF21. Add `tests/ir_site_slow_test.ts`, with the check that the parallel plan wrote: a temporary file with two type assignments between the two `ModuleIR` types, in both directions, under `deno check`. Set `ignore` to true when the sibling file is absent. This guard proves assignment compatibility in both directions. It cannot see an extra optional property on one side, so no document may claim that it proves equal members. Keep this command in the plan as the manual form:

```sh
deno run --check --no-lock --ext=ts - <<'TS'
import type { ModuleIR as CoreModuleIR } from "./src/core/ir.ts";
import type { ModuleIR as SiteModuleIR } from "../effektive/public/typed-ir.ts";
type Assert<T extends true> = T;
export type CoreFitsSite = Assert<[CoreModuleIR] extends [SiteModuleIR] ? true : false>;
export type SiteFitsCore = Assert<[SiteModuleIR] extends [CoreModuleIR] ? true : false>;
TS
```

Unit 2. Correct invariant 2 and the layering table for `cron.ts`, and name `CLOSED_UNIT_IDS` and `LOG_LEVELS` as shared rule data in `ir.ts`. Correct "Prelude table" in `CONCEPTS.md`. Add the target lock and the surface snapshot to `docs/architecture.md`. In `docs/development.md`, state the `.gitignore` trap and the command `git ls-files -ci --exclude-standard`, and replace "parts A8 and L5". In `README.md`, replace the Phase A status text. In `docs/api.md`, state that only `build --validate` runs the validator. Add a test to `tests/docs_test.ts`: each test name that the layering table cites exists in the named file.

Unit 3. Rewrite the Effect feature section of `docs/status.md` to hold only open candidates, with one link to `docs/language-rules.md` for the done rows. Check each removed fact against `docs/language-rules.md` first. Add a fact there if it is missing. Remove the two rows of "Open items" that SBF24 names. Keep the stopping rule, the dispositions, the gaps, the deferrals, and the manual items.

Unit 4. Add a `0.10.4` section to `CHANGELOG.md`. The commit `45218f3` set that version. So the new section holds the current "Unreleased" entries and the Effect features of the ES, EL, and SL work. It states the IR version 7 change as a breaking change. Add the reset changes of section 5 under "Unreleased". Add a short "Release" section to `docs/development.md` with the steps that the history shows: update `CHANGELOG.md`, set `deno.json`, run the gate, and commit. Add a test to `tests/docs_test.ts`: the newest versioned heading of `CHANGELOG.md` equals the version in `deno.json`.

Unit 5. Move `docs/api.md:924-1018` to `docs/archive/api-migrations.md` without a content change, and keep the signature help paragraph in its reference section. Update the links.

Unit 6. Run the measurements in the background. Each one exceeds two minutes:

```sh
deno task bench --full m1 m3 m4 --json docs/evidence/release-measurements-2026-10-30.json > docs/evidence/release-measurements-2026-10-30.txt
```

Add one section to `docs/release-measurements.md` with the 100 ms p90 budget result. A measured regression stops closure and goes to the user. It does not change the budget. Then record the final numbers in section 13. Read `../effektive/public/effektive-spec.html` for a statement that the reset made false, and correct it in a separate commit there. Under Decision 2 (a), no spec statement names the proof budget at the base, so the expected change is none. Mark this plan complete, move it to `docs/archive/plans/`, update its registry row, and remove its row from the open items.

Preserve: every fact in `docs/status.md` that has a live use.

Verify:

```sh
deno test --allow-read tests/docs_test.ts
deno test --allow-all tests/ir_site_slow_test.ts
git ls-files -ci --exclude-standard                                  # the three known files, and no new file
git diff --exit-code 45218f3 -- fixtures/golden fixtures/validate fixtures/lex fixtures/ir src/core/ir.ts
wc -l docs/status.md AGENTS.md                                       # record in section 13
git ls-files docs | wc -l                                            # record in section 13
deno task check; echo "exit=$?"
```

The `git diff` prints nothing, so no wire type changes. Each moved file stays byte-equal, so `git diff -M --name-status <SB9 base> HEAD | command grep '^R' | command grep -v '^R100'` prints nothing, except a file that a unit edits on purpose.

## 9. Considered and rejected

- A new compiler architecture, a universal builtin table, a shared child table, or family dispatch registries. SBF27 gives the measured reasons. Reopen family registries only if the builtin volume rises.
- A split of `check_expr.ts` or `BodyChecker`. It concentrates 831 branches and about 2,950 lines, but this review found one separable group (SBF13) with a complete context. Other moves shift lines and widen no boundary.
- An upgrade of the target to Effect 4.1.0. It repairs the gate, but it changes the target of the emitted code, the golden context, and every runtime claim. That is a selection, not a repair.
- `overrides` in a generated `package.json` (probe D). It needs a `node_modules` directory and a file beside the user's source.
- Pruning the 43 unused named exports of the entry points. No outside code imports the package, so it is safe. But the gain is not measured, and invariant 5 keeps the names.
- An offline gate with a persistent cache keyed by the lockfile hash. The frozen locks tie each resolved version to the commit. A registry outage now gives a clear failure, and SB1 documents the need for network access. A cache manager adds code for that case only.
- Exact fixture pins, or a copy of the root lockfile in the temporary projects. Neither holds both `@std/assert` and `@std/internal` (SBF3).
- Removal of the `specialized` field of the `builtin` fact. No repository code reads it, but `CheckedModule` exposes it, and section 5 allows no such change.
- A move of the proof types from `predicates.ts` into `ir.ts` (SBF15). The validator still imports `SolverLimits` from `predicates.ts`, so its type-only exception stays, and the move has no stated gain.
- Renames of the avoidable "nominal" names (SBF17). The criteria of section 1 do not cover a name, and no review shows a wrong concept behind these names.
- A normalized declaration comparison of `src/core/ir.ts` and the website copy. It needs a declaration normalizer for two files that differ by 430 diff lines, and no member drift is shown. The assignment guard of SB9 unit 1 stays, with its stated limit.
- Hosted CI. Decision D24 in `docs/architecture.md` says that the project has none.
- The validator in the language server and the playground. It adds latency and changes what a user sees. SB9 documents the current contract.
- Removal of the unread log kinds `cli.tsc` and `pg.layout`, and of the unread fields. The log format is a contract, and the FR work waits for real logs.
- A smaller `scripts/logs_report.ts`. Its value depends on the same logs.
- Slow-to-fast test conversion. Only 7 of 278 slow tests finish under 50 ms, and four tests could move, for a saving of about 1 s.
- A fix for the possible timing flakes in `tests/cli_test.ts:551-558` and `tests/retry_options_slow_test.ts:195-239`. No flake is observed. Fix one when it occurs.
- A break of the import between `scripts/` and `tests/`. `scripts/golden_update.ts:14` already uses this pattern, and SB2 follows it.
- A generation scheme for the type table. 2,000 edits grew the heap by 3.0 MB in the core review, and the limit stays recorded in `docs/status.md`.
- A second copy of `cron.ts` for the validator. It adds 113 lines, and it finds a bug only if an independent author writes it. `tests/schedule_cron_slow_test.ts` compares it with `Cron.parse`.

## 10. Decisions for the user

Decision 1. Which document is the reset authority?
(a) This document. `docs/plans/2026-10-30-reset-implementation.md` moves to the archive in SB0 unit 3, and SB5, SB6, and the traces of SB2 keep its design. Recommended. It covers the same ownership work. It also covers the `--tsc` path, a tested lock fix, the capture repair, the proof budget, the crash, and the unfired rejection sites. The parallel plan's repair candidate reaches its stop condition (section 4).
(b) The parallel plan. This document moves to the archive as evidence. Its RST0a then needs the probes of SBF2 before it can run.
(c) Keep the parallel plan as the authority, and add selected SB phases to it.

Decision 2. Which scope does the proof budget have (SBF11)?
(a) One budget for each module. A result then depends only on the module and its dependency interfaces. A project above the total limit, with no single module above it, becomes accepted. The worst-case solver work of one update then grows with the module count. The recorded p90 cost of a 100,000-step solver run is 2.5 ms (`docs/refinement-measurements.md`). Recommended, because the base must give one result for one input.
(b) Keep one budget for each run. SB3 records the difference in a test, and the disagreement stays.

The user selected Decision 1 (a) and Decision 2 (a) on 2026-10-30. That approval authorizes the phases of section 8. It does not authorize a push, a release, or a push of the website repository.

## 11. Order, review, and stop rules

Run the phases in this order: SB0, SB1, SB2, SB3, SB4, SB5, SB6, SB7, SB8, SB9. SB0 comes first, because no other phase can pass the gate until it is done. SB2 comes before SB3 to SB7, because those phases need its oracle. SB4 comes before SB8, because SB8 moves tests. SB9 comes last. SB3 and SB4 touch different files, so they can run in either order. SB5 and SB7 also touch different files, so they can run in either order.

Each phase is one reviewable batch. Opus reads each diff line by line and runs each verification command itself. A claim without command output is not evidence.

Stop a phase and report to the user in each of these cases:

- A verification command fails twice for the same cause.
- A capture or a snapshot shows a difference that the phase does not explain.
- A fixture update appears necessary.
- A unit needs a behavior change outside section 5.
- A measurement shows a regression against the 100 ms budget.
- A new upstream release breaks the gate again, in a way that SB0 does not cover.

An incomplete or failed phase stays on local `main` only as a new reverting commit. Do not rewrite history. Do not push.

## 12. Validation

Astra validated the draft of this plan on 2026-10-30, with the model `gpt-6-astra`, reasoning effort `xhigh`, and a read-only sandbox. The run took 755 s and changed no file. Its verdict was "revise before execution". The main session checked each finding against the source, and the table below gives each outcome. Astra reviewed the draft, not the revised text, so the revisions have no second independent review.

Astra confirmed these items by a run or by reading the source:

- SBF2 and SBF7: the `--no-lock` path and the capture failure handling exist, and the scratch lock has 14 packages.
- SBF11: the reproducer gave 1 fresh diagnostic, 0 incremental diagnostics, and 0 control diagnostics.
- SBF12: 100,000 repetitions returned 100,000 diagnostics, and 130,000 repetitions gave `RangeError` from `analyze.ts:40`. `src/core` has 30 spread pushes.
- SBF13 and SBF14: the constructor context supports the two substitutions. The nine Map and Set operations, the five disk fields, and the one outside read of `diskProgram` match the findings.
- SB3: by source inspection, the budget of one module keeps each completed proof below the aggregate limit.
- SBF16 and SBF21: `functionOf` has no caller, the IR diff has 430 lines, and the assignment command passed.
- The source, core, test, slow test, fixture, and document counts of section 2.

Astra could not run the full gate, the capture, lock generation, the empty-cache probes, or the benchmarks, because its sandbox was read-only. It did not check every reported coverage count or every future phase command. The main session ran those gates and probes, and section 2 and SBF2 and SBF3 give the results.

| Finding | Severity | Problem | Outcome |
| --- | --- | --- | --- |
| V1 | Blocker | SB7 removed `specialized`, and `CheckedModule` exposes it. Section 5 does not allow that change. | Accepted. The field stays, and section 9 records the reason. |
| V2 | Major | An exact pin of `@std/assert` leaves `@std/internal` open, and the harnesses kept `--no-lock`. | Accepted. A copy of the root lock also failed (probes N, P, and Q). SB1 unit 1 uses a lock generated from the fixture configuration, with `--frozen` (probes R and S). |
| V3 | Major | SB0 generalized from one extra package. An overlapping range was not tested. | Accepted. Probe L tested it. SBF2 states the narrower claim, section 5 item 1 names the effect, and SB0 unit 1 adds a test. |
| V4 | Major | Separate output arrays and a final file map lose order and repeated writes. | Accepted. SB2 unit 1 records one ordered list of events. |
| V5 | Major | A new script without a file map entry fails `tests/docs_test.ts`. | Accepted. SB2 unit 1 and SB4 unit 1 update `docs/api.md` and `docs/development.md`. |
| V6 | Major | SB4 imported `ROWS`, which is private, and the phase changes no source. | Accepted. SB4 unit 5 compares `childrenOf` with `exprChildren` as multisets. |
| V7 | Major | The proof type move was not precise, and it broke the capture procedure. | Resolved by declining SBF15. `SolverLimits` keeps the exception, so the move has no stated gain. SB7 drops the unit, and SB9 again requires no diff in `src/core/ir.ts`. |
| V8 | Minor | The plan said 24 language server methods. | Accepted. The count is 22. SB2 unit 1 lists them, and it adds an unsupported request and an ignored notification. |
| V9 | Major | The helper range of `tests/emit_slow_test.ts` holds a test. | Accepted. SB8 unit 3 moves declarations only, and the test moves to one file. |
| V10 | Minor | A zero-difference noise level contradicts the documented run variance. | Accepted. Section 8 uses the documented rule and keeps the fixed phase base. |
| V11 | Major | Astra said that the model names conflict with the rules that it read. Three file lists were not resolved. | Partly rejected. `AGENTS.md` takes the model names from the global instructions of each tool, so the Claude Code names stand, and section 8 adds the rule for Codex. The file lists are accepted: SB7 and SB8 now enumerate them. |
| V12 | Minor | The two-way assignment check does not prove equal members. | Accepted for the wording in SB9 unit 1. Section 9 declines the normalized comparison and gives the reason. |
| V13 | Minor | The renames show no reset benefit. | Accepted. SB7 keeps the comment corrections, and section 9 records the renames. |

The main session rejected only the model name part of V11.

## 13. Progress

| Phase | State | Entry SHA | Commits | Measurements and notes |
| --- | --- | --- | --- | --- |
| SB0 | Done | `b2f356db2939e129525c25d4eda42b1488d96357` | `54f0028`, `26cfe83`, `82df64c` | Gate exit 0: 2,679 fast and 280 slow passed. Byte identity exit 0, and `src/core` and `fixtures` equal `45218f3`. Capture `HEAD HEAD`: exit 0 in 392 s beside other work, 12,567 records on each side, 0 new, 0 missing. |
| SB1 | Done | `82df64cb9eff77ee53fe469ecb5b2eef1909006f` | `b6668f4`, `42955cf`, `9be79f0` | Gate exit 0: 2,692 fast and 280 slow passed. Stale Effect pin failed `tests/versions_test.ts`. Changed fixture configuration failed with "The lockfile is out of date". Fixture configurations stayed `^1`, and no fixture changed. |
| SB2 | Done | `9be79f0473761f4fa76289fb3facaa203727a836` | `4648813`, `d9d96ee`, `0dcd2a7` | Gate exit 0: 2,787 fast and 280 slow passed. A second `surface:update` changed nothing, and `src/` equals the phase base. Temporary source edits: a message failed 1 test, an exit code failed 4 tests, two reversed publishes failed 1 test, and swapped `publishDiagnostics` and `effektive/generatedChanged` failed 1 test. The first reversal passed, because no step published two documents, so the main session added that step. |
| SB3 | Done | `0dcd2a7e781e6d7c4221f9b7e635c5e051f5d49d` | `7c18074`, `6690d66`, `b5916df` | Gate exit 0: 2,790 fast and 280 slow passed. Byte identity exit 0. Capture against the phase base: exit 0 in 408 s beside other work, 0 missing, 7 new (3 `check`, 4 `program`). All 7 come from `tests/diagnostic_volume_test.ts` and `tests/proof_budget_test.ts`, and their result sizes match those tests. Spread review: 21 of the other 23 sites have a size that depends on one source construct, so `6690d66` changed them. No crash was reproduced at those 21 sites. `predicates.ts:94,108` stay, because the caller bounds the size. `checkModuleStep` keeps its optional `proofBudget` parameter, because `tests/refinement_proofs_test.ts` passes small budgets to it. |
| SB4 | Done | `b5916df84f09233765a2f0a4be6384b22ec06077` | `5af1e03`, `d25efda`, `73eba8e`, `968c56c`, `8e78386` | Gate exit 0: 2,863 fast and 280 slow passed. `src` equals the phase base. `rules:unfired` first printed 68 sites (list below the table), and it now prints 0. The test has 68 rows. No site is unreachable, and no rule is dead. Child tables: 123 kinds with no content difference. Only `timeout` differs in order: the emitter gives `[durationMs, job]` because `job` is deferred, and the validator gives `[job, durationMs]`. The orchestrator deleted `world.ts:776`, `effect.ts:438`, and `ref.ts:42` in scratch edits. Each deletion failed exactly its own row, and `src` was restored. Unit 4 found SBF28. |
| SB5 | Done | `a9394b0701fd1969d08d4aa8608d632488649e27` | `1d9bba5` | Gate exit 0: 2,863 fast and 280 slow passed. Byte identity exit 0. Capture against the phase base: exit 0, 12,843 records on each side, 0 new, 0 missing. `tests`, `fixtures`, `deno.json`, `deno.lock`, and `src/core/ir.ts` equal the phase base. A normalized comparison of the removed and added text shows only the receiver change and the two named substitutions. `docs/api.md` line 44 also changed, because the move made it false. |
| SB6 | Done | `54bf7ae4552d66473d0cef9e27eec5f33adc4810` | `50b047f` | Gate exit 0: 2,863 fast and 280 slow passed. A second `surface:update` changed nothing. Capture against the phase base: exit 0, 12,843 records on each side, 0 new, 0 missing. `tests`, `fixtures`, `deno.json`, `deno.lock`, and `src/core` equal the phase base. The orchestrator compared each state change with the old `saveRound`, and creation and mutation order are the same. No document needed a change: `docs/api.md` names the disk program and not its fields. |
| SB7 | Done | `50b047fd3f9d0e7597c97cc151c7ccb1330a9abc` | `972b0ca`, `87aaaf7`, `04163cd` | Gate exit 0: 2,863 fast and 280 slow passed. Byte identity exit 0. Capture against the phase base: exit 0, 12,843 records on each side, 0 new, 0 missing. `tests`, `fixtures`, `deno.json`, `deno.lock`, and `src/core/ir.ts` equal the phase base. No dead code item had to stay. Correction: the commit messages swap two finding numbers. `87aaaf7` fixes SBF18 and `04163cd` fixes SBF17. The orchestrator did not rewrite the history. All 69 changed lines of `04163cd` are comments, and the orchestrator rewrapped one comment in `initialization.ts`. The invariant label `I8` went too, because only `docs/archive/` defines it. Measurement names such as `M4` stay. |
| SB8 | Done | `04163cd47bf20a107d9969bd6d521d48bb03f26b` | `d639f09`, `f23c108`, `0d0032b`, `9e22076` | Gate exit 0: 2,863 fast and 280 slow passed, which are the counts of the phase base. The sorted list of test names is equal before and after. `src` and `fixtures` equal the phase base. Wall time of `deno task test:slow`, three runs each on an extracted commit: before 72, 83, and 72 s, after 40, 41, and 41 s. `tests/emit_slow_test.ts` summed to 47.7 s, and the five files sum to about 2.8, 8.2, 14.1, 9.3, and 13.3 s, from the per-test times of the base. The first capture ran beside the gates: 0 missing, 2 new clean `program` records, and 1,057 `program` records on the base side. The rerun with the same phase base gave 12,843 records on each side, 0 new, and 0 missing, so the two records were run variance. |
| SB9 | Done | `9e2207689cc888d1afebded122df9e9d5806fd45` | `4693f82`, `f5fa49a`, `abc9e88`, `32e4369`, `b7e2dc7`, and the commit that moves this plan | Gate exit 0: 2,865 fast and 282 slow passed. The two new slow tests are the IR guard, and one of them proves that the guard fails on `TS2344`. `tests/docs_test.ts` passes, and it now reads the layering table and the changelog version. The wire diff against `45218f3` is empty for `fixtures/golden`, `fixtures/validate`, `fixtures/lex`, `fixtures/ir`, and `src/core/ir.ts`. `git ls-files -ci --exclude-standard` prints the three known files. No moved file changed. `docs/status.md` has 303 lines, down from 320 at review, and `AGENTS.md` has 50. `git ls-files docs` counts 159 files. Full M1, M3, and M4 of `4d68be0` exited 0: the large p90 values are 12.873, 61.930, 60.023, and 65.419 ms, below the 100 ms budget. Eight alternating M1 runs before and after the reset differ by at most 1.7% in the median of medians, below each row floor, so the reset shows no regression. One p90 on each side passed 100 ms in a row with a high floor. `docs/release-measurements.md` records this. The website specification holds no statement that the reset made false, so that repository has no new commit. SBF28 stays open in `docs/status.md` for a user decision. |

The first `rules:unfired` output of SB4 listed these 68 sites in `src/core/validate/`:

- `expr.ts`: 266, 475, 484, 497, 505, 513, 557, 737, 1139, 1313, 1616
- `families/codec.ts`: 28, 48, 93, 102
- `families/collections.ts`: 19, 109, 122
- `families/effect.ts`: 71, 207, 217, 228, 236, 438, 471
- `families/fiber.ts`: 29, 43, 51
- `families/layer.ts`: 32, 45, 59, 69, 93
- `families/ref.ts`: 33, 42, 58
- `families/schedule.ts`: 105, 252, 270, 300
- `families/schema.ts`: 941
- `families/scope.ts`: 39, 60, 64, 104, 144, 160, 265, 341, 362, 370
- `families/stream.ts`: 1021
- `serialization.ts`: 152
- `world.ts`: 542, 575, 583, 593, 602, 612, 624, 729, 776, 1146, 1312, 1315, 1367, 1375, 1395
