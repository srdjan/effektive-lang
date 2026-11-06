// Tests for the declaration index and the content hash.

import { assert, assertEquals } from "@std/assert";
import { fnv1a64 } from "../src/core/hash.ts";
import { buildIndex, type DeclEntry } from "../src/core/declaration_index.ts";
import { parse } from "../src/core/parse.ts";
import { FIXTURES } from "./helpers.ts";

function indexOf(text: string, path = "m.eff") {
  return buildIndex(parse(path, text).tree);
}

function decl(text: string, name: string): DeclEntry {
  const entry = indexOf(text).byName.get(name);
  assert(entry !== undefined, `no declaration ${name}`);
  return entry;
}

function sliceOf(text: string, span: { start: number; end: number }): string {
  return text.slice(span.start, span.end);
}

Deno.test("fnv1a64 matches the published FNV-1a 64-bit vectors", () => {
  assertEquals(fnv1a64(""), "cbf29ce484222325");
  assertEquals(fnv1a64("a"), "af63dc4c8601ec8c");
  assertEquals(fnv1a64("foobar"), "85944171f73967e8");
});

Deno.test("fnv1a64 hashes UTF-16 code units, so a surrogate pair is two units", () => {
  assertEquals(fnv1a64("\u{1F600}"), "e5e45a0a241b88d8");
  assertEquals(fnv1a64("\u{1F601}"), "e5e45b0a241b8a8b");
});

Deno.test("the index lists the service contract declarations", () => {
  const text = Deno.readTextFileSync(
    new URL("examples/users-service.eff", FIXTURES),
  );
  const index = indexOf(text, "users-service.eff");
  assertEquals(
    index.decls.map((d) => `${d.kind} ${d.name} ${d.exported}`),
    [
      "type UserId true",
      "type Name true",
      "type User true",
      "error UserMissing true",
      "error StoreUnavailable true",
      "service Users true",
    ],
  );
  const users = index.byName.get("Users")!;
  assertEquals([...users.methods.keys()], ["find", "save", "all"]);
  assertEquals(users.methodList.length, 3);
});

Deno.test("a private declaration is not exported", () => {
  const index = indexOf(
    "const a = (): int => 1\nexport const b = (): int => 2\n",
  );
  assertEquals(index.byName.get("a")!.exported, false);
  assertEquals(index.byName.get("b")!.exported, true);
});

Deno.test("a const arrow is flagged and its name span covers the name", () => {
  const text =
    "export const f = (x: int): int\n  fails E\n  with S.m => x + 1\n";
  const d = decl(text, "f");
  assertEquals(d.isArrow, true);
  assertEquals(sliceOf(text, d.nameSpan), "f");
});

Deno.test("isArrow is true only for a const whose first value node is an arrow", () => {
  const rows: readonly (readonly [string, string, boolean])[] = [
    ["const f = (x: int): int => x\n", "f", true],
    ["const k: int = 3\n", "k", false],
    ["type T = { a: int }\n", "T", false],
    ["const k\n", "k", false],
    ["const f = (x: int): int =>\n", "f", true],
  ];
  for (const [text, name, expected] of rows) {
    const entry = indexOf(text).byName.get(name);
    assertEquals(entry?.isArrow, expected, text);
  }
});

Deno.test("a service method span covers the method signature", () => {
  const text = "export service S {\n  a(): int\n  b(x: int): int fails E\n}\n";
  const s = decl(text, "S");
  assertEquals(
    sliceOf(text, s.methods.get("b")!.span),
    "b(x: int): int fails E",
  );
});

Deno.test("a provider in an interface file is indexed with the provider kind", () => {
  const text = 'import { U } from "./u.eff"\nexport provider P provides U\n';
  const p = indexOf(text, "h.effi").byName.get("P")!;
  assertEquals(p.kind, "provider");
  assertEquals(sliceOf(text, p.span), "export provider P provides U");
});

Deno.test("an import entry holds its names and its decoded specifier", () => {
  const text = 'import { a, b } from "./lib.eff"\nimport { c } from "host:x"\n';
  const imports = indexOf(text).imports;
  assertEquals(imports.length, 2);
  assertEquals(imports[0].names.map((n) => n.name), ["a", "b"]);
  assertEquals(imports[0].specifier, "./lib.eff");
  assertEquals(imports[1].specifier, "host:x");
  assertEquals(sliceOf(text, imports[0].specifierSpan!), '"./lib.eff"');
});

Deno.test("broken declarations are indexed when their name parsed", () => {
  const text =
    "const ok = (): int => 1\nconst broken = (: int =>\nconst after = (): int => 2\n";
  const index = indexOf(text);
  assertEquals(index.decls.map((d) => d.name), ["ok", "broken", "after"]);
  assertEquals(index.byName.get("ok")!.broken, false);
  assertEquals(index.byName.get("broken")!.broken, true);
  assertEquals(index.byName.get("after")!.broken, false);
});

Deno.test("a repeated name keeps the first entry in byName and both in decls", () => {
  const index = indexOf("const a = (): int => 1\nconst a = (): int => 2\n");
  assertEquals(index.decls.length, 2);
  assertEquals(index.byName.get("a")!.node, index.decls[0].node);
});
