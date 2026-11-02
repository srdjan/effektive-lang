// The write-back of `effektive check --fix`: the contract quick fix, applied to
// every `.eff` module in rounds over an in-memory copy of the inputs.

import {
  applySourceEdits,
  compareText,
  contractActionsAt,
  Program,
  type Revision,
} from "../core/mod.ts";

export interface FixOutcome {
  /** The new text of each `.eff` file that changed, by root-relative path. */
  readonly texts: ReadonlyMap<string, string>;
  /** The number of distinct functions that received an edit, over all rounds. */
  readonly functions: number;
}

/**
 * Adds the missing `fails` and `uses` entries of the exported functions. A
 * round applies the actions of all modules and checks the edited inputs again.
 * The loop ends after a round that changes no text. A fix in one module can
 * make a closed caller in another module miss an entry, and the next round
 * fixes that caller.
 */
export function fixContracts(first: Revision): FixOutcome {
  const original = first.inputs();
  const functions = new Set<string>();
  let revision = first;
  while (true) {
    const files = new Map(revision.inputs());
    const touched: string[] = [];
    for (const path of [...files.keys()].sort(compareText)) {
      const text = files.get(path) ?? "";
      const actions = contractActionsAt(revision, path, 0, text.length, true);
      const next = applySourceEdits(text, actions.flatMap((a) => a.edits));
      if (next === text) continue;
      files.set(path, next);
      for (const action of actions) touched.push(action.function);
    }
    if (touched.length === 0) break;
    const updated = new Program(revision.root).update({ set: files });
    if (!updated.ok) break;
    for (const id of touched) functions.add(id);
    revision = updated.value;
  }
  const texts = new Map<string, string>();
  for (const [path, text] of revision.inputs()) {
    if (original.get(path) !== text) texts.set(path, text);
  }
  return { texts, functions: functions.size };
}
