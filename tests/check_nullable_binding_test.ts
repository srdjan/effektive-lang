// A `match` on a nullable union takes a `null` arm and then a binding arm. The
// binding has the subject type without `null`. These tests check the accepted
// forms and each rejection by exact code and message.

import { assertEquals } from "@std/assert";
import { assertValidProject, checkModule, diagnosticsOf } from "./helpers.ts";

const TYPES = `type Int = int
type Cents = int
type Text = string
type Nil = null
type Item = { r: Int }
type Circle = { radius: Int }
type Square = { side: Int }
type Shape = Circle | Square
type Mode = "a" | "b" | null
type MaybeInt = Int | null
type MaybeCents = Cents | null
type MaybeShape = Shape | null
type ModeOrInt = Mode | Int
type Opt = Option<Int>
`;

function matching(subject: string, arms: string, result = "Int"): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (s: ${subject}): ${result} =>\n  match s {\n${arms}\n  }\n`,
  );
}

Deno.test("a binding arm after the null arm checks and takes the type without null", () => {
  assertEquals(matching("MaybeInt", "    null => 0,\n    n => n + 1"), []);
  assertEquals(
    matching("MaybeCents", "    null => 0,\n    n => n", "Cents"),
    [],
  );
  assertEquals(matching("Int | Nil", "    null => 0,\n    n => n"), []);
  assertEquals(matching("MaybeInt", "    null => 0,\n    _ => 1"), []);
});

Deno.test("a null subject with a literal union keeps the literal arms", () => {
  assertEquals(
    matching("Mode", '    null => 0,\n    "a" => 1,\n    "b" => 2'),
    [],
  );
});

Deno.test("a binding arm on a nullable tagged union nests a match", () => {
  assertEquals(
    matching(
      "MaybeShape",
      "    null => 0,\n    n =>\n      match n {\n        Circle(c) => c.radius,\n        Square(q) => q.side\n      }",
    ),
    [],
  );
});

Deno.test("a match without a binding or wildcard arm is not exhaustive", () => {
  assertEquals(matching("MaybeInt", "    null => 0"), [
    "pattern/001 the match is not exhaustive; it needs _",
  ]);
  assertEquals(matching("MaybeInt", "    1 => 0, _ => 1").length, 1);
});

Deno.test("a binding arm before the null arm is rejected once", () => {
  assertEquals(matching("MaybeInt", "    n => 1,\n    null => 0"), [
    "pattern/004 a binding arm must come after the `null` arm",
  ]);
});

Deno.test("an arm after a binding arm is unreachable", () => {
  assertEquals(
    matching("MaybeInt", "    null => 0,\n    n => 1,\n    _ => 2"),
    [
      "pattern/002 this arm is unreachable, because an earlier binding arm matches every value except null",
    ],
  );
});

Deno.test("a name that is not a constructor on an option subject is a rejected binding", () => {
  assertEquals(
    matching("Opt", "    Nnoe => 0,\n    Some(v) => v"),
    [
      "pattern/001 the match is not exhaustive; it needs None",
      "pattern/004 `Nnoe` is not a constructor; a binding arm applies only after the `null` arm of a nullable union",
    ],
  );
});

Deno.test("a module constant as an arm on a non-nullable subject is a rejected binding", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}const f1 = 1\nexport const f = (s: Int): Int =>\n  match s {\n    f1 => 0,\n    _ => 1\n  }\n`,
    ),
    [
      "pattern/004 `f1` is not a constructor; a binding arm applies only after the `null` arm of a nullable union",
    ],
  );
});

Deno.test("an error name keeps the constructor message", () => {
  assertEquals(
    matching("MaybeInt", "    null => 0,\n    TimeoutError => 1"),
    [
      "pattern/001 the match is not exhaustive; it needs _",
      "pattern/004 a constructor pattern needs a binding, as in `Some(x)` or `E(x)`",
    ],
  );
});

Deno.test("a constructor arm on a nullable union is foreign", () => {
  assertEquals(
    matching("MaybeShape", "    null => 0,\n    Circle(c) => 0"),
    [
      "pattern/001 the match is not exhaustive; it needs _",
      "pattern/003 `Circle` does not belong to the subject (the nullable union MaybeShape)",
    ],
  );
});

Deno.test("a nullable union hidden inside another identity keeps the subject message", () => {
  assertEquals(
    matching("ModeOrInt", "    null => 0,\n    n => 1"),
    [
      "pattern/004 a match cannot take a value of type ModeOrInt; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, primitives, and nullable unions",
    ],
  );
});

Deno.test("a nullable match lowers to a bind pattern that the validator accepts", () => {
  assertValidProject(
    checkModule(
      `${TYPES}export const f = (s: MaybeInt): Int =>\n  match s {\n    null => 0,\n    n => n + 1\n  }\n`,
    ),
  );
});

Deno.test("a binding arm shadows a module constant", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}const n = 5\nexport const f = (s: MaybeInt): Int =>\n  match s {\n    null => n,\n    n => n + 1\n  }\n`,
    ),
    [],
  );
});

Deno.test("Some as an arm is a constructor pattern and not a binding", () => {
  assertEquals(
    matching("MaybeInt", "    null => 0,\n    Some => 1"),
    [
      "pattern/001 the match is not exhaustive; it needs _",
      "pattern/004 a constructor pattern needs a binding, as in `Some(x)` or `E(x)`",
    ],
  );
});

Deno.test("a type name as a bare arm keeps the constructor message", () => {
  assertEquals(matching("Shape", "    Circle => 0,\n    _ => 1"), [
    "pattern/004 a constructor pattern needs a binding, as in `Some(x)` or `E(x)`",
  ]);
});

Deno.test("a union of a primitive and a non-null literal is not nullable", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}type IntOrA = Int | "a"\nexport const f = (s: IntOrA): Int =>\n  match s {\n    _ => 1\n  }\n`,
    ),
    [
      "pattern/004 a match cannot take a value of type IntOrA; version 0 matches options, errors, tagged records, records with a literal discriminator field, literals, primitives, and nullable unions",
    ],
  );
});

Deno.test("a binding arm is a refinement path for a constructor proof", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}type Pos = int where n => n > 0\nexport const f = (s: MaybeInt): Pos =>\n  match s {\n    null => Pos(1),\n    n => if (n > 0) { Pos(n) } else { Pos(1) }\n  }\n`,
    ),
    [],
  );
});

Deno.test("a declared error name as a bare arm keeps the constructor message", () => {
  assertEquals(
    diagnosticsOf(
      `${TYPES}error Stop = {}\nexport const f = (s: MaybeInt): Int =>\n  match s {\n    null => 0,\n    Stop => 1\n  }\n`,
    ),
    [
      "pattern/001 the match is not exhaustive; it needs _",
      "pattern/004 a constructor pattern needs a binding, as in `Some(x)` or `E(x)`",
    ],
  );
});
