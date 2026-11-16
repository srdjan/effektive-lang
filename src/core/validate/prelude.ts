// The declarations that the prelude gives to every module: the reserved
// errors SchemaError, TimeoutError, and SchemaIssue, and the untagged
// identities Duration and Instant. One table seeds the world of a module and
// answers whether an error identity is reserved.

import type {
  ErrorDecl,
  ErrorId,
  ModuleIR,
  Span,
  TypeDecl,
  TypeId,
} from "../ir.ts";
import {
  DURATION_ID,
  INSTANT_ID,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";

export type ReservedErrorId =
  | typeof SCHEMA_ERROR_ID
  | typeof SCHEMA_ISSUE_ID
  | typeof TIMEOUT_ERROR_ID;

/** The span of a declaration that has no source text. */
export function fallbackSpan(module: ModuleIR["module"]): Span {
  return { source: module, start: 0, end: 0 };
}

/** True for the errors that the runtime owns: no declaration can raise or hold them. */
export function isReservedError(
  id: TypeId | ErrorId,
): id is ReservedErrorId {
  return id === SCHEMA_ERROR_ID || id === SCHEMA_ISSUE_ID ||
    id === TIMEOUT_ERROR_ID;
}

/** The reserved errors in seeding order. */
export function preludeErrors(
  module: ModuleIR["module"],
): readonly ErrorDecl[] {
  const message = {
    name: "message",
    type: { kind: "primitive", name: "string" },
    optional: false,
  } as const;
  return [
    {
      kind: "error",
      id: SCHEMA_ERROR_ID,
      name: "SchemaError",
      fields: [message],
      span: fallbackSpan(module),
    },
    {
      kind: "error",
      id: TIMEOUT_ERROR_ID,
      name: "TimeoutError",
      fields: [message],
      span: fallbackSpan(module),
    },
    {
      kind: "error",
      id: SCHEMA_ISSUE_ID,
      name: "SchemaIssue",
      fields: [],
      span: fallbackSpan(module),
    },
  ];
}

/** `Duration` and `Instant` are the builtin untagged identities over `int`. */
export function preludeTypes(module: ModuleIR["module"]): readonly TypeDecl[] {
  function identity(
    id: TypeDecl["id"],
    name: TypeDecl["name"],
  ): TypeDecl {
    return {
      kind: "type",
      id: id,
      name: name,
      definition: {
        kind: "nominal",
        base: { kind: "primitive", name: "int" },
      },
      span: fallbackSpan(module),
    };
  }
  return [identity(DURATION_ID, "Duration"), identity(INSTANT_ID, "Instant")];
}
