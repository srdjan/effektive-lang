// The independent typed-IR validator (design D11). It recomputes every
// annotation of a module from the IR alone and reports each disagreement with
// its validation area. This directory imports only `../ir.ts`, `../source.ts`,
// and `../diagnostics.ts`: it shares no code with the checker, the resolver,
// or the lowering, so it can serve as a differential oracle for them.

import { type Diagnostic, normalizeDiagnostics } from "../diagnostics.ts";
import type { ModuleIR, Span } from "../ir.ts";
import { BodyValidator } from "./expr.ts";
import { AREA, moduleSpan, Report } from "./report.ts";
import { fallbackSpan } from "./prelude.ts";
import { checkSerialization } from "./serialization.ts";
import { checkDeclarationHeaders } from "./declaration_checks.ts";
import { checkImports } from "./import_checks.ts";
import { checkRecursion } from "./recursion_checks.ts";
import { buildWorld } from "./world_table.ts";

export { AREA } from "./report.ts";

/**
 * Validates one module. `sources` maps each source identifier to its text. An
 * empty result means the module is valid. The diagnostics are sorted and
 * without duplicates.
 */
export function validateModule(
  ir: ModuleIR,
  sources: ReadonlyMap<string, string>,
): readonly Diagnostic[] {
  const report = new Report();
  const fallback: Span = Array.isArray(ir.sources)
    ? moduleSpan(ir)
    : fallbackSpan(ir.module);
  // A module that does not have the shape of ModuleIR makes a check throw.
  // The validator reports the shape problem and goes on with the next part.
  const unexpected = (path: string, span: Span, e: unknown): void => {
    report.add(
      AREA.serialization,
      path,
      `the IR has an unexpected shape: ${
        e instanceof Error ? e.message : String(e)
      }`,
      span,
    );
  };
  const guard = (path: string, span: Span, run: () => void): void => {
    try {
      run();
    } catch (e) {
      unexpected(path, span, e);
    }
  };
  let world: ReturnType<typeof buildWorld>;
  try {
    world = buildWorld(ir);
  } catch (e) {
    unexpected("", fallback, e);
    return normalizeDiagnostics(report.items);
  }
  const ctx = { world, report };
  guard("imports", fallback, () => checkImports(ctx, ir));
  guard("declarations", fallback, () => checkDeclarationHeaders(ctx, ir));
  guard("declarations", fallback, () => checkRecursion(ctx, ir));
  ir.declarations.forEach((d, i) => {
    const path = `declarations[${i}]`;
    guard(path, d?.span ?? fallback, () => {
      if (d.kind === "function") {
        new BodyValidator(ctx).checkFunction(d, path);
      } else if (d.kind === "constant") {
        new BodyValidator(ctx).checkConstant(d, path);
      }
    });
  });
  guard("", fallback, () => checkSerialization(ir, sources, report));
  return normalizeDiagnostics(report.items);
}
