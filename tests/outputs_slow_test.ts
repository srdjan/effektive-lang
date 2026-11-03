// Real filesystem tests for generated-output containment.

import { assert, assertEquals } from "@std/assert";
import {
  buildSpanTable,
  type EmittedModule,
  type SourceMapV3,
} from "../src/core/mod.ts";
import { denoFs } from "../src/host/deno_io.ts";
import type { GeneratedSource } from "../src/host/generation.ts";
import { removeStaleOutputs, writeGenerated } from "../src/host/outputs.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";

function generated(path: string): GeneratedSource {
  const source = path.replace(/\.ts$/, ".eff");
  const emitted: EmittedModule = {
    module: source.replace(/\.eff$/, ""),
    path,
    text:
      `// Generated from ${source} by the Effektive compiler. Do not edit.\nexport {};\n`,
    spans: [],
    hostAssertions: [],
  };
  const map: SourceMapV3 = {
    version: 3,
    file: path,
    sources: [source],
    names: [],
    mappings: "",
  };
  return {
    generated: () => ({
      kind: "ready",
      emitted,
      table: buildSpanTable(emitted),
      map,
    }),
  };
}

function write(root: string, path: string) {
  return writeGenerated(denoFs, root, generated(path), ["m"], true);
}

Deno.test("writeGenerated rejects external output links before writing either file", async () => {
  await withTemporaryDirectory("effektive-output-links-", async (dir) => {
    const root = `${dir}/project`;
    const outside = `${dir}/outside`;
    await Deno.mkdir(root);
    Deno.mkdirSync(outside);

    Deno.mkdirSync(`${root}/existing-ts`);
    const existingTs = `${outside}/existing.ts`;
    const existingPath = "existing-ts/m.ts";
    const oldTs = generated(existingPath).generated("m");
    assert(oldTs.kind === "ready");
    Deno.writeTextFileSync(existingTs, oldTs.emitted.text);
    Deno.symlinkSync(existingTs, `${root}/${existingPath}`);
    const existingTsResult = write(root, existingPath);
    assert(existingTsResult.failed);
    assertEquals(existingTsResult.written, []);
    assertEquals(existingTsResult.notes, [
      "error: cannot write existing-ts/m.ts: path resolves outside the project root",
    ]);
    assertEquals(Deno.readTextFileSync(existingTs), oldTs.emitted.text);
    assertEquals(denoFs.kind(`${root}/${existingPath}.map`), "missing");

    Deno.mkdirSync(`${root}/existing-map`);
    const existingMap = `${outside}/existing.map`;
    Deno.writeTextFileSync(existingMap, "outside map\n");
    const existingMapPath = "existing-map/m.ts";
    Deno.symlinkSync(existingMap, `${root}/${existingMapPath}.map`);
    const existingMapResult = write(root, existingMapPath);
    assert(existingMapResult.failed);
    assertEquals(existingMapResult.written, []);
    assertEquals(existingMapResult.notes, [
      "error: cannot write existing-map/m.ts.map: path resolves outside the project root",
    ]);
    assertEquals(Deno.readTextFileSync(existingMap), "outside map\n");
    assertEquals(denoFs.kind(`${root}/${existingMapPath}`), "missing");

    Deno.mkdirSync(`${root}/dangling-ts`);
    const danglingTs = `${outside}/new.ts`;
    const danglingTsPath = "dangling-ts/m.ts";
    Deno.symlinkSync(danglingTs, `${root}/${danglingTsPath}`);
    const danglingTsResult = write(root, danglingTsPath);
    assert(danglingTsResult.failed);
    assertEquals(danglingTsResult.written, []);
    assertEquals(danglingTsResult.notes, [
      "error: cannot write dangling-ts/m.ts: symbolic link target cannot be resolved",
    ]);
    assertEquals(denoFs.kind(danglingTs), "missing");
    assertEquals(denoFs.kind(`${root}/${danglingTsPath}.map`), "missing");

    Deno.mkdirSync(`${root}/dangling-map`);
    const danglingMap = `${outside}/new.map`;
    const danglingMapPath = "dangling-map/m.ts";
    Deno.symlinkSync(danglingMap, `${root}/${danglingMapPath}.map`);
    const danglingMapResult = write(root, danglingMapPath);
    assert(danglingMapResult.failed);
    assertEquals(danglingMapResult.written, []);
    assertEquals(danglingMapResult.notes, [
      "error: cannot write dangling-map/m.ts.map: symbolic link target cannot be resolved",
    ]);
    assertEquals(denoFs.kind(danglingMap), "missing");
    assertEquals(denoFs.kind(`${root}/${danglingMapPath}`), "missing");

    Deno.mkdirSync(`${outside}/parent`);
    Deno.symlinkSync(`${outside}/parent`, `${root}/external-parent`);
    const parentResult = write(root, "external-parent/m.ts");
    assert(parentResult.failed);
    assertEquals(parentResult.written, []);
    assertEquals(denoFs.kind(`${outside}/parent/m.ts`), "missing");
    assertEquals(denoFs.kind(`${outside}/parent/m.ts.map`), "missing");

    Deno.mkdirSync(`${outside}/stale`);
    const stalePath = "stale-parent/m.ts";
    const stale = generated(stalePath).generated("m");
    assert(stale.kind === "ready");
    Deno.writeTextFileSync(`${outside}/stale/m.ts`, stale.emitted.text);
    Deno.writeTextFileSync(`${outside}/stale/m.ts.map`, "outside map\n");
    Deno.symlinkSync(`${outside}/stale`, `${root}/stale-parent`);
    const removed = removeStaleOutputs(denoFs, root, ["stale-parent/m"]);
    assertEquals(removed.removed, []);
    assertEquals(denoFs.kind(`${outside}/stale/m.ts`), "file");
    assertEquals(denoFs.kind(`${outside}/stale/m.ts.map`), "file");
  });
});

Deno.test("writeGenerated supports ordinary paths and internal directory links", async () => {
  await withTemporaryDirectory("effektive-output-links-", async (dir) => {
    const root = `${dir}/project`;
    await Deno.mkdir(`${root}/inside`, { recursive: true });
    Deno.symlinkSync(`${root}/inside`, `${root}/internal-link`);

    const ordinary = write(root, "ordinary/m.ts");
    assertEquals(ordinary.failed, false);
    assertEquals(ordinary.written, ["ordinary/m.ts", "ordinary/m.ts.map"]);

    const internal = write(root, "internal-link/m.ts");
    assertEquals(internal.failed, false);
    assertEquals(internal.written, [
      "internal-link/m.ts",
      "internal-link/m.ts.map",
    ]);
    assertEquals(denoFs.kind(`${root}/inside/m.ts`), "file");
    assertEquals(denoFs.kind(`${root}/inside/m.ts.map`), "file");

    Deno.symlinkSync(root, `${dir}/project-alias`);
    const alias = write(`${dir}/project-alias`, "alias-root/m.ts");
    assertEquals(alias.failed, false);
    assertEquals(alias.written, ["alias-root/m.ts", "alias-root/m.ts.map"]);
    assertEquals(denoFs.kind(`${root}/alias-root/m.ts`), "file");
  });
});
