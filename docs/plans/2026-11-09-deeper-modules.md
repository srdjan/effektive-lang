# Deeper modules

Status: in progress on local `main`. On 2026-11-09 the user set this goal: fewer and deeper modules, smaller interfaces, one check of data where it enters, one-off logic written where it is used, and no try/catch where it is not necessary. The user pushes; this plan does not.

## Baseline

Opus measured these values at `36d61d8` on 2026-11-09:

| Measure | Value |
| --- | --- |
| Source modules under `src/` | 157 |
| Lines with `try {` under `src/` | 41 |
| Exported names that no other file names | 70 |
| Private functions and methods with one use in their file | 392 (76 of them have 10 lines or fewer) |
| Fast suite | 3005 passed, 0 failed, 4 seconds |

## Rules for all units

The change preserves behavior. The diagnostics, the IR, the emitted TypeScript, the CLI output, and the LSP responses stay the same.

A module merge moves the code of a small module into its only importer, or into the module that owns its concept. The merge deletes the old file, updates every import, and updates the source file map in `docs/api.md`.

An inline replaces a private helper that has one call site with its body at that call site. Inline a helper when its body is one-off logic and the call site stays easy to read. Keep a helper when it is a grammar production of the parser, an entry of a dispatch table, recursive, or a name that a comment cannot replace.

An unexport removes `export` from a name that no other file names. When the name is then unused, delete it.

A check is redundant when the type system or an earlier check at the entry already proves its result. Remove a redundant check. Keep a check of input from outside the process: a file, JSON text, an LSP message, or a subprocess output.

Keep try/catch at the boundary where a Deno API or `JSON.parse` throws. Keep the internal-failure conversions of the lowerer, the emitter, and the validator. Remove a try/finally when no caller can observe the state that the finally block restores.

Do not change a declaration that has a row in `fixtures/mutation/survivors.json`, and do not inline a helper into such a declaration.

## Units

| Unit | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| DMU1 (adapters: CLI, host, LSP) | Sonnet | `src/cli/`, `src/host/`, `src/lsp/`, the tests and bench files that import a merged module, a comment in `editors/vscode/extension.js`, `docs/api.md` | Fast gate passes in the worktree. | 90 |
| DMU2 (emitter and validator) | Sonnet | `src/core/emit/`, `src/core/validate/`, `src/core/validate_project.ts`, `src/core/typescript.ts`, `docs/api.md` | Fast gate and the emitter slow tests pass in the worktree. | 90 |
| DMU3 (front end, program, editor queries) | Sonnet | `lex.ts`, `parse.ts`, `syntax*.ts`, `resolve.ts`, `declaration_index.ts`, `project*.ts`, `paths.ts`, `db.ts`, `interface.ts`, `diagnostics.ts`, `editor*.ts`, `source.ts`, `util.ts`, `result.ts`, `hash.ts`, `file_diff.ts`, `frontend.ts`, and the importers of a merged module, `docs/api.md` | Fast gate passes in the worktree. | 100 |
| DMU4 (checker, refinements, lowering, types) | Sonnet | `check_*.ts`, `check_builtins/`, `infer_*.ts`, `types.ts`, `type_*.ts`, `signatures.ts`, `predicates.ts`, `predicate_source.ts`, `linear.ts`, `lower.ts`, `service_bounds.ts`, `modes.ts` | Fast gate passes in the worktree. | 90 |
| DMU5 (integration) | Opus | all | `deno task check` exits 0 on `main`. `deno task behavior:compare 36d61d8 HEAD` exits 0. | direct |

The fast gate is `deno fmt --check && deno lint && deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts' && deno task test`.

Each Sonnet unit works in its own detached worktree under `~/.claude/scratch/`, made from local `main` at `36d61d8`. Opus cherry-picks each commit into `main`, then runs the full gate.

## Module merges

| Merge | Reason |
| --- | --- |
| DMM1: `src/cli/report.ts` into `src/cli/main.ts` | `main.ts` is the only importer. |
| DMM2: `src/cli/fix.ts` into `src/cli/main.ts` | `main.ts` is the only importer. |
| DMM3: `src/host/events.ts` into `src/host/deno_io.ts` | `deno_io.ts` is the only source importer. |
| DMM4: `src/lsp/methods.ts` into `src/lsp/protocol.ts` | The method names are part of the protocol. |
| DMM5: `src/core/emit/predicates.ts` into `src/core/emit/decls.ts` | `decls.ts` is the only importer. |
| DMM6: `src/core/file_diff.ts` into `src/core/db.ts` | `diffFiles` makes the input of `Program.update`. |
| DMM7: `src/core/hash.ts` into the module that owns the interface hash | Two importers use the one function. |
| DMM8: `src/core/result.ts` into `src/core/source.ts` | `source.ts` already re-exports `Result`. |

Opus kept these small modules on purpose: `emit/failure.ts`, `emit/emitted_module.ts`, `body_env.ts`, `host/ports.ts`, and `lsp/handler.ts` break import cycles. `validate/guards.ts` keeps the validator independent of the checker. The builtin family modules keep one file for each family in each stage.

## Results

Each unit adds its result here after Opus reviews it.
