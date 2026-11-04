# Worklog: service imports

The authority is [the service imports plan](2026-11-04-service-imports.md).
This worklog records evidence and steering for that plan. It introduces no separate ID prefix.

## Current objective

Add `imports Users from "./users-service.eff"` and infer function requirements within the module's declared service set.

## Accepted steering

The user selected explicit source paths. The user then removed the proposed leading `module` keyword.
This direction replaces the earlier requirement to write services on each exported function when a module uses service headers.

## Workspace

The branch is local `main`. Deno reports version 2.9.8.
Existing user edits affect `docs/api.md`, `docs/editor.md`, `docs/measurements.md`, and `docs/release-measurements.md`.
The sibling website initially has no changes.

The other workspace task committed its documentation as `b6e29b9`. The service-import work now builds on that commit.

## Evidence

The current declaration checker closes omitted exported `with` clauses in `src/core/check_declarations.ts`.
The interface builder already selects written or solved effect sets through `contractSets`.
The current Users example declares the contract with its functions. The host adapter imports that contract and provides the implementation.

The baseline `deno task check` passes: 2,818 fast tests and 263 slow tests. The command used Deno 2.9.8.
The baseline log is `/tmp/effektive-service-imports-baseline.log`.

## Current work and next action

The read-only compiler review found that existing import links, solving, interfaces, and IR can support this feature.
An independent Sol reviewer found the plan feasible after four corrections. The main agent accepted all four corrections.
The module bound includes requirements in produced values, but excludes requirements that occur only in input types.

Reserved Effect capabilities do not require service headers. Provider acquisition requirements remain after `provide`.
Acceptance now checks foreign service closure and propagation of interface hashes.
The compiler executor is active. Editor and corpus work remain queued until the compiler unit passes its checks.

## Compiler checkpoint

The executor chose contextual `imports` syntax with the existing `ImportDecl` node.
`ImportEntry` distinguishes ordinary imports from service imports. Repeated links to one module must produce one combined IR import.
The first public test failed before implementation with `syntax/009` for `imports` and `unknown-name/001` for `Users`.

The executor owns compiler files and `tests/service_imports_test.ts`. The main agent will review its diff and run the complete gate.
The main agent independently ran `deno test --allow-read tests/service_imports_test.ts` during syntax integration.
The test still failed because exported requirements remained closed. Its log is `/tmp/effektive-service-imports-focused-initial.log`.

The main agent repeated the focused command after export inference changed. The first public test now passes.
The main agent reviewed the initial syntax, index, resolver, lowering, and bound-checking diffs.
The parser now shares statement termination checks between ordinary imports and service headers.

The main agent emitted an in-memory module with a service header and an ordinary import from the same source.
The output combines both bindings in one TypeScript import and gives `find` the type `Effect.Effect<User, never, Users>`.
The main agent confirmed that an ordinary import of an undeclared service produces `requirement-contract/002` when called.

The first full fast-suite check reports 2,818 passes and one failure: the new diagnostic lacks a registered error fixture.
The compiler executor also owns the focused project under `fixtures/errors/requirement-contract-service-import-bound/`.
The main agent ran the expanded focused suite independently: all 12 tests pass.

The suite checks inference, module bounds, provider acquisition, returned contracts, internal Scope, foreign interfaces, incremental updates, lowering, validation, and emission.
The main agent requested small additions for duplicate headers, contextual identifier compatibility, and unused local functions.
The executor completed those additions. The focused file now has 13 tests.

The executor returned its compiler unit. The main agent started the complete gate after reviewing the source and tests.
The first complete gate stopped at formatting. The executor formatted its owned files.
The next gate found two surface-snapshot failures because the new error project adds one CLI case.

The main agent regenerated the surface snapshot. The only change adds the expected new diagnostic and its origin note.
The main agent restarted the complete gate after checking that snapshot diff.
The complete compiler gate now passes. The log is `/tmp/effektive-service-imports-compiler-check.log`.

## Corpus mapping

A separate read-only Sol agent mapped the fixture and website migration.
The contract module must own shared data, errors, and `Users` to avoid a module cycle.
The migration changes service, error, and type identities from `users` to `users-service`.

The corpus unit must update validator fixture inputs and generated manifests as well as ordinary golden output.
The website manifest must include the contract module as a companion of `users.eff` and `main.eff`.
The website typecheck harness removes one-line local imports and combines panels. It needs explicit contract dependencies for each affected panel.

The website requires an asset version increase when `site.js` changes. The selected next site version is `0.14.2`.
The compiler version remains `0.14.1`. No release, tag, or publication is authorized.
