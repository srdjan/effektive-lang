// Tests that kill mutation survivors of src/core/syntax.ts.

import { assertEquals } from "@std/assert";
import { parse } from "../src/core/parse.ts";
import { printTree } from "../src/core/syntax.ts";

Deno.test("printTree prints the tokens and trivia of the tree, not the stored text", () => {
  const { tree } = parse("t.eff", "const a = 1\n", "eff");
  assertEquals(printTree(tree), "const a = 1\n");
  assertEquals(
    printTree({ ...tree, text: tree.text + "tail" }),
    "const a = 1\n",
  );
});
