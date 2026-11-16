// Readable forms of types for messages. They are not a serialization format.

import { moduleOfId, shortName } from "./ids.ts";
import { emptyMap, emptySet, setFrom } from "./runtime.ts";
import type { SchemaPresence, TypeReader, TypeRef } from "./types.ts";

/** Ids that `print` meets, in types and in id lists, and the ids that it prints as `module#Name`. */
type Names = {
  readonly show?: (id: string) => string;
  readonly qualified: ReadonlySet<string>;
};

export type TypeText = string;
export type TypeTexts = readonly string[];
export type TypeRefs = readonly TypeRef[];
export type EffectIds = readonly string[];

export function showType(table: TypeReader, ref: TypeRef): TypeText {
  return print(table, { qualified: emptySet() }, ref);
}

/**
 * The readable forms of several types for one message. When two different
 * ids share a short name, each prints as `module#Name`, so the message can
 * tell them apart.
 */
export function showTypes(table: TypeReader, refs: TypeRefs): TypeTexts {
  let shown = emptySet<string>();
  const collect: Names = {
    show: (id) => {
      shown = shown.add(id);
      return id;
    },
    qualified: emptySet(),
  };
  for (const ref of refs) {
    const _text = print(table, collect, ref);
  }
  let byName = emptyMap<string, string[]>();
  for (const id of shown) {
    const name = declaredName(id);
    byName = byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const names: Names = {
    qualified: setFrom(
      [...byName.values()].filter((ids) => ids.length > 1).flat(),
    ),
  };
  return refs.map((ref) => print(table, names, ref));
}

/**
 * The name that two ids can share: the part after the `#`. An id without a `#`
 * is its own name, so a reserved id never collides with a declared name.
 */
function declaredName(id: string): string {
  const hash = id.indexOf("#");
  return hash < 0 ? id : id.slice(hash + 1);
}

/** An id as `print` shows it: `module#Name` when another id shares its name. */
function idText(names: Names, id: string): string {
  const shown = names.show === undefined ? id : names.show(id);
  return names.qualified.has(shown)
    ? `${moduleOfId(shown) ?? ""}#${declaredName(shown)}`
    : shortName(shown);
}

const SCHEMA_NAMES: Record<SchemaPresence, string> = {
  "required": "Schema",
  "optional": "SchemaOptional",
  "encoded-optional": "SchemaEncodedOptional",
  "decoded-optional": "SchemaDecodedOptional",
};

/** Ids joined with ` | `. */
function listText(names: Names, ids: readonly string[]): string {
  return ids.map((id) => idText(names, id)).join(" | ");
}

function print(table: TypeReader, names: Names, ref: TypeRef): string {
  const node = table.node(ref);
  if (node.kind === "primitive") {
    return node.name === "unit" ? "void" : node.name;
  }
  if (node.kind === "literal") return JSON.stringify(node.value);
  if (node.kind === "named") return idText(names, node.id);
  if (node.kind === "record") {
    return node.fields.length === 0
      ? "{}"
      : `{ ${
        node.fields.map((f) =>
          `${f.name}${f.optional ? "?" : ""}: ${print(table, names, f.type)}`
        ).join(", ")
      } }`;
  }
  if (node.kind === "array") {
    const inner = table.node(node.element).kind;
    const text = print(table, names, node.element);
    return inner === "union" || inner === "function"
      ? `(${text})[]`
      : `${text}[]`;
  }
  if (node.kind === "tuple") {
    return `[${node.elements.map((e) => print(table, names, e)).join(", ")}]`;
  }
  if (node.kind === "union") {
    return node.members.map((m) => print(table, names, m)).join(" | ");
  }
  if (node.kind === "option") {
    return `Option<${print(table, names, node.element)}>`;
  }
  if (node.kind === "ref") {
    return `Ref<${print(table, names, node.element)}>`;
  }
  if (node.kind === "retry-schedule") {
    return `RetrySchedule<${print(table, names, node.error)}>`;
  }
  if (node.kind === "schema") {
    return `${SCHEMA_NAMES[node.presence]}${
      node.constructorDefault ? "ConstructorDefault" : ""
    }<${print(table, names, node.decoded)}, ${
      print(table, names, node.encoded)
    }, ${listText(names, node.decodeRequirements) || "never"}, ${
      listText(names, node.encodeRequirements) || "never"
    }${
      node.makeInput === undefined
        ? ""
        : `, ${print(table, names, node.makeInput)}`
    }>`;
  }
  if (node.kind === "effect") {
    return `Effect<${print(table, names, node.result)}, ${
      listText(names, node.failures) || "never"
    }, ${listText(names, node.requirements) || "never"}>`;
  }
  if (node.kind === "stream") {
    return `Stream<${print(table, names, node.element)}, ${
      listText(names, node.failures) || "never"
    }, ${listText(names, node.requirements) || "never"}>`;
  }
  if (node.kind === "sink") {
    return `Sink<${print(table, names, node.input)}, ${
      print(table, names, node.result)
    }, ${listText(names, node.failures) || "never"}, ${
      listText(names, node.requirements) || "never"
    }${
      node.leftover === table.never
        ? ""
        : `, ${print(table, names, node.leftover)}`
    }>`;
  }
  if (node.kind === "function") {
    const parameters = node.parameters.map((p) => print(table, names, p))
      .join(", ");
    const execution = node.execution === "pure" ? "pure " : "";
    return `${execution}(${parameters}) => ${print(table, names, node.result)}${
      effectSuffix(
        listText(names, node.failures),
        listText(names, node.requirements),
      )
    }`;
  }
  if (node.kind === "provider") {
    return `provider provides ${listText(names, node.provides)}`;
  }
  return "<error>";
}

/** The ` fails ...` and ` with ...` text of two sets, as the hover contract prints it. */
export function effectText(
  failures: EffectIds,
  requirements: EffectIds,
): TypeText {
  return effectSuffix(
    failures.map(shortName).join(" | "),
    requirements.map(shortName).join(" | "),
  );
}

/** The suffix of two printed sets. An empty set adds no text. */
function effectSuffix(failures: string, requirements: string): string {
  return (failures === "" ? "" : ` fails ${failures}`) +
    (requirements === "" ? "" : ` with ${requirements}`);
}
