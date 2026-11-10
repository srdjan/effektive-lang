// The validator accepts exactly the instance types of `div` and the rounding
// builtins: `div` is `(int, int) => int`, a rounding builtin is
// `(number) => int`, and each is pure with empty effect sets. Each row forges
// the type of one prelude import value in a lowered program, and requires the
// exact diagnostics of `validateModule`.

import { assert, assertEquals } from "@std/assert";
import type { ModuleIR, Type } from "../src/core/ir.ts";
import { forgedModule, loweredModule } from "./helpers.ts";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

/** A program that calls only `name`, so that a forged type has few echoes. */
function sourceOf(name: string): string {
  const call = name === "div" ? "div(a, b)" : `${name}(x)`;
  return `type Int = int
type Num = number
type Cents = int
export const f = (a: Int, b: Int, x: Num): Int => ${call}
`;
}

const INT: Type = { kind: "primitive", name: "int" };
const NUMBER: Type = { kind: "primitive", name: "number" };
const CENTS: Type = { kind: "named", id: "type:m#Cents" };

/** The function type of the prelude import value of `name`. */
function instance(ir: ModuleIR, name: string): Mutable<
  Extract<Type, { kind: "function" }>
> {
  const imp = (ir as Mutable<ModuleIR>).imports.find((i) =>
    i.module === "effektive:prelude"
  );
  const value = imp?.values.find((v) => v.name.startsWith(`$builtin/${name}/`));
  assert(value !== undefined, name);
  assert(value.type.kind === "function", name);
  return value.type;
}

function forged(
  name: string,
  change: (type: Mutable<Extract<Type, { kind: "function" }>>) => void,
): string[] {
  return forgedModule(sourceOf(name), (ir) => change(instance(ir, name)));
}

Deno.test("the lowered program of each builtin is valid, and its instances have the exact types", () => {
  assertEquals(
    ["div", "trunc", "floor", "round", "ceil"].map((name) => {
      const type = instance(loweredModule(sourceOf(name)), name);
      return [type.parameters.length, type.result, type.execution];
    }),
    [
      [2, INT, "pure"],
      [1, INT, "pure"],
      [1, INT, "pure"],
      [1, INT, "pure"],
      [1, INT, "pure"],
    ],
  );
});

Deno.test("div with a wrong parameter count is rejected", () => {
  assertEquals(
    forged("div", (type) => {
      type.parameters = [INT];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin div takes 2 int parameters",
      "validation/002 declarations[3].body.arguments: the function takes 1 arguments, the call has 2",
    ],
  );
});

Deno.test("div with a number parameter is rejected", () => {
  assertEquals(
    forged("div", (type) => {
      type.parameters = [INT, NUMBER];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin div takes 2 int parameters",
    ],
  );
});

Deno.test("a rounding builtin with an int parameter is rejected", () => {
  assertEquals(
    forged("round", (type) => {
      type.parameters = [INT];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin round takes 1 number parameter",
      "validation/002 declarations[3].body.arguments[0]: the argument has type type:m#Num, which does not fit the parameter int",
    ],
  );
});

Deno.test("a rounding builtin with an identity parameter is rejected", () => {
  assertEquals(
    forged("trunc", (type) => {
      type.parameters = [CENTS];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin trunc takes 1 number parameter",
      "validation/002 declarations[3].body.arguments[0]: the argument has type type:m#Num, which does not fit the parameter type:m#Cents",
    ],
  );
});

Deno.test("a rounding builtin with a number result is rejected", () => {
  assertEquals(
    forged("floor", (type) => {
      type.result = NUMBER;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin floor returns an int",
      "validation/002 declarations[3].body.type: expected number, recorded int",
      "validation/002 declarations[3].body: the body type number does not fit the declared result type:m#Int",
    ],
  );
});

Deno.test("an effectful instance of a rounding builtin is rejected", () => {
  assertEquals(
    forged("ceil", (type) => {
      type.execution = "effect";
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin ceil is pure, with no failure and no requirement",
      "validation/004 declarations[3].type.execution: expected effect, recorded pure",
      "validation/004 declarations[3].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("an instance with a failure is rejected", () => {
  assertEquals(
    forged("div", (type) => {
      type.effects = { failures: ["error:m#Boom"], requirements: [] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.failures[0]: the failure error:m#Boom is not a declared error",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin div is pure, with no failure and no requirement",
      "validation/003 declarations[3].type.effects.failures: an inferred contract equals the body: expected [error:m#Boom], recorded []",
      "validation/004 declarations[3].type.execution: expected effect, recorded pure",
      "validation/001 declarations[3].body.callee.type.effects.failures[0]: the failure error:m#Boom is not a declared error",
      "validation/002 declarations[3].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[3].body.effects.failures: expected [error:m#Boom], recorded []",
      "validation/004 declarations[3].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("an instance with a requirement is rejected", () => {
  assertEquals(
    forged("round", (type) => {
      type.effects = { failures: [], requirements: ["cap:m#Clock.now"] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin round is pure, with no failure and no requirement",
      "validation/004 declarations[3].type.execution: expected effect, recorded pure",
      "validation/001 declarations[3].body.callee.type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 declarations[3].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[3].body.effects.requirements: expected [cap:m#Clock.now], recorded []",
      "validation/003 declarations[3].body: the body requires [cap:m#Clock.now], which the declared requirements [] do not list",
      "validation/004 declarations[3].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("a Duration argument of a data builtin is rejected, as the checker rejects it", () => {
  const source = `type Num = number
type Int = int
export const f = (d: Duration, x: Num): Int => round(x)
`;
  assertEquals(
    forgedModule(source, (ir) => {
      const f = (ir as Mutable<ModuleIR>).declarations.find((d) =>
        d.kind === "function"
      );
      assert(f?.kind === "function" && f.body.kind === "call");
      const argument = f.body.arguments[0];
      assert(argument.kind === "reference");
      argument.target = "local:m#f/d";
      argument.type = { kind: "named", id: "type:effect/Duration" };
    }),
    [
      "validation/002 declarations[2].body.arguments[0]: round does not take a closed unit argument of type Duration",
    ],
  );
});
