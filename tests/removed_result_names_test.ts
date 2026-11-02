// The result collection names left the prelude (rebase unit G6). Each removed
// name is an ordinary unknown name, and a module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed result collection builtin is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    ["partitionAll([defer(() => 1)])", "partitionAll"],
    ["validateAll([defer(() => 1)], (errors) => 1)", "validateAll"],
    ["allResults([defer(() => 1)])", "allResults"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("a module can declare the removed names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}export const partitionAll = (n: Int): Int => n
export const validateAll = (n: Int): Int => partitionAll(n)
export const allResults = (n: Int): Int => validateAll(n)
`,
    ),
    [],
  );
});
