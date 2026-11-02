// Error paths of the built-in type names in the declaration checker
// (`TypeLowerer.named` in src/core/type_lower.ts): a wrong number of type arguments
// for Ref and RetrySchedule, and a RetrySchedule over a type that is not a
// declared error. Each case pins the code, the text of the node that carries
// the span, and the message.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

const PRELUDE = "type Int = int\nerror E = {}\nerror F = {}\n";

/** The diagnostics for one type alias `T`, as [code, node text, message]. */
function reportsFor(body: string): string[][] {
  const text = `${PRELUDE}type T = ${body}\n`;
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => [
    d.code,
    text.slice(d.span.start, d.span.end),
    d.message,
  ]);
}

const ARITY = "type-mismatch/001";

Deno.test("a wrong number of type arguments names the type and the counts", () => {
  const cases: readonly (readonly [body: string, message: string])[] = [
    ["Ref<>", "`Ref` takes 1 type argument, but 0 are given"],
    ["Ref<Int, Int>", "`Ref` takes 1 type argument, but 2 are given"],
    [
      "RetrySchedule<>",
      "`RetrySchedule` takes 1 type argument, but 0 are given",
    ],
    [
      "RetrySchedule<E, F>",
      "`RetrySchedule` takes 1 type argument, but 2 are given",
    ],
  ];
  for (const [body, message] of cases) {
    assertEquals(reportsFor(body), [[ARITY, body, message]], body);
  }
});

Deno.test("a RetrySchedule needs a declared error type", () => {
  assertEquals(reportsFor("RetrySchedule<E>"), []);
  assertEquals(reportsFor("RetrySchedule<Int>"), [
    [ARITY, "Int", "RetrySchedule needs a declared error type"],
  ]);
  assertEquals(reportsFor("RetrySchedule<Option<E>>"), [
    [ARITY, "Option<E>", "RetrySchedule needs a declared error type"],
  ]);
});
