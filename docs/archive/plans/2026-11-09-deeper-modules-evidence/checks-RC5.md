# Redundant checks in the independent validator (RC5)

Scope: `src/core/validate/` and `src/core/validate_project.ts`, read at commit 7ae2d4f. Line numbers are the line numbers at that commit.

Census commands:

- P1 lookup fallback: `git grep -n -E '\.get\([^)]*\) \?\? ' -- src/core/validate src/core/validate_project.ts`
- P2 typeof: `git grep -n -E 'typeof [a-zA-Z_.]+ [!=]== "' -- src/core/validate src/core/validate_project.ts`
- P3 isRecord: `git grep -n 'isRecord(' -- src/core/validate src/core/validate_project.ts`
- P4 undefined exit: `git grep -n -E '=== undefined\) (return|continue|throw|break)' -- src/core/validate src/core/validate_project.ts`
- P5 internal throw: `git grep -n -E 'throw (new Error|internal)\(' -- src/core/validate src/core/validate_project.ts`
- P6 has then get: `git grep -n -A2 -E '\.has\(' -- src/core/validate src/core/validate_project.ts`, keeping each `.has(` line whose next two lines read `.get(`
- P7 Array.isArray: `git grep -n 'Array.isArray(' -- src/core/validate src/core/validate_project.ts`
- P8 instanceof: `git grep -n -E ' instanceof ' -- src/core/validate src/core/validate_project.ts`
- P9: other redundant checks seen while reading.

Counts: P1 has 10 lines (0 removed, 0 restructured, 10 kept). P2 has 35 lines (0 removed, 1 restructured, 34 kept). P3 has 10 lines (0 removed, 0 restructured, 10 kept). P4 has 27 lines (0 removed, 0 restructured, 27 kept). P5 has 0 lines (0 removed, 0 restructured, 0 kept). P6 has 13 lines (0 removed, 0 restructured, 13 kept). P7 has 12 lines (0 removed, 0 restructured, 12 kept). P8 has 1 line (0 removed, 0 restructured, 1 kept). P9 has 1 site (0 removed, 1 restructured, 0 kept). For P6, the raw output has 328 lines; 13 `.has(` lines have a `.get(` in the next two lines, and each is listed.

The validator is a test oracle. Its first check of each part of forged IR stays. A check is redundant only when the validator already proved the same fact on the same data, or when the static type proves it.

| Site (file:line at 7ae2d4f) | Pattern | Decision | Reason or proof |
| --- | --- | --- | --- |
| src/core/validate/expr.ts:155 | P1 | kept | falls back across different maps |
| src/core/validate/recursion_checks.ts:127 | P1 | kept | counter default inside the frozen guardedDataGroups |
| src/core/validate/recursion_checks.ts:171 | P1 | kept | falls back across different maps |
| src/core/validate/recursion_checks.ts:198 | P1 | kept | multimap default: a node can have no edges |
| src/core/validate/recursion_checks.ts:201 | P1 | kept | frozen guardedDataGroups; low.get(id) is set at entry but TypeScript needs the default |
| src/core/validate/recursion_checks.ts:203 | P1 | kept | frozen guardedDataGroups; same Tarjan bookkeeping |
| src/core/validate/recursion_checks.ts:213 | P1 | kept | multimap default: a node can have no edges |
| src/core/validate/recursion_checks.ts:229 | P1 | kept | multimap default: a member can have no edges |
| src/core/validate/typing.ts:78 | P1 | kept | falls back across different maps |
| src/core/validate/typing.ts:738 | P1 | kept | falls back across different maps |
| src/core/validate/builtins.ts:32 | P2 | kept | first check of forged IR |
| src/core/validate/builtins.ts:39 | P2 | kept | first check of forged IR |
| src/core/validate/builtins.ts:105 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/expr.ts:1675 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/families/context.ts:48 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/families/context.ts:50 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/families/effect.ts:310 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/families/schema.ts:804 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/guards.ts:8 | P2 | kept | definition of isRecord |
| src/core/validate/import_checks.ts:201 | P2 | kept | first check of forged IR |
| src/core/validate/predicates.ts:93 | P2 | kept | first check of forged IR |
| src/core/validate/predicates.ts:97 | P2 | kept | first check of forged IR |
| src/core/validate/predicates.ts:246 | P2 | kept | first check of forged IR |
| src/core/validate/predicates.ts:271 | P2 | kept | first check of forged IR |
| src/core/validate/predicates.ts:281 | P2 | kept | first check of forged IR |
| src/core/validate/recursion_checks.ts:267 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:147 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:354 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:367 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:479 | P2 | kept | first check of forged IR |
| src/core/validate/refinements.ts:484 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:512 | P2 | kept | first check of forged IR |
| src/core/validate/refinements.ts:526 | P2 | kept | first check of forged IR |
| src/core/validate/refinements.ts:537 | P2 | kept | separates the string message from a Type in a union |
| src/core/validate/refinements.ts:590 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:642 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:653 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:673 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/refinements.ts:676 | P2 | kept | narrows a literal value type that TypeScript needs |
| src/core/validate/serialization.ts:17 | P2 | kept | first check of forged IR; the set can hold a non-string |
| src/core/validate/serialization.ts:19 | P2 | restructured | the previous item already passed the string test on the last step; the loop now carries it as a string |
| src/core/validate/serialization.ts:26 | P2 | kept | first check of forged IR |
| src/core/validate/serialization.ts:27 | P2 | kept | first check of forged IR |
| src/core/validate/serialization.ts:107 | P2 | kept | the walk reads plain data; the first check of this value |
| src/core/validate/type_checks.ts:63 | P2 | kept | first check of forged IR |
| src/core/validate/guards.ts:5 | P3 | kept | definition of isRecord |
| src/core/validate/predicates.ts:55 | P3 | kept | first check of forged IR |
| src/core/validate/predicates.ts:93 | P3 | kept | first check of forged IR |
| src/core/validate/predicates.ts:108 | P3 | kept | the pop-time check at line 93 gives a different diagnostic; removal changes the message |
| src/core/validate/predicates.ts:271 | P3 | kept | first check of forged IR |
| src/core/validate/predicates.ts:301 | P3 | kept | first check of forged IR |
| src/core/validate/serialization.ts:26 | P3 | kept | first check of forged IR |
| src/core/validate/serialization.ts:122 | P3 | kept | first check of forged IR |
| src/core/validate_project.ts:41 | P3 | kept | first check of forged IR |
| src/core/validate_project.ts:65 | P3 | kept | first check of forged IR |
| src/core/validate/families/effect.ts:52 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/effect.ts:75 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/effect.ts:94 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/effect.ts:356 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/effect.ts:379 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/effect.ts:399 | P4 | kept | jobFunction returns undefined when the job is not a function |
| src/core/validate/families/schema.ts:293 | P4 | kept | an argument index can be out of range in forged IR |
| src/core/validate/families/schema.ts:729 | P4 | kept | a callback can be absent |
| src/core/validate/predicates.ts:72 | P4 | kept | narrowing of pop(); the only alternative is a non-null assertion |
| src/core/validate/predicates.ts:91 | P4 | kept | narrowing of pop(); the only alternative is a non-null assertion |
| src/core/validate/refinements.ts:126 | P4 | kept | condition() returns undefined for an unsupported operand |
| src/core/validate/refinements.ts:166 | P4 | kept | refinedTarget() returns undefined for a type without a predicate |
| src/core/validate/refinements.ts:324 | P4 | kept | linearAt() returns undefined for an unsupported path |
| src/core/validate/refinements.ts:346 | P4 | kept | pathOf() returns undefined for an unsupported expression |
| src/core/validate/refinements.ts:401 | P4 | kept | a path array can be empty |
| src/core/validate/refinements.ts:403 | P4 | kept | locals map can lack the id; first lookup |
| src/core/validate/refinements.ts:441 | P4 | kept | a declaration can have no predicate |
| src/core/validate/refinements.ts:612 | P4 | kept | an alias map can lack the id; ends the walk |
| src/core/validate/refinements.ts:631 | P4 | kept | fields.find returns undefined when the field is absent |
| src/core/validate/refinements.ts:731 | P4 | kept | substitute() returns undefined for an unsupported term |
| src/core/validate/refinements.ts:745 | P4 | kept | a term value can be unsupported |
| src/core/validate/typing.ts:99 | P4 | kept | end of the alias chain |
| src/core/validate/typing.ts:693 | P4 | kept | end of the alias chain |
| src/core/validate/typing.ts:803 | P4 | kept | identityBody returns undefined for a non-identity |
| src/core/validate/typing.ts:840 | P4 | kept | the first lookup of a member class |
| src/core/validate_project.ts:39 | P4 | kept | definition of the shown text for a missing value |
| src/core/validate_project.ts:195 | P4 | kept | importDifference returns undefined when the sides agree |
| src/core/validate/recursion_checks.ts:126 | P6 | kept | has tests the within set; get reads the counter map found |
| src/core/validate/recursion_checks.ts:199 | P6 | kept | has tests number; get reads low (a different map) |
| src/core/validate/recursion_checks.ts:202 | P6 | kept | has tests onStack; get reads number (a different map) |
| src/core/validate/recursion_checks.ts:269 | P6 | kept | has tests seen; get reads aliases (a different map) |
| src/core/validate/recursion_checks.ts:301 | P6 | kept | has tests guarded; get reads legal (a different map) |
| src/core/validate/refinements.ts:609 | P6 | kept | has tests seen; get reads aliases (a different map) |
| src/core/validate/typing.ts:97 | P6 | kept | has tests identities; get reads aliases (a different map) |
| src/core/validate/typing.ts:256 | P6 | kept | has tests identities; get reads aliases (a different map) |
| src/core/validate/typing.ts:262 | P6 | kept | has tests identities; get reads aliases (a different map) |
| src/core/validate/typing.ts:277 | P6 | kept | has tests identities; get reads aliases or taggedRecords |
| src/core/validate/typing.ts:636 | P6 | kept | has tests identities; get reads aliases (a different map) |
| src/core/validate/typing.ts:691 | P6 | kept | has tests sealed; get reads aliases (a different map) |
| src/core/validate/typing.ts:736 | P6 | kept | has tests refined; get reads errors (a different map) |
| src/core/validate/guards.ts:8 | P7 | kept | definition of isRecord |
| src/core/validate/index.ts:30 | P7 | kept | first check of forged IR |
| src/core/validate/predicates.ts:121 | P7 | kept | first check of forged IR |
| src/core/validate/predicates.ts:143 | P7 | kept | first check of forged IR |
| src/core/validate/predicates.ts:196 | P7 | kept | first check of forged IR |
| src/core/validate/predicates.ts:280 | P7 | kept | first check of forged IR |
| src/core/validate/refinements.ts:491 | P7 | kept | first check of forged IR |
| src/core/validate/refinements.ts:525 | P7 | kept | first check of forged IR |
| src/core/validate/serialization.ts:118 | P7 | kept | first check of forged IR |
| src/core/validate/serialization.ts:132 | P7 | kept | first check of forged IR |
| src/core/validate_project.ts:40 | P7 | kept | first check of forged IR |
| src/core/validate_project.ts:55 | P7 | kept | first check of forged IR |
| src/core/validate/index.ts:40 | P8 | kept | narrows a caught unknown |
| src/core/validate/serialization.ts:143 | P9 | restructured | the walk already holds asSpan(value.span) as nodeSpan; the loop used it again for the key span |
