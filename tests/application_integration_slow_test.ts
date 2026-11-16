import { assert, assertEquals } from "@std/assert";
import { checkProject, emitProject, memoryHost } from "../src/core/mod.ts";
import { deno, withTemporaryDirectory } from "./process_helpers.ts";
import { assertValidProject } from "./helpers.ts";

Deno.test("service workflow passes real loopback HTTP and file-backed SQLite acceptance", async () => {
  const base = new URL(
    "../fixtures/applications/service-workflow/",
    import.meta.url,
  );
  const files = Object.fromEntries(
    ["effektive.json", "contracts.eff", "host.effi", "workflow.eff"].map((
      name,
    ) => [
      name,
      Deno.readTextFileSync(new URL(name, base)),
    ]),
  );
  const project = checkProject(memoryHost(files), "", ["workflow.eff"]);
  assert(project.ok, JSON.stringify(project));
  const lowered = assertValidProject(project.value);
  await withTemporaryDirectory("effektive-http-sqlite-", async (dir) => {
    for (
      const name of [
        "deno.json",
        "adapter.ts",
        "integration_driver.ts",
        "integration_runtime_test.ts",
      ]
    ) {
      Deno.writeTextFileSync(
        `${dir}/${name}`,
        Deno.readTextFileSync(new URL(name, base)),
      );
    }
    for (
      const result of emitProject(lowered, {
        config: project.value.analysis.project.config,
      }).values()
    ) {
      assert(result.ok, JSON.stringify(result));
      Deno.writeTextFileSync(`${dir}/${result.value.path}`, result.value.text);
    }
    Deno.copyFileSync(
      new URL("./application_lock.json", import.meta.url),
      `${dir}/deno.lock`,
    );
    for (
      const args of [
        ["check", "--frozen", "integration_runtime_test.ts"],
        [
          "test",
          "--frozen",
          "--no-prompt",
          `--allow-read=${Deno.realPathSync(dir)}`,
          `--allow-write=${Deno.realPathSync(dir)}`,
          "--allow-net=127.0.0.1",
          "integration_runtime_test.ts",
        ],
      ]
    ) {
      const result = await deno(dir, args);
      assertEquals(result.code, 0, `${result.stderr}\n${result.stdout}`);
    }
  });
});
