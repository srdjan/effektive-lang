# Light FP Adoption Handover

## Current objective

Install the latest JSR Light FP lint in `effektive-lang` and repair every lint issue.
Keep all `0.8.0` rules and preserve compiler behavior.
The user paused this work on 2026-11-16. The pause remains active until the user resumes.

## Accepted constraints and decisions

The user required a worktree and withheld merge approval until review.
The user approved one dependency-age override for installing `0.8.0` from JSR.
The configuration retains Deno's default age policy.
The user accepted the full compiler migration, including function factories and required explicit arguments.
The source language, diagnostics, emitted output, and existing expected test values must remain unchanged.
The user requested retained implementation knowledge for a possible later skill. No skill exists.

The plan authority is [the adoption plan](../archive/plans/2026-11-16-light-fp-adoption.md).
The plan also owns the worklog and executor units.
The working knowledge reference is [the subset notebook](../light-fp-subset.md).
The earlier handover at `2026-11-16-142752-light-fp-adoption.md` describes an older checkpoint.
Current repository guidance and the latest user instructions govern continuation.

Sol executors use high effort. Each executor receives explicit file ownership and a turn budget.
Main reviews every output and independently checks changes.
Every commit requires `deno task check`. Mutation reads committed `HEAD` through `git archive`.
No push or merge is authorized. Preserve unrelated worktrees and both original main checkouts.

## Live project state

Parking time: `2026-11-16 16:49:40 UTC`.
Repository: `/Users/srdjans/Code/effektive-lang-light-fp-lint`.
Branch: `lint/light-fp-0.8.0`.
HEAD: `76d63bfed54072f964b66a91e658e4e4bdd59f5e`.
Subject: `Adopt Light FP lint 0.8.0 across the compiler`.
Base: `cbd367abca1bc33d5a35d81fe2d90a33836ca784`.
Deno: `2.9.8`.

The compiler checkout on main remains clean at the base commit.
The original website checkout remains clean at `4fcaac625de840533e1fef3cacac0ebfaf76231e`.
The companion website worktree is `/Users/srdjans/Code/effektive-light-fp-lint`.
Its branch is `lint/light-fp-ir-0.8.0`.
Its clean HEAD is `ca14f8218a1e47ca50bf19cd77e4658ae9dede96`.
That commit contains only the generated `public/typed-ir.ts` copy.

Nothing is staged. These paths are modified or untracked, including this handover:

```text
 M docs/api.md
 M docs/archive/api-migrations.md
 M docs/light-fp-subset.md
 M docs/plans/2026-11-16-light-fp-adoption.md
 M src/core/emit/module_state.ts
 M src/core/emit/tsc.ts
 M src/core/validate/guards.ts
 M src/core/validate/sets.ts
 M tests/editor_service_imports_test.ts
?? docs/handoffs/2026-11-16-164940-light-fp-adoption.md
?? tests/light_fp_emitter_mutation_test.ts
?? tests/light_fp_validator_mutation_test.ts
```

Ignored witnesses remain under `demos/light-fp-lint/`. Do not commit them.
The earlier memory extension points to the notebook and records verified lessons.
Its path is `/Users/srdjans/.codex/memories/extensions/ad_hoc/notes/2026-11-16T163116Z-light-fp-subset-evidence.md`.

All executors completed. Every known root command session settled.
No owned Deno task remains active. Port 8790 has no listener.
Main closed its playground browser tab and preserved the preexisting `about:blank` tab.
No operation remains unsettled. No remote write occurred.

## Completed work and evidence

The committed migration pins `jsr:@srdjan/light-fp-lint@0.8.0` in `deno.json`.
The lockfile holds its resolved integrity. The existing tasks and exclusions remain unchanged.
The initial census held 15,390 diagnostics across 205 files.
Strict lint reached zero diagnostics. The supplemental layer and suppression checks passed.

Seven signed `pure-module` exceptions cover inert initialization.
Six initialize readonly lookup tables in `src/core/resolve.ts`.
One creates the private invariant Symbol in `src/core/source.ts`.
Main reviewed each initializer. No blanket suppression or new exclusion exists.

Commit `76d63bf` passes the full gate with the companion website root:

```sh
EFFEKTIVE_SITE_ROOT=/Users/srdjans/Code/effektive-light-fp-lint deno task check
```

The gate passes format, lint, repository-wide type checks, 3,305 fast tests, and 325 slow tests.
Six fast tests remain ignored, as in the baseline.
The full gate log is `demos/light-fp-lint/full-check-candidate.log`.
The gate took about eight minutes because the two proof-budget tests each compile 10,000 functions.

Main compares all 497 behavior records against the original compiler. Every record matches exactly.
Both runs use the same generated forged-IR corpus.
The records are `demos/light-fp-lint/behavior-base.json` and `behavior-candidate.json`.
The lexer keeps all 20,000 expected snapshot hashes.
The direct-array parser matches 190 complete fixtures and passes the prefix oracle.

Browser checks pass for default compilation, diagnostic recovery, and file selection.
The report and witnesses are under `demos/light-fp-lint/autoqa/`.
The disabled logging route produced one HTTP 404. No compiler startup error appeared.

The website copy passes standalone type checking, 12 website tests, and 70 strict panel checks.
The paired IR slow tests pass. An explicit missing companion path fails instead of skipping.
`EFFEKTIVE_SITE_ROOT` selects the companion only for those slow tests.
The default still checks the normal sibling website.

The survivor register rebased 80 rows and retired eight removed sites. It now contains 156 rows.
Main independently passes the exact-site census.
The row ledger is `demos/light-fp-lint/mutation-register-rebase.md`.

The first mutation smoke run kills one lexer sample in 12 seconds.
The larger sweep at committed `76d63bf` samples one site in each of 117 modules.
It kills 107 samples and leaves ten survivors, with no timeout or stale row.
The sweep takes 185 seconds. Its raw log and report start with `mutation-sweep-76d63bf-`.
The exact module list is `demos/light-fp-lint/mutation-modules.json`.

Seven survivors now have public tests. Main passes all 13 tests across the three affected test files.
The combined green log is `demos/light-fp-lint/mutation-new-tests-main.log`.
Main independently reproduces the editor mutation failure in `editor-completion-mutant-witness.log`.
The emitter executor proves four exact failures in `emitter-mutation-proof.md` and its logs.
The validator executor proves two exact failures in `validator-mutation-*` logs.
Main reviewed both new test files and those witnesses.

The seven cases cover service completion, safe error fields, null defaults, closure guards, schema field adapters, boolean state, and refinement paths.
The selected field-adapter mutation targets `retry-schedule || schema`, not the later function term.
The new public emitter test therefore uses a forged imported host schema field.

The other three survivors receive smaller source changes, still uncommitted:

- Main removes the unused `isFalse` helper and its type alias.
- Main replaces two header-marker searches with direct matching at the first space.
- Main removes a custom comparator from native string sorting.

Main also removes a synthetic string argument from the emitter's open-state query.
The query now reads its actual captured state directly.
The focused owner-query run passes six tests.
The guard cleanup passes 143 tests. The parser and sorting cleanup passes 143 tests.
Main compares 2,835 header cases and 2,801 string-list cases with the original compiler. No result differs.
The differential witness is `demos/light-fp-lint/native-simplification-compare.log`.
No new survivor row was registered after the sweep.

## Unfinished or blocked work

The latest full gate predates all dirty source and test changes listed above.
The current tree needs final lint, type checks, and the full gate before another commit.
The latest zero-lint census predates the last header and sorting simplifications; focused lint passes those two files.

Main has not run `demos/light-fp-lint/mutation_overlay_review.ts`.
That script independently reruns all seven exact mutations in an archived `76d63bf` tree with the new tests overlaid.
It preserves the shared worktree and removes its temporary archive.

After the remaining unit passes the gate and is committed, mutation must run against the new committed HEAD.
The earlier sweep cannot prove that new tests kill the final committed candidate's selected samples.
The same seed can select different sites after source simplification changes each module's site count.
Every new survivor needs a public test or a specific source proof.

The notebook still describes an ongoing migration. The active plan needs final evidence and completion status.
The final completion commit must archive the plan and update its links and registry path.
The plan remains the only execution authority. Do not create a second plan.
No skill creation, release, push, or merge is pending authorization within this task.

## Evidence limits

The mutation sweep is bounded. It does not exhaust the initial 12,800-site inventory.
It covers 117 eligible modules with 12,682 sites, using one sample per module.
Four browser adapters have no changed supported mutation expression. Twelve modules contain no mutation site.

Parser samples remain slower than the original under host load.
The latest eight paired samples measure 40.51-50.59 ms for the original and 62.04-73.41 ms for the candidate.
Each sample parses the tutorial file 1,000 times.
The full gate and unrelated processes ran during that measurement. No isolated regression ratio or performance parity is established.
The raw samples are `demos/light-fp-lint/parser-final-main-samples.log`.

The winning lexer avoids source-length scratch buffers.
Ten 16 MiB comment runs measure median peak RSS of 60,424,192 bytes, against the original 65,658,880 bytes.
This measures the process, including its runtime. It does not isolate lexer allocation.

The class-specific TypeTable prototype fault test was retired because it cannot reach factory-owned closure methods.
Public configuration recovery and differential update tests remain. They do not prove unexpected check-stage rollback.
The plan records the source trace and its limits. Do not add a testing-only production hook.

Coverage has not run on this migration. No new coverage-floor claim exists.
The broader documentation audit reports historical broken links. No broad documentation repair belongs to this task.

## Next authorized step

After the user resumes, main will independently run the seven mutation witnesses:

```sh
deno run --allow-read --allow-write --allow-env --allow-run=git,tar,deno demos/light-fp-lint/mutation_overlay_review.ts
```

The command runs from `/Users/srdjans/Code/effektive-lang-light-fp-lint`.
It tests the exact sampled mutations from committed `76d63bf` with the current test overlays.
Main will then reconcile the results and continue the accepted lint-adoption objective.

## Resumption

The next session must first read active `AGENTS.md` guidance, including `/Users/srdjans/AGENTS.md`.
The next session must compare this snapshot with live repository state before editing.
The next session must preserve newer changes and reconcile differences.
This handover provides context. Current instructions and live state govern continuation.
The user must resume before task advancement continues.

## Next-session prompt

```text
Read `/Users/srdjans/Code/effektive-lang-light-fp-lint/docs/handoffs/2026-11-16-164940-light-fp-adoption.md` first. Compare its recorded state with the live repository. Preserve newer changes. Continue with the independent seven-mutant review in `demos/light-fp-lint/mutation_overlay_review.ts`.
```
