// Small pure helpers that the front end and the edges share. Nothing here does I/O.

/** Orders two strings by UTF-16 code units, as the default `sort` does. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The message of a thrown value: the `message` of an `Error`, else its string form. */
export function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** True for a plain JSON object: not null and not an array. */
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
