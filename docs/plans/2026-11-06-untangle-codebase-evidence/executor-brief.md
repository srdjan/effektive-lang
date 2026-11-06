# Executor brief (shared by every UNU dispatch)

You are a Sonnet executor for one unit of the untangle refactor of the repository effektive-lang, a
Deno 2.9.8 TypeScript compiler for the Effektive language. The plan is
`docs/plans/2026-11-06-untangle-codebase.md`. The evidence for each problem item (file:line) is in
`docs/plans/2026-11-06-untangle-codebase-evidence/survey-*.md`. The astra cross-check of the plan is in
`docs/plans/2026-11-06-untangle-codebase-evidence/astra-crosscheck.md`. Read the plan sections of your
fixes, the evidence lines of your items, and `docs/architecture.md` (layering rules and invariants).

## The goal of a refactor unit

Pieces that change together end up together. Pieces that do not change together are not tied.
Everything depends on what changes less. Remove the listed problems with the structural fix that the
plan names. Behavior must stay the same.

## Hard rules

- Emitted TypeScript text, source maps, IR, diagnostics, CLI output, and LSP output stay byte-identical.
  Never run `deno task golden:update`, `surface:update`, `validate:update`, `lex:update`, or `site:ir`.
  If a golden, surface, IR, lexer, or website-IR test fails, your change is wrong: fix the change.
- Diagnostic codes, messages, spans, and their order stay byte-identical. So do CLI and language server
  output and the website file `typed-ir.ts`, which `scripts/site_ir.ts` generates from `src/core/ir.ts`.
- Do not edit `src/core/ir.ts` unless your unit says so. `scripts/behavior_corpus.ts` must stay
  self-contained, with no import, because `behavior_compare.ts` copies it into old source trees.
- When you add, remove, or rename a production module under `src/` or `playground/src/`, update
  `fixtures/coverage/ownership.json`. For a module with only types, also update the type-only list in
  `tests/coverage_test.ts`.
- The validator `src/core/validate/` duplicates checker rules on purpose. Never share a rule between the
  validator and the checker. The validator may import only `ir.ts`, `source.ts`, `diagnostics.ts`, its own
  files, and types of `predicates.ts`.
- `src/core` does no I/O. `src/host`, `src/cli`, `src/lsp`, and `playground/src` import the core only
  through `src/core/frontend.ts`, `src/core/typescript.ts`, or `src/core/mod.ts`. The emitter must not
  import checker-phase modules. Tests import entry-point names only through the entry points.
- Use Result types for expected failures. Never use the `any` type or cast to `any`.
- Do not change test expectations, except where a test names an internal that you moved or renamed. In
  that case, change the import or the call, not the expected value.
- Do not delete a test unless the plan says so. Test pruning is a later unit.
- Remove a comment only when your change makes it false. Comment pruning is a later unit.

## Git and shell

- Commit each complete, isolated piece of work with a short imperative subject and a body that gives the
  reason. End each message with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never run `git checkout`, `git restore`, `git stash`, `git reset --hard`, `git rebase`, or `git push`.
  Other sessions share this repository.
- Write `command rm -f`, `command cp`, `command mv`, and `command diff`. The zsh aliases hang the shell.
- Read a line range of a large file, not the whole file. Filter command output with `grep`, `head`, or
  `tail`, and show only failures.

## Verification

- Run `deno task check` before each commit. It runs format check, lint, type check, the fast tests, and
  the slow tests (about 60 s). Test the exit status of `deno task check` itself, not of a pipe.
- Run `deno fmt` on the files you changed before the gate.
- Import graph: `deno run -A ~/.claude/scratch/untangle/deps.ts "$PWD" cycles` lists import cycles.

## Handback

When you finish, or when you reach your turn budget, stop and hand back at most 250 words:
the commits (sha and subject), the changed files by count, the result of the last `deno task check`
(passed or failed, with the failing test names), each listed problem item that you fixed, each item that
you did not fix with the reason, and the open issues. Do not paste file contents or full logs.
