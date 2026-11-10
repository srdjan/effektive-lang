// The pure builtins `div`, `trunc`, `floor`, `round`, and `ceil`. A pipeline
// left side is the first argument, a unit type (`Duration`, `Instant`) is
// refused, and a module constant can shadow the name.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertValidProject, checkModule, diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Text = string
type Flag = boolean
type Nums = number[]
type Ints = int[]
type Cents = int
type Pos = int where n => n > 0
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("div takes two int values and gives an int", () => {
  assertEquals(body("a: Int, b: Int", "div(a, b)", "Int"), []);
  assertEquals(body("", "div(7, 2)", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
  assertEquals(body("a: Num, b: Int", "div(a, b)", "Int"), [
    "type-mismatch/003 the argument has type Num, but int is expected",
  ]);
  assertEquals(body("a: Int", "div(a, 2.5)", "Int"), [
    "type-mismatch/003 the argument has type number, but int is expected",
  ]);
  assertEquals(body("a: Int", 'div(a, "2")', "Int"), [
    "type-mismatch/003 the argument has type string, but int is expected",
  ]);
});

Deno.test("each rounding builtin takes a number and gives an int", () => {
  assertEquals(body("x: Num", "trunc(x)", "Int"), []);
  assertEquals(body("x: Num", "floor(x)", "Int"), []);
  assertEquals(body("x: Num", "round(x)", "Int"), []);
  assertEquals(body("x: Num", "ceil(x)", "Int"), []);
  assertEquals(body("x: Num", "round(x)", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
  assertEquals(body("x: Text", "round(x)", "Int"), [
    "type-mismatch/003 the argument has type Text, but number is expected",
  ]);
  assertEquals(body("x: Flag", "ceil(x)", "Int"), [
    "type-mismatch/003 the argument has type Flag, but number is expected",
  ]);
});

Deno.test("an int argument widens to the number parameter of a rounding builtin", () => {
  assertEquals(body("n: Int", "round(n)", "Int"), []);
  assertEquals(body("", "floor(7)", "Int"), []);
  assertEquals(body("c: Cents", "trunc(c)", "Int"), []);
});

Deno.test("a call with the wrong argument count is an arity error", () => {
  assertEquals(body("a: Int", "div(a)", "Int"), [
    "type-mismatch/004 `div` takes 2 arguments, but 1 is given",
  ]);
  assertEquals(body("x: Num", "round(x, x)", "Int"), [
    "type-mismatch/004 `round` takes 1 argument, but 2 are given",
  ]);
});

Deno.test("a Duration or an Instant argument is a type mismatch in each builtin", () => {
  assertEquals(body("d: Duration", "round(d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but number is expected",
  ]);
  assertEquals(body("d: Duration", "trunc(d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but number is expected",
  ]);
  assertEquals(body("d: Duration", "floor(d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but number is expected",
  ]);
  assertEquals(body("d: Duration", "ceil(d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but number is expected",
  ]);
  assertEquals(body("d: Duration", "div(d, 2)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but int is expected",
  ]);
  assertEquals(body("d: Duration", "div(7, d)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but int is expected",
  ]);
  assertEquals(body("", "round(5s)", "Int"), [
    "type-mismatch/003 the argument has type Duration, but number is expected",
  ]);
  assertEquals(body("i: Instant", "round(i)", "Int"), [
    "type-mismatch/003 the argument has type Instant, but number is expected",
  ]);
  assertEquals(body("i: Instant", "div(i, 2)", "Int"), [
    "type-mismatch/003 the argument has type Instant, but int is expected",
  ]);
  assertEquals(body("d: Duration", "Int(d) |> round", "Int"), []);
});

Deno.test("a foreign sealed argument is a type mismatch", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff": "export sealed type Level = int\n",
      "main.eff": `import { Level } from "./lib.eff"
type Int = int
export const a = (l: Level): Int => round(l)
export const b = (l: Level): Int => div(l, 2)
`,
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  assertEquals(
    checked.value.diagnostics.map((d) => `${d.code} ${d.message}`),
    [
      "type-mismatch/003 the argument has type Level, but number is expected",
      "type-mismatch/003 the argument has type Level, but int is expected",
    ],
  );
});

Deno.test("a plain int result fits an owned identity, and not a refined one", () => {
  assertEquals(body("x: Num", "round(x)", "Cents"), []);
  assertEquals(body("a: Int, b: Int", "div(a, b)", "Cents"), []);
  assertEquals(body("x: Num", "round(x)", "Pos"), [
    "type-mismatch/013 the function body does not prove the required refinement Pos",
  ]);
  assertEquals(body("a: Int, b: Int", "div(a, b)", "Pos"), [
    "type-mismatch/013 the function body does not prove the required refinement Pos",
  ]);
});

Deno.test("a constant of a refined type does not take a plain int result", () => {
  assertEquals(
    diagnosticsOf(`${TYPES}const x = 2.5
export const c: Cents = round(x)
export const p: Pos = round(x)
`),
    [
      "type-mismatch/013 the constant does not prove the required refinement Pos",
    ],
  );
});

Deno.test("an identity over int or number is an argument", () => {
  assertEquals(
    diagnosticsOf(`type Meters = number
type Cents = int
export const f = (m: Meters, c: Cents): Cents => round(m) + div(c, c)
`),
    [],
  );
});

Deno.test("a bare builtin name is not a value", () => {
  assertEquals(
    body("xs: Nums", "map(xs, round)", "Ints"),
    ["unknown-name/004 the builtin `round` can only be called or used as a pipeline stage"],
  );
});

Deno.test("a builtin takes a pipeline left side as its first argument", () => {
  assertEquals(body("x: Num", "x |> round", "Int"), []);
  assertEquals(body("x: Num", "x * 1.5 |> floor", "Int"), []);
  assertEquals(body("s: Int", "s * 90 |> div(100)", "Int"), []);
  assertEquals(body("x: Num", "x |> round |> div(3)", "Int"), []);
  assertEquals(body("x: Num", "x |> div(3)", "Int"), [
    "type-mismatch/003 the argument has type Num, but int is expected",
  ]);
  assertEquals(body("xs: Nums", "map(xs, (x) => round(x))", "Ints"), []);
});

Deno.test("a module constant named like a builtin shadows it", () => {
  const checked = checkModule(`${TYPES}const round = 3
const floor = "f"
export const f = (x: Num): Int => round
export const g = (): Text => floor
export const h = (x: Num): Int => trunc(x)
`);
  assertValidProject(checked);
});

Deno.test("a parameter named like a builtin shadows it", () => {
  assertEquals(body("round: Int", "round + 1", "Int"), []);
  assertEquals(body("div: Int", "div + 1", "Int"), []);
});
