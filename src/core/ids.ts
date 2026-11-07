// Helpers for the identity strings of declarations (`type:users#User`) and
// capabilities (`cap:users#Users.find`). Each helper returns undefined for a
// malformed identity, so the editor queries never throw. The emitter wraps these
// helpers and turns undefined into an internal failure.

import {
  type CapabilityId,
  type ErrorId,
  type LocalId,
  SCHEMA_ERROR_ID,
  SCHEMA_ISSUE_ID,
  type ServiceId,
  TIMEOUT_ERROR_ID,
  type TypeId,
  type ValueId,
} from "./ir.ts";

const SERVICE_PREFIX = "service:";
const CAPABILITY_PREFIX = "cap:";

/** The prefixes of declaration identities. A provider has a value identity. */
export type DeclarationPrefix = "type" | "error" | "service" | "value";

/** The identity of a declaration, such as `type:users#User`. */
export function declarationId<P extends DeclarationPrefix>(
  prefix: P,
  module: string,
  name: string,
): `${P}:${string}` {
  return `${prefix}:${module}#${name}`;
}

/** True for an identity such as `type:users#User`. */
export function isTypeId(id: string): id is TypeId {
  return id.startsWith("type:");
}

/** True for an identity such as `error:users#NotFound`. */
export function isErrorId(id: string): id is ErrorId {
  return id.startsWith("error:");
}

/** True for an identity such as `service:users#Users`. */
export function isServiceId(id: string): id is ServiceId {
  return id.startsWith(SERVICE_PREFIX);
}

/** True for one of the reserved Effect errors, which have no `#` and no source declaration. */
export function isReservedErrorId(id: string): id is ErrorId {
  return id === SCHEMA_ERROR_ID || id === SCHEMA_ISSUE_ID ||
    id === TIMEOUT_ERROR_ID;
}

/** True for an identity such as `value:users#find`. */
export function isValueId(id: string): id is ValueId {
  return id.startsWith("value:");
}

/** True for an identity such as `local:users#find/x`. */
export function isLocalId(id: string): id is LocalId {
  return id.startsWith("local:");
}

/** The identity of a service method: `cap:users#Users.find`. */
export function capabilityId(
  module: string,
  service: string,
  method: string,
): CapabilityId {
  return `cap:${module}#${service}.${method}`;
}

/** The capability of a method of the service with identity `service:m#S`. */
export function capabilityOfService(
  service: ServiceId,
  method: string,
): CapabilityId {
  return `cap:${service.slice(SERVICE_PREFIX.length)}.${method}`;
}

/** The identity of a local binding of a declaration: `local:users#find/x`. */
export function localId(
  module: string,
  owner: string,
  name: string,
): LocalId {
  return `local:${module}#${owner}/${name}`;
}

/** The identity of a local binding that the checker adds to a body: `local:value:users#find/$record3`. */
export function bodyLocalId(declaration: ValueId, name: string): LocalId {
  return `local:${declaration}/${name}`;
}

/** The collection builtins whose closed instances the IR names in a call. */
const BUILTIN_INSTANCE_NAMES = [
  "all",
  "traverse",
  "map",
  "filter",
  "fold",
] as const;

export type BuiltinInstanceName = typeof BUILTIN_INSTANCE_NAMES[number];

/** The identity of a closed builtin instance: `value:<module>#$builtin/<name>/<hash>`. */
export function builtinInstanceId(
  module: string,
  name: BuiltinInstanceName,
  hash: string,
): ValueId {
  return `value:${module}#$builtin/${name}/${hash}`;
}

/** The builtin name of an instance identity, or undefined for any other identity. */
export function builtinInstanceName(id: string): string | undefined {
  if (!isValueId(id)) return undefined;
  const rest = id.slice(id.indexOf("#") + 1);
  if (!rest.startsWith("$builtin/")) return undefined;
  return rest.split("/")[1];
}

/** The typed name, or undefined when `name` is not a collection builtin. */
export function asBuiltinInstanceName(
  name: string | undefined,
): BuiltinInstanceName | undefined {
  return BUILTIN_INSTANCE_NAMES.find((candidate) => candidate === name);
}

/** The typed builtin name of an instance identity, or undefined for any other identity. */
export function knownBuiltinInstanceName(
  id: string,
): BuiltinInstanceName | undefined {
  return asBuiltinInstanceName(builtinInstanceName(id));
}

/** The module part of an identity such as `type:users#User`. */
export function moduleOfId(id: string): string | undefined {
  const colon = id.indexOf(":");
  const hash = id.indexOf("#");
  if (colon < 0 || hash < colon) return undefined;
  return id.slice(colon + 1, hash);
}

/** The declared name in an identity such as `type:users#User`. */
export function nameOfId(id: string): string | undefined {
  const hash = id.indexOf("#");
  if (hash < 0) return undefined;
  const rest = id.slice(hash + 1);
  const dot = rest.indexOf(".");
  return dot < 0 ? rest : rest.slice(0, dot);
}

/** The method name in a capability such as `cap:users#Users.find`. */
export function methodOfCapability(
  capability: CapabilityId,
): string | undefined {
  const dot = capability.indexOf(".", capability.indexOf("#"));
  if (dot < 0) return undefined;
  return capability.slice(dot + 1);
}

/** `cap:m#S.method` to `service:m#S`. */
export function serviceOfCapability(
  capability: CapabilityId,
): ServiceId | undefined {
  const hash = capability.indexOf("#");
  if (hash < 0) return undefined;
  const dot = capability.indexOf(".", hash);
  if (dot < 0) return undefined;
  return `${SERVICE_PREFIX}${capability.slice(CAPABILITY_PREFIX.length, dot)}`;
}

/** The prefix after the kind of a reserved Effect identity, such as `error:effect/SchemaError`. */
const RESERVED_SPACE = ":effect/";

/**
 * The name of an identity, for messages: the part after the `#`. A reserved
 * Effect identity has no `#`, and its name is the part after `effect/`.
 */
export function shortName(id: string): string {
  const hash = id.indexOf("#");
  if (hash >= 0) return id.slice(hash + 1);
  const reserved = id.indexOf(RESERVED_SPACE);
  return reserved < 0 ? id : id.slice(reserved + RESERVED_SPACE.length);
}
