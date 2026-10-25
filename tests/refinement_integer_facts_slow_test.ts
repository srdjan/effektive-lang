import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

Deno.test("a Float guard returns a valid Positive value at runtime", async () => {
  const output = await compileStrictTarget(
    {
      "m.eff": `
export type Float = number
export type Positive = int where n => n > 0
export const safe = (x: Float): Positive =>
  if (x > 0 && x < 1) { 1 } else { 1 }
`,
    },
    ["m.eff"],
    `import { safe } from "./m.ts";
console.log(JSON.stringify([safe(0.5), safe(2)]));`,
    "effektive-refinement-integer-facts-",
  );
  assertEquals(JSON.parse(output), [1, 1]);
});
