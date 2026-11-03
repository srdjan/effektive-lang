// Slow tests of the emitter: scopes, fibers, and concurrent combinators. Each
// test copies a fixture project to a temporary directory, builds there, and
// runs `deno check`, `deno fmt`, or `deno run` on the result. Nothing is
// written under fixtures/.

import { assertEquals } from "@std/assert";
import { runScript } from "./process_helpers.ts";
import { build, withTemporary } from "./emit_slow_helpers.ts";

Deno.test("withResource releases after success, typed failure, and interruption", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Files {",
        "  open(): { read: () => Text fails Stop, wait: () => void, close: () => void }",
        "}",
        "export const load = (): Text fails Stop with Files.open =>",
        "  withResource(() => Files.open(), (file) => file.read(), (file) => file.close())",
        "export const block = (): void with Files.open =>",
        "  withResource(() => Files.open(), (file) => file.wait(), (file) => file.close())",
        "type Text = string",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Files, Stop, block, load } from "./main.ts";

const events: string[] = [];
let fail = false;
let started: Deferred.Deferred<void> | undefined;
const Live = Layer.succeed(Files)({
  open: () => Effect.sync(() => {
    events.push("acquire");
    return {
      read: () => fail
        ? Effect.sync(() => { events.push("read"); }).pipe(Effect.andThen(Effect.fail(new Stop({}))))
        : Effect.sync(() => { events.push("read"); return "ok"; }),
      wait: () => Effect.sync(() => { events.push("wait"); }).pipe(
        Effect.andThen(Deferred.succeed(started!, undefined)),
        Effect.andThen(Effect.never),
      ),
      close: () => Effect.sync(() => { events.push("release"); }),
    };
  }),
});

const success = Effect.runSync(load().pipe(Effect.provide(Live)));
fail = true;
const failed = Effect.runSyncExit(load().pipe(Effect.provide(Live)));
const typedFailure = Exit.isFailure(failed);
await Effect.runPromise(Effect.gen(function* () {
  started = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkChild(block().pipe(Effect.provide(Live)));
  yield* Deferred.await(started);
  yield* Fiber.interrupt(fiber);
  events.push("interrupted");
}));
console.log(JSON.stringify({ success, typedFailure, events }));
`,
    );
    assertEquals(result, {
      success: "ok",
      typedFailure: true,
      events: [
        "acquire",
        "read",
        "release",
        "acquire",
        "read",
        "release",
        "acquire",
        "wait",
        "release",
        "interrupted",
      ],
    });
  });
});

Deno.test("bounded traverse limits jobs and waits for scoped finalizers", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Jobs {",
        "  open(n: Int): { work: () => Int fails Stop, close: () => void }",
        "}",
        "export const bounded = (xs: Int[]): Int[] fails Stop with Jobs.open =>",
        "  traverse(xs, (n) => withResource(() => Jobs.open(n), (job) => job.work(), (job) => job.close()), { concurrency: 2 })",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Jobs, Stop, bounded } from "./main.ts";

type Gate = Deferred.Deferred<void>;
let gates: Gate[] = [];
let ready: Gate[] = [];
let policy: "success" | "failure" | "interrupt" = "success";
let active = 0;
let maximum = 0;
const started: number[] = [];
const released: number[] = [];
const Live = Layer.succeed(Jobs)({
  open: (n) => Effect.sync(() => {
    started.push(n);
    active++;
    maximum = Math.max(maximum, active);
    return {
      work: () => policy === "success"
        ? Deferred.succeed(ready[n - 1]!, undefined).pipe(
          Effect.andThen(Deferred.await(gates[n - 1]!)), Effect.as(n * 2),
        )
        : n === 2 && policy === "failure"
        ? Deferred.succeed(ready[1]!, undefined).pipe(
          Effect.andThen(Deferred.await(gates[1]!)),
          Effect.andThen(Effect.fail(new Stop({}))),
        )
        : n === 2
        ? Deferred.succeed(ready[1]!, undefined).pipe(Effect.andThen(Effect.never))
        : Effect.never,
      close: () => Effect.sync(() => { released.push(n); active--; }),
    };
  }),
});

const makeGates = () => Effect.forEach([1, 2, 3, 4], () => Deferred.make<void>());
const ordered = await Effect.runPromise(Effect.gen(function* () {
  gates = yield* makeGates();
  ready = yield* makeGates();
  const fiber = yield* Effect.forkChild(bounded([1, 2, 3, 4]).pipe(Effect.provide(Live)));
  yield* Deferred.await(ready[0]!);
  yield* Deferred.await(ready[1]!);
  yield* Deferred.succeed(gates[1]!, undefined);
  yield* Deferred.await(ready[2]!);
  yield* Deferred.succeed(gates[0]!, undefined);
  yield* Deferred.await(ready[3]!);
  yield* Deferred.succeed(gates[3]!, undefined);
  yield* Deferred.succeed(gates[2]!, undefined);
  return yield* Fiber.join(fiber);
}));
const success = { ordered, maximum, active };
started.length = 0; released.length = 0; maximum = 0; policy = "failure";
const failed = await Effect.runPromise(Effect.gen(function* () {
  gates = yield* makeGates();
  ready = yield* makeGates();
  const fiber = yield* Effect.forkChild(bounded([1, 2, 3]).pipe(Effect.provide(Live)));
  yield* Deferred.await(ready[1]!);
  yield* Deferred.succeed(gates[1]!, undefined);
  return yield* Fiber.await(fiber);
}));
const failure = { failed: Exit.isFailure(failed), started: [...started], released: [...released].sort(), active };
started.length = 0; released.length = 0; policy = "interrupt";
await Effect.runPromise(Effect.gen(function* () {
  gates = yield* makeGates();
  ready = yield* makeGates();
  const fiber = yield* Effect.forkChild(bounded([1, 2, 3]).pipe(Effect.provide(Live)));
  yield* Deferred.await(ready[1]!);
  yield* Fiber.interrupt(fiber);
}));
const interruption = { started: [...started], released: [...released].sort(), active };
console.log(JSON.stringify({ success, failure, interruption }));
`,
    );
    assertEquals(result, {
      success: { ordered: [2, 4, 6, 8], maximum: 2, active: 0 },
      failure: { failed: true, started: [1, 2], released: [1, 2], active: 0 },
      interruption: { started: [1, 2], released: [1, 2], active: 0 },
    });
  });
});

Deno.test("unbounded traverse starts every job and waits for scoped finalizers", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Jobs {",
        "  open(n: Int): { work: () => Int fails Stop, close: () => void }",
        "}",
        "export const unbounded = (xs: Int[]): Int[] fails Stop with Jobs.open =>",
        '  traverse(xs, (n) => withResource(() => Jobs.open(n), (job) => job.work(), (job) => job.close()), { concurrency: "unbounded" })',
        "export const all = (): Int[] =>",
        '  traverse([defer(() => 1), defer(() => 2)], (job) => run(job), { concurrency: "unbounded" })',
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Jobs, Stop, all, unbounded } from "./main.ts";

type Gate = Deferred.Deferred<void>;
let gates: Gate[] = [];
let ready: Gate[] = [];
let policy: "success" | "failure" | "interrupt" = "success";
let active = 0;
let maximum = 0;
const started: number[] = [];
const released: number[] = [];
const Live = Layer.succeed(Jobs)({
  open: (n) => Effect.sync(() => {
    started.push(n);
    active++;
    maximum = Math.max(maximum, active);
    return {
      work: () => Deferred.succeed(ready[n - 1]!, undefined).pipe(
        Effect.andThen(Deferred.await(gates[n - 1]!)),
        Effect.andThen(policy === "failure" && n === 2
          ? Effect.fail(new Stop({}))
          : Effect.succeed(n * 2)),
      ),
      close: () => Effect.sync(() => { released.push(n); active--; }),
    };
  }),
});

const makeGates = () => Effect.forEach([1, 2, 3], () => Deferred.make<void>());
const reset = async (next: typeof policy) => {
  policy = next;
  started.length = 0;
  released.length = 0;
  maximum = 0;
  gates = await Effect.runPromise(makeGates());
  ready = await Effect.runPromise(makeGates());
};
const start = () => Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(unbounded([1, 2, 3]).pipe(Effect.provide(Live)));
  for (const gate of ready) yield* Deferred.await(gate);
  return fiber;
});

await reset("success");
const ordered = await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* start();
  yield* Deferred.succeed(gates[2]!, undefined);
  yield* Deferred.succeed(gates[0]!, undefined);
  yield* Deferred.succeed(gates[1]!, undefined);
  return yield* Fiber.join(fiber);
}));
const success = { ordered, maximum, active, started: [...started] };

await reset("failure");
const failed = await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* start();
  yield* Deferred.succeed(gates[1]!, undefined);
  return yield* Fiber.await(fiber);
}));
const failure = { failed: Exit.isFailure(failed), started: [...started], released: [...released].sort(), active };

await reset("interrupt");
await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* start();
  yield* Fiber.interrupt(fiber);
}));
const interruption = { started: [...started], released: [...released].sort(), active };
const empty = await Effect.runPromise(unbounded([]).pipe(Effect.provide(Live)));
const allResults = await Effect.runPromise(all());
console.log(JSON.stringify({ success, failure, interruption, empty, allResults }));
`,
    );
    assertEquals(result, {
      success: {
        ordered: [2, 4, 6],
        maximum: 3,
        active: 0,
        started: [1, 2, 3],
      },
      failure: {
        failed: true,
        started: [1, 2, 3],
        released: [1, 2, 3],
        active: 0,
      },
      interruption: {
        started: [1, 2, 3],
        released: [1, 2, 3],
        active: 0,
      },
      empty: [],
      allResults: [1, 2],
    });
  });
});

Deno.test("all preserves tuple and record results and cleans up siblings", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Jobs { number(): Int fails Stop; text(): Text }",
        "type Int = int",
        "type Text = string",
        "type Pair = [Effect<Int, Stop, Jobs.number>, Effect<Text, never, Jobs.text>]",
        "const pair: Pair = [defer(() => Jobs.number()), defer(() => Jobs.text())]",
        "export const tuple = (): [Int, Text] fails Stop with Jobs.number | Jobs.text =>",
        '  all(pair, { concurrency: "unbounded" })',
        "export const record = (): { number: Int, text: Text } fails Stop with Jobs.number | Jobs.text =>",
        '  all({ number: defer(() => Jobs.number()), text: defer(() => Jobs.text()) }, { concurrency: "unbounded" })',
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Jobs, Stop, tuple, record } from "./main.ts";

const Stable = Layer.succeed(Jobs)({
  number: () => Effect.succeed(7),
  text: () => Effect.succeed("seven"),
});
const tupleResult = await Effect.runPromise(tuple().pipe(Effect.provide(Stable)));
const recordResult = await Effect.runPromise(record().pipe(Effect.provide(Stable)));

let numberReady = Effect.runSync(Deferred.make<void>());
let textReady = Effect.runSync(Deferred.make<void>());
let releaseNumber = Effect.runSync(Deferred.make<void>());
let mode: "failure" | "interrupt" = "failure";
const started: string[] = [];
const released: string[] = [];
const Live = Layer.succeed(Jobs)({
  number: () => Effect.acquireUseRelease(
    Effect.sync(() => { started.push("number"); }),
    () => Deferred.succeed(numberReady, undefined).pipe(
      Effect.andThen(Deferred.await(releaseNumber)),
      Effect.andThen(mode === "failure" ? Effect.fail(new Stop({})) : Effect.never),
    ),
    () => Effect.sync(() => { released.push("number"); }),
  ),
  text: () => Effect.acquireUseRelease(
    Effect.sync(() => { started.push("text"); }),
    () => Deferred.succeed(textReady, undefined).pipe(Effect.andThen(Effect.never)),
    () => Effect.sync(() => { released.push("text"); }),
  ),
});
const start = () => Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(record().pipe(Effect.provide(Live)));
  yield* Deferred.await(numberReady);
  yield* Deferred.await(textReady);
  return fiber;
});
const failed = await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* start();
  yield* Deferred.succeed(releaseNumber, undefined);
  return yield* Fiber.await(fiber);
}));
const failure = { failed: Exit.isFailure(failed), started: [...started], released: [...released].sort() };

mode = "interrupt";
started.length = 0;
released.length = 0;
numberReady = Effect.runSync(Deferred.make<void>());
textReady = Effect.runSync(Deferred.make<void>());
releaseNumber = Effect.runSync(Deferred.make<void>());
await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* start();
  yield* Fiber.interrupt(fiber);
}));
const interruption = { started: [...started], released: [...released].sort() };
console.log(JSON.stringify({ tupleResult, recordResult, failure, interruption }));
`,
    );
    assertEquals(result, {
      tupleResult: [7, "seven"],
      recordResult: { number: 7, text: "seven" },
      failure: {
        failed: true,
        started: ["number", "text"],
        released: ["number", "text"],
      },
      interruption: {
        started: ["number", "text"],
        released: ["number", "text"],
      },
    });
  });
});

Deno.test("a source race interrupts its losing fiber and waits for cleanup", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export service Source {",
        "  slow(): Int",
        "  fast(): Int",
        "}",
        "export const main = (): Int with Source.slow | Source.fast =>",
        "  run(race(defer(() => Source.slow()), defer(() => Source.fast())))",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer } from "effect";
import { Source, main } from "./main.ts";
let started = 0;
let released = 0;
const SourceLive = Layer.succeed(Source)({
  slow: () => Effect.sync(() => { started++; return 0; }).pipe(
    Effect.flatMap(() => Effect.never),
    Effect.onInterrupt(() => Effect.sync(() => { released++; })),
  ),
  fast: () => Effect.sleep("20 millis").pipe(Effect.as(7)),
});
const value = await Effect.runPromise(main().pipe(Effect.provide(SourceLive)));
console.log(JSON.stringify({ value, started, released }));
`,
    );
    assertEquals(result, { value: 7, started: 1, released: 1 });
  });
});

Deno.test("forkScoped outlives its spawning fiber and closes with its scope", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "type Bool = boolean",
        "export service Child { run(): void; wait(): void; alive(): Bool }",
        "const job = defer(() => {",
        '    all({ spawner: defer(() => { forkScoped(defer(() => Child.run())); 1 }), other: defer(() => 2) }, { concurrency: "unbounded" })',
        "    Child.wait()",
        "    Child.alive()",
        "})",
        "export const main = (): Bool with Child.run | Child.wait | Child.alive => scoped(job)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Layer } from "effect";
import { Child, main } from "./main.ts";
const ready = Deferred.makeUnsafe<void>();
let active = false;
let released = 0;
const Live = Layer.succeed(Child)({
  run: () => Effect.sync(() => { active = true; }).pipe(
    Effect.andThen(Deferred.succeed(ready, undefined)),
    Effect.andThen(Effect.never),
    Effect.onInterrupt(() => Effect.sync(() => { active = false; released++; })),
  ),
  wait: () => Deferred.await(ready),
  alive: () => Effect.sync(() => active),
});

const observed = await Effect.runPromise(main().pipe(Effect.provide(Live)));
console.log(JSON.stringify({ observed, active, released }));
`,
    );
    assertEquals(result, { observed: true, active: false, released: 1 });
  });
});

Deno.test("reference updates are atomic under bounded traversal", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "export const main = (): Int => {",
        "  const ref = makeRef(0)",
        "  traverse([1, 2, 3, 4], (n) => updateRef(ref, (current) => current + 1), { concurrency: 4 })",
        "  getRef(ref)",
        "}",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { main } from "./main.ts";
console.log(JSON.stringify({ value: await Effect.runPromise(main()) }));
`,
    );
    assertEquals(result, { value: 4 });
  });
});

Deno.test("effectful reference updates are atomic under bounded traversal", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "export service Clock { pause(n: Int): Int }",
        "export const main = (): Int with Clock.pause => {",
        "  const ref = makeRef(0)",
        "  traverse([1, 2, 3, 4, 5, 6, 7, 8], (n) => updateRef(ref, (current) => current + Clock.pause(1)), { concurrency: 4 })",
        "  getRef(ref)",
        "}",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer } from "effect";
import { Clock, main } from "./main.ts";
const live = Layer.succeed(Clock)({ pause: (n: number) => Effect.sleep(1).pipe(Effect.as(n)) });
console.log(JSON.stringify({ value: await Effect.runPromise(main().pipe(Effect.provide(live))) }));
`,
    );
    assertEquals(result, { value: 8 });
  });
});

Deno.test("a failing effectful reference update leaves the value unchanged", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "export error Stop = { at: int }",
        "export service Gate { check(n: Int): Int fails Stop }",
        "export const bump = (ref: Ref<Int>): void fails Stop with Gate.check => updateRef(ref, (n) => Gate.check(n))",
        "export const make = (): Ref<Int> => makeRef(5)",
        "export const read = (ref: Ref<Int>): Int => getRef(ref)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Exit, Layer } from "effect";
import { Gate, bump, make, read } from "./main.ts";
const live = Layer.succeed(Gate)({ check: (n: number) => Effect.fail({ _tag: "Stop", at: n } as never) });
const ref = await Effect.runPromise(make());
const exit = await Effect.runPromiseExit(bump(ref).pipe(Effect.provide(live)));
console.log(JSON.stringify({ failed: Exit.isFailure(exit), value: await Effect.runPromise(read(ref)) }));
`,
    );
    assertEquals(result, { failed: true, value: 5 });
  });
});

Deno.test("custom retry schedule sees one-based attempts and stops on None", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Jobs { next(): Int fails Stop }",
        "const policy: RetrySchedule<Stop> = retrySchedule((error: Stop, attempt: Int): Option<Duration> =>",
        "  if (attempt < 3) { Some(0ms) } else { None })",
        "export const main = (): Int fails Stop with Jobs.next => retry(() => Jobs.next(), { schedule: policy })",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer } from "effect";
import { Jobs, Stop, main } from "./main.ts";
let attempts = 0;
const Live = Layer.succeed(Jobs)({ next: () => Effect.sync(() => { attempts++; }).pipe(Effect.andThen(Effect.fail(new Stop({})))) });
const error = await Effect.runPromise(Effect.flip(main().pipe(Effect.provide(Live))));
console.log(JSON.stringify({ attempts, tag: error._tag }));
`,
    );
    assertEquals(result, { attempts: 3, tag: "main#Stop" });
  });
});

Deno.test("source Layers merge and provide their declared services", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "service First { one(): Int }",
        "service Second { two(): Int }",
        "const first = layer(First, () => ({ one: () => 1 }))",
        "const second = layer(Second, () => ({ two: () => 2 }))",
        "const both: Layer<First | Second> = mergeLayers(first, second)",
        "export const main = (): Int => provide(both, () => First.one() + Second.two())",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { main } from "./main.ts";
console.log(JSON.stringify({ value: await Effect.runPromise(main()) }));
`,
    );
    assertEquals(result, { value: 3 });
  });
});

Deno.test("source Layer acquisition carries its failure and service requirement", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Source { next(): Int fails Stop }",
        "service First { one(): Int }",
        "const first: Layer<First, Stop, Source.next> = layer(First, () => {",
        "  const value = Source.next()",
        "  ({ one: () => value })",
        "})",
        "export const main = (): Int fails Stop with Source.next => provide(first, () => First.one())",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer } from "effect";
import { Source, main } from "./main.ts";
const SourceLive = Layer.succeed(Source)({ next: () => Effect.succeed(9) });
console.log(JSON.stringify({ value: await Effect.runPromise(main().pipe(Effect.provide(SourceLive))) }));
`,
    );
    assertEquals(result, { value: 9 });
  });
});
