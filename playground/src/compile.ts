// The compile facade of the playground. It keeps one `Program`
// across edits and turns a revision into plain data for the page: diagnostics
// per file, generated TypeScript per `.eff` or `.effi` file, and the time of
// the update.
//
// This file has no DOM code and no Deno API. The clock and the program come in
// through `PlaygroundPorts`, so that a test can supply a fake clock and a
// program double.
//
// Where to start. `createPlayground(files, ports)` copies `files` and compiles
// nothing. `session.start()` sends every file in one `update` and returns the
// first result. `session.update(path, text)` sends one file. When `update` runs
// before `start`, it changes the file and then sends every file, so the first
// call to the program always carries the whole project. A call that ends with
// an `internal` error leaves the project unsent, so the next call sends every
// file again.

import {
  createTypeScriptOutputs,
  type HoverBackend,
  stepOutput,
  type TypeScriptOutputs,
} from "../../src/core/typescript.ts";
import {
  caught,
  type ConfigError,
  describeConfigError,
  errorMessage,
  hoverAt,
  Program,
  type ProgramChanges,
  type Result,
  type Revision,
  type Severity,
} from "../../src/core/mod.ts";
import { emptyMap, mapFrom } from "../../src/core/frontend.ts";

/** The part of `Program` that the facade uses. A test supplies a double. */
export type ProgramPort = {
  readonly update: (
    changes: ProgramChanges,
  ) => Result<Revision, ConfigError>;
};

type PlaygroundPorts = {
  /** The clock, in milliseconds. `performance.now` fits. */
  readonly now: () => number;
  /** The program. The default is `Program("")`. */
  readonly program?: ProgramPort;
  readonly outputs?: TypeScriptOutputs;
};

/** One diagnostic of one file. Offsets are UTF-16 code units, `to` exclusive. */
export type PlaygroundDiagnostic = {
  readonly from: number;
  readonly to: number;
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
};

/** The generated TypeScript of one `.eff` or `.effi` file. */
type PlaygroundOutput = {
  readonly text: string;
  /** True when the text comes from an earlier revision, because this one has errors. */
  readonly stale: boolean;
};

export type PlaygroundResult = {
  /** Every file of the revision, keyed by root-relative path. A clean file has an empty list. */
  readonly diagnostics: Readonly<
    Record<string, readonly PlaygroundDiagnostic[]>
  >;
  /** Every `.eff` and `.effi` file, keyed by its source path. `null` means no output ever existed. */
  readonly outputs: Readonly<Record<string, PlaygroundOutput | null>>;
  /** The time of the update and the emits, from `ports.now`. */
  readonly elapsedMs: number;
};

export type PlaygroundError =
  | { readonly tag: "config"; readonly message: string }
  | { readonly tag: "internal"; readonly message: string };

/** The answer of `hover`. The offsets are in the file that the hover names. */
export type PlaygroundHover = {
  readonly from: number;
  readonly to: number;
  readonly contract: string;
  /** The backend type, `unavailable` while the module has errors, or undefined. */
  readonly backend: HoverBackend | undefined;
};

export interface Playground {
  /** Sends every file and returns the first result. Later calls send every file again. */
  start(): Result<PlaygroundResult, PlaygroundError>;
  /** Changes one file and compiles. */
  update(
    path: string,
    text: string,
  ): Result<PlaygroundResult, PlaygroundError>;
  /** Hover on the last good revision. Undefined after an error result. */
  hover(path: string, offset: number): PlaygroundHover | undefined;
}

function diagnosticsOf(
  revision: Revision,
): Record<string, PlaygroundDiagnostic[]> {
  const result: Record<string, PlaygroundDiagnostic[]> = {};
  for (const path of revision.sourceTexts().keys()) result[path] = [];
  for (const diagnostic of revision.diagnostics) {
    const path = diagnostic.span.source;
    const previous = result[path] ?? [];
    previous[previous.length] = {
      from: diagnostic.span.start,
      to: diagnostic.span.end,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
    };
    result[path] = previous;
  }
  return result;
}

export function createPlayground(
  files: Readonly<Record<string, string>>,
  ports: PlaygroundPorts,
): Playground {
  const outputCache = ports.outputs ?? createTypeScriptOutputs();
  const program: ProgramPort = ports.program ?? Program("");
  let texts = mapFrom<string, string>(Object.entries(files));
  /** The text of the newest emit that succeeded, by source path. */
  let lastGoodText = emptyMap<string, string>();
  let sent = false;
  let lastGood: Revision | undefined;

  function compile(
    changed: string | undefined,
    started: number,
  ): Result<PlaygroundResult, PlaygroundError> {
    const changes: ProgramChanges = sent && changed !== undefined
      ? { set: mapFrom([[changed, texts.get(changed) ?? ""]]) }
      : { set: mapFrom(texts) };
    const updated = program.update(changes);
    sent = true;
    if (!updated.ok) {
      return {
        ok: false,
        error: { tag: "config", message: describeConfigError(updated.error) },
      };
    }
    const revision = updated.value;
    const outputs: Record<string, PlaygroundOutput | null> = {};
    for (const info of revision.moduleInfos()) {
      const path = info.path;
      const step = stepOutput(
        lastGoodText.get(path),
        outputCache.emitted(revision, info.name),
      );
      if (step.lastGood !== undefined) {
        lastGoodText = lastGoodText.set(path, step.lastGood);
      }
      outputs[path] = step.output;
    }
    const diagnostics = diagnosticsOf(revision);
    lastGood = revision;
    return {
      ok: true,
      value: {
        diagnostics: diagnostics,
        outputs: outputs,
        elapsedMs: ports.now() - started,
      },
    };
  }

  function run(
    changed: string | undefined,
  ): Result<PlaygroundResult, PlaygroundError> {
    lastGood = undefined;
    const started = ports.now();
    const compiled = caught(() => compile(changed, started));
    if (!compiled.ok) {
      sent = false;
      return {
        ok: false,
        error: { tag: "internal", message: errorMessage(compiled.error) },
      };
    }
    return compiled.value;
  }

  return {
    start: () => run(undefined),
    update: (path, text) => {
      texts = texts.set(path, text);
      return run(path);
    },
    hover: (path, offset) => {
      if (lastGood === undefined) return undefined;
      const hit = hoverAt(lastGood, path, offset, outputCache);
      if (hit === undefined) return undefined;
      return {
        from: hit.span.start,
        to: hit.span.end,
        contract: hit.contract,
        backend: hit.backend,
      };
    },
  };
}
