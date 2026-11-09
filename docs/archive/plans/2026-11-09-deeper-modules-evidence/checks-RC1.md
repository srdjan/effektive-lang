# Redundant checks in the adapters (RC1)

This ledger covers every census line of `src/cli`, `src/host`, and `src/lsp` at `e16f546`. The census is a list of checks that might repeat a fact that the type or an earlier check already proves.

Census commands, run from the repository root:

- P1 lookup fallback: `git grep -n -E '\.get\([^)]*\) \?\? ' -- src/cli src/host src/lsp`
- P2 typeof: `git grep -n -E 'typeof [a-zA-Z_.]+ [!=]== "' -- src/cli src/host src/lsp`
- P3 isRecord: `git grep -n 'isRecord(' -- src/cli src/host src/lsp`
- P4 undefined exit: `git grep -n -E '=== undefined\) (return|continue|throw|break)' -- src/cli src/host src/lsp`
- P5 internal throw: `git grep -n -E 'throw (new Error|internal)\(' -- src/cli src/host src/lsp`
- P6: other redundant checks that the reader found while reading.

Counts: P1 6, P2 27, P3 13, P4 38, P5 0. P5 has no line, so it has no row.

Decisions by pattern:

- P1: removed 0, restructured 0, kept 6
- P2: removed 0, restructured 1, kept 26
- P3: removed 0, restructured 2, kept 11
- P4: removed 0, restructured 3, kept 35
- P5: removed 0, restructured 0, kept 0

Six rows changed code, in three commits: the publish loop of `projects.ts`, the located project of `features.ts` and `generated_texts.ts`, and the editor params of `protocol.ts`. Rows `protocol.ts:546` and `547` stay, because a shape check would change the error text. Rows that name the same line in two patterns, such as `jsonrpc.ts:317`, get one row for each pattern.

| Site (file:line at e16f546) | Pattern | Decision | Reason or proof |
|---|---|---|---|
| src/lsp/features.ts:85 | P1 | kept | type needs a string; the span source can be absent |
| src/lsp/features.ts:315 | P1 | kept | multimap default |
| src/lsp/features.ts:321 | P1 | kept | edit span source can name a file that the revision lacks |
| src/lsp/projects.ts:674 | P1 | kept | a diagnostic path can lack text in both maps |
| src/lsp/projects.ts:676 | P1 | kept | multimap default: a file with no diagnostics |
| src/lsp/projects.ts:712 | P1 | kept | missing key means nothing published yet |
| src/host/log.ts:157 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:348 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:350 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:351 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:352 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:374 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:375 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:376 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:377 | P2 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:378 | P2 | kept | entry point: parsed JSON text of a log line |
| src/lsp/jsonrpc.ts:266 | P2 | kept | entry point: decoded JSON-RPC frame |
| src/lsp/jsonrpc.ts:267 | P2 | kept | entry point: decoded JSON-RPC frame |
| src/lsp/jsonrpc.ts:284 | P2 | kept | entry point: decoded JSON-RPC frame |
| src/lsp/jsonrpc.ts:317 | P2 | kept | entry point: decoded frame error field |
| src/lsp/jsonrpc.ts:318 | P2 | kept | entry point: decoded JSON-RPC frame |
| src/lsp/protocol.ts:263 | P2 | kept | entry point: primitive check of an LSP message field |
| src/lsp/protocol.ts:331 | P2 | kept | entry point: primitive check of an LSP message field |
| src/lsp/protocol.ts:335 | P2 | kept | entry point: primitive check of an LSP message field |
| src/lsp/protocol.ts:341 | P2 | kept | entry point: primitive check of an LSP message field |
| src/lsp/protocol.ts:393 | P2 | kept | entry point: initializationOptions from the client |
| src/lsp/protocol.ts:402 | P2 | kept | entry point: initializationOptions from the client |
| src/lsp/protocol.ts:411 | P2 | kept | entry point: initializationOptions from the client |
| src/lsp/protocol.ts:547 | P2 | kept | entry point; the error text names context, so a shape check would change it |
| src/lsp/protocol.ts:558 | P2 | restructured | the params and object checks now check newName; text unchanged |
| src/lsp/wire_log.ts:31 | P2 | kept | entry point: raw initialize params, logged before validation |
| src/lsp/wire_log.ts:86 | P2 | kept | entry point: raw frame, logged before validation |
| src/lsp/wire_log.ts:88 | P2 | kept | entry point: raw frame id |
| src/host/log.ts:156 | P3 | kept | entry point: parsed JSON text of a log line |
| src/host/log_schema.ts:390 | P3 | kept | entry point: parsed JSON value |
| src/lsp/jsonrpc.ts:272 | P3 | kept | entry point: decoded frame |
| src/lsp/jsonrpc.ts:317 | P3 | kept | entry point: decoded frame error field |
| src/lsp/protocol.ts:289 | P3 | kept | entry point: the object shape check itself |
| src/lsp/protocol.ts:366 | P3 | kept | entry point: the one check of params |
| src/lsp/protocol.ts:383 | P3 | kept | entry point: initializationOptions from the client |
| src/lsp/protocol.ts:530 | P3 | restructured | second check of validated params; the shape check now carries the version |
| src/lsp/protocol.ts:546 | P3 | kept | entry point; the error text names context, so a shape check would change it |
| src/lsp/protocol.ts:558 | P3 | restructured | the params and object checks now check newName; text unchanged |
| src/lsp/wire_log.ts:27 | P3 | kept | entry point: raw workspace folder |
| src/lsp/wire_log.ts:71 | P3 | kept | entry point: raw params, read before validation |
| src/lsp/wire_log.ts:86 | P3 | kept | entry point: raw frame, logged before validation |
| src/cli/format.ts:33 | P4 | kept | text of a path can be unknown to the host |
| src/host/generation.ts:41 | P4 | kept | a module can lack a lowering result |
| src/host/outputs.ts:120 | P4 | kept | entry point: the first line of a file on disk can be missing |
| src/lsp/features.ts:112 | P4 | restructured | found is checked once, then project is read directly |
| src/lsp/features.ts:115 | P4 | kept | a revision can lack the text of a file |
| src/lsp/features.ts:151 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/features.ts:159 | P4 | kept | the query can find no hover target |
| src/lsp/features.ts:161 | P4 | kept | a span of a file that the revision lacks has no range |
| src/lsp/features.ts:178 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/features.ts:181 | P4 | kept | the query can find no definition |
| src/lsp/features.ts:226 | P4 | kept | a request URI can have no project |
| src/lsp/features.ts:230 | P4 | kept | a file can have no open, disk, or revision text |
| src/lsp/features.ts:253 | P4 | kept | a saved URI can have no project |
| src/lsp/features.ts:264 | P4 | kept | a request URI can have no project |
| src/lsp/features.ts:342 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/features.ts:411 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/features.ts:433 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/features.ts:456 | P4 | kept | a request URI can have no project |
| src/lsp/features.ts:459 | P4 | kept | a file can have no open or disk text |
| src/lsp/features.ts:549 | P4 | kept | cursorOf returns undefined when the request has no good revision |
| src/lsp/generated_texts.ts:76 | P4 | restructured | found is checked once, then project is read directly |
| src/lsp/projects.ts:249 | P4 | kept | entry point: a client URI can fail to convert |
| src/lsp/projects.ts:253 | P4 | kept | a path can lie outside the project root |
| src/lsp/projects.ts:323 | P4 | kept | two indexes of open documents; no type links them |
| src/lsp/projects.ts:387 | P4 | kept | entry point: a client URI can fail to convert |
| src/lsp/projects.ts:391 | P4 | kept | a path can lie outside the project root |
| src/lsp/projects.ts:430 | P4 | kept | two indexes of open documents; no type links them |
| src/lsp/projects.ts:443 | P4 | kept | a document can have no project after a config change |
| src/lsp/projects.ts:471 | P4 | kept | a path can fail to convert to a URI |
| src/lsp/projects.ts:492 | P4 | kept | a path can fail to convert to a URI |
| src/lsp/projects.ts:508 | P4 | kept | a cleared URI can fail to convert back |
| src/lsp/projects.ts:511 | P4 | kept | a path can lie outside the project root |
| src/lsp/projects.ts:603 | P4 | kept | entry point: a client URI can fail to convert |
| src/lsp/projects.ts:613 | P4 | kept | a path can lie outside the project root |
| src/lsp/projects.ts:669 | P4 | kept | a project can have no good revision |
| src/lsp/projects.ts:680 | P4 | restructured | the loop takes the entries of project.open, so no lookup by key |
| src/lsp/projects.ts:714 | P4 | kept | a path can fail to convert to a URI |
| src/lsp/server.ts:403 | P4 | kept | an unknown notification method has no handler |

## P6: other redundant checks

Each row is a line next to a census row, or a check that the census patterns do not match.

| Site (file:line at e16f546) | Pattern | Decision | Reason or proof |
|---|---|---|---|
| src/lsp/features.ts:110 | P6 | restructured | The two `found?.project` reads came before the check of `found`. They now come after it. |
| src/lsp/generated_texts.ts:75 | P6 | restructured | The `found?.project` read came before the check of `found`. It now comes after it. |
| src/lsp/features.ts:293 | P6 | kept | The `diskConfig?.ok` read is an entry point: a port read that can fail. |
| src/lsp/features.ts:326 | P6 | kept | A document can be closed, so a missing open version is a normal state. |
| src/host/outputs.ts:72 | P6 | kept | `passed.has(name)` reads a set that the fixpoint loop shrinks. |
