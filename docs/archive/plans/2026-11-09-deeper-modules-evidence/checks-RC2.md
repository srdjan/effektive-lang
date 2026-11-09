# Redundant checks in the front end, the program, and the editor queries (RC2)

This ledger covers the redundant-check census at e16f546 for `src/core/{lex,parse,syntax,syntax_queries,resolve,declaration_index,project,project_config,paths,db,interface,diagnostics,diagnostic_delta,editor,editor_actions,editor_completion,editor_hints,editor_index,editor_rename,editor_signature,editor_tokens,frontend,serialize,source,util,ids,graph,content_id,sha256,analyze,mod}.ts`.

Census commands, with `AREA` as that file list:

- P1 `git grep -n -E '\.get\([^)]*\) \?\? ' -- AREA`
- P2 `git grep -n -E 'typeof [a-zA-Z_.]+ [!=]== "' -- AREA`
- P3 `git grep -n 'isRecord(' -- AREA`
- P4 `git grep -n -E '=== undefined\) (return|continue|throw|break)' -- AREA`
- P5 `git grep -n -E 'throw (new Error|internal)\(' -- AREA`
- P6 other redundant checks found while reading

Counts of census lines (parse.ts:222 matches both P4 and P5 and has one row, listed under P4, P5): P1 18, P2 12, P3 5, P4 41, P5 3. P6 has 3 extra sites. Decisions:

- P1: removed 0, restructured 1, kept 17
- P2: removed 0, restructured 1, kept 11
- P3: removed 0, restructured 0, kept 5
- P4: removed 1, restructured 1, kept 39
- P5: removed 1, restructured 0, kept 1
- P6: removed 2, restructured 1, kept 0

The P6 rows list the sites that the census does not match. Line numbers are at e16f546.

| Site (file:line at e16f546) | Pattern | Decision | Reason or proof |
|---|---|---|---|
| src/core/db.ts:236 | P1 | kept | public query; an unknown module name is a normal input |
| src/core/db.ts:372 | P1 | kept | inside Program.check, which has a survivor row |
| src/core/db.ts:375 | P1 | kept | inside Program.check, which has a survivor row |
| src/core/diagnostic_delta.ts:52 | P1 | kept | counter default |
| src/core/diagnostic_delta.ts:63 | P1 | kept | a missing key means no unused match |
| src/core/editor.ts:121 | P1 | kept | a module path can have no occurrences |
| src/core/editor_completion.ts:337 | P1 | kept | a file can have no local scopes |
| src/core/editor_index.ts:61 | P1 | kept | ids are plain strings, so the capability parse can fail by type |
| src/core/editor_index.ts:148 | P1 | kept | multimap default |
| src/core/editor_index.ts:187 | P1 | kept | the path comes from the caller and can be unknown |
| src/core/editor_index.ts:200 | P1 | kept | index invariant that the type cannot carry; a new field would add a concept |
| src/core/editor_rename.ts:38 | P1 | kept | index invariant that the type cannot carry; a new field would add a concept |
| src/core/editor_rename.ts:134 | P1 | kept | index invariant that the type cannot carry; a new field would add a concept |
| src/core/editor_tokens.ts:133 | P1 | kept | the path comes from the caller and can be unknown |
| src/core/interface.ts:316 | P1 | kept | public function; an unknown module name is a normal input |
| src/core/interface.ts:320 | P1 | kept | the graph covers every module, but the map type cannot carry it |
| src/core/project.ts:387 | P1 | restructured | linkModules now takes each edge index from one position lookup, so no fallback remains |
| src/core/resolve.ts:589 | P1 | kept | counter default |
| src/core/content_id.ts:18 | P2 | kept | value is unknown |
| src/core/interface.ts:67 | P2 | kept | value is unknown |
| src/core/project_config.ts:211 | P2 | kept | effektive.json is an entry point |
| src/core/project_config.ts:221 | P2 | kept | effektive.json is an entry point |
| src/core/project_config.ts:271 | P2 | kept | effektive.json is an entry point |
| src/core/project_config.ts:274 | P2 | kept | effektive.json is an entry point |
| src/core/serialize.ts:36 | P2 | kept | list items are unknown |
| src/core/serialize.ts:39 | P2 | restructured | the previous item was already checked as a string; the loop now keeps it as a string |
| src/core/serialize.ts:49 | P2 | kept | value is unknown |
| src/core/serialize.ts:54 | P2 | kept | value is unknown |
| src/core/syntax.ts:232 | P2 | kept | JSON.parse returns unknown, and the lexer can emit a malformed string |
| src/core/util.ts:22 | P2 | kept | the body of isRecord; the value is unknown |
| src/core/project_config.ts:185 | P3 | kept | effektive.json is an entry point |
| src/core/project_config.ts:206 | P3 | kept | effektive.json is an entry point |
| src/core/project_config.ts:252 | P3 | kept | effektive.json is an entry point |
| src/core/project_config.ts:256 | P3 | kept | effektive.json is an entry point |
| src/core/util.ts:19 | P3 | kept | the definition of isRecord, not a call |
| src/core/content_id.ts:17 | P4 | kept | value is unknown |
| src/core/db.ts:243 | P4 | kept | inside declEntry, which has a survivor row |
| src/core/db.ts:279 | P4 | kept | public query; an unknown module name is a normal input |
| src/core/db.ts:459 | P4 | kept | inside sameModes, which has a survivor row |
| src/core/declaration_index.ts:119 | P4 | kept | parser recovery can omit the child |
| src/core/declaration_index.ts:121 | P4 | kept | parser recovery can omit the child |
| src/core/declaration_index.ts:139 | P4 | kept | parser recovery can omit the child |
| src/core/declaration_index.ts:141 | P4 | kept | parser recovery can omit the child |
| src/core/declaration_index.ts:207 | P4 | kept | most node kinds are not declarations |
| src/core/declaration_index.ts:209 | P4 | kept | parser recovery can omit the child |
| src/core/editor.ts:160 | P4 | kept | no node can cover the offset |
| src/core/editor.ts:162 | P4 | restructured | the candidates now carry each node info, so the second lookup is gone |
| src/core/editor.ts:185 | P4 | kept | the path can be unknown |
| src/core/editor.ts:204 | P4 | kept | a module can lack a resolution |
| src/core/editor.ts:206 | P4 | kept | a module can lack a resolution |
| src/core/editor.ts:216 | P4 | kept | no node can cover the offset |
| src/core/editor_actions.ts:136 | P4 | kept | an arrow can lack the => token |
| src/core/editor_completion.ts:375 | P4 | removed | the caller passes the module info that it already has |
| src/core/editor_completion.ts:392 | P4 | kept | an import can lack a link target |
| src/core/editor_index.ts:58 | P4 | kept | ids are plain strings, so the capability parse can fail by type |
| src/core/editor_index.ts:116 | P4 | kept | a module can lack a resolution |
| src/core/editor_signature.ts:65 | P4 | kept | an alias can lead to a module without a resolution |
| src/core/editor_signature.ts:195 | P4 | kept | no table has a type for the callee |
| src/core/editor_signature.ts:203 | P4 | kept | no call can cover the cursor |
| src/core/parse.ts:222 | P4, P5 | kept | guards the parser stack, which the type cannot carry |
| src/core/project.ts:286 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:141 | P4 | kept | not every text is a prelude name |
| src/core/resolve.ts:549 | P4 | kept | the scope is mutable state that the type cannot carry |
| src/core/resolve.ts:551 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:720 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:751 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:783 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:803 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:859 | P4 | kept | parser recovery can omit the child; a binding can lack a service |
| src/core/resolve.ts:886 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:1154 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:1163 | P4 | kept | parser recovery can omit the child |
| src/core/resolve.ts:1309 | P4 | kept | parser recovery can omit the child |
| src/core/syntax_queries.ts:170 | P4 | kept | parser recovery can omit the child |
| src/core/syntax_queries.ts:322 | P4 | kept | parser recovery can omit the child |
| src/core/syntax_queries.ts:324 | P4 | kept | parser recovery can omit the child |
| src/core/parse.ts:277 | P5 | kept | guards the Eof position in the token stream |
| src/core/project.ts:410 | P5 | removed | cycleDiagnostic now receives the sorted module entries, so it needs no lookup |
| src/core/editor.ts:217 | P6 | restructured | definitionAt now iterates the target entries, so the second lookup and its undefined exit are gone |
| src/core/project.ts:374 | P6 | removed | the modules.has check merged into the one position lookup in linkModules |
| src/core/project.ts:408 | P6 | removed | the module lookup in cycleDiagnostic, the same site as the P5 throw at project.ts:410 |
