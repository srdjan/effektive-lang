# Redundant checks, pass RC6

This ledger covers three check patterns in `src/`, outside the paths that other auditors own, at commit 7ae2d4f. Result: no site is redundant, so the pass makes no code change.

Let `AREA` be: `src ':!src/core/validate' ':!src/core/validate_project.ts' ':!src/host/deno_io.ts' ':!src/host/log.ts' ':!src/host/workspace.ts' ':!src/lsp/jsonrpc.ts' ':!src/lsp/positions.ts' ':!src/core/project_config.ts' ':!src/core/syntax.ts' ':!src/core/util.ts' ':!src/core/frontend.ts' ':!src/cli/main.ts'`.

Census commands:

- P6: `git grep -n -A2 -E '\.has\(' -- AREA`. A script also searched the next 20 lines for a `.get(` on the same receiver.
- P7: `git grep -n 'Array.isArray(' -- AREA`
- P8: `git grep -n -E ' instanceof ' -- AREA`

Counts: P6 141 `.has(` lines, P7 12 lines, P8 8 lines. Every census line has one row.

Decisions: P6 141 kept, 0 removed, 0 restructured. P7 12 kept, 0 removed, 0 restructured. P8 8 kept, 0 removed, 0 restructured.

Two lines appear under two patterns: `src/core/serialize.ts:63` (P6 and P7) and `src/core/emit/fields.ts:209` (P6 and P8). Each has one row per pattern.

| Site (file:line at 7ae2d4f) | Pattern | Decision | Reason or proof |
| --- | --- | --- | --- |
| src/cli/args.ts:93 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/cli/args.ts:98 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/cli/args.ts:106 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/cli/args.ts:113 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_binary.ts:63 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_binary.ts:150 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_builtins/effect.ts:283 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_builtins/effect.ts:588 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_builtins/effect.ts:594 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_builtins/layer.ts:194 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_builtins/schema.ts:333 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_declarations.ts:439 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_declarations.ts:443 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_declarations.ts:449 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_declarations.ts:699 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:346 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:660 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1209 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1216 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1253 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1446 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1731 | P6 | kept | The has test is on pendingLocals and the get is on body.locals. These are two maps. |
| src/core/check_expr.ts:1820 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1842 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1860 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:1960 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:2354 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:2518 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:2540 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_expr.ts:2548 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:53 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:54 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:58 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:65 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:77 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:79 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_patterns.ts:127 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_project.ts:197 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_refinements.ts:330 | P6 | kept | The get at line 347 is in another method (integerPath) and has its own undefined test. |
| src/core/check_refinements.ts:401 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_refinements.ts:457 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/check_refinements.ts:626 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/db.ts:103 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/db.ts:332 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/db.ts:431 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/declaration_index.ts:149 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/declaration_index.ts:211 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/diagnostics.ts:423 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_actions.ts:61 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_actions.ts:62 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_actions.ts:70 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:53 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:153 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:348 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:350 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:353 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:363 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_completion.ts:364 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_index.ts:129 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_rename.ts:121 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_rename.ts:122 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_signature.ts:41 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_signature.ts:70 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_tokens.ts:162 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_tokens.ts:177 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_tokens.ts:181 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/editor_tokens.ts:210 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/effect_set.ts:63 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/decls.ts:78 | P6 | kept | The has test is on a seen set and the get is on byId. These are two maps. |
| src/core/emit/decls.ts:136 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/decls.ts:167 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/decls.ts:245 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/decls.ts:659 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/doc.ts:443 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/doc.ts:539 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/expr.ts:236 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/expr.ts:719 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/fields.ts:40 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/fields.ts:209 | P6 | kept | The has test is inside emitted text for a runtime Set. No get follows it. |
| src/core/emit/module_state.ts:335 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/module_state.ts:349 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/module_state.ts:461 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/module_state.ts:463 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/module_state.ts:499 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/types.ts:321 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/types.ts:322 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/types.ts:404 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/emit/types.ts:405 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/infer_contracts.ts:205 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/infer_contracts.ts:215 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/interface.ts:152 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/interface.ts:318 | P6 | kept | The has test is on a seen set and the get is on the import graph. These are two maps. |
| src/core/lex.ts:109 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/lex.ts:221 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/lex.ts:653 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/lower.ts:393 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/patterns.ts:83 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/patterns.ts:192 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/project.ts:93 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/project.ts:190 | P6 | kept | The has test is on loaded and the get is on failures. These are two maps. |
| src/core/project.ts:406 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/recursion_guard.ts:23 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/recursion_guard.ts:141 | P6 | kept | The get at line 147 is in another closure. The has test is in a some callback over a fresh id list. |
| src/core/requirement_provenance.ts:25 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/requirement_provenance.ts:150 | P6 | kept | The has test is on a seen set and the get is on resolution.targets. These are two maps. |
| src/core/requirement_provenance.ts:201 | P6 | kept | The has test is on a seen set and the get is on resolution.targets. These are two maps. |
| src/core/requirement_provenance.ts:204 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/requirement_provenance.ts:236 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:237 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:241 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:399 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:406 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:561 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:609 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:625 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/resolve.ts:860 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/serialize.ts:63 | P6 | kept | The has test is on a Set of key names. The item is read from a record, not from this set. |
| src/core/service_bounds.ts:87 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/syntax_queries.ts:37 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/syntax_queries.ts:391 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/type_lower.ts:410 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/type_lower.ts:712 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/type_show.ts:50 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:149 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:471 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:706 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:722 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:828 | P6 | kept | The get at line 846 is in another method (follow). The has test in isDefined needs no value. |
| src/core/types.ts:981 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:1151 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:1249 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/types.ts:1302 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/host/log_schema.ts:291 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/host/outputs.ts:72 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/host/save_round.ts:84 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/features.ts:86 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/projects.ts:294 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/projects.ts:392 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/projects.ts:464 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/projects.ts:596 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/lsp/projects.ts:693 | P6 | kept | No get of this map follows in the same block. The test guards a branch, an insert, or a membership answer. |
| src/core/content_id.ts:29 | P7 | kept | The value is unknown and the check tells arrays from records. |
| src/core/emit/doc.ts:297 | P7 | kept | The check is the type guard that tells the list branch of the Doc union from the other branches. |
| src/core/emit/fields.ts:115 | P7 | kept | This is emitted text. The generated code checks a runtime value. |
| src/core/emit/fields.ts:119 | P7 | kept | This is emitted text. The generated code checks a runtime value. |
| src/core/emit/fields.ts:150 | P7 | kept | This is emitted text. The generated code checks a runtime value. |
| src/core/interface.ts:68 | P7 | kept | The value is unknown and the check tells arrays from records. |
| src/core/predicates.ts:345 | P7 | kept | The predicate comes from imported JSON. The check guards the operand list of an untrusted node. |
| src/core/predicates.ts:505 | P7 | kept | The term comes from imported JSON. The check validates the path of an untrusted term. |
| src/core/serialize.ts:53 | P7 | kept | The value is unknown and the check tells arrays from records. |
| src/core/serialize.ts:63 | P7 | kept | The item is unknown, read from a record by key. |
| src/lsp/protocol.ts:303 | P7 | kept | The value is an LSP message field of type unknown. |
| src/lsp/wire_log.ts:25 | P7 | kept | The folders value is unknown, read from a raw initialize message. |
| src/core/db.ts:326 | P8 | kept | The type is the union Map or Record. The check tells the two branches apart. |
| src/core/emit/emit.ts:186 | P8 | kept | The thrown value is unknown. The check tells EmitFailure from other errors. |
| src/core/emit/fields.ts:209 | P8 | kept | This is emitted text. The generated code checks a runtime value. |
| src/core/emit/helper_declarations.ts:95 | P8 | kept | This is emitted text. The generated code checks a runtime thrown value. |
| src/core/emit/helper_declarations.ts:122 | P8 | kept | This is emitted text. The generated code checks a runtime thrown value. |
| src/core/lower.ts:1689 | P8 | kept | The thrown value is unknown. The check tells LowerFailure from other errors. |
| src/core/source.ts:34 | P8 | kept | The type is the union Map or Record. The check tells the two branches apart. |
| src/lsp/server.ts:213 | P8 | kept | The error is unknown. The check tells Error from other thrown values. |
