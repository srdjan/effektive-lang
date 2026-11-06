// The request check of `POST /log` on `serve.ts`. It is a trust boundary.
// It is pure: the caller reads the request and gives the method, the headers,
// and the body text. The result is the envelopes to write, or the refusal.

import type { Result } from "../src/core/mod.ts";
import {
  type Envelope,
  parseEnvelope,
  parseSessionFileName,
} from "../src/host/log_schema.ts";

/** The only origin that may post besides a same-origin fetch. */
export const ALLOWED_ORIGIN = "http://127.0.0.1:8790";

/** The most bytes of a request body. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The most envelopes in one request. */
const MAX_ENVELOPES = 500;

export interface LogRequest {
  readonly method: string;
  readonly headers: { get(name: string): string | null };
  readonly body: string;
}

export interface Refusal {
  readonly status: 400 | 403 | 413 | 415 | 405;
  readonly message: string;
}

/** True for a playground session file name. A path separator or `..` never matches. */
export function isReplayName(name: string): boolean {
  return parseSessionFileName(name)?.surface === "playground";
}

export function checkLogRequest(
  request: LogRequest,
): Result<readonly Envelope[], Refusal> {
  const refuse = (status: Refusal["status"], message: string) => ({
    ok: false as const,
    error: { status, message },
  });
  if (request.method !== "POST") return refuse(405, "POST only");
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site !== "same-origin" && origin !== ALLOWED_ORIGIN) {
    return refuse(403, "foreign origin");
  }
  if (request.headers.get("Content-Type") !== "application/json") {
    return refuse(415, "Content-Type must be application/json");
  }
  if (new TextEncoder().encode(request.body).length > MAX_BODY_BYTES) {
    return refuse(413, "body too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return refuse(400, "body is not JSON");
  }
  if (
    !Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_ENVELOPES
  ) {
    return refuse(400, "body must be an array of 1 to 500 envelopes");
  }
  const envelopes: Envelope[] = [];
  for (const item of parsed) {
    const envelope = parseEnvelope(item, "browser");
    if (envelope === undefined) return refuse(400, "bad envelope");
    if (envelope.session !== (envelopes[0]?.session ?? envelope.session)) {
      return refuse(400, "mixed sessions");
    }
    envelopes.push(envelope);
  }
  return { ok: true, value: envelopes };
}
