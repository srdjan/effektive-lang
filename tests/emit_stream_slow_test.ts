// Slow tests of the emitter: streams. Each test copies a fixture project to a
// temporary directory, builds there, and runs `deno check`, `deno fmt`, or
// `deno run` on the result. Nothing is written under fixtures/.

import { assertEquals } from "@std/assert";
import { runScript } from "./process_helpers.ts";
import { build, withTemporary } from "./emit_slow_helpers.ts";

Deno.test("concurrent stream mapping bounds work and closes failed siblings", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "export error Stop = {}",
        "export service Source { next(n: Int): Option<[Int, Int]> }",
        "export service Worker { work(n: Int): Int fails Stop }",
        "const source = unfold(0, (n) => Source.next(n))",
        "const mapped = mapEffect(source, (n) => Worker.work(n), { concurrency: 2 })",
        "export const mapMain = (): Int[] fails Stop with Source.next | Worker.work => runStream(mapped, takeSink(10))",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Layer, Option } from "effect";
import { Source, Worker, Stop, mapMain } from "./main.ts";

const calls: number[] = [];
let active = 0;
let maximum = 0;
let fail = false;
// Worker 1 holds its slot until worker 2 lets it go. So the order does not
// depend on timers: worker 3 starts only after a slot is free.
let entered = Deferred.makeUnsafe<void>();
let finished = Deferred.makeUnsafe<void>();
const started: number[] = [];
const released: number[] = [];
const SourceLive = Layer.succeed(Source)({
  next: (n) => Effect.sync(() => {
    calls.push(n);
    return n >= 3 ? Option.none() : Option.some([n + 1, n + 1] as const);
  }),
});
const perform = (n: number) => Effect.acquireUseRelease(
  Effect.sync(() => {
    active++;
    maximum = Math.max(maximum, active);
    started.push(n);
  }),
  () => n === 1
    ? Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(finished)),
      Effect.as(n),
    )
    : n === 2
    ? Deferred.await(entered).pipe(
      Effect.andThen(fail
        ? Effect.fail(new Stop({}))
        : Deferred.succeed(finished, undefined).pipe(Effect.as(n))),
    )
    : Effect.succeed(n),
  () => Effect.sync(() => { active--; released.push(n); }),
);
const WorkerLive = Layer.succeed(Worker)({
  work: (n) => perform(n).pipe(Effect.map((value) => value * 10)),
});
const Live = Layer.mergeAll(SourceLive, WorkerLive);
const reset = () => {
  calls.length = 0;
  started.length = 0;
  released.length = 0;
  active = 0;
  maximum = 0;
  entered = Deferred.makeUnsafe<void>();
  finished = Deferred.makeUnsafe<void>();
};
const pendingMap = mapMain().pipe(Effect.provide(Live));
const before = { calls: [...calls], started: [...started] };
const mapped = await Effect.runPromise(pendingMap);
const mapSuccess = { mapped, maximum, active, started: [...started], released: [...released].sort() };
reset();
fail = true;
const mapFailure = await Effect.runPromise(Effect.flip(pendingMap));
const mapFailed = { tag: mapFailure._tag, active, started: [...started], released: [...released].sort() };
console.log(JSON.stringify({ before, mapSuccess, mapFailed }));
`,
    );
    assertEquals(result, {
      before: { calls: [], started: [] },
      mapSuccess: {
        mapped: [10, 20, 30],
        maximum: 2,
        active: 0,
        started: [1, 2, 3],
        released: [1, 2, 3],
      },
      mapFailed: {
        tag: "main#Stop",
        active: 0,
        started: [1, 2],
        released: [1, 2],
      },
    });
  });
});

Deno.test("source-authored streams pull incrementally through an effectful sink", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Source { next(state: Int): Option<[Int, Int]> fails Stop }",
        "export service Transform { double(value: Int): Int fails Stop }",
        "export service Consumer { accept(value: Int): void fails Stop }",
        "const numbers: Stream<Int, Stop, Source.next> = unfold(0, (state) => Source.next(state))",
        "const doubled: Stream<Int, Stop, Source.next | Transform.double> = mapEffect(numbers, (value) => Transform.double(value))",
        "const consume: Sink<Int, void, Stop, Consumer.accept> = sinkForEach((value: Int) => Consumer.accept(value))",
        "export const main = (): void fails Stop with Source.next | Transform.double | Consumer.accept => runStream(doubled, consume)",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer, Option } from "effect";
import { Consumer, Source, Transform, main } from "./main.ts";

let produced = 0;
let consumed = 0;
let maximumAhead = 0;
const output: number[] = [];
const SourceLive = Layer.succeed(Source)({
  next: (state) => Effect.sync(() => {
    if (state === 4) return Option.none();
    produced++;
    maximumAhead = Math.max(maximumAhead, produced - consumed);
    return Option.some([state, state + 1] as const);
  }),
});
const TransformLive = Layer.succeed(Transform)({
  double: (value) => Effect.succeed(value * 2),
});
const ConsumerLive = Layer.succeed(Consumer)({
  accept: (value) => Effect.sync(() => { output.push(value); consumed++; }),
});
const before = produced;
await Effect.runPromise(main().pipe(Effect.provide(Layer.mergeAll(
  SourceLive, TransformLive, ConsumerLive,
))));
console.log(JSON.stringify({ before, produced, consumed, maximumAhead, output }));
`,
    );
    assertEquals(result, {
      before: 0,
      produced: 4,
      consumed: 4,
      maximumAhead: 1,
      output: [0, 2, 4, 6],
    });
  });
});

Deno.test("mapEffect with a pure callback changes element type and propagates source failures", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "type Bool = boolean",
        "export error Stop = {}",
        "export service Source { next(n: Int): Option<[Int, Int]> fails Stop }",
        "export service Output { accept(value: Bool): void }",
        "const source = unfold(0, (n) => Source.next(n))",
        "const sink = sinkForEach((value: Bool) => Output.accept(value))",
        "export const main = (limit: Int): void fails Stop with Source.next | Output.accept =>",
        "  runStream(mapEffect(source, (n) => n >= limit), sink)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer, Option } from "effect";
import { Output, Source, Stop, main } from "./main.ts";

const calls: number[] = [];
const released: number[] = [];
const values: boolean[] = [];
const sourceValues = [0, 1, 3, 0, 4];
let failAtOne = false;
const SourceLive = Layer.succeed(Source)({
  next: (n) => Effect.acquireUseRelease(
    Effect.sync(() => { calls.push(n); return n; }),
    () => n === 1 && failAtOne ? Effect.fail(new Stop({})) :
      n === 5 ? Effect.succeed(Option.none()) : Effect.succeed(Option.some([sourceValues[n]!, n + 1] as const)),
    () => Effect.sync(() => { released.push(n); }),
  ),
});
const OutputLive = Layer.succeed(Output)({
  accept: (value) => Effect.sync(() => { values.push(value); }),
});
const Live = Layer.mergeAll(SourceLive, OutputLive);
const run = async (limit: number) => {
  calls.length = 0;
  released.length = 0;
  values.length = 0;
  await Effect.runPromise(main(limit).pipe(Effect.provide(Live)));
  return { calls: [...calls], released: [...released], values: [...values] };
};
const before = { calls: [...calls], released: [...released], values: [...values] };
const all = await run(0);
const selected = await run(3);
const none = await run(6);
calls.length = 0;
released.length = 0;
values.length = 0;
failAtOne = true;
const failure = await Effect.runPromise(Effect.flip(main(3).pipe(Effect.provide(Live))));
console.log(JSON.stringify({ before, all, selected, none, failure: { tag: failure._tag, calls, released, values } }));
`,
    );
    assertEquals(result, {
      before: { calls: [], released: [], values: [] },
      all: {
        calls: [0, 1, 2, 3, 4, 5],
        released: [0, 1, 2, 3, 4, 5],
        values: [true, true, true, true, true],
      },
      selected: {
        calls: [0, 1, 2, 3, 4, 5],
        released: [0, 1, 2, 3, 4, 5],
        values: [false, false, true, false, true],
      },
      none: {
        calls: [0, 1, 2, 3, 4, 5],
        released: [0, 1, 2, 3, 4, 5],
        values: [false, false, false, false, false],
      },
      failure: {
        tag: "main#Stop",
        calls: [0, 1],
        released: [0, 1],
        values: [false],
      },
    });
  });
});

Deno.test("stream pull releases a scoped operation on failure and interruption", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export error Stop = {}",
        "export service Source { open(state: Int): { next: () => Option<[Int, Int]> fails Stop, close: () => void } }",
        "const numbers = unfold(0, (state) => withResource(() => Source.open(state), (source) => source.next(), (source) => source.close()))",
        "const sink = sinkForEach((value: Int) => {})",
        "export const main = (): void fails Stop with Source.open => runStream(numbers, sink)",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Source, Stop, main } from "./main.ts";

const events: string[] = [];
let interrupt = false;
let started: Deferred.Deferred<void> | undefined;
const Live = Layer.succeed(Source)({
  open: () => Effect.sync(() => {
    events.push("acquire");
    return {
      next: () => interrupt
        ? Deferred.succeed(started!, undefined).pipe(Effect.andThen(Effect.never))
        : Effect.fail(new Stop({})),
      close: () => Effect.sync(() => { events.push("release"); }),
    };
  }),
});
const failed = Effect.runSyncExit(main().pipe(Effect.provide(Live)));
const failure = { failed: Exit.isFailure(failed), events: [...events] };
events.length = 0;
interrupt = true;
await Effect.runPromise(Effect.gen(function* () {
  started = yield* Deferred.make<void>();
  const fiber = yield* Effect.forkChild(main().pipe(Effect.provide(Live)));
  yield* Deferred.await(started);
  yield* Fiber.interrupt(fiber);
  events.push("interrupted");
}));
console.log(JSON.stringify({ failure, interruption: events }));
`,
    );
    assertEquals(result, {
      failure: { failed: true, events: ["acquire", "release"] },
      interruption: ["acquire", "release", "interrupted"],
    });
  });
});

Deno.test("a buffered stream defers production and keeps the source order", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "export service Source { next(state: Int): Option<[Int, Int]> }",
        "export service Consumer { accept(value: Int): void }",
        "const first = unfold(0, (state) => Source.next(state))",
        "const buffered = bufferStream(first, { capacity: 2 })",
        "const sink = sinkForEach((value: Int) => Consumer.accept(value))",
        "export const main = (): void with Source.next | Consumer.accept => runStream(buffered, sink)",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer, Option } from "effect";
import { Consumer, Source, main } from "./main.ts";
let produced = 0;
const output: number[] = [];
const SourceLive = Layer.succeed(Source)({
  next: (state) => Effect.sync(() => {
    if (state === 3) return Option.none();
    produced++;
    return Option.some([state, state + 1] as const);
  }),
});
const ConsumerLive = Layer.succeed(Consumer)({
  accept: (value) => Effect.sync(() => { output.push(value); }),
});
const before = produced;
await Effect.runPromise(main().pipe(Effect.provide(Layer.merge(SourceLive, ConsumerLive))));
console.log(JSON.stringify({ before, produced, output }));
`,
    );
    assertEquals(result, { before: 0, produced: 3, output: [0, 1, 2] });
  });
});
