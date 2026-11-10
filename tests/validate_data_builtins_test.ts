// The validator accepts exactly the instance types of `div`, the rounding
// builtins, `text`, and `len`: `div` is `(int, int) => int`, a rounding builtin
// is `(number) => int`, `text` is `(number) => string` or `(boolean) => string`,
// `len` is `(string) => int` or `(E[]) => int`, and each is pure with empty
// effect sets. Each row forges
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

Deno.test("a Duration argument of div is rejected", () => {
  const source = `type Int = int
export const f = (d: Duration, a: Int, b: Int): Int => div(a, b)
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
      "validation/002 declarations[1].body.arguments[0]: div does not take a closed unit argument of type Duration",
    ],
  );
});

const STRING: Type = { kind: "primitive", name: "string" };
const BOOLEAN: Type = { kind: "primitive", name: "boolean" };
const INTS: Type = { kind: "array", element: INT };

const TEXT_SOURCE = `type Int = int
type Text = string
export const f = (n: Int): Text => text(n)
`;
const LEN_SOURCE = `type Int = int
type Text = string
export const f = (s: Text): Int => len(s)
`;
const LEN_ARRAY_SOURCE = `type Int = int
type Ints = int[]
export const f = (xs: Ints): Int => len(xs)
`;

function forgedBuiltin(
  source: string,
  name: string,
  change: (type: Mutable<Extract<Type, { kind: "function" }>>) => void,
): string[] {
  return forgedModule(source, (ir) => change(instance(ir, name)));
}

Deno.test("the lowered text and len programs are valid, and their instances have the exact types", () => {
  const types = (source: string, name: string): unknown[] => {
    const type = instance(loweredModule(source), name);
    return [type.parameters, type.result, type.execution];
  };
  assertEquals(types(TEXT_SOURCE, "text"), [[NUMBER], STRING, "pure"]);
  assertEquals(
    types(
      `type Flag = boolean
type Text = string
export const f = (b: Flag): Text => text(b)
`,
      "text",
    ),
    [[BOOLEAN], STRING, "pure"],
  );
  assertEquals(types(LEN_SOURCE, "len"), [[STRING], INT, "pure"]);
  assertEquals(types(LEN_ARRAY_SOURCE, "len"), [[INTS], INT, "pure"]);
});

Deno.test("text with a wrong parameter count is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.parameters = [NUMBER, NUMBER];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin text takes 1 number or boolean parameter",
      "validation/002 declarations[2].body.arguments: the function takes 2 arguments, the call has 1",
    ],
  );
});

Deno.test("text with an int parameter is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.parameters = [INT];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin text takes 1 number or boolean parameter",
    ],
  );
});

Deno.test("text with a string parameter is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.parameters = [STRING];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin text takes 1 number or boolean parameter",
      "validation/002 declarations[2].body.arguments[0]: the argument has type type:m#Int, which does not fit the parameter string",
    ],
  );
});

Deno.test("text with an int result is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.result = INT;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin text returns a string",
      "validation/002 declarations[2].body.type: expected int, recorded string",
      "validation/002 declarations[2].body: the body type int does not fit the declared result type:m#Text",
    ],
  );
});

Deno.test("an effectful instance of text is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.execution = "effect";
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin text is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("an instance of text with a failure is rejected", () => {
  assertEquals(
    forgedBuiltin(TEXT_SOURCE, "text", (type) => {
      type.effects = { failures: ["error:m#Boom"], requirements: [] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.failures[0]: the failure error:m#Boom is not a declared error",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin text is pure, with no failure and no requirement",
      "validation/003 declarations[2].type.effects.failures: an inferred contract equals the body: expected [error:m#Boom], recorded []",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/001 declarations[2].body.callee.type.effects.failures[0]: the failure error:m#Boom is not a declared error",
      "validation/002 declarations[2].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[2].body.effects.failures: expected [error:m#Boom], recorded []",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("len with a wrong parameter count is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_SOURCE, "len", (type) => {
      type.parameters = [STRING, STRING];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin len takes 1 string or array parameter",
      "validation/002 declarations[2].body.arguments: the function takes 2 arguments, the call has 1",
    ],
  );
});

Deno.test("len with a number parameter is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_SOURCE, "len", (type) => {
      type.parameters = [NUMBER];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin len takes 1 string or array parameter",
      "validation/002 declarations[2].body.arguments[0]: the argument has type type:m#Text, which does not fit the parameter number",
    ],
  );
});

Deno.test("len with a tuple parameter is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_SOURCE, "len", (type) => {
      type.parameters = [{ kind: "tuple", elements: [INT, INT] }];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin len takes 1 string or array parameter",
      "validation/002 declarations[2].body.arguments[0]: the argument has type type:m#Text, which does not fit the parameter [int, int]",
    ],
  );
});

Deno.test("len with a number result is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_ARRAY_SOURCE, "len", (type) => {
      type.result = NUMBER;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin len returns an int",
      "validation/002 declarations[2].body.type: expected number, recorded int",
      "validation/002 declarations[2].body: the body type number does not fit the declared result type:m#Int",
    ],
  );
});

Deno.test("an effectful instance of len is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_SOURCE, "len", (type) => {
      type.execution = "effect";
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin len is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("an instance of len with a requirement is rejected", () => {
  assertEquals(
    forgedBuiltin(LEN_SOURCE, "len", (type) => {
      type.effects = { failures: [], requirements: ["cap:m#Clock.now"] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin len is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/001 declarations[2].body.callee.type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 declarations[2].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[2].body.effects.requirements: expected [cap:m#Clock.now], recorded []",
      "validation/003 declarations[2].body: the body requires [cap:m#Clock.now], which the declared requirements [] do not list",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("a Duration argument of text is rejected, as the checker rejects it", () => {
  const source = `type Int = int
type Text = string
export const f = (d: Duration, n: Int): Text => text(n)
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
      "validation/002 declarations[2].body.arguments[0]: text does not take a closed unit argument of type Duration",
    ],
  );
});

const AT_SOURCE = `type Int = int
type Ints = int[]
export const f = (xs: Ints, i: Int): Option<Int> => at(xs, i)
`;

Deno.test("the lowered at program is valid, and its instance has the exact type", () => {
  const type = instance(loweredModule(AT_SOURCE), "at");
  assertEquals(
    [type.parameters, type.result, type.execution],
    [[INTS, INT], { kind: "option", element: INT }, "pure"],
  );
});

Deno.test("an at instance with a wrong type is rejected", () => {
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.parameters[1] = NUMBER;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin at takes an array and an int parameter",
    ],
  );
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.result = { kind: "option", element: NUMBER };
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin at returns an option of the element",
      "validation/002 declarations[2].body.type: expected Option<number>, recorded Option<int>",
      "validation/002 declarations[2].body: the body type Option<number> does not fit the declared result Option<type:m#Int>",
    ],
  );
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.execution = "effect";
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin at is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

Deno.test("a Duration index of at is rejected, as the checker rejects it", () => {
  const source = `type Int = int
type Ints = int[]
export const f = (xs: Ints, d: Duration, i: Int): Option<Int> => at(xs, i)
`;
  assertEquals(
    forgedModule(source, (ir) => {
      const f = (ir as Mutable<ModuleIR>).declarations.find((d) =>
        d.kind === "function"
      );
      assert(f?.kind === "function" && f.body.kind === "call");
      const argument = f.body.arguments[1];
      assert(argument.kind === "reference");
      argument.target = "local:m#f/d";
      argument.type = { kind: "named", id: "type:effect/Duration" };
    }),
    [
      "validation/002 declarations[2].body.arguments[1]: at does not take a closed unit argument of type Duration",
    ],
  );
});

Deno.test("an at instance with a number array parameter or an int result is rejected", () => {
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.parameters[0] = NUMBER;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin at returns an option of the element",
      "validation/002 imports[0].values[0].type: the builtin at takes an array and an int parameter",
      "validation/002 declarations[2].body.arguments[0]: the argument has type type:m#Ints, which does not fit the parameter number",
    ],
  );
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.result = INT;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin at returns an option of the element",
      "validation/002 declarations[2].body.type: expected int, recorded Option<int>",
      "validation/002 declarations[2].body: the body type int does not fit the declared result Option<type:m#Int>",
    ],
  );
});

Deno.test("an instance of at with a requirement is rejected", () => {
  assertEquals(
    forgedBuiltin(AT_SOURCE, "at", (type) => {
      type.effects = { failures: [], requirements: ["cap:m#Clock.now"] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin at is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/001 declarations[2].body.callee.type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 declarations[2].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[2].body.effects.requirements: expected [cap:m#Clock.now], recorded []",
      "validation/003 declarations[2].body: the body requires [cap:m#Clock.now], which the declared requirements [] do not list",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

const CONCAT_SOURCE = `type Int = int
type Ints = int[]
export const f = (xs: Ints, x: Int): Ints => [...xs, x]
`;

Deno.test("the lowered spread program is valid, and its concat instance has the exact type", () => {
  const type = instance(loweredModule(CONCAT_SOURCE), "concat");
  assertEquals(
    [type.parameters, type.result, type.execution],
    [[INTS, INTS], INTS, "pure"],
  );
});

Deno.test("a concat instance with a parameter that is not an array is rejected", () => {
  assertEquals(
    forgedBuiltin(CONCAT_SOURCE, "concat", (type) => {
      type.parameters[1] = NUMBER;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin concat takes one or more arrays of the result type",
      "validation/002 declarations[2].body.arguments[1]: the argument has type int[], which does not fit the parameter number",
    ],
  );
});

Deno.test("a concat instance without parameters or with another element type is rejected", () => {
  assertEquals(
    forgedBuiltin(CONCAT_SOURCE, "concat", (type) => {
      type.parameters = [];
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin concat takes one or more arrays of the result type",
      "validation/002 declarations[2].body.arguments: the function takes 0 arguments, the call has 2",
    ],
  );
  assertEquals(
    forgedBuiltin(CONCAT_SOURCE, "concat", (type) => {
      type.parameters[0] = { kind: "array", element: NUMBER };
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin concat takes one or more arrays of the result type",
    ],
  );
});

Deno.test("an instance of concat with a requirement is rejected", () => {
  assertEquals(
    forgedBuiltin(CONCAT_SOURCE, "concat", (type) => {
      type.effects = { failures: [], requirements: ["cap:m#Clock.now"] };
    }),
    [
      "validation/001 imports[0].values[0].type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 imports[0].values[0].type: a pure function type must have empty failure and requirement rows",
      "validation/002 imports[0].values[0].type: the builtin concat is pure, with no failure and no requirement",
      "validation/004 declarations[2].type.execution: expected effect, recorded pure",
      "validation/001 declarations[2].body.callee.type.effects.requirements[0]: the requirement cap:m#Clock.now is not a declared service method",
      "validation/002 declarations[2].body.callee.type: a pure function type must have empty failure and requirement rows",
      "validation/003 declarations[2].body.effects.requirements: expected [cap:m#Clock.now], recorded []",
      "validation/003 declarations[2].body: the body requires [cap:m#Clock.now], which the declared requirements [] do not list",
      "validation/004 declarations[2].body.execution: expected effect, recorded pure",
    ],
  );
});

const SORT_SOURCE = `type Int = int
type Row = { k: Int }
type Rows = Row[]
export const f = (rows: Rows): Rows => sort(rows, (r) => r.k)
`;

Deno.test("the lowered sort program is valid, and its instance has the exact type", () => {
  const type = instance(loweredModule(SORT_SOURCE), "sort");
  assertEquals(
    [type.parameters.length, type.parameters[1], type.execution],
    [
      2,
      {
        kind: "function",
        parameters: [{ kind: "named", id: "type:m#Row" }],
        result: { kind: "named", id: "type:m#Int" },
        execution: "pure",
        effects: { failures: [], requirements: [] },
      },
      "pure",
    ],
  );
});

Deno.test("a sort instance with a boolean key is rejected", () => {
  assertEquals(
    forgedBuiltin(SORT_SOURCE, "sort", (type) => {
      const key = type.parameters[1];
      assert(key.kind === "function");
      key.result = BOOLEAN;
    }),
    [
      "validation/002 imports[0].values[0].type: the builtin sort orders by a number or a string",
      "validation/002 declarations[3].body.arguments[1]: the argument has type (type:m#Row) => type:m#Int [pure], which does not fit the parameter (type:m#Row) => boolean [pure]",
    ],
  );
});

Deno.test("a call of sort with an effectful key closure is rejected", () => {
  assertEquals(
    forgedModule(SORT_SOURCE, (ir) => {
      const f = (ir as Mutable<ModuleIR>).declarations.find((d) =>
        d.kind === "function"
      );
      assert(f?.kind === "function" && f.body.kind === "call");
      const closure = f.body.arguments[1];
      assert(closure.kind === "closure" && closure.type.kind === "function");
      closure.type.execution = "effect";
      closure.type.effects = { failures: ["error:m#Boom"], requirements: [] };
    }),
    [
      "validation/003 declarations[3].body: sort must invoke the callback with its declared failures and requirements",
      "validation/001 declarations[3].body.arguments[1].type.effects.failures[0]: the failure error:m#Boom is not a declared error",
      "validation/002 declarations[3].body.arguments[1]: the argument has type (type:m#Row) => type:m#Int fails error:m#Boom [effect], which does not fit the parameter (type:m#Row) => type:m#Int [pure]",
    ],
  );
});
