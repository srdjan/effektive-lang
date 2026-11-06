// The service-bound policy. A module with service headers bounds the external
// service methods that its functions and constants may require. A function
// or a constant that needs a method of a service outside the bound gets a
// `requirement-contract/002` diagnostic. A module without a service header has
// no bound. The inputs are explicit: the caller passes the type reader of the
// current revision, so the requirements that values carry are read from the
// same table as the checked bodies.

import { type Diagnostic, makeDiagnostic } from "./diagnostics.ts";
import { contractOrigins } from "./contract_origins.ts";
import { serviceOfCapability, shortName } from "./ids.ts";
import type { CapabilityId, ServiceId } from "./ir.ts";
import type { ModuleInfo } from "./project.ts";
import {
  producedRequirements,
  transferredRequirements,
} from "./requirement_provenance.ts";
import type { ModuleResolution } from "./resolve.ts";
import type { ConstantSignature, FunctionSignature } from "./signatures.ts";
import type { NodeId } from "./syntax.ts";
import type { BodyTable } from "./tables.ts";
import type { TypeReader, TypeRef } from "./types.ts";

/** A checked function, as far as the bound reads it. */
export interface BoundedFunction {
  readonly signature: Pick<
    FunctionSignature,
    "name" | "nameSpan" | "parameters"
  >;
  readonly requirements: readonly CapabilityId[];
  readonly result: TypeRef;
  readonly table: BodyTable;
  /** The body expression of the arrow, or undefined when the source is broken. */
  readonly bodyNode: NodeId | undefined;
}

/** A checked constant, as far as the bound reads it. */
export interface BoundedConstant {
  readonly signature: Pick<ConstantSignature, "name" | "nameSpan">;
  readonly type: TypeRef;
  readonly table: BodyTable;
}

export interface ServiceBoundInput {
  readonly info: Pick<ModuleInfo, "tree" | "index">;
  readonly resolution: ModuleResolution;
  /** The services that the module declares. */
  readonly declaredServices: readonly { readonly id: ServiceId }[];
  /** The type table of the current revision. */
  readonly table: TypeReader;
  readonly functions: Iterable<BoundedFunction>;
  readonly constants: Iterable<BoundedConstant>;
}

/** The services that the module may require, or undefined when it has no service header. */
function allowedServiceIds(
  input: ServiceBoundInput,
): Set<ServiceId> | undefined {
  const headers = input.info.index.imports.filter((entry) =>
    entry.role === "service"
  );
  if (headers.length === 0) return undefined;
  const allowed = new Set<ServiceId>(
    input.declaredServices.map((service) => service.id),
  );
  for (const header of headers) {
    for (const name of header.names) {
      const target = input.resolution.namespace.get(name.name)?.target;
      if (target?.kind === "service") allowed.add(target.id);
    }
  }
  return allowed;
}

/** One `requirement-contract/002` diagnostic for each function and constant that exceeds the bound. */
export function serviceBoundDiagnostics(
  input: ServiceBoundInput,
): Diagnostic[] {
  const { info, resolution, table } = input;
  const allowed = allowedServiceIds(input);
  if (allowed === undefined) return [];
  const diagnostics: Diagnostic[] = [];
  const missing = (requirements: Iterable<CapabilityId>): CapabilityId[] => {
    const found = new Set<CapabilityId>();
    for (const capability of requirements) {
      const service = serviceOfCapability(capability);
      if (service !== undefined && !allowed.has(service)) found.add(capability);
    }
    return [...found].sort();
  };
  for (const fn of input.functions) {
    const requirements = new Set<CapabilityId>(fn.requirements);
    producedRequirements(table, fn.result, requirements);
    transferredRequirements({
      table,
      tree: info.tree,
      resolution,
      body: fn.table,
      parameters: fn.signature.parameters.map((parameter) => parameter.id),
    }, requirements);
    const extra = missing(requirements);
    if (extra.length === 0) continue;
    const related = extra.flatMap((capability) =>
      fn.bodyNode === undefined ? [] : contractOrigins(
        info.tree,
        fn.table,
        fn.bodyNode,
        { kind: "requirement", capability },
      ).map((span) => ({
        span,
        message: `requires \`${shortName(capability)}\` here`,
      }))
    );
    diagnostics.push(makeDiagnostic(
      "requirement-contract/002",
      `\`${fn.signature.name}\` requires undeclared service methods ${
        extra.map(shortName).join(", ")
      }`,
      fn.signature.nameSpan,
      related,
    ));
  }
  for (const constant of input.constants) {
    const requirements = new Set<CapabilityId>();
    producedRequirements(table, constant.type, requirements);
    transferredRequirements({
      table,
      tree: info.tree,
      resolution,
      body: constant.table,
      parameters: [],
    }, requirements);
    const extra = missing(requirements);
    if (extra.length === 0) continue;
    diagnostics.push(makeDiagnostic(
      "requirement-contract/002",
      `\`${constant.signature.name}\` produces a value with undeclared service methods ${
        extra.map(shortName).join(", ")
      }`,
      constant.signature.nameSpan,
    ));
  }
  return diagnostics;
}
