# Adversarial review of the untangle refactor (30bb1d5..749ce2c)

Reviewer: Fable subagent. Worktree: `<scratch>` (HEAD 749ce2c). Base: `<scratch>` (30bb1d5).

## Result

No CONFIRMED behavior change outside the intended UND1, UND2, UND3, UND6, and the three modifier fixes of `899ce2e`.
Four PLAUSIBLE findings, all structural (new hidden links or an error-order change on inconsistent input). None changes output for a program that the checker accepts.

## Empirical checks run

1. `deno task behavior:compare 30bb1d5 HEAD`: check 123, program 11, program-error 2, lower 146, lower-error 27, emit 89, emit-error 7, validate 56 records equal; 0 changed, 0 missing, 0 added; exit 0.
2. Editor probe (`<scratch>/probe.ts`) on both trees over the 27 fixture projects that have an `effektive.json`: `Program.update`, diagnostics, `semanticClassifications`, `documentSymbols`, `inlayHintsAt`, `revision.lowered`, `outputs.emitted`, and at every identifier and punctuation offset `sourceHoverAt`, `hoverAt` (with `TypeScriptOutputs`), `definitionAt`, `completionsAt`, `occurrenceAt`, `referencesAt` (both flags), `signatureHelpAt`, `prepareRenameAt`, `contractActionsAt` (both flags), `failsClauseActionsAt`, and `renameAt` with `q1`, `Math`, `void`, `fails`; then four revisions per project (whitespace shift, breaking edit, undo, file removal) with `revisionDelta`, `interfaceHash`, `counts`, lowered IR, and emitted text. 535,077 records per tree. `cmp base.out head.out`: IDENTICAL (outputs in `<scratch>/`).
3. Parse probe: a `FieldExpr` base is a `NameExpr`, not a `Name`, so the `fieldParts` member rule (`index > 0`) equals the old `infer_inputs.ts:261` rule (`find(kind === Name)`) on real trees.

## Contract checks (all hold)

- Validator imports: only `../ir.ts`, `../source.ts`, `../diagnostics.ts`, type-only `../predicates.ts`, and its own files (grep of `src/core/validate/`).
- `src/core` has no `Deno.`/`globalThis` host call (the `globalThis.` hits are emitted text in `emit/fields.ts` and `emit/decls.ts`, and a name list in `resolve.ts`) and no non-relative import.
- Emitter value imports reach only `diagnostics.ts`, `graph.ts`, `ids.ts`, `ir.ts`, `paths.ts`, `source.ts`, `util.ts`; `project.ts`, `project_config.ts`, `predicates.ts`, `result.ts` are type-only (`tests/emit_families_test.ts:42` allowlist matches the grep).
- `scripts/behavior_corpus.ts` runs unchanged in the 30bb1d5 tree (the compare above exercised it). Its `withoutDiagnostics` helper (line 225) sets `blocked: new Map()`, which the old tree ignores and the new tree needs.

## Findings (most severe first)

### F1 PLAUSIBLE: index coupling between the checker's option facts and the lowered record fields

- `src/core/check_builtins/effect.ts` (`logOptions`, `fieldsAt = index` over `c.kids(arg.node)`), `src/core/check_builtins/schema.ts` (`optionsField` returns `index`, `defaultKeyChoice` returns `on: field.index`), `src/core/lower.ts:829-833` (`options.fields[fact.fields]?.value`) and `src/core/lower.ts:1049-1075` (`options.fields.filter((_, index) => index !== at)`).
- What: the checker records a syntax child index and the lowerer applies it to the IR `record.fields` array. The two arrays agree only while every child of the options record is a `RecordField` and `recordFields` lowers them 1:1 in order. Base code looked the field up by name (`find(f => f.name === "fields")`, `filter(field => field.name !== "on")`) and guarded `options.kind === "record"`; the new log path dropped that guard.
- Condition: a spread or shorthand child (`{ ...base, fields: x }`) would desynchronize the indexes (the IR becomes an `update` node whose `fields` hold only the explicit fields). Today `optionField` (effect.ts:194) and `defaultKeyOptionsShape` report a diagnostic for a non-`RecordField` child, so the module is never lowered. No output change today.
- Effect: a future relaxation of the options shape in the checker silently changes emitted text (wrong `fields` value or a dropped `on` key) with no compiler error. New hidden link (brief item 3). Evidence: code paths above; IR `record` expression at `ir.ts:168` has only `fields`, spreads lower to `update` at `lower.ts:1076`.

### F2 PLAUSIBLE: the memo policy carries state between `decide` and `settled` through a closure

- `src/core/db.ts:330-383`: `let keys = { rest, lowerKey }` is assigned in `decide` and read in `settled` (`keys.rest`, `keys.lowerKey`, and the `key:` signature at line 364).
- What: `ModulePolicy` (`check_project.ts:681-690`) documents the two callbacks as "before each module" and "after each module" but does not state that `settled(name)` may read what `decide(name)` computed, that no other `decide` runs in between, and that `settled` is called for every module that `decide` saw. `driveProject` (`check_project.ts:704-742`) happens to call them strictly in pairs.
- Condition: any future driver that skips `settled` on a path, batches decisions, or calls `decide` twice (for example a speculative revision) silently stores the keys of the wrong module in the memo entry.
- Effect: a stale `rest`/`lowerKey` makes a later `update` reuse a checked module whose inputs changed, so diagnostics or IR of a revision differ from a fresh check with no error. Not a behavior change today (the probe revisions and `tests/db_test.ts` agree). New hidden link.

### F3 PLAUSIBLE: `CheckedProject.blocked` and `ModuleResolution.defectArms` must be supplied by every forger

- `src/core/check_project.ts:745-763` (`blockedModules`), `src/core/lower.ts:1670` (`checked.blocked.get(module)`); `src/core/resolve.ts:1352` (`defectArms.add(kid)`), `src/core/check_expr.ts:2566` (`defectArms.has(errorNode)`).
- What: the lowering block and the `Defect` arm test moved from a local rule to a field that an earlier phase must fill. `scripts/behavior_corpus.ts:225` and `tests/internal_sites_test.ts:55` already had to add `blocked: new Map()`. The plan records the `blocked` link; the `defectArms` link is recorded only in the UNU7 integration note.
- Condition: a tool or test that builds a `CheckedProject` with diagnostics but an empty `blocked`, or a `ModuleResolution` without the arm set, gets a lowered module with errors, or a `Defect` arm checked as an unresolved error name (`errorTarget` undefined, no `failure-contract/003`).
- Effect: no product path does this (both are built by `driveProject` and `Resolver`), so no behavior change; the TypeScript types require both fields. Convention that callers must know (brief item 3).

### F4 PLAUSIBLE: error order in `lowerImports` changed for a merged service import

- `src/core/project.ts` (`planImports`), `src/core/lower.ts:1512-1560`.
- What: base iterated `info.links` in order, ran the `no-interface` test and resolved the names of each link, then merged service links with the same label. HEAD merges the names first (`planImports`) and then resolves all names of a merged label at the position of its first link.
- Condition: a module whose links are `imports S from a` (index 0), `import {X} from b` (index 1), `import {Y} from a` (index 2) where `b` has no interface and `Y` has no resolver target. Base returns `no-interface` for `b`; HEAD returns the internal `the imported name Y has no target` error first.
- Effect: only on inconsistent input (both faults at once); `lowerModule` is not reached for a module with diagnostics, and a missing target is a resolver defect. Output for accepted programs is identical (146 lower records equal). Low severity.

## Traced and found equivalent (not findings)

- `db.ts` memo: `payload`/`signature`/`refresh` paths equal the base; `PREDICATE_RULES_VERSION` left the key on purpose (D.N2). `refreshInterface` passes `previous.graph` where the base rebuilt it from the same `declarations` and `solved`; `buildTypeGraph` is deterministic on those inputs.
- `blockedModules` equals the base `lowerModule` count rule (`max(named by path, module.diagnostics.length)` over normalized diagnostics).
- `lex.ts`: `isKeywordKind` set equals the enum range `KwImport..KwNull` plus `KwFinally`, `KwWith` (13 kinds); the contextual word sets of `editor_tokens.ts`, `editor_completion.ts`, `parse.ts` (`DECLARATION_START_WORDS` with the 4..8 length bound), and the playground highlighter are the same sets as before; `isIdentifier`/`isIdentPart` match the removed regexes including `$`.
- `declarationOf` equals the removed `targetSpan` (`builtin`, `builtin-type`, `field`, `unresolved` targets have no `id`).
- `hasModifier`/`isOpaqueTypeDecl`: only the three documented inputs change.
- `nominalBodyOf`, `recordBodyOf`, `isErrorOrTagged`: a `TypeId` has one def kind, so `identityBaseOf ?? taggedRecordOf` and `taggedRecordOf ?? identityBaseOf` agree; both changed sites are guarded by `ownsSealed`/`isTypeId`.
- `literalFitsPrimitive` in `check_patterns.ts`: the domain primitive is only `string|int|number`, same truth table.
- `UNIT_ARITHMETIC` table: every (operator, left, right) cell gives the same outcome as the removed `instantArithmetic`/`durationArithmetic`, including Instant-first precedence and the `general` fallthrough.
- `literalTagOf` equals both removed walks; `recursionIsGuarded` moved unchanged.
- `signatureFunctionRef` recomputes `checkedInputFlags`, which is what the caller passed; `reportCheckedInputs` early return equals `checkedInput`.
- `ModuleState.finish()` emits the same import groups; `importLine` for `effect` and the host assertion marks (`hostName` is `fresh`, so one host per mark) give the same records.
- `stepOutput` in the language server and the playground: `lastGood` is written with the same value in the failure case.
- `planWrites.held` equals the old LSP loop (`writableSet` = writable and lowered ok); `DiskProgram.read/update` keeps `known` semantics of both adapters.
- `parseEnvelope("replay")`, `parseEnvelope("browser")`, `parseSessionFileName` equal `asEnvelope`, `toEnvelope`, `isReplayName`; `io.openLog(root, surface)` equals the removed inline `openFileLog` call.
- Option constructor roles: `Some` still runs `someCall` with its own arity; pattern coverage keys `some`/`none` are internal and cannot collide with `N:`, `L:`, `T:` keys.
- Emitter builtin instance switch: base also threw `the builtin ${name} has no emission form` in its `default` arm.
- Test pass: each removed test named in the commit bodies has a kept test that fails under the stated fault; `db_test` "an update with no change" now asserts `Program.counts`, which implies the reused `lowered` object identity that the `TypeScriptOutputs` WeakMap depends on.

## Not checked (budget)

- `tests/*_slow_test.ts` CLI watch and session flows beyond reading `session.ts` and `projects.ts` diffs; `cli/fix.ts` `reviseWithEdits` call sites; `bench/**` and `scripts/lib.ts` runner permissions; the playground `events.ts`/`app.ts` saving-label helper; `service_bounds.ts` and `initialization.ts` diagnostic order beyond the corpus `check` records.
