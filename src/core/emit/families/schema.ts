// Emission of the Schema builtins: Schema operations, make, decode, and encode.
import type { Expr, Type } from "../../ir.ts";
import { SCHEMA_ERROR_ID, SCHEMA_ISSUE_ID } from "../../ir.ts";
import { type Doc, member } from "../doc.ts";
import {
  at,
  callArguments,
  type Emitted,
  emitted,
  free,
  type Kid,
  PREC,
} from "../emitted.ts";
import { internal } from "../failure.ts";
import { resolvedAs } from "../type_query.ts";
import type { ExprOf, LeafOf } from "../shape.ts";
import { hasSchemaMetadata, schemaDoc, typeDoc } from "../types.ts";
import type { ExprCore } from "./context.ts";
type SchemaStructuralKind = "schema";
type SchemaLeafKind = LeafOf<"schema-make" | "schema-decode" | "schema-encode">;
/** The `Schema` member that wraps one argument, for each operation that only wraps it. */
const SINGLE_ARGUMENT_NAMES = {
  "array": "Array",
  "struct": "Struct",
  "optional-key": "optionalKey",
  "option-from-optional-key": "OptionFromOptionalKey",
  "union": "Union",
} as const;
export function schemaStructural(
  c: ExprCore,
  e: ExprOf<SchemaStructuralKind>,
  kid: Kid,
): Emitted {
  const schema = c.scope.effect("Schema");
  const args = e.arguments;
  const resultType = c.scope.resolve(e.type);
  function withSchemaView(value: Emitted): Emitted {
    return resultType.kind === "schema" && hasSchemaMetadata(resultType)
      ? emitted(
        [
          `${schema}.make<`,
          typeDoc(c.scope, resultType, undefined),
          ">(",
          at(value, PREC.member),
          ".ast)",
        ],
        undefined,
        undefined,
      )
      : value;
  }
  if (e.op === "constructor-default") {
    {
      const sourceType = resolvedAs(
        c.scope,
        args[0].type,
        "schema",
        "constructor default needs a Schema",
      );
      const effect = c.scope.effect("Effect");
      const callback = c.pure(args[1], undefined);
      const effectful = isEffectfulCallback(args[1].type);
      return withSchemaView(emitted(
        [
          `${schema}.make<(`,
          typeDoc(c.scope, sourceType, undefined),
          ' & { readonly "~type.make.in": ',
          typeDoc(
            c.scope,
            sourceType.makeInput ?? sourceType.decoded,
            undefined,
          ),
          ` } & ${schema}.WithoutConstructorDefault)>(`,
          at(kid(args[0], undefined), PREC.member),
          ".ast).pipe(",
          `${schema}.withConstructorDefault(${effect}.${
            effectful ? "suspend" : "sync"
          }(() => `,
          at(callback, PREC.member),
          "())))",
        ],
        undefined,
        undefined,
      ));
    }
  }
  if (e.op === "identity") {
    {
      const type = resolvedAs(
        c.scope,
        e.type,
        "schema",
        "schema identity has wrong type",
      );
      return emitted(
        [
          `${schema}.toType(`,
          schemaDoc(c.scope, type.decoded, undefined),
          ")",
        ],
        undefined,
        undefined,
      );
    }
  }
  if (
    e.op === "array" || e.op === "struct" || e.op === "optional-key" ||
    e.op === "option-from-optional-key" || e.op === "union"
  ) {
    return withSchemaView(emitted(
      [
        `${schema}.${SINGLE_ARGUMENT_NAMES[e.op]}`,
        callArguments([kid(args[0], undefined)]),
      ],
      undefined,
      undefined,
    ));
  }
  if (e.op === "null-to-missing-key") {
    {
      const getter = c.scope.effect("SchemaGetter");
      const option = c.scope.effect("Option");
      const source = c.scope.temp();
      const value = c.scope.temp();
      return withSchemaView(emitted(
        [
          "((",
          source,
          ": ",
          typeDoc(c.scope, args[0].type, undefined),
          ") => ",
          `${schema}.optionalKey(${schema}.NullOr(${source})).pipe(`,
          `${schema}.decodeTo(${schema}.optionalKey(${schema}.toType(${source})), { `,
          `decode: ${getter}.transformOptional(${option}.filter((${value}) => ${value} !== null)), `,
          `encode: ${getter}.transformOptional((${value}) => ${value})`,
          " })))(",
          free(kid(args[0], undefined)),
          ")",
        ],
        undefined,
        undefined,
      ));
    }
  }
  if (
    e.op === "default-key" || e.op === "default-null-key" ||
    e.op === "default-encoded-key"
  ) {
    {
      const effect = c.scope.effect("Effect");
      const fallback = c.pure(args[1], undefined);
      const callback = args[1].type;
      const effectful = isEffectfulCallback(callback);
      const issueFailure = callback.kind === "function" &&
        callback.effects.failures.includes(SCHEMA_ISSUE_ID);
      const deferred: Doc = [
        `${effect}.${effectful ? "suspend" : "sync"}(() => `,
        at(fallback, PREC.member),
        "())",
      ];
      const issue = c.scope.temp();
      const defaultValue: Doc = issueFailure
        ? [
          `${effect}.mapError(`,
          deferred,
          ", (",
          issue,
          ") => new ",
          `${schema}.SchemaError(`,
          issue,
          "))",
        ]
        : deferred;
      if (e.op === "default-null-key") {
        const getter = c.scope.effect("SchemaGetter");
        const option = c.scope.effect("Option");
        const source = c.scope.temp();
        const value = c.scope.temp();
        const issueDefault: Doc = callback.kind === "function" &&
            callback.effects.failures.includes(SCHEMA_ERROR_ID)
          ? [
            `${effect}.mapError(`,
            deferred,
            `, (${issue}) => ${issue}.issue)`,
          ]
          : deferred;
        const options = args[2];
        const omit = options?.kind === "record" &&
          options.fields[0].value.kind === "literal" &&
          options.fields[0].value.value === "omit";
        return withSchemaView(emitted(
          [
            "((",
            source,
            ": ",
            typeDoc(c.scope, args[0].type, undefined),
            ") => ",
            `${schema}.optionalKey(${schema}.NullOr(${source})).pipe(`,
            `${schema}.decodeTo(${schema}.toType(${source}), { `,
            `decode: ${getter}.transformOptionalEffect((${value}) => { `,
            `const ${issue} = ${option}.filter(${value}, (${value}) => ${value} !== null); `,
            `return ${option}.isSome(${issue}) ? ${effect}.succeed(${issue}) : ${effect}.map(`,
            issueDefault,
            `, ${option}.some); }), `,
            `encode: ${getter}.${omit ? "omit" : "passthrough"}() })))`,
            "(",
            free(kid(args[0], undefined)),
            ")",
          ],
          undefined,
          undefined,
        ));
      }
      return withSchemaView(emitted(
        [
          at(kid(args[0], undefined), PREC.member),
          ".pipe(",
          `${schema}.${
            e.op === "default-encoded-key"
              ? "withDecodingDefaultKey"
              : "withDecodingDefaultTypeKey"
          }(`,
          defaultValue,
          ...(args[2] === undefined
            ? []
            : [", ", free(kid(args[2], undefined))]),
          "))",
        ],
        undefined,
        undefined,
      ));
    }
  }
  if (e.op === "optional-transform") {
    {
      const getter = c.scope.effect("SchemaGetter");
      const decode = c.pure(args[2], undefined);
      const encode = c.pure(args[3], undefined);
      return withSchemaView(emitted(
        [
          at(kid(args[0], undefined), PREC.member),
          ".pipe(",
          `${schema}.decodeTo(`,
          free(kid(args[1], undefined)),
          ", { decode: ",
          `${getter}.${schemaGetterName(args, 2)}(`,
          free(decode),
          "), encode: ",
          `${getter}.${schemaGetterName(args, 3)}(`,
          free(encode),
          ") }))",
        ],
        undefined,
        undefined,
      ));
    }
  }
  if (e.op === "optional-from-required") {
    {
      const getter = c.scope.effect("SchemaGetter");
      const effect = c.scope.effect("Effect");
      const option = c.scope.effect("Option");
      const issue = c.scope.effect("SchemaIssue");
      const decode = c.pure(args[2], undefined);
      const encode = c.pure(args[3], undefined);
      const decodeEffectful = isEffectfulCallback(args[2].type);
      const encodeEffectful = isEffectfulCallback(args[3].type);
      const decodeValue = c.scope.temp();
      const encodeValue = c.scope.temp();
      const encodeResult: Doc = encodeEffectful
        ? [
          `${effect}.map(${effect}.suspend(() => `,
          at(encode, PREC.member),
          "(",
          encodeValue,
          `)), ${option}.some)`,
        ]
        : [
          `${option}.some(`,
          at(encode, PREC.member),
          "(",
          encodeValue,
          "))",
        ];
      return withSchemaView(emitted(
        [
          at(kid(args[0], undefined), PREC.member),
          ".pipe(",
          `${schema}.decodeTo(`,
          free(kid(args[1], undefined)),
          ", { decode: ",
          `${getter}.transformOptionalEffect((${decodeValue}) => `,
          `${option}.isSome(${decodeValue}) ? `,
          `${effect}.${decodeEffectful ? "suspend" : "sync"}(() => `,
          at(decode, PREC.member),
          "(",
          decodeValue,
          `.value)) : ${effect}.fail(new ${issue}.InvalidValue({ message: `,
          '"required encoded key is missing"',
          " })))",
          ", encode: ",
          `${getter}.${
            encodeEffectful ? "transformOptionalEffect" : "transformOptional"
          }((${encodeValue}) => `,
          encodeResult,
          ") }))",
        ],
        undefined,
        undefined,
      ));
    }
  }
  if (e.op === "recursive") {
    {
      const body = c.scope.temp();
      const self = c.scope.temp();
      const callback = c.pure(args[0], undefined);
      const type = typeDoc(c.scope, e.type, undefined);
      return emitted(
        [
          "(() => { let ",
          body,
          ": ",
          type,
          "; const ",
          self,
          ": ",
          type,
          ` = ${schema}.suspend(() => `,
          body,
          "); ",
          body,
          " = ",
          at(callback, PREC.member),
          "(",
          self,
          "); return ",
          self,
          "; })()",
        ],
        undefined,
        undefined,
      );
    }
  }
  if (e.op === "transform") {
    {
      const source = kid(args[0], undefined);
      const target = kid(args[1], undefined);
      const decode = c.pure(args[2], undefined);
      const encode = c.pure(args[3], undefined);
      const transformation = c.scope.effect("SchemaTransformation");
      const issue = c.scope.effect("SchemaIssue");
      const effect = c.scope.effect("Effect");
      const option = c.scope.effect("Option");
      const value = c.scope.temp();
      const result = c.scope.temp();
      return withSchemaView(emitted(
        [
          at(source, PREC.member),
          ".pipe(",
          `${schema}.decodeTo(`,
          free(target),
          ", ",
          `${transformation}.transformEffect({ decode: `,
          schemaConversion(
            decode,
            schemaIssueMode(args, 2),
            isEffectfulCallback(args[2].type),
            value,
            result,
            effect,
            option,
            issue,
          ),
          ", encode: ",
          schemaConversion(
            encode,
            schemaIssueMode(args, 3),
            isEffectfulCallback(args[3].type),
            value,
            result,
            effect,
            option,
            issue,
          ),
          " })))",
        ],
        undefined,
        undefined,
      ));
    }
  }
  {
    const missing: never = e.op;
    return internal(`unhandled Schema operation ${missing}`);
  }
}
export function schemaLeaf(
  c: ExprCore,
  e: ExprOf<SchemaLeafKind>,
  children: readonly Emitted[],
): Emitted {
  if (e.kind === "schema-make") {
    return emitted(
      member(
        at(children[0], PREC.member),
        "makeEffect",
        callArguments([
          c.adaptedInput(children[1], e.input.type, "make"),
        ]),
      ),
      undefined,
      undefined,
    );
  }
  const schema = c.scope.effect("Schema");
  const schemaType = c.scope.resolve(e.schema.type);
  let inputType = e.input.type;
  if (schemaType.kind === "schema") {
    inputType = e.kind === "schema-decode"
      ? schemaType.encoded
      : schemaType.decoded;
  }
  const input = c.adaptedInput(
    children[1],
    inputType,
    e.kind === "schema-decode" ? "encoded" : "decoded",
  );
  return emitted(
    [
      `${schema}.${
        e.kind === "schema-decode" ? "decodeUnknownEffect" : "encodeEffect"
      }(`,
      free(children[0]),
      ")(",
      free(input),
      ")",
    ],
    undefined,
    undefined,
  );
}
/**
 * True for a function type that runs as an effect. Unlike `isEffectfulFunction`,
 * it does not resolve aliases.
 */
function isEffectfulCallback(type: Type): boolean {
  return type.kind === "function" && type.execution === "effect";
}

function schemaGetterName(
  args: readonly Expr[],
  index: number,
): "transformOptionalEffect" | "transformOptional" {
  return isEffectfulCallback(args[index].type)
    ? "transformOptionalEffect"
    : "transformOptional";
}

function schemaIssueMode(args: readonly Expr[], index: number): boolean {
  const type = args[index].type;
  return type.kind === "function" &&
    type.effects.failures.includes(SCHEMA_ISSUE_ID);
}

function schemaConversion(
  callback: Emitted,
  issueMode: boolean,
  effectful: boolean,
  value: string,
  result: string,
  effect: string,
  option: string,
  issue: string,
): Doc {
  if (issueMode) {
    return ["(", value, ") => ", at(callback, PREC.member), "(", value, ")"];
  }
  return [
    "(",
    value,
    ") => ",
    `${effect}.flatMap(`,
    ...(effectful ? [] : [`${effect}.succeed(`]),
    at(callback, PREC.member),
    "(",
    value,
    effectful ? "), (" : ")), (",
    result,
    ") => ",
    `${option}.isSome(`,
    result,
    ") ? ",
    `${effect}.succeed(`,
    result,
    ".value) : ",
    `${effect}.fail(new ${issue}.InvalidValue({ message: \"schema transformation rejected\" }, `,
    value,
    ")))",
  ];
}
