import { assert, assertEquals } from "@std/assert";
import { analyzeProject } from "../src/core/analyze.ts";
import {
  type CheckedProject,
  checkModuleStep,
  checkProject,
  reachedModules,
} from "../src/core/check_project.ts";
import type { ValueId } from "../src/core/ir.ts";
import { lowerProject } from "../src/core/lower.ts";
import { memoryHost } from "../src/core/source.ts";
import { nodeSpan } from "../src/core/syntax.ts";
import { TypeTable } from "../src/core/types.ts";

function check(text: string): CheckedProject {
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "m.eff": text }),
    "",
    ["m.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function messages(project: CheckedProject): string[] {
  return project.diagnostics.map((diagnostic) =>
    `${diagnostic.code} ${diagnostic.message}`
  );
}

function proofTexts(
  project: CheckedProject,
  source: string,
  name: string,
): string[] {
  const module = project.modules.get("m");
  const body = module?.functions.get(`value:m#${name}` as ValueId);
  assert(module !== undefined && body !== undefined);
  return [...body.table.proofs.keys()].map((node) => {
    const span = nodeSpan(module.tree, node);
    return source.slice(span.start, span.end);
  });
}

Deno.test("refinement constructors prove literals and reject invalid values", () => {
  const source = `
type Positive = int where n => n > 0
const good = (): Positive => Positive(1)
const bad = (): Positive => Positive(0)
`;
  const project = check(source);
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/013",
  ]);
  assertEquals(proofTexts(project, source, "good"), ["1"]);
  assert(messages(project)[0].includes("does not satisfy"));
  const lowered = lowerProject(check(`
type Positive = int where n => n > 0
const good = (): Positive => Positive(1)
`)).get("m");
  assert(lowered?.ok);
  const good = lowered.value.declarations.find((declaration) =>
    declaration.kind === "function" && declaration.name === "good"
  );
  assert(JSON.stringify(good).includes('"target":"type:m#Positive"'));
});

Deno.test("arithmetic and control-flow facts preserve a refinement", () => {
  const source = `
type Bool = boolean
type Positive = int where n => n > 0
const take = (p: Positive): Bool => true
const bump = (p: Positive): Positive => p + 1
const alias = (p: Positive): Positive => { const q = p + 1; q - 1 }
const guarded = (p: Positive): Positive => if (p > 1) { p - 1 } else { 1 }
const both = (p: Positive): Bool => (p > 1) && take(Positive(p - 1))
const either = (p: Positive): Bool => (p <= 1) || take(Positive(p - 1))
const matched = (p: Positive): Positive => match (p) { 2 => p - 1, _ => 1 }
`;
  const project = check(source);
  assertEquals(project.diagnostics, [], messages(project).join("\n"));
  assert(proofTexts(project, source, "bump").includes("p + 1"));
  assert(proofTexts(project, source, "alias").includes("q - 1"));
  assert(proofTexts(project, source, "guarded").includes("p - 1"));
  assert(proofTexts(project, source, "matched").includes("p - 1"));

  const restored = check(`
type Positive = int where n => n > 0
const invalid = (p: Positive): Positive =>
  if (p > 1) { p - 1 } else { p - 1 }
`);
  assertEquals(restored.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/013",
  ]);
});

Deno.test("record construction and updates prove required field relations", () => {
  const source = `
type Int = int
type Text = string
type Amount = int where n => n > 0
type Input = { amount: Amount }
type Window = { low: Int, high: Int } where w => w.high - w.low >= 1
type Named = { name: Text } where value => len(value.name) >= 0
const made = (): Window => ({ low: 1, high: 2 })
const moved = (w: Window): Window => ({ ...w, high: w.high + 1 })
const bad = (w: Window): Window => ({ ...w, high: w.low })
const nested = (input: Input): Amount => input.amount + 1
const named = (name: Text): Named => ({ name })
`;
  const project = check(source);
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/013",
  ]);
  assertEquals(proofTexts(project, source, "made"), [
    "{ low: 1, high: 2 }",
  ]);
  assertEquals(proofTexts(project, source, "moved"), [
    "{ ...w, high: w.high + 1 }",
  ]);
  assertEquals(proofTexts(project, source, "nested"), ["input.amount + 1"]);
  assertEquals(proofTexts(project, source, "named"), ["{ name }"]);
});

Deno.test("proofs preserve identity separation and reject unsupported arithmetic", () => {
  const project = check(`
type Int = int
type Positive = int where n => n > 0
const cross = (n: Int): Positive => n
const multiply = (p: Positive): Positive => p * 2
`);
  assertEquals(project.diagnostics.map((diagnostic) => diagnostic.code), [
    "type-mismatch/003",
    "type-mismatch/013",
  ]);
  assert(messages(project)[1].includes("does not prove"));

  const sealed = checkProject(
    memoryHost({
      "effektive.json": "{}",
      "lib.eff": "export sealed type Positive = int where n => n > 0",
      "main.eff":
        'import { Positive } from "./lib.eff"\nconst bad = (): Positive => Positive(1)',
    }),
    "",
    ["main.eff"],
  );
  assert(sealed.ok);
  assertEquals(sealed.value.diagnostics.map((diagnostic) => diagnostic.code), [
    "sealed/001",
  ]);
});

Deno.test("proof limits reject aggregate and query exhaustion", () => {
  const source = `
type Positive = int where n => n > 0
const bump = (p: Positive): Positive => p + 1
`;
  const analysis = analyzeProject(
    memoryHost({ "effektive.json": "{}", "m.eff": source }),
    "",
    ["m.eff"],
  );
  assert(analysis.ok);
  const info = analysis.value.project.modules.get("m");
  assert(info !== undefined);
  for (const remaining of [0, 1]) {
    const budget = { remaining };
    const step = checkModuleStep(
      analysis.value,
      info,
      "m",
      new TypeTable(),
      reachedModules(analysis.value, "m", new Map(), new Map()),
      budget,
    );
    assertEquals(
      step.checked.diagnostics.map((diagnostic) => diagnostic.code),
      [
        "type-mismatch/013",
      ],
    );
    assert(step.checked.diagnostics[0].message.includes("proof limit"));
    assertEquals(budget.remaining, 0);
  }
});
