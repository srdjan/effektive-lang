# Foundation reset plan

Date: 2026-10-31. Base revision: `171b212162419ec682acce4eb92eb1db159c6a3d` (v0.11.1) on local `main`. Status: approved by the user on 2026-10-31, with FND1 to FND4 at option (a). Execution is in progress.

FN identifies the phases of this plan. FNF identifies its findings. FND identifies its decisions.

## 1. Authority and scope

This document is the sole plan authority for this reset. It holds the findings review, the target design, the phases, the verification of each phase, and the progress ledger. When another document disagrees with this plan about reset work, this plan wins.

`docs/status.md` stays the authority for project status and the stopping rule. `docs/architecture.md` stays the reference for the current architecture until a phase changes it. The canonical language specification stays in the sibling repository `../effektive/public/`.

Commit `c225085`, from another writer, rewrote `README.md` after the base. It changes no other file, so the measurements of section 4 still hold.

The planning request authorized changes to this document only. So FN0 registers this document and commits it, because the gate was red at the base and no commit could pass before FN0.

Approval of this plan authorizes the phases of section 12 on local `main`. It also authorizes the commands in those phases that run longer than two minutes: `behavior:capture`, `coverage`, `mutate`, and `bench --full`. It does not authorize a push, a release, a version change, or a website commit.

## 2. Result of the review

The compiler architecture stays. The pipeline, the typed IR contract, and the independent validator give the right boundaries. A fresh measurement of feature cost confirms this: structural edits are 12% to 21% of the core lines of a new builtin (FNF21).

The base has three real weaknesses. First, the gate is red at the base, and it has two separate causes (FNF1 and FNF2). Second, the project measures which lines run, but not which faults the tests detect (FNF5 and FNF6). Third, some weight has no reader, and some rules have several owners (FNF12 to FNF19).

This plan gives a stronger test base first, and it prunes second. A refactor is only as safe as the tests that guard it.

The plan removes about 450 lines from `src/`, of 56,164 TypeScript lines. That number is an estimate from line ranges, and each phase measures the real number. A larger cut needs removal of language forms, which the request does not allow. Decision FND1 records that limit: 12,239 lines are builtin family code, and 86 of the 117 prelude names have no use in the application, example, or tutorial sources.

## 3. Planning worklog

| Unit | Owner and model | Scope | Result |
| --- | --- | --- | --- |
| Baseline and adapter review | Main session, Opus | Gate, coverage, mutation sample, `src/cli`, `src/host`, `src/lsp`, `playground`, `scripts`, `bench`, documents | Section 4, FNF1 to FNF11, FNF22 to FNF26 |
| Core review | Subagent 1, Opus, read-only | `src/core/` | 51 tool calls. FNF12 to FNF21 |
| Test review | Subagent 2, Opus, read-only | `tests/`, `fixtures/` | 34 tool calls. Partial: its mode could not write to `/tmp`, so the main session ran coverage, mutation, and timing |
| Validation | Subagent 3, Codex Astra, `xhigh` | This document and cited source | Three read-only passes. Section 15 |

The two read-only reviewers changed no file. `git status --short` printed nothing after each run. The main session ran all measurements in `git archive` exports under `/tmp`, so no measurement touched the repository.

## 4. Baseline

All numbers come from one Apple machine on 2026-10-31, with Deno 2.9.8. Each row is one run unless the row says otherwise. "Export" means a `git archive` copy of the base under `/tmp`, with a symlink to the sibling website repository where stated.

| Measure | Value | Command or source |
| --- | --- | --- |
| Full gate | Exit 1 in 11.75 s. Format, lint, and type check passed. Fast suite: 2,883 passed, 1 failed. The slow suite did not start. | `deno task check` in an export |
| Slow suite, first run | Exit 1 in 85 s: 279 passed, 1 failed, 2 ignored. Two reviews ran on the machine. | `deno task test:slow` in an export |
| Slow suite, quiet, with coverage and the sibling | Exit 0: 282 passed, 0 failed | `scripts/test_slow.ts --coverage=<dir>` |
| Two concurrent slow suites | Each exit 0: 282 passed, in 1 min 25 s | Two exports, run together |
| Slow suite with the FN1 retry and lock probes | Exit 0: 282 passed | Export with both probes applied |
| Fast suite, changelog corrected | Exit 0: 2,884 passed in about 4 s | `deno test --no-check ...` in an export |
| Slowest fast tests | 1000 ms, 699 ms (both `tests/proof_budget_test.ts`), then 540 ms. One test at or over 1 s. | Log of the gate run |
| Coverage, fast suite | Lines 94.4%, branches 93.6% | `deno test --coverage`, then `deno coverage --lcov` |
| Coverage, fast and slow, with child processes | Lines 96.8%, branches 94.26%, functions 99.2% | `DENO_COVERAGE_DIR`, then `deno coverage <fast> <slow>` |
| `deno coverage --threshold=96` | Exit 1: branch 94.26% is below 96%. At 90: exit 0. | Same data |
| Unfired validator rejection sites | 0 | `scripts/rules_unfired.ts` in an export with the changelog corrected |
| Mutation sample | 48 mutants, 44 killed, 4 survived, 0 timeouts, at most 90 s with four workers | Section 7, FNF5 |
| Mutation sites in `src/`, without `src/core/ir.ts` | 11,122 | Same operators as the sample |
| TypeScript in `src/` | 56,164 lines. `src/core`: 119 files, 51,134 lines | `git ls-files 'src/*.ts' 'src/**/*.ts' \| xargs wc -l` |
| Builtin family files | 12,239 lines, 21.8% of `src/` | `wc -l src/core/check_builtins/*.ts src/core/validate/families/*.ts src/core/emit/families/*.ts` |
| `tests/` | 250 files, 70,746 lines, 58 slow files | `git ls-files tests` |
| `fixtures/` | 298 files | `git ls-files fixtures` |
| `docs/` | 160 files, of which 103 are in `docs/archive/` | `git ls-files docs` |
| Tracked bytes | 18,882,001. Two raw JSON files in `docs/evidence/`: 8,690,394 (46.0%) | `git ls-files -z \| xargs -0 wc -c` |
| Duplicate code in adapters and tools | 7 clusters of six-line windows in 67 files | A scan in `/tmp` |
| Private core imports in tests | 323 statements in 114 files, to 55 modules. 117 statements can move to an entry point now. | A TypeScript AST scan in `/tmp` |
| Session logs | 0 files in `playground/.effektive/logs/` | `ls` |

Coverage by directory, fast and slow suites together:

| Directory | Lines | Branches |
| --- | --- | --- |
| `src/core` | 96.8% | 94.3% |
| `src/cli` | 99.1% | 95.5% |
| `src/host` | 90.3% | 92.6% |
| `src/lsp` | 97.6% | 92.8% |
| `playground/src` | 96.2% | 93.5% |

The lowest core files are the refinement solver: `validate/predicates.ts` (74.3% of lines, 67 uncovered), `predicate_source.ts` (81.4%, 63 uncovered), and `predicates.ts` (82.4%, 74 uncovered). The lowest adapter file is `src/host/deno_io.ts` (72.4%, 51 uncovered).

### Evidence limits

This review does not prove that no other defect exists. The mutation sample covers 48 of 1,413 sites in eight modules, so it gives no reliable rate for a module. It runs only the fast suite, so a mutant that only a slow test can kill counts as a survivor. The review ran no behavior capture, no full benchmark, no browser session, and no installed-editor check.

## 5. First principles

The repository must do five things. It must turn source into checked, typed IR. It must check that IR independently. It must emit Effect-TS from the IR. It must serve the command-line tool, the language server, the editor client, and the playground from one core. It must prove each of these.

A stable base for new features needs six conditions.

1. A gate result depends only on the commit. Today it fails at the base, and it depends on machine load.
2. A test failure means a defect. Today one test fails on wall-clock time.
3. The tests detect faults, and the project can measure that. Today no tool measures it, and all four sampled survivors are real gaps.
4. The central invariants hold on generated inputs, not only on chosen examples. Today property tests stop at the parser.
5. Each decision has one owner, and each thing in the tree has a reader.
6. Each live document states only true facts about the final design.

The earlier resets closed reproducibility, the surface oracle, and the validator rejection proof. This plan does not repeat that work. It adds conditions 2 to 4, which those plans left open, and it finishes conditions 5 and 6.

### Design after the reset

The compiler stages do not change. The test system gains four tools: a coverage task with floors, a seeded mutation tool with a register of survivors, four property tests, and a release task that changes the version and the changelog together.

`docs/testing.md` becomes the one description of the test system. It states what each oracle proves and what it can miss.

In the core, the declaration index holds only what a reader needs. Lowering and emission report one invariant failure kind. Each diagnostic category comes from its code. A new type kind fails the compile at each emitter type walk. Four accidental hot spots become smaller functions.

## 6. Preservation contract

The reset preserves all current functionality.

| Surface | What stays equal | Oracle |
| --- | --- | --- |
| Source language | Accepted forms, rejected forms, recovery, type identity, inferred inputs, refinement rules | Error fixtures, parser and checker tests, application tests, capture |
| Diagnostics | Codes, messages, severity, order, spans | Error fixtures, surface snapshot, capture |
| Typed IR | Wire version 7, node shapes, annotations, proofs, interface hashes | `tests/ir_snapshot_test.ts`, mutation fixtures, capture |
| TypeScript output | Exact text, companion modules, source maps, span tables | Golden files, strict target tests, capture |
| Command line | Flags, exit codes, stdout, stderr, write order, watch behavior | `tests/cli_test.ts`, surface snapshot, slow tests |
| Language server | Replies, order, diagnostics, save behavior, retry rules | `tests/lsp_*`, surface snapshot |
| Playground | Editing, diagnostics, hover, stale labels, replay | Facade, model, and replay tests, browser flow in FN11 |
| Logs and replay | Event names, envelope, order, blob retention, replay exclusions | Log, wire log, report, and replay tests |
| Packaging and applications | Entry points, VSIX contents, offline installation, application results | Installation and application slow tests |

These changes are intended. No other observable change is allowed.

1. `LowerError` and `EmitError` lose the `unsupported` variant (FN6). No source program reaches it, and the command-line text stays equal.
2. `DeclEntry` loses four unread fields, and `MethodEntry` loses one (FN6).
3. Under FND2 (a), the entry points lose names with no importer (FN7). Under the same decision, nine unread fields leave exported records (FN7): `InitializationGraph.references`, `ConstantBody.init`, `ModuleInterface.module`, `FileIndex.source`, `ModuleResolution.module`, `SpanTable.module`, `Lexed.source`, `ProviderSignature.provides`, and `specialized`.
4. `deno task rules:unfired` exits 1 when its list is not empty (FN2).
5. `fixtures/lex/snapshot.json` loses its file map, and keeps its random corpus (FN10).
6. Under FND4 (a), two raw sample files and 17 screenshots leave the tree (FN10). Git history keeps them.

## 7. Detailed findings review

"Confirmed" means that the main session read the source or ran the command. "Reported" means that one reviewer measured it, and the main session did not repeat it. "Probable" means that the cause is not proven, and the finding names the check that can confirm it.

### Gate integrity

FNF1 (high, confirmed). The gate is red at the base. Commit `171b212` raised `deno.json:3` to 0.11.1 and added no changelog heading. The newest heading is 0.11.0, so `tests/docs_test.ts:135` fails. `deno task check` uses `&&`, so a fast failure stops the gate before the slow suite. Effect: no commit can pass the gate. The same failure occurred one day earlier as NBF1. The cause of the repeat is the release path: two hand edits and a rule. Disposition: FN0 repairs the record, and FN1 adds a release task.

FNF2 (high, confirmed flake; load is the probable cause). `tests/retry_options_slow_test.ts:205` asserts a wall-clock upper bound. One run measured `196,258` against limits of 100 and 150, under load from two reviews. The same commit then passed three times, once quiet and twice in two concurrent suites. So load alone does not always trigger it. A planned check can confirm the cause: run FN1 under three concurrent suites. Lines 162, 191, and 206 have the same weakness, and line 191 has a limit of 9 ms. The stable base plan deferred this flake until it occurred, and it has now occurred. A probe in an export replaced `Date.now()` with `TestClock`. All 8 tests passed, with exact gaps `[30,60,120]` and `[10,30,90]`, and jitter gaps of 17.8 and 32.4 inside their nominal ranges. FN1 found a second test of this kind: `tests/repeat_slow_test.ts:107` failed in one of three concurrent suites at a load average of 76, because a real 50 ms timeout fired before the second 1 ms job finished. That run confirms load as a cause. Disposition: FN1.

FNF3 (medium, confirmed). `tests/target_helpers.ts:106` and `tests/tutorial_slow_test.ts:33` resolve the target with `--no-lock`, but `src/host/deno_io.ts:134` uses a seeded lock. Effect: strict target tests take a different resolution path from the path that users run. The present float is narrow, because `effect@4.0.5` has no npm dependencies. A probe in an export seeded the lock in `target_helpers.ts`, and 282 slow tests passed. The other `--no-lock` rows run the local tool, read two local files, or assert launch arguments. They stay. Disposition: FN1.

FNF4 (medium, confirmed). `tests/proof_budget_test.ts:35` takes 1000 ms, at the one-second limit of a fast test. Line 48 takes 699 ms. The next test takes 540 ms. Effect: the fast suite breaks its own rule under small load. Disposition: FN1 moves this file to the slow suite.

### Fault detection

FNF5 (high, confirmed). No tool measures fault detection, and a sample found real gaps. A search of `scripts/`, `deno.json`, `AGENTS.md`, and `docs/development.md` finds no mutation tool. The main session wrote a sample tool in `/tmp`. It flips comparisons, swaps `&&` and `||`, negates `if` conditions, and flips boolean returns. Each mutant ran the whole fast suite with `--no-check`.

| Module | Sites | Sampled | Killed | Survived |
| --- | ---: | ---: | ---: | ---: |
| `src/core/predicates.ts` | 137 | 6 | 4 | 2 |
| `src/core/validate/predicates.ts` | 113 | 6 | 5 | 1 |
| `src/core/check_binary.ts` | 152 | 6 | 6 | 0 |
| `src/core/types.ts` | 432 | 6 | 5 | 1 |
| `src/core/validate/typing.ts` | 472 | 6 | 6 | 0 |
| `src/core/db.ts` | 53 | 6 | 6 | 0 |
| `src/core/cron.ts` | 37 | 6 | 6 | 0 |
| `src/core/paths.ts` | 17 | 6 | 6 | 0 |

The four survivors are these. Each one changes the meaning of the function, by reading of the source. No run proved that a source program can reach the first one.

| Site at the base | Mutant | Effect of the mutant |
| --- | --- | --- |
| `src/core/predicates.ts:105` | `if (operand.value)` becomes `if (!operand.value)` | `or(false, x)` gives `false`, and `or(true, x)` drops the constant |
| `src/core/predicates.ts:514` | `\|\|` becomes `&&` | A forged term path that is not a list passes this check |
| `src/core/validate/predicates.ts:47` | `\|\|` becomes `&&` | An invalid `maxSteps` limit passes the certificate check |
| `src/core/types.ts:1380` | outer `&&` becomes `\|\|` | Two `Fiber` types with different failures fit |

A full run is not a gate step. At the sample rate of 48 mutants in at most 90 s, 11,122 sites take about 5.8 hours. Disposition: FN2 adds the tool and a register, and FN4 closes the gaps in the solver and the type rules.

FNF6 (high, confirmed). Property tests stop at the parser. `tests/fixtures_test.ts:256,276,296` test parser prefixes and edits. `tests/db_test.ts:114,138` and `tests/revision_isolation_test.ts` compare incremental results with fresh results, but only on hand-written examples with fixed edits. `tests/validate_typing_test.ts` holds tables only. The earlier reset compared 194 edits with a fresh run, and it tried 60,000 mutated programs, but those review scripts are not in the repository. Effect: SBF11 and NBF2 were both incremental defects that a seeded property can catch, and a future defect of that kind has no standing oracle. Disposition: FN3.

FNF7 (medium, confirmed). The project has no coverage floor, and `AGENTS.md` says not to claim a target until the project adopts one. Coverage is good overall, and it is lowest in the solver (section 4). Child-process coverage works through `DENO_COVERAGE_DIR`. Disposition: FND3 and FN2. FN4 closes the solver lines.

FNF8 (medium, confirmed). Some assertions accept a wrong behavior. `tests/` has 55 rows of the form `assert(x.length > 0)`. `tests/check_body_test.ts:225` and `:1758` accept any diagnostic, so a typing error in the test program also passes. Disposition: FN4.

FNF9 (medium, confirmed). Tests reach private modules. 323 import statements in 114 files reach 55 private modules. 117 statements can move to an entry point now. `ir.ts` (54) and `validate/index.ts` (44) are justified, because they are the wire contract and the independent validator. Effect: an internal move edits tests that have no reason to change. Disposition: FN5.

FNF10 (medium, confirmed). The lexer oracle decays. `tests/lex_snapshot_test.ts:61` skips each file that changed after the snapshot, and it needs only half of the files to compare. The file map repeats what the parser fixtures and golden files prove. Its random corpus of 20,000 strings keeps its value. Disposition: FN10 removes the file map.

FNF11 (low, reported). Test helpers have copies, and some loops need review. The test review found 38 exact helper copies, including `forged` (7) and `all` (7). It found 133 multi-line loop heads in fast tests that it did not classify. Disposition: FN4.

### Weight with no reader

FNF12 (medium, confirmed). The declaration index keeps tracking for a phase that the project did not build. `src/core/index.ts:53-54` and `:38` declare `headerHash`, `bodyHash`, `headerSpan`, `bodySpan`, and `MethodEntry.hash`. No `src` file outside `index.ts` reads the first four, and only `tests/index_test.ts` reads them. The reviewer found no reader of `MethodEntry.hash`. The header comment of `index.ts` promises a use that does not exist. D4 planned declaration-level tracking, and D9 states that Phase B is not needed while M1 meets the budget. Effect: each index build computes two hashes for each declaration, and about 125 lines serve no reader. Disposition: FN6.

FNF13 (medium, confirmed). `unsupported` and `internal` mean one thing. `tests/unsupported_sites_test.ts:1-4` says that the parser or the checker excludes every `unsupported` site. Both print the same text in `src/host/outputs.ts:40,50`. There are 13 sites, not the twelve that the test comment states, and the test also cites `check_expr.ts:7174` in a file of 2,999 lines. Merged coverage shows that `emit/scope.ts:497` has no test. Effect: two names for one broken invariant, in two public result types. Disposition: FN6. The `unsupported` pattern domain in `patterns.ts` is another concept, and it stays.

FNF14 (low, reported; each deletion must compile). Some fields and privates have no reader. Five rows are internal: `BuiltinInstance.name` (`lower.ts:139`), `ModuleContext.services` (`lower.ts:150`), `World.module` (`validate/world.ts:50`), and the privates at `parse.ts:153` and `resolve.ts:420`.

Nine rows are fields of exported records, so an entry point can return them: `InitializationGraph.references` (`initialization.ts:14`), `ConstantBody.init` (`check_project.ts:88`), `ModuleInterface.module` (`interface.ts:48`), `FileIndex.source` (`index.ts:81`), `ModuleResolution.module` (`resolve.ts:300`), `SpanTable.module` (`emit/spans.ts:27`), `Lexed.source` (`lex.ts:72`), `ProviderSignature.provides` (`signatures.ts:121`), and `specialized` (`tables.ts:300`). Three assertions in `tests/check_body_test.ts:2020,2029,2037` read `specialized`.

The reviewer's compile overlay missed real reads, so each deletion needs its own compile. Disposition: FN6 removes the internal rows. Under FND2 (a), FN7 removes the exported rows.

FNF15 (medium, confirmed). The entry surface exceeds its use. 42 of 109 named re-exports have no importer through an entry point: 30 of 85 in `frontend.ts`, and 12 of 24 in `typescript.ts`. Six span helpers at `source.ts:89-123` have no `src` caller (reported). This reopens a rejected item with a new reason. The earlier plans kept these names as a public contract. The maintainer confirmed that no outside code imports the package, and invariant 5 of `docs/architecture.md` states both facts. Some names can gain importers in FN5, so FN7 counts again. Disposition: FND2 and FN7.

FNF16 (low, confirmed). `category` repeats a part of each diagnostic code. All 81 codes have a `category` equal to the code prefix. `description` stays, because `docs/language-rules.md` says that the registry describes every code. Disposition: FN6 derives the category.

### Repeated decisions

FNF17 (medium, confirmed for the first five, probable for the sixth). Same-side code repeats a decision.

| Repetition | Sites | Estimated lines |
| --- | --- | --- |
| Type child walks, apart from the `named` case | `types.ts:908-978`, `:1166-1217` | Not measured |
| Node child reads | `index.ts:90`, `resolve.ts:384`, and `kidsOf` | 18 |
| Parenthesis unwrap | `predicate_source.ts:388`, `check_refinements.ts:400`, `check_expr.ts:395,1866`, `editor_signature.ts:56` | Not measured |
| Emit helper records | `emit/scope.ts:555-628`, `emit/emit.ts:152-157` | 35 |
| Module lookup that can throw | `check.ts:1136-1141`, `check_project.ts:179-183` | Not measured |
| Linear algebra (probable) | `predicate_source.ts:140-176,362-384`, `check_refinements.ts:521-531,596-628` | Not measured |

The first row is a partial duplicate. The `named` cases differ on purpose: `foreignSealedOf` enters error records, tagged bodies, and guarded aliases, and `childRefs` stops there. `foreignSealedOf` also returns the first match, and `check_binary.ts:303` uses that result to select a diagnostic. `childRefs` takes a maximum, so its child order has no effect. FN8 shares only the other cases, in the order of `foreignSealedOf`. The check that can confirm the sixth row is a differential over normalized predicates. Disposition: FN8.

FNF18 (medium, confirmed). Two emitter type walks hide a new type kind. `containsNamed` (`emit/decls.ts:497`) and `needsFieldAdapter` (`emit/fields.ts:62`) use `default:`, so a new `Type` kind gives no compile error there. The Map and Set type commit `1ef9f9b` added 32 `case "set"` rows in 12 files.

The four emitter walkers are not copies. `needsFieldAdapter` expands named types and stops at errors. `containsNamed` skips tuples and does not expand names. `containsFunction` stops at deferred types. `namedIn` also collects effect identities. Disposition: FN8 replaces the two `default:` arms with exhaustive cases, and the walkers stay separate.

FNF19 (low, reported). Small type gaps exist. Counts: 36 `as` casts, 4 `!` assertions, 0 `@ts-`, 91 `throw`, 11 `try`. `isTypeId` (`ids.ts:28`) can replace seven guards and their casts. Lines `lower.ts:990,1008,1026,1050` prove callback shapes again. `LowerFailure` and `EmitFailure` cover unreachable states, so the Result rule holds. Disposition: FN8 for the guards. The callback shapes stay unless a fact can carry the node.

FNF20 (medium, confirmed for the numbers). Four hot spots hold accidental complexity. Eleven functions at or above 49 are flat dispatch over a closed set, and they stay. These four are not flat dispatch.

| Function | Site | Lines | Cyclomatic number |
| --- | --- | ---: | ---: |
| `invoke` | `src/core/lower.ts:868` | 258 | 59 |
| `recordConstruction` | `src/core/check_expr.ts:1847` | 164 | 54 |
| `walk` | `src/core/validate/world.ts:266` | 152 | 54 |
| `checkBuiltinShape` | `src/core/validate/world.ts:1136` | 147 | 49 |

The main session read `walk` and `checkBuiltinShape` in full. `walk` holds a group of function checks and a 36-line `schema` case in one closure. `checkBuiltinShape` holds two shapes: the `all` builtin, and the array callback builtins. Disposition: FN9.

FNF21 (no defect, reported). Structure is not the main cost of a feature. Four recent commits gave these numbers.

| Commit | Files | Core lines | Semantic lines | Structural lines |
| --- | ---: | ---: | --- | --- |
| `2cf3cd2` random | 12 | +92 | 73 in 4 files | 19 in 8 files |
| `5008fc0` log | 11 | +271 | 238 in 4 files | 33 in 7 files |
| `0488ce7` Map and Set operations | 13 | +846 | 743 in 5 files | 103 in 8 files |
| `1ef9f9b` Map and Set types | 16 | +250 | All forced by a new `Type` kind | - |

Structure touches most files, but it holds 12% to 21% of the lines. The real cost is the semantics on both sides of the oracle, and tests at 1.6 to 3 times the core lines. SBF27 stands, so the plan adds no builtin table. FNF18 adds a compile error at two walks, and it does not reduce the sites of a new type kind.

### Tools and documents

FNF22 (low, confirmed). Plan labels remain in comments and test text. A search finds 75 lines: 17 in `src/`, 11 in `playground/`, 2 in `scripts/`, 2 in `bench/`, and 43 in `tests/`. One line is a false match: `target: "ES2022"` at `bench/m5_variants.ts:77`. Examples: `src/lsp/projects.ts:1` ("plan 5.3 and 5.5") and `src/core/validate_project.ts:2`. Effect: a comment points at a section that a reader cannot find. Disposition: FN10.

FNF23 (medium, confirmed). Raw evidence holds 46.0% of the tracked bytes. `docs/evidence/release-measurements-2026-10-21.json` and `-2026-10-30.json` hold 8,690,394 bytes. The 17 PNG files in `docs/release-assets/` show a layout that `4031957` replaced on 2026-10-26. Only archive documents link the screenshots, and `docs/release-measurements.md:17,111` links the raw files. Effect: a repository search sees about 475,000 lines of samples, and the screenshots no longer show the product. Disposition: FND4 and FN10.

FNF24 (medium, confirmed). Live documents repeat rules and history. `docs/status.md:48-165` restates language rules that `docs/language-rules.md` holds, though `status.md` says that other documents link to it for facts. `docs/language-rules.md` has 49 history labels. `docs/development.md:44-53` holds reset history. Invariant 2 of `docs/architecture.md` names two shared constants, but `ir.ts` exports eight (reported). Invariant 5 says that names stay and that no outside code imports them. Disposition: FN11.

FNF25 (medium, confirmed). Browser evidence is old. The last automated browser review ran on 2026-10-21. The workbench layout changed on 2026-10-26, and its plan names a manual check only. The house rule asks for real user flows in a browser. `docs/status.md:306` records that the user has not accepted the page. Disposition: FN11 runs one flow against the running page.

FNF26 (no defect, confirmed). Adapters and tools are healthy. A scan found 7 duplicate windows in 67 files. `src/host/save_round.ts` keeps its two removal rules on purpose. The session sets differ by policy. The 53 exports in `bench/`, `scripts/`, `playground/`, and `src/host/` with no outside reader are mostly local types, so their removal gives no simpler code.

### Language surface

FNF27 (no defect, confirmed for the count). Most builtin names serve no application. 86 of the 117 prelude names have no word match in the 15 application `.eff` files, the examples, or the tutorial. The count covers 16 of 19 Schema names, 26 of 32 stream names, and 10 of 10 Schedule names. The stopping rule of 2026-10-19 ended automatic parity work, and the rule of 2026-10-27 asks that a source form carry user intent. A word match is an approximate measure, and each name has tests and a specification entry. Disposition: FND1.

### Findings during execution

FNF28 (medium, confirmed, open). The checker accepts a program that the validator rejects. FN3 unit 2 found this case. Take `export sealed type Positive = int` in `lib.eff`. In `main.eff`, take `type R = { s: Schema<int, int, never, never, Positive> }`, `type Q = { s: Schema<int> }`, and `export const f = (r: R): Q => ({ s: r.s })`.

Observed results: `check`, `build`, and `build --tsc` exit 0, and only `build --validate` exits 1 with two `validation/002` diagnostics. Probable cause: `TypeTable.schema` at `src/core/types.ts:644` drops `makeInput` when `isAssignable` holds both ways. That call has no module, so it has every sealed authority. The IR keeps `makeInput` at `src/core/type_lower.ts:647`, and the validator needs authority at `src/core/validate/typing.ts:377`. A check that can confirm the cause: pass a module with no authority at that call, and run the test below. The call at `src/core/check_builtins/schema.ts:429` reads authority in the same way.

The rule is clear: a sealed value widens only inside its declaring module, and `Schema` stays invariant. So the checker is the wrong side, and the expected result is `type-mismatch/003`. A repair rejects a program that the checker accepts today, so it changes an observable result outside section 6. This plan does not make that change. The case follows the path of SBF28: it stays open in `docs/status.md` for a user decision. No unit needs the repair.

FNF29 (medium, confirmed, open). The checker accepts a second program that the validator rejects. The orchestrator found this case while it read the other `isAssignable` calls. Take `export sealed type Code = null | 1` and `export type Flag = boolean` in `lib.eff`. In `main.eff`, take `export const f = (c: Code): Flag => c === null`.

Observed results: the checker reports nothing, and the validator reports one `validation/002`. The comparison `c === 1` passes on both sides. Probable cause: `src/core/check_binary.ts:285` tests `null` through `isAssignable`, which has every sealed authority, and the validator applies authority to the same comparison. The rules let another module compare primitive values, so the validator is probably the wrong side. A check that can confirm the cause: read the `===` case in `src/core/validate/expr.ts`. This case stays open on the same path as FNF28.

`tests/type_laws_property_test.ts` holds three tests whose names start with "known difference". Each test first failed with the correct expected value, for the reason of its defect. Each test now pins the current wrong result, so a repair must change it.

### Corrections to the inputs

The main session checked the reviewer reports, and these claims changed.

- The test review proposed a test that each update task is idempotent. The snapshot tests already compare the current build with the committed file, so a second update gives the same text. This plan drops that test.
- The test review proposed that the gate fail when the sibling website is absent. A `git archive` export has no sibling, and the capture runs in one. `tests/ir_site_slow_test.ts:40,52` stay, and `docs/testing.md` records the limit.
- The test review listed every `--no-lock` row as a risk. Only two rows resolve the target (FNF3).
- The core review proposed to delete `checkAnalysis`, `checkProject`, and `lowerProject`. `scripts/behavior_capture.ts:93` anchors on `checkAnalysis`, and a missing anchor fails the capture. `bench/m2.ts` and `scripts/validate_fixtures.ts` also call them, and tests hold 463 references. So this plan keeps them, and FN3 proves that both drivers agree.
- The core review reported `emit/scope.ts:497` as probably untested. Merged coverage confirms it: lines 487, 489, and 497 did not run.
- The core review said that `checkBuiltinShape` is an `if` chain with no exhaustive check. That claim is wrong: `src/core/validate/world.ts:1277` holds a `never` default on a `switch`. The function is still a hot spot, for the reason in FNF20.
- The core review read only the first part of `walk`. The main session read the rest, and the finding stands.
- The stable base plan said that no repository code reads `specialized`. Three test assertions read it (FNF14).

## 8. Decisions for the user

Decision FND1. Does this reset keep all 117 prelude names?
(a) Keep them all. Recommended. The request says to preserve current functionality, and a removal is a language change.
(b) Open a separate deprecation review for names with no application use. It is the only large simplification left, but it needs a language decision, website changes, and a migration note.

Decision FND2. Do unread entry names and unread public fields go?
(a) Remove them after FN5, and rewrite invariant 5 of `docs/architecture.md`. Recommended. No outside code imports the package.
(b) Keep them. FN7 does not run.

Decision FND3. How does the project enforce coverage?
(a) A separate `deno task coverage` with floors. Each reset phase and `deno task release` run it. Recommended. The fast suite takes about 4 s without coverage and 26 s with it, and the slow suite takes longer, so the task stays out of the gate before each commit.
(b) Put the floors in `deno task check`. It gives a stronger gate, and each commit costs more time.
(c) Adopt no floors. FN2 keeps the report, and the `AGENTS.md` rule stays.

Decision FND4. Does raw evidence leave the tree?
(a) Remove the two raw JSON files and the 17 PNG files, and keep the text reports and the JSON review records. Recommended. Git history keeps them. Three archive documents keep their links, and these links stop resolving. The link test skips `docs/archive`, and FN10 records the commit that holds the files.
(b) Keep them. FN10 unit 3 does not run.

## 9. Considered and rejected

- A new compiler architecture, a universal builtin table, a shared child table, or family dispatch registries. FNF21 repeats the result of SBF27.
- Elaboration in the checker, which would remove the lowering stage. Lazy lowering is a design property that M3 measures: a hover does not lower. The saving is not measured, and it cannot run in small phases.
- A split of `check_expr.ts` by length. FNF20 selects functions by their shape, not by file size.
- Any sharing of rules between the checker and the validator, or of child tables between the emitter and the validator.
- One shared child function for the four emitter walkers. They visit different children and stop at different nodes (FNF18), so a shared function changes behavior.
- Removal of the second project driver (section 7, corrections).
- A gate limit on the time of a fast test. It adds a failure that depends on load, which is the defect of FNF2. FN1 gives a command that a phase runs.
- A full mutation run in a gate. FNF5 gives the cost.
- Mutation of `src/core/emit/` against the fast suite. The slow suite proves the emitter, and one slow run takes about a minute. `docs/testing.md` records the limit.
- A reason file for each fixture update. Invariant 4 and the stop rules of section 13 already govern updates, and a reviewer reads the diff. FN10 removes the part of the lexer file that had the most churn with no meaning.
- Removal of unread exports in `bench/` and `scripts/` (FNF26).
- A rewrite or split of `tests/check_body_test.ts` or `tests/validate_test.ts`. A split saves no time.
- Removal of the archive. Live documents link 80 of its 101 Markdown files.
- A correction of the double diagnostic for `{ a: 1, ...base }`, which gives `syntax/014` and `type-mismatch/005`. A change is a behavior change. `tests/builtin_report_sites_test.ts:628-634` pins only `type-mismatch/005`, so FN9 unit 2 first adds an exact test of both codes.
- Removal of log kinds or a smaller `logs_report.ts`. The FR work waits for real logs.

## 10. Inherited items and known risks

| Item | Disposition |
| --- | --- |
| FR1 to FR7 (log findings) | Stay deferred. The user chose to wait for real logs, and `playground/.effektive/logs/` holds 0 files. |
| Item 9 (broader package interoperability) | Stays deferred by the user. |
| TCM (TypeScript content mappers) | Stays deferred by the user. |
| Metrics (item 16) and sort (item 24) | Stay candidates. They are features. |
| Hand test of the VS Code client | Stays with the user. |
| Playground acceptance | Stays with the user. FN11 adds automated evidence, and it does not replace the acceptance. |

The user supplied six known risks on 2026-10-30 and asked for no action at that time. The test work of this request covers two of them.

| Risk | Disposition |
| --- | --- |
| Nothing ties website examples to fixtures | Stays open. It is a change in another repository. |
| 22 of 65 website code blocks are not fully checked | Stays open. This review did not count them again. |
| `withFiber` is the only callback fixed, and `mapGroups` has no evidence of the same fault | Stays open. This review found no new evidence. |
| `tests/target_helpers.ts:106` uses `--no-lock` | FN1 closes it (FNF3). |
| Two fast cases in `tests/proof_budget_test.ts` run close to the limit | FN1 closes it (FNF4). |
| The earlier p90 spike has no confirmed cause | Stays open. FN11 records the p90 of its run. |

## 11. Execution rules and shared verification

Work on local `main`. Make one commit for each unit, unless a unit table says otherwise. Do not push. Do not rewrite history.

Stage each file by name, and stage only the files of the unit. Do not use `git add -A`. Another writer can commit during the reset, as `c225085` did. Leave that work as it is. SCOPE must name such a commit and exclude it.

Before a phase starts, record its entry commit in section 16 as the full SHA. That SHA stays the phase base through all corrections.

In this shell, `grep`, `diff`, `du`, and `curl` are aliases. Write `command grep`, `command diff`, `command rm -f`, `command cp`, and `command mv`. In zsh, an unquoted `$VAR` does not split into words, and a word that starts with `=` fails. A script that needs a word list must use an array. In zsh, `$?` after a pipe gives the status of the last command, so write the output to a file first. On macOS, `git grep -E` does not treat `\b` as a word boundary, so a pattern with `\b` must use `command grep`. Without `NO_COLOR=1`, Deno test logs hold color codes, and the COUNTS and NAMES commands print nothing.

Opus orchestrates, and it reviews each diff line by line. Opus runs each verification command itself, because a claim is not evidence. Sonnet executes each unit through the `sonnet-implementer` agent unless the unit table says Opus. An executor that reaches its turn budget stops, and it hands back its status and open items. Then Opus splits the unit. If Codex executes, use the model names in the global instructions of Codex.

Each dispatch carries the finding text, the files, the acceptance check, and the rule that a subagent cannot see this conversation. A worktree agent starts at `origin/main`, so a dispatch must use the main tree or a `git archive` copy.

### Shared checks

GATE. Run this before each commit. Test the exit status of the command itself.

```sh
NO_COLOR=1 deno task check > /tmp/fn-gate.log 2>&1 && git commit -m "<subject>"
```

COUNTS. Read the two result lines of the gate.

```sh
command grep -E '^(ok|FAILED) \|' /tmp/fn-gate.log
```

Expected: two `ok` lines, with no failed test. The repository run shows no ignored test, because the sibling repository exists.

BYTES. Run this for each phase that changes `src/core`. The first command proves that regeneration gives the committed fixtures. The second command proves that the phase committed no fixture change. Each must print nothing and exit 0. If a file changes, run `git checkout -- fixtures/` and fix the code.

```sh
deno task golden:update > /dev/null && deno task validate:update > /dev/null && deno task surface:update > /dev/null && git diff --exit-code fixtures/
git diff --exit-code <phase-base> HEAD -- fixtures/golden fixtures/ir fixtures/validate fixtures/surface
```

CAPTURE. Run this at the end of each phase that changes `src/core`.

```sh
deno task behavior:capture <phase-base> HEAD > /tmp/fn-capture.log 2>&1; echo "capture exit $?"; command grep -E '^(new in|missing in)|records \(' /tmp/fn-capture.log
```

Expected: exit 0, and `missing in HEAD: 0`. The task exits 1 when a base record is missing. A record holds its kind, an input hash, a result hash, and a length. It holds no message and no test name. New records must come only from tests that the phase adds. Up to two new or missing clean `program` records can be run variance. In that case, run the capture again with the same phase base. When a phase edits existing tests, follow `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`, so that both sides run the same tests.

NAMES. Run this at the end of each phase, and save the list. Compare it with the list of the phase that ran before it.

```sh
command grep -E ' \.\.\. (ok|FAILED|ignored)' /tmp/fn-gate.log | sed -E 's/ \.\.\. .*$//' | sed -E 's#^\./tests/[^ ]+ => ##' | command sort > /tmp/fn-names-<phase>.txt
command diff /tmp/fn-names-<previous>.txt /tmp/fn-names-<phase>.txt
```

CAPTURE-RAN. Run this when a capture must exit 1 because forged failure records change. A failed test also gives exit 1, so these commands prove that the comparison finished.

```sh
command grep -c ' records (' <log>
command grep -cE '^(new|missing) in ' <log>
command grep -E '^missing in ' <log>
```

Expected: `2`, then `2`, then one line with a count above 0. Any other output fails the check.

SCOPE. Run this at the end of each phase. Compare the list with the files of the phase.

```sh
git diff --name-status <phase-base> HEAD
```

COVERAGE. From FN2 on, run `deno task coverage` at the end of each phase. It must exit 0.

## 12. Phases

The phases run in the order of section 13. Each phase is one reviewable batch.

### FN0. Restore the green gate and register the plan

Goal: the gate passes, and this plan is on `main`. Findings: FNF1.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Move the "Unreleased" entries under `## 0.11.1 - 2026-10-30`, and keep an empty `## Unreleased` above it. The date is the date of `171b212`. | Opus | `CHANGELOG.md` | `deno test --allow-read tests/docs_test.ts` exits 0 | 5 turns |
| 2. Add one registry row: FN (phases), FNF (findings), FND (decisions). Commit it with this plan. | Opus | `docs/plans/README.md`, this plan | Row links resolve in `tests/docs_test.ts` | 5 turns |

Verification:

```sh
NO_COLOR=1 deno task check > /tmp/fn-gate.log 2>&1; echo "gate exit $?"
command grep -E '^(ok|FAILED) \|' /tmp/fn-gate.log
git diff --name-only <phase-base> HEAD
```

Expected: gate exit 0, 2,884 fast and 282 slow tests passed, and no ignored test. The last command prints exactly `CHANGELOG.md`, `docs/plans/2026-10-31-foundation-reset.md`, and `docs/plans/README.md`. Run NAMES once, and save the list as `/tmp/fn-names-fn0.txt`.

If FNF2 fails this gate, record the failure in section 16. Run the gate again once on a quiet machine. Then continue to FN1.

### FN1. Make the gate depend only on the commit

Goal: the same commit gives the same gate result under load. Findings: FNF1, FNF2, FNF3, FNF4. This phase changes no file in `src/`.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Run the retry harness under `TestClock`. Read the time through `Clock.currentTimeMillis`. Fork the program with `Effect.forkChild`, step `TestClock.adjust(1)` until the fiber ends, and join it. Assert the probe values exactly: gaps `[30, 60, 120]` and `[10, 30, 90]`, a total of 300, and gaps `[0, 0, 40, 80]`. Assert jitter inside `[16, 24)` and `[32, 48)`. Correct the header comment. | Sonnet | `tests/retry_options_slow_test.ts` | The file passes, and `command grep -c 'Date.now' tests/retry_options_slow_test.ts` prints 0 | 15 turns |
| 2. Write `tscLock()` to `deno.lock` in the temporary directory of each test. In `tests/target_helpers.ts`, the process runs in that directory, so use `--lock=deno.lock`. In `tests/tutorial_slow_test.ts`, the process runs at the repository root, so use `--lock=${dir}/deno.lock`. | Sonnet | `tests/target_helpers.ts`, `tests/tutorial_slow_test.ts` | Slow suite passes in an empty cache, and `git diff --exit-code deno.lock` prints nothing | 15 turns |
| 3. Rename the file with `git mv`, and change nothing else in it. | Sonnet | `tests/proof_budget_test.ts` to `tests/proof_budget_slow_test.ts` | Fast-test time check below passes | 5 turns |
| 4. Add `deno task release <version>`. A pure function `releaseTexts(changelog, config, version, date)` returns a `Result`, and it fails when "Unreleased" has no entries or the version does not rise. The script refuses a dirty tree, writes both files, and runs `deno task check`. On failure, it restores both files and exits 1. It never commits or pushes. Add a literal table test. `tests/docs_test.ts` requires a file map row for each new script. | Sonnet | `scripts/release.ts`, `tests/release_test.ts`, `deno.json`, `docs/development.md`, `docs/api.md` | Release checks below pass | 25 turns |

Verification:

```sh
git diff --exit-code <phase-base> -- src
git grep -n -- '--no-lock' tests/
for i in 1 2 3; do mkdir -p /tmp/fn1-$i; git archive HEAD | tar -x -C /tmp/fn1-$i; done
pids=(); for i in 1 2 3; do (cd /tmp/fn1-$i && deno task test:slow > /tmp/fn1-load-$i.log 2>&1) & pids+=($!); done; for p in $pids; do wait $p; echo "load suite exit $?"; done
command rm -rf /tmp/fn1-1 /tmp/fn1-2 /tmp/fn1-3
```

Expected: the first command prints nothing. The second command lists only the rows of `tests/emit_lift_slot_slow_test.ts`, `tests/parse_chain_slow_test.ts`, `tests/installation_slow_test.ts`, `tests/ir_site_slow_test.ts`, and `tests/vscode_client_test.ts`. Each load suite exits 0. If a load suite fails, a test still depends on load. Fix that test in this phase, and record it in FNF2.

Fast-test time check. Run `NO_COLOR=1 deno task test` three times, and keep the minimum of each test. Expected: each minimum is below 1 s. One run is not enough, because a test at 540 ms on a quiet machine reaches 1 s at a load average of 23.

Release checks. Run these in a `git clone` under `/tmp`, because the task reads git state. Run `deno task release 0.11.2`. Expected: exit 1, with a message that "Unreleased" has no entries, and both files unchanged. Add one entry under "Unreleased" in the copy, commit it there, and run the task again. Expected: exit 0, heading `## 0.11.2 - <today>`, and `version` 0.11.2. Commit that result in the clone. Add one more entry under "Unreleased", and commit it. Run `deno task release 0.11.1`. Expected: exit 1, with a message that the version does not rise. Then change one file without a commit, and run `deno task release 0.11.3`. Expected: exit 1, with a message that the tree is dirty.

Then run GATE and SCOPE. Run NAMES against FN0. Expected: the only differences are the names of tests that the phase adds to `tests/release_test.ts`.

### FN2. Measure test strength

Goal: one command gives coverage, and one command gives fault detection. Findings: FNF5, FNF7. This phase changes no file in `src/`.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Add `deno task coverage`. It runs the fast suite and the slow suite with coverage and `DENO_COVERAGE_DIR` in a temporary directory. It merges them with `deno coverage`, includes `src/` and `playground/src/`, prints a table by directory and the 20 lowest files, and removes the temporary directory. Under FND3 (a), floors start at line 96, branch 94, function 99. `deno.json` holds them under `coverage.thresholds`. | Sonnet | `scripts/coverage.ts`, `deno.json`, `tests/coverage_test.ts`, `docs/development.md`, `docs/api.md` | Floor checks below pass | 25 turns |
| 2. Make `rules:unfired` exit 1 when its list is not empty. Update its header comment and its row in `docs/development.md`. | Sonnet | `scripts/rules_unfired.ts`, its test, `docs/development.md` | Exit 0 on the current tree, and exit 1 with a forged uncovered site in a unit test | 10 turns |
| 3. Add `deno task mutate`. Base it on the sample tool of FNF5. Options: `--seed`, `--sample <n or all>`, `--workers`, `--tests <file>`, `--only <path:line>`, and module paths. It works in `git archive` copies and never edits the working tree. It follows the mutation contract below. Parse sources with the existing `typescript` import. | Sonnet | `scripts/mutate.ts`, `tests/mutate_slow_test.ts`, `fixtures/mutation/survivors.json`, `deno.json`, `docs/development.md`, `docs/api.md` | Mutate checks below pass | 35 turns |
| 4. Add `docs/testing.md`: test layers, each oracle with what it proves and what it can miss, the floors, the mutation commands, and the register rule. Move the "Reset regression checks" text of `docs/development.md` into it. Replace the coverage sentence of `AGENTS.md`. | Opus | `docs/testing.md`, `docs/development.md`, `AGENTS.md` | `tests/docs_test.ts` passes | 15 turns |
| 5. Under FND3 (a), make `deno task release` run `deno task coverage` after the gate. On failure, the task restores both files and exits 1. | Sonnet | `scripts/release.ts`, `tests/release_test.ts` | Release floor check below passes | 10 turns |

Mutation contract. The tool first runs the test set on a clean copy with type checks, and it exits 2 when that run fails. Each mutant run uses `--no-check`, because a mutant that only breaks a type proves nothing. Each mutant run uses `--fail-fast` and a limit of 60 s. The tool gives each result one class: killed (a test ran and failed), survived (tests ran, and all passed), timeout, or infrastructure error (no test ran). A timeout counts as killed, and the report lists it. A crash after a test started also counts as killed. An infrastructure error gives exit 2.

A register row holds `file`, `declaration` (the enclosing function or method), `offset` (the character offset of the expression in that declaration), `text` (the exact source text of the expression), `operator`, `class`, and `reason`. It holds no line number, so a change outside the declaration does not make it stale. A change inside the declaration can make it stale, and a reviewer must then check its reason again. Each row must match exactly one site. Two classes permit success: `equivalent` (no input can observe the change) and `slow-only` (the row names the slow test that kills the mutant). The tool exits 1 for a survivor with no row, or for a row that matches no site.

`tests/mutate_slow_test.ts` must cover two equal expressions in one file, and the deletion of a registered site while an equal expression remains.

`docs/testing.md` must state these limits. Golden files cover six modules. Mutation fixtures cover the listed mutations. The surface snapshot covers 90 command-line records and 28 language server records, in memory. The IR snapshot reaches at most 50 of 123 expression kinds. The capture sees its record kinds and test inputs only. `rules:unfired` sees direct validator rejections only. Log replay skips `--tsc` and watch sessions. `tests/ir_site_slow_test.ts` is ignored in an export, because the sibling is absent.

Verification:

```sh
git diff --exit-code <phase-base> -- src
deno task coverage; echo "coverage exit $?"
deno task rules:unfired > /tmp/fn2-unfired.log; echo "unfired exit $?"; tail -1 /tmp/fn2-unfired.log
```

Expected: coverage exit 0, `0 unfired rejection sites`, and unfired exit 0. Floor checks: in a copy, set the branch floor to 96. Expected: `deno task coverage` exits 1 and names branch coverage. Mutate checks:

```sh
deno task mutate --seed 1 --sample all --workers 4 src/core/paths.ts > /tmp/fn2-mutate.log; echo "mutate exit $?"
git status --short
```

Expected: the report lists 17 sites, and `git status --short` prints nothing. Exit 1 is correct when survivors have no row, and the report then names each one. `tests/mutate_slow_test.ts` must prove the operators and the four result classes with literal inputs.

Release floor check: in a `git clone` under `/tmp`, set the branch floor to 96, add an "Unreleased" entry, and commit both. Run `deno task release 0.11.2`. Expected: exit 1, and `CHANGELOG.md` and `deno.json` unchanged. Then run GATE, SCOPE, and NAMES against FN1.

### FN3. Add property tests for the central invariants

Goal: each central invariant holds on generated inputs. Findings: FNF6. This phase changes no file in `src/`. A property that fails at this base is a finding, not a test defect, until the evidence shows otherwise.

The tests use `makeRandom` from `bench/generate.ts`, a literal table of seeds, and no new dependency. Each failure message prints the seed and the step. A test that takes 1 s or more goes in a file named `*_slow_test.ts`.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. P1, incremental equals fresh. Start from `generateProject({ declarations: 30, seed })`. Apply a seeded edit sequence with body edits, signature edits, alias edits, a syntax error, a type error, a restore, and a module removal. After each step, compare the long-lived `Program` with a new `Program`, and compare both with `checkProject` and `lowerProject` on the same files. Add an `observe` helper that records success and failure states: diagnostics, module names, lowering, validation, emission, source maps, span tables, and `Revision.interfaceHash`. The third result covers diagnostics and IR only. A second long-lived `Program` keeps each revision without a query, and the test queries those revisions after the last step. The helper `snapshot()` at `tests/revision_isolation_test.ts:36` stays, because it asserts a clean revision. | Opus | `tests/incremental_property_test.ts` | Kill check below | 30 turns |
| 2. P2, type laws. Build a `TypeTable` and a `TypeEnv` from one generated definition set, with one owner module. Prove reflexivity on all generated types. Prove transitivity only on primitives, literals, and arrays, tuples, and records of those kinds. Two rules are not transitive, so assert each as a literal case. Nominal widening: for identities `A` and `B` over `int`, `A` fits `int`, `int` fits `B`, and `A` does not fit `B`. Function lifting: a pure function fits its effect counterpart, that effect type fits a union that holds it, and the pure function does not fit that union. Prove that `TypeTable.isAssignableIn` and the validator `fits` agree on generated pairs, through `type_ir.ts`. Private imports are justified here. | Opus | `tests/type_laws_property_test.ts` | Kill check below | 30 turns |
| 3. P3, solver soundness. Generate small predicates over three integer terms. Put explicit bounds on each term in the assumptions. Evaluate by brute force over those bounds, and assert that the satisfying set is not empty. A "proved" result must make the predicate true for each satisfying assignment. A "disproved" result must make the predicate false for each satisfying assignment. `verifyCertificate` must accept each certificate. Prove the identity and absorption laws of `and` and `or`. | Sonnet | `tests/predicates_property_test.ts` | Kill check below | 25 turns |
| 4. P4, accepted implies valid. Start from the examples and from generated projects. Apply seeded token edits. When the checker gives no diagnostic, the validator must give none, and emission must succeed. Assert the literal count of accepted programs for the fixed seeds, so the test cannot pass empty. | Sonnet | `tests/acceptance_property_slow_test.ts` | Kill check below | 25 turns |

Verification:

```sh
git diff --exit-code <phase-base> -- src
deno task mutate --seed 11 --sample 30 --workers 4 --tests tests/incremental_property_test.ts src/core/db.ts
deno task mutate --seed 12 --sample 30 --workers 4 --tests tests/type_laws_property_test.ts src/core/types.ts
deno task mutate --seed 13 --sample 30 --workers 4 --tests tests/predicates_property_test.ts src/core/predicates.ts
deno task mutate --seed 14 --sample 30 --workers 4 --tests tests/acceptance_property_slow_test.ts src/core/check_binary.ts
```

Expected: the source diff prints nothing. Each report shows at least one killed mutant. Exit 1 is correct here, because the single test file leaves survivors. Record each kill count in section 16. Then find the current line of the `Fiber` site and of the `or` site, and run these two commands.

```sh
deno task mutate --seed 1 --sample all --tests tests/type_laws_property_test.ts --only src/core/types.ts:<fiber-line> src/core/types.ts
deno task mutate --seed 1 --sample all --tests tests/predicates_property_test.ts --only src/core/predicates.ts:<or-line> src/core/predicates.ts
```

Expected: each mutant at those lines that FNF5 lists is killed. Then run GATE, SCOPE, and COVERAGE. Each new test must pass in a run of the fast suite with no second attempt.

If a property finds a defect, stop that unit and record a new FNF row. Write a test that reproduces the defect, and confirm that it fails for that reason. A fix that changes observable behavior outside section 6 needs a user decision. A repair of a wrong result with one clear rule follows the same path as SBF28.

### FN4. Close the known test gaps

Goal: the solver and the type rules have proven tests, and weak assertions are gone. Findings: FNF5, FNF7, FNF8, FNF11. This phase changes no file in `src/`, unless FN3 stop rules apply.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Add tests that kill the four survivors of FNF5 through public functions: `or` with constants, a forged term path, an invalid `maxSteps`, and `Fiber` failures. | Sonnet | Existing predicate and typing test files | Each mutant of FNF5 is killed by `--only` at its current line | 15 turns |
| 2. Run the targeted mutation command below in the background. For each survivor, add a test, or add a register row with the reason. Work in batches of 20 survivors for each dispatch. | Sonnet, new agent per batch | Test files, `fixtures/mutation/survivors.json` | Command exits 0 | 30 turns per batch |
| 3. For each uncovered line of `predicates.ts`, `validate/predicates.ts`, and `predicate_source.ts`, add a test. A line that no input can reach gets a row in `docs/testing.md`, with the reason. | Sonnet | Test files, `docs/testing.md` | `deno task coverage` shows the three files, and each remaining line has a row | 30 turns |
| 4. Replace each `assert(x.length > 0)` that checks a diagnostic with `assertEquals` on the exact codes. Keep a row that guards a census or a file list. | Sonnet | Test files | Weak-assertion command below | 30 turns |
| 5. Fold the exact helper copies of FNF11 into `tests/helpers.ts` or a family helper. | Sonnet | Test files | NAMES equal. The helper command below prints a number below 30, and section 16 says why each remaining definition differs. | 20 turns |
| 6. Review the 133 loop heads. Rewrite a loop that computes an expected value. Leave a table loop, a census, or a property. | Sonnet | Test files | Each rewrite keeps the test name | 20 turns |
| 7. Raise the floors to the final measured values, rounded down. | Opus | `deno.json`, `docs/testing.md` | `deno task coverage` exits 0 | 5 turns |

The targeted run covers 1,359 sites. At the sample rate, that is about 43 minutes.

```sh
deno task mutate --seed 20261031 --sample all --workers 4 src/core/predicates.ts src/core/validate/predicates.ts src/core/check_binary.ts src/core/types.ts src/core/validate/typing.ts src/core/db.ts
```

Weak-assertion check, and helper count:

```sh
git grep -nE 'assert\(.*\.length > 0' -- 'tests/*.ts'
git ls-files -z tests | xargs -0 command grep -nE '^(export )?(async )?function (forged|all|lowered)\b' | wc -l
```

Expected: each remaining row of the first command guards a census or a file list, and section 16 gives the count. The second command prints 30 at the base.

Verification: run the targeted command again with the same seed. Expected: exit 0. Then run `git diff --exit-code <phase-base> -- src`, GATE, SCOPE, and COVERAGE. NAMES against FN3 may show only added tests.

### FN5. Move tests to the entry points

Goal: an internal move no longer edits tests that have no reason to change. Findings: FNF9. This phase changes no file in `src/`.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Rewrite each private import whose names all exist in `frontend.ts` or `typescript.ts`. Use a script in `/tmp`, and change no test body. | Sonnet | 117 import statements in `tests/` | NAMES equal | 15 turns |
| 2. Add a test to `tests/core_boundary_test.ts`: a test file must not import a name from a private module when an entry point exports that name. The test allows `ir.ts`, `validate/index.ts`, and the property tests of FN3. | Sonnet | `tests/core_boundary_test.ts` | The test fails when one import moves back | 10 turns |

Verification: run `git diff --exit-code <phase-base> -- src`, GATE, NAMES, and SCOPE. NAMES may add only the test of unit 2. No capture runs, because the test bodies and `src/` do not change.

### FN6. Prune the core

Goal: remove what has no reader. Findings: FNF12, FNF13, FNF14, FNF16. Each unit is one commit. Run the units in the table order, because unit 4 changes capture records and the other units must not.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Delete `headerSpan`, `bodySpan`, `headerHash`, `bodyHash`, `MethodEntry.hash`, and the code that computes them. Keep a small `isArrow`. Correct the header comment. Remove the test rows that read those fields. | Sonnet | `src/core/index.ts`, `tests/index_test.ts`, `docs/api.md` | `git grep -nw -e headerHash -e bodyHash -e headerSpan -e bodySpan -- src tests bench scripts playground` prints nothing | 20 turns |
| 2. Delete the five internal rows of FNF14 one at a time. Run `deno check 'src/**/*.ts'` after each. Keep a row when the compile fails, and record why. | Sonnet | `src/core/lower.ts`, `src/core/validate/world.ts`, `src/core/parse.ts`, `src/core/resolve.ts` | Section 16 lists each deleted and kept row | 15 turns |
| 3. Remove the `category` field from each registry row. Derive it from the code. Keep a compile-time tie between `Category` and `DiagnosticCode`. Keep `description`. | Sonnet | `src/core/diagnostics.ts`, `tests/diagnostics_test.ts` | `tests/diagnostics_test.ts` passes, and `categoryOf` gives the same value for all 81 codes | 15 turns |
| 4. Merge `unsupported` into `internal` in lowering and emission, with no span. Remove the two `case` rows in `src/host/outputs.ts`. Rename the test file to `tests/internal_sites_test.ts`. Correct its count and citation. Give each of the 13 sites an exact assertion of its tag and message. Add a forged input for the third-party interface site at `emit/scope.ts:497`. Update `tests/emit_test.ts:1437` and `tests/outputs_generation_test.ts:116,158`. Keep `patterns.ts` and the replay outcome in `tests/logs_replay_test.ts` as they are. | Sonnet | `src/core/lower.ts`, `src/core/emit/emit.ts`, `src/core/emit/scope.ts`, the throw sites in `src/core/emit/`, `src/host/outputs.ts`, the three test files | `git grep -n 'unsupported' -- src/core/lower.ts src/core/emit src/host` prints nothing | 30 turns |

Verification: run GATE after each unit. At the end of the phase, run BYTES, SCOPE, COVERAGE, and NAMES. NAMES may show only the test file rename, removed rows of unit 1, and tests that the phase adds.

Capture of units 1 to 3. Follow the procedure of `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`. Use `<phase-base>` as `<base>`, and use the tests of the unit 3 commit. Then run the capture from that temporary commit to the unit 3 commit. Expected: exit 0, new 0, and missing 0, subject to the variance rule of CAPTURE.

Capture of unit 4. A record holds only a hash, so the capture cannot show that a message stayed. The exact assertions of unit 4 prove that. The capture proves that no other kind of result changed.

```sh
deno task behavior:capture <unit-3-commit> <unit-4-commit> > /tmp/fn6-capture.log 2>&1; echo "capture exit $?"
awk '/^new in /{m=1;next} /^missing in /{m=1;next} m' /tmp/fn6-capture.log | command grep -vE '^(emit-error|lower-error) '
```

Expected: capture exit 1, because the tag of each forged failure record changes. CAPTURE-RAN on `/tmp/fn6-capture.log` passes. The `awk` command prints nothing, subject to the variance rule of CAPTURE.

Then measure the result:

```sh
git diff --shortstat <phase-base> HEAD -- src
```

Record the numbers in section 16.

### FN7. Reduce the entry surface

Runs only under FND2 (a). Goal: the entry points export what the repository uses, and exported records hold what the repository reads. Findings: FNF14, FNF15.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Count the entry names again, with `src`, `tests`, `bench`, `scripts`, and `playground` as readers. Remove each name with no importer. A type that an exported signature needs stays reachable through inference, so remove it. | Sonnet | `src/core/frontend.ts`, `src/core/typescript.ts`, `docs/api.md` | Type check passes, and section 16 lists the names | 20 turns |
| 2. Move the six test-only span helpers from `src/core/source.ts` to `tests/helpers.ts`. | Sonnet | `src/core/source.ts`, `tests/helpers.ts`, test imports | Type check passes | 10 turns |
| 3. Delete the nine fields of section 6 item 3, one at a time. Run `deno check 'src/**/*.ts'` after each. Keep a field when the compile shows a reader, and record why. | Sonnet | Files of FNF14, `tests/check_body_test.ts` | Section 16 lists each deleted and kept field | 20 turns |
| 4. Rewrite invariant 5: the entry points hold what the repository uses, and no outside code imports the package. Check this fact again if the project publishes the package. | Opus | `docs/architecture.md` | `tests/docs_test.ts` passes | 5 turns |

Verification: run GATE, BYTES, and SCOPE. Run CAPTURE with the phase base. Expected: 0 new, 0 missing, because no behavior changes. NAMES against FN6 must be equal.

### FN8. Give each repeated decision one owner

Goal: same-side rules have one owner. Findings: FNF17, FNF18, FNF19. Each row of the unit table is one commit. Add a test that pins current behavior before the unit changes code, where a row says so.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Add literal tests first: a `function` type with two foreign sealed children gives the first parameter, and each of an error field, a tagged body, and a guarded alias gives its foreign sealed child. Then add a private `structuralChildren(node)` for each kind except `named`, in the visit order of `foreignSealedOf`. `foreignSealedOf` and `childRefs` keep their own `named` cases. | Opus | `src/core/types.ts`, a test file | The tests pass before and after the code change | 15 turns |
| 2. Replace `nodeKids` and `kids` with `kidsOf`. | Sonnet | `src/core/index.ts`, `src/core/resolve.ts` | `git grep -n 'nodeKids' -- src` prints nothing | 10 turns |
| 3. Add one `unparen` helper. Replace the five loops. | Sonnet | Files of FNF17 | `src/core/syntax_queries.ts` holds the helper | 10 turns |
| 4. Replace the six emit helper records with one table of generated helpers. | Sonnet | `src/core/emit/scope.ts`, `src/core/emit/emit.ts` | Golden files equal | 20 turns |
| 5. Pass `info` and `resolution` down, so the two module lookups that throw go away. | Sonnet | `src/core/check.ts`, `src/core/check_project.ts` | Each `throw` of those sites is gone | 15 turns |
| 6. In `containsNamed` and `needsFieldAdapter`, replace `default:` with an explicit list of the other kinds and a `never` check. Each listed kind returns `false`, as it does now. Keep all four walkers. | Sonnet | `src/core/emit/decls.ts`, `src/core/emit/fields.ts` | A trial `Type` member in a copy fails the compile at both sites | 10 turns |
| 7. Replace the seven guards with `isTypeId`, and type `reference` from `ir.ts`. | Sonnet | `src/core/check_expr.ts`, `src/core/check_refinements.ts`, `src/core/emit/expr.ts`, `src/core/types.ts` | The `as` count falls, and section 16 records it | 15 turns |
| 8. Add a seeded differential of the two linear normalizers in a test. If it shows equal results, keep one owner. If it shows a difference, keep both, record why, and do not change behavior. | Opus | `src/core/predicate_source.ts`, `src/core/check_refinements.ts`, a test file | Section 16 records the result | 20 turns |

Verification: run GATE after each unit. At the end of the phase, run BYTES, SCOPE, COVERAGE, and CAPTURE. Expected: missing 0, and new records only from tests that the phase adds. Then run the targeted mutation command of FN4 for `src/core/types.ts` with `--seed 20261031`. Expected: exit 0.

### FN9. Reduce the hot spots and name the concepts

Goal: the remaining complexity is essential, and file names state their concept. Findings: FNF20, and the naming results of the core review. No logic changes. Each row is one commit.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Move each long inline case of `invoke` to a private method. | Sonnet | `src/core/lower.ts` | Measure below | 20 turns |
| 2. First add a test that asserts the exact diagnostic list of `({ x: 1, ...b })`: `syntax/014` and `type-mismatch/005`. Then move the prescan of `recordConstruction` to a private method. | Sonnet | `src/core/check_expr.ts`, a test file | Measure below, and the new test passes before and after the move | 20 turns |
| 3. Move the function checks and the `schema` case of `walk` to named functions. Keep the function checks before the children. Split `checkBuiltinShape` into `checkAllShape` and `checkCallbackShape`, and keep the `never` default. Keep the order of each report. | Opus | `src/core/validate/world.ts` | Measure below, and mutation fixtures equal | 25 turns |
| 4. Rename `src/core/index.ts` to `src/core/declaration_index.ts`. Rename `src/core/check.ts` to `src/core/check_declarations.ts`. Change the forbidden-name pattern at `tests/emit_families_test.ts:75`, so that it still rejects the declaration index. Correct each path and each bare file name in a comment or document. The comment at `tests/type_lowerer_named_test.ts:2` must name `src/core/type_lower.ts`. | Sonnet | Importers, `tests/emit_families_test.ts`, `tests/internal_sites_test.ts`, `tests/type_lowerer_named_test.ts`, `src/core/signatures.ts`, `docs/api.md`, `docs/architecture.md`, `docs/language-rules.md`, and `docs/solutions/architecture-patterns/type-identity-is-a-flag-on-an-alias.md` | `tests/docs_test.ts` passes, the first path command below prints nothing, and a trial emitter import of `declaration_index.ts` in a copy fails `tests/emit_families_test.ts` | 20 turns |
| 5. Move `EmitFailure` and `internal` to `src/core/emit/failure.ts`. Rename `src/core/emit/scope.ts` to `src/core/emit/module_state.ts`, and class `Scope` to `ModuleState`. `src/core/emit/explicit_scope.ts` keeps its name, and it imports the new class name. | Sonnet | `src/core/emit/`, `src/core/typescript.ts`, tests, `docs/api.md`, `docs/builtin-changes.md`, `docs/language-rules.md`, and `docs/solutions/architecture-patterns/builtin-identity-needs-a-closed-fit-to-check-units.md` | `tests/docs_test.ts` and `tests/emit_families_test.ts` pass, and the second path command below prints nothing | 20 turns |

The capture hooks use `emit/emit.ts`, `check_project.ts`, `lower.ts`, `db.ts`, and `validate/index.ts`. None of these files moves, and no hook anchor changes. Run CAPTURE in its ordinary form here. The tests at HEAD import the new paths, so the base source cannot run them.

Path commands. Run the first after unit 4, and the second after unit 5:

```sh
git grep -n -E 'core/check\.ts|core/index\.ts' -- src tests bench scripts docs ':!docs/archive' ':!docs/plans/2026-10-31-foundation-reset.md'
git grep -n 'emit/scope\.ts' -- src tests bench scripts docs ':!docs/archive' ':!docs/plans/2026-10-31-foundation-reset.md'
```

Measure check:

```sh
deno task measure:functions $(git ls-files 'src/core/*.ts' 'src/core/**/*.ts' | command grep -v 'src/core/ir.ts$') | command sort -t "$(printf '\t')" -k6,6nr | head -14
```

Expected: the rows at or above 49 are only these eleven functions: `assignable` in `types.ts`, `compute`, `exprChildren`, `assignable` in `validate/typing.ts`, `structural`, `binary`, `pattern`, `print`, `operatorResult`, `lex`, and `render`.

Verification: run GATE after each unit. At the end of the phase, run BYTES, SCOPE, COVERAGE, and CAPTURE. Expected: missing 0, and new records only from the test of unit 2. NAMES against FN8 may add only that test.

### FN10. Prune tools and storage

Goal: tools and the tree hold only what has a reader. Findings: FNF10, FNF22, FNF23.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Remove the plan labels. State the fact, or delete the comment. | Sonnet | The 74 real lines of FNF22 | Label command below prints only `bench/m5_variants.ts:77` | 15 turns |
| 2. Remove the file map from `scripts/lex_snapshot.ts` and its test. Run `deno task lex:update`. | Sonnet | `scripts/lex_snapshot.ts`, `tests/lex_snapshot_test.ts`, `fixtures/lex/snapshot.json`, `docs/development.md` | Lexer check below prints `true` | 15 turns |
| 3. Under FND4 (a), run `git rm` on the two raw JSON files and on `docs/release-assets/*.png`. Replace each live link with the text "commit `<sha>`". Add one line to `docs/archive/README.md` that names the commit that last holds the files. | Sonnet | `docs/evidence/`, `docs/release-assets/`, `docs/release-measurements.md`, `docs/archive/README.md` | `tests/docs_test.ts` passes | 10 turns |

Label command:

```sh
git ls-files -z src playground scripts bench editors/vscode/extension.js tests | xargs -0 command grep -nE '\b(plan|Plan) ([0-9]+\.[0-9]|[A-Z]{2}\b|section)|\(plan |[Pp]art [A-Z][0-9]|\b(SV|RS|LG|PW|ES|SL|EL|MS|TI|NB|SB)[0-9]+\b'
```

Lexer check:

```sh
git show <phase-base>:fixtures/lex/snapshot.json > /tmp/fn10-lex-base.json
deno eval 'const a = JSON.parse(Deno.readTextFileSync("/tmp/fn10-lex-base.json")); const b = JSON.parse(Deno.readTextFileSync("fixtures/lex/snapshot.json")); console.log(a.random === b.random && a.seed === b.seed && a.randomCount === b.randomCount)'
```

Verification: run GATE, BYTES, and SCOPE. NAMES against FN9 may show only a test name that lost a label, and the removal of the test "the lexer output of each repository .eff and .effi file equals the snapshot". Section 16 lists each changed name. If unit 1 changes only comments in `src/` and `playground/`, a capture is not needed. Prove this with `git diff -U0 <phase-base> HEAD -- src playground | command grep -E '^[-+]' | command grep -vE '^(\+\+\+|---)|^[-+]\s*(//|\*|/\*)'`. Expected: it prints nothing. If it prints a line, run CAPTURE.

### FN11. Document the final design and close the reset

Goal: each live document states the final design, and the reset has its evidence. Findings: FNF24, FNF25.

| Unit | Model | Files | Acceptance | Budget |
| --- | --- | --- | --- | --- |
| 1. Update `docs/architecture.md`: stage file names, invariant 2 with the eight shared `ir.ts` names, invariant 5 under FND2, a note on D4 that the index no longer holds declaration hashes, and a pointer to `docs/testing.md`. | Opus | `docs/architecture.md` | `tests/docs_test.ts` passes | 15 turns |
| 2. Update `docs/api.md` and `docs/development.md`: file map, tasks, removed result variants, and the renamed files. Update `README.md` only if it names a changed task or path. | Sonnet | These files | `tests/docs_test.ts` passes | 15 turns |
| 3. Reduce `docs/status.md:48-165` to the state of each area, with one link to its rule. Move any rule that `docs/language-rules.md` lacks into it. Add one row for the test strength result. | Opus | `docs/status.md`, `docs/language-rules.md` | Status has fewer than 306 lines, and no rule is lost | 20 turns |
| 4. Remove the 49 history labels from `docs/language-rules.md`, and keep each rule. Keep evidence links. | Sonnet | `docs/language-rules.md` | Label count below prints 0 | 20 turns |
| 5. Update `CONCEPTS.md`, with terms for mutant, survivor register, and property test. Update the "Unreleased" section of `CHANGELOG.md`, and `AGENTS.md`. | Opus | All three files | `tests/docs_test.ts` passes | 10 turns |
| 6. Run the browser flow below with Playwright MCP, against the running page. Record the result in section 16. | Opus | None | Flow passes | 15 turns |
| 7. Run the full measurements. Add a short section to `docs/release-measurements.md`, with the p90 rows. | Opus | `docs/release-measurements.md` | Each large-input p90 is below 100 ms | 10 turns |
| 8. Move this plan to `docs/archive/plans/`, and update the registry path and each link. | Opus | This plan, `docs/plans/README.md`, documents that link it | `tests/docs_test.ts` passes | 5 turns |

The reset changes no source form and no wire type. So the website needs no edit. Prove this with the first command below. If the check fails, stop and report it.

Label count:

```sh
command grep -oE '\b(RBF?|ES|SL|EL|SV|TI|MS|NI|PX|PP|CM|HB|NT|NM|TE|TD|RF|RW|IN|LG|FR|SBF?|NBF?)[0-9]+\b|Phase [AB]\b' docs/language-rules.md | wc -l
```

Browser flow:

1. Run `deno task playground:serve` in the background. Probe it with `deno eval 'console.log((await fetch("http://127.0.0.1:8790/")).status)'`. Expected: 200.
2. Open `http://127.0.0.1:8790/` at 1280 by 800. The MCP browser caches assets, so refresh `app.css` and `app.js` with `fetch(url, { cache: "reload" })`, then reload the page.
3. Confirm that the example compiles, with no problem row, and that the generated TypeScript panel shows text.
4. Type a type error in the editor. Confirm that a problem row shows its code, and that the generated panel shows its stale state.
5. Remove the error. Confirm that the problem row goes, and that the stale state clears.
6. Hover on one name. Confirm that the hover shows its type.
7. Repeat steps 3 to 5 at 375 by 812.
8. Read the console messages. Expected: no error.
9. Close the browser, and stop the server.

Verification:

```sh
git diff --exit-code <FN0-head> HEAD -- fixtures/golden fixtures/ir fixtures/validate fixtures/surface src/core/ir.ts
deno task bench --full m1 m3 m4 --json /tmp/fn11-bench.json > /tmp/fn11-bench.txt; echo "bench exit $?"
deno task coverage; echo "coverage exit $?"
deno task rules:unfired > /tmp/fn11-unfired.log; echo "unfired exit $?"; tail -1 /tmp/fn11-unfired.log
deno task test:installation; echo "installation exit $?"
deno task behavior:capture <FN0-head> HEAD > /tmp/fn11-capture.log 2>&1; echo "capture exit $?"
awk '/^missing in /{m=1;next} m' /tmp/fn11-capture.log | command grep -vE '^(emit-error|lower-error) '
```

Expected: the first command prints nothing. Bench exit 0, and each large-input p90 is below 100 ms. Coverage exit 0, unfired exit 0, and `0 unfired rejection sites`. Installation exit 0. The capture exits 1, because FN6 unit 4 changes forged failure records. CAPTURE-RAN on `/tmp/fn11-capture.log` passes. The `awk` command prints nothing, subject to the variance rule of CAPTURE. The `new in HEAD` rows come from tests that the reset added, and from the changed failure records.

Then run GATE, and record the final counts in section 16. Run `git ls-files docs/plans` and confirm that this plan left that directory.

## 13. Order, stop rules, and recovery

Run the phases in this one order: FN0, FN1, FN2, FN3, FN4, FN5, FN6, FN7, FN8, FN9, FN10, FN11. A phase starts after the phase before it ends. Only FN7 can be skipped, under FND2 (b).

| Phase | Depends on | Reason |
| --- | --- | --- |
| FN0 | None | No commit can pass before it. |
| FN1 | FN0 | A capture stops at a failed test, so the flake must go before any capture. |
| FN2 | FN1 | The floors and the tool need a stable gate. |
| FN3 | FN2 | The kill checks need the tool. |
| FN4 | FN3 | A property can close a survivor, so FN3 reduces this work. |
| FN5 | FN1 | It needs a stable gate. It runs before FN6 to reduce test edits. |
| FN6, FN8, FN9 | FN4 | The stronger tests guard these changes. |
| FN7 | FN5, FND2 (a) | FN5 changes which names have importers. |
| FN10 | FN9 | Its shared checks compare with the state at the end of FN9. |
| FN11 | All others | It documents the final design. |

Stop a phase and report to the user in each of these cases.

- A verification command fails twice for the same cause.
- A capture or a snapshot shows a difference that the phase does not explain.
- A fixture update seems necessary. Only FN10 unit 2 updates a snapshot.
- A unit needs a behavior change outside section 6.
- A property finds a defect whose repair needs a language decision.
- A large-input p90 passes 100 ms.
- An executor reaches a turn budget twice on one unit. Then dispatch Fable or Codex Astra with the evidence, as the global instructions say.

To undo work, add reverting commits. Do not rewrite history. A later unit can depend on an earlier unit, so revert in reverse commit order, back to the failed unit. Then run GATE.

## 14. Completion criteria

The reset is complete when each row holds at the final commit.

| Criterion | Baseline | Target | Check |
| --- | --- | --- | --- |
| Gate | Exit 1 | Exit 0 | GATE |
| Gate under load | One failure in four runs | Three concurrent suites pass | FN1 |
| Fast test with a minimum at or over 1 s in three runs | 1 | 0 | FN1 time check |
| Coverage | No floor. 96.8% of lines, 94.26% of branches | Floors in place, at the final values | `deno task coverage` |
| Unfired validator sites | 0, as a report | 0, with exit 1 otherwise | `deno task rules:unfired` |
| Mutation scope of FN4 | 44 of 48 in a sample | Exit 0: each survivor has a test or a row | `deno task mutate` |
| Property tests of central invariants | 0 beyond the parser | 4, each with a kill count | FN3 |
| Tests that can use an entry point | 117 private imports | 0 | `tests/core_boundary_test.ts` |
| TypeScript lines in `src/` | 56,164 | Measured and recorded | `git ls-files 'src/*.ts' 'src/**/*.ts' \| xargs wc -l` |
| Functions at or above 49, not flat dispatch | 4 | 0 | FN9 measure |
| Tracked bytes | 18,882,001 | Measured and recorded | `git ls-files -z \| xargs -0 wc -c` |
| Golden, IR, validate, and surface fixtures | Base | Equal | FN11 first command |
| Browser flow | Last run 2026-10-21 | Pass, on the final commit | FN11 |
| Large-input p90 | Below 100 ms on 2026-10-30 | Below 100 ms | FN11 |

## 15. Validation

Codex Astra (`gpt-6-astra`, `xhigh`, read-only) reviewed this plan on 2026-10-31, at commit `c225085`. Its verdict was that the plan needed revision before execution. It reported 15 findings: five high, eight medium, and two low. It ran focused read-only probes. It did not rerun the full suites, coverage, mutation, capture, benchmarks, packaging, or browser checks.

The main session checked each finding against the source. All 15 hold, and this plan includes each correction.

| ID | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| A1 | High | Assignment is not transitive, so the FN3 law was false. A probe gave `A` fits `int`, `int` fits `B`, and `A` does not fit `B`. | FN3 unit 2 limits transitivity to types with no named type, asserts the nominal case, and uses `isAssignableIn` and `fits`. |
| A2 | High | `foreignSealedOf` and `childRefs` differ in meaning, and the emitter walkers visit different children. A merge changes diagnostics or output. | FN8 unit 1 shares only the non-`named` cases, after literal tests. FN8 unit 6 keeps four walkers and removes two `default:` arms. Section 9 rejects a shared emitter child function. |
| A3 | High | FN6 deleted fields of exported records, and section 6 did not allow that. | FN6 keeps the five internal rows. Section 6 lists the nine exported fields under FND2 (a), and FN7 removes them. |
| A4 | High | The `unsupported` merge also needs `tests/emit_test.ts` and `tests/outputs_generation_test.ts`. The capture holds hashes, and it exits 1 on a changed record. | FN6 runs that merge last and lists all three test files. It captures units 1 to 3 with held tests, and unit 4 with an expected exit 1. Exact assertions prove the messages. FN11 states the same exit. |
| A5 | High | The gate requires a `docs/api.md` row for each new script. | FN1 unit 4 and FN2 units 1 and 3 include that file. The main session had removed these rows in its own review, because it misread the file map. That was wrong. |
| A6 | Medium | The rename to `declaration_index.ts` escapes the guard at `tests/emit_families_test.ts:75`. | FN9 unit 4 changes the pattern, and a trial import proves it. |
| A7 | Medium | The mutation tool had no contract for type errors, timeouts, empty runs, or stale register rows. | FN2 adds a mutation contract. Register rows use source text, not line numbers. |
| A8 | Medium | `snapshot()` rejects the error states of P1, and P1 did not compare the second driver. FNF6 understated existing tests. | FN3 unit 1 adds `observe` and compares three results. FNF6 is corrected. |
| A9 | Medium | "Disproved" means that the assumptions contradict the predicate, not that one counterexample exists. A bounded domain can also hold no satisfying assignment. | FN3 unit 3 states both claims over each satisfying assignment, with bounds in the assumptions and a non-empty set. |
| A10 | Medium | The tutorial test runs at the repository root, so a relative lock path selects the repository lock. | FN1 unit 2 uses `--lock=${dir}/deno.lock`, and it checks that `deno.lock` stays unchanged. |
| A11 | Medium | FND3 (a) requires coverage in `deno task release`, but no unit added it. | FN2 unit 5 adds it, with a failure check. |
| A12 | Medium | The dependency table allowed FN10 before its checks existed. FN9 unit 5 omitted `src/core/typescript.ts`. One revert cannot always undo one unit. | Section 13 fixes one linear order and revert order. NAMES saves a list for each phase. FN9 unit 5 lists the file. |
| A13 | Medium | BYTES compared the working tree with the index, so a committed fixture change passed. | BYTES also compares the phase base with HEAD. |
| A14 | Low | FN0 lacked `NO_COLOR=1`. The FN1 downgrade check could fail for a dirty tree. FN10 NAMES did not allow a removed test. | Each check is corrected. |
| A15 | Low | `src/` has 56,257 tracked lines, of which 56,164 are TypeScript. The site count is 11,122, because the first scan also dropped `type_ir.ts`. The spread test pins one code, not two. | Sections 4, 7, 9, and 14 and FN9 unit 2 are corrected. |

Second pass. Astra checked the resolutions above and the revised units. Its verdict was "needs revision", with two high and three medium findings. The main session checked each finding against the source. All five hold, and this plan includes each correction.

| ID | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| B1 | High | The transitivity law of A1 was still false. A pure function fits its effect counterpart, and that type fits a union, but `nested` disables lifting inside a union. | FN3 unit 2 limits the law to primitives, literals, and arrays, tuples, and records of those kinds. It asserts both counterexamples as literals. |
| B2 | High | A capture with a failed test also exits 1 and prints no record rows, so the FN6 and FN11 checks passed on a capture that never finished. | Section 11 adds CAPTURE-RAN, and FN6 and FN11 use it. The main session tried its commands on one sample good log and one sample failed log. |
| B3 | Medium | Register rows did not identify one site: `src/core/predicates.ts:571,580` hold the same `return true;`. | FN2 adds `declaration` and `offset`. Each row must match exactly one site, and `tests/mutate_slow_test.ts` covers duplicates. |
| B4 | Medium | FN9 unit 4 required a path check that only unit 5 can meet. | FN9 has one path command for each unit. |
| B5 | Medium | FN9 omitted live documents. Astra named three files. The main session found more: 11 rows in `docs/language-rules.md`, and bare names at `docs/architecture.md:18,20`, `docs/builtin-changes.md:30`, `src/core/signatures.ts:4`, and two comments in the sites test. | FN9 units 4 and 5 list each file. |

Third pass. Astra checked only the five corrected places of the second pass, and it ran the path commands. It found one defect, C1 (medium): FN9 unit 4 omitted `tests/type_lowerer_named_test.ts`, whose comment cites `src/core/check.ts`, and which imports neither renamed module. The main session confirmed that `TypeLowerer` is in `src/core/type_lower.ts`. FN9 unit 4 now lists the file and names the correct path. No Astra pass ran after this one-line correction.

No pass ran the phases, the full suites, coverage, mutation, capture, benchmarks, packaging, or browser checks. Those results come from the planning runs of section 4 or from the phases themselves.

## 16. Progress ledger

| Phase | State | Entry SHA | Commits | Measurements and notes |
| --- | --- | --- | --- | --- |
| FN0 | Complete | `c2250852577f7ab31b4d11d21699e6c1f9082efb` | `33210d7`, `80dfbff` | Gate exit 0: 2,884 fast and 282 slow passed, none ignored. Three files changed, as planned. |
| FN1 | Complete | `80dfbff` | `682cf52`, `1828afa`, `ad38702`, `18083c5` | Gate exit 0: 2,891 fast and 284 slow passed. Six slow suites ran in concurrent groups of three at load averages up to 106, with no failure. A first group failed `tests/repeat_slow_test.ts`, which `18083c5` fixed. Minimum fast-test time in three runs: below 1 s, at a load average of 23. All release checks passed, including the restore after a failed gate. Deviation: the rename of unit 3 landed in `682cf52`, because it was already staged. |
| FN2 | Complete | `18083c5` | `0687715`, `58caced`, `f029960` | Gate exit 0: 2,904 fast and 298 slow passed. NAMES: 27 added, 0 removed. `git diff --exit-code 18083c5 -- src` exit 0. `deno task coverage` exit 0: lines 96.77%, branches 94.26%, functions 99.14%. `deno task rules:unfired` exit 0: 0 sites. `deno task mutate` on `src/core/paths.ts`: 17 sites, 17 killed, exit 0. The report path gave exit 1 with `--tests tests/docs_test.ts`. In a clone with a branch floor of 96, `deno task release` exited 1, restored both files, and left the tree clean. Deviation: units 1, 2, and 5 share `0687715`, because the gate on unfired sites and the coverage task change the same files. |
| FN3 | Complete | `f029960` | `5ed2da1`, `12d67f9`, `f390feb`, `7923993`, `373d1a2`, and the commit that closes this row | Gate exit 0: 2,925 fast and 301 slow passed. NAMES: 24 added, 0 removed. `git diff --exit-code f029960 -- src` exit 0. SCOPE: four new test files, the plan, `docs/status.md`, and `docs/testing.md`. Kill checks (killed of 30): `db.ts` 12 with seed 11, `types.ts` 15 with seed 12, `predicates.ts` 25 with seed 13, `check_binary.ts` 20 with seed 14. Each run exited 1, as expected. `--only src/core/types.ts:1380` killed 1 of 1, `:1379` killed 2 of 2, and `--only src/core/predicates.ts:105` killed 1 of 1. COVERAGE: exit 0. Findings: FNF28 and FNF29 are open on the path of SBF28. They did not stop the phase: the rules give each result, no unit needs a repair, and a repair waits for a user decision. Deviations: P4 has the slow name, because its examples test takes about 2 s. P1 also queries retained revisions after later edits. |
| FN4 | Complete | `a1cc52e` | `f69caec`, `c57cf1f`, `e725875`, `0aa5f82`, `ecae590`, `c2d588f`, `6fb3c90`, and the commit that closes this row | Targeted mutation at seed 20261031: 1,359 sites, 1,334 killed, 24 survived with a register row, 1 timeout, exit 0. The first run left 143 survivors. After the solver tests, 114 remained: tests kill 90, and 24 are equivalent. The timeout is a kill by a hang at `types.ts:1056`. `git diff --exit-code a1cc52e -- src` exit 0. Coverage: lines 97.43%, branches 95.20%, functions 99.27%, so the floors rose to 97, 95, and 99. `docs/testing.md` lists the solver sites that no input can reach. Weak assertions: 41 of 55 rows replaced, and 14 stay (7 census guards, 3 file list guards, 4 long values that a later assertion pins). Five test programs were repaired, because they gave an extra or wrong code. Helper command: 5, down from 30. The five differ: `defect_test.ts` skips the diagnostics assertion, `predicates_test.ts` has a cast helper, `lower_test.ts` takes a checked project and does not validate, and `pure_function_type_validation_test.ts` and `sealed_identity_validation_test.ts` return other shapes and do not validate. Loop heads: 139 reviewed, 10 rewritten. Two loops stay, because each compares two results by design and has no literal: `concise_source_test.ts` compares with an expansion that uses a private name, and `revision_isolation_test.ts` compares with a fresh program. Deviation: `f69caec` fixes a flake outside the plan. `tests/emit_stream_slow_test.ts` raced two timers that do not start together, and it failed at a load average of 279. A 60 ms stall in a scratch copy reproduced the failure, and the test passes with that stall after the fix. The plan counted 133 loop heads and 1,359 sites. The loop count is 139 now, because the new tests add loops. |
| FN5 | Complete | `0e876d71e11689f456c90fbb059f6b3d07c29d0a` | `f437774`, `c8fd138`, and the commit that closes this row | 137 import statements moved in 62 test files (121 whole, 16 split), which is 208 names. The plan estimated 117 statements. A review script compared each changed file with its base: after import declarations are removed the text is equal, and each file keeps the same imported names. A check of declarations found 0 names that match an entry name but have another declaration, and 0 values that meet a type-only export. 101 statements stay private, because no entry exports their names. The ratchet test failed with `tests/cli_test.ts imports makeDiagnostic from diagnostics.ts` when that import moved back. `git diff --exit-code 0e876d7 -- src` exit 0. NAMES adds the two ratchet tests only. SCOPE lists 62 test files and the plan. Coverage exit 0 at 97.43%, 95.20%, and 99.27%. Gate: 3,005 fast and 301 slow passed. Deviation 1: unit 1 splits a statement that has both public and private names, because the ratchet rule rejects any public name. Deviation 2: the ratchet needs no exemption for the property tests of FN3, so it has none. The rule is stricter than the plan. |
| FN6 | Complete | `d64b7cb7bc9baae4f32e076752a6b10dc0887178` | `0642a6e`, `983c339`, `aa9f89a`, `fe574d1`, and the commit that closes this row | Result: `git diff --shortstat d64b7cb fe574d1 -- src` gives 12 files, 47 insertions, 369 deletions. Unit 1: all five index fields deleted, and a table test of `isArrow` passed on the old code before the change. Unit 2: all five rows deleted, no row kept: `BuiltinInstance.name`, `ModuleContext.services`, `World.module`, `Parser.count`, `Resolver.id`. Unit 3: 81 codes give the same category before and after. The registry now requires a key of the form `${Category}/${string}`, and a trial key `sytnax/001` fails the compile with TS2353. Unit 4: 13 sites merged, each with an exact test of tag and message, and `emit/scope.ts:497` gained its first test through a forged emission context. BYTES exit 0. Coverage exit 0 at 97.42%, 95.20%, and 99.30%. Gate: 3,003 fast and 301 slow passed. Capture of units 1 to 3 with held tests (`25afed1` to `aa9f89a`): the first run gave exit 1, with 0 new and 1 missing clean `program` record. The rerun gave exit 0, 0 new, and 0 missing, on 32,473 records each, so the first result was run variance. Capture of unit 4 (`aa9f89a` to `fe574d1`): exit 1 as expected, and CAPTURE-RAN passes. Its filter printed 1 new and 1 missing `check`, 1 new `emit`, and 3 new and 3 missing `lower`, which is more than the plan expected. Cause: unit 4 deleted one test and added one test. Proof: the capture from `aa9f89a` to the temporary commit `2c78c67`, which holds that test set constant, gave 14 new and 14 missing, all `emit-error` (12) and `lower-error` (2), on 32,473 records each. NAMES against FN5: 11 titles change the word `unsupported` to `internal`, 3 index test titles change, 4 index tests leave, `emitModule keeps the span...` leaves, and 3 tests are added (`isArrow`, `categoryOf`, the `scope.ts:497` site). Deviation 1: `tests/tsc_test.ts` read the `category` field, so unit 3 changed it. Deviation 2: `docs/api.md` described the `unsupported` tag, so unit 4 changed it. Deviation 3: the plan allowed the file rename but did not name title changes. A title that says `unsupported` would be false, so the titles changed. |
| FN7 | In progress | `e4892dc6da4884bbef56e6255c58950cb97c2858` | | |
| FN8 | Not started | | | |
| FN9 | Not started | | | |
| FN10 | Not started | | | |
| FN11 | Not started | | | |
