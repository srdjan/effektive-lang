// Tests of `logs:replay` (plan LG6). Each test records a session in process on
// the current build with a memory log, then replays its events. A committed
// recording would break each time a message or an output changes.

import { assert, assertEquals } from "@std/assert";
import { memoryLog } from "../src/host/log.ts";
import type { Envelope } from "../src/host/log.ts";
import { main } from "../src/cli/main.ts";
import { FrameDecoder } from "../src/lsp/jsonrpc.ts";
import { LanguageServer } from "../src/lsp/server.ts";
import { WireLog } from "../src/lsp/wire_log.ts";
import { createPlayground } from "../playground/src/compile.ts";
import {
  compileData,
  editData,
  selectData,
  startData,
} from "../playground/src/events.ts";
import { outputState, savingLabel } from "../playground/src/model.ts";
import { isReplayName } from "../playground/log_endpoint.ts";
import { applyChanges } from "../playground/src/replay.ts";
import { loadExamples, replaySession } from "../scripts/logs_replay.ts";
import { FIXTURES } from "./helpers.ts";
import { memoryIo } from "./cli_helpers.ts";
import {
  didChangeFull,
  didOpen,
  exampleFilesAt,
  exampleUri,
  frameOf,
  notification,
  request,
  ROOT,
  uriOf,
} from "./lsp_helpers.ts";

type Recorded = {
  readonly events: readonly Envelope[];
  readonly blobs: Map<string, string>;
};

const replay = (recorded: Recorded) =>
  replaySession(recorded.events, (hash) => recorded.blobs.get(hash));

/** The events with one changed. */
function changed(
  events: readonly Envelope[],
  index: number,
  data: unknown,
): Envelope[] {
  return events.map((e, i) => i === index ? { ...e, data } : e);
}

// ---- CLI

const CLI_ROOT = "/proj";
const ERROR_SOURCE = Deno.readTextFileSync(
  new URL("errors/type-mismatch-argument-count.eff", FIXTURES),
);

async function recordCli(
  files: Record<string, string>,
  args: readonly string[],
): Promise<Recorded> {
  const m = memoryIo(files);
  await main(args, m.io);
  return m.logs[0];
}

Deno.test("cli: a check with a diagnostic replays with no difference", async () => {
  const recorded = await recordCli({
    [`${CLI_ROOT}/effektive.json`]: "{}",
    [`${CLI_ROOT}/m.eff`]: ERROR_SOURCE,
  }, ["check", CLI_ROOT]);
  assertEquals(await replay(recorded), {
    tag: "same",
    surface: "cli",
    compared: 1,
    skipped: [],
  });
});

const OK_PROJECT = {
  [`${CLI_ROOT}/effektive.json`]: "{}",
  [`${CLI_ROOT}/ok.eff`]: "type Cents = int\n",
};

Deno.test("cli: a build replays its outputs, and --tsc is skipped", async () => {
  const recorded = await recordCli(OK_PROJECT, ["build", CLI_ROOT, "--tsc"]);
  assertEquals(await replay(recorded), {
    tag: "same",
    surface: "cli",
    compared: 3,
    skipped: ["tsc"],
  });
});

Deno.test("cli: a changed output hash is a difference at its seq and kind", async () => {
  const recorded = await recordCli(OK_PROJECT, ["build", CLI_ROOT]);
  const index = recorded.events.findIndex((e) => e.kind === "cli.output");
  const event = recorded.events[index];
  const data = event.data as Record<string, unknown>;
  const outcome = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, index, { ...data, hash: "0".repeat(64) }),
  });
  assertEquals(outcome.tag, "different");
  if (outcome.tag !== "different") return;
  assertEquals(outcome.seq, event.seq);
  assertEquals(outcome.kind, "cli.output");
  assertEquals((outcome.expected as { hash: string }).hash, "0".repeat(64));
  assertEquals((outcome.actual as { hash: string }).hash, data.hash);
});

Deno.test("cli: a changed diagnostic is a difference", async () => {
  const recorded = await recordCli({
    [`${CLI_ROOT}/effektive.json`]: "{}",
    [`${CLI_ROOT}/m.eff`]: ERROR_SOURCE,
  }, ["check", CLI_ROOT]);
  const index = recorded.events.findIndex((e) => e.kind === "cli.diagnostics");
  const outcome = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, index, { items: [] }),
  });
  assertEquals(outcome.tag, "different");
  if (outcome.tag === "different") {
    assertEquals(outcome.seq, recorded.events[index].seq);
    assertEquals(outcome.kind, "cli.diagnostics");
  }
});

Deno.test("cli: a watch session is unsupported", async () => {
  const m = memoryIo(OK_PROJECT);
  m.script = [() => ["ok.eff"]];
  await main(["watch", CLI_ROOT], m.io);
  const outcome = await replay(m.logs[0]);
  assertEquals(outcome.tag, "unsupported");
});

Deno.test("cli: a missing blob is unsupported", async () => {
  const recorded = await recordCli(OK_PROJECT, ["check", CLI_ROOT]);
  const outcome = await replaySession(recorded.events, () => undefined);
  assertEquals(outcome.tag, "unsupported");
});

// ---- Language server

/** Runs a server through `WireLog` and returns the log. */
function recordLsp(
  initializationOptions: Record<string, unknown>,
  steps: (deliver: (...messages: readonly unknown[]) => void) => void,
): Recorded {
  const log = memoryLog("lsp");
  const wire = new WireLog(() => log);
  const timers: { run: () => void; live: boolean }[] = [];
  const server = new LanguageServer(wire.ports({
    send: () => {},
    fs: memoryIo(exampleFilesAt(ROOT)).io.fs,
    schedule: (callback) => {
      const timer = { run: callback, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    exit: () => {},
    stderr: () => {},
    memory: () => ({ rss: Math.random(), heapUsed: Math.random() }),
  }));
  const decoder = new FrameDecoder();
  const deliver = (...messages: readonly unknown[]) => {
    for (const message of messages) {
      for (const frame of decoder.push(frameOf(message))) {
        wire.frame(frame);
        server.handle(frame);
      }
    }
    wire.batch();
    server.afterBatch();
    // The timers fire between two reads.
    for (const timer of timers.splice(0)) if (timer.live) timer.run();
  };
  deliver(
    request(0, "initialize", {
      capabilities: {},
      rootUri: uriOf(ROOT),
      initializationOptions,
    }),
    notification("initialized", {}),
  );
  steps(deliver);
  return log;
}

function lspSession(options: Record<string, unknown>): Recorded {
  const main = exampleUri("main.eff");
  const text = exampleFilesAt("")["/main.eff"];
  return recordLsp(options, (deliver) => {
    deliver(didOpen(main, 1, text));
    deliver(didChangeFull(main, 2, text + "\nbroken ((\n"));
    deliver(request(1, "textDocument/hover", {
      textDocument: { uri: main },
      position: { line: 0, character: 0 },
    }));
    deliver(request(2, "effektive/stats", { textDocument: { uri: main } }));
    deliver(request(3, "shutdown"), notification("exit"));
  });
}

Deno.test("lsp: a session replays with no difference", async () => {
  const recorded = lspSession({});
  assert(recorded.events.some((e) => e.kind === "lsp.fs"));
  const outcome = await replay(recorded);
  assertEquals(outcome.tag, "same");
});

Deno.test("lsp: a session with debounce replays its flush points", async () => {
  const recorded = lspSession({ debounceMs: 50 });
  assert(recorded.events.some((e) => e.kind === "lsp.flush"));
  const outcome = await replay(recorded);
  assertEquals(outcome.tag, "same");
});

Deno.test("lsp: a changed message out is a difference at its seq", async () => {
  const recorded = lspSession({});
  const index = recorded.events.findLastIndex((e) => e.kind === "lsp.out");
  const event = recorded.events[index];
  const message = (event.data as { message: Record<string, unknown> }).message;
  const outcome = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, index, {
      message: { ...message, id: 999 },
    }),
  });
  assertEquals(outcome.tag, "different");
  if (outcome.tag === "different") {
    assertEquals(outcome.seq, event.seq);
    assertEquals(outcome.kind, "lsp.out");
  }
});

// ---- Playground

/** Records the way `app.ts` logs: start, select, then an edit and a compile each. */
function recordPlayground(
  edits: readonly { path: string; from: number; to: number; insert: string }[],
): Recorded {
  const log = memoryLog("playground");
  const files = loadExamples();
  const session = createPlayground(files, { now: () => 0 });
  const texts: Record<string, string> = { ...files };
  let active = "main.eff";
  let result = session.start();
  const compile = () => {
    if (!result.ok) throw new Error("the facade failed");
    const state = outputState(result.value, active);
    const saving = state.tag === "text" && !active.endsWith(".effi")
      ? savingLabel(texts[active] ?? "", state.text)
      : "";
    log.append("pg.compile", compileData(active, result.value, saving));
  };
  log.append(
    "pg.start",
    startData({ build: "t", width: 1280, height: 800, files, loadMs: 1 }),
  );
  log.append("pg.select", selectData(active, "start"));
  compile();
  for (const { path, from, to, insert } of edits) {
    if (path !== active) {
      active = path;
      log.append("pg.select", selectData(path, "click"));
    }
    const changes = [{ from, to, insert }];
    texts[path] = applyChanges(texts[path], changes);
    log.append("pg.edit", editData(path, changes, texts[path].length));
    result = session.update(path, texts[path]);
    compile();
  }
  return log;
}

const EDITS = [
  { path: "main.eff", from: 0, to: 0, insert: "broken ((\n" },
  { path: "main.eff", from: 0, to: 11, insert: "" },
  { path: "users.eff", from: 0, to: 0, insert: "// note\n" },
];

Deno.test("playground: edits and compiles replay with no difference", async () => {
  const recorded = recordPlayground(EDITS);
  assert(recorded.events.some((e) => e.kind === "pg.edit"));
  const outcome = await replay(recorded);
  assertEquals(outcome.tag, "same");
  if (outcome.tag === "same") assertEquals(outcome.compared, 4);
});

Deno.test("playground: a wrong edit length is a difference at that seq", async () => {
  const recorded = recordPlayground(EDITS);
  const index = recorded.events.findIndex((e) => e.kind === "pg.edit");
  const event = recorded.events[index];
  const data = event.data as Record<string, unknown>;
  const outcome = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, index, {
      ...data,
      length: (data.length as number) + 1,
    }),
  });
  assertEquals(outcome.tag, "different");
  if (outcome.tag === "different") {
    assertEquals(outcome.seq, event.seq);
    assertEquals(outcome.kind, "pg.edit");
  }
});

Deno.test("playground: a changed compile is a difference, and changed examples are unsupported", async () => {
  const recorded = recordPlayground(EDITS);
  const index = recorded.events.findLastIndex((e) => e.kind === "pg.compile");
  const data = recorded.events[index].data as Record<string, unknown>;
  const outcome = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, index, { ...data, stale: !data.stale }),
  });
  assertEquals(outcome.tag, "different");
  const start = recorded.events.findIndex((e) => e.kind === "pg.start");
  const moved = await replay({
    blobs: recorded.blobs,
    events: changed(recorded.events, start, {
      ...(recorded.events[start].data as Record<string, unknown>),
      examples: "x",
    }),
  });
  assertEquals(moved.tag, "unsupported");
});

// ---- The replay name

Deno.test("isReplayName accepts a playground session file and refuses the rest", () => {
  const id = "7f0c1d2e-3a4b-4c5d-8e6f-0123456789ab";
  assert(isReplayName(`playground-20261026-${id}.jsonl`));
  for (
    const name of [
      "../playground-20261026-" + id + ".jsonl",
      "a/playground-20261026-" + id + ".jsonl",
      "..",
      `cli-20261026-${id}.jsonl`,
      "playground-20261026-not-a-uuid-not-a-uuid-not-a-uuid.jsonl",
      `playground-20261026-${id}.jsonl\n`,
      `playground-20261026-${id}.txt`,
    ]
  ) assertEquals(isReplayName(name), false, name);
});
