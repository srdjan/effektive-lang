// Mutation tests of the bench modules. They call exported functions only. They
// write files, which the fast task has no permission for.

import { assert, assertEquals } from "@std/assert";
import { describeLspBenchError } from "../bench/lsp_script.ts";
import { runM7 } from "../bench/m7.ts";
import { writeTarget } from "../bench/m5_target.ts";

Deno.test("writeTarget adds the mark comment to the marked file only", () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-bench-target-" });
  try {
    writeTarget(dir, {
      name: "two files",
      files: new Map([["app.ts", "export const a = 1;\n"], [
        "lib.ts",
        "export const b = 2;\n",
      ]]),
      marked: "app.ts",
    }, "m1");
    assertEquals(
      Deno.readTextFileSync(`${dir}/app.ts`),
      "export const a = 1;\n// bench m1\n",
    );
    assertEquals(
      Deno.readTextFileSync(`${dir}/lib.ts`),
      "export const b = 2;\n",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("M7 times one cold save for each side of each cold pair", async () => {
  const result = await runM7({
    seed: 1,
    timeoutMs: 30_000,
    presets: [{
      size: "small",
      coldPairs: 2,
      warmups: 0,
      steps: 1,
      saveAllSteps: 1,
    }],
  });
  assert(result.ok, result.ok ? "" : describeLspBenchError(result.error));
  const cold = result.value.rows.find((row) => row.scenario === "cold");
  assertEquals(cold?.pairs.length, 2);
  assertEquals(cold?.samples.length, 4);
});
