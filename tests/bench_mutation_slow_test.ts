// Mutation tests of the bench modules. They call exported functions only. They
// write files, which the fast task has no permission for.

import { assertEquals } from "@std/assert";
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
