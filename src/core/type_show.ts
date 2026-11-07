// Readable forms of types for messages. They are not a serialization format.

import { moduleOfId, shortName } from "./ids.ts";
import { CLOSED_UNIT_IDS } from "./ir.ts";
import type { TypeReader, TypeRef } from "./types.ts";

/** Ids that `print` meets, in types and in id lists, and the ids that it prints as `module#Name`. */
interface Names {
  readonly shown?: Set<string>;
  readonly qualified: ReadonlySet<string>;
}

export function showType(table: TypeReader, ref: TypeRef): string {
  return print(table, { qualified: new Set() }, ref);
}

/**
 * The readable forms of several types for one message. When two different
 * ids share a short name, each prints as `module#Name`, so the message can
 * tell them apart.
 */
export function showTypes(table: TypeReader, ...refs: TypeRef[]): string[] {
  const shown = new Set<string>();
  for (const ref of refs) print(table, { shown, qualified: new Set() }, ref);
  const byName = new Map<string, string[]>();
  for (const id of shown) {
    const name = declaredName(id);
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const names: Names = {
    qualified: new Set(
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
  names.shown?.add(id);
  return names.qualified.has(id) && !CLOSED_UNIT_IDS.has(id)
    ? `${moduleOfId(id) ?? ""}#${declaredName(id)}`
    : shortName(id);
}

/** Ids joined with ` | `. */
function listText(names: Names, ids: readonly string[]): string {
  return ids.map((id) => idText(names, id)).join(" | ");
}

function print(table: TypeReader, names: Names, ref: TypeRef): string {
  const node = table.node(ref);
  switch (node.kind) {
    case "primitive":
      return node.name === "unit" ? "void" : node.name;
    case "literal":
      return JSON.stringify(node.value);
    case "named":
      return idText(names, node.id);
    case "record":
      return node.fields.length === 0
        ? "{}"
        : `{ ${
          node.fields.map((f) =>
            `${f.name}${f.optional ? "?" : ""}: ${print(table, names, f.type)}`
          ).join(", ")
        } }`;
    case "array": {
      const inner = table.node(node.element).kind;
      const text = print(table, names, node.element);
      return inner === "union" || inner === "function"
        ? `(${text})[]`
        : `${text}[]`;
    }
    case "tuple":
      return `[${node.elements.map((e) => print(table, names, e)).join(", ")}]`;
    case "union":
      return node.members.map((m) => print(table, names, m)).join(" | ");
    case "option":
      return `Option<${print(table, names, node.element)}>`;
    case "ref":
      return `Ref<${print(table, names, node.element)}>`;
    case "retry-schedule":
      return `RetrySchedule<${print(table, names, node.error)}>`;
    case "schema":
      return `${
        node.presence === "optional"
          ? "SchemaOptional"
          : node.presence === "encoded-optional"
          ? "SchemaEncodedOptional"
          : node.presence === "decoded-optional"
          ? "SchemaDecodedOptional"
          : "Schema"
      }${node.constructorDefault === true ? "ConstructorDefault" : ""}<${
        print(table, names, node.decoded)
      }, ${print(table, names, node.encoded)}, ${
        listText(names, node.decodeRequirements) || "never"
      }, ${listText(names, node.encodeRequirements) || "never"}${
        node.makeInput === undefined
          ? ""
          : `, ${print(table, names, node.makeInput)}`
      }>`;
    case "effect":
      return `Effect<${print(table, names, node.result)}, ${
        listText(names, node.failures) || "never"
      }, ${listText(names, node.requirements) || "never"}>`;
    case "stream":
      return `Stream<${print(table, names, node.element)}, ${
        listText(names, node.failures) || "never"
      }, ${listText(names, node.requirements) || "never"}>`;
    case "sink":
      return `Sink<${print(table, names, node.input)}, ${
        print(table, names, node.result)
      }, ${listText(names, node.failures) || "never"}, ${
        listText(names, node.requirements) || "never"
      }${
        node.leftover === table.never
          ? ""
          : `, ${print(table, names, node.leftover)}`
      }>`;
    case "function": {
      const parameters = node.parameters.map((p) => print(table, names, p))
        .join(", ");
      const fails = node.failures.length === 0
        ? ""
        : ` fails ${listText(names, node.failures)}`;
      const withText = node.requirements.length === 0
        ? ""
        : ` with ${listText(names, node.requirements)}`;
      const execution = node.execution === "pure" ? "pure " : "";
      return `${execution}(${parameters}) => ${
        print(table, names, node.result)
      }${fails}${withText}`;
    }
    case "provider":
      return `provider provides ${listText(names, node.provides)}`;
    case "error":
      return "<error>";
  }
}

/** The ` fails ...` and ` with ...` text of two sets, as the hover contract prints it. */
export function effectText(
  failures: readonly string[],
  requirements: readonly string[],
): string {
  const fails = failures.length === 0
    ? ""
    : ` fails ${failures.map(shortName).join(" | ")}`;
  const withText = requirements.length === 0
    ? ""
    : ` with ${requirements.map(shortName).join(" | ")}`;
  return fails + withText;
}
