# Try blocks

This ledger records each try block under `src/` after the deeper-modules work, with its decision. Opus wrote it on 2026-11-09.

The census command is `git grep -n -E '(^|[^A-Za-z0-9_])try \{' -- 'src/*.ts'`. The pattern needs `try` as a whole word, because `try \{` alone also matches names such as `DeclEntry {`. A second census, `git grep -n -E '\.catch\(|\.then\([^)]*,' -- 'src/*.ts'`, finds no promise rejection handler.

| Revision | Try blocks |
| --- | --- |
| `de8d0e5` (baseline) | 31 |
| `c1d0f15` (after the four units) | 29 |
| `e16f546` (after the first adapter pass) | 25 |
| `e9abd5e` (one catch site for synchronous throws) | 6 |
| `1a55b60` (no release chain in the watch path) | 3 |

## Removed

| Site | Commit | Proof |
| --- | --- | --- |
| `src/core/lower.ts`, try/finally around a resource region | `c1758cd` | Only `lowerModule` catches a `LowerFailure`, and it discards the lowerer. No code can read `resourceBindings` after a throw. |
| `src/core/validate/expr.ts`, try/finally in `withLocals` | `5a3b0c0` | `validate/index.ts` makes a new `BodyValidator` inside each guard. No code reads the locals after a throw. |
| `src/host/deno_io.ts`, `writeText`, `kind`, and the removal of the temporary directory | `e16f546` | Each one caught every error into a message or ignored it, as `attempt` does. |
| `src/host/deno_io.ts`, try/finally around the poll race of `sourceEvents` | `e16f546` | A watcher error ends the process through `main` and `Deno.exit`, so a timer that stays has no effect. |
| 20 synchronous catch sites | `e9abd5e` | `caught` in `src/core/source.ts` returns the value or the thrown value as a `Result`. Each site now handles that `Result` with plain code. The list follows this table. |
| `src/host/deno_io.ts`, the finally of `denoCheck` | `e9abd5e` | The function removes the temporary directory after the catch, in sequence. |
| `src/cli/main.ts`, try/finally of the watch loop | `1a55b60` | The loop ends at the end of the events, when the iterator has already finished, or by a throw. After a throw, `main` returns exit 3 and the entry point calls `Deno.exit`, which closes the watcher. |
| `src/host/deno_io.ts`, try/finally of `debounceBatches` | `1a55b60` | It called `return` on its source. Only the watch loop called `return` on it, and that call is gone. The source has finished on every other path. The two `debounceBatches` tests still pass. |
| `src/host/deno_io.ts`, try/finally of `sourceEvents` | `1a55b60` | It closed the watcher. The process exit closes the watcher on every path that leaves the generator. |

The 20 synchronous sites of `e9abd5e`:

- JSON text: `src/core/project_config.ts` (`effektive.json`), `src/core/syntax.ts` (`decodeString`), `src/host/log.ts` (a log line), and `src/lsp/jsonrpc.ts` (a frame body).
- URI text: `src/core/emit/tsc.ts` (`decodeURIComponent`) and `src/lsp/positions.ts` (`new URL` and `fromFileUrl`).
- Deno calls: `readText`, `remove`, `entryKind`, the two catches of `list`, and `attempt` in `src/host/deno_io.ts`.
- Ports that can throw: `realPath` in `src/host/workspace.ts` and the write guard in `src/host/log.ts`.
- Internal failures: `src/core/lower.ts`, `src/core/emit/emit.ts`, the group guard and the world table in `src/core/validate/index.ts`, and the request and notification boundaries in `src/lsp/server.ts`.

## Kept

| Site | Kind | Why it cannot go |
| --- | --- | --- |
| `src/core/source.ts:19` | catch | `caught` is the one place that turns a synchronous throw into a `Result`. JavaScript has no other way to catch a throw. |
| `src/cli/main.ts:158` | catch | `execute` is asynchronous, so `caught` cannot take its throw. The test "an unexpected throw is an internal error with exit code 3" in `tests/cli_test.ts` needs this boundary. A promise `.catch` would be the same catch in another form. |
| `src/host/deno_io.ts:154` | catch | `Deno.Command` throws at once when it cannot start the process, and `output` rejects on a later failure. A run with a missing working directory returned `{"ok":false,"error":{"message":"Failed to spawn ... No such cwd ..."}}`. Without the catch, the CLI would give exit 3 and not the note `cannot run deno check`. |
