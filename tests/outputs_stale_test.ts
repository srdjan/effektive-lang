// Fast tests of `removeStaleOutputs` over the in-memory file system.

import { assertEquals } from "@std/assert";
import { removeStaleOutputs } from "../src/host/outputs.ts";
import { memoryIo } from "./cli_helpers.ts";

const ROOT = "/proj";
const HEADER =
  "// Generated from gone.eff by the Effektive compiler. Do not edit.";

Deno.test("removeStaleOutputs keeps the .ts file when its map cannot be removed", () => {
  const m = memoryIo({
    [`${ROOT}/gone.ts`]: `${HEADER}\nexport {}\n`,
    [`${ROOT}/gone.ts.map`]: "{}",
  });
  m.unwritable.add(`${ROOT}/gone.ts.map`);
  const first = removeStaleOutputs(m.io.fs, ROOT, ["gone"]);
  assertEquals(first.removed, []);
  assertEquals(first.notes.length, 1);
  assertEquals(m.files.has(`${ROOT}/gone.ts`), true);
  m.unwritable.delete(`${ROOT}/gone.ts.map`);
  const second = removeStaleOutputs(m.io.fs, ROOT, ["gone"]);
  assertEquals(second.removed, ["gone.ts.map", "gone.ts"]);
  assertEquals(second.notes, []);
  assertEquals(m.files.size, 0);
});

Deno.test("removeStaleOutputs removes the .ts file when its map is missing", () => {
  const m = memoryIo({ [`${ROOT}/gone.ts`]: `${HEADER}\nexport {}\n` });
  const result = removeStaleOutputs(m.io.fs, ROOT, ["gone"]);
  assertEquals(result.removed, ["gone.ts"]);
  assertEquals(result.notes, []);
  assertEquals(m.files.size, 0);
});

Deno.test("removeStaleOutputs removes the companion module of a left interface, and keeps a hand-written one", () => {
  const header =
    "// Generated from gone.effi by the Effektive compiler. Do not edit.";
  const m = memoryIo({
    [`${ROOT}/gone.effi.ts`]: `${header}\n\nexport {};\n`,
    [`${ROOT}/gone.effi.ts.map`]: "{}",
    [`${ROOT}/kept.effi.ts`]: "export const mine = 1;\n",
    [`${ROOT}/kept.effi.ts.map`]: "{}",
  });
  const result = removeStaleOutputs(m.io.fs, ROOT, ["gone", "kept"]);
  assertEquals(result.removed, ["gone.effi.ts.map", "gone.effi.ts"]);
  assertEquals(result.notes, []);
  assertEquals([...m.files.keys()].sort(), [
    `${ROOT}/kept.effi.ts`,
    `${ROOT}/kept.effi.ts.map`,
  ]);
});

Deno.test("removeStaleOutputs removes an output that the outer project root wrote", () => {
  const m = memoryIo({
    "/work/sub/gone.ts":
      "// Generated from sub/gone.eff by the Effektive compiler. Do not edit.\nexport {}\n",
    "/work/sub/gone.ts.map": "{}",
  });
  const result = removeStaleOutputs(m.io.fs, "/work/sub", ["gone"]);
  assertEquals(result.removed, ["gone.ts.map", "gone.ts"]);
  assertEquals(result.notes, []);
  assertEquals([...m.files.keys()], []);
});

Deno.test("removeStaleOutputs keeps an output whose header names another file with the same tail", () => {
  const m = memoryIo({
    "/work/sub/gone.ts":
      "// Generated from zzz/sub/gone.eff by the Effektive compiler. Do not edit.\nexport {}\n",
    "/work/sub/gone.ts.map": "{}",
  });
  const result = removeStaleOutputs(m.io.fs, "/work/sub", ["gone"]);
  assertEquals(result.removed, []);
  assertEquals([...m.files.keys()].sort(), [
    "/work/sub/gone.ts",
    "/work/sub/gone.ts.map",
  ]);
});

Deno.test("removeStaleOutputs keeps an output whose header is a suffix that does not start at a slash", () => {
  const m = memoryIo({
    "/work/sub/gone.ts":
      "// Generated from ub/gone.eff by the Effektive compiler. Do not edit.\nexport {}\n",
    "/work/sub/gone.ts.map": "{}",
  });
  const result = removeStaleOutputs(m.io.fs, "/work/sub", ["gone"]);
  assertEquals(result.removed, []);
  assertEquals([...m.files.keys()].sort(), [
    "/work/sub/gone.ts",
    "/work/sub/gone.ts.map",
  ]);
});
