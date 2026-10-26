# Architecture

This document describes the pipeline, the layering rules, the invariants, and
the decision record of the Effektive compiler. [api.md](api.md#source-file-map) holds
the source file map and the public interfaces. [language-rules.md](language-rules.md) holds
the language rules. The original design discussion of 2026-10-16 is in
[archive/transpiler-design.md](archive/transpiler-design.md). It is history.

## Pipeline

The compiler turns Effektive source into checked, typed IR. An independent
validator checks that IR. The emitter prints Effect-TS from the IR. All paths
below are under `src/core/` unless a path starts with another directory.

| Stage | Main files | Result |
| --- | --- | --- |
| Lex and parse | `lex.ts`, `parse.ts`, `syntax.ts`, `syntax_queries.ts` | A lossless syntax tree with error recovery, and `syntax` diagnostics. |
| Project, index, and resolve | `project.ts`, `index.ts`, `resolve.ts`, `analyze.ts` | The module graph from `effektive.json`, the declaration index of each file, and names resolved to identities. |
| Types | `types.ts`, `type_ir.ts`, `type_show.ts` | The interned type table, compatibility rules, and readable type text. |
| Declaration check | `signatures.ts`, `type_lower.ts`, `check.ts` | The signature model, the lowering of type nodes to interned types, and `ModuleChecker` for types, errors, services, providers, and constants. |
| Body check | `check_expr.ts`, `check_patterns.ts`, `check_binary.ts`, `check_builtins/`, `infer_inputs.ts`, `modes.ts` | Types, effects, execution modes, contracts, and match coverage of each body. |
| Project check | `check_project.ts`, `interface.ts`, `initialization.ts` | Paired declaration and body results, module interfaces with hashes, and the module initialization graph. `checkModuleStep` is the one per-module step. |
| Refinements | `check_refinements.ts`, `predicates.ts`, `predicate_source.ts` | The refinement facts of a body, the bounded proof search, and proof certificates. |
| Lowering | `lower.ts`, `serialize.ts` | Checked modules become typed IR, which `serialize.ts` writes as canonical JSON. `ir.ts` defines the IR. |
| Validation | `validate/`, `validate_project.ts` | The independent validator recomputes types, effects, and proofs from the IR alone. |
| Emission | `emit/`, `typescript.ts` | Effect-TS text, source maps, and the mapping of `deno check` errors to Effektive spans. |
| Editor queries | `editor.ts`, `editor_*.ts`, `diagnostic_delta.ts` | Hover, definition, symbols, references, rename, completion, tokens, hints, actions, and signature help. |
| Program | `db.ts`, `frontend.ts`, `mod.ts` | `Program` memoizes the queries by revision, with a cutoff at the module interface hash. `frontend.ts` and `typescript.ts` are the two narrow entry points, and `mod.ts` is the whole API. |

The host adapters are in `src/host/`. They read and write files and run
`deno check` for the command-line tool and the language server. The
command-line tool is in `src/cli/`, the language server in `src/lsp/`, and the
browser playground in `playground/`. The VS Code client is in `editors/vscode/`.

## Layering rules

Each layer depends only on the layers below it. The core has no I/O. It reads
files through `SourceHost`. Five tests enforce the rules.

| Rule | Test |
| --- | --- |
| `src/core` calls no Deno or global host API, and imports only relative files. | `tests/core_boundary_test.ts`, "src/core uses no host API, no global API, and no non-relative import" |
| The frontend entry point and the editor queries cannot reach the emitter, `typescript.ts`, or `src/host/`. | `tests/core_boundary_test.ts`, "the frontend and source queries cannot reach TypeScript output or host adapters" |
| `src/host/`, `src/cli/`, `src/lsp/`, and `playground/src/` import the core only through `frontend.ts`, `typescript.ts`, or `mod.ts`. | `tests/core_boundary_test.ts`, "host, CLI, LSP and playground adapters use public core entry points" |
| The validator imports only `ir.ts`, `source.ts`, `diagnostics.ts`, and its own files, plus a type-only import of `predicates.ts`. | `tests/validate_test.ts`, "src/core/validate imports only ir.ts, source.ts, diagnostics.ts, and its own files" |
| The emitter families never import `emit/expr.ts`, and no value import of the emitter reaches a checker module. | `tests/emit_families_test.ts`, both tests |

## Invariants

1. The layers depend only downward. The core has no Deno call and no import from
   `src/cli`, `src/host`, or `src/lsp`.
2. The independent validator shares no code with the checker. The checker and the
   validator duplicate rules on purpose, because the validator is a differential
   oracle. The emitter `ROWS` table in `emit/shape.ts` and the validator
   `exprChildren` in `validate/expr_walk.ts` also stay separate.
3. The typed IR is the contract between the checker and every later stage.
   `ir.ts` stays a copy of the sibling `typed-ir.ts`. The IR node `nominal` is
   part of IR version 6.
4. Emitted text is byte-identical across refactors. The golden files in
   `fixtures/golden/` and the mutation fixtures in `fixtures/validate/` change
   only when the emitted text or the validator rules change on purpose. Run
   `golden:update` and `validate:update` for that reason only, never to make a
   test pass.
5. The three package entry points in `deno.json` keep their exported names. No
   outside code imports the package.
6. The website links to `fixtures/applications/portable-publisher`. That path
   stays.

## Decision record

Decided by the user on 2026-10-16 and 2026-10-17. Each entry took the recommended option. The wording is that of the decision date.

| Decision | Choice |
|---|---|
| D1 Deliverable shape | (b) Shared core library. CLI first, LSP second. |
| D2 Real-time loop | (b) Diagnostics and hover per change. Generated files on save. `watch` and `build` modes. |
| D3 Host language | (a) TypeScript on Deno. Zig behind WASM only after a measured need. |
| D4 Incremental model | (b) Query-shaped core. Module-level cutoff in Phase A. Declaration-level tracking in Phase B after M2 and M3. |
| D5 Where `tsc` runs | (b) Emitter golden tests, `build --tsc`, and CI. Opt-in in `watch`. Never in the LSP. |
| D6 Output location (Q7) | (a) `users.ts` next to `users.eff`. Import specifiers become `./users.ts`. A `.js` switch can come later. |
| D7 Identity encoding | (b) Module-qualified strings such as `users#UserMissing`. The spec requires this: "A backend must encode resolved declaration identities in error tags, service keys, and brand tokens." |
| D8 Mode firewall hole (I1) | (a) Source purity assertions stay deferred. The incremental model invalidates dependents on a mode change. M3 informs a later review. |
| D9 Latency budget | (a) Set the budget after M1 and M6 give a baseline. Set on 2026-10-16: 100 ms at p90 from `didChange` to `publishDiagnostics` on the large synthetic size. Phase B is not needed while M1 meets this budget. Evidence below the table. |
| D10 Host registry format | (a) Effektive-syntax declaration file with a `provider` form, plus a `host:` map in `effektive.json`. |
| D11 IR validator | (a) Independent validator in the first version, used as a differential oracle for the checker. |
| D12 Output formatting | (a) Own printer with one fixed style. A test confirms that `deno fmt --check` accepts the output unchanged. |
| D13 Exported constants (Q4) | (a) Every exported constant requires a type annotation. This closes firewall hole I6. |
| D14 `int` arithmetic (Q6) | (a) The emitter wraps `int` operations in a runtime helper that raises a defect outside the safe integer range. The cost needs to be measured. |
| D15 Repository | (a) The transpiler lives in `effektive-lang`, separate from the `effektive` site and spec repository. |
| D16 Next phase (2026-10-16) | The LSP comes before Phase B. Phase B waits for the D9 budget, and D9 waits for M1, which needs the LSP (design 4.5 and D9). |
| D17 JSON-RPC transport (2026-10-16) | Hand-written Content-Length framing over stdio. No npm dependency in the server. |
| D18 Editor client (2026-10-16) | A thin VS Code client in `editors/vscode/`, plain JavaScript, with `vscode-languageclient`. npm is used only inside that directory. |
| D19 Measurements (2026-10-16) | This phase adds the M1, M3, and M4 harness. It replays an edit script against the real server process. |
| D20 Target names (2026-10-17) | No declaration or binding may take `undefined`, `Number`, `RangeError`, `ReadonlyArray`, `any`, `bigint`, `object`, or `symbol` (`declaration/002`). |
| D21 Type depth (2026-10-17) | A type deeper than the comparison cap gets a named diagnostic, as section 4.6 asks. |
| D22 Package export (2026-10-17) | `deno.json` exports `./src/core/mod.ts`, the documented public API. |
| D23 Long selector tests (2026-10-17) | The printer breaks a long selector test after `===`, as `deno fmt` does. In a later arm, it joins the earlier links on the first line when `deno fmt` does. |
| D24 CI (2026-10-17, revised the same day) | The project has no hosted CI. In this document, CI is the gate `deno task check`, which runs before each commit (D5). |
| D25 Book targets (2026-10-17) | The five examples are the golden outputs. The eight book targets are not, because they use short tags (D7) and source order (section 5.4). |
| D26 Names for primitives (2026-10-17) | (a) R1: a primitive type outside a type, nominal, or error body is rejected. Any type declaration, alias or nominal type, gives the name. See `docs/archive/raw-types-and-nominal-records.md`. |
| D27 R1 positions (2026-10-17) | (a) Every position outside type and error bodies, local annotations included. |
| D28 R1 in host files (2026-10-17) | (a) `.effi` files follow the same rule. |
| D29 R1 rollout (2026-10-17) | (a) Always on. One plan migrates the examples, fixtures, tests, bench generator, and golden files. |
| D30 R1 code (2026-10-17) | (a) `declaration/013`. |
| D31 Other type forms (2026-10-17) | (a) R1 checks only primitive leaves. `Effect<A>`, inline records, and inline unions with named parts stay legal. |
| D32 Brand operators (2026-10-17) | (c2) `<`, `<=`, `>`, `>=`, `+`, and `-` accept two values of one numeric brand (base `int` or `number`). `+` and `-` give that brand. `*`, `/`, and string brands keep needing `unbrand`. Update, 2026-10-23: the nominal keyword plan replaced this rule with comparison classes and widening (see `docs/language-rules.md`, "Identity operators"). `unbrand` is removed. |
| TI Type identity (2026-10-24) | A `type` declaration has identity by name, with no new syntax (NI4). The `nominal` keyword is gone. A union with a non-literal member and a bare name give a transparent alias. A record identity is tagged when a union alias of its module lists it. An unnamed operand adopts the class of a named operand in `+`, `-`, and `*` (NI25 a). Primitive names are types with identity (NI22 a). A string `+` gives the unnamed `string` (TI0). See [the plan](archive/plans/2026-10-24-type-identity.md). |

Open: none.

Evidence for the D9 budget: one run of `deno task bench m1 --full` on
2026-10-17, at commit `fc00ef7`, after rule R1. Each row had 200 samples from two
server processes. On the large synthetic size, a body edit had a p90 of 11.9 ms
(floor 12.7%). A header, alias, or mode-flip edit had a p90 of 53 to 59 ms
(floors 5.0% to 9.6%). The maximum of those rows was 56 to 92 ms.

The quick run of 2026-10-16 gave a p90 of 47 to 49 ms for those three edits.
Since then, every generated module declares the aliases `Int`, `Num`, and `Text`,
and the checker has new rules. So the two runs do not compare directly, and the
cause of the difference is not measured. Measure again with `--full` when the
core changes.

The user also accepted the suggested answers in section 9 for Q1, Q5, Q8, Q9,
and Q10. Q2, Q3, Q4, Q6, and Q7 follow from D7, D10, D13, D14, and D6.

| Question | Answer |
|---|---|
| Q1 Builtin `ValueId` scope | Per module, content hash of the closed type. |
| Q5 Unannotated module-level functions | Allowed, and never exported. |
| Q8 Diagnostic codes | Category prefix plus a number, for example `failure-contract/001`. |
| Q9 Optional and `Option` fields | `Schema.optionalKey` for `?` fields, as the book tab does. `Schema.Option` for `Option<T>` fields, after a `deno check` probe. Correction: an earlier answer named `Schema.optional`. |
| Q10 Providers in `provide` | Host-declared providers only. |

D8, D13, D14, and the answers above interpret or extend the language spec. The
spec in the `effektive` repository does not record them yet.
