// The text that content identities hash. Emitted builtin instance names depend on
// the output of `canonicalJson` (`lower.ts`, specialize), so a change here renames
// generated code.

import { compareText } from "./util.ts";

/**
 * JSON text with object keys in sorted order. Arrays keep their order. A key
 * with an `undefined` value is left out. Use it to hash a value.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort(compareText)) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}
