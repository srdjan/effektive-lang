# Project rebinding after `effektive.json` events

Prefixes: PBF (findings), PBD (decisions), PBU (units). A PBF number is the
number of the finding in the state audit of 2026-11-07.

## Findings

PBF1. A nested `effektive.json` created while one of its modules is open stops
the writes of that module. The server compares the event path only with known
project roots. `sub/effektive.json` is not a source path of the outer project,
so the server drops the event (`src/lsp/projects.ts:397`,
`src/host/workspace.ts:27`). The outer project no longer owns `sub/x`
(`src/host/save_round.ts:94`), and no nested project exists, because discovery
runs only in `didOpen` (`src/lsp/projects.ts:311`). A save writes nothing and
logs nothing (`src/lsp/projects.ts:470`).

PBF2. A nested `effektive.json` deleted while one of its modules is open stops
the writes of that module. The document stays in the nested project
(`src/lsp/projects.ts:327`). Each save logs that `sub/effektive.json` does not
exist and writes nothing (`src/lsp/projects.ts:443`). The flush also publishes a
configuration diagnostic on the deleted file.

PBF6. A document opened before its `effektive.json` exists never joins the new
project. The server keeps only the URI of a document with no project
(`src/lsp/projects.ts:244`), and it compares watched events only with known
roots (`src/lsp/projects.ts:396`).

PBF9 (outside this plan). When a module of a nested project is open, the outer
project also publishes diagnostics for that file, from the disk text and with
no version. The two lists replace each other in the client. A probe showed a
publish of 0 diagnostics from the nested project, then 2 from the outer
project, for an editor text without errors.

PBF10. An output that another project root generated blocks the new owner. The
first line of a generated file names its source relative to the project root,
for example `x.eff` from `sub/` and `sub/x.eff` from the outer root. The write
step compares that line as a string and refuses with "Move or delete it"
(`src/host/outputs.ts:194`). Removal uses the same comparison
(`src/host/outputs.ts:255`). After PBU1, a probe with outputs from before the
`effektive.json` change logged that refusal in both directions and wrote
nothing. The language server, `build`, and `watch` share this step.

## Decisions

PBD1 (user, 2026-11-07). A project whose `effektive.json` is gone, and that
keeps no open document after a rebind, is removed. The server clears each
non-empty list that the project published. Each remaining project that covers
such a path forgets its published list for the path and becomes dirty, so that
its next flush publishes its current list again.

PBD2 (user, 2026-11-07). PBF6 is in this plan, in its own commit after PBF1 and
PBF2.

PBD3. When the new search finds no project for an open document, the document
stays in its project. This keeps the documented diagnostic for a missing root
`effektive.json`.

PBD4. A rebind runs after a watched event for any file named `effektive.json`,
at any depth, of any change type. A rebind with no layout change does nothing.

PBD5. A project that a rebind creates gets a save round, because the event was
for its `effektive.json` (`docs/api.md`, "Projects, save, and configuration
errors"). A removed project gets no save round.

PBD6. A moved document keeps its text and version. The old project reads the
disk text of the path again and becomes dirty. The new project becomes dirty
and publishes the document at its next flush, also with an unchanged list.

PBD7 (user, 2026-11-07). A writer adopts an existing output when its first line
names the same source file from another root. The test: the resolved absolute
path of the source, with `/` separators, ends with `/` and the header path. For
`/work/app/sub/x.eff`, the headers `x.eff` and `sub/x.eff` pass, and
`zzz/sub/x.eff` and `zzz/x.eff` fail. An emitter cannot write a failing header
at that location, because `build` and the language server write only through
`containedProjectPath`. Removal uses the same rule. Adoption cannot make two
roots overwrite each other, because each writer passes `ownedByRoot`
(`src/cli/build.ts:83`, `src/lsp/projects.ts:516`).

## Units

| Unit | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| PBU1: PBF1, PBF2, PBD1, PBD3 to PBD6 | Sonnet | `src/lsp/projects.ts`, `tests/lsp_save_round_test.ts`, `tests/lsp_server_test.ts`, `docs/api.md`, `CHANGELOG.md` | Each new test fails before the fix for the reason of the finding and passes after it. `deno task test` passes. | 45 |
| PBU4: PBF10, PBD7 | Sonnet | `src/host/outputs.ts`, its tests, `tests/lsp_save_round_test.ts` | The same check as PBU1. The PBU1 tests run with the outputs from before the change. | 30 |
| PBU2: PBF6 | Sonnet | `src/lsp/projects.ts`, `tests/lsp_server_test.ts`, `docs/api.md`, `CHANGELOG.md` | The same check as PBU1. | 30 |
| PBU3: mutation of the changed declarations | Opus | `fixtures/mutation/survivors.json` and tests, if a survivor needs them | `deno task mutate` exits 0 for the changed sites of `src/lsp/projects.ts` and `src/host/outputs.ts`. | 20 |

The orchestrator reviews each diff, runs `deno task check`, and commits each
unit. The commit of PBU1 adds this plan. The last commit moves the plan to
`docs/archive/plans/`.

## Progress

- PBU1: implemented. Three tests failed before the fix for the reason of their finding and pass after it. The PBD3 guard test passes before and after. `deno task check` exited 0, with 2973 fast and 286 slow tests passed.
- PBU4: implemented. Five tests failed before the fix for the reason of PBF10, with the "Move or delete it" refusal or a kept stale file. They pass after it. The PBU1 test of a deleted nested `effektive.json` no longer deletes the outputs before its save. A move rewrites only the `.ts` file, because the map is the same for both roots. `deno task check` exited 0, with 2980 fast and 286 slow tests passed.
- PBU2: implemented. Two tests failed before the fix for the reason of PBF6: the document did not join the new project, and a stale change to it gave no stderr line. They pass after it. The guard test for a closed document passes before and after. `deno task check` exited 0, with 2983 fast and 286 slow tests passed.
- PBU3: complete. The first run of `deno task mutate` on the 21 changed lines left three survivors. The `catch` in `namesSource` was reachable only when the file system changed between two synchronous calls, so `namesSource` now reuses `realPath`. The stale-change return in `#applyChange` and the published-entry guard in `#removeDeadProjects` only add a dirty flag with no text change. They are registered as equivalent after a differential probe found no difference in any sent message. The second run exited 0: `src/host/outputs.ts` killed 8 of 8, and `src/lsp/projects.ts` killed 27 of 29, with the 2 survivors registered.

## Follow-ups outside this plan

- PBF9: fixed as DOF1 of the [diagnostic ownership plan](2026-11-07-diagnostic-ownership.md). Before, the outer project also published diagnostics for a module of a nested project, so the two lists replaced each other in the client.
- Probable, from code reading only: a moved document keeps its subscription to the generated view in the old project, because the subscriptions are keyed by the project. A test that subscribes, moves the document, and changes it can confirm this.
- The outer project gets no save round when a nested `effektive.json` is deleted. Its next save of the module writes the output.
