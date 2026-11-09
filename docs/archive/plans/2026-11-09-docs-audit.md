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

Status: complete on 2026-11-09. The orchestrator checked each diff against the code and spot-checked the cited lines. `deno task check` at `ca13e8e` exited 0 with 3,019 fast and 301 slow tests passed. The later commits change only documents, and `tests/docs_test.ts` passed after each one.

| Unit | State | Commits |
| --- | --- | --- |
| DAU1 | done: seven claims of `docs/api.md` corrected | `5358971` |
| DAU2 | done at its turn budget: three claims corrected; lines 202 to 555 of `docs/language-rules.md` went to DAU2b | `b93c5a2`, `01b708b` |
| DAU2b | done: each rule with a diagnostic or an emitted form in lines 202 to 555 probed; one claim cut | `b3d89b6` |
| DAU3 | done: six claims corrected in three documents | `2a568ee`, `54e2622`, `82f1aea` |
| DAU4 | done: one claim of `docs/logging.md` corrected | `07b7e6e` |
| DAU5 | done: drifted line references and two facts corrected in 12 solution notes | twelve commits, `4d81e86` to `f26255e` |

## Findings

- DA1: `.gitignore` kept the exception `!fixtures/emit/scopes/host.ts` for a directory that the explicit scope removal deleted on 2026-11-02. `ca13e8e` removes it.
- DA2: these claims stay as written, because a check needs a long run or an outside source: "about 11,000 sites" for a full mutation run and "30,000 random cases" in `docs/testing.md`, and the Node.js versions in `docs/installation.md`, which come from the engines of outside packages.
- DA3: dated measurements stay as recorded. `docs/development.md` gives 454 records in 0.78 s on 2026-11-02, and a run on 2026-11-09 gave 465 records in 0.75 s. `docs/measurements.md` records the Ref update with Effect 4.0.5, and the bench now imports 4.1.2. A run on 2026-11-09 gave numbers close to the record.
- DA4: rows of `docs/language-rules.md` that describe only Effect runtime behavior were not probed. The self-capture rows rely on `tests/schema_recursive_adapters_test.ts` and `tests/schema_constructor_recursive_test.ts`.
- DA5: the link audit reports 109 broken links, all in `docs/archive/`. They point at probe files that the archived plans deleted, and the archive stays unchanged.
