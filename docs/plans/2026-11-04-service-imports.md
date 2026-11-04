# Plan: service imports and inferred requirements

Status: active. The user selected explicit paths on 2026-11-04.
Prefix: SID identifies decisions, SIU identifies units, and SIF identifies findings.

## Objective and accepted direction

The module declares its external services once. The compiler infers each function's requirements from its body and calls.

```effektive
imports Users from "./users-service.eff"

export const rename = (id: UserId, name: Name): User => {
  const user = getUser(id)
  const renamed = { ...user, name }
  Users.save(renamed)
  renamed
}
```

SID1: The service declaration uses an explicit source path. The user selected this option.
SID2: The header starts with `imports`. The user removed the proposed `module` prefix.
SID3: The header bounds the module's external service requirements, including requirements reached through calls.

SID4: A module with this header infers omitted function requirements, including exported functions.
SID5: Existing modules keep their behavior. A written `with` clause remains a checked upper bound.
SID6: Result types on exports remain written. Failure inference keeps its current rules.

The service contract stays in a separate source module. `imports` brings that contract into scope without supplying its implementation.
Ordinary imports continue to bring data types, errors, functions, and providers into scope.
Multiple service headers can precede ordinary imports and declarations. Each header names one service and one source path.

Service headers must precede ordinary imports and declarations. Comments and blank lines can precede service headers.
An unresolved path, missing export, or non-service target produces a diagnostic.
Providing a service removes that requirement before the module bound applies. A pure function acquires no service requirement.

An unused declared service does not become a function requirement. The compiler publishes each function's actual inferred requirement set.
Function types, service methods, and host interfaces retain explicit contracts because these declarations have no bodies.
`imports` is contextual at the top level. Other uses of the identifier keep their current behavior.

Ordinary imports can still bind services, but only service headers grant permission under the module bound.
Existing duplicate-binding diagnostics apply to service headers. Host paths are valid when the imported declaration is a service.
Host interface files reject service headers because host interfaces do not infer bodies.

The bound also covers service requirements in produced values, including deferred computations and returned functions.
Requirements that occur only in input types do not become module dependencies.
The check follows produced type structure and preserves existing service identities.

Reserved Effect capabilities, including `cap:effect/Scope`, retain their contracts without requiring an external service header.
An acquisition requirement of a provider remains after `provide` removes the service that the provider supplies.

## Workspace and constraints

Work directly on local `main`. Commit each complete unit after `deno task check`. Never push.
Preserve existing edits in `docs/api.md`, `docs/editor.md`, `docs/measurements.md`, and `docs/release-measurements.md`.
Other work currently edits documentation. Recheck status before each commit and stage only owned files.

Use Deno 2.9.8. Use Sol with high reasoning effort for delegated work.
Keep compiler and website commits separate. Do not add runtime behavior or change the IR format without demonstrated need.

## Orchestration

The main agent owns specification, integration, line-by-line review, acceptance checks, and commits.
A separate reviewer checks this plan before implementation. Executors stop at their turn budgets and return open items.

| Unit | Files and responsibility | Model | Acceptance | Turn budget |
| --- | --- | --- | --- | --- |
| SIU1: compiler and public behavior tests | Required modules in `src/core/`, `tests/service_imports_test.ts`, and focused existing tests | Sol, high | Parse and resolve headers; infer direct, transitive, recursive, and foreign requirements; enforce module bounds; publish interfaces; validate and emit IR | 65 |
| SIU2: editor support | Required `src/core/editor_*.ts`, VS Code syntax, playground syntax, and focused editor tests | Sol, high | Header names resolve in editor queries; highlighting recognizes `imports`; hints expose inferred requirements; fixes respect module bounds | 40 |
| SIU3: examples and compiler documentation | `fixtures/examples/`, generated golden baselines, affected example tests, `CONCEPTS.md`, `AGENTS.md`, `docs/language-rules.md`, `docs/status.md`, `docs/tutorial.md`, `CHANGELOG.md` | Sol, high | Users example has a separate contract and service header; compiler gates pass; prose states inference and module bounds | 50 |
| SIU4: website and specification | Required files in `../effektive/public/`, website typecheck support, compiler website manifest | Sol, high | Published examples compile; strict TypeScript panels pass; site tests and asset stamping pass | 50 |
| SIU5: review, mutation, and completion | Changed logic, `fixtures/mutation/survivors.json` if required, this plan, its worklog, registry | Main agent and independent Sol reviewer | Independent review completes; required checks pass; measured mutation evidence is recorded; plan and evidence move to archive | 45 |

Compiler semantics must stabilize before editor and corpus work starts. Editor and corpus changes can run together with disjoint ownership.
Website work follows the Users contract split. Each dispatch names exact writable files and excludes user-owned changes.

## Acceptance checks

1. The selected header syntax resolves an exported service through its explicit path.
2. A non-service target, missing export, missing source, or misplaced header produces a diagnostic.
3. Exported functions infer direct and transitive requirements without `with`.
4. Local recursion and calls across module boundaries publish settled requirements.
5. Pure functions and unused service imports have empty inferred requirement sets.
6. An undeclared external service requirement fails, including requirements introduced through imported functions.
7. `provide` removes requirements before the module bound applies.
8. Written function bounds and annotated function types retain their current checks.
9. Modules without headers retain existing export checks.
10. Incremental updates propagate changed inferred requirements to importers and update interface hashes.
11. Lowered modules pass the independent validator. Emitted TypeScript preserves service identities and inferred Effect requirements.
12. The Users example, compiler documentation, website examples, and TypeScript panels agree.
13. Returned deferred computations and returned functions cannot hide an undeclared external service requirement.
14. Requirements in input types alone do not require a service header. Internal Effect capabilities retain their existing behavior.
15. A provider that supplies `Users` and requires `Config` removes `Users` and retains `Config`.
16. Exported inferred requirements include foreign service declarations and method types in the interface and its hash.

Run focused tests first. Run `deno task check` before each commit.
Mutation reads committed HEAD. Run a small mutation sample before a larger sample, with the same options except sample size.
Record exact commands, results, limitations, review findings, and user steering in the companion worklog.
