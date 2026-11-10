// The validator does not trust the checker: a `bind` pattern needs a subject with a
// null member, an earlier `null` arm, and a binding of the type without `null`.

import { assertEquals } from "@std/assert";
import type { ModuleIR } from "../src/core/ir.ts";
import { allExprs, forgedModule } from "./helpers.ts";

const SOURCE = `type Int = int
type Mode = "a" | "b" | null
type ModeOrInt = Mode | Int
type MaybeInt = Int | null
type Both = Mode | Int | null
export const f = (x: MaybeInt): Int =>
  match x {
    null => 0,
    n => n + 1
  }
`;

Deno.test("a bind arm before the null arm is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      (allExprs(ir, "match")[0] as unknown as { arms: unknown[] }).arms
        .reverse();
    }),
    [
      "validation/002 declarations[5].body.arms[0].pattern: a binding arm needs an earlier arm with the pattern null; the subject has type type:m#MaybeInt",
    ],
  );
});

Deno.test("a bind arm with the binding type of the whole subject is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const match = allExprs(ir, "match")[0];
      const pattern = match.arms[1].pattern;
      if (pattern.kind === "bind") {
        (pattern.binding as { type: unknown }).type = match.subject.type;
      }
    }),
    [
      "validation/002 declarations[5].body.arms[1].pattern.binding.type: expected type:m#Int, recorded type:m#MaybeInt",
      "validation/002 declarations[5].body.arms[1].body.left.type: expected type:m#MaybeInt, recorded type:m#Int",
      "validation/002 declarations[5].body.arms[1].body: the operator + does not accept operands of type type:m#MaybeInt and int",
    ],
  );
});

function forgeSubject(id: string): (ir: ModuleIR) => void {
  return (ir) => {
    const type = { kind: "named", id };
    const match = allExprs(ir, "match")[0];
    (match.subject as unknown as { type: unknown }).type = type;
    const [f] = ir.declarations.filter((d) => d.kind === "function");
    (f.parameters[0] as unknown as { type: unknown }).type = type;
  };
}

Deno.test("a bind arm on a subject without a null member is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, forgeSubject("type:m#ModeOrInt")),
    [
      "validation/002 declarations[5].type.parameters[0]: expected type:m#ModeOrInt, recorded type:m#MaybeInt",
      "validation/002 declarations[5].body.arms[1].pattern: a binding arm needs a subject with a null member; the subject has type type:m#ModeOrInt",
    ],
  );
});

Deno.test("a bind arm on a subject with a null that another member hides is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, forgeSubject("type:m#Both")),
    [
      "validation/002 declarations[5].type.parameters[0]: expected type:m#Both, recorded type:m#MaybeInt",
      "validation/002 declarations[5].body.arms[1].pattern: a binding arm needs a subject in which no other member hides a null; the subject has type type:m#Both",
    ],
  );
});

Deno.test("a bind arm after a literal arm other than null is rejected", () => {
  assertEquals(
    forgedModule(SOURCE, (ir) => {
      const pattern = allExprs(ir, "match")[0].arms[0].pattern;
      (pattern as unknown as { value: unknown }).value = 1;
    }),
    [
      "validation/002 declarations[5].body.arms[1].pattern: a binding arm needs an earlier arm with the pattern null; the subject has type type:m#MaybeInt",
    ],
  );
});

Deno.test("a bind arm on a union with a non-null literal member is rejected", () => {
  assertEquals(
    forgedModule(
      SOURCE.replace("type Both", 'type IntOrA = Int | "a"\ntype Both'),
      forgeSubject("type:m#IntOrA"),
    ),
    [
      "validation/002 declarations[6].type.parameters[0]: expected type:m#IntOrA, recorded type:m#MaybeInt",
      "validation/002 declarations[6].body.arms[0].pattern: the literal null does not belong to the subject of type type:m#IntOrA",
      "validation/002 declarations[6].body.arms[1].pattern: a binding arm needs a subject with a null member; the subject has type type:m#IntOrA",
    ],
  );
});
