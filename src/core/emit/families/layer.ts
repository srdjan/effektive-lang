// Emission of the layer builtins: a source layer and provide.
import { bracketed, type Doc } from "../doc.ts";
import { callArguments, type Emitted, plainEmitted } from "../emitted.ts";
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
    return internal("a source layer needs a checked service implementation");
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
      return internal(`the layer method ${method.name} is not a function`);
    }
    const names = method.type.parameters.map(() => c.scope.temp());
    const parameters = bracketed(
      "(",
      ")",
      names.map((
        name,
        i,
      ) => [
        name,
        ": ",
        typeDoc(c.scope, method.type.parameters[i], undefined),
      ]),
      false,
    );
    const invoke = plainEmitted([
      instance,
      ".",
      method.name,
      callArguments(
        names.map((name) => plainEmitted(name)),
      ),
    ]);
    const body = source.execution === "pure"
      ? plainEmitted([`${effect}.succeed`, callArguments([invoke])])
      : invoke;
    return [fieldKey(method.name), ": ", c.arrow(parameters, body, undefined)];
  });
  const assembled = c.objectLiteral(fields, []);
  const mapped = plainEmitted([
    `${effect}.map`,
    callArguments([
      c.suspended(e.acquire, undefined),
      plainEmitted(c.arrow(`(${instance})`, assembled, undefined)),
    ]),
  ]);
  return plainEmitted([
    `${layer}.effect`,
    callArguments([
      plainEmitted(c.scope.nameOf(e.service)),
      mapped,
    ]),
  ]);
}
export function layerLeaf(
  c: ExprCore,
  e: ExprOf<LayerLeafKind>,
  children: readonly Emitted[],
): Emitted {
  const effect = c.scope.effect("Effect");
  const operands = hoistedOperands([e.provider, e.job], children);
  const provider = operands[0];
  const hoisted = operands[1];
  const job = c.suspended(e.job, hoisted);
  return plainEmitted([
    `${effect}.provide`,
    callArguments([job, provider ?? c.pure(e.provider, undefined)]),
  ]);
}
