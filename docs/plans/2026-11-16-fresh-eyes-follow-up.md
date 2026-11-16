# Fresh-eyes follow-up, 2026-11-16

This plan uses the prefix FWU (units). It applies three decisions that the user took on 2026-11-16 after the [second fresh-eyes review](../archive/plans/2026-11-16-fresh-eyes-review.md). The labels FZO and FZA refer to the open items and the abstraction suggestions of that review.

Status: approved by the decisions below. Execution has started.

## Decisions

| Decision | Result |
| --- | --- |
| 1 (open item FZO1) | Each of the 150 older survivors in [`older-survivors.txt`](../archive/plans/2026-11-16-fresh-eyes-review-evidence/older-survivors.txt) gets a test, or a register row that a probe supports. The work starts with `src/core/emit/fields.ts` and `src/core/recursion_guard.ts`. |
| 2 (abstraction suggestions) | One test-only unit set with FZA1, FZA2, FZA6, and FZA7, and one unit with FZA3 and FZA4. FZA5 and FZA8-FZA11 stay open. |
| 3 (file URL paths) | The 10 places that pass `.pathname` of a file URL to the file system use `fromFileUrl` instead, as [the learning](../solutions/logic-errors/file-url-pathname-is-not-a-file-path.md) describes. |

## Rules for all units

- Each Sonnet unit works in its own detached worktree under `~/.claude/scratch/ff/`, made from local `main`. It commits there. Opus reviews the diff line by line and lands it with `git cherry-pick`.
- A refactor unit keeps every output: each diagnostic and its order, the IR, the emitted text, the golden files, the surface records, and the lexer snapshot. A test may change only where its unit changes how the test reaches the same assertion.
- FZA1 gives some tests a stronger check, because `assertValidProject` also asserts that each module lowers. When the stronger check fails on a test, the unit keeps the old form at that site and reports it.
- A survivor gets a test when an input can observe the mutant. Otherwise it gets a row of class `equivalent` or `slow-only`, as `docs/testing.md` describes. An `equivalent` row needs a differential probe with a reach count, as [the probe note](../solutions/workflow-issues/mutation-equivalent-rows-need-a-differential-probe.md) describes. A reason names functions and types, not line numbers.
- A survivor that shows a defect gets no test that pins the defect. The unit records the input and the two outputs, and stops work on that survivor.
- A timeout counts as a kill only after an isolated rerun with `--only`.
- A survivor unit puts new tests in a new file `tests/<module>_mutation_test.ts`, or in an existing file of that name. So the survivor units do not change the test files of FWU1 and FWU2.
- No unit adds an ignore comment, a lint disable, an exclusion, or a layer header.

## Sites

FZA1 (call `assertValidProject` of `tests/helpers.ts`):

- Exact copies: `null_test.ts:28`, `portable_architecture_test.ts:21`, `pure_function_type_test.ts:51`, `run_stream_sink_hint_test.ts:53` and `:142`, `schema_constructor_metadata_test.ts:39`, `schema_constructor_recursive_test.ts:36`, `schema_constructor_test.ts:42`, `schema_default_encoding_test.ts:28`, `schema_encoded_default_test.ts:42`, `schema_null_default_test.ts:42`, `schema_recursive_adapters_test.ts:28`, `schema_slow_test.ts:25` and `:45`, `service_imports_test.ts:501` and `:1114`.
- The `project.value` form: `application_integration_slow_test.ts:30`, `application_publisher_integration_slow_test.ts:31`, `application_slow_test.ts:169`, `audit_emit_slow_test.ts:36`, `schema_recursive_adapters_slow_test.ts:58`.
- Local copies of the helper: `inferred_inputs_test.ts:50`, `record_union_test.ts:15`, `refinement_some_test.ts:31`.
- Sites without the module-ok assert, which get the stronger check: `emit_alias_resolution_slow_test.ts:30`, `emit_extreme_identifiers_slow_test.ts:109`, `emit_host_slow_test.ts:154`, `refinement_flow_test.ts:26` and `:60`, `refinement_literals_test.ts:26`.

FZA2 (call `checkModule(text, file)` of `tests/helpers.ts` in place of `checkProject(memoryHost({"effektive.json": "{}", [file]: text}), "", [file])` and `assert(x.ok)`): `check_test.ts:1064`, `config_guard_mutation_test.ts:60`, `data_only_rule_test.ts:93`, `defect_test.ts:141`, `diagnostic_cascade_test.ts:9`, `emit_alias_resolution_slow_test.ts:20`, `guarded_recursion_cases_test.ts:164`, `height_within_test.ts:15`, `inferred_entry_validation_test.ts:10`, `lower_stage_effects_test.ts:24` and `:138`, `pure_function_type_validation_test.ts:13`, `record_union_slow_test.ts:40`, `refinement_integer_facts_test.ts:8` and `:20`, `refinement_literals_test.ts:6`, `refinement_proofs_test.ts:15`, `refinement_some_test.ts:13`, `refinement_validation_test.ts:16`, `schema_forged_op_test.ts:20`, `schema_null_default_test.ts:332`, `schema_set_serialization_test.ts:22`, `schema_validator_forged_test.ts:16`, `target_names_slow_test.ts:284`, `target_names_test.ts:9`, `type_lowerer_named_test.ts:15`, `validate_builtin_test.ts:15`, `validate_depth_bound_test.ts:41`, `validate_family_mutation_test.ts:112`, `validate_mutation_test.ts:71`, `validate_predicate_declaration_test.ts:17`, `validate_test.ts:90`, `validate_type_paths_test.ts:133`.

FZA6 (a new `buildMain(dir, source)` in `tests/emit_slow_helpers.ts` that writes `effektive.json` and `main.eff` and calls `build(dir, ["main.eff"])`): `emit_concurrency_slow_test.ts` lines 12, 89, 189, 307, 404, 443, 488, 516, 546, 577, 608, 637; `emit_runtime_slow_test.ts` lines 76, 443, 480, 613, 654, 702, 1244; `emit_stream_slow_test.ts` lines 11, 113, 173, 261, 318; `division_property_slow_test.ts:103`; `sort_property_slow_test.ts:82`.

FZA7 (call `withTemporaryDirectory` of `tests/process_helpers.ts` in place of an inline temporary folder with a `try`/`finally` removal): `application_slow_test.ts:176`, `emit_effectful_operands_slow_test.ts:113`, `emit_lift_once_slow_test.ts:55`, `emit_lift_slot_slow_test.ts:18`, `installation_slow_test.ts:25`, `log_slow_test.ts:7`, `mutate_tool_slow_test.ts:121` and `:363`, `playground_build_slow_test.ts:30` and `:61`, `scripts_lib_export_slow_test.ts:8` and `:29`, `scripts_lib_slow_test.ts:40`.

Decision 3: `bench/m5_target.ts:93`, and `tests/behavior_compare_slow_test.ts:7`, `behavior_corpus_test.ts:30`, `cli_slow_test.ts:17`, `emit_effectful_operands_slow_test.ts:9`, `emit_lift_once_slow_test.ts:10`, `emit_lift_slot_slow_test.ts:12`, `emit_slow_test.ts:111`, `task_permissions_slow_test.ts:5`, `website_examples_slow_test.ts:13`.

FZA3 (a generic kind guard in `src/core/ir.ts`, from `isDeferredType` and `DEFERRED_KINDS` of `src/core/emit/type_query.ts`, that accepts both an IR `Type` and a checker `TypeNode`): the 8-kind lists at `src/core/types.ts:1460`, `:1524`, and `:1585`, `src/core/recursion_guard.ts:53` and `:108`, and `src/core/emit/fields.ts:66`, and the current callers `emit/decls.ts:649`, `emit/module_state.ts:507`, `emit/types.ts:397` and `:464`.

FZA4 (one helper in `src/core/ir.ts` that gives the children of a record, array, option, tuple, or union): `src/core/types.ts:1442`, `:1536`, and `:1576`, `src/core/emit/module_state.ts:512`, `src/core/emit/decls.ts:680`. Each site keeps its visit order, its short circuit, and its `never` check.

Line numbers refer to commit `0454d2c7`.

## Units

| Unit | Model | Items | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- | --- |
| FWU1 | Sonnet | FZA1, FZA2, and the FZA7 site of `application_slow_test.ts` | the test files of those sites, `tests/helpers.ts` | Fast gate exits 0 at each commit. Each changed slow test file passes. | 80 |
| FWU2 | Sonnet | FZA6, FZA7 apart from `application_slow_test.ts`, decision 3 | `tests/emit_slow_helpers.ts`, the test files of those sites, `bench/m5_target.ts` | Fast gate exits 0 at each commit. Each changed slow test file passes. | 70 |
| FWU3 | Sonnet | FZA3, FZA4 | `src/core/ir.ts`, `emit/type_query.ts`, `types.ts`, `recursion_guard.ts`, `emit/fields.ts`, `emit/module_state.ts`, `emit/decls.ts`, `emit/types.ts`, and the register rows of the changed declarations | Fast gate exits 0 at each commit. `tests/emit*_slow_test.ts`, `tests/strict_target_slow_test.ts`, and `tests/mutate_slow_test.ts` pass. The tool on the changed lines of `ir.ts`, `type_query.ts`, `types.ts`, `module_state.ts`, and `decls.ts` leaves no new survivor without a row. | 80 |
| FWU4 | Sonnet | The 30 survivors of `emit/fields.ts`, after FWU3 | `tests/emit_fields_mutation_test.ts`, the rows of `emit/fields.ts` | `deno task mutate --seed 1 --sample all src/core/emit/fields.ts` exits 0. | 80 |
| FWU5 | Sonnet | The 28 survivors of `recursion_guard.ts`, after FWU3 | `tests/recursion_guard_mutation_test.ts`, the rows of `recursion_guard.ts` | `deno task mutate --seed 1 --sample all src/core/recursion_guard.ts` exits 0. | 80 |
| FWU6 | Sonnet | The 31 survivors of `lower.ts`, `type_lower.ts`, `infer_inputs.ts`, `check_refinements.ts`, `predicates.ts`, `requirement_provenance.ts`, `check_expr.ts`, `check_builtins/stream.ts` | new or existing `tests/<module>_mutation_test.ts` files, the rows of those modules | The tool with `--only` on the lines of the listed survivors exits 0 for each module. | 90 |
| FWU7 | Sonnet | The 27 survivors of `emit/families/schema.ts`, `emit/expr.ts`, `emit/doc.ts`, `emit/types.ts`, `emit/families/effect.ts`, after FWU3 | as FWU6 | as FWU6 | 80 |
| FWU8 | Sonnet | The 17 survivors of `resolve.ts`, `syntax.ts`, `editor_tokens.ts`, `scripts/rules_unfired.ts`, `scripts/coverage.ts`, `scripts/package_vscode_smoke.ts` | as FWU6 | as FWU6 | 70 |
| FWU9 | Sonnet | The 17 survivors of `bench/`, after FWU2 | as FWU6 | as FWU6 | 70 |
| FWU10 | Opus | all | all | Opus lands each unit. `deno task check` exits 0 on `main`. `deno task behavior:compare 0454d2c7 HEAD` exits 0. The M2 check stage of `deno task bench --quick m2 m6` before and after FWU3 differs by less than the M6 noise floor, on a quiet machine. | direct |

At most three Sonnet units run at the same time. The first wave is FWU3, FWU1, and FWU6. FWU4, FWU5, and FWU7 start after FWU3 is on `main`, and FWU9 starts after FWU2 is on `main`. When a survivor's line moved, the unit finds it by its declaration, operator, and text.

## Results

| Unit | Commits | Result |
| --- | --- | --- |
| FWU1 | 3 | FZA1, FZA2, and the FZA7 site of `application_slow_test.ts` are done. The unit reports 27 FZA1 sites, the 3 local helper copies, and 34 FZA2 sites. Two sites of `inferred_entry_validation_test.ts` keep `checkProject`, because their project has two modules. The repository still has 2936 `Deno.test` definitions. Opus checked that each removed assert is inside the helpers or still in the test. The six FZA1 sites without the module-ok assert, and the callers of two weaker local helpers, now also assert that each module lowers, and they pass. |
| FWU3 | 3 | FZA3 and FZA4 are done. `isDeferredKind` replaces the 8-kind lists at the 6 sites and `isDeferredType` at its 4 callers. `isContainerKind` and `childTypes` replace the container branches at the 5 sites. Each site keeps its order, its short circuit, and its `never` check. The plan put the helpers in `ir.ts`, but `scripts/site_ir.ts` publishes the whole text of `ir.ts` as the typed IR of the website. Commit `48ca16f7` moves them to `src/core/type_kinds.ts`, which imports nothing, and adds that module to the emitter import allowlist in `tests/emit_families_test.ts`. `ir.ts` is unchanged. The tool on the changed lines of 5 modules killed all 19 sampled mutants. `src/core/validate/type_checks.ts` keeps its own list of the 8 kinds. On `main` at `48ca16f7`, `deno task check` exits 0: 3393 fast tests passed and 6 ignored, and 332 slow tests passed. |
| FWU6 | 8 | All 31 survivors are closed. Tests in 7 new `tests/*_mutation_test.ts` files kill 30 of them, and the `--only` run of each module exits 0. The `lower.ts` tests change one checker fact of a checked project, because no source text carries such a fact; Opus corrected the doc of their `forged` helper. One `equivalent` row covers `createBodyChecker.checkFit`: both exits return `checker`, so the negated test changes no value. A differential of the 86 error fixtures and the examples gave the same diagnostics, and a logging copy counted 2815 true and 14 false results. No survivor showed a defect. |
| FWU5 | 1 | FWU3 removed 25 of the 28 survivors, because they sat on the two 8-kind lists, which `isDeferredKind` and its census test in `tests/emit_deferred_type_test.ts` now cover. A full run then found 4 survivors, 1 of them registered. 5 tests in `tests/recursion_guard_mutation_test.ts` kill 2. One `equivalent` row covers the primitive-or-literal test of `guardedRecord.visit`: the mutant returns the node, which callers read only as truthy. A differential of 200000 forged types matched, with 30691 reaches, and a control mutant differed. The full run of `src/core/recursion_guard.ts` exits 0. |
| FWU4 | 1 | All 30 survivors of `emit/fields.ts` are killed by 3 tests in `tests/emit_fields_mutation_test.ts`. Two checks of `taggedFields` use forged IR (`tagged: false`, and `tagged` on an alias), which the IR validator rejects, as the FWU6 tests forge checker facts. Opus replaced the test's own renderer with `render` of `emit/doc.ts`, with the same literal values. The full run of `src/core/emit/fields.ts` killed 64 of 64 and exits 0. |
