// Guard for the published copy of the typed IR. `src/core/ir.ts` is the
// authored contract. `scripts/site_ir.ts` generates the sibling file
// `../effektive/public/typed-ir.ts` from it. The first test compares the
// generated text with the website file byte for byte, so any drift fails. The
// second test checks the website file alone, with no other file of this
// repository. The third test compares the published log fixture with
// `fixtures/ir/example/log.ir.json`, because no generator writes that copy. A
// `git archive` export has no sibling, so all three tests are ignored.

import { assert, assertEquals } from "@std/assert";
import { generateSiteIr } from "../scripts/site_ir.ts";
import { deno, withTemporaryDirectory } from "./process_helpers.ts";

const CORE_IR = new URL("../src/core/ir.ts", import.meta.url);
const CORE_PREDICATES = new URL("../src/core/predicates.ts", import.meta.url);
const SITE_IR = new URL("../../effektive/public/typed-ir.ts", import.meta.url);
const LOG_FIXTURE = new URL(
  "../fixtures/ir/example/log.ir.json",
  import.meta.url,
);
const SITE_LOG = new URL("../../effektive/public/log.ir.json", import.meta.url);

function siteIrExists(): boolean {
  try {
    return Deno.statSync(SITE_IR).isFile;
  } catch {
    return false;
  }
}

const SITE_ABSENT = !siteIrExists();

Deno.test({
  name: "the published typed IR equals the text that site:ir generates",
  ignore: SITE_ABSENT,
  fn: () => {
    const generated = generateSiteIr(
      Deno.readTextFileSync(CORE_IR),
      Deno.readTextFileSync(CORE_PREDICATES),
    );
    assert(generated.ok, "the generator failed");
    assertEquals(Deno.readTextFileSync(SITE_IR), generated.text);
  },
});

Deno.test({
  name: "the published typed IR passes deno check alone",
  ignore: SITE_ABSENT,
  fn: async () => {
    await withTemporaryDirectory("eff-ir-site-", async (dir) => {
      Deno.copyFileSync(SITE_IR, `${dir}/typed-ir.ts`);
      const run = await deno(dir, ["check", "--no-lock", "typed-ir.ts"]);
      assertEquals(run.code, 0, run.stderr);
    });
  },
});

Deno.test({
  name: "the published log fixture equals the compiler fixture",
  ignore: SITE_ABSENT,
  fn: () => {
    assertEquals(
      Deno.readTextFileSync(SITE_LOG),
      Deno.readTextFileSync(LOG_FIXTURE),
    );
  },
});
