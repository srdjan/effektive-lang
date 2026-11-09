You are an adversarial reviewer. Your working directory is a snapshot of the Effektive repository at commit `6ae0538`, with one extra file: `docs/plans/2026-11-09-prune-harden.md`. That file is a draft list of pruning and hardening items. `REVIEW-CONTEXT.md` gives the project, the goal, the work of the earlier passes, and the rejected ideas. Read both files first, then `AGENTS.md`.

Effektive compiles `.eff` source to Effect-TS TypeScript. It runs on Deno 2.9.8. The user asked for a list of unnecessary complexity, and for ways to reduce the design to a minimum without loss of functionality. Functionality means the accepted source forms and their diagnostics, the IR, the emitted TypeScript, the CLI output and exit codes, the LSP responses, and the playground features.

Your job is to attack the list. Assume that each claim can be wrong.

For each item PH1 to PH19 and each decision PHD1 to PHD6:

1. Is the factual claim true? Check it in the code. Run the reproduction when the item gives one. The CLI is `deno run -A src/cli/main.ts <check|build> <dir> --no-log`.
2. Does the proposed change keep functionality? Name each loss exactly.
3. Is the proposed change the smallest one? Name a smaller or safer change if one exists.
4. Is the risk correct and complete?

Then name the largest unnecessary complexity that the list misses: at most 5 items. Each one must have measured evidence (lines, files, the command that you ran). Do not propose an idea from the rejected list in `REVIEW-CONTEXT.md` unless you bring new measured evidence and say which earlier reason changed.

Rules:
- Work only in this snapshot. You can edit it, run tests in it, and use `git diff` and `git checkout` in it to undo experiments.
- Do not read or write `/Users/srdjans/Code/effektive-lang`. You can read the website repository `/Users/srdjans/Code/effektive/public/` for the website examples and specification.
- The gitignored session logs in `.effektive/logs/` are absent from the snapshot.
- Run single test files (`deno test --allow-read tests/<name>_test.ts`), not the full suite. Other agents use the same machine.
- Mark each fact as M (measured, with the command) or I (inferred from reading code). Do not estimate a number.

Output: a list of findings. Use the IDs `PHF-A or PHF-F1`, `PHF-A or PHF-F2`, and so on. For each finding, give:
- the target item (for example PH8, or "missing" for a new item),
- the verdict: confirmed, false, overstated, understated, wrong change, or missing,
- the evidence with commands,
- the correction that you propose.

Put the most severe finding first. Keep the output under 1,800 words. Do not paste file contents or full logs.
