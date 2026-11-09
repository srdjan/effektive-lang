# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Checking pipeline

### Typed IR

The versioned, serializable intermediate form of a checked module, in which every expression node carries an annotation.

The emitter reads only the typed IR, and the independent validator checks it, so the typed IR is the contract between the checker and every later stage.

### Annotation

The type, execution mode, and active failure and requirement sets that the checker records on each expression node of the typed IR.

The independent validator recomputes each annotation from the node's children. An annotation that copies an outside hint, such as the expected type of a binding, can differ from the recomputed value even when the program is valid.

### Expected type

The type that the checker gives to an expression from its context, such as a binding annotation or the parameter of a builtin, before the checker checks that expression.

An expected type is a constraint as well as information: the branches of a conditional or match must each fit it, and the conditional then takes it as its type. Some builtins also read their own type from it. A type built only to supply information must therefore go only to the forms that need it.
_Avoid: hint, when the type is also enforced_

### Independent validator

The second checker that recomputes every annotation of the typed IR without shared code with the source checker, and reports each disagreement.

It acts as a differential oracle: a program that the checker accepts and the validator rejects shows a defect in one of the two. A disagreement is repaired so that both derive the same annotation, not by weakening the validator.
_Avoid: IR checker, second pass_

### TypeScript outputs

The per-program `TypeScriptOutputs` cache of emitted text, span tables, and source maps.

The frontend owns checking and lazy lowering. Output queries take a revision explicitly and reuse its lowering-result object as a weak cache key. Source hover needs neither lowering nor output; combined hover takes this cache to add the backend declaration.

### Type table

The checker stores each structural type once in shared interned storage and refers to it by a reference number.

Each revision has separate alias definitions and error-record definitions over that shared storage.
Later updates cannot change the definitions that an earlier revision reads.
Cached modules retain their last-check tables.
The current revision exposes its own table through `Revision.types`.

Reference numbers depend on intern order.
A reference number must never decide an order, choice, or message that the user can see.
A canonical structural key decides those results; the reference number only breaks ties.

### Disk program

The second `Program` of a language-server project that sees only the disk texts and never the open-document overlay. Each save round updates it and writes the generated files from it.

It exists so that a generated file always comes from saved source: the overlay program serves diagnostics and hover, and the disk program serves file output.
_Avoid: mirror, shadow program_

### Complete workspace snapshot

A successful read of every required project entry.
A failed inspection returns an error and leaves the previous complete inputs available.
The existing skip rules still apply to confirmed missing files, cycles, and links outside the root.

### Prelude table

The one table that lists every prelude operation, with a flag that tells whether a source binding may shadow it.

The prelude name type and the name sets all derive from this table. The checker keeps one row for each prelude name except `None`. A row holds a prologue and a handler. A name without a row is a compile error. A row may state that the handler tests its own argument count.

### Stage set

The effect set that one pipeline stage adds by itself, without the effects of its left value.

A quiet value is pure and has no failure and no requirement. When the left value is not quiet, the checker checks the stage with a quiet value of the same type in its place. Lowering moves the left value into its own binding and copies the stage set onto the stage call. Lowering never derives a stage set, so each stage rule has one owner. So a stage handler must not read the effect sets or the mode of its left value.

## Type identity

### Type identity

A `type` declaration has identity by name. It has none when its body is a union with a non-literal member or a bare name.

Examples are `type UserId = string`, `type Cents = int`, `type Status = "pending" | "paid"`, and `type User = { id: UserId, name: Name }`. A literal-only union gives identity. The bodies `void`, `never`, `unknown`, and `null` give identity too.

Two different types with identity never mix. This holds when their bodies are equal and when they come from different modules. A value of a type with identity fits its own body. An unnamed value fits a type with identity when the value fits its body. An unnamed value is a literal, an operator result, or an inline record, array, or tuple literal. A value of another type with identity needs the constructor, as in `Text(key)`. The builtin `Duration` and `Instant` are the closed exceptions: an unnamed value never fits either, so only a duration literal, `now()`, or arithmetic of the two types makes one.

The identity exists in the checker. The emitted TypeScript of an untagged type is the schema and the type of its body.
_Avoid: nominal type, brand type, data type_

### Transparent alias

A `type` declaration whose body is a union with a non-literal member, or a bare name. Examples are `type Article = Draft | Published` and `type Alias = User`.

A transparent alias is interchangeable with its body. It has no constructor and no identity.

### Tagged record

A record type with identity that a union alias of its own module lists. Every member of that union must be a record type with identity of the module, a tagged record of another module, or an error.

A tagged record value carries a runtime `_tag` of the form `<module>#<Name>`. The emitter prints `Schema.TaggedStruct`. A record literal written at exactly the expected tagged type constructs the value with no call. A computed value needs `Name(value)`.

A union in another module does not tag a record. When a later edit adds a record to such a union, the wire form of the record gains `_tag`. A union of records with a literal discriminator field is a different concept: it needs no runtime tag.
_Avoid: nominal record, data record_

### Tagged domain

The pattern domain of a `match` subject whose members are all tagged records or errors, after transparent aliases unfold.

Arms name the members, as in `Circle(c)`. Coverage needs one arm for each member or `_`. A record pattern does not apply to a tagged domain. A subject that mixes tagged members with other members has no domain, and the checker reports it.

### Sealed type

A type with identity whose declaring module owns construction and the operations that can invalidate its rules.

The declaration uses `sealed type Name = T`. Other modules can pass, compare, and read values. The owner exports conversions and decoders when needed. `sealed` on a transparent alias gives `declaration/017`.
The source restriction does not isolate generated TypeScript from unsound host code.
_Avoid: sealed nominal type_

### Pure function type

A function type that requires pure execution and empty failure and requirement sets.

The form is `pure (value: T) => U`. Empty effect sets alone do not establish purity. An unmarked function type retains effect execution.

### Companion module

The generated TypeScript module of a host interface file: `host.effi` gives `host.effi.ts`.

It holds the types, types with identity, errors, and services of the interface, so the compiler owns each tag string. Source modules and the host module import those values from it. The host module supplies only the opaque types and the providers.
_Avoid: interface module, host types module_

## Verification

### Behavior comparison

The refactor oracle that runs one named corpus through the public entry points of two revisions and compares the full canonical results.

The corpus holds the fixture projects of the head tree, the forged IR of `buildFixtures()` in `scripts/validate_fixtures.ts`, and four edit sequences of `Program.update`. It records results of eight kinds: check, program, program-error, lower, lower-error, emit, emit-error, and validate. The command names each changed or missing record. It does not depend on the test suite, so moving or rewriting tests does not change its records. The corpus sees only fixture inputs, so it does not cover inline test programs or command-line or language server output. The surface snapshot covers that output.
_Avoid: behavior capture, snapshot, golden run_

### Surface snapshot

The refactor oracle for command-line and language server output. `fixtures/surface/cli.json` records the exit code and the ordered events of each command-line case. `fixtures/surface/lsp.json` records each message that the server sends in one scripted session.

`tests/surface_test.ts` compares the current build with these files. Run `deno task surface:update` only after a deliberate change of that output.
_Avoid: golden file, transcript_

### Slow suite

The test files that may start subprocesses, such as `deno check` and `deno run` of emitted code.

The runner runs the files in parallel, one file for each worker, and runs the tests of one file in order. So the longest file sets a lower bound on the wall time. Each run starts with an empty dependency cache, and all files of the run share it. A change for speed counts only when it lowers the wall time of the whole suite.

### Mutant

One small fault that `deno task mutate` makes in a copy of the source, such as a flipped comparison.

A test kills a mutant when the test fails against that fault. A mutant that no test kills is a survivor, and it shows a missing test or a change that no input can observe.
_Avoid: mutation fixture, which is a forged IR in `scripts/validate_fixtures.ts`_

### Survivor register

The file `fixtures/mutation/survivors.json`, with one row for each survivor that the project accepts, and the reason.

`deno task mutate` exits 1 for a survivor with no row. It also exits 1 for a stale row: a row of a scanned file that does not match exactly one site. A row of a file that no run scans can stay stale.
_Avoid: ignore list_

### Property test

A test that generates its inputs from a literal table of seeds and asserts one law over each input.

The test also asserts literal counts of each outcome, so it cannot pass with no effective input. `docs/testing.md` lists each property test and what it can miss.
_Avoid: fuzz test_

### Noise floor

The bound on timing noise of one bench row: the 90th percentile of `|A/B - 1|` over alternating pairs of two sides of the same build.

A difference inside the floor of its row counts as null. The floor covers only the noise inside one run. Load that changes between runs makes a wider spread, so a comparison of two commits alternates base and head runs and records the load. A bisect step has its own floor, which two trees with the same code measure.
_Avoid: error bar, noise level_

## Function contracts

### Service header

A top-level declaration that permits one external service dependency for the module.

The form is `imports Users from "./users-service.eff"`. It binds the exported service without providing an implementation.
Service headers precede ordinary imports and declarations. A module can declare more than one service header.

The declared services bound the module's inferred requirements. The bound includes requirements reached through calls and produced values.
It excludes requirements that occur only in input types. Reserved Effect capabilities do not need a service header.
Services that the same module declares do not need a service header.

### `with` clause

The part of a function header that lists the services that the body needs, such as `with Users.find | Users.save`.
A name in the clause is a service or a service method.
A written clause is a checked upper bound. A module with service headers can infer an omitted clause on every function.
Without service headers, an exported function closes its omitted clause as empty. A local function still infers an omitted clause.
_Avoid: uses clause_

### `fails` clause

The part of a function header that lists the errors that the body can raise.
A written clause is a checked upper bound on the failure set of the body.
`fails never` writes an empty set. An editor action writes the inferred set as a clause.
_Avoid: error clause_

### Inferred contract

The failure set or service set that the compiler solves from a function body, when the header omits the clause.
Every function with a body infers an omitted `fails` clause. A service header also enables requirement inference for exported functions.
A new failure in an exported function with an inferred failure set reaches host TypeScript with no diagnostic. A written `fails` clause guards against this.

### Contract origin

A node of a function body that introduces a failure or a service requirement, such as a `fail(...)` or a service method call.
When a written clause misses an entry, the contract diagnostic gives each origin of that entry as a related location.
Through a call, the origin is the call, not a node inside the called function.
_Avoid: error source, cause_

### Value provenance

The origin of a value or one component: an input, a local producer, or an unresolved origin.
Transferred input components keep their exemption from the module's service bound.
A produced component retains its requirements when an input contains the same capability.
An unresolved origin retains the requirements of the checked expression type.

## Inferred inputs

### Input contract

The finalized type that a function body requires from a parameter.
Omitted parameter types and explicit `unknown` infer the same contract.

### Callable evidence

Partial internal evidence that an expression can be called.
It holds known parameter types, optional result information, and checked flags.
It does not claim a complete function type or execution contract.

### Input demand

A type requirement for an inferred parameter or one of its field paths.
The demand retains its source node for diagnostics.

### Deferred input call

A call whose inferred callee has no usable callable contract yet.
The resolver processes each distinct recovered contract once through a finite worklist.
An unresolved call requires a concrete annotation.

### Checked entry

An exported function that accepts raw input and validates its inferred contract when its Effect executes.
Without a `fails` clause, its inferred failure set includes `SchemaError`.
Its function type carries checked flags. Its body uses finalized parameter types.

### Concrete refinement

A contextual `where` predicate on a type with identity.
Construction, adoption, arithmetic, and updates require proof of the predicate.

### Proof certificate

A serializable record of Boolean splits and contradiction witnesses for a refinement obligation.
The independent validator reconstructs the obligation and checks the certificate with separate code.
