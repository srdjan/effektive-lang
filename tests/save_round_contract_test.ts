// Fixed traces of the disk save round of the language server and of the forget
// policy of watch mode (plan SB2, unit 2). Each trace pins the behavior before a
// later phase moves the disk session state. The expected values are literals.
// The failure controls are the in-memory `unwritable` set and the file map, and
// no trace waits for elapsed time.

import { assertEquals } from "@std/assert";
import { main } from "../src/cli/main.ts";
import { memoryIo } from "./cli_helpers.ts";
import {
  didChangeFull,
  didOpen,
  type Harness,
  makeHarness,
  notification,
  uriOf,
} from "./lsp_helpers.ts";

const WATCH_ROOT = "/proj";
const ROOT = "/work/app";

const intModule = (type: string, name: string, value: string): string =>
  `type ${type} = int\nexport const ${name}: ${type} = ${value}\n`;

/** The generated text of `intModule` for the type `I`. */
const GENERATED_I = [
  'import { Schema } from "effect";\n\n',
  "const $Int = Schema.Finite.check(\n",
  "  Schema.makeFilter(\n",
  '    (value) => Number.isSafeInteger(value) || "expected a safe integer",\n',
  "  ),\n);\n\n",
  "export const I = $Int;\n",
  "export type I = typeof I.Type;\n\n",
].join("");

/** The generated text for the type `J`. */
const GENERATED_J = [
  'import { Schema } from "effect";\n\n',
  "const $Int = Schema.Finite.check(\n",
  "  Schema.makeFilter(\n",
  '    (value) => Number.isSafeInteger(value) || "expected a safe integer",\n',
  "  ),\n);\n\n",
  "export const J = $Int;\n",
  "export type J = typeof J.Type;\n\n",
].join("");

const header = (name: string): string =>
  `// Generated from ${name}.eff by the Effektive compiler. Do not edit.\n\n`;
const footer = (name: string): string =>
  `//# sourceMappingURL=${name}.ts.map\n`;

const MAP_A = '{\n  "version": 3,\n  "file": "a.ts",\n  "sources": [\n' +
  '    "a.eff"\n  ],\n  "names": [],\n' +
  '  "mappings": ";;;;;;;;;;AAAA;AAAA,8B;;AACA,oBAAoB,CAApB,C;;"\n}\n';
const MAP_B = '{\n  "version": 3,\n  "file": "b.ts",\n  "sources": [\n' +
  '    "b.eff"\n  ],\n  "names": [],\n' +
  '  "mappings": ";;;;;;;;;;AAAA;AAAA,8B;;AACA,oBAAoB,CAApB,C;;"\n}\n';

// ------------------------------------------------------------------ watch

Deno.test("watch trace: a module whose output removal failed is forgotten", async () => {
  const m = memoryIo({
    [`${WATCH_ROOT}/effektive.json`]: "{}",
    [`${WATCH_ROOT}/a.eff`]: intModule("I", "a", "1"),
    [`${WATCH_ROOT}/old.eff`]: intModule("I", "old", "1"),
  });
  const order: string[] = [];
  const io = {
    ...m.io,
    stdout: (text: string) => {
      order.push(`stdout ${text}`);
    },
    stderr: (text: string) => {
      order.push(`stderr ${text}`);
    },
  };
  m.script = [
    // Remove the module and block the removal of its map.
    () => {
      m.files.delete(`${WATCH_ROOT}/old.eff`);
      m.unwritable.add(`${WATCH_ROOT}/old.ts.map`);
    },
    // Permit the removal. The batch edits no source.
    () => {
      m.unwritable.clear();
    },
    // Edit a source and add a broken one.
    () => {
      m.files.set(`${WATCH_ROOT}/a.eff`, intModule("I", "a", "2"));
      m.files.set(`${WATCH_ROOT}/broken.eff`, "const broken = (\n");
    },
  ];
  assertEquals(await main(["watch", WATCH_ROOT], io), 0);
  assertEquals(order, [
    "stderr rechecked: a, old\n",
    "stderr 2 modules, 0 diagnostics, wrote 4 files\n",
    `stderr watching ${WATCH_ROOT}\n`,
    "stderr error: cannot remove old.ts.map: permission denied\n",
    "stderr rechecked: none\n",
    "stderr 1 module, 0 diagnostics\n",
    "stderr rechecked: a, broken\n",
    "stdout broken.eff:1:17: error syntax/008: expected an expression, found end of file\n",
    "stderr 2 modules, 1 diagnostic, wrote 1 file\n",
  ]);
  assertEquals(
    [...m.files.keys()].map((path) => path.slice(WATCH_ROOT.length + 1)).sort(),
    [
      "a.eff",
      "a.ts",
      "a.ts.map",
      "broken.eff",
      "effektive.json",
      "old.ts",
      "old.ts.map",
    ],
  );
  assertEquals(
    m.files.get(`${WATCH_ROOT}/a.ts`),
    header("a") + GENERATED_I + "export const a: I = 2;\n" + footer("a"),
  );
  // The removal never ran again, so the pair of old keeps its first bytes.
  assertEquals(
    m.files.get(`${WATCH_ROOT}/old.ts`),
    header("old") + GENERATED_I + "export const old: I = 1;\n" + footer("old"),
  );
});

// ------------------------------------------------------------------ language server

const save = (name: string): unknown =>
  notification("textDocument/didSave", {
    textDocument: { uri: uriOf(`${ROOT}/${name}`) },
  });

function projectHarness(files: Readonly<Record<string, string>>): Harness {
  const full: Record<string, string> = { [`${ROOT}/effektive.json`]: "{}" };
  for (const [name, text] of Object.entries(files)) {
    full[`${ROOT}/${name}`] = text;
  }
  const h = makeHarness({ files: full });
  h.start();
  return h;
}

/** The type and message of each log, in order, and then forgets what was sent. */
function takeLogs(h: Harness): string[] {
  const logs = h.logs().map((l) => `${l.type} ${l.message}`);
  h.clearSent();
  return logs;
}

const BAD_JSON = "1 effektive.json is not valid JSON: Expected property name " +
  "or '}' in JSON at position 1 (line 1 column 2)";

Deno.test("disk trace: recovery from a broken configuration writes disk text, not the overlay", () => {
  const A = intModule("I", "a", "1");
  const A_OVERLAY = intModule("I", "a", '"x"');
  const h = projectHarness({
    "a.eff": A,
    "b.eff": intModule("J", "b", "2"),
  });
  const a = uriOf(`${ROOT}/a.eff`);
  const b = uriOf(`${ROOT}/b.eff`);
  h.deliver(didOpen(a, 1, A), didOpen(b, 1, intModule("J", "b", "2")));
  assertEquals(h.published().map((p) => [p.uri, p.version, p.diagnostics]), [
    [a, 1, []],
    [b, 1, []],
  ]);
  assertEquals(takeLogs(h), []);

  // The overlay of a is unsaved and wrong. The disk text of a stays valid.
  h.deliver(didChangeFull(a, 2, A_OVERLAY));
  assertEquals(
    h.published().map((p) => [p.uri, p.version, p.diagnostics.length]),
    [[a, 2, 1]],
  );
  h.clearSent();

  h.deliver(save("b.eff"));
  assertEquals(takeLogs(h), [
    "4 wrote a.ts",
    "4 wrote a.ts.map",
    "4 wrote b.ts",
    "4 wrote b.ts.map",
  ]);
  assertEquals(
    h.files.get(`${ROOT}/a.ts`),
    header("a") + GENERATED_I + "export const a: I = 1;\n" + footer("a"),
  );
  assertEquals(h.files.get(`${ROOT}/a.ts.map`), MAP_A);
  assertEquals(
    h.files.get(`${ROOT}/b.ts`),
    header("b") + GENERATED_J + "export const b: J = 2;\n" + footer("b"),
  );
  assertEquals(h.files.get(`${ROOT}/b.ts.map`), MAP_B);

  // Break the configuration, and change the disk text of b in the same round.
  h.files.set(`${ROOT}/effektive.json`, "{");
  h.files.set(`${ROOT}/b.eff`, intModule("J", "b", "3"));
  h.deliver(save("b.eff"));
  assertEquals(takeLogs(h), [BAD_JSON]);
  assertEquals(
    h.files.get(`${ROOT}/b.ts`),
    header("b") + GENERATED_J + "export const b: J = 2;\n" + footer("b"),
  );

  // Repair the configuration. The next save writes the new disk text of b.
  h.files.set(`${ROOT}/effektive.json`, "{}");
  h.deliver(save("b.eff"));
  assertEquals(takeLogs(h), ["4 wrote b.ts"]);
  assertEquals(
    h.files.get(`${ROOT}/b.ts`),
    header("b") + GENERATED_J + "export const b: J = 3;\n" + footer("b"),
  );
  assertEquals(h.files.get(`${ROOT}/b.ts.map`), MAP_B);
  assertEquals(
    h.files.get(`${ROOT}/a.ts`),
    header("a") + GENERATED_I + "export const a: I = 1;\n" + footer("a"),
  );
});

const REMOVE_FAILS = "1 error: cannot remove c.ts.map: permission denied";
const HELD_B = "3 b is not written: it has 1 diagnostics";

Deno.test("disk trace: a pending deletion and a held reason across eight saves", () => {
  const A = intModule("I", "a", "1");
  const B_BAD = intModule("J", "b", '"x"');
  const h = projectHarness({
    "a.eff": A,
    "b.eff": intModule("J", "b", "2"),
    "c.eff": intModule("K", "c", "3"),
  });
  const files = (): string[] => [...h.files.keys()].sort();
  const bGenerated = (value: string): string =>
    header("b") + GENERATED_J + `export const b: J = ${value};\n` + footer("b");
  h.deliver(didOpen(uriOf(`${ROOT}/a.eff`), 1, A));
  h.clearSent();
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [
    "4 wrote a.ts",
    "4 wrote a.ts.map",
    "4 wrote b.ts",
    "4 wrote b.ts.map",
    "4 wrote c.ts",
    "4 wrote c.ts.map",
  ]);

  // Step 1: delete c, block the removal of its map, and save.
  h.files.delete(`${ROOT}/c.eff`);
  h.unwritable.add(`${ROOT}/c.ts.map`);
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [REMOVE_FAILS]);
  assertEquals(files(), [
    "/work/app/a.eff",
    "/work/app/a.ts",
    "/work/app/a.ts.map",
    "/work/app/b.eff",
    "/work/app/b.ts",
    "/work/app/b.ts.map",
    "/work/app/c.ts",
    "/work/app/c.ts.map",
    "/work/app/effektive.json",
  ]);

  // Step 2: break b and save. The save holds b and retries the deletion of c.
  h.files.set(`${ROOT}/b.eff`, B_BAD);
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [REMOVE_FAILS, HELD_B]);
  assertEquals(h.files.get(`${ROOT}/b.ts`), bGenerated("2"));
  assertEquals(h.files.has(`${ROOT}/c.ts`), true);

  // Step 3: save with no edit. The deletion is retried and the held reason stays silent.
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [REMOVE_FAILS]);
  assertEquals(h.files.has(`${ROOT}/c.ts`), true);

  // Step 4: break the configuration and save. Both states stay.
  h.files.set(`${ROOT}/effektive.json`, "{");
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [BAD_JSON]);
  assertEquals(h.files.has(`${ROOT}/c.ts`), true);

  // Step 5: repair only the configuration. The deletion is retried and b stays silent.
  h.files.set(`${ROOT}/effektive.json`, "{}");
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [REMOVE_FAILS]);
  assertEquals(h.files.has(`${ROOT}/c.ts`), true);

  // Step 6: permit the removal and save. The pending outputs go and b stays held.
  h.unwritable.clear();
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), ["4 removed c.ts.map", "4 removed c.ts"]);
  assertEquals(files(), [
    "/work/app/a.eff",
    "/work/app/a.ts",
    "/work/app/a.ts.map",
    "/work/app/b.eff",
    "/work/app/b.ts",
    "/work/app/b.ts.map",
    "/work/app/effektive.json",
  ]);
  assertEquals(h.files.get(`${ROOT}/b.ts`), bGenerated("2"));

  // Step 7: repair b and save. The save writes b and clears its held reason.
  h.files.set(`${ROOT}/b.eff`, intModule("J", "b", "4"));
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), ["4 wrote b.ts"]);
  assertEquals(h.files.get(`${ROOT}/b.ts`), bGenerated("4"));

  // Step 8: break b again and save. The save reports the held reason again.
  h.files.set(`${ROOT}/b.eff`, B_BAD);
  h.deliver(save("a.eff"));
  assertEquals(takeLogs(h), [HELD_B]);
  assertEquals(h.files.get(`${ROOT}/b.ts`), bGenerated("4"));
});
