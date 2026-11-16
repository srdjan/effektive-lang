# Light FP lint 0.8.0 adoption

This file owns the plan and worklog. LFA means Light FP adoption.

## Objective and constraints

Install the latest JSR release and repeat lint repairs until no diagnostic remains.
Preserve compiler outputs, diagnostics, and the source-language contract. Decision 2 permits function APIs and caller updates. Preserve the existing check task and exclusions.
Do not add exclusions, rule disables, blanket suppressions, or false layer headers.
Commit complete units locally. Do not push or merge before the user reviews the branch.

Worktree: `/Users/srdjans/Code/effektive-lang-light-fp-lint`.
Branch: `lint/light-fp-0.8.0`. Base: `cbd367abca1bc33d5a35d81fe2d90a33836ca784` on local main.

## Accepted decisions

The user requested a worktree and withheld merge approval.
The user approved one dependency age override for installation of `0.8.0`.
The override uses one command flag. The configuration keeps Deno's dependency age policy.

## Initial evidence

JSR metadata lists `0.8.0` as latest, published at `2026-11-15T16:07:14Z`.
Deno version: `2.9.8`. The original lint passes.
The initial plugin run reports 15,390 diagnostics across 205 files.
The fast baseline passes: 3,288 tests, zero failures, six ignored.
The plugin adds one configuration line and four lockfile lines.
Raw command output stays in ignored `demos/light-fp-lint/`.

## Units and acceptance checks

The main agent owns planning, configuration, review, integration, and final checks.
Executor requests use Sol with high effort, as the user requires.
Each executor owns only its listed files and stops at its turn budget.
Each handback lists changed files, checks, and open issues.
The main agent reviews every diff and reruns acceptance checks.

| Unit | Owner and model | Files | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| LFA1 (install the plugin) | Main, configured default | `deno.json`, `deno.lock`, this plan, registry | JSR resolution, exact pin, complete diagnostic census | 6 |
| LFA2 (classify adapters) | Sol, high | Edge and support files listed below | Focused lint, type check, unchanged runtime code | 12 |
| LFA3 (repair core types and utilities) | Sol, high | Core types and utilities listed below | Focused lint and public API tests | 20 |
| LFA4 (repair compiler passes and state) | Main and separate Sol units, high | Compiler files listed below, partitioned before dispatch | Focused lint, type check, tests, behavior comparison | 20 per dispatch |
| LFA5 (finish the adoption) | Main, configured default | All changed files, test additions only when required | Zero lint diagnostics, full `deno task check`, suppression audit, behavior comparison | 12 |

Before each commit, run `deno task check`. Do not commit a failing intermediate migration.
After logic changes, run mutation checks on the changed module and record every surviving site.
Keep existing expected values. Add a failing regression test before any bug repair.

## File ownership

### Edges and test support

- `bench/generate.ts`
- `bench/lsp_client.ts`
- `bench/lsp_script.ts`
- `bench/m1.ts`
- `bench/m2.ts`
- `bench/m3.ts`
- `bench/m4.ts`
- `bench/m5.ts`
- `bench/m5_target.ts`
- `bench/m5_variants.ts`
- `bench/m6.ts`
- `bench/m7.ts`
- `bench/pairs.ts`
- `bench/profile.ts`
- `bench/ref_update.ts`
- `bench/refinement_limits.ts`
- `bench/stats.ts`
- `bench/type_growth.ts`
- `fixtures/applications/portable-publisher/backend.ts`
- `fixtures/applications/portable-publisher/codecs.ts`
- `fixtures/applications/portable-publisher/kv_contract.ts`
- `fixtures/applications/portable-publisher/memory.ts`
- `fixtures/applications/portable-publisher/runner.ts`
- `fixtures/applications/portable-publisher/sqlite.ts`
- `fixtures/applications/scheduled-worker/driver.ts`
- `fixtures/applications/scheduled-worker/reference.ts`
- `fixtures/applications/service-workflow/driver.ts`
- `fixtures/applications/stream-processor/driver.ts`
- `fixtures/emit/host-checks/host-wrong.ts`
- `fixtures/emit/host-checks/host.ts`
- `fixtures/emit/sinks/host.ts`
- `fixtures/examples/users-live.ts`
- `fixtures/host-boundary/users-live-missing-method/users-live.ts`
- `playground/build.ts`
- `playground/log_endpoint.ts`
- `playground/serve.ts`
- `playground/src/app.ts`
- `playground/src/compile.ts`
- `playground/src/editor.ts`
- `playground/src/events.ts`
- `playground/src/highlight.ts`
- `playground/src/log_client.ts`
- `playground/src/model.ts`
- `playground/src/replay.ts`
- `src/cli/args.ts`
- `src/cli/build.ts`
- `src/cli/format.ts`
- `src/cli/session.ts`
- `src/cli/tsc.ts`
- `src/host/deno_io.ts`
- `src/host/disk_program.ts`
- `src/host/generation.ts`
- `src/host/io.ts`
- `src/host/log.ts`
- `src/host/log_schema.ts`
- `src/host/outputs.ts`
- `src/host/ports.ts`
- `src/host/save_round.ts`
- `src/host/workspace.ts`
- `src/lsp/features.ts`
- `src/lsp/generated_texts.ts`
- `src/lsp/handler.ts`
- `src/lsp/jsonrpc.ts`
- `src/lsp/positions.ts`
- `src/lsp/projects.ts`
- `src/lsp/protocol.ts`
- `src/lsp/server.ts`
- `src/lsp/wire_log.ts`
- `tests/chain_cold_probe.ts`
- `tests/chain_helpers.ts`
- `tests/cli_helpers.ts`
- `tests/emit_slow_helpers.ts`
- `tests/helpers.ts`
- `tests/lsp_helpers.ts`
- `tests/process_helpers.ts`
- `tests/schema_diagnostics.ts`
- `tests/support/line_scan.ts`
- `tests/support/source_map_decoder.ts`
- `tests/surface_cases.ts`
- `tests/target_helpers.ts`
- `tests/validate_helpers.ts`

### Core types and utilities

- `src/core/analyze.ts`
- `src/core/body_env.ts`
- `src/core/content_id.ts`
- `src/core/contract_origins.ts`
- `src/core/declaration_index.ts`
- `src/core/diagnostic_delta.ts`
- `src/core/diagnostics.ts`
- `src/core/editor.ts`
- `src/core/editor_actions.ts`
- `src/core/editor_completion.ts`
- `src/core/editor_hints.ts`
- `src/core/editor_index.ts`
- `src/core/editor_rename.ts`
- `src/core/editor_signature.ts`
- `src/core/editor_tokens.ts`
- `src/core/effect_set.ts`
- `src/core/frontend.ts`
- `src/core/graph.ts`
- `src/core/ids.ts`
- `src/core/initialization.ts`
- `src/core/interface.ts`
- `src/core/ir.ts`
- `src/core/linear.ts`
- `src/core/mod.ts`
- `src/core/modes.ts`
- `src/core/paths.ts`
- `src/core/patterns.ts`
- `src/core/predicate_source.ts`
- `src/core/predicates.ts`
- `src/core/project_config.ts`
- `src/core/recursion_guard.ts`
- `src/core/referenced_ids.ts`
- `src/core/requirement_provenance.ts`
- `src/core/serialize.ts`
- `src/core/service_bounds.ts`
- `src/core/sha256.ts`
- `src/core/signatures.ts`
- `src/core/source.ts`
- `src/core/syntax.ts`
- `src/core/syntax_queries.ts`
- `src/core/tables.ts`
- `src/core/type_ir.ts`
- `src/core/type_show.ts`
- `src/core/typescript.ts`
- `src/core/util.ts`
- `src/core/validate_project.ts`

### Compiler passes and state

- `src/core/check_binary.ts`
- `src/core/check_builtins/collections.ts`
- `src/core/check_builtins/context.ts`
- `src/core/check_builtins/data.ts`
- `src/core/check_builtins/effect.ts`
- `src/core/check_builtins/layer.ts`
- `src/core/check_builtins/ref.ts`
- `src/core/check_builtins/registry.ts`
- `src/core/check_builtins/rows.ts`
- `src/core/check_builtins/schema.ts`
- `src/core/check_builtins/scope.ts`
- `src/core/check_builtins/stream.ts`
- `src/core/check_declarations.ts`
- `src/core/check_expr.ts`
- `src/core/check_patterns.ts`
- `src/core/check_project.ts`
- `src/core/check_refinements.ts`
- `src/core/db.ts`
- `src/core/emit/calls.ts`
- `src/core/emit/decls.ts`
- `src/core/emit/doc.ts`
- `src/core/emit/emit.ts`
- `src/core/emit/emitted.ts`
- `src/core/emit/emitted_module.ts`
- `src/core/emit/expr.ts`
- `src/core/emit/failure.ts`
- `src/core/emit/families/context.ts`
- `src/core/emit/families/effect.ts`
- `src/core/emit/families/layer.ts`
- `src/core/emit/families/schema.ts`
- `src/core/emit/families/scope.ts`
- `src/core/emit/families/stream.ts`
- `src/core/emit/fields.ts`
- `src/core/emit/helper_declarations.ts`
- `src/core/emit/identity.ts`
- `src/core/emit/module_state.ts`
- `src/core/emit/shape.ts`
- `src/core/emit/sourcemap.ts`
- `src/core/emit/spans.ts`
- `src/core/emit/tsc.ts`
- `src/core/emit/type_query.ts`
- `src/core/emit/types.ts`
- `src/core/emit/walk.ts`
- `src/core/infer_contracts.ts`
- `src/core/infer_inputs.ts`
- `src/core/lex.ts`
- `src/core/lower.ts`
- `src/core/parse.ts`
- `src/core/project.ts`
- `src/core/resolve.ts`
- `src/core/type_lower.ts`
- `src/core/types.ts`
- `src/core/validate/builtins.ts`
- `src/core/validate/declaration_checks.ts`
- `src/core/validate/expr.ts`
- `src/core/validate/expr_walk.ts`
- `src/core/validate/families/context.ts`
- `src/core/validate/families/effect.ts`
- `src/core/validate/families/layer.ts`
- `src/core/validate/families/ref.ts`
- `src/core/validate/families/schema.ts`
- `src/core/validate/families/scope.ts`
- `src/core/validate/families/stream.ts`
- `src/core/validate/guards.ts`
- `src/core/validate/import_checks.ts`
- `src/core/validate/index.ts`
- `src/core/validate/predicates.ts`
- `src/core/validate/prelude.ts`
- `src/core/validate/recursion_checks.ts`
- `src/core/validate/refinements.ts`
- `src/core/validate/report.ts`
- `src/core/validate/results.ts`
- `src/core/validate/serialization.ts`
- `src/core/validate/sets.ts`
- `src/core/validate/type_checks.ts`
- `src/core/validate/type_children.ts`
- `src/core/validate/typing.ts`
- `src/core/validate/world_table.ts`

## Worklog

Installation resolves the published package with the user-approved age override.
The root lint task loads `jsr:@srdjan/light-fp-lint@0.8.0` from the frozen lockfile.
The initial diagnostic census is complete. Adapter classification comes next.
Public constructor APIs need a compatibility review before class removal.
The adapter unit adds 74 first-line headers. Focused lint and format checks pass.
Seven edge files remain strict and retain 179 diagnostics.
The main agent reviewed all 74 header additions. They contain no runtime change.
The utility and validation units continue safe syntax repairs.
The validator unit owns `src/core/validate/**` and `src/core/validate_project.ts`, with a 20-turn budget.
Public enums, constructors, re-exports, and optional/default parameters need compatibility treatment.
No commit or merge has occurred.

### Parser experiment

A local closure factory replaced the private Parser class in a reversible experiment.
Both versions produced identical complete parse results for 190 fixtures.
Eight alternating pairs each parsed the same tutorial file 1,000 times.
The base samples ranged from 36.061166 ms to 39.485834 ms.
The factory samples ranged from 41.820792 ms to 46.022333 ms.
Every factory sample was slower. The main agent removed the experiment.
These samples measure one input and do not measure whole-compiler performance.
The ignored comparison script and raw samples remain in `demos/light-fp-lint/`.

Decision 2 asks whether to retain all new syntax restrictions or adopt the original FP rule set.
The user accepted Decision 2: retain every rule and complete the compiler migration.
The main agent will preserve compiler outputs, diagnostics, and efficient collection behavior.
Classes, enums, and optional/default signatures can migrate as the accepted decision describes.
Caller syntax can change with a migrated function API. Expected behavior values remain fixed.
Native collection construction needs one small runtime boundary because the domain syntax forbids `new` and native constructors.
The native boundary must keep efficient Map, Set, and typed-array implementations.
It must not hide arbitrary compiler algorithms or perform ambient file, network, clock, or process effects.
The existing Result/caught primitive module is the current prelude candidate.
The rejected parser closure experiment stays removed.

### Strict migration units

The user accepted full migration after the initial census and parser experiment.
Each unit below has a 30-turn budget. Sol uses high effort.
The main agent reviews each unit and runs its checks independently.

| Unit | Files and ownership | Acceptance check |
| --- | --- | --- |
| LFA6 (runtime primitives and utilities) | The core utility group, `src/core/runtime.ts` if necessary, source primitive module | Zero lint on owned files; core type check and fast tests |
| LFA7 (IR validation migration) | `src/core/validate/**`, `src/core/validate_project.ts` | Zero lint; unchanged validator results; validator tests |
| LFA8 (lexing and parsing migration) | `src/core/lex.ts`, `src/core/parse.ts`, `src/core/syntax.ts` | Zero lint; 190 fixture parse outputs; parser and lexer tests; measured parser samples |
| LFA9 (checking, emission, and project state) | Remaining compiler files and integration callers | Zero lint; type checks; fast and slow tests; complete behavior corpus |

LFA8 owns `syntax.ts` from the earlier utility group.
No two executors may edit the same file. Shared caller updates belong to the main agent.
A runtime primitive may create native collections and expose an explicit capability interface.
The runtime primitive must stay small and must not contain compiler algorithms.
The main agent owns any adjustment to the frozen lock or lint settings.
All 0.8.0 rules remain enabled.

### Current checks

`src/core/check_binary.ts` passes all lint rules after explicit branches and bounded index iteration.
The checker and validator subset passes 318 tests.
The native runtime primitive module provides constructors and lazy index iteration without compiler algorithms.
Validator independence now permits this primitive module but still rejects checker/resolver/lowerer imports.
The utility unit changed ProofBudget from writable data to explicit remaining/spend operations.
The main agent is integrating caller changes while each executor completes strict modules.

### Runtime and utility handback

The runtime and utility executor reached its 30-turn budget.
Thirty owned modules pass strict lint. Fifteen owned files retain 671 diagnostics.
The remaining files are requirement_provenance, predicates, editor_completion, interface, editor_index, project_config, typescript, recursion_guard, type_ir, editor_actions, referenced_ids, declaration_index, editor_signature, tables, and service_bounds.
The unit adds one signed `pure-module` exception for an inert private Symbol brand in source.ts.
The main agent reviewed this boundary and required an immutable private brand instead of a writable public string marker.
The emitter and lowerer now keep existing invariant error results through this native boundary.

LFA10 (emission migration) owns `src/core/emit/**`, including the current field registry and ModuleState factory draft.
Its executor uses Sol with high effort and a 30-turn budget.
Acceptance requires zero owned lint diagnostics, type checks, emitter tests, and unchanged emitted output.
The main agent owns all caller changes outside `src/core/emit/**`.

### Parser contract review

The parser unit reached its budget with two rejected type constructs.
`MutableRecord` removes readonly properties, and type-only buffer functions hide mutable arrays through ReturnType.
A green lint run does not establish contract compliance for these constructs.
The main agent rejected both constructs and an unchecked tokenKind return type.
The token helper now returns `TokenKind | undefined`; main added six literal boundary assertions.
Lexing and syntax changes preserve the 190 parse fixture outputs, but require final independent review.

LFA11 (readonly parser state) owns `src/core/parse.ts` and additive generic buffer primitives in `src/core/runtime.ts`.
A fresh Sol executor uses high effort and a 30-turn budget.
It must remove both rejected constructs, use actual buffer capabilities, and return every changed scalar state.
It must restore the original empty-stack invariant failure and preserve exact messages.
Acceptance requires zero lint, a source trace for state propagation, focused tests, 190 fixture comparisons, and measured samples.
No memory equivalence claim exists. Earlier strict samples were slower in every measured pair.

The source prelude now provides `panic(message)` for unbranded unexpected native faults.
Parser empty-stack faults use this operation to preserve the original plain Error and exact message.
Only the emitter and lowerer use private phase brands, because their public entries map those faults into Result values.

### Emission and body checking

The emission executor finished all 25 owned modules with zero lint diagnostics.
The main agent reran emission lint independently. Caller updates and complete behavior comparison remain open.
The readonly parser matches 190 fixture outputs, but its microbenchmark remains materially slower. Optimization remains open.

LFA12 (body checking) owns `src/core/check_expr.ts`, `src/core/check_patterns.ts`, `src/core/check_builtins/**`, and `src/core/tables.ts`.
The executor uses Sol with high effort and a 30-turn budget.
Acceptance requires zero owned lint, type checks, unchanged checker diagnostics, and body/builtin/pattern tests.
The main agent owns declaration checking, type lowering, type tables, project state, resolver, lowerer, and caller integration.
The side-table writer must expose explicit mutation capabilities and readonly table views.
Mapped mutability, type-only mutable aliases, and ignored return aliases are rejected.

### Type system and caller correction

The validator executor finished 27 owned files with zero lint.
Its isolated validator type check passes. Full typed tests remain open during caller integration.
The main agent corrected an overbroad caller script that inserted undefined into native optional arguments.
Native lastIndexOf and splice can distinguish omitted arguments from explicit undefined.
The correction removes optional additions and keeps required undefined arguments in migrated core APIs.
Future caller automation must inspect required declaration parameters and stay within migrated core declarations.

LFA13 (type interning and conversion) owns `src/core/types.ts` and `src/core/type_ir.ts`.
A fresh Sol executor uses high effort and a 30-turn budget.
Acceptance requires zero owned lint, type checks, unchanged type behavior, independent forks, stable union ordering, and type tests.
The main agent owns all caller migrations and the remaining project/declaration/resolve/lower stages.
One signed brand-creation exception may sit beside the TypeRef type when the constructor brands a newly allocated internal index.
All other casts need narrowing or an explicit validated boundary.

### Paused checkpoint

The user requested a pause on 2026-11-16.
All active executors stopped. No implementation may continue until the user resumes work.
The user also requested retained knowledge about the Light FP TypeScript subset for a later skill.
The handover preserves initial lessons, rejected approaches, evidence limits, and remaining caller migrations.
Handover: [docs/handoffs/2026-11-16-142752-light-fp-adoption.md](../handoffs/2026-11-16-142752-light-fp-adoption.md).
No commit, push, or merge occurred. The migration remains incomplete.

### Resumed checkpoint

The user resumed work on 2026-11-16. The pause is no longer active.
The live branch, HEAD, and dirty inventory match the parked work.
A fresh lint census reports 3,866 diagnostics. The type check reports 110 errors.
These counts describe this intermediate tree, not accepted compiler behavior.
Body checking and type interning resume with their existing ownership and new 30-turn limits.

LFA14 (resolution migration) owns only `src/core/resolve.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires zero owned lint, isolated type checks, and unchanged resolution diagnostics in focused public tests.
The main agent owns all callers outside that file and the remaining integration.

Implementation knowledge remains part of the objective.
The main agent will retain verified patterns, rejected approaches, and evidence limits in project documentation.
A later skill requires enough verified examples; no skill creation is claimed yet.

### Resumed integration progress

The refinement checker now exposes an owning capability and passes focused lint.
Main migrated external TypeTable construction, explicit type defaults, validator imports, and real walkExpr accumulators.
The second type check reports 36 errors during concurrent edits, down from 110.
The type executor reports zero owned lint, isolated type checks, and 67 runtime tests; main review remains open.

LFA15 (parser ownership and cost) owns `src/core/parse.ts` and the ValueBuffer section of `src/core/runtime.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
It must remove arbitrary State token passthrough and consume actual owning buffer returns.
Acceptance requires strict lint, type checks, exact fixture outputs, public parser tests, and measured paired timing.
The main agent owns other runtime additions and caller integration.
Native collection efficiency and the rejected parser approaches remain explicit review concerns.

### Review evidence and editor ownership

Main independently reran type-table and IR lint and isolated type checks.
The focused type, schema, and refinement tests pass: 73 tests, zero failures, with `--no-check`.
Review found a strict-boolean regression in schema conversion. A new public regression test failed before the correction and passes afterward.
The correction retains exact `true` semantics through type narrowing.
The module-interface and recursion-guard migrations now pass focused lint and isolated type checks.
The editor symbol cache moves from a global WeakMap into its owning Revision query.
This preserves memoization and lifetime without mutable global domain state. Final editor and revision tests remain pending.

LFA16 (lowering migration) owns only `src/core/lower.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires zero lint, isolated type checks, lowering tests, and exact emitted behavior.
Main owns caller changes outside the file.

### Lexer regressions and parser cost

The first integrated fast run reports 3,040 passing tests and 109 failures.
Many failures use the unfinished Program API. Others exposed lexer regressions.
A new public test reproduced plain `42` being treated as a duration.
The suffix check now requires a nonempty unit.
A second public test reproduced an unterminated quote ending beyond the source.
The bounded string scanner now checks the input end on each step.
The fixture-prefix oracle passes after that correction.
The full lexer snapshot still needs investigation; its expected data remains unchanged.

LFA18 (direct-array parser owner) owns `src/core/parse.ts` and removal of unused ValueBuffer primitives only.
A fresh Sol executor uses high effort and a 30-turn limit.
The existing owner-buffer candidate passes strict lint, types, parser tests, 190 whole fixtures, and the prefix oracle.
Eight paired samples measure original 35.77-40.43 ms and candidate 92.74-97.13 ms.
A simpler parser factory will own local native arrays and scalar variables.
It must expose actual owner or domain results and retain every strict rule.
The executor must preserve the current candidate until comparison identifies a winner.
No memory parity claim exists. Main owns all other caller and runtime changes.

### Verified subset lessons

The lexer snapshot now passes all 20,000 generated inputs with unchanged expected data.
The focused type and lexer run passes 94 tests with `--no-check`.
A third lexer regression test reproduced a line comment ending beyond the source.
The comment scanner now checks the input end on each step.
The TypeLowerer factory now passes strict lint; its integrated type and runtime checks remain open.
Main added public tests for strict boolean semantics in schema conversion and imported nominal declarations.
Both tests failed before correction and pass afterward.

LFA19 (declaration checking) owns only `src/core/check_declarations.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires zero lint, isolated type checks, public declaration diagnostics, and preserved recursion rules.
Main owns caller changes outside the file.
The TypeLowerer factory now returns an owning capability from report operations.
It requires the explicit related argument, which can be undefined.

Implementation notes now live in [docs/light-fp-subset.md](../light-fp-subset.md).
These working notes preserve verified patterns, counterexamples, and evidence limits for a possible later skill.
The existing regression tests carry the boolean and lexer lessons directly.
No separate solved-problem document or skill is needed for those tests.

### Body checking and project state

The body-checking executor finished 14 owned files with zero lint diagnostics.
Main review and the full shared gate remain open.
Family registries now use factories. Main owns the builtin row census caller update.

LFA20 (project and revision state) owns `src/core/db.ts` and `src/core/project.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires strict lint, isolated type checks, incremental and revision-isolation tests, and unchanged public diagnostics.
The Revision symbol-index cache must stay with its Revision owner.
Main owns callers, tests, and documentation outside those two files.

### Inference and shared checking

LFA21 (inference and shared checking) owns `src/core/infer_inputs.ts`, `src/core/infer_contracts.ts`, and `src/core/check_project.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires strict lint, isolated type checks, exact inferred contracts, and public inference/property tests.
Main owns caller migrations outside the three files.
The direct-array parser factory passes focused lint, types, 45 parser tests, 190 complete fixtures, and the prefix oracle.
Its final timing and memory evidence remain open.

### Playground pure modules

LFA22 (pure playground modules) owns `playground/src/compile.ts`, `playground/src/events.ts`, `playground/src/model.ts`, and `playground/src/highlight.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires strict lint, type checks, unchanged highlighting and compile/model behavior, and focused public tests.
Main owns all callers outside those files. These pure modules retain their strict layer.

### Fault-injection review and final review units

A read-only Sol review confirmed the old TypeTable prototype injection cannot affect factory-owned closure methods.
No deterministic public Program input reproduces that private check-stage fault.
Main retires that class-specific test. Expected behavior values remain unchanged in every retained test.
Public configuration recovery and differential update tests remain. They do not prove unexpected check-stage rollback.
Source review confirms candidate definitions and entries commit only after driveProject returns.
Counts, parse caches, input files, and shared append-only storage can advance before an unexpected check fault, as before.
This remains an explicit evidence limit. No testing-only production hook is added.

LFA23 (skeptical compiler review) reads the checking, inference, resolution, lowering, type, parser, and project diffs.
LFA24 (skeptical backend review) reads emitter, validator, primitive, and utility diffs.
Each read-only Sol reviewer uses high effort and a 20-turn limit.
Each reviewer must confirm a source trace or public reproducer before reporting a finding.
Main owns every repair, line review, and independent check.

### Confirmed final-review findings

The backend reviewer reproduced a stack overflow in span parent lookup at 20,000 nested records.
Main added a public regression test and observed RangeError before repair.
The reviewer also confirmed recursive prototype walking can overflow in the predicate guard.
Main will retain native inherited-property semantics through a small native primitive.
Emitter flag checks also changed exact true semantics into truthiness. Public regression cases will precede repair.
The emitter contains several ReturnType aliases that hide mutable maps. Main will use explicit native-owner return types.

LFA25 (lexer memory repair) owns only `src/core/lex.ts`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires strict lint, type checks, unchanged 20,000-input lexer snapshot and parse-prefix oracle, plus repeated memory samples.
The reviewer measured peak RSS for a 16 MiB line comment: base medians 64,094,208 and 64,053,248 bytes, candidate median 134,135,808 bytes.
Each group contains ten runs. Source-length scratch arrays cause the measured regression.
The repair must retain efficient dynamic native arrays or proportional growth without mutable data aliases or fake state.
Main owns all tests, callers, and other files.

LFA26 (emitter flag and owner-type repair) owns `src/core/emit/emit.ts`, `types.ts`, `module_state.ts`, `decls.ts`, and a focused public test file.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires failing public reproducers, exact original boolean behavior, explicit Map owner types, strict lint, types, and focused tests.

LFA27 (manual parser equivalence repair) owns `src/core/emit/tsc.ts`, `src/core/validate_project.ts`, `src/core/validate/builtins.ts`, and focused public regression tests.
A fresh Sol executor uses high effort and a 20-turn limit.
Acceptance requires failing public reproducers, original diagnostic and identity grammar behavior, strict lint, types, and focused tests.
The confirmed cases involve embedded severity markers, malformed identity prefixes, and line terminators in builtin identities.
Main retains ownership of native primitives, span lookup, predicate guards, validator flag-presence checks, and all integration.

### Final integration failures

The full gate passes 3,305 fast tests and 323 slow tests.
Two slow tests fail: the published IR copy and stale mutation records.

LFA28 (mutation register reconciliation) owns only `fixtures/mutation/survivors.json`.
A fresh Sol executor uses high effort and a 30-turn limit.
Acceptance requires exact current-site matches and source evidence for each rebased or retired row.
Existing classifications remain unless evidence requires a change. No new survivor receives acceptance without proof.
Main owns actual mutation runs after a checked candidate commit.

LFA29 (paired website IR) owns formatting of the top predicate declarations, the website-copy slow test, and the generated companion copy.
A fresh Sol executor uses high effort and a 20-turn limit.
The companion worktree is `/Users/srdjans/Code/effektive-light-fp-lint`, branch `lint/light-fp-ir-0.8.0`, from local website main.
Acceptance requires successful generation, standalone type checking, exact copy comparison, and unchanged compiler contracts.
An explicit test-only website-root override selects the companion worktree. The default sibling check remains.
Both original main checkouts remain untouched. Main owns integration checks and separate local commits.

### Integration evidence after review repairs

Strict lint reports zero diagnostics. Format checks pass across 633 files.
The supplemental layer and suppression audits pass.
Main compared all 497 behavior records against the original compiler with the same generated forged IR corpus.
Every record matches exactly. These records cover the named corpus only.

Browser checks pass for default compilation, diagnostic recovery, and file selection.
The agent-owned tab is closed. The user tab remains. Port 8790 has no listener after server cleanup.
Ignored witnesses are in `demos/light-fp-lint/autoqa/`.
The disabled logging route returned one HTTP 404. No compiler startup error appeared.

Main reviewed the paired website change and reran its three slow checks. All pass.
Review found that a missing explicit companion root skipped the checks.
The corrected override now fails for missing files. The default archive behavior remains.
The companion website passes 12 tests and 70 strict panel checks.
Both original main checkouts remain unchanged.

The repaired lexer uses output-proportional dynamic arrays and native comment searches.
Main's ten 16 MiB samples measure median peak RSS of 60,424,192 bytes against the original 65,658,880 bytes.
The lexer snapshot retains all 20,000 expected hashes.
Parser timing remains preliminary under unrelated host load. No performance parity claim exists.

### Mutation validation and final cleanup

The reconciled survivor register contains 156 rows. Main independently reran its census: one test passes.
The rebase retains every mapped classification and reason.
The eight retired sites no longer exist as mutation sites.
They are task-length guards, two indexed type comparisons, one schema-key comparison, one path-prefix guard, one graph loop, and one boolean return.
The ignored row ledger is `demos/light-fp-lint/mutation-register-rebase.md`.

The companion website commit is `ca14f82` on `lint/light-fp-ir-0.8.0`. Its worktree is clean.

LFA30 (final owner-query cleanup) owns only the open-state query in `src/core/emit/module_state.ts`.
Main will remove a redundant string argument and its always-true length condition.
The query must read the actual owner state directly. Existing public allocation and finalization tests cover its behavior.

LFA31 (mutation sweep) owns ignored run artifacts and a report of new survivors.
A fresh Sol executor uses high effort and a 20-turn limit.
It first validates one lexer mutation, then runs one seeded sample per changed runtime module with mutation sites.
The sweep excludes adapter files with no changed mutation site and type-only modules without sites.
Acceptance requires successful clean runs and a disposition for every sampled survivor.
The main agent owns survivor repairs, final checks, and final commits.
The sample does not exhaust the 12,800 mutation sites in the initial inventory.

### Reviewed syntax exceptions

All plugin rules remain enabled. No exclusion or baseline was added.
Seven signed `pure-module` line exceptions cover inert initialization.
Six exceptions initialize readonly lookup tables in `src/core/resolve.ts`: prelude names, builtin types, Effect errors, target names, shadowable values, and shadowable names.
One exception creates the private invariant Symbol in `src/core/source.ts`.
Main reviewed each initializer. These calls run no external effect and do not change their tables after initialization.
The supplemental suppression audit passes. Genuine adapter headers remain confined to edges, orchestration, and support modules.

### Parser performance evidence limit

A second main-agent run again matches all 190 complete parse results.
Eight paired samples of 1,000 tutorial parses measure original 40.51-50.59 ms and candidate 62.04-73.41 ms.
The full gate and unrelated processes ran during this measurement.
The sample consistently favors the original. It does not establish an isolated regression ratio.
No parser performance parity claim exists. This cost remains visible for user review.
Raw paired samples are in `demos/light-fp-lint/parser-final-main-samples.log`.

The planned mutation sweep covers 117 changed modules with mutation sites.
Four browser adapters have no changed supported mutation expression. Twelve source modules contain no mutation site.
The inventory and exact selected module list remain in ignored mutation artifacts.
