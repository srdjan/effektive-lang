// The unary operators `-e` and `!e`. The checker types `-e` as `0 - e` and `!e`
// as `e === false`, and lowering gives the same IR as those two sources.

import { assert, assertEquals } from "@std/assert";
import {
  allExprs,
  assertValidProject,
  checkModule,
  diagnosticsOf,
  emitFiles,
  loweredModule,
} from "./helpers.ts";

const TYPES = `type Int = int
type Num = number
type Text = string
type Flag = boolean
type Cents = int
type Pos = int where n => n > 0
type Sym = int where n => n >= -5 && n <= 5
type Temp = int where n => n >= -90
`;

function body(params: string, expression: string, result: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (${params}): ${result} => ${expression}\n`,
  );
}

function emitted(source: string): string {
  const module = emitFiles({ "effektive.json": "{}", "m.eff": source }, [
    "m.eff",
  ]).get("m");
  assert(module !== undefined, "module m was not emitted");
  return module.text;
}

Deno.test("-e has the type of 0 - e", () => {
  const table: [string, string, string, string[]][] = [
    ["x: Int", "-x", "Int", []],
    ["x: Int", "-x", "Text", [
      "type-mismatch/003 the function body has type Int, but Text is expected",
    ]],
    ["x: Cents", "-x", "Cents", []],
    ["x: Cents", "-x", "Int", [
      "type-mismatch/003 the function body has type Cents, but Int is expected",
    ]],
    ["x: Num", "-x", "Num", []],
    ["x: Num", "-x", "Text", [
      "type-mismatch/003 the function body has type Num, but Text is expected",
    ]],
    ["", "-5", "Text", [
      "type-mismatch/003 the function body has type int, but Text is expected",
    ]],
    ["", "-1.5", "Text", [
      "type-mismatch/003 the function body has type number, but Text is expected",
    ]],
    ["", "- -5", "Text", [
      "type-mismatch/003 the function body has type int, but Text is expected",
    ]],
  ];
  for (const [params, expression, result, expected] of table) {
    assertEquals(body(params, expression, result), expected, expression);
  }
});

Deno.test("a wrong operand of -e names the unary operator", () => {
  assertEquals(body("x: Text", "-x", "Int"), [
    "type-mismatch/007 the operator `-` does not accept an operand of type Text",
  ]);
  assertEquals(body("x: Flag", "-x", "Int"), [
    "type-mismatch/007 the operator `-` does not accept an operand of type Flag",
  ]);
});

Deno.test("-d on a Duration gives the mismatch of 0 - d, and 0ms - d is the workaround", () => {
  assertEquals(body("d: Duration", "-d", "Duration"), [
    "type-mismatch/007 the operator `-` does not accept an operand of type Duration",
  ]);
  assertEquals(body("d: Duration", "0ms - d", "Duration"), []);
});

Deno.test("-p on a refined operand needs a proof, and -Int(p) is the workaround", () => {
  assertEquals(body("p: Pos", "-p", "Pos"), [
    "type-mismatch/013 the arithmetic result does not satisfy the required refinement Pos",
  ]);
  assertEquals(body("p: Pos", "-p", "Int"), [
    "type-mismatch/003 the function body has type Pos, but Int is expected",
    "type-mismatch/013 the arithmetic result does not satisfy the required refinement Pos",
  ]);
  assertEquals(body("p: Pos", "-Int(p)", "Int"), []);
});

Deno.test("!e needs a boolean and gives a boolean", () => {
  const table: [string, string, string, string[]][] = [
    ["b: Flag", "!b", "Flag", []],
    ["b: Flag", "!b", "Text", [
      "type-mismatch/003 the function body has type boolean, but Text is expected",
    ]],
    ["", "!true", "Flag", []],
    ["", "!!true", "Flag", []],
    ["x: Int", "!x", "Flag", [
      "type-mismatch/007 the operator `!` does not accept an operand of type Int",
    ]],
    ["x: Text", "!x", "Flag", [
      "type-mismatch/007 the operator `!` does not accept an operand of type Text",
    ]],
  ];
  for (const [params, expression, result, expected] of table) {
    assertEquals(body(params, expression, result), expected, expression);
  }
});

Deno.test("an operand that fails to check hides the operator mismatch", () => {
  assertEquals(body("", "-missing", "Int"), [
    "unknown-name/001 unknown name `missing`",
  ]);
  assertEquals(body("", "!missing", "Flag"), [
    "unknown-name/001 unknown name `missing`",
  ]);
});

Deno.test("-e gives the IR of 0 - e, and !e gives the IR of e === false", () => {
  const negate = loweredModule(
    `${TYPES}export const f = (x: Int): Int => -x\n`,
  );
  const [minus] = allExprs(negate, "binary");
  assertEquals(minus.operator, "-");
  assert(minus.left.kind === "literal");
  assertEquals(minus.left.value, 0);
  assertEquals(minus.right.kind, "reference");
  const not = loweredModule(`${TYPES}export const f = (b: Flag): Flag => !b\n`);
  const [equals] = allExprs(not, "binary");
  assertEquals(equals.operator, "===");
  assertEquals(equals.left.kind, "reference");
  assert(equals.right.kind === "literal");
  assertEquals(equals.right.value, false);
});

Deno.test("the emitted text of -e equals that of 0 - e, and of !e equals that of e === false", () => {
  const unary = emitted(
    `${TYPES}export const f = (x: Int, b: Flag): Int => if (!b) { -x } else { x }\n`,
  );
  const binary = emitted(
    `${TYPES}export const f = (x: Int, b: Flag): Int => if (b === false) { 0 - x } else { x }\n`,
  );
  assertEquals(unary, binary);
});

Deno.test("a unary operand keeps its failures and requirements", () => {
  const source = `${TYPES}error Stop = {}
service Counter { next(): Int fails Stop }
export const f = (): Int fails Stop with Counter.next => -Counter.next()
`;
  assertEquals(diagnosticsOf(source), []);
  assertValidProject(checkModule(source));
});

Deno.test("a block may start with -e, and ( -e ) continues a later block item", () => {
  assertEquals(body("x: Int", "{ -x }", "Int"), []);
  assertEquals(body("x: Int", "{\n  -x\n}", "Int"), []);
  assertEquals(body("x: Int", "{\n  const y = x\n  (-y)\n}", "Int"), []);
});

Deno.test("-e and !e in refinement proofs", () => {
  const sym = `${TYPES}export const f = (s: Sym): Sym => -s\n`;
  assertEquals(diagnosticsOf(sym), []);
  assertValidProject(checkModule(sym));
  emitted(sym);
  const temp = `${TYPES}export const t: Temp = -5\n`;
  assertEquals(diagnosticsOf(temp), []);
  assertValidProject(checkModule(temp));
  emitted(temp);
  assertEquals(body("t: Temp", "-t", "Temp"), [
    "type-mismatch/013 the arithmetic result does not prove the required refinement Temp",
  ]);
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (n: Int): Pos => if (-n < 0) { Pos(n) } else { Pos(1) }\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (n: Int): Pos => if (n > 0) { Pos(n) } else { Pos(1) }\n`,
    ),
    [],
  );
  assertEquals(
    diagnosticsOf(
      `${TYPES}export const f = (n: Int): Pos => if (!(n <= 0)) { Pos(n) } else { Pos(1) }\n`,
    ),
    [
      "type-mismatch/013 the value of Pos does not prove the required refinement Pos",
    ],
  );
});
