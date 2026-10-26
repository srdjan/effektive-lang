// Tests of the pure parts of the playground replay: applying edits, the steps
// of a session file, and the timed player.

import { assertEquals } from "@std/assert";
import {
  applyChanges,
  MAX_WAIT_MS,
  play,
  type ReplayStep,
  stepsOf,
} from "../playground/src/replay.ts";

Deno.test("applyChanges applies the changes from the last to the first", () => {
  assertEquals(
    applyChanges("abcdef", [
      { from: 1, to: 2, insert: "XY" },
      { from: 4, to: 6, insert: "" },
    ]),
    "aXYcd",
  );
  assertEquals(applyChanges("abc", []), "abc");
});

const line = (ms: number, kind: string, data: unknown) =>
  JSON.stringify({ ms, kind, data });

Deno.test("stepsOf keeps selects and edits, with capped waits", () => {
  const text = [
    line(10, "pg.start", {}),
    line(20, "pg.select", { path: "main.eff", by: "start" }),
    line(30, "pg.compile", { path: "main.eff" }),
    line(130, "pg.edit", {
      path: "main.eff",
      changes: [{ from: 0, to: 0, insert: "x" }],
      length: 1,
    }),
    line(130 + MAX_WAIT_MS + 5000, "pg.select", {
      path: "users.eff",
      by: "click",
    }),
    "not json",
    line(9e9, "pg.edit", { path: "main.eff", changes: [{ from: "0" }] }),
  ].join("\n");
  assertEquals(stepsOf(text), [
    { tag: "select", path: "main.eff", waitMs: 20 },
    {
      tag: "edit",
      path: "main.eff",
      changes: [{ from: 0, to: 0, insert: "x" }],
      waitMs: 110,
    },
    { tag: "select", path: "users.eff", waitMs: MAX_WAIT_MS },
  ]);
});

Deno.test("play waits before each step and runs the steps in order", async () => {
  const steps: ReplayStep[] = [
    { tag: "select", path: "a", waitMs: 5 },
    { tag: "select", path: "b", waitMs: 7 },
  ];
  const trace: string[] = [];
  await play(
    steps,
    (step) => trace.push(`run ${step.tag === "select" ? step.path : ""}`),
    (ms) => {
      trace.push(`wait ${ms}`);
      return Promise.resolve();
    },
  );
  assertEquals(trace, ["wait 5", "run a", "wait 7", "run b"]);
});
