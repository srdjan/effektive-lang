// Tests for the browser log client with a fake fetch.

import { assert, assertEquals } from "@std/assert";
import { BUILD } from "../src/host/log.ts";
import {
  createPageLog,
  IDLE_FLUSH_MS,
  MAX_BATCH_BYTES,
  type PostFetch,
} from "../playground/src/log_client.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

type Call = Parameters<PostFetch>;

function setup(
  respond: () => Promise<{ ok: boolean }> = () => Promise.resolve({ ok: true }),
) {
  const calls: Call[] = [];
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const log = createPageLog({
    fetch: (url, init) => {
      calls.push([url, init]);
      return respond();
    },
    setTimer: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    session: SESSION,
  });
  return { calls, timers, log };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("events leave in one array after the idle pause", () => {
  const { calls, timers, log } = setup();
  log.event("pg.a", { x: 1 });
  log.event("pg.b", null);
  assertEquals(calls.length, 0);
  const live = timers.filter((t) => t.live);
  assertEquals(live.length, 1);
  assertEquals(live[0].ms, IDLE_FLUSH_MS);
  live[0].run();
  assertEquals(calls.length, 1);
  const [url, init] = calls[0];
  assertEquals(url, "/log");
  assertEquals(init.method, "POST");
  assertEquals(init.headers, { "Content-Type": "application/json" });
  assertEquals(init.keepalive, true);
  const body = JSON.parse(init.body);
  assertEquals(
    body.map((e: Record<string, unknown>) => [
      e.surface,
      e.session,
      e.seq,
      e.build,
      e.kind,
      e.v,
    ]),
    [
      ["playground", SESSION, 0, BUILD, "pg.a", 1],
      ["playground", SESSION, 1, BUILD, "pg.b", 1],
    ],
  );
});

Deno.test("flush posts at once, and posts nothing when empty", () => {
  const { calls, log } = setup();
  log.flush();
  assertEquals(calls.length, 0);
  log.event("pg.end", {});
  log.flush();
  assertEquals(calls.length, 1);
  log.flush();
  assertEquals(calls.length, 1);
});

Deno.test("a large backlog splits into bodies below the limit", () => {
  const { calls, log } = setup();
  const text = "é".repeat(5000);
  for (let i = 0; i < 20; i++) log.event("pg.edit", { text });
  log.flush();
  assert(calls.length > 1);
  let total = 0;
  for (const [, init] of calls) {
    assert(new TextEncoder().encode(init.body).length < MAX_BATCH_BYTES);
    total += JSON.parse(init.body).length;
  }
  assertEquals(total, 20);
});

Deno.test("one envelope above the limit is dropped, the rest go out", () => {
  const { calls, log } = setup();
  log.event("pg.big", { text: "x".repeat(MAX_BATCH_BYTES) });
  log.event("pg.ok", {});
  log.flush();
  assertEquals(calls.length, 1);
  assertEquals(
    JSON.parse(calls[0][1].body).map((e: { kind: string }) => e.kind),
    [
      "pg.ok",
    ],
  );
});

Deno.test("a non-2xx answer stops the logging", async () => {
  const { calls, log } = setup(() => Promise.resolve({ ok: false }));
  log.event("pg.a", {});
  log.flush();
  await settle();
  log.event("pg.b", {});
  log.flush();
  assertEquals(calls.length, 1);
});

Deno.test("a network error stops the logging", async () => {
  const { calls, log } = setup(() => Promise.reject(new TypeError("down")));
  log.event("pg.a", {});
  log.flush();
  await settle();
  log.event("pg.b", {});
  log.flush();
  assertEquals(calls.length, 1);
});
