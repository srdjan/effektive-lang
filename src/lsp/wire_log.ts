// The wire log of the language server: every frame in, every message out, every
// disk call, and every flush, as events of an `EventLog`. `WireLog` wraps the
// ports and the frame intake from outside, so the server logic does not change.
// The log folder comes from `initialize`, so events wait in a buffer until that
// frame arrives.

import { isRecord, type Result, sha256Hex } from "../core/mod.ts";
import type { HostFs } from "../host/io.ts";
import { noLog } from "../host/log.ts";
import type { LogData, LspKind } from "../host/log_schema.ts";
import type { EventLog } from "../host/ports.ts";
import type { FrameError, RequestId } from "./jsonrpc.ts";
import { uriToPath } from "./positions.ts";
import { narrowInitializeParams } from "./protocol.ts";
import type { ServerPorts } from "./server.ts";

type Event<K extends LspKind> = (log: EventLog) => LogData[K];

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
  readonly #buffer: Array<{ kind: string; data: Event<LspKind> }> = [];
  readonly #started = new Map<RequestId, { method: string; at: number }>();

  /**
   * `open` makes the log of a workspace folder. It returns a log that records
   * nothing when it cannot open.
   */
  constructor(
    private readonly open: (root: string) => EventLog,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  #emit<K extends LspKind>(kind: K, data: Event<K>): void {
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
    const narrowed = narrowInitializeParams(params);
    const off = narrowed.ok && !narrowed.value.options.log;
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
    return {
      readText: (path) => {
        const result = real.readText(path);
        this.#emit(
          "lsp.fs",
          (log) =>
            result.ok
              ? { op: "readText", path, hash: log.blob(result.value) }
              : { op: "readText", path, error: result.error },
        );
        return result;
      },
      writeText: (path, text) => {
        const result = real.writeText(path, text);
        this.#emit("lsp.fs", () => ({
          op: "writeText",
          path,
          hash: sha256Hex(text),
          ok: result.ok,
        }));
        return result;
      },
      remove: (path) => {
        const result = real.remove(path);
        this.#emit("lsp.fs", () => ({ op: "remove", path, ok: result.ok }));
        return result;
      },
      entryKind: (path) => {
        const result = real.entryKind(path);
        this.#emit(
          "lsp.fs",
          () =>
            result.ok
              ? { op: "entryKind", path, kind: result.value }
              : { op: "entryKind", path, error: result.error },
        );
        return result;
      },
      kind: (path) => {
        const kind = real.kind(path);
        this.#emit("lsp.fs", () => ({ op: "kind", path, kind }));
        return kind;
      },
      list: (path) => {
        const result = real.list(path);
        this.#emit("lsp.fs", () =>
          result.ok
            ? {
              op: "list",
              path,
              entries: result.value.map((e) => ({
                name: e.name,
                isDirectory: e.isDirectory,
              })),
            }
            : { op: "list", path, error: result.error });
        return result;
      },
      absolute: (path) => {
        const absolute = real.absolute(path);
        this.#emit(
          "lsp.fs",
          () => ({ op: "absolute", path, result: absolute }),
        );
        return absolute;
      },
    };
  }
}
