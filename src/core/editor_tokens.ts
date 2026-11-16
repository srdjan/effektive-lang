import type { Revision } from "./db.ts";
import type { FileIndex } from "./declaration_index.ts";
import type { Diagnostic } from "./diagnostics.ts";
import {
  declarationKind,
  isArrowDeclaration,
  symbolIndex,
  type SymbolOccurrence,
} from "./editor_index.ts";
import {
  contextualWordsOf,
  isFromKeyword,
  isKeywordKind,
  lex,
  OPERATOR_KINDS,
  TokenKind,
  tokenKind,
  TriviaKind,
} from "./lex.ts";
import { parseFileFresh } from "./project.ts";
import { emptyMap, emptySet, indices, mapFrom, setFrom } from "./runtime.ts";
import type { Span } from "./source.ts";

export const SEMANTIC_TOKEN_TYPES = [
  "type",
  "class",
  "interface",
  "parameter",
  "variable",
  "property",
  "function",
  "method",
  "keyword",
  "string",
  "number",
  "comment",
  "operator",
] as const;
export const SEMANTIC_TOKEN_MODIFIERS = ["declaration", "readonly"] as const;
type SemanticClassification = {
  readonly span: Span;
  readonly type: (typeof SEMANTIC_TOKEN_TYPES)[number];
  readonly modifiers: readonly (typeof SEMANTIC_TOKEN_MODIFIERS)[number][];
};

export type EditorPath = string;
export type EditorText = string;

/** Starts of service headers before the first ordinary import or declaration. */
function serviceImportKeywordStarts(
  index: FileIndex,
  diagnostics: readonly Diagnostic[],
): ReadonlySet<number> {
  const ordinaryStarts = index.decls.map((entry) => entry.span.start).concat(
    index.imports.filter((entry) => entry.role === "ordinary").map((entry) =>
      entry.span.start
    ),
  );
  const firstOrdinary = ordinaryStarts.reduce(
    (first, start) => Math.min(first, start),
    Infinity,
  );
  return setFrom(
    index.imports.filter((entry) =>
      entry.role === "service" && entry.span.start < firstOrdinary &&
      !diagnostics.some((diagnostic) =>
        diagnostic.code === "syntax/008" &&
        diagnostic.span.start === entry.span.start
      )
    ).map((entry) => entry.span.start),
  );
}

function resolvedKind(
  revision: Revision,
  occurrence: SymbolOccurrence,
): SemanticClassification["type"] {
  const target = occurrence.target;
  if (target.kind === "type") {
    return revision.types.taggedRecordOf(target.id) === undefined
      ? "type"
      : "class";
  }
  if (target.kind === "builtin-type") return "type";
  if (target.kind === "error") return "class";
  if (target.kind === "service") return "interface";
  if (target.kind === "cap") return "method";
  if (target.kind === "field") return "property";
  if (target.kind === "builtin") return "function";
  if (target.kind === "local") {
    return symbolIndex(revision).locals.get(
        occurrence.declaration?.source ?? "",
      )?.find((local) => local.identity === occurrence.identity)?.parameter
      ? "parameter"
      : "variable";
  }
  if (target.kind === "value") {
    return isArrowDeclaration(revision, occurrence.declaration)
      ? "function"
      : "variable";
  }
  return "variable";
}

/** Resolver classifications where available and lexical fallback everywhere else. */
export function semanticClassifications(
  revision: Revision | undefined,
  path: EditorPath,
  text: EditorText,
): readonly SemanticClassification[] {
  const matching = revision?.sourceTexts().get(path) === text
    ? revision
    : undefined;
  const parsed = matching === undefined
    ? parseFileFresh(path, text)
    : undefined;
  const moduleInfo = matching?.moduleInfoAt(path);
  const fileIndex = moduleInfo?.index ?? parsed?.index;
  const serviceImports = fileIndex === undefined
    ? emptySet<number>()
    : serviceImportKeywordStarts(
      fileIndex,
      moduleInfo?.parseDiagnostics ?? parsed?.parsed.diagnostics ?? [],
    );
  const occurrences = matching === undefined
    ? []
    : symbolIndex(matching).byPath.get(path) ?? [];
  const byStart = mapFrom(
    occurrences.map((occurrence) =>
      [occurrence.span.start, occurrence] as const
    ),
  );
  const lexed = lex(path, text);
  const contextualKeywords = contextualWordsOf([
    "declaration",
    "modifier",
    "clause",
    "positional",
  ]);
  const output: SemanticClassification[] = [];
  for (const i of indices(lexed.count)) {
    const kind = tokenKind(lexed.kinds[i]);
    const span = { source: path, start: lexed.starts[i], end: lexed.ends[i] };
    if (span.start === span.end || kind === TokenKind.Newline) continue;
    const occurrence = byStart.get(span.start);
    if (
      occurrence !== undefined && occurrence.span.end === span.end &&
      matching !== undefined
    ) {
      output[output.length] = {
        span: span,
        type: resolvedKind(matching, occurrence),
        modifiers: [
          ...(occurrence.isDeclaration ? ["declaration" as const] : []),
          ...(occurrence.declaration !== undefined ||
              occurrence.target.kind === "builtin"
            ? ["readonly" as const]
            : []),
        ],
      };
    } else if (kind === TokenKind.String) {
      output[output.length] = { span: span, type: "string", modifiers: [] };
    } else if (kind === TokenKind.Number) {
      output[output.length] = { span: span, type: "number", modifiers: [] };
    } else if (
      kind === TokenKind.Ident && serviceImports.has(span.start) &&
      text.slice(span.start, span.end) === "imports"
    ) {
      output[output.length] = { span: span, type: "keyword", modifiers: [] };
    } else if (
      kind === TokenKind.Ident &&
      isFromKeyword(
        text.slice(span.start, span.end),
        i + 1 < lexed.count ? tokenKind(lexed.kinds[i + 1]) : undefined,
      )
    ) {
      output[output.length] = { span: span, type: "keyword", modifiers: [] };
    } else if (
      isKeywordKind(kind) ||
      kind === TokenKind.Ident &&
        contextualKeywords.has(text.slice(span.start, span.end))
    ) output[output.length] = { span: span, type: "keyword", modifiers: [] };
    else if (kind === TokenKind.Ident) {
      output[output.length] = { span: span, type: "variable", modifiers: [] };
    } else if (kind !== undefined && OPERATOR_KINDS.has(kind)) {
      output[output.length] = { span: span, type: "operator", modifiers: [] };
    }
  }
  for (const i of indices(lexed.trivia.kinds.length)) {
    if (
      lexed.trivia.kinds[i] === TriviaKind.LineComment ||
      lexed.trivia.kinds[i] === TriviaKind.BlockComment
    ) {
      output[output.length] = {
        span: {
          source: path,
          start: lexed.trivia.starts[i],
          end: lexed.trivia.ends[i],
        },
        type: "comment",
        modifiers: [],
      };
    }
  }
  // Declarations recovered from otherwise broken regions can still be marked.
  if (matching === undefined && fileIndex !== undefined) {
    let types = emptyMap<number, SemanticClassification["type"]>();
    for (const d of fileIndex.decls) {
      if (!types.has(d.nameSpan.start)) {
        types = types.set(
          d.nameSpan.start,
          declarationKind(d.kind) ??
            (d.isArrow ? "function" : "variable"),
        );
      }
      for (const m of d.methodList) {
        if (!types.has(m.nameSpan.start)) {
          types = types.set(m.nameSpan.start, "method");
        }
      }
    }
    for (const i of indices(output.length)) {
      const type = types.get(output[i].span.start);
      if (type !== undefined) {
        output[i] = {
          ...output[i],
          type: type,
          modifiers: ["declaration", "readonly"],
        };
      }
    }
  }
  return output.sort((a, b) => a.span.start - b.span.start);
}
