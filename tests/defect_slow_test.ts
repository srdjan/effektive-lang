// Runtime behavior of defect recovery (unit ES6). Each test compiles one module
// with independent validation, type-checks the emitted TypeScript under the
// strict target options, and runs it.

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
      "effektive-defect-",
    ),
  );
}

const SOURCE = `type Int = int
type Text = string
export error Stop = { n: Int }
type Settled = { _tag: "Success", success: Int } | { _tag: "Defect", message: Text } | { _tag: "Interrupted" }
export service Log {
  seen(tag: Text, n: Int): void
  defect(message: Text): void
  next(): Int fails Stop
  boom(which: Int): Int
}
const settle = (o: Settled): void uses Log.seen | Log.defect => match o {
  { _tag: "Success", ...s } => Log.seen("Success", s.success),
  { _tag: "Defect", ...d } => Log.defect(d.message),
  { _tag: "Interrupted" } => Log.seen("Interrupted", 0)
}
export const hostDefect = (which: Int): Text uses Log.boom =>
  try { Log.boom(which)
 "fine" } catch { Defect(d) => d.message }
export const arithmetic = (): Text =>
  try { sleep(0 - 1)
 "fine" } catch { Defect(d) => d.message }
export const inHandler = (): Text uses Log.next | Log.boom =>
  try { Log.next()
 "fine" } catch { Stop(e) => { Log.boom(0)
 "handler" }, Defect(d) => d.message }
export const typedFailure = (): Int fails Stop uses Log.next =>
  try { Log.next() } catch { Defect(d) => 0 }
export const typedAndDefect = (): Int uses Log.next | Log.boom =>
  try { Log.next() } catch { Stop(e) => e.n, Defect(d) => 0 }
export const interrupted = (): Int fails TimeoutError =>
  timeout(() => try { sleep(5000)
 1 } catch { Defect(d) => 2 }, 20)
export const withFinally = (which: Int): Int uses Log.boom | Log.seen | Log.defect =>
  try { Log.boom(which) } catch { Defect(d) => 5 } finally (o) { settle(o) }
`;

const PRELUDE = `import { Effect, Layer } from "effect";
import * as M from "./main.ts";
const events: string[] = [];
const Live = Layer.succeed(M.Log)({
  seen: (tag, n) => Effect.sync(() => { events.push(tag + ":" + n); }),
  defect: (message) => Effect.sync(() => { events.push("Defect:" + message); }),
  next: () => Effect.fail(new M.Stop({ n: 9 })),
  boom: (which) => which === 0 ? Effect.die(new Error("kaput")) : which === 1 ? Effect.die("plain") : Effect.succeed(3),
});
const run = <A, E>(job: Effect.Effect<A, E, M.Log>) =>
  Effect.runPromiseExit(job.pipe(Effect.provide(Live)));
const value = <A, E>(exit: { readonly _tag: string; readonly value?: A }) =>
  exit._tag === "Success" ? exit.value : "exit:" + exit._tag;
const take = () => events.splice(0);
`;

Deno.test("the Defect arm catches host and runtime defects with their messages", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
out.error = value(await run(M.hostDefect(0)));
out.string = value(await run(M.hostDefect(1)));
out.none = value(await run(M.hostDefect(2)));
out.arithmetic = value(await run(M.arithmetic()));
console.log(JSON.stringify(out));
`,
  ) as Record<string, string>;
  assertEquals(
    { error: result.error, string: result.string, none: result.none },
    { error: "kaput", string: "plain", none: "fine" },
  );
  // The message of the RangeError defect from a negative duration.
  assert(result.arithmetic.length > 0 && result.arithmetic !== "fine");
});

Deno.test("the Defect arm catches a defect raised in a typed handler", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
console.log(JSON.stringify({ v: value(await run(M.inHandler())) }));
`,
  );
  assertEquals(result, { v: "kaput" });
});

Deno.test("the Defect arm leaves typed failures and interruption alone", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
out.typed = value(await run(M.typedFailure()));
out.handled = value(await run(M.typedAndDefect()));
out.interrupted = value(await run(M.interrupted()));
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, {
    typed: "exit:Failure",
    handled: 9,
    interrupted: "exit:Failure",
  });
});

Deno.test("finally sees Success after the Defect arm handles the defect", async () => {
  const result = await compileAndRun(
    SOURCE,
    `${PRELUDE}
const out: Record<string, unknown> = {};
out.value = value(await run(M.withFinally(0)));
out.events = take();
console.log(JSON.stringify(out));
`,
  );
  assertEquals(result, { value: 5, events: ["Success:5"] });
});
