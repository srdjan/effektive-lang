# Untangle the codebase

Status: implementation in progress. The progress section at the end records each landed unit.

This plan is the decision log of the untangle refactor of 2026-11-06. It asks one question of the code: should these pieces change together? The user chose both optional additions: remove comments that only restate the code, and remove tests that would not catch a real bug. The user also asked for an astra cross-check before implementation, and for adversarial reviews and empirical validation at the end.

Prefixes: UNP (problem items, written as `<slice>.<kind><n>`), UNF (fixes), UNU (units), UND (decisions). The kinds are H (hidden link), N (needless link), S (surplus), and X (special case). The eight slice surveys with full evidence are in [the evidence folder](2026-11-06-untangle-codebase-evidence/). The slices are A frontend, B checker, C builtin families, D program, E emitter, F validator, G adapters, and H scripts and bench. The astra cross-check is [astra-crosscheck.md](2026-11-06-untangle-codebase-evidence/astra-crosscheck.md). The shared executor brief is [executor-brief.md](2026-11-06-untangle-codebase-evidence/executor-brief.md).

## Constraints

- The validator duplicates checker rules on purpose. It is a differential oracle. A fix never shares a rule between `src/core/validate/` and the checker.
- The emitter `ROWS` table and the validator `exprChildren` stay separate.
- Emitted text, source maps, IR, diagnostics with their messages, CLI output, and language server output stay byte-identical. Only UND1 changes output, in its own commit.
- The generated website file `typed-ir.ts` stays byte-identical, except that UNU1 removes the unused `Result` declaration (UND6). `scripts/site_ir.ts` may change. `tests/ir_site_slow_test.ts` runs only when the sibling `../effektive` exists, so this check runs in the main tree after each integration, not in a scratch worktree.
- `src/core` does no I/O. Adapters import the core only through the entry points.
- `scripts/behavior_corpus.ts` stays self-contained, because `behavior_compare.ts` copies it into old trees.
- Each new or removed production module updates `fixtures/coverage/ownership.json`, and a type-only module also updates the list in `tests/coverage_test.ts`. Opus resolves conflicts in these two files at integration.

Baseline: `30bb1d5` (the changelog heading fix on top of `efb2acd`). The gate passed there: 2891 fast tests and 281 slow tests in 50 s.

## Decisions

- UND1 (display of reserved errors): astra showed that `showType` prints `fails error:effect/SchemaError` while `effectText` prints `fails SchemaError`, because `type_show.ts` has `idName` beside `ids.ts` `shortName`. Decision: fix it as a defect in its own commit, with a test that fails first. Readable text then uses the short name in both paths. The same split applies to a reserved capability: `effectText` printed `with Scope`, and `showType` printed `Effect<void, never, cap:effect/Scope>`. Commit `c47452c` fixes both sets, so a hover contract and a type mismatch message now print `Scope`. The astra adversarial review found this case, and `tests/type_show_reserved_test.ts` pins it.
- UND2 (source map decoder): `mapGenerated`, `decodeMappings`, `lookupMapping`, and `decodeVlqList` are documented in `docs/api.md` but have no product caller. No outside code imports the package. Decision: move them to test support, keep the decoder independent of the encoder, and update `docs/api.md`. `encodeVlq` stays, because production uses it.
- UND3 (diagnostic severity): the field stays, because removing it changes serialized diagnostics. The `Severity` type narrows to `"error"`.
- UND4 (`localeCompare` in the occurrence order): stays. A change would reorder public occurrence results. No failing case is known.
- UND6 (`Result` in the published IR): `Span` is an IR type and stays in `ir.ts`. `Result` is not used by any IR type, so it moves to a leaf `result.ts`. The website `typed-ir.ts` then loses one unused declaration. Opus regenerates it with `deno task site:ir` and commits it separately in `../effektive`.
- UND5 (orchestration): the Claude global instructions name Sonnet executors and permit detached worktrees from local main. The astra remark about Sol delegates applies to Codex sessions. Executors commit in detached worktrees under `~/.claude/scratch`, and Opus cherry-picks to `main`.

## Fixes

Each fix is above the problems that it removes. A problem line gives the item ID and a short statement. The evidence file of the slice has the locations. The astra verdict is noted where it narrowed a fix.

### UNF1 (one owner for ids and source paths)

`ids.ts` gets the missing constructors and predicates: `capabilityId`, `localId`, `isServiceId`, and `isReservedErrorId`, which reads the constants that `ir.ts` already exports. `paths.ts` gets every file-kind rule: `isSourcePath`, `isInterfacePath`, `fileModeOf`, `relativeSpecifier`, and the prelude module and host label constants with their tests. `ir.ts` does not change. Callers stop testing literals, but each caller keeps its own policy for companion modules, host imports, and `SchemaIssue`. The validator, `behavior_corpus.ts`, and `extension.js` keep their own copies. A test links `extension.js` `virtualUriOf` to `generatedPathOf`, and a test observes the initialization options of the client. `lower.ts:1597` keeps its own slice, because it needs the full encoded name.

- A.H3: the reserved error ids are reversed by hand in the checker and the emitter.
- A.H4: `cap:` and `local:` ids are built by hand at about 10 sites, and `serviceOfCapability` slices by a magic offset.
- A.H5, G.H18, G.X2, G.X8: the `.eff` and `.effi` test is inline at about 20 sites. The policies differ, but the path test is one rule.
- A.S3: `parse.ts` exports `fileModeOf`, a copy of `paths.ts` knowledge.
- B.H5, B.X1, B.X7: the reserved error triple is spelled four times, partly as literals.
- B.H16, B.H17: local and capability ids are built by template in the checker and the lowerer.
- B.N8: `type_show.ts` strips the unit-id prefix by slicing.
- D.H12: the prelude module name and the `host:` prefix are bare strings in lowering, emission, and the project loader.
- E.H4, E.X1, E.X2: the emitter writes the reserved error ids as literals although `ir.ts` exports them.
- E.H6, E.X3, E.X4: the emitter tests `.effi`, the prelude, and `host:` by literal.
- E.N4: the emitter reaches the id parser through `module_state.ts`.
- G.H15, G.H16: `extension.js` copies `generatedPathOf` and the server defaults. The client is plain JavaScript, so tests link them.
- Astra: `check_declarations.ts:210` tests the `service:` prefix by hand.

### UNF2 (one owner for the lexical vocabulary)

`lex.ts` exports the vocabulary: the keyword table, the contextual words with their roles, the parser-checked words, `isKeywordKind`, and `isIdentifier`. The parser, the editor token query, completion, the editor index, and the playground highlighter read it. The playground imports it through `frontend.ts` and keeps its positional rules. Keyword numeric values, token spans, recovery, and messages stay. Modifier marks from the parser are a second commit of the same unit, with their recovery defaults stated first.

- A.H6: the contextual word lists exist in six copies that already differ, and `parse.ts:378` hides a word-length bound.
- A.H7, A.S6: keyword classification depends on the order of the enum, in two copies.
- A.H8, A.X6: `void` and `while` are listed in the lexer and again in the parser.
- A.H12: the identifier shape is copied as regexes in two editor files.
- A.X5, G.X7: the playground and the core token query classify keywords with separate lists.
- B.H8, B.X8: four modifiers are decided from raw text in four styles.

### UNF3 (shared types move to leaf modules)

`Result` moves from `ir.ts` to a leaf `result.ts`, and `source.ts` re-exports it (UND6). `Span` stays in `ir.ts`. `BodyEnv` and `ProofBudget` move to a new leaf module that imports only `types.ts` and `signatures.ts`. `TypeTable.load` moves to `type_ir.ts`, and `DefinitionSource` becomes a `Pick` of `TypeGraph`. The language server handler types move to `lsp/handler.ts`. The host port types move to `host/ports.ts`. The `types.ts`-`type_ir.ts` pair keeps a type-only back edge, because union order depends on the canonical IR on purpose (B.H18). No cycle has value imports in both directions at the baseline. The gate is: only the `types.ts`-`type_ir.ts` cycle and the validator cycle remain after UNU1, and the validator cycle goes in UNU3.

- D.N8: `predicates.ts` imports `Result` from `ir.ts`, which creates a cycle and a wide fan-in.
- B.N1: `infer_inputs.ts` imports `BodyEnv` from the largest checker file, which creates a cycle.
- B.N2, B.H19: `TypeTable.load` is IR import logic in the table, and `DefinitionSource` restates part of `TypeGraph`.
- G.N1: the language server handler types live in `server.ts`, which creates a cycle.
- G.N2: the host port types are split over `io.ts` and `log.ts`, which creates a cycle.
- E.N5: `spans.ts` imports the emitted-module types from their producer.
- Astra: `site_ir.ts` strips exactly one import and copies the rest of `ir.ts`, so the publication depends on the source layout.

### UNF4 (one effect-set module)

A new `effect_set.ts` holds `EffectSet`, the pure and effect-only constants, `combine`, `isQuiet`, `without`, and the sorted-set union. `tables.ts` keeps only the checker-to-lowering contract. `modes.ts` uses the set union but keeps its own mode rule, because astra showed that the two mode rules give different results for a pure mode with a failure.

- A.N1: `tables.ts` mixes the stable algebra with the fact unions that change for each builtin.
- A.H13: `modes.ts` repeats the set union. The mode rule differs on purpose and stays.

### UNF5 (each builtin row carries its facts once)

Four commits. First, row metadata: the row key gives the fact kind, `Some` and `None` get an option-constructor role in the prelude table, the parallel core row path goes, and the Schema rows come from `SCHEMA_BUILTINS` with their own operation names. Second, option facts: the fact records the `on` and `fields` parts that lowering now reads again. Third, resolver roles: `Defect` and the `layer` service argument are resolved once and read as roles. Fourth, the builtin instance codec: `ids.ts` holds the list of instance names and a typed `builtinInstanceName`, and `tables.ts` and the emitter use them. Arity checks keep their diagnostic order on invalid input. The IR does not change.

- C.H1: each row writes the fact kind that its key already gives.
- C.H2, C.H3: collection builtin names and arities are written in four places, and the emitter parses the name out of a string id.
- C.H4, C.S2, C.X3: the Schema op set is typed twice by hand, and 16 identical rows repeat `SCHEMA_BUILTINS`.
- C.H5, C.H6: lowering reads the `on` and `fields` options again after the checker read them.
- C.N1: `refCall` and `collectionCall` dispatch on the name a second time.
- C.N3, C.N4: the concurrency option parser lives in the body checker, and one family imports another.
- C.S1, C.X1, B.S2, B.S3: `Some` has its own registry path with three exports for one test.
- C.X2: rows with their own arity skip the shared prologue.
- B.X2, A.X1: `Some` and `None` are tested by name in eight branches over five files.
- A.H9, A.X2: the resolver tests the callee text `"layer"`.
- A.X4, B.H7, B.X3: the `Defect` arm is found by text in the resolver and again in the checker.

### UNF6 (syntax shape decoders live in `syntax_queries.ts`)

Shared decoders return the parts of a function header, a field expression, and an arrow parameter list, with optional nodes for recovery. They decide no checker or inference policy. Every listed caller uses them, including the callers that astra found. The arithmetic operator set moves to `syntax_queries.ts`. One literal-fit rule beside the type table serves the callers with the same rule.

- B.H9: six copies extract the parameter list, the result, the `fails` clause, and the `with` clause.
- B.H10, D.H10: the field expression shape and the pipe stage argument order are copied in several files.
- B.H12: three tests decide whether a literal fits a primitive. The concurrency check is a different rule and stays.
- B.H14, B.X10: the arithmetic operator set is spelled three ways.
- B.H15: the inference engine repeats several decoders of the checker. The two walkers stay.
- Astra: `predicate_source.ts`, `lower.ts`, `check_builtins/schema.ts`, `check_builtins/scope.ts`, and `requirement_provenance.ts` also decode arrows or fields.

### UNF7 (nominal predicates, the recursion guard, and function types have one home)

`TypeTable` answers precise queries that keep tagged records, untagged identities, errors, opaque declarations, and aliases apart, and that keep an undefined result. Callers whose rule is the same use them. One checker-side `recursion_guard.ts` holds Rule 11 and the tag walk. It does not import the table implementation. One constructor builds a function type from a signature and its contract. Only the identical construction paths use it. The primitive set comes from one table, the two unit rows share one builder, and the unit arithmetic moves to the arithmetic rules as data.

- B.H1, B.H2: the nominal-id test and the record-body lookup are re-derived at about a dozen sites. Some variants differ on purpose and stay.
- B.H3, B.H4, B.N3: Rule 11 is split over `types.ts`, `type_lower.ts`, and two tag walks.
- B.H6, B.H21, B.X4, D.N4, D.X4: function types with checked inputs are assembled four times.
- B.S5: `idName` copies `shortName` without the reserved branch. UND1 decides the output change.
- B.S8, B.X9: the primitive set and the unit rows are restated.
- B.N7, B.X6: the unit arithmetic tests `Duration` and `Instant` by id.

### UNF8 (one linear arithmetic module)

A new `linear.ts` holds the linear expression type, the merge, the difference test, and the comparison operator table. `predicate_source.ts` and `check_refinements.ts` use it. Each keeps its own term key and its own normalization, because the keys never meet and the simplifiers differ. Predicate JSON, certificates, and search order stay. The validator does not import `linear.ts`.

- D.H1: two operator tables turn a comparison into a difference bound.
- D.H2: the difference-shape test is written twice.
- D.H3: the linear type and the merge loop exist twice.

### UNF9 (one project loop and one interface build)

First, the module step returns the type graph and both interface identities in one result. Then one driver in `check_project.ts` takes explicit cache decisions, and `db.ts` keeps its memo storage, its revisions, its span-only refresh, its counters, and its recovery after a failed configuration. The checked module states whether it can be lowered. The in-memory solver version goes. The proof budget default exists once.

- D.H5: the project loop exists in `checkAnalysis` and in `Program.check`.
- D.H6, A.H11: `db.ts` rebuilds the interface and its hash by hand.
- D.H7: the type graph is built twice for each module.
- D.N3: `Program` knows the internals of `CheckedModule`.
- D.N2, D.S4: `db.ts` imports the solver for a version constant that cannot change in memory.
- D.S5: the proof budget has two defaults.
- D.N5: the lowerer decides from raw diagnostics whether a module has errors.
- D.H16: a comment states a link that no longer exists.

### UNF10 (the project driver holds only scheduling)

The service-bound policy becomes functions with explicit inputs and diagnostic results, in a module with `requirement_provenance.ts` and `contract_origins.ts`. Initialization builds its edges and reports its cycles in `initialization.ts`. The order of analysis, inference, body checks, service bounds, and initialization diagnostics stays.

- D.N1: `check_project.ts` holds five jobs that change for different reasons.
- D.H8: the initialization edges are built in two files.
- D.X7: the driver builds four diagnostic families inline.

### UNF11 (the configuration reader leaves the module loader)

`project.ts` splits into the configuration reader and the module loader. Import planning for lowering moves behind one project query that keeps companion exports, merged services, binding order, and the prelude demand.

- A.N5: `project.ts` mixes the configuration reader and the module loader.
- D.N6, D.X2: the lowerer knows the link model and the service merge rule.
- D.X1: the `.effi` export rule sits in the lowerer.

### UNF12 (the emitter naming ledger has two phases)

`ModuleState` gets an explicit finish step. After finish, an allocation is an internal error, and only finish gives the imports. First-use order, helper order, import sorting, and name collisions stay. The id helpers and `relativeSpecifier` leave `module_state.ts`. The host assertion mark carries a typed payload instead of a name, and rendering still assigns the ranges. The helper declarations live in one file.

- E.H1: the build order is a contract that only comments state.
- E.N3: `module_state.ts` mixes five jobs.
- E.H2: the host assertion range travels by a string key and is rebuilt three times.
- E.S3: one file has two copies of the import-alias text.
- E.S4: the helper declarations are split between two files.

### UNF13 (hover uses one emitter function)

The emitter exports one function that returns the backend type text of a declaration as a Result. `typescript.ts` calls it and no longer catches `EmitFailure`. The successful-emission rule, normalization, flat width, and the unavailable result stay. UND2 moves the test-only decoder.

- E.N1, E.N2, D.N7: hover builds a `ModuleState` and catches the emitter exception.
- E.S2, D.S2: the decoder functions have no product caller (UND2).

### UNF14 (the emitter leaf list and its walkers)

`LeafCallKind` comes from `ROWS`, and leaf emission stays exhaustive. Recursive predicates that follow names with the same stopping rule share one structural child query. `LOG_SEVERITY` comes from the level names. Unused exports and the stale header comment go. The emitter dependency test changes from a filename pattern to an allowlist of the modules that emitter value imports may reach.

- E.H8: three recursive predicates repeat the name follow. The printers stay separate.
- E.H5, C.H7: the leaf marker and the leaf call list must agree.
- C.S4: `LOG_SEVERITY` repeats the six level names.
- E.S1, C.N5: an export without users, and a stale header comment.
- Astra: `tests/emit_families_test.ts` recognizes checker modules by filename, so a new checker module escapes the rule.

### UNF15 (the validator separates its tables from its checks)

`World`, `Ctx`, and `buildWorld` move to a table module. The check groups of `world.ts` become their own files. One prelude table seeds `buildWorld` and answers the reserved-error test. One `effectOf` constructor builds an active effect. The two walkers that report depth share one walk. Each other walk keeps its stopping rule and its report path. `markCheckedRaw` lists each kind. First, `scripts/rules_unfired.ts` recognizes any report receiver, with a test, so that it can watch the move.

- F.N1, F.N2: `Ctx` lives in `world.ts`, which creates a cycle, and `world.ts` holds five unrelated groups.
- F.H4: two walkers repeat the depth bound and the depth report.
- F.H1, F.H2, F.X1: the reserved error test is written three times and seeded with literals.
- F.H3: one fallback span is written five times.
- F.H6: `isRecord` and `isObject` are the same function.
- F.H7: two sorts rely on default string order beside an explicit comparator.
- F.H8: `markCheckedRaw` has a default that hides a missing kind.
- F.N3, F.N4: the core result types and `EFFECT_ONLY` live in the family folder. `streamState` stays there, because two families use it.
- F.N7: `sets.ts` holds a message formatter.
- F.S2: a pass-through type alias re-derives `AreaCode`.
- H.X6: `rules_unfired.ts` recognizes report sites by receiver spelling.

### UNF16 (one log schema)

A new `src/host/log_schema.ts` holds the data type of every record kind, including `cli.start`, `cli.change`, and `cli.tsc`, the session file name with its parser, and envelope parsing with an explicit policy for the endpoint and for old logs. It holds data and pure parsing only. The language server opens its log through the host port. `src/cli/args.ts` exports the argument rule that the replay needs. Record field order stays.

- G.H4: the session file name format is written three times, and one reader slices by fixed offsets.
- G.H5: about 80 kind and field literals in six files have no shared type.
- G.H6: the log endpoint re-states `Envelope` and has its own `isRecord`.
- G.H7: the language server bypasses the host log port.
- G.H17: the replay knows which flags the CLI adds for logging.

### UNF17 (one stale-output rule)

The stale-output transition is a pure helper in the TypeScript output layer, exported through `typescript.ts`. The language server and the playground use it and keep their own lifecycles. The playground keeps the tagged hover backend instead of flattening it to a text. One page-level helper gives the saving label to the playground and the replay. The generated-text subscriptions move to their own language server module.

- G.H1: the last-good and stale rule is in the language server and in the playground.
- G.H2, G.X1: the "backend type: not available" text is typed twice and used as a flag.
- G.H3: the saving-label rule is copied into the replay.
- G.N8: the generated-text protocol state lives in the feature file.

### UNF18 (shared editor primitives)

One target-span query serves definition and the occurrence index. One helper applies edits and builds the speculative revision. Each caller keeps its own acceptance checks. The unused parameter goes.

- G.H10: two functions map a target to its declaration span. They agree today.
- G.H13: the edit-and-revision part of the speculative sequence is in four places.
- G.S4: one parameter is unused.

### UNF19 (one disk synchronization)

A host module reads the workspace, diffs the files, and updates the disk program. The CLI session and the language server use it. Each keeps its save, removal, ownership, and presentation policy. The language server position conversion uses one line cache.

- G.H8: the language server re-derives the reason for a held module, beside `writableModules`.
- G.H9: two disk programs are fed by two copies of the read-diff-update loop.
- G.N6: one method only wraps a function.
- G.N7: the language server has two line-start caches. The CLI keeps its one-based positions.
- G.S5: the `diskProgram` getter has only a test caller.

### UNF20 (core helpers have owners)

`canonicalJson` moves next to the hash modules, with unchanged bytes, and that module states that emitted names depend on its output. Normal scripts, the bench, and the playground use the public helpers. `behavior_corpus.ts` keeps its own copies.

- A.N4: `util.ts` mixes five helpers, and private copies of `isRecord` exist.
- A.H10: nothing states that `canonicalJson` output fixes emitted names.
- H.S7: the scripts re-implement `errorMessage`.

### UNF21 (the scripts and the bench share their mechanics)

A `scripts/lib.ts` holds `ROOT`, the shared base of the suite command lines, one process runner that keeps each caller's permissions, timeouts, environment, streams, and exit handling, a temporary-directory helper, the pretty JSON writer, and the revision export. A `bench/pairs.ts` holds the A/B alternation. Scripts and bench import public names through the entry points. Stage-timing imports in `bench/m2.ts` stay. The IR baseline source moves to a fixture. A failure probe shows that `behavior:compare` still reports a change after the unit.

- H.H1: the base of the fast-suite command is written four times.
- H.S1, H.S2, H.S3, H.S4, H.S5: ten runners, nine temp-dir patterns, seven `ROOT` spellings, two revision exports, and three pretty JSON writers.
- H.H7: the A/B alternation is copied in seven places.
- H.N1: about 15 imports reach private core modules for public names.
- H.H3: the TypeScript pin has no test.
- H.H6: the IR baseline source lives in the update script.
- H.S11: about ten exports have no user outside their file.

### UNF22 (surplus that no other fix covers)

- A.S1: `Severity` has a `warning` member that nothing produces (UND3).
- G.S2: two exports have no user outside their file.
- B.S1: `executionOf` has only test callers. The tests move to `contractSets` with the same intent.

### UNF23 (comments)

Remove comments that restate the implementation. Keep comments about outside facts, ordering contracts, the oracle boundary, and the old-tree runner. Remove a workaround comment when a fix removes the workaround. Do not change `ir.ts`, because `typed-ir.ts` copies its comments.

### UNF24 (tests)

Item added during UNU3: `tests/validate_rejections_test.ts` names each row by a `file:line` site "at the time of writing". UNU3 deleted `world.ts`, so 16 names point at a missing file, and every line move makes more names false. The test name keeps only the row name.

After every structural fix, remove tests that repeat the implementation or cannot fail. Rewrite tests that depend on internals to depend on behavior. Fault injection runs before a test goes. Tests of malformed IR, emitted order, stale state, recovery, and public APIs keep their behavioral checks.

## Kept on purpose

These items stay. The reason is given for each.

- A.H1, C.H9, D.H13: one builtin or one type kind touches several layer tables. Each table is exhaustive and compiler-checked, and the layers change for different reasons. The validator and `ROWS` copies are on purpose.
- A.H2: `TARGET_NAMES` mirrors the emitted globals, guarded by `tests/target_names_slow_test.ts`.
- A.H14: the rename gate rejects target names after speculation, with its own message. A live rename to `Math` already fails (astra).
- A.H15, C.H8: the TextMate grammar copies the prelude names. The grammar is JSON, and `tests/vscode_client_test.ts` compares it.
- A.N2: `tables.ts` is the checker-to-lowering contract. Its direction is correct.
- A.N3: generic helpers are public through `frontend.ts`, which follows the adapter rule (astra).
- A.N6, A.X8: the round cap of `modes.ts` guards the solver, and astra advises to keep it.
- A.N7: one constant import. Not worth a change.
- A.S2: the diagnostic code registry is the content of the diagnostics module.
- A.S4: `analyze.ts` is a real composition.
- A.S5: two hash algorithms serve two purposes. A change needs a measurement first.
- A.X3: `never` is a sentinel of the clause grammar, not a builtin row.
- A.X7: the two name patterns validate glob segments and complete paths on purpose (astra).
- B.H11: the three name-type functions use different local, capability, and recovery information (astra).
- B.H13: the coverage key format is local to one file.
- B.H18: union order depends on the canonical IR text on purpose. A change would change emitted text.
- B.H20: the inference order is the driver's job.
- B.N4, B.N5, B.N6, C.N2: the family context interfaces are the ports of the families.
- B.S4, B.S6, B.S7: small local helpers with real users.
- B.X5: the file mode is an enum value of the parse tree, not a path test.
- C.S3: wrong claim. `stream.ts` passes `mapEffect` (astra).
- C.X4, C.X5: the `now` and `random` branches avoid an unused Effect import, and `update-ref` chooses after callback analysis (astra).
- C.X6: run-time checks in generated text are run-time semantics.
- D.H4: the two simplifiers apply different policies (astra).
- D.H9: the declaration checker builds method types, and the driver reuses them with an import fallback (astra).
- D.H11: the IR version literal is checked by the type of `ir.ts`.
- D.H14, D.H15: the serializer set list and the span key are IR contract facts. The validator checks them separately.
- D.S1, D.S3, D.S6, D.S7: the entry points, the IR serializer, the mode map, and the query counters have documented users.
- D.X3, D.X5: the prelude demand and the occupied-name scan have no equivalent pass that keeps output (astra).
- D.X6: broken-entry suppression runs at two publication stages.
- D.X8, D.X9: validator special cases and internal guards.
- E.H3, E.X5: the three `__proto__` sites handle key syntax, shorthand, and Error repair (astra).
- E.H7: the two callback tests differ on purpose (astra).
- E.N6: the family port keeps its flags.
- E.S5: the family context interface keeps families away from `expr.ts`.
- E.X6, E.X7: fallbacks for outside input and outside tool text.
- F.H5: the alias walks answer different questions with different cycle results (astra).
- F.N5, F.X2: the concurrency checks inspect different representations and arguments (astra).
- F.N6, F.S1, F.S3, F.X3, F.X4: no defect, or documented on purpose.
- G.H11, G.H12: cursor and edit rules differ by query on purpose (astra).
- G.H14: the single-file and whole-project freshness checks guard different edits (astra).
- G.N3: the CLI logs the text that it reads back from disk. A change would change the meaning of the log.
- G.N4, G.N5, G.S3, G.S6: the save round policies, the output orders, the `write` flag, and `trackTargets` have product meaning (astra).
- G.S1: wrong claim. Tests call `withParams` (astra).
- G.X3, G.X4, G.X5: platform workarounds and outside bounds. Native Windows is out of scope.
- G.X6: UND4.
- H.H2: wrong claim. The groups and the roots are different lists (astra).
- H.H4: the bench Effect imports are already pinned by `tests/versions_test.ts` (astra).
- H.H5: the fixture generators use the test helpers on purpose.
- H.H8, H.H9: the bench configurations and timeouts differ (astra).
- H.N2, H.N3, H.N4: the replay drives the real surfaces, and the version constant has one owner.
- H.N5: the two measure scripts measure different scopes (astra).
- H.S6: `site_ir.ts` uses a different result shape (astra).
- H.S8, H.S9, H.S10, H.X1, H.X2, H.X3, H.X4, H.X5, H.X7: measurement layouts, by-hand evidence scripts, and outside workarounds.

## Units

Each unit goes to one Sonnet executor with the full context in the dispatch. The executor commits in a detached worktree under `~/.claude/scratch`, and Opus cherry-picks to `main`, reviews the diff, and runs `deno task check` and `tests/ir_site_slow_test.ts` in the main tree.

| Unit | Fixes | Main files | Acceptance check | Budget |
| --- | --- | --- | --- | --- |
| UNU5 | UNF21, H.X6 of UNF15 | `scripts/**`, `bench/**`, `tests/versions_test.ts` | gate; failure probe of `behavior:compare`; `mutate` smoke run; `rules:unfired` count unchanged | 80 calls |
| UNU1 | UNF3 | `result.ts`, `source.ts`, `ir.ts`, `predicates.ts`, checker env leaf, `types.ts`, `type_ir.ts`, `lsp/handler.ts`, `host/ports.ts`, emitted-module types | gate; `typed-ir.ts` differs only by the `Result` block; the cycle gate of UNF3 | 70 calls |
| UNU2 | UNF1, UNF2, UNF20 | `ids.ts`, `paths.ts`, `lex.ts`, `parse.ts`, editor files, emitter literals, adapters, `extension.js` tests | gate | 90 calls |
| UNU3 | UNF15 | `src/core/validate/**` | gate; `validate` records of `behavior:compare` unchanged | 70 calls |
| UNU4 | UNF12, UNF13, UNF14, UND2 | `src/core/emit/**`, `typescript.ts`, source map tests, `docs/api.md` | gate; golden files and maps unchanged | 90 calls |
| UNU6a | UNF8, UNF11 | `linear.ts`, `predicate_source.ts`, `check_refinements.ts`, `project.ts`, the configuration reader, `lowerImports` in `lower.ts` | gate; IR and diagnostics unchanged | 80 calls |
| UNU6b | UNF9, UNF10 | `check_project.ts`, `db.ts`, `interface.ts`, `initialization.ts`, the service-bound module, `lowerModule` in `lower.ts` | gate; incremental and revision tests pass | 100 calls |
| UNU7 | UNF4, UNF5 | `effect_set.ts`, `tables.ts`, `modes.ts`, `check_builtins/**`, `resolve.ts`, `check_expr.ts`, `check_patterns.ts`, `infer_inputs.ts`, `lower.ts`, `ids.ts` | gate | 90 calls |
| UNU8 | UNF6, UNF7, UND1 | `syntax_queries.ts`, `recursion_guard.ts`, `types.ts`, checker files | gate | 90 calls |
| UNU9 | UNF16 | `host/log*.ts`, `lsp/wire_log.ts`, `lsp/main.ts`, `cli/args.ts`, playground log files, `scripts/logs_*.ts` | gate; `logs:replay` of the fixture logs | 80 calls |
| UNU10 | UNF17, UNF18 | `typescript.ts`, core editor files, `lsp/features.ts`, playground compile files, `cli/fix.ts` | gate; browser check of the playground | 90 calls |
| UNU11 | UNF19, UNF22 | `host/**`, `lsp/projects.ts`, `cli/session.ts`, `diagnostics.ts`, `signatures.ts` | gate | 80 calls |
| UNU13 | UNF23 | all source directories, one executor for each area | gate; `typed-ir.ts` unchanged | 60 calls each |
| UNU14 | UNF24 | `tests/**` | gate; coverage floors; fault injection | 80 calls each |

Order. UNU5 runs first, so that the comparison tools are fixed and probed before they judge other units. UNU1 runs at the same time as UNU5, because UNU1 does not touch the tools and its check is the gate. UNU2 follows UNU1, because both touch many files. UNU3, UNU4, UNU6a, and UNU6b then run in parallel worktrees. Their only shared files are the coverage inventory files and import lines in `lower.ts`. UNU7, UNU8, UNU9, UNU10, and UNU11 run one after the other, each on the result of the previous unit. UNU13 and UNU14 run last.

## Final checks

Empirical checks, each with its command output recorded in the evidence folder:

- `deno task check` passes in the main tree, with the sibling website present.
- `deno task behavior:compare 30bb1d5 <final commit>` reports no changed record. The corpus does not cover editor, CLI, or language server responses, so the surface snapshot and the adapter tests cover those.
- `deno task coverage` holds the floors.
- Directed `deno task mutate` runs on each new module and on each module whose logic moved. Each survivor gets a test or a register row.
- Fault injection: for a sample of moved rules, a deliberate fault must make at least one test fail.
- `deno task logs:replay` passes for the fixture logs and for the local session logs.
- `deno task bench --quick m1 m2 m6` at `30bb1d5` and at the final commit. A slowdown above the A/A noise floor is a finding.
- A browser session checks the playground source selection, output selection, hover, and stale output.
- `../effektive` website tests pass.

Adversarial reviews, after the empirical checks:

- Codex astra and a Fable subagent each review the full diff from `30bb1d5`, independently, with the instruction to find behavior changes, broken contracts, and new hidden links.
- Fresh survey agents repeat the inventory of hidden links, needless links, surplus, and special cases. The work repeats until no finding is worth a fix.
- Opus resolves each finding, or records why it rejects the finding.

## Progress

Each row names the commits on `main` and the main-tree gate result.

| Unit | Commits on `main` | Main-tree gate |
| --- | --- | --- |
| UNU5 | `66a2690`, `d3c5941`, `5c1de56`, `955378e`, `51de8a9` | passed |
| UNU1 | `748d597` to `17d063d` (7 commits), website `9a27abf` | passed |
| UNU2a | `b5f5d33`, `7076a43`, `71933fa` | passed, 285 slow tests |
| UNU2b | `b40a5c5`, `aa17934`, `899ce2e` | passed, 2906 fast and 285 slow tests |
| UNF20 rest | `0ba4ac4` (the bench uses the core `isRecord`; `scripts/coverage.ts` keeps its copy, because its slow test runs it with a stub `mod.ts`) | passed |
| UNU3 | `9c0cce5` to `e46afc7` (7 commits) | passed, 2906 fast and 285 slow tests; `rules:unfired` site set unchanged; `behavior:compare 51de8a9 974d5c8` 56 equal `validate` records |
| UNU6a | `954e40e`, `339260d`, `f29c431`, and Opus fix `8086a84` (the comparison bounds stay in `predicates.ts`, which removes a new `linear.ts` cycle) | passed, 2906 fast and 285 slow tests |
| UNU6b | `58aa29f`, `ae8831d`, `b16a5f2`, `e96e20d` | passed, 2906 fast and 285 slow tests; `behavior:compare 30bb1d5 e96e20d` 0 changed records in every family |
| UNU4 | `1094d8d` to `8abfb9e` (6 commits) | passed, 2909 fast and 285 slow tests |
| UNU9 | `c1b4fc7`, `cbd0d69`, `d44a98f`, `242a1df`, and Opus fix `9212709` (the schema loads through `frontend.ts`; literal test values) | passed, 2919 fast and 285 slow tests; `logs:replay` exits 0 for the six fixture logs |
| UNU11 | `19877bb`, `f60928f`, `eccf608`, `9b7edb7`, and Opus fix `7a4ae47` (the `writableModules` wrapper goes) | passed, 2919 fast and 285 slow tests |
| UNU10 | `1995b63`, `0ff62a8`, `45acb4a`, `9b2fc2c`, `ef73b41` | passed, 2924 fast and 285 slow tests; browser check passed (see below) |
| UNU7 | `f73d493`, `1e6d3d0`, `2c0b478`, `ab67ab2`, `ae03246` | passed, 2925 fast and 285 slow tests; `behavior:compare 30bb1d5 48b73d5` 0 changed records in every family |
| UNU8 | `5ca3616` to `c47452c` (7 commits), and Opus fix `db02d03` (UND1 in the named display branch) | passed, 2927 fast and 285 slow tests; `behavior:compare 30bb1d5 db02d03` 0 changed records |
| UNU13 (emitter, validator, adapters, scripts, bench) | `bc85a23`, `d04b2cc`, `aab3a26`, `47be5f9`, `01ddad1`, `6f6bfec`, `2d1c21b`, `0562621`, and Opus fix `b012df3` | passed |
| UNU13 (core) | `0872f74`, `49de945`, `f25c7ca`, `f9c7fcc` | passed after the rerun noted below |
| UNU14 T1 to T3 | `6e66d36`, `a9a0fa2`, `00dafc9`, `ffa7498`, `e738463`, `fc3c62a`, `7658101` | passed on a quiet machine, 2922 fast and 285 slow tests |
| UNU14 T4 to T6 | `ec978d4` to `16f1aea` (9 commits) | fast suite passed; the final gate covers them |
| Final checks, round 1 | `749ce2c` (a test for the `linear.ts` survivor), `1346acb` (UND1 capability test) | fast suite passed |
| Round 2 | `bb878ce` to `ee84fca` (21 commits) | fast suite passed, 2917 tests; the final gate covers them |

Decisions made at integration:

- UNU6b puts the lowering block list on `CheckedProject.blocked`, not on each checked module, because checked modules are shared across revisions and the block depends on project diagnostics. A test or tool that forges a checked project without diagnostics must also clear `blocked`.
- UNU4 shares no walker for E.H8: the stopping rules of `containsFunction`, `checkKind`, and `needsFieldAdapter` differ. E.H8 moves to the kept list.
- UNU4 defines the mark payload type in `doc.ts`, because a definition in `emitted_module.ts` makes a type cycle. The renderer is private to the emitter.
- UNU11 removes the warning filter of the playground `tabCounts`, because `Severity` is only `"error"` (UND3). Three playground test expectations change for that reason only. G.N7 is partly done: `src/lsp/features.ts` still builds line starts for each call, because UNU10 owns that file. That note was wrong: after UNU10, `rangeOfSpan` in `features.ts` still built one line table for each span, so a references answer built it once for each hit. The round-2 survey found this. Commit `ee84fca` converts the spans of one request through one `rangeConverter`.
- UNU10 shares the hover text "backend type: not available while the module has errors" as one core constant, and both clients branch on the hover backend tag, not on the text.
- UNU7 records `Defect` arms as `ModuleResolution.defectArms`, not as a new target kind, because the editor index walks every target. The `layer` test reads the prelude `service-argument` role with the same text rule, so a program that declares its own `layer` gets no new diagnostic. C.X2 stays: rows with their own arity skip the shared prologue to keep the diagnostic order.
- UND1 is done in both display paths: `c47452c` prints the effect lists with short names, and `db02d03` prints a reserved error type with its short name. Before, a type mismatch said "but error:effect/SchemaIssue is expected". UNU8 keeps the collision key of `showTypes` as the part after `#`, so a reserved id never groups with a user name, and a user cannot declare a reserved name.
- UNU8 leaves on purpose: the forced effect mode and the injected `SchemaError` in `checkFunctionBody`, the `written.result` branch in `lower.ts`, the binding compare in `check_declarations.ts`, and several nominal variants whose rules differ (listed in the UNU8 handback).
- The comment pass removed about 400 comment lines over all areas and fixed two false comments: a misplaced doc in the validator `typing.ts`, and the union order in `types.ts`, which sorts by the canonical IR text, not by ref.
- The test pass in T1 to T3 removed 7 tests and assertions that could not fail or that duplicated a kept test, and rewrote 12 tests from private state to observable output or literal values. Each removal has a fault-injection line in its commit body. The executors read only part of the bodies; the unread files are listed in their handbacks, and the final surveys cover them.
- A main gate after UNU13 failed in `tests/installation_slow_test.ts` with different VSIX bytes. The cause: each scratch worktree linked `editors/vscode/node_modules` to the main tree, and the test runs `npm ci` there, so parallel gates reinstalled the packages during packaging. The test passed alone, and later worktrees copy the directory.
- Browser check at `ef73b41` with Playwright: a `.effi` tab shows no saving label; hover on `getUser` shows the Contract and Backend type blocks as code; after a breaking edit, the output pane shows the last good text under the banner, the saving label goes, the tabs show the error counts, and hover on a module with errors shows the unavailable note as plain text; after undo, the banner is hidden and the saving label returns.
- UNU9 keeps field reads in the log readers loose, because old-log replay must stay tolerant. The writers are typed.

The failure probe of `behavior:compare` is the pair `f9b358f~1 f9b358f`. It exits 1. The earlier pair `3ab7c4b 30bb1d5` gives identical corpus output, so it cannot probe a failure.

UNU2b found three defects in modifier decoding: a comment between `opaque` and `type`, a parameter named `borrow`, and `borrow/*c*/h` without a space. Commit `899ce2e` fixes them, and `tests/modifier_decoding_test.ts` failed before the fix.

`deno task coverage` sometimes stops with "no LCOV record: src/lsp/main.ts", in scratch worktrees and once in the main tree, while other executors run gates. A rerun on main at `fdf4539` passed: lines 97.31, branches 95.22, functions 99.22 (baseline 97.28, 95.20, 99.21). The probable cause is machine load on the language server child process. An earlier note here blamed the `.claude` path, which was wrong.

## Round 2 survey

Four fresh survey agents repeated the inventory at `749ce2c`, one for each pair of first-round slices. Their reports are `round2-R1.md` to `round2-R4.md` in the evidence folder. Opus checked each claim in the code before a decision.

Fixed:

- B.H15 rest: `optionElement` was the same function in `check_expr.ts` and `infer_inputs.ts`. `TypeTable.optionElementOf` replaces both (`1604ac6`).
- B.H1 and B.H2 rest: the alias-or-record body lookup was written twice. `TypeTable.declaredBodyOf` replaces both, and the deferred-type walk calls `isErrorOrTagged` (`d43e4f1`).
- B.H10 sibling: a record field decoder was written in the checker, the schema port, the effect family, and the lowerer, and the name `fieldParts` meant two things. `recordFieldParts` and `memberAccessParts` in `syntax_queries.ts` replace them (`bb878ce`, `a339e3f`). `requirement_provenance.ts` and `resolve.ts` decode by another rule and stay.
- A.H6 rest: the editor index read the service header role from raw text. It uses `hasModifier` (`50fa6aa`).
- Five exports had no outside user (`74919f1`). A lowering site sliced an id by hand (`560f559`). A doc comment named the wrong caller (`e8b6ab4`). The playground build imported `Result` past the entry points (`26b0eee`).
- F.H6 rest: `validate_project.ts` copied `isRecord` and the prelude module name of the validator (`ac37da8`).
- A new hidden link: `spanTable` in `typescript.ts` copied the host name loop of `hostImportSpans`, so the tested copy was not the product copy. `hostNameSpans` serves both (`e15d394`).
- A new hidden link: `fieldHelper` took four keys as plain strings. `FieldHelperKey` types them (`1d9192e`).
- H rest: the m2 harness wrote the A/B alternation by hand (`0fca56b`), and `withTempDir` had an unused option (`a903835`).
- G.N7 rest: see the note above (`ee84fca`).
- Tests: eleven tests could not fail on a regression, repeated the code, or checked only a count or a difference (`ab2166d` to `bea794c`). Each commit body holds a fault that the old test missed and the new test catches.

Rejected, with the reason:

- `LeafCallKind` in `emit/calls.ts` is still a list, although the message of `1094d8d` says that the kinds come from the table. The `default` branch of the leaf switch indexes `LEAF_CALLS` with the remaining kinds, so a new leaf kind without an emitter is a type error. The list adds no unchecked link.
- `FAMILY_ROW_TABLES` has only a test reader. It is the census list beside `FAMILY_ROWS` in the same file, and the test guards a silent override of a spread key.
- The three builtin instance parsers in `ids.ts` stay apart: the untyped one keeps an internal error for an unknown instance name in a malformed IR.
- Marginal items stay until a change touches them: the `Solved` type beside `EffectSet` (the join rule differs), the string-encoded comparison class in `check_binary.ts`, the integer-valued type test in two refinement files, the `guardedRecord` callback, the collision loop in `check_expr.ts`, the constant `on` in the Schema fact (C.H5), and the one-caller types of the service bounds.
- `DefinitionSource` in `type_ir.ts` stays a copy: a `Pick` of the signature types makes an import cycle, and the checker compiles the match.

## Adversarial reviews

Codex astra and a Fable subagent reviewed `30bb1d5..749ce2c` independently, each in its own worktree. Their reports are `adversarial-astra.md` and `adversarial-fable.md` in the evidence folder. Both ran `behavior:compare` with no changed record. Astra also compared 2,224 inline inputs, 4,000 source mutations, 2,000 malformed IR mutations, 18 incremental updates, and the language server and CLI watch flows. Fable compared 535,077 editor and output records over 27 fixture projects.

- Astra, CONFIRMED: a `Scope` requirement now prints as `Scope`, not `cap:effect/Scope`, in hover contracts and type mismatch messages. This is the UND1 defect in the requirement set, so the change stays. UND1 now names the case, and `1346acb` pins it with a test that fails at `30bb1d5`.
- Fable F1, PLAUSIBLE: the checker recorded the syntax index of the `fields` option of `log` and the `on` option of `schemaDefaultKey`, and the lowerer indexed the IR record fields with it. The two arrays agree only while every child is a plain field. Fixed in `1a5ec90`: the facts hold the option label, and the lowerer finds the field by name, as before `2c0b478`.
- Fable F2, PLAUSIBLE: the program policy carried its memo keys from `decide` to `settled` through a mutable closure. Fixed in `75a0772`: `ModulePolicy` is generic over its decision type, and the memo decision holds its keys.
- Fable F3, PLAUSIBLE: a forged `CheckedProject` must fill `blocked`, and a forged `ModuleResolution` must fill `defectArms`. Kept: the types require both fields, and no product path forges them. The UNU6b and UNU7 integration decisions above record both links.
- Fable F4, PLAUSIBLE: for a module with a merged service import, a later import without an interface, and a name without a resolver target at the same time, `lowerImports` now reports the internal missing-target error before `no-interface`. Kept: it needs two faults at once, a module with diagnostics never lowers, and a missing target is a resolver defect.

## Mutation survivors

The directed run at `749ce2c` covered 19 new or moved modules and left 65 unregistered survivors and one timeout. The survivors were old test gaps that the moves exposed: the register had no row for any of these modules. Four Sonnet units handled them in detached worktrees, and Opus checked each `equivalent` reason against the code before integration.

| Unit | Modules | Tests | Rows | Commit |
| --- | --- | --- | --- | --- |
| S1 | `effect_set.ts`, `paths.ts`, `ids.ts`, `syntax_queries.ts`, new `flattenUnion` | 17 | 5 | `8a12c06` |
| S2 | `project_config.ts`, `recursion_guard.ts` | 5 | 9 | `1de3adb` |
| S3 | `validate/recursion_checks.ts` | 11 | 6 | `dff317d` |
| S4 | `validate/declaration_checks.ts`, `import_checks.ts`, `type_checks.ts` | 15 | 1 | `e44dff2` |

Each `equivalent` row rests on a code fact and a differential probe against a mutated copy. The timeout at the alias cycle guard of `recursion_checks.ts` is explained: under that mutant, `tests/guarded_recursion_cases_test.ts` never ends on a cyclic alias chain.

Fault injection: five hand faults in moved data tables, which mutation does not reach, each made a fast test fail. They were the declaration role of `provider`, the role of `where`, the session file name, the stale flag of `stepOutput`, and the unavailable hover text.
