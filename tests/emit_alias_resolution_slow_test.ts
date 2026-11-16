import { assert, assertEquals } from "@std/assert";
import { checkProject, emitProject, memoryHost } from "../src/core/mod.ts";
import { runStrictTarget } from "./target_helpers.ts";
import { assertValidProject } from "./helpers.ts";

Deno.test("pure functions lift through alias chains up to the accepted depth", async () => {
  const depths = [63, 64, 70, 125];
  const source = [
    "type Int = int",
    "type A0 = (n: Int) => Int",
    ...Array.from({ length: 125 }, (_, i) => `type A${i + 1} = A${i}`),
    "const plain = (n: Int): Int => n",
    ...depths.map((depth) => `export const lifted${depth}: A${depth} = plain`),
  ].join("\n");
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": source }),
    "",
    ["main.eff"],
  );
  assert(checked.ok);
  const lowered = assertValidProject(checked.value);
  const output = await runStrictTarget(
    emitProject(lowered, { config: checked.value.analysis.project.config }),
    `import { Effect } from "effect";
import { ${
      depths.map((depth) => `lifted${depth}`).join(", ")
    } } from "./main.ts";
const values = await Promise.all([${
      depths.map((depth) => `Effect.runPromise(lifted${depth}(${depth}))`).join(
        ", ",
      )
    }]);
console.log(JSON.stringify(values));`,
    "effektive-alias-resolution-",
  );
  assertEquals(JSON.parse(output), depths);
});
