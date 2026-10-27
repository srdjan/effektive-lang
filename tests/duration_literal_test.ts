// Duration literals: an integer followed by ms, s, m, or h is one Number token
// whose value is in milliseconds.

import { assert, assertEquals } from "@std/assert";
import { lex, TokenKind } from "../src/core/lex.ts";
import { literalOf } from "../src/core/syntax_queries.ts";
import { parse } from "../src/core/parse.ts";
import { checkModule, emitFiles } from "./helpers.ts";

function codes(text: string): string[] {
  return lex("t.eff", text).diagnostics.map((d) => d.code);
}

const UNITS: ReadonlyArray<readonly [string, number]> = [
  ["200ms", 200],
  ["5s", 5000],
  ["2m", 120000],
  ["1h", 3600000],
  ["0ms", 0],
];

Deno.test("duration literals lex as one Number token", () => {
  for (const [text] of UNITS) {
    const lexed = lex("t.eff", text);
    assertEquals(lexed.diagnostics, [], text);
    assertEquals([...lexed.kinds], [TokenKind.Number, TokenKind.Eof], text);
    assertEquals(lexed.ends[0], text.length, text);
  }
});

Deno.test("duration literals read as milliseconds", () => {
  for (const [text, ms] of UNITS) {
    const { tree } = parse("t.eff", `const d = ${text}\n`);
    const found: unknown[] = [];
    for (let node = 0; node < tree.count; node++) {
      const value = literalOf(tree, node);
      if (value !== undefined) found.push(value);
    }
    assertEquals(found, [ms], text);
  }
});

Deno.test("duration literals reject other suffixes, fractions, exponents, and leading zeros", () => {
  for (
    const text of ["5sec", "5x", "5msx", "5mm", "1.5s", "5e3ms", "05s", "1.5ms"]
  ) {
    assertEquals(codes(text), ["syntax/006"], text);
  }
});

Deno.test("a duration over the safe integer range is reported", () => {
  assertEquals(codes("9007199254740991ms"), []);
  assertEquals(codes("9007199254740992ms"), ["syntax/005"]);
  assertEquals(codes("9007199254740991h"), ["syntax/005"]);
});

Deno.test("a duration literal is a Duration and emits milliseconds", () => {
  const source = `export const d: Duration = 5s
export const s: Schedule<Int> = scheduleSpaced(5s)
type Int = int
`;
  assertEquals(checkModule(source, "m.eff").diagnostics, []);
  const module = emitFiles({ "effektive.json": "{}", "m.eff": source }, [
    "m.eff",
  ]).get("m");
  assert(module !== undefined);
  assert(module.text.includes("5000"), module.text);
  assert(!/\b5s\b/.test(module.text), module.text);
  assert(!module.text.includes("Duration.make"), module.text);
});
