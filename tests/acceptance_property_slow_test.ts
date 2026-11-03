// P4: a program that the checker accepts must pass the validator and must emit.
// The test edits the example programs and small generated projects at token
// level. The edits come from a fixed seed table. A program that the checker
// rejects only counts toward the totals. Nothing may throw in any case.

import { assertEquals } from "@std/assert";
import { allFiles, generateProject, makeRandom } from "../bench/generate.ts";
import { lex, Program, TokenKind } from "../src/core/frontend.ts";
import { TypeScriptOutputs } from "../src/core/typescript.ts";
import { exampleFiles } from "./helpers.ts";
import { validateRevision } from "./validate_helpers.ts";

type Files = Record<string, string>;
type Random = () => number;

interface Tokens {
  /** The text before each token: whitespace and comments. */
  readonly gaps: readonly string[];
  readonly texts: readonly string[];
  readonly kinds: readonly number[];
  /** The text after the last token. */
  readonly tail: string;
}

interface Edited {
  readonly text: string;
  readonly edit: string;
}

interface Tally {
  accepted: number;
  rejected: number;
  failures: string[];
}

/** Splits a file at its tokens. Joining the parts gives back the file. */
function tokenize(text: string): Tokens {
  const lexed = lex("input", text);
  const gaps: string[] = [];
  const texts: string[] = [];
  const kinds: number[] = [];
  let at = 0;
  for (let i = 0; i < lexed.count; i++) {
    const kind = lexed.kinds[i];
    if (kind === TokenKind.Eof) continue;
    gaps.push(text.slice(at, lexed.starts[i]));
    texts.push(text.slice(lexed.starts[i], lexed.ends[i]));
    kinds.push(kind);
    at = lexed.ends[i];
  }
  return { gaps, texts, kinds, tail: text.slice(at) };
}

function join(
  tokens: Tokens,
  texts: readonly string[],
): string {
  let out = "";
  for (let i = 0; i < texts.length; i++) {
    out += (tokens.gaps[i] ?? " ") + texts[i];
  }
  return out + tokens.tail;
}

function pick(random: Random, bound: number): number {
  return Math.floor(random() * bound);
}

/**
 * One token-level edit: delete a token, swap two adjacent tokens, replace a
 * token with another token of the same file, or duplicate a token. A
 * replacement takes a token of the same kind in four cases of five, which
 * keeps many programs valid.
 */
function editTokens(tokens: Tokens, random: Random): Edited {
  const count = tokens.texts.length;
  const at = pick(random, count);
  const texts = [...tokens.texts];
  const label = (what: string) =>
    `${what} token ${at} ${JSON.stringify(texts[at])}`;
  const choice = pick(random, 8);
  if (choice < 1) {
    const edit = label("delete");
    texts.splice(at, 1);
    return { text: join(tokens, texts), edit };
  }
  if (choice < 3 && at + 1 < count) {
    const edit = `swap tokens ${at} ${JSON.stringify(texts[at])} and ${
      at + 1
    } ${JSON.stringify(texts[at + 1])}`;
    [texts[at], texts[at + 1]] = [texts[at + 1], texts[at]];
    return { text: join(tokens, texts), edit };
  }
  if (choice < 4) {
    const edit = label("duplicate");
    texts.splice(at, 0, texts[at]);
    return { text: join(tokens, texts), edit };
  }
  const sameKind = pick(random, 5) < 4;
  const pool = tokens.texts
    .map((_, i) => i)
    .filter((i) =>
      i !== at && (!sameKind || tokens.kinds[i] === tokens.kinds[at])
    );
  if (pool.length === 0) return { text: join(tokens, texts), edit: "none" };
  const from = pool[pick(random, pool.length)];
  const edit = `${label("replace")} with token ${from} ${
    JSON.stringify(tokens.texts[from])
  }`;
  texts[at] = tokens.texts[from];
  return { text: join(tokens, texts), edit };
}

/** Runs the full path for one edited project and records the outcome. */
function runPath(
  files: Files,
  context: string,
  tally: Tally,
  outputs: TypeScriptOutputs,
): void {
  try {
    const updated = new Program().update({ set: files });
    if (!updated.ok) {
      tally.rejected++;
      return;
    }
    const revision = updated.value;
    if (revision.diagnostics.length > 0) {
      tally.rejected++;
      return;
    }
    tally.accepted++;
    for (const name of revision.moduleNames()) {
      const lowered = revision.lowered(name);
      if (lowered === undefined || !lowered.ok) {
        tally.failures.push(
          `${context} module ${name}: lowering failed: ${
            JSON.stringify(lowered)
          }`,
        );
        continue;
      }
      const findings = validateRevision(revision, new Map([[name, lowered]]))
        .get(name);
      if (findings === undefined || findings.length > 0) {
        tally.failures.push(
          `${context} module ${name}: validator findings: ${
            JSON.stringify(findings)
          }`,
        );
        continue;
      }
      const emitted = outputs.emitted(revision, name);
      if (emitted === undefined || !emitted.ok) {
        tally.failures.push(
          `${context} module ${name}: emission failed: ${
            JSON.stringify(emitted)
          }`,
        );
      }
    }
  } catch (error) {
    tally.failures.push(`${context}: threw ${String(error)}`);
  }
}

/** Edits `editsPerFile` times each `.eff` file of a project. */
function exercise(
  base: Files,
  seed: number,
  editsPerFile: number,
  tally: Tally,
): void {
  const outputs = new TypeScriptOutputs();
  const random = makeRandom(seed);
  for (const path of Object.keys(base).filter((p) => p.endsWith(".eff"))) {
    const tokens = tokenize(base[path]);
    for (let n = 0; n < editsPerFile; n++) {
      const edited = editTokens(tokens, random);
      runPath(
        { ...base, [path]: edited.text },
        `seed ${seed} file ${path} edit ${n} (${edited.edit})`,
        tally,
        outputs,
      );
    }
  }
}

function newTally(): Tally {
  return { accepted: 0, rejected: 0, failures: [] };
}

function assertNoFailures(tally: Tally): void {
  assertEquals(tally.failures.slice(0, 5), []);
}

const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

Deno.test("the original examples and generated projects are accepted", () => {
  const tally = newTally();
  runPath(exampleFiles(), "examples", tally, new TypeScriptOutputs());
  for (const seed of SEEDS) {
    const project = generateProject({ declarations: 8, seed });
    runPath(
      Object.fromEntries(allFiles(project)),
      `generated seed ${seed}`,
      tally,
      new TypeScriptOutputs(),
    );
  }
  assertNoFailures(tally);
  assertEquals(tally.accepted, 9);
  assertEquals(tally.rejected, 0);
});

Deno.test("token edits of the examples keep accepted programs valid and emittable", () => {
  const tally = newTally();
  for (const seed of SEEDS) exercise(exampleFiles(), seed, 40, tally);
  assertNoFailures(tally);
  assertEquals([tally.accepted, tally.rejected], [536, 1064]);
});

Deno.test("token edits of generated projects keep accepted programs valid and emittable", () => {
  const tally = newTally();
  for (const seed of SEEDS) {
    const project = generateProject({ declarations: 8, seed });
    exercise(Object.fromEntries(allFiles(project)), seed, 25, tally);
  }
  assertNoFailures(tally);
  assertEquals([tally.accepted, tally.rejected], [198, 402]);
});
