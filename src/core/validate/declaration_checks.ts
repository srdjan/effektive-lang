import { hasProperty } from "../runtime.ts";
// Checks of the declaration headers: identities, kinds, exports, services,
// type declarations, and error declarations.

import type { Report, ValidationPath } from "./report.ts";
import { isTrue } from "./guards.ts";
import { emptySet, setFrom } from "../runtime.ts";
import type {
  ErrorDecl,
  Field,
  ModuleIR,
  ServiceDecl,
  Span,
  TypeDecl,
} from "../ir.ts";
import { AREA, moduleSpan } from "./report.ts";
import { checkRefinementDeclaration } from "./refinements.ts";
import type { Ctx } from "./world_table.ts";
import {
  checkDeclaredType,
  checkDeferredFields,
  checkFieldNames,
} from "./type_checks.ts";

const KIND_PREFIX = {
  type: "type:",
  error: "error:",
  service: "service:",
  function: "value:",
  constant: "value:",
} as const;

export function checkServiceDecl(
  ctx: Ctx,
  service: ServiceDecl,
  path: ValidationPath,
  seenMethods: Set<string>,
): Ctx {
  const base = service.id.startsWith("service:")
    ? service.id.slice("service:".length)
    : service.id;
  for (const entry of service.methods.entries()) {
    const m = entry[1];
    const j = entry[0];
    const at = `${path}.methods[${j}]`;
    if (m.id !== `cap:${base}.${m.name}`) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `${at}.id`,
          `expected the capability identity cap:${base}.${m.name}, recorded ${m.id}`,
          m.span,
        ),
      };
    }
    if (seenMethods.has(m.id)) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `${at}.id`,
          `the capability ${m.id} is declared twice`,
          m.span,
        ),
      };
    }
    seenMethods = seenMethods.add(m.id);
    ctx = checkDeclaredType(ctx, m.type, `${at}.type`, m.span);
    if (m.type.checked?.some(Boolean)) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.contracts,
          `${at}.type.checked`,
          "a service method cannot claim checked entry validation",
          m.span,
        ),
      };
    }
    if (m.borrows !== undefined) {
      if (m.borrows.length !== m.type.parameters.length) {
        ctx = {
          ...ctx,
          report: ctx.report.add(
            AREA.types,
            `${at}.borrows`,
            "borrow flags must match method parameters",
            m.span,
          ),
        };
      }
      for (const entry of m.borrows.entries()) {
        const borrow = entry[1];
        const index = entry[0];
        if (!borrow) continue;
        if (!m.span.source.endsWith(".effi")) {
          ctx = {
            ...ctx,
            report: ctx.report.add(
              AREA.types,
              `${at}.borrows[${index}]`,
              "a service borrow parameter belongs in a host interface",
              m.span,
            ),
          };
        }
        const parameter = m.type.parameters[index];
        if (
          parameter?.kind !== "named" ||
          !isTrue(ctx.world.types.get(parameter.id)?.opaque)
        ) {
          ctx = {
            ...ctx,
            report: ctx.report.add(
              AREA.types,
              `${at}.borrows[${index}]`,
              "a borrow parameter needs an opaque type",
              m.span,
            ),
          };
        }
      }
    }
  }
  return ctx;
}

export function checkTypeDecl(
  ctx: Ctx,
  d: TypeDecl,
  path: ValidationPath,
): Ctx {
  ctx = checkRefinementDeclaration(ctx, d, path);
  const hasSealed = hasProperty(d.definition, "sealed");
  const sealed = d.definition.kind === "nominal"
    ? d.definition.sealed
    : undefined;
  if (
    hasSealed &&
    (d.definition.kind !== "nominal" || !isTrue(sealed))
  ) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.definition.sealed`,
        "sealed must be true and belongs only to a type with identity",
        d.span,
      ),
    };
  }
  if (
    hasProperty(d.definition, "tagged") &&
    (d.definition.kind !== "nominal" || !isTrue(d.definition.tagged) ||
      d.definition.base.kind !== "record")
  ) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.definition.tagged`,
        "tagged must be true and belongs only to a nominal definition over a record",
        d.span,
      ),
    };
  }
  if (isTrue(sealed) && d.span.source.endsWith(".effi")) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.definition.sealed`,
        "a sealed type cannot be declared in a host interface",
        d.span,
      ),
    };
  }
  if (isTrue(d.opaque) && !d.span.source.endsWith(".effi")) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.opaque`,
        "an opaque type belongs in a host interface",
        d.span,
      ),
    };
  }
  if (
    isTrue(d.opaque) &&
    (d.definition.kind !== "nominal" ||
      d.definition.base.kind !== "primitive" ||
      d.definition.base.name !== "unknown")
  ) {
    ctx = {
      ...ctx,
      report: ctx.report.add(
        AREA.types,
        `${path}.definition`,
        "an opaque type needs an unknown nominal base",
        d.span,
      ),
    };
  }
  if (
    d.definition.kind === "nominal" && isTrue(d.definition.tagged) &&
    d.definition.base.kind === "record"
  ) {
    return checkDeclarationFields(
      ctx,
      d.definition.base.fields,
      `${path}.definition.base.fields`,
      d.span,
    );
  }
  const type = d.definition.kind === "alias"
    ? d.definition.type
    : d.definition.base;
  const at = d.definition.kind === "alias"
    ? `${path}.definition.type`
    : `${path}.definition.base`;
  return checkDeclaredType(ctx, type, at, d.span);
}

/** Checks the fields of a tagged record or an error: the reserved name _tag, the names, and the types. */
function checkDeclarationFields(
  ctx: Ctx,
  fields: readonly Field[],
  at: string,
  span: Span,
): Ctx {
  for (const entry of fields.entries()) {
    const f = entry[1];
    const i = entry[0];
    if (f.name === "_tag") {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.types,
          `${at}[${i}]`,
          "the field name _tag is reserved for generated tags",
          span,
        ),
      };
    }
  }
  ctx = checkFieldNames(ctx, fields, at, span);
  ctx = checkDeferredFields(ctx, fields, at, span);
  for (const entry of fields.entries()) {
    const f = entry[1];
    const i = entry[0];
    ctx = checkDeclaredType(ctx, f.type, `${at}[${i}].type`, span);
  }
  return ctx;
}

export function checkErrorDecl(
  ctx: Ctx,
  d: ErrorDecl,
  path: ValidationPath,
): Ctx {
  return checkDeclarationFields(ctx, d.fields, `${path}.fields`, d.span);
}

export function checkDeclarationHeaders(ctx: Ctx, ir: ModuleIR): Report {
  let seen = emptySet<string>();
  const seenMethods = emptySet<string>();
  for (const entry of ir.declarations.entries()) {
    const d = entry[1];
    const i = entry[0];
    const path = `declarations[${i}]`;
    const expected = `${KIND_PREFIX[d.kind]}${ir.module}#${d.name}`;
    if (d.id !== expected) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `${path}.id`,
          `expected the identity ${expected}, recorded ${d.id}`,
          d.span,
        ),
      };
    }
    if (seen.has(d.id)) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `${path}.id`,
          `the identity ${d.id} is declared twice`,
          d.span,
        ),
      };
    }
    seen = seen.add(d.id);
    if (d.kind === "type") ctx = checkTypeDecl(ctx, d, path);
    else if (d.kind === "error") ctx = checkErrorDecl(ctx, d, path);
    else if (d.kind === "service") {
      ctx = checkServiceDecl(ctx, d, path, seenMethods);
    } else ctx = checkDeclaredType(ctx, d.type, `${path}.type`, d.span);
  }
  const declared = setFrom(ir.declarations.map((d) => d.id));
  let exported = emptySet<string>();
  for (const entry of ir.exports.entries()) {
    const id = entry[1];
    const i = entry[0];
    const span = moduleSpan(ir);
    if (!declared.has(id)) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `exports[${i}]`,
          `the export ${id} is not declared in this module`,
          span,
        ),
      };
    }
    if (exported.has(id)) {
      ctx = {
        ...ctx,
        report: ctx.report.add(
          AREA.identity,
          `exports[${i}]`,
          `the export ${id} appears twice`,
          span,
        ),
      };
    }
    exported = exported.add(id);
  }
  return ctx.report;
}
