// Tests for the union flattening of `TypeLowerer`, through the IR that
// `lowerProject` gives for type aliases.

import { assertEquals } from "@std/assert";
import { loweredModule } from "./helpers.ts";

const SOURCE = `type A = "a"
type B = "b"
type C = "c"
type D = "d"
type Nested = (A | B) | C
type Wrapped = (A) | D
type Right = A | (B | C)
type RightWrapped = A | (B)
`;

function aliasMembers(name: string): readonly unknown[] {
  const declaration = loweredModule(SOURCE).declarations.find((d) =>
    d.name === name
  );
  if (declaration?.kind !== "type") throw new Error(name);
  const definition = declaration.definition;
  if (definition.kind !== "alias" || definition.type.kind !== "union") {
    throw new Error(name);
  }
  return definition.type.members;
}

Deno.test("a union flattens its parenthesized unions into one list of members", () => {
  assertEquals(aliasMembers("Nested"), [
    { kind: "named", id: "type:m#A" },
    { kind: "named", id: "type:m#B" },
    { kind: "named", id: "type:m#C" },
  ]);
  assertEquals(aliasMembers("Right"), [
    { kind: "named", id: "type:m#A" },
    { kind: "named", id: "type:m#B" },
    { kind: "named", id: "type:m#C" },
  ]);
});

Deno.test("a union keeps the member of a parenthesized type that is no union", () => {
  assertEquals(aliasMembers("Wrapped"), [
    { kind: "named", id: "type:m#A" },
    { kind: "named", id: "type:m#D" },
  ]);
  assertEquals(aliasMembers("RightWrapped"), [
    { kind: "named", id: "type:m#A" },
    { kind: "named", id: "type:m#B" },
  ]);
});
