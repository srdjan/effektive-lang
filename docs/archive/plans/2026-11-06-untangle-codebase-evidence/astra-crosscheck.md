# Astra cross-check

Status: complete. All 208 items assigned to UNF1 through UNF22 have a verdict. No assigned item remains unchecked.

Counts: 163 CONFIRMED, 3 WRONG, and 42 OVERSTATED.
These counts describe claims, not the number of safe refactors.
The plan is not ready for execution. Several proposed removals change behavior, and several shared helpers would merge different policies.

The inspected snapshot is commit `614bb8013bb9c32e50c2924d2b7625e6764dc1b4` and uses Deno 2.9.8.
The snapshot does not contain `30bb1d5`, so its claimed relationship to that baseline cannot be established from local Git history.
This review checks the supplied source. It does not claim a completed baseline comparison or future output equivalence.

## Review method and evidence limits

The review followed the requested item, fix, kept-list, missed-problem, and unit-order checks.
Three read-only Sol delegates checked separate survey slices. The main reviewer reconciled their results against source and ran targeted probes.
The main reviewer corrected delegate classifications where the source supported only a narrower claim.
The allocation below records the review plan. No delegate edited a file.

| Review unit | Model | Files read | Acceptance check | Turn budget |
| --- | --- | --- | --- | --- |
| Frontend and checker claims | gpt-5.6-sol, high | Surveys A and B; cited source and tests | Every assigned A and B item has a verdict and source evidence | 50 tool calls |
| Builtins, program, and emitter claims | gpt-5.6-sol, high | Surveys C, D, and E; cited source and tests | Every assigned C, D, and E item has a verdict and source evidence | 65 tool calls |
| Validator, adapters, and harness claims | gpt-5.6-sol, high | Surveys F, G, and H; cited source and tests | Every assigned F, G, and H item has a verdict and source evidence | 65 tool calls |
| Integration review | Configured main model | Plan, architecture, source, tests, and returned evidence | Item coverage audit and all five requested sections complete | Main turn |

The main reviewer ran `deno test --allow-read tests/core_boundary_test.ts tests/emit_families_test.ts tests/site_ir_test.ts`.
All 12 selected tests passed. These tests check current boundaries and generator behavior, not any proposed implementation.

Read-only probes checked rename rejection, effect-set differences, diagnostic fields, reserved-error text, generator imports, rejection-site recognition, and source import cycles.
The review did not run the full gate, mutation, benchmark, browser, or website checks.
Only this report was written. No commit or production edit was made.

## Item verdicts

CONFIRMED means the stated link, duplication, or unused element exists. It does not mean deletion is safe or worthwhile.
OVERSTATED means part of the claim is true, but its scope, equivalence, or proposed consequence is unsupported.
WRONG means the material claim is false.
References below use repository-relative paths. The fix judgments preserve important distinctions omitted from short table notes.

| ID | verdict | note |
| --- | --- | --- |
| A.H3 | CONFIRMED | Reserved mappings repeat in `src/core/resolve.ts:137`, `src/core/check_expr.ts:995`, and `src/core/emit/expr.ts:383`. |
| A.H4 | CONFIRMED | `src/core/ids.ts:19` omits capability and local constructors. Templates remain at `src/core/resolve.ts:477`, `:552`, and `:833`. |
| A.H5 | CONFIRMED | `src/core/paths.ts:32` owns extensions; `src/core/project.ts:113`, `:288`, `:503`, and `:560` retest them. |
| A.H6 | CONFIRMED | Contextual lists differ at `src/core/parse.ts:71`, `src/core/editor_tokens.ts:54`, and `playground/src/highlight.ts:35`. Parser line 380 embeds a length bound. |
| A.H7 | CONFIRMED | `src/core/parse.ts:80` and `src/core/editor_tokens.ts:166` classify keywords by enum order. |
| A.H8 | CONFIRMED | `src/core/lex.ts:112` and `src/core/parse.ts:395` separately name `void` and `while`. |
| A.H9 | CONFIRMED | `src/core/resolve.ts:1043` recognizes `layer` by callee text before resolving its service argument. |
| A.H10 | CONFIRMED | `src/core/lower.ts:865` hashes canonical JSON into emitted identities. `src/core/util.ts:25` does not state the output contract. |
| A.H11 | CONFIRMED | `src/core/db.ts:398` and `:421` repeat the payload hash. `src/core/interface.ts:76` deliberately computes a different hash without spans. |
| A.H12 | CONFIRMED | Identifier grammar repeats at `src/core/lex.ts:218`, `src/core/editor_index.ts:124`, and `src/core/editor_completion.ts:114`. |
| A.H13 | OVERSTATED | `src/core/tables.ts:73` forces effect mode for nonempty sets. `src/core/modes.ts:47` does not. A live probe confirms different results. |
| A.H14 | OVERSTATED | The early check omits target names at `src/core/editor_rename.ts:104`. Lines 137-145 still reject `Math` with a different message. |
| A.N1 | CONFIRMED | `src/core/tables.ts:28` holds effect algebra beside builtin fact unions starting at line 94. |
| A.N3 | OVERSTATED | Generic helpers are public at `src/core/frontend.ts:46`. Adapter imports through that entry point follow the documented boundary. |
| A.N4 | CONFIRMED | `src/core/util.ts:4-44` combines ordering, sets, error text, record narrowing, and canonical JSON. `scripts/coverage.ts:104` copies record narrowing. |
| A.N5 | CONFIRMED | `src/core/project.ts:31-310` handles configuration. Lines 369-706 handle loading, linking, and module order. |
| A.S1 | CONFIRMED | `src/core/diagnostics.ts:20` permits warnings, but line 392 always creates error severity. Removing the field still changes output. |
| A.S3 | CONFIRMED | `src/core/parse.ts:47` exports the extension-based mode rule. Its external caller is `tests/parse_test.ts:348`. |
| A.S6 | CONFIRMED | The keyword enum, `src/core/lex.ts:89` map, and `src/core/parse.ts:80` classifier maintain separate representations. |
| A.X1 | CONFIRMED | Option names are special at `src/core/resolve.ts:629`, `:747`, and `src/core/check_patterns.ts:230`, among other sites. |
| A.X2 | CONFIRMED | `src/core/resolve.ts:1043` directly compares the callee text with `layer`. |
| A.X3 | CONFIRMED | `src/core/resolve.ts:954-969` skips the `never` sentinel in clauses. Builtin row consolidation does not remove this rule. |
| A.X4 | CONFIRMED | `src/core/check_expr.ts:2677` recognizes `Defect` by source text instead of the ordinary target path. |
| A.X5 | CONFIRMED | `playground/src/highlight.ts:185-205` repeats declaration-position logic. Shared word lists alone do not remove that logic. |
| A.X6 | CONFIRMED | `src/core/lex.ts:112` leaves two reserved words for separate parser handling at `src/core/parse.ts:395`. |
| A.X7 | OVERSTATED | Similar character classes exist, but `src/core/project.ts:98-113` validates glob segments and lines 374-378 validate complete paths. Their predicates differ intentionally. |
| B.H1 | CONFIRMED | Nominal tests repeat at `src/core/patterns.ts:114`, `src/core/check_expr.ts:2580`, and `src/core/types.ts:1405`. |
| B.H2 | OVERSTATED | `src/core/check_expr.ts:1601`, `src/core/types.ts:1316`, and `src/core/check_declarations.ts:217` intentionally accept different record-bearing types. |
| B.H3 | CONFIRMED | Tag-through-alias walks repeat at `src/core/check_declarations.ts:696` and `src/core/types.ts:917`. |
| B.H4 | CONFIRMED | `guardedRecord` lives at `src/core/types.ts:64`; group recursion checks live at `src/core/type_lower.ts:765`. |
| B.H5 | CONFIRMED | The reserved-error triple repeats at `src/core/resolve.ts:137`, `src/core/check_expr.ts:995`, and `src/core/types.ts:428`, `:1312`. |
| B.H6 | CONFIRMED | Checked-input effects pass through separate assembly paths at `src/core/signatures.ts:246-317` and `src/core/check_expr.ts:2949-3020`. |
| B.H7 | CONFIRMED | `src/core/resolve.ts:1316` and `src/core/check_expr.ts:2677` each recognize `Defect`; lowering reads its checked fact. |
| B.H8 | CONFIRMED | Raw modifier checks remain at `src/core/declaration_index.ts:141`, `src/core/check_declarations.ts:306`, and `src/core/type_lower.ts:425`, `:669`. |
| B.H9 | CONFIRMED | Header extraction repeats at `src/core/check_expr.ts:2208`, `src/core/check_declarations.ts:779`, `:934`, and `src/core/type_lower.ts:431`. |
| B.H10 | CONFIRMED | Field syntax is decoded separately at `src/core/check_expr.ts:1564`, `src/core/infer_inputs.ts:296`, and `src/core/resolve.ts:1121`. |
| B.H11 | OVERSTATED | `src/core/check_expr.ts:683`, `:1862`, and `src/core/infer_inputs.ts:239` use different local, capability, and recovery information. |
| B.H12 | OVERSTATED | Primitive fitting repeats, but `src/core/check_expr.ts:1487-1505` validates positive concurrency configuration rather than primitive compatibility. |
| B.H14 | CONFIRMED | Arithmetic sets repeat at `src/core/check_expr.ts:2186`, `src/core/infer_inputs.ts:449`, and `src/core/check_binary.ts:164`, `:208`, `:297`. |
| B.H15 | CONFIRMED | `src/core/infer_inputs.ts:203-235` and `src/core/check_expr.ts:590-620` duplicate decoders within intentionally separate traversals. |
| B.H16 | CONFIRMED | Local templates repeat at `src/core/check_expr.ts:2489`, `:2811`, and `src/core/lower.ts:404`, `:518`. |
| B.H17 | CONFIRMED | Capability templates repeat at `src/core/resolve.ts:477`, `:833`, and `src/core/check_declarations.ts:824`. |
| B.H19 | OVERSTATED | `src/core/types.ts:261-279` contains only imported types and errors. `src/core/signatures.ts:50-54` also includes services. |
| B.H21 | CONFIRMED | Function types are assembled at `src/core/signatures.ts:284`, `src/core/check_declarations.ts:1100`, and `src/core/check_expr.ts:3012`. |
| B.N1 | CONFIRMED | `src/core/infer_inputs.ts:8` imports `BodyEnv`; `src/core/check_expr.ts:130` imports inference back. |
| B.N2 | CONFIRMED | `src/core/types.ts:906-968` owns IR graph loading. Imports at `types.ts:28` and `type_ir.ts:5` form another type-only cycle. |
| B.N3 | CONFIRMED | `src/core/type_lower.ts:759-838` combines IR field handling with declaration recursion checks. |
| B.N7 | CONFIRMED | `src/core/check_binary.ts:149-235` hard-codes unit arithmetic. `src/core/patterns.ts:161` has another duration rule. |
| B.N8 | CONFIRMED | `src/core/type_show.ts:54-56` extracts a reserved unit name by slicing the identity. |
| B.S1 | CONFIRMED | `src/core/signatures.ts:233` exports `executionOf`; only `tests/check_test.ts` calls it. |
| B.S2 | CONFIRMED | `src/core/check_expr.ts:1215-1233` has a separate one-row table for `Some`. |
| B.S3 | CONFIRMED | `src/core/check_expr.ts:1152-1167` handles `None` and forwards the remaining prelude names. |
| B.S5 | CONFIRMED | `src/core/type_show.ts:128` uses `idName`; line 145 onward uses `shortName`. Live output differs for SchemaError. |
| B.S8 | CONFIRMED | Primitive classification repeats at `src/core/check_declarations.ts:265` and `src/core/type_lower.ts:223`. |
| B.X1 | CONFIRMED | `src/core/check_expr.ts:989-1010` special-cases the reserved-error set and its display names. |
| B.X2 | CONFIRMED | Option names remain in `src/core/check_expr.ts:702`, `:1158`, `src/core/check_patterns.ts:206`, `:230`, and `src/core/infer_inputs.ts:346`, `:414`. |
| B.X3 | CONFIRMED | `src/core/check_expr.ts:2677-2737` carries the separate Defect rule through checking and fact construction. |
| B.X4 | CONFIRMED | `src/core/check_expr.ts:2949-3020` mixes checked-input eligibility, diagnostics, effects, and function construction. |
| B.X6 | CONFIRMED | Unit arithmetic precedes general class arithmetic at `src/core/check_binary.ts:164-235`, `:297-310`. Its distinct semantics remain necessary. |
| B.X7 | CONFIRMED | `src/core/types.ts:428-438` seeds reserved declarations, including two literal error IDs. |
| B.X8 | CONFIRMED | `src/core/check_expr.ts:2677` tests Defect text; `src/core/check_declarations.ts:306` recognizes opaque through a regular expression. |
| B.X9 | CONFIRMED | `src/core/type_lower.ts:239-252` repeats the Duration and Instant row bodies. |
| B.X10 | CONFIRMED | `src/core/infer_inputs.ts:446-451` and `src/core/check_expr.ts:2186-2190` independently gate arithmetic context. |
| C.H1 | CONFIRMED | `src/core/check_builtins/rows.ts:28-32` constrains a repeated kind. Rows still write that kind at `src/core/check_builtins/ref.ts:62-76`. |
| C.H2 | CONFIRMED | Collection arities repeat at `src/core/check_builtins/collections.ts:340`, `src/core/lower.ts:214`, and `src/core/emit/expr.ts:1203`, `:1626`. |
| C.H3 | CONFIRMED | Builtin names cross call IR through string identities: `src/core/ids.ts:47-62`, `src/core/lower.ts:864`, and `src/core/emit/expr.ts:393`. |
| C.H4 | CONFIRMED | Schema operations repeat in `src/core/ir.ts:202`, `src/core/tables.ts:185`, and `src/core/check_builtins/schema.ts:106`, `:1321`. |
| C.H5 | CONFIRMED | `src/core/check_builtins/schema.ts:313-375` checks `on`; `src/core/lower.ts:1048-1082` decodes it again. |
| C.H6 | CONFIRMED | Option shapes repeat in `src/core/check_builtins/effect.ts:126`, `:507`, `:709` and `src/core/lower.ts:825-848`. |
| C.H7 | CONFIRMED | `src/core/emit/shape.ts:48`, `src/core/emit/calls.ts:38`, and `src/core/emit/expr.ts:1615` maintain separate routing lists. |
| C.N1 | CONFIRMED | `src/core/check_builtins/ref.ts:9-58` and `src/core/check_builtins/collections.ts:163-282` dispatch on names after selecting rows. |
| C.N3 | CONFIRMED | `src/core/check_expr.ts:1487-1505` owns concurrency parsing used through collection and stream contexts. |
| C.N4 | CONFIRMED | `src/core/check_builtins/effect.ts:33` imports `effectArrayMember` from the collections family. |
| C.N5 | CONFIRMED | `src/core/emit/families/effect.ts:1` names only a subset of the operations that the file now emits. |
| C.S1 | CONFIRMED | `src/core/check_builtins/registry.ts:19`, `:34` exports test-facing registry views used by `tests/builtin_rows_test.ts`. |
| C.S2 | CONFIRMED | `src/core/check_builtins/schema.ts:1321-1347` repeats the same row construction for 16 operations. |
| C.S3 | WRONG | `src/core/check_builtins/stream.ts:76-83` passes `mapEffect` to `concurrencyBound`. The operation type is not wider than its use. |
| C.S4 | CONFIRMED | `src/core/ir.ts:31-39` lists source levels; `src/core/emit/families/effect.ts:114-122` separately maps target spellings. |
| C.X1 | CONFIRMED | `src/core/check_builtins/registry.ts:15-21` and `src/core/check_expr.ts:1215-1233` create the separate Some path. |
| C.X2 | CONFIRMED | Own-arity rows bypass the common prologue at `src/core/check_expr.ts:1217-1220`; handlers such as `check_builtins/effect.ts:739` supply their own checks. |
| C.X3 | CONFIRMED | `src/core/check_builtins/schema.ts:1294-1309` has a separate schemaDefaultKey branch. The row-generation change alone does not remove its semantics. |
| C.X4 | CONFIRMED | `src/core/emit/families/effect.ts:124-137` handles now and random before requesting an Effect import. This placement preserves emitted imports. |
| C.X5 | CONFIRMED | `src/core/emit/expr.ts:1733-1741` selects the effectful update-ref operation after callback analysis. |
| D.H1 | CONFIRMED | `src/core/check_refinements.ts:593-623` and `src/core/predicates.ts:134-173` separately convert comparison operators to bounds. |
| D.H2 | CONFIRMED | Difference-shape recognition repeats at `src/core/check_refinements.ts:566-590` and `src/core/predicate_source.ts:153-176`. |
| D.H3 | OVERSTATED | Linear structures and merging repeat at `src/core/check_refinements.ts:30`, `:508` and `src/core/predicate_source.ts:32`, `:368`. Their key formats stay in separate maps. |
| D.H4 | OVERSTATED | `src/core/predicates.ts:87-118` folds constants. `src/core/check_refinements.ts:626-664` sorts and flattens but does not apply identical or-folding. |
| D.H5 | CONFIRMED | Project loops repeat at `src/core/db.ts:339-435` and `src/core/check_project.ts:780-811`. |
| D.H6 | CONFIRMED | `src/core/db.ts:404-424` rebuilds the interface and checked fields also owned by `src/core/check_project.ts:751-766`. |
| D.H7 | CONFIRMED | `src/core/check_project.ts:751-752` builds a graph; `src/core/interface.ts:297` builds it again. |
| D.H8 | CONFIRMED | Initialization edge construction repeats at `src/core/check_project.ts:525-549` and `src/core/initialization.ts:31-84`. |
| D.H9 | OVERSTATED | `src/core/check_declarations.ts:817` constructs types; `src/core/check_project.ts:273` handles imported fallback. `src/core/editor.ts:209` only locates spans. |
| D.H10 | CONFIRMED | Pipeline argument order appears at `src/core/requirement_provenance.ts:132`, `src/core/check_expr.ts:1510`, and `src/core/lower.ts:603`, `:916`. |
| D.H11 | CONFIRMED | `src/core/lower.ts:1764` writes version 8, matching the literal type at `src/core/ir.ts:323`. Type checking already constrains equality. |
| D.H12 | CONFIRMED | Prelude and host labels repeat at `src/core/lower.ts:1592`, `src/core/emit/module_state.ts:358-393`, and `src/core/project.ts:117`, `:149`. |
| D.H16 | CONFIRMED | `src/core/interface.ts:12-14` names `reachableModules` for both drivers; `src/core/db.ts:358` instead calls `reachedModules`. |
| D.N1 | CONFIRMED | `src/core/check_project.ts:258-674` combines environments, scheduling, initialization, and service-bound diagnostics. |
| D.N2 | CONFIRMED | `src/core/db.ts:40`, `:362` imports the solver version solely for an in-memory memo key. |
| D.N3 | OVERSTATED | `src/core/db.ts:404-424` does know checked-module fields. Its Revision constructor has eight arguments at lines 134-148, not seven. |
| D.N4 | CONFIRMED | `src/core/lower.ts:1649-1665` constructs a lookup object solely to reconstruct a function type. |
| D.N5 | CONFIRMED | `src/core/lower.ts:1734-1745` filters project diagnostics to decide whether module lowering can proceed. |
| D.N6 | CONFIRMED | `src/core/lower.ts:1507-1582` reads project links and merges service imports. |
| D.N7 | CONFIRMED | `src/core/typescript.ts:156-188` constructs emitter state and catches its private failure for backend hover text. |
| D.N8 | CONFIRMED | `src/core/predicates.ts:1` imports Result from IR, while `src/core/ir.ts:1` imports predicate types. |
| D.S2 | OVERSTATED | No product caller uses the listed decoders. However, `docs/api.md:489-501` documents them, and `src/core/typescript.ts:209-228` exposes them. |
| D.S4 | CONFIRMED | `src/core/predicates.ts:3` defines the version; `src/core/db.ts:362` uses it only in a cache that cannot survive code reload. |
| D.S5 | CONFIRMED | `src/core/check_project.ts:716-723` and `src/core/check_refinements.ts:59-67` both create a default proof budget. |
| D.X1 | CONFIRMED | `src/core/lower.ts:1771-1775` applies the companion-file export rule. |
| D.X2 | CONFIRMED | `src/core/lower.ts:1513-1519`, `:1556-1581` merges service imports that share labels. |
| D.X3 | CONFIRMED | `src/core/lower.ts:1585-1603` reads builtin instances collected during declaration lowering at lines 1757-1769. |
| D.X4 | CONFIRMED | `src/core/lower.ts:1649-1665` chooses between two function-type reconstruction routes. |
| D.X5 | CONFIRMED | `src/core/lower.ts:131-141`, `:404-409` scans identifiers to avoid generated binding collisions. The protection remains necessary. |
| D.X6 | CONFIRMED | Broken-entry checks occur at `src/core/check_project.ts:297-305` and `:419-423`, protecting different publication stages. |
| D.X7 | CONFIRMED | `src/core/check_project.ts:438-480`, `:501-520`, and `:645-672` builds several diagnostic families inline. |
| E.H1 | CONFIRMED | `src/core/emit/emit.ts:137-170` depends on allocation before import reads. `module_state.ts:490-539` records names on use. |
| E.H2 | CONFIRMED | `src/core/emit/decls.ts:1039-1065` marks names; `emit.ts:190-204` joins marks to hosts; `spans.ts:82-85` converts records. |
| E.H3 | OVERSTATED | `src/core/emit/fields.ts:7`, `expr.ts:898`, and `decls.ts:575` handle key syntax, shorthand, and Error-instance repair respectively. |
| E.H4 | CONFIRMED | Reserved IDs repeat in `src/core/emit/module_state.ts:630`, `expr.ts:383`, `:1421`, `:1822`, and `families/schema.ts:129`, `:154`, `:351`. |
| E.H5 | CONFIRMED | `src/core/emit/shape.ts:48-180`, `calls.ts:70-92`, and family unions do not derive their leaf-kind membership from one owner. |
| E.H6 | CONFIRMED | Extension and import-label tests repeat at `src/core/emit/emit.ts:176` and `src/core/emit/module_state.ts:358-393`. |
| E.H7 | OVERSTATED | The callback helpers differ intentionally. Successful Schema callbacks require inline arrows at `src/core/check_builtins/schema.ts:711`, `:870`, `:1021`, `:1131`. |
| E.H8 | OVERSTATED | Recursive predicates occur at `src/core/emit/module_state.ts:606`, `decls.ts:855`, and `fields.ts:33`. `types.ts:159` is shallow; its printers lack these alias walks. |
| E.N1 | CONFIRMED | `src/core/typescript.ts:156-188` reaches naming state and declaration printers for hover. |
| E.N2 | CONFIRMED | `src/core/typescript.ts:19`, `:169-186` exposes EmitFailure handling outside the emitter's Result boundary. |
| E.N3 | CONFIRMED | `src/core/emit/module_state.ts:53`, `:113`, `:149`, and `:282` mix deferred types, IDs, paths, allocation, and import state. |
| E.N4 | CONFIRMED | `src/core/emit/module_state.ts:113-146` wraps ID parsers; expression code imports those wrappers through the state module. Preserve malformed-ID errors. |
| E.N5 | CONFIRMED | `src/core/emit/spans.ts:14` imports emitted data types from their producer, `emit.ts`. This dependency is type-only. |
| E.N6 | CONFIRMED | `src/core/emit/families/context.ts:13-34` exposes flags used in selected combinations by `src/core/emit/families/scope.ts:14`, `:47`. |
| E.S1 | CONFIRMED | `src/core/emit/emitted.ts:181` exports `concurrencyText`; its only caller is in the same file at line 191. |
| E.S2 | OVERSTATED | Decoder product callers are absent, but `docs/api.md:489-501` defines the public API. `encodeVlq` also serves production encoding at `sourcemap.ts:173`, `:189`. |
| E.S3 | CONFIRMED | `src/core/emit/emit.ts:73-84` and `:158-160` repeat import-alias formatting. |
| E.S4 | CONFIRMED | `src/core/emit/outcome.ts` holds one helper declaration; peer declarations remain in `src/core/emit/decls.ts:727-807`. |
| E.X1 | CONFIRMED | `src/core/emit/expr.ts:383-386` shortens two reserved error tags; ordinary tags remain qualified. |
| E.X2 | CONFIRMED | SchemaIssue has distinct recognition and catch paths at `src/core/emit/expr.ts:1421`, `:1822` and `families/schema.ts:129`. |
| E.X3 | CONFIRMED | `src/core/emit/emit.ts:174-179` adds a module marker only for an otherwise empty companion module. |
| E.X4 | CONFIRMED | `src/core/emit/module_state.ts:378-381`, `:646-650` activates companion imports lazily. |
| E.X5 | CONFIRMED | `src/core/emit/fields.ts:15-18` lists Error-like members. `decls.ts:575-613` and `expr.ts:971-997` apply that rule. |
| F.H1 | CONFIRMED | Reserved-error tests repeat at `src/core/validate/typing.ts:166`, `:609`, and `src/core/validate/expr.ts:1171`. |
| F.H2 | CONFIRMED | `src/core/validate/world.ts:108-135` seeds literal SchemaError and SchemaIssue IDs beside imported constants. |
| F.H3 | CONFIRMED | `src/core/validate/world.ts:117`, `:128`, `:135`, `:143`, and `:151` repeat the synthetic span. The index fallback has a different source policy. |
| F.H4 | OVERSTATED | `src/core/validate/world.ts:335` and `:506` report depth. Walkers at lines 898 and 943 stop silently; recursion reports differently. |
| F.H5 | OVERSTATED | Alias walks at `src/core/validate/typing.ts:747`, `world.ts:462`, `expr.ts:150`, and `refinements.ts:557` answer different questions. Cycle results cannot be unified blindly. |
| F.H6 | CONFIRMED | `src/core/validate/serialization.ts:13-15` and `src/core/validate/predicates.ts:298-300` have identical record predicates. |
| F.H7 | CONFIRMED | Default sorts at `src/core/validate/families/layer.ts:67` and `typing.ts:665` match the explicit string comparator at `sets.ts:6`. No current ordering defect exists. |
| F.H8 | OVERSTATED | `src/core/validate/expr.ts:334-361` has a non-exhaustive default, but most kinds need no recursive raw marking. Missing future handling remains possible. |
| F.N1 | CONFIRMED | `src/core/validate/refinements.ts:22` imports Ctx from world; `src/core/validate/world.ts:46` imports refinements. |
| F.N2 | CONFIRMED | `src/core/validate/world.ts:70`, `:229`, `:542`, `:776`, and `:1106` start separate lookup and check groups. |
| F.N3 | OVERSTATED | Core result types live at `src/core/validate/families/context.ts:54-71`. However, streamState also serves `src/core/validate/families/ref.ts:27`. |
| F.N4 | CONFIRMED | `src/core/validate/families/context.ts:48` owns EFFECT_ONLY apart from QUIET and the algebra at `src/core/validate/sets.ts:36`. |
| F.N5 | OVERSTATED | Concurrency checks share a positive-integer rule. `src/core/validate/expr.ts:143` and `builtins.ts:88-106` nevertheless validate distinct numeric, type, and expression contracts. |
| F.N7 | CONFIRMED | `src/core/validate/sets.ts:101-102` includes message formatting alongside set operations. The extraction has low impact. |
| F.S2 | CONFIRMED | `src/core/validate/families/context.ts:20` derives Area from a method parameter; `src/core/validate/report.ts:20` already defines AreaCode. |
| F.X1 | CONFIRMED | `src/core/validate/world.ts:108-151` individually seeds five prelude declarations. The validator must retain its own seed policy. |
| F.X2 | OVERSTATED | `src/core/validate/expr.ts:1394-1415` checks different arguments of traverse and all. The checks are not duplicate validation of one argument. |
| G.H1 | CONFIRMED | The stale-result transition repeats at `src/lsp/features.ts:269-285` and `playground/src/compile.ts:132-165`. Their state lifecycles differ. |
| G.H2 | CONFIRMED | Backend-unavailable text repeats at `src/lsp/features.ts:165` and `playground/src/compile.ts:84-86`. |
| G.H3 | CONFIRMED | The saving-label rule repeats at `playground/src/app.ts:461-462` and `scripts/logs_replay.ts:490-492`. |
| G.H4 | CONFIRMED | `src/host/log.ts:208` and `playground/serve.ts:58` build filenames. `playground/log_endpoint.ts:31-35` parses fixed offsets. |
| G.H5 | CONFIRMED | Writers and readers repeat untyped kinds and fields at `src/cli/session.ts:80-160`, `src/lsp/wire_log.ts:60`, and `scripts/logs_replay.ts:213-253`. |
| G.H6 | CONFIRMED | `playground/log_endpoint.ts:38-56` narrows and rebuilds the envelope defined at `src/host/log.ts:12-25`. Its input boundary is stricter. |
| G.H7 | CONFIRMED | Log opening repeats at `src/host/deno_io.ts:238-244` and `src/lsp/main.ts:30-37`. The LSP does not use HostIo.openLog. |
| G.H8 | CONFIRMED | `src/lsp/projects.ts:243-260` reconstructs reasons for policy decisions at `src/host/outputs.ts:58-75`. |
| G.H9 | CONFIRMED | Disk read-diff-update loops repeat at `src/cli/session.ts:89-123` and `src/lsp/projects.ts:446-475`. |
| G.H10 | OVERSTATED | `src/core/editor.ts:215-235` and `src/core/editor_index.ts:46-60` repeat target-to-span mapping, but currently agree for all target kinds. |
| G.H11 | OVERSTATED | `src/core/editor_index.ts:180-187` implements the two-pass occurrence rule. Completion and signature queries use context-specific boundaries, not interchangeable node selection. |
| G.H12 | OVERSTATED | `src/core/editor_rename.ts:62-89` moves symbols. `src/core/diagnostic_delta.ts:20-33` uses deliberate endpoint rules for diagnostics and empty edits. |
| G.H13 | OVERSTATED | Rename and actions speculate; `src/cli/fix.ts:28-47` iterates accepted actions. A common revision constructor cannot replace their acceptance policies. |
| G.H14 | OVERSTATED | Both checks concern freshness, but `src/lsp/features.ts:107-128` checks one file. Lines 387-409 check configuration and all sources before multi-file edits. |
| G.H16 | CONFIRMED | `editors/vscode/extension.js:41-49` copies `src/core/paths.ts:38-40`. Existing example tests do not compare the two implementations directly. |
| G.H17 | CONFIRMED | `scripts/logs_replay.ts:241-242` knows which CLI flags to strip or replace during replay. |
| G.H18 | CONFIRMED | Extension knowledge repeats at `src/lsp/features.ts:294`, `src/host/workspace.ts:24`, `playground/src/app.ts:349`, and `editors/vscode/extension.js:157`. |
| G.N1 | CONFIRMED | `src/lsp/features.ts:63` imports server types; `src/lsp/server.ts` imports feature handlers. One edge is type-only. |
| G.N2 | CONFIRMED | `src/host/io.ts:7` and `src/host/log.ts:7` import each other's port types. |
| G.N3 | CONFIRMED | `src/cli/session.ts:142-150` rereads newly written output to obtain logged size and hash. |
| G.N4 | OVERSTATED | Product callers pass write=true, but `src/host/save_round.ts:20-40` also carries meaningful removal and ownership policies. They are not merely caller markers. |
| G.N5 | OVERSTATED | `src/cli/main.ts:60-100` and `src/lsp/projects.ts:489-492` intentionally present removals in different orders. A shared ordering would change output. |
| G.N6 | CONFIRMED | `src/lsp/projects.ts:521-523` wraps one ownership call and has two local callers. Removing the wrapper is optional. |
| G.N7 | OVERSTATED | `src/cli/format.ts:20-35` uses one-based positions; LSP conversion at `src/lsp/positions.ts` uses protocol clamping. The cache duplication is separable. |
| G.N8 | CONFIRMED | `src/lsp/features.ts:254-325` owns stateful generated-text subscriptions beside stateless handlers. |
| G.S1 | WRONG | Exported withParams has external callers in `tests/lsp_server_test.ts:225` and `:883`. It is not a same-file-only export. |
| G.S2 | CONFIRMED | `playground/log_endpoint.ts:15` exports MAX_ENVELOPES with no external user. Its ALLOWED_ORIGIN sibling has a test user. |
| G.S3 | CONFIRMED | Product save calls use write mode. The false output path is exercised directly at `tests/outputs_generation_test.ts:248-250`. |
| G.S4 | CONFIRMED | `src/core/editor_actions.ts:235-240` ignores `_end`; `src/lsp/features.ts:628` passes it. Removing the parameter requires caller updates. |
| G.S5 | CONFIRMED | `src/lsp/projects.ts:109-111` exposes diskProgram only to `tests/lsp_save_round_test.ts:409`. |
| G.S6 | OVERSTATED | The flag is specialized, but `src/cli/session.ts:96-108` uses it for production watch --tsc host changes. It is not test surplus. |
| G.X1 | CONFIRMED | `playground/src/model.ts:157-162` compares backend display text to determine its presentation kind. |
| G.X2 | OVERSTATED | `playground/src/app.ts:349`, `:461`, and `scripts/logs_replay.ts:490` share a path predicate but apply different UI policies. |
| G.X6 | CONFIRMED | `src/core/editor_index.ts:172-174` uses locale ordering. Replacing it changes public occurrences and can affect rename failure order. |
| G.X7 | CONFIRMED | `src/core/editor_tokens.ts:54-67` and `playground/src/highlight.ts:168-205` use separate contextual classifications. Their policies intentionally differ. |
| G.X8 | OVERSTATED | `src/core/editor_actions.ts:90`, `:242` and other queries repeat extensions, but companion files intentionally support different operations. |
| H.H1 | OVERSTATED | Suite arguments share a base at `deno.json:17`, `scripts/coverage.ts:622`, `rules_unfired.ts:104`, and `mutate.ts:517`. Coverage and mutation add different flags. |
| H.H2 | WRONG | `scripts/coverage.ts:26-32` groups reports. Lines 250-264 discover production roots. The manifest assigns paths; these are not three identical root lists. |
| H.H3 | CONFIRMED | `bench/m5_variants.ts:30` and `deno.json:63` separately pin TypeScript 5.9.3 without a connecting version test. |
| H.H4 | OVERSTATED | Effect literals repeat at `bench/ref_update.ts:7-9`, but `tests/versions_test.ts:50-63` already guards all three imports. `bench/m5.ts:195` remains separate. |
| H.H6 | CONFIRMED | `scripts/golden_update.ts:26-41` embeds the second IR baseline source rather than reading a named source fixture. |
| H.H7 | CONFIRMED | Pair alternation repeats at `bench/m1.ts:101`, `m2.ts:419`, `m4.ts:179`, `m5.ts:134`, `m5_variants.ts:293`, and `m7.ts:183`, `:245`. |
| H.H8 | OVERSTATED | `bench/m1.ts:35-41` and `bench/m3.ts:21-25` share input and steps. M1 also has warmups; their full configuration types differ. |
| H.H9 | OVERSTATED | Two timeout values exist. `bench/profile.ts:131` sets benchmark policy; `bench/lsp_client.ts:26` supplies a generic fallback. Equal values do not establish required coupling. |
| H.N1 | CONFIRMED | Public names use private imports at `bench/m1.ts:16`, `bench/m3.ts:10`, and `scripts/validate_fixtures.ts:9-10`. Stage-timing imports need separate treatment. |
| H.N5 | OVERSTATED | `scripts/measure.ts:34-60` measures top-level functions including nested bodies. `scripts/measure_functions.ts:18-41` tracks nesting and excludes inner bodies. |
| H.S1 | CONFIRMED | Process setup repeats at `scripts/coverage.ts:576`, `scripts/mutate.ts:529`, and `scripts/package.ts:25`. Timeouts and return contracts differ. |
| H.S2 | CONFIRMED | Archive extraction repeats at `scripts/behavior_compare.ts:302-320` and `scripts/mutate.ts:578-601`, with different revision and copy policies. |
| H.S3 | CONFIRMED | Temporary-directory lifecycles repeat at `scripts/coverage.ts:618`, `scripts/mutate.ts:678`, `scripts/test_slow.ts:11`, and benchmark scripts. |
| H.S4 | CONFIRMED | Root calculation repeats at `scripts/coverage.ts:25`, `scripts/behavior_compare.ts:282`, `scripts/package.ts:6`, and `bench/lsp_client.ts:25`. |
| H.S5 | OVERSTATED | Pretty writers match at `scripts/golden_update.ts:44`, `surface_update.ts:16`, and `lex_snapshot.ts:108`. Canonical validator and behavior serializers have different contracts. |
| H.S6 | OVERSTATED | `scripts/site_ir.ts:19-21`, `:82-84` uses text/blocks/message, not generic value/error. `scripts/behavior_corpus.ts:47-49` intentionally stays standalone. |
| H.S7 | OVERSTATED | Ordinary scripts repeat error formatting, but `scripts/behavior_corpus.ts:7-9` must remain independent of compiler imports during old-tree comparison. |
| H.S11 | CONFIRMED | Listed exports have no external caller. Examples: `scripts/behavior_compare.ts:142`, `scripts/coverage.ts:473`, and `bench/m5_target.ts:65`. Full-tree searches confirm the complete list. |

## Fix judgments

Each judgment covers removal, output compatibility, layering, and the smaller useful change.
Structural feasibility does not prove byte identity. The proposed implementations do not exist in this snapshot.

### UNF1 (reserved names, identities, and source paths)

Revise the scope. Constructors and path predicates remove repeated encodings. They do not remove the distinct policies that use those encodings.
The emitter still needs different treatment for SchemaIssue, companion modules, and host imports.
`ids.ts:108` already provides `shortName`; the emitter must preserve qualified tags for ordinary errors.

The rename change can alter LSP error text. `editor_rename.ts:104` rejects builtin names early, while lines 137-145 reject target names after speculation.
A live rename to `Math` already fails. A shared boolean must not merge these two error messages.

Adding executable predicates to `ir.ts` expands its documented role as a contract with eight shared values.
The validator must retain its independent reserved-error rule. Emitter code must not import the resolver to reuse its name policy.
Adapters must receive path helpers through public entry points. The validator, standalone corpus runner, and JavaScript client need explicit exceptions.

The smaller change keeps contract constants in `ir.ts`, constructors in `ids.ts`, and path parsing in `paths.ts`.
Source-name policy stays in the resolver. The website generator needs a separate check for every change to `ir.ts`.

### UNF2 (lexical vocabulary)

The shared vocabulary removes real maintenance links. It does not justify making every consumer classify words identically.
The parser uses contextual words as identifiers in some positions. The playground uses positional highlighting, while semantic tokens use resolved context.
Preserve these policies, keyword numeric values, token spans, recovery behavior, and diagnostic messages.

Parser marks can remove repeated modifier decoding. Their representation and recovery defaults need explicit design before execution.
The smaller change exports vocabulary and classification helpers first. Modifier marks can follow as a separate unit.
The playground must import the helpers through `frontend.ts`; it must not import `lex.ts` directly.

### UNF3 (shared types and import cycles)

Moving handler types, host ports, and `BodyEnv` removes the stated type-only cycles.
Moving `TypeTable.load` separates imported graph construction from interning, provided registration order and existing-definition precedence remain unchanged.
These moves can preserve runtime output.

Moving `Span` and `Result` out of `ir.ts` breaks the current standalone publication mechanism.
`scripts/site_ir.ts:87-98` strips exactly one import and copies the remaining IR source verbatim.
The generator either rejects an inserted first import or retains a later relative import in the supposedly standalone output.
Re-exports alone do not solve this problem.

The cycle claim is also incomplete. `types.ts:28` imports `type_ir.ts`, which imports table types at `type_ir.ts:5`.
Moving `load` does not remove that cycle. The acceptance condition must distinguish value cycles from type-only cycles.
`BodyEnv` also contains `ProofBudget`, which lives in `check_refinements.ts:26-28`.
Moving that environment directly into `signatures.ts` adds a dependency from signatures to checker code.
The environment and budget data need a leaf owner.
The smaller change moves only the types needed to break selected cycles, with public re-exports and generator support in the same unit.
Validator imports must remain within their existing allowlist.

### UNF4 (effect-set algebra)

The sorted-set union can be shared, but the mode rules are not identical.
`modes.ts:45-50` derives mode from input modes. `tables.ts:55-74` also makes nonempty effect sets force effect mode.
A live probe with pure mode and a failure produces pure mode from the solver and effect mode from `combine`.
The plan needs a proven input invariant or distinct wrappers. A shared type alone does not establish that invariant.
The solver compares lengths after a monotone join. Replacing that join with an overwrite would invalidate `modes.ts:53-55`.

No IR or adapter change is necessary. The validator must keep its own effect operations.
The smaller change extracts set operations while retaining each mode rule and the solver's round cap.

### UNF5 (builtin rows and checked facts)

The row metadata and repeated option decoding are useful targets. The fix does not remove every listed problem as written.
`mapEffect` is a live caller of the concurrency operation type in `check_builtins/stream.ts:76-83`.
Removing that operation is wrong.

Collection calls remain ordinary call IR with builtin identities encoded in strings.
`lower.ts:864-870` writes that encoding; `emit/expr.ts:393-400` reads it.
Removing the protocol requires an IR change. Under the fixed IR contract, a shared identity codec can only make the protocol explicit.

Option constructors, `Defect`, `never`, and `layer` carry different resolution rules.
A descriptor can replace repeated name tests without turning these forms into ordinary value calls.
Arity handlers must retain argument checking, effect collection, and diagnostic order on invalid input.
Schema rows must retain their individual operation names in diagnostics.

The smaller change separates row metadata, option facts, and resolver roles into distinct units.
The proposed row changes do not address A.X3 (the `never` sentinel in clauses). That assigned item needs a separate remedy or retained status.
The emitter must read IR metadata or leaf constants, never checker-family tables.
The validator must keep independent builtin recognition and checks.

### UNF6 (syntax decoders)

Shared header and field decoders can remove repeated tree navigation.
They must expose optional nodes and recovery states without deciding checker or inference policy.
The inference engine runs before complete checking, so an unknown result cannot become a checked error during decoding.

Literal fitting and name-target typing are semantic operations, not syntax decoders.
Their callers use different environments and recovery behavior. They do not belong in `syntax_queries.ts` merely because their inputs include nodes.
Keep arithmetic vocabulary in a leaf module and put shared type predicates beside the type table.

This narrower extraction can preserve IR and diagnostics. A universal decoder that adds fallbacks or changes traversal order cannot claim that guarantee.
The validator must not use these checker helpers.

### UNF7 (nominal types, recursion, and function types)

Named predicates and a function-type constructor can reduce repeated rules.
The predicates must distinguish tagged records, untagged identities, errors, opaque declarations, and aliases.
The record lookup must preserve undefined results rather than turn every nominal type into a record.

Rule 11 needs one checker-side owner. That owner must not depend back on the table implementation if the table imports it.
Tag lookup for imported graphs must still handle forward declarations and aliases.
Function construction must retain checked flags, borrow flags, written contracts, inferred contracts, and source-order IR.

Replacing `idName` with `shortName` changes readable output and can change collision grouping.
`type_show.ts:39-60` treats identities without `#` differently, including its separate unit branch.
A live probe prints `fails error:effect/SchemaError` through `showType` and `fails SchemaError` through `effectText`.
This confirmed display inconsistency needs its own behavior decision. It must not enter a byte-preserving extraction silently.

The smaller change adds precise table queries and extracts only identical function construction paths.
Unit arithmetic belongs with arithmetic rules. The validator must retain its independent recursion and nominal rules.
The fix text also lacks remedies for the assigned primitive classification, duplicate unit rows, and unit-arithmetic branches.
Those are B.S8, B.X9, B.N7, and B.X6 respectively. Function construction alone does not resolve them.

### UNF8 (linear arithmetic)

The duplicated linear representation, coefficient merge, and comparison conversion can share checker-side code.
The two term-key formats do not currently meet. Replacing both requires evidence that sorting and collision behavior stay unchanged.

The simplifiers are not equivalent. `predicates.ts:87-118` folds boolean constants; `check_refinements.ts:626-664` also canonicalizes and sorts.
The latter's `or` path does not perform the same constant folding.
A single replacement can change predicate JSON, proof certificates, proof-search order, and failure diagnostics.

The smaller change shares linear operations first and retains distinct normalization policies.
The validator must not import `linear.ts`, even through a new value import from `predicates.ts`.

### UNF9 (project loop and interface construction)

The duplicated outer loop and interface hashing are confirmed targets.
A shared loop can preserve output, but an optional memo hook needs a precise contract for reused and rebuilt modules.
`db.ts:338-455` forks the table, retains checked objects, and separately tracks semantic signatures and payloads with spans.
Its span-only branch rebuilds interfaces without checking the module again.

The refactor must retain these distinctions, query counters, topological order, and failed-configuration recovery.
Removing the solver version from an in-memory key is reasonable. A persistent cache would need a separate version policy.
The proof-budget default must remain unchanged.

The smaller change first returns the graph and both interface identities from one module result.
The shared driver can then consume explicit cache decisions without knowing memo storage.
No adapter or emitter dependency is needed. Existing revision and incremental tests remain required beyond static golden files.
The loop extraction alone does not remove D.N5 (lowering filters raw diagnostics) or D.X6 (broken-entry checks at separate stages).
An explicit checked-module outcome could own lowering eligibility. Broken-entry suppression still needs both publication stages unless the driver changes its result contract.

### UNF10 (project scheduling)

Extracting service-bound diagnostics and initialization checks reduces the driver's responsibilities.
The extraction must retain the order of analysis, inference, body checks, service bounds, and initialization diagnostics.
Requirements carried through values must still use the current revision's type reader.

The claimed three capability type derivations are not three copies.
`check_declarations.ts:817-830` constructs types; `check_project.ts:273-290` reuses them and handles imported fallback.
`editor.ts:209-225` locates declaration spans instead.

The smaller change extracts cohesive policy functions with explicit inputs and diagnostic results.
It should not create a broad service module that imports editor concerns.
The validator remains independent. Documentation of service-bound ownership needs to move with the code.

### UNF11 (loader and lowering responsibilities)

Splitting configuration parsing from module loading is feasible without changing diagnostics.
The two name patterns describe different accepted inputs: host labels and module paths.
One pattern must not replace both merely because the character classes look similar.

Import payload assembly can move behind a project query. The query must preserve companion exports, merged services, binding order, and prelude demand.
The prelude currently depends on builtin discovery during lowering. It cannot be collected before that discovery without an equivalent pass.
Scanning identifiers for occupied names also protects generated names from collisions; declaration-only scanning is not an automatic substitute.

The smaller change extracts configuration parsing and import planning separately.
An IR version constant is safe only with the publication changes identified under UNF3.
The emitter must continue to avoid value imports of `project.ts` and checker modules.
The proposed prose lacks a replacement for D.X5 (the occupied-name token scan) and D.X3 (prelude discovery during lowering).
Moving files alone leaves both links intact.

### UNF12 (emitter naming phases)

The naming order is a real contract. `emit/emit.ts:137-170` allocates declaration names, host helpers, and helper imports before reading import lists.
A two-phase API can make that order clearer, but `finish()` alone cannot make a wrong order a type error.
TypeScript permits early calls and retained aliases to the allocator.

The implementation needs controlled orchestration or a sealed allocator with checks after finalization.
It must preserve first-use order, helper order, import sorting, and generated-name collisions.
These details directly determine emitted bytes.

Host assertion offsets exist only after document rendering at `emit/emit.ts:189-204`.
The declaration emitter cannot return final offsets while it still returns an unrendered document.
A typed mark payload can remove the string lookup. Rendering must still assign the ranges.

The smaller change extracts pure helpers and introduces explicit finalization before replacing the mark protocol.
No checker import is needed. Emitter-private wrapper errors must remain unchanged when ID helpers move.

### UNF13 (hover emission and source-map helpers)

The hover wrapper is a good boundary change. An emitter function can return `Result` and hide `ModuleState` and `EmitFailure`.
It must retain the successful-emission prerequisite, declaration normalization behavior, flat rendering width, and unavailable backend result.
`typescript.ts:163-185` defines the current behavior.

The decoder deletion needs a separate API decision.
`docs/api.md:489-501` documents `mapGenerated`, `decodeMappings`, `lookupMapping`, `encodeVlq`, and `decodeVlqList`.
`typescript.ts:209-228` exports them through the package entry points.
No in-repository product caller does not make a documented export nonexistent.

The smaller behavior-preserving fix keeps the documented functions and moves only private test support.
The hover wrapper stays behind `typescript.ts`; source-only editor queries must not import it.
The decoder should also remain independent from the encoder so a shared coding error cannot defeat round-trip checks.

### UNF14 (emitter walkers and dispatch)

Narrow this fix. The survey does not establish six duplicate alias walkers or four predicate walkers.
`hasSchemaMetadata` is a shallow predicate. `typeDoc` and `encodedTypeDoc` are printers that treat names differently.
The three recursive predicates also have different stopping rules.

A shared structural child query can help. A universal alias-following fold can change named-type printing, deferred-type handling, and generated helper use.
Deriving leaf kinds from `ROWS` is useful, provided leaf emission remains exhaustive and separate from validator traversal.

`fieldKey` handles property syntax. It does not own Error-instance repair or shorthand semantics.
The `__proto__` tests at `decls.ts:575-613` and `expr.ts:898-904` therefore cannot collapse into one formatting call.
Named predicates can share the relevant facts without merging policies.

The `now` and `random` branches avoid requesting an unused Effect import.
The `update-ref` branch chooses an operation after callback analysis. These branches need not disappear.
The smaller change derives leaf membership and removes unused exports first, then extracts only equivalent walker structure.
The fix does not specify a remedy for E.N6 (family-specific flags on shared emitter methods).
Those flags need separate wrappers or an explicit decision to retain the existing port.

### UNF15 (validator tables and checks)

Extracting `World`, `Ctx`, and cohesive check groups is compatible with the validator boundary.
The new modules must remain under `validate/`. Their rules must not reuse checker predicates, builtin tables, linear operations, or recursion guards.

A universal bounded walker is unsafe as specified.
Some walks report depth, some stop silently, and recursion checks report at a declaration path.
Alias cycles also mean different things for lookup, assignability, recursive declarations, and malformed IR.
One termination result would change validator diagnostics and possibly accepted IR.

The concurrency checks inspect different representations: a numeric IR field, an expression record, and a type.
Their common arithmetic predicate can be local to the validator. Their surrounding checks must remain distinct.
The two option checks apply to different builtin argument positions.

The smaller change extracts tables first and retains each check's traversal policy and report path.
Sorting and fallback changes need malformed-IR comparisons, not only successful golden files.
An unchanged `rules:unfired` count is insufficient because that script recognizes report receivers by spelling.

### UNF16 (log schema)

Typed records and filename parsing remove real links between writers and readers.
The schema must include all existing kinds, including `cli.start`, `cli.change`, and `cli.tsc`.
It must retain record field order when bytes matter, historical envelope shapes, and readers' treatment of unknown kinds.

The browser endpoint and disk reader have different trust boundaries.
A shared parser can offer explicit policies; it must not silently tighten old-log replay to the endpoint's current rules.
The schema module must contain data and pure parsing, with no Deno dependency reachable by browser code.

The proposed schema alone does not remove output rereads or route the LSP through the host log port.
Those changes need explicit work items. Removing rereads must define whether logs record intended text or observed disk text after a write.
The smaller change separates schema extraction, logging wiring, and output capture.
G.H17 (replay knowledge of CLI flags) also remains after schema extraction. Argument replay policy needs its own shared operation or an explicit retained boundary.

### UNF17 (compile-result presentation)

The stale-text transition is shared and can become a pure helper.
The helper belongs in the TypeScript output layer, exposed through `typescript.ts`.
Putting it in source editor queries would violate the frontend-to-emitter boundary.

The core already returns a tagged hover backend at `typescript.ts:140-146`.
The loss of that tag occurs in the playground adapter at `playground/src/compile.ts:191-200`.
The smaller fix preserves the tag through the playground model instead of redesigning core hover.

The LSP must retain subscriptions, received-result comparison, configuration-failure behavior, and notification timing.
The playground must retain its own last-good lifecycle. Only the result transition is common.
The copied saving-label rule lives in the playground and replay, so it needs a page-level helper rather than a core UI string.
Moving result presentation alone leaves G.N8 (generated-text protocol state inside features.ts) intact. The subscription class needs a separate LSP module if that item must disappear.

### UNF18 (editor primitives)

Target-span lookup is a useful shared query, but cursor and edit policies are not identical.
Selection at an exclusive end, insertion affinity, replacement endpoints, and same-offset edits need explicit policy parameters.
The speculative operations also apply different diagnostic and identity checks.

The narrower helper should apply edits and construct a revision. Each caller must retain its own acceptance checks.
Merging the single-file freshness check with the whole-project check would weaken multi-file edit safety.

Replacing `localeCompare` at `editor_index.ts:172-174` changes public occurrence order.
It does not directly reorder `referencesAt`, which uses `byIdentity` at lines 198-200.
The rename loop still consumes the sorted occurrences and can select a different first failure.
That ordering change needs a separate behavior decision.

Pure primitives can stay below editor queries. They must not introduce imports from CLI or LSP modules into core.

### UNF19 (disk project)

The workspace read-diff-update loop is a valid shared responsibility.
The save policies are not merely caller markers.
CLI and LSP have different removal retry rules, ownership checks, previous-output lifetimes, and output ordering.
The LSP also separates disk state from editor overlays.

`trackTargets` serves production `watch --tsc`; removing it loses host-change detection.
The separate `diskProgram` getter has only a test caller and can be considered independently.
The refactor must preserve complete-snapshot failure handling, ownership after configuration failures, and stale output retention.

The smaller change extracts disk synchronization first. The two adapters retain explicit save and presentation policies.
`write` can disappear from the shared save round only after production calls and direct output APIs are distinguished.
Host code must continue to import core through the public entry points.

### UNF20 (helper ownership)

Moving canonical hash input to a named module is reasonable if its bytes remain unchanged.
Generated builtin identities depend on `lower.ts:865-866`, so key ordering and primitive rendering are output contracts.
The core must not depend on a host utility module to obtain hashing or ordering helpers.

Not every private helper copy should disappear.
`scripts/behavior_corpus.ts:7-9` deliberately has no compiler imports and runs against old trees.
`behavior_compare.ts:343-349` copies only that runner. A new shared-helper import can break comparison against the baseline.

The smaller fix centralizes normal consumers but keeps the corpus runner self-contained.
If the runner gains dependencies, the comparison tool must copy or bundle the complete runner dependency set first.
Validator-local helpers remain local under the independent-oracle rule.
Keeping helpers public also retains A.N3 (generic helpers exported through the frontend). That edge follows the current adapter rule, so it should be retained explicitly.

### UNF21 (scripts and benchmark helpers)

Shared suite arguments, process execution, temporary directories, and paired runs can remove repeated code.
The helpers must retain distinct permissions, timeouts, environment variables, output streams, exit handling, cleanup, and pair ordering.
A generic runner that changes any default can change verification or measurements without changing compiler code.

`site_ir.ts` does not redeclare the public Result shape exactly; it uses `text`, `blocks`, and `message` fields.
An imported generic Result requires an API migration, not just an import replacement.
The listed script export modifiers have no external users. The Effect benchmark imports already have version-pin tests at `tests/versions_test.ts:50-63`.

The smaller change extracts equivalent process mechanics first, then handles benchmark pairing separately.
Timing stages may retain documented private imports. Public-name imports can move through entry points without widening production APIs.
The standalone corpus restriction from UNF20 also applies here.
The scripts must pass a failure probe before they become the sole evidence for later refactors.

### UNF22 (remaining surplus)

Reject deletion of `Diagnostic.severity` under the current constraints.
Every diagnostic currently contains `severity: "error"` at `diagnostics.ts:389-398`.
Removing the property changes the diagnostic object and its serialized bytes, even if no warning exists.
The smaller compatible change narrows `Severity` to `"error"` while retaining the property.

`withParams` has external test callers, so its export is not unused as claimed.
An export may become private after replacing an internal test, but that requires an explicit test change.
`executionOf` also needs its test intent preserved when callers move to `contractSets`.
Removing truly unused export modifiers can preserve runtime behavior. Removing documented callable APIs is a separate decision.

## Kept list

Two kept reasons need correction and a small worthwhile fix.

**H.X6 (textual detection of validator rejections).** This is an internal coupling, not an external workaround.
`scripts/rules_unfired.ts:19-20` recognizes selected receiver names. `rejectionLines` at lines 42-49 silently ignores other names.
A live probe recognizes `ctx.report.add(...)` but misses `context.report.add(...)`.
UNF15 can therefore preserve the reported count while losing report-site coverage.
The plan should retain a complete rejection-site inventory or strengthen recognition and test renamed receivers before moving reports.

**G.H15 (client and server configuration).** The cited test guards method names and the URI scheme, not the entire duplicated configuration contract.
`extension.js:19-25` lists restart settings; lines 209-212 repeat defaults from `src/lsp/protocol.ts:87-90`.
`tests/vscode_client_test.ts:227-250` checks method literals and the Deno version.
Its fake client discards initialization options at lines 265-272.
A test that observes initialization options and configuration changes would protect the remaining link without generating the JavaScript client.

The other retained reasons do not establish a clearly worthwhile removal in this review.
In particular, validator duplication and emitter/validator expression traversal must remain separate.
The bounded solver, family ports, platform fallbacks, and measurement-specific layouts must not disappear merely because they contain special cases.

## Missed problems

### Standalone IR publication depends on source layout

This hidden link has the highest direct impact on the planned type moves.
`scripts/site_ir.ts:16-17` fixes the exact first import. Lines 32-49 parse declarations by blank-line blocks.
Lines 94-98 combine selected predicate text with the unparsed remainder of `ir.ts`.
Moving types, changing import order, or removing comments can change publication or leave unresolved relative imports.

A live in-memory probe confirms both failure modes: a prepended import is rejected, and a later relative import survives generation.
The generator needs an explicit publication contract before UNF1, UNF3, or comment removal touches these files.
This is stronger than the survey's concern about a local Result type.

### The behavior oracle has an implicit deployment boundary

`behavior_compare.ts:343-349` copies one current runner into each old source tree.
`behavior_corpus.ts:7-9` relies on having no compiler imports.
UNF20 and UNF21 propose shared imports without assigning ownership of that deployment contract.
A helper available only at the candidate revision would make the baseline runner fail.

The command also has two distinct modes. `behavior_compare.ts:261-269` returns success for a one-revision capture.
The plan's one-argument final command therefore cannot prove equivalence.
The required command is `deno task behavior:compare 30bb1d5 <candidate-commit>` in a repository that contains both commits.
The candidate must include the tested source because the tool reads committed trees.

### Every source extraction changes the coverage inventory

`fixtures/coverage/ownership.json` explicitly classifies production paths.
`scripts/coverage.ts:201-213` rejects both new unclassified paths and deleted paths that remain in the manifest.
`tests/coverage_test.ts:248-264` also fixes the current list of type-only modules.
The planned new modules require edits to these shared files, but the unit file lists omit them.

This hidden link creates actual file overlap across supposedly independent units.
One integration owner should maintain the inventory and its assertions, with each module move supplying its classification.

### An import cycle is absent from the plan's inventory

`types.ts:28` imports conversion functions from `type_ir.ts`; `type_ir.ts:5` imports table types back.
A read-only import scan found six cycles, including this pair.
UNF3 addresses four other cycles and leaves the validator cycle to UNF15, but its acceptance condition omits this pair.

This cycle is type-only in one direction. It does not prove a runtime initialization defect.
The plan should either accept the interface dependency or move the required interface types to a leaf module.
Moving `TypeTable.load` alone does not meet the stated cycle gate.

### Refactor gates have narrower scope than their names suggest

`tests/ir_site_slow_test.ts:24-41` ignores publication checks when the sibling website is absent.
Detached worktrees and this snapshot can therefore pass those tests without checking `typed-ir.ts`.
`behavior_corpus.ts:25-34` records no editor-query, CLI, or LSP response kind.
Static corpus equivalence cannot replace the surface tests and stateful adapter checks.

The emitter dependency test uses a filename pattern at `tests/emit_families_test.ts:74-78`.
New checker files such as `service_bounds.ts`, `linear.ts`, or `recursion_guard.ts` do not match that forbidden-name pattern.
Moving a checker rule can therefore weaken the gate without changing the architecture rule.
The gate needs explicit layer ownership or an updated exhaustive set before those new modules become import candidates.

### Syntax-decoder ownership has additional callers

The assigned inventory omits several callers that will depend on the proposed shared decoders.
`src/core/predicate_source.ts:62-69`, `src/core/lower.ts:579-585`, and `src/core/check_builtins/schema.ts:1171-1177` each decode arrow parameters.
`src/core/check_builtins/scope.ts:135-139` does the same for a release callback.
Field shape decoding also appears at `src/core/predicate_source.ts:309-316` and `src/core/requirement_provenance.ts:161-166`.

These callers expand the actual overlap between UNU6 (project checking), UNU7 (builtins), and UNU8 (syntax and types).
UNF6 should list these callers while retaining their separate validation and recovery policies.

### Service identity recognition has no matching helper

`src/core/check_declarations.ts:210` tests the `service:` prefix directly.
`src/core/ids.ts:27-44` supplies corresponding predicates for type, error, value, and local identities, but none for services.
A service identity predicate would complete this part of UNF1 without changing identity grammar.
The builtin name slice at `src/core/lower.ts:1597` also needs explicit preservation when ID helpers move.
It returns the complete encoded name, whereas `builtinInstanceName` at `src/core/ids.ts:57-61` returns only the operation name.
Substituting that tempting helper would change IR payloads.

## Unit order risks

### Acceptance conditions need correction before execution

The final comparison needs both revision arguments. The current command only captures its one revision.
Every unit must keep core diagnostics and error strings stable, not only golden files and successful IR.
UNF22 currently contradicts this requirement.

The plan gives two different website rules: the constraints permit a separate website commit, while every unit requires unchanged `typed-ir.ts`.
UNF1 and UNF3 cannot proceed until the plan selects a publication rule and assigns generator work.
The unit executor must also check publication when its worktree has no sibling website.

UNU1 (shared types) cannot promise that only the validator cycle remains without addressing or explicitly accepting `types.ts` and `type_ir.ts`.
UNU2 (names and vocabulary) cannot prohibit every extension test outside `paths.ts`.
The validator, standalone corpus runner, and JavaScript client need documented exceptions.

### The parallel wave has shared files and dependent interfaces

UNU3 (validator), UNU4 (emitter), and UNU6 (project checking) create or remove production modules.
All require `fixtures/coverage/ownership.json`; type-only moves also affect `tests/coverage_test.ts`.
The claim that their files do not overlap is therefore false once acceptance work is included.

UNU5 (scripts and benchmarks) owns `scripts/site_ir.ts`, but UNF3 needs generator changes before its own gate can pass.
UNU6 moves predicate code, which is another generator input. Generator ownership must be assigned before the parallel wave.
UNU4 removes public source-map exports while UNU5 changes private imports and script helpers.
Both need one settled public API before branch integration.

UNU5 also modifies `behavior_compare.ts`, mutation helpers, suite commands, and benchmark pairing.
These tools judge the other parallel units. A moving oracle cannot independently validate a moving implementation without a frozen comparison procedure.
The plan should preserve the baseline runner or complete and fault-check the harness work before relying on it.

### Later units overlap earlier contracts

UNU2 and UNU4 both assign ownership of `relativeSpecifier`, emitter literals, and path helpers.
UNU1 and UNU4 both affect emitted-module types used by `spans.ts`.
UNU6 and UNU8 both touch type interfaces, function construction, and lowering.
UNU7 and UNU8 both change `check_expr.ts`, inference, builtin contexts, and function facts.
These changes need sequential integration against the previous unit's actual result.

UNU9 (logs), UNU10 (editor presentation), and UNU11 (disk project) share CLI sessions, LSP state, playground output, and replay expectations.
Their order is suitable only if each retains the prior unit's ports and record shapes.
UNU12 (helper ownership and surplus) comes too late if earlier units already need the new helper owners.
It also must not remove a severity field used by earlier log and presentation work.

### Diagnostic and source-order hazards need explicit checks

UNU6 must retain revision ownership, span-only interface refresh, cache identities, and query counts.
UNU7 must retain invalid-arity diagnostics and evaluation order.
UNU8 must retain source-order type IR, borrow flags, checked flags, and literal-fit differences.
UNU3 must compare malformed IR, including cycle and depth failures, and preserve report paths.
UNU4 must compare emitted text, maps, assertion ranges, and name allocation together.

UNU11 must retain CLI removal order and LSP retry behavior.
The existing output distinction is recorded in `src/cli/main.ts:60-100` and `src/lsp/projects.ts:489-492`.
A common disk object must not flatten those distinct policies.

### Final cleanup must not erase the evidence

UNU13 (comments) can change generated `typed-ir.ts`, because publication copies source comments.
The comment-only diff gate is therefore not an output-identity gate.
Comments that encode ordering, independent-oracle boundaries, or old-tree runner constraints carry necessary facts.

UNU14 (tests) runs after the refactor, which helps preserve characterization evidence during implementation.
Coverage floors alone do not show that replacement tests detect the same faults.
Tests of malformed IR, emitted order, stale state, recovery, and public source-map APIs must retain their behavioral checks.
Fault injection should run before obsolete tests disappear.

The plan also names Sonnet, Opus, branches, and detached worktrees.
The supplied repository instructions require Sol delegates and direct work on local main unless separately authorized.
The implementation orchestrator must reconcile this conflict before dispatch.

The plan owner should revise the unsafe fix scopes and acceptance conditions before implementation starts.
