# Untangle the codebase

Status: inventory complete, astra cross-check pending, no implementation started.

This plan is the decision log of the untangle refactor of 2026-11-06. It asks one question of the code: should these pieces change together? The user chose both optional additions: remove comments that only restate the code, and remove tests that would not catch a real bug.

Prefixes: UNP (problem items, written as `<slice>.<kind><n>`), UNF (fixes), UNU (units). The kinds are H (hidden link), N (needless link), S (surplus), and X (special case). The eight slice surveys with full evidence are in [the evidence folder](2026-11-06-untangle-codebase-evidence/). The slices are A frontend, B checker, C builtin families, D program, E emitter, F validator, G adapters, and H scripts and bench.

## Constraints

- The validator duplicates checker rules on purpose. It is a differential oracle. A fix never shares a rule between `src/core/validate/` and the checker.
- The emitter `ROWS` table and the validator `exprChildren` stay separate.
- Emitted text stays byte-identical. The golden files, the surface snapshot, and the IR snapshot must not change.
- The IR contract does not change. `deno task behavior:compare 30bb1d5` must report no changed record at the end.
- The generated website file `typed-ir.ts` must stay byte-identical, or a separate website commit updates it.
- `src/core` does no I/O. Adapters import the core only through the entry points.

Baseline: `30bb1d5` (the changelog heading fix on top of `efb2acd`). The gate passed there: 2891 fast tests and 281 slow tests in 50 s.

## Fixes

Each fix is above the problems that it removes. A problem line gives the item ID and a short statement. The evidence file of the slice has the locations.

### UNF1 (one owner for reserved names, ids, and source paths)

Give each reserved name one owner on the compiler side. `ir.ts` holds the contract names: the reserved Effect error ids with `isReservedErrorId`, the prelude module name, the host label prefix, and the builtin instance names. `paths.ts` holds every file-kind rule: `isSourcePath`, `isInterfacePath`, `fileModeOf`, `relativeSpecifier`, and the host-label and prelude tests. `ids.ts` gets the missing `capabilityId` and `localId` constructors. The resolver exports one `isReservedName` test that the rename query uses. Callers stop testing literals.

- A.H3: the reserved error ids are reversed by hand in the checker and the emitter.
- A.H4: `cap:` and `local:` ids are built by hand at about 10 sites, and `serviceOfCapability` slices by a magic offset.
- A.H5, G.H18, G.X2, G.X8: the `.eff` and `.effi` test is inline at about 20 sites, although `paths.ts` owns the rule.
- A.S3: `parse.ts` exports `fileModeOf`, a copy of `paths.ts` knowledge.
- A.H14: the rename gate copies the reserved-name rule and omits `TARGET_NAMES`, so a rename to `Math` passes the gate (probable defect).
- B.H5, B.X1, B.X7: the reserved error triple is spelled four times, partly as literals.
- B.H16, B.H17: local and capability ids are built by template in the checker and the lowerer.
- B.N8: `type_show.ts` strips the unit-id prefix by slicing.
- D.H12: the prelude module name and the `host:` prefix are bare strings in lowering, emission, and the project loader.
- E.H4, E.X1, E.X2: the emitter writes the reserved error ids as literals although `ir.ts` exports them.
- E.H6, E.X3, E.X4: the emitter tests `.effi`, the prelude, and `host:` by literal.
- E.N4: the emitter reaches the id parser through `module_state.ts`.
- G.H16: `extension.js` copies `generatedPathOf`. The client is plain JavaScript, so a test links the two.

### UNF2 (one owner for the lexical vocabulary)

`lex.ts` exports the vocabulary: the keyword table, the contextual words with their roles, the parser-checked words, `isKeywordKind`, and `isIdentifier`. The parser marks the modifiers `sealed`, `opaque`, `borrow`, and `pure` once, and the declaration index and the checker read the mark. The editor token query, completion, the editor index, and the playground highlighter read the vocabulary. The playground keeps its positional rules.

- A.H6: the contextual word lists exist in six copies that already differ, and `parse.ts:378` hides a word-length bound.
- A.H7, A.S6: keyword classification depends on the order of the enum, in two copies.
- A.H8, A.X6: `void` and `while` are listed in the lexer and again in the parser.
- A.H12: the identifier shape is copied as regexes in two editor files.
- A.X5, G.X7: the playground and the core token query classify keywords with separate lists.
- B.H8, B.X8: four modifiers are decided from raw text in four styles.

### UNF3 (shared types move to leaf modules, which removes the import cycles)

Each type that two modules share moves to the module that both can depend on. `Result` and `Span` move out of `ir.ts`. `BodyEnv` moves next to `TypeEnv`. `TypeTable.load` moves to `type_ir.ts`. The language server handler types move to `lsp/handler.ts`. The host port types move to `host/ports.ts`. The validator cycle is part of UNF15.

- D.N8: `predicates.ts` imports `Result` from `ir.ts`, which creates the `predicates`-`ir` cycle and a wide fan-in.
- B.N1: `infer_inputs.ts` imports `BodyEnv` from the largest checker file, which creates the second cycle.
- B.N2, B.H19: `TypeTable.load` is IR import logic in the table, and `DefinitionSource` copies `TypeGraph`.
- G.N1: the language server handler types live in `server.ts`, which creates the third cycle.
- G.N2: the host port types are split over `io.ts` and `log.ts`, which creates the fourth cycle.
- E.N5: `spans.ts` imports the emitted-module types from their producer.

### UNF4 (one effect-set algebra)

A new `effect_set.ts` holds `EffectSet`, the pure and effect-only constants, `combine`, `isQuiet`, and `without`. `modes.ts` uses it, and `Solved` becomes `EffectSet`. `tables.ts` keeps only the checker-to-lowering contract.

- A.N1: `tables.ts` mixes the stable algebra with the fact unions that change for each builtin.
- A.H13: `modes.ts` repeats `combine` as `join`.

### UNF5 (each builtin row carries its facts once)

The row key gives the fact kind. `Some` and `None` get an option-constructor role in the prelude table, so the parallel core row path goes. The Schema rows come from `SCHEMA_BUILTINS`. The fact records the parts that lowering now reads again from the options record. The `Defect` handler and the `layer` service argument come from the resolver once. Name ladders become separate handlers. The builtin instance names have one list.

- C.H1: each row writes the fact kind that its key already gives.
- C.H2, C.H3: collection builtin names and arities are written in four places, and the emitter parses the name back out of a string id.
- C.H4, C.S2, C.X3: the Schema op set is typed twice by hand, and 16 identical rows repeat `SCHEMA_BUILTINS`.
- C.H5, C.H6: lowering reads the `on` and `fields` options again after the checker read them.
- C.N1: `refCall` and `collectionCall` dispatch on the name a second time.
- C.N3, C.N4: the concurrency option parser lives in the body checker, and one family imports another.
- C.S1, C.X1, B.S2, B.S3: `Some` has its own registry path with three exports for one test.
- C.S3: the concurrency operation type is wider than its use (probable).
- C.X2: rows with their own arity skip the shared prologue.
- B.X2, A.X1: `Some` and `None` are tested by name in eight branches over five files.
- A.H9, A.X2: the resolver tests the callee text `"layer"`.
- A.X4, B.H7, B.X3: the `Defect` arm is found by text in the resolver and again in the checker.
- A.X3: `never` is skipped by name in clause listing.

### UNF6 (syntax shape decoders live in `syntax_queries.ts`)

The checker, the inference engine, the resolver, and the lowerer read a function header, a field expression, an arrow parameter list, and a name target through shared decoders. One literal-fit rule and one arithmetic operator set serve every caller. Each caller keeps its own traversal.

- B.H9: six copies extract the parameter list, the result, the `fails` clause, and the `with` clause.
- B.H10, D.H10: the field expression shape and the pipe stage argument order are copied four and three times.
- B.H11: three functions answer "the type of a name target".
- B.H12: four tests decide whether a literal fits a primitive.
- B.H14, B.X10: the arithmetic operator set is spelled three ways.
- B.H15: the inference engine repeats several decoders of the checker. The two walkers stay, because inference runs before checking.

### UNF7 (nominal predicates, the recursion guard, and function types have one home)

`TypeTable` answers `isNominalData(id)` and `recordBodyOf(id)`. One `recursion_guard.ts` holds Rule 11 and the tag-through-aliases walk. One constructor builds a function type from a signature and its solved contract. The checker, the declaration checker, `signatures.ts`, and the lowerer call it.

- B.H1, B.H2: the nominal-id test and the record-body lookup are re-derived at about a dozen sites, with unmarked variants.
- B.H3, B.H4, B.N3: Rule 11 is split over `types.ts`, `type_lower.ts`, and two tag walks.
- B.H6, B.H21, B.X4, D.N4, D.X4: function types with checked inputs are assembled four times by different routes.
- B.S5: `idName` copies `shortName` without the reserved branch (probable defect in hover text).
- B.S8, B.X9: the primitive set and the unit rows are restated.
- B.N7, B.X6: the unit arithmetic tests `Duration` and `Instant` by id.

### UNF8 (one linear arithmetic module)

A new `linear.ts` next to `predicates.ts` holds the linear expression type, the term key, the merge, the difference test, the operator table, and one simplifier. `predicate_source.ts` and `check_refinements.ts` use it.

- D.H1: two operator tables turn a comparison into a difference bound.
- D.H2: the difference-shape test is written twice.
- D.H3: the linear type and the merge loop exist twice, with two term-key formats.
- D.H4: the and-or simplification exists twice.

### UNF9 (one project loop and one interface build)

`check_project.ts` owns the project loop with an optional per-module memo hook. `db.ts` keeps only the memo keys and the revisions. The interface and its hash are built in one place, and the type graph once.

- D.H5: the project loop exists in `checkAnalysis` and in `Program.check`.
- D.H6, A.H11: `db.ts` rebuilds the interface and its hash by hand.
- D.H7: the type graph is built twice for each module.
- D.N3: `Program` knows the internals of `CheckedModule`.
- D.N2, D.S4: `db.ts` imports the solver for a version constant that cannot change.
- D.S5: the proof budget has two defaults.
- D.X6: the broken-entry rule is tested at two sites.
- D.N5: the lowerer decides from raw diagnostics whether a module has errors.
- D.H16: a comment states a link that no longer exists.

### UNF10 (the project driver holds only scheduling)

The service-bound policy moves with `requirement_provenance.ts` and `contract_origins.ts` into one `service_bounds.ts`. Initialization builds its edges and reports its cycles in `initialization.ts`. Each diagnostic family is reported next to its rule.

- D.N1: `check_project.ts` holds five jobs that change for different reasons.
- D.H8: the initialization edges are built in two files.
- D.X7: the driver builds four diagnostic families inline.
- D.H9: the method type of a capability is derived from the services map in three places (probable).

### UNF11 (lowering and the project loader separate their concerns)

The project loader splits into the configuration reader and the module loader. The lowerer reads imports through one project query and takes the IR version from `ir.ts`.

- A.N5, A.X7: `project.ts` mixes the configuration reader and the module loader, with two near-equal name patterns.
- D.N6, D.X2: the lowerer knows the link model and the service merge rule.
- D.X3: the prelude import depends on a side effect of declaration lowering.
- D.X1: the `.effi` export rule sits in the lowerer.
- D.X5: binding names come from a scan of every token of the module.
- D.H11: the IR version is a bare literal in the lowerer.

### UNF12 (the emitter naming ledger has two phases)

`ModuleState` splits into a name allocator and a finished imports result. Only `finish()` gives the imports, so a wrong call order is a type error. The id helpers and `relativeSpecifier` leave `module_state.ts`. The host assertion records come back from the declaration emitter directly. The helper declarations live in one file.

- E.H1: the build order is a contract that only comments state.
- E.N3: `module_state.ts` mixes five jobs.
- E.H2: the host assertion range travels by a string key and is rebuilt three times.
- E.S3: one file has two copies of the import-alias text.
- E.S4: the helper declarations are split between two files.

### UNF13 (hover uses one emitter function, and the test-only decoder leaves `src`)

The emitter exports one function that returns the backend type text of a declaration as a Result. `typescript.ts` calls it and no longer catches `EmitFailure`. The source map decoder and `mapGenerated` move to a test helper, because only tests use them.

- E.N1, E.N2, D.N7: hover builds a `ModuleState` and catches the emitter exception.
- E.S2, D.S2: `lookupMapping`, `decodeMappings`, `decodeVlqList`, and `mapGenerated` have no product caller.

### UNF14 (the emitter has one type walk and one kind list)

One `type_walk.ts` in `emit/` gives the children of a `Type` and follows names with one cycle guard. The four predicate walkers use it. `LeafCallKind` comes from `ROWS`. `fieldKey` owns the unsafe property names.

- E.H8: six switches over `Type` kinds repeat the name follow and the cycle guard.
- E.H5, C.H7: the leaf marker and the leaf call list must agree, with five routing mechanisms.
- E.H3, E.X5: `__proto__` and the Error-like names are tested in three places.
- E.H7: two functions decide whether a callback is effectful (probable).
- E.N6: shared interface methods carry flags for one family caller (probable).
- C.X4, C.X5: one-kind branches sit before the shared switch.
- C.S4: `LOG_SEVERITY` repeats the six level names.
- E.S1, C.N5: an export without users, and a stale header comment.

### UNF15 (the validator separates its tables from its checks)

`World` and `Ctx` move to a table module with `buildWorld`. The check groups of `world.ts` become their own files. One bounded walker beside `typeChildren` owns the depth bound and the depth report. One prelude table seeds `buildWorld` and answers `isReservedError`. One `effectOf` constructor builds an active effect.

- F.N1, F.N2: `Ctx` lives in `world.ts`, which creates the cycle, and `world.ts` holds five unrelated groups.
- F.H4: five walkers repeat the depth bound and the depth report.
- F.H5: four alias-following walkers end a cycle in different ways (probable).
- F.H1, F.H2, F.X1: the reserved error test is written three times and seeded with literals.
- F.H3: one fallback span is written five times.
- F.H6: `isRecord` and `isObject` are the same function.
- F.H7: two sorts rely on default string order beside an explicit comparator (probable).
- F.H8: `markCheckedRaw` has a default that hides a missing kind.
- F.N3, F.N4: the core result types and `EFFECT_ONLY` live in the family folder.
- F.N5: the concurrency check exists in three variants (probable).
- F.N7: `sets.ts` holds a message formatter.
- F.S2: a pass-through type alias re-derives `AreaCode`.
- F.X2: one option check is called twice (probable).

### UNF16 (one log schema)

A new `src/host/log_schema.ts` holds a data type for each record kind, the session file name with its parser, and one envelope parser. The CLI, the language server, the playground, the log endpoint, the report, and the replay use it.

- G.H4: the session file name format is written three times, and one reader slices by fixed offsets.
- G.H5: about 80 kind and field literals in six files have no shared type.
- G.H6: the log endpoint re-states `Envelope` and has its own `isRecord`.
- G.H7: the language server bypasses the host log port.
- G.H17: the replay knows which flags the CLI adds for logging.
- G.N3: the CLI session reads back each written file to hash it.

### UNF17 (one presentation of a compile result)

The core gives the generated-text rule with stale marking, and the hover backend as a tagged value. The language server converts the result to protocol types, and the playground converts it to page types.

- G.H1: the last-good and stale rule is in the language server and in the playground.
- G.H2, G.X1: the "backend type: not available" text is typed twice and used as a flag.
- G.H3: the saving-label rule is copied into the replay.
- G.N8: the generated-text protocol state lives in the feature file.

### UNF18 (one set of editor primitives)

One module holds the node at an offset, the declaration span of a target, the move of an offset through edits, and the speculative edit with its diagnostic delta. The editor queries and `check --fix` use it.

- G.H10: two functions map a target to its declaration span (probable disagreement).
- G.H11: the cursor-to-node rule is written four times with different end rules.
- G.H12: two functions move an offset through edits with different tie rules.
- G.H13: the speculative edit sequence is in four places.
- G.X6: one sort is locale dependent.
- G.S4: one parameter is unused.

### UNF19 (one disk project for the CLI and the language server)

A `DiskProject` in `src/host` reads the workspace, diffs the files, updates the program, runs the save round, and gives the reason for a held module. The CLI session and the language server use it. The save round loses its caller-specific parameters.

- G.H8: the language server re-derives the reason for a held module.
- G.H9: two disk programs are fed by two copies of the read-diff-update loop.
- G.N4, G.S3: the save round parameters only mark the caller, and `write` is always true.
- G.N5: the removal list is shaped so that each caller can reorder it.
- G.N6: one method only wraps a function.
- G.N7, G.H14: span-to-position conversion has three forms, and two checks define a current revision.
- G.S5, G.S6: a getter and a constructor flag may have only test users (probable).

### UNF20 (core helpers have owners, and edges use them)

`canonicalJson` moves next to the hash modules, and that module states that emitted names depend on its output. The edge helpers stay public, and the private copies in the playground, the scripts, and the bench go.

- A.N3, A.N4: `util.ts` mixes five helpers, and five private copies of `isRecord` exist.
- A.H10: nothing states that `canonicalJson` output fixes emitted names.
- H.S7: the scripts re-implement `errorMessage`.

### UNF21 (the scripts and the bench share their helpers)

A `scripts/lib.ts` holds `ROOT`, one command runner, a temporary-directory helper, the JSON fixture writer, the revision export, and the two suite command lines. A `bench/pairs.ts` holds the A/B alternation. Scripts and bench import public names through the entry points. `tests/versions_test.ts` gets the TypeScript and bench Effect pins.

- H.H1: the fast-suite command is written four times, and the slow-suite command twice.
- H.H2: the production roots are written twice in one script.
- H.S1, H.S2, H.S3, H.S4, H.S5: ten runners, nine temp-dir patterns, seven `ROOT` spellings, two revision exports, and three JSON writers.
- H.S6: `site_ir.ts` declares its own `Result`.
- H.H7: the A/B alternation is copied in seven places.
- H.H8, H.H9: the bench input shapes and timeouts are repeated.
- H.N1: about 15 imports reach private core modules for public names.
- H.H3, H.H4: two version pins have no test.
- H.H6: the IR baseline source lives in the update script.
- H.N5: the two measure scripts repeat their visit loop.
- H.S11: about ten exports have no user outside their file.

### UNF22 (surplus that no other fix covers)

- A.S1: `Severity` has a `warning` member that nothing produces. Remove the field from the core diagnostic.
- G.S1, G.S2: two exports have no user outside their file.
- B.S1: `executionOf` has only test callers. The tests move to `contractSets`, or the function stays private.

### UNF23 (comments)

Remove comments that restate the implementation. Keep comments about outside facts. Remove workaround comments when a fix removes the workaround.

### UNF24 (tests)

After every structural fix, remove tests that repeat the implementation or cannot fail. Rewrite tests that depend on internals to depend on behavior.

## Kept on purpose

These items stay. The reason is given for each.

- A.H1, C.H9, D.H13: one builtin or one type kind touches several layer tables. Each table is exhaustive and compiler-checked, and the layers change for different reasons. The validator and `ROWS` copies are on purpose.
- A.H2: `TARGET_NAMES` mirrors the emitted globals, guarded by `tests/target_names_slow_test.ts`.
- A.H15, C.H8: the TextMate grammar copies the prelude names. The grammar is JSON, and `tests/vscode_client_test.ts` compares it.
- A.N2: `tables.ts` is the checker-to-lowering contract. Its direction is correct.
- A.N6, A.X8: the round cap of `modes.ts` stays until the checker unit shows that no input reaches it.
- A.N7: one constant import. Not worth a change.
- A.S2: the diagnostic code registry is the content of the diagnostics module.
- A.S4: `analyze.ts` is a real composition.
- A.S5: two hash algorithms serve two purposes. A change needs a measurement first.
- B.H13: the coverage key format is local to one file.
- B.H18: union order depends on the canonical IR text on purpose. A change would change emitted text.
- B.H20: the inference order is the driver's job.
- B.N4, B.N5, B.N6, C.N2: the family context interfaces are the ports of the families.
- B.X5: the file mode is an enum value of the parse tree, not a path test.
- B.S4, B.S6, B.S7: small local helpers with real users.
- D.H14, D.H15: the serializer set list and the span key are IR contract facts. The validator checks them separately.
- D.S1, D.S3, D.S6, D.S7: the entry points, the IR serializer, the mode map, and the query counters have documented users.
- D.X8, D.X9: validator special cases and internal guards.
- E.S5: the family context interface keeps families away from `expr.ts`.
- E.X6, E.X7: fallbacks for outside input and outside tool text.
- C.X6: run-time checks in generated text are run-time semantics.
- F.N6, F.S1, F.S3, F.X3, F.X4: no defect, or documented on purpose.
- G.H15: guarded by `tests/vscode_client_test.ts`.
- G.X3, G.X4, G.X5: platform workarounds and outside bounds. Native Windows is out of scope.
- H.H5: the fixture generators use the test helpers on purpose.
- H.N2, H.N3, H.N4: the replay drives the real surfaces, and the version constant has one owner.
- H.S8, H.S9, H.S10, H.X1, H.X2, H.X3, H.X4, H.X5, H.X6, H.X7: measurement layouts, by-hand evidence scripts, and outside workarounds.

## Units

Each unit goes to one Sonnet executor with the full context in the dispatch. The executor commits on its branch or worktree, and Opus reviews the diff and runs `deno task check`. Every unit must keep the golden files, the surface snapshot, the IR snapshot, and `typed-ir.ts` unchanged.

| Unit | Fixes | Model | Main files | Acceptance check | Budget |
| --- | --- | --- | --- | --- | --- |
| UNU1 | UNF3 without the validator | Sonnet | `source.ts`, `ir.ts`, `predicates.ts`, `signatures.ts`, `check_expr.ts`, `infer_inputs.ts`, `types.ts`, `type_ir.ts`, `lsp/handler.ts`, `host/ports.ts` | gate passes; only the validator cycle remains in the import graph | 70 calls |
| UNU2 | UNF1, UNF2 | Sonnet | `ir.ts`, `paths.ts`, `ids.ts`, `lex.ts`, `parse.ts`, `resolve.ts`, editor files, emitter literals, adapters | gate passes; no inline `.eff` or `.effi` test outside `paths.ts` | 90 calls |
| UNU3 | UNF15 | Sonnet | `src/core/validate/**` | gate passes; `rules:unfired` count unchanged | 70 calls |
| UNU4 | UNF12, UNF13, UNF14 | Sonnet | `src/core/emit/**`, `typescript.ts`, source map tests | gate passes; golden files unchanged | 90 calls |
| UNU5 | UNF21 | Sonnet | `scripts/**`, `bench/**`, `tests/versions_test.ts` | gate passes; `behavior:compare` and `mutate` smoke runs work | 80 calls |
| UNU6 | UNF8, UNF9, UNF10, UNF11 | Sonnet | `predicates.ts`, `predicate_source.ts`, `check_refinements.ts`, `check_project.ts`, `db.ts`, `interface.ts`, `initialization.ts`, `project.ts`, `lower.ts` imports | gate passes | 90 calls |
| UNU7 | UNF4, UNF5 | Sonnet | `effect_set.ts`, `tables.ts`, `modes.ts`, `check_builtins/**`, `resolve.ts`, `check_expr.ts`, `check_patterns.ts`, `infer_inputs.ts`, `lower.ts` | gate passes | 90 calls |
| UNU8 | UNF6, UNF7 | Sonnet | `syntax_queries.ts`, `recursion_guard.ts`, `types.ts`, checker files | gate passes | 90 calls |
| UNU9 | UNF16 | Sonnet | `host/log*.ts`, `lsp/wire_log.ts`, `cli/session.ts`, playground log files, `scripts/logs_*.ts` | gate passes; `logs:replay` of the fixture logs passes | 80 calls |
| UNU10 | UNF17, UNF18 | Sonnet | core editor files, `diagnostic_delta.ts`, `lsp/features.ts`, playground compile files, `cli/fix.ts` | gate passes; browser check of the playground | 90 calls |
| UNU11 | UNF19 | Sonnet | `host/save_round.ts`, `host/outputs.ts`, `lsp/projects.ts`, `cli/session.ts`, `cli/main.ts`, `cli/build.ts` | gate passes | 80 calls |
| UNU12 | UNF20, UNF22 | Sonnet | `util.ts`, hash modules, adapters | gate passes | 50 calls |
| UNU13 | UNF23 | Sonnet | all source directories, one executor for each area | gate passes; diff holds comment lines only | 60 calls each |
| UNU14 | UNF24 | Sonnet | `tests/**` | gate passes; coverage floors hold | 80 calls each |

Order: UNU1 and UNU2 run first on `main`, one after the other, because they touch many files. UNU3, UNU4, UNU5, and UNU6 then run in parallel in detached worktrees, because their files do not overlap. UNU7 and UNU8 follow on `main`. UNU9, UNU10, UNU11, and UNU12 follow. UNU13 and UNU14 run last. After each wave, fresh survey agents look for remaining problems.

## Cross-check before implementation

Codex astra (`codex exec -m gpt-6-astra`) reads this plan and the evidence in a snapshot of `30bb1d5`. For each fix, it confirms or rejects each problem claim against the code. It also judges whether the fix keeps behavior, and it names better root fixes and missed problems. Opus resolves each astra finding, or records why it rejects the finding. Implementation starts after that.

## Final checks

Empirical checks, each with its command output recorded in the evidence folder:

- `deno task check` passes.
- `deno task behavior:compare 30bb1d5` reports no changed record.
- `deno task coverage` holds the floors.
- Directed `deno task mutate` runs on each new module and on each module whose logic moved. Each survivor gets a test or a register row.
- Fault injection: for a sample of moved rules, a deliberate fault must make at least one test fail. This shows that the tests still guard the moved code.
- `deno task logs:replay` passes for the fixture logs and for the local session logs.
- `deno task bench m1` and `deno task bench m2` at `30bb1d5` and at the final commit, measured with the A/A noise floor. A slowdown above the noise floor is a finding.
- A browser session checks the playground source selection, output selection, hover, and stale output.
- `../effektive` website tests pass.

Adversarial reviews, after the empirical checks:

- Codex astra and a Fable subagent each review the full diff from `30bb1d5`, independently, with the instruction to find behavior changes, broken contracts, and new hidden links.
- Fresh survey agents repeat the inventory of hidden links, needless links, surplus, and special cases. The work repeats until no finding is worth a fix.
- Opus resolves each finding, or records why it rejects the finding.
