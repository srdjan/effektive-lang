// Slow test of the directory walk with real symbolic links. The test works in a
// temporary directory that the helper removes.

import { assert, assertEquals } from "@std/assert";
import { withTemporaryDirectory } from "./process_helpers.ts";

const REPOSITORY = new URL("../", import.meta.url).pathname;

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
