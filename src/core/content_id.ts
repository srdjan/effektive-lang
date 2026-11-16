// The text that content identities hash. Emitted builtin instance names depend on
// the output of `canonicalJson` (`lower.ts`, specialize), so a change here renames
// generated code.

import { compareText, isRecord } from "./util.ts";

export type CanonicalValue = unknown;
export type CanonicalJson = string;

/**
 * Prints a value with the shared rules: sorted keys, no key with an `undefined`
 * value, array order kept. `step` is the indent of one level, or `undefined`
 * for compact text.
 */
function print(
  value: unknown,
  step: string | undefined,
  indent: string,
): string {
  if (value === undefined) return "null";
  if (!isRecord(value) && !Array.isArray(value)) return JSON.stringify(value);
  const inner = `${indent}${step ?? ""}`;
  const join = step === undefined ? "," : ",\n";
  function wrap(
    open: string,
    parts: readonly string[],
    close: string,
  ): string {
    if (parts.length === 0) return `${open}${close}`;
    if (step === undefined) return `${open}${parts.join(join)}${close}`;
    return `${open}\n${parts.join(join)}\n${indent}${close}`;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${print(item, step, inner)}`);
    return wrap("[", items, "]");
  }
  const colon = step === undefined ? ":" : ": ";
  const members = Object.keys(value).filter((k) => value[k] !== undefined)
    .sort(compareText).map((key) =>
      `${inner}${JSON.stringify(key)}${colon}${print(value[key], step, inner)}`
    );
  return wrap("{", members, "}");
}

/**
 * JSON text with object keys in sorted order. Arrays keep their order. A key
 * with an `undefined` value is left out. Use it to hash a value.
 */
export function canonicalJson(value: CanonicalValue): CanonicalJson {
  return print(value, undefined, "");
}

/** The same rules as `canonicalJson`, with two-space indentation. */
export function canonicalJsonIndented(value: CanonicalValue): CanonicalJson {
  return print(value, "  ", "");
}
