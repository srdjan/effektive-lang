# Fresh-eyes review, 2026-11-15

This ledger records the findings of a fresh-eyes cleanup review of the whole repository, and the plan that applies them. It uses the prefixes FY (findings), FYD (decisions), and FYU (units). Each finding is a candidate change that keeps behavior, unless it is in the behavior-changing section.

Status: the plan is written and waits for approval. No code change has started.

## Decisions

On 2026-11-15 the user accepted the recommended option of each decision.

| ID | Decision | Result |
| --- | --- | --- |
| FYD1 | Scope of the cleanup | FY1-FY120 and the test gaps FY121-FY129, without FY26, FY37, FY66, FY67 (only moves), FY84, FY91, FY117 (low value), and FY103, FY106 (caches without a measurement). |
| FYD2 | FY130, the probable inference defect | A separate debug unit. A failing test comes first. |
| FYD3 | FY131-FY135, the behavior-changing items | Out of this pass. They stay in this ledger. |
| FYD4 | The unread ranges | No second examination. The plan uses the current findings. |

## Baseline

Opus measured these values at `c5c6840` on 2026-11-15, at a load average of 32:

| Measure | Value |
| --- | --- |
| `deno task check` | exit 0 in 53 seconds: 3259 fast tests passed and 6 ignored, 324 slow tests passed |
| Fast gate with a warm cache | exit 0 in 6 seconds |
| Source lines under `src/` | 53099 |

## Rules for all units

The change preserves behavior. The diagnostics, the IR, the emitted TypeScript, the CLI output, and the LSP responses stay the same. A unit that finds that an item changes behavior skips the item and records it in its handback.

A test-gap item comes first in its unit. The new test must pass on the unchanged code. If the new test fails, the executor stops work on that item, keeps the test out of the commit, and reports the failure. That failure is a probable defect, not a cleanup item.

Each item, or each group of items that change the same lines, gets one commit. The commit subject is short and imperative. The body gives the reason and names the FY IDs. The last line is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before each commit, the executor runs the fast gate, and the fast gate must exit 0.

The fast gate is `deno fmt --check && deno lint && deno check 'src/**/*.ts' 'playground/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'bench/**/*.ts' && deno task test`.

An executor may change a declaration that has a row in `fixtures/mutation/survivors.json`. The handback must name each such declaration. Opus then runs `deno task mutate` on that module and checks each stale row again.

A test changes only when it covers deleted dead code, or when it reads an internal shape that an item changes. The handback names each changed test.

Each Sonnet unit works in its own detached worktree under `~/.claude/scratch/`, made from local `main` at the plan commit. The worktree has a copy of `editors/vscode/node_modules`, not a symlink. The executor commits only in its worktree. It does not run `git checkout`, `git restore`, or `git stash`, and it does not push.

## Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| FYU1 (checker and type lowering) | Sonnet | FY121, FY15, FY19-FY25, FY27-FY29, FY81-FY83, FY93, FY99, FY104 | `src/core/check_expr.ts`, `check_declarations.ts`, `check_project.ts`, `check_patterns.ts`, `check_builtins/effect.ts`, `type_lower.ts` (lines 329 and 635-652), `signatures.ts`, the `modes` reader in `db.ts`, and the tests that read `modes` | Fast gate exits 0 at each commit. | 100 |
| FYU2 (validator) | Sonnet | FY122, FY129, FY16, FY30-FY36, FY38-FY41, FY85-FY88, FY105, FY107-FY109 | `src/core/validate/`, `src/core/validate_project.ts`, validator tests | Fast gate exits 0 at each commit. | 100 |
| FYU3 (emission and lowering) | Sonnet | FY123, FY9, FY10, FY50-FY57, FY68, FY92, FY94, FY95 | `src/core/emit/`, `lower.ts`, `type_ir.ts`, `recursion_guard.ts`, emitter tests | Fast gate exits 0 at each commit. The `tests/emit*_slow_test.ts` and `tests/strict_target_slow_test.ts` files pass at the last commit. | 90 |
| FYU4 (front end) | Sonnet | FY7, FY8, FY42-FY49, FY89, FY90, FY110 (inside `syntax_queries.ts` only), FY111 | `src/core/parse.ts`, `resolve.ts`, `syntax.ts`, `syntax_queries.ts`, `type_show.ts`, `patterns.ts`, `type_lower.ts` (lines 486-545 only) | Fast gate exits 0 at each commit. | 80 |
| FYU5 (core services and editor queries) | Sonnet | FY124, FY125, FY11, FY13, FY14, FY58, FY59, FY61-FY65, FY96, FY97, FY100, FY112 | `src/core/editor*.ts`, `project.ts`, `service_bounds.ts`, `diagnostic_delta.ts`, `db.ts` (the `Revision` constructor), `source.ts`, `diagnostics.ts`, their tests | Fast gate exits 0 at each commit. | 90 |
| FYU6 (hosts and playground) | Sonnet | FY126-FY128, FY1-FY6, FY69-FY76, FY101, FY102, FY113-FY116 | `src/cli/`, `src/host/`, `src/lsp/`, `playground/`, their tests, but not `tests/cli_helpers.ts` | Fast gate exits 0 at each commit. The CLI, LSP, and watch slow tests pass at the last commit. | 100 |
| FYU7 (tooling and test support) | Sonnet | FY17, FY18, FY77-FY80, FY118-FY120 | `scripts/`, `bench/`, `tests/cli_helpers.ts`, `tests/helpers.ts`, `tests/emit_slow_helpers.ts`, `tests/surface_cases.ts` | Fast gate exits 0 at each commit. The slow tests of the changed scripts and bench modules pass at the last commit. | 60 |
| FYU8 (FY130 diagnosis) | Opus | FY130 | a new test, then `src/core/infer_inputs.ts` if the test confirms the defect | The new test fails for the reason of the defect before the fix, and passes after it. `deno task check` exits 0. | direct |
| FYU9 (inference cleanup) | Sonnet | FY12, FY60, FY98 | `src/core/infer_inputs.ts` | Fast gate exits 0 at each commit. Starts after FYU8 lands. | 50 |
| FYU10 (integration) | Opus | all | all | Each unit lands with `git cherry-pick` after a line-by-line review. `deno task check` exits 0 on `main` after each unit. `deno task behavior:compare c5c6840 HEAD` exits 0, apart from a change that FYU8 explains. `deno task mutate` exits 0 on each module with a touched register declaration. | direct |

Two units share a file in disjoint line ranges. FYU1 and FYU4 share `type_lower.ts`. FYU1 and FYU5 share `db.ts`. Opus resolves a cherry-pick conflict in a shared file.

FYU1-FYU7 run at the same time. If FYU8 confirms a defect and the fix changes the language behavior, the fix needs a `CHANGELOG.md` entry and a check of the website specification. If the fix needs a new language rule, Opus stops and asks the user first.

After FYU10, Opus does Step 4 of the fresh-eyes method: it lists abstraction candidates that occur 3 or more times. It does not implement them without approval.

When the plan is complete, the completing commit moves this file to `docs/archive/plans/` and updates the registry path.

## Method and evidence limits

Seven read-only Opus examiners each examined one slice: the checker, the validator, emission and lowering, the front end and the type model, the remaining core modules, the hosts and the playground, and the tooling with test support. Each examiner proved "unused" claims with `rg -w` across `src`, `tests`, `scripts`, `bench`, `playground`, and `editors`. A mechanical scan listed every export in `src/` that no other non-test file uses.

The Evidence column has two values. "Checked" means that the orchestrator read the code and confirmed the claim. "Reported" means that an examiner gave the evidence, and the orchestrator did not read the code again. Each examiner had a budget of 60 tool calls. Large files were read only in part, so this ledger does not cover every line. The unread ranges are listed at the end.

The line counts are estimates from reading. Nobody measured them.

## 1A Dead code

| ID | Location | Finding | Proposed change | Evidence |
| --- | --- | --- | --- | --- |
| FY1 | `src/host/outputs.ts:137` | The `write` flag of `writeGenerated` is always `true` in production. The only caller is `src/host/save_round.ts:91`. Only the "dry runs" test passes `false`. | Remove the flag and the `if (write)` level. Delete the dry-run half of the test at `tests/outputs_generation_test.ts:250-253`. | Checked |
| FY2 | `playground/src/compile.ts:45,129` | No caller sets `PlaygroundPorts.outputs`. | Delete the field. Use `new TypeScriptOutputs()` directly. | Reported |
| FY3 | `playground/src/compile.ts:100-105` | `sourceModulesOf` only copies `revision.moduleInfos()` into a map. Its comment names `sourceModuleOf`, which does not exist. | Iterate `moduleInfos()` at the use site. | Reported |
| FY4 | `src/lsp/features.ts:288` | The `configError` test in `freshProject` cannot be true. All 3 callers first call `cursorOf(..., true)`, which returns `undefined` on a config error. | Delete the line. | Checked |
| FY5 | `src/lsp/server.ts:401` | The `initialized` or `$/` test repeats the work of the handler lookup at line 403. | Delete the line. | Reported |
| FY6 | `src/cli/format.ts:164` | The one caller of `loggedDiagnostics` passes `source` as `"effektive"`. No code produces the `"validate"` member at `src/host/log_schema.ts:36`. | Remove the parameter. Remove the unused union member. | Reported |
| FY7 | `src/core/syntax_queries.ts:243` | `UnaryOperator` is exported, and only its own file uses it. | Remove `export`. | Checked |
| FY8 | `src/core/type_show.ts:50` | The condition `!CLOSED_UNIT_IDS.has(id)` cannot be false, because a closed id never enters `qualified`. | Delete the condition and its import. | Reported |
| FY9 | `src/core/emit/families/context.ts:17,20` | The `ExprCore` members `callback` and `genCall` have no users in the families. | Remove both members. Make the two methods private in `expr.ts`. | Reported |
| FY10 | `src/core/emit/expr.ts:1868-1884,1941-1952` | The `leaf()` rows for 10 pure builtins are probably unreachable, because only an effect callee becomes a leaf. This is an inference from the types. | Throw for a pure builtin first. Keep rows for the 5 effect builtins. A test run must confirm the inference. | Reported |
| FY11 | `src/core/editor_signature.ts:164-168` | The second lookup `revision.checkedModule(module.module)` returns the module that line 161 already has, so the `undefined` branch cannot run. | Read `module.functions` and `module.constants` directly. | Checked |
| FY12 | `src/core/infer_inputs.ts:72-91` | `inferArrowInputs` passes its five arguments to `inferInputs` without change. | Delete the wrapper. Export the inner function under the outer name. | Checked |
| FY13 | `src/core/project.ts:52,348` | `ModuleInfo.mode` always equals `parsed.tree.mode`. It has one reader. | Delete the field. Read `info.tree.mode`. | Reported |
| FY14 | `src/core/editor_signature.ts:100` | `if (target.kind !== "value") break;` cannot run after the tests at lines 67-71. | Delete the line, unless the type check needs it. | Reported |
| FY15 | `src/core/check_expr.ts:~2670` | `isDefect && errorNode !== undefined`: the second test is probably redundant, because `isDefect` already contains it. | Delete the second test. The type check must accept the change. | Reported |
| FY16 | `src/core/validate/expr.ts:1989` | An orphan comment names "argument readers" that do not follow it. | Delete the comment. | Reported |
| FY17 | `scripts/lib.ts:15,21`, `scripts/lex_snapshot.ts:97`, `scripts/behavior_compare.ts`, `scripts/behavior_corpus.ts`, `bench/m5_variants.ts`, `bench/generate.ts:27` | 10 exported names have no user outside their file. | Remove `export`. | Reported |
| FY18 | `tests/surface_cases.ts:123,153` | `fixedCliCases` and `errorCliCases` are exported, and only `cliCases` in the same file uses them. | Remove `export`. | Reported |

## 1B Tangled and duplicated logic

| ID | Location | Finding | Proposed change | Evidence |
| --- | --- | --- | --- | --- |
| FY19 | `src/core/check_expr.ts:2311-2318` | `implicitArrow` repeats the steps of `outcomeParameter` (`:2338-2348`). | Call `outcomeParameter` for the first parameter too. | Checked |
| FY20 | `src/core/check_expr.ts:2596-2620,2889-2911` | The branch body and the join tail of `ifExpr` and `match` are near-identical. | Extract one branch helper and one join helper. | Reported |
| FY21 | `src/core/check_declarations.ts:899-917` | `bindingFn` only renames the fields of `bindingFunction`. `checkBindingFits` calls `functionOfBinding` again. | Keep the `bindingFunction` result and pass it on. | Reported |
| FY22 | `src/core/check_declarations.ts:969-979` | Three nested `if` tests can be one condition. | Join the conditions. | Reported |
| FY23 | `src/core/check_expr.ts:~2871-2877` | A nested ternary over 5 pattern kinds reads `binding`. | Use one `"binding" in` test. | Reported |
| FY24 | `src/core/check_expr.ts:729` | The `stage` flag of `invoke` matters only for an undefined target. | Handle the undefined target in each of the 2 callers. | Reported |
| FY25 | `src/core/check_expr.ts:2680-2697` | `tryExpr` nests one level more than necessary. | Reorder the `else if` chain. | Reported |
| FY26 | `src/core/check_expr.ts:1580-1731` | `listExpr` is 150 lines, and its tuple branch is self-contained. | Extract the tuple branch. Net line change is 0. | Reported |
| FY27 | `src/core/check_project.ts:91,106,498-505` | `ModuleBodies.modes` and `CheckedModule.modes` copy `solved[id].mode`. | Read `solved`. This changes an internal shape and 5 test files. | Reported |
| FY28 | `src/core/check_expr.ts:979,1035,1044,1124` | 4 places repeat "check the arguments without a hint, report, finish with the error type". | Extract one helper. Keep the order of diagnostics. | Reported |
| FY29 | `src/core/check_expr.ts:914,1194`, `src/core/type_lower.ts:329` | The text "takes N argument(s), but M is/are given" is built 3 times. | Extract one text helper. | Reported |
| FY30 | `src/core/validate/families/scope.ts:328-348` | Both branches of `withResource` make the same two calls. Only the walker differs. | Select the walker, then make the two calls once. | Checked |
| FY31 | `src/core/validate/import_checks.ts:91,112,131,152,169,207` | 6 shape functions repeat one purity test. The `execution !== "pure"` part is redundant, because `isQuiet` contains it. | Extract `requirePure`. Do not move it into `checkBuiltinShape`, because that adds a diagnostic. | Reported |
| FY32 | `src/core/validate/expr.ts:~1463,~1492` | The concurrency literal check for `traverse` and for `all` is one block with a different index. | Extract one helper. | Reported |
| FY33 | `src/core/validate/expr.ts:1439`, `src/core/validate/import_checks.ts:271,290` | The callback arity and index rule is coded twice with nested ternaries. | Put one arity table in `builtins.ts`. | Reported |
| FY34 | `src/core/validate/expr.ts:1032-1048,1075-1091` | The element-fit loops of `arrayLike` and `tupleLike` differ only in the target type. | Extract `checkElements` with a target function. | Checked |
| FY35 | `src/core/validate/declaration_checks.ts:153-158,170-175` | Tagged-record fields and error fields run the same three checks. | Extract `checkDeclarationFields`. | Reported |
| FY36 | `src/core/validate/expr.ts:564-611` | The failure and requirement contract blocks of `checkFunction` are parallel. | Extract one helper with the set key and the verb. | Reported |
| FY37 | `src/core/validate/expr.ts:~495-545` | The borrow parameter checks nest 4 levels and do not read the local scope. | Extract `checkBorrowParameters`. About 50 lines move. | Reported |
| FY38 | `src/core/validate/expr.ts:671-690` | The `sameSet` report blocks of `finish` differ only in the key. | Loop over the two keys. | Reported |
| FY39 | `src/core/validate/families/layer.ts:152-153` | An inner `combine` call is redundant, because `combine` flattens. | Make one `combine` call. | Reported |
| FY40 | `src/core/validate/families/stream.ts:126,226`, `layer.ts:112`, `effect.ts:455` | `{ ...unionEffects(...) }` copies a fresh object. | Use the result directly. Keep `stream.ts:256`, which adds a field. | Reported |
| FY41 | `src/core/validate/world_table.ts:59-64`, `declaration_checks.ts:213-218` | The `"function"` and `"constant"` cases have the same body. | Merge the cases. | Reported |
| FY42 | `src/core/resolve.ts:1106-1114,1181-1186` | Two blocks look up a service binding in the same way. The first nests 4 levels. | Extract `serviceBinding`. | Reported |
| FY43 | `src/core/type_show.ts:133-138,156-161` | Two blocks build the `fails ... with ...` suffix. | Extract `effectSuffix`. | Reported |
| FY44 | `src/core/type_show.ts:95-103` | A 4-level nested ternary maps `SchemaPresence` to a word. | Use a `Record<SchemaPresence, string>`. | Reported |
| FY45 | `src/core/resolve.ts:616-618,632-634` | `lookupValue` has the same `outerUses` loop twice. | Mark once after the lookup. | Reported |
| FY46 | `src/core/resolve.ts:949,1004,1268` | 3 loops read "a name gives a label, else a type". | Extract `labelsAndTypes`. | Reported |
| FY47 | `src/core/resolve.ts:1152,1262,1347,1360,1240` | "Save scope, new scope, restore scope" occurs 5 times. | Add `inScope(body)`. | Reported |
| FY48 | `src/core/syntax.ts:296-313` | `printTree` copies the stack loop of `walk`. | Write `printTree` on `walk`. | Reported |
| FY49 | `src/core/parse.ts:761-787` | `parseDeclaration` has a 6-arm `if` chain on `word`. | Use `switch`. | Reported |
| FY50 | `src/core/emit/decls.ts:350-377` | `containsNamed` repeats the `containsSelf` switch in `src/core/recursion_guard.ts:36-62`. | Export one free function and use it in both places. | Checked |
| FY51 | `src/core/emit/types.ts:258-273,389-404` | `typeDoc` and `encodedTypeDoc` print records and tuples in the same way. | Extract `recordTypeDoc` and `tupleTypeDoc`. | Reported |
| FY52 | `src/core/emit/families/schema.ts:84,111,117,270` | 4 cases print the same text with a different name. | One case group with a name table. | Reported |
| FY53 | `src/core/emit/expr.ts:716-721,726-731` | The bind-and-lift tail of `fit()` occurs twice. | Extract `bindLifted`. | Reported |
| FY54 | `src/core/emit/expr.ts:828,1032,1049,1092` | 4 blocks build a field helper call. At line 828 the order of evaluation differs. | Extract `helperCall`. Keep the order, or confirm that the golden fixtures do not change. | Reported |
| FY55 | `src/core/emit/expr.ts:444` | `options.splitDown !== undefined` is always true at this point. | Make `ChainOptions` a discriminated union, or delete the test. | Reported |
| FY56 | `src/core/type_ir.ts:236-252` | `DefinitionSource` repeats 4 fields of `TypeDecl`. | Use `Pick<TypeDecl, ...>`. | Reported |
| FY57 | `src/core/emit/expr.ts:1134,1172,1176` | `binary()` computes `isIntType(...)` 3 times. | Compute it once. | Reported |
| FY58 | `src/core/editor_actions.ts:110-117,183-192` | The missing `fails` and `with` entries are computed twice. | Extract `missingEntries`. | Reported |
| FY59 | `src/core/editor_actions.ts:125-136,239-246`, `src/core/editor_hints.ts:29` | 3 places find the arrow header of a declaration. | Extract `arrowHeaderOf`. | Reported |
| FY60 | `src/core/infer_inputs.ts:350,363,405,410` and `311-338,377-393` | The expected-argument expression occurs 4 times. The constructor branches of `call` and `pipe` are near-identical. | Extract `expectedArgument` and `constructorInput`. | Reported |
| FY61 | `src/core/service_bounds.ts:92-101,124-133` | Requirement collection repeats for functions and constants. | Extract one helper. | Reported |
| FY62 | `src/core/editor.ts:147`, `editor_signature.ts:165`, `editor_completion.ts:144,198` | 4 copies collect the body tables of a checked module. | Extract `bodyTablesOf`. | Reported |
| FY63 | `src/core/editor_tokens.ts:97-104`, `src/core/editor_completion.ts:305-323` | 2 places find a declaration entry only to read `isArrow`. A 5-level ternary follows. | Extract `isArrowDeclaration`. Use a lookup table. | Reported |
| FY64 | `src/core/editor_tokens.ts:203-224` | The lexical fallback finds each declaration twice and uses a 6-level ternary. | Build one map in one pass. | Reported |
| FY65 | `src/core/diagnostic_delta.ts:36-48` | The `move` flag is not necessary, because an empty edit list gives the same offset. | Delete the flag. Pass `[]`. | Reported |
| FY66 | `src/core/project_config.ts:165-302` | `parseConfig` is 137 lines and nests 4 levels. | Split it into 2 functions. Net line change is 0. | Reported |
| FY67 | `src/core/editor_index.ts:106-180` | `symbolIndex` nests 5 levels. | Move the `using` expansion into a helper. | Reported |
| FY68 | `src/core/recursion_guard.ts:65-86` | `guardedRecord` tests the union kind 3 times and uses a cast. | Use one narrowed branch. | Reported |
| FY69 | `src/lsp/projects.ts:304,436,444` and `350,431` | The "attach a document" steps occur 3 times. The "detach" steps occur twice. | Add `#attach` and `#detach`. | Reported |
| FY70 | `src/host/outputs.ts:182-194,275-288` | 2 blocks resolve contained targets and report the first failure. | Extract one helper that returns a Result. | Reported |
| FY71 | `src/lsp/features.ts:104-127` | The `current` flag of `cursorOf` splits behavior. 2 callers use `false` and 7 use `true`. | Split it into 2 functions. | Checked |
| FY72 | `src/cli/main.ts:216-220,232-236` | The same usage-failure block occurs twice. | One local helper. | Reported |
| FY73 | `src/cli/args.ts:100-114` | The `build` and `watch` cases differ only in `kind`. | Merge the cases. | Reported |
| FY74 | `src/lsp/features.ts:519-534` | The quickfix and rewrite blocks map actions in the same way. | One local mapper. | Reported |
| FY75 | `src/host/deno_io.ts:222-227,248-253` | The timeout race occurs twice. | One helper. | Reported |
| FY76 | `src/lsp/server.ts:309,313` | Both branches of `afterBatch` call `#cancelPending()`. | Call it once before the `if`. | Reported |
| FY77 | `scripts/logs_replay.ts:133-181`, `tests/cli_helpers.ts:55-119` | `memoryFs` is a near copy of the file system in `memoryIo`. About 50 lines. | Export `memoryFs(files, unwritable)` from `tests/cli_helpers.ts`. Use it in both places. | Checked |
| FY78 | `tests/helpers.ts:375-397`, `tests/emit_slow_helpers.ts:22-40` | `diskHost` and `fileHost` have the same read block. | One shared reader. Do not use `denoFs`, because its decoder is strict. | Reported |
| FY79 | `bench/m1.ts:89`, `m3.ts:77`, `m4.ts:134`, `m7.ts:227,262,300` | 6 copies create a `Workspace`, run a body, finish, and dispose. | Add `withWorkspace(body)` to `bench/lsp_script.ts`. | Checked |
| FY80 | `scripts/golden_update.ts:28-30` | `resourceCase` repeats the read of `irFile`. | Use `irFile("resource-case.eff")`. | Reported |

## 1C Parameter bloat

| ID | Location | Finding | Proposed change | Evidence |
| --- | --- | --- | --- | --- |
| FY81 | `src/core/check_expr.ts:2350` | The `written` argument of `callbackBody` follows from `contract`. | Compute `written` inside. | Reported |
| FY82 | `src/core/check_patterns.ts:342,380` | `silent` depends only on `domain`, which is also passed. 5 guards repeat `!silent`. | Compute `silent` inside. Move the test into `foreign`. | Reported |
| FY83 | `src/core/check_expr.ts:1753` | `recordTarget` receives the 3 fields of one scan result. | Pass the scan object. | Reported |
| FY84 | `src/core/check_expr.ts:1375` | 16 of 20 calls of `callback` pass `allowEffects` as `true`. 2 calls were not resolved. | Invert the default. Low value. | Reported |
| FY85 | `src/core/validate/families/stream.ts:192-201` | `transduceStream` only forwards to `sinkTransformStream`, with one literal name. | Inline the body. | Reported |
| FY86 | `src/core/validate/expr.ts:905-917` | `checkFieldValues` has 7 parameters. 3 come from the same `e`. | Pass `e`. | Reported |
| FY87 | `src/core/validate/expr.ts:1343-1351` | `checkArguments` has 7 parameters. 2 always come from one `fn`. | Pass `fn`. | Reported |
| FY88 | `src/core/validate/type_checks.ts:206` | The `tagReserved` flag is true only from the 2 calls that FY35 merges. | Move the `_tag` check into the FY35 helper. | Reported |
| FY89 | `src/core/syntax.ts:151-206` | `schemaWord` takes 4 positional booleans. 3 are mutually exclusive and encode `SchemaPresence`. `type_lower.ts:490-528` converts them back. | Use `{ presence, constructorDefault }`. | Checked |
| FY90 | `src/core/parse.ts:796,878,934,1010,1414,1471,1547,1604` | 8 `report` calls pass the same token span pair. | Add `reportAtToken`. | Reported |
| FY91 | `src/core/predicates.ts:132-146` | The only production caller passes `rightOffset` as `"0"`, and a bigint makes a round trip through text. | Take one `offset: bigint`. 4 test sites change. Low value. | Reported |
| FY92 | `src/core/emit/module_state.ts:575` | All 3 calls of `addImport` derive 3 of its 4 arguments from one id. | Change it to `addImport(id, local)`. | Checked |
| FY93 | `src/core/type_lower.ts:635-652` | `functionOf` passes 6 parameters to `loweredFunction` and adds only the table. | Call `loweredFunction` directly. | Reported |
| FY94 | `src/core/emit/expr.ts:1041-1056` | `unknownInput` equals `direction === "encoded"` at every call. | Compute it inside. | Reported |
| FY95 | `src/core/lower.ts:778` | `args.map((_, i) => arg(i))` only copies `args`. | Pass `args`. | Reported |
| FY96 | `src/core/editor_rename.ts:79-83` | Both calls of `movedSpan` pass `bindingUse` as `true`. | Delete the parameter. | Checked |
| FY97 | `src/core/editor_signature.ts:51,123` | The `count` parameter builds a fallback that the only caller also builds. | Delete `count`. Return `[]`. | Reported |
| FY98 | `src/core/infer_inputs.ts:74,95,122,150` | The inline parameter shape occurs 4 times. `finish` receives the list that the constructor already has. | One `InputParameter` type. Store the list once. | Reported |
| FY99 | `src/core/signatures.ts:302-311` | `loweredFunction` has 8 positional parameters. 3 always travel as one contract. | Take a contract record. Combine with FY93. | Reported |
| FY100 | `src/core/db.ts:157-170` | The `Revision` constructor has 8 positional parameters and one call site. | Pass one record. | Reported |
| FY101 | `src/cli/build.ts:49-58`, `src/cli/tsc.ts:60-68`, `src/cli/session.ts:46-47` | `buildRevision` has 8 parameters and `runTsc` has 7. Each has one caller. 2 constructor defaults of `Session` are never used. | One context object. Remove the defaults. | Reported |
| FY102 | `src/lsp/projects.ts:703-709` | `#publishList` has 5 parameters. `force` occurs only with `open`. | Put `force` into the `open` object. | Reported |

## 1D Duplicates of existing helpers and unmeasured optimization

| ID | Location | Finding | Proposed change | Evidence |
| --- | --- | --- | --- | --- |
| FY103 | `src/core/check_project.ts:257-274` | `methodTypes` is a second cache in front of an existing map. No measurement is recorded. | Delete it only after a bench run. This needs to be measured. | Reported |
| FY104 | `src/core/check_builtins/effect.ts:775-780,800-806` | 2 rows write the optional-last arity by hand. `optionalLast` in `rows.ts:120` builds it. | Use `optionalLast`. | Reported |
| FY105 | `src/core/validate/refinements.ts:91-95` | `addLocal` writes its own quiet test. | Use `isQuiet(invocationOf(init))`. | Reported |
| FY106 | `src/core/validate/sets.ts:90-109` | The loops of `combine` repeat `unionEffects`. `combine` runs for every node. | Use `unionEffects`. The validator time needs to be measured before and after. | Reported |
| FY107 | `src/core/validate/import_checks.ts:82-145,342`, `builtins.ts:110` | Local primitive helpers repeat `INT`, `NUMBER`, `STRING`, `BOOLEAN` from `typing.ts:53-56`. | Import the constants. | Reported |
| FY108 | `src/core/validate_project.ts:173-183` | A hand-built span repeats `fallbackSpan`. A literal code repeats `AREA.identity`. | Use both helpers. | Reported |
| FY109 | `src/core/validate/typing.ts:189-206` | `flatten` pushes items in nested loops. | Use `flatMap`. | Reported |
| FY110 | `src/core/syntax_queries.ts:56,99,184,207,235` | 3 sites read a token kind by hand, and 2 slice node text by hand. `tokenKindOf` and `nodeText` exist. 4 more sites are outside the front end. | Call the helpers. | Reported |
| FY111 | `src/core/patterns.ts:88-97,193-199` | `unique` builds by hand what `[...new Set(values)]` returns. | Use the Set form. | Checked |
| FY112 | `src/core/source.ts:108`, `src/core/diagnostics.ts:409` | 2 comparators write `a < b ? -1 : 1`. | Use `compareText`. | Reported |
| FY113 | `src/lsp/projects.ts:53,393`, `src/lsp/protocol.ts:82,344` | `event.type === 3` uses a bare number. `FileChangeTypeValue` and `LogType` repeat values of `FileChangeType` and `LogMessageParams`. | Use the protocol names. | Checked (line 393) |
| FY114 | `src/lsp/features.ts:73,394` | `-32801` and `-32602` are bare numbers. `ErrorCodes` has `invalidParams`. | Add `contentModified`. Use both names. | Reported |
| FY115 | `src/lsp/generated_texts.ts:19`, `src/lsp/projects.ts:156` | `LocatedModule` and `DocumentRef` have the same shape. | Keep one type. | Reported |
| FY116 | `playground/src/app.ts:60,63`, `playground/src/events.ts:26-27` | The breakpoints 720 and 1024 occur twice. | Build the media queries from the constants. | Reported |
| FY117 | `src/host/log.ts:43`, `src/lsp/wire_log.ts:110`, `playground/src/events.ts:37` | One rounding expression occurs 3 times. | One shared helper. Low value. | Reported |
| FY118 | `scripts/validate_fixtures.ts:13` | `isObj` copies `isRecord` from `tests/helpers.ts:87`, which the file already imports. | Use `isRecord`. | Reported |
| FY119 | `tests/helpers.ts:392`, `tests/emit_slow_helpers.ts:35` | An inline expression repeats `errorMessage`. | Use `errorMessage`. | Reported |
| FY120 | `scripts/test_slow.ts:16-28` | The warm-up step runs a process by hand. `runProcess` in `scripts/lib.ts` does this. | Use `runProcess`. | Reported |

## Test gaps

A test for each gap comes before any refactor of the code that it covers.

| ID | Location | Behavior without a test | Evidence |
| --- | --- | --- | --- |
| FY121 | `src/core/check_expr.ts:2689` | A protected block that already has an error suppresses `failure-contract/002` for a handler of an error that the block cannot raise. Example input: `try { unknownName() } catch { Boom(x) => ... }`. | Reported |
| FY122 | `src/core/validate_project.ts:179-187` | The key of the `lowered` map differs from `ir.module`. The expected text is "expected the lowered module X, recorded Y". | Reported |
| FY123 | `src/core/emit/expr.ts:1683-1701` | The guarded tag test `"field" in $tN && ...` for a union member without the discriminator field. Neither layout is covered. | Reported |
| FY124 | `src/core/project_config.ts:114,154` | An exact host label such as `"host:clock"` in an `allow` list. The rejection of `"host:"` and `"host:cl*"`. | Reported |
| FY125 | `src/core/editor_tokens.ts:214-224` | The lexical token fallback for an error declaration, a service declaration, and a service method name. | Reported |
| FY126 | `src/cli/main.ts:289-312` | `check --fix` when the fixed file is unwritable or escapes the root. | Reported |
| FY127 | `src/cli/tsc.ts:99-101` | `deno check` exits nonzero with empty stderr. | Reported |
| FY128 | `src/lsp/projects.ts:586-588` | The log line "is not written: it cannot be lowered". The examiner did not build an input for this case. | Reported |
| FY129 | `src/core/validate/` | 6 probable gaps in message-text assertions: bufferStream capacity, takeSink count, mapEffect concurrency, IR format mismatch, non-integer span offsets, and the aggregate proof step limit. A test can cover each check by code or path, so these are not confirmed. | Reported |

## Behavior-changing (flag only)

These items change observable behavior. They are outside a cleanup pass. Each one needs a separate decision.

| ID | Location | Finding | Evidence |
| --- | --- | --- | --- |
| FY130 | `src/core/infer_inputs.ts:343-356,398-402` | When the callee is unknown, `call` defers to the resolver and `pipe` does not. A callback parameter that is used only as a pipe-stage callee probably gets no inferred type. This is a probable defect. A test with `x \|> f`, where `f` is a parameter without a written type, can confirm it. | Reported |
| FY131 | `src/host/deno_io.ts:271-276` | `denoIo` writes CLI output with one `writeSync` call. A short write on a pipe can cut the output. `writeAll` in `src/lsp/main.ts:19-27` handles this. | Reported |
| FY132 | `src/core/project_config.ts:174,182,309` | A parse or shape error names `effektive.json`, but a read error names the joined path. The CLI and LSP text changes if the forms become the same. | Reported |
| FY133 | `src/core/emit/expr.ts:1111` | `isOptionalField` returns `false` at depth 64 without a message. The guard is probably unreachable. | Reported |
| FY134 | `src/core/validate/typing.ts:153-159` | The `"named"` case of `dataOnly` repeats `namedBody` without the alias lookup. A call to `namedBody` changes the result for an alias cycle. | Reported |
| FY135 | `scripts/validate_fixtures.ts:79-101` | `canonical` duplicates `canonicalJsonIndented`. The output differs only for an `undefined` value, which no current input has. | Reported |

## Items rejected by the examiners

The examiners rejected these candidates. They are recorded so that a later review does not raise them again.

- `kindName` and `printTree` in `src/core/syntax.ts` are test oracles for parser losslessness and tree dumps.
- `FileChangeType`, `GENERATED_SCHEME`, and `LogMessageParams` in `src/lsp/protocol.ts` are protocol names. `tests/vscode_client_test.ts` ties `GENERATED_SCHEME` to the copy in `editors/vscode/extension.js`.
- The copies of `isRecord` and `sortedUnique` in `src/core/validate/` follow the rule that the validator stays independent.
- The `builtinInfo` cache in `src/core/validate/expr.ts` was accepted in commit 3e7a84a.
- The `irKeys` cache is part of the fix in `docs/solutions/logic-errors/union-member-order-must-not-depend-on-intern-order.md`.
- `scripts/coverage.ts` and `scripts/behavior_corpus.ts` keep local helpers, because a test copies them without `src/`, and a comment forbids imports from `src/`.
- No script, bench module, or fixture is orphaned.

## Unread ranges

The examiners did not read these ranges in full. A finding in them is not excluded.

- `src/core/check_expr.ts` lines 340-710, 1234-1370, 1471-1580, 1900-2098, 2374-2529, 2916-3040. `check_declarations.ts` lines 300-880. `check_refinements.ts` lines 140-653. `check_binary.ts` lines 72-328. Most of `check_builtins/`.
- `src/core/validate/families/schema.ts`, most of `validate/refinements.ts`, `validate/typing.ts`, `validate/predicates.ts`, and `validate/recursion_checks.ts`.
- `src/core/emit/` files `doc.ts`, `emit.ts`, `emitted.ts`, `sourcemap.ts`, `spans.ts`, `helper_declarations.ts`, `walk.ts`, `identity.ts`, `calls.ts`, `emitted_module.ts`, `failure.ts`, `families/effect.ts`, `families/stream.ts`, `families/layer.ts`. Most of `lower.ts`.
- About 1500 of the 1861 lines of `src/core/parse.ts`. Most of `lex.ts`, `resolve.ts`, `types.ts`, and `predicates.ts`.
- `src/core/diagnostics.ts` lines 61-329, which had only a census check.
- Parts of `src/lsp/server.ts`, `features.ts`, `protocol.ts`, `jsonrpc.ts`, `src/host/log_schema.ts`, and most of `playground/`.
- Most of `scripts/` and `bench/`, which had only reference counts and scans.
