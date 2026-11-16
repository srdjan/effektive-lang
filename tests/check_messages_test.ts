// Messages and spans of checker diagnostics that other tests assert by code only
// or not at all: block-local recursion, error-construction arity, a stream
// callback that is not an inline arrow, a duplicate record binding field, the
// service borrow checks, and three constructor and wildcard pattern messages.
// Every test runs through the public entry `checkProject`.

import { assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";

function located(files: Readonly<Record<string, string>>): string[] {
  const result = checkProject(memoryHost(files), "", ["main.eff"]);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value.diagnostics.map((d) =>
    `${d.code} ${d.message} ${d.span.start}-${d.span.end}`
  );
}

function locatedModule(source: string): string[] {
  return located({ "effektive.json": "{}", "main.eff": source });
}

const HOST_FILES = {
  "effektive.json": JSON.stringify({
    host: { files: { interface: "./host.effi", module: "./host.ts" } },
  }),
  "host.effi": `export opaque type Handle
export type Text = string
export service Files {
  read(borrow handle: Handle): Text
}
`,
  "host.ts": "export {};",
};

Deno.test("a local function that refers to itself is execution-mode/003", () => {
  assertEquals(
    locatedModule(`type Int = int
export const f = (n: Int): Int => {
  const loop = (k: Int): Int => loop(k)
  loop(n)
}
`),
    [
      "execution-mode/003 a local function cannot refer to itself; a recursive function must be a module-level function with an explicit signature 83-87",
    ],
  );
});

Deno.test("an error construction takes exactly one record argument", () => {
  assertEquals(
    locatedModule(`type Int = int
error Issue = { code: Int }
export const f = (): Issue => Issue({ code: 1 }, 2)
`),
    [
      "type-mismatch/004 the error `Issue` takes one record argument, but 2 are given 73-94",
    ],
  );
  assertEquals(
    locatedModule(`type Int = int
error Issue = { code: Int }
export const f = (): Issue => Issue()
`),
    [
      "type-mismatch/004 the error `Issue` takes one record argument, but 0 are given 73-80",
    ],
  );
});

Deno.test("a stream callback that is not an inline arrow is rejected", () => {
  assertEquals(
    locatedModule(`type Int = int
const f = unfold(0, 5)
`),
    [
      "type-mismatch/010 `unfold` requires an inline arrow callback 35-36",
      "type-mismatch/010 the callback of `unfold` must be a function, but the value has type int 35-36",
    ],
  );
  assertEquals(
    locatedModule(`type Int = int
const g = (n: Int) => n
const f = unfold(0, g)
`),
    [
      "type-mismatch/010 `unfold` callback must return Option<[Element, State]> 59-60",
      "type-mismatch/010 `unfold` requires an inline arrow callback 59-60",
    ],
  );
});

Deno.test("a record binding that names a field twice is declaration/001", () => {
  assertEquals(
    locatedModule(`type Int = int
type R = { x: Int, y: Int }
export const f = (r: R): Int => {
  const { x, x: y } = r
  x
}
`),
    ["declaration/001 duplicate record binding field `x` 90-91"],
  );
});

Deno.test("a service borrow parameter in a source module gets two diagnostics at one span", () => {
  assertEquals(
    locatedModule(`type Int = int
export service S { read(borrow x: Int): Int }
`),
    [
      "type-mismatch/010 a service borrow parameter belongs in a host interface 39-52",
      "type-mismatch/010 borrow parameters need an opaque type 39-52",
    ],
  );
});

Deno.test("a wildcard arm after arms that cover every value is unreachable", () => {
  assertEquals(
    locatedModule(`type Int = int
type Text = string
type Tagged = { kind: "a", v: Int } | { kind: "b", v: Int }
export const f = (s: Tagged): Text =>
  match s {
    { kind: "a", ...r } => "a",
    { kind: "b", ...r } => "b",
    _ => "c"
  }
`),
    [
      "pattern/002 this arm is unreachable, because the earlier arms already cover every value 212-213",
    ],
  );
});

Deno.test("tagged record arms must use the same discriminator field", () => {
  assertEquals(
    locatedModule(`type Int = int
type Text = string
type Tagged = { kind: "a", v: Int } | { kind: "b", v: Int }
export const f = (s: Tagged): Text =>
  match s {
    { kind: "a", ...r } => "a",
    { v: "b", ...r } => "b",
    _ => "c"
  }
`),
    [
      "pattern/004 an earlier arm matches on the field `kind`; every arm must use the same discriminator field 180-196",
    ],
  );
});

Deno.test("a constructor pattern on an opaque type is rejected", () => {
  assertEquals(
    located({
      ...HOST_FILES,
      "main.eff": `import { Handle, Files, Text } from "host:files"
const a = (h: Handle): Text =>
  match h {
    Handle(x) => "t",
    _ => "other"
  }
`,
    }),
    [
      "pattern/004 a match cannot take a value of type Handle; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, primitives, and nullable unions 88-89",
      "pattern/004 `Handle` is an opaque type, not a tagged record; a constructor pattern names a tagged record or an error 96-105",
    ],
  );
});
