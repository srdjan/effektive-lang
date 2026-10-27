// Runtime behavior of outcome-aware cleanup (unit ES5). Each test compiles one
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
      "effektive-outcome-",
    ),
  );
}

const SOURCE = `type Int = int
type Text = string
export error Stop = { n: Int }
type Outcome = { _tag: "Success", success: Int } | { _tag: "Failure", failure: Stop } | { _tag: "Defect", message: Text } | { _tag: "Interrupted" }
type Settled = { _tag: "Success", success: Int } | { _tag: "Defect", message: Text } | { _tag: "Interrupted" }
export service Log {
  seen(tag: Text, n: Int): void
  defect(message: Text): void
  next(): Int fails Stop
  boom(which: Int): Int
}
export service Files { open(): { read: () => Int } }
const report = (o: Outcome): void uses Log.seen | Log.defect => match o {
  { _tag: "Success", ...s } => Log.seen("Success", s.success),
  { _tag: "Failure", ...f } => Log.seen("Failure", f.failure.n),
  { _tag: "Defect", ...d } => Log.defect(d.message),
  { _tag: "Interrupted" } => Log.seen("Interrupted", 0)
}
const settle = (o: Settled): void uses Log.seen | Log.defect => match o {
  { _tag: "Success", ...s } => Log.seen("Success", s.success),
  { _tag: "Defect", ...d } => Log.defect(d.message),
  { _tag: "Interrupted" } => Log.seen("Interrupted", 0)
}
export const success = (): Int uses Log.seen | Log.defect =>
  try { 7 } finally (o) { settle(o) }
export const failure = (): Int fails Stop uses Log.next | Log.seen | Log.defect =>
  try { Log.next() } finally (o) { report(o) }
export const defect = (which: Int): Int uses Log.boom | Log.seen | Log.defect =>
  try { Log.boom(which) } finally (o) { settle(o) }
export const interrupted = (): Int fails TimeoutError uses Log.seen | Log.defect =>
  timeout(() => try { sleep(5000)
 1 } finally (o) { settle(o) }, 20)
export const raced = (): Int uses Log.seen | Log.defect =>
  run(race(defer(() => try { sleep(5000)
 1 } finally (o) { settle(o) }), defer(() => { sleep(30)
 2 })))
export const onlyFinally = (): Int uses Log.seen =>
  try { 5 } finally { Log.seen("plain", 1) }
export const handled = (): Int uses Log.next | Log.seen | Log.defect =>
  try { Log.next() } catch { Stop(e) => 0 } finally (o) { settle(o) }
export const afterCatch = (): Int uses Log.next | Log.seen | Log.defect =>
  try { Log.next() } catch { Stop(e) => e.n } finally (o) { settle(o) }
export const resource = (): Int fails Stop uses Files.open | Log.next | Log.seen | Log.defect =>
  using (f = Files.open()) { Log.next() } finally (o) { report(o) }
export const resourceOk = (): Int uses Files.open | Log.seen | Log.defect =>
  using (f = Files.open()) { f.read() } finally (o) { settle(o) }
export const callForm = (): Int uses Files.open | Log.seen | Log.defect =>
  withResource(() => Files.open(), (f) => f.read(), (f, o) => settle(o))
export const maskedBound = (): Int fails TimeoutError uses Log.seen =>
  timeout(() => try { sleep(5000)
 1 } finally (o) { sleep(30)
 Log.seen("finalized", 1) }, 10)
export const maskedPlain = (): Int fails TimeoutError uses Log.seen =>
  timeout(() => try { sleep(5000)
 1 } finally { sleep(30)
 Log.seen("finalized", 2) }, 10)
`;

const PRELUDE = `import { Effect, Layer } from "effect";
import * as M from "./main.ts";
const events: string[] = [];
const Live = Layer.mergeAll(
  Layer.succeed(M.Log)({
    seen: (tag, n) => Effect.sync(() => { events.push(tag + ":" + n); }),
    defect: (message) => Effect.sync(() => { events.push("Defect:" + message); }),
    next: () => Effect.fail(new M.Stop({ n: 9 })),
    boom: (which) => which === 0 ? Effect.die(new Error("kaput")) : Effect.die("plain"),
  }),
  Layer.succeed(M.Files)({
    open: () => Effect.succeed({ read: () => Effect.succeed(11) }),
  }),
);
const run = <A, E>(job: Effect.Effect<A, E, M.Log | M.Files>) =>
  Effect.runPromiseExit(job.pipe(Effect.provide(Live)));
const take = () => events.splice(0);
`;

Deno.test("each outcome member reaches the finalizer with its data", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
await run(M.success()); out.success = take();
const failed = await run(M.failure()); out.failure = take();
out.failureExit = failed._tag;
await run(M.defect(0)); out.errorDefect = take();
const dead = await run(M.defect(1)); out.stringDefect = take();
out.defectExit = dead._tag;
const timedOut = await run(M.interrupted()); out.interrupted = take();
out.timeoutExit = timedOut._tag;
const winner = await run(M.raced()); out.raced = take();
out.winner = winner._tag === "Success" ? winner.value : null;
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, {
    success: ["Success:7"],
    failure: ["Failure:9"],
    failureExit: "Failure",
    errorDefect: ["Defect:kaput"],
    stringDefect: ["Defect:plain"],
    defectExit: "Failure",
    interrupted: ["Interrupted:0"],
    timeoutExit: "Failure",
    raced: ["Interrupted:0"],
    winner: 2,
  });
});

Deno.test("try with only finally runs the finalizer, and catch decides what the finalizer sees", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
const only = await run(M.onlyFinally());
out.only = [only._tag === "Success" ? only.value : null, ...take()];
await run(M.handled()); out.handled = take();
const caught = await run(M.afterCatch());
out.afterCatch = [caught._tag === "Success" ? caught.value : null, ...take()];
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, {
    only: [5, "plain:1"],
    handled: ["Success:0"],
    afterCatch: [9, "Success:9"],
  });
});

Deno.test("using and withResource finalizers see the outcome of the use block", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
await run(M.resource()); out.failure = take();
await run(M.resourceOk()); out.success = take();
await run(M.callForm()); out.callForm = take();
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, {
    failure: ["Failure:9"],
    success: ["Success:11"],
    callForm: ["Success:11"],
  });
});

Deno.test("the finalizer is not interrupted, with and without an outcome binding", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
for (const name of ["maskedBound", "maskedPlain"] as const) {
  const exit = await run(M[name]());
  // Wait past the finalizer sleep, in case timeout does not await the finalizer.
  await new Promise((resolve) => setTimeout(resolve, 100));
  out[name] = { exit: exit._tag, events: take() };
}
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, {
    maskedBound: { exit: "Failure", events: ["finalized:1"] },
    maskedPlain: { exit: "Failure", events: ["finalized:2"] },
  });
});
