// Slow test of the website examples. The sibling repository
// `../effektive/public/effektive-examples/` holds the examples that the website
// publishes. `fixtures/website-examples.json` lists each check unit: a project
// directory or a single file with its configuration and companion files. The
// test copies each unit into a temporary directory, runs `check` and then
// `build --tsc` through the CLI, and compares the diagnostics with the manifest.
// It never writes into the website copy. It is ignored when the sibling is absent.

import { assertEquals } from "@std/assert";
import { copyDirectory } from "./helpers.ts";
import { type Run, withTemporaryDirectory } from "./process_helpers.ts";

const REPOSITORY = new URL("../", import.meta.url).pathname;
const EXAMPLES = new URL(
  "../../effektive/public/effektive-examples/",
  import.meta.url,
);
const MANIFEST = new URL("../fixtures/website-examples.json", import.meta.url);

/** One check unit of the manifest. `diagnostics` holds the exact `check` diagnostic lines. */
interface Unit {
  readonly path: string;
  readonly kind: "project" | "file";
  readonly configuration?: unknown;
  readonly companions?: readonly string[];
  readonly diagnostics: readonly string[];
}

function examplesExist(): boolean {
  try {
    return Deno.statSync(EXAMPLES).isDirectory;
  } catch {
    return false;
  }
}

async function effektive(args: readonly string[]): Promise<Run> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["task", "effektive", ...args, "--no-log"],
    cwd: REPOSITORY,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

/** The diagnostic lines of a run: every line that holds ` error ` or ` warning `. */
function diagnosticLines(run: Run): readonly string[] {
  return (run.stdout + run.stderr)
    .split("\n")
    .filter((line) => / (error|warning) /.test(line));
}

/** Copies the unit into `dir` and returns the directory that holds the project. */
function stage(unit: Unit, dir: string): string {
  if (unit.kind === "project") {
    copyDirectory(new URL(`${unit.path}/`, EXAMPLES), `${dir}/project`);
    return `${dir}/project`;
  }
  const project = `${dir}/project`;
  Deno.mkdirSync(project);
  Deno.writeTextFileSync(
    `${project}/effektive.json`,
    JSON.stringify(unit.configuration),
  );
  for (const name of [unit.path, ...(unit.companions ?? [])]) {
    const target = `${project}/${name}`;
    Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    Deno.copyFileSync(new URL(name, EXAMPLES), target);
  }
  return project;
}

if (!examplesExist()) {
  console.warn("website examples ignored: ../effektive/public is absent");
}

function isUnit(value: unknown): value is Unit {
  if (typeof value !== "object" || value === null) return false;
  const unit: Record<string, unknown> = { ...value };
  return typeof unit.path === "string" &&
    (unit.kind === "project" || unit.kind === "file") &&
    Array.isArray(unit.diagnostics) &&
    unit.diagnostics.every((line) => typeof line === "string") &&
    (unit.companions === undefined ||
      (Array.isArray(unit.companions) &&
        unit.companions.every((name) => typeof name === "string")));
}

/** The units of the manifest. A malformed manifest throws, so the test file fails at load. */
function readUnits(): readonly Unit[] {
  const manifest: unknown = JSON.parse(Deno.readTextFileSync(MANIFEST));
  const units: unknown = typeof manifest === "object" && manifest !== null &&
      "units" in manifest
    ? manifest.units
    : undefined;
  if (!Array.isArray(units) || !units.every(isUnit)) {
    throw new Error(`${MANIFEST.pathname} is not a list of units`);
  }
  return units;
}

const UNITS: readonly Unit[] = examplesExist() ? readUnits() : [];

Deno.test({
  name:
    "website examples: the manifest lists every example project and source file",
  ignore: !examplesExist(),
  fn: () => {
    const found: string[] = [];
    for (const entry of Deno.readDirSync(EXAMPLES)) {
      if (entry.isFile && entry.name.endsWith(".eff")) found.push(entry.name);
      if (entry.isDirectory && entry.name !== "host") found.push(entry.name);
    }
    assertEquals(found.sort(), UNITS.map((unit) => unit.path).sort());
  },
});

for (const unit of UNITS) {
  Deno.test({
    name:
      `website example ${unit.path} gives its listed diagnostics and builds`,
    fn: async () => {
      await withTemporaryDirectory("eff-website-", async (dir) => {
        const project = stage(unit, dir);
        const checked = await effektive(["check", project]);
        assertEquals(
          diagnosticLines(checked),
          unit.diagnostics,
          checked.stderr,
        );
        assertEquals(checked.code, unit.diagnostics.length === 0 ? 0 : 1);
        if (unit.diagnostics.length > 0) return;
        const built = await effektive(["build", project, "--tsc"]);
        assertEquals(built.code, 0, built.stdout + built.stderr);
      });
    },
  });
}
