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
  {
    const kind_1 = type.kind;
    if (kind_1 === "primitive" || kind_1 === "literal") {
      return ids;
    } else if (kind_1 === "named") {
      ids = ids.add(type.id);
      return ids;
    } else if (kind_1 === "record") {
      for (const field of type.fields) {
        ids = referencedIds(field.type, ids);
      }
      return ids;
    } else if (kind_1 === "array" || kind_1 === "option" || kind_1 === "ref") {
      ids = referencedIds(type.element, ids);
      return ids;
    } else if (kind_1 === "retry-schedule") {
      ids = referencedIds(type.error, ids);
      return ids;
    } else if (kind_1 === "schema") {
      ids = referencedIds(type.decoded, ids);
      ids = referencedIds(type.encoded, ids);
      if (type.makeInput !== undefined) {
        ids = referencedIds(type.makeInput, ids);
      }
      ids = effectIds([], type.decodeRequirements, ids);
      ids = effectIds([], type.encodeRequirements, ids);
      return ids;
    } else if (kind_1 === "effect") {
      ids = referencedIds(type.result, ids);
      ids = effectIds(type.effects.failures, type.effects.requirements, ids);
      return ids;
    } else if (kind_1 === "stream") {
      ids = referencedIds(type.element, ids);
      ids = effectIds(type.effects.failures, type.effects.requirements, ids);
      return ids;
    } else if (kind_1 === "sink") {
      ids = referencedIds(type.input, ids);
      ids = referencedIds(type.result, ids);
      if (type.leftover !== undefined) {
        ids = referencedIds(type.leftover, ids);
      }
      ids = effectIds(type.effects.failures, type.effects.requirements, ids);
      return ids;
    } else if (kind_1 === "tuple") {
      for (const element of type.elements) {
        ids = referencedIds(element, ids);
      }
      return ids;
    } else if (kind_1 === "union") {
      for (const member of type.members) {
        ids = referencedIds(member, ids);
      }
      return ids;
    } else if (kind_1 === "function") {
      for (const parameter of type.parameters) {
        ids = referencedIds(parameter, ids);
      }
      ids = referencedIds(type.result, ids);
      ids = effectIds(type.effects.failures, type.effects.requirements, ids);
      return ids;
    } else if (kind_1 === "provider") {
      ids = effectIds([], type.provides, ids);
      ids = effectIds(
        type.acquisition.effects.failures,
        type.acquisition.effects.requirements,
        ids,
      );
      return ids;
    } else {
      {
        const unreachable: never = type;
        return unreachable;
      }
    }
  }
}
/** Adds the identities that the interface of a declaration mentions. */
export function declarationReferencedIds<Id extends string>(
  declaration: Declaration,
  ids: Set<Id | DeclarationId>,
): Set<Id | DeclarationId> {
  {
    const kind_2 = declaration.kind;
    if (kind_2 === "function" || kind_2 === "constant") {
      ids = referencedIds(declaration.type, ids);
      return ids;
    } else if (kind_2 === "type") {
      {
        const kind_3 = declaration.definition.kind;
        if (kind_3 === "alias") {
          ids = referencedIds(declaration.definition.type, ids);
          return ids;
        } else if (kind_3 === "nominal") {
          ids = referencedIds(declaration.definition.base, ids);
          return ids;
        }
      }
      return ids;
    } else if (kind_2 === "error") {
      for (const field of declaration.fields) {
        ids = referencedIds(field.type, ids);
      }
      return ids;
    } else if (kind_2 === "service") {
      for (const method of declaration.methods) {
        ids = referencedIds(method.type, ids);
      }
      return ids;
    } else {
      {
        const unreachable: never = declaration;
        return unreachable;
      }
    }
  }
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
