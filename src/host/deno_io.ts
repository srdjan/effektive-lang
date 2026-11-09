// The real ports: the Deno file system, `deno check` as a subprocess, and
// `Deno.watchFs`. In the CLI, only this file and the wiring at the end of
// `main.ts` call Deno APIs.

import { errorMessage, type ReadError, type Result } from "../core/mod.ts";
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
    try {
      return { ok: true, value: Deno.readTextFileSync(path) };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return { ok: false, error: { tag: "not-found", path } };
      }
      return {
        ok: false,
        error: { tag: "unreadable", path, message: errorMessage(e) },
      };
    }
  },
  writeText(path: string, text: string): Result<void, FileFailure> {
    return attempt(() => {
      const slash = path.lastIndexOf("/");
      if (slash > 0) Deno.mkdirSync(path.slice(0, slash), { recursive: true });
      Deno.writeTextFileSync(path, text);
    });
  },
  remove(path: string): Result<void, FileFailure> {
    try {
      Deno.removeSync(path);
      return { ok: true, value: undefined };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return { ok: true, value: undefined };
      }
      return { ok: false, error: { message: errorMessage(e) } };
    }
  },
  entryKind(path: string): Result<EntryKind, FileFailure> {
    try {
      return {
        ok: true,
        value: Deno.lstatSync(path).isSymlink ? "symlink" : "other",
      };
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return { ok: true, value: "missing" };
      }
      return { ok: false, error: { message: errorMessage(e) } };
    }
  },
  kind(path: string): "file" | "directory" | "missing" {
    const stat = attempt(() => Deno.statSync(path));
    if (!stat.ok) return "missing";
    return stat.value.isDirectory ? "directory" : "file";
  },
  list(path: string): Result<readonly DirectoryEntry[], FileFailure> {
    try {
      const entries: DirectoryEntry[] = [];
      for (const entry of Deno.readDirSync(path)) {
        // A link to a directory is a directory for the walk.
        let isDirectory = entry.isDirectory;
        if (entry.isSymlink) {
          const target = `${path}/${entry.name}`;
          try {
            isDirectory = Deno.statSync(target).isDirectory;
          } catch (error) {
            if (
              !(error instanceof Deno.errors.NotFound) &&
              !(error instanceof Deno.errors.FilesystemLoop)
            ) {
              return {
                ok: false,
                error: { message: `${target}: ${errorMessage(error)}` },
              };
            }
          }
        }
        entries.push({ name: entry.name, isDirectory });
      }
      return { ok: true, value: entries };
    } catch (e) {
      return { ok: false, error: { message: `${path}: ${errorMessage(e)}` } };
    }
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
  try {
    return { ok: true, value: run() };
  } catch (e) {
    return { ok: false, error: { message: errorMessage(e) } };
  }
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
  let directory: string | undefined;
  try {
    directory = Deno.makeTempDirSync({ prefix: "effektive-tsc-" });
    const config = `${directory}/deno.json`;
    Deno.writeTextFileSync(config, request.config);
    const lock = `${directory}/deno.lock`;
    Deno.writeTextFileSync(lock, request.lock);
    const output = await new Deno.Command("deno", {
      args: ["check", `--lock=${lock}`, "--config", config, ...request.files],
      cwd: request.cwd,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      ok: true,
      value: { code: output.code, stderr: decoder.decode(output.stderr) },
    };
  } catch (e) {
    return { ok: false, error: { message: errorMessage(e) } };
  } finally {
    // When the removal fails, the system removes the temporary directory later.
    const made = directory;
    if (made !== undefined) {
      attempt(() => Deno.removeSync(made, { recursive: true }));
    }
  }
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
  try {
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
  } finally {
    await iterator.return?.();
  }
}

async function* sourceEvents(root: string): AsyncGenerator<readonly string[]> {
  const absolute = denoFs.absolute(root);
  const prefix = absolute.endsWith("/") ? absolute : `${absolute}/`;
  const watcher = Deno.watchFs(absolute, { recursive: true });
  const iterator = watcher[Symbol.asyncIterator]();
  let pending = iterator.next();
  try {
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
  } finally {
    watcher.close();
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
