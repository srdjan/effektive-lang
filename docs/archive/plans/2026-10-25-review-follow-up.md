# Review follow-up plan, 2026-10-25

This plan fixes the first findings of `docs/architecture-review-2026-10-25.md`. It uses the prefix RF. The user approved three decisions on 2026-10-25: protect handwritten files (RV1 with RV9), show the companion modules in the previews (RV3), and one target constant with clean emitter imports (RV5 with RV7). Each RF unit is one commit, and `deno task check` passes before each commit. The units run in the order RF1, then RF2 and RF3.

## RF1: the writer protects handwritten files (RV1, RV9)

Problem. `writeGenerated` (`src/host/outputs.ts:129-140`) writes `<module>.ts` and `<module>.ts.map` when the text differs. It does not check that the existing file is generated. A new `m.eff` beside a handwritten `m.ts` destroys `m.ts`, with no diagnostic. The command-line build, `watch`, and the language server save use this writer. The header text occurs in three places: `src/core/emit/emit.ts:169`, `src/host/outputs.ts:149`, and the regular expression in `src/host/workspace.ts:110`.

Change.

1. Create `src/core/paths.ts` with no imports from other core modules except `source.ts` types if needed. Move `joinPath`, `normalizeRelative`, `moduleNameOf`, and `generatedPathOf` from `src/core/project.ts` into it. Update every importer: `project.ts` itself, `src/core/frontend.ts:44-49` (the export list), `src/core/db.ts:57`, `src/core/emit/scope.ts:25-30`, `tests/project_test.ts`, and `bench/m2.ts`. Do not keep a re-export in `project.ts`.
2. Add two functions to `paths.ts`. `generatedHeader(source)` returns `// Generated from ${source} by the Effektive compiler. Do not edit.`. `generatedSourceOf(text)` returns the source that the first line of `text` names, when that line is exactly a generated header, and otherwise `undefined`. It ignores one trailing `\r` on the first line, so a file with CRLF line ends still counts as generated.
3. `emit.ts` uses `generatedHeader(scope.source)`. `workspace.ts` keeps a file when `generatedSourceOf(text) === undefined`. `removeStaleOutputs` compares `generatedSourceOf(read.value) === source`. Delete the private `generatedHeader` in `outputs.ts`.
4. In `writeGenerated`, the `.ts` file decides for the pair. Let `source = generatedSourceOf(emitted.text)`. A real emit always has the header, but a test double can lack it, so the guard needs `source !== undefined` (see below). Read the existing `.ts` file:
   - The text is equal: skip the `.ts` file, as now, and continue with the map.
   - The file is missing, or `source !== undefined && generatedSourceOf(old) === source`: write the `.ts` file and the map, as now.
   - The file exists, and the condition above is false: write neither file. Add the note `error: cannot write ${path}: the file exists and is not generated from ${source}. Move or delete it.` and set `failed`.
   - The read fails with `unreadable`: write neither file. Add `error: cannot read ${path}: ${message}` and set `failed`.
   Keep the map logic otherwise as it is. On a refusal, leave the module out of `generated` and `tables`, because `--tsc` checks the files in `generated` and would check the handwritten file against the span table. A failed write keeps its current behavior.
5. Give the `EmittedModule` double in `tests/outputs_generation_test.ts:14-20` a header first line for `m.eff`, so the existing tests, including "writeGenerated dry runs and partial write failures", stay green. Tests, in-memory `CliFs` as in that file: a handwritten `m.ts` stays unchanged, gets the note, sets `failed`, and gets no `m.ts.map`; a file with the header of the same source is replaced; a file with the header of another source is kept; a CRLF header counts as generated; an unreadable file gives the read note; a missing file is written. Unit tests for `generatedSourceOf`: exact header, CRLF, another first line, empty text, a header with text after it on the same line. Keep the existing stale and workspace tests green.
6. The command-line tool already prints notes to stderr and exits non-zero when `failed` is true, and it skips `--tsc` then (`src/cli/build.ts:113-115`). The language server logs notes like other write errors (`src/lsp/projects.ts:488`). Keep that. A refused file logs its note again on each save round; accept that.
7. In `docs/api.md` (about lines 22 and 46), add `paths.ts` and remove the path helpers from the `project.ts` line. Add a line to `CHANGELOG.md` under "Unreleased": the build no longer overwrites a `.ts` file that it did not generate. Files from versions before the rename to Effektive carry another header and are now refused; delete them once.

## RF2: the previews show companion modules (RV3)

Problem. The core emits `<module>.effi.ts` for a host interface file. The playground (`playground/src/compile.ts` `effModulesOf`, `playground/src/model.ts:110`, `playground/src/app.ts:403-404`) and the language server preview (`src/lsp/features.ts:46` `effModuleOf`, `request` at about line 240) accept only `.eff` files. The playground says that a host interface file has no generated code, which is wrong.

Change.

1. Language server: `effModuleOf` returns the module of any source file, `eff` or `effi`. Rename it to `sourceModuleOf`. `request` accepts `.eff` and `.effi` paths.
2. VS Code client: `virtualUriOf` (`editors/vscode/extension.js:36-42`) maps `foo/host.effi` to `effektive-generated:foo/host.effi.ts?...`. `showGeneratedTypeScript` (`extension.js:149-157`) accepts `.effi` too, and its message names both kinds of file. The notification handler reuses `virtualUriOf`.
3. Playground: `effModulesOf` includes `effi` modules. Delete the `interface` tag of `OutputState` and the message in `app.ts`. Fix the comments that name `effModuleOf` or say `.eff` only (`compile.ts:3`, `:52`, `:63`, `:102`). A `.effi` file shows its companion module like an `.eff` file shows its output, including the `stale` and `none` states.
4. Tests: update `tests/playground_model_test.ts:110` to the new behavior. Add a language server test that requests the generated text of an `.effi` file and gets the companion module. The client has no virtual URI test today, so add none.
5. Search the docs (`docs/`, `editors/vscode/README.md`, `playground/`) for text that says a host interface has no generated code, or that the command works only for `.eff`. Update it.

## RF3: one target constant and clean emitter imports (RV5, RV7)

Problem. The strict target options and `npm:effect@4.0.5` are written in `src/cli/tsc.ts`, `tests/target_helpers.ts`, four slow tests, and `bench/m5_variants.ts`. The emitter imports `stronglyConnectedComponents` from `modes.ts` (`src/core/emit/decls.ts:25`), which imports `types.ts`. RF1 removes the other emitter value import, from `project.ts`.

Change.

1. Create `src/core/graph.ts` with `stronglyConnectedComponents`, moved from `modes.ts` without change. Delete it from `modes.ts`, which does not call it. The five importers import it from `graph.ts`: `project.ts`, `initialization.ts`, `check_project.ts`, `check.ts`, and `emit/decls.ts`. Update the `modes.ts` line of `docs/api.md` and add `graph.ts`.
2. Add a test beside the validator independence test (`tests/validate_test.ts:1613`), in `tests/emit_families_test.ts` or a new fast test file. It follows the value imports of `src/core/emit/**` transitively, and skips `import type` and `export type ... from` statements. A mixed `import { type A, b }` counts as a value import. It asserts that the closure contains none of `types.ts`, `modes.ts`, `project.ts`, `parse.ts`, `index.ts`, `lower.ts`, `resolve.ts`, or a `check*.ts` file. Measure the closure first. If a module outside `emit/` that is not in that list pulls in a forbidden module, stop and report it.
3. In `src/cli/tsc.ts`, export `EFFECT_VERSION = "4.0.5"`, `TARGET_COMPILER_OPTIONS` (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, all true), and `TARGET_IMPORTS` (`effect` and `@effect/platform-node`, built from `EFFECT_VERSION`). `tscConfig` builds its text from them, and the text stays byte-equal.
4. Use the two constants in `tests/target_helpers.ts`, `tests/emit_slow_test.ts`, `tests/emit_extreme_identifiers_slow_test.ts`, `tests/emit_lift_slot_slow_test.ts`, `tests/temporal_stream_slow_test.ts`, and `bench/m5_variants.ts` (the bare version at line 31, and spread `TARGET_COMPILER_OPTIONS` into its tsconfig at line 73). `bench/m5.ts` already calls `tscConfig()`. `tests/emit_lift_slot_slow_test.ts` lacks `noUncheckedIndexedAccess` today, so the shared constant makes its check stricter. If that slow test then fails, stop and report it. Keep the literal in `tests/cli_test.ts:338`: it pins the output of `tscConfig`. The fixture `deno.json` files are user projects and stay. The repository `deno.json` stays.

Fable validated this plan on 2026-10-25. The main session applied its two must-fix findings and four optional ones.

## Out of scope

RV4, RV6, RV8, and RV10 to RV13 stay open in the review document. A language server message for a refused write, other than the log line, is not part of RF1.
