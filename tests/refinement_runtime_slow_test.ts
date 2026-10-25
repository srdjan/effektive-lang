import { assertEquals } from "@std/assert";
import { checkProject, memoryHost } from "../src/core/mod.ts";
import { compileStrictTarget } from "./target_helpers.ts";

Deno.test("inferred entries enforce integer and record refinements without transformations", async () => {
  const decisions = Array.from({ length: 7 }, (_, index) => index - 3).map(
    (n) => {
      const project = checkProject(
        memoryHost({
          "effektive.json": "{}",
          "case.eff":
            `type Positive = int where n => n > 0\nconst value: Positive = ${
              n < 0 ? `0 - ${-n}` : n
            }`,
        }),
        "",
        ["case.eff"],
      );
      if (!project.ok) throw new Error("static comparison project failed");
      if (
        project.value.diagnostics.some((diagnostic) =>
          diagnostic.code !== "type-mismatch/013"
        )
      ) throw new Error(JSON.stringify(project.value.diagnostics));
      return project.value.diagnostics.length === 0;
    },
  );
  const output = await compileStrictTarget(
    {
      "main.eff": `
export type Positive = int where n => n > 0
export type Pair = string where s => len(s) === 2
export type Window = { name: string, low: int, high: int } where w => len(w.name) > 0 && w.high - w.low >= 1
export type Row = { value: int } where row => row.value > 0
error Stop = {}
type Domain = Row | Stop
const amount = (n: Positive): Positive => n
const window = (w: Window): Window => w
export const intermediate = (p: Positive): Positive => (p + 9007199254740991) - 9007199254740991
export const read = (input): Positive fails SchemaError => amount(input.amount)
export const readPair = (input): Pair fails SchemaError => input
export const readWindow = (input): Window fails SchemaError => window(input)
export const piped = (): Positive => 1 |> amount
export const made = (): Row => ({ value: 1 })
export const optional = (input): Option<Positive> fails SchemaError => Some(input)
const takeOption = (value: Option<Positive>): Option<Positive> => value
export const readOption = (input): Option<Positive> fails SchemaError => takeOption(input)
export const wrapOption = (raw: unknown): Option<Positive> fails SchemaError => readOption(Some(raw))
export const pipeOption = (raw: unknown): Option<Positive> fails SchemaError => readOption(raw |> Some)
`,
    },
    ["main.eff"],
    `
import { Effect, Exit, Option, Schema } from "effect";
import { read, readWindow, readPair, intermediate, Positive, piped, made, Row, optional, wrapOption, pipeOption } from "./main.ts";
if (piped() !== 1) throw new Error("pipeline changed its value");
if (!Schema.is(Row)(made())) throw new Error("implicit tagged construction failed");
const some = await Effect.runPromise(optional(1));
if (!Option.isSome(some) || some.value !== 1) throw new Error("Some validation failed");
if (!Exit.isFailure(await Effect.runPromiseExit(optional(0)))) throw new Error("Some accepted an invalid input");
for (const wrap of [wrapOption, pipeOption]) {
  if (!Exit.isFailure(await Effect.runPromiseExit(wrap(0)))) throw new Error("raw Some payload escaped validation");
  if (!Option.isSome(await Effect.runPromise(wrap(1)))) throw new Error("valid raw Some payload failed");
}
const decisions = ${JSON.stringify(decisions)};
for (let n = -3; n <= 3; n++) {
  const exit = await Effect.runPromiseExit(read({ amount: n }));
  if (Exit.isSuccess(exit) !== decisions[n + 3]) throw new Error("integer predicate disagreement");
  if (Schema.is(Positive)(n) !== (n > 0)) throw new Error("schema predicate disagreement");
}
for (const input of [
  { name: "", low: 0, high: 1 },
  { name: "ok", low: 1, high: 1 },
  { name: "ok", low: 0, high: 1, extra: true },
]) {
  if (!Exit.isFailure(await Effect.runPromiseExit(readWindow(input)))) throw new Error("invalid window passed");
}
if (await Effect.runPromise(readPair("😀")) !== "😀") throw new Error("UTF-16 length");
if (!Exit.isFailure(await Effect.runPromiseExit(readPair("a")))) throw new Error("short string passed");
const input = { name: "ok", low: -9007199254740991, high: 9007199254740991 };
const result = await Effect.runPromise(readWindow(input));
if (JSON.stringify(result) !== JSON.stringify(input)) throw new Error("entry transformed data");
let overflow = false;
try { intermediate(1); } catch (error) { overflow = error instanceof RangeError; }
if (!overflow) throw new Error("unsafe ordinary arithmetic intermediate escaped its check");
console.log("refinement checks passed");
`,
    "effektive-refinement-runtime-",
  );
  assertEquals(output.trim(), "refinement checks passed");
});
