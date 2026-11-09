# Documentation audit

Prefixes: DA (findings), DAU (units).

Date: 2026-11-09. Base: `717509c` on local `main`. The user ran `/gotai:update-docs` for a full audit of the live documentation. Each claim in a live document must match the code, the manifests, and the tasks at the base.

## Scope

Live documents: 50 tracked Markdown files outside `docs/archive/`, `CHANGELOG.md`, and `.agents/`. The archive and the changelog are dated history and stay unchanged. The 109 broken links that `audit-docs.sh` reports are all in `docs/archive/`. A search of the live documents for the names that the pruning plan removed (`withResource`, `fixtures/validate`, `SourceMapOptions`, `sourcesContent`, `behavior:capture`) finds only correct text and the status lines that the user accepted under PH4.

## Common brief for each unit

- Work only in your worktree, a detached worktree at `717509c`. Do not run `git checkout`, `git restore`, or `git stash` in any tree. Do not touch `/Users/srdjans/Code/effektive-lang`.
- Read `AGENTS.md`, then each document of your unit. For each claim, check it against the code: a path exists, a command is a task in `deno.json` or a real CLI flag, an exported name exists with that signature, a count or a version matches, a described behavior matches the code or a CLI run. Run the CLI when a claim describes its output.
- Four operations only: cut a dead claim, correct a wrong claim, fold a duplicate plan list into `docs/status.md`, and simplify the text that you changed. Do not reword correct text. Do not add sections. Write a claim that you cannot derive from the code as a TODO, not a guess.
- Before you cut a claim about a missing name, check `git log -S` for a rename. A rename needs a correction, not a cut.
- Write in the style of the existing documents: ASD-STE100 Simplified Technical English, at most 20 words in an instruction and 25 in a description, active voice, no em dashes, no emojis.
- Do not edit `docs/archive/`, `CHANGELOG.md`, `.agents/`, code, tests, or fixtures. If a document is correct and the code is wrong, report it, and do not change either.
- Checks before the handback: `deno test --allow-all tests/docs_test.ts`, and `bash /Users/srdjans/Code/_skills/skills/update-docs/scripts/audit-docs.sh . | grep -v '^docs/archive/'` with no output.
- Commit in your worktree, one commit for each document that you changed. Use a short imperative subject and a body that names the evidence. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Handback, at most 400 words: the commits, and for each changed claim one line with the file, the old claim, the new claim, and the evidence. List each TODO and each code defect that you found. Do not return file contents.

## Units

| Unit | Model | Files | Acceptance | Turns |
| --- | --- | --- | --- | --- |
| DAU1 | Sonnet | `docs/api.md` | Each exported name and signature matches `src/core/mod.ts`, `src/core/frontend.ts`, `src/core/typescript.ts`, and the modules they export | 40 |
| DAU2 | Sonnet | `docs/language-rules.md`, `docs/tutorial.md`, `docs/builtin-changes.md`, `docs/rejected.md`, `docs/inferred-input-contracts.md` | Each source form, diagnostic code, and builtin matches the compiler; each changed example compiles | 40 |
| DAU3 | Sonnet | `README.md`, `AGENTS.md`, `CONCEPTS.md`, `docs/development.md`, `docs/testing.md`, `docs/architecture.md`, `docs/status.md`, `docs/plans/README.md`, `docs/plans/2026-10-19-application-acceptance-rule.md`, `docs/plans/2026-10-24-typescript-content-mappers.md` | Each path, task, directory, and count matches the tree and `deno.json` | 40 |
| DAU4 | Sonnet | `docs/editor.md`, `docs/installation.md`, `docs/integration.md`, `docs/logging.md`, `docs/measurements.md`, `docs/release-measurements.md`, `docs/refinement-measurements.md`, `editors/vscode/README.md`, `fixtures/applications/*/README.md` | Each command, setting, log kind, and path matches the code | 40 |
| DAU5 | Sonnet | `docs/solutions/**/*.md` | Each cited path, symbol, and command exists or carries a dated status line | 40 |

Each unit edits only its own files, so the units run in parallel worktrees. The orchestrator reviews each diff, applies it to `main`, and runs `deno task check`.

## Progress

| Unit | State | Commits |
| --- | --- | --- |
| DAU1 | running | - |
| DAU2 | running | - |
| DAU3 | running | - |
| DAU4 | running | - |
| DAU5 | running | - |
