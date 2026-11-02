// The scope handle names left the prelude (rebase unit G3). Each removed name
// is an ordinary unknown name, and a module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed scope handle builtin is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    ["makeScope()", "makeScope"],
    ["provideScope(1, 2)", "provideScope"],
    ["addScopeFinalizer(1, 2)", "addScopeFinalizer"],
    ["closeScope(1)", "closeScope"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("CloseableScope is an unknown type", () => {
  assertEquals(
    diagnosticsOf(`${INT}export const a = (s: CloseableScope): Int => 1\n`),
    ["unknown-name/001 unknown type `CloseableScope`"],
  );
});

Deno.test("a module can declare the removed names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}type CloseableScope = Int
export const makeScope = (n: Int): Int => n
export const provideScope = (a: Int, b: Int): Int => a + b
export const addScopeFinalizer = (a: Int, b: Int): Int => a + b
export const closeScope = (n: Int): Int => makeScope(n)
`,
    ),
    [],
  );
});
