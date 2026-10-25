import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";

function check(text: string) {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  return checked.value;
}

Deno.test("literal lengths establish string and array refinements", () => {
  const checked = check(`
type Nonempty = string where s => len(s) > 0
type Pair = int[] where a => len(a) === 2
const name: Nonempty = "😀"
const pair: Pair = [1, 2]
const local = (): Nonempty => { const text = "😀"; Nonempty(text) }
`);
  assertEquals(checked.diagnostics, []);
  for (
    const diagnostics of validateProject(
      checked.analysis.project,
      lowerProject(checked),
    ).values()
  ) assertEquals(diagnostics, []);
});

Deno.test("contextual array and tuple literals cannot bypass predicates", () => {
  const checked = check(`
type Pair = int[] where a => len(a) === 2
type Empty = [int] where t => false
const badArray: Pair = [1]
const badTuple: Empty = [1]
`);
  assertEquals(checked.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/013",
    "type-mismatch/013",
  ]);
});
