// Scope operations, resource lifetimes and opaque borrowed parameters.
import type { TypeEnv } from "../signatures.ts";
import { isTypeId, serviceOfCapability } from "../ids.ts";
import {
  type ErrorId,
  type LocalId,
  SCOPE_CAPABILITY,
  type ServiceId,
  type ValueId,
} from "../ir.ts";
import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import { combine, EFFECT_ONLY, without } from "../effect_set.ts";
import type { NodeInfo } from "../tables.ts";
import { dataOnly, type TypeRef } from "../types.ts";
import {
  type Arg,
  type BuiltinContext,
  type FactView,
  invocationOf,
  type LocalUseView,
  type ResolveView,
  type SyntaxView,
} from "./context.ts";
import { piped, type PreludeCallName, type Rows } from "./rows.ts";

export interface ScopeContext extends
  Pick<
    BuiltinContext,
    | "table"
    | "argInfo"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "report"
  >,
  SyntaxView,
  ResolveView,
  FactView,
  LocalUseView {
  readonly services: Pick<TypeEnv["services"], "get">;
  valueType(id: ValueId): TypeRef;
}

function scopedCall(
  c: ScopeContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const value = c.argInfo(args[0]);
  const effect = c.table.node(c.table.unfold(value.type));
  if (effect.kind !== "effect") {
    c.report(
      "type-mismatch/010",
      "`scoped` needs an Effect value",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([value, EFFECT_ONLY]));
  }
  return c.finish(
    node,
    effect.result,
    combine([value, {
      failures: effect.failures,
      requirements: without(effect.requirements, [SCOPE_CAPABILITY]),
      mode: "effect",
    }]),
  );
}

function forkScopedCall(
  c: ScopeContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const job = c.argInfo(args[0]);
  const effect = c.table.node(c.table.unfold(job.type));
  if (effect.kind !== "effect") {
    c.report(
      "type-mismatch/010",
      "`forkScoped` needs an Effect value",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([job, EFFECT_ONLY]));
  }
  if (effect.failures.length > 0) {
    c.report(
      "type-mismatch/010",
      "`forkScoped` needs an Effect value without typed failures",
      args[0].node,
    );
  }
  return c.finish(
    node,
    c.table.unit,
    combine([job, {
      failures: [],
      requirements: [...effect.requirements, SCOPE_CAPABILITY],
      mode: "effect",
    }]),
  );
}

/**
 * The type of an outcome binding: a structural tagged union. The Failure
 * member is absent when no failure remains.
 */
export function outcomeType(
  table: ScopeContext["table"],
  result: TypeRef,
  failures: readonly ErrorId[],
): TypeRef {
  const member = (tag: string, field?: { name: string; type: TypeRef }) =>
    table.record([
      { name: "_tag", type: table.literal(tag), optional: false },
      ...(field === undefined ? [] : [{ ...field, optional: false }]),
    ]);
  return table.union([
    member("Success", { name: "success", type: result }),
    ...(failures.length === 0 ? [] : [member("Failure", {
      name: "failure",
      type: table.union(failures.map((id) => table.named(id))),
    })]),
    member("Defect", { name: "message", type: table.string }),
    member("Interrupted"),
  ]);
}

/** Whether the written release clause binds the outcome of the use block. */
function releaseWantsOutcome(c: ScopeContext, arg: Arg): boolean {
  return c.kids(arg.node).some((k) => kindOf(c.tree, k) === SyntaxKind.Name);
}

export function withResourceCall(
  c: ScopeContext,
  node: NodeId,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  const acquire = c.callback("using", args[0], [], undefined, true);
  const opaque = opaqueHandle(c, acquire.result);
  if (!opaque) {
    operationRecord(c, acquire.result, args[0].node);
  }
  const use = c.callback(
    "using",
    args[1],
    [acquire.result],
    expected,
    true,
  );
  const useFailures = c.functionOf(use.info.type)?.failures ?? [];
  const release = c.callback(
    "using",
    args[2],
    releaseWantsOutcome(c, args[2])
      ? [acquire.result, outcomeType(c.table, use.result, useFailures)]
      : [acquire.result],
    c.table.unit,
    true,
  );
  c.fits(args[2].node, release.result, c.table.unit, "the release result");
  if (!dataOnly(c.table, use.result, "value")) {
    c.report(
      "type-mismatch/010",
      "the use result must be data only",
      args[1].node,
    );
  }
  for (const arg of [args[1], args[2]]) {
    const fact = c.facts.get(arg.node);
    if (fact?.kind === "arrow" && fact.parameters[0]?.id !== undefined) {
      const body = c.kids(arg.node).at(-1);
      if (body !== undefined) {
        if (opaque) {
          scopedBorrowUses(c, body, fact.parameters[0].id);
        } else {
          scopedUses(c, body, fact.parameters[0].id);
        }
      }
    }
  }
  const invoked = [acquire.info, use.info, release.info].map((info) => {
    const fn = c.functionOf(info.type);
    return invocationOf(fn);
  });
  return c.finish(
    node,
    use.result,
    combine([
      acquire.info,
      use.info,
      release.info,
      ...invoked,
      EFFECT_ONLY,
    ]),
  );
}

export function checkBorrowedParameter(
  c: ScopeContext,
  body: NodeId | undefined,
  parameter: {
    readonly id: LocalId | undefined;
    readonly type: {
      readonly ref: TypeRef;
    };
  },
  result: TypeRef,
): void {
  if (parameter.id === undefined) {
    return;
  }
  if (!opaqueHandle(c, parameter.type.ref)) {
    c.report(
      "type-mismatch/010",
      "a borrow parameter needs an opaque type",
      body ?? c.tree.root,
    );
  }
  if (!dataOnly(c.table, result, "value")) {
    c.report(
      "type-mismatch/010",
      "a borrow function must return data only",
      body ?? c.tree.root,
    );
  }
  if (body !== undefined) {
    scopedBorrowUses(c, body, parameter.id);
  }
}

function scopedUses(c: ScopeContext, body: NodeId, id: LocalId): void {
  for (const { node, parent, grandparent, nested } of c.localUses(body, id)) {
    const directField = parent !== undefined &&
      kindOf(c.tree, parent) === SyntaxKind.FieldExpr &&
      c.kids(parent)[0] === node;
    const directCall = grandparent !== undefined &&
      kindOf(c.tree, grandparent) === SyntaxKind.CallExpr &&
      c.kids(grandparent)[0] === parent;
    if (nested || !directField || !directCall) {
      c.report(
        "type-mismatch/010",
        "a scoped operation record may only be used as the direct receiver of an operation call",
        node,
      );
    }
  }
}

function operationRecord(c: ScopeContext, ref: TypeRef, node: NodeId): boolean {
  const type = c.table.node(c.table.unfold(ref));
  if (
    type.kind !== "record" || type.fields.length === 0 ||
    type.fields.some((f) => f.optional)
  ) {
    c.report(
      "type-mismatch/010",
      "acquisition must return a nonempty record of required operations",
      node,
    );
    return false;
  }
  let valid = true;
  for (const field of type.fields) {
    const fn = c.functionOf(field.type);
    if (
      fn === undefined || !fn.parameters.every((p) =>
        dataOnly(c.table, p, "value")
      ) ||
      !dataOnly(c.table, fn.result, "value")
    ) {
      c.report(
        "type-mismatch/010",
        `operation ${field.name} must take and return data-only values`,
        node,
      );
      valid = false;
    }
  }
  return valid;
}

function opaqueHandle(c: ScopeContext, ref: TypeRef): boolean {
  const type = c.table.node(c.table.unfold(ref));
  return type.kind === "named" && isTypeId(type.id) &&
    c.table.isOpaque(type.id);
}

function scopedBorrowUses(c: ScopeContext, body: NodeId, id: LocalId): void {
  for (const { node, parent, grandparent, nested } of c.localUses(body, id)) {
    const call = parent !== undefined &&
        kindOf(c.tree, parent) === SyntaxKind.ArgList &&
        grandparent !== undefined &&
        kindOf(c.tree, grandparent) === SyntaxKind.CallExpr
      ? grandparent
      : undefined;
    const callee = call === undefined ? undefined : c.kids(call)[0];
    const method = callee === undefined ? undefined : c.targets.get(callee);
    const index = parent === undefined ? -1 : c.kids(parent).indexOf(node);
    const capability = method?.kind === "cap" ? method.id : undefined;
    const serviceId: ServiceId | undefined = capability === undefined
      ? undefined
      : serviceOfCapability(capability);
    const signature = serviceId === undefined
      ? undefined
      : c.services.get(serviceId)?.methods.find((m) => m.id === capability);
    const functionType = method?.kind === "value"
      ? c.functionOf(c.valueType(method.id))
      : undefined;
    const borrowed = signature?.borrows?.[index] === true ||
      functionType?.borrows?.[index] === true;
    if (nested || index < 0 || !borrowed) {
      c.report(
        "type-mismatch/010",
        "a borrowed handle may only pass to a borrow-qualified method",
        node,
      );
    }
  }
}

export const SCOPE_ROWS = {
  scoped: {
    prologue: piped(1, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => scopedCall(c, node, args),
  },
  forkScoped: {
    prologue: piped(1, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => forkScopedCall(c, node, args),
  },
} satisfies Partial<Rows<PreludeCallName, ScopeContext>>;
