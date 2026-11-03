// Tests for the diagnostic report sites of the prelude builtins in
// src/core/check_expr.ts. Each row gives a builtin, a valid program, the same
// program with one change that triggers the site, the expected code, and a
// fragment of the expected message. The valid program must check with no
// diagnostics. The changed program must report the code with the fragment.
// Every test runs through the public entry `checkProject`.

import { assert, assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/frontend.ts";

interface SiteRow {
  /** The prelude builtin, or the checker feature, that owns the site. */
  readonly builtin: string;
  /** What the one change does. */
  readonly change: string;
  readonly valid: string;
  readonly invalid: string;
  readonly code: string;
  readonly fragment: string;
  /** Adds the host module `host:files`, which declares an opaque Handle. */
  readonly host?: true;
}

const HOST_FILES: Record<string, string> = {
  "effektive.json": JSON.stringify({
    host: { files: { interface: "./host.effi", module: "./host.ts" } },
  }),
  "host.effi": `
export opaque type Handle
export type Text = string
export service Files {
  open(): Handle
  read(borrow handle: Handle): Text
  plain(handle: Handle): Text
  close(borrow handle: Handle): void
}
`,
};

function diagnosticsOf(
  text: string,
  host: boolean,
): { readonly code: string; readonly message: string }[] {
  const files = host
    ? { ...HOST_FILES, "main.eff": text }
    : { "effektive.json": "{}", "main.eff": text };
  const result = checkProject(memoryHost(files), "", ["main.eff"]);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value.diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
  }));
}

const INT = "type Int = int\n";

/** A stream builtin whose first argument is the stream. `$S` is the stream. */
function streamRow(
  builtin: string,
  call: string,
  fragment = `\`${builtin}\` needs a Stream value`,
): SiteRow {
  const wrap = (stream: string) =>
    `${INT}const probe = (s: Stream<Int>) => ${call.replace("$S", stream)}\n`;
  return {
    builtin,
    change: "replace the stream with an int",
    valid: wrap("s"),
    invalid: wrap("1"),
    code: "type-mismatch/010",
    fragment,
  };
}

const STOP_JOBS = `${INT}error Stop = {}
service Jobs { next(): Int fails Stop }
`;

const LAYER_SERVICE = `${INT}service First { one(): Int }
`;

const SHAPE =
  `${INT}type Num = number\ntype Shape = { kind: "circle", radius: Num } | { kind: "square", side: Num }\n`;

const ROWS: readonly SiteRow[] = [
  // ---- brand, retry, retrySchedule
  {
    builtin: "brand constructor",
    change: "give the brand a second argument",
    valid: 'type UserId = string\nconst f = () => UserId("a")\n',
    invalid: 'type UserId = string\nconst f = () => UserId("a", "b")\n',
    code: "type-mismatch/004",
    fragment:
      "the type with identity `UserId` takes one argument, but 2 are given",
  },
  {
    builtin: "retry",
    change: "replace the job function with an int",
    valid:
      `${STOP_JOBS}const run = (): Int fails Stop with Jobs.next => retry(() => Jobs.next(), { times: 3 })\n`,
    invalid:
      `${STOP_JOBS}const run = (): Int fails Stop with Jobs.next => retry(1, { times: 3 })\n`,
    code: "type-mismatch/010",
    fragment:
      "`retry` needs a function that takes no arguments, but the job has type",
  },
  {
    builtin: "retry",
    change: "give the schedule an error type that the job does not fail with",
    valid:
      `${STOP_JOBS}const policy: RetrySchedule<Stop> = retrySchedule((error: Stop, attempt: Int): Option<Duration> => None)\nconst run = (): Int fails Stop with Jobs.next => retry(() => Jobs.next(), { schedule: policy })\n`,
    invalid:
      `${STOP_JOBS}error Other = {}\nconst policy: RetrySchedule<Other> = retrySchedule((error: Other, attempt: Int): Option<Duration> => None)\nconst run = (): Int fails Stop with Jobs.next => retry(() => Jobs.next(), { schedule: policy })\n`,
    code: "type-mismatch/003",
    fragment: "the retry schedule does not accept",
  },
  {
    builtin: "retrySchedule",
    change: "replace the callback with an int",
    valid:
      `${INT}error Stop = {}\nconst a = retrySchedule((e: Stop, attempt: Int): Option<Duration> => None)\n`,
    invalid: `${INT}const a = retrySchedule(1)\n`,
    code: "type-mismatch/010",
    fragment: "`retrySchedule` needs a function",
  },
  {
    builtin: "retrySchedule",
    change: "drop the attempt parameter",
    valid:
      `${INT}error Stop = {}\nconst a = retrySchedule((e: Stop, attempt: Int): Option<Duration> => None)\n`,
    invalid:
      `${INT}error Stop = {}\nconst a = retrySchedule((e: Stop): Option<Duration> => None)\n`,
    code: "type-mismatch/004",
    fragment:
      "the retry schedule callback takes an error and an attempt number",
  },
  {
    builtin: "retrySchedule",
    change: "type the error parameter as an int",
    valid:
      `${INT}error Stop = {}\nconst a = retrySchedule((e: Stop, attempt: Int): Option<Duration> => None)\n`,
    invalid:
      `${INT}const a = retrySchedule((e: Int, attempt: Int): Option<Duration> => None)\n`,
    code: "type-mismatch/010",
    fragment: "the retry schedule callback needs a declared error parameter",
  },
  {
    builtin: "retrySchedule",
    change: "call a service method in the callback",
    valid:
      `${INT}error Stop = {}\nconst a = retrySchedule((e: Stop, attempt: Int): Option<Duration> => Some(attempt * 1ms))\n`,
    invalid:
      `${INT}error Stop = {}\nservice Probe { n(): Int }\nconst a = retrySchedule((e: Stop, attempt: Int): Option<Duration> with Probe.n => Some(Probe.n() * 1ms))\n`,
    code: "execution-mode/001",
    fragment: "the retry schedule callback must be pure",
  },
  // ---- scopes
  {
    builtin: "scoped",
    change: "replace the job with an int",
    valid: `${INT}const a = (): Int => scoped(defer(() => 1))\n`,
    invalid: `${INT}const a = (): Int => scoped(1)\n`,
    code: "type-mismatch/010",
    fragment: "`scoped` needs an Effect value",
  },
  {
    builtin: "forkScoped",
    change: "replace the job with an int",
    valid:
      `${INT}const a = (): void => scoped(defer(() => forkScoped(defer(() => 1))))\n`,
    invalid: `${INT}const a = (): void => scoped(forkScoped(1))\n`,
    code: "type-mismatch/010",
    fragment: "`forkScoped` needs an Effect value",
  },
  // ---- resources and borrowed handles
  {
    builtin: "withResource",
    change: "acquire an int instead of a record of operations",
    host: true,
    valid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (): Text with Files.open | Files.read | Files.close =>\n  withResource(() => Files.open(), (handle) => Files.read(handle), (handle) => Files.close(handle))\n',
    invalid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (): Text with Files.close =>\n  withResource(() => 1, (handle) => "x", (handle) => {})\n',
    code: "type-mismatch/010",
    fragment:
      "acquisition must return a nonempty record of required operations",
  },
  {
    builtin: "withResource",
    change: "pass the use callback as a named function",
    host: true,
    valid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (): Text with Files.open | Files.read | Files.close =>\n  withResource(() => Files.open(), (handle) => Files.read(handle), (handle) => Files.close(handle))\n',
    invalid:
      'import { Handle, Text, Files } from "host:files"\nconst use = (handle: Handle): Text => "x"\nconst a = (): Text with Files.open | Files.close =>\n  withResource(() => Files.open(), use, (handle) => Files.close(handle))\n',
    code: "type-mismatch/010",
    fragment: "withResource requires three inline arrow callbacks",
  },
  {
    builtin: "borrow parameter",
    change: "borrow an int instead of an opaque handle",
    host: true,
    valid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (borrow handle: Handle): Text with Files.read => Files.read(handle)\n',
    invalid:
      'import { Handle, Text, Files } from "host:files"\ntype Int = int\nconst a = (borrow n: Int): Text => "x"\n',
    code: "type-mismatch/010",
    fragment: "a borrow parameter needs an opaque type",
  },
  {
    builtin: "borrow parameter",
    change: "return the borrowed handle",
    host: true,
    valid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (borrow handle: Handle): Text with Files.read => Files.read(handle)\n',
    invalid:
      'import { Handle, Text, Files } from "host:files"\nconst a = (borrow handle: Handle): Handle => handle\n',
    code: "type-mismatch/010",
    fragment: "a borrow function must return data only",
  },
  // ---- layers
  {
    builtin: "layer",
    change: "replace the service name with an int",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid: `${LAYER_SERVICE}const a = layer(1, () => ({ one: () => 1 }))\n`,
    code: "type-mismatch/010",
    fragment: "`layer` needs a declared service name",
  },
  {
    builtin: "layer",
    change: "pass the acquisition as a named function",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid:
      `${LAYER_SERVICE}const make = () => ({ one: () => 1 })\nconst a = layer(First, make)\n`,
    code: "type-mismatch/010",
    fragment: "`layer` needs an inline acquisition callback",
  },
  {
    builtin: "layer",
    change: "add a method that the service does not declare",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid:
      `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1, two: () => 2 }))\n`,
    code: "type-mismatch/005",
    fragment: "has no field `two`",
  },
  {
    builtin: "layer",
    change: "return a text from a method that returns an int",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid:
      `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => "x" }))\n`,
    code: "type-mismatch/003",
    fragment: "the field `one` has type",
  },
  {
    builtin: "layer",
    change: "return an int instead of a method record",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid: `${LAYER_SERVICE}const a = layer(First, () => 1)\n`,
    code: "type-mismatch/010",
    fragment: "`layer` acquisition must return a service method record",
  },
  {
    builtin: "layer",
    change: "call the service method that the layer provides",
    valid: `${LAYER_SERVICE}const a = layer(First, () => ({ one: () => 1 }))\n`,
    invalid:
      `${LAYER_SERVICE}const a = layer(First, () => { First.one(); ({ one: () => 1 }) })\n`,
    code: "type-mismatch/010",
    fragment: "`layer` acquisition cannot require a method it provides",
  },
  {
    builtin: "mergeLayers",
    change: "replace the second layer with an int",
    valid:
      `${LAYER_SERVICE}service Second { two(): Int }\nconst first = layer(First, () => ({ one: () => 1 }))\nconst second = layer(Second, () => ({ two: () => 2 }))\nconst both = mergeLayers(first, second)\n`,
    invalid:
      `${LAYER_SERVICE}const first = layer(First, () => ({ one: () => 1 }))\nconst both = mergeLayers(first, 2)\n`,
    code: "type-mismatch/010",
    fragment: "`mergeLayers` needs two Layer values",
  },
  {
    builtin: "mergeLayers",
    change: "merge a layer with itself",
    valid:
      `${LAYER_SERVICE}service Second { two(): Int }\nconst first = layer(First, () => ({ one: () => 1 }))\nconst second = layer(Second, () => ({ two: () => 2 }))\nconst both = mergeLayers(first, second)\n`,
    invalid:
      `${LAYER_SERVICE}const first = layer(First, () => ({ one: () => 1 }))\nconst both = mergeLayers(first, first)\n`,
    code: "type-mismatch/010",
    fragment: "`mergeLayers` cannot provide one service twice",
  },
  // ---- unfold and stream builtins with a Stream first argument
  {
    builtin: "unfold",
    change: "return an int instead of an Option of a pair",
    valid:
      `${INT}const a = (): Stream<Int> => unfold(0, (n): Option<[Int, Int]> => None)\n`,
    invalid: `${INT}const a = () => unfold(0, (n) => n)\n`,
    code: "type-mismatch/010",
    fragment: "`unfold` callback must return Option<[Element, State]>",
  },
  streamRow("mapEffect", "mapEffect($S, (n) => n + 1)"),
  streamRow("bufferStream", "bufferStream($S, { capacity: 2 })"),
  // ---- sinks, races, refs
  {
    builtin: "sinkForEach",
    change: "take no input parameter",
    valid: `${INT}const probe = () => sinkForEach((value: Int): void => {})\n`,
    invalid: `${INT}const probe = () => sinkForEach(() => {})\n`,
    code: "type-mismatch/010",
    fragment:
      "`sinkForEach` needs a one-argument callback with an annotated input",
  },
  {
    builtin: "runStream",
    change: "replace the sink with an int",
    valid:
      `${INT}const probe = (s: Stream<Int>, k: Sink<Int, Int[], never, never, Int>) => runStream(s, k)\n`,
    invalid:
      `${INT}const probe = (s: Stream<Int>, k: Sink<Int, Int[], never, never, Int>) => runStream(s, 1)\n`,
    code: "type-mismatch/010",
    fragment: "`runStream` needs a Sink as its second argument",
  },
  {
    builtin: "race",
    change: "replace the first job with an int",
    valid: `${INT}const probe = () => race(defer(() => 1), defer(() => 2))\n`,
    invalid: `${INT}const probe = () => race(1, defer(() => 2))\n`,
    code: "type-mismatch/010",
    fragment: "`race` needs two Effect values",
  },
  {
    builtin: "race",
    change: "make the second job return a text",
    valid: `${INT}const probe = () => race(defer(() => 1), defer(() => 2))\n`,
    invalid:
      `${INT}const probe = () => race(defer(() => 1), defer(() => "a"))\n`,
    code: "type-mismatch/010",
    fragment: "`race` needs compatible success types",
  },
  {
    builtin: "getRef",
    change: "replace the Ref with an int",
    valid: `${INT}const probe = (ref: Ref<Int>): Int => getRef(ref)\n`,
    invalid: `${INT}const probe = (ref: Ref<Int>): Int => getRef(1)\n`,
    code: "type-mismatch/010",
    fragment: "`getRef` needs a Ref value",
  },
  {
    builtin: "setRef",
    change: "replace the Ref with an int",
    valid: `${INT}const probe = (ref: Ref<Int>): void => setRef(ref, 2)\n`,
    invalid: `${INT}const probe = (ref: Ref<Int>): void => setRef(1, 2)\n`,
    code: "type-mismatch/010",
    fragment: "`setRef` needs a Ref value",
  },
  {
    builtin: "updateRef",
    change: "replace the Ref with an int",
    valid:
      `${INT}const probe = (ref: Ref<Int>): void => updateRef(ref, (n) => n)\n`,
    invalid:
      `${INT}const probe = (ref: Ref<Int>): void => updateRef(1, (n) => n)\n`,
    code: "type-mismatch/010",
    fragment: "`updateRef` needs a Ref value",
  },
  // ---- collections of effects
  {
    builtin: "all",
    change: "replace the collection with an int",
    valid:
      `${INT}const probe = () => all({ a: defer(() => 1), b: defer(() => 2) })\n`,
    invalid: `${INT}const probe = () => all(1)\n`,
    code: "type-mismatch/010",
    fragment: "`all` needs a tuple, record, or array of Effect values",
  },
  {
    builtin: "all",
    change: "make a record field optional",
    valid:
      `${INT}type Jobs = { a: Effect<Int> }\nconst probe = (jobs: Jobs) => all(jobs)\n`,
    invalid:
      `${INT}type Jobs = { a?: Effect<Int> }\nconst probe = (jobs: Jobs) => all(jobs)\n`,
    code: "type-mismatch/010",
    fragment: "`all` requires every record field to be present",
  },
  // ---- records and patterns
  {
    builtin: "record construction",
    change: "put a spread after a field",
    valid: `${INT}const a = (b: { x: Int }) => ({ x: 1 })\n`,
    invalid: `${INT}const a = (b: { x: Int }) => ({ x: 1, ...b })\n`,
    code: "type-mismatch/005",
    fragment: "a record spread must come first",
  },
  {
    builtin: "record update",
    change: "put a second spread after a field",
    valid: `${INT}const a = (b: { x: Int }) => ({ ...b, x: 1 })\n`,
    invalid: `${INT}const a = (b: { x: Int }) => ({ ...b, x: 1, ...b })\n`,
    code: "type-mismatch/005",
    fragment: "a record spread must come first",
  },
  {
    builtin: "record update",
    change: "put a second spread directly after the first",
    valid: `${INT}const a = (b: { x: Int }) => ({ ...b, x: 1 })\n`,
    invalid: `${INT}const a = (b: { x: Int }) => ({ ...b, ...b })\n`,
    code: "type-mismatch/005",
    fragment: "a record spread must come first",
  },
  {
    builtin: "record update",
    change: "name one field twice",
    valid: `${INT}const a = (b: { x: Int }) => ({ ...b, x: 1 })\n`,
    invalid: `${INT}const a = (b: { x: Int }) => ({ ...b, x: 1, x: 2 })\n`,
    code: "type-mismatch/005",
    fragment: "the field `x` appears twice",
  },
  {
    builtin: "match pattern",
    change: "give None a binding",
    valid:
      `${INT}const a = (o: Option<Int>): Int => match o { Some(x) => x, None => 0 }\n`,
    invalid:
      `${INT}const a = (o: Option<Int>): Int => match o { Some(x) => x, None(y) => 0 }\n`,
    code: "pattern/004",
    fragment: "`None` cannot be a constructor pattern with a binding",
  },
  {
    builtin: "match pattern",
    change: "match a tagged record pattern against an int",
    valid:
      `${SHAPE}const a = (s: Shape): Num => match s { { kind: "circle", ...c } => c.radius, { kind: "square", ...q } => q.side }\n`,
    invalid:
      `${SHAPE}const a = (n: Int): Num => match n { { kind: "circle", ...c } => 1, _ => 2 }\n`,
    code: "pattern/003",
    fragment: "a tagged record pattern does not belong to the subject",
  },
  {
    builtin: "match pattern",
    change: "give a tagged record pattern two discriminator fields",
    valid:
      `${SHAPE}const a = (s: Shape): Num => match s { { kind: "circle", ...c } => c.radius, { kind: "square", ...q } => q.side }\n`,
    invalid:
      `${SHAPE}const a = (s: Shape): Num => match s { { kind: "circle", radius: 1, ...c } => 1, _ => 2 }\n`,
    code: "pattern/004",
    fragment: "a tagged record pattern needs exactly one discriminator field",
  },
];

for (const row of ROWS) {
  Deno.test(`${row.builtin}: ${row.change}`, () => {
    const host = row.host === true;
    assertEquals(diagnosticsOf(row.valid, host), []);
    const found = diagnosticsOf(row.invalid, host);
    assert(
      found.some((d) =>
        d.code === row.code && d.message.includes(row.fragment)
      ),
      `expected ${row.code} with "${row.fragment}", got ${
        JSON.stringify(found)
      }`,
    );
  });
}

Deno.test("None is a value, not a function: a call of None reports type-mismatch/008", () => {
  const valid = diagnosticsOf(
    "type Int = int\nconst a = (o: Option<Int>): Int => match o { Some(x) => x, None => 0 }\nconst none: Option<Int> = None\n",
    false,
  );
  assertEquals(valid, []);
  const called = diagnosticsOf(
    "type Int = int\nconst none: Option<Int> = None(1)\n",
    false,
  );
  assertEquals(
    called.filter((d) => d.code === "type-mismatch/008"),
    [{
      code: "type-mismatch/008",
      message: "`None` is a value, not a function",
    }],
  );
});

Deno.test("SchemaError, SchemaIssue and TimeoutError are type names only, so no source program constructs them", () => {
  // The errorConstruction site for these two ids has no source entry: the
  // resolver gives them as error targets only in type and `fails` positions.
  for (const name of ["SchemaError", "SchemaIssue", "TimeoutError"]) {
    const found = diagnosticsOf(
      `type Int = int\nconst probe = () => ${name}({})\n`,
      false,
    );
    assertEquals(found, [{
      code: "unknown-name/001",
      message: `unknown name \`${name}\``,
    }]);
  }
});

Deno.test("a record spread after a field reports the parser and the checker codes in order", () => {
  const found = diagnosticsOf(
    `${INT}const a = (b: { x: Int }) => ({ x: 1, ...b })\n`,
    false,
  );
  assertEquals(found.map((d) => d.code), ["syntax/014", "type-mismatch/005"]);
});
