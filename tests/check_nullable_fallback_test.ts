// `x ?? d` accepts an Option or a nullable union. It lowers on a nullable union to
// the same match as `match x { null => d, v => v }`.

import { assertEquals } from "@std/assert";
import { allExprs, diagnosticsOf, loweredModule } from "./helpers.ts";

const TYPES = `type Int = int
type Cents = int
type Mode = "a" | "b" | null
type MaybeInt = Int | null
type MaybeCents = Cents | null
type Flag = boolean
type MaybeBool = boolean | null
`;

const MESSAGE =
  "type-mismatch/010 the left operand of `??` must be an Option or a nullable union";

function fallback(subject: string, body: string, result = "Int"): string[] {
  return diagnosticsOf(
    `${TYPES}export const f = (s: ${subject}): ${result} => ${body}\n`,
  );
}

Deno.test("a fallback on a nullable union checks", () => {
  assertEquals(fallback("MaybeInt", "s ?? 0"), []);
  assertEquals(fallback("MaybeCents", "s ?? 0", "Cents"), []);
  assertEquals(fallback("Option<Int>", "s ?? 0"), []);
});

Deno.test("a fallback on a non-nullable left operand names both accepted kinds", () => {
  assertEquals(fallback("Int", "s ?? 0"), [MESSAGE]);
  assertEquals(fallback("Mode", 's ?? "a"', "Mode"), [MESSAGE]);
  assertEquals(fallback("MaybeBool", "s ?? false", "Flag"), [MESSAGE]);
});

Deno.test("a fallback on a nullable union lowers to a null arm and a bind arm", () => {
  const ir = loweredModule(
    `${TYPES}export const f = (s: MaybeInt): Int => s ?? 0\n`,
  );
  const match = allExprs(ir, "match")[0];
  assertEquals(
    match.arms.map((arm) =>
      arm.pattern.kind === "literal"
        ? `literal ${arm.pattern.value}`
        : arm.pattern.kind
    ),
    ["literal null", "bind"],
  );
});
