# RC3 redundant-check ledger

Scope: the checker, the refinements, the lowering, and the types, as listed in the audit brief, at commit e16f546. Each census line appears once in the table.

AREA is `src/core/check_builtins/` and the files `src/core/{check_binary,check_declarations,check_expr,check_patterns,check_project,check_refinements,infer_contracts,infer_inputs,types,type_ir,type_lower,type_show,signatures,predicates,predicate_source,linear,lower,service_bounds,modes,contract_origins,requirement_provenance,initialization,effect_set,tables,patterns,recursion_guard,referenced_ids,body_env}.ts`.

Census commands and counts:

- P1: `git grep -n -E '\.get\([^)]*\) \?\? ' -- AREA` gives 23 lines.
- P2: `git grep -n -E 'typeof [a-zA-Z_.]+ [!=]== "' -- AREA` gives 28 lines.
- P3: `git grep -n 'isRecord(' -- AREA` gives 0 lines.
- P4: `git grep -n -E '=== undefined\) (return|continue|throw|break)' -- AREA` gives 84 lines.
- P5: `git grep -n -E 'throw (new Error|internal)\(' -- AREA` gives 35 lines.

P3 has no lines. The IR validators use `isPredicateRecord`, which has no `isRecord(` call. `predicates.ts:528` is in the P2 rows.

Decisions by pattern (removed / restructured / kept):

- P1: 0 / 1 / 22
- P2: 0 / 0 / 28
- P3: 0 / 0 / 0
- P4: 0 / 0 / 84
- P5: 2 / 0 / 33

P6 (other redundant checks found while reading): none found beyond the rows above. A search for `.has(k)` followed by `.get(k)`, for `.get(k)!`, `.get(k) as`, and `.get(k)?.` in AREA gave no lines.

Changed declarations: `checkInitialization` in `initialization.ts` and `solveModeGroup` in `modes.ts`. No declaration with a row in `fixtures/mutation/survivors.json` changed.

| Site (file:line at e16f546) | Pattern | Decision | Reason or proof |
|---|---|---|---|
| src/core/check_expr.ts:412 | P1 | kept | multimap default |
| src/core/check_expr.ts:670 | P1 | kept | side-table fact: a local type can be unset while its binding is pending |
| src/core/check_project.ts:291 | P1 | kept | side-table fact: the inference pass fills this map and can skip an id |
| src/core/check_project.ts:297 | P1 | kept | side-table fact: constantTypes is filled by another pass |
| src/core/check_project.ts:436 | P1 | kept | overlay of two maps; either map can lack the id |
| src/core/check_project.ts:740 | P1 | kept | counter default |
| src/core/check_project.ts:745 | P1 | kept | counter default; a module can have no named diagnostic |
| src/core/contract_origins.ts:32 | P1 | kept | two tables; a node is in at most one of them |
| src/core/infer_contracts.ts:119 | P1 | kept | multimap default |
| src/core/infer_contracts.ts:134 | P1 | kept | multimap default |
| src/core/infer_contracts.ts:156 | P1 | kept | multimap default |
| src/core/infer_contracts.ts:177 | P1 | kept | multimap default |
| src/core/infer_contracts.ts:186 | P1 | kept | multimap default |
| src/core/infer_contracts.ts:228 | P1 | kept | multimap default |
| src/core/lower.ts:485 | P1 | kept | only resource-bound locals have an entry |
| src/core/modes.ts:99 | P1 | restructured | solved holds every pending id from the start; the loop now iterates the entries of solved |
| src/core/modes.ts:100 | P1 | kept | computed omits an id with no result; PURE is the normal state |
| src/core/patterns.ts:160 | P1 | kept | multimap default; a member can lack the field |
| src/core/predicates.ts:415 | P1 | kept | distance holds every node, but the type cannot carry this without `!` |
| src/core/predicates.ts:416 | P1 | kept | distance holds every node, but the type cannot carry this without `!` |
| src/core/predicates.ts:428 | P1 | kept | predecessor has no entry for a node that was never relaxed |
| src/core/recursion_guard.ts:149 | P1 | kept | accumulator default |
| src/core/type_show.ts:28 | P1 | kept | multimap default |
| src/core/check_builtins/context.ts:85 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_builtins/effect.ts:306 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_builtins/effect.ts:740 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_builtins/schema.ts:1213 | P2 | kept | narrows the literal value union; the string is then used |
| src/core/check_builtins/stream.ts:169 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_builtins/stream.ts:404 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_expr.ts:448 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_expr.ts:449 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_expr.ts:637 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_expr.ts:1156 | P2 | kept | narrows the fact union to call or use it |
| src/core/check_expr.ts:1163 | P2 | kept | narrows the arity union to call or use it |
| src/core/check_patterns.ts:286 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_patterns.ts:376 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:169 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:283 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:304 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:371 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:437 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:466 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/check_refinements.ts:469 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/predicate_source.ts:320 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/predicate_source.ts:330 | P2 | kept | narrows a literal value union that TypeScript needs |
| src/core/predicates.ts:327 | P2 | kept | entry point: predicate JSON from an imported graph |
| src/core/predicates.ts:453 | P2 | kept | entry point: predicate JSON from an imported graph |
| src/core/predicates.ts:495 | P2 | kept | entry point: predicate JSON from an imported graph |
| src/core/predicates.ts:506 | P2 | kept | entry point: predicate JSON from an imported graph |
| src/core/predicates.ts:528 | P2 | kept | entry point: unknown value; this is the isRecord check of the predicate IR |
| src/core/recursion_guard.ts:21 | P2 | kept | narrows the literal value union to a string |
| src/core/check_binary.ts:28 | P4 | kept | identityBaseOf has no base for a non-identity type |
| src/core/check_binary.ts:104 | P4 | kept | loop state: a member with no comparison class has no key |
| src/core/check_builtins/effect.ts:246 | P4 | kept | optionField reports a bad field and returns undefined |
| src/core/check_builtins/effect.ts:580 | P4 | kept | optionField reports a bad field and returns undefined |
| src/core/check_builtins/schema.ts:299 | P4 | kept | the option is optional in source |
| src/core/check_declarations.ts:276 | P4 | kept | parser recovery can omit the child |
| src/core/check_declarations.ts:471 | P4 | kept | side-table fact: a nominal type can have no alias body |
| src/core/check_declarations.ts:701 | P4 | kept | side-table fact: an alias can lack a lowered body |
| src/core/check_declarations.ts:919 | P4 | kept | the binding function is optional |
| src/core/check_expr.ts:376 | P4 | kept | an unrefined type has no predicate |
| src/core/check_expr.ts:461 | P4 | kept | the caller's expected type is optional |
| src/core/check_expr.ts:568 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:618 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:657 | P4 | kept | an unresolved name has no target |
| src/core/check_expr.ts:709 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:948 | P4 | kept | the method type can be a non-function |
| src/core/check_expr.ts:1428 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:1430 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:1480 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:1664 | P4 | kept | the caller's expected type is optional |
| src/core/check_expr.ts:1710 | P4 | kept | the pool can be absent or empty |
| src/core/check_expr.ts:1728 | P4 | kept | an unresolved name has no target |
| src/core/check_expr.ts:1752 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:1921 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2350 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2353 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2437 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2493 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2626 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2637 | P4 | kept | parser recovery can omit the child |
| src/core/check_expr.ts:2668 | P4 | kept | parser recovery can omit the child |
| src/core/check_patterns.ts:100 | P4 | kept | missingOf has no answer for an open domain |
| src/core/check_patterns.ts:160 | P4 | kept | parser recovery can omit the child |
| src/core/check_patterns.ts:375 | P4 | kept | parser recovery can omit the child |
| src/core/check_project.ts:704 | P4 | kept | side tables from analysis; a failed import can leave a module without a resolution |
| src/core/check_refinements.ts:109 | P4 | kept | the initializer is optional |
| src/core/check_refinements.ts:150 | P4 | kept | an unsupported condition has no predicate |
| src/core/check_refinements.ts:161 | P4 | kept | an unsupported condition has no predicate |
| src/core/check_refinements.ts:185 | P4 | kept | an unrefined type has no predicate |
| src/core/check_refinements.ts:208 | P4 | kept | an unsupported term has no linear form |
| src/core/check_refinements.ts:246 | P4 | kept | an unsupported term has no linear form |
| src/core/check_refinements.ts:275 | P4 | kept | an unsupported expression has no path |
| src/core/check_refinements.ts:322 | P4 | kept | parser recovery can omit the child |
| src/core/check_refinements.ts:336 | P4 | kept | parser recovery can omit the child |
| src/core/check_refinements.ts:346 | P4 | kept | an empty path has no root |
| src/core/check_refinements.ts:348 | P4 | kept | side-table fact: the root of a path can be a non-local |
| src/core/check_refinements.ts:512 | P4 | kept | an unsupported term has no linear form |
| src/core/check_refinements.ts:526 | P4 | kept | an unsupported term has no linear form |
| src/core/check_refinements.ts:534 | P4 | kept | a difference can have no supported shape |
| src/core/check_refinements.ts:559 | P4 | kept | a difference can have no supported shape |
| src/core/contract_origins.ts:35 | P4 | kept | a node can have no effect set |
| src/core/infer_contracts.ts:93 | P4 | kept | the type is optional |
| src/core/infer_contracts.ts:218 | P4 | kept | a contract can be a non-callable type |
| src/core/infer_contracts.ts:236 | P4 | kept | a field type can be unknown |
| src/core/infer_contracts.ts:318 | P4 | kept | the type can be a non-record |
| src/core/infer_contracts.ts:321 | P4 | kept | a required field can be absent |
| src/core/infer_contracts.ts:343 | P4 | kept | a named type can have no nominal body |
| src/core/infer_inputs.ts:143 | P4 | kept | a parameter id is optional |
| src/core/infer_inputs.ts:294 | P4 | kept | parser recovery can omit the child |
| src/core/infer_inputs.ts:305 | P4 | kept | parser recovery can omit the child |
| src/core/infer_inputs.ts:371 | P4 | kept | parser recovery can omit the child |
| src/core/infer_inputs.ts:464 | P4 | kept | the binding name can be a non-local target |
| src/core/infer_inputs.ts:563 | P4 | kept | parser recovery can omit the child |
| src/core/lower.ts:349 | P4 | kept | parser recovery can omit the child; guards a syntax child that the checker accepted |
| src/core/predicates.ts:283 | P4 | kept | TypeScript needs the pop narrowing |
| src/core/predicates.ts:320 | P4 | kept | TypeScript needs the pop narrowing |
| src/core/predicates.ts:422 | P4 | kept | no relaxed node means no cycle; a normal result |
| src/core/predicates.ts:424 | P4 | kept | no relaxed node means no cycle; a normal result |
| src/core/predicates.ts:429 | P4 | kept | algorithm invariant that the types cannot carry |
| src/core/predicates.ts:437 | P4 | kept | algorithm invariant that the types cannot carry |
| src/core/requirement_provenance.ts:123 | P4 | kept | the initializer is optional |
| src/core/requirement_provenance.ts:164 | P4 | kept | parser recovery can omit the child |
| src/core/requirement_provenance.ts:187 | P4 | kept | parser recovery can omit the child |
| src/core/requirement_provenance.ts:289 | P4 | kept | a callback can have no recorded info |
| src/core/service_bounds.ts:81 | P4 | kept | no service header means no bound |
| src/core/type_lower.ts:174 | P4 | kept | parser recovery can omit the child |
| src/core/type_lower.ts:220 | P4 | kept | parser recovery can omit the child |
| src/core/type_lower.ts:312 | P4 | kept | parser recovery can omit the child |
| src/core/type_lower.ts:357 | P4 | kept | parser recovery can omit the child |
| src/core/type_lower.ts:690 | P4 | kept | the clause is optional in source |
| src/core/type_lower.ts:736 | P4 | kept | the clause is optional in source |
| src/core/types.ts:356 | P4 | kept | indexed storage; the type cannot prove that a ref is in range |
| src/core/types.ts:712 | P4 | kept | an alias can be absent |
| src/core/types.ts:819 | P4 | kept | the ref is optional |
| src/core/check_builtins/schema.ts:361 | P5 | kept | side-table fact: the prologue sets it, and the shared handle signature carries no fact |
| src/core/initialization.ts:62 | P5 | removed | the cycle now holds the first position, so no lookup is left |
| src/core/initialization.ts:75 | P5 | removed | the cycle now holds the nodes, so no lookup by id is left |
| src/core/lower.ts:302 | P5 | kept | side-table fact: the checker fills body.info |
| src/core/lower.ts:349 | P5 | kept | parser recovery can omit the child; guards a syntax child that the checker accepted |
| src/core/lower.ts:355 | P5 | kept | parser recovery can omit the child; the checker accepted the node |
| src/core/lower.ts:367 | P5 | kept | side-table fact: the checker records the local identity |
| src/core/lower.ts:378 | P5 | kept | side-table fact: the checker records the local identity |
| src/core/lower.ts:406 | P5 | kept | parser recovery can omit the child; the checker accepted the node |
| src/core/lower.ts:455 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:472 | P5 | kept | exhaustive default of a node-kind switch |
| src/core/lower.ts:488 | P5 | kept | side-table fact: the resolver records the target |
| src/core/lower.ts:514 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:562 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:700 | P5 | kept | exhaustive switch over fact kinds |
| src/core/lower.ts:720 | P5 | kept | the checker rejects a pipeline input; the lowerer guards it |
| src/core/lower.ts:743 | P5 | kept | parser recovery can omit the child; the checker accepted the node |
| src/core/lower.ts:793 | P5 | kept | the checker accepted the closures; the lowerer guards the shape |
| src/core/lower.ts:814 | P5 | kept | the checker proved a literal record; the lowerer guards the shape |
| src/core/lower.ts:850 | P5 | kept | hash collision guard; a runtime fact |
| src/core/lower.ts:858 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:978 | P5 | kept | parser recovery can omit the child; the checker accepted the node |
| src/core/lower.ts:1116 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1154 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1194 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1249 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1300 | P5 | kept | exhaustive switch over pattern fact kinds |
| src/core/lower.ts:1399 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1418 | P5 | kept | side-table fact: set by the checker and read by the lowerer |
| src/core/lower.ts:1561 | P5 | kept | parser recovery can omit the body |
| src/core/lower.ts:1572 | P5 | kept | solvedSignatureType returns a Result; the lowerer guards its failure |
| src/core/lower.ts:1580 | P5 | kept | side-table fact: the checker records the parameter id |
| src/core/lower.ts:1615 | P5 | kept | parser recovery can omit the initializer |
| src/core/type_ir.ts:221 | P5 | kept | callers pass a type ref, not the node; the kind is not carried |
| src/core/types.ts:356 | P5 | kept | indexed storage; the type cannot prove that a ref is in range |
