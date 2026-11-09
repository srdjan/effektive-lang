// The disk program of one project: a `Program` that sees the files of the
// project directory and nothing else. A caller reads the directory, may inspect
// the difference, and then gives the difference to the program. The CLI session
// and the language server each keep their own policy for what happens around
// these two steps.

import {
  type ConfigError,
  diffFiles,
  Program,
  type Result,
  type Revision,
} from "../core/mod.ts";
import type { HostFs } from "./io.ts";
import { readWorkspace } from "./workspace.ts";

/** The files of one read, with their difference from the last update. */
interface DiskRead {
  readonly files: ReadonlyMap<string, string>;
  readonly set: ReadonlyMap<string, string>;
  readonly remove: readonly string[];
}

export class DiskProgram {
  readonly program: Program;
  /** The files that the last update received, whether or not that update succeeded. */
  #known: ReadonlyMap<string, string> = new Map();

  constructor(readonly root: string) {
    this.program = new Program(root);
  }

  get known(): ReadonlyMap<string, string> {
    return this.#known;
  }

  /** Reads the directory and diffs it against `known`. A read error leaves `known` unchanged. */
  read(fs: HostFs): Result<DiskRead, string> {
    const read = readWorkspace(fs, this.root);
    if (!read.ok) return read;
    const { set, remove } = diffFiles(this.#known, read.value);
    return { ok: true, value: { files: read.value, set, remove } };
  }

  /** Gives the program the difference of `read`. `known` becomes the files of `read` even when the update fails. */
  update(read: DiskRead): Result<Revision, ConfigError> {
    this.#known = read.files;
    return this.program.update({ set: read.set, remove: read.remove });
  }
}
