// The service-bound policy. A module with service headers bounds the external
// service methods that its functions and constants may require. A function
// or a constant that needs a method of a service outside the bound gets a
// `requirement-contract/002` diagnostic. A module without a service header has
// no bound. The inputs are explicit: the caller passes the type reader of the
// current revision, so the requirements that values carry are read from the
// same table as the checked bodies.

import {
  type Diagnostic,
  makeDiagnostic,
  makeDiagnosticWithRelated,
} from "./diagnostics.ts";
import { contractOrigins } from "./contract_origins.ts";
import { serviceOfCapability, shortName } from "./ids.ts";
import type { CapabilityId, LocalId, ServiceId } from "./ir.ts";
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
import { emptySet, setFrom } from "./runtime.ts";

/** A checked function, as far as the bound reads it. */
type BoundedFunction = {
  readonly signature: Pick<
    FunctionSignature,
    "name" | "nameSpan" | "parameters"
  >;
  readonly requirements: readonly CapabilityId[];
  readonly result: TypeRef;
  readonly table: BodyTable;
  /** The body expression of the arrow, or undefined when the source is broken. */
  readonly bodyNode: NodeId | undefined;
};

/** A checked constant, as far as the bound reads it. */
type BoundedConstant = {
  readonly signature: Pick<ConstantSignature, "name" | "nameSpan">;
  readonly type: TypeRef;
  readonly table: BodyTable;
};

type ServiceBoundInput = {
  readonly info: Pick<ModuleInfo, "tree" | "index">;
  readonly resolution: ModuleResolution;
  /** The services that the module declares. */
  readonly declaredServices: readonly { readonly id: ServiceId }[];
  /** The type table of the current revision. */
  readonly table: TypeReader;
  readonly functions: Iterable<BoundedFunction>;
  readonly constants: Iterable<BoundedConstant>;
};

/** The services that the module may require, or undefined when it has no service header. */
function allowedServiceIds(
  input: ServiceBoundInput,
): Set<ServiceId> | undefined {
  const headers = input.info.index.imports.filter((entry) =>
    entry.role === "service"
  );
  if (headers.length === 0) return undefined;
  let allowed = setFrom<ServiceId>(
    input.declaredServices.map((service) => service.id),
  );
  for (const header of headers) {
    for (const name of header.names) {
      const target = input.resolution.namespace.get(name.name)?.target;
      if (target?.kind === "service") allowed = allowed.add(target.id);
    }
  }
  return allowed;
}

/** One `requirement-contract/002` diagnostic for each function and constant that exceeds the bound. */
export function serviceBoundDiagnostics(
  input: ServiceBoundInput,
): Diagnostic[] {
  const info = input.info;
  const resolution = input.resolution;
  const table = input.table;
  const bound = allowedServiceIds(input);
  if (bound === undefined) return [];
  const allowed: ReadonlySet<ServiceId> = bound;
  const diagnostics: Diagnostic[] = [];
  function undeclared(
    initial: Iterable<CapabilityId>,
    produced: TypeRef,
    body: BodyTable,
    parameters: readonly (LocalId | undefined)[],
  ): CapabilityId[] {
    let requirements = setFrom<CapabilityId>(initial);
    requirements = producedRequirements(
      table,
      produced,
      requirements,
      undefined,
    );
    requirements = transferredRequirements(
      {
        table: table,
        tree: info.tree,
        resolution: resolution,
        body: body,
        parameters: parameters,
      },
      requirements,
    );
    let found = emptySet<CapabilityId>();
    for (const capability of requirements) {
      const service = serviceOfCapability(capability);
      if (service !== undefined && !allowed.has(service)) {
        found = found.add(capability);
      }
    }
    return [...found].sort();
  }
  for (const fn of input.functions) {
    const extra = undeclared(
      fn.requirements,
      fn.result,
      fn.table,
      fn.signature.parameters.map((parameter) => parameter.id),
    );
    if (extra.length === 0) continue;
    const related = extra.flatMap((capability) =>
      fn.bodyNode === undefined ? [] : contractOrigins(
        info.tree,
        fn.table,
        fn.bodyNode,
        { kind: "requirement", capability: capability },
      ).map((span) => ({
        span: span,
        message: `requires \`${shortName(capability)}\` here`,
      }))
    );
    diagnostics[diagnostics.length] = makeDiagnosticWithRelated(
      "requirement-contract/002",
      `\`${fn.signature.name}\` requires undeclared service methods ${
        extra.map(shortName).join(", ")
      }`,
      fn.signature.nameSpan,
      related,
    );
  }
  for (const constant of input.constants) {
    const extra = undeclared([], constant.type, constant.table, []);
    if (extra.length === 0) continue;
    diagnostics[diagnostics.length] = makeDiagnostic(
      "requirement-contract/002",
      `\`${constant.signature.name}\` produces a value with undeclared service methods ${
        extra.map(shortName).join(", ")
      }`,
      constant.signature.nameSpan,
    );
  }
  return diagnostics;
}
