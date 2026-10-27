# Second selection of Effect features

Date: 2026-10-27. Baseline: `c8999c5`. SL identifies this plan's units.
Status: validated by Fable, approved by the user on 2026-10-27.

On 2026-10-27 the user chose the second selection from the
[status table](../status.md#effect-4-features-to-surface-in-source): item 18
(`now()` and `random()`), item 16 (logging) and item 22 (`Map` and `Set`).
Metrics, the other half of item 16, are not in this selection. The design rules
of the [effect surface plan](../archive/plans/2026-10-27-effect-surface.md#design-rules)
apply: extend an existing form before adding a name, make each new prelude name
shadowable, give each new IR shape an independent validator rule, and expose no
Effect module name as a source name.

## Evidence from the baseline

The plan author checked these facts at `c8999c5` and in `effect@4.0.5`
(`dist/*.d.ts` and `dist/*.js` under the Deno npm cache).

**Time and randomness.**

- `Clock.currentTimeMillis` is `Effect<number>` (`Clock.d.ts:265`). It reads the
  `Clock` reference, so `TestClock` controls it.
- `Random` exports `next` (`Effect<number>`, `Random.d.ts:88`), `nextBetween`,
  `nextIntBetween(min, max, { halfOpen? })` (`Random.d.ts:185`), `shuffle`,
  `choice` and `withSeed`. `Random` is a default reference, so it adds no
  requirement.
- Today source gets the time only from a host service. The portable publisher
  declares `type Instant = int` (`fixtures/applications/portable-publisher/domain.eff:6`)
  and a `Clock` service (`ports.eff:17`).
- `ScheduleInput` keeps `start` and `now` as `number` clock instants
  (`docs/language-rules.md:458`).

**Logging.**

- `Effect.logWithLevel(level?: Severity)(...message)` (`Effect.d.ts:18497`).
  `Severity` is `"Fatal" | "Error" | "Warn" | "Info" | "Debug" | "Trace"`
  (`LogLevel.d.ts:85`). `Effect.annotateLogs` takes a key and value, or a record
  (`Effect.d.ts:18815`). `References.MinimumLogLevel` filters entries
  (`References.d.ts:350`), and the host sets it.
- `fixtures/examples/log.eff:9` and `fixtures/ir/example/log.eff:9` export a
  value named `log`. So a prelude `log` must be shadowable.

**Map and Set.**

- `Equal.equals` compares plain objects and arrays by structure
  (`Equal.js`, `compareStructure` falls through to `compareRecords`). The
  emitter emits records as plain objects, so a `HashMap` with record keys
  compares keys by value. Functions compare by reference.
- `HashMap` exports `empty`, `make`, `fromIterable`, `get` (an `Option`), `has`,
  `set`, `remove`, `keys`, `values`, `entries`, `toEntries`, `size`, `map`,
  `filter`, `reduce` and more. `HashSet` exports `empty`, `make`,
  `fromIterable`, `add`, `has`, `remove`, `size`, `union`, `intersection`,
  `difference`, `map`, `filter` and `reduce`. Iteration follows the hash
  structure, not insertion order.
- `Schema.HashMap(key, value)` and `Schema.HashSet(value)` exist
  (`Schema.d.ts:10253` and `10281`). Their encoded side is a `HashMap` or
  `HashSet` of encoded values, as `Schema.Option` is for `Option`
  (`emit/types.ts:471`).
- The language has no array length or index operation. Arrays use `map`,
  `filter`, `fold`, `traverse` and `all` (`check_builtins/collections.ts:523`).
- A list of pairs needs an expected type. Without one,
  `[["a", 1], ["b", 2]]` gives `type-mismatch/012`. A list of records infers.
- A builtin generic data type touches many sites. `Option` has cases in about
  20 files (`types.ts` 10, `validate/typing.ts` 7, `validate/world.ts` 4,
  `check_patterns.ts` 4, emitter files 9, and others).

## Decisions

These decisions change the source that users write. On 2026-10-27 the user
chose (a) for SL-D1 to SL-D6.

- **SL-D1 (the type of `now()`).** (a) A closed builtin type `Instant`, a
  number of milliseconds since the Unix epoch, with its own operator table:
  `Instant - Instant` gives `Duration`, `Instant + Duration` and
  `Instant - Duration` give `Instant`, two `Instant` values compare, and every
  other mix is a diagnostic. `ScheduleInput.start` and `now` become `Instant`
  (recommended, because it follows the `Duration` design that the user chose
  for ES1b). (b) `now()` returns an `int` of milliseconds.
- **SL-D2 (random forms).** (a) `random()` returns a `number` in [0, 1), and
  `randomInt(min, max)` returns an `int` with `min <= n < max`. A call with
  `max <= min` is a runtime defect (recommended). (b) `random()` only.
- **SL-D3 (log form).** (a) One name with an options record, as `retry` and
  `repeat` have: `log(message)` logs at the info level, and
  `log(message, { level: "warn", fields: { orderId: id } })` sets a literal
  level and structured fields (recommended). (b) `log(level, message, fields?)`,
  the candidate form of the status table. (c) One name for each level, such as
  `logInfo` and `logWarn`.
- **SL-D4 (Map and Set operations).** (a) Builtins with the noun suffix that
  `getRef` and `takeStream` use: `mapOf`, `getMap`, `putMap`, `removeMap`,
  `hasMap`, `entriesMap`, and `setOf`, `addSet`, `removeSet`, `hasSet`,
  `itemsSet`. `entriesMap` and `itemsSet` return arrays, so `map`, `filter` and
  `fold` apply to the result (recommended). This adds 11 names against the
  rule "extend an existing form before adding a name". The reason: `get`,
  `put`, `has` and `remove` are common user identifiers, the prelude already
  names operations by noun suffix, and one contract for each name keeps the
  diagnostics specific. (b) Extend `map`, `filter` and `fold` to accept a `Map`
  or a `Set`, and add generic `get`, `has`, `put` and `remove` that accept
  both. (c) A hybrid: the constructors `mapOf` and `setOf`, generic `get`,
  `has`, `put` and `remove` for both types, and `entriesMap` and `itemsSet` for
  iteration.
- **SL-D5 (iteration order).** (a) `entriesMap` and `itemsSet` return the
  elements in the hash order of `HashMap` and `HashSet`. The order is stable for
  equal contents but is not insertion order. The documentation says so
  (recommended). (b) Insertion order. This needs a runtime structure other than
  `HashMap`.
- **SL-D6 (minimum log level).** (a) The host sets it with
  `References.MinimumLogLevel` at the runtime entry point. Source has no form
  for it (recommended, because the level is deployment configuration). (b) A
  source form, for example a `minLevel` option on `provide`.

## SL1: `now()` and `Instant` (item 18, SL-D1)

This section follows SL-D1 (a). If the user chooses (b), `Instant` and its
operator table go away, and `now()` returns `int`.

**Type.** `Instant` is a builtin type word with the identity
`type:effect/Instant`, a closed identity over `int`. A user declaration named
`Instant` is `declaration/002` (`resolve.ts:412-428`). No literal makes an
`Instant`. `now()`, `Instant` arithmetic, the schedule input, and a host
service or schema field typed `Instant` give one, because its boundary schema
is the int schema. An `Instant` widens to `int`.

**One set of closed unit ids.** `DURATION_ID` has about 25 sites. This unit
first adds `CLOSED_UNIT_IDS` (`Duration` and `Instant`) in `ir.ts` and replaces
each closed-fit and erasure test `=== DURATION_ID` with a membership test.
Sites that are specific to `Duration` (literals, patterns, schedule fields)
stay as they are. The sites are: the closed fit in `types.ts` near line 1237
and `validate/typing.ts` near line 309 and lines 814 and 918, `emit/types.ts`
lines 360 and 443, `emit/scope.ts` `nameOf` and `resolve`, `emit/expr.ts`
(the `nominal` erasure), `type_show.ts:56`, `type_lower.ts`, `check.ts:281`
(an exhaustive `never` switch over builtin type names), `resolve.ts`
`BUILTIN_TYPES`, `validate/world.ts`, and the tmLanguage type pattern. The
implementer greps `DURATION_ID` and classifies every site before the change.

**Operators.** The checker (`check_binary.ts`) and the validator
(`validate/expr.ts`) get an `instantArithmetic` rule. It runs before
`durationArithmetic` (`check_binary.ts:168-186`, validator mirror
`validate/expr.ts:2086-2110`) and before the shared-identity rule of
`operatorResult`. Otherwise `durationArithmetic` sees an `Instant` as an
`int` and rejects `Instant + Duration`, and the shared-identity rule types
`Instant - Instant` as `Instant`.

- `Instant - Instant` gives `Duration`.
- `Instant + Duration`, `Duration + Instant` and `Instant - Duration` give
  `Instant`.
- `Instant + Instant`, `Duration - Instant`, `Instant + int`, `int + Instant`,
  `Instant - int`, `int - Instant`, `Instant * int` and `Instant / int` give
  `type-mismatch/007`.

**Comparisons.** `comparisonClass` (`check_binary.ts:211-246`) widens an
identity to its base, so `Duration < int` and `Duration === Instant` type-check
today. This unit closes comparisons for both closed unit types: `<`, `<=`,
`>`, `>=`, `===` and `!==` need two values of the same closed unit type, and
any other mix with a closed unit type is `type-mismatch/007`. This is a
breaking change for `Duration`, which Effektive accepts because it has no
users. The validator applies the same rule.

**Builtin.** `now()` takes no arguments, has effect mode, no failures and no
requirements. Emission: `Clock.currentTimeMillis`. Prelude entry
`shadowable: true`, because `now` is a common parameter name (the publisher
uses it, `domain.eff:65`).

**Schedule input.** `ScheduleInput.start` and `ScheduleInput.now` become
`Instant` in the checker (`types.ts:654`) and in the validator, which
hard-codes `NUMBER` for both fields (`validate/families/schedule.ts:32`). The
emitter passes Effect's millisecond numbers through, as it does for `elapsed`.
No fixture reads `meta.now` or `meta.start`, so no golden output changes.

**Migration.** The portable publisher adopts the builtin. It deletes
`type Instant = int` (`domain.eff:6`) and its import of `Instant`, keeps its
`Clock` service with `now(): Instant`, and drops the constructor call in
`clockLive` (`publisher.eff:9`), because `time.nowMillis()` returns an `int`
that cannot construct a closed type. The implementer checks whether the host
time port can type its result as `Instant`. If it cannot, `clockLive` uses
`now()` in place of the host time port, and the README records the change. The
witness keeps its checks. Only generated `.ts` files of the publisher mention
`Instant`.

IR: new leaf kind `now {}`. The IR version stays 7. `Clock.currentTimeMillis`
is a value, not a call, so the kind needs family code in
`emit/families/effect.ts`, as `sleep` has (line 150), not a `LEAF_CALLS` row.

Verification: `now()` under `TestClock` after `TestClock.adjust`; each operator
rule and each rejected mix; the comparison rule for `Duration` and `Instant`;
`Instant` widens to `int`; `type Instant = int` in a module; a schedule callback
that reads `meta.now` as `Instant`; forged IR for the operator rules and for a
wrong result type; the publisher gate passes.

## SL2: `random()` and `randomInt` (item 18, SL-D2)

`random()` has effect mode and returns `number`. Emission: `Random.next`.
`randomInt(min, max)` takes two `int` values and returns `int`. Emission:
`Random.nextIntBetween(min, max, { halfOpen: true })`, after a check that
`max > min`; the check fails with a `RangeError` defect. The check is required:
Effect's default range is inclusive, and `nextIntBetween(5, 2, { halfOpen: true })`
returns a value with no error. Both names are `shadowable: true`. IR kinds
`random {}` and `random-int { min; max }`. Both need family code, because
`Random.next` is a value and `randomInt` needs the range check.

Verification: deterministic values under `Random.withSeed` in a slow test; the
half-open bound over many draws with a fixed seed; the defect for
`max <= min`; arity and type diagnostics; forged IR.

## SL3: `log` (item 16, SL-D3)

This section follows SL-D3 (a).

`log(message)` and `log(message, options)`. `message` is a `string` value of any
string type. `options` is a literal record with optional keys:

- `level`: a string literal, one of `"trace"`, `"debug"`, `"info"`, `"warn"`,
  `"error"` and `"fatal"`. The default is `"info"`.
- `fields`: a record literal. Each field value must be data by
  `dataOnly(table, ref, "value")` (`types.ts:1421`; the validator has its own
  copy in `validate/typing.ts`), the rule that `mapGroups` results use.

An unknown key, a duplicate key, a level outside the list, and a non-literal
`level` are diagnostics. The call has effect mode, returns `void`, and has no
failures and no requirements. The pipeline form is rejected (`direct`).

Emission: `Effect.logWithLevel("Warn")(message)`, wrapped in
`Effect.annotateLogs({ ... })` when `fields` is present. The host sets the
minimum level and the logger. The prelude entry is `shadowable: true`, so the
existing `log` exports keep working.

IR: new kind `log { message; level; fields: Expr | null }`.

Verification: a test logger (`Logger.make` in a slow test) records level,
message and annotations. `Logger.Options` has no annotations field
(`Logger.d.ts:81-87`), so the test logger reads
`options.fiber.getRef(References.CurrentLogAnnotations)`, and `message` arrives
as an array. Also check the default level; that a minimum level from
`References.MinimumLogLevel` drops a debug entry; that the shadowing fixtures
still compile; diagnostics for each rejected option; and forged IR for a wrong
level.

## SL4: the `Map` and `Set` types (item 22)

**Type syntax.** `Map<K, V>` and `Set<T>` are builtin type applications, like
`Option<T>`. `K` and `T` must be data by `dataOnly(table, ref, "value")`,
because `Equal` compares functions, Effects, Refs and Streams by reference. A
key type that is not data is a new `declaration` code. `V` can be any type.
`Map` keys may be records, unlike `mapGroups` keys, whose stricter key-class
rule exists because a group key becomes a Stream key in the target. `Equal`
and `Hash` compare and hash records by structure, so a record key is sound.
Both `dataOnly` copies switch on the type kind, so each gets `map` and `set`
cases.

**Type table and IR.** New type kinds `map { key; value }` and
`set { element }` in `ir.ts` `Type`, `types.ts`, `type_lower.ts`,
`type_ir.ts`, `type_show.ts`, `signatures.ts`, `validate/typing.ts`,
`validate/world.ts` and `validate/type_children.ts`. A `Map` fits another `Map`
when its key types are the same and its value type fits (keys are invariant,
values are covariant). This composes the existing rules: `Option` and arrays
are covariant, and `Ref` is invariant (`types.ts:1267-1278`). A `Set` fits when
its element type fits.

Every site that handles the `option` kind needs a decision for `map` and
`set`. Exhaustive switches report themselves. The others need the grep. The
validation found these non-exhaustive sites: `emit/scope.ts:693`
`containsFunction` (a `Map<K, () => T>` value must recurse), `emit/expr.ts`,
`check_expr.ts:2921` `containsOpaqueType`, `patterns.ts`, `check_patterns.ts`,
`check_builtins/stream.ts`, `validate/expr.ts`, `validate/families/codec.ts`,
`effect.ts`, `schema.ts` and `stream.ts`, `infer_inputs.ts:422`, and the
tests `types_test.ts`, `validate_type_paths_test.ts` and `validate_test.ts`.
The implementer runs `grep -rn '"option"' src` and classifies each site before
the change.

**Data and schemas.** A `Map` or `Set` of data is data. It may appear in a
record, a tagged record, an error field, an exported contract and a host
interface. Schema derivation uses `Schema.HashMap(key, value)` and
`Schema.HashSet(element)`, at the same sites as `Schema.Option`
(`emit/types.ts`, `emit/fields.ts`, `emit/decls.ts`). Inferred input contracts
(`infer_inputs.ts`) follow the `Option` cases.

The encoded side of these schemas is a `HashMap` or `HashSet`, as the encoded
side of `Schema.Option` is an `Option`. So `decode` on JSON input with an array
in a `Map` position fails, and `Schema.is` on an array is false. A host adapter
must build `HashMap` and `HashSet` values. Entry validation works and reports
the path of a bad entry. A conversion from JSON entry arrays is out of scope,
as it is for `Option`.

**Equality caveats.** `Hash.hash` caches the hash of each object
(`Hash.js:51`, `:94`), and `Equal.equals` caches the result of each outermost
pair (`Equal.js:71-80`). Emitted records are plain objects that the emitter
does not freeze. So host code must not change an object after it is a key.
`Equal` compares the key sets, so `{ a: 1 }` and `{ a: 1, b: undefined }` are
not equal. The implementer checks that source construction and schema decoding
both leave an absent optional field absent, and adds a test with an optional
field in a key.

**Emission.** `Map<K, V>` emits `HashMap.HashMap<K, V>` and `Set<T>` emits
`HashSet.HashSet<T>`. `EffectModule` gains `"HashMap"` and `"HashSet"`.

**Patterns and equality.** A `match` on a `Map` or `Set` subject is
`pattern/004`, as for other non-matchable types. `===` on two `Map` values is a
diagnostic, as for records.

Verification: each type rule; the key restriction; schema decode and encode of a
record with a `Map` field; a host provider that returns a `Set`; an exported
`Map` parameter with entry validation; strict target checks; forged IR for each
type rule.

## SL5: Map and Set operations (item 22, SL-D4, SL-D5)

This section follows SL-D4 (a) and SL-D5 (a). All operations are pure and
`direct`, and every name is `shadowable: true`.

| Operation | Contract | Emission |
| --- | --- | --- |
| `mapOf(entries)` | `entries` is a list of pairs `[K, V]`. Each inner two-element list literal is a pair, and the checker joins the key types and the value types separately, so `mapOf([["a", 1], ["b", 2]])` infers `Map<string, int>`. An expected `Map<K, V>` gives each pair its expected type. A later pair with an equal key replaces an earlier one. `mapOf([])` needs an expected type. The pair inference needs private `BodyChecker` members, so the row goes in `CORE_ROWS` and `CoreRowName`. The IR types the argument as an array of tuples, because strict TypeScript rejects an untyped `(string \| number)[][]` argument. | `HashMap.fromIterable` |
| `getMap(m, k)` | `Option<V>` | `HashMap.get` |
| `putMap(m, k, v)` | A new `Map<K, V>` | `HashMap.set` |
| `removeMap(m, k)` | A new `Map<K, V>` | `HashMap.remove` |
| `hasMap(m, k)` | `boolean` | `HashMap.has` |
| `entriesMap(m)` | `[K, V][]` in hash order | `HashMap.toEntries(m)`, which already returns an array |
| `setOf(items)` | `Set<T>` from a list | `HashSet.fromIterable` |
| `addSet(s, x)`, `removeSet(s, x)` | A new `Set<T>` | `HashSet.add`, `HashSet.remove` |
| `hasSet(s, x)` | `boolean` | `HashSet.has` |
| `itemsSet(s)` | `T[]` in hash order | `[...s]`, because `Array` is not a reserved target name and a user binding could shadow it |

The key argument of `getMap`, `putMap`, `removeMap` and `hasMap` must fit `K`.

The pure operations other than `mapOf` fit `OPERAND_CALLS`-style rows in
`emit/calls.ts`, so they need no family code. Every new kind also touches
`tables.ts`, `lower.ts`, `emit/shape.ts`, `emit/walk.ts`,
`validate/expr_walk.ts`, `tests/builtin_arity_test.ts` and
`tests/validate_expr_children_test.ts` (a synthetic node for each kind), as the
`scheduleCron` unit did.

Out of scope: `sizeMap` and `sizeSet`, and `union`, `intersection` and
`difference`. Arrays have no length operation either. A later selection can add
them.

Verification: each operation; structural keys (two equal records find one
entry); replacement by a later pair; the pair inference with and without an
expected type; `mapOf([])` without context (diagnostic); hash order is the
same for two maps with equal contents; arity and type diagnostics; forged IR
for each new kind.

## SL6: documentation and close

Update `docs/language-rules.md` (builtin tables, operator table, type rows, and
row 458, which says that `start` and `now` stay `number`), `docs/status.md`
(mark items 18 and 22 done, and mark item 16 as logging done and metrics
open), the spec, its grammar
and its examples in `../effektive/public/` (draft 0.68), and the website IR
model by hand. Run the site's strict checks. Move this plan to
`docs/archive/plans/` and update the registry.

## Validation

A Fable subagent validated the first draft on 2026-10-27 with compiler and
`effect@4.0.5` probes. It confirmed the evidence section: `TestClock` controls
`Clock.currentTimeMillis`, `Random.withSeed` is deterministic, structural key
lookup works for records, arrays, tuples and `Some`, and hash order is stable
for equal contents. The plan author accepted these corrections:

1. The `Instant` operator rule runs before `durationArithmetic` and before the
   shared-identity rule. Otherwise `Instant + Duration` is rejected and
   `Instant - Instant` types as `Instant`.
2. Comparisons of closed unit types need two values of the same type. This
   also closes `Duration < int`, which passes today.
3. One `CLOSED_UNIT_IDS` set replaces the closed-fit tests of `DURATION_ID`,
   with the full site list.
4. The publisher adopts the builtin `Instant`. A host service can return one,
   so the closed type does not force a rename.
5. The test logger reads annotations from the fiber, not from the logger
   options.
6. The data rule is `dataOnly(..., "value")`, and the plan says why `Map` keys
   may be records.
7. Host adapters build `HashMap` and `HashSet`, and JSON decoding into a `Map`
   is out of scope, as for `Option`.
8. `entriesMap` emits `HashMap.toEntries`, and `itemsSet` emits a spread.
9. Value-like leaves need family code. The plan names the stage files that each
   new kind touches.
10. `mapOf` goes in `CORE_ROWS`, and the IR types its argument as a tuple
    array.
11. The `option` site list is complete for SL4.
12. Equality caveats: cached hashes, unfrozen records, and absent versus
    `undefined` optional fields.
13. SL-D4 gets a hybrid option and a reason, and SL-D6 is new. Size and set
    algebra are out of scope.

## Order and gates

SL1 comes first, because SL2 reuses its leaf-kind pattern and the time
builtins share `EffectModule` edits. SL3 is independent. SL4 comes before SL5.
SL6 comes last. Each unit ends with `deno task check` and its own commit. A
change to an application fixture also runs that application's gate.
