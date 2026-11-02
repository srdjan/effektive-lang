// The general Schedule names left the prelude (rebase unit G2). Each removed
// name is an ordinary unknown name, and a module can declare it.

import { assertEquals } from "@std/assert";
import { diagnosticsOf } from "./helpers.ts";

const INT = "type Int = int\n";

Deno.test("each removed Schedule builtin is an unknown name", () => {
  const cases: readonly (readonly [call: string, name: string])[] = [
    [
      "scheduleFromStep((): Int => 0, (state: Int): Int => state)",
      "scheduleFromStep",
    ],
    ["scheduleRecurs(3)", "scheduleRecurs"],
    ["scheduleExponential(100ms)", "scheduleExponential"],
    ['scheduleCron("* * * * *")', "scheduleCron"],
    ["scheduleJittered(1)", "scheduleJittered"],
    ["scheduleMap(1, 2)", "scheduleMap"],
    ["scheduleMax(1, 2)", "scheduleMax"],
    ["scheduleMin(1, 2)", "scheduleMin"],
    ["scheduleConcat(1, 2)", "scheduleConcat"],
    ["scheduleSpaced(5ms)", "scheduleSpaced"],
  ];
  for (const [call, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}const a = () => ${call}\n`),
      [`unknown-name/001 unknown name \`${name}\``],
      name,
    );
  }
});

Deno.test("aggregateWithinStream is an unknown name", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}const a = (s: Stream<Int>) => aggregateWithinStream(s, 1, 1)\n`,
    ),
    ["unknown-name/001 unknown name `aggregateWithinStream`"],
  );
});

Deno.test("the Schedule type names are unknown types", () => {
  const cases: readonly (readonly [annotation: string, name: string])[] = [
    ["Schedule<Int>", "Schedule"],
    ["ScheduleInput<Int>", "ScheduleInput"],
    ["ScheduleMetadata<Int, Int>", "ScheduleMetadata"],
    ["ScheduleDecision<Int, Int>", "ScheduleDecision"],
  ];
  for (const [annotation, name] of cases) {
    assertEquals(
      diagnosticsOf(`${INT}export const a = (s: ${annotation}): Int => 1\n`),
      [`unknown-name/001 unknown type \`${name}\``],
      name,
    );
  }
});

Deno.test("a module can declare the removed names", () => {
  assertEquals(
    diagnosticsOf(
      `${INT}type Schedule = Int
type ScheduleInput = Int
type ScheduleMetadata = Int
type ScheduleDecision = Int
export const scheduleRecurs = (n: Int): Int => n
export const aggregateWithinStream = (n: Int): Int => n
export const scheduleCron = (n: Int): Int => aggregateWithinStream(scheduleRecurs(n))
`,
    ),
    [],
  );
});
