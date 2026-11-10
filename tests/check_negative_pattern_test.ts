// A `match` pattern can be a negative numeric literal. The pattern matches as
// the positive literal does, with the negative value.

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
type Sym = int where n => n >= -5 && n <= 5
type Shape = { n: 1, v: Int } | { n: 2, v: Int }
`;

function matching(subject: string, arms: string): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (s: ${subject}): Text =>\n  match s {\n${arms}\n  }\n`,
  );
}

Deno.test("a negative numeric literal is an accepted pattern", () => {
  assertEquals(
    matching("Int", '    -1 => "a",\n    0 => "b",\n    _ => "c"'),
    [],
  );
  assertEquals(matching("Num", '    -1.5 => "a",\n    _ => "c"'), []);
  assertEquals(
    matching("Int", '    -1 => "a",\n    1 => "b",\n    _ => "c"'),
    [],
  );
});

Deno.test("a negative literal that does not fit the subject type is foreign", () => {
  assertEquals(matching("Text", '    -1 => "a",\n    _ => "c"'), [
    "pattern/003 -1 does not belong to the subject (a string)",
  ]);
});

Deno.test("a repeated negative literal is an unreachable arm", () => {
  assertEquals(
    matching("Int", '    -1 => "a",\n    -1 => "b",\n    _ => "c"'),
    [
      "pattern/002 this arm is unreachable, because an earlier arm matches the same value",
    ],
  );
});

Deno.test("the arms 0 and -0 match the same value", () => {
  assertEquals(
    matching("Int", '    0 => "a",\n    -0 => "b",\n    _ => "c"'),
    [
      "pattern/002 this arm is unreachable, because an earlier arm matches the same value",
    ],
  );
  assertEquals(
    matching("Int", '    -0 => "a",\n    0 => "b",\n    _ => "c"'),
    [
      "pattern/002 this arm is unreachable, because an earlier arm matches the same value",
    ],
  );
});

Deno.test("a negative literal arm on a refined subject checks", () => {
  const source = `${TYPES}export const f = (s: Sym): Text =>
  match s {
    -5 => "low",
    5 => "high",
    _ => "mid"
  }
`;
  assertValidProject(checkModule(source));
});

Deno.test("a negative literal pattern lowers to a literal pattern with the negative value", () => {
  const module = loweredModule(
    `${TYPES}export const f = (n: Int): Text =>
  match n {
    -1 => "a",
    -0 => "b",
    _ => "c"
  }
`,
  );
  const [match] = allExprs(module, "match");
  const patterns = match.arms.map((arm) => arm.pattern);
  assertEquals(patterns.length, 3);
  assert(patterns[0].kind === "literal");
  assertEquals(patterns[0].value, -1);
  assert(patterns[1].kind === "literal");
  assert(Object.is(patterns[1].value, 0));
});

Deno.test("a record pattern with a negative literal field gets the diagnostic of the positive literal", () => {
  const positive = matching(
    "Shape",
    '    { n: 1, ...r } => "a",\n    _ => "c"',
  );
  assertEquals(positive, [
    "pattern/004 the discriminator of a tagged record pattern must be a string literal",
  ]);
  assertEquals(
    matching("Shape", '    { n: -1, ...r } => "a",\n    _ => "c"'),
    [
      "pattern/004 the discriminator of a tagged record pattern must be a string literal",
    ],
  );
});

Deno.test("a negative literal arm gives the refinement fact s === -5", () => {
  const arm = (body: string): string[] =>
    diagnosticsOf(
      `${TYPES}export const f = (s: Sym): Sym =>\n  match s {\n    -5 => ${body},\n    _ => s\n  }\n`,
    );
  assertEquals(arm("s + 10"), []);
  assertEquals(arm("s - 1"), [
    "type-mismatch/013 the arithmetic result does not satisfy the required refinement Sym",
  ]);
});
