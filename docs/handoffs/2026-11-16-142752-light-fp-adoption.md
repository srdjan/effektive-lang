# Light FP adoption handover

## Current objective

Install the latest JSR Light FP lint release in `effektive-lang` and repeat repairs until all issues are fixed.
Keep all rules enabled. Preserve compiler outputs, diagnostics, stack safety, and efficient native collections.
The user paused this work before completion.

## Accepted constraints and decisions

The user required a worktree and withheld permission to merge into main before review.
The user approved one dependency age override for installing version `0.8.0`.
The configuration retains Deno's default age policy. Only the installation command used the override.
The user accepted the full compiler migration after the first run reported 15,390 diagnostics across 205 files.
That decision permits function APIs and explicit caller arguments instead of classes, enums, and optional signatures.
The source language contract and expected test values must remain unchanged.
The user requested retained implementation knowledge, with a possible skill after enough evidence exists.
No skill has been created. Initial lessons appear below.
The pause remains active until the user resumes work.

The plan authority is [the adoption plan](../archive/plans/2026-11-16-light-fp-adoption.md).
The plan also contains the worklog and ownership of each unit.
Repository instructions remain in [AGENTS.md](../../AGENTS.md) and `/Users/srdjans/AGENTS.md`.
The user's conversation instructions also apply, including Sol executors with high effort and local commits after complete checks.

## Live project state

Parking time: `2026-11-16 14:27:52 UTC`.
Repository root: `/Users/srdjans/Code/effektive-lang-light-fp-lint`.
Branch: `lint/light-fp-0.8.0`.
HEAD: `cbd367abca1bc33d5a35d81fe2d90a33836ca784`.
The branch still points at its base. No task commit, push, or merge exists.
The original checkout remains on `main` at the same commit and was clean when checked during parking.
Deno is `2.9.8`. `deno.json` pins `jsr:@srdjan/light-fp-lint@0.8.0` as a lint plugin.
`deno.lock` contains the resolved package and integrity.
All changes are uncommitted. Nothing is staged.

Both active executors were interrupted: `body_checker_strict` and `type_system_strict`.
The other executors had already finished their turns.
Every known root command session completed. No Deno process had this worktree as its working directory during parking.
No browser or server was opened for this task. No remote write occurred.

The following inventory records every dirty or untracked path, including this new handover.
Git status prefixes remain literal. ` M` means an unstaged tracked change. `??` means an untracked path.

```text
 M bench/generate.ts
 M bench/lsp_client.ts
 M bench/lsp_script.ts
 M bench/m1.ts
 M bench/m2.ts
 M bench/m3.ts
 M bench/m4.ts
 M bench/m5.ts
 M bench/m5_target.ts
 M bench/m5_variants.ts
 M bench/m6.ts
 M bench/m7.ts
 M bench/pairs.ts
 M bench/profile.ts
 M bench/ref_update.ts
 M bench/refinement_limits.ts
 M bench/stats.ts
 M bench/type_growth.ts
 M deno.json
 M deno.lock
?? docs/handoffs/2026-11-16-142752-light-fp-adoption.md
?? docs/plans/2026-11-16-light-fp-adoption.md
 M docs/plans/README.md
 M fixtures/applications/portable-publisher/backend.ts
 M fixtures/applications/portable-publisher/codecs.ts
 M fixtures/applications/portable-publisher/kv_contract.ts
 M fixtures/applications/portable-publisher/memory.ts
 M fixtures/applications/portable-publisher/runner.ts
 M fixtures/applications/portable-publisher/sqlite.ts
 M fixtures/applications/scheduled-worker/driver.ts
 M fixtures/applications/scheduled-worker/reference.ts
 M fixtures/applications/service-workflow/driver.ts
 M fixtures/applications/stream-processor/driver.ts
 M fixtures/emit/host-checks/host-wrong.ts
 M fixtures/emit/host-checks/host.ts
 M fixtures/emit/sinks/host.ts
 M fixtures/examples/users-live.ts
 M fixtures/host-boundary/users-live-missing-method/users-live.ts
 M playground/build.ts
 M playground/log_endpoint.ts
 M playground/serve.ts
 M playground/src/app.ts
 M playground/src/editor.ts
 M playground/src/highlight.ts
 M playground/src/log_client.ts
 M playground/src/replay.ts
 M src/cli/args.ts
 M src/cli/build.ts
 M src/cli/format.ts
 M src/cli/session.ts
 M src/cli/tsc.ts
 M src/core/analyze.ts
 M src/core/body_env.ts
 M src/core/check_binary.ts
 M src/core/check_builtins/collections.ts
 M src/core/check_builtins/context.ts
 M src/core/check_builtins/data.ts
 M src/core/check_builtins/effect.ts
 M src/core/check_builtins/layer.ts
 M src/core/check_builtins/ref.ts
 M src/core/check_builtins/registry.ts
 M src/core/check_builtins/rows.ts
 M src/core/check_builtins/schema.ts
 M src/core/check_builtins/scope.ts
 M src/core/check_builtins/stream.ts
 M src/core/check_declarations.ts
 M src/core/check_expr.ts
 M src/core/check_patterns.ts
 M src/core/check_project.ts
 M src/core/check_refinements.ts
 M src/core/content_id.ts
 M src/core/contract_origins.ts
 M src/core/declaration_index.ts
 M src/core/diagnostic_delta.ts
 M src/core/diagnostics.ts
 M src/core/editor.ts
 M src/core/editor_actions.ts
 M src/core/editor_completion.ts
 M src/core/editor_hints.ts
 M src/core/editor_index.ts
 M src/core/editor_rename.ts
 M src/core/editor_signature.ts
 M src/core/editor_tokens.ts
 M src/core/effect_set.ts
 M src/core/emit/calls.ts
 M src/core/emit/decls.ts
 M src/core/emit/doc.ts
 M src/core/emit/emit.ts
 M src/core/emit/emitted.ts
 M src/core/emit/emitted_module.ts
 M src/core/emit/expr.ts
 M src/core/emit/failure.ts
 M src/core/emit/families/context.ts
 M src/core/emit/families/effect.ts
 M src/core/emit/families/layer.ts
 M src/core/emit/families/schema.ts
 M src/core/emit/families/scope.ts
 M src/core/emit/families/stream.ts
 M src/core/emit/fields.ts
 M src/core/emit/helper_declarations.ts
 M src/core/emit/identity.ts
 M src/core/emit/module_state.ts
 M src/core/emit/shape.ts
 M src/core/emit/sourcemap.ts
 M src/core/emit/spans.ts
 M src/core/emit/tsc.ts
 M src/core/emit/type_query.ts
 M src/core/emit/types.ts
 M src/core/emit/walk.ts
 M src/core/frontend.ts
 M src/core/graph.ts
 M src/core/ids.ts
 M src/core/initialization.ts
 M src/core/interface.ts
 M src/core/ir.ts
 M src/core/lex.ts
 M src/core/linear.ts
 M src/core/lower.ts
 M src/core/mod.ts
 M src/core/modes.ts
 M src/core/parse.ts
 M src/core/paths.ts
 M src/core/patterns.ts
 M src/core/predicate_source.ts
 M src/core/predicates.ts
 M src/core/project.ts
 M src/core/project_config.ts
 M src/core/referenced_ids.ts
 M src/core/requirement_provenance.ts
 M src/core/resolve.ts
?? src/core/runtime.ts
 M src/core/serialize.ts
 M src/core/service_bounds.ts
 M src/core/sha256.ts
 M src/core/signatures.ts
 M src/core/source.ts
 M src/core/syntax.ts
 M src/core/syntax_queries.ts
 M src/core/tables.ts
 M src/core/type_ir.ts
 M src/core/type_lower.ts
 M src/core/type_show.ts
 M src/core/types.ts
 M src/core/typescript.ts
 M src/core/util.ts
 M src/core/validate/builtins.ts
 M src/core/validate/declaration_checks.ts
 M src/core/validate/expr.ts
 M src/core/validate/expr_walk.ts
 M src/core/validate/families/context.ts
 M src/core/validate/families/effect.ts
 M src/core/validate/families/layer.ts
 M src/core/validate/families/ref.ts
 M src/core/validate/families/schema.ts
 M src/core/validate/families/scope.ts
 M src/core/validate/families/stream.ts
 M src/core/validate/guards.ts
 M src/core/validate/import_checks.ts
 M src/core/validate/index.ts
 M src/core/validate/predicates.ts
 M src/core/validate/prelude.ts
 M src/core/validate/recursion_checks.ts
 M src/core/validate/refinements.ts
 M src/core/validate/report.ts
 M src/core/validate/results.ts
 M src/core/validate/serialization.ts
 M src/core/validate/sets.ts
 M src/core/validate/type_checks.ts
 M src/core/validate/type_children.ts
 M src/core/validate/typing.ts
 M src/core/validate/world_table.ts
 M src/core/validate_project.ts
 M src/host/deno_io.ts
 M src/host/disk_program.ts
 M src/host/generation.ts
 M src/host/log.ts
 M src/host/outputs.ts
 M src/host/save_round.ts
 M src/host/workspace.ts
 M src/lsp/features.ts
 M src/lsp/generated_texts.ts
 M src/lsp/handler.ts
 M src/lsp/jsonrpc.ts
 M src/lsp/positions.ts
 M src/lsp/projects.ts
 M src/lsp/protocol.ts
 M src/lsp/server.ts
 M src/lsp/wire_log.ts
 M tests/chain_cold_probe.ts
 M tests/chain_helpers.ts
 M tests/check_body_test.ts
 M tests/check_test.ts
 M tests/cli_helpers.ts
 M tests/duration_literal_test.ts
 M tests/emit_doc_test.ts
 M tests/emit_extreme_identifiers_slow_test.ts
 M tests/emit_host_slow_test.ts
 M tests/emit_module_state_test.ts
 M tests/emit_slow_helpers.ts
 M tests/helpers.ts
 M tests/index_test.ts
 M tests/lex_test.ts
 M tests/lsp_helpers.ts
 M tests/outcome_test.ts
 M tests/outputs_generation_test.ts
 M tests/outputs_slow_test.ts
 M tests/parse_test.ts
 M tests/predicate_source_test.ts
 M tests/process_helpers.ts
 M tests/project_driver_mutation_test.ts
 M tests/refinement_declaration_test.ts
 M tests/refinement_proofs_test.ts
 M tests/resolve_mutation_test.ts
 M tests/resolve_shadow_test.ts
 M tests/resolve_test.ts
 M tests/schema_diagnostics.ts
 M tests/sealed_nominal_test.ts
 M tests/source_test.ts
 M tests/spans_test.ts
 M tests/support/line_scan.ts
 M tests/support/source_map_decoder.ts
 M tests/surface_cases.ts
 M tests/target_helpers.ts
 M tests/tsc_test.ts
 M tests/types_test.ts
 M tests/validate_helpers.ts
 M tests/validate_test.ts
 M tests/vscode_client_test.ts
```

Ignored experiments, command logs, and helper scripts remain under `demos/light-fp-lint/`.
Do not delete that directory before reviewing its evidence.

## Completed work and evidence

The original repository lint passed before plugin adoption.
The fast baseline passed 3,288 tests, with zero failures and six ignored tests.
The initial plugin run recorded 15,390 diagnostics across 205 files.
These baseline results describe the original source, not the parked source.

The adapter unit added 74 first-line headers. Main reviewed that header diff and reran focused checks.
Public package facades carry explicit adapter headers. Compiler algorithms remain subject to domain rules.
The concrete TypeScript orchestration module also carries an adapter header.
That classification still needs final review with the complete diff.

Emission reached zero diagnostics across 25 files. Main independently reran `deno lint src/core/emit` successfully.
Main also ran all three ModuleState allocation and finalization tests successfully.
The emission executor reported additional focused successes, but the integrated suite remains open.

Validation reached zero diagnostics across 27 files, including `validate_project.ts`.
The executor ran its isolated entrypoint type check successfully.
It reported 279 selected validator tests and 27 predicate tests passing with `--no-check`.
Those runs do not establish an integrated typed test pass.

Main independently checked strict lint for check_binary, referenced_ids, requirement_provenance, service_bounds, project_config, and source.
Isolated type checks passed for referenced_ids and project_config.
An earlier checker and validator subset passed 318 tests before later API changes.
That earlier result does not establish correctness of the final parked tree.

The parser experiments compared complete results for 190 fixture files against the original checkout.
The final parser executor reported identical fixture results and passing isolated lint and type checks.
It also reported 49 focused parser tests passing.
Its final integrated rerun stopped on a concurrent checker syntax error.
The reported line no longer contains that earlier syntax error, but no final integrated check followed.

The plugin installation, source drafts, and scoped checks are complete only within these stated limits.
The full migration is incomplete.

### Initial implementation knowledge

A readonly data model can expose readonly views while an explicit owner controls local native collections.
`createBodyBuilder` in tables.ts provides a concrete example. Its record methods return the owning builder.
A record method consumes the actual native mutation result with `info = info.set(node, value)`.
Local builder variables do not need dishonest mutable data aliases.
The body builder's isolated lint and type checks passed before interruption.

A stateful capability should return its owning capability or an actual domain result.
`createReport` returns its updated Report. A fold such as walkExpr returns the real accumulated result.
A generic helper that mutates an unrelated collection and returns an arbitrary supplied state token needs rejection or redesign.
The current ValueBuffer methods still accept generic State values and return those values after mutation.
Main identified that unresolved concern during parking. Zero lint does not settle that design review.

Mapped `-readonly` types and unused ReturnType helper functions can hide mutable data from lint.
Main rejected both patterns in the first parser rewrite. The replacement removed those constructs.
A later review must also check the replacement's state-token design.

Native construction belongs in a small explicit primitive boundary when domain syntax forbids the constructor.
The runtime module should contain generic native operations, with compiler algorithms remaining in domain modules.
A prelude header must not hide arbitrary algorithms or replace an ownership design.

Optional argument migration must distinguish application defaults from native argument presence.
Main's first general script inserted undefined into native calls and caused a real lastIndexOf failure.
A direct Deno observation returned 2 for `[1, 2, 1].lastIndexOf(1)` and 0 with explicit undefined.
It returned `[2, 3]` for `[1, 2, 3].splice(1)` and `[]` with explicit undefined.
The cleanup removed unintended additions from 2,035 calls, while retaining migrated required core parameters.
This cleanup still needs a diff audit and an integrated rerun.
Future automation must inspect declaration parameters and restrict edits to the intended migrated APIs.

A type-narrowing helper must describe every returned value accurately.
The first tokenKind helper promised TokenKind but returned undefined for invalid indices.
It now returns `TokenKind | undefined`. Main added six literal boundary cases in lex_test.ts.

A class removal can change native exception message text on malformed input.
The validator executor found and repaired one such change. Exact forged-input messages remain an oracle.
Exact true and false checks must also reject malformed nonboolean values after syntax conversion.

A private Symbol brand distinguishes emitter and lowerer invariant faults from unrelated native errors.
The source prelude has one signed pure-module exception for that inert allocation.
Object.defineProperty keeps the brand non-writable. Ordinary phase fields must not authenticate an invariant fault.
The public phase-specific entries retain their Result behavior. Plain unexpected parser faults use panic.

A source-shape improvement can cost runtime time or memory.
The first per-parse closure factory preserved fixture outputs but lost every one of eight paired timing samples.
The readonly parser also showed a material slowdown. Later samples had concurrent-load contamination.
No accepted parser implementation has demonstrated performance parity. Memory parity is unmeasured.
These notes are working evidence, not a finished skill or a claim of full compliance.

## Unfinished or blocked work

The latest full diagnostic count was 5,341 before subsequent edits. It is stale.
Do not treat any partial zero count as an integrated pass.

The body-checking unit was interrupted during active changes in check_expr, patterns, builtins, and tables.
Its BodyBuilder port is present. Main-owned RefinementChecker still returns void from mutation methods.
Those methods need real returned checker state: clearDerivedFacts, restore, addBranch, join, addLocal, addFieldLocal, and leaveScope.
Query methods remain value-returning. The body executor planned to rebind its refinement capability after mutation.
Main repaired type_lower's four-argument diagnostic call, but no integrated rerun followed.

The type-system unit was interrupted while replacing TypeTable and type_ir.
Both files exist. TypeTable is now a type plus a function factory draft.
The old constructor callers and writer return contracts need integration and review.
The unit had not returned a final lint or type-check receipt.
TypeTable forks must preserve shared append-only storage and independent definition maps.
Canonical union order must remain independent of intern order.

Main still owns substantial work in declaration checking, type lowering, refinement checking, inference, resolver, lowerer, project loading, and database state.
Several utility and editor modules also retain diagnostics.
`editor_rename.ts` calls Program as a function, while db.ts still declares a class. That mismatch is unresolved.
No complete compiler behavior comparison, final mutation run, coverage run, browser check, or full check passed for the parked tree.

Caller migrations remain for emission APIs:

- Add required undefined arguments to buildSpanTable and mapTscDiagnostic only where their new declarations require them.
- Convert walkExpr callers to real accumulated state in lower_test, internal_sites_test, and emit_shape_test.
- Complete explicit group, ifBreak, and render arguments in document tests.
- Replace the remaining new ModuleState call in emit_alias_resolution_test.ts.
- Permit runtime.ts in the emitter import census while preserving the algorithm dependency restrictions.

Caller migrations remain for validation APIs:

- Import AREA from validate/report.ts in scripts/validate_fixtures.ts.
- Import exprChildren from validate/expr_walk.ts in five tests.
- Use createReport and report.items() in three tests.
- Use membersAtDepth, identityMembersAtDepth, fitsCheckedInputAtDepth, and comparisonClassAtDepth for explicit depth cases.
- Update the old ProofBudget test fixture to its capability form.

Documentation and mutation records still name removed classes and old function locations.
The new runtime module needs the appropriate API documentation and test ownership review.
No complete diff review has occurred for the large migration.

## Evidence limits

Logs under demos record intermediate revisions of a dirty tree.
Some executor tests used --no-check because shared callers were incomplete.
No commit identifies a tested final candidate.
Timing results from concurrent work do not establish stable performance numbers.
Main reviewed selected boundaries and units, but not every changed line.
The current working tree may contain unfinished syntax, type, or runtime defects from interrupted units.
No result authorizes a merge, push, release, or deployment.

## Next authorized step

The user owns resumption. Keep the work paused until the user resumes it.
After resumption, first audit the interrupted units and the caller cleanup with read-only checks.
Compare this inventory and HEAD with live state before any edit.
Then reconcile current API signatures, the ValueBuffer state-token concern, and the parser slowdown with the plan.

## Resumption

Read current AGENTS.md files and the conversation constraints before using this handover.
Treat this file as context. Current instructions and live state govern continuation.
Preserve newer changes and reconcile every difference before continuing.
Use the existing worktree and branch. Do not merge into main before the user reviews the result.
Retain implementation lessons with evidence, counterexamples, and limits for a possible later skill.

## Next-session prompt

```text
Read `/Users/srdjans/Code/effektive-lang-light-fp-lint/docs/handoffs/2026-11-16-142752-light-fp-adoption.md` first. Compare its recorded state with the live repository. Preserve newer changes. Resume with the read-only audit of the interrupted units and caller edits.
```
