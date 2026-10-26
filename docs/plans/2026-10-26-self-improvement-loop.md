# Self-improvement loop

This plan adds logs to the command-line tool, the language server, and the
playground. The logs let a person or an agent replay what a user saw, follow
the meaningful internal operations, and read the visible outcomes. A report
and a replay tool turn the logs into ranked findings and regression checks.
The user asked for this on 2026-10-26. This document is the plan authority.

The plan is tooling that the user asked for. It adds no language feature, so
the application acceptance rule does not apply to it.

## Current state

On 2026-10-26 the program persists no log:

- The language server writes failure lines to stderr (`src/lsp/server.ts`,
  `#stderr`) and sends option warnings as `window/logMessage`. VS Code keeps
  both in an output-channel log, but the Effektive extension is not installed
  on this machine, and the VS Code logs of the past 24 hours hold no Effektive
  entry.
- The command-line tool prints its report to the terminal and keeps nothing.
- The playground keeps nothing. `playground/serve.ts` prints two start lines.

Facts that bind the design:

- The tasks and the installed launcher grant `--allow-read --allow-write`, and
  for the CLI also `--allow-run=deno`. None grants `--allow-env`. A log path
  therefore cannot come from `HOME` or from an environment variable.
- The fast tests run with `--allow-read` only (`deno.json`, task `test`). A
  fast test cannot write a file. `scripts/test_slow.ts` runs `*_slow_test.ts`
  with `--allow-all`.
- `tests/docs_test.ts` requires each `.ts` file under `src`, `bench`,
  `scripts`, and `playground` in the source file map of `docs/api.md`.
- `main(args, io)` in `src/cli/main.ts` does all effects through the `HostIo`
  port, and in-process tests pass a memory `HostIo`.
- The server intake is `handle(frame)` for each frame and `afterBatch()` after
  the frames of one stdin read (`src/lsp/main.ts`). A flush publishes
  diagnostics after a batch, or on a timer when `debounceMs` is above 0. The
  output is `ports.send`. Text sync is incremental.
- The server reaches the disk through `HostFs`: reads, kinds in the
  configuration walk-up, lists in `readWorkspace`, not-found results, and
  writes on save (`src/lsp/projects.ts`, `src/lsp/features.ts`).
- `narrowInitializeParams` (`src/lsp/protocol.ts`) parses only `debounceMs`
  and `writeOnSave`. Nothing parses `rootUri` or `workspaceFolders`.
- The bench client sends `rootUri: null` (`bench/lsp_client.ts`).
- The playground runs only through `serve.ts` on 127.0.0.1:8790. The website
  does not host it.
- The core has a synchronous `src/core/sha256.ts`.

## Decisions

| ID | Decision | Choice |
| --- | --- | --- |
| LG-D1 | Surfaces | The CLI, the language server, and the playground, with one event envelope. |
| LG-D2 | Content | Full source text, kept on this machine, so a replay is exact. |
| LG-D3 | Switch | Always on, with a 7-day rotation. Each surface has an off flag for tests and for a user who wants none. |
| LG-D4 | First analysis | Analyze the proxies that exist now. Repeat on real logs after 24 hours of logging. |

## Design

### Location

Each surface writes into the `.effektive/logs/` folder of a project:

| Surface | Project folder |
| --- | --- |
| CLI | The folder that holds `effektive.json`, as the command line gives it. |
| Language server | The first workspace folder, or else `rootUri`, of `initialize`. With neither, the server logs nothing. |
| Playground | `playground/` in this repository. `serve.ts` writes the file. |

When the writer creates `.effektive/`, it also writes `.effektive/.gitignore`
with the single line `*`. So no log is committed in any repository, and no
project needs a configuration change.

Each session writes one file, `<surface>-<YYYYMMDD>-<session>.jsonl`. One file
per session avoids two processes that append to one file. At session start the
writer deletes `.jsonl` files and blobs whose modification time is older than
seven days.

### Event envelope

Each line is one JSON object:

```json
{ "v": 1, "t": "2026-10-26T15:39:28.123Z", "ms": 1234, "surface": "cli",
  "session": "7f0c...", "seq": 17, "build": "0.10.3", "kind": "cli.phase", "data": {} }
```

`ms` counts from session start with `performance.now()`, so durations do not
depend on the wall clock. `session` comes from `crypto.randomUUID()`. `build`
is the release version from `deno.json`, through a JSON import. A JSON import
passes `deno check`, `deno bundle`, and a `--no-config --cached-only` run.

### Source text

Source text goes into content-addressed blobs:
`.effektive/logs/blobs/<sha256>.txt`. SHA-256 makes a collision, which would
give a replay the wrong text, not a practical risk. An event names a file with
`{ path, hash }`. The writer writes a blob only when it does not exist, and it
touches the modification time of a blob that it uses again, so rotation keeps
it.

### Events

| Surface | Kinds |
| --- | --- |
| CLI | `cli.start` (args, cwd, project), `cli.input` (path, hash for `effektive.json` and each file that `readWorkspace` returns), `cli.phase` (name, ms), `cli.diagnostics` (code, file, range, message), `cli.output` (path, hash, bytes), `cli.tsc` (exit code, ms), `cli.change` (watch paths), `cli.end` (exit code, ms) |
| Language server | `lsp.in` and `lsp.out` (each full message), `lsp.batch` (the end of one stdin read), `lsp.flush` (a timer flush), `lsp.fs` (each `HostFs` call: operation, path, and result as kind, hash, entries, or not-found), `lsp.timing` (method, id, ms), `lsp.error` (the text that now goes to stderr) |
| Playground | `pg.start` (build, viewport, layout mode, examples hash, load time), `pg.select` (path, by click, key, or hash), `pg.edit` (path, changes as from, to, insert), `pg.compile` (path, ms, diagnostics as code, from, to, stale flag, saving label), `pg.hover` (offset, hit), `pg.problem` (code), `pg.view` (name), `pg.layout` (mode), `pg.error` (tag, message), `pg.end` |

A request gives one `lsp.out`. A notification gives zero or more.

The language server log is a wire log. A new module, `src/lsp/wire_log.ts`,
wraps the frame intake, `afterBatch`, the flush timer, `ports.send`, and
`HostFs`. It buffers events until `initialize` arrives, and reads
`workspaceFolders` and `rootUri` from that raw frame with `uriToPath` from
`src/lsp/positions.ts`. `src/lsp/main.ts` stays the wiring. The server logic
does not change.

The playground buffers events and sends them with `fetch(..., { keepalive:
true })` to `POST /log` on `serve.ts`, when the browser is idle and on
`pagehide`. A browser limits keepalive bodies in flight to 64 KiB, so one
batch stays below that size. When the page opens without `serve.ts`, the
first failed post stops the logging for that page.

### Trust boundary

`POST /log` is a trust boundary. `serve.ts` accepts a request only when all of
these are true:

- `Sec-Fetch-Site` is `same-origin`, or `Origin` is `http://127.0.0.1:8790`.
- `Content-Type` is exactly `application/json`. A cross-site page cannot send
  that type without a preflight, and `serve.ts` answers no preflight.
- The body is below a fixed limit, and it is a JSON array of envelopes with
  the expected shape.
- Each `session` matches the UUID pattern, and each `surface` is
  `playground`.
- The session file stays below a fixed total size.

`serve.ts` writes only into `playground/.effektive/logs/`. `?replay=<file>`
accepts only a basename that matches the session file pattern inside that
folder.

### Ports

`src/host/log.ts` defines an `EventLog` port with `append(kind, data)` and
`blob(text)`. The file adapter takes a small file-system port: write, append,
list with modification times, set the modification time, and remove. The fast
tests use a memory file system, because they cannot write. One slow test runs
the adapter on the real disk. The CLI receives the log through `HostIo`, which
changes `tests/cli_helpers.ts` and `bench/m5.ts`. The core imports nothing
from it.

### Off flags

- CLI: `--no-log`.
- Language server: `initializationOptions.log: false`, and the VS Code
  setting `effektive.log`, default `true`.
- Playground: `deno task playground:serve --no-log`.

Only spawned processes that run on a folder of this repository need the off
flag. That is the shared helper in `tests/cli_slow_test.ts`, which runs
`check fixtures/examples`. The other spawners already use temporary folders.
In-process tests pass the memory adapter.

### Report

`deno task logs:report [--since 24h] [folder ...]` reads the log folders and
writes a Markdown report. The default folder is `playground/.effektive/logs/`.
The report has these sections:

1. Sessions per surface and build.
2. Broken behavior: internal errors, failed requests, invalid parameters, bad
   frames, playground `pg.error`, each with its session and `seq`.
3. Latency: p50 and p90 per operation, against the 100 ms p90 diagnostics
   budget in `docs/release-measurements.md`.
4. Friction: diagnostics that appear and clear within one edit burst, the
   time from an error to its fix, hover requests with no answer, time with
   stale output, problem clicks, and view switches.
5. Outcomes: compile counts, the saving label, and files written.

### Replay

`deno task logs:replay <session.jsonl>` runs a session again on the current
build and compares the outcomes. Before it compares, it removes the values
that change from run to run: `ms`, `t`, `pg.compile` elapsed time, and the
memory fields of `effektive/stats`.

- CLI: rebuild the project files from the blobs in a temporary folder, run
  `main` with the original arguments, and compare the diagnostics and the
  output hashes. Replay skips the `--tsc` stage and reports it as skipped,
  because that stage needs the Deno cache and prints absolute paths.
- Language server: feed the `lsp.in` messages to a new server with memory
  ports, call `afterBatch` at each `lsp.batch`, flush at each `lsp.flush`,
  answer each `HostFs` call from the matching `lsp.fs` event, and compare each
  `lsp.out` message.
- Playground: apply each `pg.edit` through the compile facade, and compare
  each `pg.compile`.

A difference exits 1 and prints the first differing event. So a logged session
is a regression check. The playground also accepts `?replay=<file>`. It loads
the session from `serve.ts` and plays the edits in the editor at their
recorded times, so a person sees what the user saw.

### The loop

1. `deno task logs:report --since 24h`.
2. An agent reads the report and the sessions that it names, and writes a
   findings ledger: what fails, when, the effect, and an impact estimate.
3. The user selects findings.
4. The implementer fixes each one. `logs:replay` of the named sessions shows
   the old behavior and then the new behavior.
5. The ledger records each result.

`AGENTS.md` gets one line that names this loop and `docs/logging.md`, because
it must bind Codex too.

## Phases

Each phase is one commit. Each phase that adds a `.ts` file adds its line to
the source file map of `docs/api.md` in the same commit. Run `deno task check`
before each commit and test its exit status.

### LG1: the log writer

Add `src/host/log.ts`: the envelope, the `EventLog` port, the file-system
port, the file adapter (session file, self-ignoring `.effektive/`, SHA-256
blobs, seven-day rotation), and the memory adapter.

Verification: fast tests in `tests/log_test.ts` use the memory file system and
cover the envelope order and `seq`, blob reuse, the `.gitignore` file, and
rotation of entries with old modification times. `tests/log_slow_test.ts` runs
the file adapter in a temporary folder on the real disk, including rotation
after `Deno.utimeSync`. `deno task check` exits 0.

### LG2: CLI events

Pass the log through `HostIo`. Emit the CLI kinds. Add `--no-log`, and add it
to the shared helper in `tests/cli_slow_test.ts`.

Verification: copy `fixtures/examples` to a temporary folder, and run
`deno task effektive check <copy>`. The copy holds one session file under
`.effektive/logs/` with `cli.start`, `cli.input` for `effektive.json` and each
source file, `cli.phase`, `cli.diagnostics`, and `cli.end`. A fast test runs
`main` with the memory adapter and checks the kinds. `deno task check` exits
0, and after it `git status --short` shows nothing.

### LG3: language server wire log

Add `src/lsp/wire_log.ts` and wire it in `src/lsp/main.ts`. Add the `log`
option, the VS Code setting, and `effektive.log` to the settings key set in
`tests/vscode_client_test.ts`. Make the bench client send the `rootUri` of
its temporary project copy (`bench/lsp_client.ts`, `bench/lsp_script.ts`).

Verification: a fast test drives the server through the wire log with memory
ports and the memory log. It checks one `lsp.in` per frame, one `lsp.batch`
per batch, one `lsp.out` per response, and `lsp.fs` for each disk call. Run
`deno task bench` M4 before and after the change, and record both p90 values
and the log bytes of the M4 run in this plan. Accept the change when p90 stays
inside the 100 ms budget. `deno task check` exits 0.

### LG4: playground events

Emit the playground kinds from `playground/src/app.ts`. Keep each event
builder pure in `playground/src/model.ts`. Add `POST /log` and `--no-log` to
`serve.ts`, with the request check as a pure function in its own module.

Verification: fast tests cover the event builders and the request check: a
valid batch passes, and an oversized body, a wrong shape, a bad session ID, a
wrong content type, and a foreign origin are refused. In a browser at 1280 by
800, open, edit, make an error, click the problem, and fix it. The session
file holds each matching kind in order. `deno task check` exits 0.

### LG5: the report

Add `scripts/logs_report.ts` and the `logs:report` task. Add small logs under
`fixtures/logs/`.

Verification: fast tests run the report on the fixture logs and check each
section, including a seeded internal error and a seeded transient diagnostic.
`deno task logs:report --since 24h` runs on the logs from the LG4 browser
check. `deno task check` exits 0.

### LG6: replay

Add `scripts/logs_replay.ts`, the `logs:replay` task, and the playground
`?replay=` mode.

Verification: fast tests replay each fixture log with no difference, and a
fixture log with one changed outcome exits 1 and names that event. A language
server fixture log with `debounceMs` above 0 replays its `lsp.flush` points
with no difference. In a browser, `?replay=` plays the LG4 session, and a
`?replay=` value with a path separator is refused. `deno task check` exits 0.

### LG7: documents

Write `docs/logging.md`: the location, the envelope, the kinds, the content
and its privacy, the rotation, the off flags, and the loop. Link it from
`docs/api.md` and the README table. Add a CHANGELOG line and the `AGENTS.md`
line. Move this plan to `docs/archive/plans/` and update the registry row.

Verification: `deno test --allow-read tests/docs_test.ts` and
`deno task check` exit 0.

## First analysis: proxies

No program log exists yet. These findings come from the evidence of
2026-10-26: my browser sessions with the playground, the frames of four demo
takes, the `deno task check` logs, and the git history. The impact is an
estimate. The first report on real logs replaces this ranking.

| ID | Impact | What fails, when, and the effect | Evidence | Proposal |
| --- | --- | --- | --- | --- |
| FR1 | High | Hover and the status-bar contract give nothing on a declaration name, a parameter, or a type in a signature. The user sees no contract where the user looks first. Both the playground and the editor use this query (`hoverAt` in `src/core/typescript.ts`). | At `users.eff` line 19, columns 26, 30, and 32 gave an empty contract. Line 23 on `user` gave `User`. | Answer hover on a declaration name with its contract, on a parameter with its type, and on a type name with its definition. |
| FR2 | High | The playground compiles on each document change and shows each new diagnostic at once, also in the middle of a word. Errors flash, the Problems count jumps, and the stale banner and the saving label flip while the user types. The server and the VS Code client default `debounceMs` to 0, so the editor can do the same. | The frames of the "write" shot show `syntax/008` and `unknown-name/001` while the line is half typed. `playground/src/app.ts` compiles on each `docChanged`. | Show new errors after a typing pause, and clear errors at once. Take the pause from the `pg.edit` intervals in the LG logs, not from a guess. |
| FR3 | Medium | `installation_slow_test.ts` fails sometimes: `deno bundle` cannot copy its esbuild binary in the temporary Deno cache. A failed run stops a commit. | 1 failure in 5 `deno task check` runs in this session on 2026-10-26, with "failed to copy esbuild binary ... No such file or directory". The next full run passed. | Probable cause: two `deno bundle` runs in parallel under one fresh `DENO_DIR` (`installation_slow_test.ts` and `playground_build_slow_test.ts`, through `scripts/test_slow.ts`). Confirm by running the two tests at the same time, then give each its own `DENO_DIR` or serialize them. |
| FR4 | Medium | `playground:serve` builds once, and `serveDir` sends no `Cache-Control`, so the browser keeps old `app.js` and `app.css`. A changed page needs a server restart and a forced reload. After an upgrade, a user can get new HTML with an old script. | Four restarts and four forced reloads on 2026-10-26. | Send `Cache-Control: no-cache` from `serve.ts`, and rebuild when a file in `playground/src/` changes. |
| FR5 | Medium | Both correctness defects that the past 24 hours found were in refinement proofs, and code review found them, not a test. | RBF20 (a refined union member skipped its proof) and RBF12 (or-facts were not canonical at joins). | Generate small refinement programs and compare the checker and the validator verdicts. The validator is already an independent oracle. |
| FR6 | To measure | The playground script is 1,026,253 bytes, or 310,145 bytes after gzip. The cost of the first load is not known. | `serve.ts` start lines. | `pg.start` logs the load time. Decide after the first report. |
| FR7 | Low | On a phone the status bar wraps to 68 px with the contract and the saving label, so less code shows. | Browser check at 375 by 812. | Below 720 px, hide the saving label or keep the contract to one line. |

Test time showed no inefficiency in the last check run: no fast test took more
than 1 second, and the slow suite took about 55 seconds.

## Validation

A Fable review on 2026-10-26 found thirteen points, seven of them blocking.
The plan now:

- adds each file to the `docs/api.md` source map in its own phase
- tests the file adapter through a memory file system, plus one slow test on the real disk
- makes the bench client send a `rootUri`, so the LG3 measurement covers a logging server
- logs batch and flush boundaries and replays them
- logs every `HostFs` call and replays from that log
- makes the `POST /log` check concrete, with the content type, the origin, the session pattern, and the size caps
- logs every workspace input of the CLI, and skips `--tsc` in replay

The non-blocking points are in too:

- the off flag goes only in the one helper that runs on `fixtures/examples`
- the settings key test changes
- the wire log is a separate module that buffers until `initialize`
- the plan uses SHA-256 blobs
- a playground batch stays below the 64 KiB keepalive limit
- the current state names `window/logMessage`

Fable could not confirm the esbuild text of FR3 from the code. The saved
failure output of this session confirms it, and FR3 now names a probable cause
and the check that confirms it.

## Progress

| Unit | State | Commit |
| --- | --- | --- |
| LG1 | Planned | |
| LG2 | Planned | |
| LG3 | Planned | |
| LG4 | Planned | |
| LG5 | Planned | |
| LG6 | Planned | |
| LG7 | Planned | |
