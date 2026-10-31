// The lexer oracle. fixtures/lex/snapshot.json holds one hash of the lexer
// output (kinds, starts, ends, trivia, triviaEnd, diagnostics) for each input of
// a fixed corpus. The test regenerates the corpus and compares every hash, so a
// refactor of src/core/lex.ts that changes the output for any input fails here.
// scripts/lex_snapshot.ts writes the snapshot.

import { assert, assertEquals } from "@std/assert";
import {
  lexHash,
  type LexSnapshot,
  RANDOM_COUNT,
  randomInputs,
  SEED,
} from "../scripts/lex_snapshot.ts";

const ROOT = new URL("../", import.meta.url);
const HASH_WIDTH = 16;

function readSnapshot(): LexSnapshot {
  return JSON.parse(
    Deno.readTextFileSync(new URL("fixtures/lex/snapshot.json", ROOT)),
  );
}

Deno.test("the lexer output of 20,000 random strings equals the snapshot", () => {
  const snapshot = readSnapshot();
  assertEquals(snapshot.seed, SEED);
  assertEquals(snapshot.randomCount, RANDOM_COUNT);
  assertEquals(snapshot.random.length, RANDOM_COUNT * HASH_WIDTH);
  const inputs = randomInputs(RANDOM_COUNT);
  const mismatches: string[] = [];
  inputs.forEach((text, index) => {
    const expected = snapshot.random.slice(
      index * HASH_WIDTH,
      (index + 1) * HASH_WIDTH,
    );
    if (lexHash(text) !== expected) {
      mismatches.push(`#${index} ${JSON.stringify(text)}`);
    }
  });
  assertEquals(mismatches.slice(0, 5), []);
  // The corpus must reach strings, escapes, and numbers, or it proves nothing.
  assert(inputs.some((text) => text.includes('"\\')));
  assert(inputs.some((text) => /[0-9][eE][+-]?[0-9]/.test(text)));
  assert(inputs.some((text) => text.includes("\u{1F600}")));
});
