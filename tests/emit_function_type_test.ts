// A function type with an empty parameter list prints `()` in every layout. The
// signature of `make` is long enough that the signature breaks.

import { assertEquals } from "@std/assert";
import { emitFiles } from "./helpers.ts";

const SOURCE = `type Int = int
export const make = (first: Int, second: Int, third: Int, fourth: Int): () => Int => () => first
`;

Deno.test("a long signature with a thunk result prints the empty parameter list", () => {
  const files = { "effektive.json": "{}", "main.eff": SOURCE };
  const text = emitFiles(files, ["main.eff"]).get("main")?.text ?? "";
  assertEquals(
    text.includes(
      `export const make = (
  first: Int,
  second: Int,
  third: Int,
  fourth: Int,
): () => Effect.Effect<Int> =>
() => Effect.succeed(first);
`,
    ),
    true,
    text,
  );
});
