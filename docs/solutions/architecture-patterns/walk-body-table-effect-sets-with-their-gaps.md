---
title: A walk over body-table effect sets must cross unfinished nodes and read stage sets
date: 2026-11-04
category: architecture-patterns
module: src/core/contract_origins.ts and src/core/check_expr.ts
problem_type: architecture_pattern
component: type_checker
severity: medium
applies_when:
  - "You write a query that maps a failure or a requirement of a function to the source nodes that introduce it"
  - "You walk `BodyTable.info` from a body root down through the syntax tree"
  - "You extend `contractOrigins` for the phase 2 inlay hint tooltip, or for hover"
symptoms:
  - "The search reports a whole call as the origin, although an argument carries the failure"
  - "The search reports a `try` as the origin, although a handler raises the failure again"
  - "A pipeline stage appears as the origin of a failure of its left value"
  - "A `fail` inside a `using` block is never reached"
tags: [checker, body-table, effect-sets, contract-origins, related-locations, pipeline, stage-sets, implicit-arrow, try-catch]
---

# A walk over body-table effect sets must cross unfinished nodes and read stage sets

## Context

Plan PV (`docs/archive/plans/2026-11-04-contract-provenance.md`) added related locations to `failure-contract/001` and `requirement-contract/001`. `contractOrigins` in `src/core/contract_origins.ts` walks the checker's `BodyTable` from the body root. At each node it selects the children that carry the missing entry. A node with no such child is a location.

The first plan assumed that each syntax node has an `info` entry, and that the `info` of a node holds only the effects of its own subtree. Both assumptions are wrong. The orchestrator, a fresh-eyes critic, and the plan validator each missed or misread a different gap. The critic said that a pipeline stage loses origins. The code shows the opposite: a naive walk reports the stage as a false origin.

## Guidance

`BodyTable.info` holds the effect set of each finished node, for its whole subtree (`finish`, `src/core/check_expr.ts:318`). A walk over it must handle five facts.

1. **Some nodes are never finished.** The `ArgList` of a call (`src/core/check_expr.ts:735`), the `CatchClause` of a `try` (`src/core/check_expr.ts:2648`), and a `PipeStage` with a quiet left value (`src/core/check_expr.ts:1551`) have no `info` entry. Treat such a node as transparent: its children stand in for it, recursively. Without this rule, `Store.put(Store.get())` reports the outer call, and a `try` whose handler raises the error again reports the whole `try`.
2. **A stage with a non-quiet left value holds the effects of a sibling.** Its `info` includes the left value, which is not its child. Its own set is in `BodyTable.stageSets` (`src/core/check_expr.ts:1552`). Read `stageSets` first, then `info`. The reason that `stageSets` exists is in `docs/solutions/logic-errors/pipeline-stage-effects-must-come-from-the-checker.md`.
3. **An arrow node is pure, and some arrows are implicit.** `callbackBody` finishes the arrow node with pure effects and records the fact `{ kind: "arrow" }` (`src/core/check_expr.ts:2383-2384`). Its body nodes are in the same body table. The clauses of `using` and `withResource` are implicit arrows (`implicitArrow`, `src/core/check_expr.ts:2312`), not `ArrowExpr` nodes. Find an arrow by its fact. Replace it by `arrowBody` for an `ArrowExpr`, else by its last child.
4. **A `try` removes the handled errors.** The `try` node subtracts the errors that its handlers name (`src/core/check_expr.ts:2748`). Each handler arm records `{ kind: "handler", error }` (`src/core/check_expr.ts:2736`). Skip the protected block only for an error that a handler of that `try` names. A handler can raise the same error again, and then the handler is the origin.
5. **Two forms remove requirements.** `provide` removes the services that its Layer supplies (`src/core/check_builtins/layer.ts:77`), and `scoped` removes the scope capability (`src/core/check_builtins/scope.ts:64`). No node both removes a requirement from one child and gets it from another, so the plain walk is correct for requirements.

A recursive group publishes only the body tables of its last round, so the stored sets are not stale. An error path still finishes its node (`errorInfo`, `src/core/check_expr.ts:333`).

Reuse `contractOrigins` for a new query of this kind instead of writing a second walk. The fixture matrix in `tests/contract_origins_test.ts` proves each fact: M3 (the handler that raises again), M8 (the stage set), M14 (the `using` block), and M16 (the nested call). Mutation of the module left four survivors. Each one is registered as `equivalent` in `fixtures/mutation/survivors.json`, with its reason.

## When to apply

Apply this when a query needs the source position of an effect, not only the effect set. The walk gives the call site in the current function. It does not follow a call into the callee. A node that introduces an entry and also has a child that carries it reports only the child.
