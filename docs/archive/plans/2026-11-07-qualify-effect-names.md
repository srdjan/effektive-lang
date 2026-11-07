# Qualify colliding names in effect lists

Status: in progress on the branch `qualify-effect-names`, which starts at the head of `untangle-knots`. The user approved this plan on 2026-11-07 (decision D2 of the knots follow-up). The branch is not pushed or merged.

## Problem

QN1 (the defect): a message that shows two types prints `module#Name` when two named types share a short name (`src/core/type_show.ts:54-61`). The failure, requirement, and provider lists of the same types print only the short name (`src/core/type_show.ts:99-138`). Two different errors named `E` then look the same.

Reproduction through the CLI, with modules `a` and `b` that each export `error E`:

```text
main.eff:3:24: error type-mismatch/003: argument 1 has type () => Int fails E, but () => Int fails E is expected
```

## Fix

QNU1 (one unit, done by Opus, because it changes one source file): add one private function `idText(names, id)` to `type_show.ts`. It records the id in `names.shown` and prints `module#Name` when the id is in `names.qualified`. The `named` case and every id list in `print` use it. An id without a collision prints as before, so other messages do not change.

The test comes first. It goes next to "two identities with one short name print as module#Name" in `tests/check_body_test.ts` and must fail before the fix. The expected message is:

```text
type-mismatch/003 argument 1 has type () => Int fails b#E, but () => Int fails a#E is expected
```

## Not in scope

- `showType` prints one type without a collision check. It stays as it is.
- `effectText`, the hover text of one function contract, keeps short names.
- QN2 (anomaly 5 of the knots follow-up): the CLI and the language server use different rules for an offset between a `\r` and its `\n`. A probe converted all 164 `.eff` fixtures to `\r\n` line ends: none of the 392 diagnostics has such an offset. The defect is latent, so this plan does not change it.

## Checks

- The new test fails before the fix and passes after it.
- `deno task check` exits 0.
- `deno task mutate --sample all src/core/type_show.ts` gives no new survivor and no new stale row.
- `CHANGELOG.md` gets one entry under `## Unreleased`.
