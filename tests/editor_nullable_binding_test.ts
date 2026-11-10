// Hover on the binding of a nullable match shows the subject type without `null`,
// as it does for the binding of `Some(x)`.

import { assert, assertEquals } from "@std/assert";
import { hoverAt, Program } from "../src/core/mod.ts";
import { TypeScriptOutputs } from "../src/core/typescript.ts";
import { offsetOf } from "./helpers.ts";

const outputs = new TypeScriptOutputs();

function hoverText(text: string, needle: string, delta: number): string {
  const result = new Program("").update({
    set: { "effektive.json": "{}", "m.eff": text },
  });
  assert(result.ok, JSON.stringify(result));
  const hover = hoverAt(
    result.value,
    "m.eff",
    offsetOf(text, needle, delta),
    outputs,
  );
  assert(hover !== undefined, "no hover");
  return hover.contract;
}

const SOME = `type Int = int
export const f = (o: Option<Int>): Int =>
  match o {
    None => 0,
    Some(x) => x + 1
  }
`;

const NULLABLE = `type Int = int
type Cents = int
type MaybeCents = Cents | null
export const f = (o: MaybeCents): Int =>
  match o {
    null => 0,
    n => n + 1
  }
`;

Deno.test("hover on the use of a Some binding shows its type", () => {
  assertEquals(hoverText(SOME, "x + 1", 0), "Int");
});

Deno.test("hover on the use of a nullable binding shows the type without null", () => {
  assertEquals(hoverText(NULLABLE, "n + 1", 0), "Cents");
});
