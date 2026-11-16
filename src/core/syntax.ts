// The lossless syntax tree. Node ids are indices into per-file arrays.
// Every token (including newline tokens and the Eof token) is a leaf node, so a
// walk over the leaves in order visits every token once. Trivia stays in the lexer
// tables and the printer emits it in front of its token.

import type { Lexed } from "./lex.ts";
import { indices } from "./runtime.ts";
import { parseJson, type Span } from "./source.ts";
import type { SchemaPresence } from "./types.ts";

export type NodeId = number;

export type FileMode = "eff" | "effi";

type SyntaxKinds = {
  readonly Token: 0;
  readonly Missing: 1;
  readonly Error: 2;
  readonly Module: 3;
  readonly ImportDecl: 4;
  readonly TypeDecl: 5;
  readonly RefinementClause: 6;
  readonly ErrorDecl: 7;
  readonly ServiceDecl: 8;
  readonly ServiceMethod: 9;
  readonly ProviderDecl: 10;
  readonly ConstDecl: 11;
  readonly ParamList: 12;
  readonly Param: 13;
  readonly FailsClause: 14;
  readonly WithClause: 15;
  readonly ProvidesClause: 16;
  readonly QualifiedName: 17;
  readonly Name: 18;
  readonly NamedType: 19;
  readonly EffectType: 20;
  readonly StreamType: 21;
  readonly SinkType: 22;
  readonly SchemaType: 23;
  readonly LayerType: 24;
  readonly TypeArgs: 25;
  readonly LiteralType: 26;
  readonly RecordType: 27;
  readonly FieldType: 28;
  readonly TupleType: 29;
  readonly ArrayType: 30;
  readonly UnionType: 31;
  readonly FunctionType: 32;
  readonly ParenType: 33;
  readonly LiteralExpr: 34;
  readonly NameExpr: 35;
  readonly ParenExpr: 36;
  readonly ArrowExpr: 37;
  readonly CallExpr: 38;
  readonly ArgList: 39;
  readonly FieldExpr: 40;
  readonly BinaryExpr: 41;
  readonly UnaryExpr: 42;
  readonly PipeExpr: 43;
  readonly PipeStage: 44;
  readonly RecordExpr: 45;
  readonly ListExpr: 46;
  readonly RecordField: 47;
  readonly ShorthandField: 48;
  readonly SpreadField: 49;
  readonly SpreadElement: 50;
  readonly Block: 51;
  readonly IfExpr: 52;
  readonly MatchExpr: 53;
  readonly MatchArm: 54;
  readonly TryExpr: 55;
  readonly CatchClause: 56;
  readonly Handler: 57;
  readonly WildcardPattern: 58;
  readonly LiteralPattern: 59;
  readonly NamePattern: 60;
  readonly CtorPattern: 61;
  readonly RecordPattern: 62;
  readonly PatternField: 63;
  readonly SpreadPattern: 64;
  readonly OptionFallbackExpr: 65;
  readonly RecordBinding: 66;
  readonly BindingField: 67;
  readonly ShorthandBinding: 68;
  readonly UsingExpr: 69;
  readonly ResourceAcquire: 70;
  readonly ResourceUse: 71;
  readonly ResourceRelease: 72;
  readonly FinallyClause: 73;
};

export type SyntaxKind = SyntaxKinds[keyof SyntaxKinds];

/** Stable numeric syntax kinds stored in compact syntax-tree arrays. */
export const SyntaxKind: SyntaxKinds = {
  Token: 0,
  Missing: 1,
  Error: 2,
  Module: 3,
  ImportDecl: 4,
  TypeDecl: 5,
  RefinementClause: 6,
  ErrorDecl: 7,
  ServiceDecl: 8,
  ServiceMethod: 9,
  ProviderDecl: 10,
  ConstDecl: 11,
  ParamList: 12,
  Param: 13,
  FailsClause: 14,
  WithClause: 15,
  ProvidesClause: 16,
  QualifiedName: 17,
  Name: 18,
  NamedType: 19,
  EffectType: 20,
  StreamType: 21,
  SinkType: 22,
  SchemaType: 23,
  LayerType: 24,
  TypeArgs: 25,
  LiteralType: 26,
  RecordType: 27,
  FieldType: 28,
  TupleType: 29,
  ArrayType: 30,
  UnionType: 31,
  FunctionType: 32,
  ParenType: 33,
  LiteralExpr: 34,
  NameExpr: 35,
  ParenExpr: 36,
  ArrowExpr: 37,
  CallExpr: 38,
  ArgList: 39,
  FieldExpr: 40,
  BinaryExpr: 41,
  UnaryExpr: 42,
  PipeExpr: 43,
  PipeStage: 44,
  RecordExpr: 45,
  ListExpr: 46,
  RecordField: 47,
  ShorthandField: 48,
  SpreadField: 49,
  SpreadElement: 50,
  Block: 51,
  IfExpr: 52,
  MatchExpr: 53,
  MatchArm: 54,
  TryExpr: 55,
  CatchClause: 56,
  Handler: 57,
  WildcardPattern: 58,
  LiteralPattern: 59,
  NamePattern: 60,
  CtorPattern: 61,
  RecordPattern: 62,
  PatternField: 63,
  SpreadPattern: 64,
  OptionFallbackExpr: 65,
  RecordBinding: 66,
  BindingField: 67,
  ShorthandBinding: 68,
  UsingExpr: 69,
  ResourceAcquire: 70,
  ResourceUse: 71,
  ResourceRelease: 72,
  FinallyClause: 73,
};

const SYNTAX_KINDS: readonly SyntaxKind[] = [
  SyntaxKind.Token,
  SyntaxKind.Missing,
  SyntaxKind.Error,
  SyntaxKind.Module,
  SyntaxKind.ImportDecl,
  SyntaxKind.TypeDecl,
  SyntaxKind.RefinementClause,
  SyntaxKind.ErrorDecl,
  SyntaxKind.ServiceDecl,
  SyntaxKind.ServiceMethod,
  SyntaxKind.ProviderDecl,
  SyntaxKind.ConstDecl,
  SyntaxKind.ParamList,
  SyntaxKind.Param,
  SyntaxKind.FailsClause,
  SyntaxKind.WithClause,
  SyntaxKind.ProvidesClause,
  SyntaxKind.QualifiedName,
  SyntaxKind.Name,
  SyntaxKind.NamedType,
  SyntaxKind.EffectType,
  SyntaxKind.StreamType,
  SyntaxKind.SinkType,
  SyntaxKind.SchemaType,
  SyntaxKind.LayerType,
  SyntaxKind.TypeArgs,
  SyntaxKind.LiteralType,
  SyntaxKind.RecordType,
  SyntaxKind.FieldType,
  SyntaxKind.TupleType,
  SyntaxKind.ArrayType,
  SyntaxKind.UnionType,
  SyntaxKind.FunctionType,
  SyntaxKind.ParenType,
  SyntaxKind.LiteralExpr,
  SyntaxKind.NameExpr,
  SyntaxKind.ParenExpr,
  SyntaxKind.ArrowExpr,
  SyntaxKind.CallExpr,
  SyntaxKind.ArgList,
  SyntaxKind.FieldExpr,
  SyntaxKind.BinaryExpr,
  SyntaxKind.UnaryExpr,
  SyntaxKind.PipeExpr,
  SyntaxKind.PipeStage,
  SyntaxKind.RecordExpr,
  SyntaxKind.ListExpr,
  SyntaxKind.RecordField,
  SyntaxKind.ShorthandField,
  SyntaxKind.SpreadField,
  SyntaxKind.SpreadElement,
  SyntaxKind.Block,
  SyntaxKind.IfExpr,
  SyntaxKind.MatchExpr,
  SyntaxKind.MatchArm,
  SyntaxKind.TryExpr,
  SyntaxKind.CatchClause,
  SyntaxKind.Handler,
  SyntaxKind.WildcardPattern,
  SyntaxKind.LiteralPattern,
  SyntaxKind.NamePattern,
  SyntaxKind.CtorPattern,
  SyntaxKind.RecordPattern,
  SyntaxKind.PatternField,
  SyntaxKind.SpreadPattern,
  SyntaxKind.OptionFallbackExpr,
  SyntaxKind.RecordBinding,
  SyntaxKind.BindingField,
  SyntaxKind.ShorthandBinding,
  SyntaxKind.UsingExpr,
  SyntaxKind.ResourceAcquire,
  SyntaxKind.ResourceUse,
  SyntaxKind.ResourceRelease,
  SyntaxKind.FinallyClause,
];

const SYNTAX_KIND_NAMES: readonly string[] = [
  "Token",
  "Missing",
  "Error",
  "Module",
  "ImportDecl",
  "TypeDecl",
  "RefinementClause",
  "ErrorDecl",
  "ServiceDecl",
  "ServiceMethod",
  "ProviderDecl",
  "ConstDecl",
  "ParamList",
  "Param",
  "FailsClause",
  "WithClause",
  "ProvidesClause",
  "QualifiedName",
  "Name",
  "NamedType",
  "EffectType",
  "StreamType",
  "SinkType",
  "SchemaType",
  "LayerType",
  "TypeArgs",
  "LiteralType",
  "RecordType",
  "FieldType",
  "TupleType",
  "ArrayType",
  "UnionType",
  "FunctionType",
  "ParenType",
  "LiteralExpr",
  "NameExpr",
  "ParenExpr",
  "ArrowExpr",
  "CallExpr",
  "ArgList",
  "FieldExpr",
  "BinaryExpr",
  "UnaryExpr",
  "PipeExpr",
  "PipeStage",
  "RecordExpr",
  "ListExpr",
  "RecordField",
  "ShorthandField",
  "SpreadField",
  "SpreadElement",
  "Block",
  "IfExpr",
  "MatchExpr",
  "MatchArm",
  "TryExpr",
  "CatchClause",
  "Handler",
  "WildcardPattern",
  "LiteralPattern",
  "NamePattern",
  "CtorPattern",
  "RecordPattern",
  "PatternField",
  "SpreadPattern",
  "OptionFallbackExpr",
  "RecordBinding",
  "BindingField",
  "ShorthandBinding",
  "UsingExpr",
  "ResourceAcquire",
  "ResourceUse",
  "ResourceRelease",
  "FinallyClause",
];

/** The key and constructor options that one Schema type word selects. */
type SchemaFlags = {
  readonly presence: SchemaPresence;
  readonly constructorDefault: boolean;
};

/**
 * What one argument position of a type word holds: a type, a `provides` name
 * set, a `fails` name set, or a `with` name set.
 */
export type TypeSlotKind = "type" | "provides" | "fails" | "with";

/** One argument position of a type word. A required slot reports a missing comma before it. */
type TypeSlot = {
  readonly kind: TypeSlotKind;
  readonly required: boolean;
};

/**
 * A type word that takes `<...>` arguments: its node kind, its argument slots in
 * order, and, for Schema words, its flags. The parser reads slots from the first
 * and stops at the first slot without a comma before it, unless the slot is required.
 */
type TypeWord = {
  readonly kind: SyntaxKind;
  readonly slots: readonly TypeSlot[];
  readonly schema?: SchemaFlags;
};

const EFFECT_SLOTS: readonly TypeSlot[] = [
  { kind: "type", required: false },
  { kind: "fails", required: false },
  { kind: "with", required: false },
];

const SCHEMA_SLOTS: readonly TypeSlot[] = [
  { kind: "type", required: false },
  { kind: "type", required: false },
  { kind: "with", required: false },
  { kind: "with", required: false },
  { kind: "type", required: false },
];

function schemaWord(
  presence: SchemaPresence,
  constructorDefault: boolean,
): TypeWord {
  return {
    kind: SyntaxKind.SchemaType,
    slots: SCHEMA_SLOTS,
    schema: {
      presence: presence,
      constructorDefault: constructorDefault,
    },
  };
}

/** Returns the parser metadata for one `Word<...>` type word. */
export function typeWord(word: SyntaxText): TypeWord | undefined {
  if (word === "Effect") {
    return { kind: SyntaxKind.EffectType, slots: EFFECT_SLOTS };
  }
  if (word === "Stream") {
    return { kind: SyntaxKind.StreamType, slots: EFFECT_SLOTS };
  }
  if (word === "Sink") {
    return {
      kind: SyntaxKind.SinkType,
      slots: [
        { kind: "type", required: false },
        { kind: "type", required: true },
        { kind: "fails", required: false },
        { kind: "with", required: false },
        { kind: "type", required: false },
      ],
    };
  }
  if (word === "Layer") {
    return {
      kind: SyntaxKind.LayerType,
      slots: [
        { kind: "provides", required: false },
        { kind: "fails", required: false },
        { kind: "with", required: false },
      ],
    };
  }
  if (word === "Schema") {
    return schemaWord("required", false);
  }
  if (word === "SchemaOptional") {
    return schemaWord("optional", false);
  }
  if (word === "SchemaEncodedOptional") {
    return schemaWord("encoded-optional", false);
  }
  if (word === "SchemaDecodedOptional") {
    return schemaWord("decoded-optional", false);
  }
  if (word === "SchemaConstructorDefault") {
    return schemaWord("required", true);
  }
  if (word === "SchemaOptionalConstructorDefault") {
    return schemaWord("optional", true);
  }
  if (word === "SchemaEncodedOptionalConstructorDefault") {
    return schemaWord("encoded-optional", true);
  }
  if (word === "SchemaDecodedOptionalConstructorDefault") {
    return schemaWord("decoded-optional", true);
  }
  return undefined;
}

type TypeWords = {
  readonly get: (word: SyntaxText) => TypeWord | undefined;
};

/** The fixed type-word lookup. */
export const TYPE_WORDS: TypeWords = { get: typeWord };

const TYPE_WORD_NAMES: readonly SyntaxText[] = [
  "Effect",
  "Stream",
  "Sink",
  "Layer",
  "Schema",
  "SchemaOptional",
  "SchemaEncodedOptional",
  "SchemaDecodedOptional",
  "SchemaConstructorDefault",
  "SchemaOptionalConstructorDefault",
  "SchemaEncodedOptionalConstructorDefault",
  "SchemaDecodedOptionalConstructorDefault",
];

/** Returns the type words in their stable completion order. */
export function typeWords(): IterableIterator<SyntaxText> {
  return TYPE_WORD_NAMES.values();
}

export type SyntaxTree = {
  readonly source: string;
  readonly text: string;
  readonly mode: FileMode;
  readonly lexed: Lexed;
  readonly root: NodeId;
  /** Number of nodes. */
  readonly count: number;
  readonly kinds: Uint8Array;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  /** The parent node id, or -1 for the root. */
  readonly parents: Int32Array;
  /** The token index for a Token leaf, or -1. */
  readonly tokens: Int32Array;
  /** Children of node `n` are `children[childStart[n] .. childEnd[n])`. */
  readonly childStart: Uint32Array;
  readonly childEnd: Uint32Array;
  readonly children: Uint32Array;
};

export type SyntaxText = string;
export type SyntaxKindName = string;
export type ProblemStatus = boolean;
export type WalkDecision = boolean | undefined;

/** Decodes a string token. The lexer accepts only strings that JSON accepts. */
export function decodeString(text: SyntaxText): SyntaxText | undefined {
  const parsed = parseJson(text);
  return parsed.ok && typeof parsed.value === "string"
    ? parsed.value
    : undefined;
}

export function kindOf(tree: SyntaxTree, node: NodeId): SyntaxKind {
  return SYNTAX_KINDS[tree.kinds[node]];
}

export function kindName(kind: SyntaxKind): SyntaxKindName {
  return SYNTAX_KIND_NAMES[kind] ?? `Kind${kind}`;
}

export function childrenOf(tree: SyntaxTree, node: NodeId): Uint32Array {
  return tree.children.subarray(tree.childStart[node], tree.childEnd[node]);
}

export function nodeSpan(tree: SyntaxTree, node: NodeId): Span {
  return {
    source: tree.source,
    start: tree.starts[node],
    end: tree.ends[node],
  };
}

export function nodeText(tree: SyntaxTree, node: NodeId): SyntaxText {
  return tree.text.slice(tree.starts[node], tree.ends[node]);
}

/** Pre-order walk. Return `false` from the visitor to skip the children of a node. */
export function walk(
  tree: SyntaxTree,
  node: NodeId,
  visit: (node: NodeId) => WalkDecision,
): undefined {
  const stack: NodeId[] = [node];
  let stackCount = 1;
  for (const _visited of indices(tree.count)) {
    if (stackCount === 0) break;
    stackCount = stackCount - 1;
    const current = stack[stackCount];
    const descend = visit(current);
    if (!descend && descend !== undefined) continue;
    const kids = childrenOf(tree, current);
    for (const offset of indices(kids.length)) {
      const remaining = kids.length - offset - 1;
      stack[stackCount] = kids[remaining];
      stackCount = stackCount + 1;
    }
  }
  return undefined;
}

/** True when the subtree under `node` holds an Error or Missing node. */
export function hasProblem(tree: SyntaxTree, node: NodeId): ProblemStatus {
  let found = false;
  const pending: NodeId[] = [node];
  let pendingCount = 1;
  for (const _visited of indices(tree.count)) {
    if (found || pendingCount === 0) break;
    pendingCount = pendingCount - 1;
    const current = pending[pendingCount];
    const kind = kindOf(tree, current);
    found = kind === SyntaxKind.Error || kind === SyntaxKind.Missing;
    if (found) continue;
    const children = childrenOf(tree, current);
    for (const index of indices(children.length)) {
      pending[pendingCount] = children[index];
      pendingCount = pendingCount + 1;
    }
  }
  return found;
}

/** Prints the tree back to text: trivia and token text in tree order. */
export function printTree(tree: SyntaxTree): SyntaxText {
  const lexed = tree.lexed;
  const out: string[] = [];
  const pending: NodeId[] = [tree.root];
  let pendingCount = 1;
  for (const _visited of indices(tree.count)) {
    if (pendingCount === 0) break;
    pendingCount = pendingCount - 1;
    const node = pending[pendingCount];
    if (kindOf(tree, node) === SyntaxKind.Token) {
      const token = tree.tokens[node];
      const firstTrivia = token === 0 ? 0 : lexed.triviaEnd[token - 1];
      const triviaCount = lexed.triviaEnd[token] - firstTrivia;
      for (const offset of indices(triviaCount)) {
        const trivia = firstTrivia + offset;
        out[out.length] = tree.text.slice(
          lexed.trivia.starts[trivia],
          lexed.trivia.ends[trivia],
        );
      }
      out[out.length] = tree.text.slice(
        lexed.starts[token],
        lexed.ends[token],
      );
      continue;
    }
    const children = childrenOf(tree, node);
    for (const offset of indices(children.length)) {
      const remaining = children.length - offset - 1;
      pending[pendingCount] = children[remaining];
      pendingCount = pendingCount + 1;
    }
  }
  return out.join("");
}
