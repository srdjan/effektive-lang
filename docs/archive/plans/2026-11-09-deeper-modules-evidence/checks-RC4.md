# Redundant checks in the emitter (RC4)

Scope: `src/core/emit/` and `src/core/typescript.ts`, read at commit e16f546. Line numbers are the line numbers at that commit.

Census commands:

- P1 lookup fallback: `git grep -n -E '\.get\([^)]*\) \?\? ' -- src/core/emit src/core/typescript.ts`
- P2 typeof: `git grep -n -E 'typeof [a-zA-Z_.]+ [!=]== "' -- src/core/emit src/core/typescript.ts`
- P3 isRecord: `git grep -n 'isRecord(' -- src/core/emit src/core/typescript.ts`
- P4 undefined exit: `git grep -n -E '=== undefined\) (return|continue|throw|break)' -- src/core/emit src/core/typescript.ts`
- P5 internal throw: `git grep -n -E 'throw (new Error|internal)\(' -- src/core/emit src/core/typescript.ts`
- P6: other redundant checks seen while reading.

Counts: P1 has 7 lines (5 restructured, 2 kept). P2 has 7 lines (7 kept). P3 has 0 lines. P4 has 24 lines (2 restructured, 22 kept). P5 has 41 lines (2 removed, 39 kept). P6 has 3 sites (1 restructured, 2 kept). Three lines match both P4 and P5 (expr.ts:877, identity.ts:18, identity.ts:25). Each such line has one row, with both patterns named. The table has 79 rows.

| Site (file:line at e16f546) | Pattern | Decision | Reason or proof |
| --- | --- | --- | --- |
| src/core/emit/decls.ts:80 | P4 | kept | a referenced id can name a declaration of another module |
| src/core/emit/decls.ts:167 | P4 | restructured | the loop tests the popped value only; the length test is gone |
| src/core/emit/decls.ts:187 | P5 | kept | guards a dependency cycle that the checker excludes; the IR types cannot express it |
| src/core/emit/decls.ts:323 | P5 | kept | nominal types without a tagged record base have no form; the IR types cannot express it |
| src/core/emit/decls.ts:341 | P4 | kept | optional predicate; a normal state |
| src/core/emit/decls.ts:684 | P5 | removed | dead code after an exhaustive switch; the compiler proves it |
| src/core/emit/decls.ts:700 | P5 | kept | IR invariant the types cannot express: a declaration id resolves to a service |
| src/core/emit/decls.ts:832 | P5 | kept | IR invariant the types cannot express: an imported value has a provider type |
| src/core/emit/doc.ts:228 | P2 | kept | narrows the Doc union to a string; TypeScript needs it |
| src/core/emit/doc.ts:229 | P2 | kept | narrows the Doc union for base.slice; a rewrite adds a let for no gain |
| src/core/emit/doc.ts:293 | P2 | kept | type guard that implements isText |
| src/core/emit/doc.ts:497 | P4 | restructured | the loop tests the popped value only; the length test is gone |
| src/core/emit/doc.ts:601 | P1 | kept | a span close can lack its open end; the Doc type does not pair them |
| src/core/emit/expr.ts:358 | P4 | kept | optional bodyDown; a normal state |
| src/core/emit/expr.ts:412 | P5 | kept | IR invariant the types cannot express: the mode of a node |
| src/core/emit/expr.ts:569 | P4 | kept | optional chain; a normal state |
| src/core/emit/expr.ts:604 | P4 | kept | optional expected type; a normal state |
| src/core/emit/expr.ts:627 | P5 | removed | fit now gets the function type from liftedFrom, which already proved it |
| src/core/emit/expr.ts:663 | P5 | kept | IR invariant the types cannot express: a leaf kind in a structural position |
| src/core/emit/expr.ts:870 | P2 | kept | narrows the literal union to tell a string from a number or boolean |
| src/core/emit/expr.ts:877 | P4, P5 | kept | IR invariant the types cannot express: a local id resolves |
| src/core/emit/expr.ts:883 | P5 | kept | IR invariant: a builtin reference is a callee; the types cannot express it |
| src/core/emit/expr.ts:1115 | P5 | kept | IR invariant the types cannot express: a closure has a function type |
| src/core/emit/expr.ts:1153 | P5 | kept | IR invariant the types cannot express: a leaf call never gets here |
| src/core/emit/expr.ts:1176 | P5 | kept | IR invariant the types cannot express: a callback has a function type |
| src/core/emit/expr.ts:1189 | P5 | kept | a test builds a builtin that has no emission form; the case is reachable |
| src/core/emit/expr.ts:1194 | P5 | kept | argument count of an array; the types cannot express it |
| src/core/emit/expr.ts:1202 | P5 | kept | argument count of an array; the types cannot express it |
| src/core/emit/expr.ts:1215 | P5 | kept | the builtins all and traverse are emitted as leaves; the switch must cover them |
| src/core/emit/expr.ts:1303 | P5 | kept | arms are a runtime array; the option match may lack an arm |
| src/core/emit/expr.ts:1330 | P5 | kept | IR invariant the types cannot express: a Some pattern appears only in an option match |
| src/core/emit/expr.ts:1350 | P5 | kept | arms are a runtime array; the types cannot express a non-empty list |
| src/core/emit/expr.ts:1449 | P5 | kept | IR invariant the types cannot express: an option pattern appears only in an option match |
| src/core/emit/expr.ts:1601 | P5 | kept | narrows the node to a leaf kind; the types cannot express it |
| src/core/emit/expr.ts:1616 | P5 | kept | argument count of an array; the types cannot express it |
| src/core/emit/expr.ts:1626 | P5 | kept | IR invariant the types cannot express: filter has an array parameter |
| src/core/emit/families/layer.ts:25 | P5 | kept | IR invariant the types cannot express: a layer has a service and a record implementation |
| src/core/emit/families/layer.ts:36 | P5 | kept | IR invariant the types cannot express: a layer method has a function type |
| src/core/emit/families/schema.ts:370 | P5 | kept | exhaustive switch guard on never |
| src/core/emit/families/scope.ts:45 | P5 | kept | IR invariant the types cannot express: with-resource has three closures |
| src/core/emit/fields.ts:132 | P2 | kept | text of generated code, not an emitter check |
| src/core/emit/fields.ts:150 | P2 | kept | text of generated code, not an emitter check |
| src/core/emit/helper_declarations.ts:144 | P4 | kept | text of generated code, not an emitter check |
| src/core/emit/identity.ts:18 | P4, P5 | kept | IR invariant: an identity string is well formed; a string type cannot say so |
| src/core/emit/identity.ts:25 | P4, P5 | kept | IR invariant: an identity string is well formed; a string type cannot say so |
| src/core/emit/identity.ts:32 | P5 | kept | IR invariant: a capability string is well formed; a string type cannot say so |
| src/core/emit/identity.ts:40 | P5 | kept | IR invariant: a capability string is well formed; a string type cannot say so |
| src/core/emit/module_state.ts:262 | P5 | kept | project file entry may be missing; config is an entry point |
| src/core/emit/module_state.ts:266 | P5 | kept | host module path comes from config; an entry point |
| src/core/emit/module_state.ts:312 | P4 | kept | a host module path can be invalid; the loop then ends in a throw |
| src/core/emit/module_state.ts:320 | P5 | kept | the config may lack a host module for the interface; an entry point |
| src/core/emit/module_state.ts:327 | P5 | kept | guards the call order of the allocator; the types cannot express it |
| src/core/emit/module_state.ts:584 | P1 | kept | default for a module that is not a host module; a normal state |
| src/core/emit/sourcemap.ts:29 | P5 | kept | precondition of the VLQ encoder on a number |
| src/core/emit/sourcemap.ts:88 | P1 | restructured | the checking loop now stores the text and line starts for each record |
| src/core/emit/sourcemap.ts:119 | P4 | kept | lastTarget is loop state; undefined is a normal state |
| src/core/emit/sourcemap.ts:126 | P1 | restructured | the text comes from the record source info, not a second lookup |
| src/core/emit/sourcemap.ts:128 | P1 | restructured | the line starts come from the record source info |
| src/core/emit/sourcemap.ts:132 | P1 | restructured | the index comes from the record source info |
| src/core/emit/sourcemap.ts:164 | P1 | restructured | sourcesContent reads the stored texts of the known sources |
| src/core/emit/tsc.ts:93 | P4 | kept | open is loop state; undefined is a normal state |
| src/core/emit/tsc.ts:240 | P4 | kept | entry point: the tsc output may name a file that has no table |
| src/core/emit/tsc.ts:242 | P4 | kept | entry point: the tsc position may lie outside the file |
| src/core/emit/tsc.ts:256 | P4 | kept | entry point: the offset may lie in no span record |
| src/core/emit/type_query.ts:78 | P5 | kept | IR invariant the types cannot express: a resolved type has the expected kind |
| src/core/emit/types.ts:34 | P2 | kept | narrows the literal union to tell a string from a number or boolean |
| src/core/emit/types.ts:314 | P5 | kept | IR invariant the types cannot express: a type has no function or provider in it |
| src/core/emit/types.ts:380 | P5 | kept | IR invariant the types cannot express: a type has no function or provider in it |
| src/core/emit/types.ts:400 | P5 | kept | deno lint no-fallthrough needs it after the exhaustive switch; removal failed the gate |
| src/core/emit/walk.ts:83 | P4 | kept | some declaration kinds have no body; a normal state |
| src/core/emit/walk.ts:92 | P4 | kept | some declaration kinds have no body; a normal state |
| src/core/typescript.ts:71 | P4 | kept | a module name can be unknown to the revision; a normal state |
| src/core/typescript.ts:85 | P4 | kept | the entry is undefined exactly when the module is unknown; same state as above |
| src/core/typescript.ts:105 | P4 | kept | the entry and the emitted result are undefined together; the types cannot carry this |
| src/core/typescript.ts:121 | P4 | kept | the entry and the table are undefined together; the types cannot carry this |
| src/core/typescript.ts:199 | P4 | kept | a hover position can lie outside every name; a normal state |
| src/core/typescript.ts:87 | P6 | restructured | a non-null assertion on a second lookup; the entry lookup now returns the lowered module |
| src/core/typescript.ts:201 | P6 | kept | a non-null assertion; the fix is in `sourceHoverAt` in `editor.ts`, outside the emitter |
| src/core/emit/sourcemap.ts:80 | P6 | kept | entry point: the caller supplies the source texts, so a missing text is data |
