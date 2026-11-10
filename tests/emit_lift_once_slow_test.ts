// Slow tests for the evaluation point of a computed pure callback in a slot of
// an effect function type. With the largest safe integer, the factory raises
// `int overflow`. The error must come from the expression that the source
// writes, not from a later call of the callback.

import { assertEquals } from "@std/assert";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "../src/cli/tsc.ts";
import { deno, runScript } from "./process_helpers.ts";

const CLI = new URL("../src/cli/main.ts", import.meta.url).pathname;

const PROGRAM = `type Int = int
const make = (x: Int): pure () => Int => {
  const y = x + 1
  () => y
}
const mk1 = (x: Int): pure (n: Int) => Int => {
  const y = x + 1
  (n: Int) => y + n
}
export const lifted = (x: Int): () => Int => make(x)
export const deferred = (x: Int): Effect<Int> => defer(make(x))
export const traversed = (x: Int, items: Int[]): Int[] => traverse(items, mk1(x))
export const viaMatch = (o: Option<Int>): () => Int => match o {
  Some(n) => {
    const y = n + 1
    () => y
  },
  None => make(0)
}
`;

const SCRIPT = `
import { Effect, Option } from "effect";
import { deferred, lifted, traversed, viaMatch } from "./m.ts";

const M = Number.MAX_SAFE_INTEGER;
const where = (label: string, fn: () => unknown): string => {
  try {
    fn();
    return label + ": returned";
  } catch (e: unknown) {
    return label + ": " + String(e);
  }
};
console.log(JSON.stringify({
  lifted: where("lifted", () => lifted(M)),
  deferred: where("deferred", () => deferred(M)),
  viaMatch: where("viaMatch", () => viaMatch(Option.some(M))),
  traversed: where("traversed", () => Effect.runSync(traversed(M, []))),
}));
`;

Deno.test("a computed pure callback runs at the expression that the source writes", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "effektive-lift-once-" });
  try {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/m.eff`, PROGRAM);
    const build = await deno(dir, [
      "run",
      "-q",
      "--no-lock",
      "--allow-read",
      "--allow-write",
      "--allow-run=deno",
      CLI,
      "build",
      dir,
      "--tsc",
    ]);
    assertEquals(
      build.code,
      0,
      `build failed:\n${build.stdout}\n${build.stderr}`,
    );
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify({
        compilerOptions: TARGET_COMPILER_OPTIONS,
        imports: TARGET_IMPORTS,
      }),
    );
    const result = await runScript(dir, SCRIPT);
    assertEquals(result, {
      lifted: "lifted: RangeError: int overflow",
      deferred: "deferred: RangeError: int overflow",
      viaMatch: "viaMatch: RangeError: int overflow",
      traversed: "traversed: RangeError: int overflow",
    });
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
