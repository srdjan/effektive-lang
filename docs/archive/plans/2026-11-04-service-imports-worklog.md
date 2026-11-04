# Worklog: service imports

Status: complete. All accepted review findings are resolved. All required gates pass before the final archive commit.

The authority is [the service imports plan](2026-11-04-service-imports.md).
This worklog records evidence and steering for that plan. It introduces no separate ID prefix.

## Current objective

Add `imports Users from "./users-service.eff"` and infer function requirements within the module's declared service set.

## Accepted steering

The user selected explicit source paths. The user then removed the proposed leading `module` keyword.
This direction replaces the earlier requirement to write services on each exported function when a module uses service headers.

## Workspace

The branch is local `main`. Deno reports version 2.9.8.
Existing user edits affect `docs/api.md`, `docs/editor.md`, `docs/measurements.md`, and `docs/release-measurements.md`.
The sibling website initially has no changes.

The other workspace task committed its documentation as `b6e29b9`. The service-import work now builds on that commit.

## Evidence

The current declaration checker closes omitted exported `with` clauses in `src/core/check_declarations.ts`.
The interface builder already selects written or solved effect sets through `contractSets`.
The current Users example declares the contract with its functions. The host adapter imports that contract and provides the implementation.

The baseline `deno task check` passes: 2,818 fast tests and 263 slow tests. The command used Deno 2.9.8.
The baseline log is `/tmp/effektive-service-imports-baseline.log`.

## Current work and next action

The read-only compiler review found that existing import links, solving, interfaces, and IR can support this feature.
An independent Sol reviewer found the plan feasible after four corrections. The main agent accepted all four corrections.
The module bound includes requirements in produced values, but excludes requirements that occur only in input types.

Reserved Effect capabilities do not require service headers. Provider acquisition requirements remain after `provide`.
Acceptance now checks foreign service closure and propagation of interface hashes.
The compiler unit is committed as `5c16c83` after its complete gate passed.
The diagnostic follow-up is committed as `27dc90f`. Editor support is committed as `c239295`.
The corpus and playground package are committed as `a5893ca`. The website unit is committed as `a973f40`.
The review fixes are committed as `4deba49`. Final committed mutation checks pass, and both plan documents move to the archive.

## Compiler checkpoint

The executor chose contextual `imports` syntax with the existing `ImportDecl` node.
`ImportEntry` distinguishes ordinary imports from service imports. A header and ordinary import for the same module produce one combined IR import.
Correction: ordinary imports without a service header retain separate IR entries. The final review identified and corrected the initial broader merge.
The first public test failed before implementation with `syntax/009` for `imports` and `unknown-name/001` for `Users`.

The executor owns compiler files and `tests/service_imports_test.ts`. The main agent will review its diff and run the complete gate.
The main agent independently ran `deno test --allow-read tests/service_imports_test.ts` during syntax integration.
The test still failed because exported requirements remained closed. Its log is `/tmp/effektive-service-imports-focused-initial.log`.

The main agent repeated the focused command after export inference changed. The first public test now passes.
The main agent reviewed the initial syntax, index, resolver, lowering, and bound-checking diffs.
The parser now shares statement termination checks between ordinary imports and service headers.

The main agent emitted an in-memory module with a service header and an ordinary import from the same source.
The output combines both bindings in one TypeScript import and gives `find` the type `Effect.Effect<User, never, Users>`.
The main agent confirmed that an ordinary import of an undeclared service produces `requirement-contract/002` when called.

The first full fast-suite check reports 2,818 passes and one failure: the new diagnostic lacks a registered error fixture.
The compiler executor also owns the focused project under `fixtures/errors/requirement-contract-service-import-bound/`.
The main agent ran the expanded focused suite independently: all 12 tests pass.

The suite checks inference, module bounds, provider acquisition, returned contracts, internal Scope, foreign interfaces, incremental updates, lowering, validation, and emission.
The main agent requested small additions for duplicate headers, contextual identifier compatibility, and unused local functions.
The executor completed those additions. The focused file now has 13 tests.

The executor returned its compiler unit. The main agent started the complete gate after reviewing the source and tests.
The first complete gate stopped at formatting. The executor formatted its owned files.
The next gate found two surface-snapshot failures because the new error project adds one CLI case.

The main agent regenerated the surface snapshot. The only change adds the expected new diagnostic and its origin note.
The main agent restarted the complete gate after checking that snapshot diff.
The complete compiler gate now passes. The log is `/tmp/effektive-service-imports-compiler-check.log`.
That gate passed 2,835 fast tests and 263 slow tests.

## Corpus mapping

A separate read-only Sol agent mapped the fixture and website migration.
The contract module must own shared data, errors, and `Users` to avoid a module cycle.
The migration changes service, error, and type identities from `users` to `users-service`.

The corpus unit must update validator fixture inputs and generated manifests as well as ordinary golden output.
The website manifest must include the contract module as a companion of `users.eff` and `main.eff`.
The website typecheck harness removes one-line local imports and combines panels. It needs explicit contract dependencies for each affected panel.

The website requires an asset version increase when `site.js` changes. The selected next site version is `0.14.2`.
The compiler version remains `0.14.1`. No release, tag, or publication is authorized.

## Mutation

The small run used committed `5c16c83` and the full fast suite in temporary copies.
Command: `deno task mutate --seed 1 --sample 1 --workers 4 src/core/parse.ts src/core/declaration_index.ts src/core/resolve.ts src/core/check_declarations.ts src/core/check_project.ts src/core/lower.ts`.
All six sampled faults were killed. The run found no unregistered survivor or stale row and reported 14 seconds.

The expanded run keeps every option except `--sample`, which changes from `1` to `3`.
The logs are `/tmp/effektive-service-imports-mutation-small.log` and `/tmp/effektive-service-imports-mutation-expanded.log`.
The expanded run killed 17 of 18 faults. It found one unregistered survivor and no stale row, in 27 seconds.
The survivor changes an existing guard in `Resolver.expr` from `&&` to `||` when a `layer` argument is not a name.
The main agent added a public regression for an invalid layer key in a module with a service header.
The regression must enter a commit before mutation can test it, because mutation reads committed HEAD.

The main agent also targeted the new parser and bound-checking guards through `--only`.
The targeted small run killed both sampled faults. Increasing only the sample size tested all 24 selected mutations.
That run killed 19 faults and exposed five uncovered mutations: two alias checks, two origin checks, and one malformed-header check.

The main agent added assertions for named output contracts, the `from` keyword, and direct-call origin spans.
The main agent removed a redundant origin filter. `contractOrigins` already checks whether the body carries the requested capability.
That change also retains origin notes when an invalid written function bound omits an active requirement.
The strengthened focused suite passes all 14 tests. A committed rerun remains required.

The targeted logs are `/tmp/effektive-service-imports-mutation-targeted-small.log` and `/tmp/effektive-service-imports-mutation-targeted-expanded.log`.

## Editor, corpus, and cleanup checks

The main agent reviewed editor source and tests, then passed 92 focused editor tests independently.
The main agent fixed six LSP expectations caused by the contract split. All 52 LSP tests then passed.
The split preserves separate symbols for the consumer and contract. A failed consumer no longer blocks its independent host companion.

The five simplification reviews covered reuse, quality, efficiency, test value, and comments.
Accepted changes cache hover occurrences, reuse import syntax for completion, stop scanning past the cursor, and remove a duplicate type-table argument.
The changes also remove three redundant private helper comments. Existing file overviews and the produced-input exclusion note remain.

Broader caching, batched origin queries, and combined highlighter passes were not necessary for this feature.
The test review found that empty validation and emission maps could pass one existing test's loops.
A separate output test now asserts both module keys and the emitted Effect requirement. Existing proof tests remain intact.

The focused compiler, editor, and LSP check passed 159 tests after cleanup. The separate output test also passed.
The origin regression fails in a temporary copy with the original filter. It passes with the simplified filter.

The first integrated gate passed 2,848 fast tests but found five remaining slow fixture assumptions.
Those assumptions concerned deterministic edit counts, module counts, file lists, source positions, and a watch-test message.
The corpus executor corrected them. All 1,920 seeded property edits still run with unchanged validation and emission checks.

The main agent found that the playground package omitted the new contract module.
The package test failed before the build list changed. It now checks that the actual bundled sources compile without diagnostics.
The two package tests pass. The final integrated gate passes 2,848 fast tests and 263 slow tests.

## Playground browser check

The main agent checked the Users example at 1440 by 1000 and 390 by 844 pixels.
The page shows the service header, the contract tab, inferred generated types, and zero compiler problems.
The mobile TypeScript tab opens correctly. Neither viewport has document-level horizontal overflow.

The browser reported one `/log` 404 because the test server used `--no-log`. No compilation failure occurred.
The main agent closed its isolated tab and stopped its test server. The pre-existing browser tab remains open.

## Committed mutation checks

The committed targeted rerun kills all 23 selected mutations in the new parser and module-bound functions.
It reports no unregistered survivor or stale row. Its log is `/tmp/effektive-service-imports-mutation-targeted-committed.log`.

Correction: the invalid-layer regression does not kill the older resolver mutation. The committed broader sample still kills 17 of 18 faults.
The surviving change only adds a lookup for a non-name argument. Name and missing arguments take identical branches under both guards.
A non-name expression cannot match a declared identifier or a prelude name. The lookup finds nothing and changes no `outerUses` entry.

The main agent records that source proof as an `equivalent` row in the mutation register.
The register row must enter a commit before the broader mutation command can read it.
The invalid-layer test remains a public diagnostic regression, but it is not evidence that this mutation was killed.

The editor and playground small sample kills all five selected faults with no unregistered survivor or stale row.
Its command names `editor.ts`, `editor_completion.ts`, `editor_tokens.ts`, `playground/src/highlight.ts`, and `playground/build.ts`.
The expanded run changes only `--sample 1` to `--sample 3`.
The expanded editor and playground run kills all 15 selected faults. It reports no unregistered survivor or stale row.

## Website verification

The website executor delivered draft 0.75 and asset version 0.14.2. The compiler version remains 0.14.1.
The main agent repeated the site tests: 12 passed. The strict panel check passed 65 units with no missing panel.
Five canonical published files match the compiler fixtures byte for byte. The updated main gate passed 2,848 fast and 264 slow tests.

The main agent reviewed the website diff, including imports, error tags, grammar, and direct panel dependencies.
The mini-book browser check exercised Lookup, Rename, and Recover at 1440 by 1000 pixels, then Collect at 390 by 844.
The mobile specification contains the separate contract and consumer. All checked views show the service header without document overflow or console errors.

The main agent closed its isolated tab and stopped only its own server. The existing user server and browser tab remain open.
The main agent corrected the specification to retain other body requirements after `provide`.
The specification now states the input-only exclusion, contextual identifier rule, and restrictions on host interface files.

## Independent review checkpoint

The formal review found missing keyword completion after a service header newline. The previous-token helper skips newlines.
The review also found that merging every import changes legacy IR when a module has two ordinary imports from one source.
The main agent confirmed that baseline `b6e29b9` produces two imports and the current source produces one. Both results pass independent validation.

The review requested an exported deferred-constant bound test and an entry-point type import cleanup.
The main agent also found a status-row overclaim: inferred failure actions and written-bound repairs are different editor actions.
These changes await the review receipt before editing primary source.

The TextMate grammar colors late service-header forms even though the compiler rejects their placement.
The review found no valid identifier or call misclassified by that rule. The plan does not require color parity for invalid source.

The main agent read the solution that requires a differential probe before accepting an equivalent row.
The probe compares 55 public-API cases over missing, named, literal, parenthesized, structural, function, field, and Option arguments.
It covers module scope, function scope, and nested shadowing. Its sanity case requires the expected layer diagnostic.

Diagnostics, lowering, independent validation, and emission are byte-identical between source and mutant for those cases.
The probe supports the static proof; it does not prove equivalence for every possible input.
The artifacts are in `/tmp/effektive-service-import-proof-kf4wok83/`, including `orig.jsonl`, `mut.jsonl`, and both `probe.ts` copies.

## Review fixes

The review receipt is complete: run `20261104-142719-73dac337`, with verdict `Ready with fixes`.
Its artifacts are in `/tmp/compound-engineering-501/ce-code-review/20261104-142719-73dac337/`.
Seven lenses completed. The review used Sol throughout and does not provide independence across models.

The compiler repair unit owns `src/core/lower.ts`, `tests/service_imports_outputs_test.ts`, and `tests/service_imports_test.ts`.
It addresses finding 1, legacy import preservation, and finding 6, public type imports.
It also adds the missing exported constant bound case. Its budget is 30 turns; acceptance uses the focused public tests.
The main agent owns finding 5, newline completion, in `editor_completion.ts` and `editor_service_imports_test.ts`.
The main agent also owns finding 2, the status wording. Acceptance requires focused tests and the complete project gate.

The main agent accepts all four actionable findings. No actionable finding is deferred.
The contextual `from` recovery remains greedy because the service name `from` is valid.
The invalid-source coloring difference does not change accepted source. No grammar change is necessary.

The newline completion regression fails before the fix and passes afterward.
The fix tracks the immediate preceding token, including newlines, and excludes EOF.
The public test covers empty source, a first header, semicolon-separated headers, newline-separated headers, and invalid late headers.
The main agent passes 85 focused editor tests. A separate five-test rerun includes the added empty-source case.
An initial command named a nonexistent editor test file. The corrected command passes; its log retains the successful result.

The website unit is committed separately as `a973f40` on local `main`.
Its final checks pass 12 site tests, 65 strict TypeScript units, and JavaScript syntax validation.
The website checkout is clean. No push, tag, deployment, or release occurred.

The compiler repair preserves separate ordinary imports unless their target also has a service header.
The main agent reviewed the lowering change and all new tests line by line, then passed 18 focused compiler tests independently.
The executor reports 49 focused tests, formatting, and diff checks passed. The main agent does not substitute that report for its gate.
The new constant test checks both an undeclared requirement diagnostic and the corresponding permitted header.
`FunctionType` now enters the test through `mod.ts`. The status text now describes the actual editor actions.

The main agent's full review-fix gate passes formatting, lint, type checks, 2,850 fast tests, and 264 slow tests.
Its log is `/tmp/effektive-service-imports-review-fixes-check.log`.
Review findings 1, 2, 5, and 6 are resolved. The exported constant testing gap is also closed.
No justified actionable finding remains. Parser recovery and invalid-source coloring retain the documented evidence limits.

## Acceptance reconciliation

The main agent reopened the plan after review fixes. The following evidence covers all 16 acceptance checks.

| Plan checks | Evidence |
| --- | --- |
| 1-2: header syntax and rejection | Public parsing and project tests cover relative paths, host paths, positions, missing targets, and interface restrictions. |
| 3-6: solved requirements and module bounds | Public project tests cover recursion, imported calls, unused headers, pure functions, and undeclared methods. |
| 7-9: provision and compatibility | Tests cover acquisition requirements, written function bounds, legacy export closure, and separate ordinary IR imports. |
| 10: incremental propagation | Project revisions check changed requirements, interfaces, hashes, and downstream diagnostics. |
| 11: lowering and emission | Output tests require nonempty module maps, independent validation, and generated Effect requirements. Golden fixtures cover combined service imports. |
| 12: published agreement | The main gate builds published source examples. The site passes 12 tests and 65 strict TypeScript units. |
| 13-14: produced values and inputs | Tests cover deferred outputs, returned functions, exported deferred constants, input-only contracts, and internal Scope. |
| 15: provider acquisition | The public test removes Users and retains Config after provision. |
| 16: foreign closure | Interface tests include foreign service declarations and methods, then check hash propagation. |

The main agent checked both browser views and preserved user-owned sessions.
The review receipt covers all five implementation units. Final archival records the completed checks and the local commits.

## Final committed mutation checks

Both final small samples pass on `4deba49`: six compiler faults and five editor or playground faults are killed.
Both expanded runs change only `--sample 1` to `--sample 3`.
The compiler run kills 17 faults and accepts the one registered resolver equivalent. It reports no stale row or unregistered survivor.
Its log is `/tmp/effektive-service-imports-final-compiler-mutation-expanded.log`.

The editor run kills 14 of 15 faults. The remaining fault changes the public completion guard for missing modules and negative offsets.
This sample differs from the earlier sample because simplification changed the available mutation sites.
The main agent adds public checks for a missing module, a negative offset, and an offset after the source.
All six service-header editor tests pass. The expanded editor command must run again after this test enters a commit.
The failed sample remains in `/tmp/effektive-service-imports-final-editor-mutation-expanded.log`.

Targeted checks kill the selective import-merge fault and both EOF-guard faults in completion.
These checks use `--sample all --workers 1` and the corresponding public test file.
The lowering site is `src/core/lower.ts:1566`. The completion site is `src/core/editor_completion.ts:261`.
The logs end in `final-lowering-mutation-targeted.log` and `final-completion-mutation-targeted.log` under `/tmp/effektive-service-imports-`.

The gate after the invalid-offset regression passes: 2,851 fast tests and 264 slow tests.
Formatting, lint, and type checks also pass. The log is `/tmp/effektive-service-imports-offset-check.log`.
The website manifest receives its separate contract unit and companion dependencies in the final alignment commit.

The expanded editor rerun on `1a8c903` kills all 15 sampled faults, with no unregistered survivor or stale row.
Its log is `/tmp/effektive-service-imports-final-editor-mutation-expanded-rerun.log`.
The targeted completion-guard run kills all six faults at `editor_completion.ts:437` using the six public service-header editor tests.
Its log is `/tmp/effektive-service-imports-final-offset-mutation-targeted.log`.
The final mutation checks pass. The registered resolver equivalent retains its static proof and 55-case differential evidence.

## Completion

All five plan units and all 16 acceptance checks are complete. No actionable review finding or implementation question remains open.
The compiler commits are `5c16c83`, `27dc90f`, `c239295`, `a5893ca`, `4deba49`, `80bfd90`, and `1a8c903`.
The website commit is `a973f40`. The compiler stays at 0.14.1, with unchanged IR version 8.
The website assets use 0.14.2. This asset stamp is not a compiler release.

Mutation evidence covers the named samples and targeted guards, not every possible fault.
The review uses seven completed Sol lenses. It does not supply independence across models.
Website TypeScript checks cover paired target panels; they do not prove isolated source fragments compile.
Browser evidence covers the named desktop and mobile views. User-owned sessions remain open.
The next action belongs to the user: review the local commits.

The final archive gate passes formatting, lint, type checks, 2,851 fast tests, and 264 slow tests.
Its log is `/tmp/effektive-service-imports-archive-check.log`. Both plan documents now live under `docs/archive/plans/`.

## Follow-up: deferred values in argument transfers

A later review reports that `setRef` can store a new deferred value that requires an undeclared service.
The main agent's public regression reproduces the gap: the expected `requirement-contract/002` is absent.
The active requirement set and `void` result contain no evidence of the stored computation.
The earlier completion checks did not cover this transfer through an input reference.

The repair stays within the accepted bound. It checks produced values that calls transfer outside the current computation.
Unused parameter types retain their exemption. Provided execution requirements must remain removed.
The main agent owns `check_project.ts`, public tests in `service_imports_test.ts`, and this evidence file.
A read-only Sol reviewer checks argument facts, pipelines, and the repair design, with a budget of 20 turns.
Acceptance requires the reported negative case, a permitted-header control, unused inputs, reference updates, and provided computations.
The main agent will run focused tests, the complete gate, and committed mutation checks before final completion.

The design review found that scanning every argument type rejects a function that only forwards an input reference.
The repair follows local aliases, parentheses, input fields, and input reference reads before checking a transferred value.
Reference updates inspect callback results. Inline and aliased identity callbacks preserve the input-only exemption.
Ordinary calls and service calls check locally produced arguments. Pipeline calls include their left value as the first argument.
Reference builtins require direct syntax. The initial piped-reference test correctly produced an existing syntax-use diagnostic and was removed.

The original write regression fails before the repair and passes afterward. The public transfer tests cover aliases, updates, calls, service calls, and pipelines.
Positive controls preserve unused inputs, input forwarding, field reads, identity updates, provided scalar writes, and provision inside deferred computations.
A separate negative case confirms that outer provision does not remove a stored computation's future requirement.
A constant callback test covers a deferred value reached through a locally constructed record.
The main agent passes all 23 focused compiler and output tests. The change adds no syntax, type field, or IR field.

The independent repair check found one additional false positive in an identity callback held in a local record.
The main agent reproduced that false positive, then resolved concrete record fields to their value origins.
The origin walk also handles record spreads and destructured local bindings. It stays iterative and guards cycles.
The positive controls now cover direct, aliased, field-held, copied, and destructured identity callbacks.
A matching negative control stores a newly produced deferred value through a callback in a local record.
All 23 focused tests pass after that correction. The full gate before that correction passed 2,856 fast and 264 slow tests.
The final source requires a new full gate because the record-field origin logic changed.

The final repair passes formatting, lint, type checks, 2,856 fast tests, and 264 slow tests.
The log is `/tmp/effektive-service-transfer-final-check.log`.
The main agent reviewed the complete diff, including the correction from the independent check.
The reported escape now produces `requirement-contract/002`. The matching header permits the operation.
The remaining action is mutation against the committed repair, followed by its evidence update.
