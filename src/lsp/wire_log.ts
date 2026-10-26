// The wire log of the language server: every frame in, every message out, every
// disk call, and every flush, as events of an `EventLog`. `WireLog` wraps the
// ports and the frame intake from outside, so the server logic does not change.
// The log folder comes from `initialize`, so events wait in a buffer until that
// frame arrives.

import { isRecord, type Result, sha256Hex } from "../core/mod.ts";
import type { HostFs } from "../host/io.ts";
import { type EventLog, noLog } from "../host/log.ts";
import type { FrameError, RequestId } from "./jsonrpc.ts";
import { uriToPath } from "./positions.ts";
import type { ServerPorts } from "./server.ts";

type Event = (log: EventLog) => Record<string, unknown>;

// shortcut: events before `initialize` stop at this count, raise it if a client sends more.
const MAX_BUFFERED = 1000;

/** The workspace folder of a raw `initialize` message, if it names one. */
function workspaceRoot(params: Record<string, unknown>): string | undefined {
  const folders = params.workspaceFolders;
  const first = Array.isArray(folders) ? folders[0] : undefined;
  const uris = [
    isRecord(first) ? first.uri : undefined,
    params.rootUri,
  ];
  for (const uri of uris) {
    const path = typeof uri === "string" ? uriToPath(uri) : undefined;
    if (path !== undefined) return path;
  }
  return undefined;
}

export class WireLog {
  #log: EventLog | undefined;
  readonly #buffer: Array<{ kind: string; data: Event }> = [];
  readonly #started = new Map<RequestId, { method: string; at: number }>();

  /**
   * `open` makes the log of a workspace folder. It returns a log that records
   * nothing when it cannot open.
   */
  constructor(
    private readonly open: (root: string) => EventLog,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  #emit(kind: string, data: Event): void {
    // An off log builds no event, so a disk read hashes nothing.
    if (this.#log === noLog) return;
    if (this.#log !== undefined) {
      this.#log.append(kind, data(this.#log));
    } else if (this.#buffer.length < MAX_BUFFERED) {
      this.#buffer.push({ kind, data });
    }
  }

  #decide(log: EventLog): void {
    this.#log = log;
    for (const { kind, data } of this.#buffer.splice(0)) {
      log.append(kind, data(log));
    }
  }

  /** The log of the first `initialize` decides; a later one changes nothing. */
  #initialize(params: unknown): void {
    if (this.#log !== undefined) return;
    const record = isRecord(params) ? params : {};
    const options = record.initializationOptions;
    const off = isRecord(options) && options.log === false;
    const root = off ? undefined : workspaceRoot(record);
    this.#decide(root === undefined ? noLog : this.open(root));
  }

  /** Logs one decoded frame. Call it before `server.handle(frame)`. */
  frame(frame: Result<unknown, FrameError>): void {
    if (!frame.ok) {
      this.#emit("lsp.in", () => ({ error: frame.error }));
      return;
    }
    const message = frame.value;
    this.#emit("lsp.in", () => ({ message }));
    if (!isRecord(message) || typeof message.method !== "string") return;
    const id = message.id;
    if (typeof id === "string" || typeof id === "number") {
      this.#started.set(id, { method: message.method, at: this.clock() });
    }
    if (message.method === "initialize") this.#initialize(message.params);
  }

  /** Logs the end of one stdin read. Call it before `server.afterBatch()`. */
  batch(): void {
    this.#emit("lsp.batch", () => ({}));
  }

  /** The ports of the server with every effect logged. */
  ports(real: ServerPorts): ServerPorts {
    return {
      send: (message) => {
        this.#emit("lsp.out", () => ({ message }));
        const id = "id" in message ? message.id : null;
        const started = id === null || "method" in message
          ? undefined
          : this.#started.get(id);
        if (id !== null && started !== undefined) {
          this.#started.delete(id);
          const ms = Math.round((this.clock() - started.at) * 10) / 10;
          this.#emit("lsp.timing", () => ({ method: started.method, id, ms }));
        }
        real.send(message);
      },
      fs: this.#fs(real.fs),
      schedule: (callback, ms) =>
        real.schedule(() => {
          this.#emit("lsp.flush", () => ({}));
          callback();
        }, ms),
      exit: (code) => {
        this.#emit("lsp.exit", () => ({ code }));
        real.exit(code);
      },
      stderr: (text) => {
        this.#emit("lsp.error", () => ({ text }));
        real.stderr(text);
      },
      memory: real.memory,
    };
  }

  #fs(real: HostFs): HostFs {
    const fs = (op: string, path: string, data: Event) =>
      this.#emit("lsp.fs", (log) => ({ op, path, ...data(log) }));
    return {
      readText: (path) => {
        const result = real.readText(path);
        fs(
          "readText",
          path,
          (log) =>
            result.ok
              ? { hash: log.blob(result.value) }
              : { error: result.error },
        );
        return result;
      },
      writeText: (path, text) => {
        const result = real.writeText(path, text);
        fs("writeText", path, () => ({ hash: sha256Hex(text), ok: result.ok }));
        return result;
      },
      remove: (path) => {
        const result = real.remove(path);
        fs("remove", path, () => ({ ok: result.ok }));
        return result;
      },
      kind: (path) => {
        const kind = real.kind(path);
        fs("kind", path, () => ({ kind }));
        return kind;
      },
      list: (path) => {
        const result = real.list(path);
        fs("list", path, () =>
          result.ok
            ? {
              entries: result.value.map((e) => ({
                name: e.name,
                isDirectory: e.isDirectory,
              })),
            }
            : { error: result.error });
        return result;
      },
      absolute: (path) => {
        const absolute = real.absolute(path);
        fs("absolute", path, () => ({ result: absolute }));
        return absolute;
      },
    };
  }
}
