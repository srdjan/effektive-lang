// Small pure helpers that the front end and the edges share. Nothing here does I/O.

import { setFrom, unknownMessage } from "./runtime.ts";

export type Text = string;
export type Ordering = number;
export type UnknownValue = unknown;
export type Count = number;

/** Orders two strings by UTF-16 code units, as the default `sort` does. */
export function compareText(a: Text, b: Text): Ordering {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Sorted copy without duplicates. */
export function sortedUnique<T extends string>(items: readonly T[]): T[] {
  return [...setFrom(items)].sort(compareText);
}

/** The message of a thrown value: the `message` of an `Error`, else its string form. */
export function errorMessage(thrown: UnknownValue): Text {
  return unknownMessage(thrown);
}

/** True for a plain JSON object: not null and not an array. */
export function isRecord(
  value: UnknownValue,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text of an arity diagnostic, for example "`f` takes 1 argument, but 2 are given". */
export function arityMessage(
  subject: Text,
  noun: Text,
  expected: Count,
  given: Count,
): Text {
  return `${subject} takes ${expected} ${noun}${
    expected === 1 ? "" : "s"
  }, but ${given} ${given === 1 ? "is" : "are"} given`;
}
