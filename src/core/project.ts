// The project: module identity, the host registry, the module graph, import cycles,
// and the topological order. `project_config.ts` reads `effektive.json`. The core
// reads files only through SourceHost.

import {
  type Diagnostic,
  makeDiagnostic,
  normalizeDiagnostics,
} from "./diagnostics.ts";
import { isCycle, stronglyConnectedComponents } from "./graph.ts";
import {
  buildIndex,
  type FileIndex,
  type ImportEntry,
} from "./declaration_index.ts";
import {
  hostKeyOf,
  isHostLabel,
  isModulePath,
  isSourcePath,
  joinPath,
  moduleNameOf,
  normalizeRelative,
} from "./paths.ts";
import { parse, type ParseResult } from "./parse.ts";
import type { ReadError, Result, SourceHost, Span } from "./source.ts";
import {
  CONFIG_FILE,
  type ConfigError,
  importAllowed,
  type ProjectConfig,
  readConfig,
} from "./project_config.ts";
import type { FileMode, SyntaxTree } from "./syntax.ts";
import { compareText } from "./util.ts";

interface ImportLink {
  /** The import declaration in the index of the importing module. */
  readonly entry: ImportEntry;
  /** The imported module's name, or undefined when the import could not be linked. */
  readonly target: string | undefined;
  /** The `Import.module` value of the IR: the module name, or the import string for a host import. */
  readonly label: string | undefined;
  readonly isHost: boolean;
}

export interface ModuleInfo {
  /** The module name: the root-relative path without `.eff` or `.effi`. */
  readonly name: string;
  /** The root-relative path. Diagnostic spans use it as their source. */
  readonly path: string;
  readonly mode: FileMode;
  readonly tree: SyntaxTree;
  readonly parseDiagnostics: readonly Diagnostic[];
  readonly index: FileIndex;
  /** One link for each import in `index.imports`, in the same order. */
  readonly links: readonly ImportLink[];
}

/** One import of a module as the lowerer binds it. */
interface PlannedImport {
  /** The `Import.module` value, or undefined when the import could not be linked. */
  readonly label: string | undefined;
  /** The name of the imported module, or undefined when the import could not be linked. */
  readonly target: string | undefined;
  /** The text that reports a missing interface. */
  readonly imported: string;
  /** The names that the import binds, in source order. */
  readonly names: readonly string[];
}

/**
 * Plans the imports of a module, in link order. Imports from one module that has a service
 * import share one entry, which binds the names of every such import.
 */
export function planImports(info: ModuleInfo): readonly PlannedImport[] {
  const serviceLabels = new Set(
    info.links.flatMap((link) =>
      link.entry.role === "service" && link.label !== undefined
        ? [link.label]
        : []
    ),
  );
  const planned: PlannedImport[] = [];
  const mergedAt = new Map<string, number>();
  for (const link of info.links) {
    const item: PlannedImport = {
      label: link.label,
      target: link.target,
      imported: link.label ?? link.entry.specifier ?? "",
      names: link.entry.names.map((name) => name.name),
    };
    if (link.label === undefined || !serviceLabels.has(link.label)) {
      planned.push(item);
      continue;
    }
    const at = mergedAt.get(link.label);
    if (at === undefined) {
      mergedAt.set(link.label, planned.length);
      planned.push(item);
      continue;
    }
    const previous = planned[at];
    planned[at] = { ...previous, names: [...previous.names, ...item.names] };
  }
  return planned;
}

type ExportRule = "declared" | "every-declaration";

/**
 * The companion module of a `.effi` file exports every declaration, because the host module
 * needs each one. Any other module exports what it declares as exported.
 */
export function exportRuleOf(info: ModuleInfo): ExportRule {
  return info.mode === "effi" ? "every-declaration" : "declared";
}

export interface Project {
  readonly root: string;
  readonly config: ProjectConfig;
  /** Modules by name, in discovery order. */
  readonly modules: ReadonlyMap<string, ModuleInfo>;
  /** For each module name, the sorted names of the modules that it imports. */
  readonly graph: ReadonlyMap<string, readonly string[]>;
  /** Every module name, imported modules before their importers. */
  readonly order: readonly string[];
  /** Configuration, loading, and linking diagnostics. Parse diagnostics are in the modules. */
  readonly diagnostics: readonly Diagnostic[];
}

type LoadFailure =
  | { readonly tag: "read"; readonly error: ReadError }
  | { readonly tag: "conflict"; readonly other: string }
  | { readonly tag: "bad-name" };

/**
 * Module names become part of identities such as `value:users#getUser` and of
 * emitted error tags, so a name may not contain `#` or other special characters.
 */
const MODULE_NAME_PATTERN = /^[A-Za-z0-9_.\/-]+$/;

function emptySpan(source: string): Span {
  return { source, start: 0, end: 0 };
}

/** The parse tree, parse diagnostics, and declaration index of one file. */
export interface ParsedFile {
  readonly parsed: ParseResult;
  readonly index: FileIndex;
}

/**
 * Turns the text of a file into its parse result. The default parses every time.
 * A memoizing caller returns the earlier result when the text is equal, so that
 * an unchanged file keeps its syntax tree object.
 */
export type FileParser = (path: string, text: string) => ParsedFile;

export const parseFileFresh: FileParser = (path, text) => {
  const parsed = parse(path, text);
  return { parsed, index: buildIndex(parsed.tree) };
};

interface LoadedFile {
  readonly path: string;
  readonly name: string;
  readonly parsed: ParseResult;
  readonly index: FileIndex;
}

class Loader {
  readonly modules = new Map<string, ModuleInfo>();
  readonly diagnostics: Diagnostic[] = [];
  private readonly pathOfName = new Map<string, string>();
  private readonly failures = new Map<string, LoadFailure>();
  /** The loaded files in load order. The loop in `run` appends to it. */
  private readonly queue: LoadedFile[] = [];
  private readonly loaded = new Set<string>();

  constructor(
    private readonly host: SourceHost,
    private readonly root: string,
    private readonly config: ProjectConfig,
    private readonly parseFile: FileParser,
  ) {}

  /** Loads a file once. Returns the failure when the file cannot be used. */
  private ensure(path: string): LoadFailure | undefined {
    if (this.loaded.has(path)) return undefined;
    const failed = this.failures.get(path);
    if (failed !== undefined) return failed;
    const name = moduleNameOf(path);
    if (!MODULE_NAME_PATTERN.test(name)) {
      const failure: LoadFailure = { tag: "bad-name" };
      this.failures.set(path, failure);
      return failure;
    }
    const owner = this.pathOfName.get(name);
    if (owner !== undefined && owner !== path) {
      const failure: LoadFailure = { tag: "conflict", other: owner };
      this.failures.set(path, failure);
      return failure;
    }
    const read = this.host.readText(joinPath(this.root, path));
    if (!read.ok) {
      const failure: LoadFailure = { tag: "read", error: read.error };
      this.failures.set(path, failure);
      return failure;
    }
    const { parsed, index } = this.parseFile(path, read.value);
    this.pathOfName.set(name, path);
    this.loaded.add(path);
    this.queue.push({ path, name, parsed, index });
    return undefined;
  }

  private reportFailure(path: string, failure: LoadFailure, span: Span): void {
    if (failure.tag === "conflict") {
      this.diagnostics.push(makeDiagnostic(
        "module/001",
        `${path} and ${failure.other} have the same module name`,
        span,
      ));
    } else if (failure.tag === "bad-name") {
      this.diagnostics.push(makeDiagnostic(
        "module/001",
        `the module path ${path} may contain only letters, digits, and _ . - /`,
        span,
      ));
    } else {
      const reason = failure.error.tag === "not-found"
        ? "the file does not exist"
        : `the file cannot be read: ${failure.error.message}`;
      this.diagnostics.push(makeDiagnostic(
        "module/002",
        `cannot load ${path}: ${reason}`,
        span,
      ));
    }
  }

  private reportForbidden(importer: string, target: string, span: Span): void {
    const source = moduleNameOf(importer);
    if (importAllowed(this.config, source, target)) return;
    this.diagnostics.push(makeDiagnostic(
      "module/005",
      `module \`${source}\` cannot import \`${target}\` under the project import rules`,
      span,
    ));
  }

  addEntry(raw: string): void {
    const path = normalizeRelative(raw);
    if (path === undefined) {
      this.diagnostics.push(makeDiagnostic(
        "module/001",
        `the entry path \`${raw}\` is not a path inside the project root`,
        emptySpan(raw),
      ));
      return;
    }
    if (!isModulePath(path)) {
      this.diagnostics.push(makeDiagnostic(
        "module/001",
        `the entry path \`${path}\` does not end in .eff or .effi`,
        emptySpan(path),
      ));
      return;
    }
    const failure = this.ensure(path);
    if (failure !== undefined) {
      this.reportFailure(path, failure, emptySpan(path));
    }
  }

  private linkImport(importer: string, entry: ImportEntry): ImportLink {
    const unlinked: ImportLink = {
      entry,
      target: undefined,
      label: undefined,
      isHost: false,
    };
    const specifier = entry.specifier;
    const span = entry.specifierSpan;
    if (specifier === undefined || span === undefined) return unlinked;
    const bad = (message: string): ImportLink => {
      this.diagnostics.push(makeDiagnostic("module/001", message, span));
      return unlinked;
    };
    if (isHostLabel(specifier)) {
      const key = hostKeyOf(specifier);
      const registered = this.config.host.get(key);
      if (registered === undefined) {
        this.diagnostics.push(makeDiagnostic(
          "module/002",
          `host module \`${key}\` is not registered in ${CONFIG_FILE}`,
          span,
        ));
        return { ...unlinked, isHost: true };
      }
      const failure = this.ensure(registered.interfacePath);
      if (failure !== undefined) {
        this.reportFailure(registered.interfacePath, failure, span);
        return { ...unlinked, isHost: true };
      }
      this.reportForbidden(importer, specifier, span);
      return {
        entry,
        target: moduleNameOf(registered.interfacePath),
        label: specifier,
        isHost: true,
      };
    }
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      return bad(
        `import \`${specifier}\` must start with ./ or ../, or use the host: prefix`,
      );
    }
    if (!isSourcePath(specifier)) {
      return bad(`relative import \`${specifier}\` must end in .eff`);
    }
    const slash = importer.lastIndexOf("/");
    const dir = slash < 0 ? "" : importer.slice(0, slash);
    const resolved = normalizeRelative(
      dir === "" ? specifier : `${dir}/${specifier}`,
    );
    if (resolved === undefined) {
      return bad(`import \`${specifier}\` leaves the project root`);
    }
    const failure = this.ensure(resolved);
    if (failure !== undefined) {
      this.reportFailure(resolved, failure, span);
      return unlinked;
    }
    const name = moduleNameOf(resolved);
    this.reportForbidden(importer, name, span);
    return { entry, target: name, label: name, isHost: false };
  }

  /** Loads every module that the entries reach and builds the module records in load order. */
  run(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const { path, name, parsed, index } = this.queue[i];
      this.modules.set(name, {
        name,
        path,
        mode: parsed.tree.mode,
        tree: parsed.tree,
        parseDiagnostics: parsed.diagnostics,
        index,
        links: index.imports.map((entry) => this.linkImport(path, entry)),
      });
    }
  }
}

interface GraphResult {
  readonly graph: ReadonlyMap<string, readonly string[]>;
  readonly order: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

function linkModules(
  modules: ReadonlyMap<string, ModuleInfo>,
): GraphResult {
  const sorted = [...modules].sort(([a], [b]) => compareText(a, b));
  const names = sorted.map(([name]) => name);
  // Module names are sorted, so ascending indexes keep the order of `names`.
  const position = new Map(names.map((name, i) => [name, i]));
  const graph = new Map<string, readonly string[]>();
  const edges: (readonly number[])[] = [];
  for (const [name, info] of sorted) {
    const targets = new Set<number>();
    for (const link of info.links) {
      const at = link.target === undefined
        ? undefined
        : position.get(link.target);
      if (at !== undefined) targets.add(at);
    }
    const indexes = [...targets].sort((a, b) => a - b);
    graph.set(name, indexes.map((i) => names[i]));
    edges.push(indexes);
  }
  const order: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const indexes of stronglyConnectedComponents(names.length, edges)) {
    const component = indexes.map((i) => sorted[i]);
    for (const [moduleName] of component) {
      order.push(moduleName);
    }
    if (isCycle(indexes, edges)) {
      diagnostics.push(cycleDiagnostic(component));
    }
  }
  return { graph, order, diagnostics };
}

function cycleDiagnostic(
  component: readonly (readonly [string, ModuleInfo])[],
): Diagnostic {
  const names = component.map(([name]) => name);
  const members = new Set(names);
  const first = component[0][1];
  const link = first.links.find((l) =>
    l.target !== undefined && members.has(l.target) &&
    l.entry.specifierSpan !== undefined
  );
  const span = link?.entry.specifierSpan ?? emptySpan(first.path);
  const cycle = names.length === 1
    ? `${names[0]} imports itself`
    : `import cycle: ${names.join(" -> ")} -> ${names[0]}`;
  return makeDiagnostic("module/003", cycle, span);
}

/**
 * Reads the project file, loads the entry files and every module they import,
 * builds the module graph, and orders the modules. Entry paths are relative to
 * the root. A missing or malformed project file is an error value. Other
 * problems are diagnostics in the project. The optional `parseFile` replaces
 * the parser, for memoization.
 */
export function loadProject(
  host: SourceHost,
  root: string,
  entries: readonly string[],
  parseFile: FileParser = parseFileFresh,
): Result<Project, ConfigError> {
  const configResult = readConfig(host, root);
  if (!configResult.ok) return configResult;
  const { config } = configResult.value;
  const loader = new Loader(host, root, config, parseFile);
  for (const entry of entries) loader.addEntry(entry);
  loader.run();
  const linked = linkModules(loader.modules);
  return {
    ok: true,
    value: {
      root,
      config,
      modules: loader.modules,
      graph: linked.graph,
      order: linked.order,
      diagnostics: normalizeDiagnostics([
        ...configResult.value.diagnostics,
        ...loader.diagnostics,
        ...linked.diagnostics,
      ]),
    },
  };
}
