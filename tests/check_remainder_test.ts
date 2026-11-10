// The binary operator `%`. The checker types it as it types `*`, and a unit
// type (`Duration`, `Instant`) has no remainder.

import { assert, assertEquals } from "@std/assert";
import {
  allExprs,
  assertValidProject,
  checkModule,
  diagnosticsOf,
  loweredModule,
} from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Text = string
type Cents = int
type Count = int
type Pos = int where n => n > 0
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("% of two int values is an int", () => {
  assertEquals(body("a: Int, b: Int", "a % b", "Int"), []);
  assertEquals(body("a: Int, b: Int", "a % b", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
  assertEquals(body("", "7 % 3", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
});

Deno.test("% of an identity and itself is a plain int", () => {
  assertEquals(body("a: Cents, b: Cents", "a % b", "Text"), [
    "type-mismatch/003 the function body has type int, but Text is expected",
  ]);
  assertEquals(body("a: Cents, b: Cents", "a % b", "Cents"), []);
});

Deno.test("% of an identity and an unnamed value keeps the identity", () => {
  assertEquals(body("c: Cents", "c % 7", "Text"), [
    "type-mismatch/003 the function body has type Cents, but Text is expected",
  ]);
  assertEquals(body("c: Cents", "7 % c", "Text"), [
    "type-mismatch/003 the function body has type Cents, but Text is expected",
  ]);
  assertEquals(body("c: Cents", "c % 7", "Cents"), []);
});

Deno.test("% of two different identities is a mismatch", () => {
  assertEquals(body("a: Cents, b: Count", "a % b", "Int"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Cents and Count",
  ]);
});

Deno.test("% of a refined identity needs a proof, and Int(p) is the workaround", () => {
  assertEquals(body("p: Pos", "p % 2", "Pos"), [
    "type-mismatch/013 the arithmetic result does not prove the required refinement Pos",
  ]);
  assertEquals(body("p: Pos", "p % 2", "Int"), [
    "type-mismatch/003 the function body has type Pos, but Int is expected",
    "type-mismatch/013 the arithmetic result does not prove the required refinement Pos",
  ]);
  assertEquals(body("p: Pos", "Int(p) % 2", "Int"), []);
});

Deno.test("% with a number operand is a number", () => {
  assertEquals(body("", "7.5 % 2", "Text"), [
    "type-mismatch/003 the function body has type number, but Text is expected",
  ]);
  assertEquals(body("", "7 % 2.5", "Text"), [
    "type-mismatch/003 the function body has type number, but Text is expected",
  ]);
  assertEquals(body("n: Num", "n % 2", "Num"), []);
  assertEquals(body("n: Num", "n % 2", "Text"), [
    "type-mismatch/003 the function body has type Num, but Text is expected",
  ]);
});

Deno.test("% of a text or a boolean is a mismatch", () => {
  assertEquals(body("a: Text, b: Text", "a % b", "Text"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Text and Text",
  ]);
  assertEquals(body("a: Int", "a % true", "Int"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Int and boolean",
  ]);
});

Deno.test("a Duration has no remainder, and an Instant has none either", () => {
  assertEquals(body("", "5s % 2", "Duration"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Duration and int",
  ]);
  assertEquals(body("", "5s % 3s", "Duration"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Duration and Duration",
  ]);
  assertEquals(body("", "2 % 5s", "Duration"), [
    "type-mismatch/007 the operator `%` does not accept operands of type int and Duration",
  ]);
  assertEquals(body("", "5s % 1.5", "Duration"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Duration and number",
  ]);
  assertEquals(body("i: Instant", "i % 2", "Instant"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Instant and int",
  ]);
  assertEquals(body("i: Instant, d: Duration", "i % d", "Instant"), [
    "type-mismatch/007 the operator `%` does not accept operands of type Instant and Duration",
  ]);
});

Deno.test("an int remainder fits an identity that the module owns", () => {
  const source = `${TYPES}export const f = (a: Int, b: Int): Cents => {
  const c: Cents = a % b
  c
}
`;
  assertEquals(diagnosticsOf(source), []);
  assertValidProject(checkModule(source));
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (a: Int, b: Int): Pos => {
  const p: Pos = a % b
  p
}
`,
    ),
    [
      "type-mismatch/013 the value does not prove the required refinement Pos",
    ],
  );
});

Deno.test("% gives the IR binary operator %", () => {
  const module = loweredModule(
    `${TYPES}export const f = (a: Int, b: Int): Int => a % b\n`,
  );
  const [remainder] = allExprs(module, "binary");
  assert(remainder !== undefined);
  assertEquals(remainder.operator, "%");
  assertValidProject(
    checkModule(`${TYPES}export const f = (a: Int, b: Int): Int => a % b\n`),
  );
});

Deno.test("an operand that fails to check hides the % mismatch", () => {
  assertEquals(body("a: Int", "a % missing", "Int"), [
    "unknown-name/001 unknown name `missing`",
  ]);
});
