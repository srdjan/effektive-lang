// Emission of the layer builtins: a source layer and provide.

import { bracketed, type Doc } from "../doc.ts";
import { callArguments, type Emitted, emitted } from "../emitted.ts";
import { fieldKey } from "../fields.ts";
import { internal } from "../failure.ts";
import { type ExprOf, hoistedOperands, type LeafOf } from "../shape.ts";
import { typeDoc } from "../types.ts";
import type { ExprCore } from "./context.ts";

type LayerStructuralKind = "layer";

type LayerLeafKind = LeafOf<"provide">;

export function layerStructural(
  c: ExprCore,
  e: ExprOf<LayerStructuralKind>,
): Emitted {
  const declaration = c.scope.typeLevelDeclaration(e.service);
  const acquire = c.functionTypeOf(e.acquire.type);
  const implementation = acquire === undefined
    ? undefined
    : c.scope.resolve(acquire.result);
  if (declaration?.kind !== "service" || implementation?.kind !== "record") {
    throw internal("a source layer needs a checked service implementation");
  }
  const effect = c.scope.effect("Effect");
  const layer = c.scope.effect("Layer");
  const instance = c.scope.temp();
  const fields: Doc[] = declaration.methods.map((method) => {
    const field = implementation.fields.find((f) => f.name === method.name);
    const source = field === undefined
      ? undefined
      : c.scope.resolve(field.type);
    if (source?.kind !== "function") {
      throw internal(`the layer method ${method.name} is not a function`);
    }
    const names = method.type.parameters.map(() => c.scope.temp());
    const parameters = bracketed(
      "(",
      ")",
      names.map((
        name,
        i,
      ) => [name, ": ", typeDoc(c.scope, method.type.parameters[i])]),
      false,
    );
    const invoke = emitted([
      instance,
      ".",
      method.name,
      callArguments(names.map((name) => emitted(name))),
    ]);
    const body = source.execution === "pure"
      ? emitted([`${effect}.succeed`, callArguments([invoke])])
      : invoke;
    return [fieldKey(method.name), ": ", c.arrow(parameters, body)];
  });
  const assembled = c.objectLiteral(fields, []);
  const mapped = emitted([
    `${effect}.map`,
    callArguments([
      c.suspended(e.acquire),
      emitted(c.arrow(`(${instance})`, assembled)),
    ]),
  ]);
  return emitted([
    `${layer}.effect`,
    callArguments([emitted(c.scope.nameOf(e.service)), mapped]),
  ]);
}

export function layerLeaf(
  c: ExprCore,
  e: ExprOf<LayerLeafKind>,
  children: readonly Emitted[],
): Emitted {
  const effect = c.scope.effect("Effect");
  const [provider, hoisted] = hoistedOperands([e.provider, e.job], children);
  const job = c.suspended(e.job, hoisted);
  return emitted([
    `${effect}.provide`,
    callArguments([job, provider ?? c.pure(e.provider)]),
  ]);
}
