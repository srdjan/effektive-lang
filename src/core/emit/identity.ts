import { setFrom } from "../runtime.ts";
// Identity helpers for the emitter. Each one turns a malformed identity into an
// internal failure, where the `ids.ts` helper returns undefined.
import type { CapabilityId, ServiceId } from "../ir.ts";
import { SCOPE_CAPABILITY } from "../ir.ts";
import {
  type DeclarationName,
  type IdentityText,
  type MethodName,
  methodOfCapability as coreMethodOfCapability,
  type ModuleName,
  moduleOfId as coreModuleOfId,
  nameOfId as coreNameOfId,
  serviceOfCapability as coreServiceOfCapability,
} from "../ids.ts";
import { compareText } from "../util.ts";
import { internal } from "./failure.ts";
/** The module part of an identity such as `type:users#User`. */
export function moduleOfId(id: IdentityText): ModuleName {
  const module = coreModuleOfId(id);
  if (module === undefined) {
    return internal(`malformed identity ${id}`);
  }
  return module;
}
/** The declared name in an identity such as `type:users#User`. */
export function nameOfId(id: IdentityText): DeclarationName {
  const name = coreNameOfId(id);
  if (name === undefined) {
    return internal(`malformed identity ${id}`);
  }
  return name;
}
export function serviceOfCapability(capability: CapabilityId): ServiceId {
  const service = coreServiceOfCapability(capability);
  if (service === undefined) {
    return internal(`malformed capability ${capability}`);
  }
  return service;
}
export function methodOfCapability(capability: CapabilityId): MethodName {
  const method = coreMethodOfCapability(capability);
  if (method === undefined) {
    return internal(`malformed capability ${capability}`);
  }
  return method;
}
/** Service identities of a capability list, sorted and unique. */
export function servicesOf(capabilities: readonly CapabilityId[]): ServiceId[] {
  return [
    ...setFrom(
      capabilities.filter((id) => id !== SCOPE_CAPABILITY).map(
        serviceOfCapability,
      ),
    ),
  ].sort(compareText);
}
