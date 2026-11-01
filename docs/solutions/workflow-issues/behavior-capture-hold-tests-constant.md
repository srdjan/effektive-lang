---
title: Hold the test set constant to read behavior:capture when a change also moves tests
date: 2026-10-20
category: workflow-issues
module: scripts/behavior_capture.ts
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A refactor commit also moves, deletes, merges, or rewrites tests"
  - "behavior:capture reports missing or new records after a change that should keep behavior"
  - "A change renames or removes a source form, so tests rewrite their own Effektive sources"
  - "A capture shows one new or one missing program record and nothing else"
  - "A refactor changes the CLI or the language server output, which the capture does not record"
  - "A capture spans many phases, and the head tests do not load on the base source"
  - "A change is meant to alter behavior, so its new tests fail on the base source"
tags: [behavior-capture, oracle, refactor, git-commit-tree, byte-identity, rederive, run-variance, characterization-test]
last_updated: 2026-10-31
---

# Hold the test set constant to read behavior:capture when a change also moves tests

## Context

`deno task behavior:capture <base> <head>` is the refactor oracle of this
project. It runs the fast and slow suites on both revisions and compares the
record sets as multisets (`scripts/behavior_capture.ts:331`, `:369-370`).
Each `check`, `program`, and `validate` record holds a hash of its input
(`scripts/behavior_capture.ts:13-17`, `:56`). That hash makes a clean program
visible, but it also ties every record to the test that produced it.

So a commit that moves or rewrites tests changes the record set even when no
source behavior changes. In this session, deleting `typeAt` and moving its
tests onto `hoverAt` gave "missing in HEAD: 2" (`check`) and "new: 3"
(`program`), because the same programs now ran through `Program.update` and
not through `checkAnalysis`. A missing record normally means a behavior
change, so the raw result is a false alarm that a reviewer cannot dismiss
without more evidence.

The same procedure was needed earlier, by the rederive Phase 2 coordinator,
which captured the Phase 2 source with the Phase 1 test set (session history;
see `docs/archive/plans/2026-10-20-rederive-review.md` section 12).

## Guidance

Build a temporary commit object that holds the base source and the head tests.
Then capture it against the head. Both sides then run the same tests, so any
difference comes from the source. `main` does not move, and the working tree
does not change: the commands use a separate index file.

```bash
export GIT_INDEX_FILE=<scratch>/tmpindex
git read-tree <base>                       # base tree into the temporary index
git rm -r -q -f --cached tests             # -f: the index differs from HEAD and the work tree
git read-tree --prefix=tests/ HEAD:tests   # head tests over the base source
T=$(git write-tree)
C=$(git commit-tree "$T" -p <base> -m "temp: base src with HEAD tests")
unset GIT_INDEX_FILE
deno task behavior:capture "$C" HEAD
```

Read the result as follows. "new 0, missing 0" shows that the source change
keeps every recorded result for the programs that the head tests run. It does
not cover what the capture does not record (see "Run variance and blind
spots" below). Up to two new or missing clean `program` records can be run
variance. Any other difference is a real source behavior change.

Two refinements:

- Without `-f`, `git rm --cached` refuses with "staged content different from
  both the file and the HEAD". Both sessions hit this.
- When a head test does not compile against the base source (it calls a
  function the change adds), patch that one file in the temporary index:
  `git hash-object -w <edited copy>`, then
  `git update-index --cacheinfo 100644,<blob>,tests/<file>`.

The method fails when the tests rewrite their own Effektive sources, for
example when a builtin is renamed or removed. Then the base compiler rejects
the new sources, and the input hashes differ on both sides. For such a change,
use a byte-identity proof: extract the base compiler with
`git archive <base> src | tar -x -C <dir>`, compile each old source with it,
compile the rewritten source with the head compiler, and compare the emitted
TypeScript, the serialized IR, the interface hash, and the hover text. The S1,
S2, and S4 builtin removals were verified this way.

## A span that is too long to hold the tests constant

The method also fails over a span of many phases. The head tests can import a
renamed file or a name that the base does not have, so they do not load on the
base source. Run the plain capture, then explain each missing row:

1. Find the last revision with the base source:
   `git diff --shortstat <base> <rev> -- src` prints nothing.
2. Run `deno task behavior:capture <base> <rev>`. No source changed in this
   span, so each missing row of this capture comes from a test edit.
3. Compare the two missing lists with `comm -13` on sorted rows. A row with an
   equal kind and equal hashes in both lists has the same cause.
4. Search the capture logs of the later phases for each row that remains. A row
   in the plain capture of a phase, and not in its held-tests capture, comes
   from a test edit of that phase.
5. Treat a row that no log explains as a behavior change.

This proof is weaker than a held-tests capture. It gives the cause of each
missing row, but an input that left the test set has no record at the head. So
this proof says nothing about the head behavior for that input. Step 4 also
needs the phase logs, so keep each capture log until the work closes.

## A change that is meant to alter behavior

A capture stops when a test fails on a compared revision
(`scripts/behavior_capture.ts:311-314`). So the method above cannot run when a
change alters behavior on purpose: the new expectations fail on the base source,
and the old expectations fail on the head source.

Use one test set on both sides, and leave out the tests that changed:

1. Run the held-tests capture once. Its failure list names the tests to leave
   out.
2. Copy the test file, and change each of these tests to `Deno.test.ignore`.
3. Build two temporary commits that share the edited file. Then capture one
   against the other.

```bash
B=$(git hash-object -w <edited copy>)
export GIT_INDEX_FILE=<scratch>/tmpindex
git read-tree <base>
git rm -r -q -f --cached tests
git read-tree --prefix=tests/ HEAD:tests
git update-index --cacheinfo "100644,$B,tests/<file>"
OLD=$(git commit-tree "$(git write-tree)" -p <base> -m "temp: old source")
git read-tree HEAD
git update-index --cacheinfo "100644,$B,tests/<file>"
NEW=$(git commit-tree "$(git write-tree)" -p HEAD -m "temp: new source")
unset GIT_INDEX_FILE
deno task behavior:capture "$OLD" "$NEW"
```

"new 0, missing 0" shows that no other recorded program changed. The ignored
tests hold the evidence for the intended change, so they must pass at the head.
The capture says nothing about an input that only the ignored tests run.

## Run variance and blind spots

A capture of one revision against itself is not always equal. On 2026-10-22,
a temporary commit captured against itself gave 9123 and 9124 records: 1 new
`program` record and 0 missing (`docs/archive/plans/2026-10-22-decoupling-review.md`,
section 9). Earlier captures in the same plan also gained or lost clean
`program` records that reruns of one revision did not repeat. The cause is
probably a test whose number of speculative programs depends on timing. It is
not confirmed.

The reset plan captures of 2026-10-26 narrowed it. The variance records had
the input hashes `83f02953ec49d241` and `f1634df78e1d6629` in RB3 and in RB5,
up to two records in one capture. A probe capture of one revision that wrote
out the inputs of these two hashes found neither of them. So these inputs are
transient file sets that only some runs reach, probably an intermediate state
in a timing-dependent watch or save test. A probe run in which the variance
occurs can name the test.

So accept up to two extra or missing `program` records only when:

- the record is clean. A record line is `kind input-hash result-hash size`
  (`scripts/behavior_capture.ts:56-57`), and a clean result `[]` has size 2.
  The capture prints the new records (`scripts/behavior_capture.ts:372`) and
  the missing records, so read the size.
- no other record differs.

For any larger difference, capture each revision alone
(`deno task behavior:capture <rev>` prints its records) and compare the sets.

The capture records completed calls of the core library, also in the child
processes of the slow tests. It records no stdout or stderr text, no CLI
output, and no language server log.

ED3b of that plan moved the CLI watch round and the language server save round
onto one shared function. Its capture was clean, and all tests passed. But the
watch loop printed the removed paths and the notes of each module together,
where it had printed all removed paths first. A line-by-line review found the
change. The fix restores the old order, and a test with two leaving modules
in `tests/watch_stale_test.ts` pins it.

Before such a refactor, add characterization tests of the output text and
order. Use at least two items wherever the old code flattens per-item
results.

Each capture exports a revision to a new temporary path and runs the tests
there. Deno keeps compile cache entries for each path, so the capture uses its
own DENO_DIR and removes it after (`scripts/behavior_capture.ts:253-254`,
`:316`). Do not run two captures at once, or a capture with the gate, because
some slow tests check the temporary directories of the system.

## Why This Matters

Without this step, a reviewer has two bad choices for a commit that moves tests.
The reviewer can accept unexplained missing records, and so hide a real
behavior change. Or the reviewer can reject a correct refactor. The capture
exists to judge refactors that agents implement, and claims from the
implementer are not evidence. A false alarm that only the implementer can
explain defeats that purpose.

## Read-only subprocesses in an instrumented tree

The cold-chain test starts its child with `--allow-read` only. In an
instrumented tree, the child must also append to `capture.records`, or the
capture fails although the compiler behavior did not change. Since RB3 of the
reset plan, `captureRevision` in `scripts/behavior_capture.ts` grants that
child write access to the record file of the instrumented tree. It fails
visibly when the permission anchor in `tests/parse_chain_slow_test.ts`
changes. The repository test keeps its read-only permission.

The capture runs also leave out `tests/docs_test.ts`. That test checks the
documents, not compiler behavior, and it rejects the hook files that the
instrumentation adds under `src/`.

## When to Apply

When a compared revision predates the process-scoped benchmark directory
prefix, run the full repository gate and behavior capture serially. Its cleanup
tests compare all matching harness directories in the system temporary
directory before and after each test. Concurrent verification runs can see
each other's directories and fail those assertions on both the unchanged
base and the candidate. During the Codec extraction, the failures named only
changing `effektive-bench-lsp-` directories; the concurrent logs were retained
and both checks were rerun serially. On 2026-10-22, the harness prefix gained
the creating process ID, so current cleanup checks detect their own leaks
without observing directories from other runs. The regression also verifies
that an owned leftover remains visible.

- Before you accept any refactor commit that deletes, moves, merges, or
  rewrites a test, when its capture against the base shows any difference.
- When an implementer reports "the differences come from the test changes".
  Run this check; do not accept the claim.
- Not needed when the capture already shows "new 0, missing 0", or when the
  only differences are new records from added tests and no record is missing.
  A clean capture still says nothing about CLI or language server output, so
  a change to that output needs its own tests.

## Examples

In this session, the batch after `e2832b4` (up to `af26d21`) deleted `typeAt` and
moved its tests to `hoverAt`. The direct capture
`behavior:capture e2832b4 HEAD` reported 2 missing `check` records and 3 new
`program` records. The capture of the temporary commit (base source `e2832b4`
plus the head tests) against HEAD reported "new 0, missing 0". That result
showed that the source changes of the batch kept behavior, and that the whole
difference came from the test move.

The foundation reset captured `80dfbff` against `de79193`, and 15 missing rows
stayed outside the expected `emit-error` and `lower-error` kinds: 12 `check` and
3 `lower`. The source of `d64b7cb` equals the source of `80dfbff`, and the capture
of that span held 11 of the 15 rows. The plain capture of FN6 unit 4 held the
other 4 rows, and its held-tests capture held none of them. So test edits caused
all 15 rows.

The repairs of FNF28 and FNF29 (`14e027c` and `6359f27`) changed checker and
validator results on purpose. The held-tests capture from `2bae0c4` stopped with
10 failed tests, and all 10 held new expectations. With those 10 tests ignored
on both sides, each side gave 32485 records, with new 0 and missing 0.
