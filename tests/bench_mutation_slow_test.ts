// Mutation tests of the bench modules. They call exported functions only. They
// write files, which the fast task has no permission for.

import { assert, assertEquals } from "@std/assert";
import { describeLspBenchError } from "../bench/lsp_script.ts";
import { runM7 } from "../bench/m7.ts";
import { runVariants } from "../bench/m5_variants.ts";
import { writeTarget } from "../bench/m5_target.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";

Deno.test("writeTarget adds the mark comment to the marked file only", async () => {
  await withTemporaryDirectory("effektive-bench-target-", (dir) => {
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
    return Promise.resolve();
  });
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

Deno.test("the M5 variants time the cold processes and the warm service on a small target", async () => {
  const outcome = await runVariants([{
    name: "tiny",
    files: new Map([["app.ts", "export const a: number = 1;\n"]]),
    marked: "app.ts",
  }], { pairs: 1, warmups: 0 });
  assert(outcome.ok);
  assertEquals(outcome.value.skipped, []);
  assertEquals(
    outcome.value.results.map((result) => result.variant),
    [
      "tsc 5.9.3 cold process",
      "tsgo 7.0.0-dev.20260707.2 cold process",
      "ts.LanguageService 5.9.3 warm",
    ],
  );
  const service = outcome.value.results[2];
  assertEquals(service?.pairs.length, 1);
  assertEquals(service?.samples.length, 2);
  assertEquals(typeof service?.firstCall, "number");
});
