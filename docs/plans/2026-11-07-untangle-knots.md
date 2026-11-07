# Untangle the remaining knots

Status: in progress on the branch `untangle-knots`. The user asked for a branch for this work, and the branch is not pushed or merged.

A knot is one of four defects: a leaky abstraction, a drifted copy, a stale workaround, or an empty wrapper. Three read-only audits found 29 candidates on 2026-11-07. This plan keeps the 13 candidates that Opus confirmed in the code and that the [2026-11-06 untangle plan](../archive/plans/2026-11-06-untangle-codebase.md#kept-on-purpose) did not keep on purpose. The wiring diagram and its knot data are in the gitignored `demos/untangle/`.

## Constraints

- Each fix keeps emitted TypeScript byte-identical. The golden files and the mutation fixtures do not change.
- Each fix keeps CLI and language server output, except KN5 and KN11. Those two change output on purpose, and each gets a test that fails before the fix.
- The validator duplication, the emitter `ROWS` table, and every item on the kept list of the 2026-11-06 plan stay.
- The gate after each knot is `deno task check` (format, lint, type check, all tests, the playground build) and `deno task behavior:compare <before> <after>`. When a gate fails, the knot is rolled back.

## Knots

Ranked worst first. The rank counts the files and call sites that the knot touches, and the chance that it causes a later defect.

| ID | Kind | Knot | Sites | Untangle step |
| --- | --- | --- | --- | --- |
| KN1 | Drifted copy | Two walks decide which declarations a module exposes. The emitter export set and the interface payload can disagree. The provider arm already differs. | `src/core/emit/decls.ts:69`, `src/core/referenced_ids.ts:7`, `src/core/interface.ts:122` | One declaration walk in `referenced_ids.ts`. The emitter and `interface.ts` use it. |
| KN2 | Leaky abstraction | The host rebuilds core path rules. `isSourcePath` has two meanings with one name. The `.eff`, `.effi`, and `.map` names are built by hand. | `src/host/workspace.ts:21`, `src/core/paths.ts:36`, `src/host/outputs.ts:186,262,283`, `src/core/emit/emit.ts:150` | Rename the host predicate. Add `sourceMapPathOf` and `modulePathsOf` to `paths.ts`. |
| KN3 | Drifted copy | Four classes copy the child-node helpers, and `check_declarations.ts` borrows them from the type lowerer. | `src/core/resolve.ts:374`, `src/core/type_lower.ts:138`, `src/core/check_expr.ts:270`, `src/core/lower.ts:305`, `src/core/check_declarations.ts:273` | `kidsOfKind(tree, node, kind)` in `syntax_queries.ts`. |
| KN4 | Stale workaround | The checker computes a constant order and a dependency map that no product code reads. The header says that the emitter reads the order. The emitter computes its own order from the IR. | `src/core/initialization.ts:5,104`, `src/core/check_project.ts:114` | Delete `order` and `dependencies`. Keep `cycles`. Correct the comment. |
| KN5 | Drifted copy | Semantic tokens test `kind >= TokenKind.Arrow`, which matches `Unknown` and misses `Eq`. The playground keeps its own operator set. | `src/core/editor_tokens.ts:171`, `playground/src/highlight.ts:49`, `src/core/lex.ts:54` | One operator set in `lex.ts` for both highlighters. |
| KN6 | Leaky abstraction | The emitter and the lowerer parse identity strings by hand. | `src/core/emit/identity.ts:30`, `src/core/emit/module_state.ts:269`, `src/core/lower.ts:936` | `tokenOfId` moves to `ids.ts`. Use `isValueId`. The pipeline binding carries its name. |
| KN7 | Leaky abstraction | The program cache key lists the config fields in `db.ts`. | `src/core/db.ts:124`, `src/core/project_config.ts:32` | `configKey` moves to `project_config.ts`. |
| KN8 | Drifted copy | Six sites write the test "this component is a cycle". | `src/core/emit/decls.ts:214`, `src/core/initialization.ts:89`, `src/core/check_project.ts:387`, `src/core/recursion_guard.ts:194`, `src/core/project.ts:404`, `src/core/check_declarations.ts:591` | `isCycle(component, edges)` in `graph.ts`. |
| KN9 | Drifted copy | Two canonical JSON printers share their key order and their undefined rule. | `src/core/serialize.ts:73`, `src/core/content_id.ts:11` | One printer with a compact and an indented layout. |
| KN10 | Leaky abstraction | The language server narrows the `log` option and never reads it. The wire log parses the raw message again. | `src/lsp/wire_log.ts:72`, `src/lsp/protocol.ts:392` | The wire log uses `narrowInitializeParams`. |
| KN11 | Leaky abstraction | Completion and the occurrence index sort with the host locale. | `src/core/editor_completion.ts:121`, `src/core/editor_index.ts:174` | Use `compareText`. |
| KN12 | Stale workaround | `BodyEnv.proofBudget` is optional, and the refinement checker has a fallback that no product path uses. | `src/core/body_env.ts:11`, `src/core/check_refinements.ts:70` | Make the budget required. |
| KN13 | Empty wrapper | Seven protocol narrowers only forward. `sourceModuleOf` only forwards. `frontend.ts` exports `symbolIndex` without a user. Both arms of an `if` in `fields.ts` return the same text. | `src/lsp/protocol.ts:431`, `src/lsp/generated_texts.ts:15`, `src/core/frontend.ts:13`, `src/core/emit/fields.ts:104` | Typed constants, inline, remove the export, delete the `if`. |

## Not selected

- Kept on purpose by the 2026-11-06 plan: the four freshness checks of the language server (G.H14), the save-round parameters (G.N4, G.S6), the two span movers (G.H12), the re-read of written files (G.N3), the coverage keys (B.H13), `guardedRecord`, and the separate term keys of the two predicate compilers (UNF8).
- Behavior changes without an application blocker: the qualified names in effect lists of `type_show.ts`, the `\r\n` clamp of CLI positions, and the sealed-type authority in `types.ts`.
- Speculative: an exhaustive severity map in the CLI and the language server. The core has one severity.

## Units

Sonnet implements KN1, KN2, KN3, KN4, KN5, KN6, KN8, and KN9, each in a detached scratch worktree with a turn budget of 60 tool calls. Opus implements KN7 and KN10 to KN13 directly. Opus applies each knot to the branch in rank order, reviews the diff, and runs the gate.

## Progress

| ID | Commit | Gate |
| --- | --- | --- |
