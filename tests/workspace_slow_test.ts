// Slow test of the directory walk with real symbolic links. The test works in a
// temporary directory that the helper removes.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { isRecord } from "../src/core/frontend.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";

const REPOSITORY = fromFileUrl(new URL("../", import.meta.url));

Deno.test("check ends on real symlink cycles and reads each module once", async () => {
  await withTemporaryDirectory("effektive-links-", async (dir) => {
    Deno.mkdirSync(`${dir}/project/sub`, { recursive: true });
    Deno.mkdirSync(`${dir}/sibling`);
    Deno.writeTextFileSync(`${dir}/project/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/project/a.eff`,
      "type I = int\nexport const a: I = 1\n",
    );
    Deno.writeTextFileSync(
      `${dir}/project/sub/b.eff`,
      "type I = int\nexport const b: I = 2\n",
    );
    Deno.writeTextFileSync(
      `${dir}/sibling/c.eff`,
      "type I = int\nexport const c: I = 3\n",
    );
    // An upward link, a link to a sibling of the root, and a cycle of two links.
    Deno.symlinkSync("..", `${dir}/project/sub/up`);
    Deno.symlinkSync("../../sibling", `${dir}/project/sub/side`);
    Deno.symlinkSync("missing", `${dir}/project/gone`);
    Deno.symlinkSync("y", `${dir}/project/x`);
    Deno.symlinkSync("x", `${dir}/project/y`);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["task", "effektive", "check", `${dir}/project`],
      cwd: REPOSITORY,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(60_000),
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    assert(stderr.includes("2 modules, 0 diagnostics"), stderr);
  });
});

Deno.test("workspace reads fail when inspection of a directory link is denied", async () => {
  await withTemporaryDirectory("effektive-link-inspection-", async (dir) => {
    const root = join(dir, "project");
    const hidden = join(root, ".sources");
    const link = join(root, "source");
    Deno.mkdirSync(hidden, { recursive: true });
    Deno.writeTextFileSync(join(root, "effektive.json"), "{}");
    Deno.writeTextFileSync(join(hidden, "a.eff"), "type I = int\n");
    Deno.writeTextFileSync(join(hidden, "host.ts"), "export const host = 1;\n");
    Deno.writeTextFileSync(join(hidden, "a.ts"), "previous output\n");
    Deno.writeTextFileSync(join(hidden, "a.ts.map"), "previous map\n");
    Deno.symlinkSync(hidden, link);
    const probe = join(dir, "probe.ts");
    const host = toFileUrl(join(REPOSITORY, "src/host/deno_io.ts")).href;
    const workspace = toFileUrl(join(REPOSITORY, "src/host/workspace.ts")).href;
    Deno.writeTextFileSync(
      probe,
      `import { denoFs } from ${JSON.stringify(host)};
import { readWorkspace, readTargetInputs } from ${JSON.stringify(workspace)};
const source = readWorkspace(denoFs, ${JSON.stringify(root)});
const target = readTargetInputs(denoFs, ${JSON.stringify(root)});
console.log(JSON.stringify({ source: source.ok, target: target.ok,
  sourceError: source.ok ? null : source.error,
  targetError: target.ok ? null : target.error }));
`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        `--allow-read=${REPOSITORY},${dir}`,
        `--deny-read=${hidden},${link}`,
        "--config",
        join(REPOSITORY, "deno.json"),
        probe,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const result: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
    assert(isRecord(result));
    assertEquals(result.source, false);
    assertEquals(result.target, false);
    assert(typeof result.sourceError === "string");
    assertStringIncludes(result.sourceError, link);
    assertEquals(result.targetError, result.sourceError);
    assertEquals(
      Deno.readTextFileSync(join(hidden, "a.ts")),
      "previous output\n",
    );
    assertEquals(
      Deno.readTextFileSync(join(hidden, "a.ts.map")),
      "previous map\n",
    );
  });
});

const NEEDS_FIX = [
  "export type Id = string",
  "export error Missing = { id: Id }",
  "export service Store {",
  "  find(id: Id): Id fails Missing",
  "}",
  "export const load = (id: Id): Id => Store.find(id)",
  "",
].join("\n");

const FIXED = [
  "export type Id = string",
  "export error Missing = { id: Id }",
  "export service Store {",
  "  find(id: Id): Id fails Missing",
  "}",
  "export const load = (id: Id): Id with Store => Store.find(id)",
  "",
].join("\n");

async function checkFix(root: string): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: ["task", "effektive", "check", root, "--fix", "--no-log"],
    cwd: REPOSITORY,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(60_000),
  }).output();
}

Deno.test("check --fix rejects a source link outside the project", async () => {
  await withTemporaryDirectory("effektive-source-link-", async (dir) => {
    const root = `${dir}/project`;
    const outside = `${dir}/outside.eff`;
    Deno.mkdirSync(root);
    Deno.writeTextFileSync(`${root}/effektive.json`, "{}");
    Deno.writeTextFileSync(outside, NEEDS_FIX);
    Deno.symlinkSync(outside, `${root}/main.eff`);

    const output = await checkFix(root);
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 2, stderr);
    assert(
      stderr.includes(
        "main.eff cannot be read: path resolves outside the project root",
      ),
      stderr,
    );
    assertEquals(Deno.readTextFileSync(outside), NEEDS_FIX);
  });
});

Deno.test("check --fix writes through a source link inside the project", async () => {
  await withTemporaryDirectory("effektive-source-link-", async (dir) => {
    const root = `${dir}/project`;
    Deno.mkdirSync(`${root}/.sources`, { recursive: true });
    Deno.writeTextFileSync(`${root}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${root}/.sources/main.eff`, NEEDS_FIX);
    Deno.symlinkSync(".sources/main.eff", `${root}/main.eff`);

    const output = await checkFix(root);
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    assertEquals(Deno.readTextFileSync(`${root}/.sources/main.eff`), FIXED);
  });
});
