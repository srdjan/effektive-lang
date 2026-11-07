// A type guard shared by the validator modules. Both the serializer walk and
// the certificate checks read values that may not have the shape of the IR.

/** True for a plain JSON object: not null and not an array. */
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
