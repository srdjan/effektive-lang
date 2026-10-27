// Runtime behavior of `log` (unit SL3). Each test compiles one module with
// independent validation, type-checks the emitted TypeScript under the strict
// target options, and runs it with a recording logger.

import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

const SOURCE = `type Text = string
type Id = int
export const plain = (msg: Text): void => log(msg)
export const warned = (msg: Text, id: Id): void =>
  log(msg, { level: "warn", fields: { orderId: id, tags: ["a", "b"] } })
export const quiet = (msg: Text): void => log(msg, { level: "debug" })
`;

/** The shared prelude of every run: a logger that records one entry per log call. */
const RECORDER = `import { Effect, Logger, References } from "effect";
import { plain, warned, quiet } from "./main.ts";
const entries: { level: string; message: unknown; annotations: unknown }[] = [];
const recorder = Logger.make((options) => {
  entries.push({
    level: options.logLevel,
    message: options.message,
    annotations: options.fiber.getRef(References.CurrentLogAnnotations),
  });
});
const withRecorder = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Logger.layer([recorder])));
`;

async function compileAndRun(run: string): Promise<unknown> {
  return JSON.parse(
    await compileStrictTarget(
      { "main.eff": SOURCE },
      ["main.eff"],
      `${RECORDER}${run}`,
      "effektive-log-",
    ),
  );
}

Deno.test("log(message) logs at the Info level with no annotations", async () => {
  const result = await compileAndRun(`
await Effect.runPromise(withRecorder(plain("hello")));
console.log(JSON.stringify(entries));
`);
  assertEquals(result, [{
    level: "Info",
    message: ["hello"],
    annotations: {},
  }]);
});

Deno.test("level and fields set the Warn level and the annotations", async () => {
  const result = await compileAndRun(`
await Effect.runPromise(withRecorder(warned("late", 7)));
console.log(JSON.stringify(entries));
`);
  assertEquals(result, [{
    level: "Warn",
    message: ["late"],
    annotations: { orderId: 7, tags: ["a", "b"] },
  }]);
});

Deno.test("the annotations do not leak to the next entry", async () => {
  const result = await compileAndRun(`
await Effect.runPromise(withRecorder(Effect.gen(function* () {
  yield* warned("first", 1);
  yield* plain("second");
})));
console.log(JSON.stringify(entries.map((e) => e.annotations)));
`);
  assertEquals(result, [{ orderId: 1, tags: ["a", "b"] }, {}]);
});

Deno.test("MinimumLogLevel Info drops a debug entry and keeps an info entry", async () => {
  const result = await compileAndRun(`
const program = Effect.gen(function* () {
  yield* quiet("dropped");
  yield* plain("kept");
}).pipe(Effect.provideService(References.MinimumLogLevel, "Info"));
await Effect.runPromise(withRecorder(program));
console.log(JSON.stringify(entries.map((e) => [e.level, e.message])));
`);
  assertEquals(result, [["Info", ["kept"]]]);
});

Deno.test("a debug entry is logged when the minimum level is Debug", async () => {
  const result = await compileAndRun(`
const program = quiet("shown").pipe(
  Effect.provideService(References.MinimumLogLevel, "Debug"),
);
await Effect.runPromise(withRecorder(program));
console.log(JSON.stringify(entries.map((e) => [e.level, e.message])));
`);
  assertEquals(result, [["Debug", ["shown"]]]);
});
