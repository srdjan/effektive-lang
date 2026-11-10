import { assertEquals } from "@std/assert";
import type { Diagnostic } from "../src/core/frontend.ts";
import { parse } from "../src/core/parse.ts";
import { fileModeOf } from "../src/core/paths.ts";
import {
  childrenOf,
  hasProblem,
  kindName,
  kindOf,
  type NodeId,
  nodeText,
  printTree,
  SyntaxKind,
  type SyntaxTree,
  walk,
} from "../src/core/syntax.ts";
import {
  constInitializer,
  declSummaries,
  findFirst,
  nodeChildren,
  sexp,
  treeProblems,
} from "./helpers.ts";
import { unparen } from "../src/core/syntax_queries.ts";

/** Parses text, checks the invariants that hold for every input, and returns the result. */
function parseChecked(text: string, mode: "eff" | "effi" = "eff") {
  const result = parse(mode === "eff" ? "t.eff" : "t.effi", text, mode);
  assertEquals(
    printTree(result.tree),
    text,
    "the printed tree equals the input",
  );
  assertEquals(treeProblems(result.tree), []);
  return result;
}

function parseClean(text: string, mode: "eff" | "effi" = "eff"): SyntaxTree {
  const result = parseChecked(text, mode);
  assertEquals(result.diagnostics.map(show), []);
  return result.tree;
}

function show(d: Diagnostic): string {
  return `${d.span.start}-${d.span.end} ${d.code} ${d.message}`;
}

function countKind(tree: SyntaxTree, kind: SyntaxKind): number {
  let n = 0;
  walk(tree, tree.root, (node) => {
    if (kindOf(tree, node) === kind) n++;
  });
  return n;
}

function kindsOfChildren(tree: SyntaxTree, node: NodeId): string[] {
  return nodeChildren(tree, node).map((c) => kindName(kindOf(tree, c)));
}

Deno.test("Sink appends leftovers after its existing effect channels", () => {
  parseClean(
    "type S = Sink<int, int[], never, never, { rest: Option<int[]> }>",
  );
  parseClean("type S = Sink<int, int[], E, Service.call, int | string>");
  for (
    const [text, diagnostic] of [
      [
        "type S = Sink<int, int[], never, never, int, string>",
        "43-44 syntax/008 expected `>`, found `,`",
      ],
      [
        "type S = Stream<int, never, never, int>",
        "33-34 syntax/008 expected `>`, found `,`",
      ],
      [
        "type S = Sink<int, int[], never, never, >",
        "40-41 syntax/008 expected a type, found `>`",
      ],
    ] as const
  ) {
    assertEquals(parseChecked(text).diagnostics.map(show), [diagnostic], text);
  }
});

Deno.test("a newline continues an item before fails, with, =>, |>, else, and catch", () => {
  const cases: [string, string, SyntaxKind][] = [
    ["fails", "const f = (): int\n  fails E\n  => 1", SyntaxKind.FailsClause],
    ["with", "const f = (): int\n  with S.m\n  => 1", SyntaxKind.WithClause],
    ["=>", "const f = (): int\n  => 1", SyntaxKind.ArrowExpr],
    ["|>", "const f = xs\n  |> g", SyntaxKind.PipeExpr],
    ["else", "const f = if (a) { 1 }\n  else { 2 }", SyntaxKind.IfExpr],
    [
      "catch",
      "const f = try { 1 }\n  catch { E(e) => 2 }",
      SyntaxKind.CatchClause,
    ],
  ];
  for (const [name, text, kind] of cases) {
    const tree = parseClean(text);
    assertEquals(countKind(tree, kind), 1, name);
    assertEquals(declSummaries(tree).map((d) => d.kind), ["ConstDecl"], name);
  }
});

Deno.test("a newline ends an item before a binary operator and before a call", () => {
  const plus = parseChecked("const f = a\n+ b");
  assertEquals(plus.diagnostics.map(show), [
    "12-13 syntax/009 unexpected `+`; expected a declaration",
  ]);
  assertEquals(declSummaries(plus.tree)[0].kind, "ConstDecl");
  const call = parseClean("const f = (): int => {\n  a\n  (b)\n}");
  const block = findFirst(call, SyntaxKind.Block)!;
  assertEquals(kindsOfChildren(call, block), ["NameExpr", "ParenExpr"]);
});

Deno.test("a newline does not end an item after an operator, a comma, =, =>, :, (, [, or {", () => {
  parseClean("const f = 1 +\n  2");
  parseClean("const f = g(1,\n  2)");
  parseClean("const f =\n  1");
  parseClean("const f: \n  int = 1");
  parseClean("const f = (x:\n  int): int =>\n  x");
  parseClean("const f = g(\n  1\n)");
  parseClean("const f = {\n  a: 1\n}");
  parseClean("type T = [\n  int,\n  string\n]");
  parseClean("const f = a &&\n  b");
  parseClean("const f = a |>\n  g");
});

Deno.test("a semicolon separates declarations and block items", () => {
  const tree = parseClean(
    "const a = 1; const b = 2;\nconst c = (): int => { const x = 1; x }",
  );
  assertEquals(declSummaries(tree).map((d) => d.name), ["a", "b", "c"]);
});

Deno.test("operator precedence and left associativity", () => {
  const table: [string, string][] = [
    ["a + b * c", "(a + (b * c))"],
    ["a * b + c", "((a * b) + c)"],
    ["a - b - c", "((a - b) - c)"],
    ["a / b * c", "((a / b) * c)"],
    ["a + b % c", "(a + (b % c))"],
    ["a % b + c", "((a % b) + c)"],
    ["a % b * c", "((a % b) * c)"],
    ["a * b % c", "((a * b) % c)"],
    ["a - b % c - d", "((a - (b % c)) - d)"],
    ["a % b === c", "((a % b) === c)"],
    ["-a % b", "((-a) % b)"],
    ["a < b === c < d", "((a < b) === (c < d))"],
    ["a === b && c !== d || e", "(((a === b) && (c !== d)) || e)"],
    ["a || b && c", "(a || (b && c))"],
    ["a >= b + 1", "(a >= (b + 1))"],
    ["(a + b) * c", "((a + b) * c)"],
    ["a || b |> f", "((a || b) |> f)"],
    ["a + b |> f", "((a + b) |> f)"],
    ["a |> f |> g(1, 2)", "((a |> f) |> g(1, 2))"],
    ["a |> S.m", "(a |> S.m)"],
    ["a.b.c(1).d", "a.b.c(1).d"],
    ["f(a)(b)", "f(a)(b)"],
    ["f(a + 1, b * 2)", "f((a + 1), (b * 2))"],
  ];
  for (const [source, expected] of table) {
    const tree = parseClean(`const x = ${source}`);
    assertEquals(sexp(tree, constInitializer(tree, "x")), expected, source);
  }
});

Deno.test("a pipeline stage is a qualified name with optional arguments", () => {
  const tree = parseClean("const x = a |> f |> S.m(1)");
  assertEquals(countKind(tree, SyntaxKind.PipeStage), 2);
  assertEquals(countKind(tree, SyntaxKind.PipeExpr), 2);
});

Deno.test("bracket expressions parse as lossless lists, including trailing commas", () => {
  const tree = parseClean(
    'const a = [1, 2,]\nconst b = [1, [2, 3]]\nconst c: [int, string] = [1, "x"]\n',
  );
  assertEquals(countKind(tree, SyntaxKind.ListExpr), 4);
  assertEquals(
    kindsOfChildren(tree, constInitializer(tree, "a")),
    ["LiteralExpr", "LiteralExpr"],
  );
  const broken = parseChecked("const a = [1,, 2]\nconst b = [1\n");
  assertEquals(
    broken.diagnostics.map((d) => d.code),
    ["syntax/008", "syntax/008"],
  );
});

Deno.test("at an open parenthesis the parser chooses an arrow or a grouping", () => {
  const table: [string, SyntaxKind][] = [
    ["(a)", SyntaxKind.ParenExpr],
    ["((a))", SyntaxKind.ParenExpr],
    ["(a) => a", SyntaxKind.ArrowExpr],
    ["a => a", SyntaxKind.ArrowExpr],
    ["a\n => a", SyntaxKind.ArrowExpr],
    ["() => a", SyntaxKind.ArrowExpr],
    ["(a, b) => a", SyntaxKind.ArrowExpr],
    ["(a: int): int => a", SyntaxKind.ArrowExpr],
    ["(a)\n  => a", SyntaxKind.ArrowExpr],
    ["(a): int\n  fails E\n  => a", SyntaxKind.ArrowExpr],
    ["(a) + (b)", SyntaxKind.BinaryExpr],
    ["(a)(b)", SyntaxKind.CallExpr],
  ];
  for (const [source, kind] of table) {
    const tree = parseClean(`const x = ${source}`);
    assertEquals(
      kindName(kindOf(tree, constInitializer(tree, "x"))),
      kindName(kind),
      source,
    );
  }
});

Deno.test("a brace opens a block, a handler list, an arm list, or a record by context", () => {
  const block = parseClean("const f = (): int => { 1 }");
  assertEquals(countKind(block, SyntaxKind.Block), 1);
  assertEquals(countKind(block, SyntaxKind.RecordExpr), 0);

  const paren = parseClean("const f = (): R => ({ a: 1 })");
  assertEquals(countKind(paren, SyntaxKind.Block), 0);
  assertEquals(countKind(paren, SyntaxKind.RecordExpr), 1);

  const record = parseClean("const r = { a: 1 }");
  assertEquals(countKind(record, SyntaxKind.RecordExpr), 1);

  const match = parseClean("const m = match x { _ => 1 }");
  assertEquals(countKind(match, SyntaxKind.MatchExpr), 1);
  assertEquals(countKind(match, SyntaxKind.RecordExpr), 0);
  assertEquals(countKind(match, SyntaxKind.MatchArm), 1);

  const tried = parseClean("const t = try { 1 } catch { E(e) => 1 }");
  assertEquals(countKind(tried, SyntaxKind.Block), 1);
  assertEquals(countKind(tried, SyntaxKind.Handler), 1);

  const branch = parseClean("const i = if (c) { 1 } else { 2 }");
  assertEquals(countKind(branch, SyntaxKind.Block), 2);
  assertEquals(countKind(branch, SyntaxKind.RecordExpr), 0);
});

Deno.test("record expressions: leading spread, shorthand, trailing comma", () => {
  const tree = parseClean("const r = { ...base, a: 1, b, }");
  const record = findFirst(tree, SyntaxKind.RecordExpr)!;
  assertEquals(kindsOfChildren(tree, record), [
    "SpreadField",
    "RecordField",
    "ShorthandField",
  ]);
  const empty = parseClean("const r = {}");
  assertEquals(
    kindsOfChildren(empty, findFirst(empty, SyntaxKind.RecordExpr)!),
    [],
  );
});

Deno.test("patterns", () => {
  const tree = parseClean(
    'const m = match x { _ => 1, "s" => 2, 3 => 3, true => 4, Some(v) => 5, None => 6, ' +
      'E(e) => 7, { k: "a", ...r } => 8, { k: "b" } => 9 }',
  );
  const arms: string[] = [];
  walk(tree, tree.root, (node) => {
    if (kindOf(tree, node) === SyntaxKind.MatchArm) {
      arms.push(kindName(kindOf(tree, nodeChildren(tree, node)[0])));
    }
  });
  assertEquals(arms, [
    "WildcardPattern",
    "LiteralPattern",
    "LiteralPattern",
    "LiteralPattern",
    "CtorPattern",
    "NamePattern",
    "CtorPattern",
    "RecordPattern",
    "RecordPattern",
  ]);
});

Deno.test("nested patterns are syntax errors", () => {
  const result = parseChecked(
    "const m = match x { Some(Some(v)) => 1, None => 2 }",
  );
  assertEquals(result.diagnostics.map((d) => d.code), ["syntax/011"]);
  // The later arm still parses.
  assertEquals(countKind(result.tree, SyntaxKind.MatchArm), 2);
});

Deno.test("type forms", () => {
  const types = [
    "string",
    "Id",
    "Option<int>",
    "Ref<string>",
    "Option<Option<int>>",
    "int[]",
    "int[][]",
    "[int, string]",
    "{ a: int, b?: string, }",
    "{ a: { b: int } }",
    '"x" | "y"',
    "A | B | C",
    "(A | B)[]",
    "1 | true",
    "(x: int) => string",
    "() => int fails E with S.m",
    "(f: (x: int) => int, y: int) => int",
    "(x: int) => int[] fails E | F",
  ];
  for (const type of types) parseClean(`type T = ${type}`);
  const union = parseClean('type T = "a" | "b"');
  assertEquals(countKind(union, SyntaxKind.UnionType), 1);
  const optional = parseClean("type T = { a?: int }");
  assertEquals(countKind(optional, SyntaxKind.FieldType), 1);
  assertEquals(
    nodeText(optional, findFirst(optional, SyntaxKind.FieldType)!),
    "a?: int",
  );
});

Deno.test("a service method named fails or uses does not continue the previous method", () => {
  const tree = parseClean(
    "service S {\n  a(): int\n  fails(x: int): int\n  uses(): int\n}",
  );
  assertEquals(countKind(tree, SyntaxKind.ServiceMethod), 3);
  assertEquals(countKind(tree, SyntaxKind.FailsClause), 0);
  assertEquals(countKind(tree, SyntaxKind.WithClause), 0);
});

Deno.test("a service method clause on the next line continues the method", () => {
  const tree = parseClean(
    "service S {\n  a(): int\n    fails E | F\n  b(): int\n}",
  );
  assertEquals(countKind(tree, SyntaxKind.ServiceMethod), 2);
  assertEquals(countKind(tree, SyntaxKind.FailsClause), 1);
});

Deno.test("host interface files accept provider declarations", () => {
  const tree = parseClean(
    'import { Users } from "../users.eff"\nexport provider UsersLive provides Users\n',
    "effi",
  );
  assertEquals(declSummaries(tree).map((d) => d.kind), [
    "ImportDecl",
    "ProviderDecl",
  ]);
  const full = parseClean(
    "provider P provides A | B fails E with C.m",
    "effi",
  );
  assertEquals(countKind(full, SyntaxKind.ProvidesClause), 1);
  assertEquals(countKind(full, SyntaxKind.FailsClause), 1);
  assertEquals(countKind(full, SyntaxKind.WithClause), 1);
});

Deno.test("host interface files reject const, and source files reject provider", () => {
  const constResult = parseChecked("const a = (x: int): int => x", "effi");
  assertEquals(constResult.diagnostics.map((d) => d.code), ["syntax/012"]);
  const providerResult = parseChecked("provider P provides S", "eff");
  assertEquals(providerResult.diagnostics.map((d) => d.code), ["syntax/013"]);
});

Deno.test("fileModeOf follows the extension", () => {
  assertEquals(fileModeOf("host/providers.effi"), "effi");
  assertEquals(fileModeOf("users.eff"), "eff");
  assertEquals(fileModeOf("anything"), "eff");
  assertEquals(parse("a.effi", "provider P provides S").diagnostics, []);
});

Deno.test("void is valid as a type and reserved as a name", () => {
  parseClean("const f = (): void => 1");
  parseClean("service S { f(): void }");
  assertEquals(parseChecked("const void = 1").diagnostics.map((d) => d.code), [
    "syntax/007",
  ]);
  assertEquals(
    parseChecked("const f = (void: int): int => 1").diagnostics.map((d) =>
      d.code
    ),
    ["syntax/007"],
  );
  assertEquals(parseChecked("const f = void").diagnostics.map((d) => d.code), [
    "syntax/007",
  ]);
});

Deno.test("CRLF input gives the same tree as LF input", () => {
  const lf =
    "const a = (x: int): int\n  fails E\n  => {\n  x\n}\nconst b = a\n  |> f\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  const lfResult = parseChecked(lf);
  const crlfResult = parseChecked(crlf);
  assertEquals(crlfResult.diagnostics, []);
  assertEquals(declSummaries(crlfResult.tree), declSummaries(lfResult.tree));
  assertEquals(crlfResult.tree.count, lfResult.tree.count);
});

Deno.test("an error is a Missing node of zero width plus one diagnostic", () => {
  const result = parseChecked("const a = ");
  assertEquals(result.diagnostics.map((d) => d.code), ["syntax/008"]);
  const missing = findFirst(result.tree, SyntaxKind.Missing)!;
  assertEquals(result.tree.starts[missing], result.tree.ends[missing]);
  assertEquals(hasProblem(result.tree, result.tree.root), true);
});

Deno.test("an error span covers a token on the same line and ends a line when the token is on a later line", () => {
  const sameLine = parseChecked("const a = foo(1 2)");
  assertEquals(sameLine.diagnostics.map((d) => [d.span.start, d.span.end]), [[
    16,
    17,
  ]]);
  const laterLine = parseChecked("const a = 1 +\nconst b = 2");
  assertEquals(laterLine.diagnostics.map((d) => [d.span.start, d.span.end]), [[
    13,
    13,
  ]]);
});

Deno.test("diagnostic spans carry the source path", () => {
  const result = parse("dir/a.eff", "const a = )");
  assertEquals(
    result.diagnostics.map((d) => [d.span.source, d.code, d.message]),
    [["dir/a.eff", "syntax/008", "expected an expression, found `)`"]],
  );
});

Deno.test("odd inputs parse without throwing, print back exactly, and give a sound tree", () => {
  const inputs: readonly (readonly [text: string, diagnostics: string[]])[] = [
    ["", []],
    ["\n", []],
    ["a b c d", ["0-1 syntax/009 unexpected `a`; expected a declaration"]],
    ["=> => =>", ["0-2 syntax/009 unexpected `=>`; expected a declaration"]],
    ["|> |> |>", ["0-2 syntax/009 unexpected `|>`; expected a declaration"]],
    ["const a = 1 const b = 2", [
      "12-17 syntax/008 expected end of line or `;`, found `const`",
    ]],
    ["const a = 1\n\n\n\nconst b", [
      "22-22 syntax/008 expected `=`, found end of file",
    ]],
  ];
  for (const [text, diagnostics] of inputs) {
    assertEquals(
      parseChecked(text).diagnostics.map(show),
      diagnostics,
      JSON.stringify(text),
    );
  }
});

Deno.test("children of a node are contiguous and in source order", () => {
  const tree = parseClean("const a = f(1, { b: 2 })\ntype T = { x: int }");
  walk(tree, tree.root, (node) => {
    let cursor = tree.starts[node];
    for (const child of childrenOf(tree, node)) {
      assertEquals(
        tree.starts[child] >= cursor ||
          kindOf(tree, child) === SyntaxKind.Missing,
        true,
      );
      cursor = Math.max(cursor, tree.ends[child]);
    }
  });
});

Deno.test("nesting up to 100 levels parses; deeper input is reported and never overflows the stack", () => {
  parseClean("const a = " + "(".repeat(100) + "1" + ")".repeat(100));
  parseClean("type T = " + "Option<".repeat(100) + "int" + ">".repeat(100));
  for (
    const [prefix, open] of [
      ["const a = ", "("],
      ["const a = ", "f("],
      ["const a = ", "() => {"],
      ["const a = ", "-"],
      ["const a = ", "if (a) { 1 } else "],
      ["type T = ", "Option<"],
    ]
  ) {
    const result = parseChecked(prefix + open.repeat(10000));
    assertEquals(
      result.diagnostics.some((d) => d.message.includes("nesting is too deep")),
      true,
      open,
    );
  }
  // These openers cannot nest, so they only need to survive.
  for (
    const text of ["const a = [", "const a = {", "type T = {", "type T = ["]
  ) {
    parseChecked(text.repeat(10000));
  }
});

Deno.test("too deep a nesting does not hide the later declarations", () => {
  const text = "const x = " + "(".repeat(300) + "1" + ")".repeat(300) + "\n" +
    "const y = )\n" +
    "const z = 1\n";
  const result = parseChecked(text);
  assertEquals(
    result.diagnostics.map((d) => [d.code, d.span.start]),
    [["syntax/009", 266], ["syntax/008", text.indexOf("const y = )") + 10]],
  );
});

Deno.test("a type declares a type of any body, and sealed precedes type", () => {
  const tree = parseClean(
    "type Id = string\nexport type Row = { id: Id }\nsealed type Pair = [int, int]\n",
  );
  assertEquals(
    declSummaries(tree).map((d) => [d.kind, d.name]),
    [
      ["TypeDecl", "Id"],
      ["TypeDecl", "Row"],
      ["TypeDecl", "Pair"],
    ],
  );
});

Deno.test("nominal is an ordinary name and no declaration word", () => {
  const tree = parseClean(
    "const nominal = 1\nconst f = (nominal: int): int => nominal\n",
  );
  assertEquals(declSummaries(tree).map((d) => d.kind), [
    "ConstDecl",
    "ConstDecl",
  ]);
  assertEquals(
    parseChecked("nominal Row = { id: int }\n").diagnostics.map(show),
    [
      "0-7 syntax/009 unexpected `nominal`; expected a declaration",
    ],
  );
  assertEquals(
    parseChecked("sealed nominal Row = { id: int }\n").diagnostics.map(show),
    ["7-14 syntax/008 expected `type`, found `nominal`"],
  );
});

Deno.test("data is an ordinary name and no declaration word", () => {
  const tree = parseClean(
    "const data = 1\nconst f = (data: int): int => data\n",
  );
  assertEquals(declSummaries(tree).map((d) => d.kind), [
    "ConstDecl",
    "ConstDecl",
  ]);
  assertEquals(parseChecked("data Row = { id: int }\n").diagnostics.map(show), [
    "0-4 syntax/009 unexpected `data`; expected a declaration",
  ]);
});

Deno.test("unparen strips nested parenthesis expressions and keeps a malformed one", () => {
  const kindsAfterUnparen = (source: string): string => {
    const { tree } = parse("t.eff", source);
    const initializer = constInitializer(tree, "x");
    return kindName(kindOf(tree, unparen(tree, initializer)));
  };
  assertEquals(kindsAfterUnparen("const x = a\n"), "NameExpr");
  assertEquals(kindsAfterUnparen("const x = (a)\n"), "NameExpr");
  assertEquals(kindsAfterUnparen("const x = ((a))\n"), "NameExpr");
  assertEquals(kindsAfterUnparen("const x = (\n"), "ParenExpr");
});

Deno.test("a record literal arrow body gets one diagnostic and parses as a record", () => {
  const cases: ReadonlyArray<string> = [
    "const f = (): P => { a: 1, b: 2 }",
    "const f = (): P => {\n  a: 1,\n  b: 2\n}",
    "const f = (p: P): P => { ...p, a: 1 }",
    "const f = (): P => { a: 1 }",
    "const f = (x: int) => match (x) { _ => { a: 1 } }",
  ];
  for (const text of cases) {
    const result = parseChecked(text);
    assertEquals(result.diagnostics.map((d) => d.code), ["syntax/016"], text);
    assertEquals(countKind(result.tree, SyntaxKind.RecordExpr), 1, text);
    assertEquals(countKind(result.tree, SyntaxKind.Block), 0, text);
  }
});

Deno.test("the record body diagnostic starts at the opening brace", () => {
  const result = parseChecked("const f = (): P => { a: 1 }");
  assertEquals(
    result.diagnostics.map((d) => [d.code, d.span.start, d.span.end]),
    [["syntax/016", 19, 20]],
  );
});

Deno.test("a block arrow body without a record start parses as before", () => {
  const cases: ReadonlyArray<string> = [
    "const f = (a: int) => { a }",
    "const f = (a: int, b: int) => { a; b }",
    "const f = (a: int, b: int) => {\n  a\n  b\n}",
    "const f = () => {}",
    "const f = (): P => ({ a: 1, b: 2 })",
  ];
  for (const text of cases) {
    assertEquals(parseChecked(text).diagnostics, [], text);
  }
  const shorthand = parseChecked("const f = (a: int) => { a }");
  assertEquals(countKind(shorthand.tree, SyntaxKind.Block), 1);
  assertEquals(countKind(shorthand.tree, SyntaxKind.RecordExpr), 0);
  const empty = parseChecked("const f = () => {}");
  assertEquals(countKind(empty.tree, SyntaxKind.Block), 1);
});

Deno.test("a with clause parses after an arrow header, in a function type, and in a provider", () => {
  const arrow = parseClean("const f = (): int fails E with S.m => 1");
  assertEquals(countKind(arrow, SyntaxKind.FailsClause), 1);
  assertEquals(countKind(arrow, SyntaxKind.WithClause), 1);
  const functionType = parseClean(
    "type Callback = (id: Id) => string fails E with S.m | T",
  );
  assertEquals(countKind(functionType, SyntaxKind.FunctionType), 1);
  assertEquals(countKind(functionType, SyntaxKind.WithClause), 1);
  const provider = parseClean("provider P provides S with C.m", "effi");
  assertEquals(countKind(provider, SyntaxKind.WithClause), 1);
});

Deno.test("uses is an ordinary name and starts no clause", () => {
  const tree = parseClean("const uses = 1\nconst f = (): int => uses");
  assertEquals(countKind(tree, SyntaxKind.WithClause), 0);
});

Deno.test("with is a keyword, so a name position rejects it", () => {
  const result = parseChecked("const with = 1");
  assertEquals(result.diagnostics.map(show), [
    "6-10 syntax/008 expected a name, found `with`",
  ]);
});

Deno.test("a rejected with or finally keyword still forms the method node", () => {
  const withMethod = parseChecked("service S { with(): string }");
  assertEquals(withMethod.diagnostics.map(show), [
    "12-16 syntax/008 expected a name, found `with`",
  ]);
  assertEquals(
    nodeText(
      withMethod.tree,
      findFirst(withMethod.tree, SyntaxKind.ServiceMethod)!,
    ),
    "with(): string",
  );
  const finallyMethod = parseChecked("service S { finally(): string }");
  assertEquals(
    nodeText(
      finallyMethod.tree,
      findFirst(finallyMethod.tree, SyntaxKind.ServiceMethod)!,
    ),
    "finally(): string",
  );
});

Deno.test("unary operators bind tighter than `*` and looser than postfix forms", () => {
  const table: [string, string][] = [
    ["-a", "(-a)"],
    ["!a", "(!a)"],
    ["-a * b", "((-a) * b)"],
    ["-a.b", "(-a.b)"],
    ["-f(x)", "(-f(x))"],
    ["!a === b", "((!a) === b)"],
    ["!a && b", "((!a) && b)"],
    ["a - -b", "(a - (-b))"],
    ["- -x", "(-(-x))"],
    ["!!x", "(!(!x))"],
    ["-x |> f", "((-x) |> f)"],
    ["-(a + b)", "(-(a + b))"],
    ["a * -b + c", "((a * (-b)) + c)"],
    ["-\n  a", "(-a)"],
  ];
  for (const [source, expected] of table) {
    const tree = parseClean(`const x = ${source}`);
    assertEquals(sexp(tree, constInitializer(tree, "x")), expected, source);
    assertEquals(countKind(tree, SyntaxKind.UnaryExpr) > 0, true, source);
  }
});

Deno.test("a unary plus keeps syntax/010", () => {
  const result = parseChecked("const x = +1");
  assertEquals(result.diagnostics.map(show), [
    "10-11 syntax/010 unary operator `+` is not supported",
  ]);
});

Deno.test("a block item after the first cannot start with a unary minus", () => {
  const source =
    "const f = (): int => {\n  const total = price\n  - discount\n}";
  const result = parseChecked(source);
  assertEquals(result.diagnostics.map(show), [
    "47-48 syntax/010 a block item cannot start with `-`; put `-` at the end of the previous line, or write `(-x)`",
  ]);
  parseClean("const f = (): int => {\n  -x\n}");
  parseClean(
    "const f = (): int => {\n  const total = price -\n  discount\n  (-total)\n}",
  );
  parseClean("const f = (): int => {\n  const total = price\n  !flag\n}");
});

Deno.test("a pattern and a record pattern field accept a negative number literal", () => {
  const table: [string, number][] = [
    ["const f = (x: int): int => match x {\n  -1 => 1,\n  _ => 2\n}", 1],
    ["const f = (x: number): int => match x {\n  -1.5 => 1,\n  _ => 2\n}", 1],
    ["const f = (x: int): int => match x {\n  - 1 => 1,\n  _ => 2\n}", 1],
    ["const f = (s: Shape): int => match s {\n  { n: -1, ...r } => 1\n}", 1],
  ];
  for (const [source, count] of table) {
    const tree = parseClean(source);
    assertEquals(countKind(tree, SyntaxKind.LiteralPattern), count, source);
  }
});

Deno.test("a minus before a pattern that is not a number gives syntax/011", () => {
  const table: [string, string[]][] = [
    ["const f = (x: int): int => match x {\n  -5s => 1,\n  _ => 2\n}", [
      "40-42 syntax/011 a negative pattern must be a number literal, as in `-1` or `-1.5`",
    ]],
    ['const f = (x: int): int => match x {\n  -"a" => 1,\n  _ => 2\n}', [
      "40-43 syntax/011 a negative pattern must be a number literal, as in `-1` or `-1.5`",
    ]],
    ["const f = (x: int): int => match x {\n  -true => 1,\n  _ => 2\n}", [
      "40-44 syntax/011 a negative pattern must be a number literal, as in `-1` or `-1.5`",
    ]],
    ["const f = (x: int): int => match x {\n  -y => 1,\n  _ => 2\n}", [
      "40-41 syntax/011 a negative pattern must be a number literal, as in `-1` or `-1.5`",
    ]],
    [
      "const f = (s: Shape): int => match s {\n  { n: -5s, ...r } => 1\n}",
      [
        "47-49 syntax/011 a negative pattern must be a number literal, as in `-1` or `-1.5`",
      ],
    ],
  ];
  for (const [source, expected] of table) {
    assertEquals(parseChecked(source).diagnostics.map(show), expected, source);
  }
});
