// Helpers for the slow emitter tests. This file holds no test: a test in a
// helper file runs again in each file that imports the helper.

import { assert, assertEquals } from "@std/assert";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "../src/cli/tsc.ts";
import { checkProject } from "../src/core/check_project.ts";
import { emitProject, type EmittedModule } from "../src/core/typescript.ts";
import { lowerProject } from "../src/core/lower.ts";
import type { Project } from "../src/core/project.ts";
import type { SourceHost } from "../src/core/source.ts";
import { copyDirectory, EXAMPLE_ENTRIES, FIXTURES } from "./helpers.ts";
import { deno, withTemporaryDirectory } from "./process_helpers.ts";

const DENO_CONFIG = JSON.stringify(
  {
    compilerOptions: TARGET_COMPILER_OPTIONS,
    imports: TARGET_IMPORTS,
  },
  null,
  2,
);

/** A host that reads from the file system. Paths are absolute. */
export const fileHost: SourceHost = {
  readText(path: string) {
    try {
      return { ok: true, value: Deno.readTextFileSync(path) };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return { ok: false, error: { tag: "not-found", path } };
      }
      return {
        ok: false,
        error: {
          tag: "unreadable",
          path,
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  },
};

export interface Built {
  /** The root-relative generated paths. */
  readonly paths: string[];
  readonly project: Project;
  readonly emitted: ReadonlyMap<string, EmittedModule>;
}

/**
 * Builds the project in `root`: checks it, lowers it, emits it, and writes each
 * generated file next to its source. Returns the root-relative generated paths.
 */
export function build(root: string, entries: readonly string[]): string[] {
  return buildProject(root, entries).paths;
}

/** Like `build`, and also returns the project and the emitted modules. */
export function buildProject(root: string, entries: readonly string[]): Built {
  const checked = checkProject(fileHost, root, entries);
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(checked.value.diagnostics.map((d) => d.code), []);
  const emitted = emitProject(lowerProject(checked.value), {
    config: checked.value.analysis.project.config,
  });
  const paths: string[] = [];
  const modules = new Map<string, EmittedModule>();
  for (const [name, module] of emitted) {
    assert(module.ok, `${name}: ${JSON.stringify(module)}`);
    const target = `${root}/${module.value.path}`;
    Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    Deno.writeTextFileSync(target, module.value.text);
    paths.push(module.value.path);
    modules.set(name, module.value);
  }
  Deno.writeTextFileSync(`${root}/deno.json`, DENO_CONFIG);
  return {
    paths,
    project: checked.value.analysis.project,
    emitted: modules,
  };
}

export function withTemporary<T>(
  body: (dir: string) => Promise<T>,
): Promise<T> {
  return withTemporaryDirectory("effektive-emit-", body);
}

export async function check(
  dir: string,
  files: readonly string[],
): Promise<void> {
  const run = await deno(dir, ["check", "--config", "deno.json", ...files]);
  assertEquals(run.code, 0, `deno check failed:\n${run.stderr}`);
}

export function buildExamples(dir: string): string[] {
  copyDirectory(new URL("examples/", FIXTURES), dir);
  return build(dir, EXAMPLE_ENTRIES);
}

/** The forms module in a deep directory, with long names and long strings. */
export const LONG_NAMES =
  "a-very-long-directory-name-for-the-module-path/and-another-nested-part/long-names";

export function buildForms(dir: string): string[] {
  copyDirectory(new URL("emit/forms/", FIXTURES), dir);
  return build(dir, [
    "forms.eff",
    "names.eff",
    "conditional-chains.eff",
    "nominal-records.eff",
    "data-types.eff",
    "recursive-data.eff",
    "optional-fields.eff",
    "brand-operators.eff",
    "inline-records.eff",
    "array-bodies.eff",
    "literal-results.eff",
    LONG_NAMES + ".eff",
  ]);
}
