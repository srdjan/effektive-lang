import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

Deno.test("inferred entries validate closed records when their Effect executes", async () => {
  const output = await compileStrictTarget(
    {
      "main.eff": `
type Count = int
const consume = (value: Count): Count => value
export const read = (input): Count fails SchemaError => consume(input.amount)
service Raw { next(): unknown }
export const pair = (first, second): Count fails SchemaError => { consume(first.amount); consume(second.amount) }
export const gather = (): Count fails SchemaError uses Raw => pair(Raw.next(), Raw.next())
export const readAny = (input): unknown fails SchemaError => input.field
export const explicit = (input: unknown): Count fails SchemaError => consume(input.amount)
`,
    },
    ["main.eff"],
    `
import { Effect, Exit } from "effect";
import { read, explicit, readAny, pair, gather, Raw } from "./main.ts";
let accesses = 0;
const input = { get amount() { accesses++; return 3; } };
const deferred = read(input);
if (accesses !== 0) throw new Error("entry validated eagerly");
if (await Effect.runPromise(deferred) !== 3) throw new Error("valid input");
for (const entry of [read, explicit]) {
  for (const raw of [{}, { amount: "bad" }, { amount: 3, extra: true }]) {
    const exit = await Effect.runPromiseExit(entry(raw));
    if (!Exit.isFailure(exit)) throw new Error("invalid input passed");
  }
  if (await Effect.runPromise(entry({ amount: 7 })) !== 7) throw new Error("parity");
}
if (!Exit.isFailure(await Effect.runPromiseExit(readAny({})))) throw new Error("missing unknown field passed");
let laterReads = 0;
const second = { get amount() { laterReads++; return 7; } };
if (!Exit.isFailure(await Effect.runPromiseExit(pair({}, second)))) throw new Error("first invalid parameter passed");
if (laterReads !== 0) throw new Error("parameter checks ran out of order");
let calls = 0;
const result = await Effect.runPromise(gather().pipe(Effect.provideService(Raw, {
  next: () => Effect.sync(() => ({ amount: ++calls })),
})));
if (calls !== 2 || result !== 2) throw new Error("argument evaluation order or count changed");
console.log("entry checks passed");
`,
    "effektive-inferred-entry-",
  );
  assertEquals(output.trim(), "entry checks passed");
});
