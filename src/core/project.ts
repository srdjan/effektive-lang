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
import type { SyntaxTree } from "./syntax.ts";
import { compareText } from "./util.ts";
import { emptyMap, emptySet, mapFrom, setFrom } from "./runtime.ts";

type ImportLink = {
  /** The import declaration in the index of the importing module. */
  readonly entry: ImportEntry;
  /** The imported module's name, or undefined when the import could not be linked. */
  readonly target: string | undefined;
  /** The `Import.module` value of the IR: the module name, or the import string for a host import. */
  readonly label: string | undefined;
  readonly isHost: boolean;
};

export type ModuleInfo = {
  /** The module name: the root-relative path without `.eff` or `.effi`. */
  readonly name: string;
  /** The root-relative path. Diagnostic spans use it as their source. */
  readonly path: string;
  readonly tree: SyntaxTree;
  readonly parseDiagnostics: readonly Diagnostic[];
  readonly index: FileIndex;
  /** One link for each import in `index.imports`, in the same order. */
  readonly links: readonly ImportLink[];
};

/** One import of a module as the lowerer binds it. */
type PlannedImport = {
  /** The `Import.module` value, or undefined when the import could not be linked. */
  readonly label: string | undefined;
  /** The name of the imported module, or undefined when the import could not be linked. */
  readonly target: string | undefined;
  /** The text that reports a missing interface. */
  readonly imported: string;
  /** The names that the import binds, in source order. */
  readonly names: readonly string[];
};

/**
 * Plans the imports of a module, in link order. Imports from one module that has a service
 * import share one entry, which binds the names of every such import.
 */
export function planImports(info: ModuleInfo): readonly PlannedImport[] {
  const serviceLabels = setFrom(
    info.links.flatMap((link) =>
      link.entry.role === "service" && link.label !== undefined
        ? [link.label]
        : []
    ),
  );
  const planned: PlannedImport[] = [];
  let mergedAt = emptyMap<string, number>();
  for (const link of info.links) {
    const item: PlannedImport = {
      label: link.label,
      target: link.target,
      imported: link.label ?? link.entry.specifier ?? "",
      names: link.entry.names.map((name) => name.name),
    };
    if (link.label === undefined || !serviceLabels.has(link.label)) {
      planned[planned.length] = item;
      continue;
    }
    const at = mergedAt.get(link.label);
    if (at === undefined) {
      mergedAt = mergedAt.set(link.label, planned.length);
      planned[planned.length] = item;
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
  return info.tree.mode === "effi" ? "every-declaration" : "declared";
}

export type Project = {
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
};

type LoadFailure =
  | { readonly tag: "read"; readonly error: ReadError }
  | { readonly tag: "conflict"; readonly other: string }
  | { readonly tag: "bad-name" };

/**
 * Module names become part of identities such as `value:users#getUser` and of
 * emitted error tags, so a name may not contain `#` or other special characters.
 */
function isModuleName(name: string): boolean {
  for (const character of name) {
    const allowed = character >= "A" && character <= "Z" ||
      character >= "a" && character <= "z" ||
      character >= "0" && character <= "9" ||
      "_./-".includes(character);
    if (!allowed) return false;
  }
  return name.length > 0;
}

function emptySpan(source: string): Span {
  return { source: source, start: 0, end: 0 };
}

/** The parse tree, parse diagnostics, and declaration index of one file. */
export type ParsedFile = {
  readonly parsed: ParseResult;
  readonly index: FileIndex;
};

/**
 * Turns the text of a file into its parse result. The default parses every time.
 * A memoizing caller returns the earlier result when the text is equal, so that
 * an unchanged file keeps its syntax tree object.
 */
export type FileParser = (path: string, text: string) => ParsedFile;
export type FilePath = string;
export type SourceText = string;
export type ProjectRoot = string;
export type ProjectEntries = readonly string[];

export function parseFileFresh(path: FilePath, text: SourceText): ParsedFile {
  const parsed = parse(path, text, undefined);
  return { parsed: parsed, index: buildIndex(parsed.tree) };
}

type LoadedFile = {
  readonly path: string;
  readonly name: string;
  readonly parsed: ParseResult;
  readonly index: FileIndex;
};

type Loader = {
  readonly modules: ReadonlyMap<string, ModuleInfo>;
  readonly diagnostics: readonly Diagnostic[];
  readonly addEntry: (raw: string) => Loader;
  readonly run: () => Loader;
};

function Loader(
  host: SourceHost,
  root: string,
  config: ProjectConfig,
  parseFile: FileParser,
): Loader {
  let modules = emptyMap<string, ModuleInfo>();
  let diagnostics: Diagnostic[] = [];
  let pathOfName = emptyMap<string, string>();
  let failures = emptyMap<string, LoadFailure>();
  /** The loaded files in load order. The loop in `run` appends to it. */
  const queue: LoadedFile[] = [];
  let loaded = emptySet<string>();

  /** Loads a file once. Returns the failure when the file cannot be used. */
  function ensure(path: string): LoadFailure | undefined {
    if (loaded.has(path)) return undefined;
    const failed = failures.get(path);
    if (failed !== undefined) return failed;
    const name = moduleNameOf(path);
    if (!isModuleName(name)) {
      const failure: LoadFailure = { tag: "bad-name" };
      failures = failures.set(path, failure);
      return failure;
    }
    const owner = pathOfName.get(name);
    if (owner !== undefined && owner !== path) {
      const failure: LoadFailure = { tag: "conflict", other: owner };
      failures = failures.set(path, failure);
      return failure;
    }
    const read = host.readText(joinPath(root, path));
    if (!read.ok) {
      const failure: LoadFailure = { tag: "read", error: read.error };
      failures = failures.set(path, failure);
      return failure;
    }
    const parsedFile = parseFile(path, read.value);
    pathOfName = pathOfName.set(name, path);
    loaded = loaded.add(path);
    queue[queue.length] = {
      path: path,
      name: name,
      parsed: parsedFile.parsed,
      index: parsedFile.index,
    };
    return undefined;
  }

  function reportFailure(
    path: string,
    failure: LoadFailure,
    span: Span,
  ): Diagnostic[] {
    let diagnostic: Diagnostic;
    if (failure.tag === "conflict") {
      diagnostic = makeDiagnostic(
        "module/001",
        `${path} and ${failure.other} have the same module name`,
        span,
      );
    } else if (failure.tag === "bad-name") {
      diagnostic = makeDiagnostic(
        "module/001",
        `the module path ${path} may contain only letters, digits, and _ . - /`,
        span,
      );
    } else {
      const reason = failure.error.tag === "not-found"
        ? "the file does not exist"
        : `the file cannot be read: ${failure.error.message}`;
      diagnostic = makeDiagnostic(
        "module/002",
        `cannot load ${path}: ${reason}`,
        span,
      );
    }
    diagnostics[diagnostics.length] = diagnostic;
    return diagnostics;
  }

  function reportForbidden(
    importer: string,
    target: string,
    span: Span,
  ): Diagnostic[] {
    const source = moduleNameOf(importer);
    if (importAllowed(config, source, target)) return diagnostics;
    diagnostics[diagnostics.length] = makeDiagnostic(
      "module/005",
      `module \`${source}\` cannot import \`${target}\` under the project import rules`,
      span,
    );
    return diagnostics;
  }

  function addEntry(raw: string): Loader {
    const path = normalizeRelative(raw);
    if (path === undefined) {
      diagnostics[diagnostics.length] = makeDiagnostic(
        "module/001",
        `the entry path \`${raw}\` is not a path inside the project root`,
        emptySpan(raw),
      );
      return self;
    }
    if (!isModulePath(path)) {
      diagnostics[diagnostics.length] = makeDiagnostic(
        "module/001",
        `the entry path \`${path}\` does not end in .eff or .effi`,
        emptySpan(path),
      );
      return self;
    }
    const failure = ensure(path);
    if (failure !== undefined) {
      diagnostics = reportFailure(path, failure, emptySpan(path));
    }
    return self;
  }

  function linkImport(importer: string, entry: ImportEntry): ImportLink {
    const unlinked: ImportLink = {
      entry: entry,
      target: undefined,
      label: undefined,
      isHost: false,
    };
    const specifier = entry.specifier;
    const span = entry.specifierSpan;
    if (specifier === undefined || span === undefined) return unlinked;
    const importSpan = span;
    function bad(message: string): ImportLink {
      diagnostics[diagnostics.length] = makeDiagnostic(
        "module/001",
        message,
        importSpan,
      );
      return unlinked;
    }
    if (isHostLabel(specifier)) {
      const key = hostKeyOf(specifier);
      const registered = config.host.get(key);
      if (registered === undefined) {
        diagnostics[diagnostics.length] = makeDiagnostic(
          "module/002",
          `host module \`${key}\` is not registered in ${CONFIG_FILE}`,
          span,
        );
        return { ...unlinked, isHost: true };
      }
      const failure = ensure(registered.interfacePath);
      if (failure !== undefined) {
        diagnostics = reportFailure(registered.interfacePath, failure, span);
        return { ...unlinked, isHost: true };
      }
      diagnostics = reportForbidden(importer, specifier, span);
      return {
        entry: entry,
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
    const failure = ensure(resolved);
    if (failure !== undefined) {
      diagnostics = reportFailure(resolved, failure, span);
      return unlinked;
    }
    const name = moduleNameOf(resolved);
    diagnostics = reportForbidden(importer, name, span);
    return { entry: entry, target: name, label: name, isHost: false };
  }

  /** Loads every module that the entries reach and builds module records in load order. */
  function run(): Loader {
    for (const loadedFile of queue.values()) {
      modules = modules.set(loadedFile.name, {
        name: loadedFile.name,
        path: loadedFile.path,
        tree: loadedFile.parsed.tree,
        parseDiagnostics: loadedFile.parsed.diagnostics,
        index: loadedFile.index,
        links: loadedFile.index.imports.map((entry) =>
          linkImport(loadedFile.path, entry)
        ),
      });
    }
    return self;
  }

  const self: Loader = {
    modules: modules,
    diagnostics: diagnostics,
    addEntry: addEntry,
    run: run,
  };
  return self;
}

type GraphResult = {
  readonly graph: ReadonlyMap<string, readonly string[]>;
  readonly order: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
};

function linkModules(
  modules: ReadonlyMap<string, ModuleInfo>,
): GraphResult {
  const sorted = [...modules].sort((left, right) =>
    compareText(left[0], right[0])
  );
  const names = sorted.map((entry) => entry[0]);
  // Module names are sorted, so ascending indexes keep the order of `names`.
  const position = mapFrom(
    names.map((name, index): readonly [string, number] => [name, index]),
  );
  let graph = emptyMap<string, readonly string[]>();
  const edges: (readonly number[])[] = [];
  for (const moduleEntry of sorted) {
    const name = moduleEntry[0];
    const info = moduleEntry[1];
    let targets = emptySet<number>();
    for (const link of info.links) {
      const at = link.target === undefined
        ? undefined
        : position.get(link.target);
      if (at !== undefined) targets = targets.add(at);
    }
    const indexes = [...targets].sort((a, b) => a - b);
    graph = graph.set(name, indexes.map((index) => names[index]));
    edges[edges.length] = indexes;
  }
  const order: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const indexes of stronglyConnectedComponents(names.length, edges)) {
    const component = indexes.map((i) => sorted[i]);
    for (const moduleEntry of component) {
      order[order.length] = moduleEntry[0];
    }
    if (isCycle(indexes, edges)) {
      diagnostics[diagnostics.length] = cycleDiagnostic(component);
    }
  }
  return { graph: graph, order: order, diagnostics: diagnostics };
}

function cycleDiagnostic(
  component: readonly (readonly [string, ModuleInfo])[],
): Diagnostic {
  const names = component.map((entry) => entry[0]);
  const members = setFrom(names);
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
  root: ProjectRoot,
  entries: ProjectEntries,
  parseFile: FileParser | undefined,
): Result<Project, ConfigError> {
  const configResult = readConfig(host, root);
  if (!configResult.ok) return configResult;
  const config = configResult.value.config;
  let loader = Loader(host, root, config, parseFile ?? parseFileFresh);
  for (const entry of entries) loader = loader.addEntry(entry);
  loader = loader.run();
  const linked = linkModules(loader.modules);
  return {
    ok: true,
    value: {
      root: root,
      config: config,
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
