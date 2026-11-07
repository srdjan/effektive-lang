# Adversarial review

The review found one confirmed change outside the permitted behavior changes. A Scope capability now prints differently in hover contracts and diagnostic messages.

The comparison used base `30bb1d5691c0d3e80437d745452ccbe990645196` and HEAD `749ce2c163f9d3c656456e32483e840431a47001`, with Deno 2.9.8. I read the repository instructions, architecture, testing rules, and untangle plan before the review.

**CONFIRMED - Medium: Scope capability display changes exceed the error-name exception.**  
Location: `src/core/type_show.ts:108`; the requirement renderer now calls `shortName`, which strips `:effect/` in `src/core/ids.ts:184`.  
Hover input in `m.eff`: `const job = defer(() => forkScoped(defer(() => 1)))`; query offset `6`. Both revisions return no diagnostics.  
Base contract: `job: Effect<void, never, cap:effect/Scope>`; HEAD contract: `job: Effect<void, never, Scope>`. The backend type and hover span remain equal.  
Diagnostic input, with `\n` representing newlines: `type Int = int\nconst take = (n: Int): Int => n\nconst bad = (): Int => take(defer(() => forkScoped(defer(() => 1))))`.  
The `type-mismatch/003` message changes from `argument 1 has type Effect<void, never, cap:effect/Scope>, but Int is expected` to `argument 1 has type Effect<void, never, Scope>, but Int is expected`; span remains `m.eff:75..114`.  
UND1 permits short reserved error names. `SCOPE_CAPABILITY` is a capability (`src/core/ir.ts:9`), so these diagnostic and editor changes violate the required output equality.  
Evidence: `deno run --allow-read --config deno.json <scratch>/scope-probe.ts` exited `0` and printed the base and HEAD results above.

The following checks ran during this review. Scratch scripts and results are in `<scratch>/`.

| Check | Observed result |
| --- | --- |
| `deno task behavior:compare 30bb1d5 HEAD --out <scratch>/corpus` | 461 snapshots equal across eight categories; none changed, missing, or added. |
| Extracted inline source comparison (`inline-probe.ts`) | 2,224 inputs; 625 accepted at HEAD; no throws. Of 48 differences, 41 concern permitted error names, three concern permitted modifier fixes, and four expose the Scope finding. |
| Source mutation comparison (`fuzz-probe.ts 4000`) | 4,000 inputs; 1,010 accepted at HEAD. Three differences concern the permitted fix for a parameter named `borrow`. |
| Malformed IR comparison (`ir-probe.ts 2000`) | 2,000 mutations; validator and emitter results match between revisions. |
| Incremental comparison (`revisions-probe.ts`) | 18 updates match, including counters, interface hashes, diagnostics, IR, emitted output, maps, and retained revisions. |
| Adapter comparison (`adapters-probe.ts`) | Ten language server stages and six CLI watch changes match, including messages, generated files, and error output. |
| Selected tests | 19 passed across the four commands below. |
| Static import graph comparison (`imports-probe.ts`) | No new import cycle; only the retained `types.ts` / `type_ir.ts` cycle remains at HEAD. The scan includes type imports. |

The selected test commands were:

```sh
deno test --allow-read tests/core_boundary_test.ts
deno test --allow-read tests/emit_families_test.ts
deno test --allow-read tests/validate_depth_bound_test.ts
deno test --allow-read tests/validate_test.ts --filter 'src/core/validate imports only'
```

The inline comparison checked diagnostics, serialized IR, emitted text and metadata, maps, semantic tokens, and sampled hover, definition, and signature queries. It extracted literal strings from tests, including incomplete snippets. It did not reconstruct interpolated templates or projects with several files.

The incremental checks covered dependency edits, interface changes, span changes, configuration failures, source failures, removals, and recovery. They compared immediate output queries with queries deferred until later updates.

The adapter checks covered stale output, configuration recovery, injected read failures, and dependency removal and restoration. These checks used the public adapter flows with in-memory host helpers.

I also inspected the changed checker, builtin, emitter, validator, editor, host, logging, behavior harness, and playground paths. I reviewed the test-pass commit evidence and removed assertions. I found no additional concrete defect in those inspections. I did not repeat the fault injections documented in commit bodies.

These checks establish equality only for the examined inputs and paths. They do not prove complete equivalence. The review did not run the full gate, coverage, mutation testing, performance measurements, native Windows checks, or browser checks. The brief reports 2,917 fast tests and 285 slow tests passing at HEAD; I did not independently repeat that gate.

I changed no repository file except this report. I did not commit or modify the baseline checkout.

Next action: the orchestrator owns correction of the Scope display change and comparison of the two reproduction inputs against the baseline.

CONFIRMED: 1; PLAUSIBLE: 0
