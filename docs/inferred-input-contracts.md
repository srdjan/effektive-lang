# Inferred input contracts

Omitted parameter types and explicit `unknown` have equal behavior.
The compiler infers requirements from the function body, independently of callers.

```effektive
export type Positive = int where n => n > 0
const charge = (amount: Positive): Positive => amount
export const submit = (input): Positive fails SchemaError => charge(input.amount)
```

The body contract of `input` is `{ amount: Positive }`.
The exported function accepts raw input and validates that contract when its Effect executes.
Application code needs no schema value or decoding call.

Known call parameters, constructors, local annotations, expected function types, and explicit results supply requirements.
Required paths form nested closed records. Simple constant aliases retain their input paths.
Local inference keeps each written binding annotation while its initializer collects input requirements.
Requirements from separate branches combine into one closed record.
Conflicting requirements report both uses. Operators alone do not select numeric types or identities.
Unconstrained parameters remain `unknown`.
Recursive inferred parameters and unresolved callback elements need concrete annotations.
A declaration without a body defaults omitted parameter types to `unknown`.
Host interfaces cannot declare refinements or expose types whose reachable contracts contain refinements.
This rule includes imported types, errors, deferred results, callbacks, and services supplied by host providers.
Host adapters return unrefined data to checked source entries.

Local functions use inferred contracts statically and generate no entry checks.
Exported results remain explicit. Exported failure and service contracts remain closed.
An inferred exported input with a concrete contract requires `fails SchemaError`.
Opaque types, deferred types, and foreign sealed types need concrete annotations or a source-owned decoder.

Unknown components can enter checked parameters. Known components must remain statically compatible.
Known invalid literals and incompatible identities remain compile errors.
Fully typed values must prove required predicates.
Within checked records, unknown predicate inputs defer their record predicate to entry validation.
Concrete predicate inputs retain static obligations despite unrelated unknown fields.
Raw field types survive lowering. Contextual optional fields retain their existing omission rules.
Checked-entry capability survives aliases, function values, interfaces, and imports.
A conversion can discard the capability but cannot create it.
Calls to checked entries do not narrow the input contracts of forwarding functions.

Checks execute in parameter order before the body. Argument expressions keep their order and execute once.
Closed records reject missing and extra fields. Checks apply no coercions, defaults, or user transformations.
The backend uses `Schema.toType` with Effect Schema decoding.
Existing explicit Schema operations remain available.

## Concrete predicates

A contextual `where` clause applies to a type with identity, including tagged records.
Transparent alias predicates, generics, and abstract predicates remain unsupported.
Predicates support `&&`, `||`, integer comparisons, required field paths, and `len` for strings or arrays.
String lengths count UTF-16 code units.
Integer addition and subtraction must normalize to difference constraints, such as `x - y <= k`.
Predicate arithmetic uses exact mathematical integers. Ordinary arithmetic retains safe-integer checks.
Integer proof facts use only integer types and integer lengths. A `number` value cannot establish an integer fact.
Floating-point predicates and arbitrary calls remain unsupported.

Constructors, implicit adoption, arithmetic, and record updates must prove each required predicate.
The compiler retains identity distinctions and sealed ownership.
The checker uses scoped facts from `if`, `match`, `&&`, and `||`.
A record literal that fits several union members takes a member with no predicate when one fits.
Otherwise it needs the proof of the member that it takes, as for a direct result.
Two branches that establish the same `||` fact in a different operand order or grouping agree at the join.
The solver returns `proved`, `disproved`, or `unknown`. Exhaustion returns `unknown` and rejects the affected obligation.
The [measurement report](refinement-measurements.md) records query and compiler-update limits.

## Compiler and editor contracts

IR version 6 carries predicates, finalized parameter types, checked flags, entry validation, and proof certificates.
Generated pipeline bindings carry `generated: true`. These captures add no source assumptions to certificates.
The validator still checks each capture initializer against its binding contract.
The validator independently reconstructs obligations and checks Boolean splits and contradiction witnesses.
The validator also checks entry validation against body parameter contracts.
Interfaces and hashes include finalized contracts and predicates.
Incremental cache keys include the solver rules version. Source text supplies assumptions and body requirements.
Compiler APIs remain synchronous.

Hover, parameter hints, and signature help show inferred body requirements.
Signature help identifies raw checked input as `unknown -> Contract`.
Failure quick fixes retain omitted or `unknown` parameter syntax and its entry checks.

The validator cannot detect consistent contract erasure without a separate trusted contract source.
Mutation tests record that limit. Retained host aliases can mutate values after validation.
The tests establish no general host-mutation guarantee.
