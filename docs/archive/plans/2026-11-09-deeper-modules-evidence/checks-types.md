# Nullish checks that the types already decide

Opus ran this census on 2026-11-09 at `1a55b60`. It covers every `.ts` file under `src/`.

The census script loads `src/` into a TypeScript 5.9.3 program, with the options of `deno.json`: `strict` and `exactOptionalPropertyTypes`. It visits each optional chain (`?.`), each nullish fallback (`??` and `??=`), and each comparison with `null` or `undefined`. It keeps a site when the checker type of the operand at that point cannot hold `null` or `undefined`. It skips `any`, `unknown`, and type parameters. The program has no Deno or `@std/path` types, so their values read as `any` and drop out.

The project does not set `noUncheckedIndexedAccess`. So `items[0]` has the element type, even when the array is empty. The script therefore marks a site as an index read when its operand reads an element: directly, or through a local name whose value comes from an element read, an array destructure, or a call of `at`, `pop`, or `shift`.

| Result | Sites |
| --- | --- |
| Operand type cannot be nullish | 137 |
| Index reads, which are real checks | 125 |
| Left to judge | 12 |
| Removed | 0 |

| Site | Decision | Reason |
| --- | --- | --- |
| `src/core/emit/module_state.ts:388`, `:393`, `:398`, `:406`, `:410` | keep | `HelperNames` has optional fields, so each `??=` fills a helper name at its first use. The checker gives the write type of the target. |
| `src/core/predicates.ts:495` | keep | `checkTerm` is the entry check of predicate JSON from an imported interface. |
| `src/core/requirement_provenance.ts:199` | keep | `node` is `NodeId \| undefined`. The loop assigns `originOf(node)`, which can be `undefined`. |
| `src/core/requirement_provenance.ts:251` | keep | `child` is `children[1]` or `children[0]` through a conditional expression, an index read that the script does not follow. |
| `src/core/validate/index.ts:61` (`?.` and `??`) | keep | The validator reads IR that can be forged, so a declaration slot can be `null`. |
| `src/core/validate/refinements.ts:479`, `:512` | keep | The same validator rule for a predicate and a term. |
