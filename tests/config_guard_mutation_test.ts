// Tests that kill mutation survivors in the project configuration patterns and
// in the recursion guard. Each test reaches the code through an exported name.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lowerProject,
  memoryHost,
  type ProjectConfig,
} from "../src/core/frontend.ts";
import { importAllowed, parseConfig } from "../src/core/project_config.ts";

function configOf(text: string): ProjectConfig {
  const result = parseConfig(text);
  assert(result.ok, text);
  return result.value.config;
}

function fromError(pattern: string): unknown {
  const result = parseConfig(
    JSON.stringify({ imports: [{ from: pattern, allow: [] }] }),
  );
  return result.ok ? "accepted" : result.error;
}

function invalidFrom(pattern: string) {
  return {
    tag: "invalid-shape",
    path: "effektive.json",
    message: `imports entry 1 has an invalid \`from\` pattern \`${pattern}\``,
  };
}

Deno.test("an empty from pattern is invalid", () => {
  assertEquals(fromError(""), invalidFrom(""));
});

Deno.test("a from pattern with a dot part is invalid", () => {
  assertEquals(fromError("./a"), invalidFrom("./a"));
});

Deno.test("a from pattern with a dot-dot part is invalid", () => {
  assertEquals(fromError("../a"), invalidFrom("../a"));
});

Deno.test("a from pattern with a part outside the name characters is invalid", () => {
  assertEquals(fromError("a@b"), invalidFrom("a@b"));
});

Deno.test("a double-star pattern does not match a module that its tail cannot reach", () => {
  const config = configOf(
    '{"imports":[{"from":"**/x","allow":["only"]}]}',
  );
  assertEquals(importAllowed(config, "y", "other"), true);
  assertEquals(importAllowed(config, "y/x", "other"), false);
  assertEquals(importAllowed(config, "y/x", "only"), true);
});

function diagnosticsOf(text: string): string[] {
  const checked = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(checked.ok, text);
  assert(lowerProject(checked.value).get("m") !== undefined, text);
  return checked.value.diagnostics.map((d) => `${d.code} ${d.message}`);
}

Deno.test("a record with an optional self field is a guarded recursion", () => {
  assertEquals(
    diagnosticsOf(
      `type Node = { value: int, next?: Node }\ntype Leaf = { x: int }\ntype Shape = Node | Leaf`,
    ),
    [],
  );
});
