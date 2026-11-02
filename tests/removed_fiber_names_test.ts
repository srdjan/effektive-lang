// The fiber handles left the prelude (rebase unit G5). Each removed name is an
// ordinary unknown name, and a module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed fiber builtin is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    ["withFiber(defer(() => 1), (fiber) => 1)", "withFiber"],
    ["joinFiber(1)", "joinFiber"],
    ["interruptFiber(1)", "interruptFiber"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("Fiber is an unknown type", () => {
  assertEquals(
    diagnosticsOf(`${INT}export const a = (f: Fiber<Int, never>): Int => 1\n`),
    ["unknown-name/001 unknown type `Fiber`"],
  );
});

Deno.test("a module can declare the removed names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}type Fiber = Int
export const withFiber = (n: Int): Int => n
export const joinFiber = (n: Int): Int => n
export const interruptFiber = (n: Int): Int => n
export const chain = (n: Int): Fiber => joinFiber(interruptFiber(withFiber(n)))
`,
    ),
    [],
  );
});
