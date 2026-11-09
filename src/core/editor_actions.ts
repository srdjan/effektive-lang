// Contract edits come from checked body effect sets, never diagnostic prose.
import { isSourcePath } from "./paths.ts";
import type { Revision } from "./db.ts";
import { diagnosticDelta } from "./diagnostic_delta.ts";
import type { SourceEdit } from "./source.ts";
import { reviseWithEdits } from "./editor_rename.ts";
import { capabilityOfService } from "./ids.ts";
import { EFFECT_ERROR_IDS } from "./resolve.ts";
import { diagnosticInside, resultEndOf } from "./editor_hints.ts";
import { childrenOf, kindOf, SyntaxKind } from "./syntax.ts";
import { functionParts } from "./syntax_queries.ts";

interface ContractAction {
  readonly title: string;
  readonly function: string;
  readonly edits: readonly SourceEdit[];
}

function effectName(
  revision: Revision,
  module: string,
  id: string,
): string | undefined {
  for (const [name, effectId] of EFFECT_ERROR_IDS) {
    if (id === effectId) return name;
  }
  const namespace = revision.resolution(module)?.namespace;
  for (const [name, binding] of namespace ?? []) {
    const target = binding.target;
    if ("id" in target && target.id === id) return name;
    if (target.kind === "service") {
      for (const method of binding.service?.entry.methodList ?? []) {
        if (capabilityOfService(target.id, method.name) === id) {
          return `${name}.${method.name}`;
        }
      }
    }
  }
  return undefined;
}

/**
 * Names for missing requirements. A service name replaces its methods when
 * every method is missing. It takes the place of the first of those methods.
 */
function requirementNames(
  revision: Revision,
  module: string,
  ids: readonly string[],
): (string | undefined)[] {
  const missing = new Set(ids);
  const whole = new Map<string, string>();
  const covered = new Set<string>();
  for (const [name, binding] of revision.resolution(module)?.namespace ?? []) {
    if (binding.target.kind !== "service") continue;
    const prefix = capabilityOfService(binding.target.id, "");
    const methods = (binding.service?.entry.methodList ?? []).map((m) =>
      prefix + m.name
    );
    if (
      methods.length === 0 || !methods.every((m) => missing.has(m)) ||
      methods.some((m) => covered.has(m))
    ) continue;
    whole.set(ids.find((id) => methods.includes(id)) ?? "", name);
    for (const m of methods) covered.add(m);
  }
  return ids.flatMap((id) => {
    const service = whole.get(id);
    if (service !== undefined) return [service];
    return covered.has(id) ? [] : [effectName(revision, module, id)];
  });
}

const CONTRACT_CODES: readonly string[] = [
  "failure-contract/001",
  "requirement-contract/001",
];

/**
 * Missing fails/with only, for written clauses of inline contracts with reliable bodies.
 * An action adds no diagnostic. With `allowCallerGaps`, it may add contract diagnostics:
 * a closed caller can miss the entries that the action gives to its callee.
 */
export function contractActionsAt(
  revision: Revision,
  path: string,
  start: number,
  end = start,
  allowCallerGaps = false,
): readonly ContractAction[] {
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !isSourcePath(path)) return [];
  const output: ContractAction[] = [];
  for (const fn of module.functions.values()) {
    const { signature, body } = fn;
    if (
      signature.annotation !== "arrow" || !signature.written.result ||
      body === undefined || signature.span.end < start ||
      end < signature.span.start
    ) continue;
    const entry = revision.moduleInfo(module.module)?.index.byName.get(
      signature.name,
    );
    if (entry === undefined || entry.broken) continue;
    // Other body errors can make the inferred effect set incomplete.
    if (
      diagnosticInside(revision, module.path, signature.span, CONTRACT_CODES)
    ) continue;
    // An open set has no clause to extend, so it never misses an entry.
    const missingFailures = signature.written.fails
      ? [...new Set([...body.failures, ...fn.failures])].filter((id) =>
        !signature.failures.includes(id)
      )
      : [];
    const missingUses = signature.written.uses
      ? body.requirements.filter((id) => !signature.requirements.includes(id))
      : [];
    if (missingFailures.length === 0 && missingUses.length === 0) continue;
    const failureNames = missingFailures.map((id) =>
      effectName(revision, module.module, id)
    );
    const useNames = requirementNames(revision, module.module, missingUses);
    if ([...failureNames, ...useNames].some((n) => n === undefined)) continue;
    const { tree } = module;
    let arrow = -1;
    for (const child of childrenOf(tree, signature.node)) {
      if (kindOf(tree, child) === SyntaxKind.ArrowExpr) arrow = child;
    }
    if (arrow < 0) continue;
    const children = [...childrenOf(tree, arrow)];
    const { fails, uses } = functionParts(tree, arrow);
    const text = tree.text;
    const token = children.find((n) =>
      text.slice(tree.starts[n], tree.ends[n]) === "=>"
    );
    if (token === undefined) continue;
    const edits: SourceEdit[] = [];
    const clauseEdit = (
      clause: number | undefined,
      keyword: string,
      names: readonly (string | undefined)[],
      fallback: number,
    ): SourceEdit => {
      const list = names.join(" | ");
      if (clause === undefined) {
        return {
          span: { source: path, start: fallback, end: fallback },
          text: `${keyword} ${list} `,
        };
      }
      // A clause that holds only `never` has no entry to extend: replace it.
      const end = tree.ends[clause];
      if (/^\w+\s+never$/.test(text.slice(tree.starts[clause], end))) {
        return {
          span: { source: path, start: end - "never".length, end },
          text: list,
        };
      }
      return { span: { source: path, start: end, end }, text: ` | ${list}` };
    };
    if (failureNames.length > 0) {
      edits.push(clauseEdit(
        fails,
        "fails",
        failureNames,
        uses !== undefined ? tree.starts[uses] : tree.starts[token],
      ));
    }
    if (useNames.length > 0) {
      edits.push(clauseEdit(uses, "with", useNames, tree.starts[token]));
    }
    // Merge insertions at a shared offset in language clause order.
    const merged: SourceEdit[] = [];
    for (const edit of edits) {
      const i = merged.findIndex((e) => e.span.start === edit.span.start);
      if (i < 0) merged.push(edit);
      else merged[i] = { span: edit.span, text: merged[i].text + edit.text };
    }
    const checked = reviseWithEdits(revision, merged);
    if (!checked.ok) continue;
    const changedFunction = checked.value.checkedModule(module.module)
      ?.functions.get(signature.id);
    if (
      changedFunction === undefined || changedFunction.body === undefined ||
      (changedFunction.signature.written.fails &&
        [...changedFunction.body.failures, ...changedFunction.failures].some((
          id,
        ) => !changedFunction.signature.failures.includes(id))) ||
      (changedFunction.signature.written.uses &&
        changedFunction.body.requirements.some((id) =>
          !changedFunction.signature.requirements.includes(id)
        ))
    ) {
      continue;
    }
    const delta = diagnosticDelta(
      revision.diagnostics,
      checked.value.diagnostics,
      merged,
    );
    const harmful = allowCallerGaps
      ? delta.added.some((d) => !CONTRACT_CODES.includes(d.code))
      : delta.added.length > 0;
    if (harmful || delta.removed.length === 0) {
      continue;
    }
    output.push({
      title: `Add missing ${
        missingFailures.length > 0 && missingUses.length > 0
          ? "fails and with"
          : missingFailures.length > 0
          ? "fails"
          : "with"
      } entries`,
      function: signature.id,
      edits: merged,
    });
  }
  return output;
}

/**
 * One action that writes the inferred failure set of the module-level function
 * whose header holds `start` as a `fails` clause. The header runs from the start
 * of the declaration to the end of its `=>` token, so `end` is not used. The
 * action needs a visible name for every error. It changes no failure set,
 * requirement set, or mode, and it adds no diagnostic.
 */
export function failsClauseActionsAt(
  revision: Revision,
  path: string,
  start: number,
): readonly ContractAction[] {
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !isSourcePath(path)) return [];
  const { tree } = module;
  for (const fn of module.functions.values()) {
    const { signature } = fn;
    let arrow = -1;
    for (const child of childrenOf(tree, signature.node)) {
      if (kindOf(tree, child) === SyntaxKind.ArrowExpr) arrow = child;
    }
    if (arrow < 0) continue;
    const token = [...childrenOf(tree, arrow)].find((n) =>
      tree.text.slice(tree.starts[n], tree.ends[n]) === "=>"
    );
    if (
      token === undefined || start < signature.span.start ||
      start > tree.ends[token]
    ) continue;
    // The headers of two functions never overlap: this is the only candidate.
    const entry = revision.moduleInfo(module.module)?.index.byName.get(
      signature.name,
    );
    if (
      signature.annotation !== "arrow" || !signature.written.result ||
      signature.written.fails || fn.body === undefined ||
      entry === undefined || entry.broken ||
      diagnosticInside(revision, module.path, signature.span)
    ) return [];
    const names = fn.failures.map((id) =>
      effectName(revision, module.module, id)
    );
    if (names.some((n) => n === undefined)) return [];
    const at = resultEndOf(tree, signature.node);
    if (at < 0) return [];
    const clause = ` fails ${names.length === 0 ? "never" : names.join(" | ")}`;
    const edits: SourceEdit[] = [{
      span: { source: path, start: at, end: at },
      text: clause,
    }];
    const checked = reviseWithEdits(revision, edits);
    if (!checked.ok) return [];
    const changed = checked.value.checkedModule(module.module)?.functions.get(
      signature.id,
    );
    if (
      changed === undefined || changed.mode !== fn.mode ||
      !sameIds(changed.failures, fn.failures) ||
      !sameIds(changed.requirements, fn.requirements) ||
      diagnosticDelta(revision.diagnostics, checked.value.diagnostics, edits)
          .added.length > 0
    ) return [];
    return [{ title: `Write${clause}`, function: signature.id, edits }];
  }
  return [];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
