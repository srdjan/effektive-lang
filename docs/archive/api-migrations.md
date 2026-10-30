# API migrations

These notes moved from [the API reference](../api.md).

## Migrating the frontend and TypeScript APIs

The package exposes `@srdjan/effektive-lang/frontend` and
`@srdjan/effektive-lang/typescript`; the root export aggregates both.
Source-only tools can import the frontend without loading the TypeScript emitter.

Replace `revision.emitted(name)` with `outputs.emitted(revision, name)` (and
likewise for `spanTable` and `sourceMap`). Create `const outputs = new
TypeScriptOutputs()` once per program or session, rather than per query.
The CLI, playground and LSP each own their caches; the LSP disk program owns a
separate cache created on its first save round. `program.counts` contains parses,
checks and lowerings; `outputs.counts` contains emits. LSP statistics compose both.

`sourceHoverAt(revision, path, offset)` returns `{ span, contract, declaration }`
without lowering or emission. `declaration` is optional declaration identity on
module function/constant names. For the existing combined source/backend result,
call `hoverAt(revision, path, offset, outputs)`. Its backend type remains unavailable
when the module cannot emit. `emitModule(ir, context)` remains the standalone IR
consumer; `emitProject` lives in the TypeScript entry point. `SourceEdit` now
belongs to source data and retains its public export.

```ts
import { Program, sourceHoverAt } from "@srdjan/effektive-lang/frontend";
import { hoverAt, TypeScriptOutputs } from "@srdjan/effektive-lang/typescript";

const program = new Program();
const outputs = new TypeScriptOutputs();
const updated = program.update({ set: files });
if (updated.ok) {
  const revision = updated.value;
  sourceHoverAt(revision, "main.eff", offset);
  outputs.emitted(revision, "main");
  hoverAt(revision, "main.eff", offset, outputs);
}
```

Here `files` contains project texts and `offset` is a UTF-16 source offset.

IR v4 removes `with-resource.useBinding`, `with-resource.releaseBinding`,
`with-fiber.useBinding`, and `map-groups.groupBinding`. Read the identity from
`use.parameters[0].id`, `release.parameters[0].id`, or, for grouped streams,
`use.parameters[1].id`. These slots use the exported `ClosureExpr` type; runtime
validation still checks closure shape, arity, parameter types, references and
borrowed uses. Older wire versions receive `validation/008`; there is no automatic
conversion. IR v5 adds the flag `tagged` on a `nominal` definition. Schedule
compositions and schema decode/encode/make now discriminate as individual
TypeScript union members, with the same serialized node shapes.

Bare single-parameter lambdas use the existing `ArrowExpr`, `ParamList`, and
`Param` source nodes. Their lossless tree contains only the tokens that were
written; the omitted parentheses are not synthesized.

`OptionFallbackExpr` represents source `??`. Checking records its result,
effects, and hygienic Some binding. Lowering emits ordinary `match` with a
single subject and lazy None arm, so standalone IR consumers need no new node.

Block-local `RecordBinding` nodes contain `BindingField` aliases or
`ShorthandBinding` fields. Checking records ordinary field reads and a hygienic
subject capture; lowering expands into existing block binds and `get` nodes.

`UsingExpr` contains one source binding and three `ResourceAcquire`,
`ResourceUse`, and `ResourceRelease` regions. They share the existing callback
body checker and resource rules. Editor references and rename use one identity
across use/finalization; completion exposes it only in those regions. Lowering
remaps references to separate closure parameters and emits `with-resource` IR.

The type `NodeFact` merges the members `brand-construction` and `data-construction`
into `identity-construction`, which holds the field `identity`. The pattern fact
kind `data` is now `tagged`, and its field `data` is now `tagged`. The type
`TypeReader` renames the methods `brandBaseOf` and `dataRecordOf` to
`identityBaseOf` and `taggedRecordOf`. The IR is unchanged.

## Input contracts in IR version 6

IR version 6 adds `TypeDecl.predicate` and `FunctionType.checked`.
Function parameter types carry finalized body contracts.
A true checked flag permits raw unknown input and requires generated entry validation.
`FunctionDecl.entryValidation` lists checked parameter identities in declaration order.
`Annotation.proofs` carries target identities and independently checked certificates.
Older wire versions receive `validation/008` without conversion.

## IR version 7

IR version 7 adds the expression kinds `timeout`, `sleep`, `repeat`, `uninterruptible`,
`ensure`, `race-all`, `schedule-exponential` and `schedule-jittered`.
The `catch` node has an optional `defect` handler of the type `DefectHandler`.
A `with-resource` release closure has one or two parameters.
The constants `TIMEOUT_ERROR_ID` and `DURATION_ID` name the builtin error `TimeoutError`
and the builtin type `Duration`. A duration is a `nominal` node over a millisecond number.
IR field names such as `durationMs` and `delayMillis` keep their names. Only source names changed.
The [effect surface plan](plans/2026-10-27-effect-surface.md) gives the reasons.
