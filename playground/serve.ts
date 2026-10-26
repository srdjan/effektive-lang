// Builds the playground, then serves the output on 127.0.0.1:8790 (plan
// section 8). Run it with `deno task playground:serve`. The page posts its
// session log to `POST /log`, and this file writes it into
// `playground/.effektive/logs/`. `--no-log` turns that off.

import { serveDir } from "@std/http/file-server";
import { join } from "@std/path";
import { denoLogFs } from "../src/host/deno_io.ts";
import { prepareLogFolder } from "../src/host/log.ts";
import { build, describeBuildError, REPOSITORY_ROOT } from "./build.ts";
import {
  checkLogRequest,
  isReplayName,
  MAX_BODY_BYTES,
} from "./log_endpoint.ts";

const OUT_DIR = join(REPOSITORY_ROOT, "playground", "dist");
const HOSTNAME = "127.0.0.1";
const PORT = 8790;

/** The most bytes of one session file. */
const SESSION_CAP_BYTES = 32 * 1024 * 1024;

/** Where the session files go, or undefined when logging is off. */
function openLogFolder(): string | undefined {
  if (Deno.args.includes("--no-log")) return undefined;
  const prepared = prepareLogFolder(
    denoLogFs,
    join(REPOSITORY_ROOT, "playground"),
    new Date(),
  );
  if (prepared.ok) return prepared.value;
  console.error(`log folder: ${prepared.error.message}; logging is off`);
  return undefined;
}

const respond = (status: number, message = "") =>
  new Response(message === "" ? null : message, { status });

/** The session files by session ID, with the bytes written so far. */
const sessions = new Map<string, { file: string; bytes: number }>();

async function handleLog(request: Request, logs: string): Promise<Response> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) return respond(413, "body too large");
  const checked = checkLogRequest({
    method: request.method,
    headers: request.headers,
    body: await request.text(),
  });
  if (!checked.ok) return respond(checked.error.status, checked.error.message);
  const envelopes = checked.value;
  const session = envelopes[0].session;
  const text = envelopes.map((e) => JSON.stringify(e) + "\n").join("");
  const size = new TextEncoder().encode(text).length;
  let target = sessions.get(session);
  if (target === undefined) {
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    target = { file: `${logs}/playground-${day}-${session}.jsonl`, bytes: 0 };
    sessions.set(session, target);
  }
  if (target.bytes + size > SESSION_CAP_BYTES) {
    return respond(413, "session file full");
  }
  const written = denoLogFs.appendText(target.file, text);
  if (!written.ok) return respond(500, written.error.message);
  target.bytes += size;
  return respond(204);
}

/** `GET /replay/<file>`: a session file of the logs folder, for `?replay=`. */
function handleReplay(request: Request, logs: string | undefined): Response {
  // A DNS-rebinding page is same-origin under another host name.
  if (request.headers.get("host") !== `${HOSTNAME}:${PORT}`) {
    return respond(403, "wrong host");
  }
  const { pathname } = new URL(request.url);
  let name: string;
  try {
    name = decodeURIComponent(pathname.slice("/replay/".length));
  } catch {
    return respond(400, "bad name");
  }
  if (!isReplayName(name)) return respond(400, "bad name");
  if (logs === undefined) return respond(404);
  try {
    return new Response(Deno.readTextFileSync(`${logs}/${name}`), {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  } catch {
    return respond(404);
  }
}

if (import.meta.main) {
  const result = await build(OUT_DIR);
  if (!result.ok) {
    console.error(describeBuildError(result.error));
    Deno.exit(1);
  }
  const { appBytes, appGzipBytes } = result.value;
  console.log(`app.js: ${appBytes} bytes, ${appGzipBytes} bytes after gzip`);
  console.log(`http://${HOSTNAME}:${PORT}/`);
  const logs = openLogFolder();
  Deno.serve(
    { hostname: HOSTNAME, port: PORT, onListen: () => {} },
    (request) => {
      if (
        request.method === "POST" && new URL(request.url).pathname === "/log"
      ) {
        // With --no-log the answer is 404, so the page stops after its first post.
        return logs === undefined ? respond(404) : handleLog(request, logs);
      }
      if (
        request.method === "GET" &&
        new URL(request.url).pathname.startsWith("/replay/")
      ) return handleReplay(request, logs);
      return serveDir(request, { fsRoot: OUT_DIR, quiet: true });
    },
  );
}
