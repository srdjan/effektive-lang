# Compiler reset execution evidence

Authority: [Compiler reset](2026-11-01-compiler-reset.md).
Prefix: CR, shared with the authority because this file records the same phases.

## Objective and constraints

Repair host invalidation, annotated arrow evidence, and deferred callbacks.
Then separate resolution from traversal and reconcile references.
Preserve public APIs, IR version 7, diagnostic order, output, lazy queries, and independent validation outside those corrections.
Work on local main. Commit each complete phase. Never push.
The user authorized the supplied implementation plan. No scope decision remains open.
The executor model `gpt-5.6-sol` accepted the first dispatch with high effort.
Each executor has an eight-tool-turn budget. The main agent owns review, full checks, and commits.

## Completed evidence

The initial tree was clean at `c580de8acea73a4644c179d3081d850634d1516d`.
Deno reports version 2.9.8.
Public `checkProject` reproduces `type-mismatch/011` for the annotated callback example.
Public `checkProject` reproduces `type-mismatch/003` for the annotated local arrow example.
The preservation executor reviewed the plan and reported no implementation blocker.
No Compound Engineering packs apply.

## Host invalidation

CR2 (host invalidation): the new regression failed before the production edit.
The failure showed incremental `a.ts` against fresh `b.ts` after reversal.
The cache key now preserves host insertion order. The emitter keeps first-configured selection.
The main agent reviewed the one-line production change and the full regression.
The targeted command passed 46 tests with exit 0.
The CR2 gate passed with exit 0: 3,119 fast tests and 301 slow tests.
The regression covers warm output, maps, spans, validation, unchanged configuration, restoration, and delayed retained output.
The CR2 commit is `d264c86`.
Mutation tested committed `d264c86`: 55 sites, six sampled, six killed, zero survivors, zero timeouts; exit 0.

## Arrow evidence

CR3 (arrow evidence): public regressions first reported four `type-mismatch/003` diagnostics.
Partial callable evidence now retains annotated parameters, explicit results, and contextual checked flags.
Bindings, parentheses, aliases, local records, and record aliases retain that evidence.
Known complete callable contracts take precedence over partial evidence.
The driver creates no complete function type from arrow evidence.
The main agent corrected syntax in the effect fixture and reviewed every production change.
The targeted command passed 64 tests with exit 0.
The CR3 gate passed with exit 0: 3,121 fast tests and 301 slow tests.
Accepted cases lower and pass independent validation. The negative argument still reports `type-mismatch/003`.
The effect case retains `effect`, `error:m#LocalFailure`, and `cap:m#LocalService.read`.
Before inference changes, measurement reported 726 lines and 240 AST branches.
The CR3 commit is `ec35d42`.
Mutation tested committed `ec35d42`: 250 sites, six sampled, six killed, zero survivors, zero timeouts; exit 0.

## Deferred callbacks

CR4 (deferred calls): the new cases failed before production changes with six `/011` diagnostics and one `/003` diagnostic.
Deferred calls retain complete origins, argument nodes, source nodes, and processed contracts.
A demand enqueues calls for its root. Each call processes each distinct contract once.
Propagation visits call arguments with recovered parameter contracts and preserves checked flags.
No invocation argument creates a callback signature. No whole-body iteration or arbitrary iteration limit exists.
The main agent strengthened dependency ordering, nested aliases, sibling diagnostics, and shadowed-contract coverage.
The main agent reviewed every changed line and repeated the targeted command: 53 passed, exit 0.
Accepted cases lower and independently validate. Unsupported callbacks still report `/011`.

## Resolution boundary

CR5 (resolution boundary): `infer_contracts.ts` owns demands, origins, deferred calls, and final contract resolution.
`infer_inputs.ts` owns syntax traversal, expression evidence, and diagnostic construction.
The resolver returns tagged issues. Its explicit `TypeTable` dependency can intern types.
A driver callback applies each recovered contract to call arguments. The resolver imports no expression checker or emitter.
Tests remain byte-identical to `e5fad97` for behavior capture.
The main agent reviewed both complete source changes and repeated the targeted suite: 49 passed, exit 0.
The first full gate rejected a missing source-map entry in `docs/api.md`.
That required entry moved from documentation closure into this phase. The gate now runs again.

### Simplification review

The five review lenses covered reuse, quality, efficiency, tests, and comments.
The main agent reused `unparen`, removed two unused exports, consumed the queue with a cursor, and deleted one redundant comment.
The main agent retained the driver callback because the plan forbids whole-body iterations, not bounded contextual argument traversal.
The main agent retained table queries on the resolver because they share its explicit table dependency.
No measured bottleneck justifies a second demand index or per-call contract queue in this reset.
Protected proof tests and their two helper comments remain unchanged.
The test review found no defect in the protected tests.

### Measurements

The existing line method excludes blank lines and lines that start with `//`.
It does not count executable statements. AST branches are the measure script's count.

| Revision or file | Lines | AST branches | Import declarations |
| --- | ---: | ---: | ---: |
| Original driver at `c580de8` | 726 | 240 | 13 |
| Driver after fixes at `e5fad97` | 903 | 300 | 13 |
| Extracted driver | 634 | 216 | 13 |
| New resolver | 332 | 85 | 4 |

Both measurement commands passed. The combined modules contain 966 measured lines and 301 AST branches.
The extraction separates responsibilities; it does not reduce the combined line count.

## Current work

CR5 (resolution boundary): the full gate passed after the API map correction.
It passed 3,125 fast tests and 301 slow tests with exit 0.
The main agent will commit, then capture behavior against `e5fad97`.
The independent code review runs against the complete reset diff.

## Unresolved questions

The user authorized all required long checks to run to completion.
No unresolved scope question remains.

## Next action

The main agent will finish callback verification, then separate contract resolution from traversal.

## Refactor mutation follow-up

An additional mutation run tested committed `793597f` in both inference modules.
The sample killed eight faults and left four survivors, without timeouts. The command exited 1.
Three survivors affected field lookup in the driver. One survivor affected named error records in the resolver.
Two new public-API tests cover typed callback fields and compatible field demands on an error identity.
Both accepted cases lower and independently validate. The inference suite passed 35 tests with exit 0.
The parser wraps an expression receiver before the member Name in every FieldExpr.
The evidence lookup therefore needs no receiver-index guard. The main agent removed that redundant guard.
The full follow-up gate passed 3,127 fast tests and 301 slow tests with exit 0.
The next mutation run will check every variant at the three remaining surviving comparison sites.

The new tests require capture with equal tests on both sides.
The main agent will create a temporary comparison commit with `e5fad97` source and the final tests.
This temporary object will not move main or create a branch.

## Documentation preparation

The executor updated architecture, API, development, testing, input-contract reference, and shared terms.
The broad link audit stopped on archive references. The main agent inspected all touched references and corrected the traversal wording.
The main agent checked all three Effektive examples through checking, lowering, and independent validation; all passed.
The canonical website remains accurate: its existing annotation and unresolved-callback rules still apply.
No source form or project status changed, so no sibling website edit is required.

### Directed mutation evidence

The follow-up commit is `ee0c9ed`.
The directed resolver run killed both variants of its former surviving comparison, with zero timeouts; exit 0.
The directed driver run killed three of four variants at its field guard, with zero timeouts; exit 1.
Its remaining logical variant changed `||` to `&&`.
A differential public-API probe compared nine sources and found six differences between original and mutant.
The differences affect inferred parameter contracts during incomplete field recovery. One case also changes a diagnostic.
This survivor is not equivalent. The main agent added a public regression for missing and keyword member names.
The inference suite passed 36 tests. The full gate passed 3,128 fast tests and 301 slow tests with exit 0.
No register exception or coverage threshold change was added.
The main agent will repeat the directed driver mutation after the recovery test commit.
