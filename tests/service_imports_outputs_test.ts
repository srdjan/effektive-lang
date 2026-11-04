import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkProject,
  emitProject,
  lowerProject,
  memoryHost,
} from "../src/core/mod.ts";
import { validateProject } from "../src/core/validate_project.ts";

Deno.test("service imports retain both modules through validation and emission", () => {
  const checked = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "users-service.eff": `
export type User = { name: string }
export service Users { find(): User }
`,
      "users.eff": `
imports Users from "./users-service.eff"
import { User } from "./users-service.eff"
export const getUser = (): User => Users.find()
`,
    }),
    "",
    ["users.eff"],
  );
  assert(checked.ok);
  assertEquals(checked.value.diagnostics, []);
  const modules = ["users", "users-service"];
  const lowered = lowerProject(checked.value);
  assertEquals([...lowered.keys()].sort(), modules);
  for (const result of lowered.values()) assert(result.ok);

  const validation = validateProject(checked.value.analysis.project, lowered);
  assertEquals([...validation.keys()].sort(), modules);
  assertEquals([...validation.values()].flat(), []);

  const emitted = emitProject(lowered, {
    config: checked.value.analysis.project.config,
  });
  assertEquals([...emitted.keys()].sort(), modules);
  for (const result of emitted.values()) assert(result.ok);
  const consumer = emitted.get("users");
  assert(consumer?.ok);
  assertStringIncludes(
    consumer.value.text,
    "Effect.Effect<User, never, Users>",
  );
});
