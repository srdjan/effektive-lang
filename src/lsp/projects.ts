// Projects and the open-document overlay. A project is a directory with
// `effektive.json`. The set keeps one `Program` per project. A project lives
// until it loses its `effektive.json` and its last open document. The text that
// the program sees is the disk text of each file with the open documents laid
// over it. A flush gives the program the difference and then publishes
// diagnostics.
//
// Nothing here throws on purpose. The server wraps each handler, and that
// wrapper is the only exception boundary.

import { TypeScriptOutputs } from "../core/typescript.ts";
import {
  basename,
  dirname,
  isAbsolute,
  join as joinNativePath,
  relative,
  SEPARATOR,
} from "@std/path";
import type { HostFs } from "../host/io.ts";
import { DiskProgram } from "../host/disk_program.ts";
import type { HeldReason } from "../host/outputs.ts";
import { ownedByRoot, runSaveRound } from "../host/save_round.ts";
import { isSourcePath, readWorkspace } from "../host/workspace.ts";
import {
  compareText,
  CONFIG_FILE,
  type ConfigError,
  describeConfigError,
  type Diagnostic as CoreDiagnostic,
  diffFiles,
  joinPath,
  Program,
  type Result,
  type Revision,
  type RevisionDelta,
  revisionDelta,
} from "../core/mod.ts";
import {
  applyContentChanges,
  pathToUri,
  rangeConverter,
  uriToPath,
} from "./positions.ts";
import type {
  Diagnostic,
  DidChangeParams,
  DidOpenParams,
  FileEvent,
  PublishDiagnosticsParams,
} from "./protocol.ts";

/** The `type` of a `window/logMessage`. */
export type LogType = 1 | 2 | 3 | 4;

/** One open document of a project. */
interface OpenDocument {
  readonly uri: string;
  version: number;
  text: string;
}

interface CompletedProject {
  readonly revision: Revision;
  readonly delta: RevisionDelta;
}

type ProjectPhase =
  | { readonly kind: "new" }
  | { readonly kind: "ready"; readonly last: CompletedProject }
  | {
    readonly kind: "failed";
    readonly error: ConfigError;
    readonly last: CompletedProject | undefined;
  };

/** The disk state of one project. It sees disk texts only. `saveRound` owns it. */
interface DiskSession {
  readonly disk: DiskProgram;
  readonly outputs: TypeScriptOutputs;
  /** The module names of the last successful round, plus names whose removal failed. */
  modules: readonly string[];
  /** The reason last logged for each held module, so that a repeat stays silent. */
  readonly heldReasons: Map<string, string>;
}

/** The state of one project. The set owns it. Other code reads it. */
export class ProjectState {
  /** The disk texts, by root-relative path. */
  disk: ReadonlyMap<string, string> = new Map();
  /** The open documents, by root-relative path. */
  readonly open = new Map<string, OpenDocument>();
  /** The texts that the program has now, by root-relative path. */
  current: ReadonlyMap<string, string> = new Map();
  /** True when the wanted texts may differ from `current`. */
  dirty = false;
  private phase: ProjectPhase = { kind: "new" };
  /** The serialized list last published per path. A path never published counts as `[]`. */
  readonly published = new Map<string, string>();
  /** The version of each open document at its last publish. */
  readonly publishedVersions = new Map<string, number>();

  readonly program: Program;
  readonly outputs = new TypeScriptOutputs();

  /** The disk state of the save round. Created on the first round, and only when `writeOnSave` is true. */
  diskSession: DiskSession | undefined;

  constructor(readonly root: string) {
    this.program = new Program(root);
  }

  private get last(): CompletedProject | undefined {
    return this.phase.kind === "new" ? undefined : this.phase.last;
  }

  /** True after the first `Program.update`, including a failed update. */
  get started(): boolean {
    return this.phase.kind !== "new";
  }

  get lastGood(): Revision | undefined {
    return this.last?.revision;
  }

  get lastDelta(): RevisionDelta | undefined {
    return this.last?.delta;
  }

  get configError(): ConfigError | undefined {
    return this.phase.kind === "failed" ? this.phase.error : undefined;
  }

  /** Publishes a complete update state, retaining the last good pair on failure. */
  recordUpdate(updated: Result<Revision, ConfigError>): void {
    const previous = this.last;
    this.phase = updated.ok
      ? {
        kind: "ready",
        last: {
          revision: updated.value,
          delta: revisionDelta(previous?.revision, updated.value),
        },
      }
      : { kind: "failed", error: updated.error, last: previous };
  }

  /** The disk texts with the open documents laid over them. */
  wanted(): Map<string, string> {
    const texts = new Map(this.disk);
    for (const [path, document] of this.open) texts.set(path, document.text);
    return texts;
  }
}

/** A document that belongs to a project. */
interface DocumentRef {
  readonly project: ProjectState;
  /** The root-relative path. */
  readonly path: string;
}

/** The ports of the set. */
interface ProjectSetPorts {
  readonly fs: HostFs;
  /** Sends `textDocument/publishDiagnostics`. */
  publish(params: PublishDiagnosticsParams): void;
  /** Sends `window/logMessage`. */
  log(type: LogType, message: string): void;
  /** Writes a line to stderr. The set adds the line end. */
  stderr(text: string): void;
  /** The `writeOnSave` option of the client. It does not change after `initialize`. */
  writeOnSave(): boolean;
  /** Called after each flush whose `Program.update` gave a revision, after the diagnostics went out. */
  flushed(project: ProjectState, revision: Revision): void;
}

function sameTexts(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [path, text] of a) if (b.get(path) !== text) return false;
  return true;
}

/** The root-relative path of the source file `absolute` under `root`, or undefined. */
function sourcePathUnder(root: string, absolute: string): string | undefined {
  const path = relative(root, absolute);
  if (isAbsolute(path)) return undefined;
  const corePath = SEPARATOR === "\\" ? path.replaceAll("\\", "/") : path;
  return isSourcePath(corePath) ? corePath : undefined;
}

/**
 * Converts the diagnostics of a revision, grouped by root-relative path. Each
 * text is the one that the revision used, else the wanted text.
 */
function groupDiagnostics(
  diagnostics: readonly CoreDiagnostic[],
  root: string,
  textOf: (path: string) => string,
): Map<string, Diagnostic[]> {
  const rangeOf = rangeConverter(textOf);
  const groups = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const related = (d.related ?? []).flatMap((item) => {
      const uri = pathToUri(joinPath(root, item.span.source));
      return uri === undefined ? [] : [{
        location: { uri, range: rangeOf(item.span) },
        message: item.message,
      }];
    });
    const converted: Diagnostic = {
      range: rangeOf(d.span),
      severity: 1,
      code: d.code,
      source: "effektive",
      message: d.message,
      ...(related.length > 0 ? { relatedInformation: related } : {}),
    };
    const list = groups.get(d.span.source);
    if (list === undefined) groups.set(d.span.source, [converted]);
    else list.push(converted);
  }
  return groups;
}

/** Why a module is not written, for the log. */
function heldMessage(name: string, reason: HeldReason): string {
  switch (reason.tag) {
    case "diagnostics":
      return `${name} is not written: it has ${reason.count} diagnostics`;
    case "import":
      return `${name} is not written: it imports ${reason.target}, which is not written`;
    case "lowering":
      return `${name} is not written: it cannot be lowered`;
  }
}

export class ProjectSet {
  readonly #projects = new Map<string, ProjectState>();
  /** Open documents with a project, by URI. */
  readonly #documents = new Map<string, DocumentRef>();
  /** Open documents without a project, by URI, with their unsaved text. */
  readonly #orphans = new Map<string, OpenDocument>();
  /** URIs whose missing project the set already logged. */
  readonly #logged = new Set<string>();

  constructor(private readonly ports: ProjectSetPorts) {}

  /** The projects in the order they opened. */
  projects(): readonly ProjectState[] {
    return [...this.#projects.values()];
  }

  /** The projects that wait for a flush. */
  dirtyProjects(): readonly ProjectState[] {
    return this.projects().filter((p) => p.dirty);
  }

  /**
   * The project and path of a document, without a flush. An open document is
   * found by URI. Any other `file:` URI is found by the roots of the known
   * projects (the longest root wins).
   */
  lookup(uri: string): DocumentRef | undefined {
    const open = this.#documents.get(uri);
    if (open !== undefined) return open;
    const absolute = uriToPath(uri);
    if (absolute === undefined) return undefined;
    let best: DocumentRef | undefined;
    for (const project of this.#projects.values()) {
      const path = sourcePathUnder(project.root, absolute);
      if (path === undefined) continue;
      if (
        best === undefined || project.root.length > best.project.root.length
      ) {
        best = { project, path };
      }
    }
    return best;
  }

  /**
   * The helper for every request handler: finds the document's project and
   * flushes it first when it is dirty, so that the request never reads an old
   * revision. Returns undefined when the document has no project.
   */
  forRequest(uri: string): DocumentRef | undefined {
    const found = this.lookup(uri);
    if (found !== undefined) this.flush(found.project);
    return found;
  }

  /** Flushes every dirty project, in the order they opened. */
  flushDirty(): void {
    for (const project of this.dirtyProjects()) this.flush(project);
  }

  // ---- Notifications ------------------------------------------------------

  didOpen(params: DidOpenParams): void {
    const { uri, version, text } = params.textDocument;
    const previous = this.#documents.get(uri);
    if (previous !== undefined) {
      // A repeated open replaces the document.
      previous.project.open.delete(previous.path);
      previous.project.publishedVersions.delete(previous.path);
      this.#documents.delete(uri);
    }
    this.#orphans.delete(uri);
    const found = this.#discover(uri);
    if (found === undefined) {
      this.#orphans.set(uri, { uri, version, text });
      if (!this.#logged.has(uri)) {
        this.#logged.add(uri);
        this.ports.log(
          3,
          `${uri} is not in an Effektive project; it gets no diagnostics`,
        );
      }
      return;
    }
    const { project, path } = found;
    project.open.set(path, { uri, version, text });
    project.publishedVersions.delete(path);
    project.dirty = true;
    this.#documents.set(uri, found);
  }

  didChange(params: DidChangeParams): void {
    const { uri } = params.textDocument;
    const found = this.#documents.get(uri);
    if (found === undefined) {
      const orphan = this.#orphans.get(uri);
      if (orphan === undefined) {
        this.ports.stderr(`didChange for a document that is not open: ${uri}`);
      } else {
        this.#applyChange(orphan, params);
      }
      return;
    }
    const document = found.project.open.get(found.path);
    if (document === undefined) return;
    if (this.#applyChange(document, params)) found.project.dirty = true;
  }

  /** Applies a change to an open document. Returns false for a stale version. */
  #applyChange(document: OpenDocument, params: DidChangeParams): boolean {
    const { uri, version } = params.textDocument;
    if (version <= document.version) {
      this.ports.stderr(`ignored stale document version ${version} for ${uri}`);
      return false;
    }
    document.text = applyContentChanges(
      document.text,
      params.contentChanges,
    );
    document.version = version;
    return true;
  }

  didClose(uri: string): void {
    const found = this.#documents.get(uri);
    if (found === undefined) {
      if (!this.#orphans.delete(uri)) {
        this.ports.stderr(`didClose for a document that is not open: ${uri}`);
      }
      return;
    }
    this.#documents.delete(uri);
    const { project, path } = found;
    project.open.delete(path);
    project.publishedVersions.delete(path);
    // The watcher ignores an open document, so a save while it was open never
    // reached `disk`. Read the file again.
    this.#reread(project, path);
    project.dirty = true;
  }

  /** Reads one file of a project from disk again. A missing file leaves `disk`. */
  #reread(project: ProjectState, path: string): void {
    const absolute = joinPath(project.root, path);
    const read = this.ports.fs.readText(absolute);
    const disk = new Map(project.disk);
    if (read.ok) disk.set(path, read.value);
    else if (read.error.tag === "not-found") disk.delete(path);
    else {
      this.ports.stderr(`cannot read ${absolute}: ${read.error.message}`);
      return;
    }
    project.disk = disk;
  }

  /**
   * Watched-file events. An event counts when its path lies under a known
   * project root, passes `isSourcePath`, and is not an open document. An event
   * for any `effektive.json` also binds the open documents to their projects
   * again, including the documents that had no project.
   */
  didChangeWatchedFiles(events: readonly FileEvent[]): void {
    const absolutes: string[] = [];
    for (const event of events) {
      const absolute = uriToPath(event.uri);
      if (absolute === undefined) continue;
      absolutes.push(absolute);
      for (const project of this.#projects.values()) {
        const path = sourcePathUnder(project.root, absolute);
        if (path === undefined) continue;
        if (project.open.has(path)) continue;
        if (event.type === 3) {
          const disk = new Map(project.disk);
          disk.delete(path);
          project.disk = disk;
        } else {
          this.#reread(project, path);
        }
        project.dirty = true;
      }
    }
    if (absolutes.some((absolute) => basename(absolute) === CONFIG_FILE)) {
      this.#rebind();
      this.#removeDeadProjects();
    }
    // The client sends no `didSave` for `effektive.json`, so each project
    // whose own `effektive.json` changed gets a save round.
    for (const project of [...this.#projects.values()]) {
      const named = absolutes.some((absolute) =>
        sourcePathUnder(project.root, absolute) === CONFIG_FILE
      );
      if (named) this.saveRound(project);
    }
  }

  /**
   * Finds the project of each open document again, and moves a document whose
   * project changed. A document without a project joins the project that it
   * now finds, with its unsaved text.
   */
  #rebind(): void {
    for (const [uri, old] of [...this.#documents]) {
      const found = this.#discover(uri);
      if (found === undefined || found.project === old.project) continue;
      const document = old.project.open.get(old.path);
      if (document === undefined) continue;
      old.project.open.delete(old.path);
      old.project.publishedVersions.delete(old.path);
      this.#reread(old.project, old.path);
      old.project.dirty = true;
      const { version, text } = document;
      found.project.open.set(found.path, { uri, version, text });
      found.project.publishedVersions.delete(found.path);
      found.project.dirty = true;
      this.#documents.set(uri, found);
    }
    for (const [uri, { version, text }] of [...this.#orphans]) {
      const found = this.#discover(uri);
      if (found === undefined) continue;
      found.project.open.set(found.path, { uri, version, text });
      found.project.publishedVersions.delete(found.path);
      found.project.dirty = true;
      this.#documents.set(uri, found);
      this.#orphans.delete(uri);
    }
  }

  /**
   * Removes each project that has no `effektive.json` and no open document.
   * The set clears the lists that the project published. A project that covers
   * a cleared path forgets its list for it, so that its next flush publishes
   * that list again.
   */
  #removeDeadProjects(): void {
    const hasDocument = new Set<ProjectState>();
    for (const { project } of this.#documents.values()) {
      hasDocument.add(project);
    }
    const cleared: string[] = [];
    for (const [root, project] of [...this.#projects]) {
      if (hasDocument.has(project)) continue;
      const config = joinNativePath(root, CONFIG_FILE);
      if (this.ports.fs.kind(config) === "file") continue;
      this.#projects.delete(root);
      for (const [path, json] of project.published) {
        if (json === "[]") continue;
        const uri = pathToUri(joinPath(project.root, path));
        if (uri === undefined) continue;
        this.ports.publish({ uri, diagnostics: [] });
        cleared.push(uri);
      }
    }
    for (const uri of cleared) {
      const absolute = uriToPath(uri);
      if (absolute === undefined) continue;
      for (const project of this.#projects.values()) {
        const path = sourcePathUnder(project.root, absolute);
        if (path === undefined || !project.published.has(path)) continue;
        project.published.delete(path);
        project.dirty = true;
      }
    }
  }

  /**
   * One save round: reads the workspace from disk,
   * brings the disk program up to date, removes the outputs of deleted
   * modules, and writes the outputs of every writable module that the project
   * owns. Does nothing when `writeOnSave` is false.
   */
  saveRound(project: ProjectState): void {
    if (!this.ports.writeOnSave()) return;
    const { fs, log } = this.ports;
    const session = project.diskSession ??= {
      disk: new DiskProgram(project.root),
      outputs: new TypeScriptOutputs(),
      modules: [],
      heldReasons: new Map(),
    };
    const { disk, outputs } = session;
    const read = disk.read(fs);
    if (!read.ok) {
      log(1, `cannot read the project ${project.root}: ${read.error}`);
      return;
    }
    const workspace = read.value.files;
    if (!sameTexts(project.disk, workspace)) {
      // The overlay program must see the new disk text at the next flush.
      project.disk = workspace;
      project.dirty = true;
    }
    const updated = disk.update(read.value);
    if (!updated.ok) {
      log(1, describeConfigError(updated.error));
      return;
    }
    const revision = updated.value;
    const owns = (name: string): boolean => ownedByRoot(fs, project.root, name);

    const round = runSaveRound({
      fs,
      root: project.root,
      revision,
      outputs,
      previous: session.modules,
      removal: "retry",
      owns,
      write: true,
    });
    for (const { removed, notes } of round.removals) {
      for (const path of removed) log(4, `removed ${path}`);
      for (const note of notes) log(1, note);
    }
    session.modules = round.modules;

    for (const path of round.outputs.written) log(4, `wrote ${path}`);
    for (const note of round.outputs.notes) log(1, note);

    const held = new Set<string>();
    for (const [name, why] of round.held) {
      if (!owns(name)) continue;
      held.add(name);
      const reason = heldMessage(name, why);
      if (session.heldReasons.get(name) === reason) continue;
      session.heldReasons.set(name, reason);
      log(3, reason);
    }
    for (const name of [...session.heldReasons.keys()]) {
      if (!held.has(name)) session.heldReasons.delete(name);
    }
  }

  /** Finds or opens the project of a document. */
  #discover(uri: string): DocumentRef | undefined {
    const absolute = uriToPath(uri);
    if (absolute === undefined) return undefined;
    const fs = this.ports.fs;
    let dir = dirname(absolute);
    for (;;) {
      if (fs.kind(joinNativePath(dir, CONFIG_FILE)) === "file") break;
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
    const path = sourcePathUnder(dir, absolute);
    if (path === undefined) return undefined;
    let project = this.#projects.get(dir);
    if (project === undefined) {
      project = new ProjectState(dir);
      const read = readWorkspace(fs, dir);
      if (read.ok) project.disk = read.value;
      else {
        this.ports.log(1, `cannot read the project ${dir}: ${read.error}`);
      }
      this.#projects.set(dir, project);
    }
    return { project, path };
  }

  // ---- Flush and publish --------------------------------------------------

  /**
   * Gives the program the difference between the wanted texts and its current
   * texts, then publishes. A flush with no text difference starts no revision.
   * It still publishes an open document that was opened or changed in version.
   */
  flush(project: ProjectState): void {
    if (!project.dirty) return;
    project.dirty = false;
    const wanted = project.wanted();
    const { set, remove } = diffFiles(project.current, wanted);
    if (project.started && set.size === 0 && remove.length === 0) {
      this.#publish(project, wanted);
      return;
    }
    const updated = project.program.update({ set, remove });
    project.current = wanted;
    project.recordUpdate(updated);
    this.#publish(project, wanted);
    if (updated.ok) this.ports.flushed(project, updated.value);
  }

  #publish(project: ProjectState, wanted: ReadonlyMap<string, string>): void {
    const error = project.configError;
    if (error !== undefined) {
      // Other files keep the diagnostics that they have.
      const origin = { line: 0, character: 0 };
      this.#publishList(project, CONFIG_FILE, [{
        range: { start: origin, end: origin },
        severity: 1,
        code: "config",
        source: "effektive",
        message: describeConfigError(error),
      }]);
      return;
    }
    const revision = project.lastGood;
    if (revision === undefined) return;
    const used = revision.sourceTexts();
    const groups = groupDiagnostics(
      revision.diagnostics,
      project.root,
      (path) => used.get(path) ?? wanted.get(path) ?? "",
    );
    const listOf = (path: string): Diagnostic[] => groups.get(path) ?? [];
    const openPaths = [...project.open.keys()].sort(compareText);
    for (const path of openPaths) {
      const document = project.open.get(path);
      if (document === undefined) continue;
      const newVersion = project.publishedVersions.get(path) !==
        document.version;
      this.#publishList(
        project,
        path,
        listOf(path),
        { uri: document.uri, version: document.version },
        newVersion,
      );
    }
    const closed = new Set([...groups.keys(), ...project.published.keys()]);
    for (const path of [...closed].sort(compareText)) {
      if (project.open.has(path)) continue;
      this.#publishList(project, path, listOf(path));
    }
  }

  /**
   * Publishes one list when `force` is set or when it differs from the list
   * last published for the path. An open document passes its own URI and
   * version. A closed file gets a URI from its path and no version.
   */
  #publishList(
    project: ProjectState,
    path: string,
    list: readonly Diagnostic[],
    open?: { readonly uri: string; readonly version: number },
    force = false,
  ): void {
    const json = JSON.stringify(list);
    if (!force && json === (project.published.get(path) ?? "[]")) return;
    const uri = open?.uri ?? pathToUri(joinPath(project.root, path));
    if (uri === undefined) return;
    project.published.set(path, json);
    if (open === undefined) {
      this.ports.publish({ uri, diagnostics: list });
      return;
    }
    project.publishedVersions.set(path, open.version);
    this.ports.publish({ uri, version: open.version, diagnostics: list });
  }
}
