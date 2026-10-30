import { assert, assertEquals } from "@std/assert";
import {
  failureText,
  HOOK_PATHS,
  instrumentSources,
} from "../scripts/behavior_capture.ts";

const ROOT = new URL("..", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const HOOKED_FILES = [
  "src/core/emit/emit.ts",
  "src/core/check_project.ts",
  "src/core/lower.ts",
  "src/core/db.ts",
  "src/core/validate/index.ts",
];

Deno.test("behavior capture finds every hook anchor in the current sources", () => {
  const result = instrumentSources(read, "/records");
  assert(result.ok, result.ok ? "" : result.error.join("\n"));
  for (const path of HOOK_PATHS) assert(result.value.has(path), path);
  for (const path of HOOKED_FILES) {
    const text = result.value.get(path);
    assert(text !== undefined && text.includes("capture("), path);
  }
});

Deno.test("behavior capture names each entry point whose anchor is gone", () => {
  const result = instrumentSources(
    (path) => path === "src/core/check_project.ts" ? "" : read(path),
    "/records",
  );
  assert(!result.ok);
  assertEquals(result.error.length, 1);
  assert(result.error[0].startsWith("src/core/check_project.ts: "));
});

Deno.test("behavior capture writes the records path into the hook as a literal", () => {
  const result = instrumentSources(read, '/tmp/a "b"/records');
  assert(result.ok);
  for (const path of HOOK_PATHS) {
    const text = result.value.get(path);
    assert(text !== undefined, path);
    assert(text.includes('"/tmp/a \\"b\\"/records"'), text);
    assert(!text.includes("Deno.env"), text);
  }
});

Deno.test("failure text puts stderr first and stdout last", () => {
  assertEquals(
    failureText(
      "Check a_test.ts\nFAILED | 1 passed | 1 failed\n",
      "error: Test failed\n",
    ),
    "error: Test failed\nCheck a_test.ts\nFAILED | 1 passed | 1 failed\n",
  );
});

Deno.test("failure text keeps the last 40 lines", () => {
  assertEquals(
    failureText(
      "l01\nl02\nl03\nl04\nl05\nl06\nl07\nl08\nl09\nl10\nl11\nl12\nl13\nl14\n" +
        "l15\nl16\nl17\nl18\nl19\nl20\nl21\nl22\nl23\nl24\nl25\nl26\nl27\nl28\n" +
        "l29\nl30\nl31\nl32\nl33\nl34\nl35\nl36\nl37\nl38\nl39\nl40\nl41\nl42",
      "",
    ),
    "l03\nl04\nl05\nl06\nl07\nl08\nl09\nl10\nl11\nl12\nl13\nl14\n" +
      "l15\nl16\nl17\nl18\nl19\nl20\nl21\nl22\nl23\nl24\nl25\nl26\nl27\nl28\n" +
      "l29\nl30\nl31\nl32\nl33\nl34\nl35\nl36\nl37\nl38\nl39\nl40\nl41\nl42",
  );
});
