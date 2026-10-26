// The browser side of the playground log (plan LG4). It wraps events in the
// shared envelope, batches them, and posts them to `POST /log` on `serve.ts`.
// Logging never changes the page: an error inside the client is swallowed, and
// after the first failed post (also a 404, when `serve.ts` runs `--no-log` or
// the page is a static file) the client drops every later event.

import { type LogClock, memoryLog } from "../../src/host/log.ts";

/** The most bytes of one request body. The browser keepalive limit is 64 KiB. */
export const MAX_BATCH_BYTES = 60_000;

/** The pause after the last event before the client posts, in milliseconds. */
export const IDLE_FLUSH_MS = 1000;

/** The part of `fetch` that the client uses. */
export type PostFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly keepalive: true;
    readonly body: string;
  },
) => Promise<{ readonly ok: boolean }>;

export interface PageLogOptions extends LogClock {
  readonly fetch: PostFetch;
  /** Calls `run` after `ms` and gives a function that cancels the call. */
  readonly setTimer?: (run: () => void, ms: number) => () => void;
}

export interface PageLog {
  event(kind: string, data: unknown): void;
  /** Posts every pending event now. Use it on `pagehide`. */
  flush(): void;
}

const inert: PageLog = { event: () => {}, flush: () => {} };

const defaultTimer = (run: () => void, ms: number): () => void => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/** Splits JSON strings into array bodies below the limit. Oversized items drop. */
function batches(items: readonly string[]): string[] {
  const encoder = new TextEncoder();
  const bodies: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const bytes = encoder.encode(item).length + 1;
    if (bytes + 2 > MAX_BATCH_BYTES) continue;
    if (size + bytes > MAX_BATCH_BYTES) {
      bodies.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length > 0) bodies.push(`[${current.join(",")}]`);
  return bodies;
}

export function createPageLog(options: PageLogOptions): PageLog {
  let log: ReturnType<typeof memoryLog>;
  try {
    log = memoryLog("playground", options);
  } catch {
    return inert;
  }
  const setTimer = options.setTimer ?? defaultTimer;
  let stopped = false;
  let cancel: (() => void) | undefined;

  const stop = () => {
    stopped = true;
    log.events.length = 0;
  };

  const flush = () => {
    cancel?.();
    cancel = undefined;
    if (stopped) return;
    try {
      const items = log.events.splice(0).map((e) => JSON.stringify(e));
      for (const body of batches(items)) {
        options.fetch("/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body,
        }).then((response) => {
          if (!response.ok) stop();
        }, stop);
      }
    } catch {
      stop();
    }
  };

  return {
    event: (kind, data) => {
      if (stopped) return;
      try {
        log.append(kind, data);
        cancel?.();
        cancel = setTimer(flush, IDLE_FLUSH_MS);
      } catch {
        stop();
      }
    },
    flush,
  };
}
