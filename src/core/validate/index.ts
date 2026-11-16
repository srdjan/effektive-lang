// The independent typed-IR validator (design D11). It recomputes every
// annotation of a module from the IR alone and reports each disagreement with
// its validation area. This directory imports only `../ir.ts`, `../source.ts`,
// `../diagnostics.ts`, and the native primitives in `../runtime.ts`. It shares
// no code with the checker, resolver, or lowering. It remains their
// differential oracle.

import { type Diagnostic, normalizeDiagnostics } from "../diagnostics.ts";
import type { ModuleIR, Span } from "../ir.ts";
import { createBodyValidator } from "./expr.ts";
import { AREA, createReport, moduleSpan, type Report } from "./report.ts";
import { fallbackSpan } from "./prelude.ts";
import { checkSerialization } from "./serialization.ts";
import { checkDeclarationHeaders } from "./declaration_checks.ts";
import { checkImports } from "./import_checks.ts";
import { checkRecursion } from "./recursion_checks.ts";
import { buildWorld } from "./world_table.ts";
import { caught } from "../source.ts";
import { unknownMessage } from "../runtime.ts";

/**
 * Validates one module. `sources` maps each source identifier to its text. An
 * empty result means the module is valid. The diagnostics are sorted and
 * without duplicates.
 */
export function validateModule(
  ir: ModuleIR,
  sources: ReadonlyMap<string, string>,
): readonly Diagnostic[] {
  let report = createReport();
  const fallback: Span = Array.isArray(ir.sources)
    ? moduleSpan(ir)
    : fallbackSpan(ir.module);
  // A module that does not have the shape of ModuleIR makes a check throw.
  // The validator reports the shape problem and goes on with the next part.
  function unexpected(path: string, span: Span, e: unknown): Report {
    return report.add(
      AREA.serialization,
      path,
      `the IR has an unexpected shape: ${unknownMessage(e)}`,
      span,
    );
  }
  function guard(path: string, span: Span, run: () => Report): Report {
    const done = caught(run);
    return done.ok ? done.value : unexpected(path, span, done.error);
  }
  const world = caught(() => buildWorld(ir));
  if (!world.ok) {
    report = unexpected("", fallback, world.error);
    return normalizeDiagnostics(report.items());
  }
  const ctx = { world: world.value, report: report };
  report = guard("imports", fallback, () => checkImports(ctx, ir));
  report = guard(
    "declarations",
    fallback,
    () => checkDeclarationHeaders(ctx, ir),
  );
  report = guard("declarations", fallback, () => checkRecursion(ctx, ir));
  for (const entry of ir.declarations.entries()) {
    const d = entry[1];
    const i = entry[0];
    const path = `declarations[${i}]`;
    report = guard(path, d?.span ?? fallback, () => {
      if (d.kind === "function") {
        return createBodyValidator(ctx).checkFunction(d, path);
      } else if (d.kind === "constant") {
        return createBodyValidator(ctx).checkConstant(d, path);
      }
      return ctx.report;
    });
  }
  report = guard("", fallback, () => checkSerialization(ir, sources, report));
  return normalizeDiagnostics(report.items());
}
