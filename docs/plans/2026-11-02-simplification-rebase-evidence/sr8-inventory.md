# SR8 inventory: validator guarantees, fixture census, kernel size, and SRD4 options

Base: `git archive` copy of local main `85fd121` at `/tmp/eff-sr8/repo`. Date: 2026-11-02.
The scripts in `sr8-scripts/` read that copy by absolute path. To run them again, make the copy first:
`mkdir -p /tmp/eff-sr8/repo && git archive 85fd121 | tar -x -C /tmp/eff-sr8/repo`.
Scope: the kept language. The items that Phase 3 removes appear only in Section 3.3.

## 1. Result

Guarantees (Section 2): 55 guarantees of the kept language.

| Status | Count |
| --- | --- |
| Covered by another kept oracle | 10 |
| Partly covered | 27 |
| Validator only | 18 |

Fixture census (Section 4): `fixtures/validate/` holds 23 JSON files: 22 fixtures and `manifest.json`. The plan says 22 cases. That number is correct for the fixtures.

| Disposition | Count |
| --- | --- |
| Another oracle catches it: the strict target check | 6 |
| Another oracle catches it: the emitter guard | 4 |
| Validator only: keep the check or add a public test | 12 |

Line counts (Section 5). "Code" means lines that are not blank and not comment-only. "Raw" means all lines.

| Measurement | Code lines | Raw lines |
| --- | --- | --- |
| (a) Validator now: `src/core/validate/**` and `src/core/validate_project.ts` | 9,448 | 10,260 |
| (b) Lines that Phase 3 removes | 1,032 | 1,075 |
| (c) Validator after Phase 3 | 8,416 | 9,185 |
| (d) Kernel K1: proof check and int literal rule, without the expression walk | 1,674 | 1,850 |
| (d') Kernel K3: K1 plus the expression walk, which the inferred-contract check needs | 6,325 | 6,835 |

Main finding: the three defects that the oracle map calls "only the validator" need the expression walk. The walk is 6,325 of 8,416 code lines (75%) after Phase 3. A kernel without the walk (K1) is 1,674 code lines (20%), but it cannot find proof obligations by itself. Recommendation (Section 6): option A, keep the kept families.

## 2. Guarantee inventory (SR8 step 1)

### 2.1 Terms and evidence

- STC: the strict target check. It is `build --tsc`: `deno check` of the emitted TypeScript with `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` (`src/cli/tsc.ts:16-20`).
- EG: the emitter guards in `src/core/emit/expr.ts`. Line 423 throws `pure() received an effect-mode <kind> node`. Line 670 throws `<kind> node in a structural position`. Line 894 throws `unbound local <id>`.
- GOLD: the golden files in `fixtures/golden/` (collections, log, main, pay, traverse, users). They hold specific inputs only.
- IRS: `tests/ir_snapshot_test.ts:5`. It compares IR, emitted text, source maps, and interface hashes of the examples project (`fixtures/ir/examples-baseline.json`). It holds specific inputs only.
- CHK: a public checker diagnostic. `tests/fixtures_test.ts:139-141` requires an error fixture for each registered code.
- M1: the script `sr8-scripts/fixture_tsc.ts`. It replaces the lowered IR of one module with a forged fixture, emits with the public `emitProject`, and runs STC. Output: `sr8-scripts/fixture_tsc.out`. Both baselines (examples, ir) pass with exit 0.
- M2: the script `sr8-scripts/fixture_golden.ts`. It compares the emitted text of each forged fixture with the emitted text of the true lowering. The true emission equals each golden file (measured).
- M3: the script `sr8-scripts/measure.ts`. It measures lines and the call graph.

Status rules. "Covered": a kept oracle catches the defect class, with measured or test evidence. "Partly covered": a kept oracle catches some cases, or catches only the source rule (CHK), or catches only specific inputs (GOLD, IRS). "Validator only": I found no kept oracle. "Inferred" marks a claim without a test or a measurement. Each inferred claim names the check that can confirm it.

A note on CHK. A checker diagnostic proves that the checker rejects the bad source in its error fixtures. The validator proves that the lowered IR obeys the rule. The validator adds value only on inputs that the error fixtures do not hold. Two tests run the validator on generated programs: `tests/acceptance_property_slow_test.ts:143` and `tests/incremental_property_test.ts:81`.

Locations are under `src/core/`. A location is `file:function:line` of the report call.

### 2.2 Serialization (`validation/008`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | The IR records format `light-functional-ir` version 8. | `validate/serialization.ts:checkSerialization:50` | `expected the format light-functional-ir version 8, recorded ...` | IRS compares the examples IR (inferred: the snapshot holds the format field; confirm with `grep '"format"' fixtures/ir/examples-baseline.json`). | Partly covered |
| S2 | Each listed source is among the supplied source texts. | `validate/serialization.ts:checkSerialization:61` | `the source <s> is not among the supplied source texts` | None found. | Validator only |
| S3 | Each span has a source and two offsets, names a listed source, and lies inside that source. | `validate/serialization.ts:checkSerialization:75`, `:153` | `a span has a source and two offsets`; span problems at `:75` | M1: two fixtures pass STC. M2: emitted text is identical. IRS compares source maps of the examples only. | Validator only |
| S4 | Each number in the IR is finite. | `validate/serialization.ts:checkSerialization:117` | `a number must be finite, recorded <v>` | None found. | Validator only |
| S5 | Each effect set is sorted and unique. | `validate/serialization.ts:checkSerialization:143` | `an effect set is sorted and unique, recorded [...]` | M1: passes STC. M2: emitted text is identical. | Validator only |
| S6 | A malformed IR gives a diagnostic, not a crash. | `validate/index.ts:validateModule:41` | `the IR has an unexpected shape: ...` | Not applicable: this is robustness of the validator itself. | Validator only |

### 2.3 Identity (`validation/001`, and `validation/009`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| I1 | Each declaration identity has the expected form and appears once. | `validate/world.ts:checkDeclarationHeaders:725`, `:733` | `expected the identity <e>, recorded <r>`; `the identity <id> is declared twice` | M1: duplicate declaration passes STC. M2: emitted text is identical. | Validator only |
| I2 | Each export is declared in the module and appears once. | `validate/world.ts:checkDeclarationHeaders:764`, `:772` | `the export <id> is not declared in this module`; `the export <id> appears twice` | M1: passes STC. M2: emitted text is identical. | Validator only |
| I3 | Each import payload is consistent: no own identity, no duplicate, each export declared, each binding targets an export. | `validate/world.ts:checkImport:1305`, `:1313`, `:1317`, `:1346`, `:1356` | `an import payload cannot claim this module's identity ...`; `the binding <b> targets <t>, which the module <m> does not export` | CHK `unknown-name/002` for the source rule. | Partly covered |
| I4 | The prelude import has no bindings, exports exactly its builtin ids, and each builtin id and name has the fixed form. | `validate/world.ts:checkImport:1369`, `:1377`, `:1388`, `:1397` | `a builtin identity has the form value:<m>#$builtin/<name>/<hash>, recorded ...` | None found. | Validator only |
| I5 | Each reference targets a parameter, a binding, or a declaration in scope. | `validate/expr.ts:reference:903` | `the target <t> is not a parameter, a binding, or a declaration in scope` | EG line 894 (`unbound local`), measured by M1 on `identity-unknown-reference.json`. A reference to an unknown declaration: STC inferred (confirm with a forged-IR run like M1). | Covered |
| I6 | A builtin appears only as the callee of a call. | `validate/expr.ts:reference:912` | `the builtin <t> may appear only as the callee of a call` | EG test `tests/internal_sites_test.ts:308` ("a builtin that is not a callee gives an internal emission error"). CHK `unknown-name/004`. | Covered |
| I7 | Each local identity has the local form and is declared once in its function. | `validate/expr.ts:declareLocal:253`, `:261` | `<id> is not a local identity`; `the local <id> is declared twice in this function` | CHK `declaration/001` for the source names. | Partly covered |
| I8 | Each perform names a method of a service of the module or of an import. | `validate/expr.ts:perform:1501` | `the capability <c> is not a method of a service of this module or of an import` | STC: M1 gives TS2551 on `identity-unknown-capability.json`. | Covered |
| I9 | Each type id and each nominal construction names a declared type. | `validate/world.ts:checkTypeIds:239`; `validate/expr.ts:nominal:1173` | `the type <t> is not a declared type` | CHK `unknown-name/001`. STC inferred (confirm with a forged-IR run). | Partly covered |
| I10 | Each constructed or handled error is declared. | `validate/expr.ts:errorConstruction:1257`; `validate/expr.ts:catchExpr:1831` | `the error <e> is not declared`; `the handled error <e> is not declared` | CHK `unknown-name/001`. | Partly covered |
| I11 | Each service method has the identity `cap:<service>.<method>` and is declared once. | `validate/world.ts:checkServiceDecl:571`, `:579` | `expected the capability identity cap:...`; `the capability <id> is declared twice` | STC catches a wrong method name at a perform (M1, I8). The id form itself: inferred. | Partly covered |
| I12 | The IR records the module name under which it was lowered. | `validate_project.ts:validateProject:195` | `module: expected the lowered module <n>, recorded <r>` | None found. | Validator only |
| I13 | Each import payload equals the export of its producer in the same call (producer binding). | `validate_project.ts:importDifference:141`, `validateProject` | `validation/009`: `imports[i]: the import of <m> in <n> differs from the producer ...` | `tests/validate_import_binding_test.ts` uses the validator. No other oracle found. | Validator only |

### 2.4 Types (`validation/002`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | The recorded type of each node equals the recomputed type. | `validate/expr.ts:finish:620` | `expected <t>, recorded <r>` | STC catches 2 of 7 type fixtures in M1 (TS2741, TS2339). It misses 5 (recorded string, literal as int, identity mismatch, binary result, sealed literal). | Partly covered |
| T2 | An `int` literal is a safe integer. | `validate/typing.ts:literalFits:230-245`, through `finish` and `accepts` | as T1 or T3 | Oracle map: "only the validator". M1: `types-literal-as-int.json` passes STC, text identical. | Validator only |
| T3 | A value fits the type of its context: argument, field, element, binding, body result, initializer, Some value, nominal base, branch. | `validate/expr.ts:1389`, `:962`, `:1041`, `:1083`, `:1548`, `:518`, `:582`, `:724`, `:1213`, `:1313`, `branchFits:1600` | for example `the argument has type <a>, which does not fit the parameter <p>` | CHK `type-mismatch/003` (18 occurrences in `fixtures/errors`). STC catches structural mismatches (M1: TS2345 on the provide job). STC misses identity mismatches between two names of one primitive (M1: `types-identity-mismatch.json` passes). | Partly covered |
| T4 | A callee is a function, a call has the right arity, and recorded parameter types match. | `validate/expr.ts:call:1415`, `checkArguments:1357`, `checkParameterTypes:312`, `:318` | `the function takes <n> arguments, the call has <m>` | CHK `type-mismatch/004`, `type-mismatch/008`. STC inferred for arity (confirm with a forged-IR run). | Partly covered |
| T5 | Record, array, and tuple constructions, field reads, and updates have the right shape. | `validate/expr.ts:checkFieldValues:939`, `:946`, `:976`; `recordLike:995`; `arrayLike:1025`; `tupleLike:1065`; `get:1106`; `update:1146` | for example `the construction is missing the required fields ...` | STC: M1 gives TS2741 on `types-record-into-tagged.json`. CHK `type-mismatch/005`, `/006`. | Partly covered |
| T6 | Nominal construction obeys identity, opaque, and sealed rules. A foreign module cannot construct, update, or compute with a sealed type. | `validate/expr.ts:nominal:1182`, `:1189`, `:1199`; `update:1134`; `binary:1970` | `the module cannot construct the foreign sealed type <t>` | CHK `sealed/001`, `/002`, `/003`. STC misses it: M1 `types-sealed-literal-foreign.json` passes. | Partly covered |
| T7 | A condition is boolean, and an operator accepts its operand types. | `validate/expr.ts:ifExpr:1618`; `binary:1952` | `a condition must be boolean, but it has type <t>` | CHK `type-mismatch/007`. | Partly covered |
| T8 | A pattern belongs to its subject, its binding has the expected type, and a duration pattern holds safe-integer milliseconds. | `validate/expr.ts:pattern:1690`, `:1699`, `:1723` | `<p> does not belong to the subject of type <t>` | STC: M1 gives TS2339 on `types-untagged-name-pattern.json`. `tests/emit_unmatched_slow_test.ts` covers a lost arm. CHK `pattern/003`. | Covered |
| T9 | Declarations are well formed: no `_tag` or duplicate field, no function or deferred field in a tagged record, unrefined host data, correct sealed, tagged, and opaque flags, no recursive type, bounded depth, pure function types with empty rows, builtin shapes. | `validate/world.ts:431`, `:439`, `:496`, `:538`, `:639-679`, `:1095`, `:337`, `:514`, `:1073`, `:390`, `:1129`, `:1137` | for example `the type <id> refers to itself; version 0 has no recursive types` | CHK `declaration/007`, `/009`, `/010`, `/012`, `/015`, `/016`, `/017`, `/018`, `execution-mode/005`. | Partly covered |
| T10 | `fail` takes a named error value, and a reserved target error cannot be constructed in source. | `validate/expr.ts:fail:1799`; `errorConstruction:1247` | `fail needs a value of a named error type, ...` | CHK `type-mismatch/010` names `fail`. Reserved target errors: no checker evidence found. | Partly covered |
| T11 | Borrow and checked-entry rules hold: borrow flags match parameters, borrow parameters are opaque, borrow functions return data, checked entry lists exactly the checked parameters of an exported function, with a schema-derivable type. | `validate/expr.ts:checkFunction:419-500`; `validate/world.ts:checkServiceDecl:589-620`; `checkTypeIds:279`; `closure:1298` | for example `a borrow parameter needs an opaque type` | No error fixture contains `borrow` (measured: 0 files). 5 non-validator test files mention `borrow` (inferred coverage; confirm by reading `tests/inferred_entry_validation_test.ts` and the borrow tests). | Partly covered |
| T12 | A generated capture marker is `true`. | `validate/expr.ts:block:1560` | `a generated capture marker must be true` | None found. | Validator only |

### 2.5 Effects and contracts (`validation/003`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | A written `fails` or `uses` clause bounds the body. | `validate/expr.ts:checkFunction:532`, `:556` | `the body can fail with <x>, which the declared failures <d> do not list` | STC: M1 gives TS2375 on `contracts-body-exceeds-declaration.json`. CHK `failure-contract/001`, `requirement-contract/001`. | Covered |
| C2 | An inferred contract equals the body: no extra and no missing failure or requirement. | `validate/expr.ts:checkFunction:544`, `:566` | `an inferred contract equals the body: expected <b>, recorded <d>` | Oracle map: an extra failure is "only the validator". A missing one is a narrower contract, which STC catches (oracle map). | Validator only |
| C3 | The recorded failure and requirement sets of each node equal the recomputed sets. | `validate/expr.ts:finish:641`, `:651` | `expected <x>, recorded <y>` | M1: `contracts-dropped-failure.json` passes STC. M2: emitted text is identical. | Validator only |
| C4 | Closures and builtin callbacks carry the declared failures and requirements. | `validate/expr.ts:closure:1323`, `:1333`; `call:1459`; `validate/world.ts:checkCallbackShape:1236` | `<builtin> must invoke the callback with its declared failures and requirements` | STC for the narrower direction: inferred from C1 (confirm with a forged-IR run). | Partly covered |

### 2.6 Execution mode (`validation/004`) and initialization (`validation/007`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| E1 | The recorded execution mode of each node equals the recomputed mode. | `validate/expr.ts:finish:661` | `expected <m>, recorded <r>` | EG line 670: M1 on `execution-node-pure.json`. | Covered |
| E2 | The execution mode of a function type fits its body. | `validate/expr.ts:checkExecution:397` | `expected <m>, recorded <r>` | EG line 423: M1 on `execution-function-pure.json`. `tests/internal_sites_test.ts:286` forges a related case. | Covered |
| E3 | A builtin callback is pure with empty sets, and an `updateRef` callback maps element to element. | `validate/expr.ts:checkArguments:1372`; `validate/families/ref.ts:refOperation:59` | `a builtin callback is pure with empty failure and requirement sets` | CHK `execution-mode/001`. | Partly covered |
| N1 | A module constant has a pure initializer with empty sets. | `validate/expr.ts:checkConstant:593` | `a module constant needs a pure initializer with empty sets; ...` | EG line 423: M1 on `initialization-constant-perform.json`. CHK `execution-mode/002`. | Covered |

### 2.7 Recovery (`validation/005`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | A handler names an error that the protected block can raise. | `validate/expr.ts:catchExpr:1846` | `the protected block cannot fail with <e>; its failures are <f>` | STC: M1 gives TS2375 and TS2322 on `recovery-absent-handler.json`. CHK `failure-contract/002`. | Covered |
| R2 | Each error has at most one handler. | `validate/expr.ts:catchExpr:1839` | `the error <e> has two handlers` | CHK `failure-contract/003`. | Partly covered |
| R3 | Handler bindings have the handled type, and handler and body results fit the catch type. | `validate/expr.ts:catchExpr:1823`, `:1864`, `:1873`, `:1882`, `:1891` | `expected <e>, recorded <t>` | STC inferred (confirm with a forged-IR run). | Partly covered |

### 2.8 Refinements and proofs (`validation/002`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| P1 | Each adoption of a value into a refined type has exactly one proof, for a constructible refined identity, with a supported claim and a certificate that checks under rebuilt assumptions within the step limits. | `validate/refinements.ts:checkProof:218-303`, called from `adoption:154` | `a value adopted as <t> needs one proof`; `... has duplicate proofs`; `the proof certificate is invalid: <tag>`; four more at `invalid:305` | CHK `type-mismatch/013` covers unproved source only. Only `validate/predicates.ts:verifyCertificate` checks certificates; `src/core/predicates.ts` produces them. No file in `src/core/emit/` reads `proofs` (grep). | Validator only |
| P2 | Each recorded proof is used by an obligation. | `validate/refinements.ts:audit:184-202` | `the proof has no supported obligation on this expression` | None found. | Validator only |
| P3 | An operation that keeps a refined identity carries a proof. | `validate/refinements.ts:retain:176-182` (7 call sites) | as P1 | None found. | Validator only |
| P4 | A refinement predicate is supported, applies to a non-opaque type with identity, and stays out of host interfaces. | `validate/refinements.ts:checkRefinementDeclaration:454`, `:464`, `:478` | `a predicate belongs only to a non-opaque type with identity` | CHK `declaration/018`. | Partly covered |

### 2.9 Control forms (`validation/006`)

| ID | Guarantee | Location | Message | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| K1 | A concurrency option is a positive safe integer or unbounded. | `validate/expr.ts:checkConcurrency:685`; `call:1469`, `:1481` | `<name> concurrency must be a positive safe integer or unbounded` | No error fixture contains `concurrency` (measured: 0 files). 8 non-validator test files mention it (inferred). | Partly covered |
| K2 | A retry, provide, or run job is a function with zero parameters. | `validate/expr.ts:jobFunction:1915`, `:1924` | `<what> needs a function that takes no arguments, ...` | STC: M1 gives TS2345 on `control-provide-job-with-parameter.json`. | Covered |
| K3 | A retry count is a finite nonnegative safe integer. | `validate/families/effect.ts:retry:49` | `retry needs a finite nonnegative safe integer count, recorded <n>` | M1: passes STC. M2: GOLD would catch it on `pay.ts` only. CHK `type-mismatch/010` names `retry`; a negative-count error fixture is not confirmed (`grep -rn retry fixtures/errors`). | Validator only |

### 2.10 Kept families

Each family row groups the rejection sites of one module. These rules mirror checker rules on builtin arguments.

| ID | Guarantee | Location | Sites | Kept oracles other than the validator | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | Effect builtins get valid arguments: Duration for `timeout` and `sleep`, a string message, a level, and data fields for `log`, int bounds for `randomInt`, a pure two-parameter retry schedule, Effect values for `run`, `race`, `raceAll`. | `validate/families/effect.ts:49-476` | 17 | CHK `type-mismatch/003`, `/010`. STC inferred for argument types. | Partly covered |
| F2 | Layers return exactly the service methods with fitting types, `mergeLayers` provides each service once, and `provide` gets a provider. | `validate/families/layer.ts:33-131` | 7 | CHK `declaration/003`, `type-mismatch/010`. STC inferred. | Partly covered |
| F3 | Ref operations get a Ref and a fitting value. | `validate/families/ref.ts:33-59` | 3 | STC inferred. | Partly covered |
| F4 | Schema builders and runners (kept part) get valid inputs, and a foreign module cannot derive, decode, or make a sealed type. | `validate/families/schema.ts:137`, `:268`, `:358`, `:950-977` | 6 | CHK `sealed/004`. | Partly covered |
| F5 | Scope forms are well formed: `scoped` and `forkScoped` get an Effect, acquisition returns an operation record, `ensure` and `withResource` callbacks have the right shape, and a borrowed handle goes only to a borrow method. | `validate/families/scope.ts:39-384` | 17 | 16 non-validator test files mention these forms (inferred). | Partly covered |
| F6 | Kept Stream operators get valid inputs: `unfold`, `mapEffect`, `mapStream`, pure predicates, `sinkForEach`, `takeSink`, `transduceStream`, `runStream`, `bufferStream`. | `validate/families/stream.ts`: `unfoldStream`, `mapElements`, `pureStreamPredicate`, `sinkForEach`, `takeSink`, `sinkTransformStream`, `runStream`, `bufferStream` | 15 of 43 (28 sites leave with Phase 3) | STC inferred for Stream and Sink types. | Partly covered |

## 3. Phase 3 items (not analyzed)

### 3.1 Removed by Phase 3

These items leave with Phase 3. I did not analyze their guarantees. Line counts come from M3.

| Item | Code lines | Raw lines |
| --- | --- | --- |
| `validate/families/codec.ts`, whole file (7 sites) | 109 | 113 |
| `validate/families/fiber.ts`, whole file (5 sites) | 120 | 126 |
| `validate/families/schema.ts`: `schemaInvalid`, `schemaAt`, `schemaBoth` and their three table entries (lines 227-241) | 47 | 50 |
| `validate/families/stream.ts`: the 25 operators (functions, tables, and types) | 653 | 683 |
| `validate/expr.ts`: dispatch cases and imports of the removed kinds | 62 | 62 |
| `validate/expr_walk.ts`: child cases of the removed kinds | 41 | 41 |
| Total | 1,032 | 1,075 |

### 3.2 Not measured

Phase 3 can also remove the `codec` and `fiber` type kinds. Their cases are in `validate/typing.ts` (lines 123-187, 354-375, 463-465, 650-652, 961-978), `validate/world.ts` (353-374, 453-458, 806-808, 866-868), and `validate/type_children.ts` (34, 44). I did not count them, because the plan does not say that the type kinds go. Unused imports in `stream.ts` are also not counted. After Phase 3 lands, measure them with `git diff --numstat <phase-3 base>..HEAD -- src/core/validate src/core/validate_project.ts`.

## 4. Fixture census (SR8 step 2)

Use of the files: the loop at `tests/validate_test.ts:1928` runs each fixture through `validateModule` and expects exactly the listed code and path. `tests/validate_test.ts:1952` compares the files with `scripts/validate_fixtures.ts`. `tests/fixtures_test.ts:132` counts each listed code as having a fixture. `tests/validate_family_mutation_test.ts` mutates IR in memory and leaves the files untouched.

Evidence columns: M1 gives the STC result and the emitter result. M2 tells whether the emitted text changes. For a fixture with an emitter error, `deno check` ran only on the other modules, so its exit 0 says nothing about that module.

| Fixture | Defect injected | Guarantee | M1 result | M2 result | Disposition |
| --- | --- | --- | --- | --- | --- |
| `identity-unknown-reference.json` | A reference targets an unknown local. | I5 | EG: `unbound local local:log#log/missing` | emit error | Another oracle catches it: the emitter guard (`emit/expr.ts:894`) |
| `identity-unknown-capability.json` | A perform names an undeclared capability. | I8 | STC exit 1, TS2551 | text differs | Another oracle catches it: STC |
| `identity-undeclared-export.json` | The module exports an undeclared identity. | I2 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `identity-duplicate-declaration.json` | An error declaration appears twice. | I1 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `types-recorded-string.json` | A perform node is recorded as `string`, not `void`. | T1 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `types-literal-as-int.json` | The literal `"paid"` is recorded as `int`. | T1, T2 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `types-identity-mismatch.json` | An argument is recorded as `Name`; the parameter is `UserId`. | T1, T3 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `types-binary-identity-result.json` | The fold callback body becomes `sum * 2` of type `Amount`, recorded as `int`. | T1 | STC exit 0 | `collections` differs | Validator only: keep the check or add a public test. GOLD sees the changed expression on `collections.ts` only, not the type. |
| `types-sealed-literal-foreign.json` | A literal flows into the foreign sealed `UserId`. | T6 | STC exit 0 | identical | Validator only: keep the check or add a public test. The source rule has CHK `sealed/001`. |
| `types-record-into-tagged.json` | A record replaces the construction of tagged `Fixed`. | T5 | STC exit 1, TS2741 | text differs | Another oracle catches it: STC |
| `types-untagged-name-pattern.json` | `Fixed` loses its tagged flag, so a name pattern has no tagged member. | T8 | STC exit 1, TS2339 | text differs | Another oracle catches it: STC |
| `contracts-dropped-failure.json` | The failure set of a perform node is empty. | C3 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `contracts-body-exceeds-declaration.json` | The declared failure set of `log` is empty, but the body can fail. | C1 | STC exit 1, TS2375 | text differs | Another oracle catches it: STC |
| `execution-node-pure.json` | A perform node is recorded as pure. | E1 | EG: `perform node in a structural position` | emit error | Another oracle catches it: the emitter guard (`emit/expr.ts:670`) |
| `execution-function-pure.json` | An empty-row effect function type is recorded as pure. | E2 | EG: `pure() received an effect-mode run node` | emit error | Another oracle catches it: the emitter guard (`emit/expr.ts:423`) |
| `recovery-absent-handler.json` | A handler names an error that the block cannot raise. | R1 | STC exit 1, TS2375 and TS2322 | text differs | Another oracle catches it: STC |
| `control-retry-negative.json` | The retry count is -1. | K3 | STC exit 0 | `pay` differs | Validator only: keep the check or add a public test. GOLD sees it on `pay.ts` only. |
| `control-provide-job-with-parameter.json` | The provide job takes one parameter. | K2 | STC exit 1, TS2345 | text differs | Another oracle catches it: STC |
| `initialization-constant-perform.json` | A module constant has a perform initializer. | N1 | EG: `pure() received an effect-mode perform node` | emit error | Another oracle catches it: the emitter guard (`emit/expr.ts:423`) |
| `serialization-unsorted-set.json` | A failure set in an import payload is not sorted. | S5 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `serialization-span-past-end.json` | A span ends after the end of its source. | S3 | STC exit 0 | identical | Validator only: keep the check or add a public test |
| `serialization-unknown-source.json` | A span names a source that the module does not list. | S3 | STC exit 0 | identical | Validator only: keep the check or add a public test |

IRS note. 19 of the 22 fixtures mutate a module of the examples project. A lowering that produced one of these exact mutations on the examples would fail IRS. This holds for those inputs only. The other 3 fixtures use `fixtures/ir/tagged.eff` and `fixtures/ir/empty-effect.eff`, which IRS does not hold.

Observation on effect. For 10 of the 12 "validator only" fixtures, the emitted text is identical to the true emission (M2). So these defects do not change the emitted program on these inputs. They can change other readers of the IR, such as the language server or the website typed IR. That effect is not measured.

## 5. Kernel measurement (input for SR8 step 3)

### 5.1 Method

M3 (`sr8-scripts/measure.ts`) reads every `.ts` file under `src/core/validate/` and `src/core/validate_project.ts`.

- Code lines: lines that are not blank and whose trimmed text does not start with `//`, `/*`, `*`, or `*/`. Raw lines: all lines, as `wc -l` counts them.
- Chunks: the script splits each file at top-level declarations (`function`, `const`, `let`, `class`, `type`, `interface`, `enum`) and at class methods. A comment block directly above a declaration belongs to it. Each file has one import chunk.
- Edges: an identifier in a chunk links to a local declaration of that name, or to the declaration that a named import brings in. A method call links through its receiver: `this` to the same class, `refinements` to `RefinementValidator`, `c` and `core` to `BodyValidator` (the `ValidatorCore` of families), `report` to `Report`, and `)` to any class. Other receivers (for example `world.types.get`) are ignored as Map and Set calls.
- Kernels are transitive closures over these edges, after the Phase 3 lines are removed. Import lines are not counted in a kernel.
- Check of completeness: the closure from `validateProject` reaches 8,014 of the 8,416 code lines after Phase 3. The rest is import lines and four schema helpers (`schemaIssueType`, `directionalRequirements`, `inheritedDefault`, `inheritedMakeInput`). Probable cause: only type positions or removed builders use them. Confirm with `grep -n "schemaIssueType\|directionalRequirements\|inheritedDefault\|inheritedMakeInput" src/core/validate/families/schema.ts`.
- Limits: a reference in a type position counts as an edge, so a kernel can be a little too large. A method call through an unlisted receiver name is missed, so a kernel can be a little too small.

### 5.2 The plan's ranges

- `validate/refinements.ts:154-302`: verified. Line 154 starts `adoption` (its comment starts at 150). The range holds `adoption`, `retain` (176), `audit` (184), `refinedTarget` (204), and `checkProof` (218). `checkProof` closes at line 303.
- `validate/expr.ts:1633-1704`: verified with a shift. Line 1633 is inside the branch loop of `ifExpr` (1614-1645). The range holds all of `matchExpr` (1647-1680) and the first 23 lines of `pattern` (from 1682). `pattern` continues after 1704.

### 5.3 Results

| Set | What it holds | Code lines | Raw lines | Share of (c) code |
| --- | --- | --- | --- | --- |
| (a) Validator now | all files | 9,448 | 10,260 | |
| (b) Phase 3 removal | Section 3.1 | 1,032 | 1,075 | |
| (c) After Phase 3 | (a) minus (b) | 8,416 | 9,185 | 100% |
| K2 | `typing.ts:literalFits` (the `int` literal rule, T2) | 15 | 16 | 0.2% |
| K1 = K1 with K2 | Closure of the `RefinementValidator` fact and proof methods, plus `expr.ts:1633-1704`, without `BodyValidator` methods | 1,674 | 1,850 | 20% |
| STRUCT | Closure of `checkSerialization`, `checkDeclarationHeaders`, `checkImports`, and `validateProject` producer binding, without `BodyValidator` | 1,965 | 2,175 | 23% |
| Option B set | K1, STRUCT, all module-level checks of `world.ts` and `index.ts`, and `exprChildren`, without `BodyValidator` and families | 3,804 | 4,159 | 45% |
| K3 | Closure of `BodyValidator.checkFunction`: the full expression walk | 6,325 | 6,835 | 75% |
| FULL | Closure of `validateProject` | 8,014 | 8,653 | 95% |

K1 by file (code lines): `refinements.ts` 699, `typing.ts` 423, `predicates.ts` 303, `expr.ts` 72 (the plan's range), `type_children.ts` 58, `sets.ts` 43, `builtins.ts` 32, `report.ts` 17, `world.ts` 15, `families/context.ts` 12. The full chunk list prints when you run M3.

K3 by file (code lines): `expr.ts` 1,782, `typing.ts` 823, `schema.ts` 808, `refinements.ts` 699, `effect.ts` 450, `scope.ts` 351, `stream.ts` 306, `predicates.ts` 303, `world.ts` 201, `expr_walk.ts` 142, `layer.ts` 141, `sets.ts` 78, `ref.ts` 60, `type_children.ts` 58, `context.ts` 57, `builtins.ts` 42, `report.ts` 24.

### 5.4 What each validator-only guarantee needs

- P1, P2, P3 (proofs): K1 checks a proof. K1 does not find the obligations. Today `BodyValidator.accepts` (`expr.ts:328`) calls `adoption` from 13 call sites, and `retain` has 7 call sites in the walk. Both need the recomputed type of each expression. So K1 alone needs a new obligation finder. That finder could read the recorded types, but T1 would then no longer check them. The size of such a finder is not measured. SR8 step 3 can measure it with a prototype.
- T2 (`int` literal): K2 is 15 code lines, but it runs inside `fits` on recomputed types (K1 includes it).
- C2, C3 (inferred contract, node effect sets): these need the recomputed effects of every node, so they need K3. K3 reaches every kept family, because each builtin form has its own effect rule.
- T12 (capture marker), K3 (retry count): one site each, inside the walk.
- S2 to S6, I1, I2, I4, I12, I13: STRUCT holds them.

## 6. Options for SRD4

Line changes are against (c), the validator after Phase 3: 8,416 code and 9,185 raw lines.

Tests that use the validator (measured by `grep -rlE "src/core/validate(/|_project)|validate_helpers" tests scripts`): 99 files. Of these, 18 files have names that start with `tests/validate_` (17 test files and `tests/validate_helpers.ts`). They hold 298 `Deno.test` calls.

### Option A: keep the kept families (recommended)

- Line change: 0 after Phase 3. The total change from now is -1,032 code and -1,075 raw lines (Phase 3 only).
- Guarantees lost: none.
- Tests that change: none beyond Phase 3.
- Risk: the validator stays at 8,416 code lines. Each new builtin needs a validator rule as well as a checker rule.

### Option B: keep the proof kernel and the structural check

- Kept set: 3,804 code and 4,159 raw lines (measured), plus a new obligation finder (not measured).
- Line change: -4,612 code and -5,026 raw lines, before the obligation finder.
- Guarantees lost: C2 and C3 (one of the three "only the validator" defects of the oracle map), T1, T12, K3 (validator only). The validator part of T3 to T11, C4, E3, R2, R3, K1, and F1 to F6 (partly covered).
- At risk: P1 to P3 stay only if the new finder works on recorded types. The deleted T1 check no longer verifies those types.
- Tests that change: tests of body checks and of families. The count is not measured. Measure it with `grep -lE "validation/00[2-7]" tests/*.ts | wc -l` after you choose the set.
- Risk: medium to high. The finder is new code without a measured size, and the most valuable guarantee (C2) goes.

### Option C: delete the validator, add public tests

- Line change: -8,416 code and -9,185 raw lines.
- Guarantees lost: all 18 "validator only" guarantees, and the validator part of the 27 "partly covered" guarantees.
- Public tests to add: for C2, a checker test that compares inferred contracts with expected literal sets on a corpus. For P1 to P3, a test of `src/core/predicates.ts` certificates against an independent checker. That test would need `validate/predicates.ts:verifyCertificate` (303 code lines) or an equal. For T2 and K3, checker tests on literal inputs. These protect only their listed inputs.
- Tests that change: the 99 files above. `tests/validate_test.ts` alone has 3,281 lines.
- Risk: high. The property tests (`tests/acceptance_property_slow_test.ts:143`, `tests/incremental_property_test.ts:81`) lose their only semantic oracle on generated programs.

### Recommendation

I recommend option A. The three defects that only the validator catches all need the expression walk. The walk (K3) is 75% of the validator after Phase 3. Option B saves 4,612 code lines but loses C2, and it needs new unmeasured code to keep the proofs. Option C saves all lines but leaves the property tests without a semantic oracle. Phase 3 already removes 1,032 code lines.

## 7. Open items

1. The codec and fiber type-kind cases are not measured (Section 3.2). The owner of Phase 3 can measure them with the `git diff --numstat` command in that section.
2. The statuses of I9, T4, C4, R3, K1, and F1 to F6 rest on inferred STC coverage or on CHK alone. To confirm them, extend `sr8-scripts/fixture_tsc.ts` with one forged IR for each of I9, T4, C4, R3, F1 to F6, and K1.
3. The obligation finder of option B has no measured size. SR8 step 3 can build and measure it if the user wants option B.
4. The effect of the 10 output-neutral defects on the language server and the website typed IR is not measured.
5. The test count for option B is not measured (command in Section 6).
