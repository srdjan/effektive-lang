import { TypeScriptOutputs } from "../src/core/typescript.ts";
const outputCache = new TypeScriptOutputs();
// Fast tests of the save round. Each test drives
// the round through `didSave` on the in-memory file system of the harness, and
// compares the generated files with an oracle: a fresh `Program` over the same
// disk texts, the shared write rule, and the emitted text with its source map.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Program, serializeSourceMap } from "../src/core/mod.ts";
import { planWrites } from "../src/host/outputs.ts";
import { isSourcePath } from "../src/host/workspace.ts";
import {
  didChangeFull,
  didClose,
  didOpen,
  exampleFiles,
  exampleUri,
  type Harness,
  makeHarness,
  notification,
  ROOT,
  uriOf,
  watched,
} from "./lsp_helpers.ts";

const MAIN = exampleUri("main.eff");
const USERS = exampleUri("users.eff");
const F = exampleFiles();
const MAIN_TEXT = F["main.eff"];
const USERS_TEXT = F["users.eff"];
const SOLO = "export const solo = (): Int => 1\n\ntype Int = int\n";

/** `users.eff` with `displayName` turned into a pure function: a mode flip. */
const USERS_PURE = (() => {
  const start = USERS_TEXT.indexOf("export const displayName");
  const end = USERS_TEXT.indexOf("\nexport", start + 10);
  return USERS_TEXT.slice(0, start) +
    "export const displayName = (id: UserId): Name => Name(id)\n" +
    (end < 0 ? "" : USERS_TEXT.slice(end));
})();
const USERS_BROKEN = USERS_TEXT.replace("Users.save(renamed)", "Users.save(1)");

function save(uri: string): unknown {
  return notification("textDocument/didSave", { textDocument: { uri } });
}

/** A started harness with `main.eff` open, so that the project is known. */
function started(
  extra: Readonly<Record<string, string>> = {},
  options?: unknown,
): Harness {
  const h = makeHarness();
  h.start(options);
  for (const [path, text] of Object.entries(extra)) {
    h.files.set(`${ROOT}/${path}`, text);
  }
  h.deliver(didOpen(MAIN, 1, MAIN_TEXT));
  h.clearSent();
  return h;
}

function setDisk(h: Harness, path: string, text: string | undefined): void {
  if (text === undefined) h.files.delete(`${ROOT}/${path}`);
  else h.files.set(`${ROOT}/${path}`, text);
}

/** The oracle: output path to text, from the disk sources under `ROOT`. */
function oracle(h: Harness, skip = ""): Map<string, string> {
  const set = new Map<string, string>();
  for (const [full, text] of h.files) {
    if (!full.startsWith(`${ROOT}/`)) continue;
    const path = full.slice(ROOT.length + 1);
    if (isSourcePath(path)) set.set(path, text);
  }
  const updated = new Program(ROOT).update({ set });
  assert(updated.ok);
  const revision = updated.value;
  const outputs = new Map<string, string>();
  for (const name of planWrites(revision).writable) {
    if (skip !== "" && name.startsWith(skip)) continue;
    const emitted = outputCache.emitted(revision, name);
    const map = outputCache.sourceMap(revision, name);
    assert(emitted?.ok && map?.ok, name);
    outputs.set(emitted.value.path, emitted.value.text);
    outputs.set(`${emitted.value.path}.map`, serializeSourceMap(map.value));
  }
  return outputs;
}

/** The generated files on disk: a `.ts` file with the header, or a `.ts.map`. */
function generatedOnDisk(h: Harness): string[] {
  return [...h.files].filter(([path, text]) =>
    path.startsWith(`${ROOT}/`) &&
    (path.endsWith(".ts.map") ||
      (path.endsWith(".ts") && text.startsWith("// Generated from")))
  ).map(([path]) => path.slice(ROOT.length + 1)).sort();
}

function assertMatchesOracle(h: Harness, skip = ""): void {
  const expected = oracle(h, skip);
  for (const [path, text] of expected) {
    assertEquals(h.files.get(`${ROOT}/${path}`), text, path);
  }
  assertEquals(generatedOnDisk(h), [...expected.keys()].sort());
}

function logsOf(h: Harness, type: number): string[] {
  return h.logs().filter((l) => l.type === type).map((l) => l.message);
}

Deno.test("the first round writes every writable module and its map, as the oracle does", () => {
  const h = started();
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  assert(h.files.has(`${ROOT}/users.ts`) && h.files.has(`${ROOT}/main.ts.map`));
  assertEquals(logsOf(h, 1), []);
  assert(logsOf(h, 4).includes("wrote main.ts"));
});

Deno.test("a save of an .effi file writes its companion module", () => {
  const h = started();
  h.deliver(save(MAIN));
  const companion = `${ROOT}/host/providers.effi.ts`;
  assertStringIncludes(h.files.get(companion) ?? "", "export {};");
  const effi = "host/providers.effi";
  setDisk(h, effi, `${F[effi]}export type Extra = { n: int }\n`);
  h.deliver(save(exampleUri(effi)));
  assertStringIncludes(h.files.get(companion) ?? "", "export const Extra =");
  assert(h.files.has(`${companion}.map`));
  assertMatchesOracle(h);
});

Deno.test("a save with no change writes and logs nothing", () => {
  const h = started();
  h.deliver(save(MAIN));
  const before = new Map(h.files);
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(h.files, before);
  assertEquals(h.logs(), []);
});

Deno.test("a configuration error writes nothing and recovery matches the oracle in both directions", () => {
  const config = F["effektive.json"];
  const h = started();
  h.deliver(save(MAIN));
  const good = new Map(h.files);
  // good, bad, good: the disk program must see the exact previous text again.
  setDisk(h, "effektive.json", "{");
  setDisk(h, "users.eff", USERS_PURE);
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(h.files.get(`${ROOT}/main.ts`), good.get(`${ROOT}/main.ts`));
  assertEquals(logsOf(h, 1).length, 1);
  setDisk(h, "effektive.json", config);
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  assert(h.files.get(`${ROOT}/main.ts`) !== good.get(`${ROOT}/main.ts`));
  // bad, good: a project whose first round meets a bad configuration.
  const bad = makeHarness();
  bad.start();
  setDisk(bad, "effektive.json", "{");
  bad.deliver(didOpen(MAIN, 1, MAIN_TEXT), save(MAIN));
  assertEquals(generatedOnDisk(bad), []);
  assertEquals(logsOf(bad, 1).length, 1);
  setDisk(bad, "effektive.json", config);
  bad.deliver(save(MAIN));
  assertMatchesOracle(bad);
});

Deno.test("a disk read error logs type 1 and writes nothing", () => {
  const h = started();
  h.unreadable.add(`${ROOT}/users.eff`);
  h.deliver(save(MAIN));
  assertEquals(generatedOnDisk(h), []);
  const errors = logsOf(h, 1);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], "users.eff");
  h.unreadable.clear();
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
});

Deno.test("a directory resolution failure preserves disk state and retries", () => {
  const h = started({ "sub/a.eff": SOLO });
  h.deliver(save(MAIN));
  const outputBefore = new Map([
    ["sub/a.ts", h.files.get(`${ROOT}/sub/a.ts`)],
    ["sub/a.ts.map", h.files.get(`${ROOT}/sub/a.ts.map`)],
  ]);
  setDisk(h, "sub/a.eff", SOLO.replace("=> 1", "=> 2"));
  h.throwOnAbsolute.add(`${ROOT}/sub`);
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(
    new Map([
      ["sub/a.ts", h.files.get(`${ROOT}/sub/a.ts`)],
      ["sub/a.ts.map", h.files.get(`${ROOT}/sub/a.ts.map`)],
    ]),
    outputBefore,
  );
  assertEquals(logsOf(h, 1), [
    `cannot read the project ${ROOT}: sub: cannot be resolved`,
  ]);
  h.throwOnAbsolute.clear();
  h.clearSent();
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  assert(h.files.get(`${ROOT}/sub/a.ts`) !== outputBefore.get("sub/a.ts"));
  assertEquals(logsOf(h, 1), []);
});

Deno.test("a write failure logs type 1, and the next save repairs a partial write", () => {
  const h = started();
  h.files.delete(`${ROOT}/main.ts`);
  h.unwritable.add(`${ROOT}/main.ts.map`);
  h.deliver(save(MAIN));
  const errors = logsOf(h, 1);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], "cannot write main.ts.map");
  assert(h.files.has(`${ROOT}/main.ts`) && !h.files.has(`${ROOT}/main.ts.map`));
  h.unwritable.clear();
  h.clearSent();
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  assertEquals(logsOf(h, 1), []);
});

Deno.test("a deleted output file is repaired by the next save", () => {
  const h = started();
  h.deliver(save(MAIN));
  h.files.delete(`${ROOT}/users.ts`);
  h.files.delete(`${ROOT}/main.ts.map`);
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
});

Deno.test("an open document that changed on disk is compiled from its disk text", () => {
  const h = started();
  h.deliver(didOpen(USERS, 1, USERS_TEXT));
  h.deliver(save(MAIN));
  setDisk(h, "users.eff", USERS_PURE);
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  assertEquals(
    h.files.get(`${ROOT}/users.ts`),
    oracle(h).get("users.ts"),
  );
});

Deno.test("a round shows the overlay program the new disk text of a closed file", () => {
  const h = started();
  h.deliver(save(MAIN));
  h.clearSent();
  setDisk(h, "users.eff", USERS_BROKEN);
  h.deliver(save(MAIN));
  const users = h.published().find((p) => p.uri === USERS);
  assert(users !== undefined);
  assertEquals(users.diagnostics.map((d) => d.code), ["type-mismatch/003"]);
});

Deno.test("a rename removes the outputs of the old path and writes the new path", () => {
  const h = started({ "solo.eff": SOLO });
  h.deliver(save(MAIN));
  assert(h.files.has(`${ROOT}/solo.ts`) && h.files.has(`${ROOT}/solo.ts.map`));
  setDisk(h, "solo.eff", undefined);
  setDisk(h, "solo2.eff", SOLO);
  h.clearSent();
  h.deliver(save(MAIN));
  assert(
    !h.files.has(`${ROOT}/solo.ts`) && !h.files.has(`${ROOT}/solo.ts.map`),
  );
  assert(h.files.has(`${ROOT}/solo2.ts`));
  assertMatchesOracle(h);
  assertEquals(logsOf(h, 4).filter((m) => m.startsWith("removed")).sort(), [
    "removed solo.ts",
    "removed solo.ts.map",
  ]);
});

Deno.test("a close without save leaves the outputs on the disk texts", () => {
  const h = started();
  h.deliver(save(MAIN));
  h.deliver(didOpen(USERS, 1, USERS_TEXT), didChangeFull(USERS, 2, USERS_PURE));
  h.deliver(save(MAIN));
  assertMatchesOracle(h);
  const before = new Map(h.files);
  h.deliver(didClose(USERS), save(MAIN));
  assertEquals(h.files, before);
});

Deno.test("nested roots: the outer round neither writes nor removes the inner outputs", () => {
  const inner = "export const inner = (): Int => 1\n\ntype Int = int\n";
  const h = started({ "inner/effektive.json": "{}", "inner/m.eff": inner });
  h.deliver(save(MAIN));
  assert(oracle(h).has("inner/m.ts"));
  assert(!h.files.has(`${ROOT}/inner/m.ts`));
  assertMatchesOracle(h, "inner/");
  // The inner project owns these files. The outer round leaves them alone.
  const header =
    "// Generated from inner/m.eff by the Effektive compiler. Do not edit.";
  setDisk(h, "inner/m.ts", `${header}\n`);
  setDisk(h, "inner/m.eff", undefined);
  h.deliver(save(MAIN));
  assertEquals(h.files.get(`${ROOT}/inner/m.ts`), `${header}\n`);
});

Deno.test("a failed map removal is retried on the next round", () => {
  const h = started({ "solo.eff": SOLO });
  h.deliver(save(MAIN));
  setDisk(h, "solo.eff", undefined);
  h.unwritable.add(`${ROOT}/solo.ts.map`);
  h.clearSent();
  h.deliver(save(MAIN));
  const errors = logsOf(h, 1);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], "cannot remove solo.ts.map");
  // The .ts file still has the header that proves ownership.
  assert(h.files.has(`${ROOT}/solo.ts`));
  h.unwritable.clear();
  h.deliver(save(MAIN));
  assert(
    !h.files.has(`${ROOT}/solo.ts`) && !h.files.has(`${ROOT}/solo.ts.map`),
  );
  assertMatchesOracle(h);
});

/** The type-4, type-1, and type-3 logs of the harness, as "type message", in order. */
function roundLogs(h: Harness): string[] {
  return h.logs().filter((l) => l.type === 1 || l.type === 3 || l.type === 4)
    .map((l) => `${l.type} ${l.message}`);
}

Deno.test("a round logs each removed path and each removal note in module order", () => {
  const h = started({ "aa.eff": SOLO, "bb.eff": SOLO });
  h.deliver(save(MAIN));
  setDisk(h, "aa.eff", undefined);
  setDisk(h, "bb.eff", undefined);
  // The map goes first, so aa loses its map and then fails on its .ts file.
  h.unwritable.add(`${ROOT}/aa.ts`);
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(roundLogs(h), [
    "4 removed aa.ts.map",
    "1 error: cannot remove aa.ts: permission denied",
    "4 removed bb.ts.map",
    "4 removed bb.ts",
  ]);
});

Deno.test("a round logs removals, writes, write notes, and held modules in that order", () => {
  const h = started({ "solo.eff": SOLO });
  h.deliver(save(MAIN));
  setDisk(h, "solo.eff", undefined);
  setDisk(h, "extra.eff", SOLO);
  setDisk(h, "users.eff", USERS_BROKEN);
  h.unwritable.add(`${ROOT}/extra.ts.map`);
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(roundLogs(h), [
    "4 removed solo.ts.map",
    "4 removed solo.ts",
    "4 wrote extra.ts",
    "1 error: cannot write extra.ts.map: permission denied",
    "3 users is not written: it has 1 diagnostics",
    "3 main is not written: it imports users, which is not written",
  ]);
});

Deno.test("a held module is logged once at type 3 and cleared when it is writable", () => {
  const h = started();
  setDisk(h, "users.eff", USERS_BROKEN);
  h.deliver(save(MAIN));
  const held = logsOf(h, 3);
  assertEquals(held.length, 2);
  assert(held.includes("users is not written: it has 1 diagnostics"));
  assert(h.files.has(`${ROOT}/host/providers.effi.ts`));
  assert(
    held.includes(
      "main is not written: it imports users, which is not written",
    ),
  );
  h.clearSent();
  h.deliver(save(MAIN));
  assertEquals(logsOf(h, 3), []);
  setDisk(h, "users.eff", USERS_TEXT);
  h.deliver(save(MAIN));
  assertEquals(logsOf(h, 3), []);
  setDisk(h, "users.eff", USERS_BROKEN);
  h.deliver(save(MAIN));
  assertEquals(logsOf(h, 3).length, 2);
});

Deno.test("writeOnSave false writes nothing and logs nothing", () => {
  const h = started({}, { writeOnSave: false });
  const before = new Map(h.files);
  h.deliver(
    save(MAIN),
    watched({ uri: uriOf(`${ROOT}/effektive.json`), type: 2 }),
  );
  assertEquals(h.files, before);
  assertEquals(h.logs(), []);
});

const NESTED_V1 = "export const x = (): Int => 1\n\ntype Int = int\n";
const NESTED_V2 = "export const x = (): Int => 2\n\ntype Int = int\n";

Deno.test("a nested effektive.json created while a module is open moves the module and gets a round", () => {
  const h = makeHarness({
    files: {
      [`${ROOT}/effektive.json`]: "{}",
      [`${ROOT}/sub/x.eff`]: NESTED_V1,
    },
  });
  h.start();
  const x = uriOf(`${ROOT}/sub/x.eff`);
  h.deliver(didOpen(x, 1, NESTED_V1));
  h.files.set(`${ROOT}/sub/effektive.json`, "{}");
  h.clearSent();
  h.deliver(watched({ uri: uriOf(`${ROOT}/sub/effektive.json`), type: 1 }));
  assertEquals(h.server.projects.lookup(x)?.project.root, `${ROOT}/sub`);
  assertEquals(roundLogs(h), ["4 wrote x.ts", "4 wrote x.ts.map"]);
  h.files.set(`${ROOT}/sub/x.eff`, NESTED_V2);
  h.clearSent();
  h.deliver(didChangeFull(x, 2, NESTED_V2), save(x));
  // The source map is the same for both versions, so only the module changes.
  assertEquals(roundLogs(h), ["4 wrote x.ts"]);
  assertStringIncludes(
    h.files.get(`${ROOT}/sub/x.ts`) ?? "",
    "export const x = (): Int => 2",
  );
});

Deno.test("a nested effektive.json deleted while a module is open returns the module to the outer project", () => {
  const h = makeHarness({
    files: {
      [`${ROOT}/effektive.json`]: "{}",
      [`${ROOT}/sub/effektive.json`]: "{}",
      [`${ROOT}/sub/x.eff`]: NESTED_V1,
    },
  });
  h.start();
  const x = uriOf(`${ROOT}/sub/x.eff`);
  h.deliver(didOpen(x, 1, NESTED_V1), save(x));
  h.files.delete(`${ROOT}/sub/effektive.json`);
  h.clearSent();
  h.deliver(watched({ uri: uriOf(`${ROOT}/sub/effektive.json`), type: 3 }));
  assertEquals(h.server.projects.lookup(x)?.project.root, ROOT);
  assertEquals(h.server.projects.projects().map((p) => p.root), [ROOT]);
  assertEquals(roundLogs(h), []);
  assertEquals(h.published(), [{ uri: x, version: 1, diagnostics: [] }]);
  // The nested project wrote these files with a header that names `x.eff`.
  h.files.delete(`${ROOT}/sub/x.ts`);
  h.files.delete(`${ROOT}/sub/x.ts.map`);
  h.files.set(`${ROOT}/sub/x.eff`, NESTED_V2);
  h.clearSent();
  h.deliver(didChangeFull(x, 2, NESTED_V2), save(x));
  assertEquals(roundLogs(h), ["4 wrote sub/x.ts", "4 wrote sub/x.ts.map"]);
  assertStringIncludes(
    h.files.get(`${ROOT}/sub/x.ts`) ?? "",
    "export const x = (): Int => 2",
  );
});
