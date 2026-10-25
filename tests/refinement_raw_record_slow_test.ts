import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

Deno.test("checked record entries validate raw components during Effect execution", async () => {
  const output = await compileStrictTarget(
    {
      "main.eff": `
type Int = int
type Window = { low: Int, high: Int } where w => w.high > w.low
const take = (value: Window): Window => value
export const entry = (input): Window fails SchemaError => take(input)
export const wrap = (raw: unknown): Window fails SchemaError => entry({ low: raw, high: 2 })
type Flag = boolean
export const conditional = (flag: Flag, raw: unknown): Window fails SchemaError => entry(if (flag) { ({ low: raw, high: 2 }) } else { ({ low: raw, high: 3 }) })
type Box = { window: Window }
const takeBox = (value: Box): Box => value
export const boxEntry = (input): Box fails SchemaError => takeBox(input)
export const nested = (raw: unknown): Box fails SchemaError => boxEntry({ window: { low: raw, high: 2 } })
export const wholeNested = (raw: unknown): Box fails SchemaError => boxEntry({ window: raw })
type OptionalWindow = { low: Int, high: Int, note?: Int } where w => w.high > w.low
const takeOptional = (value: OptionalWindow): OptionalWindow => value
export const optionalEntry = (input): OptionalWindow fails SchemaError => takeOptional(input)
export const missingOptional = (raw: unknown): OptionalWindow fails SchemaError => optionalEntry({ low: raw, high: 2 })
type NamedWindow = { low: Int, high: Int, label: Int } where w => w.high > w.low
const takeNamed = (value: NamedWindow): NamedWindow => value
export const namedEntry = (input): NamedWindow fails SchemaError => takeNamed(input)
export const partial = (raw: unknown): NamedWindow fails SchemaError => namedEntry({ low: 1, high: 2, label: raw })
`,
    },
    ["main.eff"],
    `
import { Effect, Exit } from "effect";
import { wrap, conditional, nested, wholeNested, missingOptional, partial } from "./main.ts";
const result = await Effect.runPromise(wrap(1));
if (result.low !== 1 || result.high !== 2) throw new Error("valid record changed");
for (const raw of [0.5, 2, 3, "bad", undefined, null]) {
  if (!Exit.isFailure(await Effect.runPromiseExit(wrap(raw)))) throw new Error("invalid raw field passed");
}
for (const flag of [true, false]) {
  if ((await Effect.runPromise(conditional(flag, 1))).low !== 1) throw new Error("conditional valid record failed");
  if (!Exit.isFailure(await Effect.runPromiseExit(conditional(flag, 4)))) throw new Error("conditional invalid record passed");
}
if ((await Effect.runPromise(nested(1))).window.low !== 1) throw new Error("nested valid record failed");
if (!Exit.isFailure(await Effect.runPromiseExit(nested(2)))) throw new Error("nested invalid record passed");
if (!Exit.isFailure(await Effect.runPromiseExit(wholeNested({ low: 1, high: 2, extra: true })))) throw new Error("nested extra field passed");
if ((await Effect.runPromise(missingOptional(1))).low !== 1) throw new Error("missing optional field failed");
if ((await Effect.runPromise(partial(1))).label !== 1) throw new Error("unrelated raw field failed");
if (!Exit.isFailure(await Effect.runPromiseExit(partial("bad")))) throw new Error("unrelated invalid raw field passed");
console.log("raw record checks passed");
`,
    "effektive-raw-record-",
  );
  assertEquals(output.trim(), "raw record checks passed");
});
