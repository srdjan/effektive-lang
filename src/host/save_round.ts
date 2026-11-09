// The output step of a save round, shared by `build`, `watch`, and the
// language server: remove the outputs of modules that left the project, then
// write the outputs of every writable module that the project owns.
//
// The round is synchronous and prints and logs nothing. It returns one removal
// record per module, so that each caller keeps its own messages and their order.

import type { TypeScriptOutputs } from "../core/typescript.ts";
import { CONFIG_FILE, joinPath, type Revision } from "../core/mod.ts";
import type { HostFs } from "./io.ts";
import { generationSource } from "./generation.ts";
import {
  type GeneratedOutputs,
  type HeldReason,
  planWrites,
  removeStaleOutputs,
  writeGenerated,
} from "./outputs.ts";

/** What a round does with a module whose output removal failed. */
type RemovalRule =
  /** Keep the module in `modules`, so that the next round tries again (LSP). */
  | "retry"
  /** Drop the module, so that no later round tries again (CLI watch). */
  | "forget";

interface SaveRoundInput {
  readonly fs: HostFs;
  readonly root: string;
  readonly revision: Revision;
  readonly outputs: TypeScriptOutputs;
  /** The `modules` of the previous round. `build` passes `[]` and removes nothing. */
  readonly previous: readonly string[];
  readonly removal: RemovalRule;
  /** False for a module that a nested project owns. Callers pass `ownedByRoot`. */
  readonly owns: (name: string) => boolean;
  readonly write: boolean;
}

/** The removal of the outputs of one module that left the project. */
export interface ModuleRemoval {
  readonly name: string;
  readonly removed: readonly string[];
  readonly notes: readonly string[];
}

interface SaveRound {
  /** Pass this as `previous` to the next round. */
  readonly modules: readonly string[];
  /** One entry per module that left, in the order of `previous`. */
  readonly removals: readonly ModuleRemoval[];
  /** The writable modules, before the `owns` filter. */
  readonly writable: readonly string[];
  /** The reason for each module that is not written, before the `owns` filter. */
  readonly held: ReadonlyMap<string, HeldReason>;
  readonly outputs: GeneratedOutputs;
}

/**
 * True when the project at `root` owns the module `name`: no directory between
 * the root and the module holds its own `effektive.json`. A nested project
 * writes and removes the outputs of its own modules.
 */
export function ownedByRoot(fs: HostFs, root: string, name: string): boolean {
  const parts = name.split("/").slice(0, -1);
  for (let n = 1; n <= parts.length; n++) {
    const dir = joinPath(root, parts.slice(0, n).join("/"));
    const path = joinPath(dir, CONFIG_FILE);
    const entry = fs.entryKind(path);
    if (!entry.ok) return false;
    if (entry.value === "missing") continue;
    if (fs.kind(path) !== "directory") return false;
  }
  return true;
}

export function runSaveRound(input: SaveRoundInput): SaveRound {
  const { fs, root, revision, owns } = input;
  const names = revision.moduleNames();
  const present = new Set(names);
  const removals: ModuleRemoval[] = [];
  const kept: string[] = [];
  for (const name of input.previous) {
    if (present.has(name) || !owns(name)) continue;
    const { removed, notes } = removeStaleOutputs(fs, root, [name]);
    removals.push({ name, removed, notes });
    if (input.removal === "retry" && notes.length > 0) kept.push(name);
  }
  const { writable, held } = planWrites(revision);
  const outputs = writeGenerated(
    fs,
    root,
    generationSource(revision, input.outputs),
    writable.filter(owns),
    input.write,
  );
  return { modules: [...names, ...kept], removals, writable, held, outputs };
}
