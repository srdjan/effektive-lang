import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";

Deno.test("inference keeps a shared field requirement on an explicit union", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": `
type Int = int
type Flag = boolean
type Left = { value: Int, left: Flag }
type Right = { value: Int, right: Flag }
type Input = Left | Right
const requireInput = (value: Input): Int => value.value
const read = (input): Int => { const ignored = requireInput(input); input.value }
`,
    }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  for (
    const diagnostics of validateProject(
      checked.value.analysis.project,
      lowerProject(checked.value),
    ).values()
  ) assertEquals(diagnostics, []);
});

Deno.test("successful branch joins and later match arms retain established facts", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": `
type Int = int
type Positive = int where n => n > 0
type Flag = boolean
error Invalid = {}
const guarded = (n: Int): Positive fails Invalid => {
  if (n > 0) {} else { fail(Invalid({})) }
  Positive(n)
}
const common = (n: Int, flag: Flag): Positive fails Invalid => {
  if (flag) { if (n > 0) {} else { fail(Invalid({})) } }
  else { if (n > 0) {} else { fail(Invalid({})) } }
  Positive(n)
}
const matched = (n: Positive): Positive => match (n) { 1 => 1, _ => n - 1 }
`,
    }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  for (
    const diagnostics of validateProject(
      checked.value.analysis.project,
      lowerProject(checked.value),
    ).values()
  ) assertEquals(diagnostics, []);
});
