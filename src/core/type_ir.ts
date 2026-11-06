// Conversion between IR type trees and interned types. Each function reads or
// writes through the public methods of one `TypeTable`.

import type { ErrorId, Field, FunctionType, Type, TypeId } from "./ir.ts";
import type { Predicate } from "./predicates.ts";
import { guardedRecord } from "./recursion_guard.ts";
import type { TypeRef, TypeTable } from "./types.ts";
import { canonicalJson } from "./content_id.ts";
import { compareText } from "./util.ts";

/** Interns an IR type tree. Unions flatten and sort, records sort. */
export function typeFromIr(table: TypeTable, type: Type): TypeRef {
  switch (type.kind) {
    case "primitive":
      return table.primitive(type.name);
    case "literal":
      return table.literal(type.value);
    case "named":
      return table.named(type.id);
    case "record":
      return table.record(type.fields.map((f) => ({
        name: f.name,
        type: typeFromIr(table, f.type),
        optional: f.optional,
      })));
    case "array":
      return table.array(typeFromIr(table, type.element));
    case "tuple":
      return table.tuple(type.elements.map((e) => typeFromIr(table, e)));
    case "union":
      return table.union(type.members.map((m) => typeFromIr(table, m)));
    case "option":
      return table.option(typeFromIr(table, type.element));
    case "ref":
      return table.ref(typeFromIr(table, type.element));
    case "retry-schedule":
      return table.retrySchedule(typeFromIr(table, type.error));
    case "schema":
      return table.schema(
        typeFromIr(table, type.decoded),
        typeFromIr(table, type.encoded),
        type.decodeRequirements,
        type.encodeRequirements,
        {
          presence: type.optionalKey === true
            ? "optional"
            : type.encodedOptionalKey === true
            ? "encoded-optional"
            : type.decodedOptionalKey === true
            ? "decoded-optional"
            : "required",
          makeInput: typeFromIr(table, type.makeInput ?? type.decoded),
          constructorDefault: type.constructorDefault === true,
        },
      );
    case "effect":
      return table.effect(
        typeFromIr(table, type.result),
        type.effects.failures,
        type.effects.requirements,
      );
    case "stream":
      return table.stream(
        typeFromIr(table, type.element),
        type.effects.failures,
        type.effects.requirements,
      );
    case "sink":
      return table.sink(
        typeFromIr(table, type.input),
        typeFromIr(table, type.result),
        type.effects.failures,
        type.effects.requirements,
        type.leftover === undefined
          ? table.never
          : typeFromIr(table, type.leftover),
      );
    case "function":
      return functionTypeFromIr(table, type);
    case "provider":
      return table.provider({
        provides: type.provides,
        execution: type.acquisition.execution,
        failures: type.acquisition.effects.failures,
        requirements: type.acquisition.effects.requirements,
      });
  }
}

export function functionTypeFromIr(
  table: TypeTable,
  type: FunctionType,
): TypeRef {
  return table.function({
    execution: type.execution,
    parameters: type.parameters.map((p) => typeFromIr(table, p)),
    ...(type.borrows === undefined ? {} : { borrows: type.borrows }),
    ...(type.checked === undefined ? {} : { checked: type.checked }),
    result: typeFromIr(table, type.result),
    failures: type.effects.failures,
    requirements: type.effects.requirements,
  });
}

/**
 * The IR tree of an interned type. Records list fields by name. Union members
 * sort by their canonical text, so the result does not depend on ref numbers.
 * The error type becomes `unknown`.
 */
export function typeToIr(table: TypeTable, ref: TypeRef): Type {
  const node = table.node(ref);
  switch (node.kind) {
    case "primitive":
      return { kind: "primitive", name: node.name };
    case "literal":
      return { kind: "literal", value: node.value };
    case "named":
      return { kind: "named", id: node.id };
    case "record":
      return {
        kind: "record",
        fields: node.fields.map((f) => ({
          name: f.name,
          type: typeToIr(table, f.type),
          optional: f.optional,
        })),
      };
    case "array":
      return { kind: "array", element: typeToIr(table, node.element) };
    case "tuple":
      return {
        kind: "tuple",
        elements: node.elements.map((e) => typeToIr(table, e)),
      };
    case "union": {
      const members = node.members.map((m) => {
        const ir = typeToIr(table, m);
        return { ir, text: canonicalJson(ir) };
      });
      members.sort((a, b) => compareText(a.text, b.text));
      return { kind: "union", members: members.map((m) => m.ir) };
    }
    case "option":
      return { kind: "option", element: typeToIr(table, node.element) };
    case "ref":
      return { kind: "ref", element: typeToIr(table, node.element) };
    case "retry-schedule":
      return { kind: "retry-schedule", error: typeToIr(table, node.error) };
    case "schema":
      return {
        kind: "schema",
        decoded: typeToIr(table, node.decoded),
        encoded: typeToIr(table, node.encoded),
        decodeRequirements: node.decodeRequirements,
        encodeRequirements: node.encodeRequirements,
        ...(node.presence === "optional" ? { optionalKey: true as const } : {}),
        ...(node.presence === "encoded-optional"
          ? { encodedOptionalKey: true as const }
          : {}),
        ...(node.presence === "decoded-optional"
          ? { decodedOptionalKey: true as const }
          : {}),
        ...(node.makeInput === undefined
          ? {}
          : { makeInput: typeToIr(table, node.makeInput) }),
        ...(node.constructorDefault === true
          ? { constructorDefault: true as const }
          : {}),
      };
    case "effect":
      return {
        kind: "effect",
        result: typeToIr(table, node.result),
        effects: {
          failures: node.failures,
          requirements: node.requirements,
        },
      };
    case "stream":
      return {
        kind: "stream",
        element: typeToIr(table, node.element),
        effects: { failures: node.failures, requirements: node.requirements },
      };
    case "sink":
      return {
        kind: "sink",
        input: typeToIr(table, node.input),
        result: typeToIr(table, node.result),
        ...(node.leftover === table.never
          ? {}
          : { leftover: typeToIr(table, node.leftover) }),
        effects: { failures: node.failures, requirements: node.requirements },
      };
    case "function":
      return functionTypeToIr(table, ref);
    case "provider":
      return {
        kind: "provider",
        provides: node.provides,
        acquisition: {
          execution: node.execution,
          effects: {
            failures: node.failures,
            requirements: node.requirements,
          },
        },
      };
    case "error":
      return { kind: "primitive", name: "unknown" };
  }
}

/** The IR function type of a ref that must be a function type. */
export function functionTypeToIr(
  table: TypeTable,
  ref: TypeRef,
): FunctionType {
  const node = table.node(ref);
  if (node.kind !== "function") {
    throw new Error(`type ref ${ref} is not a function type`);
  }
  return {
    kind: "function",
    execution: node.execution,
    parameters: node.parameters.map((p) => typeToIr(table, p)),
    ...(node.borrows === undefined ? {} : { borrows: node.borrows }),
    ...(node.checked === undefined ? {} : { checked: node.checked }),
    result: typeToIr(table, node.result),
    effects: { failures: node.failures, requirements: node.requirements },
  };
}

/** What a graph of imported declarations supplies to the table. */
export interface DefinitionSource {
  readonly types: readonly {
    readonly id: TypeId;
    readonly opaque?: boolean;
    readonly predicate?: Predicate;
    readonly definition:
      | { readonly kind: "alias"; readonly type: Type }
      | {
        readonly kind: "nominal";
        readonly base: Type;
        readonly tagged?: true;
        readonly sealed?: true;
      };
  }[];
  readonly errors: readonly {
    readonly id: ErrorId;
    readonly fields: readonly Field[];
  }[];
}

/**
 * Registers the declarations of an imported module graph. A definition that
 * the table already has stays as it is.
 */
export function loadGraph(table: TypeTable, source: DefinitionSource): void {
  // The table registers the declarations one at a time, so a tag alias may
  // come after the alias that uses it. The source lists all of them.
  const aliasTypes = new Map<string, Type>();
  for (const decl of source.types) {
    if (decl.definition.kind === "alias") {
      aliasTypes.set(decl.id, decl.definition.type);
    } else if (decl.definition.tagged !== true && decl.opaque !== true) {
      aliasTypes.set(decl.id, decl.definition.base);
    }
  }
  const tagOf = (type: Type): string | undefined => {
    const seen = new Set<string>();
    let current: Type | undefined = type;
    while (current !== undefined) {
      if (current.kind === "literal") {
        return typeof current.value === "string" ? current.value : undefined;
      }
      if (current.kind !== "named" || seen.has(current.id)) return undefined;
      seen.add(current.id);
      current = aliasTypes.get(current.id);
    }
    return undefined;
  };
  for (const decl of source.types) {
    if (table.isDefined(decl.id)) continue;
    if (decl.definition.kind === "alias") {
      table.defineAlias(
        decl.id,
        typeFromIr(table, decl.definition.type),
        guardedRecord(decl.definition.type, decl.id, tagOf),
      );
    } else if (decl.opaque === true) {
      table.defineOpaque(decl.id);
    } else {
      // A nominal type is an alias with identity. A tagged one is a tagged record.
      const body = typeFromIr(table, decl.definition.base);
      const sealed = decl.definition.sealed === true;
      if (decl.definition.tagged === true) {
        table.defineTagged(decl.id, body, sealed, decl.predicate);
      } else {
        table.defineIdentity(
          decl.id,
          body,
          sealed,
          guardedRecord(decl.definition.base, decl.id, tagOf),
          decl.predicate,
        );
      }
    }
  }
  for (const decl of source.errors) {
    if (table.isDefined(decl.id)) continue;
    table.defineError(
      decl.id,
      table.record(decl.fields.map((f) => ({
        name: f.name,
        type: typeFromIr(table, f.type),
        optional: f.optional,
      }))),
    );
  }
}
