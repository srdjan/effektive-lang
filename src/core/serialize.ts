// Serialization of typed IR (spec, "Equations and validation", row
// Serialization): sets are sorted and unique, and literals are finite.
//
// The output is canonical JSON: object keys in sorted order, two-space
// indentation, and a trailing newline. A key with an `undefined` value is left
// out. The check runs before the text is produced, so a bad module gives an
// error value and no text.

import { canonicalJsonIndented } from "./content_id.ts";
import type { ModuleIR } from "./ir.ts";
import type { Result } from "./source.ts";
import { compareText, isRecord } from "./util.ts";

type SerializeError =
  /** A failure, requirement, or provides set that is not sorted, or that repeats an entry. */
  | {
    readonly tag: "unsorted-set";
    /** Where the list sits, as `declarations[2].body.effects.failures`. */
    readonly path: string;
  }
  /** A number literal that is `NaN` or infinite. */
  | { readonly tag: "non-finite-number"; readonly path: string };

const SET_KEYS: readonly string[] = [
  "failures",
  "requirements",
  "decodeRequirements",
  "encodeRequirements",
  "provides",
];

/** True when the list holds strings in strictly increasing order. */
function isSortedUnique(list: readonly unknown[]): boolean {
  let previous: string | undefined;
  for (const item of list) {
    if (typeof item !== "string") return false;
    if (previous !== undefined && compareText(previous, item) >= 0) {
      return false;
    }
    previous = item;
  }
  return true;
}

/** Finds the first violation in tree order, or undefined. */
function findProblem(value: unknown, path: string): SerializeError | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? undefined
      : { tag: "non-finite-number", path: path };
  }
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const i of value.keys()) {
      const problem = findProblem(value[i], `${path}[${i}]`);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const record = value;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (
      SET_KEYS.includes(key) && Array.isArray(item) && !isSortedUnique(item)
    ) {
      return { tag: "unsorted-set", path: `${path}.${key}` };
    }
    const problem = findProblem(item, `${path}.${key}`);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * The canonical JSON text of a module. The result is an error value when an
 * effect set is not sorted and unique or when a number literal is not finite.
 */
export function serializeModule(
  module: ModuleIR,
): Result<string, SerializeError> {
  const problem = findProblem(module, "$");
  if (problem !== undefined) return { ok: false, error: problem };
  return { ok: true, value: `${canonicalJsonIndented(module)}\n` };
}
