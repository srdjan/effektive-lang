// `--tsc`: run `deno check` over the generated files and the host modules with a
// generated configuration, then map each error back to the Effektive source.

import {
  hostModulePaths,
  mapTscDiagnostic,
  parseDenoCheck,
  type ProjectConfig,
  type SpanTable,
} from "../core/mod.ts";
import type { HostIo } from "../host/io.ts";
import type { EventLog } from "../host/log.ts";
import { formatTscMappings, type TextOf } from "./format.ts";
import targetLock from "./target_lock.json" with { type: "json" };

/** The version of Effect that the generated code targets. */
export const EFFECT_VERSION = "4.0.5";

/** The compiler options of the generated check. */
export const TARGET_COMPILER_OPTIONS = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
} as const;

/** The pinned host imports of the generated check. */
export const TARGET_IMPORTS = {
  effect: `npm:effect@${EFFECT_VERSION}`,
  "@effect/platform-node": `npm:@effect/platform-node@${EFFECT_VERSION}`,
} as const;

/** The configuration of the generated check: strict, with pinned host imports. */
export function tscConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: TARGET_COMPILER_OPTIONS,
      imports: TARGET_IMPORTS,
    },
    null,
    2,
  ) + "\n";
}

/** The lockfile of the generated check: it pins the packages behind the host imports. */
export function tscLock(): string {
  return JSON.stringify(targetLock, null, 2) + "\n";
}

interface TscOutcome {
  /** Lines for stdout: one per mapped diagnostic. */
  readonly lines: readonly string[];
  /** Lines for stderr: output that belongs to no diagnostic, and failures of the run. */
  readonly notes: readonly string[];
  /** True when `deno check` reported a diagnostic or failed to run. */
  readonly failed: boolean;
}

/**
 * Runs `deno check` over `generated` (root-relative paths) and over the host
 * modules of the configuration. `tables` maps each generated path to its span table.
 */
export async function runTsc(
  io: HostIo,
  root: string,
  config: ProjectConfig,
  generated: readonly string[],
  tables: ReadonlyMap<string, SpanTable>,
  textOf: TextOf,
  log: EventLog,
): Promise<TscOutcome> {
  const hosts = hostModulePaths(config);
  const files = [...new Set([...generated, ...hosts.keys()])];
  const absolute = io.fs.absolute(root);
  const started = performance.now();
  const run = await io.denoCheck({
    cwd: absolute,
    config: tscConfig(),
    lock: tscLock(),
    files,
  });
  if (!run.ok) {
    log.append("cli.error", {
      message: `cannot run deno check: ${run.error.message}`,
    });
    return {
      lines: [],
      notes: [`error: cannot run deno check: ${run.error.message}`],
      failed: true,
    };
  }
  log.append("cli.tsc", {
    code: run.value.code,
    ms: performance.now() - started,
  });
  const output = parseDenoCheck(run.value.stderr, absolute);
  const mappings = output.diagnostics.map((d) =>
    mapTscDiagnostic(d, tables, hosts)
  );
  const failed = run.value.code !== 0 || output.diagnostics.length > 0;
  const notes = [...output.other];
  if (failed && output.diagnostics.length === 0 && notes.length === 0) {
    notes.push(`error: deno check exited with code ${run.value.code}`);
  }
  return { lines: formatTscMappings(mappings, textOf), notes, failed };
}
