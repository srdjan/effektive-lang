// Slow test of the command `deno task behavior:compare`. It exports HEAD
// with `git archive` and runs the corpus runner in the exported tree.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { deno } from "./process_helpers.ts";

const ROOT = new URL("..", import.meta.url).pathname;

Deno.test("the comparison of HEAD with HEAD on the edit sequences exits with 0", async () => {
  const out = Deno.makeTempDirSync({ prefix: "effektive-compare-slow-" });
  const scratch = Deno.makeTempDirSync({ prefix: "effektive-compare-tmp-" });
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run=git,tar,deno",
        "scripts/behavior_compare.ts",
        "HEAD",
        "HEAD",
        "--only",
        "edits/",
        "--out",
        out,
      ],
      cwd: ROOT,
      env: { NO_COLOR: "1", TMPDIR: scratch },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assertEquals(output.code, 0, decoder.decode(output.stderr));
    assertEquals(
      decoder.decode(output.stdout),
      [
        "check: 0 equal, 0 changed, 0 missing, 0 added",
        "program: 11 equal, 0 changed, 0 missing, 0 added",
        "program-error: 2 equal, 0 changed, 0 missing, 0 added",
        "lower: 0 equal, 0 changed, 0 missing, 0 added",
        "lower-error: 0 equal, 0 changed, 0 missing, 0 added",
        "emit: 0 equal, 0 changed, 0 missing, 0 added",
        "emit-error: 0 equal, 0 changed, 0 missing, 0 added",
        "validate: 0 equal, 0 changed, 0 missing, 0 added",
        `output: ${out}`,
        "",
      ].join("\n"),
    );
    assertEquals([...Deno.readDirSync(out)].length, 0);
    // The command removes the exported trees that it makes in TMPDIR.
    assertEquals([...Deno.readDirSync(scratch)].length, 0);
  } finally {
    Deno.removeSync(out, { recursive: true });
    Deno.removeSync(scratch, { recursive: true });
  }
});

Deno.test("a revision that does not exist gives exit status 2", async () => {
  const output = await deno(ROOT, [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run=git,tar,deno",
    "scripts/behavior_compare.ts",
    "no-such-revision-0000",
    "HEAD",
    "--only",
    "edits/",
  ]);
  assertEquals(output.code, 2);
  assertStringIncludes(
    output.stderr,
    "cannot export no-such-revision-0000",
  );
});
