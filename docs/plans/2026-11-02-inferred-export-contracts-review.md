# Review: inferred `fails` and `uses` on exported functions

Status: review complete on 2026-11-02. Decision XCD1 is open. Prefix: XC (findings), XCD (decisions).

## Result

Do not infer the failure set of an exported function. A written `fails` clause on an export is the only check that catches a new failure before run time. A prototype showed that, with inference, a new failure reaches the host with no diagnostic from any tool.

Keep exported contracts stated, and make them cheaper to state. Service names in `uses` clauses remove 24% of the exported clause text with no compiler change and identical output. A command-line write-back of the existing quick fix removes the typing cost.

## The proposal

The user proposed on 2026-11-02 to remove `fails`, `using`, and similar clauses, because the compiler can infer them. The example removes `fails UserMissing | StoreUnavailable` and the `uses` keyword from `getUser` in `fixtures/examples/users.eff`. The user asked to generalize the idea and to make it better.

This review reads the proposal as "omit the `fails` and `uses` clauses on exported functions, and infer them". Two parts of the literal text do not apply. `using` is the resource expression (`using (x = acquire()) { ... } finally { ... }`), not a contract clause. The compiler cannot infer its finalizer. The bare `Users.find` before `=>` in the example does not parse: Fable observed `syntax/008`. A keyword-less list would also collide with the bare single-parameter arrow `user => ...`.

## Rules today

A non-exported function infers each omitted `fails` or `uses` clause from its body. A written clause closes its own set and acts as an upper bound. An exported function closes both sets, so an omitted clause means an empty set. Sources: the row "Open local contracts" in [language-rules.md](../language-rules.md), `src/core/check_declarations.ts:998`, and line 355 of the canonical specification.

This split is decision D1 "annotate exports, infer locals" of the [terse source plan](../archive/plans/2026-10-24-terse-source.md), accepted on 2026-10-24. The terse-syntax exception in `AGENTS.md` has the condition "keep explicit exported contracts". The proposal reverses D1 and needs a change to that condition.

## Method

A prototype ran in a detached scratch worktree at `7494879`. It opened exported sets and removed the clauses from 19 exported function headers in 11 of the 20 corpus files. The corpus is `fixtures/examples` and `fixtures/applications`. Fable (a read-only subagent) and codex astra (`gpt-6-astra` in a snapshot) reviewed the proposal independently, with file pointers and without these findings.

## Findings

| ID | Finding | Evidence |
| --- | --- | --- |
| XC1 | Every written exported contract in the corpus equals the inferred set. With the clauses removed and inference on, all 20 emitted modules are byte-identical to the baseline. | Observed. All 6 projects pass `build --tsc`. The 4 application check, lowering, and validation tests pass. |
| XC2 | The clauses are about 5% of the corpus. Removing them removes 1,332 of 26,126 bytes (5.1%). `uses` text is about half of the clause text. | Observed. Fable counted 4.7% and astra 5.4% of non-whitespace characters, with other counting rules. |
| XC3 | A new failure in an inferred export reaches the host with no diagnostic. The emitted error type of `submit` gains `Banned`. | Observed in `service-workflow/workflow.eff`. The prototype build, `--tsc`, and `deno check` of `main.ts`, `driver.ts`, and `integration_driver.ts` all exit 0. Today the same edit gives `failure-contract/001` at `workflow.eff:13:44`. |
| XC4 | A leaked requirement is caught only by the host type check, in TypeScript terms. `Effect.runPromise` needs an empty requirement set but accepts any failure set. | Observed. Removing `provide(StoreLive, ...)` gives 0 diagnostics from the build and `--tsc`. `deno check main.ts` gives TS2379 at `Effect.runPromise`. |
| XC5 | `build --tsc` does not check the host driver files. It checks the emitted files and the host modules of `effektive.json` only. | Observed in XC4. This gap exists today, independent of the proposal. |
| XC6 | A method-level `uses` bound states least authority. The emitted TypeScript keeps only service names, so no host check sees a new method call. | Observed. Astra: adding `Users.save` to `getUser` fails today, and the emitted type requires `Users` in both cases. `workflow.ts:41` emits `Catalog \| Runtime` for `uses Catalog.price \| Runtime.database`. |
| XC7 | A written set shields callers from a body that fails less. With inference, the set shrinks, and a caller's `catch` arm for the removed failure becomes unreachable (`failure-contract/002`). | Fable observed the shield and the unreachable-arm diagnostic. The effect under inference is an inference from those two results. |
| XC8 | The change is not one line. Three more sites must use the solved sets: `buildInterface` in `src/core/interface.ts`, its rebuild in `src/core/db.ts`, and the reach graph from `exportedValueIds`. | Observed. With the closure change only, the checker accepted wrong contracts, and `--tsc` gave 3 TS2375 errors. Without the reach-graph change, the validator gave `validation/001` in `portable-publisher`. |
| XC9 | 41 fast tests encode the closed exported contract. The 4 application tests that delete a clause to prove a lost channel lose their purpose. | Observed: 42 of 2,718 fast tests fail with the changed rule and the original corpus. The 42nd test also fails on `main` (XC14). |
| XC10 | Inference must add the entry-validation failure `SchemaError` for an exported inferred input. The body does not produce that failure. | Rule in `docs/inferred-input-contracts.md:54`. Astra observed the build failure when the clause is removed today. |
| XC11 | The keywords stay in the language. Service methods, function types, binding annotations, and `.effi` declarations have no body to infer from. | Observed in `ports.eff`, `platform.eff`, `grants.eff`, and `host.effi`. |
| XC12 | With inference, an edit that changes an exported set changes the interface hash and rechecks every importer. | Probable, from the memo key in `src/core/db.ts:12`. A `watch` measurement can confirm the cost. |
| XC13 | Service names in `uses` clauses state the same sets where a clause lists every method. The change saves 316 bytes, 24% of the exported clause text. | Observed in 5 files on the unchanged compiler. The 5 application projects pass `--tsc`, and the emitted output is identical. |
| XC14 | `tests/docs_test.ts` fails on `main`: `deno.json` has version 0.12.2, and `CHANGELOG.md` has no 0.12.2 heading. | Observed at `7494879`, without the prototype. |

No two exports in the corpus have the same full signature. A shared function type, which astra suggested, saves nothing in this corpus.

## Generalization

The general rule is not "infer everything". The general rule is: the compiler infers what a body does, and the source states what a body may do. A part is stated where other code relies on it, and inferred where no other code relies on it.

Under that rule, D1 is already the general form. Local functions and inline arrows infer their sets. Exported functions, function types, service methods, and `.effi` declarations state their sets. A stated set is a checked upper bound.

The two channels differ at the boundary. A leaked requirement still fails a host type check (XC4). A new failure passes every check (XC3). A method-level requirement is visible to no host check (XC6). So a stated `fails` clause carries intent that the compiler cannot infer: the promise to callers. This agrees with the 2026-10-27 rule for Effect features in source.

To make the rule better, state each contract with the coarsest name that keeps its intent. Use a named error set for failures. Use a service name in `uses`, unless the method list states least authority, as `users.eff` does with `Users.find`. Let tools write the clauses, so that a person never types an inferable set.

## Decision XCD1: exported contracts

1. Keep today's rules and change nothing.
2. Recommended: keep stated exported contracts and make them cheaper. Rewrite the corpus `uses` lists to service names where every method is listed (XC13). Add a command-line write-back of the existing quick fix in `src/core/editor_actions.ts`. Keep method-level names where they state least authority.
3. Infer `uses` on exports and keep `fails` closed. This removes about half of the clause text (XC2). A leaked requirement fails only the host type check (XC4), and least-authority bounds hold only where written (XC6).
4. Infer both on exports, and add a committed snapshot of every exported contract. The build reports drift at the export, and a command accepts it. This keeps the guard but adds a file and a command.
5. Infer both on exports without a snapshot: the proposal as written. A new failure then reaches run time with no diagnostic (XC3).

Options 3, 4, and 5 need the `AGENTS.md` condition "keep explicit exported contracts" changed, and the specification and website updated. Each option except 1 needs a plan with units and checks before work starts.

## Limits of this review

The interface-hash cost of XC12 is not measured. The runtime behavior under inference is not tested, because the emitted code was byte-identical. The prototype used `as never` casts and is not kept. Its four changed sites are named in XC8.
