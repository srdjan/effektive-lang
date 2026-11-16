// Tests for `containsNamed` of src/core/recursion_guard.ts. Each case calls
// the exported function with a literal IR type. A branch that does not return
// the boolean falls to the exhaustive check and returns the type itself, so the
// tests compare with the exact booleans.

import { assertEquals } from "@std/assert";
import type { Type } from "../src/core/ir.ts";
import { containsNamed } from "../src/core/recursion_guard.ts";

const ID = "type:m#T";
const target: Type = { kind: "named", id: ID };
const INT: Type = { kind: "primitive", name: "int" };

Deno.test("containsNamed finds the id under an array", () => {
  assertEquals(containsNamed({ kind: "array", element: target }, ID), true);
});

Deno.test("containsNamed returns false for an array without the id", () => {
  assertEquals(containsNamed({ kind: "array", element: INT }, ID), false);
});

Deno.test("containsNamed finds the id under an option", () => {
  assertEquals(containsNamed({ kind: "option", element: target }, ID), true);
});

Deno.test("containsNamed returns false for an option without the id", () => {
  assertEquals(containsNamed({ kind: "option", element: INT }, ID), false);
});

Deno.test("containsNamed does not look through a tuple", () => {
  assertEquals(
    containsNamed({ kind: "tuple", elements: [target, INT] }, ID),
    false,
  );
});
