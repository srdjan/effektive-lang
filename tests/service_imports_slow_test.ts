import { assertEquals } from "@std/assert";
import { compileStrictTarget } from "./target_helpers.ts";

Deno.test("composite input forwarding passes the strict target", async () => {
  const output = await compileStrictTarget(
    {
      "services.eff": `
export type Int = int
export service Users { read(): Int }
export service Allowed {
  record(input: {
    job: Effect<Int, never, Users.read>,
    other: Effect<Int, never, Users.read>
  }): void
  nested(input: { payload: { job: Effect<Int, never, Users.read> } }): void
  tuple(input: [Effect<Int, never, Users.read>, Effect<Int, never, Users.read>]): void
  list(input: Effect<Int, never, Users.read>[]): void
}
`,
      "main.eff": `
imports Allowed from "./services.eff"
import { Int, Users } from "./services.eff"
export const forward = (
  input: { job: Effect<Int, never, Users.read>, other: Effect<Int, never, Users.read> },
  jobs: Effect<Int, never, Users.read>[]
): void => {
  const alias = input
  const copied = { ...alias }
  const { job } = copied
  Allowed.record({ job, other: input.other })
  Allowed.nested({ payload: { job: alias.job } })
  Allowed.tuple([input.job, input.other])
  Allowed.list(jobs)
}
`,
    },
    ["main.eff"],
    `
import { Effect } from "effect";
import { forward } from "./main.ts";
import { Allowed } from "./services.ts";
const job = Effect.succeed(1);
const calls: string[] = [];
await Effect.runPromise(forward({ job, other: job }, [job]).pipe(
  Effect.provideService(Allowed, {
    record: () => Effect.sync(() => { calls.push("record"); }),
    nested: () => Effect.sync(() => { calls.push("nested"); }),
    tuple: () => Effect.sync(() => { calls.push("tuple"); }),
    list: () => Effect.sync(() => { calls.push("list"); }),
  }),
));
console.log(calls.join(","));
`,
    "effektive-service-imports-",
  );
  assertEquals(output.trim(), "record,nested,tuple,list");
});
