// The declarations that the prelude gives to every module: the reserved
// errors SchemaError, TimeoutError, and SchemaIssue, and the untagged
// identities Duration and Instant. One table seeds the world of a module and
// answers whether an error identity is reserved.

import type { ErrorDecl, Span, TypeDecl } from "../ir.ts";
import {
  DURATION_ID,
  INSTANT_ID,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  TIMEOUT_ERROR_ID,
} from "../ir.ts";

/** The span of a declaration that has no source text. */
export function fallbackSpan(module: string): Span {
  return { source: module, start: 0, end: 0 };
}

/** True for the errors that the runtime owns: no declaration can raise or hold them. */
export function isReservedError(id: string): boolean {
  return id === SCHEMA_ERROR_ID || id === SCHEMA_ISSUE_ID ||
    id === TIMEOUT_ERROR_ID;
}

/** The reserved errors in seeding order. */
export function preludeErrors(module: string): readonly ErrorDecl[] {
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
export function preludeTypes(module: string): readonly TypeDecl[] {
  const identity = (id: TypeDecl["id"], name: string): TypeDecl => ({
    kind: "type",
    id,
    name,
    definition: { kind: "nominal", base: { kind: "primitive", name: "int" } },
    span: fallbackSpan(module),
  });
  return [identity(DURATION_ID, "Duration"), identity(INSTANT_ID, "Instant")];
}
