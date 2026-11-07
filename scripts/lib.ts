// Shared mechanics of the task scripts: the repository root, one process
// runner, a temporary directory helper, the fixture JSON writer, the revision
// export, and the base arguments of the fast test suite.
//
// `scripts/behavior_corpus.ts` must not import this module. The comparison
// copies that file into old source trees, where this module does not exist.

import { dirname, fromFileUrl, resolve } from "@std/path";
import type { Result } from "../src/core/mod.ts";

/** The repository root, without a trailing separator. */
export const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

/** The permission flags of the fast suite. Flags of a caller follow them. */
export const FAST_SUITE_PERMISSIONS: readonly string[] = [
  "--allow-read",
  "--parallel",
];

/** The test selection of the fast suite: no slow test, the `tests/` directory. */
export const FAST_SUITE_SELECTION: readonly string[] = [
  "--ignore=**/*_slow_test.ts",
  "tests/",
];

/**
 * The arguments of the fast suite after `deno test`. The `flags` of the caller
 * go between the permissions and the selection.
 */
export function fastSuiteArgs(flags: readonly string[] = []): string[] {
  return [...FAST_SUITE_PERMISSIONS, ...flags, ...FAST_SUITE_SELECTION];
}

/** How a child process stream is connected. */
export type Stdio = "piped" | "inherit" | "null";

/** The options of one process. Each default is the default of `Deno.Command`. */
export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  /** Default `"piped"`. */
  readonly stdout?: Stdio;
  /** Default `"piped"`. */
  readonly stderr?: Stdio;
  /** Kill the process after this many milliseconds. No limit by default. */
  readonly timeoutMs?: number;
  /** The signal of the timeout kill. Default `"SIGTERM"`. */
  readonly killSignal?: Deno.Signal;
}

/** The outcome of one process. A stream that was not piped is the empty text. */
export interface RunResult {
  readonly success: boolean;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the timeout killed the process. */
  readonly timedOut: boolean;
}

/**
 * Runs one command to its end. A command that cannot start throws, as
 * `Deno.Command` does. Without a timeout the call is `Deno.Command#output`.
 */
export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const commandOptions: Deno.CommandOptions = {
    args: [...args],
    stdout: options.stdout ?? "piped",
    stderr: options.stderr ?? "piped",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  };
  const decoder = new TextDecoder();
  let timedOut = false;
  let output: Deno.CommandOutput;
  if (options.timeoutMs === undefined) {
    output = await new Deno.Command(command, commandOptions).output();
  } else {
    const child = new Deno.Command(command, commandOptions).spawn();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill(options.killSignal ?? "SIGTERM");
      } catch {
        // The process already ended.
      }
    }, options.timeoutMs);
    output = await child.output();
    clearTimeout(timer);
  }
  return {
    success: output.success,
    code: output.code,
    stdout: options.stdout === undefined || options.stdout === "piped"
      ? decoder.decode(output.stdout)
      : "",
    stderr: options.stderr === undefined || options.stderr === "piped"
      ? decoder.decode(output.stderr)
      : "",
    timedOut,
  };
}

/**
 * How `runChecked` words a failure: the trimmed `stderr` after the first
 * argument, or the last 40 lines of `stderr` and `stdout` after all arguments.
 */
export type FailureStyle = "stderr" | "tail";

function failureText(
  command: string,
  args: readonly string[],
  result: RunResult,
  style: FailureStyle,
): string {
  if (style === "stderr") {
    return `${command} ${args[0]} failed: ${result.stderr.trim()}`;
  }
  const text = (result.stderr + result.stdout).split("\n").slice(-40)
    .join("\n");
  return `${command} ${args.join(" ")} failed:\n${text}`;
}

/** Runs one command with piped streams. Its value is `stdout` when it exits 0. */
export async function runChecked(
  command: string,
  args: readonly string[],
  style: FailureStyle,
  options: Omit<RunOptions, "stdout" | "stderr"> = {},
): Promise<Result<string, string>> {
  const result = await runProcess(command, args, options);
  if (result.success) return { ok: true, value: result.stdout };
  return { ok: false, error: failureText(command, args, result, style) };
}

/**
 * Creates a temporary directory, runs `body` with it, and removes the
 * directory when `body` ends or throws. With `tolerateRemoveFailure` a failed
 * removal is ignored, because the system removes the directory later.
 */
export async function withTempDir<T>(
  prefix: string,
  body: (directory: string) => Promise<T>,
  options: { readonly tolerateRemoveFailure?: boolean } = {},
): Promise<T> {
  const directory = await Deno.makeTempDir({ prefix });
  try {
    return await body(directory);
  } finally {
    await removeDirectory(directory, options.tolerateRemoveFailure === true);
  }
}

async function removeDirectory(
  directory: string,
  tolerateFailure: boolean,
): Promise<void> {
  try {
    await Deno.remove(directory, { recursive: true });
  } catch (cause) {
    if (!tolerateFailure) throw cause;
  }
}

/** The text of a fixture JSON file: two-space indent and a final newline. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Where `exportRevision` writes. */
export interface RevisionExport {
  /** The tar file that `git archive` writes. The caller removes it. */
  readonly archive: string;
  /** Each directory receives the whole tree. Missing directories are made. */
  readonly destinations: readonly string[];
  /** Extra `git archive` flags before the output flag. */
  readonly archiveFlags?: readonly string[];
  readonly failure: FailureStyle;
}

/**
 * Exports the committed tree of `revision` into each destination with
 * `git archive` and `tar`, run in the repository root.
 */
export async function exportRevision(
  revision: string,
  target: RevisionExport,
): Promise<Result<void, string>> {
  const made = await runChecked(
    "git",
    [
      "archive",
      ...(target.archiveFlags ?? []),
      "-o",
      target.archive,
      revision,
    ],
    target.failure,
    { cwd: ROOT },
  );
  if (!made.ok) return made;
  const extracted = await Promise.all(target.destinations.map(async (dir) => {
    await Deno.mkdir(dir, { recursive: true });
    return await runChecked(
      "tar",
      ["-xf", target.archive, "-C", dir],
      target.failure,
      { cwd: ROOT },
    );
  }));
  for (const result of extracted) {
    if (!result.ok) return result;
  }
  return { ok: true, value: undefined };
}
