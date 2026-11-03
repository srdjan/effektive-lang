// Fast tests of `effektive check --fix`. They run `main` in process with the
// in-memory doubles of cli_helpers.ts.

import { assertEquals } from "@std/assert";
import { main } from "../src/cli/main.ts";
import { exampleFiles } from "./helpers.ts";
import { memoryIo, under } from "./cli_helpers.ts";

const ROOT = "/proj";
const CONFIG = { "effektive.json": "{}" };

async function run(args: readonly string[], files: Record<string, string>) {
  const m = memoryIo(under(ROOT, files));
  const code = await main(args, m.io);
  return { code, stdout: m.out.join(""), stderr: m.err.join(""), m };
}

const SERVICE = [
  "export type Id = string",
  "export error Missing = { id: Id }",
  "export service Store {",
  "  find(id: Id): Id fails Missing",
  "}",
  "",
].join("\n");

Deno.test("check --fix adds a missing requirement and leaves the inferred failure open", async () => {
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...CONFIG,
    "a.eff": SERVICE +
      "export const load = (id: Id): Id => Store.find(id)\n",
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(
    r.m.files.get(`${ROOT}/a.eff`),
    SERVICE +
      "export const load = (id: Id): Id with Store => Store.find(id)\n",
  );
  assertEquals(r.stdout, "");
  assertEquals(
    r.stderr,
    "1 module, 0 diagnostics, fixed 1 function in 1 file\n",
  );
});

Deno.test("check --fix adds a missing failure to a written fails clause", async () => {
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...CONFIG,
    "a.eff": SERVICE + "export error Other = { id: Id }\n" +
      "export const load = (id: Id): Id fails Other with Store => Store.find(id)\n",
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(
    r.m.files.get(`${ROOT}/a.eff`),
    SERVICE + "export error Other = { id: Id }\n" +
      "export const load = (id: Id): Id fails Other | Missing with Store => Store.find(id)\n",
  );
});

Deno.test("check --fix writes no failure clause for an export that infers its failures", async () => {
  const text = SERVICE +
    "export const load = (id: Id): Id with Store => Store.find(id)\n";
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...CONFIG,
    "a.eff": text,
  });
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.m.files.get(`${ROOT}/a.eff`), text);
  assertEquals(r.stderr, "1 module, 0 diagnostics\n");
});

Deno.test("check --fix fixes a closed caller in a second module in a later round", async () => {
  const a = [
    "export type Id = string",
    "export error Gone = { id: Id }",
    "export error Other = { id: Id }",
    "export const f = (id: Id): Id fails Other => fail(Gone({ id }))",
    "",
  ].join("\n");
  const b = [
    'import { f, Gone, Id, Other } from "./a.eff"',
    "export const g = (id: Id): Id fails Other => f(id)",
    "",
  ].join("\n");
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...CONFIG,
    "a.eff": a,
    "b.eff": b,
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertEquals(
    r.m.files.get(`${ROOT}/a.eff`),
    [
      "export type Id = string",
      "export error Gone = { id: Id }",
      "export error Other = { id: Id }",
      "export const f = (id: Id): Id fails Other | Gone => fail(Gone({ id }))",
      "",
    ].join("\n"),
  );
  assertEquals(
    r.m.files.get(`${ROOT}/b.eff`),
    [
      'import { f, Gone, Id, Other } from "./a.eff"',
      "export const g = (id: Id): Id fails Other | Gone => f(id)",
      "",
    ].join("\n"),
  );
  assertEquals(
    r.stderr,
    "2 modules, 0 diagnostics, fixed 2 functions in 2 files\n",
  );
});

Deno.test("check --fix writes no file when nothing needs a fix", async () => {
  const files = under(ROOT, exampleFiles());
  const m = memoryIo(files);
  const before = new Map(m.files);
  const code = await main(["check", ROOT, "--fix", "--no-log"], m.io);
  assertEquals(code, 0, m.err.join(""));
  assertEquals(m.files, before);
  assertEquals(m.err.join(""), "6 modules, 0 diagnostics\n");
});

Deno.test("check --fix keeps an unrelated error and still fixes a function", async () => {
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...CONFIG,
    "a.eff": SERVICE +
      "export const load = (id: Id): Id => Store.find(id)\n" +
      "export const broken = (id: Id): Id => missing(id)\n",
  });
  assertEquals(r.code, 1);
  assertEquals(
    r.m.files.get(`${ROOT}/a.eff`),
    SERVICE +
      "export const load = (id: Id): Id with Store => Store.find(id)\n" +
      "export const broken = (id: Id): Id => missing(id)\n",
  );
  assertEquals(
    r.stdout,
    "a.eff:7:39: error unknown-name/001: unknown name `missing`\n",
  );
  assertEquals(
    r.stderr,
    "1 module, 1 diagnostic, fixed 1 function in 1 file\n",
  );
});

Deno.test("build --fix is a usage error", async () => {
  const r = await run(["build", ROOT, "--fix"], CONFIG);
  assertEquals(r.code, 2);
  assertEquals(
    r.stderr.split("\n")[0],
    "effektive: unknown flag `--fix` for `build`",
  );
});

Deno.test("watch --fix is a usage error", async () => {
  const r = await run(["watch", ROOT, "--fix"], CONFIG);
  assertEquals(r.code, 2);
  assertEquals(
    r.stderr.split("\n")[0],
    "effektive: unknown flag `--fix` for `watch`",
  );
});

Deno.test("check --fix restores the removed with clauses of the examples and keeps the failures inferred", async () => {
  const files = exampleFiles();
  const stripped = files["users.eff"].replace(/ with Users(?= =>)/g, "");
  const r = await run(["check", ROOT, "--fix", "--no-log"], {
    ...files,
    "users.eff": stripped,
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertEquals(r.stdout, "");
  assertEquals(
    r.stderr,
    "6 modules, 0 diagnostics, fixed 4 functions in 1 file\n",
  );
  assertEquals(
    r.m.files.get(`${ROOT}/users.eff`)?.split("\n").slice(18, 19),
    [
      "export const getUser = (id: UserId): User with Users.find =>",
    ],
  );
});
