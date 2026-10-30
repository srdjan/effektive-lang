// Version pins. Each row names the source constant of a version, a file, and
// the exact text that the file must hold. A change of the constant fails each
// row of that version until the row and its file hold the new version. The
// table does not cover the guides in `docs/`.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { REQUIRED_DENO_VERSION } from "../scripts/package.ts";
import { EFFECT_VERSION } from "../src/cli/tsc.ts";

const ROOT = new URL("../", import.meta.url);

const PINS: ReadonlyArray<
  readonly [version: string, file: string, text: string]
> = [
  [
    REQUIRED_DENO_VERSION,
    "editors/vscode/package.json",
    '"description": "The Deno 2.9.8 executable that starts the language server."',
  ],
  [
    EFFECT_VERSION,
    "fixtures/tutorial/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "fixtures/applications/order-lifecycle/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "fixtures/applications/portable-publisher/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "fixtures/applications/scheduled-worker/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "fixtures/applications/service-workflow/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "fixtures/applications/stream-processor/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    EFFECT_VERSION,
    "bench/ref_update.ts",
    'import * as Effect from "npm:effect@4.0.5/Effect";',
  ],
  [
    EFFECT_VERSION,
    "bench/ref_update.ts",
    'import * as Ref from "npm:effect@4.0.5/Ref";',
  ],
  [
    EFFECT_VERSION,
    "bench/ref_update.ts",
    'import * as SynchronizedRef from "npm:effect@4.0.5/SynchronizedRef";',
  ],
  [REQUIRED_DENO_VERSION, "README.md", "The project needs Deno 2.9.8."],
  [EFFECT_VERSION, "README.md", "Generated TypeScript targets Effect 4.0.5."],
];

for (const [version, file, text] of PINS) {
  Deno.test(`${file} holds ${text}`, () => {
    assertStringIncludes(text, version);
    const source = Deno.readTextFileSync(new URL(file, ROOT));
    assertEquals(source.includes(text), true);
  });
}

Deno.test("the running Deno version is the required version", () => {
  assertEquals(Deno.version.deno, REQUIRED_DENO_VERSION);
});
