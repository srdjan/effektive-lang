// The pure builtin `at`. `at(xs, i)` takes an array and an `int` index and gives
// an `Option` of the element. A pipeline left side is the array, a tuple is not
// an array, and a closed unit, a string, or a `Duration` is not an index.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Ints = Int[]
type Text = string
type Texts = Text[]
type Cents = int
type Prices = Cents[]
type Pair = [int, int]
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("at takes an array and an int and gives an option of the element", () => {
  assertEquals(body("xs: Ints, i: Int", "at(xs, i)", "Option<Int>"), []);
  assertEquals(body("xs: Texts", "at(xs, 0)", "Option<Text>"), []);
  assertEquals(body("", "at([10, 20, 30], 1)", "Option<Int>"), []);
  assertEquals(body("xs: Ints", "at(xs, 0) ?? 0", "Int"), []);
  assertEquals(body("xs: Ints", "xs |> at(0)", "Option<Int>"), []);
});

Deno.test("at of an array with identity elements fits the matching option", () => {
  assertEquals(body("cs: Prices", "at(cs, 0)", "Option<Cents>"), []);
  assertEquals(body("ints: Ints", "at(ints, 0)", "Option<Cents>"), [
    "type-mismatch/003 the function body has type Option<Int>, but Option<Cents> is expected",
  ]);
});

Deno.test("at of a tuple is a type mismatch", () => {
  assertEquals(body("p: Pair", "at(p, 0)", "Option<Int>"), [
    "type-mismatch/003 the argument has type Pair, but an array is expected",
  ]);
});

Deno.test("at with a string or a closed unit index is a type mismatch", () => {
  assertEquals(body("xs: Ints", 'at(xs, "a")', "Option<Int>"), [
    "type-mismatch/003 the argument has type string, but int is expected",
  ]);
  assertEquals(body("xs: Ints, d: Duration", "at(xs, d)", "Option<Int>"), [
    "type-mismatch/003 the argument has type Duration, but int is expected",
  ]);
  assertEquals(body("xs: Ints, i: Instant", "at(xs, i)", "Option<Int>"), [
    "type-mismatch/003 the argument has type Instant, but int is expected",
  ]);
});

Deno.test("a module constant named at shadows the builtin", () => {
  assertEquals(
    diagnosticsOf(
      "type Int = int\nconst at = (a: Int, b: Int): Int => a + b\nexport const f = (): Int => at(1, 2)\n",
    ),
    [],
  );
});
