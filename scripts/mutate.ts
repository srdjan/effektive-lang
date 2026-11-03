// Measures which faults the fast tests detect. Run
// `deno task mutate [--seed N] [--sample <n|all>] [--workers N] [--tests <file>]
// [--only <path:line>]... <module>...`. Each `--only` adds one site. The
// defaults are seed 1, sample all, and workers 4. The tool never edits the
// working tree. It makes one `git archive HEAD` copy for each worker under a
// temporary directory, so it tests the committed HEAD, and it removes the
// copies when it ends.
//
// A mutant is one small change of one source site: a comparison flip (`===`
// and `!==`, `<` and `<=`, `>` and `>=`), a swap of `&&` and `||`, a negated
// `if` condition, or a flipped `return true` or `return false`. The scan skips
// type nodes. First the tool runs the test set on a clean copy with type
// checks, and it exits 2 when that run fails. Then it runs the test set once
// for each mutant, without type checks, with `--fail-fast`, and with a limit
// of 60 s. The default test set is the fast suite. `--tests <file>` runs only
// that file.
//
// Each result has one class. A mutant is killed when a test ran and failed. It
// survives when tests ran and all passed. It times out when the limit passes,
// and a timeout counts as killed but the report lists it. A crash after a test
// started also counts as killed, because the mutant broke the run. It is an
// infrastructure error when no test ran, and that gives exit 2.
//
// The register `fixtures/mutation/survivors.json` lists the survivors that the
// project accepts. A row holds `file`, `declaration` (the enclosing function
// or method, or `<module>`), `offset` (characters from the start of the
// declaration to the expression), `text` (the exact source of the expression),
// `operator` (`comparison`, `logical`, `negate-if`, or `boolean-return`),
// `class`, and `reason`. The class `equivalent` means no input can observe the
// change. The class `slow-only` means a `*_slow_test.ts` file kills the
// mutant, and the reason names that file. A row holds no line number.
//
// Exit 0: no survivor lacks a row, and no row is stale. Exit 1: a survivor
// lacks a row, or a row of a scanned file matches no site. Exit 2: the clean
// run failed, a run was an infrastructure error, the register is malformed, or
// the arguments are bad. The stale check uses all sites of each scanned file.

import { dirname, fromFileUrl, join } from "@std/path";
import ts from "typescript";
import type { Result } from "../src/core/mod.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const REGISTER_PATH = "fixtures/mutation/survivors.json";
const MUTANT_LIMIT_MS = 60_000;
const CLEAN_LIMIT_MS = 600_000;

export type Operator =
  | "comparison"
  | "logical"
  | "negate-if"
  | "boolean-return";

/** One mutation site: where it is, what it replaces, and what replaces it. */
export interface Mutant {
  readonly file: string;
  /** Line (from 1) of the start of the replaced range. */
  readonly line: number;
  readonly operator: Operator;
  readonly declaration: string;
  /** Characters from the start of the declaration to the start of `text`. */
  readonly offset: number;
  /** The exact source of the whole expression. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const SWAPS: ReadonlyMap<ts.SyntaxKind, { to: string; op: Operator }> = new Map(
  [
    [ts.SyntaxKind.EqualsEqualsEqualsToken, { to: "!==", op: "comparison" }],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, {
      to: "===",
      op: "comparison",
    }],
    [ts.SyntaxKind.LessThanToken, { to: "<=", op: "comparison" }],
    [ts.SyntaxKind.LessThanEqualsToken, { to: "<", op: "comparison" }],
    [ts.SyntaxKind.GreaterThanToken, { to: ">=", op: "comparison" }],
    [ts.SyntaxKind.GreaterThanEqualsToken, { to: ">", op: "comparison" }],
    [ts.SyntaxKind.AmpersandAmpersandToken, { to: "||", op: "logical" }],
    [ts.SyntaxKind.BarBarToken, { to: "&&", op: "logical" }],
  ],
);

function isFunctionLike(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) || ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node);
}

/** The name that a declaration node adds to a qualified name, if any. */
function nameOf(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isClassExpression(node)
  ) {
    return node.name?.getText(sf);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (
      ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent)
    ) {
      return parent.name.getText(sf);
    }
  }
  return undefined;
}

/**
 * The enclosing declaration of a node: its qualified name and the start of its
 * innermost named function. A node outside a named function belongs to
 * `<module>`, which starts at offset 0.
 */
function declarationOf(
  node: ts.Node,
  sf: ts.SourceFile,
): { name: string; start: number } {
  let boundary: ts.Node | undefined;
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (isFunctionLike(n) && nameOf(n, sf) !== undefined) {
      boundary = n;
      break;
    }
  }
  if (boundary === undefined) return { name: "<module>", start: 0 };
  const chain: string[] = [];
  for (let n: ts.Node | undefined = boundary; n; n = n.parent) {
    const name = nameOf(n, sf);
    if (name !== undefined) chain.unshift(name);
  }
  return { name: chain.join("."), start: boundary.getStart(sf) };
}

/** Every mutation site of a source file, in source order. */
export function mutantsOf(file: string, source: string): Mutant[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const out: Mutant[] = [];
  const add = (
    site: ts.Node,
    range: ts.Node,
    operator: Operator,
    replacement: string,
  ) => {
    const start = range.getStart(sf);
    const decl = declarationOf(site, sf);
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      operator,
      declaration: decl.name,
      offset: site.getStart(sf) - decl.start,
      text: site.getText(sf),
      start,
      end: range.getEnd(),
      replacement,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isBinaryExpression(node)) {
      const swap = SWAPS.get(node.operatorToken.kind);
      if (swap !== undefined) add(node, node.operatorToken, swap.op, swap.to);
    } else if (ts.isIfStatement(node)) {
      add(
        node.expression,
        node.expression,
        "negate-if",
        `!(${node.expression.getText(sf)})`,
      );
    } else if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const kind = node.expression.kind;
      if (
        kind === ts.SyntaxKind.TrueKeyword ||
        kind === ts.SyntaxKind.FalseKeyword
      ) {
        add(
          node,
          node.expression,
          "boolean-return",
          kind === ts.SyntaxKind.TrueKeyword ? "false" : "true",
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The source text after the mutant is applied. */
export function applyMutant(source: string, mutant: Mutant): string {
  return source.slice(0, mutant.start) + mutant.replacement +
    source.slice(mutant.end);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The items to test, in source order. `"all"` keeps every item. A number keeps
 * that many items, chosen by a shuffle that the seed fixes.
 */
export function selectSample<T>(
  items: readonly T[],
  sample: number | "all",
  seed: number,
): T[] {
  if (sample === "all" || sample >= items.length) return [...items];
  const order = items.map((_, index) => index);
  const next = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, sample).sort((a, b) => a - b).map((i) => items[i]!);
}

export type MutantClass =
  | "killed"
  | "survived"
  | "timeout"
  | "infrastructure";

/** What one test run left: the output text and whether the limit passed. */
export interface RunOutput {
  readonly timedOut: boolean;
  readonly output: string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const SUMMARY = /^(ok|FAILED) \| (\d+) passed.*? \| (\d+) failed/m;
const TEST_LINE = / \.\.\. (?:ok|FAILED)/;

/** Classifies one test run from its Deno summary line. */
export function classify(run: RunOutput): MutantClass {
  if (run.timedOut) return "timeout";
  const text = run.output.replace(ANSI, "");
  const match = SUMMARY.exec(text);
  if (match === null) {
    return TEST_LINE.test(text) ? "killed" : "infrastructure";
  }
  const passed = Number(match[2]);
  const failed = Number(match[3]);
  if (passed + failed === 0) return "infrastructure";
  if (match[1] === "FAILED" && failed >= 1) return "killed";
  if (match[1] === "ok" && passed >= 1) return "survived";
  return "infrastructure";
}

export type RegisterClass = "equivalent" | "slow-only";

export interface RegisterRow {
  readonly file: string;
  readonly declaration: string;
  readonly offset: number;
  readonly text: string;
  readonly operator: Operator;
  readonly class: RegisterClass;
  readonly reason: string;
}

const OPERATORS: readonly string[] = [
  "comparison",
  "logical",
  "negate-if",
  "boolean-return",
];

/** Parses the register text. A bad shape gives an error, not an exception. */
export function parseRegister(text: string): Result<RegisterRow[], string> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${(error as Error).message}` };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: "the register must be an array" };
  }
  const rows: RegisterRow[] = [];
  for (const [index, raw] of (data as unknown[]).entries()) {
    const where = `row ${index}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `${where} must be an object` };
    }
    const row = raw as Record<string, unknown>;
    for (const key of ["file", "declaration", "text", "reason"]) {
      if (typeof row[key] !== "string") {
        return { ok: false, error: `${where}: "${key}" must be a string` };
      }
    }
    const offset = row.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      return {
        ok: false,
        error: `${where}: "offset" must be a non-negative integer`,
      };
    }
    if (typeof row.operator !== "string" || !OPERATORS.includes(row.operator)) {
      return {
        ok: false,
        error: `${where}: "operator" must be one of ${OPERATORS.join(", ")}`,
      };
    }
    const reason = row.reason as string;
    if (row.class === "equivalent") {
      if (reason.trim() === "") {
        return { ok: false, error: `${where}: "reason" must not be empty` };
      }
    } else if (row.class === "slow-only") {
      if (!reason.includes("_slow_test.ts")) {
        return {
          ok: false,
          error: `${where}: a slow-only reason must name a *_slow_test.ts file`,
        };
      }
    } else {
      return {
        ok: false,
        error: `${where}: "class" must be equivalent or slow-only`,
      };
    }
    rows.push({
      file: row.file as string,
      declaration: row.declaration as string,
      offset,
      text: row.text as string,
      operator: row.operator as Operator,
      class: row.class,
      reason,
    });
  }
  return { ok: true, value: rows };
}

type SiteKey = Pick<
  Mutant,
  "file" | "declaration" | "offset" | "text" | "operator"
>;

function keyOf(site: SiteKey): string {
  return JSON.stringify([
    site.file,
    site.declaration,
    site.offset,
    site.operator,
    site.text,
  ]);
}

/** The register row to paste for a mutant, with an empty class and reason. */
export function rowOf(
  mutant: Mutant,
  row?: RegisterRow,
): Record<string, unknown> {
  return {
    file: mutant.file,
    declaration: mutant.declaration,
    offset: mutant.offset,
    text: mutant.text,
    operator: mutant.operator,
    class: row?.class ?? "",
    reason: row?.reason ?? "",
  };
}

export interface RegisterMatch {
  /** Survivors that a row covers, each with its row. */
  readonly registered: { mutant: Mutant; row: RegisterRow }[];
  /** Survivors that no row covers. */
  readonly unregistered: Mutant[];
  /** Rows of a scanned file that do not match exactly one site. */
  readonly stale: RegisterRow[];
}

/**
 * Matches the register against the sites. `sites` holds all sites of every
 * scanned file, `survivors` holds the survivors. A row of a scanned file must
 * match exactly one site, or it is stale.
 */
export function matchRegister(
  sites: readonly Mutant[],
  survivors: readonly Mutant[],
  register: readonly RegisterRow[],
  scannedFiles: readonly string[],
): RegisterMatch {
  const siteCount = new Map<string, number>();
  for (const site of sites) {
    siteCount.set(keyOf(site), (siteCount.get(keyOf(site)) ?? 0) + 1);
  }
  const scanned = new Set(scannedFiles);
  const rows = register.filter((row) => scanned.has(row.file));
  const stale = rows.filter((row) => siteCount.get(keyOf(row)) !== 1);
  const rowByKey = new Map(rows.map((row) => [keyOf(row), row]));
  const registered: { mutant: Mutant; row: RegisterRow }[] = [];
  const unregistered: Mutant[] = [];
  for (const mutant of survivors) {
    const row = rowByKey.get(keyOf(mutant));
    if (row === undefined) unregistered.push(mutant);
    else registered.push({ mutant, row });
  }
  return { registered, unregistered, stale };
}

export interface Options {
  readonly seed: number;
  readonly sample: number | "all";
  readonly workers: number;
  readonly tests: string | undefined;
  /** The sites to mutate. Empty means every site of the modules. */
  readonly only: readonly { readonly file: string; readonly line: number }[];
  readonly modules: readonly string[];
}

function positiveInt(text: string): number | undefined {
  return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : undefined;
}

/** Parses the command line. */
export function parseOptions(args: readonly string[]): Result<Options, string> {
  let seed = 1;
  let sample: number | "all" = "all";
  let workers = 4;
  let tests: string | undefined;
  const only: { file: string; line: number }[] = [];
  const modules: string[] = [];
  const list = [...args];
  while (list.length > 0) {
    const arg = list.shift()!;
    if (!arg.startsWith("--")) {
      modules.push(arg.replace(/^\.\//, ""));
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? list.shift() : arg.slice(eq + 1);
    if (value === undefined) {
      return { ok: false, error: `${flag} needs a value` };
    }
    if (flag === "--seed") {
      if (!/^\d+$/.test(value)) {
        return { ok: false, error: "--seed must be a non-negative integer" };
      }
      seed = Number(value);
    } else if (flag === "--sample") {
      const n = value === "all" ? "all" : positiveInt(value);
      if (n === undefined) {
        return {
          ok: false,
          error: "--sample must be a positive integer or all",
        };
      }
      sample = n;
    } else if (flag === "--workers") {
      const n = positiveInt(value);
      if (n === undefined) {
        return { ok: false, error: "--workers must be a positive integer" };
      }
      workers = n;
    } else if (flag === "--tests") {
      tests = value;
    } else if (flag === "--only") {
      const colon = value.lastIndexOf(":");
      const line = colon < 0 ? undefined : positiveInt(value.slice(colon + 1));
      if (line === undefined) {
        return { ok: false, error: "--only must be <path:line>" };
      }
      only.push({ file: value.slice(0, colon).replace(/^\.\//, ""), line });
    } else {
      return { ok: false, error: `unknown flag ${flag}` };
    }
  }
  if (modules.length === 0) {
    return { ok: false, error: "name at least one module" };
  }
  for (const module of modules) {
    if (
      !module.endsWith(".ts") || module.startsWith("/") ||
      module.split("/").includes("..")
    ) {
      return {
        ok: false,
        error: `${module} must be a relative path of a .ts file`,
      };
    }
  }
  return { ok: true, value: { seed, sample, workers, tests, only, modules } };
}

/** The `deno test` arguments of the clean run (`check`) or a mutant run. */
export function testArgs(tests: string | undefined, check: boolean): string[] {
  const noCheck = check ? [] : ["--no-check"];
  return tests === undefined
    ? [
      "test",
      ...noCheck,
      "--allow-read",
      "--parallel",
      "--fail-fast",
      "--ignore=**/*_slow_test.ts",
      "tests/",
    ]
    : ["test", ...noCheck, "--allow-all", "--fail-fast", tests];
}

// ---- Process work ----

async function runDeno(
  cwd: string,
  args: string[],
  limitMs: number,
): Promise<RunOutput> {
  const child = new Deno.Command("deno", {
    args,
    cwd,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process already ended.
    }
  }, limitMs);
  const result = await child.output();
  clearTimeout(timer);
  const decoder = new TextDecoder();
  return {
    timedOut,
    output: decoder.decode(result.stdout) + "\n" +
      decoder.decode(result.stderr),
  };
}

async function run(
  command: string,
  args: string[],
  options: Deno.CommandOptions = {},
): Promise<Result<string, string>> {
  const result = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
    ...options,
  }).output();
  if (!result.success) {
    const message = new TextDecoder().decode(result.stderr).trim();
    return { ok: false, error: `${command} ${args[0]} failed: ${message}` };
  }
  return { ok: true, value: new TextDecoder().decode(result.stdout) };
}

async function makeCopies(
  base: string,
  count: number,
): Promise<Result<string[], string>> {
  const archive = join(base, "head.tar");
  const made = await run("git", [
    "archive",
    "--format=tar",
    "-o",
    archive,
    "HEAD",
  ], {
    cwd: ROOT,
  });
  if (!made.ok) return made;
  const dirs = Array.from({ length: count }, (_, i) => join(base, `w${i}`));
  const extracted = await Promise.all(dirs.map(async (dir) => {
    await Deno.mkdir(dir);
    return await run("tar", ["-xf", archive, "-C", dir]);
  }));
  for (const result of extracted) {
    if (!result.ok) return result;
  }
  return { ok: true, value: dirs };
}

interface Outcome {
  readonly mutant: Mutant;
  readonly class: MutantClass;
  readonly tail: string;
}

/** Runs every mutant on a pool of copies. Stops early on an infrastructure error. */
async function runMutants(
  copies: readonly string[],
  mutants: readonly Mutant[],
  tests: string | undefined,
): Promise<Outcome[]> {
  const outcomes: (Outcome | undefined)[] = mutants.map(() => undefined);
  let next = 0;
  let aborted = false;
  const worker = async (copy: string) => {
    while (!aborted && next < mutants.length) {
      const index = next++;
      const mutant = mutants[index]!;
      const path = join(copy, mutant.file);
      const original = await Deno.readTextFile(path);
      let result: RunOutput;
      try {
        await Deno.writeTextFile(path, applyMutant(original, mutant));
        result = await runDeno(copy, testArgs(tests, false), MUTANT_LIMIT_MS);
      } finally {
        await Deno.writeTextFile(path, original);
      }
      const cls = classify(result);
      if (cls === "infrastructure") aborted = true;
      outcomes[index] = {
        mutant,
        class: cls,
        tail: result.output.trim().split("\n").slice(-20).join("\n"),
      };
    }
  };
  await Promise.all(copies.map(worker));
  return outcomes.filter((outcome): outcome is Outcome =>
    outcome !== undefined
  );
}

function shorten(text: string): string {
  const first = text.split("\n")[0]!;
  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}

function describe(mutant: Mutant): string {
  return `${mutant.file}:${mutant.line} ${mutant.operator}: ` +
    `${shorten(mutant.text)} -> ${shorten(mutant.replacement)}`;
}

async function main(args: string[]): Promise<number> {
  const started = Date.now();
  const parsed = parseOptions(args);
  if (!parsed.ok) {
    console.error(`mutate: ${parsed.error}`);
    return 2;
  }
  const options = parsed.value;
  let registerText: string;
  try {
    registerText = await Deno.readTextFile(join(ROOT, REGISTER_PATH));
  } catch (error) {
    console.error(`mutate: cannot read ${REGISTER_PATH}: ${error}`);
    return 2;
  }
  const register = parseRegister(registerText);
  if (!register.ok) {
    console.error(`mutate: ${REGISTER_PATH}: ${register.error}`);
    return 2;
  }

  const base = await Deno.makeTempDir({ prefix: "effektive-mutate-" });
  try {
    const copies = await makeCopies(base, options.workers);
    if (!copies.ok) {
      console.error(`mutate: ${copies.error}`);
      return 2;
    }
    const clean = await runDeno(
      copies.value[0]!,
      testArgs(options.tests, true),
      CLEAN_LIMIT_MS,
    );
    if (clean.timedOut || classify(clean) !== "survived") {
      console.error("mutate: the clean run failed:");
      console.error(clean.output.trim().split("\n").slice(-30).join("\n"));
      return 2;
    }

    const sitesByModule = new Map<string, Mutant[]>();
    for (const module of options.modules) {
      let source: string;
      try {
        source = await Deno.readTextFile(join(copies.value[0]!, module));
      } catch {
        console.error(`mutate: ${module} is not a file in HEAD`);
        return 2;
      }
      sitesByModule.set(module, mutantsOf(module, source));
    }
    const sampled = new Map<string, Mutant[]>();
    for (const [module, sites] of sitesByModule) {
      const kept = options.only.length === 0
        ? sites
        : sites.filter((site) =>
          options.only.some((o) => site.file === o.file && site.line === o.line)
        );
      sampled.set(module, selectSample(kept, options.sample, options.seed));
    }
    const all = [...sampled.values()].flat();
    const outcomes = await runMutants(copies.value, all, options.tests);
    const broken = outcomes.find((outcome) =>
      outcome.class === "infrastructure"
    );
    if (broken !== undefined) {
      console.error(`mutate: no test ran for ${describe(broken.mutant)}:`);
      console.error(broken.tail);
      return 2;
    }

    const survivors = outcomes.filter((o) => o.class === "survived").map((o) =>
      o.mutant
    );
    const timeouts = outcomes.filter((o) => o.class === "timeout").map((o) =>
      o.mutant
    );
    console.log("module sites sampled killed survived timeout");
    for (const module of options.modules) {
      const mine = outcomes.filter((o) => o.mutant.file === module);
      const count = (cls: MutantClass) =>
        mine.filter((o) => o.class === cls).length;
      console.log(
        [
          module,
          sitesByModule.get(module)!.length,
          sampled.get(module)!.length,
          count("killed"),
          count("survived"),
          count("timeout"),
        ].join(" "),
      );
    }
    const allSites = [...sitesByModule.values()].flat();
    const match = matchRegister(
      allSites,
      survivors,
      register.value,
      options.modules,
    );
    const rowFor = new Map(match.registered.map((r) => [r.mutant, r.row]));
    for (const mutant of survivors) {
      console.log(describe(mutant));
      console.log(JSON.stringify(rowOf(mutant, rowFor.get(mutant))));
    }
    for (const mutant of timeouts) console.log(`timeout ${describe(mutant)}`);
    for (const row of match.stale) {
      console.log(`stale register row: ${JSON.stringify(row)}`);
    }
    console.log(
      `unregistered survivors ${match.unregistered.length}, stale rows ${match.stale.length}, ` +
        `elapsed ${Math.round((Date.now() - started) / 1000)} s`,
    );
    return match.unregistered.length === 0 && match.stale.length === 0 ? 0 : 1;
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
