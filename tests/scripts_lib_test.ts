import { assertEquals } from "@std/assert";
import { fastSuiteArgs, prettyJson } from "../scripts/lib.ts";

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
