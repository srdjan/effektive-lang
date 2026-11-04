# Effect upgrade to 4.1.2

## Authority and constraints

The user accepted this plan on 2026-11-04 and requested implementation.
EU means Effect upgrade. Each numbered unit below uses that prefix.
The target is exact version 4.1.2 for Effect and both Node platform packages.
Source syntax, compiler APIs, diagnostics, and contract rules stay compatible.
Work stays on local `main`. Each complete unit gets a local commit. Nothing is pushed or published.
Historical measurements keep their original dependency versions.
The evidence file records progress, findings, commands, and review limits.

## Orchestration

The main agent owns specification, review, checks, and commits.
The requested executor model, `gpt-5.6-sol`, is unavailable. The main agent will execute sequentially.
No independent model review can be claimed without an actual review result.
Each turn budget limits agent turns, not elapsed time.

| Unit | Files and responsibility | Acceptance | Turn budget |
| --- | --- | --- | --- |
| EU1: Compatibility inventory | Emitter families, host fixtures, target tests, upstream changes | Relevant upstream changes have affected surfaces or exclusion reasons | 3 |
| EU2: Pins and compatibility | CLI target constant, three locks, fixture configurations, benchmark imports, version and CLI tests, necessary emitter repairs | Focused tests and `deno task check` pass | 6 |
| EU3: Website alignment | Sibling target configuration, lock, examples, current version statements | Website tests, strict panels, compiler example tests pass | 4 |
| EU4: Review and evidence | Current documentation, changelog, plan registry, evidence | Review findings close and required gates pass | 3 |

## Implementation

I will first record Git state and read each repository's instructions.
I will review upstream releases 4.0.6 through 4.1.2 against active emitted APIs and host adapters.
I will prioritize Schema, Effect, Context, Layer, Schedule, streams, references, and Node file services.
I will preserve schema guards unless target probes prove that removal preserves every accepted behavior.

I will set `EFFECT_VERSION` to `4.1.2` and retain derived target imports.
I will regenerate the target lock through the procedure in `docs/development.md`.
I will retain the shared platform override and remove only the documented workspace metadata.
I will update active fixture pins, benchmark imports, CLI expectations, and version tests.
I will regenerate the application lock and update the frozen root lock.
I will inspect lock diffs for unrelated dependency changes.
I will retain checks that reject drift and allow host imports under the target lock.

I will repair emitted TypeScript only when compatibility checks demonstrate a defect.
I will add behavior tests only for demonstrated changes or missing coverage.
If logic changes, I will run mutation checks against the tested committed revision.
I will start with a small sample and increase only the sample size.

I will update current setup guides, target statements, and the Unreleased changelog.
I will document Node.js 22.19.0 as the minimum for the Node platform packages.
I will preserve historical release records and measurements.
I will update sibling website pins, current claims, canonical specification claims, and examples where needed.

## Verification and completion

I will first run a bounded smoke check in a temporary project.
I will then run existing schema, runtime, application, strict target, and CLI checks through their harnesses.
I will check initialization pins, frozen lock behavior, transitive drift, host modules, and runtime execution.
I will run `deno task check` before each compiler commit.
I will run `deno task test:installation` and the sibling website's tests and strict TypeScript checks.
I will preserve exact command results and distinguish failures from evidence limits.

I will review each diff and commit coupled compiler changes as one coherent unit.
I will commit website changes separately in the sibling repository.
I will archive the completed plan and evidence and update registry links.
The user owns pushes, publication, deployment, and release version changes.
