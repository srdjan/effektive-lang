import type { Revision } from "./db.ts";
import type { FileIndex } from "./declaration_index.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { symbolIndex, type SymbolOccurrence } from "./editor_index.ts";
import { lex, TokenKind, TriviaKind } from "./lex.ts";
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
export interface SemanticClassification {
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

const contextualKeywords = new Set([
  "where",
  "type",
  "error",
  "sealed",
  "service",
  "provider",
  "opaque",
  "fails",
  "provides",
  "borrow",
  "pure",
  "using",
]);

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
      const declaration = occurrence.declaration;
      const entry = declaration === undefined
        ? undefined
        : revision.moduleInfoAt(declaration.source)?.index.decls.find((d) =>
          d.nameSpan.start === declaration.start
        );
      return entry?.isArrow ? "function" : "variable";
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
      kind >= TokenKind.KwImport && kind <= TokenKind.KwNull ||
      kind === TokenKind.KwFinally || kind === TokenKind.KwWith ||
      kind === TokenKind.Ident &&
        contextualKeywords.has(text.slice(span.start, span.end))
    ) output.push({ span, type: "keyword", modifiers: [] });
    else if (kind === TokenKind.Ident) {
      output.push({ span, type: "variable", modifiers: [] });
    } else if (kind >= TokenKind.Arrow) {
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
    const names = new Set(
      fileIndex.decls.flatMap((d) => [
        d.nameSpan.start,
        ...d.methodList.map((m) => m.nameSpan.start),
      ]),
    );
    for (let i = 0; i < output.length; i++) {
      if (names.has(output[i].span.start)) {
        const declaration = fileIndex.decls.find((d) =>
          d.nameSpan.start === output[i].span.start
        );
        const type = declaration?.kind === "type"
          ? "type"
          : declaration?.kind === "error"
          ? "class"
          : declaration?.kind === "service"
          ? "interface"
          : declaration?.isArrow
          ? "function"
          : declaration === undefined
          ? "method"
          : "variable";
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
