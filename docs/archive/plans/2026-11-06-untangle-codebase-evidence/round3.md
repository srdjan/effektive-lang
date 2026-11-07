# Round 3 survey (read-only, `749ce2c..HEAD`)

Cycles: `deps.ts cycles` reports only `SCC(2): type_ir.ts, types.ts` (the accepted type-only pair). No new cycle.
I did not run `deno task` commands. I read the whole `src scripts bench playground/build.ts` diff and the test diff.

## Findings worth a fix (3, all small)

1. `src/core/lower.ts:986-1001` (`BodyLowerer.fieldParts`) - hidden link, copy of a rule.
   After `recordFieldParts` returns `undefined`, the method looks up the first `Name` child again (the rule
   that `recordFieldParts` owns) only to call `this.required(...)` for its throw, then ends with an
   unreachable-looking `throw internal("a name node has no identifier")`. The `1a5ec90`-era
   move left a second copy of the label rule and two throws for one condition.
   Fix: replace everything after `if (parts !== undefined) return parts;` with
   `throw internal("a record field has no label")` (touches `src/core/lower.ts` only; internal error text only).

2. `src/core/check_builtins/schema.ts:300-327` (`defaultKeyChoice`) and `:1290` - leftover of the `at` removal (C.H5 fix).
   `defaultKeyChoice` returns `{ op }`, an object with one property, and its only caller destructures it
   (`const { op } = ...`, line 1290). The wrapper existed to carry `op` and `on`; `on` is gone.
   Fix: return the `op` string and drop the wrapper (touches `schema.ts` only). `optionsField` returning
   `{ value }` stays: it separates "field absent" from "field has no value".

3. `tests/sourcemap_test.ts:184` - false comment. `// A source is scanned once for its line starts, however many offsets
   look it up.` sits between the doc comment and `assertRoundTrip`. The cache it described moved into
   `tests/support/line_scan.ts` (`scanLines`), and `assertRoundTrip` no longer does any scan itself.
   Fix: delete the line (touches `tests/sourcemap_test.ts`).

## Not worth it (reasons)

- `src/core/types.ts:233` (`optionElementOf` in the `TypeReader` Pick): `git grep -w optionElementOf` shows only
  `check_expr.ts` and `infer_inputs.ts`, and both hold a `TypeTable`. The Pick entry has no reader user. It is one
  line, and `TypeReader` already lists writers' siblings (`recordBodyOf`). Remove only if a change touches the type.
- `src/core/types.ts:808` (`declaredBodyOf`) overlaps `recordBodyOf` (the same error and tagged cases plus alias). The
  three callers need the alias case, `recordBodyOf` callers must not get it. Two names are the real difference.
- `check_builtins/effect.ts:555-609` and `tables.ts:102`: the `log` fact `fields` is now a label string that always
  equals `"fields"`; the `schema` fact `options.on` always equals `"on"`. They act as flags and as the lookup key for
  the lowerer. A boolean would need the lowerer to repeat the literal, which is a worse link. Keep (consistent with the
  Fable F1 fix).
- `src/lsp/features.ts:85`: `texts.get(path) ?? ""` is a dead fallback because `texts.has(span.source)` guards it.
  Harmless; `rangeConverter` requires a total function.
- `src/core/type_show.ts:56-60` slices `node.id.slice(hash + 1)` twice, and `declaredName` (line 41) is the same
  expression. It predates `749ce2c`, local to one file, and `shortName` differs for no-hash ids on purpose (UND1).
- `ModulePolicy<D>` (`check_project.ts:688`) has one generic user (`db.ts`). It is the reviewed F2 fix; the default
  parameter keeps `CHECK_EVERY_MODULE` simple. Keep.
- `emitFailureAsResult` (`emit/emit.ts:178`) has two callers that both use it; the generic `E` is real. Keep.
- `validate/report.ts` imports `fallbackSpan` from `validate/prelude.ts` (`moduleSpan` and `fallbackSpan` are two names
  of one idea, one takes a module name, one takes the IR). No cycle (deps tool). Keep.
- `scripts/lib.ts` `tolerateRemoveFailure` has two callers (`bench/m5.ts`, `bench/m5_variants.ts`). Real use.

## Round 2 and adversarial fixes: complete?

- `optionElementOf`, `declaredBodyOf`, `recordFieldParts`, `memberAccessParts`, `hostNameSpans`, `FieldHelperKey`,
  `moduleSpan`, `guards.ts isRecord`: no remaining copy found by `git grep` in src (the validator copies of checker
  rules are on purpose). `util.ts isRecord` vs `validate/guards.ts isRecord`: a deliberate split (validator import rule).
- Part left: finding 1 (the lowerer still holds the label rule) and finding 2 (wrapper of `defaultKeyChoice`).
- F1 (`1a5ec90`): index `at` gone from tables, checker, lowerer. Complete. F2 (`75a0772`): no closure left. Complete.
- Unexported names (`CONTEXTUAL_WORDS`, `DECLARATION_START_WORDS`, `isIdentStart`, `buildInitializationGraph`,
  `BUILTIN_INSTANCE_NAMES`): `git grep -w` shows no outside user. Complete.
- `ids.ts:118` hand-slices after `#` inside the owner of `shortName`; `shortName` differs for reserved ids. Not worth it.

## Tests

- `tests/*_mutation_test.ts` (four files), `tests/support/line_scan.ts`, and the diff of existing tests use literal
  expected values and exact diagnostics. `line_scan.ts` is an independent scan, with `sourcemap_test.ts` as its only user.
  No test that repeats the implementation or cannot fail was found.
- `tests/core_helpers_mutation_test.ts:~196-212` ("memberAccessParts returns no member when the only Name child is the
  base"): input `const v = a . ( .` depends on parser error recovery (two FieldExpr nodes, order of a stack walk, empty
  base text). It asserts a recovery shape, not a user-visible result, and `fieldExprs` holds a loop. Fragile, but it
  kills a real survivor. Not worth it unless the parser recovery changes.
- `tests/validate_checks_mutation_test.ts`: paths such as `declarations[8]` and the depth literals `1537`/`1538`
  (bound `MAX_DEPTH` + 1) tie to the seed layout and the constant. They fail loudly on change. Keep.
- `tests/docs_test.ts` weakened `assertEquals(cited.length, 7)` to `> 0`: intended (count was a repeat of the table).
