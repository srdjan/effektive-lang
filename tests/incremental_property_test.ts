// A property test of the incremental program: after every edit, a long-lived
// `Program` gives the same result as a new `Program` and as the old driver
// (`checkProject` with `lowerProject`) for the same files. The comparison is the
// oracle. A second long-lived `Program` keeps its revisions without a query, so
// later edits run first. The final queries must give the recorded results. The
// literal counts prove that the sequence reached error states.

import { assertEquals } from "@std/assert";
import {
  allFiles,
  applyAliasEdit,
  applyBodyEdit,
  applyInterfaceEdit,
  applyModeFlipEdit,
  type GeneratedProject,
  generateProject,
  makeRandom,
} from "../bench/generate.ts";
import {
  checkProject,
  compareText,
  errorMessage,
  lowerProject,
  memoryHost,
  type ModuleIR,
  Program,
  type Result,
  type Revision,
  serializeModule,
} from "../src/core/frontend.ts";
import type { LowerError } from "../src/core/frontend.ts";
import {
  serializeSourceMap,
  TypeScriptOutputs,
} from "../src/core/typescript.ts";

type Files = ReadonlyMap<string, string>;
type Random = () => number;
type Observation = Readonly<Record<string, unknown>>;

const DECLARATIONS = 30;

const EDIT_KINDS = [
  "signature",
  "alias",
  "flip",
  "config",
  "host",
  "span",
  "syntax",
  "type",
  "restore",
  "remove",
] as const;

type StepKind = "body" | typeof EDIT_KINDS[number];

interface Step {
  readonly kind: StepKind;
  readonly set: Files;
  readonly remove: readonly string[];
}

// ------------------------------------------------------------------ observation

function lowerResult(
  result: Result<ModuleIR, LowerError> | undefined,
): unknown {
  return result?.ok ? serializeModule(result.value) : result;
}

/** Everything a revision reports, for a clean revision and for an error step. */
function observe(revision: Revision, outputs: TypeScriptOutputs): Observation {
  const names = revision.moduleNames();
  const lowered = new Map<string, Result<ModuleIR, LowerError>>();
  for (const name of names) {
    const result = revision.lowered(name);
    if (result !== undefined) lowered.set(name, result);
  }
  const validation = revision.validate(lowered);
  const observation: Record<string, unknown> = {
    diagnostics: revision.diagnostics,
    modules: names,
  };
  for (const name of names) {
    const emitted = outputs.emitted(revision, name);
    const map = outputs.sourceMap(revision, name);
    observation[`${name} lowered`] = lowerResult(lowered.get(name));
    observation[`${name} validation`] = validation.get(name);
    observation[`${name} emitted`] = emitted?.ok ? emitted.value.text : emitted;
    observation[`${name} spans`] = outputs.spanTable(revision, name);
    observation[`${name} map`] = map?.ok ? serializeSourceMap(map.value) : map;
    observation[`${name} interface`] = revision.interfaceHash(name);
  }
  return observation;
}

function observeProgram(
  program: Program,
  outputs: TypeScriptOutputs,
  step: { readonly set?: Files; readonly remove?: readonly string[] },
): { readonly observation: Observation; readonly revision?: Revision } {
  const result = program.update(step);
  return result.ok
    ? { observation: observe(result.value, outputs), revision: result.value }
    : { observation: { config: result.error } };
}

/** The old driver. It has diagnostics and IR, and no interface or output. */
function observeDriver(files: Files): Observation {
  const entries = [...files.keys()].filter((path) => path.endsWith(".eff"))
    .sort(compareText);
  const checked = checkProject(memoryHost(files), "", entries);
  if (!checked.ok) return { config: checked.error };
  const lowered = lowerProject(checked.value);
  const observation: Record<string, unknown> = {
    diagnostics: checked.value.diagnostics,
    modules: [...lowered.keys()],
  };
  for (const [name, result] of lowered) {
    observation[`${name} lowered`] = lowerResult(result);
  }
  return observation;
}

function assertCovers(actual: Observation, expected: Observation): void {
  for (const key of Object.keys(expected)) {
    assertEquals(actual[key], expected[key], key);
  }
}

// ------------------------------------------------------------------ the edits

function choose<T>(rng: Random, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("choose: no items");
  return item;
}

function shuffled<T>(rng: Random, items: readonly T[]): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const [item] = rest.splice(Math.floor(rng() * rest.length), 1);
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** The return type of the `link` function. The importer calls `link`. */
function applyLinkSignatureEdit(text: string): string {
  return text.replace(
    /(export const link\d+ = \(n: Int\): )(Int|Num)/,
    (_match, head: string, type: string) =>
      `${head}${type === "Int" ? "Num" : "Int"}`,
  );
}

/** The body of the `link` function. The interface does not change. */
function applyLinkBodyEdit(text: string, revision: number): string {
  return text.replace(
    /(export const link\d+ = \(n: Int\): (?:Int|Num) => n \+ )\d+/,
    `$1${revision}`,
  );
}

/** An alias in `base.eff` that the feature modules use. */
function applyBaseAliasEdit(text: string): string {
  return text.replace(
    /export type Num = (number|int)\n/,
    (_match, type: string) =>
      `export type Num = ${type === "number" ? "int" : "number"}\n`,
  );
}

/** A line that no parse accepts, at the start of a seeded line. */
function applySyntaxError(text: string, rng: Random): string {
  const at = text.lastIndexOf("\n", Math.floor(rng() * text.length)) + 1;
  return `${text.slice(0, at)}const = =\n${text.slice(at)}`;
}

function applyTypeError(text: string, revision: number): string {
  return `${text}\nexport const wrong${revision}: Int = "text"\n`;
}

/** Moves every span of the module. The declarations stay the same. */
function applySpanEdit(text: string, revision: number): string {
  return `// revision ${revision}\n${text}`;
}

/** Adds or removes a permissive import policy. */
function applyConfigImportsEdit(text: string): string {
  const policy =
    '  "imports": [{ "from": "**", "allow": ["**", "host:*"] }],\n';
  return text.includes(policy)
    ? text.replace(policy, "")
    : text.replace("{\n", `{\n${policy}`);
}

/** Adds or removes an unused service from the provider contract. */
function applyHostSignatureEdit(text: string): string {
  return text.includes("provides Store | Gate")
    ? text.replace("provides Store | Gate", "provides Store")
    : text.replace("provides Store\n", "provides Store | Gate\n");
}

/**
 * Generates the edits. `clean` holds the text that the edits build on. An error
 * step, a restore, and a removal change only `files`, so the next edit of the
 * path, or a seeded repair, leaves the error state.
 */
class EditSequence {
  readonly files: Map<string, string>;
  private readonly clean: Map<string, string>;
  private readonly seen: { readonly path: string; readonly text: string }[];
  private readonly targets: readonly string[];

  constructor(
    private readonly project: GeneratedProject,
    private readonly rng: Random,
  ) {
    this.files = allFiles(project);
    this.clean = new Map(this.files);
    this.targets = [project.edit.path, project.edit.importer, "base.eff"];
    this.seen = this.targets.map((path) => ({
      path,
      text: this.cleanText(path),
    }));
  }

  private cleanText(path: string): string {
    const text = this.clean.get(path);
    if (text === undefined) throw new Error(`no text for ${path}`);
    return text;
  }

  /** The changes that return every other changed file to its clean text. */
  private repairs(except: string): Map<string, string> {
    const set = new Map<string, string>();
    if (this.rng() < 0.5) return set;
    for (const [path, text] of this.clean) {
      if (path !== except && this.files.get(path) !== text) set.set(path, text);
    }
    return set;
  }

  private edit(kind: StepKind, path: string, change: (text: string) => string) {
    const before = this.cleanText(path);
    const after = change(before);
    if (after === before) throw new Error(`the ${kind} edit changed nothing`);
    return { kind, path, after };
  }

  private textEdit(kind: StepKind, revision: number) {
    const { rng, project } = this;
    const main = project.edit.path;
    switch (kind) {
      case "body":
        return choose(rng, [
          () => this.edit(kind, main, (t) => applyBodyEdit(t, revision)),
          () => this.edit(kind, main, (t) => applyLinkBodyEdit(t, revision)),
        ])();
      case "signature":
        return choose(rng, [
          () => this.edit(kind, main, applyInterfaceEdit),
          () => this.edit(kind, main, applyLinkSignatureEdit),
        ])();
      case "alias":
        return choose(rng, [
          () => this.edit(kind, main, applyAliasEdit),
          () => this.edit(kind, "base.eff", applyBaseAliasEdit),
        ])();
      case "flip":
        return this.edit(kind, main, applyModeFlipEdit);
      case "config":
        return this.edit(kind, "effektive.json", applyConfigImportsEdit);
      case "host":
        return this.edit(
          kind,
          "host/providers.effi",
          applyHostSignatureEdit,
        );
      case "span":
        return this.edit(
          kind,
          choose(rng, this.targets),
          (t) => applySpanEdit(t, revision),
        );
      case "syntax":
        return this.edit(
          kind,
          choose(rng, this.targets),
          (t) => applySyntaxError(t, rng),
        );
      case "type":
        return this.edit(
          kind,
          choose(rng, this.targets),
          (t) => applyTypeError(t, revision),
        );
      default:
        throw new Error(`${kind} is not a text edit`);
    }
  }

  private commit(
    kind: StepKind,
    set: Map<string, string>,
    remove: readonly string[],
  ): Step {
    for (const [path, text] of set) {
      this.files.set(path, text);
      this.seen.push({ path, text });
    }
    for (const path of remove) this.files.delete(path);
    return { kind, set, remove };
  }

  next(kind: StepKind, revision: number): Step {
    if (kind === "remove") {
      const present = this.targets.filter((path) => this.files.has(path));
      const path = choose(this.rng, present);
      return this.commit(kind, this.repairs(path), [path]);
    }
    if (kind === "restore") {
      const earlier = this.seen.filter(({ path, text }) =>
        this.files.get(path) !== text
      );
      const { path, text } = choose(this.rng, earlier);
      return this.commit(
        kind,
        new Map([...this.repairs(path), [path, text]]),
        [],
      );
    }
    const { path, after } = this.textEdit(kind, revision);
    const keepsError = kind === "syntax" || kind === "type";
    if (!keepsError) this.clean.set(path, after);
    return this.commit(
      kind,
      new Map([...this.repairs(path), [path, after]]),
      [],
    );
  }
}

// ------------------------------------------------------------------ the property

interface Tally {
  readonly steps: number;
  readonly retained: number;
  readonly clean: number;
  readonly withDiagnostics: number;
  readonly lowered: number;
  readonly failed: number;
  readonly emitted: number;
  /** The sorted categories of the diagnostic codes that the sequence reached. */
  readonly categories: readonly string[];
  readonly byKind: Readonly<Record<string, number>>;
}

interface Retained {
  readonly label: string;
  readonly revision: Revision;
  readonly expected: Observation;
}

function runSequence(seed: number): Tally {
  const project = generateProject({ declarations: DECLARATIONS, seed });
  const rng = makeRandom(seed);
  const sequence = new EditSequence(project, rng);
  const program = new Program("");
  const outputs = new TypeScriptOutputs();
  const unqueried = new Program("");
  const retained: Retained[] = [];
  const kinds: StepKind[] = [
    "body",
    ...shuffled(rng, EDIT_KINDS),
    "body",
    ...shuffled(rng, EDIT_KINDS),
  ];

  const byKind: Record<string, number> = {};
  const categories = new Set<string>();
  let clean = 0;
  let withDiagnostics = 0;
  let lowered = 0;
  let failed = 0;
  let emitted = 0;

  const check = (
    label: string,
    step: { readonly set?: Files; readonly remove?: readonly string[] },
  ): void => {
    try {
      const incremental = observeProgram(program, outputs, step);
      const fresh = observeProgram(new Program(""), new TypeScriptOutputs(), {
        set: sequence.files,
      });
      assertEquals(
        Object.keys(incremental.observation),
        Object.keys(fresh.observation),
        "observation keys",
      );
      assertCovers(incremental.observation, fresh.observation);
      assertCovers(incremental.observation, observeDriver(sequence.files));

      const kept = unqueried.update(step);
      if (kept.ok) {
        retained.push({
          label,
          revision: kept.value,
          expected: incremental.observation,
        });
      }

      const revision = incremental.revision;
      if (revision === undefined) return;
      if (revision.diagnostics.length === 0) clean++;
      else withDiagnostics++;
      for (const { code } of revision.diagnostics) {
        categories.add(code.split("/")[0] ?? code);
      }
      for (const name of revision.moduleNames()) {
        if (revision.lowered(name)?.ok) lowered++;
        else failed++;
        if (outputs.emitted(revision, name)?.ok) emitted++;
      }
    } catch (error) {
      throw new Error(`seed ${seed}, ${label}: ${errorMessage(error)}`);
    }
  };

  check("step 0 (start)", { set: sequence.files });
  byKind["start"] = 1;
  for (const [index, kind] of kinds.entries()) {
    const number = index + 1;
    const step = sequence.next(kind, number + 1);
    check(`step ${number} (${kind})`, step);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const lateOutputs = new TypeScriptOutputs();
  for (const { label, revision, expected } of retained) {
    try {
      assertCovers(observe(revision, lateOutputs), expected);
    } catch (error) {
      throw new Error(
        `seed ${seed}, retained ${label}: ${errorMessage(error)}`,
      );
    }
  }
  return {
    steps: kinds.length + 1,
    retained: retained.length,
    clean,
    withDiagnostics,
    lowered,
    failed,
    emitted,
    categories: [...categories].sort(compareText),
    byKind,
  };
}

/** Every sequence has the same shape, whatever its seed. */
const SHAPE = {
  steps: 23,
  retained: 23,
  byKind: {
    start: 1,
    body: 2,
    signature: 2,
    alias: 2,
    flip: 2,
    config: 2,
    host: 2,
    span: 2,
    syntax: 2,
    type: 2,
    restore: 2,
    remove: 2,
  },
};

const CASES = [
  {
    "seed": 1,
    "clean": 3,
    "withDiagnostics": 20,
    "lowered": 51,
    "failed": 39,
    "emitted": 51,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 2,
    "clean": 10,
    "withDiagnostics": 13,
    "lowered": 69,
    "failed": 20,
    "emitted": 69,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 3,
    "clean": 2,
    "withDiagnostics": 21,
    "lowered": 56,
    "failed": 34,
    "emitted": 56,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 4,
    "clean": 14,
    "withDiagnostics": 9,
    "lowered": 78,
    "failed": 10,
    "emitted": 78,
    "categories": [
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 5,
    "clean": 4,
    "withDiagnostics": 19,
    "lowered": 64,
    "failed": 26,
    "emitted": 64,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 6,
    "clean": 8,
    "withDiagnostics": 15,
    "lowered": 54,
    "failed": 35,
    "emitted": 54,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 7,
    "clean": 11,
    "withDiagnostics": 12,
    "lowered": 75,
    "failed": 15,
    "emitted": 75,
    "categories": [
      "syntax",
      "type-mismatch",
    ],
  },
  {
    "seed": 8,
    "clean": 3,
    "withDiagnostics": 20,
    "lowered": 61,
    "failed": 26,
    "emitted": 61,
    "categories": [
      "module",
      "syntax",
      "type-mismatch",
    ],
  },
];

for (const { seed, ...counts } of CASES) {
  Deno.test(`an incremental update equals a fresh run for seed ${seed}`, () => {
    assertEquals(runSequence(seed), { ...counts, ...SHAPE });
  });
}
