// Conversion between IR type trees and interned types. Each function reads or
// writes through the public methods of one `TypeTable`.

import { canonicalJson } from "./content_id.ts";
import type { ErrorId, Field, FunctionType, Type, TypeDecl } from "./ir.ts";
import { guardedRecord, literalTagOf } from "./recursion_guard.ts";
import { mapFrom } from "./runtime.ts";
import { panic } from "./source.ts";
import type { SchemaPresence, TypeNode, TypeRef, TypeTable } from "./types.ts";
import { compareText, trueFlag } from "./util.ts";

function schemaPresence(
  type: Type & { readonly kind: "schema" },
): SchemaPresence {
  if (trueFlag(type.optionalKey)) {
    return "optional";
  }
  if (trueFlag(type.encodedOptionalKey)) {
    return "encoded-optional";
  }
  if (trueFlag(type.decodedOptionalKey)) {
    return "decoded-optional";
  }
  return "required";
}

function functionOptions(type: FunctionType): {
  readonly borrows?: readonly boolean[];
  readonly checked?: readonly boolean[];
} {
  const borrows = type.borrows === undefined ? {} : { borrows: type.borrows };
  return type.checked === undefined
    ? borrows
    : { ...borrows, checked: type.checked };
}

/** Interns an IR type tree. Unions flatten and sort, records sort. */
export function typeFromIr(table: TypeTable, type: Type): TypeRef {
  if (type.kind === "primitive") return table.primitive(type.name);
  if (type.kind === "literal") return table.literal(type.value);
  if (type.kind === "named") return table.named(type.id);
  if (type.kind === "record") {
    return table.record(type.fields.map((field) => ({
      name: field.name,
      type: typeFromIr(table, field.type),
      optional: field.optional,
    })));
  }
  if (type.kind === "array") {
    return table.array(typeFromIr(table, type.element));
  }
  if (type.kind === "tuple") {
    return table.tuple(
      type.elements.map((element) => typeFromIr(table, element)),
    );
  }
  if (type.kind === "union") {
    return table.union(type.members.map((member) => typeFromIr(table, member)));
  }
  if (type.kind === "option") {
    return table.option(typeFromIr(table, type.element));
  }
  if (type.kind === "ref") return table.ref(typeFromIr(table, type.element));
  if (type.kind === "retry-schedule") {
    return table.retrySchedule(typeFromIr(table, type.error));
  }
  if (type.kind === "schema") {
    return table.schema(
      typeFromIr(table, type.decoded),
      typeFromIr(table, type.encoded),
      type.decodeRequirements,
      type.encodeRequirements,
      {
        presence: schemaPresence(type),
        makeInput: typeFromIr(table, type.makeInput ?? type.decoded),
        constructorDefault: trueFlag(type.constructorDefault),
      },
    );
  }
  if (type.kind === "effect") {
    return table.effect(
      typeFromIr(table, type.result),
      type.effects.failures,
      type.effects.requirements,
    );
  }
  if (type.kind === "stream") {
    return table.stream(
      typeFromIr(table, type.element),
      type.effects.failures,
      type.effects.requirements,
    );
  }
  if (type.kind === "sink") {
    return table.sink(
      typeFromIr(table, type.input),
      typeFromIr(table, type.result),
      type.effects.failures,
      type.effects.requirements,
      type.leftover === undefined
        ? table.never
        : typeFromIr(table, type.leftover),
    );
  }
  if (type.kind === "function") return functionTypeFromIr(table, type);
  if (type.kind === "provider") {
    return table.provider({
      provides: type.provides,
      execution: type.acquisition.execution,
      failures: type.acquisition.effects.failures,
      requirements: type.acquisition.effects.requirements,
    });
  }
  const unreachable: never = type;
  return unreachable;
}

export function functionTypeFromIr(
  table: TypeTable,
  type: FunctionType,
): TypeRef {
  return table.function({
    ...functionOptions(type),
    execution: type.execution,
    parameters: type.parameters.map((parameter) =>
      typeFromIr(table, parameter)
    ),
    result: typeFromIr(table, type.result),
    failures: type.effects.failures,
    requirements: type.effects.requirements,
  });
}

type SchemaIrOptions = {
  readonly optionalKey?: true;
  readonly encodedOptionalKey?: true;
  readonly decodedOptionalKey?: true;
  readonly makeInput?: Type;
  readonly constructorDefault?: true;
};

function schemaIrOptions(
  table: TypeTable,
  node: TypeNode & { readonly kind: "schema" },
): SchemaIrOptions {
  let presence: SchemaIrOptions = {};
  if (node.presence === "optional") presence = { optionalKey: true };
  if (node.presence === "encoded-optional") {
    presence = { encodedOptionalKey: true };
  }
  if (node.presence === "decoded-optional") {
    presence = { decodedOptionalKey: true };
  }
  const input = node.makeInput === undefined
    ? presence
    : { ...presence, makeInput: typeToIr(table, node.makeInput) };
  return trueFlag(node.constructorDefault)
    ? { ...input, constructorDefault: true }
    : input;
}

/** Converts one interned type to canonical IR. */
export function typeToIr(table: TypeTable, ref: TypeRef): Type {
  const node = table.node(ref);
  if (node.kind === "primitive") return { kind: "primitive", name: node.name };
  if (node.kind === "literal") return { kind: "literal", value: node.value };
  if (node.kind === "named") return { kind: "named", id: node.id };
  if (node.kind === "record") {
    return {
      kind: "record",
      fields: node.fields.map((field) => ({
        name: field.name,
        type: typeToIr(table, field.type),
        optional: field.optional,
      })),
    };
  }
  if (node.kind === "array") {
    return { kind: "array", element: typeToIr(table, node.element) };
  }
  if (node.kind === "tuple") {
    return {
      kind: "tuple",
      elements: node.elements.map((element) => typeToIr(table, element)),
    };
  }
  if (node.kind === "union") {
    const members = node.members.map((member) => {
      const ir = typeToIr(table, member);
      return { ir: ir, text: canonicalJson(ir) };
    }).toSorted((left, right) => compareText(left.text, right.text));
    return { kind: "union", members: members.map((member) => member.ir) };
  }
  if (node.kind === "option") {
    return { kind: "option", element: typeToIr(table, node.element) };
  }
  if (node.kind === "ref") {
    return { kind: "ref", element: typeToIr(table, node.element) };
  }
  if (node.kind === "retry-schedule") {
    return { kind: "retry-schedule", error: typeToIr(table, node.error) };
  }
  if (node.kind === "schema") {
    return {
      ...schemaIrOptions(table, node),
      kind: "schema",
      decoded: typeToIr(table, node.decoded),
      encoded: typeToIr(table, node.encoded),
      decodeRequirements: node.decodeRequirements,
      encodeRequirements: node.encodeRequirements,
    };
  }
  if (node.kind === "effect") {
    return {
      kind: "effect",
      result: typeToIr(table, node.result),
      effects: {
        failures: node.failures,
        requirements: node.requirements,
      },
    };
  }
  if (node.kind === "stream") {
    return {
      kind: "stream",
      element: typeToIr(table, node.element),
      effects: {
        failures: node.failures,
        requirements: node.requirements,
      },
    };
  }
  if (node.kind === "sink") {
    const leftover = node.leftover === table.never
      ? {}
      : { leftover: typeToIr(table, node.leftover) };
    return {
      ...leftover,
      kind: "sink",
      input: typeToIr(table, node.input),
      result: typeToIr(table, node.result),
      effects: { failures: node.failures, requirements: node.requirements },
    };
  }
  if (node.kind === "function") return functionTypeToIr(table, ref);
  if (node.kind === "provider") {
    return {
      kind: "provider",
      provides: node.provides,
      acquisition: {
        execution: node.execution,
        effects: { failures: node.failures, requirements: node.requirements },
      },
    };
  }
  if (node.kind === "error") return { kind: "primitive", name: "unknown" };
  const unreachable: never = node;
  return unreachable;
}

/** Converts a ref that must contain a function type. */
export function functionTypeToIr(table: TypeTable, ref: TypeRef): FunctionType {
  const node = table.node(ref);
  if (node.kind !== "function") {
    return panic(`type ref ${ref} is not a function type`);
  }
  const borrows = node.borrows === undefined ? {} : { borrows: node.borrows };
  const options = node.checked === undefined
    ? borrows
    : { ...borrows, checked: node.checked };
  return {
    ...options,
    kind: "function",
    execution: node.execution,
    parameters: node.parameters.map((parameter) => typeToIr(table, parameter)),
    result: typeToIr(table, node.result),
    effects: { failures: node.failures, requirements: node.requirements },
  };
}

/** What a graph of imported declarations supplies to the table. */
type DefinitionSource = {
  readonly types: readonly Pick<
    TypeDecl,
    "id" | "opaque" | "predicate" | "definition"
  >[];
  readonly errors: readonly {
    readonly id: ErrorId;
    readonly fields: readonly Field[];
  }[];
};

function aliasTypeEntries(
  declarations: DefinitionSource["types"],
): readonly (readonly [string, Type])[] {
  function entry(id: string, type: Type): readonly [string, Type] {
    return [id, type];
  }
  return declarations.flatMap((declaration) => {
    if (declaration.definition.kind === "alias") {
      return [entry(declaration.id, declaration.definition.type)];
    }
    if (
      !trueFlag(declaration.definition.tagged) && !trueFlag(declaration.opaque)
    ) {
      return [entry(declaration.id, declaration.definition.base)];
    }
    return [];
  });
}

function loadTypeDeclaration(
  table: TypeTable,
  declaration: DefinitionSource["types"][number],
  tagOf: (type: Type) => string | undefined,
): TypeTable {
  if (table.isDefined(declaration.id)) return table;
  if (declaration.definition.kind === "alias") {
    return table.defineAlias(
      declaration.id,
      typeFromIr(table, declaration.definition.type),
      guardedRecord(declaration.definition.type, declaration.id, tagOf),
    );
  }
  if (trueFlag(declaration.opaque)) return table.defineOpaque(declaration.id);
  const body = typeFromIr(table, declaration.definition.base);
  const sealed = trueFlag(declaration.definition.sealed);
  if (trueFlag(declaration.definition.tagged)) {
    return table.defineTagged(
      declaration.id,
      body,
      sealed,
      declaration.predicate,
    );
  }
  return table.defineIdentity(
    declaration.id,
    body,
    sealed,
    guardedRecord(declaration.definition.base, declaration.id, tagOf),
    declaration.predicate,
  );
}

function loadErrorDeclaration(
  table: TypeTable,
  declaration: DefinitionSource["errors"][number],
): TypeTable {
  if (table.isDefined(declaration.id)) return table;
  const record = table.record(declaration.fields.map((field) => ({
    name: field.name,
    type: typeFromIr(table, field.type),
    optional: field.optional,
  })));
  return table.defineError(declaration.id, record);
}

/** Registers imported declarations in source order and returns the updated table. */
export function loadGraph(
  table: TypeTable,
  source: DefinitionSource,
): TypeTable {
  const aliasTypes = mapFrom(aliasTypeEntries(source.types));
  function tagOf(type: Type): string | undefined {
    return literalTagOf(type, (id) => aliasTypes.get(id));
  }
  const withTypes = source.types.reduce(
    (current, declaration) => loadTypeDeclaration(current, declaration, tagOf),
    table,
  );
  return source.errors.reduce(loadErrorDeclaration, withTypes);
}
