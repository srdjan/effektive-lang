// The stream operators of rebase unit G7 left the prelude. Each removed name is
// an ordinary unknown name, and a module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed stream operator is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    ["mapGroups(1, 2)", "mapGroups"],
    ["scanStream(1, 2)", "scanStream"],
    ["mapAccumStream(1, 2)", "mapAccumStream"],
    ["foldStream(1, 2)", "foldStream"],
    ["foldEffectStream(1, 2)", "foldEffectStream"],
    ["collectStream(1, 2)", "collectStream"],
    ["headStream(1, 2)", "headStream"],
    ["lastStream(1, 2)", "lastStream"],
    ["drainStream(1, 2)", "drainStream"],
    ["aggregateStream(1, 2)", "aggregateStream"],
    ["mergeStreams(1, 2)", "mergeStreams"],
    ["zipStreams(1, 2)", "zipStreams"],
    ["concatStreams(1, 2)", "concatStreams"],
    ["flatMapStreams(1, 2)", "flatMapStreams"],
    ["switchMapStreams(1, 2)", "switchMapStreams"],
    ["catchStream(1, 2)", "catchStream"],
    ["retryStream(1, 2)", "retryStream"],
    ["debounceStream(1, 2)", "debounceStream"],
    ["throttleStream(1, 2)", "throttleStream"],
    ["takeStream(1, 2)", "takeStream"],
    ["dropStream(1, 2)", "dropStream"],
    ["filterEffectStream(1, 2)", "filterEffectStream"],
    ["takeWhileEffectStream(1, 2)", "takeWhileEffectStream"],
    ["takeUntilEffectStream(1, 2)", "takeUntilEffectStream"],
    ["dropWhileEffectStream(1, 2)", "dropWhileEffectStream"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("a module can declare the removed stream names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}export const mapGroups = (n: Int): Int => n
export const scanStream = (n: Int): Int => n
export const mapAccumStream = (n: Int): Int => n
export const foldStream = (n: Int): Int => n
export const foldEffectStream = (n: Int): Int => n
export const collectStream = (n: Int): Int => n
export const headStream = (n: Int): Int => n
export const lastStream = (n: Int): Int => n
export const drainStream = (n: Int): Int => n
export const aggregateStream = (n: Int): Int => n
export const mergeStreams = (n: Int): Int => n
export const zipStreams = (n: Int): Int => n
export const concatStreams = (n: Int): Int => n
export const flatMapStreams = (n: Int): Int => n
export const switchMapStreams = (n: Int): Int => n
export const catchStream = (n: Int): Int => n
export const retryStream = (n: Int): Int => n
export const debounceStream = (n: Int): Int => n
export const throttleStream = (n: Int): Int => n
export const takeStream = (n: Int): Int => n
export const dropStream = (n: Int): Int => n
export const filterEffectStream = (n: Int): Int => n
export const takeWhileEffectStream = (n: Int): Int => n
export const takeUntilEffectStream = (n: Int): Int => n
export const dropWhileEffectStream = (n: Int): Int => n
export const used = (n: Int): Int => mapGroups(scanStream(n))
`,
    ),
    [],
  );
});
