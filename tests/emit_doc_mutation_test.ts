// Tests that kill older mutation survivors of the layout engine.

import { assertEquals } from "@std/assert";
import {
  alt,
  type Doc,
  fill,
  group,
  ifBroke,
  ifFits,
  render,
  through,
} from "../src/core/emit/doc.ts";

Deno.test("an ifFits probe measures the first part of a fill at the current indentation", () => {
  const doc = ifFits(fill([[through, "1234567"]], 1), "yes", "no");
  assertEquals(render(doc, 8).text, "yes");
});

Deno.test("ifBroke counts a forced group that an enclosing flat group lays out", () => {
  const id = {};
  const doc: Doc = group(
    [alt([group("a", true, id)]), ifBroke(id, "!", "?")],
    undefined,
    undefined,
  );
  assertEquals(render(doc, 80).text, "a!");
});

Deno.test("ifBroke does not count an unforced group that an enclosing flat group lays out", () => {
  const id = {};
  const doc: Doc = group(
    ["(", group("b", false, id), ")", ifBroke(id, "!", "?")],
    undefined,
    undefined,
  );
  assertEquals(render(doc, 80).text, "(b)?");
});
