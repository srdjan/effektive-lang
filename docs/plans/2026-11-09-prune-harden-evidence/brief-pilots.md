# Common brief for the 2026-11-09 pilots

## Project

Effektive compiles `.eff` source to Effect-TS TypeScript. It runs on Deno 2.9.8. The pipeline is: lex, parse, resolve, check, lower to typed IR, emit TypeScript. The validator in `src/core/validate/` re-checks the IR and is a test oracle. Read `AGENTS.md` and `docs/development.md` in your worktree first.

The orchestrator wrote a pruning and hardening list. A copy is at `~/.claude/scratch/prune-2026-11-09/review-fable/docs/plans/2026-11-09-prune-harden.md`. Read only your item in it. Your pilot applies one item in a scratch worktree and measures the result. The pilot is evidence for the list. The orchestrator decides later whether the change goes to `main`.

## Rules

- Work only in your worktree, which the orchestrator made at commit `6ae0538`. Check `git -C <worktree> log --oneline -1` first.
- Do not touch `/Users/srdjans/Code/effektive-lang`. Do not run `git checkout`, `git restore`, or `git stash` there. Other agents work in the same repository.
- Commit in your worktree, one commit for each logical change, with a short imperative subject and a body that gives the reason.
- The change must keep functionality: the accepted source forms and their diagnostics, the IR, the emitted TypeScript, the CLI output and exit codes, the LSP responses, and the playground features. Do not change the golden files in `fixtures/golden/` or `fixtures/ir/`, unless your brief says otherwise.
- Do not change a declaration that has a row in `fixtures/mutation/survivors.json`.
- Run these checks in your worktree: `deno fmt --check`, `deno lint`, `deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts'`, and the test files that your brief names. Do not run `deno task check` or the full slow suite. The orchestrator runs the full gate later, when the machine is quiet. Other agents use the same machine.
- Shell traps on this machine: write `command rm -f`, `command cp`, `command mv`, `command diff`, and `command ls`, because the aliases prompt, page, or hang. Quote globs in git pathspecs. `git grep -E` ignores `\b`; use `-w` or `-P`.
- Mark each fact as M (measured, with the command) or I (inferred). Do not estimate a number.

## Handback

Return a short handback of at most 600 words:
- the commits in your worktree (hash and subject),
- `git diff --stat 6ae0538 HEAD` totals, split by `src/`, `tests/`, `fixtures/`, `scripts/`, `docs/`, and other,
- each check that you ran, with its exit code and pass and fail counts,
- each open issue, and each place where the item in the list is wrong.

Do not return file contents or full logs.
