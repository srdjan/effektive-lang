import type { Revision } from "./db.ts";
import type { FileIndex } from "./declaration_index.ts";
import type { Diagnostic } from "./diagnostics.ts";
import {
  DECLARATION_KINDS,
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
  TriviaKind,
} from "./lex.ts";
import { parseFileFresh } from "./project.ts";
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
interface SemanticClassification {
  readonly span: Span;
  readonly type: (typeof SEMANTIC_TOKEN_TYPES)[number];
  readonly modifiers: readonly (typeof SEMANTIC_TOKEN_MODIFIERS)[number][];
}

/** Starts of service headers before the first ordinary import or declaration. */
function serviceImportKeywordStarts(
  index: FileIndex,
  diagnostics: readonly Diagnostic[],
): ReadonlySet<number> {
  const firstOrdinary = Math.min(
    ...index.decls.map((entry) => entry.span.start),
    ...index.imports.filter((entry) => entry.role === "ordinary").map((entry) =>
      entry.span.start
    ),
    Infinity,
  );
  return new Set(
    index.imports.filter((entry) =>
      entry.role === "service" && entry.span.start < firstOrdinary &&
      !diagnostics.some((diagnostic) =>
        diagnostic.code === "syntax/008" &&
        diagnostic.span.start === entry.span.start
      )
    ).map((entry) => entry.span.start),
  );
}

/** Every contextual word except the import words: `imports` and `from` have their own rules. */
const contextualKeywords = contextualWordsOf(
  "declaration",
  "modifier",
  "clause",
  "positional",
);

function resolvedKind(
  revision: Revision,
  occurrence: SymbolOccurrence,
): SemanticClassification["type"] {
  switch (occurrence.target.kind) {
    case "type":
      return revision.types.taggedRecordOf(occurrence.target.id) === undefined
        ? "type"
        : "class";
    case "builtin-type":
      return "type";
    case "error":
      return "class";
    case "service":
      return "interface";
    case "cap":
      return "method";
    case "field":
      return "property";
    case "builtin":
      return "function";
    case "local":
      return symbolIndex(revision).locals.get(
          occurrence.declaration?.source ?? "",
        )?.find((l) => l.identity === occurrence.identity)?.parameter
        ? "parameter"
        : "variable";
    case "value": {
      return isArrowDeclaration(revision, occurrence.declaration)
        ? "function"
        : "variable";
    }
    default:
      return "variable";
  }
}

/** Resolver classifications where available and lexical fallback everywhere else. */
export function semanticClassifications(
  revision: Revision | undefined,
  path: string,
  text: string,
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
    ? new Set<number>()
    : serviceImportKeywordStarts(
      fileIndex,
      moduleInfo?.parseDiagnostics ?? parsed?.parsed.diagnostics ?? [],
    );
  const occurrences = matching === undefined
    ? []
    : symbolIndex(matching).byPath.get(path) ?? [];
  const byStart = new Map(occurrences.map((o) => [o.span.start, o]));
  const lexed = lex(path, text);
  const output: SemanticClassification[] = [];
  for (let i = 0; i < lexed.count; i++) {
    const kind = lexed.kinds[i];
    const span = { source: path, start: lexed.starts[i], end: lexed.ends[i] };
    if (span.start === span.end || kind === TokenKind.Newline) continue;
    const occurrence = byStart.get(span.start);
    if (
      occurrence !== undefined && occurrence.span.end === span.end &&
      matching !== undefined
    ) {
      output.push({
        span,
        type: resolvedKind(matching, occurrence),
        modifiers: [
          ...(occurrence.isDeclaration ? ["declaration" as const] : []),
          ...(occurrence.declaration !== undefined ||
              occurrence.target.kind === "builtin"
            ? ["readonly" as const]
            : []),
        ],
      });
    } else if (kind === TokenKind.String) {
      output.push({ span, type: "string", modifiers: [] });
    } else if (kind === TokenKind.Number) {
      output.push({ span, type: "number", modifiers: [] });
    } else if (
      kind === TokenKind.Ident && serviceImports.has(span.start) &&
      text.slice(span.start, span.end) === "imports"
    ) {
      output.push({ span, type: "keyword", modifiers: [] });
    } else if (
      kind === TokenKind.Ident &&
      isFromKeyword(
        text.slice(span.start, span.end),
        lexed.kinds[i + 1] as TokenKind | undefined,
      )
    ) {
      output.push({ span, type: "keyword", modifiers: [] });
    } else if (
      isKeywordKind(kind) ||
      kind === TokenKind.Ident &&
        contextualKeywords.has(text.slice(span.start, span.end))
    ) output.push({ span, type: "keyword", modifiers: [] });
    else if (kind === TokenKind.Ident) {
      output.push({ span, type: "variable", modifiers: [] });
    } else if (OPERATOR_KINDS.has(kind)) {
      output.push({ span, type: "operator", modifiers: [] });
    }
  }
  for (let i = 0; i < lexed.trivia.kinds.length; i++) {
    if (
      lexed.trivia.kinds[i] === TriviaKind.LineComment ||
      lexed.trivia.kinds[i] === TriviaKind.BlockComment
    ) {
      output.push({
        span: {
          source: path,
          start: lexed.trivia.starts[i],
          end: lexed.trivia.ends[i],
        },
        type: "comment",
        modifiers: [],
      });
    }
  }
  // Declarations recovered from otherwise broken regions can still be marked.
  if (matching === undefined && fileIndex !== undefined) {
    const types = new Map<number, SemanticClassification["type"]>();
    for (const d of fileIndex.decls) {
      if (!types.has(d.nameSpan.start)) {
        types.set(
          d.nameSpan.start,
          DECLARATION_KINDS.get(d.kind) ??
            (d.isArrow ? "function" : "variable"),
        );
      }
      for (const m of d.methodList) {
        if (!types.has(m.nameSpan.start)) types.set(m.nameSpan.start, "method");
      }
    }
    for (let i = 0; i < output.length; i++) {
      const type = types.get(output[i].span.start);
      if (type !== undefined) {
        output[i] = {
          ...output[i],
          type,
          modifiers: ["declaration", "readonly"],
        };
      }
    }
  }
  return output.sort((a, b) => a.span.start - b.span.start);
}
