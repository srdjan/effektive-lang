// The project entry of the IR validator. It validates the IR that
// `lowerProject` returns, reading source texts through the project.
// The validator is a test oracle. No entry point (`frontend.ts`,
// `typescript.ts`, `mod.ts`) exports this file, so the CLI, the language
// server, and the playground do not load it. Tests import it directly.
//
// The project entry also binds each import payload to the producer IR of the
// same call (`validation/009`). A consumer IR that a stale build left behind
// then fails against a new producer. A host import, a prelude import, and an
// absent producer are skipped.
//
// This file sits outside `validate/` because it reads the project type. The
// validator itself stays independent of the checker and the lowering.

import {
  type Diagnostic,
  makeDiagnostic,
  normalizeDiagnostics,
} from "./diagnostics.ts";
import type { LowerError } from "./lower.ts";
import type { Import, ModuleIR } from "./ir.ts";
import type { Result } from "./source.ts";
import type { Project } from "./project.ts";
import { validateModule } from "./validate/index.ts";
import { isRecord } from "./validate/guards.ts";
import { PRELUDE_MODULE } from "./validate/world_table.ts";

/** The part of a project that the validator reads: its modules. */
type ProjectModules = Pick<Project, "modules">;

/** The prefix of a host import. It names a host module and has no producer IR. */
const HOST_PREFIX = "host:";

/** A value that the IR holds: JSON data. */
type Json = unknown;

/** The text of one side of a difference. */
function shown(value: Json): string {
  if (value === undefined) return "no value";
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) return "an object";
  return JSON.stringify(value);
}

/**
 * The path and the sides of the first difference of two IR values, or
 * undefined when they are equal. An object key named `span` is ignored. An
 * array is compared by position.
 */
function firstDifference(
  imported: Json,
  produced: Json,
  path: string,
): string | undefined {
  if (Array.isArray(imported) && Array.isArray(produced)) {
    if (imported.length !== produced.length) {
      return describe(path, imported, produced);
    }
    for (const [i, item] of imported.entries()) {
      const found = firstDifference(item, produced[i], `${path}[${i}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(imported) && isRecord(produced)) {
    const keys = new Set([...Object.keys(imported), ...Object.keys(produced)]);
    for (const key of [...keys].sort()) {
      if (key === "span") continue;
      const found = firstDifference(
        imported[key],
        produced[key],
        `${path}.${key}`,
      );
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return imported === produced ? undefined : describe(path, imported, produced);
}

function describe(path: string, imported: Json, produced: Json): string {
  return `${path}: the import has ${shown(imported)}, the producer has ${
    shown(produced)
  }`;
}

/** The declarations that a module holds or carries in its import payloads, by identity. */
function knownDeclarations(producer: ModuleIR): ReadonlyMap<string, Json> {
  const known = new Map<string, Json>();
  const add = (id: string, declaration: Json) => {
    if (!known.has(id)) known.set(id, declaration);
  };
  for (const d of producer.declarations) {
    // A value keeps its identity, name, and type in an import payload.
    add(
      d.id,
      d.kind === "function" || d.kind === "constant"
        ? { id: d.id, name: d.name, type: d.type }
        : d,
    );
  }
  for (const imp of producer.imports) {
    for (const [id, entry] of payloadEntries(imp)) add(id, entry);
  }
  return known;
}

/** The entries of an import payload, each with its identity. */
function payloadEntries(imp: Import): readonly (readonly [string, Json])[] {
  return [
    ...imp.types.map((t) => [t.id, t] as const),
    ...imp.errors.map((e) => [e.id, e] as const),
    ...imp.services.map((s) => [s.id, s] as const),
    ...imp.values.map((v) => [v.id, v] as const),
  ];
}

/**
 * The first difference between one import payload and the export of its
 * producer, or undefined when they agree. A host or prelude import and an
 * absent producer have no producer IR to compare. The comparison does not call
 * the checker. It compares the IR values, and it ignores spans.
 */
function importDifference(
  imp: Import,
  producer: ModuleIR | undefined,
): string | undefined {
  if (
    producer === undefined || imp.module === PRELUDE_MODULE ||
    imp.module.startsWith(HOST_PREFIX)
  ) return undefined;
  const exported = new Set<string>(producer.exports);
  for (const id of imp.exports) {
    if (!exported.has(id)) {
      return `${id}: the import has an export, the producer has none`;
    }
  }
  for (const binding of imp.bindings) {
    if (!exported.has(binding.target)) {
      return `${binding.target}: the import binds ${binding.name}, the producer has no such export`;
    }
  }
  const known = knownDeclarations(producer);
  for (const [id, entry] of payloadEntries(imp)) {
    const found = known.get(id);
    // The owner is the module part of an identity such as `type:lib#Count`.
    const owner = /^[^:#]+:([^#]+)#/.exec(id)?.[1];
    if (found === undefined && owner !== imp.module) continue;
    const difference = firstDifference(entry, found, id);
    if (difference !== undefined) return difference;
  }
  return undefined;
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
  // The source texts, keyed by the root-relative paths that spans use.
  const sources = new Map<string, string>();
  for (const info of project.modules.values()) {
    sources.set(info.path, info.tree.text);
  }
  const result = new Map<string, readonly Diagnostic[]>();
  for (const [name, module] of lowered) {
    if (!module.ok) continue;
    const diagnostics = validateModule(module.value, sources);
    const at = {
      source: project.modules.get(name)?.path ?? name,
      start: 0,
      end: 0,
    };
    const found: Diagnostic[] = [];
    const recorded = module.value?.module;
    if (recorded !== name) {
      found.push(
        makeDiagnostic(
          "validation/001",
          `module: expected the lowered module ${name}, recorded ${recorded}`,
          at,
        ),
      );
    }
    module.value.imports.forEach((imp, index) => {
      const producer = lowered.get(imp.module);
      const difference = importDifference(
        imp,
        producer?.ok ? producer.value : undefined,
      );
      if (difference === undefined) return;
      found.push(
        makeDiagnostic(
          "validation/009",
          `imports[${index}]: the import of ${imp.module} in ${name} differs from the producer ${imp.module} at ${difference}`,
          at,
        ),
      );
    });
    result.set(
      name,
      found.length === 0
        ? diagnostics
        : normalizeDiagnostics([...found, ...diagnostics]),
    );
  }
  return result;
}
