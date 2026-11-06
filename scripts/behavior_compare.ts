// Compares the compiler behavior of two git revisions on the named corpus of
// `scripts/behavior_corpus.ts`.
//
//   deno task behavior:compare <base-rev> <head-rev> [--out <dir>] [--only <prefix>]...
//   deno task behavior:compare <rev> [--out <dir>] [--only <prefix>]...
//
// The command exports each revision with `git archive` into a temporary tree,
// copies the runner of this checkout into the tree, and runs it there. Both
// runs read the corpus inputs from the tree of the head revision, so both
// compilers see the same inputs. The command prints one summary line for each
// record kind and the name of each changed or missing record. It writes the
// base and head result text of each changed or missing record to the output
// directory.
//
// Exit status: 0 when no record changed and none is missing. 1 when a record
// changed or is missing. 2 for a usage error or a failed run. With one
// revision, the command writes the records of that revision and exits with 0.

import { type Kind, KINDS, type Rec, type Res } from "./behavior_corpus.ts";
import { exportRevision, runChecked } from "./lib.ts";

// ------------------------------------------------------------------ arguments

export interface Options {
  /** One revision, or the base and the head. */
  readonly revisions: readonly string[];
  readonly out: string | undefined;
  readonly only: readonly string[];
}

export const USAGE =
  "usage: deno task behavior:compare <base-rev> [<head-rev>] [--out <dir>] [--only <prefix>]...";

/** Parses the arguments of the command. The error value is the usage text. */
export function parseArgs(args: readonly string[]): Res<Options> {
  const revisions: string[] = [];
  const only: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out" || arg === "--only") {
      const value = args[i + 1];
      if (value === undefined) return { ok: false, error: USAGE };
      i++;
      if (arg === "--out") out = value;
      else only.push(value);
    } else if (arg.startsWith("--")) {
      return { ok: false, error: USAGE };
    } else {
      revisions.push(arg);
    }
  }
  if (revisions.length < 1 || revisions.length > 2) {
    return { ok: false, error: USAGE };
  }
  return { ok: true, value: { revisions, out, only } };
}

// ------------------------------------------------------------------ comparison

export interface KindCounts {
  readonly equal: number;
  readonly changed: number;
  readonly missing: number;
  readonly added: number;
}

export interface Difference {
  readonly kind: Kind;
  readonly name: string;
  readonly base: string;
  /** The head text, or undefined when the head has no such record. */
  readonly head: string | undefined;
}

export interface Comparison {
  readonly counts: Readonly<Record<Kind, KindCounts>>;
  readonly changed: readonly Difference[];
  readonly missing: readonly Difference[];
}

function keyOf(r: Rec): string {
  return `${r.kind}\u0000${r.name}`;
}

function selected(r: Rec, only: readonly string[]): boolean {
  return only.length === 0 || only.some((p) => r.name.startsWith(p));
}

/** Compares two record sets by kind and case name. `only` keeps the names that start with a prefix. */
export function compareRecords(
  base: readonly Rec[],
  head: readonly Rec[],
  only: readonly string[] = [],
): Comparison {
  const baseRecords = base.filter((r) => selected(r, only));
  const headRecords = new Map(
    head.filter((r) => selected(r, only)).map((r) => [keyOf(r), r]),
  );
  const tally = new Map<Kind, { -readonly [K in keyof KindCounts]: number }>(
    KINDS.map((k) => [k, { equal: 0, changed: 0, missing: 0, added: 0 }]),
  );
  const changed: Difference[] = [];
  const missing: Difference[] = [];
  const seen = new Set<string>();
  for (const record of baseRecords) {
    const counts = tally.get(record.kind);
    if (counts === undefined) continue;
    const key = keyOf(record);
    seen.add(key);
    const other = headRecords.get(key);
    if (other === undefined) {
      counts.missing++;
      missing.push({
        kind: record.kind,
        name: record.name,
        base: record.text,
        head: undefined,
      });
    } else if (other.text !== record.text) {
      counts.changed++;
      changed.push({
        kind: record.kind,
        name: record.name,
        base: record.text,
        head: other.text,
      });
    } else {
      counts.equal++;
    }
  }
  for (const [key, record] of headRecords) {
    if (!seen.has(key)) tally.get(record.kind)!.added++;
  }
  return {
    counts: Object.fromEntries(tally) as Record<Kind, KindCounts>,
    changed,
    missing,
  };
}

/** One summary line for each kind. */
function summaryLines(comparison: Comparison): string[] {
  return KINDS.map((kind) => {
    const c = comparison.counts[kind];
    return `${kind}: ${c.equal} equal, ${c.changed} changed, ${c.missing} missing, ${c.added} added`;
  });
}

/** The summary lines, then one line for each changed record and each missing record. */
export function reportLines(comparison: Comparison): string[] {
  return [
    ...summaryLines(comparison),
    ...comparison.changed.map((d) => `changed: ${d.kind} ${d.name}`),
    ...comparison.missing.map((d) => `missing: ${d.kind} ${d.name}`),
  ];
}

/** 0 when nothing changed and nothing is missing, else 1. */
export function exitStatus(comparison: Comparison): 0 | 1 {
  return comparison.changed.length + comparison.missing.length === 0 ? 0 : 1;
}

/** The counts of one record set, one line for each kind. */
export function countLines(records: readonly Rec[]): string[] {
  return KINDS.map((kind) =>
    `${kind}: ${records.filter((r) => r.kind === kind).length} records`
  );
}

/** The records of a runner output file: `{ "records": [...] }`. */
export function parseRecords(text: string): Res<readonly Rec[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `the output is not JSON: ${error}` };
  }
  if (
    typeof parsed !== "object" || parsed === null || !("records" in parsed) ||
    !Array.isArray(parsed.records)
  ) return { ok: false, error: "the output has no records list" };
  return { ok: true, value: parsed.records as Rec[] };
}

// ------------------------------------------------------------------ output files

/**
 * A file-name part for a case name. A slash becomes two underscores. A
 * character outside letters, digits, dot, underscore, and hyphen becomes its
 * code in hexadecimal between two tildes.
 */
export function safeName(name: string): string {
  return [...name].map((c) =>
    c === "/"
      ? "__"
      : /[A-Za-z0-9._-]/.test(c)
      ? c
      : `~${c.codePointAt(0)!.toString(16)}~`
  ).join("");
}

/** The text of a record, formatted for reading when it holds JSON. */
export function prettyText(text: string): string {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
}

/** The files to write for the differences: file name and text. */
export function differenceFiles(
  comparison: Comparison,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const d of [...comparison.changed, ...comparison.missing]) {
    const stem = `${safeName(d.name)}.${d.kind}`;
    files.set(`${stem}.base.json`, prettyText(d.base) + "\n");
    if (d.head !== undefined) {
      files.set(`${stem}.head.json`, prettyText(d.head) + "\n");
    }
  }
  return files;
}

// ------------------------------------------------------------------ the command

/** The boundary of the command: the exports, the runs, the files, and the output. */
export interface Deps {
  /** The records of one revision. `fixturesFrom` is the head revision. */
  records(
    revision: string,
    fixturesFrom: string,
    only: readonly string[],
  ): Promise<Res<readonly Rec[]>>;
  makeTempDir(): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  log(line: string): void;
  fail(line: string): void;
}

/** Runs the command and returns its exit status. */
export async function runCommand(
  args: readonly string[],
  deps: Deps,
): Promise<number> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    deps.fail(String(parsed.error));
    return 2;
  }
  const { revisions, only } = parsed.value;
  const head = revisions[revisions.length - 1];
  const runs = await Promise.all(
    revisions.map((revision) => deps.records(revision, head, only)),
  );
  for (const run of runs) {
    if (!run.ok) {
      deps.fail(String(run.error));
      return 2;
    }
  }
  const sets = runs.map((run) => (run as { value: readonly Rec[] }).value);
  const out = parsed.value.out ?? await deps.makeTempDir();
  if (sets.length === 1) {
    await deps.writeFile(
      `${out}/records.json`,
      JSON.stringify({ records: sets[0] }) + "\n",
    );
    for (const line of countLines(sets[0])) deps.log(line);
    deps.log(`output: ${out}`);
    return 0;
  }
  const comparison = compareRecords(sets[0], sets[1], only);
  for (const [name, text] of differenceFiles(comparison)) {
    await deps.writeFile(`${out}/${name}`, text);
  }
  for (const line of reportLines(comparison)) deps.log(line);
  deps.log(`output: ${out}`);
  return exitStatus(comparison);
}

// ------------------------------------------------------------------ real boundary

/** Exports a revision into a new directory and returns the directory. */
async function exportRevisionTree(revision: string): Promise<Res<string>> {
  const tree = await Deno.makeTempDir({ prefix: "effektive-compare-" });
  const archive = `${tree}.tar`;
  try {
    const exported = await exportRevision(revision, {
      archive,
      destinations: [tree],
      failure: "tail",
    });
    if (exported.ok) return { ok: true, value: tree };
    await Deno.remove(tree, { recursive: true });
    return { ok: false, error: `cannot export ${revision}: ${exported.error}` };
  } finally {
    await Deno.remove(archive).catch(() => {});
  }
}

const trees = new Map<string, Promise<Res<string>>>();

/** The exported tree of a revision. A revision is exported once. */
function treeOf(revision: string): Promise<Res<string>> {
  let tree = trees.get(revision);
  if (tree === undefined) {
    tree = exportRevisionTree(revision);
    trees.set(revision, tree);
  }
  return tree;
}

let runCount = 0;

const realDeps: Deps = {
  async records(revision, fixturesFrom, only) {
    const tree = await treeOf(revision);
    const fixtures = await treeOf(fixturesFrom);
    if (!tree.ok) return tree;
    if (!fixtures.ok) return fixtures;
    const runner = await Deno.readTextFile(
      new URL("./behavior_corpus.ts", import.meta.url),
    );
    const copy = `${tree.value}/scripts/behavior_corpus.ts`;
    await Deno.writeTextFile(copy, runner);
    const out = `${tree.value}/behavior.records.${runCount++}.json`;
    const ran = await runChecked(
      "deno",
      [
        "run",
        "--allow-read",
        "--allow-write",
        copy,
        "--tree",
        tree.value,
        "--fixtures",
        `${fixtures.value}/fixtures`,
        "--out",
        out,
        ...only.flatMap((p) => ["--only", p]),
      ],
      "tail",
      { cwd: tree.value },
    );
    if (!ran.ok) {
      return { ok: false, error: `run at ${revision}: ${ran.error}` };
    }
    const parsed = parseRecords(await Deno.readTextFile(out));
    return parsed.ok ? parsed : {
      ok: false,
      error: `run at ${revision}: ${parsed.error}`,
    };
  },
  makeTempDir: () => Deno.makeTempDir({ prefix: "effektive-behavior-" }),
  async writeFile(path, text) {
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, text);
  },
  log: (line) => console.log(line),
  fail: (line) => console.error(line),
};

if (import.meta.main) {
  let status = 2;
  try {
    status = await runCommand(Deno.args, realDeps);
  } finally {
    for (const tree of trees.values()) {
      const done = await tree;
      if (done.ok) {
        await Deno.remove(done.value, { recursive: true }).catch(() => {});
      }
    }
  }
  Deno.exit(status);
}
