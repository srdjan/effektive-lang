// Guard for the published copy of the typed IR. `src/core/ir.ts` is the
// authored contract. `scripts/site_ir.ts` generates the sibling file
// `../effektive/public/typed-ir.ts` from it. The first test compares the
// generated text with the website file byte for byte, so any drift fails. The
// second test checks the website file alone, with no other file of this
// repository. The third test compares the published log fixture with
// `fixtures/ir/example/log.ir.json`, because no generator writes that copy. A
// `git archive` export has no sibling, so all three tests are ignored.

import { assert, assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { generateSiteIr } from "../scripts/site_ir.ts";
import { deno } from "./process_helpers.ts";
import { withTempDir } from "../scripts/lib.ts";

const CORE_IR = new URL("../src/core/ir.ts", import.meta.url);
const CORE_PREDICATES = new URL("../src/core/predicates.ts", import.meta.url);
const LOG_FIXTURE = new URL(
  "../fixtures/ir/example/log.ir.json",
  import.meta.url,
);

function siteFile(name: string): URL {
  const override = Deno.env.get("EFFEKTIVE_SITE_ROOT");
  return override === undefined
    ? new URL(`../../effektive/public/${name}`, import.meta.url)
    : toFileUrl(join(override, "public", name));
}

const SITE_IR = siteFile("typed-ir.ts");
const SITE_LOG = siteFile("log.ir.json");

function siteIrExists(): boolean {
  try {
    return Deno.statSync(SITE_IR).isFile;
  } catch {
    return false;
  }
}

// An explicit companion root must fail when its files are absent.
const SITE_ABSENT = Deno.env.get("EFFEKTIVE_SITE_ROOT") === undefined &&
  !siteIrExists();

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
    await withTempDir("eff-ir-site-", async (dir) => {
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
