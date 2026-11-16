// The family rows of the prelude builtins. A new builtin in an existing family
// adds its row to that family file, so the body checker does not change. The
// body checker checks the option constructors, which have no family row.

import { type CollectionContext, collectionRows } from "./collections.ts";
import { type DataContext, dataRows } from "./data.ts";
import { type EffectContext, effectRows } from "./effect.ts";
import { type LayerContext, layerRows } from "./layer.ts";
import { refRows } from "./ref.ts";
import type { PreludeCallName, Rows } from "./rows.ts";
import { type SchemaContext, schemaRows } from "./schema.ts";
import { type ScopeContext, scopeRows } from "./scope.ts";
import { type StreamContext, streamRows } from "./stream.ts";

/** Every operation that a family handler or prologue reads from the checker. */
type FamilyContext =
  & CollectionContext
  & DataContext
  & EffectContext
  & LayerContext
  & ScopeContext
  & StreamContext
  & SchemaContext;

export type FamilyRowTables = {
  readonly collections: ReturnType<typeof collectionRows>;
  readonly data: ReturnType<typeof dataRows>;
  readonly effect: ReturnType<typeof effectRows>;
  readonly layer: ReturnType<typeof layerRows>;
  readonly ref: ReturnType<typeof refRows>;
  readonly schema: ReturnType<typeof schemaRows>;
  readonly scope: ReturnType<typeof scopeRows>;
  readonly stream: ReturnType<typeof streamRows>;
};

/** Creates the family row tables for the test of their key sets. */
export function familyRowTables(): FamilyRowTables {
  return {
    collections: collectionRows(),
    data: dataRows(),
    effect: effectRows(),
    layer: layerRows(),
    ref: refRows(),
    schema: schemaRows(),
    scope: scopeRows(),
    stream: streamRows(),
  };
}

/** Creates one row for every prelude call name. */
export function createFamilyRows(): Rows<PreludeCallName, FamilyContext> {
  const collections = collectionRows();
  const data = dataRows();
  const effect = effectRows();
  const layer = layerRows();
  const ref = refRows();
  const schema = schemaRows();
  const scope = scopeRows();
  const stream = streamRows();
  return {
    all: collections.all,
    traverse: collections.traverse,
    map: collections.map,
    sort: collections.sort,
    filter: collections.filter,
    fold: collections.fold,
    div: data.div,
    trunc: data.trunc,
    floor: data.floor,
    round: data.round,
    ceil: data.ceil,
    text: data.text,
    len: data.len,
    at: data.at,
    fail: effect.fail,
    retry: effect.retry,
    repeat: effect.repeat,
    retrySchedule: effect.retrySchedule,
    timeout: effect.timeout,
    uninterruptible: effect.uninterruptible,
    now: effect.now,
    log: effect.log,
    random: effect.random,
    randomInt: effect.randomInt,
    sleep: effect.sleep,
    defer: effect.defer,
    run: effect.run,
    race: effect.race,
    provide: layer.provide,
    layer: layer.layer,
    mergeLayers: layer.mergeLayers,
    makeRef: ref.makeRef,
    getRef: ref.getRef,
    setRef: ref.setRef,
    updateRef: ref.updateRef,
    schema: schema.schema,
    schemaArray: schema.schemaArray,
    schemaStruct: schema.schemaStruct,
    schemaOptionalKey: schema.schemaOptionalKey,
    schemaNullToMissingKey: schema.schemaNullToMissingKey,
    schemaOptionFromOptionalKey: schema.schemaOptionFromOptionalKey,
    schemaDefaultKey: schema.schemaDefaultKey,
    schemaConstructorDefault: schema.schemaConstructorDefault,
    schemaOptionalTransform: schema.schemaOptionalTransform,
    schemaOptionalFromRequired: schema.schemaOptionalFromRequired,
    schemaUnion: schema.schemaUnion,
    schemaTransform: schema.schemaTransform,
    schemaRecursive: schema.schemaRecursive,
    schemaDecode: schema.schemaDecode,
    schemaEncode: schema.schemaEncode,
    schemaMake: schema.schemaMake,
    scoped: scope.scoped,
    forkScoped: scope.forkScoped,
    unfold: stream.unfold,
    mapEffect: stream.mapEffect,
    sinkForEach: stream.sinkForEach,
    takeSink: stream.takeSink,
    transduceStream: stream.transduceStream,
    runStream: stream.runStream,
    bufferStream: stream.bufferStream,
  };
}
