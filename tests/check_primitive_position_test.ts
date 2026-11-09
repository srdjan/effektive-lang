// Tests for rule R1: a primitive type node can occur only inside a type or
// error declaration. Each test runs through the public entry `checkProject`.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

Deno.test("a string parameter outside a type declaration gives declaration/013 with the exact message", () => {
  assertEquals(
    diagnosticsOf(
      "type Count = int\nconst f = (name: string): Count => 1\n",
    ),
    [
      "declaration/013 the primitive type `string` can occur only inside a type or error declaration",
    ],
  );
});

Deno.test("a literal type outside a type declaration gives declaration/013 with its source text", () => {
  assertEquals(
    diagnosticsOf(
      'type Count = int\nconst f = (s: "paid"): Count => 1\n',
    ),
    [
      'declaration/013 the primitive type `"paid"` can occur only inside a type or error declaration',
    ],
  );
});

Deno.test("primitives inside type and error bodies give no diagnostic", () => {
  const source = [
    "type Name = string",
    'type Status = "pending" | "paid"',
    "type Item = { name: string, tags: string[], count: int }",
    "error Declined = { reason: string }",
    "const f = (name: Name, item: Item): Name => name",
    "",
  ].join("\n");
  assertEquals(diagnosticsOf(source), []);
});
