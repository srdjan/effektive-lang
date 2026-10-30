// The surface oracle test: the command-line records and the language server
// records of the current build must equal fixtures/surface/. Run
// `deno task surface:update` only after a deliberate change of that output.

import { assertEquals } from "@std/assert";
import {
  cliCases,
  type CliRecord,
  lspRecords,
  type LspStep,
  runCliCase,
} from "./surface_cases.ts";

function readFixture(name: string): unknown {
  return JSON.parse(
    Deno.readTextFileSync(
      new URL(`../fixtures/surface/${name}`, import.meta.url),
    ),
  );
}

const expectedCli = readFixture("cli.json") as Record<string, CliRecord>;
const expectedLsp = readFixture("lsp.json") as LspStep[];

Deno.test("the surface fixture lists exactly the command-line cases", () => {
  assertEquals(
    Object.keys(expectedCli).sort(),
    cliCases().map((c) => c.name).sort(),
  );
});

// A census: one test for each command-line case.
for (const c of cliCases()) {
  Deno.test(`surface cli: ${c.name}`, async () => {
    assertEquals(await runCliCase(c), expectedCli[c.name]);
  });
}

Deno.test("surface lsp: the scripted session", () => {
  assertEquals(lspRecords(), expectedLsp);
});
