# Fable review of the draft list

The Fable reviewer worked in a snapshot of `6ae0538` with the draft list. Its probes were in `/tmp/fable-probes/`. This file records its findings as it reported them. Section 8 of the plan resolves each one.

PHF-F1. Target PH1. Confirmed fact, wrong change. The reproduction holds: `build probe-f2 --no-log` exits 0 with 0 diagnostics and one U+FFFD pair in `m.ts` (M). `Deno.readTextFileSync` keeps a leading BOM, and `new TextDecoder("utf-8", { fatal: true })` removes it (M: first character `feff` and length 17, against `74` and length 16). Use `{ fatal: true, ignoreBOM: true }`. The product reads go through `denoFs.readText` (`src/host/deno_io.ts:29`), which `src/cli/session.ts:142`, `src/host/workspace.ts:141`, `src/lsp/projects.ts:365`, and `src/lsp/features.ts:291,303` call (M), so one fix covers the CLI and the LSP. Add a BOM case to the test.

PHF-F2. Target PH8. Understated. `behavior_compare.ts` exports each revision with `git archive` and passes the fixtures of the head tree to both runs (`scripts/behavior_compare.ts:219`, `:305-326`). If each revision builds its own forged inputs, a lowering change makes them differ, and the comparison stops holding the inputs constant. `readForged` reads `manifest.json` and the source paths of the manifest (`behavior_corpus.ts:421-432`). Correction: run the head `validate_fixtures.ts` writer into the exported fixtures tree before both runs, and keep `readForged`.

PHF-F3. Target PHD1. Confirmed, incomplete change. The checker requires three inline closures (`src/core/check_builtins/scope.ts:160`), and `using` has its own lowering (`src/core/lower.ts:438-551`), apart from `invokeWithResource` (`:669-670`, `:784-802`). `using` shares the diagnostic text "withResource requires three inline arrow callbacks" (`scope.ts:160`) and the callback name "withResource" (`scope.ts:165,171,179`). After option (a), a `using` block would name a builtin that no longer exists. Rename them. The corpus count holds for the fixture projects only: `fixtures/ir/resource-case.eff:3` calls `withResource(`, 12 test files name it, and the website specification has 8 mentions. `src/core/resolve.ts:89` holds the prelude entry.

PHF-F4. Target PH13. Wrong change. `main.ts:231` calls `session.sync()` again after `check --fix` writes, and that call can give `unchanged` (I). Removal of line 225 needs a cast or an internal throw. Drop PH13.

PHF-F5. Target PH3. Confirmed, change larger than needed. With `build.ts:95` changed to a loop, `check` prints all 130,000 diagnostics and the count line (M). `:88,89` grow with the module count, `:112,116` with the tsc output, and `main.ts:272` with the fix count. Fix `:95`, and `:112` as a defensive step.

PHF-F6. Target PHD2. Overstated. The website specification calls `log("ready")` (`effektive-spec.html:288,292`) and documents `now()` (`:64`, `:1419`), and `fixtures/ir/empty-effect.eff:2` calls `run(defer(...))` (M). Options (b) and (c) would break specification examples and an IR fixture. Option (a) stands; record these sites.

PHF-F7. Target PH14. Definitions by file (M): `checkText` 4 files, `diagnosticsOf` 6 files plus `tests/helpers.ts:722`, `offsetOf` 4, `isRecord` 4. `tests/helpers.ts` has only `diagnosticsOf`. Three of the four need a new shared helper. Measure body equality first.

PHF-F8. Target PH10. `src/core/lower.ts` has 12 `fact?.kind !==` sites, not ten, and 30 `throw internal(` in total (M). Two differ in shape (`:1063` returns, `:1334` has a compound condition). Keep them out of the helper.

PHF-F9. Target PH9. Confirmed. The manifest has 157 paths in three categories, all under `src/` or `playground/src/` (M). The inventory walk covers exactly those roots (`scripts/coverage.ts:9,255-259`), so the inversion loses only the check that a listed file still exists. The RCP-3 reason (`docs/archive/plans/2026-11-05-codebase-reset-plan.md:610`) survives, because the exception lists keep their reasons. The 32 commits are not verifiable in a snapshot.

PHF-F10. Target PH4. Confirmed, one site missing: `tests/internal_sites_test.ts:1-3` says "Thirteen sites throw an internal failure: two in the lowering and eleven in the emitter". `src/core/lower.ts` has 30 and `src/core/emit/` has 38 (M).

PHF-F11. Target PH6. A smaller change exists: refuse a body without `Content-Length` with status 411. The session map and the restart reset stay as the plan says.

PHF-F12. Target PH7. LCOV zero counts per range (M): resolve 808-826 15 of 17, resolve 336-346 6 of 11, check_expr 852-858 5 of 6, check_expr 876-880 1 of 5, check_expr 893-898 5 of 5, project_config 2 of 2, 5 of 5, 6 of 6, emit/expr 1534-1547 9 of 14, parse 873-878 5 of 5. `opaque type X = int` gives `syntax/012` and then `syntax/008`; the test must use `opaque type X` alone.

PHF-F13. Target PH18 and PHD6. Five live links and one comment must change: `docs/status.md:236`, `docs/inferred-input-contracts.md:92`, `docs/measurements.md:117`, `docs/language-rules.md:752`, `scripts/logs_report.ts:19` (M). `tests/docs_test.ts:37` checks each relative link. `docs/evidence/` is 308 KiB. PHD6 has three links: add `docs/measurements.md:111`.

PHF-F14. Target PHD5. `docs/logging.md` lists each of the three kinds once, and `scripts/logs_replay.ts:209-212` names `cli.change` in a comment and a message (M). No script consumes their data.

PHF-F15. Target PH16. Confirmed: `docs/development.md:28,38,39` list the three tasks, both scripts import the same four kernel names, and no measure test exists (M).

PHF-F16. Targets PH2, PH5, PH11, PH12, PH15, PH19, PHD4. Confirmed. PH2: the build exits 0 and `deno fmt --check` rejects `m.ts`; `emit/expr.ts:331-341` have 0 hits; the inner `split` and `splitAdaptive` at `:337,339` have 0 calls, and the outer pair at `:347,349` has 427 and 484 (M); `tests/emit_slow_test.ts:121` runs fmt on `forms.ts`. The 16 Schema builders appear on the website 4 or more times each, and the validator has no importer outside `scripts/` and `tests/` (M).

PHF-F17. Missing, harden: the false count in `tests/internal_sites_test.ts:1-3`.

PHF-F18. Missing, decision: `docs/api.md` holds a 210-line source file map with 191 rows, and `tests/docs_test.ts:96` requires it to name every file under `src`, `bench`, `scripts`, and `playground` (M). Options: (a) keep it for its descriptions, (b) one row per directory. Fable recommends (a).

PHF-F19. Missing, prune: 14 test files build `new Deno.Command(` at 22 sites, while `tests/process_helpers.ts:13` exports `deno(cwd, args)`. 10 of the 14 pass `stdin` or `env`, so the helper needs an options parameter. Delta needs measurement.

Fable found no larger missing item. The 61 uncovered lines of `src/core/validate/refinements.ts` are about 30 ranges of 1 to 7 lines, which fits defensive branches.
