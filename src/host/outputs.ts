// The emit-and-write step of a build, shared by `build`, `watch`, and the
// language server: emit each named module, build its source map, and write the
// generated file and the map when their text changed.

import {
  type EmitProjectError,
  generatedPathOf,
  generatedSourceOf,
  type LowerError,
  type Revision,
  serializeSourceMap,
  type SpanTable,
} from "../core/mod.ts";
import type { HostFs } from "./io.ts";
import type { GeneratedSource } from "./generation.ts";
import { containedProjectPath } from "./workspace.ts";

export interface GeneratedOutputs {
  /** The root-relative paths of the files that changed on disk. */
  readonly written: string[];
  /** The root-relative paths of the generated modules, in the order of `names`. */
  readonly generated: string[];
  /** The span table of each generated path. */
  readonly tables: Map<string, SpanTable>;
  /** Messages for stderr. */
  readonly notes: string[];
  /** True when a module failed to lower, emit, map, or write. */
  readonly failed: boolean;
}

function describeLowerError(error: LowerError): string {
  switch (error.tag) {
    case "diagnostics":
      return `${error.module} has ${error.count} diagnostics`;
    case "unknown-module":
      return `${error.module}: ${error.tag}`;
    case "no-interface":
      return `${error.module} imports ${error.imported}, which has no interface`;
    case "internal":
      return `${error.module}: ${error.message}`;
  }
}

function describeEmitError(error: EmitProjectError): string {
  switch (error.tag) {
    case "lowering":
      return describeLowerError(error.error);
    case "internal":
      return error.message;
  }
}

/** Why a module is not written. A caller words it for its own output. */
export type HeldReason =
  /** The module has diagnostics of its own. */
  | { readonly tag: "diagnostics"; readonly count: number }
  /** The module imports `target`, which is not written. */
  | { readonly tag: "import"; readonly target: string }
  /** The module cannot be lowered. */
  | { readonly tag: "lowering" };

export interface WritePlan {
  /**
   * The modules that a build writes, in the order of `revision.moduleNames()`.
   * A module that imports a module that is not written is not written either,
   * because its generated import would not load. A module whose own lowering
   * failed stays in the list, and `writeGenerated` skips it.
   */
  readonly writable: readonly string[];
  /** The reason for each module that is not written, in the order of `moduleNames()`. */
  readonly held: ReadonlyMap<string, HeldReason>;
}

export function planWrites(revision: Revision): WritePlan {
  const names = revision.moduleNames();
  const passed = new Set(names);
  const writable = (name: string): boolean => {
    const lowered = revision.lowered(name);
    return lowered !== undefined && lowered.ok && passed.has(name);
  };
  // A fixpoint, because one forward pass is wrong inside an import cycle.
  // The graph also holds host interface targets: their companion modules count.
  for (let changed = true; changed;) {
    changed = false;
    for (const name of [...passed]) {
      if (revision.imports(name).some((target) => !writable(target))) {
        passed.delete(name);
        changed = true;
      }
    }
  }
  const held = new Map<string, HeldReason>();
  for (const name of names) {
    if (writable(name)) continue;
    held.set(name, heldReasonOf(revision, name, writable));
  }
  return { writable: [...passed], held };
}

function heldReasonOf(
  revision: Revision,
  name: string,
  writable: (name: string) => boolean,
): HeldReason {
  const lowered = revision.lowered(name);
  if (lowered !== undefined && !lowered.ok) {
    if (lowered.error.tag === "diagnostics") {
      return { tag: "diagnostics", count: lowered.error.count };
    }
  }
  const blocker = revision.imports(name).find((target) => !writable(target));
  if (blocker !== undefined) return { tag: "import", target: blocker };
  return { tag: "lowering" };
}

export function writableModules(revision: Revision): string[] {
  return [...planWrites(revision).writable];
}

/**
 * Emits the named modules of the revision. With `write` true, it writes the
 * generated file and its map under `root` for each module whose text changed:
 * `<module>.ts` for `.eff`, `<module>.effi.ts` for `.effi`. A module with
 * diagnostics is skipped without a note: the caller reports it. The caller also leaves out the modules that failed validation.
 */
export function writeGenerated(
  fs: HostFs,
  root: string,
  source: GeneratedSource,
  names: readonly string[],
  write: boolean,
): GeneratedOutputs {
  const written: string[] = [];
  const generated: string[] = [];
  const tables = new Map<string, SpanTable>();
  const notes: string[] = [];
  let failed = false;
  for (const name of names) {
    const output = source.generated(name);
    switch (output.kind) {
      case "skip":
        continue;
      case "lower":
        notes.push(
          `error: cannot lower ${describeLowerError(output.error)}`,
        );
        failed = true;
        continue;
      case "emit":
        notes.push(
          `error: cannot emit ${name}: ${describeEmitError(output.error)}`,
        );
        failed = true;
        continue;
      case "map":
        notes.push(
          `error: cannot build the source map of ${name}: source ${output.error.source} is missing`,
        );
        failed = true;
        continue;
      case "ready":
        break;
      default: {
        const unreachable: never = output;
        return unreachable;
      }
    }
    const { emitted, table, map } = output;
    if (write) {
      const outputs: [string, string][] = [
        [emitted.path, emitted.text],
        [`${emitted.path}.map`, serializeSourceMap(map)],
      ];
      const targets: [string, string, string][] = [];
      let blocked = false;
      for (const [path, text] of outputs) {
        const target = containedProjectPath(fs, root, path);
        if (!target.ok) {
          notes.push(`error: cannot write ${path}: ${target.error.message}`);
          failed = true;
          blocked = true;
          break;
        }
        targets.push([path, text, target.value]);
      }
      if (blocked) continue;
      // The `.ts` file decides for the pair. A file that this source did not
      // generate stays, with its map unwritten and the module left out.
      const owner = generatedSourceOf(emitted.text);
      const existing = fs.readText(targets[0][2]);
      if (!existing.ok && existing.error.tag === "unreadable") {
        notes.push(
          `error: cannot read ${emitted.path}: ${existing.error.message}`,
        );
        failed = true;
        continue;
      }
      if (
        existing.ok && existing.value !== emitted.text &&
        (owner === undefined || generatedSourceOf(existing.value) !== owner)
      ) {
        notes.push(
          `error: cannot write ${emitted.path}: the file exists and is not generated from ${
            owner ?? name
          }. Move or delete it.`,
        );
        failed = true;
        continue;
      }
      for (const [path, text, full] of targets) {
        const old = path === emitted.path ? existing : fs.readText(full);
        if (old.ok && old.value === text) continue;
        const result = fs.writeText(full, text);
        if (result.ok) {
          written.push(path);
        } else {
          notes.push(`error: cannot write ${path}: ${result.error.message}`);
          failed = true;
        }
      }
    }
    generated.push(emitted.path);
    tables.set(emitted.path, table);
  }
  return { written, generated, tables, notes, failed };
}

/**
 * Removes the outputs of modules that left the project. A module that left has
 * no known mode, so each named module tries `<module>.ts` for `<module>.eff` and
 * `<module>.effi.ts` for `<module>.effi`, each with its `.map`. A `.ts` file goes
 * only when its first line is the emitter header of that source, so a
 * hand-written file at the same path stays. The map goes only together with its
 * `.ts` file, and before it. Returns the root-relative paths that it removed,
 * and messages for stderr.
 */
export function removeStaleOutputs(
  fs: HostFs,
  root: string,
  modules: readonly string[],
): { readonly removed: string[]; readonly notes: string[] } {
  const removed: string[] = [];
  const notes: string[] = [];
  for (const module of modules) {
    for (const source of [`${module}.eff`, `${module}.effi`]) {
      const path = generatedPathOf(source);
      const output = containedProjectPath(fs, root, path);
      if (!output.ok) {
        notes.push(`error: cannot remove ${path}: ${output.error.message}`);
        continue;
      }
      const read = fs.readText(output.value);
      if (!read.ok) {
        if (read.error.tag === "unreadable") {
          notes.push(`error: cannot read ${path}: ${read.error.message}`);
        }
        continue;
      }
      if (generatedSourceOf(read.value) !== source) continue;
      // The map goes first. When it fails, the `.ts` file keeps the header that
      // proves ownership, so a later call can retry. A missing file counts as removed.
      const targets: [string, string][] = [];
      let blocked = false;
      for (const target of [`${path}.map`, path]) {
        const contained = containedProjectPath(fs, root, target);
        if (!contained.ok) {
          notes.push(
            `error: cannot remove ${target}: ${contained.error.message}`,
          );
          blocked = true;
          break;
        }
        targets.push([target, contained.value]);
      }
      if (blocked) continue;
      for (const [target, full] of targets) {
        const existed = fs.kind(full) !== "missing";
        const result = fs.remove(full);
        if (result.ok) {
          if (existed) removed.push(target);
        } else {
          notes.push(`error: cannot remove ${target}: ${result.error.message}`);
          break;
        }
      }
    }
  }
  return { removed, notes };
}
