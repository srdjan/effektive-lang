// Tests for the exact error text of each rename refusal that other rename tests assert only by `ok`.

import { assert, assertEquals } from "@std/assert";
import { Program, renameAt } from "../src/core/frontend.ts";

const text = "type Int = int\nconst a = (x: Int): Int => x\n";

function renameResult(source: string, needle: string, name: string): unknown {
  const loaded = Program("").update({
    set: { "effektive.json": "{}", "m.eff": source },
  });
  assert(loaded.ok);
  return renameAt(loaded.value, "m.eff", source.indexOf(needle), name);
}

function refusal(error: string) {
  return { ok: false, error: error };
}

Deno.test("a new name that is not an identifier is refused with its message", () => {
  const message = "The new name must be a valid identifier.";
  assertEquals(renameResult(text, "x:", "bad-name"), refusal(message));
  assertEquals(renameResult(text, "x:", "const"), refusal(message));
  assertEquals(renameResult(text, "x:", ""), refusal(message));
  assertEquals(renameResult(text, "x:", "two words"), refusal(message));
});

Deno.test("a builtin type name is refused as reserved", () => {
  assertEquals(
    renameResult(text, "x:", "int"),
    refusal("The new name is reserved."),
  );
});

Deno.test("a position that is not a symbol cannot be renamed", () => {
  const message = "This symbol cannot be renamed in Effektive source.";
  assertEquals(renameResult(text, "=>", "y"), refusal(message));
  assertEquals(renameResult(text, "const", "y"), refusal(message));
});

Deno.test("a rename to the current name changes nothing", () => {
  assertEquals(renameResult(text, "x:", "x"), { ok: true, value: [] });
});

Deno.test("a rename that another binding would capture is refused with its message", () => {
  const message = "The rename would capture or conflict with another binding.";
  const nested =
    "type Int = int\nconst a = (x: Int): Int => { const f = (y: Int): Int => y + x; f(1) }\n";
  assertEquals(renameResult(nested, "x:", "y"), refusal(message));
  const global =
    "type Int = int\nconst g = (): Int => 1\nconst a = (x: Int): Int => x + g()\n";
  assertEquals(renameResult(global, "x:", "g"), refusal(message));
});
