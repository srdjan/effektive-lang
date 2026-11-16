// Syntax highlighting from the core lexer. The page and the compiler
// then agree on every token. The function merges the token table and the trivia
// table into one sorted list of ranges. Words and spaces that need no color give
// no range.
//
// The lexer reads `imports`, `type`, `error`, `service`, `provider`, `fails`,
// `provides`, and `from` as names. This file gives them the keyword kind by
// position, from the token stream.

import {
  BUILTIN_TYPE_NAMES,
  contextualWordsOf,
  isFromKeyword,
  isKeywordKind,
  lex,
  OPERATOR_KINDS,
  PRELUDE_NAMES,
  TokenKind,
  tokenKind,
  TriviaKind,
} from "../../src/core/frontend.ts";
import { emptySet, indices, reverseIndices } from "../../src/core/frontend.ts";

export type HighlightKind =
  | "keyword"
  | "builtin"
  | "type"
  | "string"
  | "number"
  | "comment"
  | "operator";

/** A range of the text. `to` is exclusive. Ranges do not overlap. */
type HighlightRange = {
  readonly from: number;
  readonly to: number;
  readonly kind: HighlightKind;
};

type HighlightText = string;

/** Words that are keywords at the start of a line or after `export`. */
function declarationWords(): ReadonlySet<string> {
  return contextualWordsOf(["declaration"]);
}

/**
 * Words that are keywords wherever they appear as a name: the clause words. The
 * positional words `where` and `using`, the modifiers, `imports`, and `from`
 * have their own rules below.
 */
function clauseWords(): ReadonlySet<string> {
  return contextualWordsOf(["clause"]);
}

function isCapitalized(word: string): boolean {
  const first = word.charCodeAt(0);
  return first >= 0x41 && first <= 0x5a;
}

function functionTypeOpeners(
  kinds: ArrayLike<number>,
  count: number,
): ReadonlySet<number> {
  let openers = emptySet<number>();
  const closes: boolean[] = [];
  let next: TokenKind | undefined = TokenKind.Eof;
  for (const i of reverseIndices(count)) {
    const kind = tokenKind(kinds[i]);
    if (kind === TokenKind.RParen) {
      closes[closes.length] = next === TokenKind.Arrow;
    } else if (kind === TokenKind.LParen) {
      const close = closes[closes.length - 1];
      if (close !== undefined) closes.length = closes.length - 1;
      if (close) openers = openers.add(i);
    }
    if (kind !== TokenKind.Newline) next = kind;
  }
  return openers;
}

/** Token indexes of complete service headers in the leading header region. */
function serviceImportOpeners(
  text: string,
  kinds: ArrayLike<number>,
  starts: ArrayLike<number>,
  ends: ArrayLike<number>,
  count: number,
): ReadonlySet<number> {
  let openers = emptySet<number>();
  let headersAllowed = true;
  let lineStart = true;
  let skipThrough = -1;
  for (const i of indices(count)) {
    if (i <= skipThrough) continue;
    const kind = tokenKind(kinds[i]);
    if (kind === TokenKind.Newline || kind === TokenKind.Semicolon) {
      lineStart = true;
      continue;
    }
    if (kind === TokenKind.Eof) break;
    if (
      headersAllowed && lineStart && kind === TokenKind.Ident &&
      text.slice(starts[i], ends[i]) === "imports" &&
      kinds[i + 1] === TokenKind.Ident && kinds[i + 2] === TokenKind.Ident &&
      text.slice(starts[i + 2], ends[i + 2]) === "from" &&
      kinds[i + 3] === TokenKind.String
    ) {
      openers = openers.add(i);
      skipThrough = i + 3;
      lineStart = false;
      continue;
    }
    headersAllowed = false;
    lineStart = false;
  }
  return openers;
}

function skipWhitespace(text: string, start: number): number {
  for (const offset of indices(text.length - start)) {
    const index = start + offset;
    if (text[index].trim().length > 0) return index;
  }
  return text.length;
}

function isIdentifierStart(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) || code === 0x24 || code === 0x5f;
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || (code >= 0x30 && code <= 0x39);
}

function identifierEnd(text: string, start: number): number | undefined {
  if (!isIdentifierStart(text.charCodeAt(start))) return undefined;
  for (const offset of indices(text.length - start - 1)) {
    const index = start + offset + 1;
    if (!isIdentifierPart(text.charCodeAt(index))) return index;
  }
  return text.length;
}

function isWhereFunctionSuffix(text: string): boolean {
  let index = skipWhitespace(text, 0);
  if (index === 0) return false;
  if (text[index] === "(") {
    index = skipWhitespace(text, index + 1);
    const end = identifierEnd(text, index);
    if (end === undefined) return false;
    index = skipWhitespace(text, end);
    if (text[index] !== ")") return false;
    index = skipWhitespace(text, index + 1);
  } else {
    const end = identifierEnd(text, index);
    if (end === undefined) return false;
    index = skipWhitespace(text, end);
  }
  return text.slice(index, index + 2) === "=>";
}

/** The ranges of `text`, sorted by `from`. */
export function highlightTokens(text: HighlightText): HighlightRange[] {
  const lexed = lex("", text);
  const declaration = declarationWords();
  const clause = clauseWords();
  const pureTypeOpeners = functionTypeOpeners(lexed.kinds, lexed.count);
  const serviceImports = serviceImportOpeners(
    text,
    lexed.kinds,
    lexed.starts,
    lexed.ends,
    lexed.count,
  );
  const ranges: HighlightRange[] = [];

  for (const i of indices(lexed.trivia.kinds.length)) {
    const kind = lexed.trivia.kinds[i];
    if (kind === TriviaKind.LineComment || kind === TriviaKind.BlockComment) {
      ranges[ranges.length] = {
        from: lexed.trivia.starts[i],
        to: lexed.trivia.ends[i],
        kind: "comment",
      };
    }
  }

  for (const i of indices(lexed.count)) {
    const kind = tokenKind(lexed.kinds[i]);
    const from = lexed.starts[i];
    const to = lexed.ends[i];
    let result: HighlightKind | undefined;
    if (isKeywordKind(kind)) {
      result = "keyword";
    } else if (kind === TokenKind.String) {
      result = "string";
    } else if (kind === TokenKind.Number) {
      result = "number";
    } else if (kind !== undefined && OPERATOR_KINDS.has(kind)) {
      result = "operator";
    } else if (kind === TokenKind.Ident) {
      const word = text.slice(from, to);
      const previous = i === 0 ? undefined : tokenKind(lexed.kinds[i - 1]);
      const startsDeclaration = previous === undefined ||
        previous === TokenKind.Newline || previous === TokenKind.KwExport;
      const previousWord = i === 0
        ? ""
        : text.slice(lexed.starts[i - 1], lexed.ends[i - 1]);
      const beforePrevious = i < 2 ? undefined : lexed.kinds[i - 2];
      const afterSealed = previousWord === "sealed" &&
        (beforePrevious === undefined || beforePrevious === TokenKind.Newline ||
          beforePrevious === TokenKind.KwExport);
      if (serviceImports.has(i)) result = "keyword";
      else if (
        word === "using" && lexed.kinds[i + 1] === TokenKind.LParen &&
        lexed.kinds[i + 2] === TokenKind.Ident &&
        lexed.kinds[i + 3] === TokenKind.Eq
      ) result = "keyword";
      else if (
        isFromKeyword(word, tokenKind(lexed.kinds[i + 1]))
      ) result = "keyword";
      else if (clause.has(word)) result = "keyword";
      else if (
        word === "sealed" && startsDeclaration &&
        text.slice(lexed.starts[i + 1], lexed.ends[i + 1]) === "type"
      ) result = "keyword";
      else if (
        word === "where" &&
        isWhereFunctionSuffix(text.slice(lexed.ends[i]))
      ) result = "keyword";
      else if (word === "pure") {
        let open = lexed.count;
        for (const offset of indices(lexed.count - i - 1)) {
          const candidate = i + offset + 1;
          if (tokenKind(lexed.kinds[candidate]) !== TokenKind.Newline) {
            open = candidate;
            break;
          }
        }
        if (pureTypeOpeners.has(open)) result = "keyword";
      } else if (
        declaration.has(word) &&
        (startsDeclaration || (word === "type" && afterSealed))
      ) {
        result = "keyword";
      } else if (PRELUDE_NAMES.has(word)) result = "builtin";
      else if (BUILTIN_TYPE_NAMES.has(word) || isCapitalized(word)) {
        result = "type";
      }
    }
    if (result !== undefined) {
      ranges[ranges.length] = { from: from, to: to, kind: result };
    }
  }

  return ranges.sort((a, b) => a.from - b.from);
}
