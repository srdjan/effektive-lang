import { assertEquals } from "@std/assert";
import { runChecked, runProcess, withTempDir } from "../scripts/lib.ts";

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

Deno.test("runProcess runs in the directory and with the environment of the caller", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "lib-test-" });
  try {
    const result = await runProcess("deno", [
      "eval",
      "console.log(Deno.cwd() + ' ' + Deno.env.get('LIB_TEST_VALUE'))",
    ], { cwd: dir, env: { LIB_TEST_VALUE: "seen" } });
    assertEquals(result.stdout, `${Deno.realPathSync(dir)} seen\n`);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("runProcess leaves the text of a stream empty when the stream is not piped", async () => {
  const result = await runProcess("deno", [
    "eval",
    "console.log('out'); console.error('err')",
  ], { stdout: "null", stderr: "null" });
  assertEquals([result.stdout, result.stderr], ["", ""]);
});

Deno.test("runProcess finishes a process that ends before its timeout", async () => {
  const result = await runProcess("deno", ["eval", "console.log('fast')"], {
    timeoutMs: 60000,
  });
  assertEquals(
    [result.success, result.stdout, result.timedOut],
    [true, "fast\n", false],
  );
});

Deno.test("runChecked returns stdout when the command exits 0", async () => {
  const result = await runChecked("deno", [
    "eval",
    "console.log('value')",
  ], "stderr");
  assertEquals(result, { ok: true, value: "value\n" });
});

Deno.test("runChecked words a failure in the tail style with all arguments", async () => {
  const result = await runChecked("deno", [
    "eval",
    "console.log('line'); console.error('bad'); Deno.exit(1)",
  ], "tail");
  assertEquals(result, {
    ok: false,
    error:
      "deno eval console.log('line'); console.error('bad'); Deno.exit(1) failed:\nbad\nline\n",
  });
});

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

Deno.test("withTempDir throws a failed removal by default", async () => {
  let thrown = "";
  try {
    await withTempDir("lib-test-", (dir) => {
      Deno.removeSync(dir);
      return Promise.resolve();
    });
  } catch (cause) {
    thrown = (cause as Error).name;
  }
  assertEquals(thrown, "NotFound");
});

Deno.test("withTempDir ignores a failed removal when it tolerates the failure", async () => {
  const value = await withTempDir("lib-test-", (dir) => {
    Deno.removeSync(dir);
    return Promise.resolve("done");
  }, { tolerateRemoveFailure: true });
  assertEquals(value, "done");
});
