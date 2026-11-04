# Plan: write the inferred failure set as a `fails` clause (WF)

Status: proposed. The decisions WFD1 to WFD5 wait for the user. No unit starts before the user accepts them.

IDs: WFD (decisions), WFU (units), WFF (validation findings).

## Goal

A user can turn the inferred failure set of a function into a written `fails` clause with one editor action. The written clause is the accepted guard against failure drift (EID4). After the edit, a new failure in the body gives `failure-contract/001`, with a related location at the new failure.

## Origin

The feature review of 2026-11-04 ranked this addition as AD4 (`docs/archive/feature-review-2026-11-04.md`). EID4 (`docs/archive/plans/2026-11-03-inferred-export-failures.md`) chose a written `fails` clause and inlay hints as the drift guard, with no snapshot file. Today the user must type the set by hand. XC3 states the risk: a new failure in an export with an inferred set reaches host TypeScript with no diagnostic.

Plan PV (`docs/archive/plans/2026-11-04-contract-provenance.md`) is complete. So the later `failure-contract/001` already names the node that adds the failure.

## Current behavior

These statements come from the code at `134cbb9` and from probes in a scratch project.

1. The contract quick fix only extends a written clause. `contractActionsAt` (`src/core/editor_actions.ts:81`) computes no missing failure for an omitted `fails` clause (`src/core/editor_actions.ts:111-115`). An action must remove at least one diagnostic and add none (`src/core/editor_actions.ts:198-203`). A function with an inferred set has no diagnostic to remove, so the rule excludes it.
2. The inlay hint shows the inferred failures, such as ` fails UserMissing`, at the end of the result type (`src/core/editor_hints.ts:53-71`). A function with a diagnostic inside its span gets no hint (`src/core/editor_hints.ts:34-38`). An empty set gives no hint (`src/core/editor_hints.ts:58`).
3. `check --fix` applies `contractActionsAt` to every module in rounds (`src/cli/fix.ts:28-48`). It never writes a clause that the source omits.
4. The language server gives every action the kind `quickfix` (`src/lsp/features.ts:613-617`). The server advertises only `quickfix` (`src/lsp/protocol.ts:143`). The parameter check reads only `textDocument` and `range` (`src/lsp/protocol.ts:561-564`), so the server ignores `context.only`.
5. `fn.failures` of a checked function is the invocation set. For an omitted clause, it is the inferred set (`src/core/check_expr.ts:166-167`). For an export with a checked input, it includes `SchemaError` (`src/core/check_expr.ts:3009`). The set is sorted by error identity, and the hint prints it in that order.
6. `effectName` finds the name of an error through the module namespace and the reserved names `SchemaError`, `SchemaIssue`, and `TimeoutError` (`src/core/editor_actions.ts:16-37`). It gives `undefined` for an error that the module cannot see.
7. A `fails` clause can hold `never`. The resolver skips the name (`src/core/resolve.ts:949`), and lowering gives an empty set. A probe showed that `export const bad = (n: N): N fails never => fail(Boom({ n }))` gives `failure-contract/001` with the note line "can fail with `Boom` here". `docs/language-rules.md` documents `never` as an empty set only for Effect values (row "Effect value compatibility").
8. A probe wrote the inferred set as a clause on four exports: a pure export (`fails never`), an export with a service failure (`fails Boom`), an export whose `try` handles every failure (`fails never`), and an export with a checked input (`fails SchemaError`). The emitted TypeScript did not change.
9. A `fails` clause needs a written result type. The arrow header parses the effect clauses only after `:` and a result type (`src/core/parse.ts:1486-1492`). The probe `const local = (n: N) fails Boom => ...` gives `syntax/008`.
10. The header parts come in a fixed order: parameters, result, `fails`, `with`, then `=>` (`src/core/parse.ts:1486-1495` and `src/core/parse.ts:942-945`). So text inserted at the end of the result type stays before a written `with` clause.

## Rules after the change

The rules use the recommended option of each decision.

1. A new exported query `failsClauseActionsAt(revision, path, start, end)` in `src/core/editor_actions.ts` returns zero or one action. `check --fix` does not call it.
2. The candidate is the module-level function whose header contains `start`. The header runs from the start of the declaration to the end of its `=>` token. Thus one request checks at most one function. A cursor in the body gives no action.
3. The candidate must have `annotation === "arrow"`, a written result, no written `fails` clause, and a body. Its declaration must not be broken. No diagnostic may lie inside its span, as for the inlay hint.
4. Each error of `fn.failures` must have a visible name through `effectName`. If one error has no visible name, the query returns no action, because the XCD5 deferral forbids an added import.
5. The edit inserts ` fails A | B` at the hint position: the end of the result type. The names come in the order of `fn.failures`, which is the order of the hint. For an empty set, the edit inserts ` fails never` (WFD4).
6. The query checks the edited project before it returns the action. The function's failure set, requirement set, and execution mode must equal the values before the edit. The diagnostic comparison (`diagnosticDelta`) must show no added diagnostic. If a condition fails, the query returns no action.
7. The title is the inserted clause, such as `Write fails StoreUnavailable | UserMissing` or `Write fails never`.
8. The language server gives the action the kind `refactor.rewrite`, as the TypeScript server does for its "infer return type" action. The server advertises `["quickfix", "refactor.rewrite"]`. When a request has `context.only`, the server returns only the actions whose kind equals an entry or starts with that entry and a dot. The contract quick fixes come first in the answer.
9. The VS Code client needs no change. `vscode-languageclient` 10.1.2 passes the new kind through.

## Decisions

| ID | Decision | Options |
| --- | --- | --- |
| WFD1 | Editor surfaces | (a) A code action only. (b) A code action, and also text edits on the inlay hint, so that a double click on the hint writes it. The hint path would check names but not the edited project, because the editor asks for hints on each scroll. |
| WFD2 | Command-line batch form | (a) None now. The action is a choice for each function. A batch that writes a clause on every export works against the accepted change of 2026-11-03, which made inferred failure sets the terse default. (b) A new flag, for example `check --write-fails`, that writes the clause on every export without one. |
| WFD3 | Which functions get the action | (a) Every module-level function that writes a result type and omits `fails`: exports and locals, the same scope as the inlay hint. (b) Exported functions only. |
| WFD4 | A function with an empty inferred set | (a) Write `fails never`, and document that form for function headers in the rules and the website specification. The drift that host TypeScript does not catch is mostly an effectful export whose empty failure channel gains an error. (b) Give no action for an empty set. |
| WFD5 | Plan validation before execution | (a) Fable validates this plan read-only, and the orchestrator resolves each finding before WFU1 starts, as `AGENTS.md` asks for a non-trivial plan. (b) No validation. |

Recommendations: WFD1 (a), WFD2 (a), WFD3 (a), WFD4 (a), WFD5 (a).

## Units

The units run in order. Each Sonnet executor gets a dispatch with all the context it needs, and it must not run `git checkout`, `git restore`, or `git stash`.

| ID | Model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| WFU1 | Sonnet | `src/core/editor_actions.ts` (the new query); `src/core/editor_hints.ts` (move the hint position loop at lines 59-69 into one helper that the hint and the query share, with no change of hint behavior); `src/core/frontend.ts` (export); `tests/editor_actions_test.ts` (the matrix below) | Each matrix case passes with literal expected values. The existing editor tests pass unchanged. The handback gives the measured wall time of one `failsClauseActionsAt` call on the largest project in `fixtures/applications/`, and of one `contractActionsAt` call that returns an action, for comparison. `deno task check` exits 0. | 40 |
| WFU2 | Sonnet | `src/lsp/features.ts`; `src/lsp/protocol.ts` (the kinds and the `context.only` check); `tests/lsp_editor_test.ts`; `tests/surface_cases.ts` (one new code action step after the last step, on the hints document); `fixtures/surface/lsp.json` through `deno task surface:update` | New fast tests assert: the kind and the edit of the action on a function with no diagnostic; `context.only: ["quickfix"]` removes it; `context.only: ["refactor"]` keeps it; an invalid `context.only` gives error -32602. The `lsp.json` diff changes only the advertised kinds and adds the new step. `deno task check` exits 0. | 30 |
| WFU3 | Opus (orchestrator) | `docs/editor.md` (the contract action paragraph, and the server capabilities in the section "Language server"); `docs/language-rules.md` (row "Inferred contracts": `fails never` closes an empty set); `CONCEPTS.md` (the `fails` clause entry); `CHANGELOG.md` (Unreleased); website `../effektive/public/effektive-spec.html`, committed separately | Each changed statement matches the code. `deno task check` exits 0. The site's strict checks pass. | Direct |
| WFU4 | Sonnet | `fixtures/mutation/survivors.json`; tests that kill survivors | `deno task mutate` on the new lines of `src/core/editor_actions.ts`, the helper in `src/core/editor_hints.ts`, and the changed lines of `src/lsp/features.ts` and `src/lsp/protocol.ts` exits 0. Each survivor has a kill test or a register row with a reason. The run uses a detached scratch worktree at the committed head, on a quiet machine. | 40 |

## Fixture matrix of WFU1

The cases use the `PRELUDE` of `tests/editor_actions_test.ts` unless a case names other text. Each expected text is literal. Where this plan gives an order of names, the order is by error identity. The executor confirms each expected text against the real output before it fixes the literal.

| Case | Input | Expected |
| --- | --- | --- |
| W0 | The text of `fixtures/examples/users.eff`, cursor on `getUser` | One action. It inserts ` fails StoreUnavailable | UserMissing` after `User` in the header of `getUser`. The edited project has 0 diagnostics. |
| W1 | `export const f = (n: Int): Int => if (n > 0) { fail(Stop({})) } else { fail(Other({})) }` | Title `Write fails Other | Stop`. The header becomes `(n: Int): Int fails Other | Stop =>`. |
| W2 | An export with `with Clock.now` whose body fails with `Stop` | The clause goes before `with`: `(): Int fails Stop with Clock.now =>`. |
| W3 | The header of W2 split over two lines, with `with` on the second line | ` fails Stop` goes at the end of the first line. The second line does not change. |
| W4 | An export with a checked input, such as `export const c = (n): Int => n + 1` | The header gets ` fails SchemaError`. The edited project has 0 diagnostics. |
| W5 | `export const p = (n: Int): Int => n` | Title `Write fails never`. The header becomes `(n: Int): Int fails never =>`. |
| W6 | An export whose `try` handles its only failure | The header gets ` fails never`. |
| W7 | `lib.eff` exports `Int`, the error `Hidden`, and a function `boom` that fails with `Hidden`. `m.eff` imports `Int` and `boom`, not `Hidden`, and exports `f` that calls `boom()` | No action. |
| W8 | `export const f = (): Int fails Stop => fail(Stop({}))` | No action from the new query. |
| W9 | `const l = (n: Int) => n` (no written result) | No action. |
| W10 | An export whose body has an unknown name | No action. |
| W11 | The text of W1 with the cursor at the declaration start, at the end of `=>`, and in the body | An action, an action, and no action. |
| W12 | Two exports, with the range from the header of the first into the header of the second | One action, for the first export. |
| W13 | A function whose result comes from a binding annotation | No action. |
| W14 | The edited text of W5, with the body changed to `fail(Stop({}))` | One `failure-contract/001` diagnostic, with one related location at the `fail` call. |
| W15 | A function in a recursive group | One action. The edited project has no new diagnostic. |

## Risks and limits

1. Each request checks the edited project once, as the contract quick fix does. Rule 2 limits a request to one function. WFU1 measures the time. This plan sets no limit before the measurement.
2. When an error has no visible name, the hint still shows the set, but no action appears. The user must add the import first. An action marked disabled, with the reason, is a follow-up.
3. The plan checks the language server answer, not the VS Code menu. Probably VS Code lists a `refactor.rewrite` action under the light bulb and in the Refactor menu. A manual check in VS Code after WFU2 confirms it.
4. `fails never` is an existing resolver rule, but no document states it for a function header. WFU3 documents it.
5. A written clause adds words to the source. The action is a choice for each function, so the terse default stays.

## Out of scope

The command-line batch form (WFD2 b), text edits on the inlay hint (WFD1 b), import insertion (XCD5), a named error set in the written clause, disabled actions with reasons, actions in the playground, and the phase 2 tooltip of contract origins.

## Validation findings

None yet.

## Results

None yet.
