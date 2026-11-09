# Common brief for the 2026-11-09 pruning and hardening scouts

## Project

Repository: `/Users/srdjans/Code/effektive-lang` at commit `6ae0538` on local `main`.
Effektive is a language that compiles `.eff` source to Effect-TS TypeScript. It runs on Deno 2.9.8.
The pipeline is: lex, parse, resolve, check, lower to typed IR, emit TypeScript. The validator (`src/core/validate/`) re-checks the IR and is kept as a test oracle only.
The CLI is in `src/cli/`, the language server in `src/lsp/`, the shared host adapters in `src/host/`, the VS Code client in `editors/vscode/`, the browser playground in `playground/`, the measurement harnesses in `bench/`, and the task scripts in `scripts/`.
Read `AGENTS.md`, `docs/development.md`, and `docs/architecture.md` first. `docs/api.md` has a map of the source files. `CONCEPTS.md` has the shared terms.

## Goal

The user asked for a hardening and pruning list. Find unnecessary complexity, and find ways to reduce the design to a minimum without loss of functionality. This is the cleanup step before more features.

Functionality means: every accepted source form and its diagnostics, the IR, the emitted TypeScript, the CLI output and exit codes, the LSP responses, the VS Code client features, and the playground features. A pruning item keeps all of them. An item that removes functionality is a decision for the user. Mark it as kind `decision` and say exactly what a user loses.

A hardening item is a defect or a probable defect: a crash, a hang, wrong output, a silent wrong result, a missing check of outside input, or a document that states a false fact.

## Already done: do not propose these again

The repository had eight pruning passes since 2026-10-20. The plan registry is `docs/plans/README.md`, and the finished plans are in `docs/archive/plans/`.

- 2026-11-09 (`docs/archive/plans/2026-11-09-deeper-modules.md`): module merges, every unused export removed (0 remain), one-use private helpers inlined where readable, a census of redundant checks at every site of eight patterns (ledgers RC1 to RC6 in `docs/archive/plans/2026-11-09-deeper-modules-evidence/`), and try blocks reduced from 31 to 1.
- 2026-11-07 (`2026-11-07-untangle-knots.md`) and 2026-11-06 (`2026-11-06-untangle-codebase.md`): hidden links, needless links, drifted copies, stale workarounds, empty wrappers. Each has a "kept on purpose" list. Read it before you propose an item in the same area.
- 2026-11-02 (`2026-11-02-simplification-rebase.md`): 63 prelude names removed in groups G1 to G7, the validator product paths removed, tests that read private source text cleaned up.
- 2026-10-20 (`2026-10-20-hardening-pruning.md`): the first hardening and pruning list.

## Rejected or decided: do not propose these again

Propose one of these only with new measured evidence that the earlier reason no longer holds. Then say which reason changed.

- A rewrite of the pipeline, the parser, or the type table.
- A universal builtin registry. Structural work was measured at 6% to 21% of builtin lines.
- A merge of the checker and validator logic. Shared mistakes would pass both.
- A split of `src/core/check_expr.ts`. Its largest functions are flat dispatch.
- Removal of refinements or inferred inputs.
- Removal of `scripts/mutate.ts`, the surface snapshot, or the lexer snapshot.
- Removal of the validator (decision SRD4: it stays as a test oracle).
- Removal of `bench/`, the logging loop, `docs/archive/`, or the packaging checks (decision SRD3).
- Removal of the 9 basic effect names: `timeout` `sleep` `race` `uninterruptible` `repeat` `random` `randomInt` `updateRef` `withResource`.
- The emitter `ROWS` table, and each item on the kept lists of the 2026-11-06 and 2026-11-07 plans.

## Rules

- Do not edit, commit, checkout, restore, or stash in `/Users/srdjans/Code/effektive-lang`. Read only. Other agents read the same tree.
- For an experiment, such as a trial deletion or a probe script, make your own detached worktree: `git -C /Users/srdjans/Code/effektive-lang worktree add --detach ~/.claude/scratch/prune-2026-11-09/wt-<slice> 6ae0538`. Remove it at the end with `git -C /Users/srdjans/Code/effektive-lang worktree remove --force <path>`.
- The machine is shared with five other scouts. Run single test files (`deno test --allow-read tests/<file>_test.ts`), not the full suite, unless your brief says otherwise.
- Shell traps on this machine: write `command rm -f`, `command cp`, `command mv`, `command diff`, and `command ls`. The aliases prompt, page, or hang. Quote globs in git pathspecs. `git grep -E` ignores `\b`; use `-w` or `-P`.
- Mark each fact M (measured: give the command) or I (inferred from reading code). Never estimate a number. Write "needs measurement" when you have no number.
- Coverage: a merged LCOV report of the fast and slow suites at `6ae0538` is at `~/.claude/scratch/prune-2026-11-09/cov/all.lcov` when it exists. `DA:<line>,0` marks an uncovered line. Uncovered code is a candidate for dead code or for a missing test. Check which one.

## Handback

Return at most 15 candidate items, ranked by value: the lines or concepts removed, or the defect severity, for each unit of risk. Use this form for each item:

- ID (your slice letter and a number, for example B3) and kind: `prune`, `harden`, or `decision`.
- Where: `path:line` for each site.
- Evidence: M or I facts, with the commands.
- Change: the smallest change that solves it.
- Delta: measured lines, or "needs measurement".
- Proof: which check shows that functionality stays (a test file, `deno task behavior:compare`, golden files, a probe).
- Risk: what could break.

Then list the candidates that you checked and rejected, one line each with the reason. Keep the handback under 1,800 words. Do not include file contents or full logs.
