// Validation of a revision for tests. The validator is a test oracle, and a
// revision does not carry it. This helper reads the module infos of the
// revision and calls `validateProject` with them.

import {
  type Diagnostic,
  type LowerError,
  type ModuleIR,
  Program,
  type Result,
  type Revision,
} from "../src/core/mod.ts";
import { validateProject } from "../src/core/validate_project.ts";

/** Validates the lowered modules of `revision`. A key is a module name. */
export function validateRevision(
  revision: Revision,
  lowered: ReadonlyMap<string, Result<ModuleIR, LowerError>>,
): ReadonlyMap<string, readonly Diagnostic[]> {
  const modules = new Map(
    revision.moduleNames().flatMap((name) => {
      const info = revision.moduleInfo(name);
      return info === undefined ? [] : [[name, info] as const];
    }),
  );
  return validateProject({ modules }, lowered);
}

/** The text of each source file under `dir`, keyed by the path relative to `dir`. */
function sourceFilesOf(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of Deno.readDirSync(`${dir}/${prefix}`)) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === ".effektive") continue;
      Object.assign(files, sourceFilesOf(dir, `${path}/`));
    } else if (/\.(?:eff|effi)$|^effektive\.json$/.test(entry.name)) {
      files[path] = Deno.readTextFileSync(`${dir}/${path}`);
    }
  }
  return files;
}

/**
 * Loads the Effektive project in `dir`, lowers each module, and validates the
 * IR. Returns one line for each diagnostic of the validator, and the lowering
 * failures. An empty list means the validator accepts the project.
 */
export function validationProblems(dir: string): string[] {
  const loaded = new Program().update({ set: sourceFilesOf(dir) });
  if (!loaded.ok) return [`project: ${JSON.stringify(loaded.error)}`];
  const revision = loaded.value;
  const lowered = new Map<string, Result<ModuleIR, LowerError>>();
  for (const name of revision.moduleNames()) {
    const result = revision.lowered(name);
    if (result !== undefined) lowered.set(name, result);
  }
  const problems = [...lowered].flatMap(([name, result]) =>
    result.ok ? [] : [`${name}: lowering failed`]
  );
  for (const [name, found] of validateRevision(revision, lowered)) {
    for (const item of found) {
      problems.push(`${name}: ${item.code} ${item.message}`);
    }
  }
  return problems;
}
