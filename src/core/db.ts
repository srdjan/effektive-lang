// The program: the state of one project across revisions, with
// memoized queries and an early cutoff at module level.
//
// `update` starts a new revision from a set of file changes. The revision then
// answers frontend queries: checked modules, diagnostics, and lazy typed IR.
// TypeScriptOutputs owns output queries separately.
//
// Memoization has three levels.
//
// 1. Parse memo. A file whose text equals the text of the last parse keeps its
//    syntax tree object, its parse diagnostics, and its declaration index.
// 2. Check memo. The memo key of a module holds its own text and the interface
//    hash of every module that it reaches. A module with an
//    unchanged key is not checked again. Its checked module, type graph, and
//    interface are reused.
// 3. Lowering memo. The lowering key holds the hash of the full interface
//    payload of every reached module, spans included (see the note on spans
//    below). A module with an unchanged lowering key reuses its IR. Outputs
//    use the lowering result as their cache key in TypeScriptOutputs.
//
// The program runs the project driver of `checkAnalysis`, `driveProject`, with
// a policy that decides for each module whether to reuse the memo entry, to
// build only its interface again, or to check it. The driver does not know the
// memo, so the result of a revision equals the result of a check from scratch.
// One test compares both.
//
// Each revision owns its definitions and shares append-only interned storage.
// Type references in reused modules stay valid. Memory growth over a long
// watch session is measurement M4.
//
// Note on spans. The IR import of a module carries the interface payload of the
// imported module, and the payload carries the source spans of the declarations.
// The interface of a module also copies the declarations of other modules that
// it reaches. The interface hash leaves the spans out. An edit that
// only moves a declaration of an imported module keeps that hash, so the
// importer is not checked again. Its lowering key changes, so the program builds
// its interface again from the reused declarations and lowers it again. The IR
// then carries the new spans.

import { buildSymbolIndex, type SymbolIndex } from "./editor_index.ts";
import { type Analysis, analyzeProject } from "./analyze.ts";
import type { Solved } from "./modes.ts";
import {
  type CheckedModule,
  type CheckedProject,
  driveProject,
  type ModuleDecision,
  type ModulePolicy,
  type ModuleStep,
} from "./check_project.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { moduleOfId, nameOfId } from "./ids.ts";
import type { DeclEntry } from "./declaration_index.ts";
import { fnv1a64, payloadHash } from "./interface.ts";
import type { ModuleIR, ValueId } from "./ir.ts";
import { type LowerError, lowerModule } from "./lower.ts";
import {
  type ModuleInfo,
  type ParsedFile,
  parseFileFresh,
  type Project,
} from "./project.ts";
import {
  type ConfigError,
  configKey,
  type ProjectConfig,
} from "./project_config.ts";
import { isSourcePath, joinPath } from "./paths.ts";
import type { ModuleResolution } from "./resolve.ts";
import { memoryHost, type Result } from "./source.ts";
import { type TypeReader, TypeTable } from "./types.ts";
import { compareText } from "./util.ts";
import { deleteMapEntry, emptyMap, mapFrom } from "./runtime.ts";

/** A change set. Paths are relative to the project root. */
export type ProgramChanges = {
  /** Files that are new or that have new text. */
  readonly set?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>;
  /** Files that no longer exist. */
  readonly remove?: readonly string[];
};

/** The files to set and the paths to remove, so that `known` becomes `wanted`. */
type FileDiff = {
  readonly set: ReadonlyMap<string, string>;
  readonly remove: readonly string[];
};

/**
 * The change set that turns `known` into `wanted`, in the shape that
 * `Program.update` takes. A path is in `set` when `wanted` holds a text that
 * `known` lacks or holds with another text. A path is in `remove` when `known`
 * holds it and `wanted` does not. Both lists keep the order of their source map.
 */
export function diffFiles(
  known: ReadonlyMap<string, string>,
  wanted: ReadonlyMap<string, string>,
): FileDiff {
  let set = emptyMap<string, string>();
  for (const file of wanted) {
    const path = file[0];
    const text = file[1];
    if (known.get(path) !== text) set = set.set(path, text);
  }
  const remove = [...known.keys()].filter((path) => !wanted.has(path));
  return { set: set, remove: remove };
}

/**
 * Cumulative counts of the expensive queries of a program (design measurement
 * M3). A memo hit does not count.
 */
export type QueryCounts = {
  /** Parses that missed the parse memo. */
  readonly parses: number;
  /** Modules checked again, whatever the reason. */
  readonly checks: number;
  /** Lowerings that `Revision.lowered` computed on demand. */
  readonly lowerings: number;
};

/** The counter owner that a program shares with its revisions. */
type QueryCounter = {
  readonly counts: () => QueryCounts;
  readonly parsed: () => QueryCounter;
  readonly checked: () => QueryCounter;
  readonly lowered: () => QueryCounter;
};

function QueryCounter(): QueryCounter {
  let parses = 0;
  let checks = 0;
  let lowerings = 0;
  function counts(): QueryCounts {
    return { parses: parses, checks: checks, lowerings: lowerings };
  }
  function parsed(): QueryCounter {
    parses = parses + 1;
    return counter;
  }
  function checked(): QueryCounter {
    checks = checks + 1;
    return counter;
  }
  function lowered(): QueryCounter {
    lowerings = lowerings + 1;
    return counter;
  }
  const counter: QueryCounter = {
    counts: counts,
    parsed: parsed,
    checked: checked,
    lowered: lowered,
  };
  return counter;
}

/**
 * A cache decision with the keys that `decide` computed for the module.
 * `settled` stores them in the new memo entry.
 */
type MemoDecision = ModuleDecision & {
  readonly keys: { readonly rest: string; readonly lowerKey: string };
};

/** The payload hash of the interface of a step, or `fallback` when the step has no interface. */
function payloadOf(step: ModuleStep, fallback: string): string {
  const built = step.checked.interface;
  return built.ok ? payloadHash(built.value.payload) : fallback;
}

/** A memo entry. The key decides when it is valid. The lazy fields fill on demand. */
type Entry = {
  readonly text: string;
  readonly rest: string;
  readonly step: ModuleStep;
  /** What the checker of an importer sees: the interface hash, or the key when there is no interface. */
  readonly signature: string;
  /** What the lowering of an importer sees: the full payload hash, or the signature when there is no interface. */
  readonly payload: string;
  /** The payload hashes of the reached modules when this entry was lowered. */
  readonly lowerKey: string;
  readonly lowered: (
    checked: CheckedProject,
    name: string,
    counter: QueryCounter,
  ) => Result<ModuleIR, LowerError>;
};

function LoweredQuery(): Entry["lowered"] {
  let cached: Result<ModuleIR, LowerError> | undefined;
  return (checked, name, counter) => {
    if (cached === undefined) {
      counter = counter.lowered();
      cached = lowerModule(checked, name);
    }
    return cached;
  };
}

type RevisionState = {
  readonly number: number;
  readonly project: Project;
  readonly checked: CheckedProject;
  readonly rechecked: readonly string[];
  readonly entries: ReadonlyMap<string, Entry>;
  readonly texts: ReadonlyMap<string, string>;
  readonly counter: QueryCounter;
  readonly files: ReadonlyMap<string, string>;
};

export type Revision = {
  /** The revision number: 1 for the first successful `update`. */
  readonly number: number;
  /** The modules that this revision checked again, in topological order. */
  readonly rechecked: readonly string[];
  /** All diagnostics of the project, sorted and without duplicates. */
  readonly diagnostics: readonly Diagnostic[];
  readonly root: string;
  readonly config: ProjectConfig;
  /** The type table of this revision, read-only. */
  readonly types: TypeReader;
  /** The loading, linking, and resolving diagnostics before module checks. */
  readonly analysisDiagnostics: readonly Diagnostic[];
  readonly symbolIndex: () => SymbolIndex;
  readonly moduleNames: () => readonly string[];
  readonly checkedModule: (name: string) => CheckedModule | undefined;
  readonly moduleInfos: () => Iterable<ModuleInfo>;
  readonly moduleInfo: (name: string) => ModuleInfo | undefined;
  readonly moduleInfoAt: (path: string) => ModuleInfo | undefined;
  readonly checkedModuleAt: (path: string) => CheckedModule | undefined;
  readonly resolution: (name: string) => ModuleResolution | undefined;
  readonly imports: (name: string) => readonly string[];
  readonly declEntry: (id: string) => DeclEntry | undefined;
  readonly interfaceHash: (name: string) => string | undefined;
  readonly sourceTexts: () => ReadonlyMap<string, string>;
  readonly inputs: () => ReadonlyMap<string, string>;
  readonly lowered: (
    name: string,
  ) => Result<ModuleIR, LowerError> | undefined;
};

/**
 * The state of the program after one `update`. The query methods return
 * memoized values: a module with an unchanged key returns the same objects as
 * in the revision before.
 */
export function Revision(state: RevisionState): Revision {
  const project = state.project;
  const checked = state.checked;
  const entries = state.entries;
  let pathMap: ReadonlyMap<string, string> | undefined;
  let editorSymbols: SymbolIndex | undefined;

  function symbolIndex(): SymbolIndex {
    editorSymbols = editorSymbols ?? buildSymbolIndex(revision);
    return editorSymbols;
  }

  /**
   * The module names, imported modules before their importers. Each `.eff` and
   * `.effi` module has one generated module, so this is also their list.
   */
  function moduleNames(): readonly string[] {
    return [...entries.keys()];
  }

  function checkedModule(name: string): CheckedModule | undefined {
    return entries.get(name)?.step.checked;
  }

  /** The module infos in discovery order. */
  function moduleInfos(): Iterable<ModuleInfo> {
    return project.modules.values();
  }

  function moduleInfo(name: string): ModuleInfo | undefined {
    return project.modules.get(name);
  }

  /** The module name of each root-relative path. Built on first use. */
  function namesByPath(): ReadonlyMap<string, string> {
    if (pathMap === undefined) {
      pathMap = mapFrom(
        [...project.modules].map(
          (moduleEntry): readonly [string, string] => [
            moduleEntry[1].path,
            moduleEntry[0],
          ],
        ),
      );
    }
    return pathMap;
  }

  function moduleInfoAt(path: string): ModuleInfo | undefined {
    const name = namesByPath().get(path);
    return name === undefined ? undefined : project.modules.get(name);
  }

  function checkedModuleAt(path: string): CheckedModule | undefined {
    const name = namesByPath().get(path);
    return name === undefined ? undefined : entries.get(name)?.step.checked;
  }

  function resolution(name: string): ModuleResolution | undefined {
    return checked.analysis.resolutions.get(name);
  }

  /** The sorted module names that a module imports, or an empty list. */
  function imports(name: string): readonly string[] {
    return project.graph.get(name) ?? [];
  }

  /** The declaration entry, or undefined for a malformed or unknown identity. */
  function declEntry(id: string): DeclEntry | undefined {
    const owner = moduleOfId(id);
    const name = nameOfId(id);
    if (owner === undefined || name === undefined) return undefined;
    return project.modules.get(owner)?.index.byName.get(name);
  }

  /** The interface hash, which leaves out source spans. */
  function interfaceHash(name: string): string | undefined {
    return entries.get(name)?.step.checked.hash;
  }

  /** The text of each loaded file, keyed by its root-relative path. */
  function sourceTexts(): ReadonlyMap<string, string> {
    return state.texts;
  }

  /** The input files when this revision started. */
  function inputs(): ReadonlyMap<string, string> {
    return state.files;
  }

  /** The typed IR of a module. A module with an error has an error value. */
  function lowered(name: string): Result<ModuleIR, LowerError> | undefined {
    const entry = entries.get(name);
    return entry?.lowered(checked, name, state.counter);
  }

  const revision: Revision = {
    number: state.number,
    rechecked: state.rechecked,
    diagnostics: checked.diagnostics,
    root: project.root,
    config: project.config,
    types: checked.table,
    analysisDiagnostics: checked.analysis.diagnostics,
    symbolIndex: symbolIndex,
    moduleNames: moduleNames,
    checkedModule: checkedModule,
    moduleInfos: moduleInfos,
    moduleInfo: moduleInfo,
    moduleInfoAt: moduleInfoAt,
    checkedModuleAt: checkedModuleAt,
    resolution: resolution,
    imports: imports,
    declEntry: declEntry,
    interfaceHash: interfaceHash,
    sourceTexts: sourceTexts,
    inputs: inputs,
    lowered: lowered,
  };
  return revision;
}

type ParseMemo = {
  readonly text: string;
  readonly file: ParsedFile;
};

export type ProgramRoot = string;

export type Program = {
  /** A snapshot of the cumulative query counts over the life of the program. */
  readonly counts: () => QueryCounts;
  readonly update: (
    changes: ProgramChanges | undefined,
  ) => Result<Revision, ConfigError>;
};

function isMapChangeSet(
  set: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): set is ReadonlyMap<string, string> {
  return typeof set.get === "function" &&
    typeof set.entries === "function";
}

function changeEntries(
  set:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>
    | undefined,
): readonly (readonly [string, string])[] {
  if (set === undefined) return [];
  return isMapChangeSet(set) ? [...set] : Object.entries(set);
}

/** `root` is the project directory that diagnostics and errors name. */
export function Program(root: ProgramRoot | undefined): Program {
  const programRoot = root ?? "";
  let files = emptyMap<string, string>();
  let parses = emptyMap<string, ParseMemo>();
  let entries = emptyMap<string, Entry>();
  let table = TypeTable();
  let count = 0;
  let counter = QueryCounter();

  function parseFile(path: string, text: string): ParsedFile {
    const memo = parses.get(path);
    if (memo !== undefined && memo.text === text) return memo.file;
    counter = counter.parsed();
    const file = parseFileFresh(path, text);
    parses = parses.set(path, { text: text, file: file });
    return file;
  }

  /** The same project driver as `checkAnalysis`, with the memo deciding modules. */
  function check(analysis: Analysis): Revision {
    const nextTable = table.fork();
    const project = analysis.project;
    const config = configKey(project.config);
    let signatures = emptyMap<string, string>();
    let payloads = emptyMap<string, string>();
    let nextEntries = emptyMap<string, Entry>();
    const rechecked: string[] = [];
    const policy: ModulePolicy<MemoDecision> = {
      decide: (name, info, seen) => {
        const reached = seen.reached;
        const keys = {
          rest: JSON.stringify([
            info.path,
            config,
            analysis.diagnostics.filter((diagnostic) =>
              diagnostic.span.source === info.path
            ),
            reached.map((other) => [other, signatures.get(other) ?? null]),
          ]),
          lowerKey: JSON.stringify(
            reached.map((other) => [other, payloads.get(other) ?? null]),
          ),
        };
        const entry = entries.get(name);
        if (
          entry === undefined || entry.text !== info.tree.text ||
          entry.rest !== keys.rest
        ) {
          return { kind: "check", keys: keys };
        }
        return {
          kind: entry.lowerKey === keys.lowerKey ? "reuse" : "refresh",
          step: entry.step,
          keys: keys,
        };
      },
      settled: (name, step, decision) => {
        const keys = decision.keys;
        const previous = entries.get(name);
        const text = step.checked.tree.text;
        let entry: Entry;
        if (decision.kind === "check" || previous === undefined) {
          const signature = step.checked.hash ??
            `key:${fnv1a64(keys.rest)}:${fnv1a64(text)}`;
          entry = {
            text: text,
            rest: keys.rest,
            step: step,
            signature: signature,
            payload: payloadOf(step, signature),
            lowerKey: keys.lowerKey,
            lowered: LoweredQuery(),
          };
          rechecked[rechecked.length] = name;
          counter = counter.checked();
        } else if (decision.kind === "refresh") {
          // Only reached-module spans moved. Lower the IR again on demand.
          entry = {
            text: previous.text,
            rest: previous.rest,
            step: step,
            signature: previous.signature,
            payload: payloadOf(step, previous.signature),
            lowerKey: keys.lowerKey,
            lowered: LoweredQuery(),
          };
        } else {
          entry = previous;
        }
        nextEntries = nextEntries.set(name, entry);
        signatures = signatures.set(name, entry.signature);
        payloads = payloads.set(name, entry.payload);
        return policy;
      },
    };
    const checked = driveProject<MemoDecision>(analysis, nextTable, policy);

    let texts = emptyMap<string, string>();
    for (const name of project.order) {
      const info = project.modules.get(name);
      if (info !== undefined && analysis.resolutions.has(name)) {
        texts = texts.set(info.path, info.tree.text);
      }
    }
    entries = nextEntries;
    table = nextTable;
    return Revision({
      number: count,
      project: project,
      checked: checked,
      rechecked: rechecked,
      entries: nextEntries,
      texts: texts,
      counter: counter,
      files: mapFrom(files),
    });
  }

  /**
   * Applies changes and starts a revision. A project-file error is a value.
   * Changed files remain, so a later update can repair the project file.
   */
  function update(
    changes: ProgramChanges | undefined,
  ): Result<Revision, ConfigError> {
    const selected = changes ?? {};
    for (const file of changeEntries(selected.set)) {
      files = files.set(file[0], file[1]);
    }
    for (const path of selected.remove ?? []) {
      files = deleteMapEntry(files, path).map;
      parses = deleteMapEntry(parses, path).map;
    }

    let hostFiles = emptyMap<string, string>();
    for (const file of files) {
      hostFiles = hostFiles.set(
        joinPath(programRoot, file[0]),
        file[1],
      );
    }
    const entryPaths = [...files.keys()].filter(isSourcePath).sort(compareText);
    const analyzed = analyzeProject(
      memoryHost(hostFiles),
      programRoot,
      entryPaths,
      parseFile,
    );
    if (!analyzed.ok) return analyzed;
    count = count + 1;
    return { ok: true, value: check(analyzed.value) };
  }

  return { counts: counter.counts, update: update };
}

/** The modules that differ between two revisions, in the module order of the later one. */
export type RevisionDelta = {
  /** Modules whose interface hash differs. */
  readonly interfaceChanged: readonly string[];
  /** Modules whose mode map differs in size or in any entry. */
  readonly modeChanged: readonly string[];
};

function sameModes(
  a: ReadonlyMap<ValueId, Solved> | undefined,
  b: ReadonlyMap<ValueId, Solved> | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.size !== b.size) return false;
  for (const entry of a) {
    const id = entry[0];
    const solved = entry[1];
    if (b.get(id)?.mode !== solved.mode) return false;
  }
  return true;
}

/**
 * Compares two revisions. A module that the earlier revision lacks counts as
 * changed in both lists. An undefined `previous` makes every module changed.
 */
export function revisionDelta(
  previous: Revision | undefined,
  next: Revision,
): RevisionDelta {
  const interfaceChanged: string[] = [];
  const modeChanged: string[] = [];
  for (const name of next.moduleNames()) {
    const before = previous?.checkedModule(name);
    if (previous === undefined || before === undefined) {
      interfaceChanged[interfaceChanged.length] = name;
      modeChanged[modeChanged.length] = name;
      continue;
    }
    if (previous.interfaceHash(name) !== next.interfaceHash(name)) {
      interfaceChanged[interfaceChanged.length] = name;
    }
    if (!sameModes(before.solved, next.checkedModule(name)?.solved)) {
      modeChanged[modeChanged.length] = name;
    }
  }
  return {
    interfaceChanged: interfaceChanged,
    modeChanged: modeChanged,
  };
}
