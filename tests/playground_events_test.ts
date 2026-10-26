// Tests for the playground log events: the event data builders and layoutOf.

import { assertEquals } from "@std/assert";
import { sha256Hex } from "../src/core/mod.ts";
import type { PlaygroundResult } from "../playground/src/compile.ts";
import {
  compileData,
  editData,
  endData,
  errorData,
  hoverData,
  layoutData,
  layoutOf,
  problemData,
  selectData,
  startData,
  viewData,
} from "../playground/src/events.ts";

const RESULT: PlaygroundResult = {
  diagnostics: {
    "main.eff": [
      { from: 1, to: 4, severity: "error", code: "b/001", message: "m" },
      { from: 6, to: 7, severity: "warning", code: "b/002", message: "m" },
    ],
    "users.eff": [
      { from: 0, to: 1, severity: "error", code: "b/003", message: "m" },
    ],
    "pay.eff": [],
  },
  outputs: {
    "main.eff": { text: "x", stale: true },
    "users.eff": { text: "y", stale: false },
    "pay.eff": null,
  },
  elapsedMs: 3.14159,
};

Deno.test("layoutOf splits at 720 and 1024", () => {
  assertEquals(
    [375, 719, 720, 1023, 1024, 1280].map(layoutOf),
    ["narrow", "narrow", "wide", "wide", "explorer", "explorer"],
  );
});

Deno.test("startData holds the viewport, layout, and examples hash", () => {
  const files = { "main.eff": "a" };
  assertEquals(
    startData({
      build: "1.2.3",
      width: 1280,
      height: 800,
      files,
      loadMs: 41.27,
    }),
    {
      build: "1.2.3",
      viewport: { w: 1280, h: 800 },
      layout: "explorer",
      examples: sha256Hex(JSON.stringify(files)),
      loadMs: 41.3,
    },
  );
});

Deno.test("compileData lists the active file, the error counts, and staleness", () => {
  assertEquals(compileData("main.eff", RESULT, "5% fewer"), {
    path: "main.eff",
    ms: 3.1,
    diagnostics: [
      { code: "b/001", from: 1, to: 4 },
      { code: "b/002", from: 6, to: 7 },
    ],
    counts: { "main.eff": 1, "users.eff": 1 },
    stale: true,
    saving: "5% fewer",
  });
  const other = compileData("pay.eff", RESULT, "");
  assertEquals([other.diagnostics, other.stale], [[], false]);
});

Deno.test("the small builders return plain data", () => {
  const changes = [{ from: 0, to: 2, insert: "ab" }];
  assertEquals(selectData("a.eff", "key"), { path: "a.eff", by: "key" });
  assertEquals(editData("a.eff", changes, 9), {
    path: "a.eff",
    changes,
    length: 9,
  });
  assertEquals(hoverData(5, undefined, "cursor"), {
    offset: 5,
    hit: false,
    by: "cursor",
  });
  assertEquals(problemData({ code: "b/001", path: "a.eff" }), {
    code: "b/001",
    path: "a.eff",
  });
  assertEquals(viewData("output"), { name: "output" });
  assertEquals(layoutData("wide"), { mode: "wide" });
  assertEquals(errorData("internal", "boom"), {
    tag: "internal",
    message: "boom",
  });
  assertEquals(endData(), {});
});
