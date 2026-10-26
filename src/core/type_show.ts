// Readable forms of types for messages. They are not a serialization format.

import { moduleOfId, shortName } from "./ids.ts";
import type { TypeReader, TypeRef } from "./types.ts";

/** Named ids that `print` meets, and the ids that it prints as `module#Name`. */
interface Names {
  readonly shown?: Set<string>;
  readonly qualified: ReadonlySet<string>;
}

/** A readable form for messages. It is not a serialization format. */
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
    const name = idName(id);
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const names: Names = {
    qualified: new Set(
      [...byName.values()].filter((ids) => ids.length > 1).flat(),
    ),
  };
  return refs.map((ref) => print(table, names, ref));
}

function idName(id: string): string {
  const hash = id.indexOf("#");
  return hash < 0 ? id : id.slice(hash + 1);
}

function print(table: TypeReader, names: Names, ref: TypeRef): string {
  const node = table.node(ref);
  switch (node.kind) {
    case "closeable-scope":
      return "CloseableScope";
    case "primitive":
      return node.name === "unit" ? "void" : node.name;
    case "literal":
      return JSON.stringify(node.value);
    case "named": {
      names.shown?.add(node.id);
      const hash = node.id.indexOf("#");
      if (hash < 0) return node.id;
      return names.qualified.has(node.id)
        ? `${moduleOfId(node.id) ?? ""}#${node.id.slice(hash + 1)}`
        : node.id.slice(hash + 1);
    }
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
    case "codec":
      return `Codec<${print(table, names, node.decoded)}, ${
        print(table, names, node.encoded)
      }>`;
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
        node.decodeRequirements.map(idName).join(" | ") || "never"
      }, ${node.encodeRequirements.map(idName).join(" | ") || "never"}${
        node.makeInput === undefined
          ? ""
          : `, ${print(table, names, node.makeInput)}`
      }>`;
    case "fiber":
      return `Fiber<${print(table, names, node.result)}, ${
        node.failures.map(idName).join(" | ") || "never"
      }>`;
    case "effect":
      return `Effect<${print(table, names, node.result)}, ${
        node.failures.map(idName).join(" | ") || "never"
      }, ${node.requirements.map(idName).join(" | ") || "never"}>`;
    case "stream":
      return `Stream<${print(table, names, node.element)}, ${
        node.failures.map(idName).join(" | ") || "never"
      }, ${node.requirements.map(idName).join(" | ") || "never"}>`;
    case "schedule":
      return `Schedule<${print(table, names, node.output)}, ${
        print(table, names, node.input)
      }, ${node.failures.map(idName).join(" | ") || "never"}, ${
        node.requirements.map(idName).join(" | ") || "never"
      }>`;
    case "sink":
      return `Sink<${print(table, names, node.input)}, ${
        print(table, names, node.result)
      }, ${node.failures.map(idName).join(" | ") || "never"}, ${
        node.requirements.map(idName).join(" | ") || "never"
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
        : ` fails ${node.failures.map(idName).join(" | ")}`;
      const uses = node.requirements.length === 0
        ? ""
        : ` uses ${node.requirements.map(idName).join(" | ")}`;
      const execution = node.execution === "pure" ? "pure " : "";
      return `${execution}(${parameters}) => ${
        print(table, names, node.result)
      }${fails}${uses}`;
    }
    case "provider":
      return `provider provides ${node.provides.map(idName).join(" | ")}`;
    case "error":
      return "<error>";
  }
}

/** The ` fails ...` and ` uses ...` text of two sets, as the hover contract prints it. */
export function effectText(
  failures: readonly string[],
  requirements: readonly string[],
): string {
  const fails = failures.length === 0
    ? ""
    : ` fails ${failures.map(shortName).join(" | ")}`;
  const uses = requirements.length === 0
    ? ""
    : ` uses ${requirements.map(shortName).join(" | ")}`;
  return fails + uses;
}
