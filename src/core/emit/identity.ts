// Identity helpers for the emitter. Each one turns a malformed identity into an
// internal failure, where the `ids.ts` helper returns undefined.

import type { CapabilityId, ServiceId } from "../ir.ts";
import { SCOPE_CAPABILITY } from "../ir.ts";
import {
  methodOfCapability as coreMethodOfCapability,
  moduleOfId as coreModuleOfId,
  nameOfId as coreNameOfId,
  serviceOfCapability as coreServiceOfCapability,
} from "../ids.ts";
import { compareText } from "../util.ts";
import { internal } from "./failure.ts";

/** The module part of an identity such as `type:users#User`. */
export function moduleOfId(id: string): string {
  const module = coreModuleOfId(id);
  if (module === undefined) throw internal(`malformed identity ${id}`);
  return module;
}

/** The declared name in an identity such as `type:users#User`. */
export function nameOfId(id: string): string {
  const name = coreNameOfId(id);
  if (name === undefined) throw internal(`malformed identity ${id}`);
  return name;
}

/** The text after the colon: the tag, service key, or identity token of the emitted code. */
export function tokenOfId(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}

export function serviceOfCapability(capability: CapabilityId): ServiceId {
  const service = coreServiceOfCapability(capability);
  if (service === undefined) {
    throw internal(`malformed capability ${capability}`);
  }
  return service;
}

export function methodOfCapability(capability: CapabilityId): string {
  const method = coreMethodOfCapability(capability);
  if (method === undefined) {
    throw internal(`malformed capability ${capability}`);
  }
  return method;
}

/** Service identities of a capability list, sorted and unique. */
export function servicesOf(
  capabilities: readonly CapabilityId[],
): ServiceId[] {
  return [
    ...new Set(
      capabilities.filter((id) => id !== SCOPE_CAPABILITY).map(
        serviceOfCapability,
      ),
    ),
  ].sort(compareText);
}
