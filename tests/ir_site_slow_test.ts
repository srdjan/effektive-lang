// Guard for the published copy of the typed IR. `src/core/ir.ts` is the
// authored contract. The sibling file `../effektive/public/typed-ir.ts` is a
// standalone copy. The guard proves that a `ModuleIR` from one file is
// assignable to the `ModuleIR` of the other file, in both directions. It cannot
// see an extra optional property on one side, so it does not prove equal members.

import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { deno, withTemporaryDirectory } from "./process_helpers.ts";

const CORE_IR = new URL("../src/core/ir.ts", import.meta.url);
const SITE_IR = new URL("../../effektive/public/typed-ir.ts", import.meta.url);

function siteIrExists(): boolean {
  try {
    return Deno.statSync(SITE_IR).isFile;
  } catch {
    return false;
  }
}

const SITE_ABSENT = !siteIrExists();

function assignmentCheck(siteHref: string): string {
  return [
    `import type { ModuleIR as CoreModuleIR } from "${CORE_IR.href}";`,
    `import type { ModuleIR as SiteModuleIR } from "${siteHref}";`,
    "type Assert<T extends true> = T;",
    "export type CoreFitsSite = Assert<[CoreModuleIR] extends [SiteModuleIR] ? true : false>;",
    "export type SiteFitsCore = Assert<[SiteModuleIR] extends [CoreModuleIR] ? true : false>;",
    "",
  ].join("\n");
}

Deno.test({
  name: "the published typed IR and the core IR accept each other's ModuleIR",
  ignore: SITE_ABSENT,
  fn: async () => {
    await withTemporaryDirectory("eff-ir-site-", async (dir) => {
      Deno.writeTextFileSync(`${dir}/check.ts`, assignmentCheck(SITE_IR.href));
      const run = await deno(dir, ["check", "--no-lock", "check.ts"]);
      assertEquals(run.code, 0, run.stderr);
    });
  },
});

Deno.test({
  name: "the guard fails when the published ModuleIR loses a property",
  ignore: SITE_ABSENT,
  fn: async () => {
    await withTemporaryDirectory("eff-ir-site-", async (dir) => {
      const original = Deno.readTextFileSync(SITE_IR);
      const start = original.indexOf("export interface ModuleIR {");
      const line = "  readonly module: string;\n";
      const at = original.indexOf(line, start);
      const changed = original.slice(0, at) + original.slice(at + line.length);
      assertNotEquals(changed, original);
      Deno.writeTextFileSync(`${dir}/typed-ir.ts`, changed);
      Deno.writeTextFileSync(
        `${dir}/check.ts`,
        assignmentCheck(`file://${dir}/typed-ir.ts`),
      );
      const run = await deno(dir, ["check", "--no-lock", "check.ts"]);
      assertEquals(run.code, 1, run.stderr);
      assertStringIncludes(run.stderr, "TS2344 [ERROR]");
      assertStringIncludes(run.stderr, "export type SiteFitsCore");
    });
  },
});
