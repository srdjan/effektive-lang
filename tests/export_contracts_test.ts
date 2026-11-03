// Tests for the inferred failure sets of exported functions: an omitted
// `fails` clause is inferred from the body, an omitted `with` clause means no
// services, and a written `fails` clause stays a checked upper bound.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  inlayHintsAt,
  type ModuleIR,
  Program,
  type Result,
  type Revision,
} from "../src/core/mod.ts";
import type { LowerError } from "../src/core/mod.ts";
import type { ValueId } from "../src/core/ir.ts";
import { emitFiles } from "./helpers.ts";
import { validateRevision } from "./validate_helpers.ts";

function load(files: Record<string, string>, program = new Program("")) {
  const result = program.update({
    set: { "effektive.json": "{}", ...files },
  });
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function codesOf(revision: Revision): string[] {
  return revision.diagnostics.map((d) => d.code);
}

function bodyOf(revision: Revision, module: string, name: string) {
  const body = revision.checkedModule(module)?.functions.get(
    `value:${module}#${name}` as ValueId,
  );
  assert(body !== undefined, `${module}.${name}`);
  return body;
}

function interfaceOf(revision: Revision, module: string) {
  const built = revision.checkedModule(module)?.interface;
  assert(built?.ok, `interface of ${module}`);
  return built.value.payload;
}

/** The validator findings of every lowered module of the revision. */
function validationOf(revision: Revision): string[] {
  const lowered = new Map<string, Result<ModuleIR, LowerError>>();
  for (const name of revision.moduleNames()) {
    const ir = revision.lowered(name);
    assert(ir !== undefined, name);
    assert(ir.ok, `${name} did not lower`);
    lowered.set(name, ir);
  }
  return [...validateRevision(revision, lowered).values()].flat().map((d) =>
    `${d.code} ${d.message}`
  );
}

const E_AND_F = `export type Text = string
error E = { m: string }
export const f = (): Text => fail(E({ m: "x" }))
`;

Deno.test("an export with no fails clause infers its failures and publishes them", () => {
  const revision = load({ "m.eff": E_AND_F });
  assertEquals(codesOf(revision), []);
  const body = bodyOf(revision, "m", "f");
  assertEquals(body.failures, ["error:m#E"]);
  assertEquals(body.signature.written, {
    result: true,
    fails: false,
    uses: true,
  });
  const value = interfaceOf(revision, "m").values.find((v) => v.name === "f");
  assert(value?.type.kind === "function");
  assertEquals(value.type.effects.failures, ["error:m#E"]);
  const text = emitFiles({ "effektive.json": "{}", "m.eff": E_AND_F }, [
    "m.eff",
  ]).get("m")?.text;
  assertStringIncludes(text ?? "", "Effect.Effect<Text, E>");
});

Deno.test("an importer handles the inferred failure of an export in a catch arm", () => {
  const revision = load({
    "a.eff": E_AND_F.replace("error E", "export error E"),
    "b.eff": `import { E, f, Text } from "./a.eff"
export const g = (): Text => try { f() } catch { E(e) => e.m }
`,
  });
  assertEquals(codesOf(revision), []);
  assertEquals(bodyOf(revision, "b", "g").failures, []);
});

Deno.test("an export that fails with a private error puts the error in the type graph", () => {
  const revision = load({
    "a.eff": E_AND_F,
    "b.eff": `import { f, Text } from "./a.eff"
export const g = (): Text => f()
`,
  });
  assertEquals(codesOf(revision), []);
  assertEquals(interfaceOf(revision, "a").errors.map((e) => e.id), [
    "error:a#E",
  ]);
  assertEquals(bodyOf(revision, "b", "g").failures, ["error:a#E"]);
  assertEquals(validationOf(revision), []);
});

Deno.test("a foreign error reached through an imported call enters the foreign graph", () => {
  const revision = load({
    "a.eff": E_AND_F.replace("error E", "export error E").replace("f =", "g ="),
    "b.eff": `import { g, Text } from "./a.eff"
export const f = (): Text => g()
`,
    "c.eff": `import { f } from "./b.eff"
import { Text } from "./a.eff"
export const h = (): Text => f()
`,
  });
  assertEquals(codesOf(revision), []);
  assertEquals(interfaceOf(revision, "b").errors.map((e) => e.id), [
    "error:a#E",
  ]);
  assertEquals(interfaceOf(revision, "c").errors.map((e) => e.id), [
    "error:a#E",
  ]);
  assertEquals(bodyOf(revision, "c", "h").failures, ["error:a#E"]);
  assertEquals(validationOf(revision), []);
});

Deno.test("a written fails clause of an export is an upper bound", () => {
  const revision = load({
    "m.eff": `type Text = string
error A = { m: string }
error B = { m: string }
export const f = (): Text fails A => fail(B({ m: "x" }))
`,
  });
  assertEquals(
    revision.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "failure-contract/001 the body can fail with B, which the `fails` clause does not list",
    ],
  );
});

Deno.test("an export with no with clause lists no services", () => {
  const revision = load({
    "m.eff": `type Text = string
export service Users { find(id: Text): Text }
export const f = (id: Text): Text => Users.find(id)
`,
  });
  assertEquals(
    revision.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "requirement-contract/001 the body requires Users.find, which the `with` clause does not list",
    ],
  );
});

Deno.test("the inlay hint of an export stands at the end of the result type, before with", () => {
  const text = `type Text = string
error E = { m: string }
export service Users { find(id: Text): Text fails E }
export const f = (id: Text): Text with Users => Users.find(id)
`;
  const revision = load({ "m.eff": text });
  assertEquals(codesOf(revision), []);
  const hints = inlayHintsAt(revision, "m.eff", {
    start: 0,
    end: text.length,
  });
  assertEquals(hints, [{
    position: text.indexOf(" with Users"),
    label: " fails E",
  }]);
});

Deno.test("a body edit that adds or removes a failure changes the interface hash and the importer", () => {
  const importer = `import { E, f, Text } from "./a.eff"
export const g = (): Text => try { f() } catch { E(e) => e.m }
`;
  const withoutFailure = `export type Text = string
export error E = { m: string }
export const f = (): Text => "x"
`;
  const withFailure = `export type Text = string
export error E = { m: string }
export const f = (): Text => fail(E({ m: "x" }))
`;
  const program = new Program("");
  const first = load({ "a.eff": withoutFailure, "b.eff": importer }, program);
  assertEquals(codesOf(first), ["failure-contract/002"]);
  const second = load({ "a.eff": withFailure }, program);
  assertEquals(codesOf(second), []);
  assert(second.interfaceHash("a") !== first.interfaceHash("a"));
  assertEquals(second.rechecked, ["a", "b"]);
  const third = load({ "a.eff": withoutFailure }, program);
  assertEquals(codesOf(third), ["failure-contract/002"]);
  assertEquals(third.interfaceHash("a"), first.interfaceHash("a"));
});

Deno.test("a recursive group of exports settles through the group solver", () => {
  const revision = load({
    "m.eff": `type Text = string
type Int = int
error E = { m: string }
export const even = (n: Int): Int =>
  if (n > 0) { odd(n - 1) } else { fail(E({ m: "x" })) }
export const odd = (n: Int): Int => if (n > 0) { even(n - 1) } else { 0 }
export const loop = (n: Int): Int => if (n > 0) { loop(n - 1) } else { 0 }
`,
  });
  assertEquals(codesOf(revision), []);
  assertEquals(bodyOf(revision, "m", "even").failures, ["error:m#E"]);
  assertEquals(bodyOf(revision, "m", "odd").failures, ["error:m#E"]);
  assertEquals(bodyOf(revision, "m", "loop").failures, []);
  assertEquals(bodyOf(revision, "m", "loop").mode, "pure");
});

Deno.test("the span-only rebuild of an importer keeps the inferred failures of its exports", () => {
  const a = E_AND_F.replace("error E", "export error E");
  const b = `import { f, Text } from "./a.eff"
export const g = (): Text => f()
`;
  const program = new Program("");
  const first = load({ "a.eff": a, "b.eff": b }, program);
  const second = load({ "a.eff": "// moves every span\n" + a }, program);
  assertEquals(second.rechecked, ["a"]);
  const value = interfaceOf(second, "b").values.find((v) => v.name === "g");
  assert(value?.type.kind === "function");
  assertEquals(value.type.effects.failures, ["error:a#E"]);
  assertEquals(second.interfaceHash("b"), first.interfaceHash("b"));
});
