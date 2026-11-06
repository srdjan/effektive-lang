// Mutable reference construction, reads, writes and update callbacks.
// Prelude dispatch checks arity and records facts before this handler runs.

import type { NodeId } from "../syntax.ts";
import { combine, EFFECT_ONLY } from "../effect_set.ts";
import type { NodeInfo } from "../tables.ts";
import type { TypeRef } from "../types.ts";
import type { Arg, BuiltinContext } from "./context.ts";
import { direct, type PreludeCallName, type Rows } from "./rows.ts";

type RefName = "getRef" | "setRef" | "updateRef";

/** The first argument of a Ref operation, and the element type of the Ref that it must be. */
function refArgument(
  c: BuiltinContext,
  name: RefName,
  args: readonly Arg[],
): { readonly first: NodeInfo; readonly element: TypeRef } {
  const first = c.argInfo(args[0]);
  const ref = c.table.node(c.table.unfold(first.type));
  if (ref.kind !== "ref" && !c.isError(first.type)) {
    c.report(
      "type-mismatch/010",
      `\`${name}\` needs a Ref value`,
      args[0].node,
    );
  }
  return { first, element: ref.kind === "ref" ? ref.element : c.table.error };
}

function makeRefCall(
  c: BuiltinContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const first = c.argInfo(args[0]);
  return c.finish(
    node,
    c.table.ref(c.widen(first.type)),
    combine([first, EFFECT_ONLY]),
  );
}

function getRefCall(
  c: BuiltinContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { first, element } = refArgument(c, "getRef", args);
  return c.finish(node, element, combine([first, EFFECT_ONLY]));
}

function setRefCall(
  c: BuiltinContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { first, element } = refArgument(c, "setRef", args);
  const value = c.argInfo(args[1], element);
  c.fits(args[1].node, value.type, element, "the new Ref value");
  return c.finish(
    node,
    c.table.unit,
    combine([first, value, EFFECT_ONLY]),
  );
}

function updateRefCall(
  c: BuiltinContext,
  node: NodeId,
  args: readonly Arg[],
): NodeInfo {
  const { first, element } = refArgument(c, "updateRef", args);
  const transform = c.callback("updateRef", args[1], [element], element, true);
  c.fits(args[1].node, transform.result, element, "the updated Ref value");
  // An effectful callback runs inside the update, so the call takes its
  // failures and requirements.
  const fn = c.functionOf(transform.info.type);
  return c.finish(
    node,
    c.table.unit,
    combine([first, transform.info, EFFECT_ONLY, {
      mode: "pure",
      failures: fn?.failures ?? [],
      requirements: fn?.requirements ?? [],
    }]),
  );
}

export const REF_ROWS = {
  makeRef: {
    prologue: direct(1, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => makeRefCall(c, node, args),
  },
  getRef: {
    prologue: direct(1, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => getRefCall(c, node, args),
  },
  setRef: {
    prologue: direct(2, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => setRefCall(c, node, args),
  },
  updateRef: {
    prologue: direct(2, "effect", { fact: "key" }),
    handle: (c, node, _name, args) => updateRefCall(c, node, args),
  },
} satisfies Partial<Rows<PreludeCallName, BuiltinContext>>;
