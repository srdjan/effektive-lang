// The codec names and the authored Schema issue constructors left the prelude
// (rebase unit G4). Each removed name is an ordinary unknown name, and a
// module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed codec and issue builtin is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    ["codec((n: Int): Int => n, (n: Int): Int => n)", "codec"],
    ["decode(1, 2)", "decode"],
    ["encode(1, 2)", "encode"],
    ['schemaInvalid("x")', "schemaInvalid"],
    ['schemaAt("k", 1)', "schemaAt"],
    ["schemaBoth(1, 2, 3)", "schemaBoth"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("Codec is an unknown type", () => {
  assertEquals(
    diagnosticsOf(`${INT}export const a = (c: Codec<Int, Int>): Int => 1\n`),
    ["unknown-name/001 unknown type `Codec`"],
  );
});

Deno.test("a module can declare the removed names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}type Codec = Int
export const codec = (n: Int): Int => n
export const decode = (n: Int): Int => codec(n)
export const encode = (n: Int): Int => decode(n)
export const schemaInvalid = (n: Int): Int => encode(n)
export const schemaAt = (n: Int): Int => schemaInvalid(n)
export const schemaBoth = (n: Int): Int => schemaAt(n)
`,
    ),
    [],
  );
});
