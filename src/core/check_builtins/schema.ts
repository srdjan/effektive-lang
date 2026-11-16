// Schema construction, directional transformations, defaults and recursion checks.
import { type CapabilityId, SCHEMA_ERROR_ID, SCHEMA_ISSUE_ID } from "../ir.ts";
import type { DiagnosticCode } from "../diagnostics.ts";
import { panic } from "../source.ts";
import { kindOf, type NodeId, SyntaxKind } from "../syntax.ts";
import {
  functionParts,
  literalOf,
  recordFieldParts,
} from "../syntax_queries.ts";
import { combine, PURE_EFFECTS } from "../effect_set.ts";
import type { NodeFact, NodeInfo } from "../tables.ts";
import { dataOnly, type TypeNode, type TypeRef } from "../types.ts";
import { emptyMap, emptySet, setFrom } from "../runtime.ts";
import type {
  Arg,
  BuiltinContext,
  FactView,
  ResolveView,
  SyntaxView,
} from "./context.ts";
import type { BuiltinRow, Rows, SharedPrologue } from "./rows.ts";

export type SchemaContext =
  & Pick<
    BuiltinContext,
    | "table"
    | "module"
    | "assignable"
    | "argInfo"
    | "callback"
    | "finish"
    | "fits"
    | "functionOf"
    | "isError"
  >
  & SyntaxView
  & ResolveView
  & FactView
  & {
    checkFit(
      node: NodeId,
      found: TypeRef,
      expected: TypeRef | undefined,
      what: string,
    ): SchemaContext;
    report(code: DiagnosticCode, message: string, node: NodeId): SchemaContext;
    fact(node: NodeId, fact: NodeFact): SchemaContext;
    readonly infos: ReadonlyMap<NodeId, NodeInfo>;
    kidsOfKind(node: NodeId, kind: SyntaxKind): NodeId[];
    expr(node: NodeId, expected: TypeRef | undefined): NodeInfo;
  };

type SchemaNode = Extract<TypeNode, { readonly kind: "schema" }>;

/**
 * True when `failures` is known and holds no failure or exactly one failure
 * from `allowed`. A set with two failures fails the test, even when both are
 * allowed.
 */
function failsOnlyWith(
  failures: readonly string[] | undefined,
  allowed: readonly string[],
): boolean {
  return failures !== undefined && failures.length <= 1 &&
    failures.every((id) => allowed.includes(id));
}

type SchemaOp = Extract<NodeFact, { readonly kind: "schema" }>["op"];

/**
 * Where `self` may occur below a call of a Schema builtin in a recursive body.
 * - "guard": the argument is below a guard, so `self` is allowed there.
 * - "container": the arguments keep the guard state that the call has.
 * - "pass-first": `self` may occur only in the first argument. A later one is a callback.
 * - "pass-two": `self` may occur only in the first two arguments.
 * - "reject": `self` may not occur below the call.
 */
type RecursionRole =
  | "guard"
  | "container"
  | "pass-first"
  | "pass-two"
  | "reject";

/** How `schemaCall` treats one Schema builtin. */
type SchemaBuiltin = {
  readonly op: SchemaOp;
  readonly arity: number;
  /** A third options argument is also accepted. */
  readonly acceptsOptions?: true;
  /** The Schema argument may carry a constructor default. */
  readonly acceptsDefault: boolean;
  /** Constructor make-input metadata passes through this builtin. */
  readonly preservesMakeInput: boolean;
  /** How a recursive Schema body may hold its `self` below a call of this builtin. */
  readonly recursion: RecursionRole;
};

type SchemaBuiltinName =
  | "schema"
  | "schemaArray"
  | "schemaStruct"
  | "schemaOptionalKey"
  | "schemaNullToMissingKey"
  | "schemaOptionFromOptionalKey"
  | "schemaDefaultKey"
  | "schemaConstructorDefault"
  | "schemaOptionalTransform"
  | "schemaOptionalFromRequired"
  | "schemaUnion"
  | "schemaTransform"
  | "schemaRecursive"
  | "schemaDecode"
  | "schemaEncode"
  | "schemaMake";

const SCHEMA_BUILTINS: Readonly<Record<SchemaBuiltinName, SchemaBuiltin>> = {
  schema: {
    op: "identity",
    arity: 0,
    acceptsDefault: false,
    preservesMakeInput: false,
    recursion: "reject",
  },
  schemaArray: {
    op: "array",
    arity: 1,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "guard",
  },
  schemaStruct: {
    op: "struct",
    arity: 1,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "container",
  },
  schemaOptionalKey: {
    op: "optional-key",
    arity: 1,
    acceptsDefault: true,
    preservesMakeInput: true,
    recursion: "guard",
  },
  schemaNullToMissingKey: {
    op: "null-to-missing-key",
    arity: 1,
    acceptsDefault: true,
    preservesMakeInput: true,
    recursion: "guard",
  },
  schemaOptionFromOptionalKey: {
    op: "option-from-optional-key",
    arity: 1,
    acceptsDefault: true,
    preservesMakeInput: true,
    recursion: "reject",
  },
  schemaDefaultKey: {
    op: "default-key",
    arity: 2,
    acceptsOptions: true,
    acceptsDefault: true,
    preservesMakeInput: true,
    recursion: "pass-first",
  },
  schemaConstructorDefault: {
    op: "constructor-default",
    arity: 2,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "pass-first",
  },
  schemaOptionalTransform: {
    op: "optional-transform",
    arity: 4,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "pass-two",
  },
  schemaOptionalFromRequired: {
    op: "optional-from-required",
    arity: 4,
    acceptsDefault: true,
    preservesMakeInput: true,
    recursion: "pass-two",
  },
  schemaUnion: {
    op: "union",
    arity: 1,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "container",
  },
  schemaTransform: {
    op: "transform",
    arity: 4,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "reject",
  },
  schemaRecursive: {
    op: "recursive",
    arity: 1,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "reject",
  },
  schemaDecode: {
    op: "decode",
    arity: 2,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "reject",
  },
  schemaEncode: {
    op: "encode",
    arity: 2,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "reject",
  },
  schemaMake: {
    op: "make",
    arity: 2,
    acceptsDefault: false,
    preservesMakeInput: true,
    recursion: "reject",
  },
};

const DEFAULT_KEY_ON = ["missing", "null", "encoded"] as const;

const DEFAULT_KEY_OPTION = "on";

const DEFAULT_KEY_OPS = {
  missing: "default-key",
  null: "default-null-key",
  encoded: "default-encoded-key",
} as const;

/** The recursion role of a builtin name; a name that is not a Schema builtin rejects `self`. */
function recursionRoleOf(name: string | undefined): RecursionRole {
  return name !== undefined && isSchemaBuiltinName(name)
    ? SCHEMA_BUILTINS[name].recursion
    : "reject";
}

function isSchemaBuiltinName(name: string): name is SchemaBuiltinName {
  return Object.hasOwn(SCHEMA_BUILTINS, name);
}

/** What a Schema handler reads from the call. */
type SchemaCall = {
  readonly node: NodeId;
  readonly name: SchemaBuiltinName;
  readonly builtin: SchemaBuiltin;
  /** The op that the prologue recorded: `schemaDefaultKey` may select another with `on`. */
  readonly op: SchemaOp;
  readonly args: readonly Arg[];
  readonly expected: TypeRef | undefined;
};

type SchemaHandler = (checker: SchemaContext, call: SchemaCall) => NodeInfo;

/** One handler for each Schema op. A missing op is a compile error. */
type SchemaHandlers = { readonly [O in SchemaOp]: SchemaHandler };

const SCHEMA_HANDLERS: SchemaHandlers = {
  identity: (c, call) => schemaIdentityCall(c, call),
  array: (c, call) => schemaArrayCall(c, call),
  struct: (c, call) => schemaStructCall(c, call),
  "optional-key": (c, call) => schemaOptionalKeyCall(c, call),
  "null-to-missing-key": (c, call) => schemaNullToMissingKeyCall(c, call),
  "option-from-optional-key": (c, call) =>
    schemaOptionFromOptionalKeyCall(c, call),
  "default-key": (c, call) =>
    schemaDefaultKeyCall(c, call, { direction: "decoded", nullable: false }),
  "constructor-default": (c, call) => schemaConstructorDefaultCall(c, call),
  "default-null-key": (c, call) =>
    schemaDefaultKeyCall(c, call, { direction: "decoded", nullable: true }),
  "default-encoded-key": (c, call) =>
    schemaDefaultKeyCall(c, call, { direction: "encoded", nullable: false }),
  "optional-transform": (c, call) => schemaOptionalBridgeCall(c, call),
  "optional-from-required": (c, call) => schemaOptionalBridgeCall(c, call),
  union: (c, call) => schemaUnionCall(c, call),
  transform: (c, call) => schemaTransformCall(c, call),
  recursive: (c, call) => schemaRecursiveCall(c, call),
  decode: (c, call) => schemaOperationCall(c, call),
  encode: (c, call) => schemaOperationCall(c, call),
  make: (c, call) => schemaOperationCall(c, call),
};

/** The literal value of a field in an inline options record, by label. */
function optionsField(c: SchemaContext, record: NodeId, label: string): {
  readonly value: NodeId | undefined;
} | undefined {
  if (kindOf(c.tree, record) !== SyntaxKind.RecordExpr) {
    return undefined;
  }
  for (const field of c.kids(record)) {
    const parts = recordFieldParts(c.tree, field);
    if (parts?.label === label) {
      return { value: parts.value };
    }
  }
  return undefined;
}

/**
 * The Schema operation that the `on` option of `schemaDefaultKey` selects. An
 * absent `on` means "missing". An `on` that is not one of the three literals
 * is reported here and selects the default operation.
 */
function defaultKeyChoice(
  c: SchemaContext,
  name: SchemaBuiltinName,
  options: Arg,
): "default-key" | "default-null-key" | "default-encoded-key" {
  const field = optionsField(c, options.node, DEFAULT_KEY_OPTION);
  if (field === undefined) return "default-key";
  const value = field.value;
  const literal = value !== undefined &&
      kindOf(c.tree, value) === SyntaxKind.LiteralExpr
    ? literalOf(c.tree, value)
    : undefined;
  const on = DEFAULT_KEY_ON.find((candidate) => candidate === literal);
  if (on === undefined) {
    c = c.report(
      "type-mismatch/010",
      `${name} \`on\` must be a literal "missing", "null", or "encoded"`,
      value ?? options.node,
    );
    return "default-key";
  }
  return DEFAULT_KEY_OPS[on];
}

/** Whether an options record is inline with distinct known fields. */
function defaultKeyOptionsShape(c: SchemaContext, record: NodeId): boolean {
  if (kindOf(c.tree, record) !== SyntaxKind.RecordExpr) {
    return false;
  }
  const fields = c.kids(record);
  if (fields.length < 1 || fields.length > 2) {
    return false;
  }
  let seen = emptySet<string>();
  for (const field of fields) {
    const parts = kindOf(c.tree, field) === SyntaxKind.RecordField
      ? recordFieldParts(c.tree, field)
      : undefined;
    if (
      parts === undefined || parts.value === undefined ||
      seen.has(parts.label) ||
      kindOf(c.tree, parts.value) !== SyntaxKind.LiteralExpr
    ) {
      return false;
    }
    seen = seen.add(parts.label);
    if (parts.label === "encodingStrategy") {
      const strategy = literalOf(c.tree, parts.value);
      if (strategy !== "omit" && strategy !== "passthrough") {
        return false;
      }
    } else if (parts.label !== DEFAULT_KEY_OPTION) {
      return false;
    }
  }
  return true;
}

function schemaCall(
  c: SchemaContext,
  node: NodeId,
  name: SchemaBuiltinName,
  args: readonly Arg[],
  expected: TypeRef | undefined,
): NodeInfo {
  const builtin: SchemaBuiltin = SCHEMA_BUILTINS[name];
  const fact = c.facts.get(node);
  if (fact?.kind !== "schema") {
    return panic("internal: a Schema builtin call has no schema fact");
  }
  const op = fact.op;
  const handler = SCHEMA_HANDLERS[op];
  const result = handler(c, {
    node: node,
    name: name,
    builtin: builtin,
    op: op,
    args: args,
    expected: expected,
  });
  const type = c.table.node(c.table.unfold(result.type));
  if (
    type.kind === "schema" &&
    c.table.containsForeignSealed(c.module, type.decoded)
  ) {
    c = c.report(
      "sealed/004",
      "only the declaring module can derive a Schema that decodes to a sealed type",
      node,
    );
  }
  return result;
}

function changedMakeInput(c: SchemaContext, type: SchemaNode): boolean {
  return type.makeInput !== undefined &&
    !(c.table.isAssignableIn(c.module, type.makeInput, type.decoded) &&
      c.table.isAssignableIn(c.module, type.decoded, type.makeInput));
}

/** The Schema type of a checked argument, or undefined after a report. */
function schemaOf(
  c: SchemaContext,
  call: SchemaCall,
  info: NodeInfo,
  at: NodeId,
): SchemaNode | undefined {
  const name = call.name;
  const builtin = call.builtin;
  const op = call.op;
  const type = c.table.node(c.table.unfold(info.type));
  const accepted = type.kind === "schema" &&
    (op === "constructor-default" ||
      type.presence === "required") &&
    (builtin.acceptsDefault || !type.constructorDefault);
  if (!accepted && !c.isError(info.type)) {
    c = c.report("type-mismatch/010", `\`${name}\` needs a Schema value`, at);
  }
  if (
    type.kind === "schema" && changedMakeInput(c, type) &&
    !builtin.preservesMakeInput
  ) {
    c = c.report(
      "type-mismatch/010",
      `${name} does not yet preserve constructor make-input metadata`,
      at,
    );
  }
  return accepted ? type : undefined;
}

/** The SchemaOptional type of a checked argument, or undefined after a report. */
function optionalOf(
  c: SchemaContext,
  call: SchemaCall,
  info: NodeInfo,
  at: NodeId,
): SchemaNode | undefined {
  const type = c.table.node(c.table.unfold(info.type));
  if (type.kind !== "schema" || type.presence !== "optional") {
    if (!c.isError(info.type)) {
      c = c.report(
        "type-mismatch/010",
        `\`${call.name}\` needs a SchemaOptional field`,
        at,
      );
    }
    return undefined;
  }
  return type;
}

/** Checks the first argument as the Schema that most ops wrap. */
function firstSchema(c: SchemaContext, call: SchemaCall): {
  first: NodeInfo;
  schema: SchemaNode | undefined;
} {
  const first = c.argInfo(call.args[0], undefined);
  return { first: first, schema: schemaOf(c, call, first, call.args[0].node) };
}

/**
 * The expected Schema type that `schema()` and `schemaRecursive` read their
 * type from, with the expected type itself. Returns undefined after a report.
 */
function expectedSchema(c: SchemaContext, call: SchemaCall): {
  schema: SchemaNode;
  type: TypeRef;
} | undefined {
  const node = call.node;
  const name = call.name;
  const expected = call.expected;
  const hintKind = expected === undefined
    ? undefined
    : c.table.node(c.table.unfold(expected)).kind;
  const hintable = hintKind === "schema" || hintKind === "error";
  const hint = expected === undefined || !hintable
    ? undefined
    : schemaOf(c, call, {
      type: expected,
      failures: [],
      requirements: [],
      mode: "pure",
    }, node);
  if (expected === undefined || hint === undefined) {
    // `schemaOf` has already reported a rejected flag or a poisoned hint.
    if (!hintable) {
      c = c.report(
        "type-mismatch/010",
        `\`${name}\` needs an expected Schema type`,
        node,
      );
    }
    return undefined;
  }
  if (
    !dataOnly(c.table, hint.decoded, "value", true) ||
    !dataOnly(c.table, hint.encoded, "value", true) ||
    !dataOnly(c.table, hint.makeInput ?? hint.decoded, "value", true)
  ) {
    c = c.report(
      "type-mismatch/010",
      "Schema data must be compiler-derived",
      node,
    );
  }
  return { schema: hint, type: expected };
}

function schemaIdentityCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const node = call.node;
  const hint = expectedSchema(c, call);
  if (hint === undefined) {
    return c.finish(node, c.table.error, PURE_EFFECTS);
  }
  if (
    hint.schema.decoded !== hint.schema.encoded ||
    hint.schema.decodeRequirements.length ||
    hint.schema.encodeRequirements.length
  ) {
    c = c.report(
      "type-mismatch/003",
      "`schema()` needs an identity Schema with no services",
      node,
    );
  }
  return c.finish(node, hint.type, PURE_EFFECTS);
}

function schemaRecursiveCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const node = call.node;
  const name = call.name;
  const args = call.args;
  const hint = expectedSchema(c, call);
  if (hint === undefined) {
    return c.finish(
      node,
      c.table.error,
      combine(args.map((arg) => c.argInfo(arg, undefined))),
    );
  }
  const callback = c.callback(name, args[0], [hint.type], hint.type, false);
  if (!guardedSchemaCallback(c, args[0].node)) {
    c = c.report(
      "type-mismatch/010",
      "recursive schema self must occur beneath an array, optional key, or tagged union with a terminal branch",
      args[0].node,
    );
  }
  if (!c.assignable(callback.result, hint.type)) {
    c = c.report(
      "type-mismatch/003",
      "recursive schema body does not fit its expected Schema",
      args[0].node,
    );
  }
  return c.finish(node, hint.type, combine([callback.info]));
}

function schemaStructCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const node = call.node;
  const args = call.args;
  const input = c.argInfo(args[0], undefined);
  const record = c.table.node(c.table.unfold(input.type));
  if (record.kind !== "record" || record.fields.some((f) => f.optional)) {
    c = c.report(
      "type-mismatch/010",
      "`schemaStruct` needs a record of required Schema fields",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([input]));
  }
  const fields = record.fields.flatMap((field) => {
    const schema = c.table.node(c.table.unfold(field.type));
    return schema.kind === "schema" ? [{ field: field, schema: schema }] : [];
  });
  if (fields.length !== record.fields.length) {
    c = c.report(
      "type-mismatch/010",
      "`schemaStruct` fields must be Schema values or schemaOptionalKey descriptors",
      args[0].node,
    );
    return c.finish(node, c.table.error, combine([input]));
  }
  const decoded = c.table.record(fields.map((entry) => ({
    name: entry.field.name,
    type: entry.schema.decoded,
    optional: entry.schema.presence === "optional" ||
      entry.schema.presence === "decoded-optional",
  })));
  const encoded = c.table.record(fields.map((entry) => ({
    name: entry.field.name,
    type: entry.schema.encoded,
    optional: entry.schema.presence === "optional" ||
      entry.schema.presence === "encoded-optional",
  })));
  return c.finish(
    node,
    c.table.schema(
      decoded,
      encoded,
      fields.flatMap((entry) => entry.schema.decodeRequirements),
      fields.flatMap((entry) => entry.schema.encodeRequirements),
      {
        makeInput: c.table.record(fields.map((entry) => ({
          name: entry.field.name,
          type: entry.schema.makeInput ?? entry.schema.decoded,
          optional: entry.schema.presence === "optional" ||
            entry.schema.presence === "decoded-optional" ||
            (entry.schema.constructorDefault ?? false),
        }))),
      },
    ),
    combine([input]),
  );
}

function schemaUnionCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const node = call.node;
  const args = call.args;
  const list = args[0].node;
  if (kindOf(c.tree, list) !== SyntaxKind.ListExpr) {
    const input = c.argInfo(args[0], undefined);
    c = c.report(
      "type-mismatch/010",
      "`schemaUnion` needs an inline list of Schema branches",
      list,
    );
    return c.finish(node, c.table.error, combine([input]));
  }
  const elements = c.kids(list);
  const spread = elements.find((element) =>
    kindOf(c.tree, element) === SyntaxKind.SpreadElement
  );
  if (spread !== undefined) {
    c = c.report(
      "type-mismatch/003",
      "`schemaUnion` takes a list literal of schemas without a spread",
      spread,
    );
    const infos = elements.map((element) =>
      c.expr(
        kindOf(c.tree, element) === SyntaxKind.SpreadElement
          ? c.kids(element)[0]
          : element,
        undefined,
      )
    );
    return c.finish(node, c.table.error, combine(infos));
  }
  c = c.fact(list, { kind: "list", shape: "tuple" });
  const infos = elements.map((element) => c.expr(element, undefined));
  const input = c.finish(
    list,
    c.table.tuple(infos.map((info) => info.type)),
    combine(infos),
  );
  const branches = infos.map((info, index) =>
    schemaOf(c, call, info, elements[index])
  );
  if (branches.length < 2 || branches.some((branch) => branch === undefined)) {
    c = c.report(
      "type-mismatch/010",
      "`schemaUnion` needs at least two ordinary Schema branches",
      list,
    );
    return c.finish(node, c.table.error, combine([input]));
  }
  const schemas = branches.filter((branch) => branch !== undefined);
  return c.finish(
    node,
    c.table.schema(
      c.table.union(schemas.map((branch) => branch.decoded)),
      c.table.union(schemas.map((branch) => branch.encoded)),
      schemas.flatMap((branch) => branch.decodeRequirements),
      schemas.flatMap((branch) => branch.encodeRequirements),
      {
        makeInput: c.table.union(
          schemas.map((branch) => branch.makeInput ?? branch.decoded),
        ),
      },
    ),
    combine([input]),
  );
}

/** `schemaOptionalTransform` and `schemaOptionalFromRequired`. */
function schemaOptionalBridgeCall(
  c: SchemaContext,
  call: SchemaCall,
): NodeInfo {
  const node = call.node;
  const args = call.args;
  const fromRequired = call.name === "schemaOptionalFromRequired";
  const sourceInfo = c.argInfo(args[0], undefined);
  const targetInfo = c.argInfo(args[1], undefined);
  const source = fromRequired
    ? schemaOf(c, call, sourceInfo, args[0].node)
    : optionalOf(c, call, sourceInfo, args[0].node);
  const target = optionalOf(c, call, targetInfo, args[1].node);
  if (source === undefined || target === undefined) {
    return c.finish(
      node,
      c.table.error,
      combine([
        sourceInfo,
        targetInfo,
        ...args.slice(2).map((arg) => c.argInfo(arg, undefined)),
      ]),
    );
  }
  return optionalBridge(c, call, {
    sourceInfo: sourceInfo,
    targetInfo: targetInfo,
    source: source,
    target: target,
  });
}

function schemaConstructorDefaultCall(
  c: SchemaContext,
  call: SchemaCall,
): NodeInfo {
  const node = call.node;
  const name = call.name;
  const args = call.args;
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  const callback = c.callback(
    name,
    args[1],
    [],
    schema?.makeInput ?? schema?.decoded,
    true,
  );
  const fn = c.functionOf(callback.info.type);
  if (
    kindOf(c.tree, args[1].node) !== SyntaxKind.ArrowExpr ||
    fn === undefined ||
    fn.requirements.length !== 0 ||
    !failsOnlyWith(fn.failures, [SCHEMA_ISSUE_ID]) ||
    (schema !== undefined &&
      !c.assignable(
        callback.result,
        schema.makeInput ?? schema.decoded,
      ))
  ) {
    c = c.report(
      "type-mismatch/010",
      "schemaConstructorDefault needs an inline make-input callback with no services and only SchemaIssue failure",
      args[1].node,
    );
  }
  return c.finish(
    node,
    schema === undefined ? c.table.error : c.table.schema(
      schema.decoded,
      schema.encoded,
      schema.decodeRequirements,
      schema.encodeRequirements,
      {
        presence: schema.presence,
        makeInput: schema.makeInput ?? schema.decoded,
        constructorDefault: true,
      },
    ),
    combine([first, callback.info]),
  );
}

/**
 * Reports a Schema whose decoded or encoded type admits null, at the first
 * argument of the call. The null-to-missing and null-default operations need
 * nonnullable field types.
 */
function rejectNullableSchema(
  c: SchemaContext,
  call: SchemaCall,
  schema: SchemaNode | undefined,
): SchemaContext {
  const nil = c.table.literal(null);
  if (
    schema !== undefined &&
    (c.assignable(nil, schema.decoded) || c.assignable(nil, schema.encoded))
  ) {
    c = c.report(
      "type-mismatch/010",
      `${call.name} needs nonnullable decoded and encoded field types`,
      call.args[0].node,
    );
  }
  return c;
}

/** The Schema of an optional key over `schema`. The encoded side admits null when `nullEncoded` is set. */
function optionalKeySchema(
  c: SchemaContext,
  schema: SchemaNode | undefined,
  nullEncoded: boolean,
): TypeRef {
  if (schema === undefined) return c.table.error;
  return c.table.schema(
    schema.decoded,
    nullEncoded
      ? c.table.union([schema.encoded, c.table.literal(null)])
      : schema.encoded,
    schema.decodeRequirements,
    schema.encodeRequirements,
    {
      presence: "optional",
      makeInput: schema.makeInput ?? schema.decoded,
      constructorDefault: schema.constructorDefault ?? false,
    },
  );
}

function schemaNullToMissingKeyCall(
  c: SchemaContext,
  call: SchemaCall,
): NodeInfo {
  const initial = firstSchema(c, call);
  c = rejectNullableSchema(c, call, initial.schema);
  return c.finish(
    call.node,
    optionalKeySchema(c, initial.schema, true),
    combine([initial.first]),
  );
}

function schemaOptionalKeyCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const initial = firstSchema(c, call);
  return c.finish(
    call.node,
    optionalKeySchema(c, initial.schema, false),
    combine([initial.first]),
  );
}

function schemaArrayCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  return c.finish(
    call.node,
    schema === undefined ? c.table.error : c.table.schema(
      c.table.array(schema.decoded),
      c.table.array(schema.encoded),
      schema.decodeRequirements,
      schema.encodeRequirements,
      { makeInput: c.table.array(schema.makeInput ?? schema.decoded) },
    ),
    combine([first]),
  );
}

function schemaOptionFromOptionalKeyCall(
  c: SchemaContext,
  call: SchemaCall,
): NodeInfo {
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  return c.finish(
    call.node,
    schema === undefined ? c.table.error : c.table.schema(
      c.table.option(schema.decoded),
      schema.encoded,
      schema.decodeRequirements,
      schema.encodeRequirements,
      { presence: "encoded-optional" },
    ),
    combine([first]),
  );
}

/**
 * The Schema operations `default-key`, `default-null-key`, and
 * `default-encoded-key`, which the `on` option of `schemaDefaultKey` selects.
 * `direction` names the field type that the default callback returns.
 * `nullable` adds null to the encoded type and rejects a nullable field.
 */
function schemaDefaultKeyCall(c: SchemaContext, call: SchemaCall, variant: {
  readonly direction: "decoded" | "encoded";
  readonly nullable: boolean;
}): NodeInfo {
  const node = call.node;
  const name = call.name;
  const args = call.args;
  const direction = variant.direction;
  const nullable = variant.nullable;
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  if (nullable) c = rejectNullableSchema(c, call, schema);
  const nil = c.table.literal(null);
  const defaultType = direction === "encoded"
    ? schema?.encoded
    : schema?.decoded;
  const fallback = c.callback(name, args[1], [], defaultType, true);
  const fallbackFn = c.functionOf(fallback.info.type);
  if (
    fallbackFn !== undefined &&
    !failsOnlyWith(fallbackFn.failures, [SCHEMA_ISSUE_ID, SCHEMA_ERROR_ID])
  ) {
    c = c.report(
      "type-mismatch/010",
      `${name} callback may fail only with SchemaIssue or SchemaError`,
      args[1].node,
    );
  }
  if (kindOf(c.tree, args[1].node) !== SyntaxKind.ArrowExpr) {
    c = c.report(
      "type-mismatch/010",
      `${name} needs an inline default callback`,
      args[1].node,
    );
  }
  if (
    defaultType !== undefined &&
    !c.assignable(fallback.result, defaultType)
  ) {
    c = c.report(
      "type-mismatch/003",
      `${name} callback must return the ${direction} field type`,
      args[1].node,
    );
  }
  const options = args[2] === undefined ? undefined : c.argInfo(
    args[2],
    c.table.record([{
      name: DEFAULT_KEY_OPTION,
      type: c.table.union(DEFAULT_KEY_ON.map((on) => c.table.literal(on))),
      optional: true,
    }, {
      name: "encodingStrategy",
      type: c.table.union([
        c.table.literal("omit"),
        c.table.literal("passthrough"),
      ]),
      optional: true,
    }]),
  );
  if (options !== undefined && !defaultKeyOptionsShape(c, args[2].node)) {
    c = c.report(
      "type-mismatch/010",
      `${name} options must be an inline { on?: "missing" | "null" | "encoded", encodingStrategy?: "omit" | "passthrough" } record with literal values`,
      args[2].node,
    );
  }
  return c.finish(
    node,
    schema === undefined ? c.table.error : c.table.schema(
      schema.decoded,
      nullable ? c.table.union([schema.encoded, nil]) : schema.encoded,
      [...schema.decodeRequirements, ...(fallbackFn?.requirements ?? [])],
      schema.encodeRequirements,
      {
        presence: "encoded-optional",
        makeInput: schema.makeInput ?? schema.decoded,
        constructorDefault: schema.constructorDefault ?? false,
      },
    ),
    combine([
      first,
      fallback.info,
      ...(options === undefined ? [] : [options]),
    ]),
  );
}

/** `schemaDecode`, `schemaEncode`, and `schemaMake`: run a Schema on a value. */
function schemaOperationCall(
  c: SchemaContext,
  call: SchemaCall,
): NodeInfo {
  const node = call.node;
  const op = call.op;
  const args = call.args;
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  let inputHint: TypeRef | undefined;
  if (op === "make") inputHint = schema?.makeInput ?? schema?.decoded;
  if (op === "encode") inputHint = schema?.decoded;
  const input = c.argInfo(
    args[1],
    inputHint,
  );
  if (
    op !== "encode" && schema !== undefined &&
    c.table.containsForeignSealed(c.module, schema.decoded)
  ) {
    c = c.report(
      "sealed/004",
      `only the declaring module can run schema${
        op === "decode" ? "Decode" : "Make"
      } for a sealed type`,
      node,
    );
  }
  if (op !== "decode" && schema !== undefined) {
    c = c.checkFit(
      args[1].node,
      input.type,
      op === "make" ? schema.makeInput ?? schema.decoded : schema.decoded,
      `the schema ${op} input`,
    );
  }
  let result = c.table.error;
  if (schema !== undefined) {
    result = op === "encode" ? schema.encoded : schema.decoded;
  }
  let requirements: readonly CapabilityId[] = [];
  if (schema !== undefined && op === "decode") {
    requirements = schema.decodeRequirements;
  }
  if (schema !== undefined && op === "encode") {
    requirements = schema.encodeRequirements;
  }
  return c.finish(
    node,
    result,
    combine([first, input, {
      failures: [op === "make" ? SCHEMA_ISSUE_ID : SCHEMA_ERROR_ID],
      requirements: requirements,
      mode: "effect",
    }]),
  );
}

function schemaTransformCall(c: SchemaContext, call: SchemaCall): NodeInfo {
  const node = call.node;
  const name = call.name;
  const args = call.args;
  const initial = firstSchema(c, call);
  const first = initial.first;
  const schema = initial.schema;
  const targetInfo = c.argInfo(args[1], undefined);
  const target = schemaOf(c, call, targetInfo, args[1].node);
  if (schema === undefined || target === undefined) {
    const rest = args.slice(2).map((arg) => c.argInfo(arg, undefined));
    return c.finish(node, c.table.error, combine([first, targetInfo, ...rest]));
  }
  if (
    c.table.containsForeignSealed(c.module, schema.decoded) &&
    !c.table.containsForeignSealed(c.module, target.decoded)
  ) {
    c = c.report(
      "sealed/004",
      "only the declaring module can pass a sealed type to a schema transformation callback",
      node,
    );
  }
  const decode = c.callback(
    name,
    args[2],
    [schema.decoded],
    c.table.option(target.encoded),
    true,
  );
  const encode = c.callback(
    name,
    args[3],
    [target.encoded],
    c.table.option(schema.decoded),
    true,
  );
  const decodeFn = c.functionOf(decode.info.type);
  const encodeFn = c.functionOf(encode.info.type);
  if (
    kindOf(c.tree, args[2].node) !== SyntaxKind.ArrowExpr ||
    kindOf(c.tree, args[3].node) !== SyntaxKind.ArrowExpr
  ) {
    c = c.report(
      "type-mismatch/010",
      "schemaTransform needs inline callbacks",
      node,
    );
  }
  if (
    !failsOnlyWith(decodeFn?.failures, [SCHEMA_ISSUE_ID]) ||
    !failsOnlyWith(encodeFn?.failures, [SCHEMA_ISSUE_ID])
  ) {
    c = c.report(
      "type-mismatch/010",
      "schema transformations may fail only with SchemaIssue",
      node,
    );
  }
  const decodeExpected = decodeFn?.failures.includes(SCHEMA_ISSUE_ID)
    ? target.encoded
    : c.table.option(target.encoded);
  const encodeExpected = encodeFn?.failures.includes(SCHEMA_ISSUE_ID)
    ? schema.decoded
    : c.table.option(schema.decoded);
  if (
    !c.assignable(decode.result, decodeExpected) ||
    !c.assignable(encode.result, encodeExpected)
  ) {
    c = c.report(
      "type-mismatch/003",
      "schema transformation callbacks must return Option or issue-failing values in their direction",
      node,
    );
  }
  return c.finish(
    node,
    c.table.schema(target.decoded, schema.encoded, [
      ...schema.decodeRequirements,
      ...target.decodeRequirements,
      ...(decodeFn?.requirements ?? []),
    ], [
      ...schema.encodeRequirements,
      ...target.encodeRequirements,
      ...(encodeFn?.requirements ?? []),
    ], { makeInput: target.makeInput ?? target.decoded }),
    combine([first, targetInfo, decode.info, encode.info]),
  );
}

/**
 * The shared tail of schemaOptionalTransform and schemaOptionalFromRequired.
 * Both bridge a source field to an optional target. A required source passes
 * its value to the decode callback and reads its value from the encode
 * callback. An optional source passes and reads an Option.
 */
function optionalBridge(
  c: SchemaContext,
  call: SchemaCall,
  parts: {
    readonly sourceInfo: NodeInfo;
    readonly targetInfo: NodeInfo;
    readonly source: SchemaNode;
    readonly target: SchemaNode;
  },
): NodeInfo {
  const node = call.node;
  const name = call.name;
  const args = call.args;
  const fromRequired = name === "schemaOptionalFromRequired";
  const sourceInfo = parts.sourceInfo;
  const targetInfo = parts.targetInfo;
  const source = parts.source;
  const target = parts.target;
  if (
    c.table.containsForeignSealed(c.module, source.decoded) &&
    !c.table.containsForeignSealed(c.module, target.decoded)
  ) {
    c = c.report(
      "sealed/004",
      `only the declaring module can pass a sealed type to a ${name} callback`,
      node,
    );
  }
  const sourceValue = fromRequired
    ? source.decoded
    : c.table.option(source.decoded);
  const decode = c.callback(
    name,
    args[2],
    [sourceValue],
    c.table.option(target.encoded),
    true,
  );
  const encode = c.callback(
    name,
    args[3],
    [c.table.option(target.encoded)],
    sourceValue,
    true,
  );
  const decodeFn = c.functionOf(decode.info.type);
  const encodeFn = c.functionOf(encode.info.type);
  if (
    !failsOnlyWith(decodeFn?.failures, [SCHEMA_ISSUE_ID]) ||
    !failsOnlyWith(encodeFn?.failures, [SCHEMA_ISSUE_ID])
  ) {
    c = c.report(
      "type-mismatch/010",
      `${name} callbacks may fail only with SchemaIssue`,
      node,
    );
  }
  if (
    kindOf(c.tree, args[2].node) !== SyntaxKind.ArrowExpr ||
    kindOf(c.tree, args[3].node) !== SyntaxKind.ArrowExpr
  ) {
    c = c.report("type-mismatch/010", `${name} needs inline callbacks`, node);
  }
  if (
    !c.assignable(decode.result, c.table.option(target.encoded)) ||
    !c.assignable(encode.result, sourceValue)
  ) {
    c = c.report(
      "type-mismatch/003",
      fromRequired
        ? `${name} decode must return optional target-encoded values and encode must return a required source-decoded value`
        : `${name} callbacks must return directional Option values`,
      node,
    );
  }
  return c.finish(
    node,
    c.table.schema(target.decoded, source.encoded, [
      ...source.decodeRequirements,
      ...target.decodeRequirements,
      ...(decodeFn?.requirements ?? []),
    ], [
      ...source.encodeRequirements,
      ...target.encodeRequirements,
      ...(encodeFn?.requirements ?? []),
    ], {
      presence: fromRequired ? "decoded-optional" : "optional",
      makeInput: target.makeInput ?? target.decoded,
      constructorDefault: target.constructorDefault ?? false,
    }),
    combine([sourceInfo, targetInfo, decode.info, encode.info]),
  );
}

function guardedSchemaCallback(c: SchemaContext, node: NodeId): boolean {
  if (kindOf(c.tree, node) !== SyntaxKind.ArrowExpr) {
    return false;
  }
  const parts = c.kids(node);
  const params = functionParts(c.tree, node).paramList;
  const first = params === undefined
    ? undefined
    : c.kidsOfKind(params, SyntaxKind.Param)[0];
  const name = first === undefined
    ? undefined
    : c.kidsOfKind(first, SyntaxKind.Name)[0];
  const self = name === undefined ? undefined : c.targets.get(name);
  const body = parts.at(-1);
  function builtin(part: NodeId): string | undefined {
    if (kindOf(c.tree, part) !== SyntaxKind.CallExpr) {
      return undefined;
    }
    const callee = c.kids(part)[0];
    const target = callee === undefined ? undefined : c.targets.get(callee);
    return target?.kind === "builtin" ? target.name : undefined;
  }
  if (
    self?.kind !== "local" || body === undefined ||
    kindOf(c.tree, body) !== SyntaxKind.CallExpr ||
    recursionRoleOf(builtin(body)) !== "container"
  ) {
    return false;
  }
  const selfId = self.id;
  function isSelf(part: NodeId): boolean {
    const target = c.targets.get(part);
    return kindOf(c.tree, part) === SyntaxKind.NameExpr &&
      target?.kind === "local" && target.id === selfId;
  }
  function containsSelf(part: NodeId): boolean {
    return isSelf(part) || c.kids(part).some(containsSelf);
  }
  const union = builtin(body) === "schemaUnion";
  function findList(part: NodeId): NodeId | undefined {
    if (kindOf(c.tree, part) === SyntaxKind.ListExpr) return part;
    return c.kids(part).map(findList).find((found) => found !== undefined);
  }
  const list = union ? findList(body) : undefined;
  const tags = list === undefined ? [] : c.kids(list).map((branch) => {
    const info = c.infos.get(branch);
    const schema = info === undefined
      ? undefined
      : c.table.node(c.table.unfold(info.type));
    const decoded = schema?.kind === "schema"
      ? c.table.node(c.table.unfold(schema.decoded))
      : undefined;
    const encoded = schema?.kind === "schema"
      ? c.table.node(c.table.unfold(schema.encoded))
      : undefined;
    let candidates = emptyMap<string, string>();
    if (decoded?.kind !== "record" || encoded?.kind !== "record") {
      return candidates;
    }
    for (const field of decoded.fields) {
      if (field.optional) {
        continue;
      }
      const other = encoded.fields.find((item) => item.name === field.name);
      if (other === undefined || other.optional) {
        continue;
      }
      const left = c.table.node(c.table.unfold(field.type));
      const right = c.table.node(c.table.unfold(other.type));
      if (
        left.kind === "literal" && right.kind === "literal" &&
        typeof left.value === "string" && left.value === right.value
      ) {
        candidates = candidates.set(field.name, left.value);
      }
    }
    return candidates;
  });
  const tagged = tags.length >= 2 && [...tags[0].keys()].some((name) => {
    const values = tags.map((candidate) => candidate.get(name));
    return values.every((value) => value !== undefined) &&
      setFrom(values).size === values.length;
  });
  const finiteChoice = list !== undefined &&
    tagged &&
    c.kids(list).some((branch) => !containsSelf(branch));
  let found = false;
  function visit(part: NodeId, guarded: boolean): boolean {
    if (!containsSelf(part)) {
      return true;
    }
    if (isSelf(part)) {
      found = true;
      return guarded;
    }
    if (kindOf(c.tree, part) === SyntaxKind.CallExpr) {
      const role = recursionRoleOf(builtin(part));
      const args = c.kids(part).find((child) =>
        kindOf(c.tree, child) === SyntaxKind.ArgList
      );
      const values = args === undefined ? [] : c.kids(args);
      if (role === "pass-first") {
        return values.length >= 2 &&
          values.slice(1).every((value) => !containsSelf(value)) &&
          visit(values[0], guarded);
      }
      if (role === "pass-two") {
        return values.length === 4 &&
          values.slice(2).every((value) => !containsSelf(value)) &&
          values.slice(0, 2).every((value) => visit(value, guarded));
      }
      if (role === "guard") {
        return values.every((value) => visit(value, true));
      }
      if (role === "container") {
        return values.every((value) => visit(value, guarded));
      }
      return false;
    }
    return c.kids(part).every((child) => visit(child, guarded));
  }
  return visit(body, finiteChoice) && found;
}

/** Creates the shared row with the exact Schema builtin name type. */
function schemaRow<Name extends SchemaBuiltinName>(): BuiltinRow<
  Name,
  SchemaContext
> {
  const prologue: SharedPrologue<Name, SchemaContext> = {
    arity: (name, args) => {
      const builtin: SchemaBuiltin = SCHEMA_BUILTINS[name];
      return builtin.acceptsOptions && args.length === 3 ? 3 : builtin.arity;
    },
    bail: "pure",
    pipeline: "direct",
    fact: (c, name, args) => {
      const builtin: SchemaBuiltin = SCHEMA_BUILTINS[name];
      if (builtin.acceptsOptions && args.length === 3) {
        const op = defaultKeyChoice(c, name, args[2]);
        return {
          kind: "schema",
          op: op,
          options: true,
        };
      }
      return { kind: "schema", op: builtin.op, options: false };
    },
  };
  function handle(
    c: SchemaContext,
    node: NodeId,
    name: Name,
    args: readonly Arg[],
    expected: TypeRef | undefined,
  ): NodeInfo {
    return schemaCall(c, node, name, args, expected);
  }
  return { prologue: prologue, handle: handle };
}

export function schemaRows(): Rows<SchemaBuiltinName, SchemaContext> {
  return {
    schema: schemaRow(),
    schemaArray: schemaRow(),
    schemaStruct: schemaRow(),
    schemaOptionalKey: schemaRow(),
    schemaNullToMissingKey: schemaRow(),
    schemaOptionFromOptionalKey: schemaRow(),
    schemaDefaultKey: schemaRow(),
    schemaConstructorDefault: schemaRow(),
    schemaOptionalTransform: schemaRow(),
    schemaOptionalFromRequired: schemaRow(),
    schemaUnion: schemaRow(),
    schemaTransform: schemaRow(),
    schemaRecursive: schemaRow(),
    schemaDecode: schemaRow(),
    schemaEncode: schemaRow(),
    schemaMake: schemaRow(),
  };
}
