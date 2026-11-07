# Plan registry

Each ledger or plan uses its own ID prefix. A new document must not reuse a prefix that another document uses for different items. Pick a new prefix, and add it to this table. A plan that is complete moves to `docs/archive/plans/`, and its row gets the new path.

| Prefix | Document | Scope |
| --- | --- | --- |
| R, P0, D | [`docs/archive/plans/2026-10-20-rederive-review.md`](../archive/plans/2026-10-20-rederive-review.md) | Rederive review |
| H, P, S, T, W, Q | [`docs/archive/plans/2026-10-20-hardening-pruning.md`](../archive/plans/2026-10-20-hardening-pruning.md) | Hardening and pruning |
| FI | [`docs/archive/plans/2026-10-20-extreme-identifier-formatting.md`](../archive/plans/2026-10-20-extreme-identifier-formatting.md) | Extreme identifier formatting |
| RS | [`docs/archive/plans/2026-10-21-refactor-simplify.md`](../archive/plans/2026-10-21-refactor-simplify.md) | Refactor and simplify |
| AU | [`docs/archive/plans/2026-10-21-audit-fixes.md`](../archive/plans/2026-10-21-audit-fixes.md) | Audit fixes |
| SV | [`docs/archive/plans/2026-10-21-save-transpilation.md`](../archive/plans/2026-10-21-save-transpilation.md) | Save transpilation |
| FX | [`docs/archive/plans/2026-10-21-correctness-fixes.md`](../archive/plans/2026-10-21-correctness-fixes.md) | Accepted correctness work |
| ER | [`docs/archive/plans/2026-10-21-editor-release.md`](../archive/plans/2026-10-21-editor-release.md) | Accepted release work |
| CK, IC, ED | [`docs/archive/plans/2026-10-22-decoupling-review.md`](../archive/plans/2026-10-22-decoupling-review.md) | Decoupling work |
| NT | [`docs/archive/plans/2026-10-23-nominal-data-types.md`](../archive/plans/2026-10-23-nominal-data-types.md) | Nominal data types |
| EX | [`docs/archive/plans/2026-10-23-nominal-examples.md`](../archive/plans/2026-10-23-nominal-examples.md) | Nominal examples |
| HB | [`docs/archive/plans/2026-10-23-host-boundary-checks.md`](../archive/plans/2026-10-23-host-boundary-checks.md) | Host boundary checks |
| CM | [`docs/archive/plans/2026-10-23-host-interface-companion.md`](../archive/plans/2026-10-23-host-interface-companion.md) | Companion module of host interfaces |
| NM | [`docs/archive/plans/2026-10-23-nominal-keyword.md`](../archive/plans/2026-10-23-nominal-keyword.md) | The `nominal` keyword |
| PP | [`docs/archive/plans/2026-10-23-portable-applications.md`](../archive/plans/2026-10-23-portable-applications.md) | Portable application roadmap |
| PX | [`docs/archive/plans/2026-10-23-portable-extensions.md`](../archive/plans/2026-10-23-portable-extensions.md) | Approved portable extensions |
| TE | [`docs/archive/plans/2026-10-24-terse-source.md`](../archive/plans/2026-10-24-terse-source.md) | Terse source work |
| MS | [`docs/archive/plans/2026-10-24-compiler-boundaries-source-forms.md`](../archive/plans/2026-10-24-compiler-boundaries-source-forms.md) | Compiler boundaries, IR v4, and concise source forms |
| NI | [`docs/archive/plans/2026-10-24-implicit-nominal-ideation.md`](../archive/plans/2026-10-24-implicit-nominal-ideation.md) | Ideation for nominal identity on `type` declarations |
| TI | [`docs/archive/plans/2026-10-24-type-identity.md`](../archive/plans/2026-10-24-type-identity.md) | Type identity work |
| TD | [`docs/archive/plans/2026-10-25-type-identity-rederive.md`](../archive/plans/2026-10-25-type-identity-rederive.md) | Type identity rederive plan |
| TCM | [`docs/plans/2026-10-24-typescript-content-mappers.md`](2026-10-24-typescript-content-mappers.md) | Deferred TypeScript content mapper integration experiment and adoption assessment |
| RV | [`docs/archive/architecture-review-2026-10-25.md`](../archive/architecture-review-2026-10-25.md) | Architecture review |
| RF | [`docs/archive/plans/2026-10-25-review-follow-up.md`](../archive/plans/2026-10-25-review-follow-up.md) | Follow-up work of the architecture review |
| RW | [`docs/archive/plans/2026-10-25-review-remaining.md`](../archive/plans/2026-10-25-review-remaining.md) | Remaining work of the architecture review |
| IN | [`docs/archive/plans/2026-10-25-inferred-input-contracts.md`](../archive/plans/2026-10-25-inferred-input-contracts.md) | Inferred input contracts and automatic validation |
| RB (phases), RBF (findings) | [`docs/archive/plans/2026-10-25-reset.md`](../archive/plans/2026-10-25-reset.md) | Reset work |
| PW | [`docs/archive/plans/2026-10-26-playground-workbench.md`](../archive/plans/2026-10-26-playground-workbench.md) | Playground workbench layout |
| LG (phases), FR (findings) | [`docs/archive/plans/2026-10-26-self-improvement-loop.md`](../archive/plans/2026-10-26-self-improvement-loop.md) | Logging, report, replay, and the self-improvement loop |
| ES | [`docs/archive/plans/2026-10-27-effect-surface.md`](../archive/plans/2026-10-27-effect-surface.md) | First selection of Effect 4 features to surface in source |
| LR | [`docs/archive/plans/2026-10-27-replay-integrity.md`](../archive/plans/2026-10-27-replay-integrity.md) | Replay ordering and source retention |
| EL | [`docs/archive/plans/2026-10-27-effect-surface-leftovers.md`](../archive/plans/2026-10-27-effect-surface-leftovers.md) | Open points of the effect surface plan: Cron, typed duration patterns, one callback test |
| SL | [`docs/archive/plans/2026-10-27-second-effect-selection.md`](../archive/plans/2026-10-27-second-effect-selection.md) | Second selection of Effect features: `now()`, `random()`, logging, `Map` and `Set` |
| SB (phases), SBF (findings) | [`docs/archive/plans/2026-10-30-stable-base-reset.md`](../archive/plans/2026-10-30-stable-base-reset.md) | Stable base reset |
| CA | [`docs/archive/plans/2026-11-03-concurrent-awaits.md`](../archive/plans/2026-11-03-concurrent-awaits.md) | Concurrent awaits on hot paths |
| MT | [`docs/archive/plans/2026-11-03-mutation-tool-register.md`](../archive/plans/2026-11-03-mutation-tool-register.md) | Mutation register of the mutation tool |
| RST (phases), RSTF (findings), RSTD (decisions) | [`docs/archive/plans/2026-10-30-reset-implementation.md`](../archive/plans/2026-10-30-reset-implementation.md) | Parallel reset plan, not selected |
| NB (phases), NBF (findings), NBD (decisions) | [`docs/archive/plans/2026-10-30-reset-base.md`](../archive/plans/2026-10-30-reset-base.md) | Revision definitions and playground output paths |
| FN (phases), FNF (findings), FND (decisions) | [`docs/archive/plans/2026-10-31-foundation-reset.md`](../archive/plans/2026-10-31-foundation-reset.md) | Foundation reset |
| MU (batches), MUS (survivors), MUF (findings) | [`docs/archive/plans/2026-11-01-mutation-survivors.md`](../archive/plans/2026-11-01-mutation-survivors.md) | Mutation survivors in three modules of the validator and the checker |
| CR (phases) | [`docs/archive/plans/2026-11-01-compiler-reset.md`](../archive/plans/2026-11-01-compiler-reset.md) | Compiler reset |
| SR (items), SRD (decisions), FB and AS (analysis findings), VF and VA (validation findings) | [`docs/archive/plans/2026-11-02-simplification-rebase.md`](../archive/plans/2026-11-02-simplification-rebase.md) | Simplification rebase proposal, with its analysis and validation evidence |
| XC (findings), XCD (decisions), XCU (units) | [`docs/archive/plans/2026-11-02-inferred-export-contracts-review.md`](../archive/plans/2026-11-02-inferred-export-contracts-review.md) | Review of inferred `fails` and `uses` on exported functions |
| FE (phases), FEF (findings) | [`docs/archive/plans/2026-11-03-fresh-eyes-fixes.md`](../archive/plans/2026-11-03-fresh-eyes-fixes.md) | Completed fixes from the fresh-eyes review; progress and checks are in its evidence file |
| EID (decisions), EIU (units), EIF (findings) | [`docs/archive/plans/2026-11-03-inferred-export-failures.md`](../archive/plans/2026-11-03-inferred-export-failures.md) | Inferred failure sets on exports and the `with` clause |
| AD (candidates), K (critique points) | [`docs/archive/feature-review-2026-11-04.md`](../archive/feature-review-2026-11-04.md) | Feature review of 2026-11-04: ranked candidates and their critique |
| PVD (decisions), PVU (units), PVF (findings) | [`docs/archive/plans/2026-11-04-contract-provenance.md`](../archive/plans/2026-11-04-contract-provenance.md) | Contract provenance, phase 1: related locations on contract diagnostics |
| WFD (decisions), WFU (units), WFF (findings) | [`docs/archive/plans/2026-11-04-write-inferred-fails.md`](../archive/plans/2026-11-04-write-inferred-fails.md) | Editor action that writes the inferred failure set as a `fails` clause |
| SID (decisions), SIU (units), SIF (findings) | [`docs/archive/plans/2026-11-04-service-imports.md`](../archive/plans/2026-11-04-service-imports.md) | Explicit service imports and inferred function requirements |
| EU (units) | [`docs/archive/plans/2026-11-04-effect-upgrade.md`](../archive/plans/2026-11-04-effect-upgrade.md) | Effect 4.1.2 pins and compatibility; checks are in the evidence file |
| RCP (phases and findings) | [`docs/archive/plans/2026-11-05-codebase-reset-plan.md`](../archive/plans/2026-11-05-codebase-reset-plan.md) | Completed correctness, verification, and simplification reset |
| UNP (items, written `<slice>.<kind><n>`), UNF (fixes), UNU (units) | [`docs/archive/plans/2026-11-06-untangle-codebase.md`](../archive/plans/2026-11-06-untangle-codebase.md) | Untangle refactor: hidden links, needless links, surplus, and special cases |
| PBF (findings), PBD (decisions), PBU (units) | [`docs/archive/plans/2026-11-07-project-rebinding.md`](../archive/plans/2026-11-07-project-rebinding.md) | Project rebinding after `effektive.json` events |
| DOF (findings), DOD (decisions), DOU (units) | [`docs/plans/2026-11-07-diagnostic-ownership.md`](2026-11-07-diagnostic-ownership.md) | Diagnostic ownership of nested project files |
