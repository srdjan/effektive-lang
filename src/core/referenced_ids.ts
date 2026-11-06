// The identities that an IR type mentions. A leaf module: it reads only IR types.

import type { CapabilityId, ErrorId, Type } from "./ir.ts";
import { serviceOfCapability } from "./ids.ts";

/** Adds the type and error identities that an IR type mentions, and the services of its capabilities. */
export function referencedIds(type: Type, ids: Set<string>): void {
  switch (type.kind) {
    case "primitive":
    case "literal":
      return;
    case "named":
      ids.add(type.id);
      return;
    case "record":
      for (const field of type.fields) referencedIds(field.type, ids);
      return;
    case "array":
    case "option":
    case "ref":
      referencedIds(type.element, ids);
      return;
    case "retry-schedule":
      referencedIds(type.error, ids);
      return;
    case "schema":
      referencedIds(type.decoded, ids);
      referencedIds(type.encoded, ids);
      if (type.makeInput !== undefined) referencedIds(type.makeInput, ids);
      effectIds([], type.decodeRequirements, ids);
      effectIds([], type.encodeRequirements, ids);
      return;
    case "effect":
      referencedIds(type.result, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "stream":
      referencedIds(type.element, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "sink":
      referencedIds(type.input, ids);
      referencedIds(type.result, ids);
      if (type.leftover !== undefined) referencedIds(type.leftover, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "tuple":
      for (const element of type.elements) referencedIds(element, ids);
      return;
    case "union":
      for (const member of type.members) referencedIds(member, ids);
      return;
    case "function":
      for (const parameter of type.parameters) referencedIds(parameter, ids);
      referencedIds(type.result, ids);
      effectIds(type.effects.failures, type.effects.requirements, ids);
      return;
    case "provider":
      effectIds([], type.provides, ids);
      effectIds(
        type.acquisition.effects.failures,
        type.acquisition.effects.requirements,
        ids,
      );
      return;
  }
}

/** Adds failure identities and the services of capabilities. */
export function effectIds(
  failures: readonly ErrorId[],
  capabilities: readonly CapabilityId[],
  ids: Set<string>,
): void {
  for (const failure of failures) ids.add(failure);
  for (const capability of capabilities) {
    const service = serviceOfCapability(capability);
    if (service !== undefined) ids.add(service);
  }
}
