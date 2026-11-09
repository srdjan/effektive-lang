// Tests for the log writes of `playground/serve.ts`. They write files, so the
// fast test task (read permission only) cannot run them.

import { assertEquals } from "@std/assert";
import { ALLOWED_ORIGIN } from "../playground/log_endpoint.ts";
import { route } from "../playground/serve.ts";
import { sessionFileName } from "../src/host/log_schema.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

const envelope = (session = SESSION) => ({
  v: 1,
  t: "2026-10-26T12:00:00.000Z",
  ms: 1.5,
  surface: "playground",
  session,
  seq: 0,
  build: "0.10.3",
  kind: "pg.start",
  data: {},
});

function post(session = SESSION): Request {
  const body = JSON.stringify([envelope(session)]);
  return new Request("http://127.0.0.1:8790/log", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:8790",
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
    body,
  });
}

const tempLogs = () => Deno.makeTempDirSync({ prefix: "pg-log-" });

Deno.test("a valid POST appends the envelope and gives 204", async () => {
  const logs = tempLogs();
  const response = await route(post(), logs, new Map());
  const files = [...Deno.readDirSync(logs)].map((e) => e.name);
  assertEquals(response.status, 204);
  assertEquals(files.length, 1);
  assertEquals(
    Deno.readTextFileSync(`${logs}/${files[0]}`),
    JSON.stringify(envelope()) + "\n",
  );
});

Deno.test("the session cap holds across a restart", async () => {
  const logs = tempLogs();
  const file = `${logs}/${sessionFileName("playground", new Date(), SESSION)}`;
  Deno.writeFileSync(file, new Uint8Array(0));
  Deno.truncateSync(file, 33_554_432);
  const response = await route(post(), logs, new Map());
  assertEquals(response.status, 413);
  assertEquals(Deno.statSync(file).size, 33_554_432);
});

Deno.test("the session map holds at most 256 sessions", async () => {
  const logs = tempLogs();
  const sessions = new Map(
    Array.from(
      { length: 256 },
      (_, i) => [`s${i}`, { file: `${logs}/s${i}`, bytes: 0 }] as const,
    ),
  );
  assertEquals((await route(post(), logs, sessions)).status, 204);
  assertEquals(sessions.size, 256);
  assertEquals(sessions.has("s0"), false);
  assertEquals(sessions.has("s1"), true);
});
