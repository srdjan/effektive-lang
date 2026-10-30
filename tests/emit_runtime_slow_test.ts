// Slow tests of the emitter: codecs, data values, and running the emitted
// examples. Each test copies a fixture project to a temporary directory, builds
// there, and runs `deno check`, `deno fmt`, or `deno run` on the result.
// Nothing is written under fixtures/.

import { assertEquals } from "@std/assert";
import { copyDirectory, FIXTURES } from "./helpers.ts";
import { runScript } from "./process_helpers.ts";
import {
  build,
  buildExamples,
  buildForms,
  withTemporary,
} from "./emit_slow_helpers.ts";

Deno.test("pure codecs validate both directions and preserve None", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Int = int",
        "export const shift: Codec<Int, Int> = codec((n: Int): Int => n + 1, (n: Int): Int => n - 1)",
        "export const parse = (input: unknown): Option<Int> => decode(shift, input)",
        "export const print = (n: Int): Option<Int> => encode(shift, n)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Option } from "effect";
import { parse, print } from "./main.ts";
const good = parse(4);
const bad = parse("bad");
const encoded = print(5);
console.log(JSON.stringify({ good: Option.getOrUndefined(good), bad: Option.isNone(bad), encoded: Option.getOrUndefined(encoded) }));
`,
    );
    assertEquals(result, { good: 5, bad: true, encoded: 4 });
  });
});

Deno.test("data values carry a tag, keep it when widened, and round trip through a schema and a codec", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/forms/", FIXTURES), dir);
    build(dir, ["data-types.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import * as M from "./data-types.ts";
const user = M.make();
const encoded = await Effect.runPromise(M.encodeUser(user));
const decoded = await Effect.runPromise(M.decodeUser(encoded));
const rejected = await Effect.runPromise(Effect.flip(M.decodeUser({ id: "u1", name: "Ann" })));
console.log(JSON.stringify({
  user,
  plain: M.plain(user),
  twin: M.twin(user),
  piped: M.piped(),
  renamed: M.rename(user, "Bo"),
  mark: M.mark(),
  encoded,
  decoded,
  untaggedRejected: rejected._tag,
}));
`,
    );
    const ann = { _tag: "data-types#User", id: "u1", name: "Ann" };
    assertEquals(result, {
      user: ann,
      plain: ann,
      twin: { _tag: "data-types#Twin", id: "u1", name: "Ann" },
      piped: { _tag: "data-types#Pin", id: "p1" },
      renamed: { ...ann, name: "Bo" },
      mark: { _tag: "data-types#Marker" },
      encoded: ann,
      decoded: ann,
      untaggedRejected: "SchemaError",
    });
  });
});

const WIDENED_RECORDS = [
  "type Int = int",
  "type Text = string",
  "type A = { x: Int }",
  "type B = { x: Int }",
  "type C = { inner: { x: Int }, label: Text }",
  "type Variants = A | B | C",
  "const fieldsSchema: Schema<{ x: Int }> = schema()",
  "export const make = (x: Int): A => A({ x })",
  "export const widen = (a: A): B => B(a)",
  "export const update = (a: A): B => B({ ...a, x: 9 })",
  'export const nested = (a: A): C => C({ inner: a, label: "n" })',
  "export const encodeFields = (a: A): { x: Int } fails SchemaError =>",
  "  schemaEncode(fieldsSchema, a)",
  "",
].join("\n");

Deno.test("a widened record value constructs another nominal type, in a copy, an update, and a nested field, and encodes without its tag", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(`${dir}/main.eff`, WIDENED_RECORDS);
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import * as M from "./main.ts";
const a = M.make(1);
console.log(JSON.stringify({
  widen: M.widen(a),
  update: M.update(a),
  nested: M.nested(a),
  encoded: await Effect.runPromise(M.encodeFields(a)),
  source: a,
}));
`,
    );
    assertEquals(result, {
      widen: { _tag: "main#B", x: 1 },
      update: { _tag: "main#B", x: 9 },
      nested: { _tag: "main#C", inner: { x: 1 }, label: "n" },
      encoded: { x: 1 },
      source: { _tag: "main#A", x: 1 },
    });
  });
});

Deno.test("nominal operators compare and compute on the base value at run time", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/nominal-operators/", FIXTURES), dir);
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import * as M from "./main.ts";
const total = M.Cents.make(21);
console.log(JSON.stringify({
  text: M.asText(M.UserId.make("u1")),
  greet: M.greet(M.UserId.make("u1")),
  first: [M.isFirst(M.UserId.make("u1")), M.isFirst(M.UserId.make("u2"))],
  positive: [M.positive(total), M.positive(M.Cents.make(0))],
  double: M.double(total),
  shifted: M.shifted(total),
  half: M.half(total),
  square: M.square(total),
  sum: M.sum(total, total),
}));
`,
    );
    assertEquals(result, {
      text: "u1",
      greet: "u1!",
      first: [true, false],
      positive: [true, false],
      double: 42,
      shifted: 26,
      half: 10.5,
      square: 441,
      sum: 42,
    });
  });
});

Deno.test("a data value with a missing optional prototype-named field nests in another data value", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Text = string",
        "export type Tok = { label: Text, toString?: Text }",
        "export type Toks = Tok[]",
        "export type Box = { tok: Tok, all: Toks, maybe: Option<Tok> }",
        "type Records = Tok | Box",
        "export const tok = (l: Text): Tok => Tok({ label: l })",
        'export const box = (): Box => Box({ tok: tok("a"), all: [tok("b")], maybe: Some(tok("c")) })',
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { box } from "./main.ts";
console.log(JSON.stringify(box()));
`,
    );
    assertEquals(result, {
      _tag: "main#Box",
      tok: { _tag: "main#Tok", label: "a" },
      all: [{ _tag: "main#Tok", label: "b" }],
      maybe: {
        _id: "Option",
        _tag: "Some",
        value: { _tag: "main#Tok", label: "c" },
      },
    });
  });
});

Deno.test("a widened record value with a nested optional prototype-named field loses its tag and keeps the field adapter", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Text = string",
        "export type Tok = { label: Text, toString?: Text }",
        "export type Toks = Tok[]",
        "export type Box = { tok: Tok, all: Toks, maybe: Option<Tok> }",
        "export type Boxed = { tok: Tok, all: Toks, maybe: Option<Tok> }",
        "type Records = Tok | Box | Boxed",
        "export const tok = (l: Text): Tok => Tok({ label: l })",
        'export const box = (): Box => Box({ tok: tok("a"), all: [tok("b")], maybe: Some(tok("c")) })',
        "export const rebox = (b: Box): Boxed => Boxed(b)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { box, rebox } from "./main.ts";
console.log(JSON.stringify(rebox(box())));
`,
    );
    assertEquals(result, {
      _tag: "main#Boxed",
      tok: { _tag: "main#Tok", label: "a" },
      all: [{ _tag: "main#Tok", label: "b" }],
      maybe: {
        _id: "Option",
        _tag: "Some",
        value: { _tag: "main#Tok", label: "c" },
      },
    });
  });
});

Deno.test("a match over data and error types selects the arm by tag", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/forms/", FIXTURES), dir);
    build(dir, ["data-types.eff"]);
    const result = await runScript(
      dir,
      `
import * as M from "./data-types.ts";
const user = M.make();
console.log(JSON.stringify({
  circle: M.describe(M.circle()),
  square: M.describe(M.square()),
  lax: [M.circular(M.circle()), M.circular(M.square())],
  outcome: [M.outcome(M.Circle.make({ radius: "r" })), M.outcome(M.reject(user))],
  kind: [M.kind(M.mark()), M.kind(M.Circle.make({ radius: "r" }))],
}));
`,
    );
    assertEquals(result, {
      circle: "r",
      square: "s",
      lax: ["r", "other"],
      outcome: ["r", "no"],
      kind: ["marker", "r"],
    });
  });
});

Deno.test("recursive data types build, encode, decode, and match", async () => {
  await withTemporary(async (dir) => {
    copyDirectory(new URL("emit/forms/", FIXTURES), dir);
    build(dir, ["recursive-data.eff"]);
    const result = await runScript(
      dir,
      `
import { Schema } from "effect";
import * as M from "./recursive-data.ts";
const tree = M.nested();
const list = M.two();
const forest = M.forest();
const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A): A =>
  Schema.decodeUnknownSync(schema)(Schema.encodeSync(schema)(value));
const back = roundTrip(M.List, list);
console.log(JSON.stringify({
  tree: Schema.encodeSync(M.Tree)(tree),
  treeBack: roundTrip(M.Tree, tree),
  list: Schema.encodeSync(M.List)(list),
  listBack: back,
  length: [M.length(list), M.length(back), M.length(M.Nil.make({}))],
  forest: Schema.encodeSync(M.Forest)(forest),
  forestBack: roundTrip(M.Forest, forest)._tag,
  badTag: Schema.decodeUnknownExit(M.List)({ _tag: "recursive-data#Other" })._tag,
}));
`,
    );
    const nil = { _tag: "recursive-data#Nil" };
    const list = {
      _tag: "recursive-data#Cons",
      head: 1,
      tail: {
        _tag: "recursive-data#Cons",
        head: 2,
        tail: nil,
      },
    };
    // No union lists `Tree`, so it has no tag.
    const leaf = (label: string) => ({ label, children: [] });
    const tree = { label: "root", children: [leaf("a"), leaf("b")] };
    assertEquals(result, {
      tree,
      treeBack: tree,
      list,
      listBack: list,
      length: [2, 2, 0],
      forest: {
        _tag: "recursive-data#Forest",
        first: {
          _id: "Option",
          _tag: "Some",
          value: {
            _tag: "recursive-data#Node",
            rest: {
              _tag: "recursive-data#Forest",
              first: { _id: "Option", _tag: "None" },
            },
          },
        },
      },
      forestBack: "recursive-data#Forest",
      badTag: "Failure",
    });
  });
});

Deno.test("a pure codec over a data type decodes into data and encodes back", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "type Text = string",
        "export type Name = { text: Text }",
        "type Other = { count: Text }",
        "type Records = Name | Other",
        "export const names: Codec<Name, Text> = codec((text: Text): Name => Name({ text }), (name: Name): Text => name.text)",
        "export const parse = (input: unknown): Option<Name> => decode(names, input)",
        "export const print = (name: Name): Option<Text> => encode(names, name)",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Option } from "effect";
import { Name, parse, print } from "./main.ts";
console.log(JSON.stringify({
  parsed: Option.getOrUndefined(parse("Zed")),
  printed: Option.getOrUndefined(print(Name.make({ text: "Amy" }))),
}));
`,
    );
    assertEquals(result, {
      parsed: { _tag: "main#Name", text: "Zed" },
      printed: "Amy",
    });
  });
});

Deno.test("stored Effect values run twice after deferred construction", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "error Stop = {}",
        "export service Counter { next(): Int fails Stop }",
        "export service Factory { produce(): Effect<Int, Stop, Counter.next> }",
        "export const make = (): Effect<Int, Stop, Counter.next> => defer(() => Counter.next())",
        "export const fromHost = (): Int fails Stop uses Counter.next | Factory.produce => run(Factory.produce())",
        "export const twice = (stored: Effect<Int, Stop, Counter.next>): Int fails Stop uses Counter.next => {",
        "  const first = run(stored)",
        "  const second = run(stored)",
        "  first + second",
        "}",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Effect, Layer } from "effect";
import { Counter, make, twice } from "./main.ts";

let calls = 0;
const Live = Layer.succeed(Counter)({
  next: () => Effect.sync(() => ++calls),
});
const stored = make();
const before = calls;
const sum = Effect.runSync(twice(stored).pipe(Effect.provide(Live)));
console.log(JSON.stringify({ before, sum, calls }));
`,
    );
    assertEquals(result, { before: 0, sum: 3, calls: 2 });
  });
});

Deno.test("traverse runs sequentially and stops after a typed callback failure", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "error Stop = { at: int }",
        "service Probe { step(n: Int): Int fails Stop }",
        "export const run = (xs: Int[]): Int[] fails Stop uses Probe.step => traverse(xs, (n) => Probe.step(n))",
        "export const pure = (xs: Int[]): Int[] => traverse(xs, (n) => n + 1)",
        "type Int = int",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { Probe, Stop, run, pure } from "./main.ts";

const calls: number[] = [];
const Live = Layer.succeed(Probe)({
  step: (n) => Effect.gen(function* () {
    calls.push(n);
    if (n === 3) return yield* Effect.fail(new Stop({ at: n }));
    return n * 2;
  }),
});
const empty = Effect.runSync(run([]).pipe(Effect.provide(Live)));
const success = Effect.runSync(run([1, 2]).pipe(Effect.provide(Live)));
const failed = Effect.runSyncExit(run([1, 2, 3, 4]).pipe(Effect.provide(Live)));
const found = Exit.isFailure(failed) ? Cause.findError(failed.cause) : undefined;
const stoppedAt = found !== undefined && Result.isSuccess(found) &&
    found.success instanceof Stop ? found.success.at : null;
console.log(JSON.stringify({ empty, success, stoppedAt, calls, pure: Effect.runSync(pure([1, 2])) }));
`,
    );
    assertEquals(result, {
      empty: [],
      success: [2, 4],
      stoppedAt: 3,
      calls: [1, 2, 1, 2, 3],
      pure: [2, 3],
    });
  });
});

Deno.test("effectful map, filter and fold run in order, stop at the first failure, and accumulate", async () => {
  await withTemporary(async (dir) => {
    Deno.writeTextFileSync(`${dir}/effektive.json`, "{}");
    Deno.writeTextFileSync(
      `${dir}/main.eff`,
      [
        "error Stop = { at: int }",
        "service Probe {",
        "  step(n: Int): Int fails Stop",
        "  keep(n: Int): Flag fails Stop",
        "}",
        "export const m = (xs: Int[]): Int[] fails Stop uses Probe.step => map(xs, (n) => Probe.step(n))",
        "export const mp = (xs: Int[]): Int[] fails Stop uses Probe.step => xs |> map((n) => Probe.step(n))",
        "export const f = (xs: Int[]): Int[] fails Stop uses Probe.keep => filter(xs, (n) => Probe.keep(n))",
        "export const g = (xs: Int[]): Int fails Stop uses Probe.step => fold(xs, 100, (a, n) => a + Probe.step(n))",
        "export const pure = (xs: Int[]): Int[] => map(xs, (n) => n + 1)",
        "type Int = int",
        "type Flag = boolean",
        "",
      ].join("\n"),
    );
    build(dir, ["main.eff"]);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { Probe, Stop, m, mp, f, g, pure } from "./main.ts";

const calls: string[] = [];
const Live = Layer.succeed(Probe)({
  step: (n) => Effect.gen(function* () {
    calls.push("step" + n);
    if (n === 3) return yield* Effect.fail(new Stop({ at: n }));
    return n * 2;
  }),
  keep: (n) => Effect.gen(function* () {
    calls.push("keep" + n);
    if (n === 9) return yield* Effect.fail(new Stop({ at: n }));
    return n % 2 === 0;
  }),
});
const run = <A>(job: Effect.Effect<A, Stop, Probe>) =>
  Effect.runSyncExit(job.pipe(Effect.provide(Live)));
const value = <A>(exit: Exit.Exit<A, Stop>) => Exit.isSuccess(exit) ? exit.value : null;
const stoppedAt = (exit: Exit.Exit<unknown, Stop>) => {
  const found = Exit.isFailure(exit) ? Cause.findError(exit.cause) : undefined;
  return found !== undefined && Result.isSuccess(found) ? found.success.at : null;
};
const out: Record<string, unknown> = {};
out.map = value(run(m([1, 2])));
out.mapCalls = calls.splice(0);
out.piped = value(run(mp([4, 5])));
out.pipedCalls = calls.splice(0);
out.mapStop = stoppedAt(run(m([1, 2, 3, 4])));
out.mapStopCalls = calls.splice(0);
out.filter = value(run(f([1, 2, 3, 4])));
out.filterCalls = calls.splice(0);
out.filterStop = stoppedAt(run(f([2, 9, 4])));
out.filterStopCalls = calls.splice(0);
out.fold = value(run(g([1, 2, 4])));
out.foldCalls = calls.splice(0);
out.foldEmpty = value(run(g([])));
out.foldStop = stoppedAt(run(g([1, 3, 5])));
out.foldStopCalls = calls.splice(0);
out.pure = pure([1, 2]);
console.log(JSON.stringify(out));
`,
    );
    assertEquals(result, {
      map: [2, 4],
      mapCalls: ["step1", "step2"],
      piped: [8, 10],
      pipedCalls: ["step4", "step5"],
      mapStop: 3,
      mapStopCalls: ["step1", "step2", "step3"],
      filter: [2, 4],
      filterCalls: ["keep1", "keep2", "keep3", "keep4"],
      filterStop: 9,
      filterStopCalls: ["keep2", "keep9"],
      fold: 114,
      foldCalls: ["step1", "step2", "step4"],
      foldEmpty: 100,
      foldStop: 3,
      foldStopCalls: ["step1", "step3"],
      pure: [2, 3],
    });
  });
});

Deno.test("the emitted examples run: main, a provided fallback, collections, and pay", async () => {
  await withTemporary(async (dir) => {
    buildExamples(dir);
    const result = await runScript(
      dir,
      `
import { Effect, Layer, Option } from "effect";
import { main } from "./main.ts";
import { activeNames, displayName } from "./users.ts";
import { UsersLive } from "./users-live.ts";
import { activeNames as activeUserNames, total } from "./collections.ts";
import { type Order, OrderId, Orders, pay, Payments } from "./pay.ts";

const orders = new Map<string, Order>([
  ["o1", { id: OrderId.make("o1"), totalCents: 250, status: "pending" }],
]);
const OrdersMemory = Layer.succeed(Orders)({
  find: (id) => Effect.succeed(Option.fromNullishOr(orders.get(id))),
  save: (order) => Effect.sync(() => { orders.set(order.id, order); }),
});
const charges: number[] = [];
const PaymentsMemory = Layer.succeed(Payments)({
  charge: (amount) => Effect.sync(() => { charges.push(amount); return "ok"; }),
});
const paid = Effect.runSync(
  pay(OrderId.make("o1")).pipe(
    Effect.provide(Layer.mergeAll(OrdersMemory, PaymentsMemory)),
  ),
);
console.log(JSON.stringify({
  main: Effect.runSync(main()),
  guest: Effect.runSync(displayName("nobody").pipe(Effect.provide(UsersLive))),
  active: Effect.runSync(activeNames().pipe(Effect.provide(UsersLive))),
  total: total([1, 2, 3]),
  activeUsers: activeUserNames([
    { name: "a", active: true },
    { name: "b", active: false },
  ]),
  paidStatus: paid.status,
  paidTotal: paid.totalCents,
  stored: orders.get("o1")?.status,
  charges,
}));
`,
    );
    assertEquals(result, {
      main: "Ada",
      guest: "Guest",
      active: ["Ada"],
      total: 6,
      activeUsers: ["a"],
      paidStatus: "paid",
      paidTotal: 250,
      stored: "paid",
      charges: [250],
    });
  });
});

Deno.test("a catch with two handlers raises a handler failure to the caller (Effect.catchTags)", async () => {
  await withTemporary(async (dir) => {
    buildForms(dir);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Option, Result } from "effect";
import { Id, lookup2, Store } from "./forms.ts";

const StoreMemory = Layer.succeed(Store)({
  find: () => Effect.succeed(Option.none()),
  count: () => Effect.succeed(1),
  tick: () => Effect.succeed(undefined),
});
const run = (fail: boolean) =>
  Effect.runSyncExit(
    lookup2(Id.make("x"), fail).pipe(Effect.provide(StoreMemory)),
  );
const describe = (exit: Exit.Exit<string, unknown>) => {
  if (Exit.isSuccess(exit)) return { tag: "success", value: exit.value };
  const found = Cause.findError(exit.cause);
  const error = Result.isSuccess(found) ? found.success : undefined;
  const tag = typeof error === "object" && error !== null && "_tag" in error
    ? error._tag
    : undefined;
  return { tag: "failure", error: tag };
};
// The body fails with NotFound. Its handler fails with Other. The second
// handler must not catch that failure, so the failure reaches the caller.
// The second run fails with Other, and its handler returns a value.
console.log(JSON.stringify({ first: describe(run(true)), second: describe(run(false)) }));
`,
    );
    assertEquals(result, {
      first: { tag: "failure", error: "forms#Other" },
      second: { tag: "success", value: "x" },
    });
  });
});

Deno.test("int arithmetic outside the safe range throws, and a throw inside an effect is a defect", async () => {
  await withTemporary(async (dir) => {
    buildForms(dir);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { hoist, Id, mul, Store } from "./forms.ts";

let thrown: string | undefined;
try {
  mul(2 ** 40, 2 ** 40);
} catch (e) {
  thrown = e instanceof RangeError ? e.message : "other";
}
const StoreMemory = Layer.succeed(Store)({
  find: () => Effect.succeed(Option.none()),
  count: () => Effect.succeed(1),
  tick: () => Effect.succeed(undefined),
});
const exit = Effect.runSyncExit(
  hoist(Id.make("x"), Number.MAX_SAFE_INTEGER).pipe(Effect.provide(StoreMemory)),
);
console.log(JSON.stringify({
  thrown,
  small: mul(6, 7),
  defect: Exit.isFailure(exit) && Cause.hasDies(exit.cause) &&
    !Cause.hasFails(exit.cause),
}));
`,
    );
    assertEquals(result, { thrown: "int overflow", small: 42, defect: true });
  });
});

Deno.test("brand addition outside the safe range throws, and a throw inside an effect is a defect", async () => {
  await withTemporary(async (dir) => {
    buildForms(dir);
    const result = await runScript(
      dir,
      `
import { Cause, Effect, Exit, Layer } from "effect";
import { add, bump, Count, Counter, below } from "./brand-operators.ts";

const big = Count.make(Number.MAX_SAFE_INTEGER);
let thrown: string | undefined;
try {
  add(big, Count.make(1));
} catch (e) {
  thrown = e instanceof RangeError ? e.message : "other";
}
const CounterMemory = Layer.succeed(Counter)({
  read: () => Effect.succeed(Count.make(Number.MAX_SAFE_INTEGER)),
});
const exit = Effect.runSyncExit(
  bump(Count.make(1)).pipe(Effect.provide(CounterMemory)),
);
console.log(JSON.stringify({
  thrown,
  sum: add(Count.make(40), Count.make(2)),
  below: below(Count.make(1), Count.make(2)),
  defect: Exit.isFailure(exit) && Cause.hasDies(exit.cause) &&
    !Cause.hasFails(exit.cause),
}));
`,
    );
    assertEquals(result, {
      thrown: "int overflow",
      sum: 42,
      below: true,
      defect: true,
    });
  });
});

Deno.test("a pure function lifted into an effect function slot runs", async () => {
  await withTemporary(async (dir) => {
    buildForms(dir);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { useLift, useLiftClosure } from "./forms.ts";
console.log(JSON.stringify({
  lift: Effect.runSync(useLift(1)),
  closure: Effect.runSync(useLiftClosure(3)),
}));
`,
    );
    assertEquals(result, { lift: 3, closure: 12 });
  });
});

Deno.test("a retry of a pure job runs", async () => {
  await withTemporary(async (dir) => {
    buildForms(dir);
    const result = await runScript(
      dir,
      `
import { Effect } from "effect";
import { retryPure, retryPureNamed } from "./forms.ts";
console.log(JSON.stringify({
  closure: Effect.runSync(retryPure()),
  named: Effect.runSync(retryPureNamed()),
}));
`,
    );
    assertEquals(result, { closure: 2, named: 2 });
  });
});
