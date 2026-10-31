// Operator typing of binary expressions (src/core/check_binary.ts), reached
// through `.eff` source programs and their diagnostics.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Flag = boolean
type Mixed = "a" | 1
type Rec = { a: int }
`;

function body(
  params: string,
  expression: string,
  result: string,
): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

Deno.test("an identity over literals of two classes equals no literal", () => {
  // The members "a" and 1 are a string and a number, so the identity has no
  // comparison class and a literal cannot widen to it.
  assertEquals(body("x: Mixed", `x === "a"`, "Flag"), [
    `type-mismatch/007 the operator \`===\` does not accept operands of type Mixed and "a"`,
  ]);
  assertEquals(body("x: Mixed", `1 === x`, "Flag"), [
    `type-mismatch/007 the operator \`===\` does not accept operands of type int and Mixed`,
  ]);
});

Deno.test("a literal of one class equals a value of the same class only", () => {
  assertEquals(body("", `"x" === "y"`, "Flag"), []);
  assertEquals(body("", `"x" === 1`, "Flag"), [
    "type-mismatch/007 the operator `===` does not accept operands of type string and int",
  ]);
  assertEquals(body("", `1 === "x"`, "Flag"), [
    "type-mismatch/007 the operator `===` does not accept operands of type int and string",
  ]);
});

Deno.test("a record equals no scalar, in either operand order", () => {
  assertEquals(body("o: Rec, x: Int", "o === x", "Flag"), [
    "type-mismatch/007 the operator `===` does not accept operands of type Rec and Int",
  ]);
  assertEquals(body("o: Rec, x: Int", "x === o", "Flag"), [
    "type-mismatch/007 the operator `===` does not accept operands of type Int and Rec",
  ]);
});

Deno.test("a Duration times a Duration follows the general rules and is an int", () => {
  assertEquals(body("a: Duration, b: Duration", "a * b", "Int"), []);
  assertEquals(body("a: Duration, b: Duration", "a * b", "Duration"), [
    "type-mismatch/003 the function body has type int, but Duration is expected",
  ]);
  assertEquals(body("a: Duration, b: Duration", "a + b", "Duration"), []);
  assertEquals(body("a: Duration, b: Duration", "a - b", "Duration"), []);
});
