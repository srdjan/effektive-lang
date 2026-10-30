// Regenerates fixtures/surface/cli.json and fixtures/surface/lsp.json from the
// current build: the command-line records and the language server records that
// tests/surface_test.ts compares. Run it with `deno task surface:update` only
// after a deliberate change of the command-line output or the server replies.

import { cliRecords, lspRecords } from "../tests/surface_cases.ts";

const directory = new URL("../fixtures/surface/", import.meta.url);
Deno.mkdirSync(directory, { recursive: true });
const files: readonly (readonly [string, unknown])[] = [
  ["cli.json", await cliRecords()],
  ["lsp.json", lspRecords()],
];
for (const [name, records] of files) {
  Deno.writeTextFileSync(
    new URL(name, directory),
    JSON.stringify(records, null, 2) + "\n",
  );
  console.log(`wrote fixtures/surface/${name}`);
}
