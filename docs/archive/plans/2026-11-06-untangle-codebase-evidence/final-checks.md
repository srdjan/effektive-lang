# Final checks

Each section gives the command, the commit, and the lines of its output that carry the result. The base is `30bb1d5`. The last code commit is `0198e7c`. The two commits after `37a720f` are the bench fix `2501e2d` and the survivor unit S5 `0198e7c`.

## Gate

`deno task check` in the main tree, with the sibling website present, at `37a720f` and again with the bench fix:

```
ok | 2966 passed | 0 failed | 6 ignored
ok | 285 passed | 0 failed
exit 0
```

S5 adds three fast tests. `deno task test` at `0198e7c` passed 2969 tests. The gate before the archive commit covers the final tree.

## Coverage

`deno task coverage` at `0198e7c`:

```
Total: lines 97.41%, branches 95.36%, functions 99.24%
exit 0
```

The base gave lines 97.28, branches 95.20, and functions 99.21.

## Behavior comparison

`deno task behavior:compare 30bb1d5 HEAD` at `0198e7c`:

```
check: 123 equal, 0 changed, 0 missing, 0 added
program: 11 equal, 0 changed, 0 missing, 0 added
program-error: 2 equal, 0 changed, 0 missing, 0 added
lower: 146 equal, 0 changed, 0 missing, 0 added
lower-error: 27 equal, 0 changed, 0 missing, 0 added
emit: 89 equal, 0 changed, 0 missing, 0 added
emit-error: 7 equal, 0 changed, 0 missing, 0 added
validate: 56 equal, 0 changed, 0 missing, 0 added
exit 0
```

## Unfired rejection sites

`deno task rules:unfired` at `0198e7c`:

```
src/core/validate/expr.ts:1825: this.add(
1 unfired rejection sites
exit 1
```

The site is the type check of a catch binding. The base has the same site unfired at line 1792, so the set of unfired sites is unchanged.

## Log replay

`deno task logs:replay` exits 0 for the six fixture logs and for the four local playground session logs, at `37a720f`.

## Mutation

`deno task mutate --seed 1 --sample all` over the 21 new or moved modules, at `37a720f`:

```
timeout src/core/validate/recursion_checks.ts:269 logical: current.kind !== "named" || seen.has(current.id) -> &&
unregistered survivors 0, stale rows 0, elapsed 1044 s
exit 0
```

The same command over `src/core/db.ts` and `src/core/check_project.ts`, at `0198e7c`:

```
src/core/db.ts 54 54 50 4 0
src/core/check_project.ts 68 68 65 3 0
unregistered survivors 0, stale rows 0, elapsed 78 s
exit 0
```

The columns are sites, sampled, killed, survived, and timeout. The plan section "Mutation survivors" explains the timeout and S5.

## Website

The `../effektive` website tests: 12 passed. The strict type check of the TypeScript panels: 65 units passed.

## Browser check

Playwright against `deno task playground:serve` at `2501e2d`, after a reload of `app.js` and `app.css`:

- Source selection: the `users.eff` tab shows `users.ts` in the output pane.
- Hover on `getUser` shows the Contract block `getUser(id: UserId): User fails StoreUnavailable | UserMissing with Users.find` and the Backend type block.
- A cursor on `getUser` shows the position `Ln 10, Col 17` at once and the contract in the status bar after the pause.
- A breaking edit (`Some(user) => missingName`) shows the banner "This module has errors. This is the last good output.", `Problems (1)`, the tab badge `1 error`, and the last good output. Hover then shows the contract and "backend type: not available while the module has errors".
- After the edit is undone, the banner is hidden, `Problems (0)` shows, and the badge is gone.

## Fault run for the payload hash

At `aa7d4e1`, `payloadOf` in `src/core/db.ts` was made to return its fallback, `deno task test` ran, and the file was restored. The failing tests, counted by unique name:

```
   3 ./tests/db_test.ts
   8 ./tests/incremental_property_test.ts
   1 ./tests/output_characterization_test.ts
   1 ./tests/revision_isolation_test.ts
```

The message of `2501e2d` says eight tests in three files. That first count read only the first eight lines of the output.
