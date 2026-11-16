// Tests for the input inference of node kinds that no other form handles:
// a list literal and an option fallback, through the signature of a checked
// function.

import { assertEquals } from "@std/assert";
import type { ValueId } from "../src/core/ir.ts";
import { showType } from "../src/core/type_show.ts";
import { checkModule } from "./helpers.ts";

const SOURCE = `type Text = string
type Int = int
const consume = (value: Text): Text => value
const sum = (xs: Int[]): Int => 1
const listed = (a): Int => sum([a])
const fallback = (a, o: Option<Text>): Text => o ?? consume(a)
`;

function parameterTypes(name: string): string[] {
  const project = checkModule(SOURCE);
  assertEquals(project.diagnostics, []);
  const body = project.modules.get("m")?.functions.get(
    `value:m#${name}` as ValueId,
  );
  if (body === undefined) throw new Error(name);
  return body.signature.parameters.map((p) =>
    showType(project.table, p.type.ref)
  );
}

Deno.test("an input in a list literal takes the element type that the list expects", () => {
  assertEquals(parameterTypes("listed"), ["Int"]);
});

Deno.test("an input in the fallback of an option takes the type that its use demands", () => {
  assertEquals(parameterTypes("fallback"), ["Text", "Option<Text>"]);
});
