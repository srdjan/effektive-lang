// Version pins. Each row names a file and the exact text that it must hold, so
// a version change cannot leave a stale pin that the gate does not see.

import { assertEquals } from "@std/assert";
import { REQUIRED_DENO_VERSION } from "../scripts/package.ts";

const ROOT = new URL("../", import.meta.url);

const PINS: ReadonlyArray<readonly [file: string, text: string]> = [
  [
    "editors/vscode/package.json",
    '"description": "The Deno 2.9.8 executable that starts the language server."',
  ],
  ["fixtures/tutorial/deno.json", '"effect": "npm:effect@4.0.5"'],
  [
    "fixtures/applications/order-lifecycle/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    "fixtures/applications/portable-publisher/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    "fixtures/applications/scheduled-worker/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    "fixtures/applications/service-workflow/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  [
    "fixtures/applications/stream-processor/deno.json",
    '"effect": "npm:effect@4.0.5"',
  ],
  ["bench/ref_update.ts", 'import * as Effect from "npm:effect@4.0.5/Effect";'],
  ["bench/ref_update.ts", 'import * as Ref from "npm:effect@4.0.5/Ref";'],
  [
    "bench/ref_update.ts",
    'import * as SynchronizedRef from "npm:effect@4.0.5/SynchronizedRef";',
  ],
  ["README.md", "The project needs Deno 2.9.8."],
  ["README.md", "Generated TypeScript targets Effect 4.0.5."],
];

for (const [file, text] of PINS) {
  Deno.test(`${file} holds ${text}`, () => {
    const source = Deno.readTextFileSync(new URL(file, ROOT));
    assertEquals(source.includes(text), true);
  });
}

Deno.test("the running Deno version is the required version", () => {
  assertEquals(Deno.version.deno, REQUIRED_DENO_VERSION);
});
