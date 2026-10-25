# Architecture review, 2026-10-25

This review covers the overall state of the code, the code organization, and the architecture at commit `252f3e3` (v0.10.0). It uses the prefix RV. Two reviewers worked independently and read-only, with one shared brief: a Fable subagent and Codex with the model `gpt-6-astra`. The main session merged the two reports and checked the items marked "confirmed" against the source.

## Summary

The architecture holds. The layers depend only downward, and the measured import graph has no violation. The IR validator imports only `ir.ts`, `source.ts`, and `diagnostics.ts`, so it stays independent of the checker. The core has no Deno calls and no imports from the command-line tool, the host adapters, or the language server. The value imports of `src/` have no cycle.

Two items need attention before more release work. First, the output writer can overwrite a handwritten TypeScript file (RV1). Second, `deno task check` fails on main, because commit `252f3e3` changed the version only in `deno.json` (RV2). The structural hot spots are `types.ts` and the large checker and lowering classes. Several small duplications make an Effect upgrade or a target change touch 8 to 14 files.

## Measurements

| Measure | Value | Source |
| --- | --- | --- |
| TypeScript in `src/` | 45,909 lines in 124 files | astra |
| `src/core` with subdirectories | 41,616 lines in 101 files | astra |
| Tests | 174 files, 55,042 lines: 130 fast, 34 slow, 10 helpers | both |
| Fast suite | 2,131 passed, 1 failed, 11.9 s | Fable |
| Diagnostic codes | 78 registered. 69 have a fixture marker, and the other 9 occur in tests | Fable |
| `throw` sites | 96 in `src/core`, 0 in `src/cli`, `src/host`, and `src/lsp` | Fable |
| `any` in `src` | 0 | Fable |

Largest files: `check_expr.ts` 2,410 lines, `check.ts` 2,303, `types.ts` 1,952, `lower.ts` 1,866, `emit/expr.ts` 1,781.

Longest source functions (`deno task measure:functions`; lines and cyclomatic complexity): `schemaStructural` (`emit/families/schema.ts:24`, 379, 37), `render` (`emit/doc.ts:345`, 324, 50), `lex` (`lex.ts:392`, 247, 51), `BodyLowerer.invoke` (`lower.ts:810`, 234, 51), `streamStructural` (`emit/families/stream.ts:35`, 232, 16), `completionsAt` (`editor_completion.ts:77`, 209, 94), `TypeTable.assignable` (`types.ts:1413`, 194, 121), validator `assignable` (`validate/typing.ts:232`, 187, 116), `compute` (`validate/expr.ts:550`, 185, 101). Line counts include comments and nested functions. A long flat switch is not a cohesion problem by itself.

## Findings

RV1 (high, confirmed, astra). The output writer overwrites any file at the output path. `writeGenerated` (`src/host/outputs.ts:129-133`) writes when the old text differs, and it does not check the generated header. The cleanup code does check the header (`generatedHeader`, `outputs.ts:148`). So a new `m.eff` beside a handwritten `m.ts` destroys `m.ts` with no diagnostic. The command-line build and the language server save both use this writer. An unreadable existing file also reaches the write. Change: refuse to write over a file whose first line is not the generated header of that source, and report it as an error. Blast radius: `src/host/outputs.ts` and its tests.

RV2 (high, confirmed, both). The gate is red on main. `deno.json:3` says 0.10.0, and `editors/vscode/package.json:5` and `package-lock.json:3,9` say 0.9.0. The test "the extension and its lock file carry the compiler version" (`tests/vscode_client_test.ts`) fails, as designed. The version has three hand-kept copies, plus the VSIX name in `docs/installation.md` and `editors/vscode/README.md`. Fixed in commit `c7d7402`: `deno.json` is now the only source of the version. The packager writes it into the packaged manifest, and the VSIX name has no version.

RV3 (medium, confirmed, astra). Generated-code previews omit the companion modules of host interfaces. The core emits `.effi.ts` files, but the playground (`playground/src/compile.ts:103`, `playground/src/model.ts:110`) and the language server preview (`src/lsp/features.ts:240`) accept only `.eff` paths. The playground also says that a host interface has no generated code, and `tests/playground_model_test.ts:110` keeps that old assumption. Blast radius: playground compile and model code, the language server preview, and their tests.

RV4 (medium, Fable and astra). `TypeTable` (`types.ts:376`) has 54 methods. It covers interning, definitions, IR conversion (`fromIr` and `toIr`), assignability, and printing. `BodyChecker` (`check_expr.ts:187`) has about 2,150 lines, and `check.ts` holds `TypeLowerer` (747 lines) and `ModuleChecker` (925 lines). Change: move IR conversion and printing out of `types.ts` into their own files, and split `completionsAt` by position kind. A rewrite of the large classes has no demonstrated benefit. Review them when they change.

RV5 (medium, Fable). The strict target options (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) are written in 8 files, and the literal `npm:effect@4.0.5` occurs in 14 files. An Effect upgrade or a target change has no single source. Change: one target constant, imported by `src/cli/tsc.ts`, `tests/target_helpers.ts`, and `bench`. The fixture `deno.json` files are user projects and stay. Blast radius: 8 files.

RV6 (medium, Fable). 21 bare `throw new Error("internal: ...")` sites have no Result boundary, for example `types.ts:420`, `check_project.ts:177`, and `parse.ts:240`. The command-line tool catches them (`src/cli/main.ts:122`, exit 3), and the language server answers `internalError` and stays alive (`src/lsp/server.ts:382-386`). `Program.update` (`db.ts:317-345`) updates its memo state before `check` runs, and no test shows a correct update after such a throw. This is an inference, not a tested fact. Change: one test that forces an internal failure in `check` and then runs a good update.

RV7 (low, confirmed, both). The emitter reaches checker-phase modules through two imports. `emit/decls.ts:25` imports `stronglyConnectedComponents` from `modes.ts`, which imports `types.ts`. `emit/scope.ts:30` imports path helpers from `project.ts`, which imports the index and the parser. Change: move the graph helper to `util.ts` or a new `graph.ts`, and the path helpers to a small module with no dependencies. Add a transitive import test for the emitter and the validator.

RV8 (low, astra). The writer reduces emit errors to their tag and source-map errors to one fixed sentence (`src/host/outputs.ts:109`, `:113`). An injected error printed only `error: cannot emit m: internal`. Change: include the message.

RV9 (low, Fable and astra). The text of the generated header occurs three times: `emit/emit.ts:169`, `src/host/outputs.ts:149`, and `src/host/workspace.ts:110`. A change to the header in one place breaks cleanup or the workspace filter. Change: one shared helper, together with RV1.

RV10 (low, Fable). Small copies: `compareText` (`util.ts:4`, `serialize.ts:29`), `MAX_DEPTH = 1536` with the same comment (`types.ts:327`, `patterns.ts:37`), the `PATTERN_KINDS` set (`syntax_queries.ts:153`, `lower.ts:182`, `resolve.ts:304`), and the guard text "is not part of the analysis" (`check.ts:2288`, `check_project.ts:177`, `:473`). `scripts/golden_update.ts` and `scripts/validate_fixtures.ts` import `tests/helpers.ts`, so tooling depends on the test tree. Change: delete the copies.

RV11 (low, both). Unused exports. 17 exported types have no reference outside `src/core` (Fable lists them). `Compile` occurs only at `ir.ts:336` (astra). `readConfig`, `numericBrand`, and `allResultsCall` have only same-file callers. `typescript.ts` re-exports three modules with `export *`, which also exposes `hostAssertionAtOffset`, `zeroBasedPosition`, `SourceMapOptions`, and `DenoCheckOutput` without a caller. Change: named export lists in `typescript.ts`, and drop the unused names when their files change.

RV12 (low, confirmed for the first item, Fable and astra). Docs drift. `docs/transpiler-design.md:684-686` says that a match does not test the last arm. The code (`emit/expr.ts:1352-1356`) and `docs/language-rules.md` say that a last arm other than `_` has a test and the else branch throws. `docs/api.md:79` places `emitProject` in `emit/emit.ts`, but it is in `typescript.ts:35`. `docs/api.md:137` names four application witnesses, and there are five. The `docs/api.md` file map lacks `editor_hints.ts`, `emit/emitted.ts`, `emit/families/`, `validate/builtins.ts`, and `bench/m7.ts`.

RV13 (low, Fable). The slow suite gets a fresh `DENO_DIR` for each run (`scripts/test_slow.ts:6,17`), so each `deno task check` downloads Effect again and needs the network. Its share of the check time needs measurement. `tests/emit_slow_test.ts` is 5,444 lines with 88 tests, and a split by builtin family would help navigation.

## Accepted as they are

The checker and the validator duplicate their rules on purpose. Each builtin touches the checker row, `lower.ts`, an emit family, and a validate family. `docs/status.md` records the merge of the first three (ARC-5) as declined, and neither reviewer proposes to reopen it. The two failure classes in lowering and emission (`LowerFailure`, `EmitFailure`) look alike, but merging them would couple the two phases for about 20 lines. Tests that use internal APIs (`Scope.resolve`, validator `fits` and `same`, emitter shape walkers) give independent evidence, so removing them would weaken verification. The fixture update flow and the benchmark harnesses work, and neither reviewer found a reason to replace them.

## Recommended order

1. RV2: done.
2. RV1 and RV9: protect handwritten files, with one header helper.
3. RV3: companion modules in the previews.
4. RV7 and RV5: emitter imports and one target constant.
5. RV4, RV6, and RV10 to RV13, when the files change.

## Not checked

Neither reviewer ran the slow suite, the benchmarks, the VSIX packaging, the playground in a browser, or the editor in VS Code. Neither measured memory or latency. Neither read the sibling website repository. The duplicate search compared names and short bodies, not every function body.
