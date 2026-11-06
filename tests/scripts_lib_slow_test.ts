import { assertEquals } from "@std/assert";
import { runChecked, runProcess, withTempDir } from "../scripts/lib.ts";

Deno.test("withTempDir removes the directory after the body and after a throw", async () => {
  let seen = "";
  const value = await withTempDir("lib-test-", (dir) => {
    seen = dir;
    Deno.writeTextFileSync(`${dir}/a.txt`, "x");
    return Promise.resolve(7);
  });
  assertEquals(value, 7);
  assertEquals(await Deno.stat(seen).then(() => true, () => false), false);
  let thrown = "";
  try {
    await withTempDir("lib-test-", (dir) => {
      seen = dir;
      throw new Error("boom");
    });
  } catch (cause) {
    thrown = (cause as Error).message;
  }
  assertEquals(thrown, "boom");
  assertEquals(await Deno.stat(seen).then(() => true, () => false), false);
});

Deno.test("runProcess returns the streams and the exit code", async () => {
  const result = await runProcess("deno", [
    "eval",
    "console.log('out'); console.error('err'); Deno.exit(3)",
  ]);
  assertEquals(
    [
      result.success,
      result.code,
      result.stdout,
      result.stderr,
      result.timedOut,
    ],
    [false, 3, "out\n", "err\n", false],
  );
});

Deno.test("runProcess kills a process after the timeout", async () => {
  const result = await runProcess("deno", [
    "eval",
    "setInterval(() => {}, 1000)",
  ], { timeoutMs: 1500, killSignal: "SIGKILL" });
  assertEquals([result.success, result.timedOut], [false, true]);
});

Deno.test("runChecked words a failure in the stderr style", async () => {
  const result = await runChecked("deno", [
    "eval",
    "console.error('bad'); Deno.exit(1)",
  ], "stderr");
  assertEquals(result, { ok: false, error: "deno eval failed: bad" });
});
