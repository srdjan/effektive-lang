# Common brief for the PH units

## Project

Effektive compiles `.eff` source to Effect-TS TypeScript. It runs on Deno 2.9.8. The pipeline is: lex, parse, resolve, check, lower to typed IR, emit TypeScript. The validator in `src/core/validate/` re-checks the IR and is a test oracle. The CLI is in `src/cli/`, the language server in `src/lsp/`, the shared host adapters in `src/host/`, and the playground in `playground/`. Read `AGENTS.md` and `docs/development.md` in your worktree first. Your unit is one row of Section 10 of `docs/plans/2026-11-09-prune-harden.md`. Read the items of your unit in Sections 4 and 5 of that file.

## Rules

- Work only in your worktree. The orchestrator made it from local `main`. Check `git -C <worktree> log --oneline -1` first.
- Do not touch `/Users/srdjans/Code/effektive-lang`. Do not run `git checkout`, `git restore`, or `git stash` in any tree. Other agents work in the same repository.
- Commit in your worktree. Use one commit for each logical change, with a short imperative subject and a body that gives the reason. End each commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A unit for a defect starts with a test that reproduces the defect. Run it, and confirm that it fails for the reason of the defect. Then fix the defect, and confirm that the test passes.
- Tests use `Deno.test` and `@std/assert`. Test behavior through a public entry point: the CLI, an exported function, or the HTTP surface. Assert exact literal values. Do not put loops, branches, or computed expected values in a test; a table of literal cases is allowed. A fast test runs in under one second. A test that starts a subprocess goes in a file named `*_slow_test.ts`.
- Keep every other output the same: the diagnostics, the IR, the emitted TypeScript, the CLI output and exit codes, and the LSP responses. Do not change the golden files in `fixtures/golden/` or `fixtures/ir/` unless your unit says so.
- Never use the `any` type or a cast to `any`. Use `unknown` with narrowing.
- `fixtures/mutation/survivors.json` anchors each row at an offset from the start of its declaration. If you edit a declaration that has a row, check the row with the mutation tool.
- Shell traps on this machine: write `command rm -f`, `command cp`, `command mv`, `command diff`, and `command ls`, because the aliases prompt, page, or hang. Quote globs in git pathspecs. `git grep -E` ignores `\b`; use `-w` or `-P`.
- The machine is loaded by other projects. Do not run `deno task check`, the full fast suite, or the full slow suite. The orchestrator runs the full gate on `main`.

## Checks before the handback

1. `deno fmt --check`, `deno lint`, and `deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts'`.
2. Each test file that you changed or added, and each test file that your unit names.
3. After your last commit: `deno task mutate --seed 1 --sample 1 <module>` for each module under `src/`, `scripts/`, or `playground/` that you changed. The tool tests the committed HEAD. Exit 0 means that no register row is stale. If a timeout appears under load, repeat that line with `--only <path:line>`.

## Handback

Return at most 500 words:
- the commits (hash and subject),
- the `git diff --stat <base> HEAD` totals,
- for a defect: the failing test output before the fix, in one line, and the passing result after it,
- each check that you ran, with its exit code and pass and fail counts,
- each open issue.

Do not return file contents or full logs. When you reach your turn budget, stop and hand back your status and open items.
