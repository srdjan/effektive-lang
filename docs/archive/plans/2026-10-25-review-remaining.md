# Remaining review work, 2026-10-25

This plan fixes the open findings of `docs/architecture-review-2026-10-25.md`: RV4, RV6, RV8, and RV10 to RV13. It uses the prefix RW. The user asked on 2026-10-25 to continue with the remaining work. Each RW unit is one commit, and `deno task check` passes before each commit. No unit changes observable compiler behavior, except RW1, which adds detail to error messages.

## RW1: the writer keeps the detail of emit and source-map errors (RV8)

Problem. `writeGenerated` (`src/host/outputs.ts`, the `emit` and `map` cases) prints only the tag of an emit error, and one fixed sentence for a source-map or span-table error. An injected failure printed only `error: cannot emit m: internal`.

Change. The `emit` note prints the message: `error: cannot emit ${name}: ${message}`. The `EmitProjectError` tags `unsupported` and `internal` carry `message`. The `lowering` tag carries a `LowerError`; use `describeLowerError` (`outputs.ts:31`). `buildSpanTable` cannot fail (`src/core/emit/spans.ts:49-52`), and the `!table.ok` branch in `generationSource` (`src/host/generation.ts:54`) is dead, because the span table only forwards the emit error, which returns earlier. The only source-map error is `SourceMapError = { tag: "missing-source"; source }` (`src/core/emit/sourcemap.ts:91-94`). So the `map` variant of `Generation` carries `readonly error: SourceMapError`, and the note prints `error: cannot build the source map of ${name}: source ${error.source} is missing`. Remove the dead `table.ok` test if the types allow it. Update the two `{ kind: "map" }` literals in `tests/outputs_generation_test.ts` (about lines 114 and 168), and add a test for each of the three notes with a `GeneratedSource` double.

## RW2: a good update after an internal failure in check (RV6)

Problem. 21 internal `throw` sites have no Result boundary. The command-line tool and the language server catch them. No test shows that `Program.update` (`src/core/db.ts:317`) gives a correct revision after `check` threw. Reading the code: `check` builds `entries` locally and assigns `this.entries` only at the end, and the files stay changed by design. So the state is expected to stay correct, but no test pins it.

Change. Add one fast test in the `Program` tests (find them with `git grep -l "new Program" tests`). Make a project with two modules. Run a good update. Then make `TypeTable.prototype.isAssignableIn` throw on its next call (save the original, and restore it in `finally`), change a module so that `check` runs again, and assert that `update` throws. Restore the method. Run a good update with new text. Assert that its diagnostics and the emitted text of each module equal those of a fresh `Program` given the same files. Fable confirmed with a probe that `isAssignableIn` is reached on a recheck (`BodyChecker.assignable`, `check_expr.ts:283`), and that `isAssignable` is not. `this.count++` (`db.ts:340`) and the parse memo advance before `check`, so do not compare revision ids or counters with the fresh program.

## RW3: delete the small copies (RV10)

1. `compareText`: `src/core/serialize.ts:29` copies `src/core/util.ts:4`. Import it from `util.ts`, unless the header of `serialize.ts` states a reason to stay import-free. In that case keep it and report.
2. `MAX_DEPTH = 1536`: `src/core/types.ts:329` and `src/core/patterns.ts:39`. Export one constant from `types.ts` (`patterns.ts` already imports types from it) and keep its comment once.
3. `PATTERN_KINDS`: `src/core/lower.ts:182` and `src/core/resolve.ts:304` copy the set in `src/core/syntax_queries.ts:153`, which exports `isPatternKind`. Use `isPatternKind` in both, and delete the two sets. Confirm first that the three sets are equal.
4. The text "module ${module} is not part of the analysis": `src/core/check_project.ts:174`, `:470`, and `src/core/check.ts:2289`. The guard at `check_project.ts:467-471` looks up only `resolution`, never uses it, and the `collectEntries` call on the next line throws the same text. Delete that guard. Keep the other two sites as they are.
5. Declined: `scripts/golden_update.ts` and `scripts/validate_fixtures.ts` import `tests/helpers.ts`. Tests already import `scripts/package.ts`, both trees are development code, and a move prevents no failure. Record this in the review document.

## RW4: named exports and unused exports (RV11)

1. `src/core/typescript.ts` re-exports three modules with `export *`. Replace each with a named export list of the names that a caller outside the re-exported module uses (search `src`, `tests`, `bench`, `scripts`, `playground`). This drops `hostAssertionAtOffset`, `zeroBasedPosition`, `SourceMapOptions`, and `DenoCheckOutput` from the surface if they have no caller.
2. `Compile` occurs only at `src/core/ir.ts:336`. Delete it if it has no use.
3. `readConfig` (`project.ts`), `numericBrand`, and `allResultsCall` have only same-file callers. Remove their `export`.
4. In a separate commit, for every other `export` in `src/core/**`: when the name has no reference outside its own file in `src`, `tests`, `bench`, `scripts`, or `playground`, remove the `export`. A re-export line counts as a reference, so a re-exported name stays. Delete a name that has no reference at all, also in its own file. Fable measured 80 such names and one (`Compile`) with no reference at all. List the removed names in the commit body. Leave the design history in `docs/transpiler-design.md:596,602`.

## RW5: docs drift (RV12)

1. `docs/transpiler-design.md:684-686` says that a match does not test its last arm. The code (`src/core/emit/expr.ts:1352-1356`) and `docs/language-rules.md` say that a last arm other than `_` has a test, and the else branch throws. Make the design document say what the code does.
2. `docs/api.md:79` places `emitProject` in `emit/emit.ts`. It is in `src/core/typescript.ts`. Fix it.
3. `docs/api.md:139` names four application witnesses. `fixtures/applications/` has five, with `portable-publisher`, and `docs/status.md:41` says five. Fix the text.
4. The file map in `docs/api.md` lacks `editor_hints.ts`, `emit/emitted.ts`, `emit/families/`, `validate/builtins.ts`, and `bench/m7.ts`. Add each, with one line that matches the header comment of the file. Check that every other file in `src/core/`, `src/core/emit/`, `src/core/validate/`, and `bench/` has a line, and that no line names a file that is gone.

## RW6: split TypeTable and completionsAt (RV4)

Problem. `TypeTable` (`src/core/types.ts:376`) has 54 methods. It holds interning, definitions, IR conversion, assignability, and printing. `completionsAt` (`src/core/editor_completion.ts:77`) is 209 lines with cyclomatic complexity 94.

Change.

1. Move `fromIr`, `fromIrFunction`, `toIr`, and `toIrFunction` (`types.ts:1147-1397`) to a new `src/core/type_ir.ts` as functions `typeFromIr(table, type)`, `functionTypeFromIr(table, type)`, `typeToIr(table, ref)`, and `functionTypeToIr(table, ref)`. They use only public `TypeTable` methods. Update every caller (about 80 sites in `src`, `tests`, and `bench`).
2. Move `show` and `showAll` (`types.ts:1611` to the end of the class) to a new `src/core/type_show.ts` as `showType(table, ref)` and `showTypes(table, ...refs)`. The private fields `shown` and `qualified` become local state of one `showTypes` call, so `TypeTable` loses them. The output must stay byte-equal. Update every caller (about 70 sites).
3. Split `completionsAt` into one function for each position kind that its branches handle, in the same file. Keep the order of the checks and the result of each branch. Do not change other functions.
4. Update the file map in `docs/api.md`: the `types.ts` line (about line 25) no longer says IR conversion, and `type_ir.ts` and `type_show.ts` get lines.
5. Measure before and after with `deno task measure:functions`, and report the new line count of `types.ts`, the method count of `TypeTable`, and the longest function in `editor_completion.ts`.
6. Fable suggested one-line delegate methods on `TypeTable` to avoid the caller changes. The main session rejected that: the delegates keep the mixed surface that RV4 names, and the caller changes are mechanical and type-checked.
7. If a moved function needs a private member of `TypeTable`, stop and report it. Do not make the member public.

## RW7: the slow suite (RV13)

1. The main session measures `deno task test:slow` with a fresh `DENO_DIR` and with a warm one, and records both times in the review document. A cold download of the two Effect packages took 1.35 s on 2026-10-25, but the cold type-check cache was not measured. The fresh `DENO_DIR` stays unless the warm run is much faster.
2. Declined: the split of `tests/emit_slow_test.ts`. Fable found no shared expensive setup, and `scripts/test_slow.ts` runs files one after another, so a split saves no time. Its "runtime" section is 3,700 lines with no sub-headers, so a split by family needs a judgment for each of 88 tests, for navigation only. Record this in the review document.

Fable validated this plan on 2026-10-25. The main session applied its must-fix findings for RW1, RW2, RW3, and RW5.

## Out of scope

The checker and the validator duplicate their rules on purpose. The review lists them under "Accepted as they are".
