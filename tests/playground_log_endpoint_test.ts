// Tests for the request check of `POST /log`.

import { assertEquals } from "@std/assert";
import {
  ALLOWED_ORIGIN,
  checkLogRequest,
  MAX_BODY_BYTES,
} from "../playground/log_endpoint.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

function envelope(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    t: "2026-10-26T12:00:00.000Z",
    ms: 1.5,
    surface: "playground",
    session: SESSION,
    seq: 0,
    build: "0.10.3",
    kind: "pg.start",
    data: {},
    ...over,
  };
}

function check(
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
) {
  const all: Record<string, string> = {
    Origin: ALLOWED_ORIGIN,
    "Content-Type": "application/json",
    ...headers,
  };
  return checkLogRequest({
    method,
    headers: new Headers(all),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const status = (result: ReturnType<typeof check>) =>
  result.ok ? 204 : result.error.status;

Deno.test("a valid batch passes with its envelopes", () => {
  const batch = [envelope(), envelope({ seq: 1, kind: "pg.end" })];
  const result = check(batch);
  assertEquals(result.ok ? [...result.value] : null, batch as unknown[]);
});

Deno.test("a same-origin fetch passes without an Origin header", () => {
  const result = check([envelope()], {
    "Sec-Fetch-Site": "same-origin",
    Origin: "",
  });
  assertEquals(status(result), 204);
});

Deno.test("a foreign origin gives 403", () => {
  assertEquals(
    status(check([envelope()], { Origin: "http://evil.example" })),
    403,
  );
  assertEquals(
    status(check([envelope()], {
      Origin: ALLOWED_ORIGIN,
      "Sec-Fetch-Site": "cross-site",
    })),
    204,
  );
});

Deno.test("a wrong content type gives 415", () => {
  assertEquals(
    status(check([envelope()], { "Content-Type": "text/plain" })),
    415,
  );
  assertEquals(
    status(check([envelope()], {
      "Content-Type": "application/json; charset=utf-8",
    })),
    415,
  );
});

Deno.test("an oversized body gives 413", () => {
  const big = [envelope({ data: { text: "x".repeat(MAX_BODY_BYTES) } })];
  assertEquals(status(check(big)), 413);
});

Deno.test("a wrong shape gives 400", () => {
  const bad: unknown[] = [
    "not json",
    {},
    [],
    [1],
    [envelope({ v: 2 })],
    [envelope({ surface: "cli" })],
    [envelope({ session: "s1" })],
    [envelope({ session: "AAAAAAAA-2222-3333-4444-555555555555" })],
    [envelope({ seq: -1 })],
    [envelope({ seq: 1.5 })],
    [envelope({ ms: "1" })],
    [envelope({ kind: "cli.start" })],
    [envelope({ build: 1 })],
    [{ ...envelope(), data: undefined }],
    [envelope(), envelope({ session: "22222222-2222-3333-4444-555555555555" })],
  ];
  for (const body of bad) assertEquals(status(check(body)), 400, String(body));
});

Deno.test("a method other than POST is refused", () => {
  assertEquals(status(check([envelope()], {}, "GET")), 405);
});
