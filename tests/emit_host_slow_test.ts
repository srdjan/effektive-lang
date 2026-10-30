// Slow tests of the emitter: the host boundary and host checks. Each test
// copies a fixture project to a temporary directory, builds there, and runs
// `deno check`, `deno fmt`, or `deno run` on the result. Nothing is written
// under fixtures/.

import { assert, assertEquals } from "@std/assert";
import { checkProject } from "../src/core/check_project.ts";
import { buildSpanTable, hostImportSpans } from "../src/core/emit/spans.ts";
import {
  hostModulePaths,
  mapTscDiagnostic,
  parseDenoCheck,
} from "../src/core/emit/tsc.ts";
import { lowerProject } from "../src/core/lower.ts";
import { validateProject } from "../src/core/validate_project.ts";
import { lineStarts, positionOf, spanText } from "../src/core/source.ts";
import {
  copyDirectory,
  EXAMPLE_ENTRIES,
  FIXTURES,
  hostBoundaryManifest,
} from "./helpers.ts";
import { deno, runScript } from "./process_helpers.ts";
import {
  build,
  buildProject,
  type Built,
  check,
  fileHost,
  withTemporary,
} from "./emit_slow_helpers.ts";

// ------------------------------------------------------------------ host boundary (A6b)

Deno.test("a wrong host module gives one host-boundary diagnostic on the import of UsersLive", async () => {
  const fixtures = hostBoundaryManifest();
  assertEquals(fixtures.length, 1);
  for (const fixture of fixtures) {
    await withTemporary(async (dir) => {
      copyDirectory(new URL("examples/", FIXTURES), dir);
      const built = buildProject(dir, EXAMPLE_ENTRIES);
      // The wrong module replaces the right one.
      Deno.copyFileSync(
        new URL(
          `host-boundary/${fixture.directory}/${fixture.host}`,
          FIXTURES,
        ),
        `${dir}/users-live.ts`,
      );
      const run = await deno(dir, [
        "check",
        "--config",
        "deno.json",
        ...built.paths,
        "users-live.ts",
      ]);
      assertEquals(run.code, 1, `deno check should fail:\n${run.stderr}`);

      const output = parseDenoCheck(run.stderr, Deno.realPathSync(dir));
      assertEquals(output.other, [], run.stderr);
      const imports = hostImportSpans(built.project);
      const tables = new Map(
        [...built.emitted].map(([name, module]) => [
          module.path,
          buildSpanTable(module, imports.get(name)),
        ]),
      );
      const mapped = output.diagnostics.map((d) => mapTscDiagnostic(d, tables));
      assertEquals(mapped.length, 1, run.stderr);
      const only = mapped[0];
      assert(only.tag === "host-boundary", JSON.stringify(only));
      assertEquals(only.diagnostic.code, fixture.code);

      const source = Deno.readTextFileSync(`${dir}/${fixture.expected.source}`);
      const position = positionOf(
        lineStarts(source),
        source,
        only.diagnostic.span.start,
      );
      assertEquals(only.diagnostic.span.source, fixture.expected.source);
      assertEquals(
        [position.line, position.column],
        [fixture.expected.line, fixture.expected.column],
      );
      assertEquals(spanText(source, only.diagnostic.span), "UsersLive");
    });
  }
});

Deno.test("a host layer of the declared service that lacks a method gives one host-module diagnostic", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("examples/", FIXTURES), dir);
    const built = buildProject(dir, EXAMPLE_ENTRIES);
    Deno.writeTextFileSync(
      `${dir}/users-live.ts`,
      [
        'import { Effect, Layer, Option } from "effect";',
        'import { Users } from "./users.ts";',
        "export const UsersLive = Layer.succeed(Users)({",
        "  find: () => Effect.succeed(Option.none()),",
        "  save: () => Effect.void,",
        "});",
        "",
      ].join("\n"),
    );
    const run = await deno(dir, [
      "check",
      "--config",
      "deno.json",
      ...built.paths,
      "users-live.ts",
    ]);
    assertEquals(run.code, 1, `deno check should fail:\n${run.stderr}`);
    const output = parseDenoCheck(run.stderr, Deno.realPathSync(dir));
    assertEquals(output.other, [], run.stderr);
    const imports = hostImportSpans(built.project);
    const tables = new Map(
      [...built.emitted].map(([name, module]) => [
        module.path,
        buildSpanTable(module, imports.get(name)),
      ]),
    );
    const hosts = hostModulePaths(built.project.config);
    const mapped = output.diagnostics.map((d) =>
      mapTscDiagnostic(d, tables, hosts)
    );
    assertEquals(mapped.length, 1, run.stderr);
    const only = mapped[0];
    assert(only.tag === "host-module", JSON.stringify(only));
    assertEquals([only.key, only.file, only.line], [
      "providers",
      "users-live.ts",
      3,
    ]);
  });
});

Deno.test("explicit scopes survive root return and share aliases across modules", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/scopes/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const project = checkProject(fileHost, dir, ["consumer.eff"]);
    assert(project.ok);
    assertEquals(project.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        project.value.analysis.project,
        lowerProject(project.value),
      ).values()
    ) {
      assertEquals(diagnostics, []);
    }
    build(dir, ["consumer.eff"]);
    const formatted = await deno(dir, [
      "fmt",
      "--check",
      "owner.ts",
      "consumer.ts",
    ]);
    assertEquals(formatted.code, 0, formatted.stderr);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Layer, Option } from "effect";
import { Child, open, openProvided, close, piped } from "./owner.ts";
import { alias, copied, stash, stop, stopNew, provideNew, registerNew } from "./consumer.ts";
const events: string[] = [];
const ready = Deferred.makeUnsafe<void>();
const live = Layer.succeed(Child)({
  run: () => Effect.acquireUseRelease(
    Effect.sync(() => { events.push("start"); }),
    () => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never)),
    () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("release"); }))),
  ),
  ready: () => Deferred.await(ready),
});
const owner = await Effect.runPromise(open().pipe(Effect.provide(live)));
events.push("root-returned");
const saved = await Effect.runPromise(stash(owner));
const both = Option.getOrThrow(copied(owner));
const same = both[0] === owner && both[1][0] === owner;
const deferredClose = alias(owner);
await Effect.runPromise(stop(saved));
events.push("closed");
await Effect.runPromise(deferredClose());
await Effect.runPromise(close(owner));
await Effect.runPromise(piped());
await Effect.runPromise(stopNew());
await Effect.runPromise(provideNew(Effect.void));
await Effect.runPromise(registerNew(Effect.void));
const providerReady = Deferred.makeUnsafe<void>();
const provider = Layer.effect(Child)(Effect.acquireRelease(
  Effect.sync(() => {
    events.push("acquire-provider");
    return { run: () => Deferred.succeed(providerReady, undefined).pipe(Effect.andThen(Effect.never)), ready: () => Effect.void };
  }),
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("release-provider"); }))),
));
const external = Layer.succeed(Child)({ run: () => Effect.void, ready: () => Deferred.await(providerReady) });
const provided = await Effect.runPromise(openProvided(provider).pipe(Effect.provide(external)));
events.push("provider-root-returned");
await Effect.runPromise(close(provided));
console.log(JSON.stringify({ same, events }));
`,
    );
    assertEquals(result, {
      same: true,
      events: [
        "start",
        "root-returned",
        "release",
        "closed",
        "acquire-provider",
        "provider-root-returned",
        "release-provider",
      ],
    });
  });
});

Deno.test("explicit close callers wait for one cleanup and retain its defects", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/scopes/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["consumer.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { create, close } from "./owner.ts";
import { register, alias } from "./consumer.ts";
const events: string[] = [];
const owner = await Effect.runPromise(create());
const entered = Deferred.makeUnsafe<void>();
const release = Deferred.makeUnsafe<void>();
await Effect.runPromise(register(owner, Deferred.succeed(entered, undefined).pipe(
  Effect.andThen(Deferred.await(release)),
  Effect.andThen(Effect.sync(() => { events.push("release"); })),
)));
await Effect.runPromise(Effect.gen(function* () {
  const first = yield* Effect.forkChild(close(owner));
  yield* Deferred.await(entered);
  const second = yield* Effect.forkChild(alias(owner)().pipe(Effect.andThen(Effect.sync(() => { events.push("second"); }))));
  yield* Effect.yieldNow;
  if (events.length !== 0) throw new Error("close returned before release");
  yield* register(owner, Effect.sync(() => { events.push("late-during-close"); }));
  const cancel = yield* Effect.forkChild(Fiber.interrupt(first));
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(cancel);
  yield* Fiber.join(second);
}));
await Effect.runPromise(close(owner));
await Effect.runPromise(register(owner, Effect.sync(() => { events.push("late"); })));
await Effect.runPromise(close(owner));
const defective = await Effect.runPromise(create());
await Effect.runPromise(register(defective, Effect.sync(() => { events.push("remaining"); })));
await Effect.runPromise(register(defective, Effect.die("cleanup-defect")));
const first = await Effect.runPromiseExit(close(defective));
const second = await Effect.runPromiseExit(alias(defective)());
const replayed = Exit.isFailure(first) && Exit.isFailure(second) && Cause.hasDies(first.cause) && JSON.stringify(first.cause) === JSON.stringify(second.cause);
const lateDefect = await Effect.runPromiseExit(register(owner, Effect.die("late-defect")));
const stillClosed = await Effect.runPromiseExit(close(owner));
console.log(JSON.stringify({ events, replayed, lateIsSeparate: Exit.isFailure(lateDefect) && Exit.isSuccess(stillClosed) }));
`,
    );
    assertEquals(result, {
      events: ["late-during-close", "release", "second", "late", "remaining"],
      replayed: true,
      lateIsSeparate: true,
    });
  });
});

Deno.test("scope registration captures services and evaluates arguments before execution", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/scopes/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["consumer.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Fiber, Layer } from "effect";
import { Audit, Work, Order, create, register, ordinary, close, ordered, provideOrdered } from "./owner.ts";
const events: string[] = [];
const owner = await Effect.runPromise(create());
const audit = (name: string) => Layer.succeed(Audit)({ release: () => Effect.sync(() => { events.push(name); }) });
await Effect.runPromise(register(owner).pipe(Effect.provide(audit("registration-context"))));
events.push("registered");
await Effect.runPromise(close(owner).pipe(Effect.provide(audit("closing-context"))));
await Effect.runPromise(register(owner).pipe(Effect.provide(audit("late-context"))));
const orderOwner = await Effect.runPromise(create());
const order = Layer.succeed(Order)({
  owner: () => Effect.sync(() => { events.push("owner"); return orderOwner; }),
  job: () => Effect.sync(() => { events.push("job"); return Effect.sync(() => { events.push("execute"); }); }),
  mark: (value: string) => Effect.sync(() => { events.push(value); }),
});
await Effect.runPromise(ordered().pipe(Effect.provide(order)));
await Effect.runPromise(provideOrdered().pipe(Effect.provide(order)));
await Effect.runPromise(close(orderOwner));
const another = await Effect.runPromise(create());
const entered = Deferred.makeUnsafe<void>();
const release = Deferred.makeUnsafe<void>();
const work = Layer.succeed(Work)({ wait: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(7)) });
const value = await Effect.runPromise(Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(ordinary(another).pipe(Effect.provide(work)));
  yield* Deferred.await(entered);
  yield* close(another);
  events.push("ordinary-still-running");
  yield* Deferred.succeed(release, undefined);
  return yield* Fiber.join(fiber);
}));
const after = await Effect.runPromise(ordinary(another).pipe(Effect.provide(work)));
console.log(JSON.stringify({ events, value, after }));
`,
    );
    assertEquals(result, {
      events: [
        "registered",
        "registration-context",
        "late-context",
        "owner",
        "job",
        "registered",
        "owner",
        "job",
        "execute",
        "execute",
        "ordinary-still-running",
      ],
      value: 7,
      after: 7,
    });
  });
});

Deno.test("mapGroups emits typed live routing with fresh state and closes unused or partial groups", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/groups/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const checked = checkProject(fileHost, dir, ["main.eff"]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        checked.value.analysis.project,
        lowerProject(checked.value),
      ).values()
    ) assertEquals(diagnostics, []);
    build(dir, ["main.eff"]);
    const formatted = await deno(dir, [
      "fmt",
      "--check",
      "main.ts",
      "contracts.ts",
    ]);
    assertEquals(formatted.code, 0, formatted.stderr);
    const result = await runScript(
      dir,
      `
import { Effect, Stream } from "effect";
import { grouped, skipped, firsts, branded } from "./main.ts";
import { Key } from "./contracts.ts";
let pulls = 0;
const source = Stream.unfold(0, n => Effect.sync(() => { pulls++; return n < 6 ? [n, n + 1] as const : undefined; }));
const saved = grouped(source);
const before = pulls;
const runs = [];
for (let run = 0; run < 2; run++) runs.push((await Effect.runPromise(Stream.runCollect(saved))).sort((a, b) => a.key - b.key));
const unused = (await Effect.runPromise(Stream.runCollect(skipped(Stream.make(0, 0, 0, 1, 1, 0, 2, 2, 0))))).sort();
const partial = (await Effect.runPromise(Stream.runCollect(firsts(Stream.make(0, 0, 0, 1, 1, 0, 2, 2, 0))))).sort((a, b) => a.key - b.key);
const keys = await Effect.runPromise(Stream.runCollect(branded(Stream.make(Key.make("a"), Key.make("b"), Key.make("a")))));
const empty = await Effect.runPromise(Stream.runCollect(grouped(Stream.empty)));
console.log(JSON.stringify({ before, pulls, runs, unused, partial, keys: keys.sort((a, b) => a[0]!.localeCompare(b[0]!)), empty }));
`,
    );
    const groups = [{ key: 0, items: [0, 3] }, { key: 1, items: [1, 4] }, {
      key: 2,
      items: [2, 5],
    }];
    assertEquals(result, {
      before: 0,
      pulls: 14,
      runs: [groups, groups],
      unused: [0, 1, 2],
      partial: [0, 1, 2].map((key) => ({
        key,
        first: { _id: "Option", _tag: "Some", value: key },
      })),
      keys: [["a", "a"], ["b"]],
      empty: [],
    });
  });
});

Deno.test("mapGroups emits a later live key, waits for cleanup, and applies per-key backpressure", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/groups/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { supervised } from "./main.ts";
import { Pull, Use } from "./contracts.ts";
const ready = Deferred.makeUnsafe<void>();
const events: string[] = [];
const source = Stream.unfold(0, (n): Effect.Effect<readonly [number, number]> => n < 2 ? Effect.succeed([n, n + 1] as const) : Effect.acquireUseRelease(
  Deferred.succeed(ready, undefined), () => Effect.never,
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("source-release"); })))));
const service = { value: (key: number) => Effect.acquireUseRelease(Effect.void,
  () => key === 0 ? Effect.never : Deferred.await(ready).pipe(Effect.as(key)),
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("group-release:" + key); })))) };
const first = await Effect.runPromise(Stream.runHead(supervised(source)).pipe(Effect.provideService(Use, service), Effect.provideService(Pull, { next: () => Effect.die("unexpected pull service") }), Effect.timeout("5 seconds")));
const entered = Deferred.makeUnsafe<void>();
const release = Deferred.makeUnsafe<void>();
const trace: string[] = [];
const pausedSource = Stream.unfold(0, n => Effect.sync(() => { trace.push("pull:" + n); return n < 4 ? [n < 3 ? 0 : 1, n + 1] as const : undefined; }));
let paused: string[] = [];
const outputs = await Effect.runPromise(Effect.gen(function* () {
  const child = yield* Effect.forkChild(Stream.runCollect(supervised(pausedSource)).pipe(Effect.provideService(Use, {
    value: key => key === 0 ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(key)) : Effect.succeed(key)
  })));
  yield* Deferred.await(entered);
  yield* Effect.yieldNow;
  paused = trace.slice();
  yield* Deferred.succeed(release, undefined);
  return yield* Fiber.join(child);
}).pipe(Effect.provideService(Pull, { next: () => Effect.die("unexpected pull service") }), Effect.timeout("5 seconds")));
console.log(JSON.stringify({ first: Option.getOrUndefined(first), events: events.sort(), paused, outputs: outputs.sort(), trace }));
`,
    );
    assertEquals(result, {
      first: 1,
      events: ["group-release:0", "group-release:1", "source-release"],
      paused: ["pull:0", "pull:1", "pull:2"],
      outputs: [0, 1],
      trace: ["pull:0", "pull:1", "pull:2", "pull:3", "pull:4"],
    });
  });
});

Deno.test("mapGroups preserves construction and deferred services and closes callback-owned scoped workers", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/groups/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Effect, Exit, Option, Stream } from "effect";
import { deferred, scopedWork } from "./main.ts";
import { BuildStop, Factory, Pull, Use, Worker } from "./contracts.ts";
const calls: string[] = [];
const saved = await Effect.runPromise(deferred().pipe(Effect.provideService(Factory, {
  source: () => Effect.sync(() => { calls.push("build"); return Stream.unfold(0, n => Pull.use(p => p.next(n)).pipe(Effect.map(Option.getOrUndefined))); })
})));
const before = calls.slice();
const runs = [];
for (const prefix of [10, 20]) runs.push((await Effect.runPromise(Stream.runCollect(saved).pipe(
  Effect.provideService(Pull, { next: n => Effect.sync(() => { calls.push("pull:" + prefix + ":" + n); return n < 2 ? Option.some([n, n + 1] as const) : Option.none(); }) }),
  Effect.provideService(Use, { value: key => Effect.sync(() => { calls.push("use:" + prefix + ":" + key); return prefix + key; }) })
))).sort());
const failed = await Effect.runPromiseExit(deferred().pipe(Effect.provideService(Factory, { source: () => Effect.fail(new BuildStop({})) })));
const started = new Map<number, Deferred.Deferred<void>>([[0, Deferred.makeUnsafe<void>()], [1, Deferred.makeUnsafe<void>()]]);
const workerEvents: string[] = [];
const worker = {
  run: (key: number) => Effect.acquireUseRelease(Deferred.succeed(started.get(key)!, undefined), () => Effect.never,
    () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { workerEvents.push("release:" + key); })))),
  wait: (key: number) => Deferred.await(started.get(key)!)
};
const worked: number[] = [];
await Effect.runPromise(Stream.runForEach(scopedWork(Stream.make(0, 1)), key => Effect.sync(() => {
  if (!workerEvents.includes("release:" + key)) throw new Error("result before callback worker cleanup");
  worked.push(key);
})).pipe(Effect.provideService(Worker, worker), Effect.timeout("5 seconds")));
console.log(JSON.stringify({ before, runs, buildFailure: Exit.isFailure(failed) && Option.getOrUndefined(Cause.findErrorOption(failed.cause))?._tag,
  pulls: calls.filter(c => c.startsWith("pull:")).length, uses: calls.filter(c => c.startsWith("use:")).length,
  worked: worked.sort(), workerEvents: workerEvents.sort() }));
`,
    );
    assertEquals(result, {
      before: ["build"],
      runs: [[10, 11], [20, 21]],
      buildFailure: "contracts#BuildStop",
      pulls: 6,
      uses: 4,
      worked: [0, 1],
      workerEvents: ["release:0", "release:1"],
    });
  });
});

Deno.test("mapGroups source failure, callback failure, and interruption await peer cleanup", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/groups/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Effect, Exit, Fiber, Option, Stream } from "effect";
import { supervised } from "./main.ts";
import { Pull, SourceStop, Use, UseStop } from "./contracts.ts";
const outcomes = [];
for (const mode of ["source", "callback", "interrupt"] as const) {
  const entered = Deferred.makeUnsafe<void>();
  const ready = Deferred.makeUnsafe<void>();
  const peer = Deferred.makeUnsafe<void>();
  const events: string[] = [];
  const source = mode === "source" ? Stream.concat(Stream.make(0), Stream.fromEffect(Deferred.await(entered).pipe(Effect.andThen(Effect.fail(new SourceStop({}))))))
    : mode === "interrupt" ? Stream.make(0) : Stream.concat(Stream.make(0, 1), Stream.fromEffect(Effect.acquireUseRelease(Deferred.succeed(ready, undefined), () => Effect.never,
      () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("source-release"); }))))));
  const program = Stream.runDrain(supervised(source)).pipe(Effect.provideService(Use, {
    value: key => Effect.acquireUseRelease(Deferred.succeed(entered, undefined),
      () => mode === "callback" ? key === 0 ? Deferred.await(peer).pipe(Effect.andThen(Deferred.await(ready)), Effect.andThen(Effect.fail(new UseStop({}))))
        : Deferred.succeed(peer, undefined).pipe(Effect.andThen(Effect.never)) : Effect.never,
      () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("group-release:" + key); }))))
  }), Effect.provideService(Pull, { next: () => Effect.die("unexpected pull service") }));
  const exit = mode === "interrupt" ? await Effect.runPromise(Effect.gen(function* () {
    const child = yield* Effect.forkChild(program);
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(child);
    return yield* Fiber.await(child);
  }).pipe(Effect.timeout("5 seconds"))) : await Effect.runPromiseExit(program.pipe(Effect.timeout("5 seconds")));
  outcomes.push({ mode, failed: Exit.isFailure(exit), error: Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag ?? null : null, events: events.sort() });
}
console.log(JSON.stringify(outcomes));
`,
    );
    assertEquals(result, [
      {
        mode: "source",
        failed: true,
        error: "contracts#SourceStop",
        events: ["group-release:0"],
      },
      {
        mode: "callback",
        failed: true,
        error: "contracts#UseStop",
        events: ["group-release:0", "group-release:1", "source-release"],
      },
      {
        mode: "interrupt",
        failed: true,
        error: null,
        events: ["group-release:0"],
      },
    ]);
  });
});

Deno.test("Sink transduction replays chunks, repeats with fresh state, and preserves terminal semantics", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const checked = checkProject(fileHost, dir, ["main.eff"]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        checked.value.analysis.project,
        lowerProject(checked.value),
      ).values()
    ) assertEquals(diagnostics, []);
    build(dir, ["main.eff"]);
    const formatted = await deno(dir, [
      "fmt",
      "--check",
      "main.ts",
      "contracts.ts",
    ]);
    assertEquals(formatted.code, 0, formatted.stderr);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Sink, Stream } from "effect";
import { batches, inline, first, broad, discardForeign, makePairs, withSink } from "./main.ts";
const outputs: Array<Array<ReadonlyArray<number>>> = [];
for (const size of [1, 2, 3, 10]) {
  const source = Stream.fromArray([1, 2, 3, 4, 5]).pipe(Stream.rechunk(size));
  const saved = batches(source);
  for (let run = 0; run < 2; run++) outputs.push(await Effect.runPromise(Stream.runCollect(saved)));
}
const exact = await Effect.runPromise(Stream.runCollect(inline(Stream.make(1, 2, 3, 4))));
const empty = await Effect.runPromise(Stream.runCollect(inline(Stream.empty)));
const terminal = await Effect.runPromise(first(Stream.make(1, 2, 3, 4)));
const wider = await Effect.runPromise(Stream.runCollect(broad(Stream.make("a", "b"), Sink.take<string | number>(2))));
const foreign = await Effect.runPromise(discardForeign(Stream.make(1, 2), Sink.succeed("ok", ["rest"])));
const made = await Effect.runPromise(Stream.runCollect(withSink(Stream.make(1, 2, 3), makePairs())));
const trace: string[] = [];
const chunked = Stream.fromPull(Effect.sync(() => {
  let index = 0;
  return Effect.suspend(() => { trace.push("pull:" + index); return index++ === 0 ? Effect.succeed([1, 2, 3, 4, 5] as const) : Cause.done(); });
}));
await Effect.runPromise(Stream.runForEach(batches(chunked), (batch) => Effect.sync(() => { trace.push("batch:" + batch.join(",")); })));
let zeroPulls = 0;
const unpulled = Stream.unfold(0, (n) => Effect.sync(() => { zeroPulls++; return [n, n + 1] as const; }));
const zero = await Effect.runPromise(Stream.runCollect(withSink(unpulled, Sink.succeed([42])).pipe(Stream.take(3))));
console.log(JSON.stringify({ outputs, exact, empty, terminal, wider, foreign, made, trace, zeroPulls, zero }));
`,
    );
    assertEquals(result, {
      outputs: Array.from({ length: 8 }, () => [[1, 2], [3, 4], [5]]),
      exact: [[1, 2], [3, 4], []],
      empty: [[]],
      terminal: [1, 2],
      wider: [["a", "b"], []],
      foreign: "ok",
      made: [[1, 2], [3]],
      trace: ["pull:0", "batch:1,2", "batch:3,4", "pull:1", "batch:5"],
      zeroPulls: 0,
      zero: [[42], [42], [42]],
    });
  });
});

Deno.test("Sink construction effects stay separate from consumption services and failures", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Option, Sink, Stream } from "effect";
import { Add, Factory, Pull, SourceStop, SinkStop, BuildStop } from "./contracts.ts";
import { fromFactory } from "./main.ts";
const events: string[] = [];
const factory = Layer.succeed(Factory)({
  source: () => Effect.sync(() => { events.push("source"); return Stream.unfold(0, (n) => Pull.use((pull) => pull.next(n)).pipe(Effect.map(Option.getOrUndefined))); }),
  sink: () => Effect.sync(() => { events.push("sink"); return Sink.foldUntil(() => 0, 2, (sum: number, n: number) => Add.use((add) => add.add(sum, n))); }),
});
const stream: Stream.Stream<number, SourceStop | SinkStop, Pull | Add> = await Effect.runPromise(fromFactory().pipe(Effect.provide(factory)));
const atConstruction = [...events];
const consume = (sourceFail: boolean, sinkFail: boolean) => {
  const seen: number[] = [];
  const job = Stream.runForEach(stream, (value) => Effect.sync(() => { seen.push(value); })).pipe(
    Effect.provideService(Pull, { next: (state) => Effect.sync(() => { events.push("pull:" + state); }).pipe(Effect.andThen(sourceFail && state === 3 ? Effect.fail(new SourceStop({})) : Effect.succeed(state < 4 ? Option.some([state + 1, state + 1] as const) : Option.none()))) }),
    Effect.provideService(Add, { add: (sum, n) => Effect.sync(() => { events.push("add:" + n); }).pipe(Effect.andThen(sinkFail && n === 3 ? Effect.fail(new SinkStop({})) : Effect.succeed(sum + n))) }),
  );
  return Effect.exit(job).pipe(Effect.map((exit) => ({ seen, tag: Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag : "Success" })));
};
const sinkFailure = await Effect.runPromise(consume(false, true));
const sourceFailure = await Effect.runPromise(consume(true, false));
const success = await Effect.runPromise(consume(false, false));
const failed = await Effect.runPromiseExit(fromFactory().pipe(Effect.provideService(Factory, {
  source: () => Effect.fail(new BuildStop({})),
  sink: () => Effect.sync(() => { throw new Error("sink constructed after failed source"); }),
})));
console.log(JSON.stringify({ atConstruction, sinkFailure, sourceFailure, success, buildFailure: Exit.isFailure(failed) && Cause.hasFails(failed.cause) }));
`,
    );
    assertEquals(result, {
      atConstruction: ["source", "sink"],
      sinkFailure: { seen: [3], tag: "contracts#SinkStop" },
      sourceFailure: { seen: [3, 3], tag: "contracts#SourceStop" },
      success: { seen: [3, 7, 0], tag: "Success" },
      buildFailure: true,
    });
  });
});

Deno.test("Sink transduction retains consumption scopes and closes pending pulls on interruption", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Effect, Exit, Fiber, Scope, Sink, Stream } from "effect";
import { batches, withSink } from "./main.ts";
const events: string[] = [];
let index = 0;
const tracked = Sink.fromTransform<number, number[], never, never, number>((upstream, scope) => Effect.gen(function* () {
  const current = ++index;
  events.push("start:" + current);
  yield* Scope.addFinalizer(scope, Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("release:" + current); }))));
  return yield* Sink.take<number>(2).transform(upstream, scope);
}));
await Effect.runPromise(Stream.runForEach(withSink(Stream.make(1, 2, 3), tracked), (value) => Effect.sync(() => { events.push("batch:" + value.join(",")); })));
const normal = [...events];
events.length = 0;
const failure = await Effect.runPromiseExit(Stream.runForEach(withSink(Stream.make(1, 2, 3), tracked), () => Effect.fail("consumer-stop")));
const consumerReleased = events.includes("release:3") && Exit.isFailure(failure);
events.length = 0;
const entered = Deferred.makeUnsafe<void>();
const pending = Stream.unfold(0, (state): Effect.Effect<readonly [number, number]> => state === 0 ? Effect.succeed([1, 1] as const) : Effect.acquireUseRelease(
  Deferred.succeed(entered, undefined), () => Effect.never,
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("source-release"); }))),
));
await Effect.runPromise(Effect.gen(function* () {
  const child = yield* Effect.forkChild(Stream.runDrain(withSink(pending, tracked)));
  yield* Deferred.await(entered);
  yield* Fiber.interrupt(child);
}));
const interrupted = [...events].sort();
const seen: Array<ReadonlyArray<number>> = [];
const defect = await Effect.runPromiseExit(Stream.runForEach(batches(Stream.concat(Stream.make(1, 2, 3), Stream.fromEffect(Effect.die("source-defect")))), (value) => Effect.sync(() => { seen.push(value); })));
console.log(JSON.stringify({ normal, consumerReleased, interrupted, seen, defect: Exit.isFailure(defect) && Cause.hasDies(defect.cause) }));
`,
    );
    assertEquals(result, {
      normal: [
        "start:1",
        "batch:1,2",
        "start:2",
        "batch:3",
        "release:2",
        "release:1",
      ],
      consumerReleased: true,
      interrupted: ["release:4", "source-release", "start:4"],
      seen: [[1, 2]],
      defect: true,
    });
  });
});

Deno.test("Sink host providers retain leftover types across the existing interface boundary", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(
      `${dir}/effektive.json`,
      JSON.stringify({
        host: { sinks: { interface: "./host.effi", module: "./host.ts" } },
      }),
    );
    build(dir, ["host-main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Stream } from "effect";
import { make } from "./host-main.ts";
import { Add, Pull } from "./contracts.ts";
const source = await Effect.runPromise(make());
const values = await Effect.runPromise(Stream.runCollect(source).pipe(
  Effect.provideService(Add, { add: (sum, n) => Effect.succeed(sum + n) }),
  Effect.provideService(Pull, { next: () => Effect.die("unexpected pull service") }),
));
console.log(JSON.stringify(values));
`,
    );
    assertEquals(result, [3, 3]);
    Deno.writeTextFileSync(
      `${dir}/host.ts`,
      `
import { Effect, Layer, Sink, Stream } from "effect";
import { Factory } from "./contracts.ts";
export const FactoryLive = Layer.succeed(Factory)({
  source: () => Effect.succeed(Stream.make(1)),
  sink: () => Effect.succeed(Sink.succeed(1, ["wrong leftover"])),
});
`,
    );
    const wrong = await deno(dir, ["check", "host-main.ts"]);
    assert(
      wrong.code !== 0 && wrong.stderr.includes("string") &&
        wrong.stderr.includes("number"),
      wrong.stderr,
    );
  });
});

Deno.test("aggregateStream emits target batches, replay, and demand behavior", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const checked = checkProject(fileHost, dir, ["main.eff"]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        checked.value.analysis.project,
        lowerProject(checked.value),
      ).values()
    ) assertEquals(diagnostics, []);
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Deferred, Effect, Fiber, Sink, Stream } from "effect";
import { aggregated, aggregatedInline, aggregateOne, aggregatedBroad, aggregateWithSink } from "./main.ts";
const outputs: Array<Array<ReadonlyArray<number>>> = [];
const targetOutputs: Array<Array<ReadonlyArray<number>>> = [];
for (const size of [1, 2, 3, 10]) {
  const source = Stream.fromArray([1, 2, 3, 4, 5]).pipe(Stream.rechunk(size));
  const saved = aggregated(source);
  for (let run = 0; run < 2; run++) {
    outputs.push(await Effect.runPromise(Stream.runCollect(saved)));
    targetOutputs.push(await Effect.runPromise(Stream.runCollect(Stream.aggregate(source, Sink.take<number>(2)))));
  }
}
const exact = await Effect.runPromise(Stream.runCollect(aggregatedInline(Stream.make(1, 2, 3, 4))));
const empty = await Effect.runPromise(Stream.runCollect(aggregatedInline(Stream.empty)));
const broad = await Effect.runPromise(Stream.runCollect(aggregatedBroad(Stream.make("a", "b"), Sink.take<string | number>(2))));
const zero = await Effect.runPromise(Stream.runCollect(aggregateWithSink(Stream.never, Sink.succeed([42])).pipe(Stream.take(3))));
let pulls = 0;
const demand = await Effect.runPromise(Effect.gen(function* () {
  const first = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const source = Stream.unfold(0, (n) => Effect.sync(() => { pulls++; return n < 3 ? [n + 1, n + 1] as const : undefined; }));
  const child = yield* Stream.runForEach(aggregateOne(source), (batch) => batch[0] === 1
    ? Deferred.succeed(first, undefined).pipe(Effect.andThen(Deferred.await(release)))
    : Effect.void).pipe(Effect.forkChild);
  yield* Deferred.await(first);
  yield* Effect.yieldNow;
  const blocked = pulls;
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(child);
  return { blocked, total: pulls };
}).pipe(Effect.timeout("5 seconds")));
console.log(JSON.stringify({ outputs, targetOutputs, exact, empty, broad, zero, demand }));
`,
    );
    const actual = result as {
      outputs: unknown[];
      targetOutputs: unknown[];
      exact: unknown;
      empty: unknown;
      broad: unknown;
      zero: unknown;
      demand: unknown;
    };
    assertEquals(actual.outputs, actual.targetOutputs);
    assertEquals(actual.outputs.length, 8);
    assertEquals({
      exact: actual.exact,
      empty: actual.empty,
      broad: actual.broad,
      zero: actual.zero,
      demand: actual.demand,
    }, {
      exact: [[1, 2], [3, 4]],
      empty: [],
      broad: [["a", "b"]],
      zero: [[42], [42], [42]],
      demand: { blocked: 1, total: 4 },
    });
  });
});

Deno.test("aggregateStream retains deferred failures and awaits cancellation cleanup", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/sinks/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Sink, Stream } from "effect";
import { aggregatedFailing, aggregateWithSink, aggregateFromFactory } from "./main.ts";
import { Add, BuildStop, Factory, Pull, SinkStop, SourceStop } from "./contracts.ts";
const seen: Array<ReadonlyArray<number>> = [];
const sourceFailure = await Effect.runPromiseExit(Stream.runForEach(
  aggregatedFailing(Stream.concat(Stream.fromArray([1, 2, 3]), Stream.fail(new SourceStop({})))),
  (batch) => Effect.sync(() => { seen.push(batch); }),
));
const events: string[] = [];
const factory = Layer.succeed(Factory)({
  source: () => Effect.sync(() => { events.push("source"); return Stream.unwrap(Pull.use((pull) => pull.next(0)).pipe(Effect.map(() => Stream.fromArray([1, 2, 3, 4])))); }),
  sink: () => Effect.sync(() => { events.push("sink"); return Sink.foldUntil(() => 0, 2, (sum: number, n: number) => Add.use((add) => add.add(sum, n))); }),
});

const saved = await Effect.runPromise(aggregateFromFactory().pipe(Effect.provide(factory)));
const atConstruction = [...events];
const consume = (failSink: boolean) => {
  const values: number[] = [];
  return Effect.exit(Stream.runForEach(saved, (n) => Effect.sync(() => { values.push(n); })).pipe(
    Effect.provideService(Pull, { next: (state) => Effect.succeed(state < 4 ? Option.some([state + 1, state + 1] as const) : Option.none()) }),
    Effect.provideService(Add, { add: (sum, n) => failSink && n === 3 ? Effect.fail(new SinkStop({})) : Effect.succeed(sum + n) }),
  )).pipe(Effect.map((exit) => ({ values, tag: Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag : "Success" })));
};
const failed = await Effect.runPromise(consume(true));
const succeeded = await Effect.runPromise(consume(false));
const buildFailure = await Effect.runPromiseExit(aggregateFromFactory().pipe(Effect.provideService(Factory, {
  source: () => Effect.fail(new BuildStop({})),
  sink: () => Effect.sync(() => { throw new Error("sink should not be constructed"); }),
})));
const cleanup: string[] = [];
const cancellation = await Effect.runPromise(Effect.gen(function* () {
  const pending = yield* Deferred.make<void>();
  const source = Stream.unfold(0, (n): Effect.Effect<readonly [number, number] | undefined> => n === 0
    ? Effect.succeed([1, 1] as const)
    : Effect.acquireUseRelease(
      Deferred.succeed(pending, undefined), () => Effect.never,
      () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { cleanup.push("source-release"); }))),
    ));
  const child = yield* Stream.runCollect(aggregateWithSink(source, Sink.take<number>(2))).pipe(Effect.forkChild);
  yield* Deferred.await(pending);
  yield* Fiber.interrupt(child);
  return yield* Effect.exit(Fiber.join(child));
}).pipe(Effect.timeout("5 seconds")));
console.log(JSON.stringify({
  seen, sourceFailure: Exit.isFailure(sourceFailure) && Option.getOrUndefined(Cause.findErrorOption(sourceFailure.cause))?._tag,
  atConstruction, failed, succeeded, buildFailure: Exit.isFailure(buildFailure) && Cause.hasFails(buildFailure.cause),
  cancellation: Exit.isFailure(cancellation) && Cause.hasInterrupts(cancellation.cause), cleanup,
}));
`,
    );
    assertEquals(result, {
      seen: [[1, 2], [3]],
      sourceFailure: "contracts#SourceStop",
      atConstruction: ["source", "sink"],
      failed: { values: [3], tag: "contracts#SinkStop" },
      succeeded: { values: [3, 7], tag: "Success" },
      buildFailure: true,
      cancellation: true,
      cleanup: ["source-release"],
    });
  });
});

Deno.test("general Schedule values drive timed aggregation with fresh state and cleanup", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/schedules/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const checked = checkProject(fileHost, dir, ["main.eff"]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        checked.value.analysis.project,
        lowerProject(checked.value),
      ).values()
    ) {
      assertEquals(diagnostics, []);
    }
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Pull, Schedule, Stream } from "effect";
import { TestClock } from "effect/testing";
import { controlled, custom, early, mapped, Policy, Stop, timed } from "./main.ts";
let chooseCalls = 0;
let labelCalls = 0;
const good = {
  choose: (_input: Option.Option<ReadonlyArray<number>>, attempt: number) => Effect.sync(() => { chooseCalls++; return attempt; }),
  label: (output: number) => Effect.sync(() => { labelCalls++; return output + 100; }),
};
const atConstruction = [chooseCalls, labelCalls];
const run = Effect.gen(function* () {
  const step = yield* Schedule.toStep(mapped);
  const [first, firstDelay] = yield* step(0, Option.none());
  const [second] = yield* step(1, Option.some([1]));
  const done = yield* Pull.matchEffect(step(2, Option.some([2])), {
    onSuccess: () => Effect.succeed(-1),
    onDone: Effect.succeed,
    onFailure: Effect.failCause,
  });
  return [first, Duration.toMillis(firstDelay), second, done];
});

const first = await Effect.runPromise(Effect.provideService(run, Policy, good));
const second = await Effect.runPromise(Effect.provideService(run, Policy, good));
let failedLabels = 0;
const completionFailure = await Effect.runPromiseExit(Effect.provideService(run, Policy, {
  choose: good.choose,
  label: (output: number) => Effect.sync(() => ++failedLabels).pipe(Effect.flatMap((n) =>
    n === 3 ? Effect.fail(new Stop({})) : Effect.succeed(output + 100))),
}));
let pulls = 0;
const ended = await Effect.runPromise(Stream.runCollect(early(Stream.unfold(0, (n) => Effect.sync(() => {
  pulls++;
  return n < 3 ? [n + 1, n + 1] as const : undefined;
})))).pipe(Effect.timeout("5 seconds")));
const flushed = await Effect.runPromise(Effect.gen(function* () {
  const firstPull = yield* Deferred.make<void>();
  const source = Stream.unfold(0, (n): Effect.Effect<readonly [number, number] | undefined> =>
    n === 0 ? Deferred.succeed(firstPull, undefined).pipe(Effect.as([1, 1] as const)) : Effect.never);
  const fiber = yield* Stream.runCollect(Stream.take(timed(source), 1)).pipe(Effect.forkChild);
  yield* Deferred.await(firstPull);
  yield* TestClock.adjust("1 seconds");
  return yield* Fiber.join(fiber);
}).pipe(Effect.provide(TestClock.layer()), Effect.timeout("5 seconds")));
const events: string[] = [];
const source = Stream.scoped(Stream.fromEffect(Effect.acquireRelease(
  Effect.sync(() => { events.push("acquire"); return 1; }),
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("release"); }))),
))).pipe(Stream.concat(Stream.never));
const failed = await Effect.runPromiseExit(Stream.runCollect(controlled(source)).pipe(
  Effect.provideService(Policy, {
    choose: good.choose,
    label: (_output: number) => Effect.fail(new Stop({})),
  }),
  Effect.timeout("5 seconds"),
));
console.log(JSON.stringify({
  atConstruction, first, second, chooseCalls, labelCalls, failedLabels,
  completionFailure: Exit.isFailure(completionFailure) ? Option.getOrUndefined(Cause.findErrorOption(completionFailure.cause))?._tag : "Success",
  ended, pulls, flushed, events,
  failed: Exit.isFailure(failed) ? Option.getOrUndefined(Cause.findErrorOption(failed.cause))?._tag : "Success",
}));
`,
    );
    assertEquals(result, {
      atConstruction: [0, 0],
      first: [101, 0, 102, 102],
      second: [101, 0, 102, 102],
      chooseCalls: 11,
      labelCalls: 6,
      failedLabels: 3,
      completionFailure: "main#Stop",
      ended: [[1]],
      pulls: 1,
      flushed: [[1]],
      events: ["acquire", "release"],
      failed: "main#Stop",
    });
  });
});

Deno.test("composed Schedule values preserve delays, phases, fresh state, and failure", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/schedules/", FIXTURES), dir);
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    const checked = checkProject(fileHost, dir, ["composition.eff"]);
    assert(checked.ok);
    assertEquals(checked.value.diagnostics, []);
    for (
      const diagnostics of validateProject(
        checked.value.analysis.project,
        lowerProject(checked.value),
      ).values()
    ) {
      assertEquals(diagnostics, []);
    }
    build(dir, ["composition.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Duration, Effect, Exit, Option, Pull, Schedule, Stream } from "effect";
import { assembled, batches, combined, Factory, fastest, LeftPolicy, LeftStop, phases, RightPolicy, RightStop, short, slowest } from "./composition.ts";
const trace = (policy: Schedule.Schedule<number>) => Effect.gen(function* () {
  const step = yield* Schedule.toStep(policy);
  const decisions: unknown[] = [];
  for (let index = 0; index < 6; index++) {
    const result = yield* Pull.matchEffect(step(index * 100, undefined), {
      onSuccess: ([output, delay]) => Effect.succeed({ kind: "Continue" as const, output, delay: Duration.toMillis(delay) }),
      onDone: (output) => Effect.succeed({ kind: "Done" as const, output }),
      onFailure: Effect.failCause,
    });
    decisions.push(result);
    if (result.kind === "Done") break;
  }
  return decisions;
});
const first = [
  await Effect.runPromise(trace(slowest)),
  await Effect.runPromise(trace(fastest)),
  await Effect.runPromise(trace(phases)),
];
const second = [
  await Effect.runPromise(trace(slowest)),
  await Effect.runPromise(trace(fastest)),
  await Effect.runPromise(trace(phases)),
];
let leftCalls = 0;
let rightCalls = 0;
const service = {
  left: { next: () => Effect.sync(() => ++leftCalls).pipe(Effect.flatMap((n) => n === 2 ? Effect.fail(new LeftStop({})) : Effect.succeed(n))) },
  right: { next: () => Effect.sync(() => ++rightCalls) },
};
const atConstruction = [leftCalls, rightCalls];
let factoryCalls = 0;
const built = await Effect.runPromise(assembled().pipe(Effect.provideService(Factory, {
  make: () => Effect.sync(() => { factoryCalls++; return short; }),
})));
const beforeStep = [factoryCalls, leftCalls, rightCalls];
const constructed = await Effect.runPromise(Effect.gen(function* () {
  const step = yield* Schedule.toStep(built);
  const [output, delay] = yield* step(0, Option.none());
  return [output, Duration.toMillis(delay)];
}).pipe(Effect.provideService(LeftPolicy, { next: () => Effect.succeed(7) })));
const failure = await Effect.runPromise(Effect.gen(function* () {
  const step = yield* Schedule.toStep(combined);
  const [output, delay] = yield* step(0, Option.none());
  const exit = yield* Effect.exit(step(1, Option.some([1])));
  return { output, delay: Duration.toMillis(delay), exit };
}).pipe(
  Effect.provideService(LeftPolicy, service.left),
  Effect.provideService(RightPolicy, service.right),
));
let otherRightCalls = 0;
const rightFailure = await Effect.runPromiseExit(Effect.gen(function* () {
  const step = yield* Schedule.toStep(combined);
  return yield* step(0, Option.none());
}).pipe(
  Effect.provideService(LeftPolicy, { next: () => Effect.succeed(1) }),
  Effect.provideService(RightPolicy, { next: () => Effect.sync(() => ++otherRightCalls).pipe(Effect.flatMap(() => Effect.fail(new RightStop({})))) }),
));
const events: string[] = [];
const source = Stream.scoped(Stream.fromEffect(Effect.acquireRelease(
  Effect.sync(() => { events.push("acquire"); return 1; }),
  () => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => { events.push("release"); }))),
))).pipe(Stream.concat(Stream.never));
const stopped = await Effect.runPromiseExit(Stream.runCollect(batches(source)).pipe(
  Effect.provideService(LeftPolicy, { next: () => Effect.fail(new LeftStop({})) }),
  Effect.provideService(RightPolicy, { next: () => Effect.succeed(1) }),
  Effect.timeout("5 seconds"),
));
console.log(JSON.stringify({
  first, second, atConstruction, factoryCalls, beforeStep, constructed, leftCalls, rightCalls,
  initial: [failure.output, failure.delay],
  failed: Exit.isFailure(failure.exit) ? Option.getOrUndefined(Cause.findErrorOption(failure.exit.cause))?._tag : "Success",
  rightFailed: Exit.isFailure(rightFailure) ? Option.getOrUndefined(Cause.findErrorOption(rightFailure.cause))?._tag : "Success",
  otherRightCalls,
  events,
  stopped: Exit.isFailure(stopped) ? Option.getOrUndefined(Cause.findErrorOption(stopped.cause))?._tag : "Success",
}));
`,
    );
    const shortExpected = [
      { kind: "Continue", output: 20, delay: 20 },
      { kind: "Done", output: 0 },
    ];
    const longExpected = [
      { kind: "Continue", output: 10, delay: 10 },
      { kind: "Continue", output: 20, delay: 20 },
      { kind: "Continue", output: 20, delay: 20 },
      { kind: "Done", output: 0 },
    ];
    const phasesExpected = [
      { kind: "Continue", output: 0, delay: 10 },
      { kind: "Continue", output: 0, delay: 20 },
      { kind: "Continue", output: 1, delay: 20 },
      { kind: "Continue", output: 2, delay: 20 },
      { kind: "Done", output: 3 },
    ];
    assertEquals(result, {
      first: [shortExpected, longExpected, phasesExpected],
      second: [shortExpected, longExpected, phasesExpected],
      atConstruction: [0, 0],
      factoryCalls: 1,
      beforeStep: [1, 0, 0],
      constructed: [10, 10],
      leftCalls: 2,
      rightCalls: 1,
      initial: [1, 1],
      failed: "composition#LeftStop",
      rightFailed: "composition#RightStop",
      otherRightCalls: 1,
      events: ["acquire", "release"],
      stopped: "composition#LeftStop",
    });
  });
});

Deno.test("a match throws for a value outside its type: pure, effect, and stream callback", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/unmatched/", FIXTURES), dir);
    build(dir, ["main.eff"]);
    await check(dir, ["main.ts"]);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Stream } from "effect";
import * as M from "./main.ts";

const circle = M.Circle.make({ radius: "r" });
const square = M.Square.make({ side: "s" });
const outside = {
  shape: { _tag: "main#Other" },
  status: "refunded",
  figure: { kind: "triangle" },
};
const thrown = (run: () => unknown): string => {
  try {
    run();
    return "no throw";
  } catch (e) {
    return e instanceof TypeError ? e.message : String(e);
  }
};
const NamesLive = Layer.succeed(M.Names)({ label: () => Effect.succeed("n") });
const dies = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause)
    ? (Cause.squash(exit.cause) as Error).message
    : "no defect";
const effectExit = (job: Effect.Effect<unknown, never, M.Names>) =>
  Effect.runPromiseExit(job.pipe(Effect.provide(NamesLive)));
const streamExit = <A>(stream: Stream.Stream<A>) =>
  Effect.runPromiseExit(Stream.runCollect(stream));

console.log(JSON.stringify({
  pure: [
    thrown(() => M.shapePure(outside.shape as never)),
    thrown(() => M.statusPure(outside.status as never)),
    thrown(() => M.figurePure(outside.figure as never)),
  ],
  effect: [
    dies(await effectExit(M.shapeEffect(outside.shape as never))),
    dies(await effectExit(M.statusEffect(outside.status as never))),
    dies(await effectExit(M.figureEffect(outside.figure as never))),
  ],
  stream: [
    dies(await streamExit(M.shapeStream(Stream.make(outside.shape as never)))),
    dies(await streamExit(M.statusStream(Stream.make(outside.status as never)))),
    dies(await streamExit(M.figureStream(Stream.make(outside.figure as never)))),
  ],
  valid: {
    pure: [
      M.shapePure(circle), M.shapePure(square),
      M.statusPure("pending"), M.statusPure("paid"),
      M.figurePure({ kind: "circle", radius: "r" }),
      M.figurePure({ kind: "square", side: "s" }),
    ],
    effect: await Effect.runPromise(
      Effect.all([M.shapeEffect(circle), M.shapeEffect(square), M.statusEffect("pending")])
        .pipe(Effect.provide(NamesLive)),
    ),
    stream: Array.from(await Effect.runPromise(Stream.runCollect(M.shapeStream(Stream.make(circle, square))))),
  },
  wild: [M.shapeWild(circle), M.shapeWild(outside.shape as never)],
}));
`,
    );
    const m = "a match received a value outside its type";
    assertEquals(result, {
      pure: [m, m, m],
      effect: [m, m, m],
      stream: [m, m, m],
      valid: {
        pure: ["r", "s", "p", "q", "r", "s"],
        effect: ["n", "s", "n"],
        stream: ["r", "s"],
      },
      wild: ["r", "other"],
    });
  });
});

// ------------------------------------------------------------------ host checks (HB4)

const HOST_CHECKS_ENTRIES = ["main.eff"];

const HOST_CHECKS_SCRIPT = `
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
import * as C from "./contracts.ts";
import * as M from "./main.ts";

const ClockLive = Layer.succeed(C.Clock)({ now: () => Effect.succeed(7) });
const exitOf = <A, E>(job: Effect.Effect<A, E, C.Clock>) =>
  Effect.runPromiseExit(job.pipe(Effect.provide(ClockLive)));
const value = async <A, E>(job: Effect.Effect<A, E, C.Clock>): Promise<A> => {
  const exit = await exitOf(job);
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  return exit.value;
};
const defect = async <A, E>(job: Effect.Effect<A, E, C.Clock>): Promise<string> => {
  const exit = await exitOf(job);
  return Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause)
    ? (Cause.squash(exit.cause) as Error).message
    : "no defect";
};
const streamValue = <A, E>(job: Effect.Effect<Stream.Stream<A, E, C.Clock>, E, C.Clock>) =>
  job.pipe(Effect.flatMap((stream) => Effect.all([Stream.runCollect(stream), Stream.runCollect(Stream.chunks(stream))])));
`;

function buildHostChecks(dir: string): Built {
  copyDirectory(new URL("emit/host-checks/", FIXTURES), dir);
  return buildProject(dir, HOST_CHECKS_ENTRIES);
}

Deno.test("a host check accepts a data value with a missing optional prototype-named field", async () => {
  await withTemporary(async (dir) => {
    const files: Record<string, string> = {
      "effektive.json":
        '{ "host": { "h": { "interface": "./h.effi", "module": "./h.ts" } } }',
      "h.effi": [
        "export type Text = string",
        "export type Tok = { label: Text, toString?: Text }",
        "export type Other = { label: Text }",
        "export type Records = Tok | Other",
        "export service Auth { token(): Tok }",
        "export provider AuthLive provides Auth",
        "",
      ].join("\n"),
      "main.eff": [
        'import { Tok, Auth, AuthLive } from "host:h"',
        "export const token = (): Tok => provide(AuthLive, () => Auth.token())",
        "",
      ].join("\n"),
      "h.ts": [
        'import { Effect, Layer } from "effect";',
        'import { Auth, Tok } from "./h.effi.ts";',
        "// `make` reads the missing `toString` through the prototype chain.",
        'const input = Object.assign(Object.create(null), { label: "a" });',
        "export const AuthLive = Layer.succeed(Auth)({",
        "  token: () => Effect.succeed(Tok.make(input)),",
        "});",
        "",
      ].join("\n"),
    };
    for (const [path, text] of Object.entries(files)) {
      Deno.writeTextFileSync(`${dir}/${path}`, text);
    }
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { token } from "./main.ts";
console.log(JSON.stringify(await Effect.runPromise(token())));
`,
    );
    assertEquals(result, { _tag: "h#Tok", label: "a" });
  });
});

Deno.test("a wrapped host provider passes correct values, keeps stream chunks, and leaves other methods alone", async () => {
  await withTemporary(async (dir) => {
    const built = buildHostChecks(dir);
    assertEquals([...built.paths].sort(), [
      "contracts.ts",
      "host.effi.ts",
      "main.ts",
    ]);
    await check(dir, ["main.ts", "contracts.ts", "host.ts"]);
    const main = built.emitted.get("main")?.text ?? "";
    assert(main.includes("Layer.mergeAll("), main);
    const result = await runScript(
      dir,
      HOST_CHECKS_SCRIPT + `
const boom = await exitOf(M.get("boom"));
const [items, chunks] = await value(streamValue(M.watch()));
console.log(JSON.stringify({
  get: await value(M.get("k")),
  find: await value(M.find("f")),
  list: await value(M.list()),
  summary: await value(M.summary()),
  items,
  chunks: chunks.length,
  total: await value(M.total()),
  ping: await value(M.ping()),
  token: await Effect.runPromise(M.token()),
  boomFails: Exit.isFailure(boom) && Cause.hasFails(boom.cause) && !Cause.hasDies(boom.cause),
}));
`,
    );
    assertEquals(result, {
      get: { _tag: "contracts#Row", id: "k1" },
      find: {
        _id: "Option",
        _tag: "Some",
        value: { _tag: "contracts#Row", id: "f" },
      },
      list: [{ _tag: "contracts#Row", id: "r" }, {
        _tag: "contracts#Gap",
        id: "g",
      }],
      summary: { count: 2, first: { _tag: "contracts#Row", id: "first" } },
      items: [
        { _tag: "contracts#Row", id: "s1" },
        { _tag: "contracts#Gap", id: "s2" },
        { _tag: "contracts#Row", id: "s3" },
      ],
      chunks: 1,
      total: 7,
      ping: "pong",
      token: { _tag: "host#Token", id: "t" },
      boomFails: true,
    });
  });
});

Deno.test("a wrong tag through a cast dies on each checked method and names the method and the issue path", async () => {
  await withTemporary(async (dir) => {
    buildHostChecks(dir);
    Deno.copyFileSync(`${dir}/host-wrong.ts`, `${dir}/host.ts`);
    await check(dir, ["main.ts", "contracts.ts", "host.ts"]);
    const result = await runScript(
      dir,
      HOST_CHECKS_SCRIPT + `
console.log(JSON.stringify({
  get: await defect(M.get("k")),
  find: await defect(M.find("f")),
  list: await defect(M.list()),
  watch: await defect(streamValue(M.watch())),
  summary: await defect(M.summary()),
  total: await value(M.total()),
  ping: await value(M.ping()),
  token: await defect(M.token()),
}));
`,
    );
    assert(typeof result === "object" && result !== null);
    const found = result as Record<string, unknown>;
    const message = (method: string, path: string) => {
      const text = found[method];
      assert(typeof text === "string", `${method}: ${JSON.stringify(text)}`);
      assert(
        text.startsWith(
          `host value of Rows.${method} does not match its type: `,
        ),
        text,
      );
      assert(!text.includes("\n"), text);
      assert(path === "" || text.includes(path), `${method}: ${text}`);
    };
    message("get", "");
    message("find", "");
    message("list", "at [1]");
    message("watch", "");
    message("summary", 'at ["first"]');
    // A method without a data result passes the value through.
    assertEquals(found.total, 1.5);
    assertEquals(found.ping, "pong");
    // A data type of the host interface has a schema in the companion module, so its result is checked too.
    const token = found.token;
    assert(typeof token === "string", JSON.stringify(token));
    assert(
      token.startsWith("host value of Auth.token does not match its type: "),
      token,
    );
  });
});

Deno.test("the emitted host check modules are a fixed point of deno fmt", async () => {
  await withTemporary(async (dir) => {
    const built = buildHostChecks(dir);
    const run = await deno(dir, ["fmt", "--check", ...built.paths]);
    assertEquals(run.code, 0, `deno fmt --check failed:\n${run.stderr}`);
    assert(
      run.stderr.includes("Checked 3 files"),
      `deno fmt did not check all three files:\n${run.stderr}`,
    );
  });
});

Deno.test("a host module with its own service class and a missing method gives one host-boundary diagnostic on the wrapped provider", async () => {
  await withTemporary(async (dir) => {
    const built = buildHostChecks(dir);
    Deno.writeTextFileSync(
      `${dir}/host.ts`,
      [
        'import { Context, Effect, Layer } from "effect";',
        'import { Pings, Row } from "./contracts.ts";',
        'import { Auth, Token } from "./host.effi.ts";',
        'export const AuthLive = Layer.succeed(Auth)({ token: () => Effect.succeed(Token.make({ id: "t" })) });',
        'class OwnRows extends Context.Service<OwnRows, { readonly get: (key: string) => Effect.Effect<Row> }>()("contracts#Rows") {}',
        "export const RowsLive = Layer.merge(",
        '  Layer.succeed(OwnRows)({ get: () => Effect.succeed(Row.make({ id: "x" })) }),',
        '  Layer.succeed(Pings)({ ping: () => Effect.succeed("pong") }),',
        ");",
        "",
      ].join("\n"),
    );
    const run = await deno(dir, [
      "check",
      "--config",
      "deno.json",
      ...built.paths,
      "host.ts",
    ]);
    assertEquals(run.code, 1, `deno check should fail:\n${run.stderr}`);
    const output = parseDenoCheck(run.stderr, Deno.realPathSync(dir));
    assertEquals(output.other, [], run.stderr);
    const imports = hostImportSpans(built.project);
    const tables = new Map(
      [...built.emitted].map(([name, module]) => [
        module.path,
        buildSpanTable(module, imports.get(name)),
      ]),
    );
    const mapped = output.diagnostics.map((d) => mapTscDiagnostic(d, tables));
    assertEquals(mapped.length, 1, run.stderr);
    const only = mapped[0];
    assert(only.tag === "host-boundary", JSON.stringify(only));
    assertEquals(only.diagnostic.code, "host-boundary/001");
    const source = Deno.readTextFileSync(
      `${dir}/${only.diagnostic.span.source}`,
    );
    assertEquals(spanText(source, only.diagnostic.span), "RowsLive");
  });
});
