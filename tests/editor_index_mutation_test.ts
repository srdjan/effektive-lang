// Tests for the declaration lookup and the reference guards of the editor
// index, one test for each survivor of `deno task mutate` that a test can kill.

import {
  Program,
  referencesAt,
  semanticClassifications,
} from "../src/core/frontend.ts";
import { assert, assertEquals } from "@std/assert";

function load(text: string) {
  const loaded = new Program("").update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(loaded.ok);
  return loaded.value;
}

Deno.test("classification marks an arrow const as a function and a plain const as a variable in one module", () => {
  const text = `type Int = int
const f = (x: Int): Int => x
const v: Int = 1
const g = (): Int => f(v)
`;
  const revision = load(text);
  assertEquals(revision.diagnostics, []);
  const classes = semanticClassifications(revision, "m.eff", text).map((c) =>
    `${text.slice(c.span.start, c.span.end)}:${c.type}`
  );
  assertEquals(classes, [
    "type:keyword",
    "Int:type",
    "=:operator",
    "int:type",
    "const:keyword",
    "f:function",
    "=:operator",
    "x:parameter",
    "Int:type",
    "Int:type",
    "=>:operator",
    "x:parameter",
    "const:keyword",
    "v:variable",
    "Int:type",
    "=:operator",
    "1:number",
    "const:keyword",
    "g:function",
    "=:operator",
    "Int:type",
    "=>:operator",
    "f:function",
    "v:variable",
  ]);
});

Deno.test("references at a builtin type name, a field name, and a blank offset are empty", () => {
  const text = `type Int = int
type R = { a: Int }
const r: R = { a: 1 }
const g = (): Int => r.a
`;
  const revision = load(text);
  assertEquals(revision.diagnostics, []);
  assertEquals(referencesAt(revision, "m.eff", text.indexOf("= int") + 2), []);
  assertEquals(referencesAt(revision, "m.eff", text.indexOf("a: Int")), []);
  assertEquals(
    referencesAt(revision, "m.eff", text.indexOf("const r") + 5),
    [],
  );
});
