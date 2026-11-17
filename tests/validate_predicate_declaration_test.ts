// Each row forges the predicate of a refined type in lowered IR and requires
// the first diagnostic of the public entry `validateModule`. A row fails if its
// rejection in `checkRefinementDeclaration` is deleted.

import { assert, assertEquals } from "@std/assert";
import type { TypeDecl } from "../src/core/ir.ts";
import { validateModule } from "../src/core/validate/index.ts";
import { loweredModule } from "./helpers.ts";

const SOURCE = `
type Positive = int where n => n > 0
type Name = string where s => len(s) > 0
const value = (): Positive => Positive(1)
`;

/** The first diagnostic after `predicate` replaces the predicate of `typeName`. */
function firstDiagnostic(typeName: string, predicate: unknown): string {
  const ir = loweredModule(SOURCE);
  const declaration = ir.declarations.find((item): item is TypeDecl =>
    item.kind === "type" && item.name === typeName
  );
  assert(declaration !== undefined);
  Object.assign(declaration, { predicate });
  const found = validateModule(ir, new Map([["m.eff", SOURCE]]))[0];
  return `${found.code} ${found.message}`;
}

const zero = { kind: "zero" };
const difference = (left: unknown, right: unknown, maximum: string) => ({
  kind: "difference",
  left,
  right,
  maximum,
});
const against = (term: unknown) => difference(term, zero, "0");

function nested(levels: number): unknown {
  return Array.from({ length: levels }).reduce<unknown>(
    (operand) => ({ kind: "not", operand }),
    { kind: "constant", value: true },
  );
}

const ROWS: readonly (readonly [string, string, unknown, string])[] = [
  [
    "a predicate that is not an object",
    "Positive",
    5,
    "validation/002 declarations[0].predicate: a predicate is not an object",
  ],
  [
    "a nesting of 1537 levels",
    "Positive",
    nested(1537),
    "validation/002 declarations[0].predicate: predicate nesting exceeds 1536 levels",
  ],
  [
    "a constant predicate with a number",
    "Positive",
    { kind: "constant", value: 1 },
    "validation/002 declarations[0].predicate: a constant predicate needs a boolean value",
  ],
  [
    "a conjunction without a list",
    "Positive",
    { kind: "and", operands: 1 },
    "validation/002 declarations[0].predicate: a Boolean predicate needs an operand list",
  ],
  [
    "a disjunction with a bad operand",
    "Positive",
    { kind: "or", operands: [5] },
    "validation/002 declarations[0].predicate: a predicate is not an object",
  ],
  [
    "an unknown predicate kind",
    "Positive",
    { kind: "xor" },
    "validation/002 declarations[0].predicate: a predicate has an unknown kind",
  ],
  [
    "a maximum with a leading zero",
    "Positive",
    difference(zero, zero, "01"),
    "validation/002 declarations[0].predicate: a difference maximum must be a normalized integer",
  ],
  [
    "an empty maximum",
    "Positive",
    difference(zero, zero, ""),
    "validation/002 declarations[0].predicate: a difference maximum must be a normalized integer",
  ],
  [
    "a maximum with a letter",
    "Positive",
    difference(zero, zero, "1x"),
    "validation/002 declarations[0].predicate: a difference maximum must be a normalized integer",
  ],
  [
    "a term that is not an object",
    "Positive",
    against(null),
    "validation/002 declarations[0].predicate: a predicate term is not an object",
  ],
  [
    "an unknown term kind",
    "Positive",
    against({ kind: "bogus" }),
    "validation/002 declarations[0].predicate: a predicate term has an unknown kind",
  ],
  [
    "an input term over a string",
    "Name",
    against({ kind: "input" }),
    "validation/002 declarations[1].predicate: an input term must have type int",
  ],
  [
    "a term path with a number",
    "Positive",
    against({ kind: "field", path: [1] }),
    "validation/002 declarations[0].predicate: a predicate term path must be a string list",
  ],
  [
    "a field term without a path",
    "Positive",
    against({ kind: "field", path: [] }),
    "validation/002 declarations[0].predicate: a field term needs a field path",
  ],
  [
    "a length term in bytes",
    "Name",
    against({ kind: "length", path: [], unit: "bytes" }),
    "validation/002 declarations[1].predicate: a length term must use UTF-16 units",
  ],
  [
    "a length term over an int",
    "Positive",
    against({ kind: "length", path: [], unit: "utf16" }),
    "validation/002 declarations[0].predicate: a length term needs a string or array",
  ],
  [
    "a field term over an int",
    "Positive",
    against({ kind: "field", path: ["x"] }),
    "validation/002 declarations[0].predicate: the predicate path reaches non-record field x",
  ],
];

for (const [name, typeName, predicate, expected] of ROWS) {
  Deno.test(`validateModule rejects ${name} in a refinement declaration`, () => {
    assertEquals(firstDiagnostic(typeName, predicate), expected);
  });
}
