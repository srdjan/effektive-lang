// Tests of the two measure scripts through their command lines. Each script
// runs at import, so the test starts one `deno` process for each.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ROOT, runProcess, withTempDir } from "../scripts/lib.ts";

const SAMPLE = `import { x } from "./x.ts";

// a comment

export function f(a: number): number {
  if (a > 0 && a < 5) return 1;
  for (const i of [x]) {
    if (i) a++;
  }
  return a ?? 0;
}

const g = (b?: { c: number }) => b?.c;
`;

async function measure(script: string): Promise<string> {
  return await withTempDir("measure-test-", async (dir) => {
    const file = join(dir, "sample.ts");
    await Deno.writeTextFile(file, SAMPLE);
    const run = await runProcess("deno", [
      "run",
      "--allow-read",
      "--allow-env",
      join(ROOT, "scripts", script),
      file,
    ]);
    assertEquals(run.code, 0, run.stderr);
    return run.stdout.replaceAll(dir, "DIR");
  });
}

Deno.test("measure.ts prints the counts of each file as JSON", async () => {
  const stdout = await measure("measure.ts");
  assertEquals(
    JSON.parse(stdout),
    [{
      file: "DIR/sample.ts",
      loc: 9,
      branches: 7,
      maxCyclo: 6,
      fnCount: 2,
      importsOut: 1,
      exportedFns: 1,
      anyDefault: 0,
      topFns: [
        { name: "f", line: 5, loc: 7, branches: 6, cyclomatic: 6 },
        { name: "g", line: 13, loc: 1, branches: 1, cyclomatic: 2 },
      ],
    }],
  );
});

Deno.test("measure_functions.ts prints one tab-separated row for each function", async () => {
  const stdout = await measure("measure_functions.ts");
  assertEquals(
    stdout,
    "DIR/sample.ts\tf\t5\t7\t6\t6\t0\nDIR/sample.ts\tg\t13\t1\t1\t2\t0\n",
  );
});
