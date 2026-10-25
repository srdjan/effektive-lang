// Inlay hints for inferred parameter and effect contracts. Inline arrows get
// no hint: shortcut, callback hints would add noise at every call site.
import { effectText } from "./check_project.ts";
import type { Revision } from "./db.ts";
import { childrenOf, kindOf, SyntaxKind } from "./syntax.ts";
import { isTypeKind } from "./syntax_queries.ts";
import { showType } from "./type_show.ts";

export interface InlayHint {
  /** The insertion offset for the displayed label. */
  readonly position: number;
  /** Holds only the inferred contract part. */
  readonly label: string;
}

/**
 * The hints whose position is inside `range` (inclusive) in the file `path`.
 * A function with a diagnostic inside its span gets no hint, because the
 * inferred sets of a broken body are unreliable.
 */
export function inlayHintsAt(
  revision: Revision,
  path: string,
  range: { readonly start: number; readonly end: number },
): readonly InlayHint[] {
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !path.endsWith(".eff")) return [];
  const { tree } = module;
  const index = revision.moduleInfo(module.module)?.index;
  const hints: InlayHint[] = [];
  for (const fn of module.functions.values()) {
    const { signature } = fn;
    const { written } = signature;
    if (index?.byName.get(signature.name)?.broken !== false) continue;
    if (
      module.diagnostics.some((d) =>
        d.span.start >= signature.span.start && d.span.end <= signature.span.end
      )
    ) continue;
    for (const parameter of signature.parameters) {
      const type = revision.types.node(parameter.type.ref);
      if (
        !parameter.inferred || type.kind === "error" ||
        type.kind === "primitive" && type.name === "unknown" ||
        parameter.span.end < range.start || parameter.span.end > range.end
      ) continue;
      hints.push({
        position: parameter.span.end,
        label: parameter.annotated
          ? ` validated: ${showType(revision.types, parameter.type.ref)}`
          : `: ${showType(revision.types, parameter.type.ref)}`,
      });
    }
    if (signature.exported || (written.fails && written.uses)) continue;
    const label = effectText(
      written.fails ? [] : fn.failures,
      written.uses ? [] : fn.requirements,
    );
    if (label === "") continue;
    let position = -1;
    for (const child of childrenOf(tree, signature.node)) {
      if (kindOf(tree, child) !== SyntaxKind.ArrowExpr) continue;
      for (const part of childrenOf(tree, child)) {
        const kind = kindOf(tree, part);
        if (
          kind === SyntaxKind.ParamList || kind === SyntaxKind.FailsClause ||
          kind === SyntaxKind.UsesClause || isTypeKind(kind)
        ) position = Math.max(position, tree.ends[part]);
      }
    }
    if (position < range.start || position > range.end) continue;
    hints.push({ position, label });
  }
  return hints;
}
