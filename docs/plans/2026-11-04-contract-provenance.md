# Plan: contract provenance, phase 1 (PV)

Date: 2026-11-04. Status: accepted. The user accepted option (a) of PVD1,
PVD2, and PVD3 on 2026-11-04. Fable validated the plan on 2026-11-04
(PVF1 to PVF11). The orchestrator checked and accepted each finding, and this
text includes the resolutions.

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
  come from `checkedInputFlags` (`src/core/check_expr.ts:2914`). So there are
  three report sites. The checker method `report` takes no related locations
  (`src/core/check_expr.ts:282-284`).
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
- The surface snapshot holds no record with a related location. It holds one
  language server record with `requirement-contract/001`
  (`fixtures/surface/lsp.json:1424-1436`) and three command-line records with a
  contract code (`fixtures/surface/cli.json:789,1067,1084`).
  `deno task surface:update` rewrites both files.
- The CLI session log records diagnostics without related locations
  (`loggedDiagnostics`, `src/cli/format.ts:139-153`). The summary count uses the
  number of diagnostics (`src/cli/build.ts:100`), not the number of lines.

## Data that the search uses

- `BodyTable.info` maps each checked node to the effect set of its whole
  subtree (`finish`, `src/core/check_expr.ts:294-302`).
- Some wrapper nodes have no `info` entry, because the checker never calls
  `finish` on them. Examples are the `ArgList` of a call
  (`src/core/check_expr.ts:697-704`), the `CatchClause` of a `try`
  (`src/core/check_expr.ts:2612-2624`), and a pipeline stage with a quiet left
  value (`src/core/check_expr.ts:1516`).
- An arrow node has pure effects (`src/core/check_expr.ts:2349`). Its body
  nodes are checked into the same body table, because `callbackBody` calls
  `checkBody` on the same checker. Each node that `callbackBody` checks has the
  fact `{ kind: "arrow" }` (`src/core/check_expr.ts:2348`). This includes an
  `ArrowExpr`, whose body is `arrowBody` (`src/core/syntax_queries.ts:166-172`),
  and the implicit arrows of `using` and `withResource` clauses, whose body is
  the last child (`src/core/check_expr.ts:2277-2313`).
- A stream callback of `mapEffect` or `unfold` leaves its call pure; the
  failure enters at the run call (`src/core/check_builtins/stream.ts:73,113-118`).
- A recursive group publishes only the body tables of its last round
  (`src/core/check_project.ts:308-312`), so the stored `info` is not stale.
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
3. The children of a node are its syntax children (`kidsOf`), with three
   changes. A child with no own set is transparent: its own children stand in
   for it, recursively (PVF1). A child with the fact `{ kind: "arrow" }` is
   replaced by its body: `arrowBody` for an `ArrowExpr`, else its last child
   (PVF2). At a `try` node, the protected block is removed when the entry is a
   failure that a handler arm of that `try` names.
4. Start at the body root when it carries the entry. At each node, select the
   children that carry the entry. When none does, the node is a location.
   Otherwise, visit each selected child.
5. Collect the locations, remove duplicates, and sort them by span start.

The search reads only data that the checker already stores. It adds no field to
`BodyTable` and no IR change. The search runs only on the error path, when a
contract diagnostic fires. Its cost is not measured.

## Decisions

The orchestrator recommended option (a) of each decision. The user accepted
option (a) of each decision on 2026-11-04.

| ID | Decision | Options |
| --- | --- | --- |
| PVD1 | How the command-line tool prints a related location | (a) A note line directly after its diagnostic line: `path:line:column: note: message`, as compilers such as GCC print. The diagnostic lines keep their sort order. (b) Append the locations to the message on the same line. (c) Print nothing; only the language server shows them. |
| PVD2 | How many locations for one missing entry | (a) Every location that the search finds, in source order. (b) Only the first location. |
| PVD3 | Plan validation before execution | (a) Fable validates this plan read-only, and the orchestrator resolves each finding before PVU1 starts, as `AGENTS.md` asks for a non-trivial plan. (b) No validation. |

## Units

Each executor works in the main tree on local `main`. It must not run
`git checkout`, `git restore`, `git stash`, or `git commit`. The orchestrator
reviews each diff line by line, runs `deno task check`, and commits each unit
separately. The shared files are `src/core/check_expr.ts` (PVU1 only),
`fixtures/surface/lsp.json` (PVU1 only), and `fixtures/surface/cli.json`
(PVU2 only). The units run in order.

After the PVU1 commit, the orchestrator runs
`deno task behavior:compare 0520ffd <PVU1 commit>`, because the command needs
two committed revisions (PVF4). The expected result: only `check` and
`program` records whose diagnostics hold one of the two codes change, and only
by added `related` entries.

| ID | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| PVU1 | Sonnet | New `src/core/contract_origins.ts`; `src/core/check_expr.ts` (the three report sites, and `report` or a direct `makeDiagnostic` call for related locations); new `tests/contract_origins_test.ts`; `fixtures/surface/lsp.json` through `deno task surface:update` | The fixture matrix below passes with literal expected values. The census test passes. The `lsp.json` diff adds `relatedInformation` to the one contract record only. The `cli.json` diff is empty. `deno task check` exits 0. | 45 |
| PVU2 | Sonnet | `src/cli/format.ts`; `tests/cli_test.ts`; `fixtures/surface/cli.json` through `deno task surface:update`; `docs/api.md` (the diagnostic line format, and the sentence "Stdout holds only diagnostics" at `docs/api.md:656-657`) | A fast CLI test asserts the exact note lines of one contract diagnostic and one "first declared here" diagnostic. The diagnostic lines keep their sort order before the note lines are added, so `tests/cli_sort_test.ts` passes unchanged. The `cli.json` diff only adds note lines and new records. The changed records are the three contract records and the records whose diagnostics already carry related locations: `declaration/001`, `declaration/004`, and `declaration/010` (8 such lines in `cli.json` today). `LoggedDiagnostic` does not change in phase 1 (PVF6). `deno task check` exits 0. | 25 |
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
| M6 | A call of a function imported from a second module. Use `memoryHost` with two files and `checkProject` | The call. |
| M7 | A recursive group: `const a = (n: Int): Int fails Other => if (n === 0) { 0 } else { b(n - 1) }` and `const b = (n: Int): Int => if (n === 0) { fail(Boom({ id: "" })) } else { a(n - 1) }`. Both members need written result types (`tests/check_body_test.ts:1173-1185`) | One: `b(n - 1)`, for `Boom`. |
| M8 | A pipeline whose left value fails with `E1` and whose stage fails with `E2`, both unlisted | `E1` at the left value. `E2` at the stage. The stage is not a location for `E1`. |
| M9 | `map(xs, (x) => fail(E({ ... })))` (see `fixtures/errors/requirement-contract-effectful-map.eff`) | The `fail` inside the callback. |
| M10 | A missing `with` entry for `Shelf.find` | The method call. |
| M11 | A `provide` that supplies a service inside the body, and one call of an unlisted method outside it | One: the outside call. |
| M12 | An inline arrow with its own written `fails` clause that misses `E`. The clause order is parameters, result type, `fails`, `with`, `=>` (`src/core/parse.ts:914-947`) | The diagnostic of the arrow, on the arrow body (`src/core/check_expr.ts:2340`, `496`), with a location inside that body. |
| M13 | An export with a checked input and `fails E`, without `SchemaError`. Take the input shape from `tests/inferred_inputs_test.ts` | One location at the checked parameter (`parameter.span`). |
| M14 | A `using` block whose use part fails with an unlisted `E` | The `fail` inside the use part (PVF2). |
| M15 | A block `const f = (x: Int): Int => fail(E({ ... }))`, then `f(1)` | The call `f(1)`. The `const` is pure (`src/core/check_expr.ts:2438`). |
| M16 | A nested call such as `Store.put(Store.get())`, where both methods fail with `StoreDown` and the clause omits it | One: the inner call (rule 4). |

The census test checks every case in `fixtures/errors/` that gives one of the
two codes from `checkBody`. Each missing entry has at least one related
location, and each location lies inside the diagnostic span.

## Risks and limits

- An inline arrow argument is searched when its call carries the entry. If a
  call carries the entry for another reason and also takes a callback that
  fails with the entry but does not run it, the callback's `fail` becomes a
  wrong location. No such case is known. A case that shows it goes into the
  matrix.
- Rule 4 can miss a location. The goal of phase 1 is a correct location for
  each missing entry, not every location.
- A logged language server session with a contract diagnostic gives a
  difference in `deno task logs:replay`, because each message out is compared
  and the diagnostics gain `relatedInformation`. This is expected. A CLI
  session does not differ, because the CLI log records diagnostics without
  related locations (PVF6).
- Some locations are coarser than a reader expects (PVF8). A `fail` in a
  `mapEffect` or `unfold` callback has its location at the stream run call,
  because the callback leaves its own call pure. A pipeline stage with a quiet
  left value has no own set, so the location is the whole pipeline. Both
  follow rule 3.
- The note lines of PVD1 (a) are a new line kind on stdout. A problem matcher
  that matches only `error` lines ignores them. No outside code reads the
  output.

## Validation findings

Fable reviewed the plan read-only on 2026-11-04. The orchestrator checked
PVF1, PVF3, and the surface lines in the code before acceptance.

| ID | Finding | Resolution |
| --- | --- | --- |
| PVF1 | `ArgList` and `CatchClause` have no `info`, so the search stopped at the call or the `try`. | Search rule 3: a child with no own set is transparent. M3 and M16 test it. |
| PVF2 | `using` and `withResource` clauses are implicit arrows that `ArrowExpr` detection misses. | Search rule 3 finds an arrow by its fact. M14 tests it. |
| PVF3 | PVU1 changes `lsp.json`, and the CLI surface already holds contract records. | PVU1 owns `lsp.json`. The PVU2 check names the changed records. The orchestrator also found 8 lines with `declaration/001`, `declaration/004`, or `declaration/010` that gain note lines. |
| PVF4 | `behavior:compare` needs two commits, and an executor does not commit. | The orchestrator runs it after the PVU1 commit. |
| PVF5 | Three report sites, and `report` takes no related locations. | PVU1 names the three sites. |
| PVF6 | The CLI log has no related locations, so only language server replays differ. | The risk is corrected. `LoggedDiagnostic` does not change in phase 1. |
| PVF7 | The sort test and the `docs/api.md` stdout sentence were not named. | PVU2 names both. |
| PVF8 | Stream callbacks and quiet-left stages give coarse locations. | Recorded under risks. |
| PVF9 | No source shape gives a wrong location. | None. |
| PVF10 | M6, M7, M9, M12, and M13 needed concrete shapes; a block `const` arrow case was missing. | The matrix gives the shapes and adds M15. |
| PVF11 | Each cited line is correct. | None. |

## Out of scope

Phase 2 (the inlay hint tooltip), related locations in the playground problem
list, origins inside a callee, an added import, and the website specification.
This plan changes no source form, no IR, and no emitted TypeScript.
