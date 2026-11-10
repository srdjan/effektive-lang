// A spread in a list literal. `[x, ...xs, y]` joins the elements and the arrays.
// A spread value must be an array, and the element types must have a common type.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Ints = Int[]
type Text = string
type Texts = Text[]
type Pair = [Int, Int]
type NonEmpty = int[] where a => len(a) > 0
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("a spread can stand at any position and a literal can hold several", () => {
  assertEquals(body("xs: Ints, x: Int", "[x, ...xs]", "Ints"), []);
  assertEquals(body("xs: Ints, x: Int", "[...xs, x]", "Ints"), []);
  assertEquals(body("xs: Ints, ys: Ints", "[...xs, ...ys]", "Ints"), []);
  assertEquals(body("", "[0, ...[1, 2], 3]", "Ints"), []);
  assertEquals(body("xs: Ints", "[...xs, 1]", "Int[]"), []);
  assertEquals(body("xs: Ints", "[...xs]", "Ints"), []);
});

Deno.test("a spread of a missing name is unknown-name/001", () => {
  assertEquals(body("", "[...missing]", "Ints"), [
    "unknown-name/001 unknown name `missing`",
  ]);
});

Deno.test("a spread of a value without a type or of a non-array is type-mismatch/003", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}export const f = (xs) => [...xs, 1]\n`)
      .filter((d) => d.startsWith("type-mismatch/003")),
    ["type-mismatch/003 the spread has type unknown, but an array is expected"],
  );
  assertEquals(body("n: Int", "[...n, 1]", "Ints"), [
    "type-mismatch/003 the spread has type Int, but an array is expected",
  ]);
});

Deno.test("a spread where a tuple is expected is type-mismatch/012", () => {
  assertEquals(body("xs: Ints", "[...xs]", "Pair"), [
    "type-mismatch/012 a spread gives an array, but the tuple [Int, Int] is expected",
  ]);
});

Deno.test("a spread of another element type is type-mismatch/012", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}const f = (x: Int, ts: Texts) => [x, ...ts]\n`),
    [
      "type-mismatch/012 spread element 2 has element type Text, which has no common array element type with Int",
    ],
  );
});

Deno.test("a spread in the list of schemaUnion is type-mismatch/003", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}const a: Schema<Text> = schema()\nconst u = schemaUnion([...[a], a])\n`,
    ),
    [
      "type-mismatch/003 `schemaUnion` takes a list literal of schemas without a spread",
    ],
  );
});

Deno.test("a literal with a spread has no proven length", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (ys: Ints): NonEmpty => [1, ...ys]\nconst v: NonEmpty = [1, ...[2]]\n`,
    ),
    [
      "type-mismatch/013 the function body does not prove the required refinement NonEmpty",
      "type-mismatch/013 the constant does not prove the required refinement NonEmpty",
    ],
  );
  assertEquals(body("", "[1, 2]", "NonEmpty"), []);
});

Deno.test("a literal with a spread does not prove a refined argument or field", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}type Box = { items: NonEmpty }
const take = (xs: NonEmpty): Int => 1
export const viaArg = (ys: Ints): Int => take([1, ...ys])
export const viaField = (ys: Ints): Box => ({ items: [1, ...ys] })
`,
    ),
    [
      "type-mismatch/013 argument 1 does not prove the required refinement NonEmpty",
      "type-mismatch/013 the field `items` does not prove the required refinement NonEmpty",
    ],
  );
});
