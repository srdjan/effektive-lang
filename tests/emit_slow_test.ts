// Slow tests of the emitter: type check and formatting. Each test copies a
// fixture project to a temporary directory, builds there, and runs `deno
// check`, `deno fmt`, or `deno run` on the result. Nothing is written under
// fixtures/.

import { assert, assertEquals } from "@std/assert";
import { copyDirectory, FIXTURES, listFixtures } from "./helpers.ts";
import { deno, runScript } from "./process_helpers.ts";
import {
  build,
  buildExamples,
  buildForms,
  check,
  LONG_NAMES,
  withTemporary,
} from "./emit_slow_helpers.ts";

Deno.test("host providers preserve shared scope handles and reject raw target scopes", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/scopes/", FIXTURES), dir);
    Deno.writeTextFileSync(
      `${dir}/effektive.json`,
      JSON.stringify({
        host: {
          boundary: { interface: "./host.effi", module: "./host.ts" },
        },
      }),
    );
    build(dir, ["host-main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { create, close } from "./owner.ts";
import { pass } from "./host-main.ts";
const owner = await Effect.runPromise(create());
const received = await Effect.runPromise(pass(owner));
await Effect.runPromise(close(received));
console.log(JSON.stringify({ same: received === owner }));
`,
    );
    assertEquals(result, { same: true });
    Deno.writeTextFileSync(
      `${dir}/host.ts`,
      `
import { Layer, Scope } from "effect";
import { Boundary } from "./boundary.ts";
import type { Owner } from "./owner.ts";
export const BoundaryLive = Layer.succeed(Boundary)({ accept: (_owner: Owner) => Scope.make() });
`,
    );
    const wrong = await deno(dir, ["check", "host-main.ts"]);
    assert(wrong.code !== 0, wrong.stdout + wrong.stderr);
    assert(
      wrong.stderr.includes("Closeable") && wrong.stderr.includes("done"),
      wrong.stderr,
    );
  });
});

// ------------------------------------------------------------------ type check

Deno.test("the emitted examples and users-live.ts pass deno check under strict settings", async () => {
  await withTemporary(async (dir) => {
    const generated = buildExamples(dir);
    assertEquals(
      [...generated].sort(),
      [
        "collections.ts",
        "host/providers.effi.ts",
        "log.ts",
        "main.ts",
        "pay.ts",
        "users.ts",
      ],
    );
    await check(dir, [...generated, "users-live.ts"]);
  });
});

Deno.test("the emitted forms and name-collision modules pass deno check", async () => {
  await withTemporary(async (dir) => {
    await check(dir, buildForms(dir));
  });
});

Deno.test("contextual Some payloads retain tuple shape and literals through Effect callbacks", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.copyFileSync(
      new URL("emit/contextual-options.eff", FIXTURES),
      `${dir}/main.eff`,
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
import { source, nested, record, array, tupleArray, emptyTuple, selected, effectful, Probe, Stop } from "./main.ts";
const unwrap = <A>(value: Option.Option<A>): A => {
  if (Option.isNone(value)) throw new Error("expected Some");
  return value.value;
};
let calls = 0;
const live = Layer.succeed(Probe)({ next: () => Effect.sync(() => { calls++; return 7; }) });
const first = await Effect.runPromise(Stream.runCollect(source));
const second = await Effect.runPromise(Stream.runCollect(source));
const nestedValue = unwrap(await Effect.runPromise(nested));
const present = unwrap(await Effect.runPromise(effectful(false).pipe(Effect.provide(live))));
const absent = await Effect.runPromise(effectful(true).pipe(Effect.provide(live)));
const failed = await Effect.runPromiseExit(effectful(false).pipe(Effect.provide(
  Layer.succeed(Probe)({ next: () => Effect.fail(new Stop({})) }),
)));
const error = Exit.isFailure(failed) ? Option.getOrUndefined(Cause.findErrorOption(failed.cause)) : undefined;
console.log(JSON.stringify({ first, second, nested: [unwrap(nestedValue[0]), nestedValue[1]],
  record: unwrap(await Effect.runPromise(record)), array: unwrap(await Effect.runPromise(array)),
  tupleArray: unwrap(await Effect.runPromise(tupleArray)), emptyTuple: unwrap(await Effect.runPromise(emptyTuple)),
  selectedSome: unwrap(selected(Option.some(9))), selectedNone: unwrap(selected(Option.none())),
  present, absent: Option.isNone(absent), calls, failed: error instanceof Stop,
}));
`,
    );
    assertEquals(result, {
      first: [{ kind: "End", value: 0 }],
      second: [{ kind: "End", value: 0 }],
      nested: [{ kind: "Value", value: 1 }, [2, "ok"]],
      record: { kind: "End", value: 3 },
      array: [1, 2, 3],
      tupleArray: [[{ kind: "Value", value: 4 }, false]],
      emptyTuple: [],
      selectedSome: [{ kind: "Value", value: 9 }, false],
      selectedNone: [{ kind: "End", value: 0 }, true],
      present: [{ kind: "Value", value: 7 }, true],
      absent: true,
      calls: 1,
      failed: true,
    });
  });
});

// ------------------------------------------------------------------ formatting (A6b)

Deno.test("deno fmt does not exclude the golden files, and it accepts them unchanged", async () => {
  const config = JSON.parse(
    Deno.readTextFileSync(new URL("../deno.json", import.meta.url)),
  );
  const excluded: unknown = config.fmt.exclude;
  assert(Array.isArray(excluded));
  assert(
    !excluded.some((entry) => String(entry).startsWith("fixtures/golden")),
    "deno.json excludes the golden files from deno fmt",
  );
  const root = new URL("../", import.meta.url).pathname;
  const run = await deno(root, ["fmt", "--check", "fixtures/golden"]);
  assertEquals(run.code, 0, `deno fmt --check failed:\n${run.stderr}`);
  const goldenCount = listFixtures("golden", /\.ts$/).length;
  assert(
    run.stderr.includes(`Checked ${goldenCount} files`),
    `deno fmt did not check all ${goldenCount} golden files:\n${run.stderr}`,
  );
});

Deno.test("the emitted forms are a fixed point of deno fmt", async () => {
  await withTemporary(async (dir) => {
    const generated = buildForms(dir);
    assertEquals(
      [...generated].sort(),
      [
        LONG_NAMES + ".ts",
        "array-bodies.ts",
        "brand-operators.ts",
        "conditional-chains.ts",
        "data-types.ts",
        "forms.ts",
        "inline-records.ts",
        "literal-results.ts",
        "names.ts",
        "nominal-records.ts",
        "optional-fields.ts",
        "recursive-data.ts",
      ],
    );
    const run = await deno(dir, ["fmt", "--check", ...generated]);
    assertEquals(run.code, 0, `deno fmt --check failed:\n${run.stderr}`);
    assert(
      run.stderr.includes("Checked 12 files"),
      `deno fmt did not check the twelve files:\n${run.stderr}`,
    );
  });
});
