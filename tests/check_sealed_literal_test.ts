import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { assertValidProject } from "./helpers.ts";

const CONFIG = { "effektive.json": "{}" };

function messages(
  files: Readonly<Record<string, string>>,
  entry = "main.eff",
): string[] {
  const result = checkProject(
    memoryHost({ ...CONFIG, ...files }),
    "",
    [entry],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => `${d.code}: ${d.message}`);
}

const LIB = `
export type Int = int
export type Text = string
export sealed type Bag = Int[]
export sealed type Pair = [Int, Int]
export sealed type Card = { title: Text }
export type Open = Int[]
`;
const IMPORT = `import { Int, Text, Bag, Pair, Card, Open } from "./lib.eff"\n`;

function foreign(body: string): string[] {
  return messages({ "lib.eff": LIB, "main.eff": IMPORT + body });
}

const bag = "only the declaring module can construct the sealed type `Bag`";
const pair = "only the declaring module can construct the sealed type `Pair`";
const card = "only the declaring module can construct the sealed type `Card`";

Deno.test("a foreign module cannot construct a sealed type by literal", () => {
  const cases: ReadonlyArray<readonly [string, string[]]> = [
    ["export const f = (a: Int): Bag => [a]", [`sealed/001: ${bag}`]],
    ["export const f = (): Bag => []", [`sealed/001: ${bag}`]],
    [
      "export const f = (a: Int): Pair => [a, a]",
      [`sealed/001: ${pair}`],
    ],
    [
      "export const f = (t: Text): Card => ({ title: t })",
      [`sealed/001: ${card}`],
    ],
    [
      "export const f = (a: Int): Bag[] => [[a]]",
      [`sealed/001: ${bag}`],
    ],
    [
      "export const f = (a: Int): { b: Bag } => ({ b: [a] })",
      [`sealed/001: ${bag}`],
    ],
    [
      "export const f = (a: Int): Option<Bag> => Some([a])",
      [`sealed/001: ${bag}`],
    ],
  ];
  for (const [body, expected] of cases) {
    assertEquals(foreign(body), expected, body);
  }
});

Deno.test("a foreign module accepts literals that do not construct a sealed type", () => {
  for (
    const body of [
      "export const f = (b: Bag): Bag[] => [b]",
      "export const f = (b: Bag): Option<Bag> => Some(b)",
      "export const f = (a: Int): Open => [a]",
    ]
  ) {
    assertEquals(foreign(body), [], body);
  }
});

Deno.test("the declaring module constructs its sealed type by literal", () => {
  assertEquals(
    messages({
      "main.eff": `
export type Int = int
export type Text = string
export sealed type Bag = Int[]
export sealed type Card = { title: Text }
export const f = (a: Int): Bag => [a]
export const g = (t: Text): Card => ({ title: t })
`,
    }),
    [],
  );
});

Deno.test("the declaring module constructs its sealed types by literal, and the program validates", () => {
  const result = checkProject(
    memoryHost({
      ...CONFIG,
      "lib.eff": LIB +
        `export const bag = (a: Int): Bag => [a]
export const pair = (a: Int): Pair => [a, a]
export const card = (t: Text): Card => ({ title: t })
`,
    }),
    "",
    ["lib.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  assertValidProject(result.value);
});
