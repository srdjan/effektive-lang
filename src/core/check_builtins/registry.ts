// The family rows of the prelude builtins. A new builtin in an existing family
// adds its row to that family file, so the body checker does not change. The
// body checker checks the option constructors, which have no family row.

import type { BuiltinContext } from "./context.ts";
import { COLLECTION_ROWS, type CollectionContext } from "./collections.ts";
import { EFFECT_ROWS, type EffectContext } from "./effect.ts";
import { LAYER_ROWS, type LayerContext } from "./layer.ts";
import { REF_ROWS } from "./ref.ts";
import type { PreludeCallName, Rows } from "./rows.ts";
import { SCHEMA_ROWS, type SchemaContext } from "./schema.ts";
import { SCOPE_ROWS, type ScopeContext } from "./scope.ts";
import { STREAM_ROWS, type StreamContext } from "./stream.ts";

/** Every operation that a family handler or prologue reads from the checker. */
type FamilyContext =
  & BuiltinContext
  & CollectionContext
  & EffectContext
  & LayerContext
  & ScopeContext
  & StreamContext
  & SchemaContext;

/** The family row tables by family name, for the test of the key sets. */
export const FAMILY_ROW_TABLES = {
  collections: COLLECTION_ROWS,
  effect: EFFECT_ROWS,
  layer: LAYER_ROWS,
  ref: REF_ROWS,
  schema: SCHEMA_ROWS,
  scope: SCOPE_ROWS,
  stream: STREAM_ROWS,
} as const;

// A type annotation keeps the generic index of `preludeCall` valid. A
// `satisfies` clause on this table breaks it.
export const FAMILY_ROWS: Rows<PreludeCallName, FamilyContext> = {
  ...COLLECTION_ROWS,
  ...EFFECT_ROWS,
  ...LAYER_ROWS,
  ...REF_ROWS,
  ...SCHEMA_ROWS,
  ...SCOPE_ROWS,
  ...STREAM_ROWS,
};
