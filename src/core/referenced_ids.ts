// The identities that an IR type mentions. A leaf module: it reads only IR types.
import type {
  CapabilityId,
  Declaration,
  DeclarationId,
  ErrorId,
  Type,
} from "./ir.ts";
import { serviceOfCapability } from "./ids.ts";
/** Adds the type and error identities that an IR type mentions, and the services of its capabilities. */
export function referencedIds<Id extends string>(
  type: Type,
  ids: Set<Id | DeclarationId>,
): Set<Id | DeclarationId> {
  if (type.kind === "primitive" || type.kind === "literal") {
    return ids;
  }
  if (type.kind === "named") {
    ids = ids.add(type.id);
    return ids;
  }
  if (type.kind === "record") {
    for (const field of type.fields) {
      ids = referencedIds(field.type, ids);
    }
    return ids;
  }
  if (type.kind === "array" || type.kind === "option" || type.kind === "ref") {
    ids = referencedIds(type.element, ids);
    return ids;
  }
  if (type.kind === "retry-schedule") {
    ids = referencedIds(type.error, ids);
    return ids;
  }
  if (type.kind === "schema") {
    ids = referencedIds(type.decoded, ids);
    ids = referencedIds(type.encoded, ids);
    if (type.makeInput !== undefined) {
      ids = referencedIds(type.makeInput, ids);
    }
    ids = effectIds([], type.decodeRequirements, ids);
    ids = effectIds([], type.encodeRequirements, ids);
    return ids;
  }
  if (type.kind === "effect") {
    ids = referencedIds(type.result, ids);
    ids = effectIds(type.effects.failures, type.effects.requirements, ids);
    return ids;
  }
  if (type.kind === "stream") {
    ids = referencedIds(type.element, ids);
    ids = effectIds(type.effects.failures, type.effects.requirements, ids);
    return ids;
  }
  if (type.kind === "sink") {
    ids = referencedIds(type.input, ids);
    ids = referencedIds(type.result, ids);
    if (type.leftover !== undefined) {
      ids = referencedIds(type.leftover, ids);
    }
    ids = effectIds(type.effects.failures, type.effects.requirements, ids);
    return ids;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      ids = referencedIds(element, ids);
    }
    return ids;
  }
  if (type.kind === "union") {
    for (const member of type.members) {
      ids = referencedIds(member, ids);
    }
    return ids;
  }
  if (type.kind === "function") {
    for (const parameter of type.parameters) {
      ids = referencedIds(parameter, ids);
    }
    ids = referencedIds(type.result, ids);
    ids = effectIds(type.effects.failures, type.effects.requirements, ids);
    return ids;
  }
  if (type.kind === "provider") {
    ids = effectIds([], type.provides, ids);
    ids = effectIds(
      type.acquisition.effects.failures,
      type.acquisition.effects.requirements,
      ids,
    );
    return ids;
  }
  const unreachable: never = type;
  return unreachable;
}
/** Adds the identities that the interface of a declaration mentions. */
export function declarationReferencedIds<Id extends string>(
  declaration: Declaration,
  ids: Set<Id | DeclarationId>,
): Set<Id | DeclarationId> {
  if (declaration.kind === "function" || declaration.kind === "constant") {
    ids = referencedIds(declaration.type, ids);
    return ids;
  }
  if (declaration.kind === "type") {
    {
      const kind_3 = declaration.definition.kind;
      if (kind_3 === "alias") {
        ids = referencedIds(declaration.definition.type, ids);
        return ids;
      }
      if (kind_3 === "nominal") {
        ids = referencedIds(declaration.definition.base, ids);
        return ids;
      }
    }
    return ids;
  }
  if (declaration.kind === "error") {
    for (const field of declaration.fields) {
      ids = referencedIds(field.type, ids);
    }
    return ids;
  }
  if (declaration.kind === "service") {
    for (const method of declaration.methods) {
      ids = referencedIds(method.type, ids);
    }
    return ids;
  }
  const unreachable: never = declaration;
  return unreachable;
}
/** Adds failure identities and the services of capabilities. */
export function effectIds<Id extends string>(
  failures: readonly ErrorId[],
  capabilities: readonly CapabilityId[],
  ids: Set<Id | DeclarationId>,
): Set<Id | DeclarationId> {
  for (const failure of failures) {
    ids = ids.add(failure);
  }
  for (const capability of capabilities) {
    const service = serviceOfCapability(capability);
    if (service !== undefined) {
      ids = ids.add(service);
    }
  }
  return ids;
}
