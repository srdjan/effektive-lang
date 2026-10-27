// The event log: one JSON object per line, plus content-addressed text blobs.
// Logging never breaks the program: after a write failure the file log turns
// itself off. The core never imports this file.

import { isRecord, type Result, sha256Hex } from "../core/mod.ts";
import config from "../../deno.json" with { type: "json" };
import type { FileFailure } from "./io.ts";

export type Surface = "cli" | "lsp" | "playground";

/** One line of a session file. */
export interface Envelope {
  readonly v: 1;
  /** Wall time, ISO 8601. */
  readonly t: string;
  /** Monotonic milliseconds since the session start. */
  readonly ms: number;
  readonly surface: Surface;
  readonly session: string;
  /** Starts at 0 and grows by 1 for each event. */
  readonly seq: number;
  readonly build: string;
  readonly kind: string;
  readonly data: unknown;
}

/** The release version from `deno.json`. */
export const BUILD: string = config.version;

export interface EventLog {
  append(kind: string, data: unknown): void;
  /** Stores the text under its SHA-256 hex hash, and returns the hash. */
  blob(text: string): string;
}

/** A log that records nothing. */
export const noLog: EventLog = {
  append: () => {},
  blob: sha256Hex,
};

/** The sources of time, identity, and version. Tests inject all of them. */
export interface LogClock {
  now?: () => Date;
  /** Monotonic milliseconds. */
  clock?: () => number;
  session?: string;
  build?: string;
}

function envelopes(
  surface: Surface,
  options: LogClock,
): { session: string; next(kind: string, data: unknown): Envelope } {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const session = options.session ?? crypto.randomUUID();
  const build = options.build ?? BUILD;
  const start = clock();
  let seq = 0;
  return {
    session,
    next: (kind, data) => ({
      v: 1,
      t: now().toISOString(),
      ms: Math.round((clock() - start) * 10) / 10,
      surface,
      session,
      seq: seq++,
      build,
      kind,
      data,
    }),
  };
}

/** A log that keeps its events and blobs in memory, for tests. */
export function memoryLog(
  surface: Surface,
  options: LogClock = {},
): EventLog & { events: Envelope[]; blobs: Map<string, string> } {
  const factory = envelopes(surface, options);
  const events: Envelope[] = [];
  const blobs = new Map<string, string>();
  return {
    events,
    blobs,
    append: (kind, data) => {
      events.push(factory.next(kind, data));
    },
    blob: (text) => {
      const hash = sha256Hex(text);
      blobs.set(hash, text);
      return hash;
    },
  };
}

/** A file in a directory listing. */
export interface LogEntry {
  readonly name: string;
  /** Modification time, in milliseconds since the epoch. */
  readonly mtimeMs: number;
}

/** The small file system that the file log needs. */
export interface LogFs {
  /** Creates the directory and its parents. */
  mkdir(path: string): Result<void, FileFailure>;
  readText(path: string): Result<string, FileFailure>;
  /** Writes the whole file. */
  writeText(path: string, text: string): Result<void, FileFailure>;
  /** Appends to the file, and creates it when missing. */
  appendText(path: string, text: string): Result<void, FileFailure>;
  exists(path: string): boolean;
  /** The files of a directory, not its sub-directories. */
  list(path: string): Result<readonly LogEntry[], FileFailure>;
  /** Sets the modification time of a file to now. */
  touch(path: string): Result<void, FileFailure>;
  remove(path: string): Result<void, FileFailure>;
}

export interface FileLogOptions extends LogClock {
  readonly fs: LogFs;
  readonly projectDir: string;
  readonly surface: Surface;
}

const ROTATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Prepares `<projectDir>/.effektive/logs/`: creates the folders, writes the
 * self-ignoring `.gitignore`, and deletes session files older than seven days.
 * Old blobs stay while a retained session references them. Unreadable or
 * damaged sessions prevent blob cleanup. The result is the logs folder.
 * It fails only when the folders or the `.gitignore` cannot be written.
 */
export function prepareLogFolder(
  fs: LogFs,
  projectDir: string,
  now: Date,
): Result<string, FileFailure> {
  const root = `${projectDir}/.effektive`;
  const logs = `${root}/logs`;
  const blobs = `${logs}/blobs`;
  const made = fs.mkdir(blobs);
  if (!made.ok) return made;
  const ignore = `${root}/.gitignore`;
  if (!fs.exists(ignore)) {
    const written = fs.writeText(ignore, "*\n");
    if (!written.ok) return written;
  }
  const cutoff = now.getTime() - ROTATION_MS;
  const sessions = fs.list(logs);
  if (!sessions.ok) return { ok: true, value: logs };
  const retained: string[] = [];
  for (const entry of sessions.value) {
    if (!entry.name.endsWith(".jsonl")) continue;
    const path = `${logs}/${entry.name}`;
    if (entry.mtimeMs < cutoff && fs.remove(path).ok) continue;
    retained.push(path);
  }
  const listed = fs.list(blobs);
  if (!listed.ok) return { ok: true, value: logs };
  const old = listed.value.filter((entry) =>
    entry.name.endsWith(".txt") && entry.mtimeMs < cutoff
  );
  if (old.length === 0) return { ok: true, value: logs };
  const hashes = new Set<string>();
  for (const path of retained) {
    const read = fs.readText(path);
    if (!read.ok) return { ok: true, value: logs };
    for (const line of read.value.split("\n")) {
      if (line.trim() === "") continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return { ok: true, value: logs };
      }
      if (isRecord(event) && isRecord(event.data)) {
        if (typeof event.data.hash === "string") hashes.add(event.data.hash);
      }
    }
  }
  for (const entry of old) {
    if (!hashes.has(entry.name.slice(0, -4))) {
      fs.remove(`${blobs}/${entry.name}`);
    }
  }
  return { ok: true, value: logs };
}

/**
 * Opens the log of one session in `<projectDir>/.effektive/logs/`. It fails
 * only when the folders cannot be created.
 */
export function openFileLog(
  options: FileLogOptions,
): Result<EventLog, FileFailure> {
  const { fs, projectDir, surface } = options;
  const now = options.now ?? (() => new Date());
  const prepared = prepareLogFolder(fs, projectDir, now());
  if (!prepared.ok) return prepared;
  const logs = prepared.value;
  const blobs = `${logs}/blobs`;
  const factory = envelopes(surface, { ...options, now });
  const day = now().toISOString().slice(0, 10).replaceAll("-", "");
  const file = `${logs}/${surface}-${day}-${factory.session}.jsonl`;
  let enabled = true;
  const guard = (run: () => Result<void, FileFailure>) => {
    try {
      if (!run().ok) enabled = false;
    } catch {
      // A throwing file system counts as a write failure.
      enabled = false;
    }
  };
  return {
    ok: true,
    value: {
      append: (kind, data) => {
        if (!enabled) return;
        guard(() =>
          fs.appendText(file, JSON.stringify(factory.next(kind, data)) + "\n")
        );
      },
      blob: (text) => {
        const hash = sha256Hex(text);
        if (!enabled) return hash;
        const path = `${blobs}/${hash}.txt`;
        guard(() =>
          fs.exists(path) ? fs.touch(path) : fs.writeText(path, text)
        );
        return hash;
      },
    },
  };
}
