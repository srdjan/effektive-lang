// Tests for `RefinementChecker` sites that the checker reaches only through
// its own facts: a constant fact at the end of a scope, and a `not` predicate
// of a refinement. Source text cannot write the second one, because a
// refinement rejects `!` (declaration/018), so the test builds the type table.

import { assert, assertEquals } from "@std/assert";
import {
  newProofBudget,
  RefinementChecker,
} from "../src/core/check_refinements.ts";
import type { TypeId } from "../src/core/ir.ts";
import { parse } from "../src/core/parse.ts";
import { type NodeId, SyntaxKind } from "../src/core/syntax.ts";
import { childrenOf, kindOf } from "../src/core/syntax.ts";
import { TypeTable } from "../src/core/types.ts";
import type { Predicate } from "../src/core/predicates.ts";
import { checkModule } from "./helpers.ts";

function literalNode(text: string) {
  const parsed = parse("m.eff", text, undefined);
  assertEquals(parsed.diagnostics, []);
  const tree = parsed.tree;
  function find(node: NodeId): NodeId | undefined {
    if (kindOf(tree, node) === SyntaxKind.LiteralExpr) return node;
    for (const child of childrenOf(tree, node)) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const node = find(tree.root);
  assert(node !== undefined);
  return { tree, node };
}

const FALSE: Predicate = { kind: "constant", value: false };

Deno.test("a constant fact stays after a scope that holds no local", () => {
  const { tree } = literalNode("const x = 0\n");
  const checker = RefinementChecker(
    tree,
    TypeTable(),
    "m",
    new Map(),
    newProofBudget(),
  );
  const scope = checker.snapshot();
  checker.addBranch(FALSE);
  checker.leaveScope(scope);
  assertEquals(checker.snapshot().branches, [FALSE]);
});

Deno.test("a not predicate of a refinement substitutes its operand", () => {
  const { tree, node } = literalNode("const x = 0\n");
  const id = "type:m#NotPositive" as TypeId;
  const positive: Predicate = {
    kind: "difference",
    left: { kind: "zero" },
    right: { kind: "field", path: [] },
    maximum: "-1",
  };
  const table = TypeTable().defineIdentity(
    id,
    TypeTable().int,
    false,
    false,
    { kind: "not", operand: positive },
  );
  const checker = RefinementChecker(
    tree,
    table,
    "m",
    new Map(),
    newProofBudget(),
  );
  assertEquals(checker.proveIdentity(node, id).status, "proved");
});

Deno.test("a not-equal condition proves a refinement that excludes the value", () => {
  const project = checkModule(`type Int = int
type NonZero = int where n => n !== 0
const guarded = (n: Int): NonZero => if (n !== 0) { NonZero(n) } else { NonZero(1) }
`);
  assertEquals(project.diagnostics, []);
});
