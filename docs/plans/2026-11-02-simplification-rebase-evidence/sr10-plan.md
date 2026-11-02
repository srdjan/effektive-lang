# SR10 plan: replace the behavior capture with a named corpus comparison

Date: 2026-11-02. Base: local `main`. Owner: the orchestrator. SRD5 (a) authorizes this unit. It does not authorize a push, a release, or a version change.

## 1. Goal

`scripts/behavior_capture.ts` compares the compiler behavior of two git revisions. It patches five private call sites through source-text anchors (`checkAnalysis`, `Program.update`, `lowerModule`, `emitModule`, `validateModule`). It runs the whole test suite and records hashes of eight result kinds. A record has no case name and no result text, and it changes when tests move (see `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`).

SR10 replaces it with a named corpus that runs through public entry points against both revisions. The comparison keeps the full result text of each mismatch. The hooks retire only after the corpus compares cleanly (VA7). The lexer snapshot (`scripts/lex_snapshot.ts`) stays.

## 2. Design decisions

D1. Two scripts. `scripts/behavior_corpus.ts` is the runner: it runs the corpus in one tree and writes one JSON file of records. `scripts/behavior_compare.ts` is the command: it exports two revisions, runs the runner in each, and compares. The task `behavior:compare` replaces `behavior:capture`.

D2. One corpus for both revisions. The command copies the head runner into both exported trees. Each runner reads the corpus inputs from the head tree, so both compilers see the same inputs.

D3. One adapter. The runner reaches the compiler only through one function, `loadCore(root)`, which returns a small `CoreApi` record. It imports `src/core/mod.ts` and the validator entry of that tree. When a base revision has another API, only `loadCore` changes. The first base for the detection check, `cb4abd3` (v0.12.1), has no `src/core/validate_project.ts`: there, `validateProject` comes from `src/core/frontend.ts`. `loadCore` handles both.

D4. Full records. A record is the canonical JSON of the whole result: object keys sorted, no hashes. The key of a record is the case name and the kind.

D5. The eight kinds stay: `check`, `program`, `program-error`, `lower`, `lower-error`, `emit`, `emit-error`, `validate`. The corpus must give at least one record of each kind.

## 3. Corpus

All inputs come from `fixtures/` of the head tree. The case name is the path relative to `fixtures/`.

1. Projects. Each directory with an `effektive.json`. Each bundle without one: `emit/sinks`, with the host key `sinks` (see `BUNDLES` in `tests/validate_expr_children_test.ts`). Each `.eff` file outside a project directory under `fixtures/emit`, `fixtures/errors`, `fixtures/parse`, and `fixtures/ir`, with the configuration `{}`.
   - `check`: the diagnostics of `checkProject`, for all modules.
   - When the project has no diagnostics: for each module, `lower` (the `serializeModule` text) or `lower-error`. For each lowered module, `emit` (the emitted module text and its map) or `emit-error`, with the project configuration. One `validate` record: the `validateProject` result over the lowered modules.
   - When the project has diagnostics: lower each module with all diagnostics removed, as `withoutDiagnostics` in `tests/internal_sites_test.ts` does. Record `lower` or `lower-error` under the case name with the suffix `!forced`. A thrown error that is not a lowering failure gives a record `{ "thrown": <message> }`.
2. Forged IR. Each `fixtures/validate/*.json`, as `tests/validate_test.ts` reads them (search for `fixtures/validate`). Record `validate`, and `emit` or `emit-error` with an empty configuration.
3. Edit sequences. A literal table in the runner of named sequences of `Program.update` calls over an in-memory host. Each step records `program` (the diagnostics) or `program-error` (the `ConfigError`). At least these sequences: a clean project, then an edit that adds a type error, then the revert; a new module, then its deletion; an `effektive.json` with invalid JSON, then the repair; a configuration that names a missing host module.

## 4. Unit A: build the corpus comparison

Model: Sonnet. Workspace: the git worktree that the dispatch names. Turn budget: 100 tool calls. At 80 before the commit, stop and hand back.

Files: `scripts/behavior_corpus.ts`, `scripts/behavior_compare.ts`, `tests/behavior_corpus_test.ts` (fast), `tests/behavior_compare_slow_test.ts`, `deno.json` (add the task `behavior:compare`; keep `behavior:capture` until unit B).

Command contract: `deno task behavior:compare <base-rev> <head-rev> [--out <dir>] [--only <prefix>]...`.
- It prints one summary line for each kind: `<kind>: <n> equal, <n> changed, <n> missing, <n> added`.
- It prints each changed or missing case name with its kind.
- It writes the base and head records of each changed or missing record to the output directory as `<safe case name>.<kind>.base.json` and `.head.json`. Without `--out`, it uses a new temporary directory and prints its path.
- Each `--only` keeps the cases whose names start with that prefix.
- Exit status: 0 when no record changed and none is missing. 1 when a record changed or is missing. 2 for a usage error or a failed run.
- With one revision, it writes the records of that revision to the output directory and prints the summary counts per kind.

Tests:
- The fast test calls the exported functions of the two scripts. It runs the runner on a small in-memory corpus: one clean project, one project with a diagnostic, one forged IR, and one edit sequence. It asserts literal records and the presence of all eight kinds. It compares two literal record sets and asserts the exact report lines and the exit status. Each test runs in under one second.
- The slow test runs the command on `HEAD HEAD` with one `--only` prefix and asserts exit status 0 and its exact summary lines.

Acceptance:
1. `deno task check` exits 0.
2. A full run on the head gives at least one record of each kind. Report the count per kind and the measured run time of the full comparison.
3. `deno task behavior:compare <unit base> <unit commit>` exits 0 with 0 changed and 0 missing. The unit changes no compiler source, so the comparison must be clean.
4. `deno task behavior:compare cb4abd3 <unit commit>` reports changes. List the changed kinds with counts and up to ten case names. Match each change to an entry of the "Unreleased" section of `CHANGELOG.md`. Report each change that matches no entry. Do not change compiler source to remove a difference.
5. `deno task mutate` on the compare logic of `scripts/behavior_compare.ts`. Kill each survivor with a public test, or register it with a reason.

Commit subject: "Add the named corpus comparison of two revisions".

## 5. Unit B: retire the behavior capture

Model: Sonnet. Starts after the orchestrator accepts unit A. Turn budget: 50 tool calls.

Files:
- Delete `scripts/behavior_capture.ts`, `tests/behavior_capture_test.ts`, `tests/behavior_capture_slow_test.ts`, and `tests/behavior_capture_tree.ts`.
- `tests/core_boundary_test.ts`: remove the `HOOK_PATHS` import, its filter, and the header sentences about hook files.
- `deno.json`: remove the task `behavior:capture`.
- Docs: `docs/development.md` (the task row and the capture note), `docs/testing.md` (the oracle row and the note about the capture exit status), `docs/api.md` (the script map), `CONCEPTS.md` (the section "Behavior capture" becomes the comparison), and a status line after the title of `docs/solutions/workflow-issues/behavior-capture-hold-tests-constant.md`.
- Search the repository for `behavior_capture` and `behavior:capture` outside `docs/archive/` and the plan evidence. Fix each live reference.

Acceptance: `deno task check` exits 0. `deno task behavior:compare <unit A commit> <unit B commit>` exits 0 with 0 changed and 0 missing. Net lines from git.

Commit subject: "Retire the behavior capture hooks".

## 6. Rules for both units

- Work only in the named worktree. Never push. Never create or move a branch. Never run `git checkout`, `git restore`, `git stash`, `git reset`, or `git gc`. Commit on the detached HEAD.
- Do not edit `CHANGELOG.md`, `docs/archive/`, or the plan files. The orchestrator writes those.
- Never use `any`. Use `unknown` with narrowing. Expected failures are `Result` values.
- Tests: public behavior, literal expected values, no mocks. A test that starts a subprocess goes in a `*_slow_test.ts` file.
- Prose: ASD-STE100 Simplified Technical English, no em dashes, no emojis.
- Shell: write `command rm -f`, `command cp`, and `command mv`.
- Handback: the changed files, the check results with counts, the acceptance results, the open issues, and the proposed CHANGELOG line. No file contents, no full logs. Take line counts from git.
