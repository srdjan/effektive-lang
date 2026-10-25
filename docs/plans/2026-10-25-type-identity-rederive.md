# Type identity rederive plan

Status: proposed 2026-10-25. Not approved. Base commit: `b988088`.

This plan uses the prefix TD. It comes from a rederive review of the type identity subsystem. The review measured each function and sketched rederivations from the contract. The scratch scripts and sketches are in `/tmp/rederive-ti/` and are not part of the repository. Only the branch deltas of the sketches are firm, because the sketches were parsed but not type-checked or run.

Scope: `TypeTable` identity state and `assignable` in `src/core/types.ts`, `hasIdentity`, `inferTags`, and `tagRecord` in `src/core/check.ts`, `src/core/check_binary.ts`, `flattenIdentityMembers` and `domainOf` in `src/core/patterns.ts`, `recordTarget` and `recordConstruction` in `src/core/check_expr.ts`, and the validator copy in `src/core/validate/typing.ts`. The validator stays independent of the checker. No item shares code between them.

## Baseline

Branches follow the rederive playbook definition, and a `default` does not count. CC is cyclomatic complexity.

| Module (in-scope functions) | Functions | LOC | Branches | CC |
| --- | --- | --- | --- | --- |
| `types.ts` | 20 | 468 | 310 | 250 |
| `check.ts` | 5 | 256 | 80 | 78 |
| `check_binary.ts` | 12 | 212 | 103 | 97 |
| `patterns.ts` | 3 | 92 | 37 | 32 |
| `check_expr.ts` | 3 | 206 | 65 | 62 |
| `validate/typing.ts` | 13 | 347 | 266 | 210 |
| Total | 56 | 1581 | 861 | 729 |

`TypeTable.assignable` has 207 branches and CC 158. The validator `assignable` has 186 branches and CC 138. The identity part of the checker ladder (`types.ts:1418-1491`) has 70 branches.

Full fast suite coverage, branch and line: `types.ts` 94.5 and 94.3, `check.ts` 94.5 and 96.8, `check_binary.ts` 97.0 and 97.5, `check_expr.ts` 93.6 and 97.0, `patterns.ts` 93.6 and 98.1, `validate/typing.ts` 95.8 and 95.8. The slow suite runs in subprocesses, so these numbers do not include it. No test in scope takes more than one second.

## Findings

TD1 (defect). A union of identities takes another name. Step 6 of `assignable` (`types.ts:1477-1485`) tests `sn.kind !== "named"`, so a union source counts as an unnamed value. The union then splits inside the body comparison, and each named member widens to the body. So `(v: Cents | Meters): Score => v` and its `Option` form build with 0 diagnostics, and `build --validate` also accepts them. The validator has the same step (`typing.ts:291-299`). `docs/language-rules.md:30` forbids this. Fix: add `sn.kind !== "union"` to the checker step and `s.kind !== "union"` to the validator step. The review tested the fix on a scratch copy: the leaks are rejected, `1 | 2` still fits `Cents`, and 2125 fast and 208 slow tests pass. Cost: 2 branches.

TD2 (type-driven). `TypeTable` stores the kind of each id in 7 parallel structures (`types.ts:350-358`). They allow 128 combinations per id, and only 10 are legal. Convention alone keeps the legal ones: `defineAlias` clears 6 sets, `markSealed` has a runtime guard, `markTagged` has none, and `tagRecord` replays the flags by hand. Proposal: one `AliasDef` per id, `transparent{body, guarded} | identity{body, sealed, guarded} | tagged{body, sealed} | opaque`. One `define` replaces `defineAlias`, `defineBrand`, and the 5 `mark*` writers. The query names stay, so about 45 outside call sites do not change. Sketch: 47 to 40 branches. Open decision: the sketch drops `sealed` on an opaque type. Only IR that the validator already rejects carries that combination (`world.ts:563`, `:571`).

TD3 (dead code). The brand step in the checker `assignable` (`types.ts:1463-1473`) never runs in production, because `brands` holds only opaque ids and the step excludes opaque ids. Deleting it fails 3 tests in `tests/types_test.ts` (`:439`, `:533`, `:547`), and each one calls `defineBrand` without `markOpaque`, which production never does. Delta: 8 branches. The simplify pass of 2026-10-25 deletes this step and must handle those 3 tests (see TD9).

TD4 (mechanical, after TD2). Rederive the identity ladder of `assignable`. Classify each side as transparent, named, union, or free. Split a source union first, which includes TD1. Widen an identity or tagged record that the module may widen to its body with `adopt=false`. A named target accepts only its own name, or a free value through the body of an open untagged identity. Sketch: 70 to 42 branches. The validator can get the same change in its own code. Risk: medium, because the step order matters.

TD5 (type-driven). `recordTarget` returns a closed union. The current return type allows `construct` and `variants` together, and a `variants` result carries `ref` and `fields` that the consumer drops (`check_expr.ts:1635`). Proposal: `none | record | construct | variants`. Sketch: 6 branches fewer. Tests `check_body_test.ts:3701`, `:3722`, and `:3731` cover the three outcomes.

TD6 (type-driven, optional). Comparison classes in `check_binary.ts` as an ADT. This removes the `"brand:"` string encoding and the `as TypeId` cast at `check_binary.ts:114`. Sketch: 3 branches more. Lowest leverage.

TD7 (mechanical). Merge `flattenMembers` and `flattenIdentityMembers` into one walk, and do the same for the validator's `members` and `identityMembers`. Sketch: 8 to 4 branches. The simplify pass of 2026-10-25 does this.

## Test findings

TD8. TD1 has no test. Before the fix, add a table test (the union does not fit `Score`, and `1 | 2` fits `Cents`), a source test (`type-mismatch/003`, also inside `Option`), and a validator test or fixture mutation.

TD9. `tests/types_test.ts:439`, `:533`, and `:547` test non-opaque brands, which production never creates. Rewrite them with identities or opaque types.

TD10. `tests/types_test.ts:491` and the solution doc `docs/solutions/architecture-patterns/type-identity-is-a-flag-on-an-alias.md` treat `type UserId = Text` as an identity over an identity. Source cannot produce that state: a bare-name body gives a transparent alias (`check.ts:1593`), so `(t: Text): UserId => t` passes. Add a test that this alias is transparent. Correct the doc.

TD11. `tests/types_test.ts:22` tests how the parallel sets clear each other, which is internal. Replace it under TD2.

TD12. Add tests for live paths that the fast suite does not cover: `load` of opaque, tagged, guarded, and sealed types (`types.ts:972-986`), a sealed tagged record with a `_tag` field (`check.ts:1664`), and `sealedRootOf` through an alias (`types.ts:822`, `:825`).

## Architecture findings

The subsystem does no I/O. `TypeReader` (`types.ts:331`) is a read port, but nothing limits the write side. The identity flags are complete only after `checkType`, `inferTags`, and `checkCycles` run in order (`check.ts:1393-1400`). TD2 replaces whole definitions, so no pass can leave a partial mix of flags. The code still uses the retired terms "brand" and "data", and the `"brand"` kind in `TypeNodeInfo` now means opaque. `numericBrand`, `sharedNumericBrand`, and `comparisonClass` are exported from `check_binary.ts`, but only that file uses them.

## Docs to update

The solution doc: the example block, the note on two-step widening, the union rule in rule 2, and step 5 after TD3. `docs/language-rules.md:30`: add that a union of named values takes no other name. `docs/language-rules.md:71` and the code comment at `types.ts:1443-1444`: the clause "identity over another identity" describes a state that source cannot produce.

## Phases

Each phase is one commit and ends with `deno task check` passing.

1. TD8 tests, then the TD1 fix in both files. Expected: the probe gives 2 `type-mismatch/003`.
2. TD9 and TD11, then TD3, if the simplify pass has not done it. Expected: 8 branches fewer.
3. TD12 tests, then TD2. Expected: about 40 branches in the identity methods.
4. TD4. Expected: about 42 branches in the identity ladder.
5. TD5. Expected: 6 branches fewer.
6. TD7 if the simplify pass has not done it, TD6 if accepted, TD10, and the doc fixes.
7. Validator-local merges. `deno task validate:update` must show no fixture diff.

## What not to touch

`hasIdentity`, the flag-on-alias principle and `unfold`, `nameSignature`, `same`, `unionOf`, `domainOf`, `inferTags`, and the structural `switch` in both `assignable` functions. Never share code between the checker and the validator. TD2 must keep the public query names.
