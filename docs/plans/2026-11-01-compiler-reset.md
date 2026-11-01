# Compiler reset

Prefix: CR (compiler reset phases).

The user authorized execution on 2026-11-01. This document is the sole authority for the reset.
The execution base is `c580de8acea73a4644c179d3081d850634d1516d` on local `main`.
The working tree was clean. Deno 2.9.8 is active.

## Goal and preservation contract

Repair three demonstrated defects and separate inference traversal from contract resolution.
Preserve the pipeline: source, analysis, checking, typed IR, independent validation, TypeScript output.
Preserve existing source forms, explicit exported contracts, recovery, identity, refinements, and checked entries.
Preserve diagnostics, generated text, companion modules, spans, and maps outside the documented corrections.
Preserve typed IR version 7, serialization, annotations, proofs, interface hashes, and public interfaces.
Fresh and incremental results must agree. Retained revisions must preserve their results.
Frontend queries must remain independent of emission. Lowering and emission must remain lazy.
The validator must retain independent semantic implementations.

No new syntax, builtin, backend, plugin framework, or general inference system belongs here.
Adapter changes require a compiler interface need. Parser rewrites and unrelated cleanup remain excluded.
`docs/status.md` controls project status. The sibling website controls the language specification.
No push, release, version change, or branch creation is authorized.

## Findings and baseline

The planning review reported 3,118 fast tests and 301 slow tests passing.
It measured 120 core TypeScript files, 47,632 nonblank non-comment lines, 11,643 AST branches, and 686 imports.
The review measured no coverage, mutation score, or performance.

An annotation on a local callback establishes usable evidence, but direct invocation still reports `type-mismatch/011`:

```eff
type Int = int
const read = (input): Int => {
  const fn: (n: Int) => Int = input
  input(1)
}
```

An annotated local arrow loses its callable evidence and reports `type-mismatch/003`:

```eff
type Int = int
const read = (input): Int => {
  const fn = (n: Int): Int => n
  fn(input)
}
```

The same loss affects local record fields.
Host configuration keys sort entries, but companion emission selects the first configured matching host.
Reversing two hosts for one opaque interface leaves a stale import after incremental compilation.
Fresh compilation selects the new first host. Both results have no diagnostics.
Generated incremental tests omit configuration and host declaration edits.
The testing reference describes removed `known difference` tests.
These findings justify scoped repairs. They do not justify replacement of the compiler.

## Target design

Traversal collects demands and callable evidence. Resolution combines demands and propagates deferred calls.
The driver publishes finalized contracts and diagnostics.
Resolution receives `TypeTable` explicitly and can intern types. Resolution is not pure.
Callable evidence contains parameter types, result information, and checked flags, without claiming complete function types.
The ordinary checker owns complete function types, execution modes, failures, and requirements.

Contracts come from annotations, expected contracts, or existing signatures. Invocation arguments cannot invent signatures.
Deferred calls retain complete origins, field paths, and source nodes.
Demands deduplicate by origin, path, type, and source node.
Each call processes each distinct usable contract once. New facts enqueue dependent calls.
The finite contract set ensures termination. Do not repeat body traversal or impose an arbitrary iteration limit.
Publish unresolved diagnostics after propagation. Preserve conflict selection and diagnostic order.
Unconstrained callbacks still require annotations. A resolved field cannot hide an unresolved sibling.
Preserve first-configured host selection by retaining order in cache keys.

## Execution units

Each unit has an eight-tool-turn executor budget. The main agent reviews every changed line and owns commits.
Each executor returns changed paths, check results, and open issues. Executors must not commit.
Each complete unit must pass `deno task check` before its local commit.
Commands expected to exceed two minutes require the project pause rule.
Never regenerate golden files to accept unexplained differences.

| Unit | Model | Owned files | Acceptance |
| --- | --- | --- | --- |
| CR1 (preservation evidence) | Sol, high | This authority, registry, `tests/incremental_property_test.ts` | Passing real configuration and host edits; fresh and incremental comparison; baseline reproductions |
| CR2 (host invalidation) | Sol, high | `src/core/db.ts`, `tests/output_characterization_test.ts` | Reorder, warm caches, delayed retained revisions, restoration, unchanged configuration |
| CR3 (arrow evidence) | Sol, high | `src/core/infer_inputs.ts`, existing inference tests | Local arrows, aliases, record fields, checked flags, effects, invalid arguments, lowering and validation |
| CR4 (deferred calls) | Sol, high | `src/core/infer_inputs.ts`, existing inference tests | Calls before evidence, aliases, nested fields, conflicts, two inputs, unresolved sibling, shadowing, explicit unknown |
| CR5 (resolution boundary) | Sol, high | Inference driver, new `src/core/infer_contracts.ts`, existing boundary tests | Separate state and resolution; structured issues; unchanged entry points and behavior |
| CR6 (documentation) | Sol, high | Authority, registry, affected references; website only if inaccurate | Current references, actual measurements and evidence, archived authority, no open implementation items |

The requested executor model is `gpt-5.6-sol`, with high reasoning effort.
The main agent must record a model availability blocker before substituting another model.
The phases form a dependency chain. Independent review can run without changing the active unit's files.

## Verification

CR1 and CR2:

```sh
deno test --allow-read tests/db_test.ts tests/revision_isolation_test.ts tests/incremental_property_test.ts tests/output_characterization_test.ts
deno task check
```

After the CR2 commit:

```sh
deno task mutate --seed 1 --sample 6 src/core/db.ts
```

CR3:

```sh
deno test --allow-read tests/inferred_inputs_test.ts tests/inferred_entry_validation_test.ts tests/inferred_editor_test.ts tests/type_laws_property_test.ts
deno task check
```

CR4:

```sh
deno test --allow-read tests/inferred_inputs_test.ts tests/inferred_entry_validation_test.ts tests/inferred_editor_test.ts tests/open_contracts_test.ts
deno task check
```

After each inference repair commit:

```sh
deno task mutate --seed 1 --sample 6 src/core/infer_inputs.ts
```

CR5:

```sh
deno test --allow-read tests/inferred_inputs_test.ts tests/inferred_entry_validation_test.ts tests/inferred_editor_test.ts tests/core_boundary_test.ts
deno task measure src/core/infer_inputs.ts src/core/infer_contracts.ts
deno task measure:functions src/core/infer_inputs.ts src/core/infer_contracts.ts
deno task check
deno task behavior:capture <post-fix-base> <refactor-head>
```

The capture base is the CR4 commit. Both revisions must use the same tests.
The contract module must not import the expression checker or emitter.
Moving the existing class without separating responsibilities fails acceptance.
No numerical reduction is promised before measurement.

CR6:

```sh
deno task check
deno task coverage
deno task logs:replay
```

Changed website examples require compiler validation. TypeScript panels require the website's strict checks.
Website changes receive a separate local commit in the sibling repository.

## Completion

All three defects require passing public-API regressions through lowering and independent validation.
Completion also requires stable retained revisions, preserved contracts, separated responsibilities, current documentation, and final checks.
The completing commit archives this authority and its evidence and updates registry links.
Execution evidence belongs in the adjacent compiler reset worklog.
The main agent owns the next action: establish preservation evidence.
