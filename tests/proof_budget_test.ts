import { assertEquals } from "@std/assert";
import { checkProject, memoryHost, Program } from "../src/core/mod.ts";

const head =
  "type Int = int\ntype Positive = int where n => n > 0\nerror Invalid = {}\n";

function proofFunction(name: string): string {
  return `const ${name} = (n: Int): Positive fails Invalid => {\n  if (n > 0) {} else { fail(Invalid({})) }\n  Positive(n)\n}\n`;
}

function manyProofs(count: number): string {
  return head +
    Array.from({ length: count }, (_, i) => proofFunction(`f${i}`)).join("");
}

const oneProof = head + proofFunction("victim");

function fresh(files: Record<string, string>, entries: string[]): string[] {
  const result = checkProject(memoryHost(files), "", entries);
  if (!result.ok) throw new Error("checkProject failed");
  return result.value.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

function edited(
  files: Record<string, string>,
  changed: Record<string, string>,
): string[] {
  const program = new Program("");
  program.update({ set: files });
  const result = program.update({ set: changed });
  if (!result.ok) throw new Error("Program.update failed");
  return result.value.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

Deno.test("a module above the aggregate limit does not spend the budget of another module", () => {
  const files = {
    "effektive.json": "{}",
    "a.eff": manyProofs(10_000),
    "z.eff": oneProof,
  };
  assertEquals(fresh(files, ["a.eff", "z.eff"]), []);
  assertEquals(
    edited({ ...files, "a.eff": head }, { "a.eff": files["a.eff"] }),
    [],
  );
});

Deno.test("one module above the proof limit gives type-mismatch/013 on both paths", () => {
  const files = {
    "effektive.json": "{}",
    "a.eff": manyProofs(10_001),
  };
  const expected = [
    "type-mismatch/013: the value of Positive exceeds the proof limit for the required refinement Positive",
  ];
  assertEquals(fresh(files, ["a.eff"]), expected);
  assertEquals(
    edited({ ...files, "a.eff": head }, { "a.eff": files["a.eff"] }),
    expected,
  );
});
