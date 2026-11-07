// Tests that kill mutation survivors of the small core helpers: the effect
// set algebra, the path specifier, the identity parsers, and the syntax
// queries. Each case uses a literal input and a literal expected value.

import { assertEquals } from "@std/assert";
import type { CapabilityId, ErrorId } from "../src/core/ir.ts";
import { combine, type EffectSet, isQuiet } from "../src/core/effect_set.ts";
import {
  methodOfCapability,
  moduleOfId,
  nameOfId,
  serviceOfCapability,
} from "../src/core/ids.ts";
import { parse } from "../src/core/parse.ts";
import { relativeSpecifier } from "../src/core/paths.ts";
import {
  childrenOf,
  kindOf,
  type NodeId,
  nodeText,
  SyntaxKind,
  type SyntaxTree,
} from "../src/core/syntax.ts";
import {
  isArithmeticOperator,
  memberAccessParts,
} from "../src/core/syntax_queries.ts";
import type { TypeRef } from "../src/core/frontend.ts";
import { MAX_DEPTH, TypeTable } from "../src/core/types.ts";
import { findFirst } from "./helpers.ts";

const FAILURE: ErrorId = "error:m#Boom";
const CAPABILITY: CapabilityId = "cap:m#S.run";

function set(
  mode: "pure" | "effect",
  failures: readonly ErrorId[],
  requirements: readonly CapabilityId[],
): EffectSet {
  return { mode, failures, requirements };
}

Deno.test("combine marks a pure part with a failure as effect", () => {
  assertEquals(combine([set("pure", [FAILURE], [])]), {
    failures: [FAILURE],
    requirements: [],
    mode: "effect",
  });
});

Deno.test("combine marks a pure part with a requirement as effect", () => {
  assertEquals(combine([set("pure", [], [CAPABILITY])]), {
    failures: [],
    requirements: [CAPABILITY],
    mode: "effect",
  });
});

Deno.test("combine keeps an effect part with empty sets as effect", () => {
  assertEquals(combine([set("effect", [], [])]), {
    failures: [],
    requirements: [],
    mode: "effect",
  });
});

Deno.test("combine keeps pure parts with empty sets as pure", () => {
  assertEquals(combine([set("pure", [], []), set("pure", [], [])]), {
    failures: [],
    requirements: [],
    mode: "pure",
  });
});

Deno.test("isQuiet is true only for a pure set with no failure and no requirement", () => {
  assertEquals(isQuiet(set("pure", [], [])), true);
  assertEquals(isQuiet(set("effect", [], [])), false);
  assertEquals(isQuiet(set("pure", [FAILURE], [])), false);
  assertEquals(isQuiet(set("pure", [], [CAPABILITY])), false);
  assertEquals(isQuiet(set("effect", [FAILURE], [CAPABILITY])), false);
});

Deno.test("relativeSpecifier does not treat the target file name as a shared directory", () => {
  assertEquals(relativeSpecifier("a/b/c/x.ts", "a/b"), "../../b");
});

Deno.test("relativeSpecifier keeps the shared directories", () => {
  assertEquals(relativeSpecifier("a/b/x.ts", "a/b/y.ts"), "./y.ts");
  assertEquals(relativeSpecifier("a/b/x.ts", "a/c/y.ts"), "../c/y.ts");
  assertEquals(relativeSpecifier("x.ts", "a/y.ts"), "./a/y.ts");
});

Deno.test("moduleOfId returns the text between the colon and the hash", () => {
  assertEquals(moduleOfId("type:users#User"), "users");
  assertEquals(moduleOfId(":m#x"), "m");
});

Deno.test("moduleOfId returns undefined when the colon is missing or after the hash", () => {
  assertEquals(moduleOfId("foo#bar"), undefined);
  assertEquals(moduleOfId("a#b:c"), undefined);
  assertEquals(moduleOfId("type:users"), undefined);
});

Deno.test("nameOfId returns the text after the hash up to a dot", () => {
  assertEquals(nameOfId("type:users#User"), "User");
  assertEquals(nameOfId("cap:users#Users.find"), "Users");
  assertEquals(nameOfId("#Name"), "Name");
  assertEquals(nameOfId("type:users"), undefined);
  assertEquals(nameOfId("m#.x"), "");
});

Deno.test("methodOfCapability returns the text after the dot", () => {
  assertEquals(methodOfCapability("cap:users#Users.find"), "find");
  assertEquals(methodOfCapability("cap:users#Users"), undefined);
});

Deno.test("serviceOfCapability replaces the capability prefix with the service prefix", () => {
  assertEquals(
    serviceOfCapability("cap:users#Users.find"),
    "service:users#Users",
  );
  assertEquals(serviceOfCapability("cap:users#Users"), undefined);
  assertEquals(serviceOfCapability("cap:users.Users"), undefined);
});

Deno.test("isArithmeticOperator accepts the four arithmetic operators only", () => {
  assertEquals(isArithmeticOperator("+"), true);
  assertEquals(isArithmeticOperator("-"), true);
  assertEquals(isArithmeticOperator("*"), true);
  assertEquals(isArithmeticOperator("/"), true);
  assertEquals(isArithmeticOperator("<"), false);
  assertEquals(isArithmeticOperator("&&"), false);
  assertEquals(isArithmeticOperator(undefined), false);
});

Deno.test("memberAccessParts returns the base and the member of a field access", () => {
  const result = parse("t.eff", "const x = a.b\n", "eff");
  const node = findFirst(result.tree, SyntaxKind.FieldExpr);
  assertEquals(node === undefined, false);
  const parts = memberAccessParts(result.tree, node!);
  assertEquals(nodeText(result.tree, parts.base!), "a");
  assertEquals(nodeText(result.tree, parts.member!), "b");
});

/**
 * A chain of aliases `A0 .. A(n+1)`. Each alias before `An` is a union of the
 * next alias and `int`. `An` is a union of the next alias and `string?`. The
 * last alias is `int`. The union of `An` sits at union depth `n` from `A0`.
 */
function optionAtDepth(table: TypeTable, n: number): TypeRef {
  const id = (k: number) => `type:m#A${k}` as const;
  for (let k = 0; k <= n + 1; k++) {
    const target = k === n + 1 ? table.int : table.union([
      table.named(id(k + 1)),
      k === n ? table.option(table.string) : table.int,
    ]);
    table.defineAlias(id(k), target);
  }
  return table.named(id(0));
}

Deno.test("optionElementOf finds an option in a union at the last visited depth", () => {
  const table = new TypeTable();
  const root = optionAtDepth(table, MAX_DEPTH - 1);
  assertEquals(table.optionElementOf(root), table.string);
});

Deno.test("optionElementOf does not expand a union at the depth bound", () => {
  const table = new TypeTable();
  const root = optionAtDepth(table, MAX_DEPTH);
  assertEquals(table.optionElementOf(root), undefined);
});

/** Every FieldExpr node of a tree, in the pre-order that reverses child order. */
function fieldExprs(tree: SyntaxTree): NodeId[] {
  const found: NodeId[] = [];
  const stack = [tree.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (kindOf(tree, node) === SyntaxKind.FieldExpr) found.push(node);
    stack.push(...childrenOf(tree, node));
  }
  return found;
}

Deno.test("memberAccessParts returns no member when the only Name child is the base", () => {
  const result = parse("t.eff", "const v = a . ( .\n", "eff");
  const nodes = fieldExprs(result.tree);
  assertEquals(nodes.length, 2);
  const parts = memberAccessParts(result.tree, nodes[0]);
  assertEquals(nodeText(result.tree, parts.base!), "");
  assertEquals(parts.member, undefined);
});
