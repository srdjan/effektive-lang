# Try blocks

This ledger records each try block under `src/` after the deeper-modules work, with its decision. Opus wrote it on 2026-11-09.

The census command is `git grep -n -E '(^|[^A-Za-z0-9_])try \{' -- 'src/*.ts'`. The pattern needs `try` as a whole word, because `try \{` alone also matches names such as `DeclEntry {`.

| Revision | Try blocks |
| --- | --- |
| `de8d0e5` (baseline) | 31 |
| `c1d0f15` (after the four units) | 29 |
| `e16f546` (after the adapter pass) | 25 |

## Removed

| Site | Commit | Proof |
| --- | --- | --- |
| `src/core/lower.ts`, try/finally around a resource region | `c1758cd` | Only `lowerModule` catches a `LowerFailure`, and it discards the lowerer. No code can read `resourceBindings` after a throw. |
| `src/core/validate/expr.ts`, try/finally in `withLocals` | `5a3b0c0` | `validate/index.ts` makes a new `BodyValidator` inside each guard. No code reads the locals after a throw. |
| `src/host/deno_io.ts`, `writeText` | `e16f546` | It caught every error into a message, as `attempt` does. |
| `src/host/deno_io.ts`, `kind` | `e16f546` | It mapped every error to `missing`; `attempt` and one `if` do the same. |
| `src/host/deno_io.ts`, removal of the temporary directory of `denoCheck` | `e16f546` | The nested try ignored the error; `attempt` does the same. |
| `src/host/deno_io.ts`, try/finally around the poll race of `sourceEvents` | `e16f546` | A watcher error ends the process through `main` and `Deno.exit`, so a timer that stays has no effect. `debounceBatches` already clears its timer without a try block. |

## Kept

| Site | Kind | Reason |
| --- | --- | --- |
| `src/cli/main.ts:131` | try/finally | Releases the watch event iterator. |
| `src/cli/main.ts:162` | catch | The one exception boundary of `main`: an unexpected throw becomes exit 3. |
| `src/core/emit/emit.ts:183` | catch | Turns an `EmitFailure` into an internal `EmitError`. |
| `src/core/emit/tsc.ts:68` | catch | `decodeURIComponent` throws on a malformed escape in `deno check` output. |
| `src/core/lower.ts:1667` | catch | Turns a `LowerFailure` into an internal `LowerError`. |
| `src/core/project_config.ts:169` | catch | `JSON.parse` of `effektive.json` text. |
| `src/core/syntax.ts:230` | catch | `JSON.parse` decodes a string token. The lexer keeps a malformed token for recovery and stores no validity flag. |
| `src/core/validate/index.ts:46` | catch | The validator reads forged IR; a throw in one group becomes a diagnostic. |
| `src/core/validate/index.ts:53` | catch | The same boundary for the world table of malformed IR. |
| `src/host/deno_io.ts:24` | catch | `readText` maps `NotFound` to `not-found` and other errors to `unreadable`. `attempt` keeps only the message. |
| `src/host/deno_io.ts:44` | catch | `remove` maps `NotFound` to success. |
| `src/host/deno_io.ts:55` | catch | `entryKind` maps `NotFound` to `missing`. |
| `src/host/deno_io.ts:73` | catch | `list` reports a failed directory read with its path. |
| `src/host/deno_io.ts:80` | catch | A link whose target is missing or loops (`NotFound`, `FilesystemLoop`) is not a directory. Other errors fail the list. |
| `src/host/deno_io.ts:132` | catch | `attempt`: the shared place where a Deno exception becomes a `FileFailure`. |
| `src/host/deno_io.ts:149` | catch and finally | `deno check` runs as a subprocess. The finally removes the temporary directory. |
| `src/host/deno_io.ts:192` | try/finally | `debounceBatches` releases its source iterator. |
| `src/host/deno_io.ts:231` | try/finally | `sourceEvents` closes the watcher. |
| `src/host/log.ts:151` | catch | `JSON.parse` of a log line from a file. |
| `src/host/log.ts:186` | catch | `JSON.stringify` throws on data that cannot be serialized, such as a `bigint`. A test covers this case. |
| `src/host/workspace.ts:32` | catch | The workspace walk resolves link targets that can be missing. The CLI checks the root at its entry, so the other three callers of `fs.absolute` use it with no check. |
| `src/lsp/jsonrpc.ts:191` | catch | `JSON.parse` of a frame body from the client. |
| `src/lsp/positions.ts:105` | catch | `new URL` and `fromFileUrl` throw on a malformed URI from the client. |
| `src/lsp/server.ts:360` | catch | The exception boundary of request dispatch: a throw becomes an error response. |
| `src/lsp/server.ts:416` | catch | `#contain`: the exception boundary of notifications and flushes. |
