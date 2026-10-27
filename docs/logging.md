# Session logs

The command-line tool, the language server, and the playground write a local
session log. A log lets a person or an agent see what a user saw, follow the
internal operations, and read the visible outcomes. `deno task logs:report`
turns the logs into a report, and `deno task logs:replay` runs a session again
as a regression check. The design and its evidence are in
[the archived plan](archive/plans/2026-10-26-self-improvement-loop.md).

## Location

Each surface writes into the `.effektive/logs/` folder of a project:

| Surface          | Project folder                                                                    |
| ---------------- | --------------------------------------------------------------------------------- |
| Command line     | The root that the command names: the folder that holds `effektive.json`.          |
| Language server  | The first workspace folder of `initialize`, or else `rootUri`. With neither, no log. |
| Playground       | `playground/` in this repository. `playground/serve.ts` writes the file.          |

The writer also writes `.effektive/.gitignore` with the single line `*`, so git
ignores the folder in every repository. Each session writes one file,
`<surface>-<YYYYMMDD>-<session>.jsonl`. Source texts go into
`.effektive/logs/blobs/<sha256>.txt`, and an event names a text by its hash.

The log changes no output, no exit code, no message, and no file outside
`.effektive/`. A write failure turns the log off for the rest of the session.

## Envelope

Each line is one JSON object:

```json
{ "v": 1, "t": "2026-10-26T15:39:28.123Z", "ms": 1234, "surface": "cli",
  "session": "7f0c...", "seq": 17, "build": "0.10.3", "kind": "cli.phase", "data": {} }
```

`ms` counts from the session start. `session` is a random UUID. `build` is the
version in `deno.json`. `src/host/log.ts` defines the envelope, the `EventLog`
port, the file adapter, and the memory adapter that tests use.

## Kinds

| Surface         | Kinds                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command line    | `cli.start`, `cli.input`, `cli.phase`, `cli.diagnostics`, `cli.output`, `cli.tsc`, `cli.change`, `cli.error`, `cli.end`                                        |
| Language server | `lsp.in`, `lsp.out`, `lsp.batch`, `lsp.flush`, `lsp.fs`, `lsp.timing`, `lsp.error`, `lsp.exit`                                                                 |
| Playground      | `pg.start`, `pg.select`, `pg.edit`, `pg.compile`, `pg.hover`, `pg.problem`, `pg.view`, `pg.layout`, `pg.error`, `pg.end`                                       |

The command-line events come from `src/cli/`. The language server log is a wire
log: `src/lsp/wire_log.ts` records each message in and out, each end of a
stdin read, each timer flush, and each disk call. The playground builds its
event data in `playground/src/events.ts` and posts batches to `POST /log`.
The playground waits for each response before posting the next batch, including batches from later flushes.
A failed request stops queued batches and later events.
`playground/log_endpoint.ts` checks each request: same origin, the JSON content
type, the size limits, and the envelope shape.

## Content and privacy

The log holds the full source text of the files that a session reads or
edits, and each edit as it was typed. The log stays on this machine. No
surface sends it anywhere. Read the blobs before you share a log folder.

## Rotation and off flags

At session start the writer deletes session files and blobs older than seven
days. A blob that a session uses again gets a new modification time.

| Surface         | Off flag                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| Command line    | `--no-log` on each project command.                                         |
| Language server | `initializationOptions.log: false`, or the VS Code setting `effektive.log`. |
| Playground      | `deno task playground:serve --no-log`.                                      |

## Report

`deno task logs:report [--since <N>(m|h|d)] [folder ...]` prints a Markdown
report of the sessions that started in the window. The default window is 24h,
and the default folder is `playground/.effektive/logs/`. The sections are
sessions, broken behavior, latency against the 100 ms p90 budget, friction,
and outcomes. The comments in `scripts/logs_report.ts` define each measure.
For example, an edit burst has gaps below 1000 ms.

## Replay

`deno task logs:replay <session.jsonl>` runs one session again on the current
build, in process, with the blobs beside the session file. It ignores the
values that change from run to run, such as times and memory. It exits 0 when
each outcome is the same, 1 at the first difference, and 2 for a usage error, a
missing blob, or a session that it does not support.

- Command line: it compares the diagnostics and the output hashes. It skips
  `--tsc`. It does not replay watch sessions.
- Language server: it answers each disk call from the log, and compares each
  message out, disk call, flush, and exit in order.
- Playground: it applies each edit and compares each compile result. The
  examples must be the ones that the session started with.

The playground also plays a session in the editor at the recorded times. Open
`http://127.0.0.1:8790/?replay=<session file name>`. `GET /replay/<name>`
accepts only a playground session file name, and only on the
`127.0.0.1:8790` host. A replay page writes no new session.

## The loop

1. Run `deno task logs:report --since 24h` on the log folders.
2. An agent reads the report and the sessions that it names. The agent writes a
   findings ledger: what fails, when, the effect, and an estimate of impact.
3. The user selects the findings to fix.
4. The implementer fixes each one. `deno task logs:replay` of a named session
   shows the old outcome, and then the new one.
5. The ledger records each result.

The first ledger, FR1 to FR7, came from proxies before any log existed. It is
in the "First analysis" section of the archived plan. The user has not
selected any of its findings yet.
