// A type guard shared by the validator modules. Both the serializer walk and
// the certificate checks read values that may not have the shape of the IR.

type JsonRecord = Readonly<Record<string, unknown>>;
type ExactTrue = true;
type ExactFalse = false;
type GuardInput = unknown;

/** True for a plain JSON object: not null and not an array. */
export function isRecord(
  value: GuardInput,
): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for the boolean value true. */
export function isTrue(value: GuardInput): value is ExactTrue {
  return typeof value === "boolean" && value;
}

/** True only for the boolean value false. */
export function isFalse(value: GuardInput): value is ExactFalse {
  return typeof value === "boolean" && !value;
}
