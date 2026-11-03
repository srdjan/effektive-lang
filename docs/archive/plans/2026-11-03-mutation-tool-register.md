# Mutation register of the mutation tool

Date: 2026-11-03. Status: complete. MT identifies the units of this plan.

## Goal

`deno task mutate --seed 1 --sample all --tests tests/mutate_slow_test.ts scripts/mutate.ts` exits 0. Each survivor gets a killing test or a register row.

## Measure

Only `tests/mutate_slow_test.ts` imports `scripts/mutate.ts`. The fast suite never loads the module, so a default run cannot measure it, and the run with `--tests tests/mutate_slow_test.ts` is the measure. At commit `7cb1c73`, that run has 145 sites: 92 killed and 53 survivors.

## Units

| Unit | Model | Files | Survivors | Acceptance check | Turns |
| --- | --- | --- | --- | --- | --- |
| MT1 | Sonnet | `tests/mutate_slow_test.ts` | 24 in pure functions: `classify` 10, `parseRegister` 3, `parseOptions` 3, `selectSample` 2, `isFunctionLike` 2, `nameOf` 2, `declarationOf` 1, `mutantsOf.visit` 1 | The measure run lists no survivor in these declarations, except rows of class `equivalent` with a differential probe. | 35 |
| MT2 | Sonnet | new `tests/mutate_tool_slow_test.ts` | 29 in the subprocess shell: `main` 19, `main.count` 1, `runMutants.worker` 4, `runMutants` 1, `makeCopies` 2, `run` 1, `shorten` 1 | A run with `--tests tests/mutate_tool_slow_test.ts` kills each survivor that gets a `slow-only` row. Each other row is `equivalent` with a differential probe. | 45 |

MT2 adds an end-to-end test of the tool through its command line. The test builds a small git repository in a temporary directory, with a copy of `scripts/mutate.ts`, a fixture module, a fixture test, and a register. A mutate copy is not a git repository, so the test must make its own.

Each unit works in its own detached worktree under `~/.claude/scratch`, and commits there, because the tool reads the committed `HEAD`. Each unit hands back its register rows as JSON. The orchestrator merges the rows, copies the test files, and runs the measure and `deno task check` on `main`.

## Evidence

MT1 added 3 tests and 3 table cases to `tests/mutate_slow_test.ts`. They kill 19 of its 24 survivors. Four survivors are `equivalent` rows, each with a differential probe: two in `selectSample` (31,200 cases, 0 differences) and two `eq < 0` sites in `parseOptions` (1,323 argument lists, 0 differences). The orchestrator checked each row reason against the code.

MT2 added `tests/mutate_tool_slow_test.ts`, with 8 tests of the tool through its command line. Each test builds its own git repository with a copy of the tool. A mutation run with only that file as the test set kills all 29 shell survivors, so they are `slow-only` rows. In the gate, the file takes about 7.5 s.

After MT1 and MT2, the measure run gave 145 sites, 111 killed, 34 survivors, and 1 unregistered survivor. After the MT-D1 and MT-D2 fixes, it gives 145 sites, 112 killed, and 33 survivors, all registered. It exits 0, with 0 stale rows.

## Decisions

MT-D1 (`parseOptions` accepts `--only :12`). `lastIndexOf(":")` returns 0, so the tool accepts a site with an empty path. The open survivor is `colon < 0` to `<=`. The proposed fix rejects `colon <= 0` and adds a test that expects the message `--only must be <path:line>`. After that fix, the measure run exits 0. Accepted: the new table case kills the survivor.

MT-D2 (`classify` reads the first summary line). `classify` takes the first line that looks like a test summary, not the last one. A failing test whose message quotes runner output can then read as `survived`. This masked 8 kills until MT1 changed one assertion message. The proposed fix takes the last summary line, with a test whose output holds a quoted summary before the real one. Accepted: two table cases cover a quoted summary of each kind.
