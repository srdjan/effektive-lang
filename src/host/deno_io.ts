// The real ports: the Deno file system, `deno check` as a subprocess, and
// `Deno.watchFs`. In the CLI, only this file and the wiring at the end of
// `main.ts` call Deno APIs.

import {
  caught,
  errorMessage,
  type ReadError,
  type Result,
} from "../core/mod.ts";
import type {
  DenoCheckRequest,
  DenoCheckRun,
  DirectoryEntry,
  EntryKind,
  HostFs,
  HostIo,
} from "./io.ts";
import { type LogFs, noLog, openFileLog } from "./log.ts";
import type { FileFailure } from "./ports.ts";
import { isTargetPath, isWorkspaceInput } from "./workspace.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The real file system. The language server uses the same object. */
export const denoFs: HostFs = {
  readText(path: string): Result<string, ReadError> {
    const read = caught(() => Deno.readTextFileSync(path));
    if (read.ok) return read;
    return {
      ok: false,
      error: read.error instanceof Deno.errors.NotFound
        ? { tag: "not-found", path }
        : { tag: "unreadable", path, message: errorMessage(read.error) },
    };
  },
  writeText(path: string, text: string): Result<void, FileFailure> {
    return attempt(() => {
      const slash = path.lastIndexOf("/");
      if (slash > 0) Deno.mkdirSync(path.slice(0, slash), { recursive: true });
      Deno.writeTextFileSync(path, text);
    });
  },
  remove(path: string): Result<void, FileFailure> {
    const removed = caught(() => Deno.removeSync(path));
    if (removed.ok || removed.error instanceof Deno.errors.NotFound) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: { message: errorMessage(removed.error) } };
  },
  entryKind(path: string): Result<EntryKind, FileFailure> {
    const stat = caught(() => Deno.lstatSync(path));
    if (stat.ok) {
      return { ok: true, value: stat.value.isSymlink ? "symlink" : "other" };
    }
    if (stat.error instanceof Deno.errors.NotFound) {
      return { ok: true, value: "missing" };
    }
    return { ok: false, error: { message: errorMessage(stat.error) } };
  },
  kind(path: string): "file" | "directory" | "missing" {
    const stat = caught(() => Deno.statSync(path));
    if (!stat.ok) return "missing";
    return stat.value.isDirectory ? "directory" : "file";
  },
  list(path: string): Result<readonly DirectoryEntry[], FileFailure> {
    const listed = caught(() => [...Deno.readDirSync(path)]);
    if (!listed.ok) {
      return {
        ok: false,
        error: { message: `${path}: ${errorMessage(listed.error)}` },
      };
    }
    const entries: DirectoryEntry[] = [];
    for (const entry of listed.value) {
      // A link to a directory is a directory for the walk. A link whose
      // target is missing or loops is not.
      let isDirectory = entry.isDirectory;
      if (entry.isSymlink) {
        const target = `${path}/${entry.name}`;
        const stat = caught(() => Deno.statSync(target));
        if (stat.ok) {
          isDirectory = stat.value.isDirectory;
        } else if (
          !(stat.error instanceof Deno.errors.NotFound) &&
          !(stat.error instanceof Deno.errors.FilesystemLoop)
        ) {
          return {
            ok: false,
            error: { message: `${target}: ${errorMessage(stat.error)}` },
          };
        }
      }
      entries.push({ name: entry.name, isDirectory });
    }
    return { ok: true, value: entries };
  },
  absolute(path: string): string {
    return Deno.realPathSync(path);
  },
};

export const denoLogFs: LogFs = {
  mkdir: (path) => attempt(() => Deno.mkdirSync(path, { recursive: true })),
  readText: (path) => attempt(() => Deno.readTextFileSync(path)),
  writeText: (path, text) => attempt(() => Deno.writeTextFileSync(path, text)),
  appendText: (path, text) =>
    attempt(() => Deno.writeTextFileSync(path, text, { append: true })),
  exists: (path) => denoFs.kind(path) !== "missing",
  list: (path) =>
    attempt(() => {
      const entries: { name: string; mtimeMs: number }[] = [];
      for (const entry of Deno.readDirSync(path)) {
        if (!entry.isFile) continue;
        const mtime = Deno.statSync(`${path}/${entry.name}`).mtime;
        entries.push({ name: entry.name, mtimeMs: mtime?.getTime() ?? 0 });
      }
      return entries;
    }),
  touch: (path) =>
    attempt(() => {
      const now = new Date();
      Deno.utimeSync(path, now, now);
    }),
  remove: (path) => denoFs.remove(path),
};

function attempt<T>(run: () => T): Result<T, FileFailure> {
  const done = caught(run);
  return done.ok
    ? done
    : { ok: false, error: { message: errorMessage(done.error) } };
}

/**
 * Runs `deno check` in the project directory. The generated configuration goes
 * to a temporary directory that the call removes, so the project directory
 * gets no new file. The seeded lockfile goes to the same directory, so
 * `deno check` writes any new lock entry there and not in the project.
 */
async function denoCheck(
  request: DenoCheckRequest,
): Promise<Result<DenoCheckRun, FileFailure>> {
  const made = attempt(() =>
    Deno.makeTempDirSync({ prefix: "effektive-tsc-" })
  );
  if (!made.ok) return made;
  const config = `${made.value}/deno.json`;
  const lock = `${made.value}/deno.lock`;
  // `Deno.Command` throws at once when it cannot start the process, and its
  // `output` promise rejects on a later failure.
  const started = attempt(() => {
    Deno.writeTextFileSync(config, request.config);
    Deno.writeTextFileSync(lock, request.lock);
    return new Deno.Command("deno", {
      args: ["check", `--lock=${lock}`, "--config", config, ...request.files],
      cwd: request.cwd,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
  });
  const run = started.ok
    ? await started.value.then(
      (output): Result<DenoCheckRun, FileFailure> => ({
        ok: true,
        value: { code: output.code, stderr: decoder.decode(output.stderr) },
      }),
      (e: unknown): Result<DenoCheckRun, FileFailure> => ({
        ok: false,
        error: { message: errorMessage(e) },
      }),
    )
    : started;
  // When the removal fails, the system removes the temporary directory later.
  attempt(() => Deno.removeSync(made.value, { recursive: true }));
  return run;
}

/** The quiet time after the last file event before a rebuild starts. */
const WATCH_DEBOUNCE_MS = 100;
/** A fallback rescan when the platform does not deliver file system events. */
const WATCH_POLL_MS = 1_000;

/**
 * Debouncing of file system events. An editor save often gives several events
 * in a row. This joins the events that arrive within `delayMs` of the previous
 * one into one batch of sorted, unique paths.
 */
export async function* debounceBatches(
  source: AsyncIterable<readonly string[]>,
  delayMs: number,
): AsyncGenerator<readonly string[]> {
  const iterator = source[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<readonly string[]>> | undefined;
  while (true) {
    pending ??= iterator.next();
    const first = await pending;
    pending = undefined;
    if (first.done) return;
    const batch = new Set<string>(first.value);
    let ended = false;
    while (true) {
      pending = iterator.next();
      let id: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<"quiet">((resolve) => {
        id = setTimeout(() => resolve("quiet"), delayMs);
      });
      const raced = await Promise.race([pending, quiet]);
      clearTimeout(id);
      if (raced === "quiet") break;
      pending = undefined;
      if (raced.done) {
        ended = true;
        break;
      }
      for (const path of raced.value) batch.add(path);
    }
    yield [...batch].sort();
    if (ended) return;
  }
}

async function* sourceEvents(root: string): AsyncGenerator<readonly string[]> {
  const absolute = denoFs.absolute(root);
  const prefix = absolute.endsWith("/") ? absolute : `${absolute}/`;
  const iterator = Deno.watchFs(absolute, { recursive: true })
    [Symbol.asyncIterator]();
  let pending = iterator.next();
  while (true) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = new Promise<"poll">((resolve) => {
      timeout = setTimeout(() => resolve("poll"), WATCH_POLL_MS);
    });
    const result = await Promise.race([pending, poll]);
    clearTimeout(timeout);
    if (result === "poll") {
      // The watch loop rescans, but an unchanged project prints nothing.
      yield [];
      continue;
    }
    if (result.done) return;
    pending = iterator.next();
    const relative = result.value.paths
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((path) => isWorkspaceInput(path) || isTargetPath(path));
    if (relative.length > 0) yield relative;
  }
}

export function denoIo(): HostIo {
  return {
    stdout: (text) => {
      Deno.stdout.writeSync(encoder.encode(text));
    },
    stderr: (text) => {
      Deno.stderr.writeSync(encoder.encode(text));
    },
    fs: denoFs,
    denoCheck,
    watch: (root) => debounceBatches(sourceEvents(root), WATCH_DEBOUNCE_MS),
    openLog: (root, surface) => {
      const opened = openFileLog({
        fs: denoLogFs,
        projectDir: root,
        surface,
      });
      return opened.ok ? opened.value : noLog;
    },
  };
}
