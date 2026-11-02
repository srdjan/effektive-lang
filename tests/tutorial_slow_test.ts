// Runs the tutorial commands on a copy of `fixtures/tutorial/`: build with
// target checking, type-check the entry point, and run it.

import { assertEquals, assertNotEquals } from "@std/assert";
import { tscLock } from "../src/cli/tsc.ts";
import { copyDirectory, FIXTURES } from "./helpers.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";
import { validationProblems } from "./validate_helpers.ts";

async function run(args: string[], cwd: string | URL): Promise<string> {
  const result = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(result.stdout);
  assertEquals(result.code, 0, decoder.decode(result.stderr) + stdout);
  return stdout;
}

Deno.test("the tutorial project builds, type-checks, and prints the shown output", async () => {
  await withTemporaryDirectory("effektive-tutorial-", async (dir) => {
    copyDirectory(new URL("tutorial/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/deno.lock`, tscLock());
    await run(
      ["task", "effektive", "build", dir, "--tsc"],
      new URL("../", import.meta.url),
    );
    assertEquals(validationProblems(dir), []);
    const root = new URL("../", import.meta.url);
    const entry = [
      "--config",
      `${dir}/deno.json`,
      `--lock=${dir}/deno.lock`,
      `${dir}/main.ts`,
    ];
    await run(["check", ...entry], root);
    const output = await run(["run", ...entry], root);
    const tutorial = Deno.readTextFileSync(
      new URL("../docs/tutorial.md", import.meta.url),
    );
    assertEquals(
      output.trim(),
      '{"dune":1,"emma":"no copies of b2","lines":["lent Dune","closed"]}',
    );
    assertEquals(tutorial.includes(`\`\`\`text\n${output}\`\`\``), true);

    const host = Deno.readTextFileSync(`${dir}/main.ts`);
    const negativeInventory = host.replace(
      'title: "Emma", copies: 0',
      'title: "Emma", copies: -1',
    );
    assertNotEquals(negativeInventory, host);
    Deno.writeTextFileSync(`${dir}/main.ts`, negativeInventory);
    assertEquals(await run(["run", ...entry], root), output);
  });
});
