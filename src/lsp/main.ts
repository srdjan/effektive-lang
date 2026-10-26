// The stdio entry of the language server (plan 5.4 and 5.12). It reads frames
// from stdin, feeds them to the server, and writes each reply with a blocking
// write. `WireLog` records the frames and the port calls. Log text goes to
// stderr and never to stdout. The end of stdin ends the process: code 0 after
// `shutdown`, else 1.

import { denoFs, denoLogFs } from "../host/deno_io.ts";
import { noLog, openFileLog } from "../host/log.ts";
import {
  encodeMessage,
  FrameDecoder,
  type OutgoingMessage,
} from "./jsonrpc.ts";
import { LanguageServer } from "./server.ts";
import { WireLog } from "./wire_log.ts";

const textEncoder = new TextEncoder();

/** Writes every byte. `writeSync` can return a short count on a pipe. */
function writeAll(
  stream: { writeSync(bytes: Uint8Array): number },
  bytes: Uint8Array,
): void {
  let written = 0;
  while (written < bytes.length) {
    written += stream.writeSync(bytes.subarray(written));
  }
}

const wire = new WireLog((root) => {
  const opened = openFileLog({
    fs: denoLogFs,
    projectDir: root,
    surface: "lsp",
  });
  return opened.ok ? opened.value : noLog;
});

const server = new LanguageServer(wire.ports({
  send: (message: OutgoingMessage) => {
    writeAll(Deno.stdout, encodeMessage(message));
  },
  fs: denoFs,
  schedule: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
  exit: (code) => Deno.exit(code),
  memory: () => {
    const { rss, heapUsed } = Deno.memoryUsage();
    return { rss, heapUsed };
  },
  stderr: (text) => {
    writeAll(Deno.stderr, textEncoder.encode(text));
  },
}));

const decoder = new FrameDecoder();
for await (const chunk of Deno.stdin.readable) {
  for (const frame of decoder.push(chunk)) {
    wire.frame(frame);
    server.handle(frame);
  }
  wire.batch();
  server.afterBatch();
}
Deno.exit(server.shutdownSeen ? 0 : 1);
