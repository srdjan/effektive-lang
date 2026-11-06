// A session ties one project directory to one program. Each `sync` reads the
// files of the directory, gives the program the difference, and returns the new
// revision. The session keeps the file texts so that the output can show
// one-based lines and columns.

import { TypeScriptOutputs } from "../core/typescript.ts";
import {
  describeConfigError,
  diffFiles,
  joinPath,
  type Revision,
  sha256Hex,
} from "../core/mod.ts";
import {
  type BuildOptions,
  type BuildOutcome,
  buildRevision,
} from "./build.ts";
import { DiskProgram } from "../host/disk_program.ts";
import type { HostIo } from "../host/io.ts";
import { noLog } from "../host/log.ts";
import { emit } from "../host/log_schema.ts";
import type { EventLog } from "../host/ports.ts";
import { readTargetInputs } from "../host/workspace.ts";

export type SyncResult =
  /** No file changed since the last sync. */
  | { readonly tag: "unchanged" }
  /** A file could not be read. */
  | { readonly tag: "read-error"; readonly message: string }
  /** The project file is missing or invalid. */
  | { readonly tag: "config-error"; readonly message: string }
  | { readonly tag: "host-change"; readonly revision: Revision }
  | { readonly tag: "revision"; readonly revision: Revision };

export class Session {
  private readonly disk: DiskProgram;
  private readonly outputs = new TypeScriptOutputs();
  private started = false;
  private targetInputs = new Map<string, string>();
  private latest: Revision | undefined;

  constructor(
    private readonly io: HostIo,
    readonly root: string,
    private readonly trackTargets = false,
    private readonly log: EventLog = noLog,
  ) {
    this.disk = new DiskProgram(root);
  }

  /** The text of a file of the last sync, by its root-relative path. */
  readonly textOf = (path: string): string | undefined =>
    this.disk.known.get(path);

  /**
   * Reads the directory. The first sync always starts a revision. A sync that
   * finds nothing new logs nothing, because the watch loop polls.
   */
  sync(): SyncResult {
    const started = performance.now();
    const result = this.read();
    if (result.tag !== "unchanged" && result.tag !== "read-error") {
      emit(this.log, "cli.phase", {
        name: "sync",
        ms: performance.now() - started,
      });
    }
    return result;
  }

  private logInputs(
    diff: { set: ReadonlyMap<string, string>; remove: readonly string[] },
    target: boolean,
  ): void {
    if (this.log === noLog) return;
    const mark = target ? { target: true as const } : {};
    for (const [path, text] of diff.set) {
      emit(this.log, "cli.input", {
        path,
        hash: this.log.blob(text),
        ...mark,
      });
    }
    for (const path of diff.remove) {
      emit(this.log, "cli.input", { path, removed: true, ...mark });
    }
  }

  private read(): SyncResult {
    const read = this.disk.read(this.io.fs);
    if (!read.ok) return { tag: "read-error", message: read.error };
    const { set, remove } = read.value;
    let hostChanged = false;
    let hostDiff: ReturnType<typeof diffFiles> | undefined;
    if (this.trackTargets) {
      const hosts = readTargetInputs(this.io.fs, this.root);
      if (!hosts.ok) return { tag: "read-error", message: hosts.error };
      hostDiff = diffFiles(this.targetInputs, hosts.value);
      hostChanged = hostDiff.set.size > 0 || hostDiff.remove.length > 0;
      this.targetInputs = new Map(hosts.value);
    }
    this.logInputs({ set, remove }, false);
    if (hostDiff !== undefined) this.logInputs(hostDiff, true);
    if (this.started && set.size === 0 && remove.length === 0) {
      return hostChanged && this.latest !== undefined
        ? { tag: "host-change", revision: this.latest }
        : { tag: "unchanged" };
    }
    this.started = true;
    const updated = this.disk.update(read.value);
    if (!updated.ok) {
      this.latest = undefined;
      return {
        tag: "config-error",
        message: describeConfigError(updated.error),
      };
    }
    this.latest = updated.value;
    return { tag: "revision", revision: updated.value };
  }

  /** Builds one revision. `previous` holds the modules of the last build. */
  async build(
    revision: Revision,
    options: BuildOptions,
    previous: readonly string[],
  ): Promise<BuildOutcome> {
    const started = performance.now();
    const outcome = await buildRevision(
      this.io,
      this.root,
      revision,
      this.textOf,
      options,
      previous,
      this.outputs,
      this.log,
    );
    if (this.log !== noLog) {
      for (const path of outcome.written) {
        const read = this.io.fs.readText(joinPath(this.root, path));
        if (!read.ok) continue;
        emit(this.log, "cli.output", {
          path,
          bytes: new TextEncoder().encode(read.value).length,
          hash: sha256Hex(read.value),
        });
      }
    }
    emit(this.log, "cli.phase", {
      name: "build",
      ms: performance.now() - started,
    });
    emit(this.log, "cli.diagnostics", { items: outcome.items });
    return outcome;
  }
}
