// Runtime behavior of `timeout` and `sleep` (unit ES2). Each test compiles one
// module with independent validation, type-checks the emitted TypeScript under
// the strict target options, and runs it.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  emitProject,
  lowerProject,
  memoryHost,
  validateProject,
} from "../src/core/mod.ts";
import { runStrictTarget } from "./target_helpers.ts";

async function compileAndRun(source: string, run: string): Promise<unknown> {
  const project = checkProject(
    memoryHost({ "effektive.json": "{}", "main.eff": source }),
    "",
    ["main.eff"],
  );
  assert(project.ok, JSON.stringify(project));
  assertEquals(project.value.diagnostics, []);
  const lowered = lowerProject(project.value);
  for (const result of lowered.values()) {
    assert(result.ok, JSON.stringify(result));
  }
  for (
    const diagnostics of validateProject(
      project.value.analysis.project,
      lowered,
    ).values()
  ) assertEquals(diagnostics, []);
  return JSON.parse(
    await runStrictTarget(
      emitProject(lowered, { config: project.value.analysis.project.config }),
      run,
      "effektive-timeout-",
    ),
  );
}

const SOURCE = `type Int = int
export service Files {
  open(): { wait: () => Int, close: () => void }
  mark(): Int
}
export const fast = (): Int fails TimeoutError => timeout(() => 7, 1s)
export const piped = (): Int fails TimeoutError => (() => 8) |> timeout(1s)
export const slow = (): Int uses Files.open | Files.mark =>
  try {
    timeout(
      () => withResource(() => Files.open(), (file) => file.wait(), (file) => file.close()),
      20ms
    )
  } catch {
    TimeoutError(e) => Files.mark()
  }
export const limit = (ms: Int): Int fails TimeoutError => timeout(() => 1, ms * 1ms)
export const hang = (): Int fails TimeoutError =>
  timeout(() => { sleep(5s)
 1 }, 10ms)
export const nap = (ms: Int): void => sleep(ms * 1ms)
`;

Deno.test("timeout returns the job value, raises TimeoutError, and finalizes before the handler", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect, Layer } from "effect";
import { Files, fast, piped, slow } from "./main.ts";
const events: string[] = [];
const Live = Layer.succeed(Files)({
  open: () => Effect.sync(() => ({
    wait: () => Effect.never,
    close: () => Effect.sync(() => { events.push("release"); }),
  })),
  mark: () => Effect.sync(() => { events.push("handler"); return -1; }),
});
const fastValue = await Effect.runPromise(fast());
const pipedValue = await Effect.runPromise(piped());
const slowValue = await Effect.runPromise(slow().pipe(Effect.provide(Live)));
console.log(JSON.stringify({ fastValue, pipedValue, slowValue, events }));
`,
  );
  assertEquals(result, {
    fastValue: 7,
    pipedValue: 8,
    slowValue: -1,
    events: ["release", "handler"],
  });
});

Deno.test("an uncaught timeout fails with the Cause.TimeoutError tag", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect } from "effect";
import { hang } from "./main.ts";
const exit = await Effect.runPromise(Effect.flip(hang()));
console.log(JSON.stringify({ tag: exit._tag }));
`,
  );
  assertEquals(result, { tag: "TimeoutError" });
});

Deno.test("a negative duration is a defect for timeout and for sleep", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Cause, Effect, Exit } from "effect";
import { limit, nap } from "./main.ts";
const defect = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasDies(exit.cause) &&
  Cause.pretty(exit.cause).includes("negative duration");
console.log(JSON.stringify({
  timeout: defect(await Effect.runPromiseExit(limit(-1))),
  sleep: defect(await Effect.runPromiseExit(nap(-1))),
}));
`,
  );
  assertEquals(result, { timeout: true, sleep: true });
});

Deno.test("sleep waits for the duration and returns void", async () => {
  const result = await compileAndRun(
    SOURCE,
    `import { Effect } from "effect";
import { nap } from "./main.ts";
const start = Date.now();
const value = await Effect.runPromise(nap(60));
console.log(JSON.stringify({ elapsed: Date.now() - start >= 50, value: value === undefined }));
`,
  );
  assertEquals(result, { elapsed: true, value: true });
});
