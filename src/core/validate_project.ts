// The project entry of the IR validator. It validates the IR that
// `lowerProject` returns, reading source texts through the project.
// The validator is a test oracle. No entry point (`frontend.ts`,
// `typescript.ts`, `mod.ts`) exports this file, so the CLI, the language
// server, and the playground do not load it. Tests import it directly.
//
// This file sits outside `validate/` because it reads the project type. The
// validator itself stays independent of the checker and the lowering.

import {
  type Diagnostic,
  makeDiagnostic,
  normalizeDiagnostics,
} from "./diagnostics.ts";
import type { LowerError } from "./lower.ts";
import type { ModuleIR, Result } from "./ir.ts";
import type { Project } from "./project.ts";
import { validateModule } from "./validate/index.ts";

/** The part of a project that the validator reads: its modules. */
export type ProjectModules = Pick<Project, "modules">;

/** The source texts of a project, keyed by the root-relative paths that spans use. */
function projectSources(project: ProjectModules): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const info of project.modules.values()) {
    sources.set(info.path, info.tree.text);
  }
  return sources;
}

/**
 * Validates every module that lowered. The result maps a module name to its
 * validation diagnostics; an empty list means the module is valid. A module
 * whose lowering gave an error value has no IR and has no entry.
 */
export function validateProject(
  project: ProjectModules,
  lowered: ReadonlyMap<string, Result<ModuleIR, LowerError>>,
): ReadonlyMap<string, readonly Diagnostic[]> {
  const sources = projectSources(project);
  const result = new Map<string, readonly Diagnostic[]>();
  for (const [name, module] of lowered) {
    if (!module.ok) continue;
    const diagnostics = validateModule(module.value, sources);
    const recorded = module.value?.module;
    result.set(
      name,
      recorded === name ? diagnostics : normalizeDiagnostics([
        makeDiagnostic(
          "validation/001",
          `module: expected the lowered module ${name}, recorded ${recorded}`,
          { source: project.modules.get(name)?.path ?? name, start: 0, end: 0 },
        ),
        ...diagnostics,
      ]),
    );
  }
  return result;
}
