// Guard test for the validator boundary: the independent IR validator is a
// test oracle. No module that the command-line tool, the language server, or
// the playground loads may reach `src/core/validate/` or
// `src/core/validate_project.ts`. The test reads the module graph from
// `deno info --json`, so it follows every import, including dynamic ones that
// Deno resolves.

import { assertEquals } from "@std/assert";

const ROOT = new URL("../", import.meta.url);

interface InfoModule {
  readonly specifier: string;
}

/** The specifiers of the modules that `deno info --json` lists for one entry point. */
async function graphOf(entry: string): Promise<readonly string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entry],
    cwd: new URL(".", ROOT),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
  const modules = (parsed as { readonly modules: readonly InfoModule[] })
    .modules;
  return modules.map((module) => module.specifier);
}

/** The modules of a graph that belong to the validator. */
function validatorModules(graph: readonly string[]): string[] {
  return graph.filter((specifier) =>
    specifier.includes("/src/core/validate/") ||
    specifier.endsWith("/src/core/validate_project.ts")
  );
}

const ENTRIES = [
  "src/cli/main.ts",
  "src/lsp/main.ts",
  "playground/src/app.ts",
] as const;

for (const entry of ENTRIES) {
  Deno.test(`${entry} does not load the IR validator`, async () => {
    const graph = await graphOf(entry);
    // Guard against a graph that is empty and so proves nothing.
    assertEquals(
      graph.some((specifier) => specifier.endsWith("/src/core/frontend.ts")),
      true,
    );
    assertEquals(validatorModules(graph), []);
  });
}
