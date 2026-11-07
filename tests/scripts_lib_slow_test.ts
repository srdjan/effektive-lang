import { assertEquals } from "@std/assert";
import { exportRevision, runChecked, runProcess } from "../scripts/lib.ts";

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

Deno.test("exportRevision extracts a committed tree into each destination", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "lib-test-" });
  try {
    const result = await exportRevision("HEAD:fixtures/mutation", {
      archive: `${dir}/tree.tar`,
      destinations: [`${dir}/a`, `${dir}/b/c`],
      failure: "stderr",
    });
    assertEquals(result, { ok: true, value: undefined });
    assertEquals(
      [
        Deno.statSync(`${dir}/a/survivors.json`).isFile,
        Deno.statSync(`${dir}/b/c/survivors.json`).isFile,
      ],
      [true, true],
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("exportRevision words the failure of an unknown revision", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "lib-test-" });
  try {
    const result = await exportRevision("no-such-revision", {
      archive: `${dir}/tree.tar`,
      destinations: [`${dir}/a`],
      failure: "stderr",
    });
    assertEquals(result, {
      ok: false,
      error:
        "git archive failed: fatal: not a valid object name: no-such-revision",
    });
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
