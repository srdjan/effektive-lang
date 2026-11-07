// Tests for the lexical fallback of semantic classification: each keyword
// token, including the `with` contract keyword, classifies as a keyword.

import { assertEquals } from "@std/assert";
import { semanticClassifications } from "../src/core/mod.ts";

Deno.test("lexical classification marks the first and last keyword tokens, with, finally, and contextual words", () => {
  const text = "import null with finally fails uses value";
  const classes = semanticClassifications(undefined, "m.eff", text).map((c) =>
    `${text.slice(c.span.start, c.span.end)}:${c.type}`
  );
  assertEquals(classes, [
    "import:keyword",
    "null:keyword",
    "with:keyword",
    "finally:keyword",
    "fails:keyword",
    "uses:variable",
    "value:variable",
  ]);
});

Deno.test("lexical classification marks the equals sign as an operator and an unused character as no operator", () => {
  const text = "const x: Int = 1 # y";
  const classes = semanticClassifications(undefined, "m.eff", text).map((c) =>
    `${text.slice(c.span.start, c.span.end)}:${c.type}`
  );
  assertEquals(classes, [
    "const:keyword",
    "x:variable",
    "Int:variable",
    "=:operator",
    "1:number",
    "y:variable",
  ]);
});
