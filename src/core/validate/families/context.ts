// The validator-owned context of the builtin families. The families use this
// context and never import `expr.ts`.

import type { Expr, Span, Type } from "../../ir.ts";
import type { AreaCode } from "../report.ts";
import type { Comp, Out } from "../results.ts";
import {
  type asFunction,
  BOOLEAN,
  INT,
  NUMBER,
  STRING,
  type TypeEnv,
  unfold,
} from "../typing.ts";
import type { Ctx } from "../world_table.ts";

/**
 * The operations that the builtin families use from the body validator. The
 * validator owns the checks of the child nodes and the report.
 */
export interface ValidatorCore {
  readonly env: TypeEnv;
  readonly ctx: Ctx;
  add(area: AreaCode, path: string, what: string, span: Span): void;
  check(e: Expr, path: string): Out;
  poison(): Comp;
  checkConcurrency(
    e: {
      readonly concurrency: number | "unbounded" | undefined;
      readonly span: Span;
    },
    path: string,
    name: string,
  ): void;
  jobFunction(
    job: Out,
    path: string,
    span: Span,
    what: string,
  ): ReturnType<typeof asFunction>;
}

/** The type that a mutable state keeps for a stored value: a literal widens to its primitive. */
export function streamState(env: TypeEnv, type: Type): Type {
  const value = unfold(env, type);
  if (value.kind !== "literal" || value.value === null) return type;
  return typeof value.value === "string"
    ? STRING
    : typeof value.value === "boolean"
    ? BOOLEAN
    : Number.isSafeInteger(value.value)
    ? INT
    : NUMBER;
}
