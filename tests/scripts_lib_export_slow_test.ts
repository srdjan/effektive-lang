import { assertEquals } from "@std/assert";
import { exportRevision } from "../scripts/lib.ts";
import { withTemporaryDirectory } from "./process_helpers.ts";

// These tests run `git archive` in the repository root, so they need the
// `.git` directory. A mutation copy made by `git archive` has none.

Deno.test("exportRevision extracts a committed tree into each destination", async () => {
  await withTemporaryDirectory("lib-test-", async (dir) => {
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
  });
});

Deno.test("exportRevision words the failure of an unknown revision", async () => {
  await withTemporaryDirectory("lib-test-", async (dir) => {
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
  });
});
