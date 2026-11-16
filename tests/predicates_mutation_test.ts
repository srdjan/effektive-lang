// Tests for the term keys of predicates.

import { assertEquals } from "@std/assert";
import { termKey } from "../src/core/predicates.ts";

Deno.test("a field term and a length term of one path have different keys", () => {
  assertEquals(termKey({ kind: "field", path: ["a"] }), 'f["a"]');
  assertEquals(
    termKey({ kind: "length", path: ["a"], unit: "utf16" }),
    'l["a"]',
  );
});
