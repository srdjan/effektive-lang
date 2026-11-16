// Tests for lowering sites that only a forged checker table reaches. Each test
// changes one fact of a checked project and lowers the module through
// `lowerModule`. The checker and the lowering agree for every source program,
// so no source text can carry such a fact.

import { assert, assertEquals } from "@std/assert";
import { type CheckedProject, lowerModule } from "../src/core/frontend.ts";
import { allExprs, checkModule } from "./helpers.ts";

type CheckedModule = NonNullable<
  ReturnType<CheckedProject["modules"]["get"]>
>;
type Body = NonNullable<ReturnType<CheckedModule["functions"]["get"]>>;
type Facts = Body["table"]["facts"];
type Fact = NonNullable<ReturnType<Facts["get"]>>;

/** The first fact that satisfies `select`, in table order, gets the fields of `change`. */
function forgedFacts(
  facts: Facts,
  select: (fact: Fact) => boolean,
  change: Record<string, unknown>,
): Facts {
  let done = false;
  return new Map(
    [...facts].map(([node, fact]) => {
      if (done || !select(fact)) return [node, fact];
      done = true;
      return [node, Object.assign(structuredClone(fact), change)];
    }),
  );
}

/** The project with the first selected fact in the first function that has one changed. */
function forged(
  text: string,
  select: (fact: Fact) => boolean,
  change: Record<string, unknown>,
): CheckedProject {
  const checked = checkModule(text);
  assertEquals(checked.diagnostics, []);
  const module = checked.modules.get("m");
  assert(module !== undefined);
  let done = false;
  const functions = new Map(
    [...module.functions].map(([id, body]) => {
      const facts = forgedFacts(body.table.facts, select, change);
      const changed = !done &&
        [...facts].some(([node, fact]) => fact !== body.table.facts.get(node));
      done = done || changed;
      return [id, { ...body, table: { ...body.table, facts: facts } }];
    }),
  );
  assert(done, "no selected fact");
  return {
    ...checked,
    modules: new Map([...checked.modules, ["m", { ...module, functions }]]),
  };
}

function lowered(result: ReturnType<typeof lowerModule>) {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

const CALL = `type Int = int
const g = (n: Int): Int => n
const f = (n: Int): Int => g(n)
`;

Deno.test("a call whose fact is no call gives an internal error that names the fact", () => {
  const kinds = [
    "none",
    "list",
    "field",
    "arrow",
    "binding",
    "pattern",
    "handler",
    "finalizer",
    "option-fallback",
    "record-binding",
  ];
  assertEquals<unknown>(
    kinds.map((kind) => {
      const result = lowerModule(
        forged(CALL, (f) => f.kind === "call", { kind }),
        "m",
      );
      assert(!result.ok);
      return result.error;
    }),
    [
      "the fact none is no call at m.eff:71-75",
      "the fact list is no call at m.eff:71-75",
      "the fact field is no call at m.eff:71-75",
      "the fact arrow is no call at m.eff:71-75",
      "the fact binding is no call at m.eff:71-75",
      "the fact pattern is no call at m.eff:71-75",
      "the fact handler is no call at m.eff:71-75",
      "the fact finalizer is no call at m.eff:71-75",
      "the fact option-fallback is no call at m.eff:71-75",
      "the fact record-binding is no call at m.eff:71-75",
    ].map((message) => ({ tag: "internal", module: "m", message })),
  );
});

const LOG = `type Text = string
export const f = (msg: Text): void => log(msg, { level: "warn", fields: { a: 1 } })
`;
const LOG_PLAIN = `type Text = string
export const f = (msg: Text): void => log(msg)
`;

Deno.test("a log call with options takes no fields when its fact has none", () => {
  const [call] = allExprs(
    lowered(
      lowerModule(forged(LOG, (f) => f.kind === "log", { fields: false }), "m"),
    ),
    "log",
  );
  assertEquals(call.fields, null);
});

Deno.test("a log call without options takes no fields when its fact has fields", () => {
  const [call] = allExprs(
    lowered(
      lowerModule(
        forged(LOG_PLAIN, (f) => f.kind === "log", { fields: true }),
        "m",
      ),
    ),
    "log",
  );
  assertEquals(call.fields, null);
});

const SCHEMA_TYPES = `type Text = string
type Nil = null
type Nullable = Text | Nil
type Encoded = { name?: Nullable }
type Decoded = { name: Text }
const text: Schema<Text> = schema()
`;
const SCHEMA_NULL = SCHEMA_TYPES +
  `const make = (): Schema<Decoded, Encoded> => schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada", { on: "null" }) })
`;
const SCHEMA_PLAIN = SCHEMA_TYPES +
  `type Optional = { name?: Text }
const make = (): Schema<Decoded, Optional> => schemaStruct({ name: schemaDefaultKey(text, (): Text => "Ada") })
`;

Deno.test("a default key keeps the option on when its fact has no options", () => {
  const project = forged(
    SCHEMA_NULL,
    (f) => f.kind === "schema" && f.op === "default-null-key",
    { options: false },
  );
  const [call] = allExprs(lowered(lowerModule(project, "m")), "schema")
    .filter((e) => e.op === "default-null-key");
  assertEquals(call.arguments.length, 3);
});

Deno.test("a default key without options stays at two arguments when its fact has options", () => {
  const project = forged(
    SCHEMA_PLAIN,
    (f) => f.kind === "schema" && f.op === "default-key",
    { options: true },
  );
  const [call] = allExprs(lowered(lowerModule(project, "m")), "schema")
    .filter((e) => e.op === "default-key");
  assertEquals(call.arguments.length, 2);
});

const MATCH = `type Int = int
const f = (t: Int): Int => match t { 1 => 2, _ => 3 }
`;

Deno.test("a pattern whose fact is invalid gives an internal error", () => {
  const result = lowerModule(
    forged(MATCH, (f) => f.kind === "pattern", {
      pattern: { kind: "invalid" },
    }),
    "m",
  );
  assert(!result.ok);
  assertEquals(result.error, {
    tag: "internal",
    module: "m",
    message: "an invalid pattern at m.eff:52-53",
  });
});
