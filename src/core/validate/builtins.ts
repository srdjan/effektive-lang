// Builtin metadata and collection shapes used only by the independent validator.

import type { ValidationFlag, ValidationText } from "./report.ts";
import type { Expr, Type } from "../ir.ts";
import { INT, same, STRING, type TypeEnv, unfold } from "./typing.ts";

const BUILTIN_NAMES = [
  "map",
  "filter",
  "fold",
  "all",
  "traverse",
  "div",
  "trunc",
  "floor",
  "round",
  "ceil",
  "text",
  "len",
  "at",
  "sort",
  "concat",
] as const;
export type BuiltinName = typeof BUILTIN_NAMES[number];
export type BuiltinCallName = BuiltinName | "other";

export type BuiltinInfo = {
  readonly identity: {
    readonly module: string;
    readonly name: BuiltinName;
  } | undefined;
  readonly call:
    | { readonly parsed: true; readonly name: BuiltinCallName | undefined }
    | { readonly parsed: false };
};

type ParsedBuiltinId = {
  readonly module: string;
  readonly name: string;
};

function hasLineTerminator(text: string): boolean {
  return [...text].some((character) =>
    character === "\n" || character === "\r" || character === "\u2028" ||
    character === "\u2029"
  );
}

function parseBuiltinId(id: string): ParsedBuiltinId | undefined {
  const marker = "#$builtin/";
  const markerAt = id.lastIndexOf(marker);
  if (!id.startsWith("value:") || markerAt <= "value:".length) return undefined;
  const module = id.slice("value:".length, markerAt);
  if (hasLineTerminator(module)) return undefined;
  const tail = id.slice(markerAt + marker.length);
  const slashAt = tail.indexOf("/");
  if (slashAt <= 0 || slashAt !== tail.lastIndexOf("/")) return undefined;
  const hash = tail.slice(slashAt + 1);
  if (hash.length === 0) return undefined;
  for (const character of hash) {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57;
    const lowerHex = code >= 97 && code <= 102;
    if (!digit && !lowerHex) return undefined;
  }
  return {
    module: module,
    name: tail.slice(0, slashAt),
  };
}

/** Unknown name segments still trigger the existing callback purity rule. */
export function classifyBuiltinCall(
  name: ValidationText | undefined,
): BuiltinCallName | undefined {
  return name === undefined
    ? undefined
    : BUILTIN_NAMES.find((known) => known === name) ?? "other";
}

/** The position of the callback and the valid parameter counts of a callback builtin. */
type CallbackShape = {
  readonly index: number;
  readonly counts: readonly number[];
};

export type CallbackBuiltin = "map" | "filter" | "sort" | "fold" | "traverse";

export const CALLBACK_SHAPES: Readonly<Record<CallbackBuiltin, CallbackShape>> =
  {
    map: { index: 1, counts: [2] },
    filter: { index: 1, counts: [2] },
    sort: { index: 1, counts: [2] },
    fold: { index: 2, counts: [3] },
    traverse: { index: 1, counts: [2, 3] },
  };

export function isCallbackBuiltin(
  name: BuiltinCallName | undefined,
): name is CallbackBuiltin {
  return name !== undefined && Object.hasOwn(CALLBACK_SHAPES, name);
}

export function builtinInfo(
  id: ValidationText,
  name: ValidationText,
): BuiltinInfo {
  const parsed = typeof id === "string" ? parseBuiltinId(id) : undefined;
  const segment = parsed?.name;
  const known = BUILTIN_NAMES.find((candidate) => candidate === segment);
  return {
    identity: parsed !== undefined && known !== undefined
      ? { module: parsed.module, name: known }
      : undefined,
    // Malformed non-string names are evaluated in the guarded call phase.
    call: typeof name === "string"
      ? { parsed: true, name: classifyBuiltinCall(name.split("/")[1]) }
      : { parsed: false },
  };
}

type Container = {
  readonly shape: Extract<
    Type,
    { readonly kind: "tuple" | "record" | "array" }
  >;
  readonly entries: readonly Type[];
};

export function containerEntries(type: Type): Container | undefined {
  if (type.kind === "tuple") {
    return { shape: type, entries: type.elements };
  }
  if (type.kind === "record") {
    return { shape: type, entries: type.fields.map((field) => field.type) };
  }
  if (type.kind === "array") return { shape: type, entries: [type.element] };
  return undefined;
}

export function rebuildContainer(
  container: Container,
  entries: readonly Type[],
): Type {
  const shape = container.shape;
  if (shape.kind === "tuple") return { kind: "tuple", elements: entries };
  if (shape.kind === "record") {
    return {
      kind: "record",
      fields: shape.fields.map((field, i) => ({
        name: field.name,
        type: entries[i],
        optional: false,
      })),
    };
  }
  return { kind: "array", element: entries[0] };
}

export function isConcurrencyType(env: TypeEnv, type: Type): ValidationFlag {
  const options = unfold(env, type);
  const field = options.kind === "record" && options.fields.length === 1
    ? options.fields[0]
    : undefined;
  return field?.name === "concurrency" && !field.optional &&
    (same(env, field.type, INT) || same(env, field.type, STRING));
}

export function isConcurrencyOption(options: Expr | undefined): ValidationFlag {
  const field = options?.kind === "record" && options.fields.length === 1
    ? options.fields[0]
    : undefined;
  const value = field?.value;
  return field?.name === "concurrency" && value?.kind === "literal" &&
    (value.value === "unbounded" ||
      (typeof value.value === "number" && Number.isSafeInteger(value.value) &&
        value.value > 0));
}
