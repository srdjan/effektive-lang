// Slow tests of the language server (plan L3a and L3b). They start the real
// server as a subprocess on a copy of `fixtures/examples` and talk to it over
// stdio. Nothing is written under fixtures/.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { LspClient } from "../bench/lsp_client.ts";
import { copyDirectory, FIXTURES } from "./helpers.ts";

const TIMEOUT_MS = 20_000;

const startServer = (cwd: string) =>
  new LspClient({ executable: Deno.execPath(), cwd, timeoutMs: TIMEOUT_MS });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

Deno.test("the server answers hover, definition, and save, and exits 0", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-lsp-" });
  let client: LspClient | undefined;
  try {
    copyDirectory(new URL("examples/", FIXTURES), dir);
    const text = Deno.readTextFileSync(`${dir}/main.eff`);
    const uri = new URL(`file://${dir}/main.eff`).href;
    client = startServer(dir);
    assert(isRecord(await client.initialize(undefined)));
    const published = client.waitForDiagnostics(uri, 1);
    await client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "effektive", version: 1, text },
    });
    assertEquals(await published, { uri, version: 1, diagnostics: [] });
    const positionOf = (needle: string, within: number) => {
      const before = text.slice(0, text.indexOf(needle)).split("\n");
      return {
        line: before.length - 1,
        character: before[before.length - 1].length + within,
      };
    };
    // Hover on the name `main`: the contract text.
    const name = positionOf("main = ", 1);
    const hover = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: name,
    });
    assert(isRecord(hover) && isRecord(hover.contents));
    assertStringIncludes(
      String(hover.contents.value),
      "main(): Name fails StoreUnavailable",
    );
    // Definition of the call of `displayName`: it lands in `users.eff`.
    const call = positionOf('displayName("u1")', 2);
    const definition = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: call,
    });
    assert(isRecord(definition));
    assertEquals(definition.uri, new URL(`file://${dir}/users.eff`).href);
    // A save writes `main.ts`. The stats request is a barrier: the server
    // answers it after it handled the save.
    await client.notify("textDocument/didSave", { textDocument: { uri } });
    await client.request("effektive/stats", { textDocument: { uri } });
    assert(Deno.statSync(`${dir}/main.ts`).isFile);
    assertEquals(await client.request("shutdown"), null);
    await client.notify("exit");
    assertEquals(await client.finish(), 0);
    // Every byte of stdout decoded as frames.
    assertEquals(client.frameErrors, []);
  } finally {
    await client?.dispose();
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("end of stdin without shutdown exits 1", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-lsp-" });
  let client: LspClient | undefined;
  try {
    copyDirectory(new URL("examples/", FIXTURES), dir);
    client = startServer(dir);
    await client.request("initialize", { capabilities: {} });
    assertEquals(await client.finish(), 1);
    assertEquals(client.frameErrors, []);
  } finally {
    await client?.dispose();
    Deno.removeSync(dir, { recursive: true });
  }
});
