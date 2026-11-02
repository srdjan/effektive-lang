// The named corpus of compiler behavior. The runner in this file runs the
// corpus through the public entry points of one source tree and writes one
// record for each result. A record has a kind, a case name, and the full
// canonical JSON text of the result. `scripts/behavior_compare.ts` runs this
// file in the exported trees of two revisions and compares the records.
//
// The runner reaches a compiler only through `loadCore`. When an older revision
// has another API, only `loadCore` changes. This file imports nothing from
// `src/`, so the same file runs in the tree of any revision.
//
// Record kinds:
//   check          the diagnostics of `checkProject`
//   program        the diagnostics of a successful `Program.update`
//   program-error  the `ConfigError` of a failed `Program.update`
//   lower          the `serializeModule` text of a lowered module
//   lower-error    the `LowerError` of a failed lowering, or a thrown message
//   emit           the emitted module and its source map
//   emit-error     the `EmitError` of a failed emission, or a thrown message
//   validate       the validator result
//
// Run `deno task behavior:compare` to use the corpus. To run the runner alone:
//   deno run -A scripts/behavior_corpus.ts --tree <root> --fixtures <dir>
//     --out <file> [--only <prefix>]...

// ------------------------------------------------------------------ records

export const KINDS = [
  "check",
  "program",
  "program-error",
  "lower",
  "lower-error",
  "emit",
  "emit-error",
  "validate",
] as const;

export type Kind = (typeof KINDS)[number];

/** One result of the corpus: a kind, a case name, and the canonical JSON text. */
export interface Rec {
  readonly kind: Kind;
  readonly name: string;
  readonly text: string;
}

export type Res<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The canonical JSON text of a value: object keys sorted, a Map as its entry
 * list in insertion order, a Set as its member list, an undefined property
 * left out. A cycle gives the text `"[cycle]"`.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<unknown>();
  const write = (v: unknown): string => {
    if (v === undefined) return "null";
    if (v === null || typeof v === "boolean" || typeof v === "string") {
      return JSON.stringify(v);
    }
    if (typeof v === "number") {
      return Number.isFinite(v) ? JSON.stringify(v) : JSON.stringify(String(v));
    }
    if (typeof v === "bigint") return JSON.stringify(`${v}n`);
    if (typeof v === "function" || typeof v === "symbol") {
      return JSON.stringify(`[${typeof v}]`);
    }
    if (seen.has(v)) return JSON.stringify("[cycle]");
    seen.add(v);
    try {
      if (Array.isArray(v)) return `[${v.map(write).join(",")}]`;
      if (v instanceof Map) {
        return `{"$map":[${
          [...v].map(([k, x]) => `[${write(k)},${write(x)}]`).join(",")
        }]}`;
      }
      if (v instanceof Set) return `{"$set":[${[...v].map(write).join(",")}]}`;
      if (v instanceof Error) {
        return write({ name: v.name, message: v.message });
      }
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${
        entries.map(([k, x]) => `${JSON.stringify(k)}:${write(x)}`).join(",")
      }}`;
    } finally {
      seen.delete(v);
    }
  };
  return write(value);
}

// ------------------------------------------------------------------ the adapter

/** The part of a checked project that the runner reads. */
export interface CheckedLike {
  readonly diagnostics: readonly unknown[];
  readonly modules: ReadonlyMap<string, unknown>;
  readonly analysis: { readonly project: ProjectLike };
}

export interface ProjectLike {
  readonly config: unknown;
  readonly modules: ReadonlyMap<
    string,
    { readonly path: string; readonly tree: { readonly text: string } }
  >;
}

export interface Changes {
  readonly set?: Readonly<Record<string, string>>;
  readonly remove?: readonly string[];
}

export interface ProgramLike {
  update(changes: Changes): Res<{ readonly diagnostics: unknown }>;
}

/** The compiler entry points that the corpus uses. */
export interface CoreApi {
  check(
    files: Readonly<Record<string, string>>,
    entries: readonly string[],
  ): Res<CheckedLike>;
  lower(checked: CheckedLike, module: string): Res<unknown>;
  /** The project with every diagnostic removed, so that lowering runs. */
  withoutDiagnostics(checked: CheckedLike): CheckedLike;
  /** The `serializeModule` text. A revision that returns a bare string gives a success. */
  serialize(ir: unknown): Res<string>;
  emit(ir: unknown, config: unknown): Res<unknown>;
  /** The source map of an emitted module, or an error value. */
  sourceMap(emitted: unknown, project: ProjectLike): unknown;
  validateProject(
    project: ProjectLike,
    lowered: ReadonlyMap<string, Res<unknown>>,
  ): unknown;
  validateModule(ir: unknown, sources: ReadonlyMap<string, string>): unknown;
  program(): ProgramLike;
  /** An empty project configuration. */
  emptyConfig(): unknown;
}

function fileUrl(root: string, path: string): URL {
  return new URL(path, `file://${root.endsWith("/") ? root : root + "/"}`);
}

type Fn = (...args: never[]) => unknown;

function fnOf(module: Record<string, unknown>, name: string): Fn | undefined {
  const value = module[name];
  return typeof value === "function" ? (value as Fn) : undefined;
}

async function importModule(
  root: string,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await import(fileUrl(root, path).href);
  } catch (error) {
    if (error instanceof TypeError || error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Loads the compiler of the tree at `root`. The head layout has
 * `validateProject` in `src/core/validate_project.ts`; an older layout has it in
 * `src/core/frontend.ts`. The error value names the missing entry points.
 */
export async function loadCore(root: string): Promise<Res<CoreApi>> {
  const mod = await importModule(root, "src/core/mod.ts");
  if (mod === undefined) {
    return { ok: false, error: `no src/core/mod.ts in ${root}` };
  }
  const projectModule = await importModule(
    root,
    "src/core/validate_project.ts",
  );
  const validatorModule = await importModule(
    root,
    "src/core/validate/index.ts",
  );
  const entries = {
    memoryHost: fnOf(mod, "memoryHost"),
    checkProject: fnOf(mod, "checkProject"),
    lowerModule: fnOf(mod, "lowerModule"),
    serializeModule: fnOf(mod, "serializeModule"),
    emitModule: fnOf(mod, "emitModule"),
    buildSpanTable: fnOf(mod, "buildSpanTable"),
    buildSourceMap: fnOf(mod, "buildSourceMap"),
    validateProject: fnOf(projectModule ?? mod, "validateProject") ??
      fnOf(mod, "validateProject"),
    validateModule: validatorModule &&
      fnOf(validatorModule, "validateModule"),
  };
  const missing = Object.entries(entries).filter(([, f]) => f === undefined)
    .map(([name]) => name);
  const program = mod["Program"];
  if (typeof program !== "function") missing.push("Program");
  if (missing.length > 0) {
    return { ok: false, error: `missing entry points: ${missing.join(", ")}` };
  }
  // Every entry exists. The casts name the shapes that the head API has.
  const e = entries as {
    [K in keyof typeof entries]: (...args: unknown[]) => unknown;
  };
  const Program = program as new () => ProgramLike;
  const api: CoreApi = {
    check: (files, entryPaths) =>
      e.checkProject(e.memoryHost(files), "", entryPaths) as Res<CheckedLike>,
    lower: (checked, module) => e.lowerModule(checked, module) as Res<unknown>,
    withoutDiagnostics: (checked) => ({
      ...checked,
      diagnostics: [],
      modules: new Map(
        [...checked.modules].map((
          [name, m],
        ) => [name, { ...(m as object), diagnostics: [] }]),
      ),
    }),
    serialize: (ir) => {
      const result = e.serializeModule(ir);
      return typeof result === "string"
        ? { ok: true, value: result }
        : result as Res<string>;
    },
    emit: (ir, config) => e.emitModule(ir, { config }) as Res<unknown>,
    sourceMap: (emitted, project) => {
      const table = e.buildSpanTable(emitted);
      const texts = new Map(
        [...project.modules.values()].map((m) => [m.path, m.tree.text]),
      );
      return e.buildSourceMap(table, texts);
    },
    validateProject: (project, lowered) => e.validateProject(project, lowered),
    validateModule: (ir, sources) => e.validateModule(ir, sources),
    program: () => new Program(),
    emptyConfig: () => ({ host: new Map() }),
  };
  return { ok: true, value: api };
}

// ------------------------------------------------------------------ the corpus

export type Files = Readonly<Record<string, string>>;

/** One project: its files, and the entry paths. */
export interface ProjectCase {
  readonly name: string;
  readonly files: Files;
  readonly entries: readonly string[];
}

/** One forged IR with the sources that its spans name. */
export interface ForgedCase {
  readonly name: string;
  readonly ir: unknown;
  readonly sources: Files;
}

/** Named steps of `Program.update` calls. */
export interface Sequence {
  readonly name: string;
  readonly steps: readonly Changes[];
}

export interface Corpus {
  readonly projects: readonly ProjectCase[];
  readonly forged: readonly ForgedCase[];
  readonly sequences: readonly Sequence[];
}

const CLEAN_MAIN = "export type Count = int\n" +
  "export const double = (n: Count): Count => n + n\n";
const BROKEN_MAIN = "export type Count = int\n" +
  'export const double = (n: Count): Count => n + "two"\n';
const CLEAN_USE = 'import { Count, double } from "./main.eff"\n' +
  "export const four = (): Count => double(2)\n";

const HOST_MAIN = 'import { Clock } from "host:sinks"\n' + CLEAN_MAIN;
const HOST_INTERFACE = "export type Tick = int\n" +
  "export service Clock { now(): Tick }\n";

/** The edit sequences. The case names start with `edits/`. */
export const EDIT_SEQUENCES: readonly Sequence[] = [
  {
    name: "type-error-then-revert",
    steps: [
      { set: { "effektive.json": "{}", "main.eff": CLEAN_MAIN } },
      { set: { "main.eff": BROKEN_MAIN } },
      { set: { "main.eff": CLEAN_MAIN } },
    ],
  },
  {
    name: "new-module-then-deletion",
    steps: [
      { set: { "effektive.json": "{}", "main.eff": CLEAN_MAIN } },
      { set: { "use.eff": CLEAN_USE } },
      { remove: ["use.eff"] },
      { remove: ["main.eff"] },
    ],
  },
  {
    name: "invalid-configuration-then-repair",
    steps: [
      { set: { "effektive.json": "{", "main.eff": CLEAN_MAIN } },
      { set: { "effektive.json": "{}" } },
      { remove: ["effektive.json"] },
    ],
  },
  {
    name: "missing-host-module",
    steps: [
      {
        set: {
          "effektive.json": JSON.stringify({
            host: { sinks: { interface: "./host.effi", module: "./host.ts" } },
          }),
          "main.eff": HOST_MAIN,
        },
      },
      { set: { "host.effi": HOST_INTERFACE } },
      { remove: ["host.effi"] },
    ],
  },
];

const SOURCE_FILE = /\.(eff|effi|json)$/;
const LOOSE_ROOTS = ["emit", "errors", "parse", "ir"] as const;

/** Directories whose files form one project without an `effektive.json`. */
const BUNDLES: ReadonlyMap<string, string> = new Map([
  [
    "emit/sinks",
    JSON.stringify({
      host: { sinks: { interface: "./host.effi", module: "./host.ts" } },
    }),
  ],
]);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readTree(root: string, dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (relative: string): void => {
    for (const entry of Deno.readDirSync(`${root}/${relative}`)) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory) walk(child);
      else if (SOURCE_FILE.test(entry.name)) {
        files[child.slice(dir.length + 1)] = Deno.readTextFileSync(
          `${root}/${child}`,
        );
      }
    }
  };
  walk(dir);
  return files;
}

function entriesOf(files: Files): string[] {
  return Object.keys(files).filter((p) => p.endsWith(".eff")).sort(compareText);
}

/** The projects under `fixtures`, found by the rules of the plan SR10. */
export function readProjects(fixtures: string): ProjectCase[] {
  const projects: ProjectCase[] = [];
  const walk = (dir: string, loose: boolean): void => {
    const names = [...Deno.readDirSync(`${fixtures}/${dir}`)]
      .sort((a, b) => compareText(a.name, b.name));
    if (names.some((e) => e.isFile && e.name === "effektive.json")) {
      const files = readTree(fixtures, dir);
      projects.push({ name: dir, files, entries: entriesOf(files) });
      return;
    }
    const bundle = BUNDLES.get(dir);
    if (bundle !== undefined) {
      const files = readTree(fixtures, dir);
      projects.push({
        name: dir,
        files: { ...files, "effektive.json": bundle },
        entries: entriesOf(files),
      });
      return;
    }
    for (const entry of names) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory) walk(child, loose);
      else if (loose && entry.name.endsWith(".eff")) {
        projects.push({
          name: child,
          files: {
            "effektive.json": "{}",
            [entry.name]: Deno.readTextFileSync(`${fixtures}/${child}`),
          },
          entries: [entry.name],
        });
      }
    }
  };
  const top = [...Deno.readDirSync(fixtures)].filter((e) => e.isDirectory)
    .map((e) => e.name).sort(compareText);
  for (const name of top) {
    walk(name, (LOOSE_ROOTS as readonly string[]).includes(name));
  }
  return projects;
}

/** The forged IR files of `fixtures/validate`, with the sources of the manifest. */
export function readForged(fixtures: string): ForgedCase[] {
  const manifest: unknown = JSON.parse(
    Deno.readTextFileSync(`${fixtures}/validate/manifest.json`),
  );
  const sourcesOf = new Map<string, Files>();
  if (isRecord(manifest) && Array.isArray(manifest.fixtures)) {
    for (const item of manifest.fixtures) {
      if (!isRecord(item) || typeof item.file !== "string") continue;
      const sources: Record<string, string> = {};
      if (isRecord(item.sources)) {
        for (const [id, path] of Object.entries(item.sources)) {
          if (typeof path === "string") {
            sources[id] = Deno.readTextFileSync(`${fixtures}/${path}`);
          }
        }
      }
      sourcesOf.set(item.file, sources);
    }
  }
  return [...Deno.readDirSync(`${fixtures}/validate`)]
    .filter((e) =>
      e.isFile && e.name.endsWith(".json") && e.name !== "manifest.json"
    )
    .map((e) => e.name).sort(compareText)
    .map((file) => ({
      name: `validate/${file}`,
      ir: JSON.parse(Deno.readTextFileSync(`${fixtures}/validate/${file}`)),
      sources: sourcesOf.get(file) ?? {},
    }));
}

/** The whole corpus of a head tree. */
export function readCorpus(fixtures: string): Corpus {
  return {
    projects: readProjects(fixtures),
    forged: readForged(fixtures),
    sequences: EDIT_SEQUENCES,
  };
}

// ------------------------------------------------------------------ running

/** True when no prefix is given, or when the name starts with a prefix. */
export function selects(name: string, only: readonly string[]): boolean {
  return only.length === 0 || only.some((p) => name.startsWith(p));
}

/** True when a case can hold a selected record: its name relates to a prefix. */
function mayHold(name: string, only: readonly string[]): boolean {
  return only.length === 0 ||
    only.some((p) => name.startsWith(p) || p.startsWith(name));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rec(kind: Kind, name: string, value: unknown): Rec {
  return { kind, name, text: canonicalJson(value) };
}

/** The record of a step that threw. */
class Thrown {
  constructor(readonly thrown: string) {}
}

/** Runs a step that may throw. A thrown error becomes a `Thrown`. */
function attempt<T>(run: () => T): T | Thrown {
  try {
    return run();
  } catch (error) {
    return new Thrown(messageOf(error));
  }
}

function isThrown<T>(r: T | Thrown): r is Thrown {
  return r instanceof Thrown;
}

function emitRecords(
  core: CoreApi,
  name: string,
  ir: unknown,
  config: unknown,
  project: ProjectLike | undefined,
  out: Rec[],
): void {
  const emitted = attempt(() => core.emit(ir, config));
  if (isThrown(emitted)) {
    out.push(rec("emit-error", name, emitted));
  } else if (emitted.ok) {
    const map = project === undefined
      ? null
      : attempt(() => core.sourceMap(emitted.value, project));
    out.push(rec("emit", name, { module: emitted.value, map }));
  } else {
    out.push(rec("emit-error", name, emitted.error));
  }
}

function lowerRecord(
  core: CoreApi,
  checked: CheckedLike,
  name: string,
  module: string,
  out: Rec[],
): Res<unknown> {
  const lowered = attempt(() => core.lower(checked, module));
  if (isThrown(lowered)) {
    out.push(rec("lower-error", name, lowered));
    return { ok: false, error: lowered };
  }
  if (lowered.ok) {
    const text = attempt(() => core.serialize(lowered.value));
    if (isThrown(text)) out.push(rec("lower-error", name, text));
    else if (text.ok) out.push(rec("lower", name, text.value));
    else out.push(rec("lower-error", name, text.error));
  } else {
    out.push(rec("lower-error", name, lowered.error));
  }
  return lowered;
}

function runProject(core: CoreApi, project: ProjectCase, out: Rec[]): void {
  const checked = attempt(() => core.check(project.files, project.entries));
  if (isThrown(checked)) {
    out.push(rec("check", project.name, checked));
    return;
  }
  if (!checked.ok) {
    out.push(rec("check", project.name, { error: checked.error }));
    return;
  }
  const value = checked.value;
  out.push(rec("check", project.name, value.diagnostics));
  const modules = [...value.modules.keys()];
  if (value.diagnostics.length > 0) {
    const forced = core.withoutDiagnostics(value);
    for (const module of modules) {
      lowerRecord(
        core,
        forced,
        `${project.name}!forced#${module}`,
        module,
        out,
      );
    }
    return;
  }
  const lowered = new Map<string, Res<unknown>>();
  for (const module of modules) {
    const name = `${project.name}#${module}`;
    const result = lowerRecord(core, value, name, module, out);
    lowered.set(module, result);
    if (result.ok) {
      emitRecords(
        core,
        name,
        result.value,
        value.analysis.project.config,
        value.analysis.project,
        out,
      );
    }
  }
  out.push(rec(
    "validate",
    project.name,
    attempt(() => core.validateProject(value.analysis.project, lowered)),
  ));
}

function runForged(core: CoreApi, forged: ForgedCase, out: Rec[]): void {
  const sources = new Map(Object.entries(forged.sources));
  out.push(rec(
    "validate",
    forged.name,
    attempt(() => core.validateModule(forged.ir, sources)),
  ));
  emitRecords(core, forged.name, forged.ir, core.emptyConfig(), undefined, out);
}

function runSequence(core: CoreApi, sequence: Sequence, out: Rec[]): void {
  const program = core.program();
  sequence.steps.forEach((step, index) => {
    const name = `edits/${sequence.name}#${index + 1}`;
    const updated = attempt(() => program.update(step));
    if (isThrown(updated)) {
      out.push(rec("program-error", name, updated));
    } else if (updated.ok) {
      out.push(rec("program", name, updated.value.diagnostics));
    } else {
      out.push(rec("program-error", name, updated.error));
    }
  });
}

/** Runs the corpus and returns its records, sorted by name and kind. */
export function runCorpus(
  core: CoreApi,
  corpus: Corpus,
  only: readonly string[] = [],
): Rec[] {
  const out: Rec[] = [];
  for (const project of corpus.projects) {
    if (mayHold(project.name, only)) runProject(core, project, out);
  }
  for (const forged of corpus.forged) {
    if (mayHold(forged.name, only)) runForged(core, forged, out);
  }
  for (const sequence of corpus.sequences) {
    if (mayHold(`edits/${sequence.name}`, only)) {
      runSequence(core, sequence, out);
    }
  }
  return out.filter((r) => selects(r.name, only)).sort((a, b) =>
    compareText(a.name, b.name) ||
    KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
  );
}

// ------------------------------------------------------------------ command line

if (import.meta.main) {
  const args = [...Deno.args];
  const options: { tree?: string; fixtures?: string; out?: string } = {};
  const only: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (value === undefined) break;
    if (args[i] === "--only") only.push(value);
    else if (args[i] === "--tree") options.tree = value;
    else if (args[i] === "--fixtures") options.fixtures = value;
    else if (args[i] === "--out") options.out = value;
  }
  if (
    options.tree === undefined || options.fixtures === undefined ||
    options.out === undefined
  ) {
    console.error(
      "usage: behavior_corpus.ts --tree <root> --fixtures <dir> --out <file> [--only <prefix>]...",
    );
    Deno.exit(2);
  }
  const core = await loadCore(options.tree);
  if (!core.ok) {
    console.error(String(core.error));
    Deno.exit(2);
  }
  const records = runCorpus(core.value, readCorpus(options.fixtures), only);
  Deno.writeTextFileSync(options.out, JSON.stringify({ records }));
}
