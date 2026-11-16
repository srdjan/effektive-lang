import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
} from "../src/core/frontend.ts";
import { parseDenoCheck } from "../src/core/typescript.ts";
import { builtinInfo } from "../src/core/validate/builtins.ts";
import { validateProject } from "../src/core/validate_project.ts";

Deno.test("parseDenoCheck uses the marker after the TypeScript code", () => {
  assertEquals(
    parseDenoCheck(
      "TS9999 [WARN]: literal [ERROR]: text\n    at file:///project/x.ts:1:2\n",
      "/project",
    ),
    {
      diagnostics: [{
        file: "x.ts",
        line: 1,
        column: 2,
        code: 9999,
        message: "literal [ERROR]: text",
        detail: "",
      }],
      other: [],
    },
  );
});

Deno.test("validateProject ignores a malformed declaration owner", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff": "export type Present = int\n",
      "main.eff":
        'import { Present } from "./lib.eff"\nexport const zero = (): Present => Present(0)\n',
    }),
    "",
    ["main.eff"],
  );
  assert(checked.ok, JSON.stringify(checked));
  const lowered = lowerProject(checked.value);
  const mainResult = lowered.get("main");
  assert(mainResult?.ok, "missing main IR");
  const forged = structuredClone(mainResult.value);
  const payload = forged.imports.find((item) => item.module === "lib");
  assert(payload !== undefined, "missing lib payload");
  const present = payload.types[0];
  assert(present !== undefined, "missing imported type");
  const missing = structuredClone(present);
  Object.defineProperty(missing, "id", { value: "ty#pe:lib#Missing" });
  Object.defineProperty(missing, "name", { value: "Missing" });
  Object.defineProperty(payload, "types", {
    value: [...payload.types, missing],
  });
  const modules = new Map(lowered);
  modules.set("main", { ok: true, value: forged });

  assertEquals(
    (validateProject(checked.value.analysis.project, modules).get("main") ?? [])
      .map((item) => ({ code: item.code, message: item.message })),
    [],
  );
});

Deno.test("builtinInfo rejects a line terminator in the module", () => {
  assertEquals(builtinInfo("value:m\nx#$builtin/map/a", "x/map"), {
    identity: undefined,
    call: { parsed: true, name: "map" },
  });
});
