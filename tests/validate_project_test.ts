import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import { validateProject } from "../src/core/validate_project.ts";

Deno.test("validateProject reports a lowered module recorded under another name", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": "export type Count = int\n",
    }),
    "",
    ["m.eff"],
  );
  assert(checked.ok);
  const lowered = lowerProject(checked.value);
  const module = lowered.get("m");
  assert(module?.ok);
  const renamed = new Map([["other", module]]);
  const diagnostics = validateProject(checked.value.analysis.project, renamed)
    .get("other") ?? [];
  assertEquals(
    diagnostics.map((d) => `${d.code} ${d.message}`),
    ["validation/001 module: expected the lowered module other, recorded m"],
  );
});
