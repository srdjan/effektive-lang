// Fast tests of `stepOutput`, the rule that both the language server and the
// playground use to choose between the newest and the last good output.

import { assertEquals } from "@std/assert";
import type { EmittedModule } from "../src/core/mod.ts";
import { stepOutput } from "../src/core/typescript.ts";

const emitted: EmittedModule = {
  module: "m",
  path: "m.ts",
  text: "new text\n",
  spans: [],
  hostAssertions: [],
};

Deno.test("a successful emit gives its text, not stale, and becomes the last good text", () => {
  assertEquals(stepOutput("old text\n", { ok: true, value: emitted }), {
    lastGood: "new text\n",
    output: { text: "new text\n", stale: false },
  });
});

Deno.test("a failed emit gives the last good text, marked stale", () => {
  assertEquals(
    stepOutput("old text\n", {
      ok: false,
      error: {
        tag: "lowering",
        module: "m",
        error: { tag: "unknown-module", module: "m" },
      },
    }),
    { lastGood: "old text\n", output: { text: "old text\n", stale: true } },
  );
});

Deno.test("a missing emit gives the last good text, marked stale", () => {
  assertEquals(stepOutput("old text\n", undefined), {
    lastGood: "old text\n",
    output: { text: "old text\n", stale: true },
  });
});

Deno.test("no emit and no last good text give no output", () => {
  assertEquals(stepOutput(undefined, undefined), {
    lastGood: undefined,
    output: null,
  });
});
