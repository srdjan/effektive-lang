// Concrete TypeScript orchestration. Frontend queries do not import this module.
import type { Revision } from "./db.ts";
import type { ModuleIR } from "./ir.ts";
import type { LowerError } from "./lower.ts";
import {
  declarationTypeText,
  type EmitContext,
  type EmitError,
  emitModule,
} from "./emit/emit.ts";
import type { EmittedModule } from "./emit/emitted_module.ts";
import { buildSpanTable, hostNameSpans, type SpanTable } from "./emit/spans.ts";
import {
  buildSourceMap,
  type SourceMapError,
  type SourceMapV3,
} from "./emit/sourcemap.ts";
import { sourceHoverAt } from "./editor.ts";
import type { Result, Span } from "./source.ts";

export type EmitProjectError =
  | EmitError
  | {
    readonly tag: "lowering";
    readonly module: string;
    readonly error: LowerError;
  };

/**
 * Emits every lowered module of a project, in the order of `lowered`. A module
 * whose lowering failed gives a `lowering` error and no text.
 */
export function emitProject(
  lowered: ReadonlyMap<string, Result<ModuleIR, LowerError>>,
  context: EmitContext,
): ReadonlyMap<string, Result<EmittedModule, EmitProjectError>> {
  const results = new Map<string, Result<EmittedModule, EmitProjectError>>();
  for (const [name, result] of lowered) {
    if (!result.ok) {
      results.set(name, {
        ok: false,
        error: { tag: "lowering", module: name, error: result.error },
      });
      continue;
    }
    results.set(name, emitModule(result.value, context));
  }
  return results;
}

interface OutputEntry {
  emitted?: Result<EmittedModule, EmitProjectError>;
  table?: Result<SpanTable, EmitProjectError>;
  map?: Result<SourceMapV3, EmitProjectError | SourceMapError>;
}

/** One output cache per program/session. Reused lowerings reuse outputs without retaining revisions. */
export class TypeScriptOutputs {
  private readonly entries = new WeakMap<
    Result<ModuleIR, LowerError>,
    OutputEntry
  >();
  private emits = 0;

  get counts(): { readonly emits: number } {
    return { emits: this.emits };
  }

  private entry(revision: Revision, name: string): OutputEntry | undefined {
    const lowered = revision.lowered(name);
    if (lowered === undefined) return undefined;
    let entry = this.entries.get(lowered);
    if (entry === undefined) {
      entry = {};
      this.entries.set(lowered, entry);
    }
    return entry;
  }

  emitted(
    revision: Revision,
    name: string,
  ): Result<EmittedModule, EmitProjectError> | undefined {
    const entry = this.entry(revision, name);
    if (entry === undefined) return undefined;
    if (entry.emitted === undefined) {
      const lowered = revision.lowered(name)!;
      this.emits++;
      entry.emitted = lowered.ok
        ? emitModule(lowered.value, { config: revision.config })
        : {
          ok: false,
          error: { tag: "lowering", module: name, error: lowered.error },
        };
    }
    return entry.emitted;
  }

  spanTable(
    revision: Revision,
    name: string,
  ): Result<SpanTable, EmitProjectError> | undefined {
    const entry = this.entry(revision, name);
    const emitted = this.emitted(revision, name);
    if (entry === undefined || emitted === undefined) return undefined;
    if (entry.table === undefined) {
      const names = hostNameSpans(revision.moduleInfo(name)?.links ?? []);
      entry.table = emitted.ok
        ? { ok: true, value: buildSpanTable(emitted.value, names) }
        : emitted;
    }
    return entry.table;
  }

  sourceMap(
    revision: Revision,
    name: string,
  ): Result<SourceMapV3, EmitProjectError | SourceMapError> | undefined {
    const entry = this.entry(revision, name);
    const table = this.spanTable(revision, name);
    if (entry === undefined || table === undefined) return undefined;
    if (entry.map === undefined) {
      entry.map = table.ok
        ? buildSourceMap(table.value, revision.sourceTexts())
        : table;
    }
    return entry.map;
  }
}

/** The generated text that a client shows for one module. */
interface GeneratedOutput {
  readonly text: string;
  /** True when the text comes from an earlier emit, because the newest emit failed. */
  readonly stale: boolean;
}

/** The new last good text of a module and the output to show after one emit. */
interface OutputStep {
  readonly lastGood: string | undefined;
  /** `null`: no emit of the module has ever succeeded. */
  readonly output: GeneratedOutput | null;
}

/**
 * The stale-output rule. A successful emit gives its text, and that text becomes
 * the last good text. A failed or missing emit gives the last good text, marked
 * stale, or no output when no emit has succeeded.
 */
export function stepOutput(
  lastGood: string | undefined,
  emitted: Result<EmittedModule, EmitProjectError> | undefined,
): OutputStep {
  if (emitted !== undefined && emitted.ok) {
    const text = emitted.value.text;
    return { lastGood: text, output: { text, stale: false } };
  }
  return {
    lastGood,
    output: lastGood === undefined ? null : { text: lastGood, stale: true },
  };
}

/** The text that a client shows when the backend type is not available. */
export const BACKEND_UNAVAILABLE_TEXT =
  "backend type: not available while the module has errors";

export type HoverBackend = { readonly tag: "type"; readonly text: string } | {
  readonly tag: "unavailable";
};
interface Hover {
  readonly span: Span;
  readonly contract: string;
  readonly backend: HoverBackend | undefined;
}

function backendOf(
  revision: Revision,
  module: string,
  id: string,
  outputs: TypeScriptOutputs,
): HoverBackend {
  const unavailable: HoverBackend = { tag: "unavailable" };
  if (!outputs.emitted(revision, module)?.ok) return unavailable;
  const lowered = revision.lowered(module);
  if (lowered === undefined || !lowered.ok) return unavailable;
  const ir: ModuleIR = lowered.value;
  const text = declarationTypeText(ir, { config: revision.config }, id);
  return text.ok ? { tag: "type", text: text.value } : unavailable;
}

export function hoverAt(
  revision: Revision,
  path: string,
  offset: number,
  outputs: TypeScriptOutputs,
): Hover | undefined {
  const source = sourceHoverAt(revision, path, offset);
  if (source === undefined) return undefined;
  const { span, contract, declaration } = source;
  const module = revision.moduleInfoAt(path)!;
  return {
    span,
    contract,
    backend: declaration === undefined
      ? undefined
      : backendOf(revision, module.name, declaration, outputs),
  };
}

export { emitModule } from "./emit/emit.ts";
export type { EmitContext } from "./emit/emit.ts";
export type { EmittedModule } from "./emit/emitted_module.ts";
export {
  buildSpanTable,
  hostImportSpans,
  mapOffset,
  offsetOfGenerated,
  recordAtOffset,
  type SpanTable,
} from "./emit/spans.ts";
export {
  buildSourceMap,
  encodeVlq,
  serializeSourceMap,
  type SourceMapError,
  type SourceMapV3,
} from "./emit/sourcemap.ts";
export {
  hostModulePaths,
  mapTscDiagnostic,
  parseDenoCheck,
  type TscDiagnostic,
  type TscMapping,
} from "./emit/tsc.ts";
