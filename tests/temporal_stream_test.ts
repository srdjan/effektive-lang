import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";

const prefix = `type Int = int
service Source { next(n: Int): Option<[Int, Int]> }
const source = unfold(0, (n) => Source.next(n))
`;

const DEBOUNCE_RULE =
  "`debounceStream` needs a nonnegative Duration literal such as `200ms`";
const THROTTLE_RULE =
  '`throttleStream` needs { units: U, duration: D, strategy: "shape" | "enforce" } with a positive integer literal U and a positive Duration literal D';

function diagnosticsOf(declaration: string) {
  const source = prefix + declaration;
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": source }),
    "",
    ["main.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    text: source.slice(d.span.start, d.span.end),
  }));
}

Deno.test("temporal stream controls accept literal windows", () => {
  assertEquals(
    diagnosticsOf(`const debounced = debounceStream(source, 0ms)
const shaped = throttleStream(source, { units: 1, duration: 1000ms, strategy: "shape" })
const enforced = throttleStream(source, { units: 2, duration: 5ms, strategy: "enforce" })`),
    [],
  );
});

Deno.test("debounceStream rejects delays that are not nonnegative Duration literals", () => {
  // The delay expression is the offending node. A parenthesized or named value is not a literal.
  for (
    const [declaration, offending] of [
      ["const s = debounceStream(source, 0 - 1)", "0 - 1"],
      ["const s = debounceStream(source, 1.5)", "1.5"],
      ["const s = debounceStream(source, 5)", "5"],
      [
        "const s = debounceStream(source, 9007199254740993)",
        "9007199254740993",
      ],
      ["const delay = 5ms\nconst s = debounceStream(source, delay)", "delay"],
    ]
  ) {
    assertEquals(
      diagnosticsOf(declaration),
      [{ code: "type-mismatch/010", message: DEBOUNCE_RULE, text: offending }],
      declaration,
    );
  }
});

Deno.test("debounceStream reports a unary minus as syntax and a non-Stream first argument as a type error", () => {
  assertEquals(
    diagnosticsOf("const s = debounceStream(source, -1)").map((d) => d.code),
    ["syntax/010"],
  );
  assertEquals(diagnosticsOf("const s = debounceStream(3, 5ms)"), [{
    code: "type-mismatch/010",
    message: "`debounceStream` needs a Stream value",
    text: "3",
  }]);
});

Deno.test("throttleStream rejects settings that are not a positive integer literal and a positive Duration literal", () => {
  for (
    const options of [
      '{ units: 0, duration: 1000ms, strategy: "shape" }',
      '{ units: 1, duration: 0ms, strategy: "shape" }',
      '{ units: 1.5, duration: 1000ms, strategy: "shape" }',
      '{ units: 1, duration: 1000ms, strategy: "drop" }',
      "{ units: 1, duration: 1000ms }",
      '{ units: 1, duration: 1000, strategy: "shape" }',
      '{ units: 1, durationMs: 1000, strategy: "shape" }',
      '{ units: 1, duration: 1000ms, strategy: "shape", extra: 1 }',
      '{ units: 1, units: 2, strategy: "shape" }',
      '{ units: u, duration: 1000ms, strategy: "shape" }',
    ]
  ) {
    assertEquals(
      diagnosticsOf(
        `const u = 1\nconst s = throttleStream(source, ${options})`,
      ),
      [{ code: "type-mismatch/010", message: THROTTLE_RULE, text: options }],
      options,
    );
  }
  assertEquals(
    diagnosticsOf(
      'const o = { units: 1, duration: 1000ms, strategy: "shape" }\nconst s = throttleStream(source, o)',
    ),
    [{ code: "type-mismatch/010", message: THROTTLE_RULE, text: "o" }],
  );
  assertEquals(
    diagnosticsOf(
      'const s = throttleStream(3, { units: 1, duration: 1000ms, strategy: "shape" })',
    ),
    [{
      code: "type-mismatch/010",
      message: "`throttleStream` needs a Stream value",
      text: "3",
    }],
  );
});
