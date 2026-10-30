# Development

This file gives the task commands, the repository layout, the error fixture
convention, the target lock, and the format and lint scope. The
[README](../README.md) gives a short overview.

## Commands

Run every command from the repository root.

| Command                       | What it does                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno task check`             | Runs the format check, the lint, the type check, the fast tests, and the slow tests.                                                                    |
| `deno task test`              | Runs the fast tests in parallel. It skips files named `*_slow_test.ts`.                                                                                 |
| `deno task test:slow`         | Runs only files named `*_slow_test.ts`, in parallel. They run `deno check`, `deno fmt`, and `deno run` with a fresh `DENO_DIR` that the task removes after.          |
| `deno task golden:update`     | Writes `fixtures/golden/<module>.ts` again from `fixtures/examples` and `fixtures/emit/traverse`, and the companion module `golden/host/providers.effi.ts`. Also writes `fixtures/ir/examples-baseline.json`, the IR snapshot of the examples. |
| `deno task validate:update`   | Writes the mutation fixtures in `fixtures/validate/` again from the current lowering.                                                                   |
| `deno task lex:update`        | Writes `fixtures/lex/snapshot.json` again from the current lexer. Run it only after a deliberate change of the lexer output.                            |
| `deno task behavior:capture`  | Compares two revisions using instrumented compiler entry points during tests, including subprocesses. See the capture note below. Use it for refactors. |
| `deno task logs:report`        | Prints a Markdown report of the session logs: `[--since <N>(m|h|d)] [folder ...]`. The default window is 24h and the default folder is `playground/.effektive/logs/`. |
| `deno task logs:replay`        | Runs a logged session again on the current build: `<session.jsonl>`. Exit 0 when the outcomes match, 1 at the first difference, 2 for a usage error or an unsupported session. It skips `--tsc`, and it does not replay watch sessions. |
| `deno task measure`           | Prints the lines, branches, and cyclomatic numbers of the files that you name, as JSON.                                                                 |
| `deno task measure:functions` | Prints the branches and cyclomatic number of each function in the files that you name, as TSV.                                                          |
| `deno task effektive`         | Runs the command-line tool. See [Using the command line](api.md#using-the-command-line).                                                                |
| `deno task lsp`               | Runs the language server over standard input and output. See [Language server](api.md#language-server).                                                 |
| `deno task bench`             | Runs the measurement harnesses. See [Measurements](measurements.md).                                                                                    |
| `deno task playground:build`  | Writes the playground page to `playground/dist/`. See [Playground](api.md#playground).                                                                  |
| `deno task playground:serve`  | Builds the playground page, then serves it on `http://127.0.0.1:8790/`.                                                                                 |
| `deno task package`           | Builds standalone CLI/server bundles and the complete local VSIX. See [installation](installation.md).                                                  |
| `deno task test:installation` | Checks reproducible packaging and isolated offline installation.                                                                                        |
| `deno task test:vscode`       | Runs installed VSIX acceptance in a local VS Code application.                                                                                          |
| `deno task fmt`               | Formats the source files.                                                                                                                               |
| `deno task lint`              | Runs the linter.                                                                                                                                        |

The capture records completed calls to `checkAnalysis`, `Program.update`,
`lowerModule`, `emitModule`, and `validateModule`, including returned error
results where present. It excludes its own tests and does not record every
lower-level checker call. The temporary hooks embed their destination path, so
child processes need write permission but no environment permission. A recording
failure fails the capture visibly.

## Layout

The core reads files only through `SourceHost`. It calls no Deno API. Tests may
use Deno APIs. [architecture.md](architecture.md) describes the pipeline and the
layering rules. The file-level map of `src/` is in
[api.md](api.md#source-file-map).

| Directory         | Content                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`       | The core library. It is synchronous and does no I/O. `Program` memoizes frontend queries; `TypeScriptOutputs` separately caches generated text and maps. The `validate/` subdirectory holds the independent IR validator, and `emit/` holds the Effect-TS emitter. `emit/families/` holds one file for each builtin family of the emitter. |
| `src/cli/`        | The command-line tool. Deno APIs stay here, in `src/host/`, `src/lsp/main.ts`, `bench/`, `playground/build.ts`, `playground/serve.ts`, `scripts/`, and `tests/`.                                                                                                       |
| `src/host/`       | The host adapters that the command-line tool and the language server share.                                                                                                                                                                                            |
| `src/lsp/`        | The language server.                                                                                                                                                                                                                                                   |
| `editors/vscode/` | The VS Code client. It is plain JavaScript with no build step.                                                                                                                                                                                                         |
| `playground/`     | The browser playground. The page is in `src/`, the build in `build.ts`.                                                                                                                                                                                                |
| `scripts/`        | The scripts that the tasks run: golden files, mutation fixtures, behavior capture, the lexer snapshot, the measure scripts, packaging, and the VS Code smoke test.                                                                                                     |
| `tests/`          | Deno tests and test helpers.                                                                                                                                                                                                                                           |
| `bench/`          | The measurement harnesses of parts A8 and L5. They are not part of the core.                                                                                                                                                                                           |
| `fixtures/`       | Input files for the tests.                                                                                                                                                                                                                                             |
| `docs/`           | [Architecture](architecture.md), rules, status, API, measurements, and the archive of finished plans.                                                                                                                                                                 |

The directories of `fixtures/` are these.

| Directory             | Content                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/`           | The five example programs, the host interface file, and `users-live.ts`.                                                                                                                                   |
| `golden/`             | The expected emitted TypeScript of each example, and the companion module of its host interface.                                                                                                           |
| `emit/`               | Inputs of the emitter tests: `contextual-options.eff` and the `schema-*.eff` files (19 single-file programs), and the project directories `forms/`, `groups/`, `host-checks/`, `host-companion/`, `nominal-operators/`, `schedules/`, `scopes/`, `sinks/`, `traverse/`, and `unmatched/`. They are not golden examples, except that `traverse/` is the sixth golden module. |
| `host-boundary/`      | A wrong host module, captured `deno check` output, and `manifest.json`.                                                                                                                                    |
| `ir/`                 | `examples-baseline.json`, the IR, emitted text, source map, and interface hash of the examples, which `golden:update` writes, and the log example in `example/` with its IR fixture.                                                                                                                                                                        |
| `applications/`       | The application fixtures include three gate applications, the order-lifecycle witness for types with identity, and the portable-publisher witness for memory and SQLite. |
| `tutorial/`           | The project that `docs/tutorial.md` quotes. `tests/tutorial_test.ts` and `tests/tutorial_slow_test.ts` keep the two equal.                                                                                     |
| `host-adapter-files/` | A project with a typed host adapter for `effect/FileSystem`.                                                                                                                                               |
| `lex/`                | `snapshot.json`: hashes of the lexer output for a fixed corpus.                                                                                                                                            |
| `validate/`           | Mutated copies of lowered IR and `manifest.json`, which names the expected code of each.                                                                                                                   |
| `parse/`              | Valid syntax forms (`ok-*`) and recovery inputs (`recovery-*`).                                                                                                                                            |
| `errors/`             | One file or one project directory for each error case, with markers.                                                                                                                                       |
| `logs/`               | Small hand-written session logs (`*.jsonl`), one or more for each surface, for the tests of `logs:report`.                                                                                                |

## Error fixture convention

An error fixture is a file in `fixtures/errors/` or a project directory in
`fixtures/errors/`. Its name is `<category>-<topic>`, where the category is a
diagnostic category such as `syntax` or `module`. A host interface file error
uses the extension `.effi`.

A single file runs as a project with one module and an empty project file. A
file whose name starts with `syntax-` only goes through the parser.

A project directory holds its own `effektive.json` and the files of the case.
The test loads every `.eff` file of the directory as an entry. A host interface
file must have an import that reaches it.

A line that contains only `// error: <code>` marks one expected diagnostic. The
diagnostic span must start on the line directly below the marker. A diagnostic
code looks like `syntax/008`.

Several marker lines in a row all apply to the first line below the run. The
test compares the sorted list of file, line, and code. The case must produce
exactly the marked diagnostics and no others.

A missing token has an empty span. The span sits at the end of the last real
token. The marker goes above the incomplete line.

The files `fixtures/parse/recovery-*.eff` use the same markers. The files
`fixtures/parse/ok-*` and the files in `fixtures/examples/` must parse with no
diagnostics. The project files `fixtures/examples/effektive.json` and
`fixtures/ir/effektive.json` set the module roots.

## Target lock

The `--tsc` check and the generated `deno.json` pin `effect` and
`@effect/platform-node` to `EFFECT_VERSION`. Their transitive packages stay open
without a lockfile. In October 2026 a new `@effect/platform-node-shared` release
needed a newer `effect` and broke the gate. The file `src/cli/target_lock.json`
pins the full closure of 14 npm packages. `tscLock()` returns its text, and
`deno check` reads it as `deno.lock`.

Generate the file again after a change of `EFFECT_VERSION` or `TARGET_IMPORTS`.
Work in an empty temporary directory.

1. Write a `deno.json` with `"nodeModulesDir": "auto"` and the two entries of
   `TARGET_IMPORTS`.
2. Write a `package.json` with
   `{ "overrides": { "@effect/platform-node-shared": "<version>" } }`. Use the
   `EFFECT_VERSION` value as `<version>`.
3. Write `a.ts`. It imports `NodeFileSystem` from `@effect/platform-node` and
   `Effect` from `effect`.
4. Run `deno run --allow-read --allow-env --config deno.json a.ts`.
5. Delete the key `workspace.packageJson` from the new `deno.lock`. Save the file
   as `src/cli/target_lock.json`.
6. Run `deno fmt src/cli/target_lock.json`.

Only the `overrides` entry in `package.json` holds the shared package at the
target version. The same entry in `deno.json` does not.

## Application lock

The application harnesses copy `tests/application_lock.json` to `deno.lock` in
their temporary directory. They run `deno` with `--frozen`. A new release of
`@std/assert` or `@std/internal` then cannot change the gate.

A change to the configuration of a fixture in `fixtures/applications/` needs a
new lockfile. Without it, the harness fails with "The lockfile is out of date".
Generate the lockfile again in an empty temporary directory.

1. Copy `fixtures/applications/order-lifecycle/deno.json` to `deno.json`.
2. Write `a.ts`. It imports `Effect` from `effect` and `assertEquals` from
   `@std/assert`.
3. Run `deno cache a.ts`.
4. Save the new `deno.lock` as `tests/application_lock.json`.
5. Run `deno fmt tests/application_lock.json`.

## Root lock

The key `lock` in `deno.json` freezes `deno.lock`. A task fails when an import
needs a change of the lockfile. To change a dependency on purpose, run
`deno install --frozen=false`. Then commit the new `deno.lock`.

## Format and lint scope

`deno fmt` skips `docs/`, `src/core/ir.ts`, `editors/vscode/node_modules/`, and
every `.eff` and `.effi` file. The copy of `ir.ts` stays as it is in the sibling
repository. `deno fmt` checks `fixtures/golden/`. `deno lint` skips `docs/` and
`fixtures/golden/`, because generated code keeps unused handler parameters. It
also skips `editors/vscode/`, which holds plain JavaScript. Both tools skip
`playground/dist/`, but `deno fmt` checks `playground/index.html` and
`playground/app.css`. The shared Deno exclusion keeps local `.claude/worktrees/`
copies out of root checks.
