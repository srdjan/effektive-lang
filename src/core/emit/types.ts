import { fieldKey } from "./fields.ts";
// The type printer and the schema printer.
//
// `typeDoc` prints a TypeScript type. `schemaDoc` prints the Effect Schema
// value of a type that has no function or provider inside.
import type {
  CapabilityId,
  Effects,
  ErrorId,
  Field,
  FunctionType,
  Type,
} from "../ir.ts";
import { isClosedUnitId, isDeferredKind, SCOPE_CAPABILITY } from "../ir.ts";
import {
  bracketed,
  callWith,
  type Doc,
  group,
  ifBreak,
  ifFits,
  indent,
  join,
  line,
  member,
  property,
  soft,
} from "./doc.ts";
import { internal } from "./failure.ts";
import { servicesOf } from "./identity.ts";
import { trueFlag } from "../util.ts";
import type { EmitNames } from "./module_state.ts";
function literalText(value: string | number | boolean | null): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
/** Parameter names of function types: `a`, `b`, `c`, ... */
export type ParameterIndex = number;
export type ParameterName = string;
export function parameterName(index: ParameterIndex): ParameterName {
  return index < 26 ? String.fromCharCode(97 + index) : `a${index}`;
}
/** Type arguments: one line when they fit, else one for each line. */
export function typeArguments(args: readonly Doc[]): Doc {
  return group(
    [
      "<",
      indent([soft, join([",", line], args)]),
      soft,
      ">",
    ],
    undefined,
    undefined,
  );
}
/**
 * The type argument of a one-argument type. `deno fmt` keeps a record type
 * beside the brackets. It breaks the brackets around any other type that does
 * not fit. A `breakable` type gets that break as a printer choice, not a
 * group, so the parameters of a signature still break first. The binding of a
 * block asks for it. Every other place keeps the brackets closed.
 */
function singleArgument(element: Type, inner: Doc, breakable: boolean): Doc {
  const beside: Doc = ["<", inner, ">"];
  if (element.kind === "record" || !breakable) {
    return beside;
  }
  return ifFits(beside, beside, ["<", indent([soft, inner]), soft, ">"]);
}
export type BracketsBreak = boolean;
/** True when the printed type can break the brackets of a one-argument type. */
export function bracketsBreak(type: Type): BracketsBreak {
  if (type.kind === "array" || type.kind === "option" || type.kind === "ref") {
    return type.element.kind !== "record";
  }
  return false;
}
function unionDoc(members: readonly Doc[]): Doc {
  return join(" | ", members);
}
function failureUnion(
  scope: EmitNames,
  failures: readonly ErrorId[],
): Doc | undefined {
  if (failures.length === 0) {
    return undefined;
  }
  return unionDoc(failures.map((id) => scope.nameOf(id)));
}
function requirementUnion(
  scope: EmitNames,
  capabilities: readonly CapabilityId[],
): Doc | undefined {
  const services = servicesOf(capabilities);
  const names: Doc[] = services.map((id) => scope.nameOf(id));
  if (capabilities.includes(SCOPE_CAPABILITY)) {
    names[names.length] = `${scope.effect("Scope")}.Scope`;
  }
  return names.length === 0 ? undefined : unionDoc(names);
}
/** The failure and requirement type arguments of an effect set, `never` when empty. */
export function channelTypeArguments(
  scope: EmitNames,
  effects: Effects,
): readonly Doc[] {
  return [
    failureUnion(scope, effects.failures) ?? "never",
    requirementUnion(scope, effects.requirements) ?? "never",
  ];
}
/**
 * `Effect.Effect<R, E, Rq>` with the trailing `never` arguments left out. The
 * failure and requirement sets are already in sorted identity order.
 */
export function effectTypeDoc(
  scope: EmitNames,
  result: Doc,
  effects: Effects,
): Doc {
  const args = deferredArguments(scope, [result], effects);
  const effect = scope.effect("Effect");
  return [`${effect}.Effect`, args];
}
function deferredArguments(
  scope: EmitNames,
  results: readonly Doc[],
  effects: Effects,
): Doc {
  const failures = failureUnion(scope, effects.failures);
  const requirements = requirementUnion(scope, effects.requirements);
  const args: Doc[] = [...results];
  if (failures !== undefined || requirements !== undefined) {
    args[args.length] = failures ?? "never";
  }
  if (requirements !== undefined) {
    args[args.length] = requirements;
  }
  return typeArguments(args);
}
function functionTypeDoc(scope: EmitNames, type: FunctionType): Doc {
  const checked = type.checked;
  const parameters = type.parameters.map((p, i) => {
    const parameterType = checked !== undefined && checked[i]
      ? "unknown"
      : typeDoc(scope, p, undefined);
    return property(parameterName(i), parameterType);
  });
  const result = typeDoc(scope, type.result, undefined);
  const returns = type.execution === "effect"
    ? effectTypeDoc(scope, result, type.effects)
    : result;
  return [
    bracketed("(", ")", parameters, false),
    " => ",
    returns,
  ];
}
/**
 * True when a Schema carries make-input or optionality metadata. The printed type
 * then needs the metadata intersection, and an emitted value needs `Schema.make`.
 */
export function hasSchemaMetadata(
  type: Extract<Type, {
    readonly kind: "schema";
  }>,
): SchemaMetadataPresence {
  return type.makeInput !== undefined || trueFlag(type.constructorDefault) ||
    trueFlag(type.optionalKey) || trueFlag(type.encodedOptionalKey) ||
    trueFlag(type.decodedOptionalKey);
}
export type SchemaMetadataPresence = boolean;
/** The readonly record type that prints each field type with `print`. */
function recordTypeDoc(
  type: Extract<Type, {
    readonly kind: "record";
  }>,
  print: (type: Type) => Doc,
): Doc {
  if (type.fields.length === 0) {
    return "{}";
  }
  const fields = type.fields.map((f) => [
    "readonly ",
    f.name,
    f.optional ? "?" : "",
    ": ",
    print(f.type),
  ]);
  return group(
    [
      "{",
      indent([line, join([";", line], fields)]),
      ifBreak(";", undefined),
      line,
      "}",
    ],
    undefined,
    undefined,
  );
}
/** The readonly tuple type that prints each element type with `print`. */
function tupleTypeDoc(
  type: Extract<Type, {
    readonly kind: "tuple";
  }>,
  print: (type: Type) => Doc,
): Doc {
  return type.elements.length === 0 ? "readonly []" : [
    "readonly [",
    join(", ", type.elements.map(print)),
    "]",
  ];
}
export function typeDoc(
  scope: EmitNames,
  type: Type,
  requestedBreak: BracketsBreak | undefined,
): Doc {
  const breakable = requestedBreak ?? false;
  if (type.kind === "primitive") {
    if (type.name === "int") return "number";
    if (type.name === "unit") return "void";
    return type.name;
  }
  if (type.kind === "literal") {
    return literalText(type.value);
  }
  if (type.kind === "named") {
    return scope.nameOf(type.id);
  }
  if (type.kind === "array") {
    return [
      "ReadonlyArray",
      singleArgument(
        type.element,
        typeDoc(scope, type.element, breakable),
        breakable,
      ),
    ];
  }
  if (type.kind === "tuple") {
    return tupleTypeDoc(type, (t) => typeDoc(scope, t, undefined));
  }
  if (type.kind === "option") {
    const option = scope.effect("Option");
    return [
      `${option}.Option`,
      singleArgument(
        type.element,
        typeDoc(scope, type.element, breakable),
        breakable,
      ),
    ];
  }
  if (type.kind === "ref") {
    return [
      `${scope.effect("SynchronizedRef")}.SynchronizedRef`,
      singleArgument(
        type.element,
        typeDoc(scope, type.element, breakable),
        breakable,
      ),
    ];
  }
  if (type.kind === "retry-schedule") {
    return [
      `${scope.effect("Schedule")}.Schedule<number, `,
      typeDoc(scope, type.error, undefined),
      ">",
    ];
  }
  if (type.kind === "schema") {
    const codec: Doc = [
      `${scope.effect("Schema")}.Codec`,
      typeArguments([
        typeDoc(scope, type.decoded, undefined),
        typeDoc(scope, type.encoded, undefined),
        requirementUnion(scope, type.decodeRequirements) ?? "never",
        requirementUnion(scope, type.encodeRequirements) ?? "never",
      ]),
    ];
    if (!hasSchemaMetadata(type)) {
      return codec;
    }
    return [
      "(",
      codec,
      ' & { readonly "~type.make.in": ',
      typeDoc(scope, type.makeInput ?? type.decoded, undefined),
      '; readonly "~type.optionality": "',
      trueFlag(type.optionalKey) || trueFlag(type.decodedOptionalKey)
        ? "optional"
        : "required",
      '"; readonly "~encoded.optionality": "',
      trueFlag(type.optionalKey) || trueFlag(type.encodedOptionalKey)
        ? "optional"
        : "required",
      '"; readonly "~type.constructor.default": "',
      trueFlag(type.constructorDefault) ? "with-default" : "no-default",
      '" })',
    ];
  }
  if (type.kind === "record") {
    return recordTypeDoc(type, (t) => typeDoc(scope, t, undefined));
  }
  if (type.kind === "union") {
    return unionDoc(type.members.map((m) => {
      const inner = typeDoc(scope, m, undefined);
      // A function or union member needs parentheses inside a union.
      return m.kind === "function" || m.kind === "union"
        ? ["(", inner, ")"]
        : inner;
    }));
  }
  if (type.kind === "function") {
    return functionTypeDoc(scope, type);
  }
  if (type.kind === "effect") {
    return effectTypeDoc(
      scope,
      typeDoc(scope, type.result, undefined),
      type.effects,
    );
  }
  if (type.kind === "stream") {
    return [
      `${scope.effect("Stream")}.Stream`,
      deferredArguments(
        scope,
        [typeDoc(scope, type.element, undefined)],
        type.effects,
      ),
    ];
  }
  if (type.kind === "sink") {
    return [
      `${scope.effect("Sink")}.Sink`,
      typeArguments([
        typeDoc(scope, type.result, undefined),
        typeDoc(scope, type.input, undefined),
        type.leftover === undefined
          ? "never"
          : typeDoc(scope, type.leftover, undefined),
        ...channelTypeArguments(scope, type.effects),
      ]),
    ];
  }
  if (type.kind === "provider") {
    // `Layer.Layer<S1 | S2, E, Rq>`.
    const services = servicesOf(type.provides).map((id) => scope.nameOf(id));
    return [
      `${scope.effect("Layer")}.Layer`,
      deferredArguments(
        scope,
        [unionDoc(services)],
        type.acquisition.effects,
      ),
    ];
  }
  return internal("unreachable type");
}
// ------------------------------------------------------------------ schemas
function schemaOfLiterals(
  scope: EmitNames,
  values: readonly (string | number | boolean | null)[],
): Doc {
  const schema = scope.effect("Schema");
  if (values.includes(null)) {
    const nonNull = values.filter((value) => value !== null);
    return nonNull.length === 0 ? `${schema}.Null` : [
      `${schema}.Union([`,
      schemaOfLiterals(scope, nonNull),
      `, ${schema}.Null])`,
    ];
  }
  if (values.length === 1) {
    return callWith(`${schema}.Literal`, literalText(values[0]));
  }
  return [
    `${schema}.Literals(`,
    bracketed("[", "]", values.map(literalText), false),
    ")",
  ];
}
type RecursiveTypes = ReadonlySet<string>;
type MaybeRecursiveTypes = RecursiveTypes | undefined;
/**
 * The TypeScript type that a type has after `schemaDoc` encodes it: a type with
 * identity becomes its base, an error becomes its Schema encoding, and each name of the
 * recursive group becomes its generated mirror type. The type has no function in it.
 */
export function encodedTypeDoc(
  scope: EmitNames,
  type: Type,
  recursive: MaybeRecursiveTypes,
): Doc {
  if (isDeferredKind(type)) {
    return internal("a deferred or function type has no schema");
  }
  if (type.kind === "primitive" || type.kind === "literal") {
    return typeDoc(scope, type, undefined);
  }
  if (type.kind === "named") {
    if (isClosedUnitId(type.id)) {
      return "number";
    }
    return recursive !== undefined && recursive.has(type.id)
      ? scope.encodedMirrorName(type.id)
      : [
        `${scope.effect("Schema")}.Codec.Encoded<typeof `,
        scope.nameOf(type.id),
        ">",
      ];
  }
  if (type.kind === "array") {
    return [
      "ReadonlyArray<",
      encodedTypeDoc(scope, type.element, recursive),
      ">",
    ];
  }
  if (type.kind === "tuple") {
    return tupleTypeDoc(type, (t) => encodedTypeDoc(scope, t, recursive));
  }
  if (type.kind === "option") {
    return [
      `${scope.effect("Option")}.Option<`,
      encodedTypeDoc(scope, type.element, recursive),
      ">",
    ];
  }
  if (type.kind === "record") {
    return recordTypeDoc(type, (t) => encodedTypeDoc(scope, t, recursive));
  }
  if (type.kind === "union") {
    return unionDoc(
      type.members.map((m) => encodedTypeDoc(scope, m, recursive)),
    );
  }
  return internal("unreachable encoded type");
}
/** The `name: schema` entries of a struct. An optional field uses `optionalKey`. */
export function schemaFieldDocs(
  scope: EmitNames,
  fields: readonly Field[],
  recursive: MaybeRecursiveTypes,
): Doc[] {
  const schema = scope.effect("Schema");
  return fields.map((f) => {
    const inner = schemaDoc(scope, f.type, recursive);
    return property(
      fieldKey(f.name),
      f.optional ? member(schema, "optionalKey", callWith("", inner)) : inner,
    );
  });
}
/** The Effect Schema value of a type. The type has no function or provider in it. */
export function schemaDoc(
  scope: EmitNames,
  type: Type,
  recursive: MaybeRecursiveTypes,
): Doc {
  const schema = scope.effect("Schema");
  if (isDeferredKind(type)) {
    return internal("a deferred or function type has no schema");
  }
  if (type.kind === "primitive") {
    if (type.name === "string") {
      return `${schema}.String`;
    }
    if (type.name === "boolean") {
      return `${schema}.Boolean`;
    }
    if (type.name === "number") {
      return `${schema}.Number`;
    }
    if (type.name === "int") {
      return scope.intSchemaName();
    }
    if (type.name === "unit") {
      return `${schema}.Void`;
    }
    if (type.name === "never") {
      return `${schema}.Never`;
    }
    if (type.name === "unknown") {
      return `${schema}.Unknown`;
    }
    return internal("unreachable primitive");
  }
  if (type.kind === "literal") {
    return schemaOfLiterals(scope, [type.value]);
  }
  if (type.kind === "named") {
    if (isClosedUnitId(type.id)) {
      return scope.intSchemaName();
    }
    return recursive !== undefined && recursive.has(type.id)
      ? [
        `${schema}.suspend((): ${schema}.Codec<`,
        scope.nameOf(type.id),
        ", ",
        scope.encodedMirrorName(type.id),
        "> => ",
        scope.nameOf(type.id),
        ")",
      ]
      : scope.nameOf(type.id);
  }
  if (type.kind === "array") {
    return callWith(
      `${schema}.Array`,
      schemaDoc(scope, type.element, recursive),
    );
  }
  if (type.kind === "tuple") {
    return [
      `${schema}.Tuple(`,
      bracketed(
        "[",
        "]",
        type.elements.map((t) => schemaDoc(scope, t, recursive)),
        false,
      ),
      ")",
    ];
  }
  if (type.kind === "option") {
    return callWith(
      `${schema}.Option`,
      schemaDoc(scope, type.element, recursive),
    );
  }
  if (type.kind === "record") {
    return [
      `${schema}.Struct(`,
      bracketed("{", "}", schemaFieldDocs(scope, type.fields, recursive), true),
      ")",
    ];
  }
  if (type.kind === "union") {
    const literals = type.members.flatMap((m) =>
      m.kind === "literal" ? [m.value] : []
    );
    if (literals.length === type.members.length) {
      return schemaOfLiterals(scope, literals);
    }
    return [
      `${schema}.Union(`,
      bracketed(
        "[",
        "]",
        type.members.map((m) => schemaDoc(scope, m, recursive)),
        false,
      ),
      ")",
    ];
  }
  return internal("unreachable schema type");
}
