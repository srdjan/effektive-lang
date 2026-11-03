// Tests of the pure parts of scripts/mutate.ts: the mutation sites, the seeded
// selection, the result classes, the register, and the arguments. They start
// no subprocess. They are slow tests only because the `typescript` import
// needs env access, which the fast suite does not grant.

import { assertEquals } from "@std/assert";
import {
  applyMutant,
  classify,
  matchRegister,
  mutantsOf,
  type Operator,
  parseOptions,
  parseRegister,
  type RegisterRow,
  rowOf,
  selectSample,
  testArgs,
} from "../scripts/mutate.ts";

/** The compact view of the sites of a source: operator, text, replacement. */
function view(source: string) {
  return mutantsOf("a.ts", source).map((m) => ({
    operator: m.operator,
    text: m.text,
    replacement: m.replacement,
  }));
}

Deno.test("each operator gives its mutant", () => {
  const cases: {
    source: string;
    mutated: string;
    operator: Operator;
    text: string;
  }[] = [
    {
      source: "export const f = (a: number, b: number) => a === b;",
      mutated: "export const f = (a: number, b: number) => a !== b;",
      operator: "comparison",
      text: "a === b",
    },
    {
      source: "export const f = (a: number, b: number) => a !== b;",
      mutated: "export const f = (a: number, b: number) => a === b;",
      operator: "comparison",
      text: "a !== b",
    },
    {
      source: "export const f = (a: number, b: number) => a < b;",
      mutated: "export const f = (a: number, b: number) => a <= b;",
      operator: "comparison",
      text: "a < b",
    },
    {
      source: "export const f = (a: number, b: number) => a <= b;",
      mutated: "export const f = (a: number, b: number) => a < b;",
      operator: "comparison",
      text: "a <= b",
    },
    {
      source: "export const f = (a: number, b: number) => a > b;",
      mutated: "export const f = (a: number, b: number) => a >= b;",
      operator: "comparison",
      text: "a > b",
    },
    {
      source: "export const f = (a: number, b: number) => a >= b;",
      mutated: "export const f = (a: number, b: number) => a > b;",
      operator: "comparison",
      text: "a >= b",
    },
    {
      source: "export const f = (a: boolean, b: boolean) => a && b;",
      mutated: "export const f = (a: boolean, b: boolean) => a || b;",
      operator: "logical",
      text: "a && b",
    },
    {
      source: "export const f = (a: boolean, b: boolean) => a || b;",
      mutated: "export const f = (a: boolean, b: boolean) => a && b;",
      operator: "logical",
      text: "a || b",
    },
    {
      source: "function f(a: boolean) {\n  if (a) return 1;\n  return 2;\n}",
      mutated:
        "function f(a: boolean) {\n  if (!(a)) return 1;\n  return 2;\n}",
      operator: "negate-if",
      text: "a",
    },
    {
      source: "function f(): boolean {\n  return true;\n}",
      mutated: "function f(): boolean {\n  return false;\n}",
      operator: "boolean-return",
      text: "return true;",
    },
    {
      source: "function f(): boolean {\n  return false;\n}",
      mutated: "function f(): boolean {\n  return true;\n}",
      operator: "boolean-return",
      text: "return false;",
    },
  ];
  for (const c of cases) {
    const sites = mutantsOf("a.ts", c.source);
    assertEquals(sites.length, 1, c.source);
    assertEquals(sites[0]!.operator, c.operator);
    assertEquals(sites[0]!.text, c.text);
    assertEquals(applyMutant(c.source, sites[0]!), c.mutated);
  }
});

Deno.test("a type node gives no mutant", () => {
  assertEquals(
    view(
      "type A = { readonly a: true } & (string | number);\n" +
        "interface I {\n  m(): boolean;\n}\n" +
        "function p(x: unknown): x is true {\n  return typeof x;\n}\n",
    ),
    [],
  );
});

Deno.test("a site records its declaration and offset", () => {
  const source = "class T {\n  m(a: boolean, b: boolean) {\n" +
    "    return a && b;\n  }\n}\nconst h = (x: number) => x >= 1;\nconst k = 1 < 2;\n";
  assertEquals(
    mutantsOf("a.ts", source).map((m) => [m.declaration, m.offset, m.line]),
    [["T.m", 39, 3], ["h", 15, 6], ["<module>", 108, 7]],
  );
});

Deno.test("a constructor, accessor, and member arrow name their declaration", () => {
  const source = "class C {\n  constructor(a: boolean, b: boolean) {\n" +
    "    this.v = a && b;\n  }\n  get g() {\n    return 1 < 2;\n  }\n" +
    "  set s(x: number) {\n    this.w = x >= 1;\n  }\n" +
    "  f = (x: number) => x > 1;\n}\n" +
    "const o = { m: (x: number) => x <= 2 };\n";
  assertEquals(
    mutantsOf("a.ts", source).map((m) => [m.declaration, m.offset, m.text]),
    [
      ["C.constructor", 51, "a && b"],
      ["C.g", 21, "1 < 2"],
      ["C.s", 32, "x >= 1"],
      ["C.f", 15, "x > 1"],
      ["m", 15, "x <= 2"],
    ],
  );
});

Deno.test("an unnamed function belongs to the named function around it", () => {
  const source =
    "function f(xs: number[]) {\n  return xs.filter((x) => x > 1);\n}\n";
  assertEquals(
    mutantsOf("a.ts", source).map((m) => [m.declaration, m.offset, m.text]),
    [["f", 53, "x > 1"]],
  );
});

Deno.test("a bare return and a literal statement give no site", () => {
  assertEquals(
    view("function f(x: boolean) {\n  true;\n  if (x) return;\n  return;\n}"),
    [{ operator: "negate-if", text: "x", replacement: "!(x)" }],
  );
});

const TWO_RETURNS =
  "function f(x: number): boolean {\n  if (x > 0) {\n    return true;\n  }\n  return true;\n}";
const ONE_RETURN = "function f(x: number): boolean {\n  return true;\n}";

Deno.test("two equal expressions in one declaration are separate sites", () => {
  const returns = mutantsOf("a.ts", TWO_RETURNS).filter((m) =>
    m.operator === "boolean-return"
  );
  assertEquals(
    returns.map((m) => [m.declaration, m.offset, m.text]),
    [["f", 52, "return true;"], ["f", 71, "return true;"]],
  );
});

function row(offset: number): RegisterRow {
  return {
    file: "a.ts",
    declaration: "f",
    offset,
    text: "return true;",
    operator: "boolean-return",
    class: "equivalent",
    reason: "No input reaches the return.",
  };
}

Deno.test("a row matches exactly one of two equal expressions", () => {
  const sites = mutantsOf("a.ts", TWO_RETURNS);
  const [first, second] = sites.filter((m) => m.operator === "boolean-return");
  const match = matchRegister(sites, [first!, second!], [row(71)], ["a.ts"]);
  assertEquals(match.registered.map((r) => r.mutant.offset), [71]);
  assertEquals(match.unregistered.map((m) => m.offset), [52]);
  assertEquals(match.stale, []);
});

Deno.test("a row is stale when its site is deleted and an equal one remains", () => {
  const sites = mutantsOf("a.ts", ONE_RETURN);
  assertEquals(
    sites.map((m) => [m.declaration, m.offset, m.text]),
    [["f", 35, "return true;"]],
  );
  const match = matchRegister(sites, [], [row(52)], ["a.ts"]);
  assertEquals(match.stale, [row(52)]);
});

Deno.test("a row of a file that the run did not scan is not stale", () => {
  const match = matchRegister([], [], [row(52)], ["b.ts"]);
  assertEquals(match.stale, []);
});

Deno.test("a survivor row prints with an empty class and reason", () => {
  const [site] = mutantsOf("a.ts", ONE_RETURN);
  assertEquals(rowOf(site!), {
    file: "a.ts",
    declaration: "f",
    offset: 35,
    text: "return true;",
    operator: "boolean-return",
    class: "",
    reason: "",
  });
});

Deno.test("the same seed gives the same selection", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assertEquals(selectSample(items, 3, 1), [3, 7, 8]);
  assertEquals(selectSample(items, 3, 1), [3, 7, 8]);
  assertEquals(selectSample(items, 3, 2), [0, 4, 9]);
  assertEquals(selectSample(items, "all", 1), items);
  assertEquals(selectSample(items, 20, 1), items);
});

Deno.test("classify names the result class from the runner output", () => {
  const cases: { timedOut: boolean; output: string; expected: string }[] = [
    {
      timedOut: false,
      output: "running 3 tests\nok | 3 passed | 0 failed (12ms)\n",
      expected: "survived",
    },
    {
      timedOut: false,
      output: "ok | 5 passed (2 steps) | 0 failed | 1 ignored (1s)\n",
      expected: "survived",
    },
    {
      timedOut: false,
      output: "\u001b[0m\u001b[32mok\u001b[0m | 1 passed | 0 failed (4ms)\n",
      expected: "survived",
    },
    {
      timedOut: false,
      output: "FAILED | 2 passed | 1 failed (30ms)\n",
      expected: "killed",
    },
    {
      timedOut: false,
      output: "a ... ok (1ms)\nb ...\nfatal: heap out of memory\n",
      expected: "killed",
    },
    {
      timedOut: false,
      output: "FAILED | 0 passed | 1 failed (5ms)\n",
      expected: "killed",
    },
    {
      timedOut: false,
      output: "ok | 0 passed | 0 failed (1ms)\n",
      expected: "infrastructure",
    },
    {
      timedOut: false,
      output: "FAILED | 0 passed | 0 failed (1ms)\n",
      expected: "infrastructure",
    },
    {
      timedOut: false,
      output: 'error: Module not found "file:///x.ts"\n',
      expected: "infrastructure",
    },
    {
      timedOut: false,
      output: "ok | 0 passed | 1 failed (5ms)\n",
      expected: "infrastructure",
    },
    {
      timedOut: false,
      output: "FAILED | 2 passed | 0 failed (5ms)\n",
      expected: "infrastructure",
    },
    { timedOut: false, output: "", expected: "infrastructure" },
    {
      timedOut: true,
      output: "running 3 tests\n",
      expected: "timeout",
    },
  ];
  for (const c of cases) {
    // The message holds the output on one line. A line that starts with
    // `ok | ` in the message would look like a summary to the outer tool when
    // a mutant of classify fails this test.
    assertEquals(classify(c), c.expected, JSON.stringify(c.output));
  }
});

Deno.test("parseRegister accepts valid rows and rejects bad ones", () => {
  const good: RegisterRow = {
    file: "a.ts",
    declaration: "f",
    offset: 3,
    text: "x",
    operator: "logical",
    class: "slow-only",
    reason: "tests/a_slow_test.ts kills it.",
  };
  assertEquals(parseRegister("[]"), { ok: true, value: [] });
  const notJson = parseRegister("{");
  assertEquals(notJson.ok, false);
  assertEquals(!notJson.ok && notJson.error.startsWith("not JSON: "), true);
  assertEquals(parseRegister(JSON.stringify([good])), {
    ok: true,
    value: [good],
  });
  const atZero: RegisterRow = { ...good, offset: 0 };
  assertEquals(parseRegister(JSON.stringify([atZero])), {
    ok: true,
    value: [atZero],
  });
  const bad: [string, string][] = [
    ["{}", "the register must be an array"],
    ["[1]", "row 0 must be an object"],
    ["[null]", "row 0 must be an object"],
    ["[[]]", "row 0 must be an object"],
    [
      JSON.stringify([{ ...good, offset: 1.5 }]),
      'row 0: "offset" must be a non-negative integer',
    ],
    [
      JSON.stringify([{ ...good, offset: -1 }]),
      'row 0: "offset" must be a non-negative integer',
    ],
    [
      JSON.stringify([{ ...good, operator: "other" }]),
      'row 0: "operator" must be one of comparison, logical, negate-if, boolean-return',
    ],
    [
      JSON.stringify([{ ...good, class: "" }]),
      'row 0: "class" must be equivalent or slow-only',
    ],
    [
      JSON.stringify([{ ...good, reason: "slow." }]),
      "row 0: a slow-only reason must name a *_slow_test.ts file",
    ],
    [
      JSON.stringify([{ ...good, class: "equivalent", reason: " " }]),
      'row 0: "reason" must not be empty',
    ],
    [
      JSON.stringify([{ ...good, text: 1 }]),
      'row 0: "text" must be a string',
    ],
  ];
  for (const [text, error] of bad) {
    assertEquals(parseRegister(text), { ok: false, error });
  }
});

Deno.test("parseOptions reads the defaults and the flags", () => {
  assertEquals(parseOptions(["./src/core/paths.ts"]), {
    ok: true,
    value: {
      seed: 1,
      sample: "all",
      workers: 4,
      tests: undefined,
      only: [],
      modules: ["src/core/paths.ts"],
    },
  });
  assertEquals(
    parseOptions([
      "--seed",
      "7",
      "--sample=2",
      "--workers",
      "3",
      "--tests",
      "tests/a_test.ts",
      "--only",
      "src/a.ts:12",
      "src/a.ts",
      "src/b.ts",
    ]),
    {
      ok: true,
      value: {
        seed: 7,
        sample: 2,
        workers: 3,
        tests: "tests/a_test.ts",
        only: [{ file: "src/a.ts", line: 12 }],
        modules: ["src/a.ts", "src/b.ts"],
      },
    },
  );
});

Deno.test("parseOptions keeps every --only site", () => {
  assertEquals(
    parseOptions([
      "--only",
      "src/a.ts:12",
      "--only=./src/b.ts:30",
      "src/a.ts",
      "src/b.ts",
    ]),
    {
      ok: true,
      value: {
        seed: 1,
        sample: "all",
        workers: 4,
        tests: undefined,
        only: [{ file: "src/a.ts", line: 12 }, { file: "src/b.ts", line: 30 }],
        modules: ["src/a.ts", "src/b.ts"],
      },
    },
  );
});

Deno.test("parseOptions rejects bad arguments", () => {
  const cases: [string[], string][] = [
    [[], "name at least one module"],
    [["--seed", "x", "a.ts"], "--seed must be a non-negative integer"],
    [["--sample", "0", "a.ts"], "--sample must be a positive integer or all"],
    [["--workers", "0", "a.ts"], "--workers must be a positive integer"],
    [["--only", "a.ts", "a.ts"], "--only must be <path:line>"],
    [["--other", "1", "a.ts"], "unknown flag --other"],
    [["--seed"], "--seed needs a value"],
    [["../a.ts"], "../a.ts must be a relative path of a .ts file"],
    [["a.js"], "a.js must be a relative path of a .ts file"],
  ];
  for (const [args, error] of cases) {
    assertEquals(parseOptions(args), { ok: false, error });
  }
});

Deno.test("testArgs builds the clean and mutant commands", () => {
  assertEquals(testArgs(undefined, true), [
    "test",
    "--allow-read",
    "--parallel",
    "--fail-fast",
    "--ignore=**/*_slow_test.ts",
    "tests/",
  ]);
  assertEquals(testArgs(undefined, false), [
    "test",
    "--no-check",
    "--allow-read",
    "--parallel",
    "--fail-fast",
    "--ignore=**/*_slow_test.ts",
    "tests/",
  ]);
  assertEquals(testArgs("tests/a_test.ts", false), [
    "test",
    "--no-check",
    "--allow-all",
    "--fail-fast",
    "tests/a_test.ts",
  ]);
});
