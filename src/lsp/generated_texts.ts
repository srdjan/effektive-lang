// The generated-text protocol state of the language server: the modules that
// a client subscribed to and the last text that the client received. A
// subscription belongs to the URI that the client sent, not to a project. The
// subscription survives a move of the module to another project, and it
// exists before the module has a project. The handlers of `features.ts` are
// stateless. `server.ts` owns one instance.

import { isModulePath, type Revision } from "../core/mod.ts";
import { stepOutput, type TypeScriptOutputs } from "../core/typescript.ts";
import { GENERATED_CHANGED_METHOD } from "./methods.ts";
import { uriToPath } from "./positions.ts";
import type { ProjectState } from "./projects.ts";
import type {
  GeneratedChangedParams,
  GeneratedTypeScriptResult,
} from "./protocol.ts";

/** The project of a URI and the path of the module in that project. */
export interface LocatedModule {
  readonly project: ProjectState;
  readonly path: string;
}

interface GeneratedEntry {
  /** The text of the newest emit that succeeded in this server session. */
  lastGood: string | undefined;
  /** What the client has now, through a response or a notification. */
  received: GeneratedTypeScriptResult | undefined;
}

/**
 * The generated TypeScript of the subscribed modules. A request subscribes the
 * URI of a module, also when the module has no project yet. After each flush
 * that produced a revision, the tracker sends `effektive/generatedChanged` for
 * each subscribed URI of that project whose text or stale flag differs from
 * what the client has. The `locate` function finds the current project of a URI.
 */
export class GeneratedTexts {
  readonly #entries = new Map<string, GeneratedEntry>();

  constructor(
    private readonly locate: (uri: string) => LocatedModule | undefined,
  ) {}

  #current(
    revision: Revision,
    path: string,
    entry: GeneratedEntry,
    outputs: TypeScriptOutputs,
  ): GeneratedTypeScriptResult | null {
    const name = revision.moduleInfoAt(path)?.name;
    const step = stepOutput(
      entry.lastGood,
      name === undefined ? undefined : outputs.emitted(revision, name),
    );
    entry.lastGood = step.lastGood;
    return step.output;
  }

  /**
   * Answers `effektive/generatedTypeScript` and subscribes the URI of a
   * module. `found` is the project of the URI, or undefined when it has none.
   */
  request(
    uri: string,
    found: LocatedModule | undefined,
  ): GeneratedTypeScriptResult | null {
    const path = found?.path ?? uriToPath(uri);
    if (path === undefined || !isModulePath(path)) return null;
    let entry = this.#entries.get(uri);
    if (entry === undefined) {
      entry = { lastGood: undefined, received: undefined };
      this.#entries.set(uri, entry);
    }
    const revision = found?.project.lastGood;
    if (found === undefined || revision === undefined) return null;
    const result = this.#current(
      revision,
      found.path,
      entry,
      found.project.outputs,
    );
    if (result !== null) entry.received = result;
    return result;
  }

  /** Called after a flush that produced a revision. */
  afterFlush(
    project: ProjectState,
    revision: Revision,
    notify: (method: string, params: unknown) => void,
  ): void {
    for (const [uri, entry] of this.#entries) {
      const found = this.locate(uri);
      if (found === undefined || found.project !== project) continue;
      const result = this.#current(
        revision,
        found.path,
        entry,
        project.outputs,
      );
      if (result === null) continue;
      const before = entry.received;
      if (
        before !== undefined && before.text === result.text &&
        before.stale === result.stale
      ) continue;
      entry.received = result;
      const params: GeneratedChangedParams = { uri };
      notify(GENERATED_CHANGED_METHOD, params);
    }
  }
}
