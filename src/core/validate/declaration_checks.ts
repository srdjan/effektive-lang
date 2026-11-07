// Checks of the declaration headers: identities, kinds, exports, services,
// type declarations, and error declarations.

import type { ErrorDecl, ModuleIR, ServiceDecl, TypeDecl } from "../ir.ts";
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
  path: string,
  seenMethods: Set<string>,
): void {
  const base = service.id.startsWith("service:")
    ? service.id.slice("service:".length)
    : service.id;
  service.methods.forEach((m, j) => {
    const at = `${path}.methods[${j}]`;
    if (m.id !== `cap:${base}.${m.name}`) {
      ctx.report.add(
        AREA.identity,
        `${at}.id`,
        `expected the capability identity cap:${base}.${m.name}, recorded ${m.id}`,
        m.span,
      );
    }
    if (seenMethods.has(m.id)) {
      ctx.report.add(
        AREA.identity,
        `${at}.id`,
        `the capability ${m.id} is declared twice`,
        m.span,
      );
    }
    seenMethods.add(m.id);
    checkDeclaredType(ctx, m.type, `${at}.type`, m.span);
    if (m.type.checked?.some(Boolean)) {
      ctx.report.add(
        AREA.contracts,
        `${at}.type.checked`,
        "a service method cannot claim checked entry validation",
        m.span,
      );
    }
    if (m.borrows !== undefined) {
      if (m.borrows.length !== m.type.parameters.length) {
        ctx.report.add(
          AREA.types,
          `${at}.borrows`,
          "borrow flags must match method parameters",
          m.span,
        );
      }
      m.borrows.forEach((borrow, index) => {
        if (!borrow) return;
        if (!m.span.source.endsWith(".effi")) {
          ctx.report.add(
            AREA.types,
            `${at}.borrows[${index}]`,
            "a service borrow parameter belongs in a host interface",
            m.span,
          );
        }
        const parameter = m.type.parameters[index];
        if (
          parameter?.kind !== "named" ||
          ctx.world.types.get(parameter.id)?.opaque !== true
        ) {
          ctx.report.add(
            AREA.types,
            `${at}.borrows[${index}]`,
            "a borrow parameter needs an opaque type",
            m.span,
          );
        }
      });
    }
  });
}

export function checkTypeDecl(ctx: Ctx, d: TypeDecl, path: string): void {
  checkRefinementDeclaration(ctx, d, path);
  const sealed = "sealed" in d.definition ? d.definition.sealed : undefined;
  if (
    sealed !== undefined &&
    (d.definition.kind !== "nominal" || sealed !== true)
  ) {
    ctx.report.add(
      AREA.types,
      `${path}.definition.sealed`,
      "sealed must be true and belongs only to a type with identity",
      d.span,
    );
  }
  if (
    "tagged" in d.definition &&
    (d.definition.tagged !== true || d.definition.base.kind !== "record")
  ) {
    ctx.report.add(
      AREA.types,
      `${path}.definition.tagged`,
      "tagged must be true and belongs only to a nominal definition over a record",
      d.span,
    );
  }
  if (sealed === true && d.span.source.endsWith(".effi")) {
    ctx.report.add(
      AREA.types,
      `${path}.definition.sealed`,
      "a sealed type cannot be declared in a host interface",
      d.span,
    );
  }
  if (d.opaque === true && !d.span.source.endsWith(".effi")) {
    ctx.report.add(
      AREA.types,
      `${path}.opaque`,
      "an opaque type belongs in a host interface",
      d.span,
    );
  }
  if (
    d.opaque === true &&
    (d.definition.kind !== "nominal" ||
      d.definition.base.kind !== "primitive" ||
      d.definition.base.name !== "unknown")
  ) {
    ctx.report.add(
      AREA.types,
      `${path}.definition`,
      "an opaque type needs an unknown nominal base",
      d.span,
    );
  }
  if (
    d.definition.kind === "nominal" && d.definition.tagged === true &&
    d.definition.base.kind === "record"
  ) {
    const { fields } = d.definition.base;
    const at = `${path}.definition.base.fields`;
    checkFieldNames(ctx, fields, at, d.span, true);
    checkDeferredFields(ctx, fields, at, d.span);
    fields.forEach((f, i) =>
      checkDeclaredType(ctx, f.type, `${at}[${i}].type`, d.span)
    );
    return;
  }
  const type = d.definition.kind === "alias"
    ? d.definition.type
    : d.definition.base;
  const at = d.definition.kind === "alias"
    ? `${path}.definition.type`
    : `${path}.definition.base`;
  checkDeclaredType(ctx, type, at, d.span);
}

export function checkErrorDecl(ctx: Ctx, d: ErrorDecl, path: string): void {
  checkFieldNames(ctx, d.fields, `${path}.fields`, d.span, true);
  checkDeferredFields(ctx, d.fields, `${path}.fields`, d.span);
  d.fields.forEach((f, i) =>
    checkDeclaredType(ctx, f.type, `${path}.fields[${i}].type`, d.span)
  );
}

export function checkDeclarationHeaders(ctx: Ctx, ir: ModuleIR): void {
  const { report } = ctx;
  const seen = new Set<string>();
  const seenMethods = new Set<string>();
  ir.declarations.forEach((d, i) => {
    const path = `declarations[${i}]`;
    const expected = `${KIND_PREFIX[d.kind]}${ir.module}#${d.name}`;
    if (d.id !== expected) {
      report.add(
        AREA.identity,
        `${path}.id`,
        `expected the identity ${expected}, recorded ${d.id}`,
        d.span,
      );
    }
    if (seen.has(d.id)) {
      report.add(
        AREA.identity,
        `${path}.id`,
        `the identity ${d.id} is declared twice`,
        d.span,
      );
    }
    seen.add(d.id);
    switch (d.kind) {
      case "type":
        checkTypeDecl(ctx, d, path);
        break;
      case "error":
        checkErrorDecl(ctx, d, path);
        break;
      case "service":
        checkServiceDecl(ctx, d, path, seenMethods);
        break;
      case "function":
        checkDeclaredType(ctx, d.type, `${path}.type`, d.span);
        break;
      case "constant":
        checkDeclaredType(ctx, d.type, `${path}.type`, d.span);
        break;
    }
  });
  const declared = new Set(ir.declarations.map((d) => d.id));
  const exported = new Set<string>();
  ir.exports.forEach((id, i) => {
    const span = moduleSpan(ir);
    if (!declared.has(id)) {
      report.add(
        AREA.identity,
        `exports[${i}]`,
        `the export ${id} is not declared in this module`,
        span,
      );
    }
    if (exported.has(id)) {
      report.add(
        AREA.identity,
        `exports[${i}]`,
        `the export ${id} appears twice`,
        span,
      );
    }
    exported.add(id);
  });
}
