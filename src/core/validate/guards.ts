// A type guard shared by the validator modules. Both the serializer walk and
// the certificate checks read values that may not have the shape of the IR.

type JsonRecord = Readonly<Record<string, unknown>>;
type ExactTrue = true;
type GuardInput = unknown;
type Flags = readonly boolean[] | undefined;
type FlagIndex = number;
type FlagFound = boolean;

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

/** True only when `flags` holds the boolean value true at `index`. */
export function flagAt(flags: Flags, index: FlagIndex): FlagFound {
  return flags !== undefined && isTrue(flags[index]);
}
