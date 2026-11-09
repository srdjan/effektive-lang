# Deeper modules

Status: complete on local `main`. On 2026-11-09 the user set this goal: fewer and deeper modules, smaller interfaces, one check of data where it enters, one-off logic written where it is used, and no try/catch where it is not necessary. The user pushes; this plan does not.

## Baseline

Opus measured these values at `36d61d8` on 2026-11-09:

| Measure | Value |
| --- | --- |
| Source modules under `src/` | 157 |
| Try blocks under `src/` | 31 (an earlier count of 41 also matched names such as `DeclEntry {`) |
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

Opus reviewed each unit diff line by line and cherry-picked it into `main`. Opus then did DMM8 and removed one redundant check in `fixContracts` of `src/cli/main.ts`. The fallback `inputs.get(path) ?? ""` read a key of the map that the loop iterated.

| Measure | `de8d0e5` | `c1d0f15` |
| --- | --- | --- |
| Source modules under `src/` | 157 | 149 |
| Try blocks under `src/` | 31 | 29 |
| Exported names that no other file names | 70 | 0 |
| Lines that start with `export` | 1000 | 923 |
| Functions and methods | 1485 | 1425 |
| Private helpers with one use (10 lines or fewer) | 392 (76) | 337 (36) |
| Source lines | 51732 | 51486 |

| Check | Result |
| --- | --- |
| `deno task check` on `main` | exit 0: 3005 fast and 296 slow tests passed, in 44 seconds |
| `deno task behavior:compare de8d0e5 HEAD` | exit 0: 461 records equal, 0 changed, 0 missing, 0 added |
| `deno task mutate --seed 1 --sample 1` on the 10 changed modules with register rows | exit 0: 0 stale rows, 0 unregistered survivors |
| `deno task coverage` | exit 0: lines 97.41%, branches 95.39%, functions 99.26%; the floors are 97, 95, and 99 |

### Kept on purpose

The 29 remaining try blocks were boundaries or resource releases. A later pass removed four more; see [the try ledger](2026-11-09-deeper-modules-evidence/try-blocks.md). They wrap a Deno API, `JSON.parse`, `new URL`, `decodeURIComponent`, or a port that throws. Others turn an internal failure into a result, or release an iterator, a timer, a watcher, or a temporary directory.

The units kept a one-use helper in these cases: it is an entry of a dispatch table, a grammar production, a type guard that narrows, a generic that carries correlated typing, or a body with early returns. A helper also stayed when a declaration with a register row calls it. Each unit handback lists its kept helpers with the reason.

The first pass found no other redundant check. The second pass below read every census site. The remaining fallbacks read a `Map.get` result, an optional field, a possibly empty array, or outside input.

`db.ts` keeps an unexported `FileDiff` type for the result of `diffFiles`. `ProgramChanges` has optional fields, so a caller that reads `diff.set.size` needs the required form.

## Second pass: checks and try blocks

The goal hook found two gaps after the first pass. First, no unit had read every check site. Second, the try blocks had no ledger. Opus ran a second pass on 2026-11-09.

Opus judged each try block, removed four in `src/host/deno_io.ts` (`e16f546`), and wrote [the try ledger](2026-11-09-deeper-modules-evidence/try-blocks.md). The whole-word count is 31 at `de8d0e5` and 25 now.

Four Sonnet auditors read every site of five census patterns: a fallback after a map lookup, a `typeof` test, an `isRecord` test, an exit on `=== undefined`, and an internal throw. Each auditor wrote a ledger with one row for each site. The validator is out of scope, because it is a test oracle that must check IR that can be malformed.

| Unit | Area | Ledger rows | Removed or restructured |
| --- | --- | --- | --- |
| RC1 | `src/cli`, `src/host`, `src/lsp` | 89 | 8 ([ledger](2026-11-09-deeper-modules-evidence/checks-RC1.md)) |
| RC2 | front end, program, editor queries | 81 | 8 ([ledger](2026-11-09-deeper-modules-evidence/checks-RC2.md)) |
| RC3 | checker, refinements, lowering, types | 170 | 3 ([ledger](2026-11-09-deeper-modules-evidence/checks-RC3.md)) |
| RC4 | emitter and `typescript.ts` | 79 | 10 ([ledger](2026-11-09-deeper-modules-evidence/checks-RC4.md)) |

These are the main changes:

- The LSP narrowers check the document version and the new name once, with the shared shape helpers. Two LSP queries check the located project once.
- The editor hover and definition queries iterate map entries, so a second lookup and its undefined exit are gone.
- `linkModules` indexes module edges once, and the cycle diagnostic gets the module entries, so an internal throw is gone.
- `checkInitialization` carries the cycle nodes, so two lookups and two internal throws are gone.
- `buildSourceMap` stores the text and the line starts of each source with its record, so five fallbacks are gone.
- `liftedFrom` returns the function type, so `fit` needs no second lookup and no internal throw.
- `TypeScriptOutputs` returns the lowered module with its cache entry, so a non-null assertion is gone.

The kept sites check an entry point or a value that can really be absent, give a default for a missing key in a multimap, or guard a fact in a side table. A fact in a side table cannot reach the reader through the types. No site was changed to a non-null assertion or a cast.

| Check after the second pass | Result |
| --- | --- |
| `deno task check` | exit 0: 3005 fast and 296 slow tests passed |
| `deno task behavior:compare de8d0e5 HEAD` | exit 0: 461 records equal, 0 changed |
| `deno task mutate --seed 1 --sample 1 src/lsp/projects.ts` | exit 0: 0 stale rows, 0 unregistered survivors |
| `deno task coverage` | exit 0: lines 97.47%, branches 95.49%, functions 99.26%; the floors are 97, 95, and 99 |
