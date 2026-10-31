import { assert, assertEquals } from "@std/assert";
import { analyzeProject } from "../src/core/analyze.ts";
import { checkModuleDeclarations } from "../src/core/check_declarations.ts";
import { memoryHost } from "../src/core/frontend.ts";
import { TypeTable } from "../src/core/types.ts";

function refine(declaration: string, allowSyntaxErrors = false) {
  const analysis = analyzeProject(
    memoryHost({
      "effektive.json": "{}",
      "m.eff": `type T = ${declaration}\n`,
    }),
    "",
    ["m.eff"],
  );
  assert(analysis.ok, JSON.stringify(analysis));
  if (!allowSyntaxErrors) assertEquals(analysis.value.diagnostics, []);
  const info = analysis.value.project.modules.get("m");
  const resolution = analysis.value.resolutions.get("m");
  assert(info !== undefined && resolution !== undefined);
  return {
    parse: analysis.value.diagnostics,
    declarations: checkModuleDeclarations(
      info,
      resolution,
      "m",
      new TypeTable(),
      new Map(),
    ),
  };
}

function rejection(declaration: string) {
  return refine(declaration).declarations.diagnostics.map((
    diagnostic,
  ) => [diagnostic.code, diagnostic.message]);
}

const INT_WHERE = "int where";
const RECORD = "{ a: int } where";

Deno.test("a clause without one predicate function is rejected", () => {
  const rows: readonly (readonly [string, string])[] = [
    [`${INT_WHERE} 5`, "a refinement needs one predicate function"],
    [`${INT_WHERE} n`, "a refinement needs one predicate function"],
    [`${INT_WHERE} (n => n > 0)`, "a refinement needs one predicate function"],
    [`${INT_WHERE} () => true`, "a refinement predicate needs one parameter"],
    [
      `${INT_WHERE} (a, b) => true`,
      "a refinement predicate needs one parameter",
    ],
    [
      `${INT_WHERE} (n: int) => n > 0`,
      "a refinement parameter must be one unannotated name",
    ],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("syntax-error recovery still reports a refinement diagnostic", () => {
  const rows: readonly (readonly [string, string, string])[] = [
    [
      `${INT_WHERE} n =>`,
      "expected an expression, found end of file",
      "a refinement predicate needs a body",
    ],
    [
      `${INT_WHERE} n => n >`,
      "expected an expression, found end of file",
      "the refinement expression is incomplete",
    ],
    [
      `${INT_WHERE} n => n > n.`,
      "expected a name, found end of line",
      "the refinement field path is incomplete",
    ],
    [
      `${INT_WHERE} (1) => n > 1`,
      "expected a name, found `1`",
      "a refinement parameter must be one unannotated name",
    ],
    [
      `${INT_WHERE} ({ a }) => n > 1`,
      "expected a name, found `{`",
      "a refinement parameter must be one unannotated name",
    ],
    [
      `${INT_WHERE} n => n > ()`,
      "expected an expression, found `)`",
      "a refinement term must be an input field path",
    ],
    [
      `${INT_WHERE} n => ()`,
      "expected an expression, found `)`",
      "a refinement supports Boolean connectives and integer comparisons",
    ],
  ];
  for (const [declaration, syntax, message] of rows) {
    const checked = refine(declaration, true);
    assertEquals(checked.parse.map((diagnostic) => diagnostic.message), [
      syntax,
    ]);
    assertEquals(
      checked.declarations.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.message,
      ]),
      [["declaration/018", message]],
    );
  }
});

Deno.test("a body must be a Boolean connective or an integer comparison", () => {
  const connective =
    "a refinement supports Boolean connectives and integer comparisons";
  const rows: readonly (readonly [string, string])[] = [
    [`${INT_WHERE} n => n`, connective],
    [`${INT_WHERE} n => [1]`, connective],
    [`${INT_WHERE} n => 1`, connective],
    [`${INT_WHERE} n => n > 0 && n`, connective],
    [`${INT_WHERE} n => n && true`, connective],
    [
      `${INT_WHERE} n => n + 1`,
      "a refinement comparison supports only integer addition and subtraction",
    ],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("an integer expression allows literals, `+`, and `-` only", () => {
  const operators = "a refinement integer expression supports only `+` and `-`";
  const literals = "a refinement needs integer literals";
  const rows: readonly (readonly [string, string])[] = [
    [`${INT_WHERE} n => n > 1.5`, literals],
    [`${INT_WHERE} n => n > "a"`, literals],
    [`${INT_WHERE} n => n > 1 * 2`, operators],
    [`${INT_WHERE} n => n * 2 > 0`, operators],
    [`${INT_WHERE} n => n > 1 + 2 * 3`, operators],
    [`${INT_WHERE} n => 1 * 2 > n`, operators],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("a failure in either operand or sum operand is reported", () => {
  const input = "a refinement can read only its input parameter";
  const rows: readonly (readonly [string, string])[] = [
    [`${INT_WHERE} n => n > m`, input],
    [`${INT_WHERE} n => m > n`, input],
    [`${INT_WHERE} n => 1 > m`, input],
    [`${INT_WHERE} n => m + 1 > 0`, input],
    [`${INT_WHERE} n => 1 + m > 0`, input],
    [`${INT_WHERE} n => len > 0`, input],
    [`${INT_WHERE} n => m.x > 0`, input],
    [`${INT_WHERE} n => len(m) > 0`, input],
    [`${INT_WHERE} n => n > 0 && m > 0`, input],
    [`${INT_WHERE} n => m > 0 && n > 0`, input],
    [`${INT_WHERE} n => m > 0 || n > 0`, input],
    [`${INT_WHERE} n => n > 0 || m > 0`, input],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("a term must be the input, a field path, or a `len` call", () => {
  const rows: readonly (readonly [string, string])[] = [
    [
      `${INT_WHERE} n => n > [1]`,
      "a refinement term must be an input field path",
    ],
    [
      `${INT_WHERE} n => other(n) > 0`,
      "a refinement supports only the `len` call",
    ],
    [
      `${INT_WHERE} n => len(n)(n) > 0`,
      "a refinement supports only the `len` call",
    ],
    [
      `${INT_WHERE} n => (len)(n) > 0`,
      "a refinement supports only the `len` call",
    ],
    [`${INT_WHERE} n => len() > 0`, "`len` needs one input or field path"],
    [`${INT_WHERE} n => len(n, n) > 0`, "`len` needs one input or field path"],
    [`${INT_WHERE} n => len(n) > 0`, "`len` needs a string or array"],
    [`${RECORD} r => len(r) > 0`, "`len` needs a string or array"],
    [`${RECORD} r => len(r.a) > 0`, "`len` needs a string or array"],
    [
      "{ a: 1 | string } where r => len(r.a) > 0",
      "`len` needs a string or array",
    ],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("a field path must reach a required field of a record", () => {
  const rows: readonly (readonly [string, string])[] = [
    [`${INT_WHERE} n => n.x > 0`, "the path reaches non-record field `x`"],
    [`${INT_WHERE} n => n.x.y > 0`, "the path reaches non-record field `x`"],
    [
      `${INT_WHERE} n => len(n.x) > 0`,
      "the path reaches non-record field `x`",
    ],
    [`${RECORD} r => r.a.b > 0`, "the path reaches non-record field `b`"],
    [`${RECORD} r => r.b > 0`, "the input has no field `b`"],
    [`${RECORD} r => len(r.b) > 0`, "the input has no field `b`"],
    [
      "{ a?: int } where r => r.a > 0",
      "the field `a` must be required",
    ],
    [
      "{ a?: string } where r => len(r.a) > 0",
      "the field `a` must be required",
    ],
  ];
  for (const [declaration, message] of rows) {
    assertEquals(rejection(declaration), [["declaration/018", message]]);
  }
});

Deno.test("a compared value must have an integer type", () => {
  const rows: readonly string[] = [
    `${RECORD} r => r > 0`,
    '{ a: "s" } where r => r.a > 0',
    "{ a: 1 | string } where r => r.a > 0",
    "{ a: 1.5 } where r => r.a > 0",
    "{ a: string } where r => r.a > 0",
  ];
  for (const declaration of rows) {
    assertEquals(rejection(declaration), [
      ["declaration/018", "a compared value must have type `int`"],
    ]);
  }
});

Deno.test("a comparison with more than one difference is rejected", () => {
  const rows: readonly string[] = [
    `${INT_WHERE} n => n + n > 0`,
    "{ a: int, b: int } where r => r.a + r.b > 0",
    "{ a: int, b: int, c: int } where r => r.a - r.b - r.c > 0",
    "{ a: int, b: int, c: int } where r => r.a + r.b + r.c > 0",
    "{ a: int, b: int } where r => r.a - r.a - r.b > r.b",
  ];
  for (const declaration of rows) {
    assertEquals(rejection(declaration), [
      ["declaration/018", "the comparison is not a difference constraint"],
    ]);
  }
});

Deno.test("accepted predicates normalize to literal difference constraints", () => {
  const input = { kind: "input" } as const;
  const zero = { kind: "zero" } as const;
  const rows = [
    [
      `${INT_WHERE} n => (n > 0)`,
      { kind: "difference", left: zero, right: input, maximum: "-1" },
    ],
    [
      `${INT_WHERE} n => ((n)) > 0`,
      { kind: "difference", left: zero, right: input, maximum: "-1" },
    ],
    [
      `${INT_WHERE} n => (((n + 1))) >= (2)`,
      { kind: "difference", left: zero, right: input, maximum: "-1" },
    ],
    [`${INT_WHERE} n => true`, { kind: "constant", value: true }],
    [`${INT_WHERE} n => false`, { kind: "constant", value: false }],
    [`${INT_WHERE} n => 1 > 0`, { kind: "constant", value: true }],
    [`${INT_WHERE} n => n - n > 0`, { kind: "constant", value: false }],
    [
      `${INT_WHERE} n => n + 1 > 0`,
      { kind: "difference", left: zero, right: input, maximum: "0" },
    ],
    [
      `${INT_WHERE} n => n > 1 + 2`,
      { kind: "difference", left: zero, right: input, maximum: "-4" },
    ],
    [
      `${INT_WHERE} n => n > 3 - 1`,
      { kind: "difference", left: zero, right: input, maximum: "-3" },
    ],
    [
      `${INT_WHERE} n => 3 > n`,
      { kind: "difference", left: input, right: zero, maximum: "2" },
    ],
    [
      `${INT_WHERE} n => n + 99999999999999999999 > 0`,
      {
        kind: "difference",
        left: zero,
        right: input,
        maximum: "99999999999999999998",
      },
    ],
    [
      `${INT_WHERE} n => n === 1`,
      {
        kind: "and",
        operands: [
          { kind: "difference", left: input, right: zero, maximum: "1" },
          { kind: "difference", left: zero, right: input, maximum: "-1" },
        ],
      },
    ],
    [
      `${INT_WHERE} n => n !== 1`,
      {
        kind: "or",
        operands: [
          { kind: "difference", left: input, right: zero, maximum: "0" },
          { kind: "difference", left: zero, right: input, maximum: "-2" },
        ],
      },
    ],
    [
      `${INT_WHERE} n => (n > 0) && (n < 5)`,
      {
        kind: "and",
        operands: [
          { kind: "difference", left: zero, right: input, maximum: "-1" },
          { kind: "difference", left: input, right: zero, maximum: "4" },
        ],
      },
    ],
    [
      `${INT_WHERE} n => n < 0 || n > 5`,
      {
        kind: "or",
        operands: [
          { kind: "difference", left: input, right: zero, maximum: "-1" },
          { kind: "difference", left: zero, right: input, maximum: "-6" },
        ],
      },
    ],
  ] as const;
  for (const [declaration, predicate] of rows) {
    const checked = refine(declaration);
    assertEquals(checked.declarations.diagnostics, []);
    assertEquals(checked.declarations.types.map((type) => type.predicate), [
      predicate,
    ]);
  }
});

Deno.test("field and length terms accept integer and sized types", () => {
  const field = (...path: string[]) => ({ kind: "field", path }) as const;
  const length = (...path: string[]) =>
    ({ kind: "length", path, unit: "utf16" }) as const;
  const zero = { kind: "zero" } as const;
  const rows = [
    [
      "{ a: 1 | 2 } where r => r.a > 0",
      { kind: "difference", left: zero, right: field("a"), maximum: "-1" },
    ],
    [
      "{ a: 1 } where r => r.a > 0",
      { kind: "difference", left: zero, right: field("a"), maximum: "-1" },
    ],
    [
      "{ a: { b: int } } where r => r.a.b > 0",
      { kind: "difference", left: zero, right: field("a", "b"), maximum: "-1" },
    ],
    [
      '{ a: "s" } where r => len(r.a) > 0',
      { kind: "difference", left: zero, right: length("a"), maximum: "-1" },
    ],
    [
      '{ a: "s" | string } where r => len(r.a) > 0',
      { kind: "difference", left: zero, right: length("a"), maximum: "-1" },
    ],
    [
      "{ a: int[] } where r => len(r.a) > 0",
      { kind: "difference", left: zero, right: length("a"), maximum: "-1" },
    ],
    [
      "string where s => len(s) > 0",
      { kind: "difference", left: zero, right: length(), maximum: "-1" },
    ],
    [
      "int[] where a => len((a)) > 0",
      { kind: "difference", left: zero, right: length(), maximum: "-1" },
    ],
    [
      "{ a: string, b: string } where r => len(r.a) === len(r.b)",
      {
        kind: "and",
        operands: [
          {
            kind: "difference",
            left: length("a"),
            right: length("b"),
            maximum: "0",
          },
          {
            kind: "difference",
            left: length("b"),
            right: length("a"),
            maximum: "0",
          },
        ],
      },
    ],
  ] as const;
  for (const [declaration, predicate] of rows) {
    const checked = refine(declaration);
    assertEquals(checked.declarations.diagnostics, []);
    assertEquals(checked.declarations.types.map((type) => type.predicate), [
      predicate,
    ]);
  }
});
