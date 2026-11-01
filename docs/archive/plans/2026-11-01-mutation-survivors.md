# Mutation survivors plan

Prefix: MU (batches), MUS (survivors), MUF (findings). Status: complete.

This plan is the authority for the work on the 126 mutation survivors in three modules. A survivor is a mutant that the fast tests do not detect. The ledger is [`2026-11-01-mutation-survivors-ledger.json`](2026-11-01-mutation-survivors-ledger.json). It gives each survivor its ID, batch, site, and disposition.

## Authority

The user approved option (a) of Decision 5 on 2026-11-01. That approval authorizes this plan, seven Sonnet batches of at most 20 survivors, long mutation runs, new tests, register rows, and commits on local `main`. It does not authorize a change in `src/` or `scripts/`, a push, a release, a version change, or a website commit.

The user then approved option (a) of Decision 6 on 2026-11-01. That approval authorizes one change in `src/core/validate/expr.ts`, the tests for MUS77 and MUS101, a behavior capture, the archive move of this plan, and commits on local `main`. It does not authorize a push or a release.

## Starting evidence

The runs at `22f6efa` used seed 1, sample all, and the fast suite.

| Module | Sites | Killed | Survived | Unregistered |
| --- | --- | --- | --- | --- |
| `src/core/validate/families/schema.ts` | 362 | 302 | 60 | 60 |
| `src/core/check_builtins/schema.ts` | 291 | 276 | 15 | 15 |
| `src/core/validate/expr.ts` | 410 | 359 | 51 | 51 |

No survivor is on a line that changed between `2bae0c4` and `22f6efa`. The foundation reset limited its mutation work to six other modules, so these three modules have no register rows. Of the 126 survivors, 95 are `logical`, 19 are `comparison`, 8 are `boolean-return`, and 4 are `negate-if`.

## Batches

Each batch adds one new test file, so that batches cannot conflict. The orchestrator merges register rows.

| Unit | Model | Survivors | Declarations | New test file | Acceptance | Budget |
| --- | --- | --- | --- | --- | --- | --- |
| MU1 | Sonnet | 17 | `schemaOf` to `schemaUnion` in the validator family | `tests/validate_schema_constructor_guards_test.ts` | Batch check below | 40 turns |
| MU2 | Sonnet | 20 | `schemaOptionalFromRequired`, `schemaOptionalTransform`, `schemaRecursive`, `schemaTransform.callbackResult` | `tests/validate_schema_optional_guards_test.ts` | Batch check below | 40 turns |
| MU3 | Sonnet | 19 | `schemaTransform`, `guardedSchemaBody`, `guardedSchemaBody.visit` | `tests/validate_schema_transform_guards_test.ts` | Batch check below | 40 turns |
| MU4 | Sonnet | 19 | All of `src/core/check_builtins/schema.ts`, and the validator `schemaOperation` | `tests/check_schema_guards_test.ts` | Batch check below | 40 turns |
| MU5 | Sonnet | 18 | `tagMayEqual` to `BodyValidator.block` | `tests/validate_body_guards_test.ts` | Batch check below | 40 turns |
| MU6 | Sonnet | 18 | `BodyValidator.ifExpr`, `matchExpr`, `pattern`, `fail` | `tests/validate_control_guards_test.ts` | Batch check below | 40 turns |
| MU7 | Sonnet | 15 | `BodyValidator.binary`, `binary.isNull`, `instantArithmetic`, `durationArithmetic` | `tests/validate_operator_guards_test.ts` | Batch check below | 40 turns |

## Method

Each batch works in a private clone of local `main` in `/tmp/mu/`, because the mutation tool reads the committed `HEAD`. The clone can hold scratch commits. The main tree stays untouched until the orchestrator reviews the batch.

For each survivor, the executor first tries to write a test through a public function: `validateModule`, `checkProject`, or `lowerProject`. A forged IR is a valid input of `validateModule`. A test asserts the exact code and message. A test has no logic, except a table of literal cases. A test runs in under one second, starts no subprocess, and needs only read permission.

A register row is the second choice. The class `equivalent` needs a reason that proves that no input of a public function can observe the change. The class `slow-only` needs a reason that names the `*_slow_test.ts` file, and a measured kill with that file.

MU1 runs alone, to prove the method. The other batches then run in groups of up to three.

## Stop rule

A test can show a real defect: a valid program that fails, or an invalid IR that passes. The executor then stops work on that survivor, keeps a reproduction, and reports the defect in its handback. This plan does not authorize the repair. The orchestrator reports the defect to the user.

## Verification

Batch check, in the clone after a scratch commit. For each line of the batch, run:

```sh
deno task mutate --seed 1 --sample all --only <module>:<line> <module>
```

Expected: each mutant on the line is killed, or it has a row in the clone's `fixtures/mutation/survivors.json`.

The orchestrator reviews each diff line by line. It runs `deno task check`, and it commits one batch at a time. The expected exit status is 0.

Final check, on local `main`:

```sh
deno task check
deno task coverage
deno task mutate --seed 1 --sample all src/core/validate/families/schema.ts
deno task mutate --seed 1 --sample all src/core/check_builtins/schema.ts
deno task mutate --seed 1 --sample all src/core/validate/expr.ts
git diff --stat 22f6efa HEAD -- src scripts
```

Expected: each command exits 0, each mutation run prints `unregistered survivors 0, stale rows 0`, and the last command prints only the repair of MUF1.

## Result

All seven batches are committed: `18791f8`, `713e79c`, `1aa3339`, `96ccfa7`, `9f33717`, `5361439`, and `99fcb01`. The repair of MUF1 is `fdadb8d`. Of the 126 survivors, 117 have a test and 8 have a register row of class `equivalent`. The site of 1 survivor, MUS76, is gone, because the repair split its condition. No batch needed the class `slow-only`. The only change in `src/` or `scripts/` is the repair, in `src/core/validate/expr.ts`.

The final runs used seed 1, sample all, and the fast suite. The first two rows are from `99fcb01`, and the third row is from `fdadb8d`. The repair changed no line of the first two modules.

| Module | Sites | Killed | Survived | Timeouts | Unregistered | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| `src/core/validate/families/schema.ts` | 362 | 357 | 2 | 3 | 0 | 0 |
| `src/core/check_builtins/schema.ts` | 291 | 289 | 2 | 0 | 0 | 0 |
| `src/core/validate/expr.ts` | 411 | 407 | 4 | 0 | 0 | 0 |

The three timeouts are on line 488 of the first module. The tool counts a timeout as a kill. They did not repeat: `--only src/core/validate/families/schema.ts:488` killed all 4 mutants of that line, with 0 timeouts, in 21 s. Their cause is not known.

The gate at `fdadb8d` exited 0, with 3,118 fast tests and 301 slow tests. `deno task coverage` exited 0 there: lines 97.50%, branches 95.38%, functions 99.30%. `deno task rules:unfired` reported 0 sites. A behavior capture compared the old source with the new source and ignored the two tests of the changed behavior on both sides. It gave 32,945 records on each side, with 0 new and 0 missing.

The review of the batches changed four results. MUS101 had a row that a probe disproved, so that row is removed. MU5 had a test that pinned MUF1, so that test is removed. One row now states that a syntax error stops the check, and one row no longer names a line number.

## Findings

MUF1 (low, confirmed, repaired in `fdadb8d`). The rule for a literal pattern accepted a wrong literal at the depth bound. `tagMayEqual` in `src/core/validate/expr.ts` returned `true` when `seen.size >= MAX_DEPTH`. Other comparisons fail at the bound: `fits` returns `false`, and `comparisonClass` returns `undefined`. No document states that this rule must accept at the bound.

Reproduction: lower `const f = (x: A): Text => match x { "a" => "a", _ => "b" }`, where `A` is an alias of `Text`. Forge `A` into a chain of aliases that ends in `string`, and forge the pattern value to the number `1`. With 1,534 aliases, `validateModule` reported "the literal 1 does not belong to the subject". With 1,535 aliases or more, up to the 3,000 tested, it reported nothing.

Reach: `declaration/012` limits an alias to 128 levels in the checker, and the validator does not repeat that limit. So only a forged IR reaches the bound. A program from the checker cannot. The effect is a match arm that can never run. This needs no change for a valid program.

The repair returns `false` at the bound and keeps `true` for a cycle, as option (a) of Decision 6 states. MUS77 is the comparison at the bound. MUS101 differs from the source only at the bound. A test that pinned the old result was forbidden by the stop rule, so both stayed open until the repair. The test "a literal pattern fails on an alias chain past the depth bound" now kills both.

## Completion

The commit that completes this plan moves the plan and its ledger to `docs/archive/plans/`, updates the registry path, and fills each disposition of the ledger.
