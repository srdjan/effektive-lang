import { assertEquals } from "@std/assert";
import { fastSuiteArgs, prettyJson, withTempDir } from "../scripts/lib.ts";

const config: { tasks: Record<string, string> } = JSON.parse(
  Deno.readTextFileSync(new URL("../deno.json", import.meta.url)),
);

Deno.test("the test task of deno.json runs the shared fast suite arguments", () => {
  assertEquals(
    config.tasks.test.replaceAll("'", ""),
    "deno test --allow-read --parallel --ignore=**/*_slow_test.ts tests/",
  );
  assertEquals(
    fastSuiteArgs(),
    ["--allow-read", "--parallel", "--ignore=**/*_slow_test.ts", "tests/"],
  );
});

Deno.test("fastSuiteArgs puts the flags of a caller before the selection", () => {
  assertEquals(fastSuiteArgs(["--fail-fast"]), [
    "--allow-read",
    "--parallel",
    "--fail-fast",
    "--ignore=**/*_slow_test.ts",
    "tests/",
  ]);
});

Deno.test("prettyJson writes a two-space indent and a final newline", () => {
  assertEquals(prettyJson({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
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
