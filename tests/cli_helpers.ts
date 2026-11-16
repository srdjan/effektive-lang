// @light-fp adapter
// In-memory doubles for the command-line tests: a file system in a map, a
// recorded `deno check` runner, and a scripted watch source.

import type {
  DenoCheckRequest,
  DenoCheckRun,
  DirectoryEntry,
  HostIo,
} from "../src/host/io.ts";
import type { FileFailure } from "../src/host/ports.ts";
import type { ReadError, Result } from "../src/core/frontend.ts";
import { memoryLog } from "../src/host/log.ts";

export interface MemoryIo {
  readonly io: HostIo;
  /** Every file, by the path that the CLI uses: the root joined with the relative path. */
  readonly files: Map<string, string>;
  /** Everything written to stdout and stderr, in order. */
  readonly out: string[];
  readonly err: string[];
  readonly checks: DenoCheckRequest[];
  /** The logs that `io.openLog` opened, in order. */
  readonly logs: ReturnType<typeof memoryLog>[];
  /** Paths whose write fails. */
  readonly unwritable: Set<string>;
  /** Batches that `io.watch` yields. A batch may be a function that changes `files` first. */
  script: (() => readonly string[] | void)[];
  /** The output of the next `deno check`. */
  denoCheckStderr: string;
  denoCheckCode: number;
}

export interface MemoryOptions {
  readonly stderr?: string;
  readonly code?: number;
}

/**
 * A file system in a map, as the CLI needs it. A write or a removal of a path
 * in `unwritable` fails.
 */
export function memoryFs(
  files: Map<string, string>,
  unwritable: ReadonlySet<string> = new Set(),
): HostIo["fs"] {
  const prefixOf = (dir: string): string =>
    dir === "." || dir === "" ? "" : dir.replace(/\/+$/, "") + "/";
  const kind = (path: string): "file" | "directory" | "missing" => {
    if (files.has(path)) return "file";
    const prefix = prefixOf(path);
    for (const key of files.keys()) {
      if (key.startsWith(prefix) && key !== path) return "directory";
    }
    return "missing";
  };
  return {
    readText(path): Result<string, ReadError> {
      const text = files.get(path);
      return text === undefined
        ? { ok: false, error: { tag: "not-found", path } }
        : { ok: true, value: text };
    },
    writeText(path, text): Result<undefined, FileFailure> {
      if (unwritable.has(path)) {
        return { ok: false, error: { message: "permission denied" } };
      }
      files.set(path, text);
      return { ok: true, value: undefined };
    },
    remove(path): Result<undefined, FileFailure> {
      if (unwritable.has(path)) {
        return { ok: false, error: { message: "permission denied" } };
      }
      files.delete(path);
      return { ok: true, value: undefined };
    },
    entryKind: (path) => ({
      ok: true,
      value: kind(path) === "missing" ? "missing" : "other",
    }),
    kind,
    list(path): Result<readonly DirectoryEntry[], FileFailure> {
      const prefix = prefixOf(path);
      const found = new Map<string, boolean>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) found.set(rest, false);
        else found.set(rest.slice(0, slash), true);
      }
      return {
        ok: true,
        value: [...found].map(([name, isDirectory]) => ({ name, isDirectory })),
      };
    },
    absolute: (path) =>
      path === "." ? "/mem" : path.startsWith("/") ? path : `/mem/${path}`,
  };
}

/** Makes an in-memory io. `files` maps full paths (root included) to texts. */
export function memoryIo(
  files: Readonly<Record<string, string>>,
  options: MemoryOptions = {},
): MemoryIo {
  const map = new Map(Object.entries(files));
  const state: Omit<MemoryIo, "io"> = {
    files: map,
    out: [],
    err: [],
    checks: [],
    logs: [],
    unwritable: new Set(),
    script: [],
    denoCheckStderr: options.stderr ?? "",
    denoCheckCode: options.code ?? 0,
  };
  const io: HostIo = {
    stdout: (text) => {
      state.out.push(text);
    },
    stderr: (text) => {
      state.err.push(text);
    },
    fs: memoryFs(map, state.unwritable),
    denoCheck(request): Promise<Result<DenoCheckRun, FileFailure>> {
      state.checks.push(request);
      return Promise.resolve({
        ok: true,
        value: { code: state.denoCheckCode, stderr: state.denoCheckStderr },
      });
    },
    watch(): AsyncIterable<readonly string[]> {
      const steps = state.script;
      return (async function* () {
        for (const step of steps) {
          const batch = step();
          yield batch ?? [];
        }
      })();
    },
    openLog() {
      const log = memoryLog("cli");
      state.logs.push(log);
      return log;
    },
  };
  return Object.assign(state, { io });
}

/** Joins the root to each relative path of a file set. */
export function under(
  root: string,
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    result[root === "." ? path : `${root}/${path}`] = text;
  }
  return result;
}
