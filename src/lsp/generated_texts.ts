// The generated-text protocol state of the language server: the modules that
// a client subscribed to and the last text that the client received. The
// handlers of `features.ts` are stateless. `server.ts` owns one instance.

import { isModulePath, type Revision } from "../core/mod.ts";
import { stepOutput, type TypeScriptOutputs } from "../core/typescript.ts";
import { GENERATED_CHANGED_METHOD } from "./methods.ts";
import type { ProjectState } from "./projects.ts";
import type {
  GeneratedChangedParams,
  GeneratedTypeScriptResult,
} from "./protocol.ts";

interface GeneratedEntry {
  /** The URI that the client used in its request. */
  uri: string;
  /** The text of the newest emit that succeeded in this server session. */
  lastGood: string | undefined;
  /** What the client has now, through a response or a notification. */
  received: GeneratedTypeScriptResult | undefined;
}

/**
 * The generated TypeScript of the subscribed modules. A request
 * subscribes the module. After each flush that produced a revision, the tracker
 * sends `effektive/generatedChanged` for each subscribed module whose text or
 * stale flag differs from what the client has.
 */
export class GeneratedTexts {
  readonly #entries = new WeakMap<
    ProjectState,
    Map<string, GeneratedEntry>
  >();

  #entriesOf(project: ProjectState): Map<string, GeneratedEntry> {
    let entries = this.#entries.get(project);
    if (entries === undefined) {
      entries = new Map();
      this.#entries.set(project, entries);
    }
    return entries;
  }

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

  /** Answers `effektive/generatedTypeScript` and subscribes the module. */
  request(
    project: ProjectState,
    path: string,
    uri: string,
  ): GeneratedTypeScriptResult | null {
    if (!isModulePath(path)) return null;
    const entries = this.#entriesOf(project);
    let entry = entries.get(path);
    if (entry === undefined) {
      entry = { uri, lastGood: undefined, received: undefined };
      entries.set(path, entry);
    }
    entry.uri = uri;
    const revision = project.lastGood;
    if (revision === undefined) return null;
    const result = this.#current(revision, path, entry, project.outputs);
    if (result !== null) entry.received = result;
    return result;
  }

  /** Called after a flush that produced a revision. */
  afterFlush(
    project: ProjectState,
    revision: Revision,
    notify: (method: string, params: unknown) => void,
  ): void {
    const entries = this.#entries.get(project);
    if (entries === undefined) return;
    for (const [path, entry] of entries) {
      const result = this.#current(revision, path, entry, project.outputs);
      if (result === null) continue;
      const before = entry.received;
      if (
        before !== undefined && before.text === result.text &&
        before.stale === result.stale
      ) continue;
      entry.received = result;
      const params: GeneratedChangedParams = { uri: entry.uri };
      notify(GENERATED_CHANGED_METHOD, params);
    }
  }
}
