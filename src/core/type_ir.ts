// Conversion between IR type trees and interned types. Each function reads or
// writes through the public methods of one `TypeTable`.

import type { FunctionType, Type } from "./ir.ts";
import type { TypeRef, TypeTable } from "./types.ts";
import { canonicalJson, compareText } from "./util.ts";

/** Interns an IR type tree. Unions flatten and sort, records sort. */
export function typeFromIr(table: TypeTable, type: Type): TypeRef {
  switch (type.kind) {
    case "closeable-scope":
      return table.closeableScope;
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
    case "codec":
      return table.codec(
        typeFromIr(table, type.decoded),
        typeFromIr(table, type.encoded),
      );
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
    case "fiber":
      return table.fiber(typeFromIr(table, type.result), type.failures);
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
    case "schedule":
      return table.schedule(
        typeFromIr(table, type.output),
        typeFromIr(table, type.input),
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
    case "closeable-scope":
      return { kind: "closeable-scope" };
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
    case "codec":
      return {
        kind: "codec",
        decoded: typeToIr(table, node.decoded),
        encoded: typeToIr(table, node.encoded),
      };
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
    case "fiber":
      return {
        kind: "fiber",
        result: typeToIr(table, node.result),
        failures: node.failures,
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
    case "schedule":
      return {
        kind: "schedule",
        output: typeToIr(table, node.output),
        input: typeToIr(table, node.input),
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
    result: typeToIr(table, node.result),
    effects: { failures: node.failures, requirements: node.requirements },
  };
}
