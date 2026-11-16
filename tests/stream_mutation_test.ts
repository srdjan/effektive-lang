// Tests for the sink hint of a stream argument that sits inside parentheses.

import { assertEquals } from "@std/assert";
import { checkModule } from "./helpers.ts";

const PRELUDE = `export type Int = int
export type Text = string
export type Flag = boolean
export error Stop = {}
export service Count { tick(value: Int): Int fails Stop }
type Branch = Sink<Int, Text, Stop, Count.tick, Text>
`;

Deno.test("a parenthesized choice between named sinks keeps the unhinted check", () => {
  const project = checkModule(
    `${PRELUDE}export const named = (s: Stream<Int>, flag: Flag, a: Branch, b: Branch): Text fails Stop with Count.tick =>
  runStream(s, (if (flag) { a } else { b }))
`,
    "main.eff",
  );
  assertEquals(project.diagnostics, []);
});

Deno.test("a parenthesized takeSink gets the hint of its stream", () => {
  const project = checkModule(
    `${PRELUDE}export const firstTwo = (s: Stream<Int>): Int[] => runStream(s, (takeSink(2)))
`,
    "main.eff",
  );
  assertEquals(project.diagnostics, []);
});
