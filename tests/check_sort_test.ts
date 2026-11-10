// The pure builtin `sort`. `sort(xs)` orders an array of an orderable type, and
// `sort(xs, key)` orders by a pure key function that gives an orderable type.
// A boolean, a nullable union, and a tuple are not orderable. A key that has
// effects is `execution-mode/001`.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Ints = Int[]
type Text = string
type Texts = Text[]
type Cents = int
type Prices = Cents[]
type Name = string
type Names = Name[]
type Flag = boolean
type Maybe = Int | null
type Tag = "a" | "b"
type Tags = Tag[]
type Pair = [int, int]
type Row = { k: Int, flag: Flag, tag: Text }
type Rows = Row[]
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("sort takes an array of an orderable type, with an optional key", () => {
  assertEquals(body("xs: Ints", "sort(xs)", "Ints"), []);
  assertEquals(body("xs: Texts", "sort(xs)", "Texts"), []);
  assertEquals(body("xs: Tags", "sort(xs)", "Tags"), []);
  assertEquals(body("xs: Names", "sort(xs)", "Names"), []);
  assertEquals(body("cs: Prices", "sort(cs)", "Prices"), []);
  assertEquals(body("ds: Duration[]", "sort(ds)", "Duration[]"), []);
  assertEquals(body("rows: Rows", "sort(rows, (r) => r.k)", "Rows"), []);
  assertEquals(body("rows: Rows", "sort(rows, (r) => r.tag)", "Rows"), []);
  assertEquals(body("xs: Ints", "xs |> sort", "Ints"), []);
  assertEquals(body("rows: Rows", "rows |> sort((r) => r.k)", "Rows"), []);
});

Deno.test("sort of an array of an identity fits the matching array", () => {
  assertEquals(body("ints: Ints", "sort(ints)", "Prices"), [
    "type-mismatch/003 the function body has type Int[], but Prices is expected",
  ]);
});

Deno.test("sort of a boolean element is a type mismatch", () => {
  assertEquals(body("xs: Flag[]", "sort(xs)", "Flag[]"), [
    "type-mismatch/003 the argument has type Flag[], but an array of an orderable type is expected",
  ]);
});

Deno.test("sort of a nullable element is a type mismatch", () => {
  assertEquals(body("xs: Maybe[]", "sort(xs)", "Maybe[]"), [
    "type-mismatch/003 the argument has type Maybe[], but an array of an orderable type is expected",
  ]);
});

Deno.test("sort with a boolean key is a type mismatch", () => {
  assertEquals(body("rows: Rows", "sort(rows, (r) => r.flag)", "Rows"), [
    "type-mismatch/003 the key has type Flag, but an orderable type is expected",
  ]);
});

Deno.test("sort of a tuple is a type mismatch", () => {
  assertEquals(body("p: Pair", "sort(p)", "Pair"), [
    "type-mismatch/003 the argument has type Pair, but an array is expected",
  ]);
});

Deno.test("sort with an effectful key is an execution mode error", () => {
  assertEquals(
    body("rows: Rows", "sort(rows, (r) => run(defer(() => r.k)))", "Rows"),
    [
      "execution-mode/001 the callback of `sort` must be pure with empty failure and requirement sets",
    ],
  );
});

Deno.test("a module constant named sort shadows the builtin", () => {
  assertEquals(
    diagnosticsOf(
      "type Int = int\nconst sort = (a: Int, b: Int): Int => a + b\nexport const f = (): Int => sort(1, 2)\n",
    ),
    [],
  );
});

Deno.test("sort of a union of two identities or of a record is a type mismatch", () => {
  assertEquals(
    diagnosticsOf(
      `type Cents = int\ntype Count = int\ntype Mixed = Cents | Count\nexport const f = (xs: Mixed[]): Mixed[] => sort(xs)\n`,
    ),
    [
      "type-mismatch/003 the argument has type Mixed[], but an array of an orderable type is expected",
    ],
  );
  assertEquals(body("xs: Row[]", "sort(xs)", "Row[]"), [
    "type-mismatch/003 the argument has type Row[], but an array of an orderable type is expected",
  ]);
  assertEquals(
    diagnosticsOf(
      `type Small = 1 | 2 | 3\nexport const f = (xs: Small[]): Small[] => sort(xs)\n`,
    ),
    [],
  );
});
