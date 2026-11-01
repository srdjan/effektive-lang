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

## Current work

CR1 (preservation evidence): the main agent reviewed every changed line.
The generator now edits import policies and provider service contracts.
All eight seeds compare 23 revisions with fresh compilation and delayed retained queries.
The initial host edit introduced a new failure category. The main agent replaced that edit with a compatible service change.
The main agent measured each seed again and updated the literal tallies.
The directed incremental command passed 45 tests with exit 0.
The baseline `deno task check` passed 3,118 fast tests and 301 slow tests with exit 0.
A public `Program` and `TypeScriptOutputs` reproduction confirms stale `a.ts` after host reversal; fresh output imports `b.ts`.
The CR1 gate passed with exit 0: 3,118 fast tests and 301 slow tests.
The main agent will next repair host invalidation.

## Unresolved questions

The user authorized all required long checks to run to completion.
No unresolved scope question remains.

## Next action

The main agent will review preservation tests and complete the first gate.
