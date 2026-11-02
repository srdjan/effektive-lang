// SR2: the next omission from the target names, found by behavior. A source
// binding that takes a name which the generated TypeScript prints or imports
// can capture that name, and then the emitted program fails the strict target
// check. The test places each candidate name as a parameter, a local, and a
// module constant in small programs that make the emitter print the affected
// constructs. The checker either reserves the name (`declaration/002`) or
// accepts the program. One `deno check` call must then pass over every accepted
// program, so the check proves that the emitter never lets a binding capture a
// name. The test reuses no source tokens, which differs from the generated
// acceptance property.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";
import { buildProject, check, withTemporary } from "./emit_slow_helpers.ts";

/** The JavaScript and TypeScript globals. */
const GLOBALS: readonly string[] = [
  "Object",
  "Array",
  "Promise",
  "JSON",
  "Symbol",
  "Boolean",
  "Date",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "Reflect",
  "Proxy",
  "Function",
  "BigInt",
  "TypeError",
  "RangeError",
  "Number",
  "String",
  "Error",
  "Math",
  "globalThis",
  "undefined",
  "NaN",
  "Infinity",
  "console",
  "parseInt",
  "isNaN",
  "Intl",
  "WeakSet",
  "Uint8Array",
  "ReadonlyArray",
  "Record",
  "Partial",
  "Readonly",
  "Omit",
  "Exclude",
  "Iterable",
  "AsyncIterable",
  "decodeURIComponent",
  "structuredClone",
  "queueMicrotask",
  "setTimeout",
  "Deno",
  "window",
  "self",
  "require",
  "module",
  "exports",
  "arguments",
  "eval",
];

/** The names that emitted code imports from `effect` or declares as helpers. */
const EMITTED: readonly string[] = [
  "Effect",
  "Context",
  "Layer",
  "Option",
  "HashMap",
  "HashSet",
  "Schema",
  "SchemaIssue",
  "SchemaGetter",
  "SchemaTransformation",
  "Stream",
  "Sink",
  "SynchronizedRef",
  "Schedule",
  "Duration",
  "Cause",
  "Clock",
  "Random",
  "Cron",
  "Fiber",
  "Deferred",
  "Exit",
  "Scope",
  "Data",
  "pipe",
  "Match",
  "Predicate",
  "Ref",
  "Queue",
  "SchemaError",
  "TimeoutError",
  "Defect",
  "$int",
  "$Int",
  "$s",
  "$t0",
  "$unmatched",
  "$hostCheck",
  "$outcome",
  "$Outcome",
  "$makeScope",
  "$CloseableScope",
  "_tag",
  "value",
  "key",
  "fields",
  "input",
  "out",
  "output",
  "supplied",
  "descriptors",
];

const NAMES: readonly string[] = [...GLOBALS, ...EMITTED];

type Position = "param" | "local" | "module" | "type";

interface Template {
  readonly id: string;
  /** The source, with the placeholder `N` in the name position. */
  readonly source: Readonly<Partial<Record<Position, string>>>;
}

const PRELUDE = "type Int = int\ntype Text = string\n";

/** Duration division prints `Math.trunc`. */
const DURATION: Template = {
  id: "duration",
  source: {
    param:
      `${PRELUDE}export const f = (N: Int, d: Duration): Duration => d / N\n`,
    local:
      `${PRELUDE}export const f = (d: Duration): Duration => {\n  const N: Int = 3\n  d / N\n}\n`,
    module:
      `${PRELUDE}const N: Int = 3\nexport const f = (d: Duration): Duration => d / N\n`,
  },
};

/** A Defect handler prints `Error` and `String`. */
const DEFECT_ARM =
  "try { sleep(0ms - 1ms)\n  V } catch { Defect(d) => d.message }";
const DEFECT: Template = {
  id: "defect",
  source: {
    param: `${PRELUDE}export const f = (N: Text): Text =>\n  ${
      DEFECT_ARM.replace("V", "N")
    }\n`,
    local: `${PRELUDE}export const f = (): Text => {\n  const N = "x"\n  ${
      DEFECT_ARM.replace("V", "N")
    }\n}\n`,
    module: `${PRELUDE}const N: Text = "x"\nexport const f = (): Text =>\n  ${
      DEFECT_ARM.replace("V", "N")
    }\n`,
  },
};

/** An optional field read of a prototype name prints the field helpers with `globalThis`. */
const OPTIONAL_TYPE = "type R = { toString?: Text }\n";
const OPTIONAL: Template = {
  id: "optional",
  source: {
    param:
      `${PRELUDE}${OPTIONAL_TYPE}export const f = (r: R, N: Text): Text =>\n  match r.toString { Some(n) => n, None => N }\n`,
    local:
      `${PRELUDE}${OPTIONAL_TYPE}export const f = (r: R): Text => {\n  const N = "x"\n  match r.toString { Some(n) => n, None => N }\n}\n`,
    module:
      `${PRELUDE}${OPTIONAL_TYPE}const N: Text = "x"\nexport const f = (r: R): Text =>\n  match r.toString { Some(n) => n, None => N }\n`,
  },
};

/** A match over a tagged union prints the unmatched fallback. */
const SHAPES =
  "export type Circle = { radius: Text }\nexport type Square = { side: Text }\nexport type Shape = Circle | Square\n";
const SHAPE_MATCH = "match s { Circle(c) => c.radius, Square(q) => V }";
const TAGGED: Template = {
  id: "tagged",
  source: {
    type:
      `${PRELUDE}export type N = { radius: Text }\nexport type Square = { side: Text }\nexport type Shape = N | Square\nexport const f = (s: Shape): Text =>\n  match s { N(c) => c.radius, Square(q) => q.side }\n`,
    param:
      `${PRELUDE}${SHAPES}export const f = (s: Shape, N: Text): Text =>\n  ${
        SHAPE_MATCH.replace("V", "N")
      }\n`,
    local:
      `${PRELUDE}${SHAPES}export const f = (s: Shape): Text => {\n  const N = "x"\n  ${
        SHAPE_MATCH.replace("V", "N")
      }\n}\n`,
    module:
      `${PRELUDE}${SHAPES}const N: Text = "x"\nexport const f = (s: Shape): Text =>\n  ${
        SHAPE_MATCH.replace("V", "N")
      }\n`,
  },
};

/** An effectful function with a typed failure prints the Effect types. */
const SERVICE =
  "export error Oops = { detail: Text }\nexport service Env { get(x: Int): Int fails Oops }\n";
const EFFECTFUL: Template = {
  id: "effectful",
  source: {
    param:
      `${PRELUDE}${SERVICE}export const f = (N: Int): Int fails Oops uses Env.get => Env.get(N)\n`,
    local:
      `${PRELUDE}${SERVICE}export const f = (): Int fails Oops uses Env.get => {\n  const N = 1\n  Env.get(N)\n}\n`,
    module:
      `${PRELUDE}${SERVICE}const N: Int = 1\nexport const f = (): Int fails Oops uses Env.get => Env.get(N)\n`,
  },
};

/** A Schema use prints the schema declarations and the decode call. */
const USER =
  "export type User = { id: Text, nick?: Text }\nconst userSchema: Schema<User> = schema()\n";
const SCHEMA: Template = {
  id: "schema",
  source: {
    type:
      `${PRELUDE}export type N = { id: Text, nick?: Text }\nconst userSchema: Schema<N> = schema()\nexport const f = (src: unknown): N fails SchemaError =>\n  schemaDecode(userSchema, src)\n`,
    param:
      `${PRELUDE}${USER}export const f = (N: unknown): User fails SchemaError =>\n  schemaDecode(userSchema, N)\n`,
    local:
      `${PRELUDE}${USER}export const f = (src: unknown): User fails SchemaError => {\n  const N = src\n  schemaDecode(userSchema, N)\n}\n`,
    module:
      `${PRELUDE}${USER}const N: Text = "x"\nexport const f = (): User fails SchemaError =>\n  schemaDecode(userSchema, N)\n`,
  },
};

/** An Option use prints the Option constructors. */
const OPTION_MATCH = "match V { Some(x) => x, None => 0 }";
const OPTION: Template = {
  id: "option",
  source: {
    param: `${PRELUDE}export const f = (N: Option<Int>): Int =>\n  ${
      OPTION_MATCH.replace("V", "N")
    }\n`,
    local: `${PRELUDE}export const f = (): Int => {\n  const N = Some(1)\n  ${
      OPTION_MATCH.replace("V", "N")
    }\n}\n`,
    module:
      `${PRELUDE}const N: Option<Int> = Some(1)\nexport const f = (): Int =>\n  ${
        OPTION_MATCH.replace("V", "N")
      }\n`,
  },
};

/** A refinement prints exact integer comparisons with `BigInt`. */
const REFINED: Template = {
  id: "refined",
  source: {
    type: `${PRELUDE}export type N = int where n => n > 0\n`,
    module:
      `${PRELUDE}const N: Int = 3\nexport type Positive = int where n => n > 0\nexport const f = (): Int => N\n`,
    param:
      `${PRELUDE}export type Span = { lo: int, hi: int } where N => N.hi - N.lo <= 10\n`,
  },
};

const TEMPLATES: readonly Template[] = [
  REFINED,
  DURATION,
  DEFECT,
  OPTIONAL,
  TAGGED,
  EFFECTFUL,
  SCHEMA,
  OPTION,
];

interface Variant {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

/** The checker outcome of one program: the diagnostic codes of its module. */
function codesOf(text: string): string[] {
  const result = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": text }),
    "",
    ["main.eff"],
  );
  assert(result.ok, JSON.stringify(result));
  return result.value.diagnostics.map((d) => d.code);
}

Deno.test("no accepted binding name captures a name that the generated TypeScript needs", async () => {
  const accepted: Variant[] = [];
  const reserved = new Set<string>();
  const parserReserved = new Set<string>();
  let reservedVariants = 0;
  let index = 0;
  for (const name of NAMES) {
    for (const template of TEMPLATES) {
      for (const [position, source] of Object.entries(template.source)) {
        const text = source.replaceAll(/\bN\b/g, () => name);
        const codes = codesOf(text);
        const path = `v${index}_${template.id}_${position}_${
          name.replaceAll("$", "_")
        }.eff`;
        index += 1;
        if (codes.includes("declaration/002")) {
          reserved.add(name);
          reservedVariants += 1;
        } else if (codes.includes("syntax/007")) {
          assert(
            codes.every((code) => code === "syntax/007"),
            `${name} in ${template.id}/${position}: ${codes}`,
          );
          parserReserved.add(name);
        } else {
          assertEquals(codes, [], `${name} in ${template.id}/${position}`);
          accepted.push({ name, path, text });
        }
      }
    }
  }
  await withTemporary(async (dir) => {
    for (const variant of accepted) {
      Deno.writeTextFileSync(`${dir}/${variant.path}`, variant.text);
    }
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const built = buildProject(dir, accepted.map((v) => v.path));
    assertEquals(built.paths.length, accepted.length);
    await check(dir, built.paths);
  });
  // Literal counts: a reservation of every name cannot make the test vacuous.
  assertEquals(accepted.length, 2184);
  assertEquals(reservedVariants, 416);
  assertEquals(reserved.size, 20);
  assertEquals(parserReserved.size, 2);
});
