// The oracle for the lexer. It lexes a fixed corpus of 20,000 random strings
// from a fixed seed over the lexer alphabet. It writes one hash of the lexer
// output for each string into fixtures/lex/snapshot.json.
// tests/lex_snapshot_test.ts regenerates the corpus and compares the hashes, so
// a change of the lexer output for any string shows as a failure.
//
// The snapshot records the lexer of the revision that wrote it. Run
// `deno task lex:update` only after a deliberate change of the lexer output. A
// refactor of the lexer must not run it.

import { lex } from "../src/core/mod.ts";
import type { Lexed } from "../src/core/lex.ts";
import { prettyJson } from "./lib.ts";

/** The number of random strings. */
export const RANDOM_COUNT = 20_000;

/** The seed of the random strings. */
export const SEED = 0x1ec5;

/**
 * The alphabet of the random strings: quotes, escapes, CR, LF, digits,
 * exponents, operators, brackets, a byte-order mark, non-ASCII letters, an
 * astral character, and a lone high surrogate.
 */
const ALPHABET: readonly string[] = [
  ..." \t\n\r\"'`\\u0aZz_$09.eE+-*/|&=!<>()[]{},:;?@#x01",
  "é",
  "ü",
  " ",
  "﻿",
  "\u{1F600}",
  "\ud83d",
];

/** A small seeded generator (mulberry32). It returns numbers in [0, 1). */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The random strings. The same seed always gives the same strings. */
export function randomInputs(count: number = RANDOM_COUNT): string[] {
  const next = generator(SEED);
  const inputs: string[] = [];
  for (let k = 0; k < count; k++) {
    const length = Math.floor(next() * 40);
    let text = "";
    for (let i = 0; i < length; i++) {
      text += ALPHABET[Math.floor(next() * ALPHABET.length)];
    }
    inputs.push(text);
  }
  return inputs;
}

/** A 64-bit hash (two 32-bit FNV style lanes) of a text, as 16 hex digits. */
function hashText(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The hash of the whole lexer output of a text: tokens, trivia, and diagnostics. */
export function lexHash(text: string): string {
  const lexed: Lexed = lex("f", text);
  return hashText(JSON.stringify([
    Array.from(lexed.kinds),
    Array.from(lexed.starts),
    Array.from(lexed.ends),
    Array.from(lexed.trivia.kinds),
    Array.from(lexed.trivia.starts),
    Array.from(lexed.trivia.ends),
    Array.from(lexed.triviaEnd),
    lexed.diagnostics,
  ]));
}

/** The content of the snapshot file. */
export interface LexSnapshot {
  readonly seed: number;
  readonly randomCount: number;
  /** The lexer hashes of the random strings, 16 hex digits each, in order. */
  readonly random: string;
}

export function buildSnapshot(random: readonly string[]): LexSnapshot {
  return {
    seed: SEED,
    randomCount: random.length,
    random: random.map(lexHash).join(""),
  };
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  const snapshot = buildSnapshot(randomInputs());
  const target = new URL("fixtures/lex/snapshot.json", root);
  await Deno.mkdir(new URL("./", target), { recursive: true });
  await Deno.writeTextFile(target, prettyJson(snapshot));
  console.log(
    `wrote fixtures/lex/snapshot.json: ${snapshot.randomCount} random inputs`,
  );
}
