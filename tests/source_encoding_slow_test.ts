// Slow test of the encoding of source files through the CLI. A source file
// with invalid UTF-8 bytes is a read error. A leading BOM stays in the text.

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { deno, withTemporaryDirectory } from "./process_helpers.ts";

const REPOSITORY = fromFileUrl(new URL("../", import.meta.url));

async function build(dir: string, bytes: Uint8Array) {
  Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
  Deno.writeFileSync(`${dir}/m.eff`, bytes);
  return await deno(REPOSITORY, [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run=deno",
    "src/cli/main.ts",
    "build",
    dir,
    "--no-log",
  ]);
}

Deno.test("build rejects a source file with invalid UTF-8 bytes", async () => {
  await withTemporaryDirectory("effektive-encoding-", async (dir) => {
    const run = await build(
      dir,
      new Uint8Array([
        ...new TextEncoder().encode('type S = string\nexport const y: S = "a'),
        0xff,
        0xfe,
        ...new TextEncoder().encode('b"\n'),
      ]),
    );
    assertEquals(run.code, 2, run.stderr);
    assertEquals(run.stdout, "");
    assertEquals(
      run.stderr,
      "effektive: m.eff cannot be read: The encoded data is not valid\n",
    );
  });
});

Deno.test("a leading BOM stays in the text and counts as a column", async () => {
  await withTemporaryDirectory("effektive-encoding-", async (dir) => {
    const run = await build(
      dir,
      new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...new TextEncoder().encode('export const y: int = "a"\n'),
      ]),
    );
    assertEquals(run.code, 1, run.stderr);
    assertEquals(
      run.stdout,
      "m.eff:1:18: error declaration/013: the primitive type `int` can occur only inside a type or error declaration\n" +
        "m.eff:1:24: error type-mismatch/003: the constant has type string, but int is expected\n",
    );
    assertEquals(run.stderr, "1 module, 2 diagnostics\n");
  });
});
