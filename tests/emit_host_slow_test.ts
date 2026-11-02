// Slow tests of the emitter: the host boundary and host checks. Each test
// copies a fixture project to a temporary directory, builds there, and runs
// `deno check`, `deno fmt`, or `deno run` on the result. Nothing is written
// under fixtures/.

import { assert, assertEquals } from "@std/assert";
import {
  checkProject,
  lineStarts,
  lowerProject,
  positionOf,
} from "../src/core/frontend.ts";
import { validateProject } from "../src/core/validate_project.ts";
import {
  buildSpanTable,
  hostImportSpans,
  hostModulePaths,
  mapTscDiagnostic,
  parseDenoCheck,
} from "../src/core/typescript.ts";
import {
  copyDirectory,
  EXAMPLE_ENTRIES,
  FIXTURES,
  hostBoundaryManifest,
  spanText,
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
