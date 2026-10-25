# Inferred input contracts and automatic validation

The user accepted this plan on 2026-10-25. The complete release includes input inference, concrete refinements, entry validation, and independent validation.
Generics and abstract predicates remain outside this release.

## Input contracts

Omitted parameter types and explicit `unknown` have equal behavior. Bodies determine requirements independently of callers.
Known arguments, constructors, local annotations, expected function types, and explicit results supply requirements.
Each input has one inference variable. Required paths form nested closed records. Simple constant aliases retain those paths.
Repeated requirements must retain equal identity. Conflicts produce diagnostics at both uses.
Unconstrained inputs remain `unknown`. Operators alone cannot select numeric or domain types.
Callees settle before callers. Recursive inference, ambiguous operators, and unresolved callback elements require concrete annotations.
Declarations without bodies default omitted types to `unknown`.
Requirements across branches combine into one closed record. Conditional omission needs an explicit union.

## Exported entry validation

Each inferred exported input has a raw input capability and a finalized body contract.
Unknown values may enter checked inputs. Known components and identities must fit statically.
Known invalid literals remain errors. Typed values with unproved predicates retain proof obligations.
Aliases, function values, imports, and interfaces preserve checked-entry metadata.
Conversions may discard that capability but cannot fabricate it. Local functions have no entry checks.
Checks execute inside the Effect, in parameter order, before the body. Arguments retain evaluation order and execute once.
Checks reject missing and extra record fields. Checks perform no coercion, defaults, or user transformation.
The existing Effect Schema backend supplies validation. Generated failures require an explicit exported `fails SchemaError` contract.
Opaque values, deferred values, and foreign sealed identities require concrete annotations or a source-owned decoder.
Host interfaces retain unrefined data contracts.

## Concrete refinements

Contextual `where` clauses apply to identities and tagged records. Transparent alias predicates remain deferred.
Example: `export type Positive = int where n => n > 0`.
Predicates support Boolean connectives, integer comparisons, required fields, and string or array lengths.
Predicate `len` counts UTF-16 string code units. Integer arithmetic uses exact mathematical integers.
Integer formulas must normalize to difference constraints. Ordinary arithmetic retains checked safe-integer behavior.
Floating-point predicates and arbitrary calls remain unsupported.
Arithmetic and updates must prove predicate preservation without changing identity or ownership.
Flow facts cover `if`, `match`, `&&`, and `||`. Branch joins retain common established facts.
The bounded solver returns `proved`, `disproved`, or `unknown`. Exhaustion blocks static obligations.
Limits for queries and compiler updates require measurements against the existing editor budget.
Certificates include Boolean splits and contradiction witnesses. Separate validator code reconstructs obligations and checks certificates.
The validator rejects unsupported claims and inconsistent entry contracts.
Consistent contract erasure needs an independent trusted contract source and remains an explicit evidence limit.

## Compiler integration

Typed IR version 6 carries canonical predicates, finalized input contracts, entry validation, and certificates.
Contracts reach lowering, interfaces, hashes, TypeScript output, hover, and signature help.
Annotation quick fixes must preserve entry validation. Compiler APIs remain synchronous.
Cache keys include canonical contracts, predicates, assumptions, and solver rules.

## Acceptance

The first example must finish the complete compiler and runtime pipeline in under one minute.
Tests compare omitted inputs with explicit `unknown` inputs.
Inference cases cover nested paths, aliases, forward calls, imports, function values, conflicts, unused inputs, and recursion.
Entry cases cover unknown calls, invalid known calls, exact records, ordered checks, single evaluation, and missing `SchemaError`.
Refinement cases cover arithmetic boundaries, invalid updates, short circuiting, identities, ownership, exhaustion, and certificate mutations.
Small exhaustive domains compare static decisions with generated checks. Boundary cases include unsafe arithmetic intermediates.
Documentation, fixtures, editor behavior, project status, and the sibling website must stay current.
Changed Effektive examples must compile. Website TypeScript panels must pass strict checks.
Each isolated commit requires `deno task check`. Work stays on local `main`. Website commits remain separate. Nothing is pushed.
Unrelated changes must remain untouched. Host mutation through retained aliases remains an evidence limit.

## Worklog

The initial working trees were clean. Deno is 2.9.8. The baseline fast suite passed 2,146 tests in 10 seconds.
The main agent owns integration, independent validation, emission, documentation, and authoritative checks.
Separate workers own predicate solving, source type infrastructure, and input inference.
The next action belongs to the main agent: connect the first complete pipeline example.


## Integration checkpoint

The user confirmed the website update, including nominal types and inference.
The first complete pipeline test passed in 623 milliseconds.
The complete compiler gate passed 2,208 fast tests and 210 subprocess tests before final review.
The website passed 57 strict panel units and 11 tests.
The main agent fixed inference of binding contracts, recursive unknown components, and forwarding calls to checked entries.
Source checking shares one aggregate proof budget across each compiler update.
The measurement report records the selected limits and the observed editor workload.
The main agent owns the remaining review, final verification, and separate local commits.

The final review found an unchecked host refinement contract.
The compiler now rejects refined contracts in host interfaces, including imported services supplied by providers.
Public compiler tests passed for direct, nested imported, and provider contracts.
The independent validator rejects refined interface declarations.

## Completion record

Input inference, checked entries, concrete refinements, IR version 6, emission, and editor support are complete.
The website now describes type identity, inferred inputs, entry checks, concrete predicates, and version 6.
Public tests cover contextual option elements, pipeline captures, tagged construction, and unrefined host interfaces.
Mutation tests reject forged certificates, self-justifying bindings, and unsupported claims that share a proof object.
The validator consumes each proof at its expression, independently of object sharing.

The final compiler gate passed 2,227 fast tests and 210 subprocess tests.
The website passed 57 strict target units and 11 serving tests.
The changed source example passed checking, lowering, independent validation, and emission.
The linked IR fixture passed independent validation. The standalone IR model passed TypeScript checking.

The measured solver limits remain 8,192 steps per query and 100,000 steps per compiler update.
The final review found repeated inference for typed arrows and repeated declaration scans for signature help.
Both paths now avoid that repeated work. The measurement report retains the samples and the large-workload latency limit.
Decoder caching remains outside this change. Current runtime tests meet the required sub-minute pipeline check.

Consistent contract erasure and retained host mutation remain evidence limits.
No browser renderer was available for visual inspection. The website checks cover target types, serving behavior, and asset versions.
The user owns review and any push after the separate local commits.

The review also found raw option payloads, source-owned dollar names, and factory calls in signature help.
Checked option constructors now retain raw payload types until entry validation.
Generated pipeline steps use an explicit IR marker. Source-owned dollar names retain their proof assumptions.
Signature help follows only direct or parenthesized alias references.
Destructured fields retain projection equations in both proof implementations.
The runtime test covers direct and piped raw option payloads. Known invalid values still fail static checking.

## Review evidence limits

The full review completed with no remaining actionable findings.
The review retained six coverage gaps.
Dedicated tests do not cover conditional checked arguments, nested runtime exactness, or prototype-sensitive fields at automatic entries.
Integration tests do not exhaust the aggregate validator allowance.
Measurements do not cover large solver arrays or many declarations during validation.

Large expression visitors and duplicated proof limits remain maintenance risks.
The solver step allowance does not bound allocation during Boolean splits.
The independent validator uses a fresh allowance for each declaration. It has no module-wide proof allowance.
The acceptance gate establishes only the tested behavior.

## Review correction worklog

The user requested fixes for three reproduced review findings.
The working tree was clean before this correction batch.
Integer proof facts must exclude Float values in both implementations.
Checked records must retain raw components until entry validation.
Local annotations must remain authoritative while their initializers collect input demands.
The focused raw-record test reproduced diagnostic `type-mismatch/013` before its fix.
The delegated annotation fix and integer-proof fix passed their focused tests.
The main agent owns integration, complete gates, separate local commits, and the website evidence update.

The integer fix excludes non-integer paths in both proof implementations.
Tests cover Float parameters, aliases, nested fields, unions, arithmetic, and mutated IR certificates.
The raw-record fix defers predicates only when a predicate input has unknown type.
An unrelated unknown field cannot remove a static predicate obligation.
The independent validator rejects both changed values and erased proof annotations.
Conditional checked records and nested runtime exactness now have dedicated coverage.
Written local annotations remain authoritative after inference visits their initializers.
Tests also retain incompatible-initializer diagnostics and caller-independent requirements.

The full gate passed 2,239 fast tests and 212 subprocess tests after these corrections.
The website passed 57 strict target units and 11 serving tests.
The main agent reviewed each worker diff and reran the focused compiler and runtime checks.
No push or browser rendering check ran during this correction batch.
