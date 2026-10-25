import { assert, assertEquals } from "@std/assert";
import { Program, signatureHelpAt } from "../src/core/frontend.ts";
import { lineStarts } from "../src/core/source.ts";
import { offsetToPosition } from "../src/lsp/positions.ts";
import { SERVER_CAPABILITIES } from "../src/lsp/protocol.ts";
import { makeHarness, uriOf } from "./lsp_helpers.ts";

const dependency = `export type Text = string
const consume = (value: Text): Text => value
export const entry = (payload): Text fails SchemaError => consume(payload.name)
`;
const consumer = `import { entry, Text } from "./dep.eff"
const alias = (entry)
const local = (left: Text, right: Text): Text => left
const constantUse: Text = local("first", "second")
const use = (raw: unknown): Text fails SchemaError => { const nestedAlias = entry; local(entry(raw), alias(raw)); nestedAlias(raw) }
`;

function revision() {
  const loaded = new Program().update({
    set: {
      "effektive.json": "{}",
      "dep.eff": dependency,
      "main.eff": consumer,
    },
  });
  assert(loaded.ok);
  assertEquals(loaded.value.diagnostics, []);
  return loaded.value;
}

Deno.test("signature help follows direct, imported, and aliased function values", () => {
  const checked = revision();
  const direct = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf("entry(raw") + "entry(".length,
  );
  assertEquals(direct, {
    label:
      "entry(payload: unknown -> { name: Text }): Text fails error:effect/SchemaError",
    parameters: [{
      label: "payload: unknown -> { name: Text }",
      documentation:
        "This entry accepts unknown input and validates it as { name: Text }.",
    }],
    activeParameter: 0,
  });
  const constant = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf('local("first"') + "local(".length,
  );
  assertEquals(constant?.parameters, [
    { label: "left: Text" },
    { label: "right: Text" },
  ]);
  const alias = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf("alias(raw") + "alias(".length,
  );
  assertEquals(alias?.parameters, direct?.parameters);
  assert(alias?.label.startsWith("alias(payload:"));
  const nestedAlias = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf("nestedAlias(raw") + "nestedAlias(".length,
  );
  assertEquals(nestedAlias?.parameters, direct?.parameters);
  assert(nestedAlias?.label.startsWith("nestedAlias(payload:"));
});

Deno.test("signature help selects nested calls and the active parameter", () => {
  const checked = revision();
  const nested = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf("entry(raw") + "entry(".length,
  );
  assert(nested?.label.startsWith("entry("));
  const second = signatureHelpAt(
    checked,
    "main.eff",
    consumer.indexOf("local(entry(raw),") + "local(entry(raw),".length,
  );
  assertEquals(second, {
    label: "local(left: Text, right: Text): Text",
    parameters: [{ label: "left: Text" }, { label: "right: Text" }],
    activeParameter: 1,
  });
});

Deno.test("signature help tolerates an incomplete argument list", () => {
  const text = consumer.replace("nestedAlias(raw) }", "nestedAlias(");
  const loaded = new Program().update({
    set: {
      "effektive.json": "{}",
      "dep.eff": dependency,
      "main.eff": text,
    },
  });
  assert(loaded.ok);
  const help = signatureHelpAt(loaded.value, "main.eff", text.length - 1);
  assert(help?.label.startsWith("nestedAlias(payload:"));
});

Deno.test("signature help does not treat a factory call as an alias", () => {
  const text = `type Int = int
const make = (wrongName: Int): (value: Int) => Int => (value: Int): Int => value
const topLevel = make(1)
const use = (): Int => { const local = make(2); local(3) + topLevel(4) }
const nested = (): Int => make(0)(1)
`;
  const loaded = new Program().update({
    set: { "effektive.json": "{}", "main.eff": text },
  });
  assert(loaded.ok);
  assertEquals(loaded.value.diagnostics, []);
  for (const name of ["local", "topLevel", "make(0)"]) {
    const call = `${name}(`;
    const help = signatureHelpAt(
      loaded.value,
      "main.eff",
      text.lastIndexOf(call) + call.length,
    );
    assertEquals(help, {
      label: `${name}(arg1: Int): Int`,
      parameters: [{ label: "arg1: Int" }],
      activeParameter: 0,
    });
  }
});

Deno.test("LSP publishes and serves signature help", () => {
  assertEquals(SERVER_CAPABILITIES.signatureHelpProvider, {
    triggerCharacters: ["(", ","],
  });
  const root = "/work/signature";
  const uri = uriOf(`${root}/main.eff`);
  const harness = makeHarness({
    files: {
      [`${root}/effektive.json`]: "{}",
      [`${root}/dep.eff`]: dependency,
      [`${root}/main.eff`]: consumer,
    },
  });
  harness.start();
  harness.deliver({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId: "effektive",
        version: 1,
        text: consumer,
      },
    },
  });
  const offset = consumer.indexOf("local(entry(raw),") +
    "local(entry(raw),".length;
  harness.deliver({
    jsonrpc: "2.0",
    id: 1,
    method: "textDocument/signatureHelp",
    params: {
      textDocument: { uri },
      position: offsetToPosition(consumer, lineStarts(consumer), offset),
      context: { triggerKind: 2, triggerCharacter: "," },
    },
  });
  const response = harness.responses(1)[0];
  assert(response !== undefined && "result" in response);
  assertEquals(response.result, {
    signatures: [{
      label: "local(left: Text, right: Text): Text",
      parameters: [{ label: "left: Text" }, { label: "right: Text" }],
    }],
    activeSignature: 0,
    activeParameter: 1,
  });
});
