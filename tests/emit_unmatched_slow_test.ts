// The strict target check as an oracle for match coverage. The checker reports
// a non-exhaustive match (pattern/001). Here the IR loses one arm after the
// checker ran, so only the TypeScript check of the emitted fallback can see it.

import { assert, assertEquals } from "@std/assert";
import { checkProject, lowerProject } from "../src/core/frontend.ts";
import type { Expr, ModuleIR } from "../src/core/frontend.ts";
import { emitProject } from "../src/core/typescript.ts";
import { deno } from "./process_helpers.ts";
import { fileHost, withTemporary } from "./emit_slow_helpers.ts";
import { TARGET_COMPILER_OPTIONS, TARGET_IMPORTS } from "../src/cli/tsc.ts";

const SOURCE = [
  "type Text = string",
  "export type Circle = { radius: Text }",
  "export type Square = { side: Text }",
  "export type Triangle = { base: Text }",
  "export type Shape = Circle | Square | Triangle",
  "export const describe = (s: Shape): Text =>",
  "  match s {",
  "    Circle(c) => c.radius,",
  "    Square(q) => q.side,",
  "    Triangle(t) => t.base",
  "  }",
  "",
].join("\n");

/** The same module with the last arm of the match in `describe` removed. */
function withoutLastArm(ir: ModuleIR): ModuleIR {
  return {
    ...ir,
    declarations: ir.declarations.map((declaration) => {
      if (declaration.kind !== "function" || declaration.name !== "describe") {
        return declaration;
      }
      const body: Expr = declaration.body;
      assert(body.kind === "match", `body kind ${body.kind}`);
      return {
        ...declaration,
        body: { ...body, arms: body.arms.slice(0, -1) },
      };
    }),
  };
}

async function checkEmitted(removeArm: boolean) {
  return await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/main.eff`, SOURCE);
    const checked = checkProject(fileHost, dir, ["main.eff"]);
    assert(checked.ok, JSON.stringify(checked));
    assertEquals(checked.value.diagnostics.map((d) => d.code), []);
    const lowered = new Map(lowerProject(checked.value));
    const main = lowered.get("main");
    assert(main !== undefined && main.ok, "module main was not lowered");
    if (removeArm) {
      lowered.set("main", { ok: true, value: withoutLastArm(main.value) });
    }
    const emitted = emitProject(lowered, {
      config: checked.value.analysis.project.config,
    }).get("main");
    assert(emitted !== undefined && emitted.ok, JSON.stringify(emitted));
    Deno.writeTextFileSync(`${dir}/${emitted.value.path}`, emitted.value.text);
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify({
        compilerOptions: TARGET_COMPILER_OPTIONS,
        imports: TARGET_IMPORTS,
      }),
    );
    const run = await deno(dir, [
      "check",
      "--config",
      "deno.json",
      emitted.value.path,
    ]);
    return { code: run.code, stderr: run.stderr, path: emitted.value.path };
  });
}

Deno.test("the target check accepts a match over every variant", async () => {
  const run = await checkEmitted(false);
  assertEquals(run.code, 0, run.stderr);
});

Deno.test("the target check rejects a match that lacks a variant when the checker is silent", async () => {
  const run = await checkEmitted(true);
  assertEquals(run.code, 1);
  const header = run.stderr.split("\n").find((line) =>
    line.startsWith("TS2345")
  );
  assertEquals(
    header,
    `TS2345 [ERROR]: Argument of type '{ readonly _tag: "main#Triangle"; readonly base: string; }' is not assignable to parameter of type 'never'.`,
  );
});
