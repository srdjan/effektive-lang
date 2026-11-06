// The command line: `effektive check|build|watch [root] [flags]`.

import type { Result } from "../core/mod.ts";

/** A command that works on a project directory. */
export type ProjectCommand =
  | {
    readonly kind: "check";
    readonly root: string;
    readonly fix: boolean;
    readonly log: boolean;
  }
  | {
    readonly kind: "build";
    readonly root: string;
    readonly tsc: boolean;
    readonly log: boolean;
  }
  | {
    readonly kind: "watch";
    readonly root: string;
    readonly tsc: boolean;
    readonly log: boolean;
  };

export type Command = { readonly kind: "help" } | ProjectCommand;

export const USAGE = [
  "usage: effektive <command> [root] [flags]",
  "",
  "commands:",
  "  check [root] [--fix]                  print diagnostics; --fix first writes the missing fails and with entries",
  "  build [root] [--tsc]                  also write <module>.ts and <module>.ts.map",
  "  watch [root] [--tsc]                  build, then rebuild when a source changes",
  "",
  "flags:",
  "  --no-log                              write no session log to <root>/.effektive/logs/",
  "",
  "root is the project directory with effektive.json. The default is the current directory.",
  "exit codes: 0 no diagnostics, 1 at least one diagnostic, 2 usage or configuration error, 3 internal error",
  "",
].join("\n");

/** The flag that turns the session log off. */
export const NO_LOG_FLAG = "--no-log";

/** The flag that adds the `deno check` stage to `build` and `watch`. */
export const TSC_FLAG = "--tsc";

const FLAGS: Readonly<Record<string, readonly string[]>> = {
  check: ["--fix", NO_LOG_FLAG],
  build: [TSC_FLAG, NO_LOG_FLAG],
  watch: [TSC_FLAG, NO_LOG_FLAG],
};

/**
 * The logged arguments of a session without the flags that a replay cannot
 * keep: the replay supplies its own log and skips the `deno check` stage.
 */
export function replayArguments(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== TSC_FLAG && arg !== NO_LOG_FLAG);
}

/** Parses the arguments. An error value holds the message for the user. */
export function parseArgs(args: readonly string[]): Result<Command, string> {
  const fail = (message: string): Result<Command, string> => ({
    ok: false,
    error: message,
  });
  if (args.length === 0) return fail("missing command");
  const [name, ...rest] = args;
  if (name === "--help" || name === "-h" || name === "help") {
    return { ok: true, value: { kind: "help" } };
  }
  if (name !== "check" && name !== "build" && name !== "watch") {
    return fail(`unknown command \`${name}\``);
  }
  const allowed = FLAGS[name];
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const arg of rest) {
    if (arg.startsWith("-") && arg.length > 1) {
      if (!allowed.includes(arg)) {
        return fail(`unknown flag \`${arg}\` for \`${name}\``);
      }
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    return fail(`too many arguments: \`${positional.join(" ")}\``);
  }
  const root = positional[0] ?? ".";
  const log = !flags.has(NO_LOG_FLAG);
  switch (name) {
    case "check":
      return {
        ok: true,
        value: { kind: "check", root, fix: flags.has("--fix"), log },
      };
    case "build":
      return {
        ok: true,
        value: {
          kind: "build",
          root,
          tsc: flags.has(TSC_FLAG),
          log,
        },
      };
    case "watch":
      return {
        ok: true,
        value: { kind: "watch", root, tsc: flags.has(TSC_FLAG), log },
      };
  }
}
