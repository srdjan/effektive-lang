# Validation report: the simplification rebase proposal

Validator: Fable. Snapshot: `/tmp/eff-fable`, a copy of `cb4abd3`. Finding prefix: VF.
Assigned experiment: task 3, the strict target check as an oracle for a wrong checker contract.

Evidence limits. The snapshot has one commit, so I could not verify commit counts, commit hashes, or log files. I did not run the full suites. Every number below is a measurement from this snapshot. Probe projects, outputs, and the expression-kind extract are under `scratch/vf/`. I restored every source edit with `git checkout`; `git diff --stat` on `src/` is empty.

## 1. Verdict table

| Item | Verdict | Reason | Evidence |
| --- | --- | --- | --- |
| SR1 | accept | Both reproducers hold. The validator does not see the defect. | `build scratch/vf/sr1 --tsc` gives TS2339 at `main.eff:2:48`. `build --validate --tsc` gives the same one diagnostic and nothing from the validator. `TARGET_NAMES` is at `src/core/resolve.ts:220-233` and lacks `Math`, `Error`, `String`. |
| SR2 | modify | The property is right. The proposal gives no cost, and the Deno check cache hides the cost when the emitted text does not change. | Uncached `build --tsc` of a 1-module project: 0.57 s. The same project without `--tsc`: 0.07 s. A rerun on unchanged output: 0.08 s. So the property must vary the emitted text in each case and batch many renames into one project. |
| SR3 | modify | `checkProject` alone misses the defect class that the experiment shows. The test must also emit and type-check. | The 5 website projects pass `build --tsc` today (copies under `scratch/vf/site/`). 21 `.eff` files and 5 `effektive.json` in the sibling. The 16 single files have no configuration, so the test needs a synthetic `{}`. |
| SR4 | accept | Reproduced. | `check scratch/vf/sr4` gives `unknown-name/001` at 3:29 and `syntax/008` at 3:30. |
| SR5 | accept | Both contradictions hold. | `docs/language-rules.md:293` allows `schedule` in `repeat`; line 517 says general Schedules are out of scope; line 932 says `--no-lock`; `src/host/deno_io.ts:132-135` writes `deno.lock` and passes `--lock=`. |
| SR6 | accept | Numbers hold. | `diff src/core/ir.ts ../effektive/public/typed-ir.ts` prints 784 lines. `tests/ir_site_slow_test.ts:4-5` states the weak guard. |
| SR7 | accept | Product paths confirmed. | `src/cli/build.ts:95` and `src/core/db.ts:69,231` are the only product imports of the validator. |
| SR8 | modify | Numbers hold. The oracle map needs three additions: VF1 for match coverage, the emitter mode guard, and a census of the validator fixtures by kept oracle (VF2). | `src/core/validate`: 24 files, 11,086 lines. Validator-only tests: 10,214 lines. `fixtures/validate`: 23 files, 12,876 lines. Scripts: 591 + 153 = 744 lines. The experiment (section 2) gives the oracle map. The validator has no match-exhaustiveness check (`grep exhaust src/core/validate` finds only the proof limit at `refinements.ts:277`). |
| SR9 | accept | Counts and groups hold. | 117 prelude names (`resolve.ts:1-173`). 122 kinds in the `Expr` union (`ir.ts:168-304`). The census rerun (`scratch/prelude_usage.ts`) gives 90 unused by applications and 68 unused anywhere. 68 - 9 basic names + `decode` + `encode` + `scheduleSpaced` + `aggregateWithinStream` = 63. `decode` and `encode` in `portable-publisher/storage.eff:14-15,42,108` are service members. Stream 2,796 and schedule 856 family lines hold. |
| SR10 | accept | Numbers hold. | `scripts/behavior_capture.ts` 387 lines, `scripts/lex_snapshot.ts` 112 lines. |
| SR11 | accept | The validator checks an import payload against itself. | `src/core/validate/world.ts:1348-1384` walks `imp.types`, `imp.errors`, and bindings of the same payload. Under SRD2 option b it folds into SR8. |
| SR12 | modify | The 13 forged-input tests exercise the `internal` guards of `lowerModule` and `emitModule` on IR, which is a published contract, not private state. One such guard is the only oracle for a wrong execution mode (experiment, edit 5). | `tests/internal_sites_test.ts:1-8`. `src/core/emit/expr.ts:425` throws `pure() received an effect-mode ... node`; `tests/emit_test.ts` covers that text. Delete only the tests that read source text. |
| SR13 | accept | Lines hold. Measurement first is right. | `types.ts:489-500` shares `storage` across forks; `614-620` appends on intern. `projects.ts:377-393` keeps the project on close; `540-548` adds roots and never removes one. |
| SRD1 | accept option a | The census confirms the 63 names. The 2 website uses in G2 need a website edit, which the proposal already states. | Census rerun above. |
| SRD2 | modify option b | Option b is viable for contracts. It needs VF1 before SR8, the mode guard test kept (SR12 modify), and the VF2 census. Without VF1 no oracle sees a non-exhaustive match once the checker is wrong. | Section 2. |
| SRD3 | accept option a | `bench/` is the measurement tool for SR2 and SR13. | `bench/`: 17 files, 5,155 lines. Uncached and cached tsc timings above came from manual timing, which `bench/` would make repeatable. |

Totals: 11 accept, 5 modify, 0 reject.

## 2. Experiment: the strict target check as an oracle

Question. Does `build --tsc` catch a wrong failure or requirement contract that the checker computes?

Setup. Probe projects under `scratch/vf/`, each with `effektive.json` = `{}`. Commands: `deno task effektive check <dir> --no-log` and `deno task effektive build <dir> --tsc --no-log`. Each checker edit was one site; I restored `src/` with `git checkout` after each case. The baseline, with the unedited checker, rejects every wrong program and accepts every legal one, so each later acceptance comes from the edit.

| Case | Program | Checker edit | `check` | `build --tsc` |
| --- | --- | --- | --- | --- |
| 1 declared failure dropped | `a-fail`: exported `go(): Text` without `fails`, body `fail(Boom(...))` | `check_expr.ts:489-513` `checkBody`: `body.failures.slice(1)` in the contract check and the stored set | 0 diagnostics (baseline: `failure-contract/001`) | exit 1, `main.eff:5:3 TS2375: Type 'Effect<string, Boom, never>' is not assignable to type 'Effect<string, never, never>'` |
| 1b inferred failure dropped | `c-inferred`: helper `risky` with no written result, exported `go(): Text => risky(flag)` without `fails` | same edit | 0 diagnostics | exit 1, TS2375 at `main.eff:6:41`, the exported function |
| 2 requirement dropped | `b-uses`: exported `stamp(): Text => Clock.now()` without `uses` | `checkBody`: `body.requirements.slice(1)` | 0 diagnostics (baseline: `requirement-contract/001`) | exit 1, TS2375 `Effect<string, never, Clock>` not assignable to `Effect<string, never, never>` |
| 3 wider failure set | `d-wider`: `safe(): Text fails Boom => try { risky(flag) } catch { Boom(e) => ... }` | `check_expr.ts:2715`: catch keeps `body.failures` | 0 diagnostics | exit 0. Annotation `Effect.Effect<Text, Boom>` over a body of type `Effect<Text, never>`. Not caught. |
| 3b false rejection | `d-wider2`: same without `fails Boom` | same edit | `failure-contract/001` | exit 1 with `deno check skipped: the build has errors`. tsc never runs. |
| 3c legal wider sets | `e-legal-wider`: `fails Boom | Never`, body raises only `Boom`; `f-legal-wider-uses`: `uses Clock`, body `"ok"` | none | 0 diagnostics | exit 0 for both. Covariance in E and R. |
| 4 match coverage | `h-match`: 3-variant union, 2 arms | `check_patterns.ts:102`: return before `pattern/001` | 0 diagnostics (baseline: `pattern/001`) | exit 0. Not caught. The chain ends in `$unmatched($t0)` and `$unmatched` takes `unknown` (`emit/decls.ts:789`). |
| 5 execution mode | `i-mode`: helper `{ now(); "ok" }`, exported `go(): Text` | `checkBody` returns `"pure"` when both sets are empty | 0 diagnostics | exit 1 before tsc: `cannot emit main: pure() received an effect-mode now node` (`emit/expr.ts:425`). The emitter guard catches it, not tsc. |
| 6 refinement proof | `j-refine2`: `zero(): Positive => amount(0)` with `Positive = int where n => n > 0` | `check_expr.ts:402`: return true before `type-mismatch/013` | 0 diagnostics (baseline: `type-mismatch/013`) | exit 0. Emitted `export type Positive = typeof Positive.Type`, which TypeScript sees as `number`. Not caught. |
| control | `fixtures/examples` under edits 1 and 2 | | 0 diagnostics | exit 0. A correct program emits the same text under a wrong checker, so there is nothing to catch. |

Why the catches work. The annotation of an exported function comes from the stored contract (`emit/decls.ts:344-348` through `effectTypeDoc` in `emit/types.ts:89`). The body has no cast: the only `as` uses in `src/core/emit` are `as const` literals and table definitions. So TypeScript infers the real failure and requirement sets of the body and compares them with the annotation. The source map places the TS diagnostic on the source line.

Where the catches stop. An annotation is printed only when the source writes a result type (`functionHeaderDoc`, `decls.ts:345`). `declaration/005` forces that for exported functions. A helper without a written result has no annotation; its defect surfaces at the first annotated caller (case 1b). Variance hides a wider set. A false rejection stops the build before tsc. A refinement is a runtime filter, so its proof has no type. Match coverage has no type today.

Conclusion for SRD2. The target check is an independent oracle for the unsound direction of a contract: a failure or requirement that the body has and the stored contract lacks, and a captured global (SR1). It is not an oracle for a wider contract, a false rejection, a refinement proof, an execution mode, or match coverage. The emitter guard covers one mode case. Refinement proofs keep their oracle in SR8 (the certificate check). Match coverage gets an oracle with VF1 below. Wider contracts and false rejections keep the golden files, the surface snapshot, and the fixtures that must compile as their oracle.

VF1 trial. I changed `(_value: unknown): never` to `(_value: never): never` in `emit/decls.ts:789`. `build --tsc` passed with 0 TS errors on 18 projects: `h-match-ok`, `fixtures/examples`, the 5 applications, the 5 website projects, and the 6 `fixtures/emit` projects that have a configuration (`forms` has 12 modules; `unmatched` has nominal, literal, and tag patterns). With that change and edit 4, `h-match` fails `build --tsc` with `main.eff:7:3 TS2345: Argument of type '{ readonly _tag: "main#Shipped"; ... }' is not assignable to parameter of type 'never'`. Not covered by the trial: the 4 emit directories without `effektive.json` (`groups`, `schedules`, `scopes`, `sinks`) and nested patterns, which no corpus program uses.

What the experiment does not prove. Each edit simulates one defect at one site. A defect inside a builtin family that narrows a stored set flows through the same `checkBody` path, so the result applies, but I did not edit a family. I did not test provider contracts (`Layer.Layer<...>`), member-level requirements (`uses Payments.charge` prints `Payments`), host boundaries, or result types.

## 3. Corrections

1. Section 1, last bullet. "TypeScript probably checks failures and requirements of each body independently of the checker" is confirmed only for a contract that is narrower than the body. A wider contract passes (cases 3 and 3c). Replace "probably" with the oracle map of section 2.
2. SR9 family counts. "35 stream, 13 schedule" kinds: 33 kinds in the `Expr` union contain `stream` and 12 contain `schedule` (`scratch/vf/expr_union.txt`). The Map and Set count of 11 holds. The 35 and 13 need their exact kind lists; the count method is not stated.
3. SR2 gives no cost. Measured: 0.57 s for an uncached 1-module `build --tsc`, 0.07 s without `--tsc`, 0.08 s for a cached rerun.
4. SR8 "one miss (SR1)". Confirmed: `build --validate --tsc` on the SR1 program reports only TS2339.
5. Not checkable in the snapshot: "141 of 894 commits", the three false-rejection commits, "24 log files", and "9 sessions". The snapshot has 1 commit and no logs.
6. SR8 "lowering copies a checker fact and diverges" names a risk. Section 2 shows that the target check covers the narrower direction of that class for contracts, so the replacement lowering test only needs the wider direction and the non-contract facts.

## 4. Additional findings

VF1 (missing, S). Type the match guard parameter as `never`. Evidence: section 2, case 4 and the VF1 trial. Proposal: change `emit/decls.ts:789` to `(_value: never): never`, update the text assertion at `tests/emit_test.ts:812`, and add `h-match` as an error fixture whose checker diagnostic is `pattern/001` and whose tsc diagnostic is TS2345 when the checker is silent. Effect: `build --tsc` becomes an oracle for match coverage, which no component other than the checker provides today. Risk: a pattern that TypeScript cannot narrow to `never` would give a false TS error; the 18-project trial found none, and a wildcard arm removes the guard call. Effort S.

VF2 (incomplete, M). Census of `fixtures/validate` before SR8. Evidence: 22 expanded cases plus a manifest, 12,876 lines; the proposal names no mapping from each case to a kept oracle. Proposal: a table with one row per case and the kept oracle that rejects the same defect (structural check, tsc, golden, runtime test, or none). A row with "none" either keeps its validator family or gets a new public test. Effect: SR8 deletes with evidence instead of by family. Risk: none. Effort M.

VF3 (incomplete, S). SR3 runs only `checkProject`. Evidence: section 2 shows that `check` accepts a program with a wrong contract. The 5 website projects pass `build --tsc` today. Proposal: the website test emits each project and single file and runs the target check, with a synthetic `{}` configuration for the 16 single files. Effect: website examples get the same oracle as the applications. Risk: about 0.6 s per project. Effort S.

VF4 (incorrect, S). SR12 classes the forged-IR tests as private-state tests. Evidence: `tests/internal_sites_test.ts:4-5` forges a `CheckedProject` and IR, which are the inputs of the public `lowerModule` and `emitModule`; `typed-ir.ts` is published. Case 5 shows that the emitter guard at `expr.ts:425` is the only oracle for a wrong mode fact. Proposal: SR12 deletes only tests that read source text; it keeps the forged-input tests of entry points. Effect: the coverage floors move less. Risk: none. Effort S.

VF5 (incomplete, S). The relayed TS2375 text ends with "with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties", which is advice about an unrelated option. Evidence: cases 1 and 2. `src/core/emit/tsc.ts:37-38` keeps the first line of the message. Proposal: cut the message at the first sentence when the code is 2375 or 2322. Effect: the user sees the type mismatch only. Risk: none. Effort S.

VF6 (missing, S). `docs/testing.md` has no row for the target check. Evidence: `grep tsc docs/testing.md` finds only the log replay row (line 37). Proposal: add a row that states what the target check catches (narrower contracts, captured globals, and with VF1 match coverage) and what it does not (wider contracts, false rejections, refinement proofs, execution modes). Effect: SRD2 option b has a written oracle map. Risk: none. Effort S.

VF7 (missing, S). SR2 must defeat the Deno check cache. Evidence: 0.08 s for a rerun on unchanged output against 0.57 s uncached. A property that re-emits identical text measures the cache, not the check. Proposal: each property case changes a name, and the test asserts that the emitted text differs from the previous case. Effect: the property measures a real check. Risk: none. Effort S.

## 5. Order and risk

1. Phase 1 adds VF1 and VF6, both before SR8. VF1 is a one-token emitter change plus one test line.
2. SR3 lands with VF3, before SR9, so that a removed name and a wrong contract both show up on the website examples.
3. VF2 runs before SR8 deletes a family. The census is the acceptance evidence of SR8.
4. SR12 follows SR8 with the VF4 modification. The forged-IR guard tests stay.
5. SR2 lands with VF7. Its cost is about 0.6 s per batch on this machine.
6. The rest of the order in Section 6 of the proposal stands.

Risk to the keep set. None of the experiments changed emitted text for a correct program. The strict target check with the pinned lock stays the gate oracle in the slow tests (`tests/emit_slow_helpers.ts:5-62`, the application slow tests, and the CLI slow tests).

## 6. Total judgment

The proposal is a dramatic simplification with measured bounds: SR8 removes about 11,000 core lines, 10,000 test lines, and 12,900 fixture lines, and SR9 removes up to 5,670 family lines gross, against a core of 51,073 lines. The net core after both needs measurement by the G1 pilot and the SR8 unit. The foundation is sound for contracts: the experiment confirms that the strict target check catches every narrower contract and captured global that the checker lets through, at the source line. The foundation has one hole, match coverage, which VF1 closes with one token. Refinement proofs keep their certificate check in SR8. Wider contracts and false rejections have no type-level oracle and keep the golden, snapshot, and fixture oracles. With VF1, VF2, VF4, and VF6, SRD2 option b is safe to accept.

The next action belongs to the orchestrator: merge VF1 to VF7 into the proposal, then the user decides SRD1 to SRD3.
