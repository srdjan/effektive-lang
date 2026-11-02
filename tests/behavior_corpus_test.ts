// Tests of the behavior corpus runner and the comparison. The runner tests run
// the real compiler of this tree on a small in-memory corpus. The comparison
// tests use literal record sets and an in-memory boundary. The slow test
// `behavior_compare_slow_test.ts` runs the whole command.

import { assert, assertEquals } from "@std/assert";
import {
  canonicalJson,
  type Corpus,
  KINDS,
  loadCore,
  type Rec,
  runCorpus,
  selects,
} from "../scripts/behavior_corpus.ts";
import {
  compareRecords,
  countLines,
  type Deps,
  differenceFiles,
  exitStatus,
  parseArgs,
  parseRecords,
  reportLines,
  runCommand,
  safeName,
  USAGE,
} from "../scripts/behavior_compare.ts";

const ROOT = new URL("..", import.meta.url).pathname;

const SMALL: Corpus = {
  projects: [
    {
      name: "p/clean",
      files: {
        "effektive.json": "{}",
        "main.eff":
          "export type Count = int\nexport const double = (n: Count): Count => n + n\n",
      },
      entries: ["main.eff"],
    },
    {
      name: "p/broken",
      files: {
        "effektive.json": "{}",
        "main.eff": 'import { a } from "./nothere.eff"\n',
      },
      entries: ["main.eff"],
    },
  ],
  forged: [{ name: "f/empty", ir: {}, sources: {} }],
  sequences: [{
    name: "bad-json",
    steps: [
      { set: { "effektive.json": "{", "main.eff": "" } },
      { set: { "effektive.json": "{}" } },
    ],
  }],
};

async function smallRecords(only: readonly string[] = []): Promise<Rec[]> {
  const core = await loadCore(ROOT);
  assert(core.ok, String(!core.ok && core.error));
  return runCorpus(core.value, SMALL, only);
}

// ------------------------------------------------------------------ canonical JSON

Deno.test("canonicalJson sorts keys, keeps Map order, and leaves out undefined properties", () => {
  assertEquals(
    canonicalJson({
      b: 1,
      a: [undefined, { z: null, y: undefined, x: "s" }],
      m: new Map([["k2", 2], ["k1", 1]]),
      s: new Set([3, 1]),
    }),
    '{"a":[null,{"x":"s","z":null}],"b":1,"m":{"$map":[["k2",2],["k1",1]]},"s":{"$set":[3,1]}}',
  );
});

Deno.test("canonicalJson writes an error, a non-finite number, and a cycle as text", () => {
  const cycle: Record<string, unknown> = { name: "c" };
  cycle.self = cycle;
  assertEquals(
    canonicalJson([new Error("boom"), NaN, 1n, cycle]),
    '[{"message":"boom","name":"Error"},"NaN","1n",{"name":"c","self":"[cycle]"}]',
  );
});

// ------------------------------------------------------------------ the runner

Deno.test("the runner gives every record kind for a small corpus", async () => {
  const records = await smallRecords();
  assertEquals(records.map((r) => `${r.kind} ${r.name}`), [
    "program-error edits/bad-json#1",
    "program edits/bad-json#2",
    "emit-error f/empty",
    "validate f/empty",
    "check p/broken",
    "lower-error p/broken!forced#main",
    "check p/clean",
    "validate p/clean",
    "lower p/clean#main",
    "emit p/clean#main",
  ]);
  assertEquals(
    [...new Set(records.map((r) => r.kind))].sort(),
    [...KINDS].sort(),
  );
});

Deno.test("the runner keeps the full result text of each record", async () => {
  const text = new Map(
    (await smallRecords()).map((r) => [`${r.kind} ${r.name}`, r.text]),
  );
  assertEquals(
    text.get("program-error edits/bad-json#1"),
    `{"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)","path":"effektive.json","tag":"malformed-json"}`,
  );
  assertEquals(text.get("program edits/bad-json#2"), "[]");
  assertEquals(
    text.get("validate f/empty"),
    '[{"category":"validation","code":"validation/008","message":": the IR has an unexpected shape: ir.declarations is not iterable","severity":"error","span":{"end":0,"start":0}}]',
  );
  assertEquals(
    text.get("check p/broken"),
    '[{"category":"module","code":"module/002","message":"cannot load nothere.eff: the file does not exist","severity":"error","span":{"end":33,"source":"main.eff","start":18}}]',
  );
  assertEquals(
    text.get("lower-error p/broken!forced#main"),
    '{"imported":"./nothere.eff","module":"main","tag":"no-interface"}',
  );
  assertEquals(text.get("check p/clean"), "[]");
  assertEquals(text.get("validate p/clean"), '{"$map":[["main",[]]]}');
  assert(
    text.get("lower p/clean#main")!.startsWith('"{\\n  \\"declarations\\": ['),
  );
  assert(
    text.get("emit p/clean#main")!.startsWith(
      '{"map":{"ok":true,"value":{"file":"main.ts"',
    ),
  );
  assert(text.get("emit-error f/empty")!.startsWith('{"thrown":"'));
});

Deno.test("the runner runs only the cases that a prefix selects", async () => {
  const records = await smallRecords(["p/clean", "edits/"]);
  assertEquals(records.map((r) => `${r.kind} ${r.name}`), [
    "program-error edits/bad-json#1",
    "program edits/bad-json#2",
    "check p/clean",
    "validate p/clean",
    "lower p/clean#main",
    "emit p/clean#main",
  ]);
  assertEquals(
    (await smallRecords(["p/clean#"])).map((r) => `${r.kind} ${r.name}`),
    ["lower p/clean#main", "emit p/clean#main"],
  );
});

Deno.test("selects keeps every name without a prefix and the names that start with one", () => {
  assertEquals(selects("a/b", []), true);
  assertEquals(selects("a/b", ["a/"]), true);
  assertEquals(selects("a/b", ["b", "x"]), false);
});

Deno.test("loadCore gives an error value for a tree without a compiler", async () => {
  const dir = "/nonexistent-effektive-tree";
  assertEquals(await loadCore(dir), {
    ok: false,
    error: `no src/core/mod.ts in ${dir}`,
  });
});

// ------------------------------------------------------------------ the comparison

const A: Rec = { kind: "check", name: "a", text: "[]" };
const B: Rec = { kind: "lower", name: "b#m", text: '"one"' };
const C: Rec = { kind: "lower", name: "c#m", text: '"two"' };
const B2: Rec = { kind: "lower", name: "b#m", text: '"uno"' };
const D: Rec = { kind: "emit", name: "d#m", text: "{}" };

Deno.test("compareRecords counts equal, changed, missing, and added records for each kind", () => {
  const comparison = compareRecords([A, B, C], [A, B2, D]);
  assertEquals(summaryOf(comparison), [
    "check: 1 equal, 0 changed, 0 missing, 0 added",
    "program: 0 equal, 0 changed, 0 missing, 0 added",
    "program-error: 0 equal, 0 changed, 0 missing, 0 added",
    "lower: 0 equal, 1 changed, 1 missing, 0 added",
    "lower-error: 0 equal, 0 changed, 0 missing, 0 added",
    "emit: 0 equal, 0 changed, 0 missing, 1 added",
    "emit-error: 0 equal, 0 changed, 0 missing, 0 added",
    "validate: 0 equal, 0 changed, 0 missing, 0 added",
  ]);
  assertEquals(comparison.changed, [
    { kind: "lower", name: "b#m", base: '"one"', head: '"uno"' },
  ]);
  assertEquals(comparison.missing, [
    { kind: "lower", name: "c#m", base: '"two"', head: undefined },
  ]);
});

function summaryOf(comparison: ReturnType<typeof compareRecords>): string[] {
  return reportLines(comparison).slice(0, KINDS.length);
}

Deno.test("reportLines names each changed and each missing record after the summary", () => {
  assertEquals(reportLines(compareRecords([A, B, C], [A, B2, D])).slice(8), [
    "changed: lower b#m",
    "missing: lower c#m",
  ]);
});

Deno.test("two equal record sets give exit status 0, and a change or a missing record gives 1", () => {
  assertEquals(exitStatus(compareRecords([A, B], [A, B])), 0);
  assertEquals(exitStatus(compareRecords([A, B], [A, B, D])), 0);
  assertEquals(exitStatus(compareRecords([A, B], [A, B2])), 1);
  assertEquals(exitStatus(compareRecords([A, B], [A])), 1);
});

Deno.test("a record of the same name and another kind is another record", () => {
  const other: Rec = { kind: "emit", name: "a", text: "[]" };
  assertEquals(
    reportLines(compareRecords([A], [other])).slice(8),
    ["missing: check a"],
  );
});

Deno.test("an only prefix drops the records of other names on both sides", () => {
  const comparison = compareRecords([A, B, C], [A, B2], ["a", "c"]);
  assertEquals(reportLines(comparison).slice(8), ["missing: lower c#m"]);
  assertEquals(comparison.counts.check.equal, 1);
  assertEquals(comparison.counts.lower.changed, 0);
});

Deno.test("countLines counts the records of each kind", () => {
  assertEquals(countLines([A, B, C]), [
    "check: 1 records",
    "program: 0 records",
    "program-error: 0 records",
    "lower: 2 records",
    "lower-error: 0 records",
    "emit: 0 records",
    "emit-error: 0 records",
    "validate: 0 records",
  ]);
});

Deno.test("safeName keeps safe characters and encodes the others", () => {
  assertEquals(safeName("emit/forms#a b.eff"), "emit__forms~23~a~20~b.eff");
  assertEquals(safeName("x!forced#m"), "x~21~forced~23~m");
});

Deno.test("differenceFiles writes the base and head text, and only the base text of a missing record", () => {
  const files = differenceFiles(compareRecords(
    [{ kind: "check", name: "p", text: '[{"a":1}]' }, B, C],
    [{ kind: "check", name: "p", text: "[]" }, B],
  ));
  assertEquals([...files], [
    ["p.check.base.json", '[\n  {\n    "a": 1\n  }\n]\n'],
    ["p.check.head.json", "[]\n"],
    ["c~23~m.lower.base.json", "two\n"],
  ]);
});

Deno.test("parseArgs reads the revisions, the output directory, and the prefixes", () => {
  assertEquals(
    parseArgs(["a", "b", "--out", "d", "--only", "x/", "--only", "y"]),
    {
      ok: true,
      value: { revisions: ["a", "b"], out: "d", only: ["x/", "y"] },
    },
  );
  assertEquals(parseArgs(["a"]), {
    ok: true,
    value: { revisions: ["a"], out: undefined, only: [] },
  });
  assertEquals(parseArgs([]), { ok: false, error: USAGE });
  assertEquals(parseArgs(["a", "b", "c"]), { ok: false, error: USAGE });
  assertEquals(parseArgs(["a", "--out"]), { ok: false, error: USAGE });
  assertEquals(parseArgs(["a", "--bogus"]), { ok: false, error: USAGE });
});

Deno.test("parseRecords reads the records list of a runner output and rejects any other text", () => {
  assertEquals(
    parseRecords('{"records":[{"kind":"check","name":"a","text":"[]"}]}'),
    {
      ok: true,
      value: [A],
    },
  );
  assertEquals(parseRecords('{"records":[]}'), { ok: true, value: [] });
  const noList = {
    ok: false as const,
    error: "the output has no records list",
  };
  assertEquals(parseRecords("{}"), noList);
  assertEquals(parseRecords('{"records":5}'), noList);
  assertEquals(parseRecords("null"), noList);
  assertEquals(parseRecords("[]"), noList);
  assertEquals(parseRecords("7"), noList);
  assertEquals(parseRecords("{"), {
    ok: false,
    error:
      "the output is not JSON: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
  });
});

// ------------------------------------------------------------------ the command

interface Log {
  readonly lines: string[];
  readonly errors: string[];
  readonly files: Map<string, string>;
}

function boundary(
  byRevision: Record<string, readonly Rec[]>,
  log: Log,
): Deps {
  return {
    records(revision, fixturesFrom, only) {
      log.lines.push(`records ${revision} ${fixturesFrom} ${only.join(",")}`);
      const records = byRevision[revision];
      return Promise.resolve(
        records === undefined
          ? { ok: false, error: `cannot export ${revision}` }
          : { ok: true, value: records },
      );
    },
    makeTempDir: () => Promise.resolve("/tmp/out"),
    writeFile(path, text) {
      log.files.set(path, text);
      return Promise.resolve();
    },
    log: (line) => log.lines.push(line),
    fail: (line) => log.errors.push(line),
  };
}

function newLog(): Log {
  return { lines: [], errors: [], files: new Map() };
}

Deno.test("the command reports a change with exit status 1 and writes its files", async () => {
  const log = newLog();
  const status = await runCommand(
    ["base", "head", "--out", "/o", "--only", "b"],
    boundary({ base: [A, B], head: [A, B2] }, log),
  );
  assertEquals(status, 1);
  assertEquals(log.lines, [
    "records base head b",
    "records head head b",
    "check: 0 equal, 0 changed, 0 missing, 0 added",
    "program: 0 equal, 0 changed, 0 missing, 0 added",
    "program-error: 0 equal, 0 changed, 0 missing, 0 added",
    "lower: 0 equal, 1 changed, 0 missing, 0 added",
    "lower-error: 0 equal, 0 changed, 0 missing, 0 added",
    "emit: 0 equal, 0 changed, 0 missing, 0 added",
    "emit-error: 0 equal, 0 changed, 0 missing, 0 added",
    "validate: 0 equal, 0 changed, 0 missing, 0 added",
    "changed: lower b#m",
    "output: /o",
  ]);
  assertEquals([...log.files], [
    ["/o/b~23~m.lower.base.json", "one\n"],
    ["/o/b~23~m.lower.head.json", "uno\n"],
  ]);
});

Deno.test("the command exits with 0 for equal records and uses a temporary directory without --out", async () => {
  const log = newLog();
  const status = await runCommand(
    ["base", "head"],
    boundary({ base: [A], head: [A] }, log),
  );
  assertEquals(status, 0);
  assertEquals(log.lines.at(-1), "output: /tmp/out");
  assertEquals(log.files.size, 0);
});

Deno.test("the command with one revision writes its records and prints the counts", async () => {
  const log = newLog();
  const status = await runCommand(
    ["only", "--out", "/o"],
    boundary({ only: [A, B] }, log),
  );
  assertEquals(status, 0);
  assertEquals(log.lines.slice(0, 2), [
    "records only only ",
    "check: 1 records",
  ]);
  assertEquals(log.lines.at(-1), "output: /o");
  assertEquals(log.files.size, 1);
  assertEquals(
    log.files.get("/o/records.json"),
    `{"records":[{"kind":"check","name":"a","text":"[]"},{"kind":"lower","name":"b#m","text":"\\"one\\""}]}\n`,
  );
});

Deno.test("the command exits with 2 for a usage error and for a failed run", async () => {
  const usage = newLog();
  assertEquals(await runCommand([], boundary({}, usage)), 2);
  assertEquals(usage.errors, [USAGE]);
  const failed = newLog();
  assertEquals(
    await runCommand(["base", "gone"], boundary({ base: [A] }, failed)),
    2,
  );
  assertEquals(failed.errors, ["cannot export gone"]);
  assertEquals(failed.files.size, 0);
});
