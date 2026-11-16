import type { EditorOffset, EditorPath } from "./editor.ts";
import type { NodeId, SyntaxTree } from "./syntax.ts";
import { emptyMap, emptySet, setFrom } from "./runtime.ts";
// Contract edits come from checked body effect sets, never diagnostic prose.
import { isSourcePath } from "./paths.ts";
import type { FunctionBody } from "./check_project.ts";
import type { Revision } from "./db.ts";
import { diagnosticDelta } from "./diagnostic_delta.ts";
import type { SourceEdit } from "./source.ts";
import { reviseWithEdits } from "./editor_rename.ts";
import { capabilityOfService } from "./ids.ts";
import { EFFECT_ERROR_IDS } from "./resolve.ts";
import {
  arrowHeaderOf,
  diagnosticInside,
  resultEndOf,
} from "./editor_hints.ts";
import { functionParts } from "./syntax_queries.ts";
type CallerGapsAllowed = boolean;
type ContractAction = {
  readonly title: string;
  readonly function: string;
  readonly edits: readonly SourceEdit[];
};
/** The failures and requirements that the body needs and the written clauses lack. */
function missingEntries(
  fn: FunctionBody,
  body: NonNullable<FunctionBody["body"]>,
): {
  readonly failures: readonly string[];
  readonly uses: readonly string[];
} {
  const binding1 = fn;
  const signature = binding1.signature;
  return {
    // An open set has no clause to extend, so it never misses an entry.
    failures: signature.written.fails
      ? [...setFrom([...body.failures, ...fn.failures])].filter((id) =>
        !signature.failures.includes(id)
      )
      : [],
    uses: signature.written.uses
      ? body.requirements.filter((id) => !signature.requirements.includes(id))
      : [],
  };
}
function effectName(
  revision: Revision,
  module: string,
  id: string,
): string | undefined {
  for (const binding2 of EFFECT_ERROR_IDS) {
    const binding3 = binding2;
    const name = binding3[0];
    const effectId = binding3[1];
    if (id === effectId) {
      return name;
    }
  }
  const namespace = revision.resolution(module)?.namespace;
  for (const binding4 of namespace ?? []) {
    const binding5 = binding4;
    const name = binding5[0];
    const binding = binding5[1];
    const target = binding.target;
    if (
      target.kind !== "builtin" && target.kind !== "builtin-type" &&
      target.kind !== "field" && target.kind !== "unresolved" &&
      target.id === id
    ) {
      return name;
    }
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
  const missing = setFrom(ids);
  let whole = emptyMap<string, string>();
  let covered = emptySet<string>();
  for (const binding6 of revision.resolution(module)?.namespace ?? []) {
    const binding7 = binding6;
    const name = binding7[0];
    const binding = binding7[1];
    if (binding.target.kind !== "service") {
      continue;
    }
    const prefix = capabilityOfService(binding.target.id, "");
    const methods = (binding.service?.entry.methodList ?? []).map((m) =>
      prefix + m.name
    );
    if (
      methods.length === 0 || !methods.every((m) => missing.has(m)) ||
      methods.some((m) => covered.has(m))
    ) {
      continue;
    }
    whole = whole.set(ids.find((id) => methods.includes(id)) ?? "", name);
    for (const m of methods) {
      covered = covered.add(m);
    }
  }
  return ids.flatMap((id) => {
    const service = whole.get(id);
    if (service !== undefined) {
      return [service];
    }
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
  path: EditorPath,
  start: EditorOffset,
  endInput: EditorOffset | undefined,
  allowCallerGaps: CallerGapsAllowed | undefined,
): readonly ContractAction[] {
  const end = endInput === undefined ? start : endInput;
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !isSourcePath(path)) {
    return [];
  }
  const output: ContractAction[] = [];
  for (const fn of module.functions.values()) {
    const binding8 = fn;
    const signature = binding8.signature;
    const body = binding8.body;
    if (
      signature.annotation !== "arrow" || !signature.written.result ||
      body === undefined || signature.span.end < start ||
      end < signature.span.start
    ) {
      continue;
    }
    const entry = revision.moduleInfo(module.module)?.index.byName.get(
      signature.name,
    );
    if (entry === undefined || entry.broken) {
      continue;
    }
    // Other body errors can make the inferred effect set incomplete.
    if (
      diagnosticInside(revision, module.path, signature.span, CONTRACT_CODES)
    ) {
      continue;
    }
    const binding9 = missingEntries(fn, body);
    const missingFailures = binding9.failures;
    const missingUses = binding9.uses;
    if (missingFailures.length === 0 && missingUses.length === 0) {
      continue;
    }
    const failureNames = missingFailures.map((id) =>
      effectName(revision, module.module, id)
    );
    const useNames = requirementNames(revision, module.module, missingUses);
    if ([...failureNames, ...useNames].some((n) => n === undefined)) {
      continue;
    }
    const binding10 = module;
    const tree = binding10.tree;
    const header = arrowHeaderOf(tree, signature.node);
    if (header === undefined || header.token === undefined) {
      continue;
    }
    const token = header.token;
    const binding12 = functionParts(tree, header.arrow);
    const fails = binding12.fails;
    const uses = binding12.uses;
    const edits: SourceEdit[] = [];

    if (failureNames.length > 0) {
      {
        const _appendTarget1 = edits;
        const _appendValue2 = clauseEdit(
          tree,
          path,
          fails,
          "fails",
          failureNames,
          uses !== undefined ? tree.starts[uses] : tree.starts[token],
        );
        _appendTarget1[_appendTarget1.length] = _appendValue2;
      }
    }
    if (useNames.length > 0) {
      {
        const _appendTarget3 = edits;
        const _appendValue4 = clauseEdit(
          tree,
          path,
          uses,
          "with",
          useNames,
          tree.starts[token],
        );
        _appendTarget3[_appendTarget3.length] = _appendValue4;
      }
    }
    // Merge insertions at a shared offset in language clause order.
    const merged: SourceEdit[] = [];
    for (const edit of edits) {
      const i = merged.findIndex((e) => e.span.start === edit.span.start);
      if (i < 0) {
        const _appendTarget5 = merged;
        const _appendValue6 = edit;
        _appendTarget5[_appendTarget5.length] = _appendValue6;
      } else {
        merged[i] = { span: edit.span, text: merged[i].text + edit.text };
      }
    }
    const checked = reviseWithEdits(revision, merged);
    if (!checked.ok) {
      continue;
    }
    const changedFunction = checked.value.checkedModule(module.module)
      ?.functions.get(signature.id);
    if (changedFunction === undefined || changedFunction.body === undefined) {
      continue;
    }
    const remaining = missingEntries(changedFunction, changedFunction.body);
    if (remaining.failures.length > 0 || remaining.uses.length > 0) {
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
    {
      const _appendTarget7 = output;
      const _appendValue8 = {
        title: `Add missing ${
          missingClauseName(missingFailures, missingUses)
        } entries`,
        function: signature.id,
        edits: merged,
      };
      _appendTarget7[_appendTarget7.length] = _appendValue8;
    }
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
  path: EditorPath,
  start: EditorOffset,
): readonly ContractAction[] {
  const module = revision.checkedModuleAt(path);
  if (module === undefined || !isSourcePath(path)) {
    return [];
  }
  const binding13 = module;
  const tree = binding13.tree;
  for (const fn of module.functions.values()) {
    const binding14 = fn;
    const signature = binding14.signature;
    const token = arrowHeaderOf(tree, signature.node)?.token;
    if (
      token === undefined || start < signature.span.start ||
      start > tree.ends[token]
    ) {
      continue;
    }
    // The headers of two functions never overlap: this is the only candidate.
    const entry = revision.moduleInfo(module.module)?.index.byName.get(
      signature.name,
    );
    if (
      signature.annotation !== "arrow" || !signature.written.result ||
      signature.written.fails || fn.body === undefined ||
      entry === undefined || entry.broken ||
      diagnosticInside(revision, module.path, signature.span, undefined)
    ) {
      return [];
    }
    const names = fn.failures.map((id) =>
      effectName(revision, module.module, id)
    );
    if (names.some((n) => n === undefined)) {
      return [];
    }
    const at = resultEndOf(tree, signature.node);
    if (at < 0) {
      return [];
    }
    const clause = ` fails ${names.length === 0 ? "never" : names.join(" | ")}`;
    const edits: SourceEdit[] = [{
      span: { source: path, start: at, end: at },
      text: clause,
    }];
    const checked = reviseWithEdits(revision, edits);
    if (!checked.ok) {
      return [];
    }
    const changed = checked.value.checkedModule(module.module)?.functions.get(
      signature.id,
    );
    if (
      changed === undefined || changed.mode !== fn.mode ||
      !sameIds(changed.failures, fn.failures) ||
      !sameIds(changed.requirements, fn.requirements) ||
      diagnosticDelta(revision.diagnostics, checked.value.diagnostics, edits)
          .added.length > 0
    ) {
      return [];
    }
    return [{ title: `Write${clause}`, function: signature.id, edits: edits }];
  }
  return [];
}
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function clauseEdit(
  tree: SyntaxTree,
  path: string,
  clause: NodeId | undefined,
  keyword: string,
  names: readonly (string | undefined)[],
  fallback: number,
): SourceEdit {
  const list = names.join(" | ");
  if (clause === undefined) {
    return {
      span: { source: path, start: fallback, end: fallback },
      text: `${keyword} ${list} `,
    };
  }
  // A clause that holds only `never` has no entry to extend: replace it.
  const end = tree.ends[clause];
  if (isNeverClause(tree.text.slice(tree.starts[clause], end))) {
    return {
      span: { source: path, start: end - "never".length, end: end },
      text: list,
    };
  }
  return { span: { source: path, start: end, end: end }, text: ` | ${list}` };
}
function isNeverClause(text: string): boolean {
  if (!text.endsWith("never")) return false;
  const prefix = text.slice(0, -5);
  const end = [...prefix].findIndex((char) =>
    !(char >= "a" && char <= "z") && !(char >= "A" && char <= "Z") &&
    !(char >= "0" && char <= "9") && char !== "_"
  );
  return end > 0 && prefix.slice(end).trim() === "";
}
function missingClauseName(
  failures: readonly string[],
  uses: readonly string[],
): string {
  if (failures.length === 0) return "with";
  return uses.length > 0 ? "fails and with" : "fails";
}
