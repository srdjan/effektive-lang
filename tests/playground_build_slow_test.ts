// Slow test of the playground build. It runs `build` into a temporary
// directory, which starts `deno bundle` as a subprocess.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, toFileUrl } from "@std/path";
import { build } from "../playground/build.ts";
import { Program } from "../src/core/frontend.ts";

const OUTPUTS: readonly string[] = [
  "index.html",
  "app.js",
  "app.css",
  "examples.json",
  "fonts/bricolage-grotesque-latin.woff2",
  "fonts/OFL.txt",
];

const EXAMPLE_PATHS: readonly string[] = [
  "collections.eff",
  "effektive.json",
  "host/providers.effi",
  "log.eff",
  "main.eff",
  "pay.eff",
  "users-service.eff",
  "users.eff",
];

Deno.test("build writes the page files and the examples", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-playground-" });
  try {
    const out = `${dir}/dist`;
    const result = await build(out);
    assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
    for (const name of OUTPUTS) {
      assert(Deno.statSync(`${out}/${name}`).isFile, `${name} is missing`);
    }
    const examples: unknown = JSON.parse(
      Deno.readTextFileSync(`${out}/examples.json`),
    );
    assert(typeof examples === "object" && examples !== null);
    assertEquals(Object.keys(examples).sort(), [...EXAMPLE_PATHS]);
    const files: Record<string, string> = {};
    for (const [path, text] of Object.entries(examples)) {
      assert(typeof text === "string", path);
      files[path] = text;
    }
    const revision = new Program("").update({ set: files });
    assert(revision.ok);
    assertEquals(revision.value.diagnostics, []);
    const app = Deno.readFileSync(`${out}/app.js`);
    assert(app.byteLength > 0);
    assertEquals(result.value.appBytes, app.byteLength);
    assert(result.value.appGzipBytes > 0);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("build refuses repository targets reached through symbolic links", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-playground-links-" });
  try {
    const root = `${dir}/repository`;
    Deno.mkdirSync(`${root}/playground`, { recursive: true });
    Deno.mkdirSync(`${root}/src/core`, { recursive: true });
    const sentinel = `${root}/src/core/keep.txt`;
    Deno.writeTextFileSync(sentinel, "keep");
    Deno.copyFileSync(
      fromFileUrl(new URL("../playground/build.ts", import.meta.url)),
      `${root}/playground/build.ts`,
    );
    const copied: { build: typeof build } = await import(
      toFileUrl(`${root}/playground/build.ts`).href
    );
    Deno.symlinkSync(root, `${dir}/alias`);
    Deno.symlinkSync(`${root}/src`, `${root}/playground/dist`);
    Deno.symlinkSync(`${dir}/missing`, `${dir}/dangling`);
    for (
      const out of [
        `${root}/src/core`,
        `${dir}/alias/src/core`,
        `${dir}/alias/src/new/output`,
        `${dir}/alias`,
        `${root}/playground/dist/core`,
        `${dir}/dangling`,
      ]
    ) {
      assertEquals(await copied.build(out), {
        ok: false,
        error: { tag: "unsafe-out-dir", outDir: out },
      });
      assertEquals(Deno.readTextFileSync(sentinel), "keep");
    }
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
