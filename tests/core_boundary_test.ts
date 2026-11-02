// Guard test for the rule "src/core does no I/O". The core library may not use
// Deno or global host APIs, and it may import only relative files. Without this
// test, a regression of the boundary shows up only when a consumer breaks.
//
// The test walks src/core with Deno.readDir, not with git, because the tests
// can run in an exported tree that has no .git directory.

import { assertEquals } from "@std/assert";

/** The forbidden names. Each pattern runs on code with comments and literals blanked. */
const FORBIDDEN: readonly (readonly [name: string, pattern: RegExp])[] = [
  ["Deno.", /\bDeno\./],
  ["console.", /\bconsole\./],
  ["Date.now", /\bDate\.now\b/],
  ["Math.random", /\bMath\.random\b/],
  ["performance.now", /\bperformance\.now\b/],
  ["setTimeout", /\bsetTimeout\b/],
  ["setInterval", /\bsetInterval\b/],
  ["fetch(", /(?<![.\w])fetch\s*\(/],
  ["globalThis", /\bglobalThis\b/],
];

/** A module specifier follows `from`, `import`, or `import(` and is a string literal. */
const SPECIFIER = /\b(?:from|import)\s*\(?\s*$/;

/** The characters after which a `/` starts a regular expression and not a division. */
const REGEX_PRECEDERS = "(,=:[!&|?{};+-*%<>~^";

interface Scan {
  /** The source with every comment and literal body replaced by spaces. Line breaks stay. */
  readonly code: string;
  /** Each string literal that follows `from`, `import`, or `import(`. */
  readonly specifiers: readonly string[];
}

/**
 * Splits TypeScript text into code and non-code. The scan is a small state
 * machine, not a parser. It blanks line comments, block comments, string
 * literals, template literal text, and regular expression literals, so a name
 * inside emitted code (the `.await` text of emit/explicit_scope.ts, for
 * example) is not a violation. Code inside `${...}` of a template stays code.
 * It records the string literals in import position, to check their specifiers.
 */
function scanCode(text: string): Scan {
  const out: string[] = [];
  const specifiers: string[] = [];
  // Each entry is the brace depth at which a template literal resumes.
  const templates: number[] = [];
  let braces = 0;
  let i = 0;
  const blank = (c: string) => (c === "\n" || c === "\r" ? c : " ");
  const lastCode = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k] !== " " && out[k] !== "\n" && out[k] !== "\r") return out[k];
    }
    return "";
  };
  const readTemplate = () => {
    // The caller consumed the opening backtick or the closing brace of `${}`.
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        out.push(" ", blank(text[i + 1] ?? ""));
        i += 2;
      } else if (c === "`") {
        out.push("`");
        i++;
        return;
      } else if (c === "$" && text[i + 1] === "{") {
        out.push("$", "{");
        i += 2;
        templates.push(braces);
        braces++;
        return;
      } else {
        out.push(blank(c));
        i++;
      }
    }
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") out.push(" "), i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (i < stop) out.push(blank(text[i])), i++;
    } else if (c === '"' || c === "'") {
      const start = i;
      // Only the tail matters, and a full join per literal would be quadratic.
      const before = out.slice(-40).join("");
      out.push(c);
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        if (text[i] === "\\") out.push(" "), i++;
        out.push(blank(text[i] ?? ""));
        i++;
      }
      if (text[i] === c) out.push(c), i++;
      if (SPECIFIER.test(before)) {
        specifiers.push(text.slice(start + 1, i - 1));
      }
    } else if (c === "`") {
      out.push("`");
      i++;
      readTemplate();
    } else if (
      c === "/" && (lastCode() === "" || REGEX_PRECEDERS.includes(lastCode()))
    ) {
      // A regular expression literal: read to the closing slash outside a class.
      out.push("/");
      i++;
      let inClass = false;
      while (i < text.length && text[i] !== "\n") {
        const r = text[i];
        if (r === "\\") out.push(" "), i++;
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        out.push(blank(text[i] ?? ""));
        i++;
      }
      if (text[i] === "/") out.push("/"), i++;
    } else {
      if (c === "{") braces++;
      if (c === "}") {
        braces--;
        if (
          templates.length > 0 && templates[templates.length - 1] === braces
        ) {
          templates.pop();
          out.push("}");
          i++;
          readTemplate();
          continue;
        }
      }
      out.push(c);
      i++;
    }
  }
  return { code: out.join(""), specifiers };
}

/** The violations of the boundary in one file, as readable lines. */
function violationsOf(path: string, text: string): string[] {
  const { code, specifiers } = scanCode(text);
  const found: string[] = [];
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    for (const [name, pattern] of FORBIDDEN) {
      if (pattern.test(line)) found.push(`${path}:${index + 1} uses ${name}`);
    }
  });
  for (const specifier of specifiers) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      found.push(`${path} imports non-relative "${specifier}"`);
    }
  }
  return found;
}

async function sourceFiles(directory: string, found: string[]): Promise<void> {
  for await (const entry of Deno.readDir(new URL(directory, ROOT))) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory) await sourceFiles(`${path}/`, found);
    else if (entry.isFile && path.endsWith(".ts")) found.push(path);
  }
}

const ROOT = new URL("../", import.meta.url);

Deno.test("src/core uses no host API, no global API, and no non-relative import", async () => {
  const files: string[] = [];
  await sourceFiles("src/core/", files);
  files.sort();
  // Guard against a walk that finds nothing and so proves nothing.
  assertEquals(files.length > 20, true, `only ${files.length} files`);
  const violations: string[] = [];
  for (const path of files) {
    const text = await Deno.readTextFile(new URL(path, ROOT));
    violations.push(...violationsOf(path, text));
  }
  assertEquals(violations, []);
});

Deno.test("the boundary scan reports each forbidden name and each non-relative import", () => {
  const names = [
    "Deno.readTextFile(p)",
    "console.log(1)",
    "Date.now()",
    "Math.random()",
    "performance.now()",
    "setTimeout(f, 1)",
    "setInterval(f, 1)",
    "fetch(url)",
    "globalThis.x",
  ];
  for (const name of names) {
    assertEquals(
      violationsOf("a.ts", `const x = ${name};`).length,
      1,
      name,
    );
  }
  for (
    const line of [
      'import { a } from "@std/assert";',
      'import "npm:left-pad";',
      'export { b } from "node:fs";',
      'const m = await import("jsr:@std/path");',
    ]
  ) {
    assertEquals(violationsOf("a.ts", line).length, 1, line);
  }
  assertEquals(
    violationsOf(
      "a.ts",
      'import { a } from "./a.ts";\nexport * from "../b.ts";',
    ),
    [],
  );
});

Deno.test("the boundary scan skips comments, string literals, templates, and regular expressions", () => {
  const text = [
    "// Deno.readTextFile is only named here",
    "/* console.log\n globalThis */",
    'const a = "Deno.x and fetch(y)";',
    "const b = 'it\\'s Date.now()';",
    "const c = `emits .await then Math.random() ${1 + 1} done`;",
    'const d = /"|setTimeout/g;',
    "const e = x.fetch(1) / 2 / 3;",
    "const f = 10 / 2; const g = 'ok';",
  ].join("\n");
  assertEquals(violationsOf("a.ts", text), []);
  // Code inside `${...}` still counts, even when it has braces of its own.
  const nested = "const h = `a ${ {k: 1}.k + Date.now() } b`;";
  assertEquals(violationsOf("a.ts", nested).length, 1);
  // A violation after a literal on the same line still counts.
  assertEquals(
    violationsOf("a.ts", 'const i = "x"; console.log(i);').length,
    1,
  );
});

Deno.test("the frontend and source queries cannot reach TypeScript output or host adapters", async () => {
  const visited = new Set<string>();
  async function visit(file: URL): Promise<void> {
    if (visited.has(file.href)) return;
    visited.add(file.href);
    assertEquals(
      /\/(?:emit|host)\/|\/typescript\.ts$/.test(file.pathname),
      false,
      file.pathname,
    );
    const { specifiers } = scanCode(await Deno.readTextFile(file));
    for (const specifier of specifiers) await visit(new URL(specifier, file));
  }
  await visit(new URL("src/core/frontend.ts", ROOT));
  assertEquals(visited.size > 30, true);
  const files: string[] = [];
  await sourceFiles("src/core/", files);
  for (const path of files.filter((p) => /\/editor[^/]*\.ts$/.test(p))) {
    for (
      const specifier of scanCode(await Deno.readTextFile(new URL(path, ROOT)))
        .specifiers
    ) {
      assertEquals(
        /emit\/|typescript\.ts|mod\.ts/.test(specifier),
        false,
        `${path}: ${specifier}`,
      );
    }
  }
});

Deno.test("host, CLI, LSP and playground adapters use public core entry points", async () => {
  const files: string[] = [];
  for (
    const directory of ["src/host/", "src/cli/", "src/lsp/", "playground/src/"]
  ) await sourceFiles(directory, files);
  let checked = 0;
  for (const path of files) {
    for (
      const specifier of scanCode(await Deno.readTextFile(new URL(path, ROOT)))
        .specifiers
    ) {
      if (!specifier.includes("core/")) continue;
      checked++;
      assertEquals(
        /core\/(?:frontend|typescript|mod)\.ts$/.test(specifier),
        true,
        `${path}: ${specifier}`,
      );
    }
  }
  assertEquals(checked > 20, true);
});

// Ratchet: a test imports a name from an entry point when an entry point exports
// it. Only a name that no entry point exports may come from a private module.

/** The modules whose imports are always allowed: the entry points and the three justified private ones. */
const ALLOWED_MODULES: ReadonlySet<string> = new Set([
  "frontend.ts",
  "typescript.ts",
  "mod.ts",
  "ir.ts",
  "validate/index.ts",
  "validate_project.ts",
]);

const NAME_START = "[A-Za-z_$][\\w$]*";

/** The exported name of one list item: drop `type `, and take the name after `as`. */
function listedName(item: string): string {
  const bare = item.trim().replace(/^type\s+/, "");
  const alias = bare.split(/\s+as\s+/);
  return (alias[alias.length - 1] ?? "").trim();
}

/** The names that one entry point file exports, in file order. */
function entryNamesOf(text: string): string[] {
  const names: string[] = [];
  const lists = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const match of text.matchAll(lists)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name = listedName(item);
      if (name !== "") names.push(name);
    }
  }
  const declarations = new RegExp(
    `^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|const|let|type|enum)\\s+(${NAME_START})`,
    "gm",
  );
  for (const match of text.matchAll(declarations)) names.push(match[1] ?? "");
  return names;
}

/** The imports in one file that take an entry-point name from a private core module. */
function privateImportsOf(
  path: string,
  text: string,
  entry: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const base = new URL(path, "file:///r/");
  const imports = /^import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)";/gm;
  for (const match of text.matchAll(imports)) {
    const specifier = match[2] ?? "";
    if (!specifier.startsWith(".")) continue;
    const resolved = new URL(specifier, base).pathname.slice("/r/".length);
    if (!resolved.startsWith("src/core/")) continue;
    const module = resolved.slice("src/core/".length);
    if (ALLOWED_MODULES.has(module)) continue;
    for (const item of (match[1] ?? "").split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]
        ?.trim() ?? "";
      if (entry.has(name)) found.push(`${path} imports ${name} from ${module}`);
    }
  }
  return found;
}

Deno.test("no test imports an entry-point name from a private core module", async () => {
  const entry = new Set<string>();
  for (const file of ["src/core/frontend.ts", "src/core/typescript.ts"]) {
    for (
      const name of entryNamesOf(
        await Deno.readTextFile(new URL(file, ROOT)),
      )
    ) entry.add(name);
  }
  // Guard against a scan that finds nothing and so proves nothing.
  assertEquals(entry.has("Program") && entry.has("TypeScriptOutputs"), true);
  const files: string[] = [];
  await sourceFiles("tests/", files);
  files.sort();
  assertEquals(files.length > 100, true, `only ${files.length} files`);
  const violations: string[] = [];
  for (const path of files) {
    const text = await Deno.readTextFile(new URL(path, ROOT));
    violations.push(...privateImportsOf(path, text, entry));
  }
  assertEquals(violations, []);
});

Deno.test("the private-import scan reports an entry name from a private module and no other import", () => {
  assertEquals(
    entryNamesOf([
      'export { Program, Revision as Rev } from "./db.ts";',
      'export type { A, B } from "./a.ts";',
      "export {",
      "  lex,",
      "  type Token as Tok,",
      '} from "./lex.ts";',
      "export type {",
      "  C,",
      '} from "./c.ts";',
      'export type * from "./ir.ts";',
      "export function f() {}",
      "export class K {}",
      "export interface I {}",
      "export type T = number;",
      "export const c = 1;",
    ].join("\n")),
    ["Program", "Rev", "A", "B", "lex", "Tok", "C", "f", "K", "I", "T", "c"],
  );
  const entry = new Set(["Program", "Revision", "Token", "lex"]);
  const scan = (path: string, text: string) =>
    privateImportsOf(path, text, entry);
  assertEquals(
    scan("tests/a_test.ts", 'import { Program } from "../src/core/db.ts";'),
    ["tests/a_test.ts imports Program from db.ts"],
  );
  assertEquals(
    scan(
      "tests/a_test.ts",
      'import { Revision as R } from "../src/core/db.ts";',
    ),
    ["tests/a_test.ts imports Revision from db.ts"],
  );
  assertEquals(
    scan(
      "tests/a_test.ts",
      'import { type Token, other } from "../src/core/lex.ts";',
    ),
    ["tests/a_test.ts imports Token from lex.ts"],
  );
  assertEquals(
    scan("tests/a_test.ts", 'import type { Token } from "../src/core/lex.ts";'),
    ["tests/a_test.ts imports Token from lex.ts"],
  );
  assertEquals(
    scan(
      "tests/a_test.ts",
      ["import {", "  other,", "  lex,", '} from "../src/core/lex.ts";'].join(
        "\n",
      ),
    ),
    ["tests/a_test.ts imports lex from lex.ts"],
  );
  assertEquals(
    scan(
      "tests/a_test.ts",
      'import { Program } from "../src/core/validate/typing.ts";',
    ),
    ["tests/a_test.ts imports Program from validate/typing.ts"],
  );
  assertEquals(
    scan(
      "tests/sub/a_test.ts",
      'import { lex } from "../../src/core/source.ts";',
    ),
    ["tests/sub/a_test.ts imports lex from source.ts"],
  );
  assertEquals(
    scan(
      "tests/a_test.ts",
      [
        'import { other } from "../src/core/lex.ts";',
        'import { Program } from "../src/core/frontend.ts";',
        'import { lex } from "../src/core/typescript.ts";',
        'import { Program as P } from "../src/core/mod.ts";',
        'import type { Program } from "../src/core/ir.ts";',
        'import { Program } from "../src/core/validate/index.ts";',
        'import { Program } from "../scripts/x.ts";',
        'import { Program } from "@std/assert";',
      ].join("\n"),
    ),
    [],
  );
});
