// The checker reads the contextual modifiers `opaque` and `borrow` from the
// word tokens that the parser wrote, so trivia between words changes nothing.
// Every test runs through the public entry `checkProject`.

import { assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

function messagesOf(files: Record<string, string>): string[] {
  const result = checkProject(memoryHost(files), "", ["main.eff"]);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

const HOST_CONFIG = JSON.stringify({
  host: { files: { interface: "./host.effi", module: "./host.ts" } },
});

const HOST_MAIN = `import { Handle, Files, Text } from "host:files"
const a = (borrow handle: Handle): Text with Files.read => Files.read(handle)
`;

const HOST_EFFI = `export opaque type Handle
export type Text = string
export service Files {
  read(borrow handle: Handle): Text
  plain(handle: Handle): Text
}
`;

Deno.test("a comment between opaque and type keeps the type opaque", () => {
  assertEquals(
    messagesOf({
      "effektive.json": HOST_CONFIG,
      "host.effi": `export opaque /* resource */ type Handle
export type Text = string
export service Files {
  read(borrow handle: Handle): Text
}
`,
      "main.eff": HOST_MAIN,
    }),
    [],
  );
});

Deno.test("a parameter named borrow before a colon is not a borrow parameter", () => {
  assertEquals(
    messagesOf({
      "effektive.json": "{}",
      "main.eff": "type Int = int\nconst a = (borrow : Int): Int => borrow\n",
    }),
    [],
  );
});

Deno.test("a comment without spaces after borrow keeps the borrow mark", () => {
  assertEquals(
    messagesOf({
      "effektive.json": HOST_CONFIG,
      "host.effi": HOST_EFFI,
      "main.eff": `import { Handle, Files, Text } from "host:files"
const a = (borrow/* c */handle: Handle): Text with Files.plain => Files.plain(handle)
`,
    }),
    ["type-mismatch/010: a borrowed handle may only pass to a borrow-qualified method"],
  );
});
