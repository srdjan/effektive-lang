// One build of a revision: print the diagnostics, and for `build` and `watch`
// also write the generated files and run `deno check`.

import type { TypeScriptOutputs } from "../core/typescript.ts";
import type { Diagnostic, Revision, SpanTable } from "../core/mod.ts";
import { formatDiagnostics, loggedDiagnostics, type TextOf } from "./format.ts";
import type { HostIo } from "../host/io.ts";
import type { LoggedDiagnostic } from "../host/log_schema.ts";
import type { EventLog } from "../host/ports.ts";
import {
  type ModuleRemoval,
  ownedByRoot,
  runSaveRound,
} from "../host/save_round.ts";
import { runTsc } from "./tsc.ts";

export interface BuildOptions {
  /** Write the generated file and its map for each module without an error whose imported modules are also written. */
  readonly write: boolean;
  /** Run `deno check` over the written files and the host modules. */
  readonly tsc: boolean;
}

export interface BuildOutcome {
  /** One line per diagnostic, for stdout. */
  readonly lines: readonly string[];
  /** Other messages, for stderr. */
  readonly notes: readonly string[];
  /** The number of diagnostics: Effektive and `deno check`. */
  readonly diagnosticCount: number;
  /** True when anything went wrong: a diagnostic, or a failure to emit or to write. */
  readonly failed: boolean;
  /** The root-relative paths of the files that changed on disk. */
  readonly written: readonly string[];
  /** The modules of the revision. Pass them as `previous` to the next build. */
  readonly modules: readonly string[];
  /** The removed outputs of each module that left, for the caller to print. They are not in `notes`. */
  readonly removals: readonly ModuleRemoval[];
  /** The diagnostics in structured form, for the session log. */
  readonly items: readonly LoggedDiagnostic[];
}

/**
 * Prints nothing itself. Returns the lines and notes for the caller. With
 * `write` false, only the diagnostics of the revision count. `previous` holds
 * the modules of the last build. With `write` true, the outputs of each module
 * that left are removed first, and a failed removal is not tried again.
 */
export async function buildRevision(
  io: HostIo,
  root: string,
  revision: Revision,
  textOf: TextOf,
  options: BuildOptions,
  previous: readonly string[],
  outputCache: TypeScriptOutputs,
  log: EventLog,
): Promise<BuildOutcome> {
  const notes: string[] = [];
  const diagnostics: Diagnostic[] = [...revision.diagnostics];
  let failed = false;
  const written: string[] = [];
  const lines: string[] = [];
  let removals: readonly ModuleRemoval[] = [];

  const names = revision.moduleNames();
  const items: LoggedDiagnostic[] = loggedDiagnostics(
    revision.diagnostics,
    textOf,
    "effektive",
  );

  let generated: string[] = [];
  let tables = new Map<string, SpanTable>();
  if (options.write) {
    const round = runSaveRound({
      fs: io.fs,
      root,
      revision,
      outputs: outputCache,
      previous,
      removal: "forget",
      owns: (name) => ownedByRoot(io.fs, root, name),
      write: options.write,
    });
    const outputs = round.outputs;
    removals = round.removals;
    written.push(...outputs.written);
    notes.push(...outputs.notes);
    if (outputs.failed) failed = true;
    generated = outputs.generated;
    tables = outputs.tables;
  }

  lines.push(...formatDiagnostics(diagnostics, textOf));
  let count = diagnostics.length;
  if (diagnostics.length > 0) failed = true;

  if (options.tsc) {
    if (failed) {
      notes.push("deno check skipped: the build has errors");
    } else {
      const outcome = await runTsc(
        io,
        root,
        revision.config,
        generated,
        tables,
        textOf,
        log,
      );
      lines.push(...outcome.lines);
      for (const message of outcome.lines) {
        items.push({ source: "tsc", message });
      }
      notes.push(...outcome.notes);
      count += outcome.lines.length;
      if (outcome.failed) failed = true;
    }
  }
  return {
    lines,
    notes,
    diagnosticCount: count,
    failed,
    written,
    modules: names,
    removals,
    items,
  };
}
