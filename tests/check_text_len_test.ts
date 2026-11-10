// The pure builtins `text` and `len`. `text` takes an `int`, a `number`, or a
// `boolean` and gives a `string`. `len` takes a `string` or an array and gives
// an `int`. A pipeline left side is the first argument, a unit type
// (`Duration`, `Instant`) is not a `text` argument, and a module constant can
// shadow each name. The refinement predicate `len` stays syntactic.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertValidProject, checkModule, diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Text = string
type Flag = boolean
type Nums = number[]
type Ints = int[]
type Texts = string[]
type Cents = int
type Label = string
type Rec = { a: int }
type Pos = int where n => n > 0
type NonEmpty = string where s => len(s) > 0
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("text takes an int, a number, or a boolean and gives a string", () => {
  assertEquals(body("n: Int", "text(n)", "Text"), []);
  assertEquals(body("x: Num", "text(x)", "Text"), []);
  assertEquals(body("f: Flag", "text(f)", "Text"), []);
  assertEquals(body("", "text(42)", "Text"), []);
  assertEquals(body("", "text(1.5)", "Text"), []);
  assertEquals(body("", "text(true)", "Text"), []);
  assertEquals(body("", "text(7)", "Int"), [
    "type-mismatch/003 the function body has type string, but Int is expected",
  ]);
});

Deno.test("text of an identity over an int, a number, or a boolean checks", () => {
  assertEquals(
    diagnosticsOf(`type Meters = number
type Cents = int
type Flag = boolean
type Text = string
export const f = (m: Meters, c: Cents, g: Flag): Text => text(m) + text(c) + text(g)
`),
    [],
  );
});

Deno.test("text of a string, a record, or an array is a type mismatch", () => {
  assertEquals(body("s: Text", "text(s)", "Text"), [
    "type-mismatch/003 the argument has type Text, but number or boolean is expected",
  ]);
  assertEquals(body("", 'text("a")', "Text"), [
    "type-mismatch/003 the argument has type string, but number or boolean is expected",
  ]);
  assertEquals(body("r: Rec", "text(r)", "Text"), [
    "type-mismatch/003 the argument has type Rec, but number or boolean is expected",
  ]);
  assertEquals(body("xs: Ints", "text(xs)", "Text"), [
    "type-mismatch/003 the argument has type Ints, but number or boolean is expected",
  ]);
});

Deno.test("text of a Duration or an Instant is a type mismatch", () => {
  assertEquals(body("d: Duration", "text(d)", "Text"), [
    "type-mismatch/003 the argument has type Duration, but number or boolean is expected",
  ]);
  assertEquals(body("", "text(5s)", "Text"), [
    "type-mismatch/003 the argument has type Duration, but number or boolean is expected",
  ]);
  assertEquals(body("i: Instant", "text(i)", "Text"), [
    "type-mismatch/003 the argument has type Instant, but number or boolean is expected",
  ]);
  assertEquals(body("d: Duration", "text(Int(d))", "Text"), []);
});

Deno.test("len of a Duration or an Instant is a type mismatch", () => {
  assertEquals(body("d: Duration", "len(d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but string or an array is expected",
  ]);
  assertEquals(body("i: Instant", "len(i)", "Int"), [
    "type-mismatch/003 the argument has type Instant, but string or an array is expected",
  ]);
});

Deno.test("len takes a string or an array and gives an int", () => {
  assertEquals(body("s: Text", "len(s)", "Int"), []);
  assertEquals(body("", 'len("abc")', "Int"), []);
  assertEquals(body("xs: Ints", "len(xs)", "Int"), []);
  assertEquals(body("xs: Texts", "len(xs)", "Int"), []);
  assertEquals(body("", "len([1, 2, 3])", "Int"), []);
  assertEquals(body("s: Label", "len(s)", "Int"), []);
  assertEquals(body("s: NonEmpty", "len(s)", "Int"), []);
  assertEquals(body("s: Text", "len(s)", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
});

Deno.test("len of a number, a boolean, or a record is a type mismatch", () => {
  assertEquals(body("", "len(5)", "Int"), [
    "type-mismatch/003 the argument has type int, but string or an array is expected",
  ]);
  assertEquals(body("x: Num", "len(x)", "Int"), [
    "type-mismatch/003 the argument has type Num, but string or an array is expected",
  ]);
  assertEquals(body("f: Flag", "len(f)", "Int"), [
    "type-mismatch/003 the argument has type Flag, but string or an array is expected",
  ]);
  assertEquals(body("r: Rec", "len(r)", "Int"), [
    "type-mismatch/003 the argument has type Rec, but string or an array is expected",
  ]);
});

Deno.test("a call with the wrong argument count is an arity error", () => {
  assertEquals(body("n: Int", "text(n, n)", "Text"), [
    "type-mismatch/004 `text` takes 1 argument, but 2 are given",
  ]);
  assertEquals(body("s: Text", "len(s, s)", "Int"), [
    "type-mismatch/004 `len` takes 1 argument, but 2 are given",
  ]);
});

Deno.test("a foreign sealed argument is a type mismatch", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff":
        "export sealed type Level = int\nexport sealed type Name = string\n",
      "main.eff": `import { Level, Name } from "./lib.eff"
type Int = int
type Text = string
export const a = (l: Level): Text => text(l)
export const b = (n: Name): Int => len(n)
`,
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(
    checked.value.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "type-mismatch/003 the argument has type Level, but number or boolean is expected",
      "type-mismatch/003 the argument has type Name, but string or an array is expected",
    ],
  );
});

Deno.test("a string result fits an owned identity, and not a refined one", () => {
  assertEquals(body("n: Int", "text(n)", "Label"), []);
  assertEquals(body("n: Int", "text(n)", "NonEmpty"), [
    "type-mismatch/013 the function body does not prove the required refinement NonEmpty",
  ]);
  assertEquals(
    diagnosticsOf(`${TYPES}export const a: Label = text(1)
export const b: NonEmpty = text(1)
`),
    [
      "type-mismatch/013 the constant does not prove the required refinement NonEmpty",
    ],
  );
});

Deno.test("an int result of len fits an owned identity, and not a refined one", () => {
  assertEquals(body("s: Text", "len(s)", "Cents"), []);
  assertEquals(body("s: Text", "len(s)", "Pos"), [
    "type-mismatch/013 the function body does not prove the required refinement Pos",
  ]);
});

Deno.test("a bare text or len is not a value", () => {
  assertEquals(
    body("xs: Ints", "map(xs, text)", "Texts"),
    ["unknown-name/004 the builtin `text` can only be called or used as a pipeline stage"],
  );
  assertEquals(
    body("xs: Texts", "map(xs, len)", "Ints"),
    ["unknown-name/004 the builtin `len` can only be called or used as a pipeline stage"],
  );
  assertEquals(
    body("xs: Ints", "map(xs, (x) => text(x))", "Texts"),
    [],
  );
});

Deno.test("text and len take a pipeline left side as the first argument", () => {
  assertEquals(body("n: Int", "n |> text", "Text"), []);
  assertEquals(body("n: Int", "n * 2 |> text", "Text"), []);
  assertEquals(body("f: Flag", "f |> text", "Text"), []);
  assertEquals(body("xs: Ints", "xs |> len", "Int"), []);
  assertEquals(body("s: Text", "s |> len", "Int"), []);
  assertEquals(body("n: Int", "n |> text |> len", "Int"), []);
  assertEquals(body("s: Text", "s |> text", "Text"), [
    "type-mismatch/003 the argument has type Text, but number or boolean is expected",
  ]);
  assertEquals(body("n: Int", "n |> len", "Int"), [
    "type-mismatch/003 the argument has type Int, but string or an array is expected",
  ]);
});

Deno.test("a string concatenation with text checks, and without it does not", () => {
  assertEquals(body("n: Int", '"n=" + text(n)', "Text"), []);
  assertEquals(body("n: Int", '"n=" + n', "Text"), [
    "type-mismatch/007 the operator `+` does not accept operands of type string and Int",
  ]);
});

Deno.test("a module constant named text or len shadows the builtin", () => {
  const checked = checkModule(`${TYPES}const text = "t"
const len = 3
export const f = (): Text => text
export const g = (): Int => len
export const h = (xs: Ints): Int => len + 1
`);
  assertValidProject(checked);
});

Deno.test("a module constant named len shadows only the value builtin", () => {
  assertEquals(
    diagnosticsOf(`type NonEmpty = string where s => len(s) > 0
type Int = int
const len = 3
export const f = (s: NonEmpty): Int => len
`),
    [],
  );
});

Deno.test("a parameter named text or len shadows the builtin", () => {
  assertEquals(body("text: Text", "text", "Text"), []);
  assertEquals(body("len: Int", "len + 1", "Int"), []);
});

Deno.test("a refined type with the predicate len checks next to the value len", () => {
  const checked = checkModule(`type Name = string where s => len(s) > 0
type Int = int
export const size = (n: Name): Int => len(n)
`);
  assertValidProject(checked);
});
