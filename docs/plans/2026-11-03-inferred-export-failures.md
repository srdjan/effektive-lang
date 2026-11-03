# Plan: inferred export failures and the `with` clause

Status: in progress. The user asked for the change on 2026-11-03. Prefix: EI.
EID is a decision, EIU is a unit, and EIF is a finding.

## Goal

Make function headers terser, and let the compiler infer more. The user's
target form is:

```effektive
export const getUser = (id: UserId): User with Users =>
  match Users.find(id) {
    Some(user) => user,
    None => fail(UserMissing({ id }))
  }
```

Today the same function needs `fails UserMissing | StoreUnavailable` and
`uses Users.find`. The compiler already infers both sets on local functions. It
solves recursive groups with a fixpoint (`src/core/modes.ts`). The exported
function is the only place where the sets are closed.

## Reversed decision

This plan reverses decision XCD1 of the
[export contract review](../archive/plans/2026-11-02-inferred-export-contracts-review.md),
which kept written contracts on exports. It also changes the condition "keep
explicit exported contracts" in `AGENTS.md`. The user asked for this change on
2026-11-03.

The review found one cost, XC3. A new failure in an exported function with an
inferred set reaches host TypeScript with no diagnostic, because
`Effect.runPromise` accepts any failure set. EID4 selects the guard for that
cost.

## Decisions

The user gave no answer within 60 seconds on 2026-11-03. The orchestrator
selected the recommended option of each decision. The user can change any of
them.

| ID | Decision | Selected option |
| --- | --- | --- |
| EID1 | Services on an export | An export states its services with `with`. An omitted `with` on an export means no services. A local function infers its services. |
| EID2 | The arrow after a header | Keep `=>`. Every arrow keeps one form. |
| EID3 | The result type of an export | Keep it written (`declaration/005` stays). |
| EID4 | The guard for failure drift | A written `fails` clause stays legal as a checked upper bound. Inlay hints show the inferred failures on exports. No snapshot file. |
| EID5 | The old keyword | Remove `uses`. Add no alias, because no outside code reads the package. |
| EID6 | The `with` name set | Keep the `uses` grammar: names joined by `|`, service names or method names (`with Users.find`). |
| EID7 | The IR field | Keep `written.uses` in the IR. A rename changes the wire format and needs a new IR version, with no value for the user. |

## Rules after the change

R1. A function with a body infers an omitted `fails` clause from the body. This
rule applies to exported and local functions. A written `fails` clause closes
its set as a checked upper bound.

R2. `with` replaces `uses` in every clause position: arrow headers, function
types, and `.effi` providers. The order stays `fails` before `with`.

R3. An exported function closes its `with` set. An omitted `with` clause on an
export means no services. A local function infers an omitted `with` clause.

R4. A binding annotation with a function type closes every part, as today.
Service methods, function types, and `.effi` providers state their sets,
because they have no body.

R5. An exported function with a checked input and no written `fails` clause
gets `SchemaError` in its inferred failure set. With a written `fails` clause,
the clause must list `SchemaError`, as today (`failure-contract/001`).

R6. The interface of a module carries the solved failure set of each exported
function. The type graph of the module and the foreign type graph include every
error that such a set names.

R7. The inlay hint shows the inferred failure set of an exported function. The
quick fix and `check --fix` add a failure only to a written `fails` clause.
They add a missing service to the `with` clause of an export.

R8. The emitted TypeScript keeps its shape: `Effect.Effect<A, E, R>`, where `E`
is the inferred set.

## Units

Each unit runs on local `main`, one at a time, with a Sonnet executor. The
orchestrator reviews each diff, runs `deno task check`, and commits each unit.
No executor may run `git checkout`, `git restore`, `git stash`, or `git commit`.

| Unit | Scope | Model | Turn budget | Depends on |
| --- | --- | --- | --- | --- |
| EIU1 | The `with` keyword | Sonnet | 60 | none |
| EIU2 | Inferred failure sets on exports | Sonnet | 80 | EIU1 |
| EIU3 | The corpus | Sonnet | 40 | EIU2 |
| EIU4 | The documentation of this repository | Sonnet | 35 | EIU3 |
| EIU5 | The website and the specification | Sonnet | 45 | EIU3 |
| EIU6 | Mutation of the changed modules | Sonnet | 50 | EIU2 |

### EIU1: the `with` keyword

Files: `src/core/lex.ts`, `src/core/parse.ts`, `src/core/syntax.ts`, the
modules that name `SyntaxKind.UsesClause`, `src/core/type_show.ts`,
`src/core/check_expr.ts` (diagnostic text), `src/core/validate/typing.ts`
(message text), `src/core/editor_tokens.ts`, `src/core/editor_completion.ts`,
`src/core/editor_actions.ts`, `editors/vscode/syntaxes/effektive.tmLanguage.json`,
the playground highlighter, every `.eff` and `.effi` fixture, and every test
that quotes a `uses` clause.

`tests/website_examples_slow_test.ts` compiles the files in
`../effektive/public/effektive-examples/`. So this unit also renames the
keyword in the website: the example files, the code blocks of
`effektive-spec.html` and `index.html`, and the contract explorer in
`site.js`. The orchestrator commits the website change in that repository
separately. The prose of the website changes in EIU5.

`with` is a reserved word of strict JavaScript. The lexer reports `syntax/007`
for it today. Add it to the words that the parser checks (`void`, `while`), so
that a name `with` still gives `syntax/007` with the same span and text. Rename
`SyntaxKind.UsesClause` to `WithClause`, and the slot kind `"uses"` to
`"with"`. `uses` becomes an ordinary name.

Acceptance: `deno task check` exits 0. A parse test shows `with` in each clause
position. A test shows that `const with = 1` still gives `syntax/007`. The
emitted `.ts` files of `fixtures/applications` and `fixtures/golden` have no
change after a build.

### EIU2: inferred failure sets on exports

Files: `src/core/check_declarations.ts` (the closure near line 998),
`src/core/check_project.ts`, `src/core/check_expr.ts` (R5, near line 2937),
`src/core/signatures.ts` (`ModeMap`, `modesAsSolved`), `src/core/interface.ts`
(`exportedValueIds`, `buildTypeGraph`, `foreignTypeGraph`, `buildInterface`),
`src/core/db.ts` (the rebuild near line 407), `src/core/editor_hints.ts`, and
their tests.

The four sites of XC8 must use the solved sets. The body checker publishes the
solved state of each function. The interface reads only modes today, so an
inferred export set would reach no importer.

Acceptance: literal tests for each case below, and `deno task check` exits 0.

1. An export with no `fails` clause, whose body fails with `E`, has no
   diagnostic. Its interface type and its emitted type carry `E`.
2. An importer sees `E` in the imported function type. A `catch` arm for `E` is
   reachable.
3. An export that fails with a private error puts that error in the type graph.
   The importer passes validation.
4. An export with a checked input and no `fails` clause infers `SchemaError`.
   With `fails X` and no `SchemaError`, `failure-contract/001` stays.
5. An export with a written `fails A`, whose body fails with `B`, gives
   `failure-contract/001`.
6. An export with no `with` clause, whose body calls a service, gives the
   existing diagnostic.
7. The inlay hint of an export shows the inferred failures.
8. A body edit that adds a failure to an export changes the interface hash. The
   importer then sees the new failure.
9. A recursive export with no `fails` clause settles through the group solver.
10. `check --fix` on an export with no `fails` clause writes no failure.

### EIU3: the corpus

Remove each exported `fails` clause whose set equals the inferred set, in
`fixtures/examples`, `fixtures/applications`, `fixtures/tutorial`, and the
playground examples. Replace the method lists of `fixtures/examples/users.eff`
with `with Users`, as the target form shows. Keep `fails` on service methods,
function types, binding annotations, and `.effi` providers. Keep the test
fixtures in `fixtures/emit`, `fixtures/errors`, and `fixtures/parse` unless a
test needs a change.

Each application test that removes a clause entry to prove a lost channel now
removes a `with` entry, or adds a `fails` bound in the test source.

Acceptance: each application builds with `--tsc` and 0 diagnostics. The emitted
`.ts` files have no change. The IR snapshot changes only in `written.fails`.

### EIU4: the documentation of this repository

Files: `docs/language-rules.md`, `docs/inferred-input-contracts.md`,
`docs/tutorial.md`, `docs/api.md`, `docs/editor.md`, `CONCEPTS.md`,
`docs/status.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, and each other file
that `grep` finds with a `uses` clause.

The `AGENTS.md` condition "keep explicit exported contracts" changes to: exports
state their result type and their services, and the compiler infers their
failures.

Acceptance: no document outside `docs/archive/` shows a `uses` clause. The docs
tests pass.

### EIU5: the website and the specification

Files in `../effektive/public/`: `effektive-spec.html`, `index.html`,
`site.js`, and `effektive-examples/`. Remove the exported `fails` clauses from
the examples, as EIU3 does in this repository. Rewrite the prose about
contracts to rules R1 to R8. Add a paragraph to "Change history". Follow the `AGENTS.md` of that repository. Verify each
changed example with the compiler, and run the strict checks of the site.
Commit in that repository separately.

### EIU6: mutation of the changed modules

Run `deno task mutate` on the changed lines of the EIU1 and EIU2 modules, in a
detached scratch worktree at the committed head. Give each survivor a literal
test or a register row that names its code fact.

Acceptance: `deno task mutate` exits 0 for the changed modules.

## Findings

Fable reviewed the EIU2 design on 2026-11-03, read-only. The orchestrator
checked EIF4 and EIF7 in the code and accepted each finding.

| ID | Finding | Resolution |
| --- | --- | --- |
| EIF1 | `exportedValueIds`, `buildTypeGraph`, `foreignTypeGraph`, and `buildInterface` read only written sets. `modesAsSolved` gives empty sets. An importer then sees no inferred failure, and the validator gives `validation/009`, or `validation/001` for a private error. | These functions take the solved sets of the module. A written set wins over a solved set, as in `contractOf`. |
| EIF2 | The span-only rebuild in `src/core/db.ts` near line 407 keeps the old hash and would publish empty sets. | The checked module stores its solved map, and the rebuild passes it. |
| EIF3 | Many tests build a `ModeMap` by hand. | Keep `ModeMap`. The bodies and the checked module carry a second map `solved`, in source order. |
| EIF4 | `checkFunctionBody` already adds `SchemaError` for a checked input and sets the mode to `effect` (`src/core/check_expr.ts:2961`). | Report `failure-contract/001` there only when `fails` is written. |
| EIF5 | The inlay hint goes after the last clause, so ` fails E` would follow `with S`. | Put the failure hint before the `with` clause. |
| EIF6 | Recursive groups and importer rechecks need no change. | None. |
| EIF7 | More tests drift: `tests/open_contracts_test.ts:207`, and after EIU3 `tests/check_test.ts:507` and `:538`, and `tests/check_body_test.ts:646`. | EIU2 and EIU3 update them. |
| EIF8 | Two cases are not in the acceptance list: a body that stops failing makes an importer's `catch` arm unreachable (`failure-contract/002`), and a foreign error reached through an imported call. | EIU2 adds both as literal tests. |
