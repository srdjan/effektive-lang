// Tests of the wire log: a real `LanguageServer` runs through `WireLog` with
// memory ports and a memory log. The tests check the events and their order.

import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../src/core/mod.ts";
import { memoryLog } from "../src/host/log.ts";
import { FrameDecoder, type OutgoingMessage } from "../src/lsp/jsonrpc.ts";
import { LanguageServer } from "../src/lsp/server.ts";
import { WireLog } from "../src/lsp/wire_log.ts";
import { memoryIo } from "./cli_helpers.ts";
import {
  didOpen,
  exampleFilesAt,
  exampleUri,
  frameOf,
  notification,
  request,
  ROOT,
  uriOf,
} from "./lsp_helpers.ts";

function rig() {
  const log = memoryLog("lsp");
  const opened: string[] = [];
  const wire = new WireLog((root) => {
    opened.push(root);
    return log;
  });
  const files = exampleFilesAt(ROOT);
  const sent: OutgoingMessage[] = [];
  const timers: Array<() => void> = [];
  const server = new LanguageServer(wire.ports({
    send: (message) => {
      sent.push(message);
    },
    fs: memoryIo(files).io.fs,
    schedule: (callback) => {
      timers.push(callback);
      return () => {};
    },
    exit: () => {},
    stderr: () => {},
    memory: () => ({ rss: 1, heapUsed: 1 }),
  }));
  const decoder = new FrameDecoder();
  /** One stdin read: the frames, then the batch marker and `afterBatch`. */
  const deliver = (...messages: readonly unknown[]) => {
    for (const message of messages) {
      for (const frame of decoder.push(frameOf(message))) {
        wire.frame(frame);
        server.handle(frame);
      }
    }
    wire.batch();
    server.afterBatch();
  };
  return { log, opened, sent, timers, deliver };
}

const kinds = (log: ReturnType<typeof memoryLog>) =>
  log.events.map((e) => e.kind);

const initialize = (params: Record<string, unknown>) =>
  request(0, "initialize", { capabilities: {}, ...params });

const MAIN = "main.eff";

function mainText(): string {
  return exampleFilesAt("")[`/${MAIN}`];
}

Deno.test("initialize opens the log at rootUri and flushes the buffer into it", () => {
  const t = rig();
  t.deliver(initialize({ rootUri: uriOf(ROOT) }));
  assertEquals(t.opened, [ROOT]);
  assertEquals(kinds(t.log).slice(0, 2), ["lsp.in", "lsp.out"]);
  const first = t.log.events[0].data as { message: { method: string } };
  assertEquals(first.message.method, "initialize");
});

Deno.test("the first workspace folder wins over rootUri", () => {
  const t = rig();
  t.deliver(initialize({
    rootUri: uriOf("/elsewhere"),
    workspaceFolders: [{ uri: uriOf(ROOT), name: "w" }],
  }));
  assertEquals(t.opened, [ROOT]);
});

Deno.test("didOpen gives lsp.in, lsp.batch, then the diagnostics after the batch", () => {
  const t = rig();
  t.deliver(
    initialize({ rootUri: uriOf(ROOT) }),
    notification("initialized", {}),
  );
  const before = t.log.events.length;
  t.deliver(didOpen(exampleUri(MAIN), 1, mainText()));
  const added = t.log.events.slice(before).filter((e) => e.kind !== "lsp.fs");
  assertEquals(added[0].kind, "lsp.in");
  assertEquals(added[1].kind, "lsp.batch");
  const out = added.findIndex((e) => e.kind === "lsp.out");
  assertEquals(out, 2);
  const message = (added[out].data as { message: { method: string } }).message;
  assertEquals(message.method, "textDocument/publishDiagnostics");
});

Deno.test("a request gives one lsp.out response and one lsp.timing", () => {
  const t = rig();
  t.deliver(
    initialize({ rootUri: uriOf(ROOT) }),
    notification("initialized", {}),
  );
  t.deliver(didOpen(exampleUri(MAIN), 1, mainText()));
  const before = t.log.events.length;
  t.deliver(request(7, "textDocument/hover", {
    textDocument: { uri: exampleUri(MAIN) },
    position: { line: 0, character: 0 },
  }));
  const added = t.log.events.slice(before);
  const responses = added.filter((e) => {
    const message = (e.data as { message?: Record<string, unknown> }).message;
    return e.kind === "lsp.out" && message?.id === 7 && !("method" in message);
  });
  assertEquals(responses.length, 1);
  const timings = added.filter((e) => e.kind === "lsp.timing");
  assertEquals(timings.length, 1);
  const timing = timings[0].data as { method: string; id: number; ms: number };
  assertEquals(timing.method, "textDocument/hover");
  assertEquals(timing.id, 7);
  assert(timing.ms >= 0);
});

Deno.test("disk reads give lsp.fs events with stored blobs", () => {
  const t = rig();
  t.deliver(
    initialize({ rootUri: uriOf(ROOT) }),
    notification("initialized", {}),
  );
  t.deliver(didOpen(exampleUri(MAIN), 1, mainText()));
  const reads = t.log.events.filter((e) =>
    e.kind === "lsp.fs" && (e.data as { op: string }).op === "readText"
  ).map((e) => e.data as { path: string; hash?: string });
  assert(reads.length > 0);
  const users = reads.find((r) => r.path === `${ROOT}/users.eff`);
  assert(users?.hash !== undefined);
  const text = exampleFilesAt(ROOT)[`${ROOT}/users.eff`];
  assertEquals(users.hash, sha256Hex(text));
  assertEquals(t.log.blobs.get(users.hash), text);
  assert(
    t.log.events.some((e) =>
      e.kind === "lsp.fs" && (e.data as { op: string }).op === "list"
    ),
  );
});

Deno.test("a scheduled flush logs lsp.flush before its outputs", () => {
  const t = rig();
  t.deliver(
    initialize({
      rootUri: uriOf(ROOT),
      initializationOptions: { debounceMs: 50 },
    }),
    notification("initialized", {}),
  );
  t.deliver(didOpen(exampleUri(MAIN), 1, mainText()));
  assertEquals(t.timers.length > 0, true);
  const before = t.log.events.length;
  for (const callback of t.timers) callback();
  const added = t.log.events.slice(before).map((e) => e.kind);
  assertEquals(added[0], "lsp.flush");
  assert(added.includes("lsp.out"));
});

Deno.test("log false opens nothing and records nothing", () => {
  const t = rig();
  t.deliver(
    initialize({
      rootUri: uriOf(ROOT),
      initializationOptions: { log: false },
    }),
    notification("initialized", {}),
  );
  t.deliver(didOpen(exampleUri(MAIN), 1, mainText()));
  assertEquals(t.opened, []);
  assertEquals(t.log.events, []);
  assert(t.sent.length > 0);
});

Deno.test("no root opens nothing and records nothing", () => {
  const t = rig();
  t.deliver(initialize({ rootUri: null }), notification("initialized", {}));
  assertEquals(t.opened, []);
  assertEquals(t.log.events, []);
});

Deno.test("a bad frame logs an error and events before initialize wait for it", () => {
  const log = memoryLog("lsp");
  const wire = new WireLog(() => log);
  wire.frame({ ok: false, error: { tag: "bad-json", message: "x" } });
  assertEquals(log.events, []);
  wire.frame({
    ok: true,
    value: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { rootUri: uriOf(ROOT) },
    },
  });
  assertEquals(log.events.length, 2);
});
