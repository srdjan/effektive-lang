// Tests for the names that the generated TypeScript reserves (decision D20).
// The emitter prints `Math`, `Error`, `String`, and `globalThis` as bare globals,
// so no source declaration or binding may take them.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

function messages(source: string): string[] {
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": source }),
    "",
    ["main.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

const CASES: readonly (readonly [string, string, string])[] = [
  [
    "a module declaration named Math",
    "type Int = int\nexport const Math: Int = 0\n",
    "declaration/002: `Math` is reserved because the generated TypeScript needs it",
  ],
  [
    "a parameter named Math",
    "type Int = int\nconst f = (Math: Int): Int => Math\n",
    "declaration/002: `Math` is reserved because the generated TypeScript needs it",
  ],
  [
    "a local named Math",
    "type Int = int\nconst f = (): Int => {\n  const Math = 2\n  Math\n}\n",
    "declaration/002: `Math` is reserved because the generated TypeScript needs it",
  ],
  [
    "a module declaration named Error",
    "type Int = int\nexport const Error: Int = 0\n",
    "declaration/002: `Error` is reserved because the generated TypeScript needs it",
  ],
  [
    "a parameter named Error",
    "type Int = int\nconst f = (Error: Int): Int => Error\n",
    "declaration/002: `Error` is reserved because the generated TypeScript needs it",
  ],
  [
    "a local named Error",
    "type Int = int\nconst f = (): Int => {\n  const Error = 2\n  Error\n}\n",
    "declaration/002: `Error` is reserved because the generated TypeScript needs it",
  ],
  [
    "a module declaration named String",
    "type Int = int\nexport const String: Int = 0\n",
    "declaration/002: `String` is reserved because the generated TypeScript needs it",
  ],
  [
    "a parameter named String",
    "type Int = int\nconst f = (String: Int): Int => String\n",
    "declaration/002: `String` is reserved because the generated TypeScript needs it",
  ],
  [
    "a local named String",
    "type Int = int\nconst f = (): Int => {\n  const String = 2\n  String\n}\n",
    "declaration/002: `String` is reserved because the generated TypeScript needs it",
  ],
  [
    "a module declaration named globalThis",
    "type Int = int\nexport const globalThis: Int = 0\n",
    "declaration/002: `globalThis` is reserved because the generated TypeScript needs it",
  ],
  [
    "a parameter named globalThis",
    "type Int = int\nconst f = (globalThis: Int): Int => globalThis\n",
    "declaration/002: `globalThis` is reserved because the generated TypeScript needs it",
  ],
  [
    "a local named globalThis",
    "type Int = int\nconst f = (): Int => {\n  const globalThis = 2\n  globalThis\n}\n",
    "declaration/002: `globalThis` is reserved because the generated TypeScript needs it",
  ],
  [
    "a module declaration named TypeError",
    "type Int = int\nexport const TypeError: Int = 0\n",
    "declaration/002: `TypeError` is reserved because the generated TypeScript needs it",
  ],
  [
    "a parameter named TypeError",
    "type Int = int\nconst f = (TypeError: Int): Int => TypeError\n",
    "declaration/002: `TypeError` is reserved because the generated TypeScript needs it",
  ],
  [
    "a local named TypeError",
    "type Int = int\nconst f = (): Int => {\n  const TypeError = 2\n  TypeError\n}\n",
    "declaration/002: `TypeError` is reserved because the generated TypeScript needs it",
  ],
];

for (const [name, source, expected] of CASES) {
  Deno.test(`the checker rejects ${name}`, () => {
    assertEquals(messages(source), [expected]);
  });
}

Deno.test("a field may take a name that the generated TypeScript reserves", () => {
  assertEquals(
    messages("type Row = { Math: int, Error: int, String: int }\n"),
    [],
  );
});
