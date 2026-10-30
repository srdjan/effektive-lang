// Runtime behavior of `uninterruptible` (unit ES7). Each test compiles one
// module with independent validation, type-checks the emitted TypeScript under
// the strict target options, and runs it.

import { assertEquals } from "@std/assert";
import { compileAndRun } from "./target_helpers.ts";

const SOURCE = `type Int = int
type Name = string
export service Log { seen(name: Name): void }
export const guarded = (): Int fails TimeoutError uses Log.seen =>
  timeout(() => uninterruptible(() => { sleep(40ms)
 Log.seen("done")
 1 }), 10ms)
export const piped = (): Int fails TimeoutError uses Log.seen =>
  timeout(() => (() => { sleep(40ms)
 Log.seen("done")
 1 }) |> uninterruptible(), 10ms)
export const open = (): Int fails TimeoutError uses Log.seen =>
  timeout(() => { sleep(40ms)
 Log.seen("done")
 1 }, 10ms)
export const raced = (): Int uses Log.seen =>
  run(race(
    defer(() => uninterruptible(() => { sleep(40ms)
 Log.seen("loser-done")
 1 })),
    defer(() => { sleep(5ms)
 2 })
  ))
`;

const PRELUDE = `import { Effect, Layer } from "effect";
import { Log, guarded, piped, open, raced } from "./main.ts";
const events: string[] = [];
const Live = Layer.succeed(Log)({
  seen: (name) => Effect.sync(() => { events.push(name); }),
});
const tag = async (e: Effect.Effect<unknown, { readonly _tag: string }, Log>) => {
  const r = await Effect.runPromise(Effect.flip(e).pipe(Effect.provide(Live)));
  return r._tag;
};
`;

Deno.test("an uninterruptible job finishes before the TimeoutError surfaces", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const a = await tag(guarded());
const afterGuarded = [...events];
events.length = 0;
const b = await tag(piped());
const afterPiped = [...events];
console.log(JSON.stringify({ a, afterGuarded, b, afterPiped }));
`,
  );
  assertEquals(result, {
    a: "TimeoutError",
    afterGuarded: ["done"],
    b: "TimeoutError",
    afterPiped: ["done"],
  });
});

Deno.test("without uninterruptible the same job is cut off", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const a = await tag(open());
await new Promise((r) => setTimeout(r, 80));
console.log(JSON.stringify({ a, events }));
`,
  );
  assertEquals(result, { a: "TimeoutError", events: [] });
});

Deno.test("a race loser inside uninterruptible still completes its job", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const winner = await Effect.runPromise(raced().pipe(Effect.provide(Live)));
console.log(JSON.stringify({ winner, events }));
`,
  );
  assertEquals(result, { winner: 2, events: ["loser-done"] });
});
