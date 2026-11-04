# Plan: contract provenance, phase 1 (PV)

Date: 2026-11-04. Status: proposed. Execution waits for the user's answers to
PVD1, PVD2, and PVD3.

## Goal

When a written `fails` or `with` clause misses an entry, the diagnostic names
the places in the function that introduce each missing entry. The language
server shows these places as related locations. The command-line tool prints
them (PVD1).

## Origin

The [feature review of 2026-11-04](../archive/feature-review-2026-11-04.md)
ranked contract provenance (AD2) first. The user accepted Decision 1 (a) of
that review: critique points K1 to K3. So phase 1 adds related locations only.
A location is the call site in this function, not a place inside a callee. A
fixture matrix asserts the exact line of each location. Phase 2, an inlay hint
tooltip that lists the origins of an inferred set, starts only after the
fixture matrix of this plan passes.

## Current behavior

Each fact below was checked at commit `0520ffd`.

- `checkBody` reports `failure-contract/001` and `requirement-contract/001` on
  the whole body node, with no related location
  (`src/core/check_expr.ts:487-509`). `checkBody` also checks the body of an
  inline arrow (`src/core/check_expr.ts:2340`), so an arrow with a written
  clause gets the same diagnostics.
- `checkFunctionBody` reports `failure-contract/001` on the signature span when
  an export has a checked input and a written `fails` clause without
  `SchemaError` (`src/core/check_expr.ts:2938-2946`). The checked parameters
  come from `checkedInputFlags` (`src/core/check_expr.ts:2914`).
- `makeDiagnostic` accepts related locations (`src/core/diagnostics.ts:351-394`).
  The resolver and the type lowering already use them, for example "first
  declared here" (`src/core/resolve.ts:378`).
- The language server maps related locations to `relatedInformation`
  (`src/lsp/projects.ts:218-234`). VS Code shows them with no client change.
- The command-line tool drops related locations: `formatDiagnostics` prints
  only the span, the code, and the message (`src/cli/format.ts:74-81`).
- The playground shows no related location. No file in `playground/src` reads
  them.
- `src/core/diagnostic_delta.ts` does not read related locations. So the
  contract quick fixes and rename, which compare diagnostics through it, do not
  change.
- Error fixtures compare only the file, the line, and the code
  (`docs/development.md:117-123`). So tests must assert related locations
  directly.
- The surface snapshot holds no record with a related location.

## Data that the search uses

- `BodyTable.info` maps each checked node to the effect set of its whole
  subtree (`finish`, `src/core/check_expr.ts:294-302`).
- An inline arrow node has pure effects
  (`src/core/check_expr.ts:2349`). Its body nodes are checked into the same
  body table, because `callbackBody` calls `checkBody` on the same checker.
- A pipeline stage whose left value is not quiet stores the left value's
  effects in its own `info`, although the left value is a sibling node. Its own
  set is in `BodyTable.stageSets` (`src/core/tables.ts:256-262`,
  `src/core/check_expr.ts:1516-1521`).
- A `catch` handler arm has the fact `{ kind: "handler", error }`
  (`src/core/tables.ts:239-245`, `src/core/check_expr.ts:2701-2702`). The
  `try` node removes the handled errors from the protected block
  (`src/core/check_expr.ts:2712-2714`).
- `provide` with a source Layer removes the supplied services
  (`src/core/check_builtins/layer.ts:77`), and `scoped` removes the scope
  capability (`src/core/check_builtins/scope.ts:64`). No other checker site
  calls `without` on a failure or requirement set.

## Rules after the change

1. Each `failure-contract/001` and `requirement-contract/001` from `checkBody`
   carries related locations. Each location is a node of the same body that
   introduces a missing entry. The message is "can fail with `E` here" for a
   failure and "requires `S.m` here" for a requirement. The names use the same
   short form as the main message.
2. The `SchemaError` form of `failure-contract/001` carries one related
   location at each parameter with a checked input, with the message "this
   input is checked, so the function can fail with `SchemaError`".
3. A location is the smallest node that carries the entry: a `fail(...)`, a
   service method call, a call of a local or imported function, or a builtin
   call that adds the entry, such as `timeout` or `schemaDecode`. Through a
   call, the location is the call, not a node inside the callee.
4. Precision comes before completeness. Each location introduces the entry.
   The list can miss a location when a node introduces the entry and also has
   a child that carries it. For example, in `Shelf.save(Shelf.find(id))`, when
   both methods fail with `StoreDown`, only the inner call is a location.
5. The locations are in source order, with no duplicates (PVD2).
6. The command-line tool prints the related locations (PVD1).

## Search rule

The search is a pure function in a new module, `src/core/contract_origins.ts`.
Its inputs are the syntax tree, the body table, the body root node, and one
missing entry: an error identity or a capability identity. It returns node
spans.

1. The own set of a node is its `stageSets` entry when one exists, else its
   `info` entry.
2. A node carries the entry when its own set holds the entry.
3. The children of a node are its syntax children, with two changes. An inline
   arrow child is replaced by its body node. At a `try` node, the protected
   block is removed when the entry is a failure that a handler arm of that
   `try` names.
4. Start at the body root when it carries the entry. At each node, select the
   children that carry the entry. When none does, the node is a location.
   Otherwise, visit each selected child.
5. Collect the locations, remove duplicates, and sort them by span start.

The search reads only data that the checker already stores. It adds no field to
`BodyTable` and no IR change. The search runs only on the error path, when a
contract diagnostic fires. Its cost is not measured.

## Decisions

The orchestrator recommends option (a) of each decision.

| ID | Decision | Options |
| --- | --- | --- |
| PVD1 | How the command-line tool prints a related location | (a) A note line directly after its diagnostic line: `path:line:column: note: message`, as compilers such as GCC print. The diagnostic lines keep their sort order. (b) Append the locations to the message on the same line. (c) Print nothing; only the language server shows them. |
| PVD2 | How many locations for one missing entry | (a) Every location that the search finds, in source order. (b) Only the first location. |
| PVD3 | Plan validation before execution | (a) Fable validates this plan read-only, and the orchestrator resolves each finding before PVU1 starts, as `AGENTS.md` asks for a non-trivial plan. (b) No validation. |

## Units

Each executor works in the main tree on local `main`. It must not run
`git checkout`, `git restore`, `git stash`, or `git commit`. The orchestrator
reviews each diff line by line, runs `deno task check`, and commits each unit
separately. The shared files are `src/core/check_expr.ts` (PVU1 only) and
`fixtures/surface/cli.json` (PVU2 only). The units run in order.

| ID | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| PVU1 | Sonnet | New `src/core/contract_origins.ts`; `src/core/check_expr.ts` (the two report sites); new `tests/contract_origins_test.ts` | The fixture matrix below passes with literal expected values. The census test passes. `deno task check` exits 0. `deno task behavior:compare 0520ffd <head>` changes only `check` and `program` records whose diagnostics hold one of the two codes, and only by added `related` entries. | 45 |
| PVU2 | Sonnet | `src/cli/format.ts`; `tests/cli_test.ts`; `fixtures/surface/cli.json` through `deno task surface:update`; `docs/api.md` (the diagnostic line format) | A fast CLI test asserts the exact note lines of one contract diagnostic and one "first declared here" diagnostic. The surface diff adds only the new records. `deno task check` exits 0. | 25 |
| PVU3 | Opus (orchestrator) | `docs/language-rules.md` (Contract diagnostics row), `docs/editor.md`, `CONCEPTS.md` (a "contract origin" entry), `CHANGELOG.md` (Unreleased), `docs/status.md` (Function contracts row) | `deno task check` exits 0. Each changed statement matches the code. | Direct |
| PVU4 | Sonnet | `fixtures/mutation/survivors.json`; tests that kill survivors | `deno task mutate` on `src/core/contract_origins.ts`, the changed lines of `src/core/check_expr.ts`, and `src/cli/format.ts` exits 0. Each survivor has a kill test or a register row with a reason. The run uses a detached scratch worktree at the committed head, on a quiet machine. | 40 |

## Fixture matrix of PVU1

Each case is a small in-memory project, checked through the public entry
points. Each case asserts the exact code, the line and column of each related
location, and each related message.

| Case | Source shape | Expected locations |
| --- | --- | --- |
| M1 | `Shelf.find(id) ?? fail(BookMissing({ id }))` with `fails StoreDown` | One: the `fail(...)` call, for `BookMissing`. |
| M2 | Two `fail(E(...))` calls in two `if` branches, `E` unlisted | Two, in source order. |
| M3 | A `try` whose block fails with `E`, a handler for `E` that fails with `E` again, `E` unlisted | One: the `fail` in the handler. The block's `fail` is absent. |
| M4 | A `try` that handles `E` completely, and an unlisted `F` after it | One, for `F`. No location for `E`. |
| M5 | A call of a module-level local function that fails with `E` | The call. |
| M6 | A call of a function imported from a second module | The call. |
| M7 | Two module-level functions in a recursive group; the written clause of one omits a failure of the other | The call of the group member. |
| M8 | A pipeline whose left value fails with `E1` and whose stage fails with `E2`, both unlisted | `E1` at the left value. `E2` at the stage. The stage is not a location for `E1`. |
| M9 | An inline arrow callback of a builtin that fails with `E` in its body | The `fail` inside the callback. |
| M10 | A missing `with` entry for `Shelf.find` | The method call. |
| M11 | A `provide` that supplies a service inside the body, and one call of an unlisted method outside it | One: the outside call. |
| M12 | An inline arrow with its own written `fails` clause that misses `E` | The diagnostic of the arrow, with a location inside the arrow body. |
| M13 | An export with a checked input and `fails E`, without `SchemaError` | One location at the checked parameter. |

The census test checks every case in `fixtures/errors/` that gives one of the
two codes. Each missing entry has at least one related location, and each
location lies inside the span of the reported body.

## Risks and limits

- An inline arrow argument is searched when its call carries the entry. If a
  call carries the entry for another reason and also takes a callback that
  fails with the entry but does not run it, the callback's `fail` becomes a
  wrong location. No such case is known. A case that shows it goes into the
  matrix.
- Rule 4 can miss a location. The goal of phase 1 is a correct location for
  each missing entry, not every location.
- A logged CLI or language server session with a contract diagnostic gives a
  difference in `deno task logs:replay`, because the diagnostics gain related
  locations. This is expected.
- The note lines of PVD1 (a) are a new line kind on stdout. A problem matcher
  that matches only `error` lines ignores them. No outside code reads the
  output.

## Out of scope

Phase 2 (the inlay hint tooltip), related locations in the playground problem
list, origins inside a callee, an added import, and the website specification.
This plan changes no source form, no IR, and no emitted TypeScript.
