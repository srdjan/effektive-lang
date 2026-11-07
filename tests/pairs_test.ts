import { assertEquals } from "@std/assert";
import { byTurn } from "../bench/pairs.ts";

Deno.test("byTurn keeps the order on an even turn and swaps it on an odd turn", () => {
  assertEquals(byTurn(0, "a", "b"), ["a", "b"]);
  assertEquals(byTurn(1, "a", "b"), ["b", "a"]);
  assertEquals(byTurn(2, "a", "b"), ["a", "b"]);
  assertEquals(byTurn(3, "a", "b"), ["b", "a"]);
});
