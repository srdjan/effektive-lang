# Diagnostic ownership of nested project files

Prefixes: DOF (findings), DOD (decisions), DOU (units). DOF1 is finding 9 of the
state audit of 2026-11-07, recorded as PBF9 in the archived
[project rebinding plan](../archive/plans/2026-11-07-project-rebinding.md).

## Findings

DOF1. When a module of a nested project is open, the outer project also
publishes diagnostics for that file. The outer `Program` reads every file under
its root, nested projects included. `#publish` in `src/lsp/projects.ts` sends
the outer list for each closed file with diagnostics, with no version. The
nested project sends its list for the same file from the editor text. The
client keeps the list that came last. A probe showed 0 diagnostics from the
nested project, then 2 from the outer project, for an editor text without
errors.

## Decisions

DOD1 (user, 2026-11-07). A project publishes the diagnostics of a closed file
only when it owns the file by `ownedByRoot` (`src/host/save_round.ts`): no
directory between the root and the file holds its own `effektive.json`. A
closed file that a nested project owns gets no diagnostics until a file of
that project opens. An open document is always published by its own project.

DOD2. After a watched event for any `effektive.json`, each project clears each
non-empty list that it published for a file that it no longer owns. It does
this during the event, before any flush, so that the new owner publishes after
the clear.

DOD3. After a project is removed or a list is cleared, each project that covers
the cleared file forgets its entry for the file and becomes dirty, also when it
has no entry. Under DOD1 the outer project has no entry for a file that it did
not own, and it must publish its list when it owns the file again.

DOD4. `effektive check` and `effektive build` at an outer root do not change.
The command line has no open documents, so DOF1 does not apply to it.

## Units

| Unit | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| DOU1: DOF1, DOD1 to DOD3 | Sonnet | `src/lsp/projects.ts`, `tests/lsp_server_test.ts` | Each new test fails before the fix for the reason of the finding and passes after it. The guard test for DOD3 passes before the fix, and fails with only the DOD1 filter. `deno task test` passes. | 35 |
| DOU2: mutation of the changed declarations | Opus | `fixtures/mutation/survivors.json` and tests, if a survivor needs them | `deno task mutate` exits 0 for the changed sites of `src/lsp/projects.ts`. | 20 |

The orchestrator writes `docs/api.md` and `CHANGELOG.md`, reviews the diff,
runs `deno task check`, and commits each unit. The last commit moves this plan
to `docs/archive/plans/`.

## Progress

- DOU1: implemented. Four tests failed before the fix for the reason of DOF1: the outer project published a nested file, or it kept its old list after a nested `effektive.json` appeared. One of them checks that the clear comes before the publish of the new nested project. They pass after the fix. The DOD3 guard test passes before the fix, and it failed with only the DOD1 filter. `deno task check` exited 0, with 2988 fast and 286 slow tests passed.
- DOU2: open.
