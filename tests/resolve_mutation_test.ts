// Tests that kill mutation survivors of src/core/resolve.ts.

import { assert, assertEquals } from "@std/assert";
import { type Analysis, analyzeProject } from "../src/core/analyze.ts";
import { memoryHost } from "../src/core/frontend.ts";
import {
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  walk,
} from "../src/core/syntax.ts";
import { targetText } from "../src/core/resolve.ts";

function analyzeText(files: Record<string, string>): Analysis {
  const result = analyzeProject(
    memoryHost({ "effektive.json": "{}", ...files }),
    "",
    ["m.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function single(text: string): Analysis {
  return analyzeText({
    "m.eff": `type Int = int\nservice First { one(): Int }\n${text}`,
  });
}

function messages(analysis: Analysis): string[] {
  return analysis.diagnostics.map((d) => `${d.code} ${d.message}`);
}

/** The target text of every NameExpr whose text equals `text`, in source order. */
function nameExprTargets(analysis: Analysis, text: string): string[] {
  const tree = analysis.project.modules.get("m")!.tree;
  const table = analysis.resolutions.get("m")!.targets;
  const found: NodeId[] = [];
  walk(tree, tree.root, (n) => {
    if (kindOf(tree, n) === SyntaxKind.NameExpr && nodeText(tree, n) === text) {
      found.push(n);
    }
  });
  return found.map((n) => {
    const target = table.get(n);
    return target === undefined ? "none" : targetText(target);
  });
}

Deno.test("a service name passed to a user function is a value error", () => {
  const analysis = single(
    "const f = (x: Int): Int => x\nconst a = f(First)\n",
  );
  assertEquals(messages(analysis), [
    "unknown-name/004 `First` is a service, not a value",
  ]);
  assertEquals(nameExprTargets(analysis, "First"), ["unresolved:First"]);
});

Deno.test("a service name passed to a method call is a value error", () => {
  const analysis = single(
    "const f = (x: Int): Int => x\nconst a = f.g(First)\n",
  );
  assertEquals(messages(analysis), [
    "unknown-name/004 `First` is a service, not a value",
  ]);
});

Deno.test("a service name as the first argument of layer resolves to the service", () => {
  const analysis = single("const a = layer(First, () => ({ one: () => 1 }))\n");
  assertEquals(messages(analysis), []);
  assertEquals(nameExprTargets(analysis, "First"), ["service:m#First"]);
});

Deno.test("a non-name first argument of layer still resolves its names", () => {
  const analysis = single(
    "const a = layer(nope.x, () => ({ one: () => 1 }))\n",
  );
  assertEquals(messages(analysis), ["unknown-name/001 unknown name `nope`"]);
});

Deno.test("a service member access without a method name reports only the syntax error", () => {
  const analysis = single("const a = First.\n");
  assertEquals(messages(analysis), [
    "syntax/008 expected a name, found end of line",
  ]);
});

Deno.test("provides with a method name checks the method", () => {
  const analysis = analyzeText({
    "effektive.json":
      '{"host": {"h": {"interface": "./h.effi", "module": "./h.ts"}}}',
    "m.eff": 'import { P } from "host:h"\nconst x = (): int => 1\n',
    "h.effi":
      'import { S } from "./s.eff"\nexport provider P provides S | S.nope\n',
    "s.eff": "export service S { get(): int }\n",
  });
  assertEquals(messages(analysis), [
    "declaration/003 a provider provides whole services; a method name is not allowed here",
    "unknown-name/003 service `S` has no method named `nope`",
  ]);
});

Deno.test("a constructor pattern with no binding name adds no stray target", () => {
  const analysis = single(
    "const f = (x: Option<Int>): Int =>\n  match x {\n    Some() => 1\n    None => 2\n  }\n",
  );
  assertEquals(messages(analysis), [
    "syntax/008 expected a name, found `)`",
    "syntax/008 expected `,`, found `None`",
  ]);
  const locals = [...analysis.resolutions.get("m")!.targets.values()].filter((
    t,
  ) => t.kind === "local");
  assertEquals(locals.map(targetText), ["local:m#f/x", "local:m#f/x"]);
});
